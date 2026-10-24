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
  /** B-86 item 1: what this key's grant allows, as the heartbeat's answer and the board both
   *  give it, or null when it is granted no repository. */
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
 *  every leg a queue names though the file omits it (no clause to check, then = nothing required,
 *  so any declaration meets it). */
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
 *  gate refuses: no course on the repository; no leg of the course with a queue; and a
 *  declaration that matches none of the course's legs' clauses. The declaration is checked first
 *  and unconditionally: whether tickets happen to be ready now is not part of "can never claim",
 *  and a ready ticket on a leg this runner cannot take is exactly the idling B-86 names.
 *  `fromFlag` says the declaration is `--capabilities`' (a narrowing), so only then is dropping it
 *  advised. */
export function neverClaimable(input: {
  repository: string;
  board: BoardView;
  course: string;
  /** The course's legs, queued or not, each with its `requires` clause ('' for none). */
  legs: { leg: string; requires: string }[];
  declared: string[];
  /** Whether the declaration came from `--capabilities` rather than the grant's own. */
  fromFlag?: boolean;
}): string | null {
  const { repository, board, course, declared } = input;
  const holds = capabilitiesOf(declared);
  const fits = input.legs.filter((l) => l.requires.split(',').map((x) => x.trim()).filter(Boolean).every((c) => holds.has(c)));
  const missing = [...new Set(input.legs.flatMap((l) => l.requires.split(',').map((x) => x.trim()).filter((c) => c && !holds.has(c))))];
  const adds = own(declared);
  if (input.legs.length && !fits.length) {
    const clauses = input.legs.map((l) => `${l.leg} requires ${l.requires || 'nothing'}`).join('; ');
    return `it declares ${declared.join(', ') || 'nothing'}, so no leg of ${course} on ${repository} can ever match (${clauses})`
      + `${missing.length ? `: it needs ${missing.join(', ')}` : ''}`
      + `${input.fromFlag && adds.length ? ` — --capabilities ${adds.join(',')} narrows the credential's capabilities, so drop the flag to declare what the grant allows (B-86)` : ''}`;
  }
  const courses = (board.repository?.courses ?? []).map((c) => c.id);
  if (courses.length && !courses.includes(course)) {
    return `${repository} runs ${courses.join(', ')}, not ${course}: this runner declares the course it can never be handed a claim on`;
  }
  if (!input.legs.length) return `${repository} runs no leg of ${course} with a queue: its tickets never reach a runner`;
  return null;
}

// ── startup: the declaration and the one line (B-86 items 1 and 3, off B-90's board) ─────────

/** What a runner discovers before its first claim: the declaration it will start with and why
 *  it can never claim. */
export interface Startup {
  /** The capabilities the first heartbeat declares: `--capabilities`', the grant's (which the
   *  board names), or null when neither could be read — then the heartbeat's own answer settles
   *  it, and the standing venue is the fallback. */
  declare: string[] | null;
  /** The one startup line, when the runner can never claim; null otherwise. */
  line: string | null;
}

/** The refusals that are a definitive answer — Baton heard the runner and said it may not read
 *  the board — as against a transient `unavailable` or an older server's `not-found`. */
const DEFINITIVE = ['forbidden', 'unauthenticated'];

/** B-86 item 3, off `baton board`'s answer (B-90): a runner whose declaration can match none of
 *  its course's legs says why in one line at startup instead of idling in silence — and one
 *  with no `--capabilities` starts by declaring what its grant allows (B-86 item 1), the board
 *  naming it for a key granted on the repository. A board Baton refuses a granted key is said
 *  in Baton's own words, never as a verdict of ineligibility; an ungranted key's, a transient
 *  failure's or an older server's answers nothing, and the heartbeat settles the declaration
 *  from its own answer. Never fatal: a fault in the caller's `clauses` is no line at all.
 *
 *  Pure of node: the runner's entry calls it, and the hosted typecheck and the integration
 *  host read it too (`api` is structural — its `boardView`, and its refusal by shape). */
export async function startup(
  api: { boardView: (repository: string) => Promise<Record<string, any>> },
  a: { repository: string; capabilities: string[] | null }, course: string,
  clauses: (board: BoardView) => { leg: string; requires: string }[],
): Promise<Startup> {
  const read = await boardFor(api, a);
  // The line is a fact about the declaration, and a declaration still unread says nothing.
  if (read.board == null) return { declare: read.declare, line: read.line };
  let why: string | null = null;
  try {
    why = neverClaimable({ repository: a.repository, board: read.board, course, legs: clauses(read.board), declared: read.declare ?? ['agent-venue'], fromFlag: a.capabilities !== null });
  } catch {
    why = null;
  }
  return { declare: read.declare, line: why ? `baton: this runner can never claim: ${why}` : null };
}

/** The board, and the declaration it settles: only the fetch is guarded, so no fault in the
 *  caller's part can pass for a transport failure. */
async function boardFor(
  api: { boardView: (repository: string) => Promise<Record<string, any>> }, a: { repository: string; capabilities: string[] | null },
): Promise<{ board: BoardView | null; declare: string[] | null; line: string | null }> {
  const narrow = a.capabilities !== null;
  let board: BoardView;
  try {
    board = (await api.boardView(a.repository)) as BoardView;
  } catch (e) {
    const flag = narrow ? a.capabilities : null;
    // A refusal the API threw (`BatonRefusal`: a `code` string and an HTTP `status`); anything
    // else is a transport failure.
    const refusal = e as { code?: unknown; message?: unknown; status?: unknown };
    if (typeof refusal?.code !== 'string' || typeof refusal.status !== 'number' || !DEFINITIVE.includes(refusal.code)) return { board: null, declare: flag, line: null };
    const message = typeof refusal.message === 'string' ? refusal.message : '';
    // A means key reaches every repository for claims and reads no board (grantedRepos' null):
    // the board is no reason to say it can never claim.
    if (!narrow && /not granted on/.test(message)) return { board: null, declare: null, line: null };
    return { board: null, declare: flag, line: `baton: Baton refused the board of ${a.repository} (${refusal.code}: ${message}), so this runner cannot say why it would never claim` };
  }
  // B-86 item 1: no flag declares the grant's capabilities, which its board names. An ungranted
  // key, or an older server whose board names none, leaves it to the heartbeat's own answer.
  if (narrow) return { board, declare: a.capabilities, line: null };
  const granted = board.granted_capabilities ?? null;
  return { board, declare: granted?.length ? granted : null, line: null };
}
