// eligibility.ts — why a runner can never claim, said in one line at startup (B-86 item 3, off
// `baton board`'s answer, B-90). A runner that declares a capability no course's legs require,
// or no course at all, is offered nothing and would idle in silence; this reads the board the
// way the gate reads it — each leg's `requires` clause against the runner's expanded declaration
// (§7.2 rule 4, src/shared/vocabulary.mjs `capabilitiesOf`) — and names the gap. Pure: no network.
import { capabilitiesOf } from '../shared/vocabulary.mjs';

/** The board's answer (`GET /v1/repositories/{repository}/board`, B-90), as much as it takes. */
export interface BoardView {
  repository?: { id?: string; courses?: { id?: string; intake?: string; queues?: { leg: string; depth?: number }[] }[] };
  ready?: { id: string; local_id?: string; title?: string; station?: string; leg?: string }[];
  /** B-90: each course's `course.json` legs — the legs the board's queues never show (nothing
   *  queued on them) keep their clauses. */
  course_files?: Record<string, { legs?: Record<string, LegClause> } | null>;
  /** The heartbeat's answer (B-86 item 1): what this key's grant allows, or null when it is granted
   *  no repository. */
  granted_capabilities?: string[] | null;
}

/** The course file's leg, as far as the board's answer names it. */
export interface LegClause {
  from?: string[];
  requires?: string | string[];
}

/** The declared capabilities that are not the standing venue: what a runner adds of its own. */
const own = (declared: string[]): string[] => declared.filter((c) => c !== 'agent-venue' && c !== 'none');

/** Each of a course's legs with its `requires` clause: the course's own `course.json` legs, and
 *  every leg a queue names though the file omits it (no clause to check, then). */
export function legClauses(course: { legs?: Record<string, LegClause> } | null | undefined, queues: { leg: string }[]): { leg: string; requires: string }[] {
  const file = course?.legs ?? {};
  const names = [...new Set([...Object.keys(file), ...queues.map((q) => q.leg)])];
  return names.map((leg) => {
    const r = file[leg]?.requires;
    return { leg, requires: (Array.isArray(r) ? r.join(',') : r ?? '').toString() };
  });
}

/** Why a runner can never claim, from its board's answer, its course's legs and what it
 *  declares — or null when the board shows it work it can take. Three answers, in the order the
 *  gate refuses: no course on the repository; no ready ticket to take now; and the startup
 *  line's own — a declaration that matches none of the course's legs' clauses. */
export function neverClaimable(input: {
  repository: string;
  board: BoardView;
  course: string;
  /** The course's legs its queues say are live, each with its `requires` clause ('' for none). */
  legs: { leg: string; requires: string }[];
  declared: string[];
}): string | null {
  const { repository, board, course, declared } = input;
  const courses = (board.repository?.courses ?? []).map((c) => c.id);
  if (courses.length && !courses.includes(course)) {
    return `${repository} runs ${courses.join(', ')}, not ${course}: this runner declares the course it can never be handed a claim on`;
  }
  if (!input.legs.length) return `${repository} runs no leg of ${course} with a queue: its tickets never reach a runner`;
  if ((board.ready ?? []).length) return null;
  const holds = capabilitiesOf(declared);
  const fits = input.legs.filter((l) => l.requires.split(',').map((x) => x.trim()).filter(Boolean).every((c) => holds.has(c)));
  if (fits.length) return null;
  const clauses = input.legs.map((l) => `${l.leg} requires ${l.requires || 'nothing'}`).join('; ');
  const missing = [...new Set(input.legs.flatMap((l) => l.requires.split(',').map((x) => x.trim()).filter((c) => c && !holds.has(c))))];
  const adds = own(declared);
  return `it declares ${declared.join(', ') || 'nothing'}, so no leg of ${course} on ${repository} can ever match (${clauses})`
    + `${missing.length ? `: it needs ${missing.join(', ')}` : ''}`
    + `${adds.length ? ` — --capabilities ${adds.join(',')} narrows the credential's capabilities, so drop the flag to declare what the grant allows (B-86)` : ''}`;
}
