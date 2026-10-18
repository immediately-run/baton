// course-markers.ts — the station function of the standard courses that open no PR (`bug-report`,
// `draft-ticket`, `decision`; BATON_SPEC R-BTN-131): where each ticket is, from the closing
// markers its legs committed (R-BTN-83). Each finished leg's `close` appends one line to
// `.baton/markers.jsonl` on the default branch — `{ticket, leg, reached, next, claim}` — and the
// sync reads the file as the checkout it posts has it. Pure over the parsed lines and the course
// file, so a repository can eject it like the `create-pr` default. Course code in the CLI, never
// core (§2b).
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
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
      const leg = ctx.graph.legs[m.leg];
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
const exec: Exec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

/** The marker courses' `close` (R-BTN-83): one line in `.baton/markers.jsonl`, committed and
 * pushed to the branch the checkout is on — the default branch, where these courses' legs commit
 * their work — so the next sync places the ticket. A push the remote refuses because it moved is
 * rebased once and pushed again; a second refusal throws, and the runner reports the leg failed.
 * Returns the commit's sha, the marker's evidence. */
export async function markerClose(
  ctx: { checkout: string; ticket: { id: string }; leg: string; claim?: { nonce?: string } },
  result: { reached?: string; next?: string | null },
  run: Exec = exec,
): Promise<string> {
  if (typeof result?.reached !== 'string' || result.reached === '') throw new Error(`the ${ctx.leg} leg returned no station reached`);
  const line: Marker = { ticket: ctx.ticket.id, leg: ctx.leg, reached: result.reached, next: result.next ?? null, claim: ctx.claim?.nonce ?? null };
  appendFileSync(join(ctx.checkout, MARKERS_FILE), `${JSON.stringify(line)}\n`);
  run('git', ['add', MARKERS_FILE], ctx.checkout);
  run('git', ['commit', '--no-gpg-sign', '-m', `baton:close ${ctx.ticket.id} ${ctx.leg}`], ctx.checkout);
  try {
    run('git', ['push', 'origin', 'HEAD'], ctx.checkout);
  } catch {
    run('git', ['pull', '--rebase', 'origin', run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], ctx.checkout)], ctx.checkout);
    run('git', ['push', 'origin', 'HEAD'], ctx.checkout);
  }
  return run('git', ['rev-parse', 'HEAD'], ctx.checkout);
}
