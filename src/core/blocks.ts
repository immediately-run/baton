// blocks.ts — why a ticket cannot move, stored, not recomputed (BATON_SPEC §2g R-BTN-75, R-BTN-77,
// R-BTN-78; R3-1251). The one writer of `ticket_blocks` and `tickets.blocked_since`: every cause —
// a snapshot's `blocked_by`, `requires`, `needs` or `decisions`, a fleet count crossing zero, an
// instance changing state, a claim starting or ending — calls `write` (or `held`) inside its own
// transaction, and nothing else writes either. The fleet counts (`fleet_capabilities`,
// `resource_fleet`) are kept here too, rewritten only where they change, and only a crossing of
// zero, or a flip of a resource's blocked condition, rewrites a ticket's rows. Asking reads the
// rows: one index per question (G-BTN-70). No name a course gives a resource, an instance, a
// capability or a decision means anything here: they are compared, never read.
import { BatonError } from './http';
import { logEvent } from './db';
import { qualify, repositoryOf, RESOURCE_NAME, TICKET_ID } from './validate';
import { isForgePath, underWebBase, type Forge } from './links';
import type { PostedStation } from './board';
import type { Store } from './ports';

export const BLOCK_KINDS = ['ticket', 'capability', 'resource', 'decision'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export interface Block { kind: BlockKind; leg?: string; ref: string; since: number; until?: number }
/** A block whose removal cleared a ticket (R-BTN-77's `cleared`). */
export interface Cleared { kind: BlockKind; ref: string; leg?: string }

/** R-BTN-77: an `unblocked` dispatch's coalescing window, its cap, and an `unblocked` message's. */
export const UNBLOCKED_WINDOW_MS = 30_000;
export const UNBLOCKED_DISPATCH_MAX = 100;
export const UNBLOCKED_MESSAGE_MAX = 20;
/** R-BTN-75, §14: how long a capability block or an `unknown` instance waits before Needs you. */
export const NEEDS_YOU_AFTER_MS = 24 * 3_600_000;
/** `blocked` with no `on`: a page's size; `transitive=1`: at most this many levels. */
export const BLOCKED_PAGE = 100;
export const TRANSITIVE_LEVELS = 5;

export interface Ctx {
  store: Store;
  now: () => number;
  /** Whether worker `id` would pass the claim gates for the ticket now (R-BTN-77's messages). */
  fits: (workerId: number, ticketId: string) => boolean;
}

/** A live worker as the counts see it: the repositories its key works on, the capabilities it may
 *  use in each (null: all it declares), what it declares and the account instances it uses. */
interface FleetWorker {
  id: number;
  repos: Map<string, Set<string> | null>;
  caps: Set<string>;
  uses: Set<string>;
}

/** A registered resource as the counts need it: its scope and who serves it, with each account
 *  instance's repositories. */
interface ResourceInfo {
  scope: 'worker' | 'account' | 'service';
  accounts: Map<string, string[]>;
}

/** What the per-worker answer reads (R-BTN-75, R-BTN-76): rows as the fleet's would be, for one. */
export interface WorkerAnswer {
  blocks: Block[];
  noInstance: { leg: string; resource: string }[];
}

/** The SQL test of a live worker (§5): alive, not reaped, its key in force. */
const LIVE = `w.reaped_at IS NULL AND w.kind != 'legacy' AND :now - w.last_seen_at < w.lease_timeout_ms AND c.revoked_at IS NULL`;

export class Blocks {
  constructor(private readonly c: Ctx) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }
  private named<T>(q: string, params: Record<string, unknown>): T[] {
    const values: unknown[] = [];
    const sql = q.replace(/:([a-z_]+)/g, (m, name: string) => {
      if (!(name in params)) return m;
      values.push(params[name]);
      return '?';
    });
    return this.rows<T>(sql, ...values);
  }

  /** R-BTN-77 via R-BTN-98: a block change or an instance's change of state drops the
   *  repository's cached recommendations. Baton keeps none since the `recommend` cache was withdrawn,
   *  so this is the seam R3-1269's `fleet_version` bumps through; it does nothing yet. */
  invalidateRecommend(_repository: string | null) {}

  // ── the writer ──────────────────────────────────────────────────────────────────────────

  /**
   * Rewrite the rows of `kinds` for each ticket from their stored causes, writing only what
   * changed, then re-evaluate whether it is blocked. `silent`: the transition is a claim's start
   * or end, which logs nothing (R-BTN-77).
   */
  write(ticketIds: Iterable<string>, kinds: readonly BlockKind[] = BLOCK_KINDS, silent = false) {
    const now = this.c.now();
    for (const id of new Set(ticketIds)) {
      const t = this.rows<{ repository_id: string; blocked_by: string }>('SELECT repository_id, blocked_by FROM tickets WHERE id = ?', id)[0];
      if (!t) continue;
      const want = new Map<string, { kind: BlockKind; ref: string; leg: string; until: number | null }>();
      for (const kind of kinds) for (const r of this.desired(id, t.repository_id, t.blocked_by, kind)) want.set(`${r.kind}\u0000${r.ref}\u0000${r.leg}`, r);
      const have = this.rows<{ kind: BlockKind; ref: string; leg: string; until: number | null }>(
        `SELECT kind, ref, leg, until FROM ticket_blocks WHERE ticket_id = ? AND kind IN (SELECT value FROM json_each(?))`, id, JSON.stringify(kinds));
      const cleared: Cleared[] = [];
      let changed = false;
      for (const h of have) {
        const key = `${h.kind}\u0000${h.ref}\u0000${h.leg}`;
        const w = want.get(key);
        if (!w) {
          this.exec('DELETE FROM ticket_blocks WHERE ticket_id = ? AND kind = ? AND ref = ? AND leg = ?', id, h.kind, h.ref, h.leg);
          cleared.push({ kind: h.kind, ref: h.ref, ...(h.leg ? { leg: h.leg } : {}) });
          changed = true;
        } else if (w.until !== h.until) {
          this.exec('UPDATE ticket_blocks SET until = ? WHERE ticket_id = ? AND kind = ? AND ref = ? AND leg = ?', w.until, id, h.kind, h.ref, h.leg);
        }
        want.delete(key);
      }
      for (const w of want.values()) {
        this.exec('INSERT INTO ticket_blocks (repository_id, ticket_id, leg, kind, ref, since, until) VALUES (?, ?, ?, ?, ?, ?, ?)', t.repository_id, id, w.leg, w.kind, w.ref, now, w.until);
        changed = true;
      }
      if (changed) this.invalidateRecommend(t.repository_id);
      this.evaluate(id, cleared, silent);
    }
  }

  /** A claim started, ended, was confirmed or its fence cleared: whether the ticket is held
   *  changed, and only that (R-BTN-75). A start or an end is silent (R-BTN-77). */
  held(ticketId: string, silent: boolean) {
    this.evaluate(ticketId, [], silent);
  }

  /** The rows one kind of cause asks for, from what is stored. */
  private desired(id: string, repo: string, blockedBy: string, kind: BlockKind): { kind: BlockKind; ref: string; leg: string; until: number | null }[] {
    if (kind === 'ticket') {
      // The posted list taken as given: the course's sync knows what is still open (R-BTN-75).
      return [...new Set(JSON.parse(blockedBy) as string[])].map((local) => ({ kind, ref: TICKET_ID.test(local) ? local : qualify(repo, local), leg: '', until: null }));
    }
    if (kind === 'capability') {
      // Absent from the counts is zero: a count is written for every needed pair (`recount`).
      return this.rows<{ name: string }>(
        `SELECT r.name FROM ticket_requires r LEFT JOIN fleet_capabilities f ON f.repository_id = ? AND f.capability = r.name
         WHERE r.ticket_id = ? AND COALESCE(f.workers, 0) = 0`, repo, id).map((r) => ({ kind, ref: r.name, leg: '', until: null }));
    }
    if (kind === 'resource') {
      // No row while no live worker has a usable instance: unanswerable, so `no-instance` (R-BTN-76).
      return this.rows<{ leg: string; resource: string }>(
        `SELECT l.leg, l.resource FROM leg_needs l JOIN resource_fleet f ON f.repository_id = l.repository_id AND f.resource = l.resource
         WHERE l.ticket_id = ? AND f.usable_workers > 0 AND f.open_workers = 0`, id)
        .map((n) => ({ kind, ref: n.resource, leg: n.leg, until: this.expectedBack(n.resource) }));
    }
    return this.rows<{ decision_id: string; leg: string }>('SELECT decision_id, leg FROM ticket_decisions WHERE ticket_id = ?', id)
      .map((d) => ({ kind, ref: d.decision_id, leg: d.leg, until: null }));
  }

  /** When the first instance of `resource` is expected back: the earliest `until` of its
   *  unavailable instances, or null when none says. */
  private expectedBack(resource: string): number | null {
    return this.rows<{ u: number | null }>(
      `SELECT MIN(s.until) AS u FROM instance_states s
       WHERE s.state = 'unavailable' AND s.until IS NOT NULL
         AND (s.instance IN (SELECT instance FROM instance_serves WHERE resource = ?) OR substr(s.instance, 1, length(?) + 8) = ? || '@worker:')`,
      resource, resource, resource)[0]?.u ?? null;
  }

  /** Whether a claim holds the ticket — rule 3's check, the one definition (R-BTN-75). */
  private isHeld(id: string): boolean {
    return this.rows(`SELECT 1 FROM claims WHERE ticket_id = ? AND (status = 'active' OR (status = 'completed' AND confirmed_at IS NULL)
                      OR (status = 'reaped' AND fence_pending = 1)) LIMIT 1`, id).length > 0;
  }

  /** R-BTN-75: blocked when not held and with a whole-ticket row or a row on its queued leg;
   *  `blocked_since` follows, and its transitions are the `blocked` and `unblocked` events. */
  private evaluate(id: string, cleared: Cleared[], silent: boolean) {
    const t = this.rows<{ repository_id: string; blocked_since: number | null }>('SELECT repository_id, blocked_since FROM tickets WHERE id = ?', id)[0];
    if (!t) return;
    const queued = this.rows<{ next_leg: string | null }>('SELECT next_leg FROM ticket_stations WHERE ticket_id = ?', id)[0]?.next_leg ?? null;
    const blocking = this.isHeld(id) ? [] : this.rows<{ kind: BlockKind; leg: string; ref: string }>(
      `SELECT kind, leg, ref FROM ticket_blocks WHERE ticket_id = ? AND (leg = '' OR leg = ?) ORDER BY kind, ref, leg`, id, queued ?? '');
    const now = this.c.now();
    if (blocking.length && t.blocked_since == null) {
      this.exec('UPDATE tickets SET blocked_since = ? WHERE id = ?', now, id);
      if (!silent) logEvent(this.c.store, now, 'blocked', 'baton', { ticket: id, blocks: blocking.map((b) => ({ kind: b.kind, ref: b.ref, ...(b.leg ? { leg: b.leg } : {}) })) }, id);
    } else if (!blocking.length && t.blocked_since != null) {
      this.exec('UPDATE tickets SET blocked_since = NULL WHERE id = ?', id);
      if (!silent) {
        logEvent(this.c.store, now, 'unblocked', 'baton', { ticket: id, cleared }, id);
        this.unblocked(t.repository_id, id, cleared);
      }
    }
  }

  /** A ticket left the board: its rows go with it (its claims and events stay). */
  forget(id: string) {
    this.exec('DELETE FROM ticket_blocks WHERE ticket_id = ?', id);
    this.exec('DELETE FROM leg_needs WHERE ticket_id = ?', id);
    this.exec('DELETE FROM ticket_decisions WHERE ticket_id = ?', id);
  }

  // ── a snapshot's causes: `needs` and `decisions` (R-BTN-76, R-BTN-78) ─────────────────────

  /**
   * Store what a snapshot posts with each placed ticket — the resources each next leg needs and
   * the ticket's open decisions — and clear them for a live ticket it placed nowhere. Returns the
   * tickets whose stored causes changed, for `write`. A need that fails the resource rule is kept
   * out (it blocks nothing); a decision whose id is Baton's own (`baton:`) is dropped, one naming
   * a leg that is not a posted next leg sits on the whole ticket, and a `url` outside the ticket's
   * repositories is dropped — the decision stays (R-BTN-78, §10.4). What was dropped is returned,
   * for the snapshot's event: logged, never refused.
   */
  posted(repo: string, stations: Map<string, PostedStation>, live: string[]): { changed: string[]; dropped: string[] } {
    const changed: string[] = [];
    const dropped: string[] = [];
    const home = this.rows<{ forge: string; web_base: string | null; github: string }>('SELECT forge, web_base, github FROM repositories WHERE id = ?', repo)[0];
    for (const local of live) {
      const id = qualify(repo, local);
      const st = stations.get(local) ?? null;
      const legs = new Set((st?.next ?? []).map((n) => n.leg));
      for (const n of st?.next ?? []) for (const r of n.needs ?? []) if (!RESOURCE_NAME.test(r)) dropped.push(`${id}:needs:${r.slice(0, 100)}`);
      const needs = (st?.next ?? []).flatMap((n) => (n.needs ?? []).filter((r) => RESOURCE_NAME.test(r)).map((r) => `${n.leg}\u0000${r}`)).sort();
      const repos = home ? this.ticketRepos(id, home) : [];
      const decisions = (st?.decisions ?? []).filter((d) => {
        if (!d.id.startsWith('baton:')) return true;
        dropped.push(`${id}:decision:${d.id}`);
        return false;
      }).map((d) => ({ id: d.id, leg: d.leg && legs.has(d.leg) ? d.leg : '', asks: d.asks, url: d.url && repos.some((base) => underWebBase(d.url!, base)) ? d.url : null }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const haveNeeds = this.rows<{ leg: string; resource: string }>('SELECT leg, resource FROM leg_needs WHERE ticket_id = ? ORDER BY leg, resource', id).map((n) => `${n.leg}\u0000${n.resource}`).sort();
      const haveDecisions = this.rows<{ decision_id: string; leg: string; asks: string; url: string | null }>(
        `SELECT decision_id, leg, asks, url FROM ticket_decisions WHERE ticket_id = ? AND source = 'sync' ORDER BY decision_id`, id);
      const needsChanged = haveNeeds.join('\n') !== needs.join('\n');
      const decisionsChanged = JSON.stringify(haveDecisions.map((d) => ({ id: d.decision_id, leg: d.leg, asks: d.asks, url: d.url }))) !== JSON.stringify(decisions);
      if (needsChanged) {
        this.exec('DELETE FROM leg_needs WHERE ticket_id = ?', id);
        for (const n of needs) {
          const [leg, resource] = n.split('\u0000');
          this.exec('INSERT INTO leg_needs (repository_id, ticket_id, leg, resource) VALUES (?, ?, ?, ?)', repo, id, leg, resource);
        }
      }
      if (decisionsChanged) {
        // A snapshot rewrites only the sync's own rows; Baton's are answered in Baton (R-BTN-78).
        this.exec(`DELETE FROM ticket_decisions WHERE ticket_id = ? AND source = 'sync'`, id);
        for (const d of decisions) {
          this.exec(`INSERT INTO ticket_decisions (ticket_id, decision_id, leg, asks, url, source) VALUES (?, ?, ?, ?, ?, 'sync')
                     ON CONFLICT (ticket_id, decision_id) DO NOTHING`, id, d.id, d.leg, d.asks, d.url);
        }
      }
      if (needsChanged || decisionsChanged) changed.push(id);
    }
    return { changed, dropped };
  }

  /** R-BTN-92's link rule's bases for a ticket: its home repository's `web_base` and each of its
   *  `repos:` as a forge path on the home's host. */
  private ticketRepos(id: string, home: { forge: string; web_base: string | null; github: string }): string[] {
    if (!home.web_base) return [];
    const host = home.web_base.slice(0, home.web_base.length - home.github.length);
    const owner = home.github.slice(0, home.github.indexOf('/'));
    const repos = JSON.parse(this.rows<{ repos: string }>('SELECT repos FROM tickets WHERE id = ?', id)[0]?.repos ?? '[]') as string[];
    return [home.web_base, ...repos.map((r) => (r.includes('/') ? r : `${owner}/${r}`)).filter((r) => isForgePath(home.forge as Forge, r)).map((r) => host + r)];
  }

  // ── unblocking wakes work (R-BTN-77) ──────────────────────────────────────────────────────

  private unblocked(repo: string, ticket: string, cleared: Cleared[]) {
    const now = this.c.now();
    const entry = { ticket_id: ticket, cleared };
    // One pending `unblocked` message per alive, idle worker granted on the repository that the
    // ticket would now pass the gates for — updated in place, the oldest dropped past 20.
    for (const w of this.named<{ id: number }>(
      `SELECT w.id FROM workers w JOIN credentials c ON c.id = w.credential_id
       WHERE ${LIVE}
         AND NOT EXISTS (SELECT 1 FROM claims k WHERE k.worker_id = w.id AND k.status = 'active')
         AND (c.created_by IS NULL OR (c.created_by NOT LIKE 'owner:%' AND c.created_by NOT LIKE 'admin:%') OR EXISTS (SELECT 1 FROM worker_grants g WHERE g.credential_id = w.credential_id AND g.repository_id = :repo AND g.revoked_at IS NULL))
       ORDER BY w.id`, { now, repo })) {
      if (!this.c.fits(w.id, ticket)) continue;
      const pending = this.rows<{ id: number; payload_json: string }>(`SELECT id, payload_json FROM messages WHERE to_worker_id = ? AND kind = 'unblocked' AND status = 'pending' ORDER BY id DESC LIMIT 1`, w.id)[0];
      if (pending) {
        const list = (JSON.parse(pending.payload_json) as { tickets: { ticket_id: string }[] }).tickets.filter((x) => x.ticket_id !== ticket);
        this.exec('UPDATE messages SET payload_json = ?, sent_at = ? WHERE id = ?', JSON.stringify({ tickets: [...list, entry].slice(-UNBLOCKED_MESSAGE_MAX) }), now, pending.id);
      } else {
        // A delivered one not yet acknowledged is superseded, not re-sent beside the new one: what
        // it named was a cue to ask for recommendations, which the new one is too (§9).
        this.exec(`UPDATE messages SET status = 'expired' WHERE to_worker_id = ? AND kind = 'unblocked' AND status = 'delivered'`, w.id);
        this.exec(`INSERT INTO messages (kind, payload_json, from_principal, to_worker_id, sent_at, status) VALUES ('unblocked', ?, 'baton', ?, ?, 'pending')`,
          JSON.stringify({ tickets: [entry] }), w.id, now);
      }
    }
    // The repository's unblocked trigger, coalesced: one dispatch per window per repository, with
    // a trailing one carrying every ticket the window unblocked (`due`).
    if (this.rows<{ t: string | null }>('SELECT unblocked_trigger AS t FROM repositories WHERE id = ?', repo)[0]?.t == null) return;
    const row = this.rows<{ last_sent_at: number | null; pending_json: string }>('SELECT last_sent_at, pending_json FROM unblocked_dispatch WHERE repository_id = ?', repo)[0];
    const pending = [...(row ? (JSON.parse(row.pending_json) as unknown[]) : []), { ticket: ticket, cleared }];
    const due = row?.last_sent_at == null ? now : Math.max(now, row.last_sent_at + UNBLOCKED_WINDOW_MS);
    this.exec(`INSERT INTO unblocked_dispatch (repository_id, pending_json, due_at) VALUES (?, ?, ?)
               ON CONFLICT (repository_id) DO UPDATE SET pending_json = excluded.pending_json, due_at = excluded.due_at`, repo, JSON.stringify(pending), due);
  }

  /** The unblocked dispatches due now, taken: each repository's window's tickets, at most 100,
   *  the rest counted as `{truncated: n}` (R-BTN-77). The caller sends them after its commit. */
  takeDue(): { repository: string; tickets: unknown[] }[] {
    const now = this.c.now();
    const out: { repository: string; tickets: unknown[] }[] = [];
    for (const r of this.rows<{ repository_id: string; pending_json: string }>(`SELECT repository_id, pending_json FROM unblocked_dispatch WHERE due_at IS NOT NULL AND due_at <= ?`, now)) {
      const all = JSON.parse(r.pending_json) as unknown[];
      const tickets = all.length > UNBLOCKED_DISPATCH_MAX ? [...all.slice(0, UNBLOCKED_DISPATCH_MAX), { truncated: all.length - UNBLOCKED_DISPATCH_MAX }] : all;
      this.exec(`UPDATE unblocked_dispatch SET pending_json = '[]', due_at = NULL, last_sent_at = ? WHERE repository_id = ?`, now, r.repository_id);
      if (all.length) out.push({ repository: r.repository_id, tickets });
    }
    return out;
  }

  /** When the next trailing dispatch is due, for the alarm. */
  nextDue(): number | null {
    return this.rows<{ d: number | null }>('SELECT MIN(due_at) AS d FROM unblocked_dispatch')[0]?.d ?? null;
  }

  /** The alarm's share: a pending `unblocked` message whose worker stopped being alive expires. */
  expireMessages() {
    this.named(`UPDATE messages SET status = 'expired' WHERE kind = 'unblocked' AND status = 'pending'
                AND to_worker_id NOT IN (SELECT w.id FROM workers w JOIN credentials c ON c.id = w.credential_id WHERE ${LIVE})`, { now: this.c.now() });
  }

  // ── the fleet counts (R-BTN-75, R-BTN-76) ─────────────────────────────────────────────────

  /** Every live worker — or only `only`, if it is live — with its repositories, capabilities and
   *  instances. */
  private fleet(only: number | null = null): FleetWorker[] {
    const now = this.c.now();
    const all = this.rows<{ id: string }>('SELECT id FROM repositories WHERE retired_at IS NULL').map((r) => r.id);
    return this.named<{ id: number; credential_id: string; created_by: string | null }>(
      `SELECT w.id, w.credential_id, c.created_by FROM workers w JOIN credentials c ON c.id = w.credential_id WHERE ${LIVE} AND (:only IS NULL OR w.id = :only) ORDER BY w.id`, { now, only })
      .map((w) => {
        // R-BTN-58: a key an owner or administrator granted works where it is granted; another
        // (a bearer token, a BATON_KEYS seed key) keeps its interim reach on every repository.
        const granted = !!w.created_by && /^(owner|admin):/.test(w.created_by);
        const repos = new Map<string, Set<string> | null>(granted
          ? this.rows<{ repository_id: string; capabilities: string }>('SELECT repository_id, capabilities FROM worker_grants WHERE credential_id = ? AND revoked_at IS NULL', w.credential_id)
            .map((g) => [g.repository_id, new Set(JSON.parse(g.capabilities) as string[])])
          : all.map((r) => [r, null]));
        return {
          id: w.id,
          repos,
          caps: new Set(this.rows<{ capability: string }>('SELECT capability FROM worker_capabilities WHERE worker_id = ?', w.id).map((r) => r.capability)),
          uses: new Set(this.rows<{ instance: string }>('SELECT instance FROM worker_instances WHERE worker_id = ?', w.id).map((r) => r.instance)),
        };
      });
  }

  private resources(): Map<string, ResourceInfo> {
    const out = new Map<string, ResourceInfo>();
    for (const r of this.rows<{ name: string; scope: ResourceInfo['scope'] }>('SELECT name, scope FROM external_resources')) out.set(r.name, { scope: r.scope, accounts: new Map() });
    for (const s of this.rows<{ instance: string; resource: string; repositories: string }>(
      `SELECT s.instance, s.resource, i.repositories FROM instance_serves s JOIN resource_instances i ON i.name = s.instance JOIN external_resources e ON e.name = s.resource
       WHERE e.scope = 'account'`)) out.get(s.resource)?.accounts.set(s.instance, JSON.parse(s.repositories) as string[]);
    return out;
  }

  private states(): Map<string, string> {
    return new Map(this.rows<{ instance: string; state: string }>('SELECT instance, state FROM instance_states').map((s) => [s.instance, s.state]));
  }

  /** A worker's usable instances of `resource` for `repo` (R-BTN-76): the service instance, its
   *  own worker instance, and the account instances it uses that serve the resource and list the
   *  repository. */
  private usable(w: { id: number; uses: Set<string> }, repo: string, resource: string, info: ResourceInfo): string[] {
    if (info.scope === 'service') return [resource];
    if (info.scope === 'worker') return [`${resource}@worker:${w.id}`];
    return [...info.accounts].filter(([name, repos]) => w.uses.has(name) && repos.includes(repo)).map(([name]) => name);
  }

  /**
   * Recount what changed: per (repository, capability) a ticket requires, the live workers granted
   * there that declare it; per (repository, resource) a posted leg needs, the live granted workers
   * with a usable instance and those with one not `unavailable`. Only a count crossing zero, or
   * the resource condition (`usable > 0 AND open = 0`) flipping, rewrites the rows of exactly the
   * tickets the indexes name. Cheap to call after anything that could move a count: a worker
   * registering or changing what it declares or uses, liveness (the alarm), a reap, a grant, an
   * instance's state, a resource or instance registered.
   */
  recount() {
    const fleet = this.fleet();
    const capsOf = (w: FleetWorker, repo: string) => {
      if (!w.repos.has(repo)) return null;
      const g = w.repos.get(repo);
      return g ? new Set([...w.caps].filter((c) => g.has(c))) : w.caps;
    };
    // Capabilities.
    const needCaps = this.rows<{ repository_id: string; name: string }>(
      'SELECT DISTINCT t.repository_id, r.name FROM ticket_requires r JOIN tickets t ON t.id = r.ticket_id');
    const haveCaps = new Map(this.rows<{ repository_id: string; capability: string; workers: number }>('SELECT repository_id, capability, workers FROM fleet_capabilities')
      .map((f) => [`${f.repository_id}\u0000${f.capability}`, f.workers]));
    const touched = new Set<string>();
    for (const n of needCaps) {
      const key = `${n.repository_id}\u0000${n.name}`;
      const count = fleet.filter((w) => capsOf(w, n.repository_id)?.has(n.name)).length;
      const before = haveCaps.get(key);
      haveCaps.delete(key);
      if (before === count) continue;
      this.exec(`INSERT INTO fleet_capabilities (repository_id, capability, workers) VALUES (?, ?, ?)
                 ON CONFLICT (repository_id, capability) DO UPDATE SET workers = excluded.workers`, n.repository_id, n.name, count);
      if (before === undefined || (before === 0) !== (count === 0)) {
        for (const t of this.rows<{ id: string }>('SELECT t.id FROM ticket_requires r JOIN tickets t ON t.id = r.ticket_id WHERE r.name = ? AND t.repository_id = ?', n.name, n.repository_id)) touched.add(t.id);
      }
    }
    for (const key of haveCaps.keys()) {
      const [repo, cap] = key.split('\u0000');
      this.exec('DELETE FROM fleet_capabilities WHERE repository_id = ? AND capability = ?', repo, cap);
    }
    if (touched.size) this.write(touched, ['capability']);

    // Resources.
    const info = this.resources();
    const states = this.states();
    const needs = this.rows<{ repository_id: string; resource: string }>(
      'SELECT DISTINCT l.repository_id, l.resource FROM leg_needs l JOIN external_resources e ON e.name = l.resource');
    const haveRes = new Map(this.rows<{ repository_id: string; resource: string; usable_workers: number; open_workers: number }>('SELECT * FROM resource_fleet')
      .map((f) => [`${f.repository_id}\u0000${f.resource}`, f]));
    const flipped = new Set<string>();
    for (const n of needs) {
      const key = `${n.repository_id}\u0000${n.resource}`;
      let usable = 0;
      let open = 0;
      for (const w of fleet) {
        if (!w.repos.has(n.repository_id)) continue;
        const mine = this.usable(w, n.repository_id, n.resource, info.get(n.resource)!);
        if (!mine.length) continue;
        usable++;
        if (mine.some((i) => (states.get(i) ?? 'unknown') !== 'unavailable')) open++;
      }
      const before = haveRes.get(key);
      haveRes.delete(key);
      if (before && before.usable_workers === usable && before.open_workers === open) continue;
      this.exec(`INSERT INTO resource_fleet (repository_id, resource, usable_workers, open_workers) VALUES (?, ?, ?, ?)
                 ON CONFLICT (repository_id, resource) DO UPDATE SET usable_workers = excluded.usable_workers, open_workers = excluded.open_workers`,
        n.repository_id, n.resource, usable, open);
      const was = !!before && before.usable_workers > 0 && before.open_workers === 0;
      if (!before || was !== (usable > 0 && open === 0)) flipped.add(key);
    }
    for (const key of haveRes.keys()) {
      const [repo, resource] = key.split('\u0000');
      this.exec('DELETE FROM resource_fleet WHERE repository_id = ? AND resource = ?', repo, resource);
      flipped.add(key);
    }
    const needers = new Set<string>();
    for (const key of flipped) {
      const [repo, resource] = key.split('\u0000');
      for (const t of this.rows<{ ticket_id: string }>('SELECT ticket_id FROM leg_needs WHERE repository_id = ? AND resource = ?', repo, resource)) needers.add(t.ticket_id);
    }
    if (needers.size) this.write(needers, ['resource']);
  }

  /** An instance changed state (R-BTN-76): recount, and refresh the expected-back `until` of the
   *  rows of the tickets whose legs need what it serves. */
  instanceChanged(instance: string) {
    this.invalidateRecommend(null);
    this.recount();
    const served = this.rows<{ resource: string }>('SELECT resource FROM instance_serves WHERE instance = ?', instance).map((r) => r.resource);
    const worker = /^(.+)@worker:\d+$/.exec(instance);
    if (worker) served.push(worker[1]);
    const ids = this.rows<{ ticket_id: string }>('SELECT DISTINCT ticket_id FROM leg_needs WHERE resource IN (SELECT value FROM json_each(?))', JSON.stringify(served)).map((r) => r.ticket_id);
    if (ids.length) this.write(ids, ['resource']);
  }

  // ── asking (R-BTN-75, §11) ────────────────────────────────────────────────────────────────

  private blockRows(ticketId: string): Block[] {
    return this.rows<{ kind: BlockKind; leg: string; ref: string; since: number; until: number | null }>(
      'SELECT kind, leg, ref, since, until FROM ticket_blocks WHERE ticket_id = ? ORDER BY kind, ref, leg', ticketId)
      .map((b) => ({ kind: b.kind, ...(b.leg ? { leg: b.leg } : {}), ref: b.ref, since: b.since, ...(b.until != null ? { until: b.until } : {}) }));
  }

  /** One worker's `capability` and `resource` answer for a ticket, computed on the spot: rule 4's
   *  comparison against what it declares and is granted, and its own usable instances. */
  forWorker(workerId: number, ticketId: string): WorkerAnswer {
    const w = this.fleet(workerId)[0] ?? {
      id: workerId, repos: new Map<string, Set<string> | null>(), caps: new Set<string>(),
      uses: new Set(this.rows<{ instance: string }>('SELECT instance FROM worker_instances WHERE worker_id = ?', workerId).map((r) => r.instance)),
    };
    const repo = repositoryOf(ticketId);
    const now = this.c.now();
    const g = w.repos.get(repo);
    const caps = g ? new Set([...w.caps].filter((c) => g.has(c))) : w.caps;
    const blocks: Block[] = this.rows<{ name: string }>('SELECT name FROM ticket_requires WHERE ticket_id = ? ORDER BY name', ticketId)
      .filter((r) => !caps.has(r.name)).map((r) => ({ kind: 'capability' as const, ref: r.name, since: now }));
    const info = this.resources();
    const states = this.rows<{ instance: string; state: string; until: number | null }>('SELECT instance, state, until FROM instance_states');
    const stateOf = new Map(states.map((s) => [s.instance, s]));
    const noInstance: WorkerAnswer['noInstance'] = [];
    for (const n of this.rows<{ leg: string; resource: string }>('SELECT leg, resource FROM leg_needs WHERE ticket_id = ? ORDER BY leg, resource', ticketId)) {
      const r = info.get(n.resource);
      if (!r) continue; // an unregistered name blocks nothing (R-BTN-76)
      const mine = this.usable(w, repo, n.resource, r);
      if (!mine.length) {
        noInstance.push({ leg: n.leg, resource: n.resource });
        continue;
      }
      if (mine.every((i) => stateOf.get(i)?.state === 'unavailable')) {
        const untils = mine.map((i) => stateOf.get(i)?.until).filter((u): u is number => u != null);
        blocks.push({ kind: 'resource', leg: n.leg, ref: n.resource, since: now, ...(untils.length ? { until: Math.min(...untils) } : {}) });
      }
    }
    return { blocks, noInstance };
  }

  /** `GET …/tickets/{ticket}/blocks[?worker=me]` (R-BTN-75): the rows by primary key, and `other`
   *  — what else keeps it from being offered that is not a block. With a worker, its own
   *  `capability` and `resource` rows replace the fleet's. */
  blocksOf(ticketId: string, workerId: number | null) {
    const t = this.rows<{ blocked_since: number | null }>('SELECT blocked_since FROM tickets WHERE id = ?', ticketId)[0];
    if (!t) throw new BatonError('not-found', `${ticketId} is not on the board`);
    const now = this.c.now();
    let blocks = this.blockRows(ticketId);
    const other: { kind: string; detail: unknown }[] = [];
    const held = this.rows<{ id: number; status: string }>(`SELECT id, status FROM claims WHERE ticket_id = ? AND (status = 'active' OR (status = 'completed' AND confirmed_at IS NULL)
                                                           OR (status = 'reaped' AND fence_pending = 1)) ORDER BY id`, ticketId);
    for (const h of held) other.push({ kind: h.status === 'active' ? 'claimed' : h.status === 'completed' ? 'unconfirmed-end' : 'fence-pending', detail: { claim_id: h.id } });
    const o = this.rows<{ hold: number; hold_reason: string | null; retry_after: number | null }>('SELECT hold, hold_reason, retry_after FROM ticket_overrides WHERE ticket_id = ?', ticketId)[0];
    if (o?.hold) other.push({ kind: 'hold', detail: { reason: o.hold_reason } });
    if (o?.retry_after != null && o.retry_after > now) other.push({ kind: 'backoff', detail: { retry_after: o.retry_after } });
    const queued = this.rows<{ next_leg: string | null }>('SELECT next_leg FROM ticket_stations WHERE ticket_id = ?', ticketId)[0]?.next_leg ?? null;
    for (const n of this.rows<{ leg: string; waiting_on: string | null }>(`SELECT leg, waiting_on FROM ticket_next_legs WHERE ticket_id = ? AND state = 'waiting' AND waiting_on IS NOT NULL ORDER BY leg`, ticketId)) {
      other.push({ kind: 'waiting_on', detail: { leg: n.leg, on: n.waiting_on } });
    }
    // R-BTN-67: an owner bar whose tag every live worker granted on the repository carries.
    const repo = repositoryOf(ticketId);
    const live = this.fleet().filter((w) => w.repos.has(repo));
    if (live.length) {
      for (const b of this.rows<{ id: number; tag: string }>(`SELECT id, tag FROM owner_bars WHERE repository_id = ? AND lifted_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`, repo, now, now)) {
        if (live.every((w) => this.rows('SELECT 1 FROM worker_tags WHERE worker_id = ? AND tag = ?', w.id, b.tag).length)) other.push({ kind: 'bars', detail: { bar: b.id, tag: b.tag } });
      }
    }
    let blocked = t.blocked_since != null;
    if (workerId != null) {
      const mine = this.forWorker(workerId, ticketId);
      blocks = [...blocks.filter((b) => b.kind !== 'capability' && b.kind !== 'resource'), ...mine.blocks];
      for (const n of mine.noInstance) other.push({ kind: 'no-instance', detail: n });
      blocked = !held.length && blocks.some((b) => !b.leg || b.leg === queued);
    } else {
      // R-BTN-76: with no live worker holding a usable instance the question has no answer.
      for (const n of this.rows<{ leg: string; resource: string }>(
        `SELECT l.leg, l.resource FROM leg_needs l JOIN external_resources e ON e.name = l.resource
         LEFT JOIN resource_fleet f ON f.repository_id = l.repository_id AND f.resource = l.resource
         WHERE l.ticket_id = ? AND COALESCE(f.usable_workers, 0) = 0 ORDER BY l.leg, l.resource`, ticketId)) other.push({ kind: 'no-instance', detail: n });
    }
    return { blocked, ...(t.blocked_since != null && workerId == null ? { since: t.blocked_since } : {}), blocks, other };
  }

  /** `GET …/blocked?on=<kind>:<ref>[&transitive=1]` (R-BTN-75): every ticket of the repository
   *  with a row on it, from `blocks_by_ref`, each with its blocks and whether it is blocked;
   *  `transitive` follows `ticket` rows through tickets blocked on those, at most 5 levels. */
  blockedOn(repo: string, on: { kind: BlockKind; ref: string }, transitive: boolean) {
    const ref = on.kind === 'ticket' && on.ref !== '*' && !TICKET_ID.test(on.ref) ? qualify(repo, on.ref) : on.ref;
    const level = (refs: string[]) => [...new Set(this.rows<{ ticket_id: string }>(
      on.ref === '*'
        ? 'SELECT DISTINCT ticket_id FROM ticket_blocks WHERE repository_id = ? AND kind = ? ORDER BY ticket_id'
        : 'SELECT DISTINCT ticket_id FROM ticket_blocks WHERE repository_id = ? AND kind = ? AND ref IN (SELECT value FROM json_each(?)) ORDER BY ticket_id',
      ...(on.ref === '*' ? [repo, on.kind] : [repo, on.kind, JSON.stringify(refs)])).map((r) => r.ticket_id))];
    const seen = new Map<string, number>();
    let frontier = level([ref]);
    for (let depth = 1; frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) if (!seen.has(id)) {
        seen.set(id, depth);
        next.push(id);
      }
      if (!transitive || on.kind !== 'ticket' || on.ref === '*' || depth >= TRANSITIVE_LEVELS) break;
      frontier = next.length ? this.rows<{ ticket_id: string }>(
        `SELECT DISTINCT ticket_id FROM ticket_blocks WHERE repository_id = ? AND kind = 'ticket' AND ref IN (SELECT value FROM json_each(?)) ORDER BY ticket_id`,
        repo, JSON.stringify(next)).map((r) => r.ticket_id) : [];
    }
    return {
      tickets: [...seen].map(([id, depth]) => ({
        ticket_id: id,
        blocked: this.rows<{ b: number | null }>('SELECT blocked_since AS b FROM tickets WHERE id = ?', id)[0]?.b != null,
        ...(transitive ? { level: depth } : {}),
        blocks: this.blockRows(id),
      })),
    };
  }

  /** `GET …/blocked` with no `on`: the repository's blocked tickets from `tickets_blocked`, 100 a
   *  page after `cursor`, and their blocks grouped by kind and `ref`. */
  blockedAll(repo: string, cursor: string | null) {
    const page = this.rows<{ id: string; blocked_since: number }>(
      `SELECT id, blocked_since FROM tickets WHERE repository_id = ? AND blocked_since IS NOT NULL AND id > ? ORDER BY id LIMIT ?`, repo, cursor ?? '', BLOCKED_PAGE + 1);
    const more = page.length > BLOCKED_PAGE;
    const tickets = page.slice(0, BLOCKED_PAGE).map((t) => ({ ticket_id: t.id, since: t.blocked_since, blocks: this.blockRows(t.id) }));
    const groups = new Map<string, { kind: BlockKind; ref: string; tickets: string[] }>();
    for (const t of tickets) {
      for (const b of t.blocks) {
        const key = `${b.kind}\u0000${b.ref}`;
        const g = groups.get(key) ?? { kind: b.kind, ref: b.ref, tickets: [] };
        if (!g.tickets.includes(t.ticket_id)) g.tickets.push(t.ticket_id);
        groups.set(key, g);
      }
    }
    return { tickets, groups: [...groups.values()], ...(more ? { next_cursor: tickets.at(-1)!.ticket_id } : {}) };
  }

  /** §14 Needs you: tickets blocked a day on a capability no live worker has, and instances
   *  `unknown` a day while a posted leg needs what they serve. */
  needsYou(now: number) {
    return {
      blocked_capability: this.rows(`SELECT b.ticket_id, b.ref AS capability, b.since FROM ticket_blocks b JOIN tickets t ON t.id = b.ticket_id
                                     WHERE b.kind = 'capability' AND b.since <= ? AND t.blocked_since IS NOT NULL ORDER BY b.since, b.ticket_id`, now - NEEDS_YOU_AFTER_MS),
      instances_unknown: this.rows(`SELECT s.instance, s.changed_at AS since FROM instance_states s
                                    WHERE s.state = 'unknown' AND s.changed_at <= ?
                                      AND EXISTS (SELECT 1 FROM instance_serves v JOIN leg_needs l ON l.resource = v.resource WHERE v.instance = s.instance)
                                    ORDER BY s.instance`, now - NEEDS_YOU_AFTER_MS),
    };
  }

  /** The dashboard: each repository's blocked tickets with their blocks (§14). */
  view() {
    return this.rows<{ id: string; repository_id: string; blocked_since: number }>(
      'SELECT id, repository_id, blocked_since FROM tickets WHERE blocked_since IS NOT NULL ORDER BY repository_id, blocked_since, id LIMIT 500')
      .map((t) => ({ ticket_id: t.id, repository_id: t.repository_id, since: t.blocked_since, blocks: this.blockRows(t.id) }));
  }
}
