// ticket-state.ts — the marker courses' state, in the ticket itself (BATON_SPEC §5.8, B-100):
// each leg's `close` writes the machine state — `station`, `next_leg`, the claim's `claim`
// nonce — into the ticket file's frontmatter and its work under its own `## <leg>` heading,
// commits the ticket on the default branch and pushes. One writer per ticket (the close), no
// shared file, no cross-ticket contention: everything `.baton/markers.jsonl` held is
// reconstructed from the ticket's frontmatter, and the path history is the file's git history
// (`baton:close <ticket> <leg>` commits). Before committing, the close validates the ticket —
// frontmatter against the repository's own item schema, the machine fields' types, and the
// presence of this leg's heading: trust nothing the agent touched, check everything the
// machine reads (the owner's decision, 2026-10-22). Course code in the CLI, never core (§2b).
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { PostedStation } from '../core/board';
import type { Step } from '../core/graph';
import type { SourceTicket } from './tickets-markdown';
import { parseFrontmatter } from './tickets-markdown';
import type { StationsResult } from './course-pr';

/** One finished leg's record, as the ticket's git history holds it and the station function
 * folds it: the same shape a marker line carried (R-BTN-83's pair plus the claim). */
export interface TicketClose {
  ticket: string;
  leg: string;
  reached: string;
  /** The leg the finished one queued (R-BTN-83's pair); null at an end. */
  next?: string | null;
  claim?: string | null;
}

/** The frontmatter keys the close owns, alone: a repository's item schema may not know them
 * (it lags the CLI), so the boundary check carries them for it (round 1, finding 2). */
export const MACHINE_KEYS = ['station', 'next_leg', 'claim'] as const;

/** The machine fields a close writes into the ticket's frontmatter — the owner's decision:
 * everything markers.jsonl held, reconstructed from frontmatter. */
export interface MachineState {
  station: string;
  /** The queued leg; null at an end (the key is removed). */
  next_leg: string | null;
  /** The closing leg's claim nonce, its evidence. */
  claim: string | null;
}

/** The part of a course file (R-BTN-69) the station function reads. */
export interface CourseGraph {
  start: string;
  start_leg: string;
  end: string[];
  legs: Record<string, { from: string[]; to: string | string[]; max_runs?: number }>;
}

/** How a command is called: `(cmd, args, cwd)`, with what a command needs beyond its arguments.
 * Optional, so a `run` that answers by arguments alone keeps working: only `exec` reads them. */
export type Exec = (
  cmd: 'git' | 'gh',
  args: string[],
  cwd: string,
  opts?: { env?: Record<string, string>; input?: string },
) => string;

/** B-94: the bound on every git (or `gh`) call a standard course's `close` makes. A command
 * that cannot answer in this long is killed and its failure thrown — a wedged push then fails
 * the leg in seconds, never blocks the claim for hours. The close runs in the runner's process
 * and its git is synchronous, so the bound also blocks the runner's loop (no beat can fire
 * while it waits): the arithmetic it must satisfy is `callClose`'s three attempts — 3 ×
 * CLOSE_TIMEOUT_MS — staying under the lease's margin (`lease_timeout` − 4 min, §9.2; 6 min
 * against 11 at today's 15-minute lease), pinned by test. */
export const CLOSE_TIMEOUT_MS = 120_000;

/** B-94: git's environment for every call the close and the runner's own git make —
 * non-interactive by construction, so a credential prompt or an ssh host-key question can never
 * wait on a terminal the runner does not have: no terminal prompt from git itself, and ssh in
 * batch mode, failing rather than asking. One definition (B-94's review round 1): the runner
 * and the generated stubs import it from here. */
export const GIT_NONINTERACTIVE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=20',
};

/** The real command runner every standard course's `close` uses; tests inject their own. B-94: it
 * is bounded — a command still running at its bound is killed with SIGKILL and its failure
 * thrown (Node reports it as a timeout error) — and never interactive. */
export const exec = (
  cmd: string,
  args: string[],
  cwd: string,
  opts: { env?: Record<string, string>; input?: string; timeoutMs?: number } = {},
): string =>
  execFileSync(cmd, args, {
    cwd, encoding: 'utf8', timeout: opts.timeoutMs ?? CLOSE_TIMEOUT_MS, killSignal: 'SIGKILL',
    ...(opts.input != null ? { input: opts.input } : { stdio: ['ignore', 'pipe', 'pipe'] }),
    env: { ...process.env, ...GIT_NONINTERACTIVE_ENV, ...opts.env },
  }).trim();

/** The bare ticket id a close names: the sync reads ids as the repository's ticket files carry
 * them (`B-1`), while a claim's `ctx.ticket.id` is repository-qualified (`docs:B-1`, R-BTN-51). */
export function bareTicketId(ticket: { id: string; home?: string | null }): string {
  if (ticket.home && ticket.id.startsWith(`${ticket.home}:`)) return ticket.id.slice(ticket.home.length + 1);
  const colon = ticket.id.indexOf(':');
  return colon < 0 ? ticket.id : ticket.id.slice(colon + 1);
}

/** How many times a close re-applies its write over a remote that moved before it gives up. */
export const PUSH_TRIES = 3;

/** A push the remote refused because the branch moved — the one failure a re-read can fix. Not
 * git's summary line (`failed to push some refs`), which every refusal prints: a hook or a
 * protected branch says `[remote rejected]`, and no re-read fixes that. */
const movedOnRemote = (e: unknown): boolean => {
  const err = e as { stderr?: unknown; message?: unknown };
  return /! \[rejected\]|non-fast-forward|\(fetch first\)/.test(`${String(err?.stderr ?? '')}\n${String(err?.message ?? '')}`);
};

/** The branch a ticket's close writes when nothing names the repository's default: `main`. */
export const DEFAULT_TICKETS_BRANCH = 'main';

/** Which branch a ticket's state is written on, in order of what knows it best — every source
 * is a git command in the checkout, never the working tree:
 * - `named`, the caller's word (the claim answer names it and the runner sets it in the stub's
 *   environment): the only source this repository's own settings carry, and the one a
 *   repository not on `main` has;
 * - `remote`, what `origin/HEAD` says — set by a plain `git clone`, absent from a mirror or a
 *   runner's fetch-only setup;
 * - `DEFAULT_TICKETS_BRANCH`, the course's own default.
 * A name that is empty, option-shaped or not a plain branch name is ignored, never run with. */
export function ticketsBranch(checkout: string, named: string | null | undefined, run: Exec = exec): string {
  const plain = (b: string | null | undefined): string | null =>
    typeof b === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b) && !b.includes('..') && !b.endsWith('/') ? b : null;
  const given = plain(named);
  if (given) return given;
  try {
    // `--short` prints the remote-tracking name (`origin/main`), and a ticket write is fetched
    // and pushed by the BRANCH name (`main`).
    const head = run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], checkout).trim().replace(/^origin\//, '');
    return plain(head) ?? DEFAULT_TICKETS_BRANCH;
  } catch {
    return DEFAULT_TICKETS_BRANCH;
  }
}

/** A ticket write's temporary index: git's own path for it in this checkout, asked of git and
 * never assumed. A linked worktree or a submodule has a `.git` FILE, not a directory, so
 * `<checkout>/.git/…` is ENOTDIR there. The tree is built there and nowhere else, so the real
 * index, `HEAD` and the working tree are never touched. */
const tmpIndexName = 'baton-ticket-index';
export function tmpIndex(checkout: string, run: Exec = exec): string {
  const rel = run('git', ['rev-parse', '--git-path', tmpIndexName], checkout).trim();
  return /^\//.test(rel) ? rel : join(checkout, rel);
}

/** The item schema a repository's tickets are checked against, beside the ticket files —
 * `item.schema.json` in the ticket file's own directory (the convention the tickets wiki
 * already checks in CI), read at the same ref as the ticket, never the working tree. */
export function itemSchemaPath(ticketPath: string): string {
  const dir = ticketPath.split('/').slice(0, -1).join('/');
  return dir === '' ? 'item.schema.json' : `${dir}/item.schema.json`;
}

/** A station id or leg id, as the course file's own grammar has it (R-BTN-69). */
const COURSE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** The ticket's machine state as its frontmatter carries it; null when the file carries none
 * (a ticket no close has touched). A field of the wrong type reads as none — the close
 * overwrites all three anyway, and the schema check names what broke. */
export function machineOf(fm: Record<string, unknown> | null | undefined): Partial<MachineState> {
  if (fm == null) return {};
  const out: Partial<MachineState> = {};
  if (typeof fm.station === 'string') out.station = fm.station;
  if (typeof fm.next_leg === 'string') out.next_leg = fm.next_leg;
  else if (fm.next_leg === null) out.next_leg = null;
  if (typeof fm.claim === 'string') out.claim = fm.claim;
  return out;
}

/** Write the machine state into the ticket's text: `station`, `next_leg` (removed at an end),
 * `claim`, in that order — one writer per ticket, the close; every other byte of the file is
 * preserved. */
export function setMachineKeys(text: string, state: MachineState): string {
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!fm) throw new Error('the ticket file has no frontmatter block');
  const block = fm[0];
  const eol = block.includes('\r\n') ? '\r\n' : '\n';
  // A machine key goes as one line; a malformed block-list value's `- item` continuations are
  // removed with it, never left dangling under the key above (round 1, finding 6; round 2's
  // finding 3 — the guard now walks a flag, not the line before, which the drop had already
  // removed).
  const kept: string[] = [];
  let dropping = false;
  for (const line of block.split(/\r?\n/)) {
    if (/^(station|next_leg|claim):/.test(line)) {
      dropping = true;
      continue;
    }
    if (dropping && /^\s+-\s+/.test(line)) continue;
    dropping = false;
    kept.push(line);
  }
  const entries: string[] = [`station: ${state.station}`];
  if (state.next_leg != null) entries.push(`next_leg: ${state.next_leg}`);
  if (state.claim != null) entries.push(`claim: ${state.claim}`);
  const closing = kept.pop()!; // the `---`
  const next = [...kept, ...entries, closing].join(eol);
  return next + text.slice(block.length);
}

/** Whether the ticket's body carries this leg's own heading — `## <leg>`, case-insensitive,
 * alone on its line: each leg gets its own heading (the owner's decision), and the close fails
 * the leg without it, naming it. */
export function legHeadingPresent(text: string, leg: string): boolean {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  return new RegExp(`^##[ \\t]+${leg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'im').test(body);
}

/** The item-schema keywords the boundary check applies (the set the tickets wiki's own schema
 * uses): `required`, `propertyNames.enum`, `properties.<key>.{type: string, enum, pattern}` and
 * `#/definitions/<name>` refs. A schema using anything else in a checked position fails the
 * check naming the keyword — never silently accepted unread (the boundary rule: check
 * everything the machine reads, or say you cannot). */
export function checkFrontmatter(schema: unknown, fm: Record<string, unknown>, ignore: readonly string[] = []): string[] {
  const out: string[] = [];
  const fail = (why: string) => out.push(why);
  const skipped = new Set(ignore);
  if (schema == null || typeof schema !== 'object' || Array.isArray(schema)) return ['item.schema.json is not a schema object'];
  const s = schema as Record<string, unknown>;
  const defs = typeof s.definitions === 'object' && s.definitions != null && !Array.isArray(s.definitions) ? s.definitions as Record<string, unknown> : {};
  /** Resolve one property's shape through a `#/definitions/<name>` ref, once; anything deeper
   * or anything else fails named. */
  const shapeOf = (key: string, p: unknown): Record<string, unknown> | null => {
    if (p == null || typeof p !== 'object' || Array.isArray(p)) return null;
    const prop = { ...(p as Record<string, unknown>) };
    if (typeof prop.$ref === 'string') {
      const m = /^#\/definitions\/([A-Za-z0-9_-]+)$/.exec(prop.$ref);
      if (!m) { fail(`${key}: a $ref other than #/definitions/<name> (${prop.$ref})`); return null; }
      const target = defs[m[1]];
      if (target == null || typeof target !== 'object' || Array.isArray(target)) { fail(`${key}: $ref ${prop.$ref} names no definition`); return null; }
      delete prop.$ref;
      return { ...(target as Record<string, unknown>), ...prop };
    }
    return prop;
  };
  const checked = new Set([`$schema`, `$id`, `title`, `description`, `type`, `required`, `properties`, `propertyNames`, `definitions`, 'additionalProperties']);
  for (const k of Object.keys(s)) if (!checked.has(k)) fail(`the schema uses "${k}", which the boundary check does not implement`);
  if (Array.isArray(s.required)) {
    for (const key of s.required) if (typeof key === 'string' && !(key in fm) && !skipped.has(key)) fail(`the ticket has no ${key}`);
  } else if (s.required !== undefined) fail('required is not a list');
  if (s.properties != null) {
    if (typeof s.properties !== 'object' || Array.isArray(s.properties)) fail('properties is not an object');
    else {
      for (const [key, p] of Object.entries(s.properties as Record<string, unknown>)) {
        if (!(key in fm) || skipped.has(key)) continue;
        const prop = shapeOf(key, p);
        if (prop == null) continue;
        for (const k of Object.keys(prop)) if (!['type', 'enum', 'pattern', 'description', 'title'].includes(k)) fail(`${key}: the property uses "${k}", which the boundary check does not implement`);
        const v = fm[key];
        if (prop.type === 'string' && typeof v !== 'string') fail(`${key} is not a string`);
        if (Array.isArray(prop.enum) && !prop.enum.some((e) => e === v)) fail(`${key} ${JSON.stringify(v)} is not one of ${prop.enum.map((e) => String(e)).join(', ')}`);
        if (typeof prop.pattern === 'string' && (typeof v !== 'string' || !new RegExp(prop.pattern).test(v))) fail(`${key} ${JSON.stringify(v)} does not match ${prop.pattern}`);
      }
    }
  }
  if (s.propertyNames != null) {
    const names = s.propertyNames as Record<string, unknown>;
    if (typeof names !== 'object' || !Array.isArray(names.enum)) fail('propertyNames.enum is not a list');
    else for (const key of Object.keys(fm)) if (!(names.enum as unknown[]).includes(key) && !skipped.has(key)) fail(`the ticket has an unknown key ${key}`);
  }
  return out;
}

/** The machine fields' own types, whatever the repository's schema says: a station and a queued
 * leg are course-file names (R-BTN-69), a claim nonce a short string. */
export function checkMachine(state: MachineState): string[] {
  const out: string[] = [];
  if (!COURSE_NAME.test(state.station)) out.push(`station ${JSON.stringify(state.station)} is not a station id`);
  if (state.next_leg != null && !COURSE_NAME.test(state.next_leg)) out.push(`next_leg ${JSON.stringify(state.next_leg)} is not a leg id`);
  if (state.claim != null && (state.claim === '' || state.claim.length > 64 || !/^[A-Za-z0-9._-]+$/.test(state.claim))) out.push('claim is not a nonce');
  return out;
}

/** The marker courses' `close` (R-BTN-83 as amended by B-100): the leg's machine state written
 * into the ticket file itself, committed on the default branch and pushed — never a shared
 * file. The write is git plumbing, exactly `commitMarkerOnDefault`'s once removed:
 *
 *  1. `git fetch origin <default>`;
 *  2. read the ticket file at `origin/<default>` — the trusted copy, never the working tree an
 *     agent may have left anywhere — and its `item.schema.json`, beside it;
 *  3. validate what the agent left: the frontmatter parses, its frontmatter satisfies the
 *     repository's schema, this leg's `## <leg>` heading is in the body. A violation throws
 *     naming the rule — the leg fails, nothing is written;
 *  4. set `station`, `next_leg`, `claim` to the runner's validated result — one writer per
 *     ticket, so a forged `station:` is simply overwritten, whatever the agent wrote;
 *  5. `hash-object` the text, write a tree = the fetched commit's tree with the file replaced
 *     (temporary index, removed after), `commit-tree` with `baton:close <ticket> <leg>`, and
 *     push, re-reading and retrying only a push the remote refused because the branch moved, up
 *     to `PUSH_TRIES`.
 *
 * Returns the pushed commit's sha, the close's evidence. Every call is bounded
 * (`CLOSE_TIMEOUT_MS`), so a remote that stops answering fails the leg in seconds. */
export async function closeTicket(
  ctx: { checkout: string; ticket: { id: string; path?: string | null; home?: string | null }; leg: string; claim?: { nonce?: string }; default_branch?: string | null; heading?: boolean },
  result: { reached?: string; next?: string | null },
  run: Exec = exec,
): Promise<string> {
  if (typeof result?.reached !== 'string' || result.reached === '') throw new Error(`the ${ctx.leg} leg returned no station reached`);
  if (ctx.ticket.path == null || ctx.ticket.path === '') throw new Error(`the ${ctx.leg} leg's ticket has no file path to write`);
  const id = bareTicketId(ctx.ticket);
  const state: MachineState = { station: result.reached, next_leg: result.next ?? null, claim: ctx.claim?.nonce ?? null };
  const branch = ticketsBranch(ctx.checkout, ctx.default_branch ?? null, run);
  const git = (args: string[], opts: { env?: Record<string, string>; input?: string } = {}): string => run('git', args, ctx.checkout, opts);
  const ref = `origin/${branch}`;
  const index = tmpIndex(ctx.checkout, run);
  const env = { GIT_INDEX_FILE: index };
  try {
    for (let tries = 1; ; tries++) {
      // The explicit refspec, not the remote's own fetch setting: a checkout with no
      // `remote.origin.fetch` would otherwise never move `origin/<branch>`, and the next close
      // would build on a stale parent and be refused.
      git(['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/${ref}`]);
      const parent = git(['rev-parse', '--verify', `${ref}^{commit}`]);
      let text: string;
      try {
        text = git(['show', `${ref}:${ctx.ticket.path}`]);
      } catch {
        throw new Error(`the ticket file ${ctx.ticket.path} is not on ${branch} — the leg cannot write it`);
      }
      // The boundary check, before anything is written: the ticket the agent left, the schema
      // beside it, and this leg's own heading. The machine fields are the close's to write.
      const fm = parseFrontmatter(text);
      if (fm == null) throw new Error(`the ticket file ${ctx.ticket.path} has no frontmatter block`);
      let schema: unknown = null;
      let schemaPresent = false;
      try {
        schema = JSON.parse(git(['show', `${ref}:${itemSchemaPath(ctx.ticket.path)}`]));
        schemaPresent = true;
      } catch (e) {
        // A schema that is present but unreadable fails the check closed — never silently
        // skipped (round 1, finding 7); a repository with none keeps the machine check.
        const missing = /does not exist|exists on disk|ambiguous argument/i.test(`${String((e as { stderr?: unknown }).stderr ?? '')}`);
        if (!missing) throw new Error(`the repository's ${itemSchemaPath(ctx.ticket.path)} is not a schema the close can check: ${(e as Error).message}`);
      }
      // The machine keys are the close's own (round 1, finding 2): a schema that does not know
      // them yet must not fail the ticket for carrying them.
      const violations = [...checkMachine(state), ...(schemaPresent && schema != null ? checkFrontmatter(schema, fm, MACHINE_KEYS) : [])];
      for (const v of violations) throw new Error(`the ticket does not validate: ${v}`);
      if (ctx.heading !== false && !legHeadingPresent(text, ctx.leg)) throw new Error(`the ticket has no '## ${ctx.leg}' heading — the leg's work belongs under its own heading`);
      // A markdown file ends with a newline; `run`'s trimmed read would drop the file's own.
      const next = text.endsWith('\n') ? setMachineKeys(text, state) : `${setMachineKeys(text, state)}\n`;
      const blob = git(['hash-object', '-w', '--stdin'], { input: next });
      rmSync(index, { force: true });
      git(['read-tree', parent], { env });
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${ctx.ticket.path}`], { env });
      const tree = git(['write-tree'], { env });
      const commit = git(['commit-tree', tree, '-p', parent, '-m', `baton:close ${id} ${ctx.leg}`]);
      try {
        git(['push', 'origin', `${commit}:refs/heads/${branch}`]);
        return commit;
      } catch (e) {
        if (!movedOnRemote(e) || tries >= PUSH_TRIES) throw e;
      }
    }
  } finally {
    // The index and git's lock for it: a close killed at its timeout leaves the lock, and every
    // later close in this checkout would fail on it.
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

/** The most closes one ticket's history is read for: enough for any course's legs at their
 * `max_runs`, bounded so a hostile history cannot spend the sync on itself. */
export const CLOSES_MAX = 100;

/** Every `baton:close <ticket> <leg>` commit in the checkout's history, grouped by ticket id,
 * newest-first — one traversal for the whole board, however many tickets hold closes (B-100).
 * Each ticket keeps at most `CLOSES_MAX`. A close whose ticket file did not change (the same
 * station re-reached) is still a commit with its subject, so it is still found: the subject, not
 * a path filter, is what the fold matches on. */
export function closesByTicket(run: (args: string[]) => string): Map<string, { sha: string; leg: string }[]> {
  const out = new Map<string, { sha: string; leg: string }[]>();
  let log: string;
  try {
    log = run(['log', '--format=%H%x09%s']);
  } catch {
    return out; // a checkout git cannot answer for has no close history
  }
  for (const line of log.split('\n').map((l) => l.trim()).filter((l) => l !== '')) {
    const m = /^([0-9a-f]{7,40})\tbaton:close (\S+) (.+)$/.exec(line);
    if (!m) continue;
    const [, sha, ticket, leg] = m;
    const list = out.get(ticket) ?? [];
    if (list.length < CLOSES_MAX) list.push({ sha, leg });
    out.set(ticket, list);
  }
  return out;
}

/** The closes one ticket's commits hold, oldest first, each read at its own commit: a leg (the
 * commit's subject), the station its close wrote, and the `next_leg` and `claim` beside it.
 * A commit whose ticket file cannot be read there contributes nothing. */
export function closesOfCommits(
  run: (args: string[]) => string,
  path: string,
  ticket: string,
  commits: { sha: string; leg: string }[],
): TicketClose[] {
  const out: TicketClose[] = [];
  for (const { sha, leg } of [...commits].reverse()) {
    let fm: Record<string, unknown> | null = null;
    try {
      fm = parseFrontmatter(run(['show', `${sha}:${path}`]));
    } catch {
      continue; // a commit whose file cannot be read contributes nothing
    }
    if (fm == null || typeof fm.station !== 'string') continue;
    out.push({ ticket, leg, reached: fm.station, next: typeof fm.next_leg === 'string' ? fm.next_leg : null, claim: typeof fm.claim === 'string' ? fm.claim : null });
  }
  return out;
}

/** The closes of one ticket, oldest first — the path history, reconstructed from the
 * repository's own history (B-100: the ticket is the record). A checkout git cannot answer for
 * has no close history at all: frontmatter state (a migration's, or a plain file) is all there
 * is, and that is what the station function reads. */
export function closesOfHistory(run: (args: string[]) => string, ticket: string, path: string): TicketClose[] {
  const commits = closesByTicket(run).get(ticket) ?? [];
  return closesOfCommits(run, path, ticket, commits);
}

export interface TicketsCtx {
  tickets: SourceTicket[];
  closed: Set<string>;
  done?: Set<string>;
  graph: CourseGraph;
  /** A course's own wait on a leg: the `waiting_on` label it waits on for `ticket`, or null when
   * it is ready (the `decision` course's `carry-out` waits on the owner's answer). */
  waits?: (ticket: SourceTicket, leg: string) => string | null;
}

/** The closes a ticket carries: its git history, as the sync attached it to the opaque `course`
 * blob (B-100: no second input — the ticket is the record); empty for a ticket whose state came
 * from the one-time migration. */
export const closesOf = (t: SourceTicket): TicketClose[] => {
  const c = (t.course ?? {}) as { closes?: unknown };
  return Array.isArray(c.closes) ? (c.closes as TicketClose[]).filter((x) => x != null && typeof x.leg === 'string' && typeof x.reached === 'string') : [];
};

const tosOf = (to: string | string[]): string[] => (Array.isArray(to) ? to : [to]);

/** The legs leaving `station` that `runs` has not exhausted, in the course file's order. */
function legsOut(graph: CourseGraph, station: string, runs: Map<string, number>): string[] {
  return Object.entries(graph.legs)
    .filter(([id, l]) => l.from.includes(station) && (l.max_runs == null || (runs.get(id) ?? 0) < l.max_runs))
    .map(([id]) => id);
}

/** Each live ticket's station (R-BTN-70) from its own record — the closes its git history
 * holds, else the frontmatter a migration wrote: the path folds every close whose pair is an
 * edge from where the ticket stood (a close that is not one — a leg that does not leave that
 * station, a `reached` the leg cannot reach, a leg past its `max_runs` — is ignored, as
 * R-BTN-83's `locate` ignores one). The queued leg is the last close's `next` when that leaves
 * the station (`next_source: marker`), else the first leg the course file lists leaving it
 * (`course`). With no close the ticket is at its frontmatter's `station` when it names one
 * (the migration's record), else `start`, its `start_leg` waiting while a dependency is not
 * closed done or an open child blocks it, as the `create-pr` course waits `implement`. */
export function stationsTickets(ctx: TicketsCtx): StationsResult {
  const done = ctx.done ?? ctx.closed;
  const stations: Record<string, PostedStation> = {};
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    let station: string | null = null;
    let queued: string | null = null;
    const path: Step[] = [];
    const runs = new Map<string, number>();
    const closes = closesOf(t);
    const fm = machineOf((t.course ?? {}) as Record<string, unknown>);
    if (closes.length === 0) {
      // A state with no close history at all — the one-time migration replays its lines as
      // closes (below, `migrateMarkersMain`), so this is a hand-set state: honoured only when
      // it names a station of this course AND carries its closing `claim` — the one writer's
      // signature (round 1, finding 9). An agent's bare `station:` pushes no claim; the ticket
      // stands where its history says.
      const stations = new Set([ctx.graph.start, ...ctx.graph.end, ...Object.values(ctx.graph.legs).flatMap((l) => [...l.from, ...tosOf(l.to)])]);
      if (typeof fm.station === 'string' && fm.claim != null && stations.has(fm.station)) station = fm.station;
      queued = fm.next_leg ?? null;
    }
    for (const m of closes) {
      // Own keys only: a close's leg is text from git, and `constructor` is no leg.
      const leg = Object.hasOwn(ctx.graph.legs, m.leg) ? ctx.graph.legs[m.leg] : undefined;
      if (station == null) {
        // The first close folds from wherever the ticket stood — start, for a ticket on its
        // course from the beginning.
        station = ctx.graph.start;
      }
      if (leg == null || !leg.from.includes(station) || !tosOf(leg.to).includes(m.reached)) continue;
      if (leg.max_runs != null && (runs.get(m.leg) ?? 0) >= leg.max_runs) continue;
      runs.set(m.leg, (runs.get(m.leg) ?? 0) + 1);
      path.push({ leg: m.leg, reached: m.reached });
      station = m.reached;
      queued = m.next ?? null;
    }
    if (station == null) station = ctx.graph.start;
    const atEnd = ctx.graph.end.includes(station);
    const out = atEnd ? [] : legsOut(ctx.graph, station, runs);
    const fromMarker = queued != null && out.includes(queued);
    const nextLeg = atEnd ? null : fromMarker ? queued : out[0] ?? null;
    const waitOf = (leg: string): string | null => {
      if (path.length === 0 && leg === ctx.graph.start_leg) {
        if (t.depends_on.some((d) => !done.has(d))) return 'dependencies';
        if (t.blocked_by.length) return 'children';
      }
      return ctx.waits?.(t, leg) ?? null;
    };
    stations[t.id] = {
      station, path, next_leg: nextLeg, next_source: fromMarker ? 'marker' : 'course', handoff_url: null,
      next: out.map((leg) => {
        const w = waitOf(leg);
        return { leg, state: w ? 'waiting' : 'ready', waiting_on: w };
      }),
      bars: {},
    };
  }
  return { stations, markers: [], course_data: {} };
}
