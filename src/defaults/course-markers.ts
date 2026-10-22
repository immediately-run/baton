// course-markers.ts — the station function of the standard courses that open no PR (`bug-report`,
// `draft-ticket`, `decision`; BATON_SPEC R-BTN-131): where each ticket is, from the closing
// markers its legs committed (R-BTN-83). Each finished leg's `close` appends one line to
// `.baton/markers.jsonl` on the default branch — `{ticket, leg, reached, next, claim}` — and the
// sync reads the file as the checkout it posts has it. Pure over the parsed lines and the course
// file, so a repository can eject it like the `create-pr` default. Course code in the CLI, never
// core (§2b).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join } from 'node:path';
import type { PostedStation } from '../core/board';
import type { Step } from '../core/graph';
import type { SourceTicket } from './tickets-markdown';
import type { StationsResult } from './course-pr';

/** One closing marker, as `markerClose` writes it. */
export interface Marker {
  ticket: string;
  leg: string;
  reached: string;
  /** The leg the finished one queued (R-BTN-83's pair); null at an end. */
  next?: string | null;
  claim?: string | null;
}

/** The part of a course file (R-BTN-69) the function reads. */
export interface CourseGraph {
  start: string;
  start_leg: string;
  end: string[];
  legs: Record<string, { from: string[]; to: string | string[]; max_runs?: number }>;
}

/** Where `.baton/markers.jsonl` lives, relative to the repository root. */
export const MARKERS_FILE = join('.baton', 'markers.jsonl');

/** The markers of `.baton/markers.jsonl`'s text, in file order. A line that is not a marker —
 * malformed JSON, a missing field — is skipped and reported through `skip`, never thrown: one bad
 * line committed to the default branch must not stop every sync after it. */
export function parseMarkers(text: string, skip: (line: number, why: string) => void = () => {}): Marker[] {
  const out: Marker[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    let m: unknown;
    try {
      m = JSON.parse(line);
    } catch {
      skip(i + 1, 'not JSON');
      return;
    }
    const v = m as Partial<Marker> | null;
    if (v == null || typeof v.ticket !== 'string' || typeof v.leg !== 'string' || typeof v.reached !== 'string') {
      skip(i + 1, 'no ticket, leg and reached');
      return;
    }
    out.push({ ticket: v.ticket, leg: v.leg, reached: v.reached, next: typeof v.next === 'string' ? v.next : null, claim: typeof v.claim === 'string' ? v.claim : null });
  });
  return out;
}

const tosOf = (to: string | string[]): string[] => (Array.isArray(to) ? to : [to]);

/** The legs leaving `station` that `runs` has not exhausted, in the course file's order. */
function legsOut(graph: CourseGraph, station: string, runs: Map<string, number>): string[] {
  return Object.entries(graph.legs)
    .filter(([id, l]) => l.from.includes(station) && (l.max_runs == null || (runs.get(id) ?? 0) < l.max_runs))
    .map(([id]) => id);
}

export interface MarkersCtx {
  tickets: SourceTicket[];
  closed: Set<string>;
  done?: Set<string>;
  graph: CourseGraph;
  markers: Marker[];
  /** A course's own wait on a leg: the `waiting_on` label it waits on for `ticket`, or null when
   * it is ready (the `decision` course's `carry-out` waits on the owner's answer). */
  waits?: (ticket: SourceTicket, leg: string) => string | null;
}

/** Each live ticket's station (R-BTN-70) from its markers: the path is every marker whose pair is
 * an edge from where the ticket stood — a marker that is not one (a leg that does not leave that
 * station, a `reached` the leg cannot reach, a leg past its `max_runs`) is ignored, as R-BTN-83's
 * `locate` ignores one. The queued leg is the last marker's `next` when that leaves the station
 * (`next_source: marker`), else the first leg the course file lists leaving it (`course`). With
 * no marker the ticket is at `start`, its `start_leg` waiting while a dependency is not closed
 * done or an open child blocks it, as the `create-pr` course waits `implement`. */
export function stationsMarkers(ctx: MarkersCtx): StationsResult {
  const done = ctx.done ?? ctx.closed;
  const stations: Record<string, PostedStation> = {};
  const byTicket = new Map<string, Marker[]>();
  for (const m of ctx.markers) byTicket.set(m.ticket, [...(byTicket.get(m.ticket) ?? []), m]);
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    let station = ctx.graph.start;
    let queued: string | null = null;
    const path: Step[] = [];
    const runs = new Map<string, number>();
    for (const m of byTicket.get(t.id) ?? []) {
      // Own keys only: a marker's leg is text from git, and `constructor` is no leg.
      const leg = Object.hasOwn(ctx.graph.legs, m.leg) ? ctx.graph.legs[m.leg] : undefined;
      if (leg == null || !leg.from.includes(station) || !tosOf(leg.to).includes(m.reached)) continue;
      if (leg.max_runs != null && (runs.get(m.leg) ?? 0) >= leg.max_runs) continue;
      runs.set(m.leg, (runs.get(m.leg) ?? 0) + 1);
      path.push({ leg: m.leg, reached: m.reached });
      station = m.reached;
      queued = m.next ?? null;
    }
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

/** What `close` runs: `git`, in the checkout, answering stdout. Tests inject it. */
export type Exec = (cmd: 'git', args: string[], cwd: string) => string;

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
 * is bounded — a command still running at `timeoutMs` (default `CLOSE_TIMEOUT_MS`) is killed
 * with SIGKILL and its failure thrown (Node reports it as a timeout error) — and never
 * interactive. */
export const exec = (cmd: string, args: string[], cwd: string, timeoutMs: number = CLOSE_TIMEOUT_MS): string =>
  execFileSync(cmd, args, {
    cwd, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL',
    env: { ...process.env, ...GIT_NONINTERACTIVE_ENV },
  }).trim();

/** Appends one marker line to `.baton/markers.jsonl` and commits that file alone, as
 * `baton:close <ticket> <leg>` — the one way every standard course writes a marker line. */
export function commitMarker(checkout: string, line: Marker, run: Exec = exec): void {
  appendFileSync(join(checkout, MARKERS_FILE), `${JSON.stringify(line)}\n`);
  run('git', ['add', MARKERS_FILE], checkout);
  run('git', ['commit', '--no-gpg-sign', '-m', `baton:close ${line.ticket} ${line.leg}`], checkout);
}

/** The bare ticket id a marker names: the sync reads ids as the repository's ticket files carry
 * them (`B-1`), while a claim's `ctx.ticket.id` is repository-qualified (`docs:B-1`, R-BTN-51). */
export function bareTicketId(ticket: { id: string; home?: string | null }): string {
  if (ticket.home && ticket.id.startsWith(`${ticket.home}:`)) return ticket.id.slice(ticket.home.length + 1);
  const colon = ticket.id.indexOf(':');
  return colon < 0 ? ticket.id : ticket.id.slice(colon + 1);
}

/** How many times a close re-applies its marker over a remote that moved before it gives up. */
export const MARKER_PUSH_TRIES = 3;

/** A push the remote refused because the branch moved — the one failure a rebase can fix. Not
 * git's summary line (`failed to push some refs`), which every refusal prints: a hook or a
 * protected branch says `[remote rejected]`, and no rebase fixes that. */
const movedOnRemote = (e: unknown): boolean => {
  const err = e as { stderr?: unknown; message?: unknown };
  return /! \[rejected\]|non-fast-forward|\(fetch first\)/.test(`${String(err?.stderr ?? '')}\n${String(err?.message ?? '')}`);
};

/** The marker courses' `close` (R-BTN-83): one line in `.baton/markers.jsonl`, committed and
 * pushed to the branch the checkout is on — the default branch, where these courses' legs commit
 * their work — so the next sync places the ticket. The checkout's own `info/attributes` merges the
 * file by union, so two closes racing on it rebase cleanly: each keeps both lines. Only a push the
 * remote refused because the branch moved is rebased and retried, up to `MARKER_PUSH_TRIES`; a
 * rebase that still stops is aborted, leaving the checkout as it was, and any other failure throws
 * at once — the runner reports the leg failed. Returns the commit's sha, the marker's evidence.
 * B-94: every call here is bounded (the default `exec`: `CLOSE_TIMEOUT_MS`, non-interactive), so
 * the worst case is `MARKER_PUSH_TRIES` pushes, each killed at its own bound — a remote that
 * stops answering fails the leg, it never holds the runner. */
export async function markerClose(
  ctx: { checkout: string; ticket: { id: string; home?: string | null }; leg: string; claim?: { nonce?: string } },
  result: { reached?: string; next?: string | null },
  run: Exec = exec,
): Promise<string> {
  if (typeof result?.reached !== 'string' || result.reached === '') throw new Error(`the ${ctx.leg} leg returned no station reached`);
  const id = bareTicketId(ctx.ticket);
  const line: Marker = { ticket: id, leg: ctx.leg, reached: result.reached, next: result.next ?? null, claim: ctx.claim?.nonce ?? null };
  unionMerge(ctx.checkout, run);
  commitMarker(ctx.checkout, line, run);
  for (let tries = 1; ; tries++) {
    try {
      run('git', ['push', 'origin', 'HEAD'], ctx.checkout);
      break;
    } catch (e) {
      if (!movedOnRemote(e) || tries >= MARKER_PUSH_TRIES) throw e;
    }
    const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], ctx.checkout);
    try {
      run('git', ['pull', '--rebase', 'origin', branch], ctx.checkout);
    } catch (e) {
      try {
        run('git', ['rebase', '--abort'], ctx.checkout);
      } catch {
        // No rebase in progress: the pull failed before starting one.
      }
      throw e;
    }
  }
  return run('git', ['rev-parse', 'HEAD'], ctx.checkout);
}

/** The line that makes git merge the markers file by union (gitattributes(5), `merge=union`). */
export const MARKERS_ATTRIBUTE = `/${MARKERS_FILE} merge=union`;

/** Writes `MARKERS_ATTRIBUTE` into the checkout's own `info/attributes` once — local to the
 * checkout, never committed, so the repository's tree is untouched. */
function unionMerge(checkout: string, run: Exec): void {
  const rel = run('git', ['rev-parse', '--git-path', 'info/attributes'], checkout);
  const file = isAbsolute(rel) ? rel : join(checkout, rel);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text.split('\n').includes(MARKERS_ATTRIBUTE)) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${MARKERS_ATTRIBUTE}\n`);
}
