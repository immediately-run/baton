// scope.ts — a leg's scope audit (B-134, OWASP ASI10 hole 7): what a leg may touch is its
// ticket's home and `repos:` entries, and two halves report what a leg did outside it.
//
//   * The runner's half is a cooperative aid: at each leg's end it reads the refs the leg's
//     window moved in the home checkout — evidence the agent does not supply, though a hostile
//     one can hide it, since the audit runs as the runner's OS user inside the trust domain it
//     audits (docs/security-model.mdx, review finding 16) — and reports the actions outside the
//     scope with the claim (`scope-exceeded`).
//   * Baton's half is the control: the forge's push deliveries for the worker identities the
//     owners named are cross-checked against the claims open at the time (rule 3's reading of
//     a claim still holding, as `openScopes` reads it). A push by one of them to a repository
//     no open claim's scope covers is `unclaimed-write`.
//
// Each finding is raised under Needs you until an owner resolves it, and with the owners'
// `scope_policy: hold` a scope-exceeded finding holds its ticket (an owner lifts the hold the
// way any hold is lifted, R-BTN-12). The scope itself is Baton's word, never the runner's: the
// claim answer carries it, and a report is judged against it here, so a runner cannot widen its
// own scope by reporting into it.
import { logEvent } from './db';
import { isForgePath, type Forge } from './links';
import { codeReposOf } from './codeRepos';
import type { Store } from './ports';
import type { ScopeAction, ScopeReport } from './validate';
import type { Delivery } from './webhook';

/** One reported action outside the leg's scope (validate.ts's shape): `kind` names the
 *  evidence — a ref pushed, a PR opened or commented on, an egress reach. B-134's runner half
 *  reports `push` alone, from the refs the leg's window moved in the home checkout; the other
 *  kinds are the shape later sources (a forge reader, a VM egress log) fill. */
export type { ScopeAction } from './validate';

/** What a ticket's leg may touch (B-134): its home and its `repos:` entries — a forge path
 *  naming the home or a `code_repos` entry (R-BTN-92, R-BTN-140), a short name read under the
 *  home's owner as R-BTN-92 reads it — as lowercased forge paths. `codeRepoPaths` is the home's
 *  listed entries' paths: once the owners list any, an entry that does not resolve into it
 *  leaves the scope (R-BTN-140's reach); `null` — no list written — keeps every forge-valid
 *  name, as before the list existed. */
export function scopePaths(home: { forge: Forge; github: string; repos: string }, codeRepoPaths: string[] | null = null): Set<string> {
  const owner = home.github.slice(0, home.github.indexOf('/'));
  const listed = codeRepoPaths != null ? new Set(codeRepoPaths.map((p) => p.toLowerCase())) : null;
  const out = new Set([home.github.toLowerCase()]);
  let repos: string[] = [];
  try {
    repos = JSON.parse(home.repos) as string[];
  } catch {
    // Stored by a checked post: never malformed; an empty scope is the home alone.
  }
  for (const r of repos) {
    if (typeof r !== 'string') continue;
    const path = (r.includes('/') ? r : `${owner}/${r}`).toLowerCase();
    if (listed != null && !listed.has(path)) continue;
    if (isForgePath(home.forge, path) || (listed != null && listed.has(path))) out.add(path);
  }
  return out;
}

/** The claims open now, as the forge cross-check reads them: each open claim's ticket scope.
 *  "Open" is rule 3's reading of a claim still holding its ticket — active, or completed and
 *  unconfirmed, or reaped fence-pending (src/core/claims.ts, rule 3) — and not `active` alone:
 *  R-BTN-8 has the runner push the leg's evidence and hand-off first and end the claim at once,
 *  so the delivery of an ordinary final push routinely lands seconds after `end()` commits, and
 *  a redelivery after a blip minutes later; read against `active` alone, every late delivery of
 *  a normal leg-end push would raise a false `unclaimed-write`. The window is exactly the
 *  fence-unconfirmed one — once a completion is confirmed or a fence cleared, the claim no
 *  longer covers. */
export function openScopes(store: Store): { ticket: string; paths: Set<string> }[] {
  return store.exec<{ ticket_id: string; repository_id: string; forge: Forge; github: string; repos: string }>(
    `SELECT c.ticket_id, p.id AS repository_id, p.forge, p.github, t.repos FROM claims c
     JOIN tickets t ON t.id = c.ticket_id JOIN repositories p ON p.id = t.repository_id
     WHERE (c.status = 'active'
            OR (c.status = 'completed' AND c.confirmed_at IS NULL)
            OR (c.status = 'reaped' AND c.fence_pending = 1)) ORDER BY c.id`).toArray()
    .map((r) => ({ ticket: r.ticket_id, paths: scopePaths(r, listedPaths(store, r.repository_id)) }));
}

/** The home's listed code-repository paths, or null while it lists none (the gate is off until
 *  the owners write a list, so every deployment reads as before B-182). */
function listedPaths(store: Store, repository: string): string[] | null {
  const entries = codeReposOf(store, repository);
  return entries.length ? entries.map((e) => e.path) : null;
}

/** A finding as Needs you lists it (§14). */
export interface ScopeFindingView {
  id: number;
  repository_id: string;
  ticket_id: string | null;
  claim_id: number | null;
  kind: 'scope-exceeded' | 'unclaimed-write';
  target: string;
  detail: Record<string, unknown>;
  raised_at: number;
  updated_at: number;
}

export class Scope {
  constructor(private readonly c: {
    store: Store;
    now: () => number;
    /** B-134: with `scope_policy: hold`, hold the claim's ticket — wired to Claims' own hold. */
    hold?: (ticket: string, claimId: number) => void;
  }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }

  /** A claim's ticket scope, as the claim answer carries it (sorted, so a test reads one list). */
  scopeOf(ticket: string): string[] {
    const home = this.rows<{ repository_id: string; forge: Forge; github: string; repos: string }>(
      `SELECT p.id AS repository_id, p.forge, p.github, t.repos FROM tickets t JOIN repositories p ON p.id = t.repository_id WHERE t.id = ?`, ticket)[0];
    return home ? [...scopePaths(home, listedPaths(this.c.store, home.repository_id))].sort() : [];
  }

  /** Record the actions a claim reported outside its leg's scope, in the caller's transaction.
   *  Each is judged against the claim's ticket scope here — the runner's report is evidence,
   *  never the verdict — and each outside action raises one `scope-exceeded` finding on the
   *  ticket (one open row per target), one event and, with `scope_policy: hold`, a hold. An
   *  action inside the scope records nothing, and so does an `egress` action: its target is a
   *  host, the scope holds forge paths alone, and no host scope exists to judge it against —
   *  nothing reports `egress` yet, and the source that fills that shape arrives with the scope
   *  for it (§12.9); raising every egress reach as outside would be a finding nothing can
   *  discharge. Returns what was raised, for the log line. */
  exceeded(claimId: number, report: ScopeReport): ScopeAction[] {
    if (!report?.actions.length) return [];
    const claim = this.rows<{ ticket_id: string; snapshot_sha: string }>('SELECT ticket_id, snapshot_sha FROM claims WHERE id = ?', claimId)[0];
    if (!claim) return [];
    const policy = this.rows<{ scope_policy: 'report' | 'hold'; repository_id: string }>(
      `SELECT r.scope_policy, r.id AS repository_id FROM tickets t JOIN repositories r ON r.id = t.repository_id WHERE t.id = ?`, claim.ticket_id)[0];
    if (!policy) return [];
    const scope = new Set(this.scopeOf(claim.ticket_id));
    const now = this.c.now();
    const raised: ScopeAction[] = [];
    for (const a of report.actions) {
      if (a.kind === 'egress' || scope.has(a.target.toLowerCase())) continue;
      raised.push(a);
      this.upsert(policy.repository_id, claim.ticket_id, claimId, 'scope-exceeded', a.target, { kind: a.kind, ref: a.ref ?? null, claim: claimId }, now);
      logEvent(this.c.store, now, 'scope-exceeded', 'baton', { ...a, claim: claimId, snapshot_sha: claim.snapshot_sha }, claim.ticket_id, claimId);
    }
    if (raised.length && policy.scope_policy === 'hold') this.c.hold?.(claim.ticket_id, claimId);
    return raised;
  }

  /** B-134's control: a push delivery for a repository whose owners named the pusher among their
   *  `worker_pushers` is cross-checked against the claims open at the time (rule 3's reading of a
   *  claim still holding, as `openScopes` reads it) — a push by the worker to a repository no
   *  open claim's scope covers is `unclaimed-write`. In the caller's transaction; a push an open
   *  claim covers records nothing, and so does one by a login the owners did not name (a human's
   *  push is not the fleet's). */
  pushDelivery(d: Delivery): void {
    if (d.event !== 'push' || d.pusher == null) return;
    const full = d.repository.toLowerCase();
    // The App serves github.com repositories alone (R-BTN-92): the same live repositories the
    // delivery's want is mapped to, matched the same way.
    const repo = this.rows<{ id: string; worker_pushers: string | null }>(
      `SELECT id, worker_pushers FROM repositories
       WHERE retired_at IS NULL AND forge = 'github' AND lower(web_base) = 'https://github.com/' || lower(github) AND lower(github) = ?`, full)[0];
    if (!repo?.worker_pushers) return;
    let pushers: string[] = [];
    try {
      pushers = JSON.parse(repo.worker_pushers) as string[];
    } catch {
      return; // stored by a checked setting: never malformed
    }
    if (!pushers.some((p) => typeof p === 'string' && p.toLowerCase() === d.pusher!.toLowerCase())) return;
    const covered = openScopes(this.c.store).some((s) => s.paths.has(full));
    if (covered) return;
    const now = this.c.now();
    this.upsert(repo.id, null, null, 'unclaimed-write', d.repository, { kind: 'push', pusher: d.pusher, claim: null }, now);
    logEvent(this.c.store, now, 'unclaimed-write', 'webhook', { pusher: d.pusher, repository: d.repository, delivery: d.id }, null, null, repo.id);
  }

  /** One open finding per shape: a repeat updates the row it has open, so Needs you shows the
   *  finding, not a stack of copies of it. `detail` holds identifiers only (R-BTN-33). */
  private upsert(repositoryId: string, ticketId: string | null, claimId: number | null, kind: 'scope-exceeded' | 'unclaimed-write', target: string, detail: Record<string, unknown>, now: number) {
    this.c.store.exec(
      `INSERT INTO scope_findings (repository_id, ticket_id, claim_id, kind, target, detail_json, raised_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (repository_id, COALESCE(ticket_id, ''), kind, target) WHERE resolved_at IS NULL
       DO UPDATE SET detail_json = excluded.detail_json, claim_id = excluded.claim_id, updated_at = excluded.updated_at`,
      repositoryId, ticketId, claimId, kind, target.toLowerCase(), JSON.stringify(detail), now, now);
  }

  /** §14 Needs you: every open finding, oldest first. */
  needsYou(): ScopeFindingView[] {
    return this.rows<{ id: number; repository_id: string; ticket_id: string | null; claim_id: number | null; kind: 'scope-exceeded' | 'unclaimed-write'; target: string; detail_json: string; raised_at: number; updated_at: number }>(
      `SELECT id, repository_id, ticket_id, claim_id, kind, target, detail_json, raised_at, updated_at FROM scope_findings
       WHERE resolved_at IS NULL ORDER BY updated_at, id`).map((r) => {
      let detail: Record<string, unknown> = {};
      try {
        detail = JSON.parse(r.detail_json) as Record<string, unknown>;
      } catch { /* stored above: never malformed */ }
      return { id: r.id, repository_id: r.repository_id, ticket_id: r.ticket_id, claim_id: r.claim_id, kind: r.kind, target: r.target, detail, raised_at: r.raised_at, updated_at: r.updated_at };
    });
  }

  /** An owner resolves a finding — the acknowledgement that it was looked at, which is all a
   *  finding waits on. The resolution is one event (`scope-resolved`), in the caller's
   *  transaction, like every neighbouring `/v1/ui` mutation leaves its row. Returns whether
   *  there was an open one to resolve. */
  resolve(id: number, by: string): boolean {
    const row = this.rows<{ repository_id: string }>('SELECT repository_id FROM scope_findings WHERE id = ? AND resolved_at IS NULL', id)[0];
    if (!row) return false;
    const now = this.c.now();
    this.c.store.exec('UPDATE scope_findings SET resolved_at = ?, resolved_by = ? WHERE id = ?', now, by, id);
    logEvent(this.c.store, now, 'scope-resolved', by, { id }, null, null, row.repository_id);
    return true;
  }
}
