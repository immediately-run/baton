// control.ts — the control-input watch and ticket provenance (BATON_SPEC §4.4 R-BTN-194; B-126,
// security model mitigation G): when an accepted board post's head changes a control input — a
// path on the fixed list below or the owners' own, or a live ticket's `expedite`, `tier`,
// `requires` or `depends_on` — and the pusher of the commits that changed it is not one of the
// owners' recorded forge identities, Baton raises one `control-changed` event, listed under
// Needs you. Detection only: nothing is refused, nothing held (hardening option 7, B-127, is the
// gate). Who pushed comes from the forge's push deliveries (R-BTN-73) alone — never the commit
// author, which anyone sets — and when a delivery is missing, past the recording bounds, or the
// forge sends none (a plain git remote), the pusher is `pusher-unknown` and the change raises
// (fail closed). The same reading records each ticket's `last_written_by`: the pusher of the
// commit that last changed its file, served with the ticket (R-BTN-194) so a privileged session
// can see whose words steer it before it reads them.
import { logEvent } from './db';
import { BatonError } from './http';
import type { TicketRow } from './board';
import type { Repository } from './registry';
import type { Store } from './ports';

/** B-126 item 1: the control inputs, a fixed list per repository — Baton's own configuration and
 * everything a privileged interactive session loads or executes (security model reach 1–2; OWASP
 * ASI05, ASI06) and the dependency manifests it may be made to install (ASI04). Owners add paths
 * in their settings (R-BTN-66, `control_paths`); the four ticket frontmatter fields are watched
 * as fields, not paths (a path rule cannot see inside a file). Patterns match a whole path;
 * `**` spans directories, `*` and `?` stay within one segment. */
export const CONTROL_PATTERNS = [
  // Baton's own configuration: courses, policies, the ticket source, the sync's scaffolding.
  '.baton/**',
  // Goal files (B-122's `**/goals/**`, the security model's candidate list).
  '**/goals/**',
  // CI: what a push can make the repository run.
  '.github/workflows/**',
  // Agent configuration: hooks, settings, skills, memory and plugin manifests — .claude/** (and
  // .claude-plugin/**), every CLAUDE.md and AGENTS.md, MCP and opencode configuration.
  '.claude/**',
  '.claude-plugin/**',
  '**/.claude-plugin/**',
  'CLAUDE.md',
  '**/CLAUDE.md',
  'AGENTS.md',
  '**/AGENTS.md',
  '.mcp.json',
  '**/.mcp.json',
  '.opencode/**',
  '**/.opencode/**',
  'opencode.json',
  '**/opencode.json',
  // Dependency manifests and lockfiles (ASI04): what an install is made to fetch and run.
  'package.json',
  '**/package.json',
  'package-lock.json',
  '**/package-lock.json',
  'npm-shrinkwrap.json',
  '**/npm-shrinkwrap.json',
  'yarn.lock',
  '**/yarn.lock',
  'pnpm-lock.yaml',
  '**/pnpm-lock.yaml',
  'bun.lock',
  '**/bun.lock',
  'bun.lockb',
  '**/bun.lockb',
  'deno.lock',
  '**/deno.lock',
  'requirements*.txt',
  '**/requirements*.txt',
  'pyproject.toml',
  '**/pyproject.toml',
  'poetry.lock',
  '**/poetry.lock',
  'Pipfile',
  '**/Pipfile',
  'Pipfile.lock',
  '**/Pipfile.lock',
  'uv.lock',
  '**/uv.lock',
  'go.mod',
  '**/go.mod',
  'go.sum',
  '**/go.sum',
  'Cargo.toml',
  '**/Cargo.toml',
  'Cargo.lock',
  '**/Cargo.lock',
  'Gemfile',
  '**/Gemfile',
  'Gemfile.lock',
  '**/Gemfile.lock',
  'composer.json',
  '**/composer.json',
  'composer.lock',
  '**/composer.lock',
  'mix.lock',
  '**/mix.lock',
  'pom.xml',
  '**/pom.xml',
  'build.gradle',
  '**/build.gradle',
  'build.gradle.kts',
  '**/build.gradle.kts',
  'gradle.lockfile',
  '**/gradle.lockfile',
] as const;

/** A control path pattern's grammar (R-BTN-66's setting admits the same): gitignore-like, `**`
 * spanning directories, `*` and `?` within a segment, character classes — no negation, for a
 * control path is named, never subtracted. */
export const PATH_PATTERN = /^[A-Za-z0-9_./*?[\]-]{1,200}$/;
/** R-BTN-66: an owner may add at most this many control paths. */
export const CONTROL_PATHS_MAX = 64;

/** One pattern as a whole-path matcher. Pure; returns null for a pattern outside the grammar. */
export function controlPattern(pattern: string): RegExp | null {
  if (!PATH_PATTERN.test(pattern)) return null;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      // `**` spans directories, matching none of them too, wherever gitignore's does: before a
      // `/` it is any number of whole segments, elsewhere it swallows the rest of the path.
      // The loop's own step then moves past the second `*`.
      if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
      else { out += '.*'; i += 1; }
      continue;
    }
    if (c === '*') { out += '[^/]*'; continue; }
    if (c === '?') { out += '[^/]'; continue; }
    // A character class passes through as git's would: the grammar admits no backslash, so its
    // content is a literal class already. An unclosed `[` is a literal bracket.
    if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close > i + 1) { out += pattern.slice(i, close + 1); i = close; continue; }
      out += '\\[';
      continue;
    }
    out += c.replace(/[.+{}()|^$\\]/g, '\\$&');
  }
  try {
    return new RegExp(`^${out}$`);
  } catch {
    return null;
  }
}

/** Whether `path` is a control input under `extra` (the owners' added patterns, R-BTN-66). */
export function isControlPath(path: string, extra: readonly string[] = []): boolean {
  for (const p of [...CONTROL_PATTERNS, ...extra]) {
    const re = cache(p);
    if (re?.test(path)) return true;
  }
  return false;
}

// Patterns are few and repeat; the compiled matchers are shared (a module-level cache of pure
// functions over immutable strings — the codebase's own `capabilitiesOf` memoises the same way).
const compiled = new Map<string, RegExp | null>();
const cache = (p: string): RegExp | null => {
  if (!compiled.has(p)) compiled.set(p, controlPattern(p));
  return compiled.get(p) ?? null;
};

/** `control_paths` as the settings PUT carries it (R-BTN-66): the checked list. */
export function checkControlPaths(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > CONTROL_PATHS_MAX || !v.every((x) => typeof x === 'string' && PATH_PATTERN.test(x as string))) {
    throw new BatonError('invalid-params', `control_paths: ${CONTROL_PATHS_WHY}`);
  }
  const out = v as string[];
  if (new Set(out).size !== out.length) throw new BatonError('invalid-params', 'control_paths: names a path twice');
  return out;
}

/** A control path pattern's bounds as the settings PUT words them. */
export const CONTROL_PATHS_WHY = `must be at most ${CONTROL_PATHS_MAX} path patterns, each of ${PATH_PATTERN.source}`;

/** R-BTN-194: who last changed a ticket — `{pusher, pusher_id?, commit, at}`, `pusher` the
 * pusher's login (or `pusher-unknown`); `signer` arrives with B-127's owner-signed control. */
export interface LastWrittenBy {
  pusher: string;
  pusher_id?: number;
  commit: string;
  at: number;
  signer?: string;
}

/** One recorded push delivery (R-BTN-73), as `push_deliveries` holds it. */
interface PushRow {
  delivery_id: string;
  before_sha: string;
  after_sha: string;
  sender_id: number | null;
  sender_login: string | null;
  commits: { sha: string; paths: string[] }[];
  truncated: number;
  received_at: number;
}

/** The control fields of a ticket's row (B-126 item 1's frontmatter list) as they stand. */
export interface ControlFields {
  expedite: number;
  tier: string | null;
  requires_clause: string;
  requires: string[];
  depends_on: string;
}

/** §14 Needs you: the control changes of the last 7 days, newest first. */
export const CHANGES_WINDOW_MS = 7 * 86_400_000;
const CHANGES_LIST_MAX = 100;
/** Bounds on one event's detail (spec-silent, recorded as R3-1232's posts' bounds are): a notice
 * names what changed, not everything that did. */
const CHANGES_MAX = 50;
const COMMITS_MAX = 40;
/** A chain longer than this is a rewritten history wearing a push list; it stops the walk. */
const CHAIN_MAX = 100;

/** One change of a `control-changed` event's detail. */
export interface ControlChange {
  /** null: a delivery past the recording bounds — its paths are not recordable (fail closed). */
  path: string | null;
  /** The ticket frontmatter fields that moved, when the path is a live ticket's file. */
  fields?: string[];
  commits: string[];
  /** The pushers of those commits: `{id: null}` is `pusher-unknown`. */
  pushers: { id: number | null; login: string | null }[];
}

export class Controls {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  private rows<T = Record<string, unknown>>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray() as T[];
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  /** The pushes that moved `repository`'s `ref` from `from` to `to`, oldest first: the recorded
   * deliveries (R-BTN-73) chained by their `before` and `after`, newest first back from `to`.
   * `complete` when the chain reaches `from`; a gap, a pruned delivery or a force push leaves it
   * false with whatever could be traced — those commits' pusher is unknown, never assumed. */
  private chain(repository: string, ref: string, from: string, to: string): { pushes: PushRow[]; complete: boolean } {
    const traced: PushRow[] = [];
    let at = to;
    for (let steps = 0; steps < CHAIN_MAX && at !== from; steps++) {
      const d = this.rows<PushRow & { commits_json: string }>(
        'SELECT delivery_id, before_sha, after_sha, sender_id, sender_login, commits_json, truncated, received_at FROM push_deliveries WHERE repository = ? AND ref = ? AND after_sha = ? ORDER BY received_at DESC, delivery_id DESC LIMIT 1',
        repository, ref, at)[0];
      if (!d) return { pushes: traced.reverse(), complete: false };
      traced.push({ ...d, commits: d.truncated ? [] : JSON.parse(d.commits_json) as PushRow['commits'] });
      at = d.before_sha;
    }
    return { pushes: traced.reverse(), complete: at === from };
  }

  /** The owners' recorded forge identities of `repository` (B-126 item 3): the `pushers` setting
   *  (R-BTN-139's list) — the user ids a push delivery's `sender.id` is judged by. */
  ownerIds(repository: string): Set<number> {
    const raw = this.rows<{ pushers: string }>('SELECT pushers FROM repositories WHERE id = ?', repository)[0]?.pushers ?? '[]';
    try {
      const v = JSON.parse(raw) as unknown;
      return new Set(Array.isArray(v) && v.every((x) => typeof x === 'number') ? v as number[] : []);
    } catch {
      return new Set();
    }
  }

  /** The owners' added control paths (R-BTN-66), as stored; never malformed — the settings PUT
   * checked them. */
  extraPaths(repository: string): string[] {
    const raw = this.rows<{ control_paths: string }>('SELECT control_paths FROM repositories WHERE id = ?', repository)[0]?.control_paths ?? '[]';
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : [];
    } catch {
      return [];
    }
  }

  /** Every ticket's control fields as they stand — read in the post's transaction before its rows
   * are rewritten, so the fields a head changed can be named. */
  fieldsOf(repository: string): Map<string, ControlFields> {
    const out = new Map<string, ControlFields>(this.rows<{ local_id: string; expedite: number; tier: string | null; requires_clause: string; depends_on: string }>(
      'SELECT local_id, expedite, tier, requires_clause, depends_on FROM tickets WHERE repository_id = ?', repository)
      .map((t) => [t.local_id, { expedite: t.expedite, tier: t.tier, requires_clause: t.requires_clause, requires: [], depends_on: t.depends_on }]));
    for (const r of this.rows<{ local_id: string; name: string }>(
      'SELECT t.local_id, q.name FROM tickets t JOIN ticket_requires q ON q.ticket_id = t.id WHERE t.repository_id = ?', repository)) {
      out.get(r.local_id)?.requires.push(r.name);
    }
    for (const f of out.values()) f.requires.sort();
    return out;
  }

  /**
   * R-BTN-194, in the transaction that accepts a post moving `repository`'s head from `from` to
   * `to`: read the push deliveries of that range (never the post's own account of what changed),
   * raise one `control-changed` event for the control inputs a non-owner's commits changed, and
   * record each ticket's `last_written_by`. `rows` are the post's tickets, `changed` their local
   * ids whose row this post rewrote, `before` the fields `fieldsOf` read before the rewrite.
   * A first snapshot (`from` null) judges nothing — there is no prior head to differ from.
   */
  advance(repository: Repository, from: string | null, to: string, at: number, rows: readonly TicketRow[], changed: ReadonlySet<string>, before: Map<string, ControlFields>): void {
    if (from == null || from === to) return;
    const { pushes, complete } = this.chain(repository.github.toLowerCase(), `refs/heads/${repository.default_branch}`, from, to);
    const owners = this.ownerIds(repository.id);
    const extra = this.extraPaths(repository.id);
    // path → the commits that changed it, oldest first, with each push's pusher.
    const touching = new Map<string, { sha: string; id: number | null; login: string | null; at: number }[]>();
    const unrecordable: PushRow[] = [];
    for (const push of pushes) {
      if (push.truncated) { unrecordable.push(push); continue; }
      for (const commit of push.commits) {
        for (const path of commit.paths) {
          const list = touching.get(path) ?? [];
          list.push({ sha: commit.sha, id: push.sender_id, login: push.sender_login, at: push.received_at });
          touching.set(path, list);
        }
      }
    }
    const pushersOf = (commits: { id: number | null; login: string | null }[]) => {
      const out: { id: number | null; login: string | null }[] = [];
      for (const c of commits) if (!out.some((p) => p.id === c.id && p.login === c.login)) out.push({ id: c.id, login: c.login });
      return out;
    };
    const changes: ControlChange[] = [];
    /** One change, raised unless every pusher of it is an owner identity — `pusher-unknown`
     * (id null) never is. A change no traced commit accounts for, and the commits a chain that
     * cannot close leaves unattributed, are unknown too: the writer is never assumed an
     * owner's (fail closed, R-BTN-194). */
    const add = (path: string | null, commits: string[], pushers: { id: number | null; login: string | null }[], fields?: string[]) => {
      const named = [...pushers];
      if ((!named.length || !complete) && !named.some((p) => p.id == null)) named.push({ id: null, login: null });
      if (named.every((p) => p.id != null && owners.has(p.id))) return;
      changes.push({ path, ...(fields?.length ? { fields } : {}), commits: [...new Set(commits)].slice(0, COMMITS_MAX), pushers: named });
    };
    for (const [path, commits] of touching) {
      if (isControlPath(path, extra)) add(path, commits.map((c) => c.sha), pushersOf(commits));
    }
    // A delivery past the recording bounds (R-BTN-73) changed paths Baton cannot name: fail
    // closed — its push raises unless the pusher is an owner identity, naming nothing.
    for (const push of unrecordable) add(null, [], [{ id: push.sender_id, login: push.sender_login }]);
    // The four watched frontmatter fields, judged on the rows themselves: the ticket's file is
    // the path, its commits in the chain the writers. A new ticket's fields are its filing, not
    // a change to an input (B-126: "changes a control input" needs a prior value).
    for (const row of rows) {
      if (!changed.has(row.id)) continue;
      const was = before.get(row.id);
      if (!was) continue;
      const fields = fieldsChanged(was, row);
      if (fields.length) add(row.path, (touching.get(row.path) ?? []).map((c) => c.sha), pushersOf(touching.get(row.path) ?? []), fields);
    }
    if (changes.length) {
      const listed = changes.slice(0, CHANGES_MAX);
      logEvent(this.c.store, at, 'control-changed', 'sync', { sha: to, parent_sha: from, changes: listed, ...(changes.length > listed.length ? { omitted: changes.length - listed.length } : {}) }, null, null, repository.id);
    }
    // Provenance (R-BTN-194): the newest commit the deliveries show changing each ticket's file,
    // its pusher; a ticket whose row changed with no traced commit is `pusher-unknown` — a
    // missing delivery or a forge that sends none (a plain git remote) — never credited to an
    // owner by assumption.
    for (const row of rows) {
      if (!row.path) continue;
      const commits = touching.get(row.path);
      const last = commits?.at(-1);
      const lw: LastWrittenBy | null = last
        ? { pusher: last.login ?? (last.id != null ? String(last.id) : 'pusher-unknown'), ...(last.id != null ? { pusher_id: last.id } : {}), commit: last.sha, at: last.at }
        : changed.has(row.id)
          ? { pusher: 'pusher-unknown', commit: to, at }
          : null;
      if (lw) this.exec('UPDATE tickets SET last_written_by = ? WHERE id = ?', JSON.stringify(lw), `${repository.id}:${row.id}`);
    }
  }

  /** §14 Needs you: the control changes of the last 7 days, newest first (R-BTN-194). */
  changesView(now: number) {
    return this.rows<{ repository_id: string; at: number; detail_json: string }>(
      `SELECT repository_id, at, detail_json FROM events WHERE kind = 'control-changed' AND at > ? ORDER BY seq DESC LIMIT ?`, now - CHANGES_WINDOW_MS, CHANGES_LIST_MAX)
      .map((r) => {
        let detail: Record<string, unknown> = {};
        try {
          detail = JSON.parse(r.detail_json) as Record<string, unknown>;
        } catch {
          detail = {};
        }
        return { repository_id: r.repository_id, at: r.at, ...detail };
      });
  }
}

/** The watched frontmatter fields that differ between the row as it stood and the post's. */
function fieldsChanged(was: ControlFields, row: TicketRow): string[] {
  const out: string[] = [];
  if (was.expedite !== row.expedite) out.push('EXPEDITE');
  if (was.tier !== (row.tier ?? null)) out.push('tier');
  if (was.requires_clause !== row.requires_clause || JSON.stringify(was.requires) !== JSON.stringify([...row.requires].sort())) out.push('requires');
  if (was.depends_on !== row.depends_on) out.push('depends_on');
  return out;
}
