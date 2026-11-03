// tickets-baton.ts — the ticket commands' Baton reads (B-129; R-BTN-179's one-answer rule, §9's
// branch-holder query, R-BTN-81's history): before `baton tickets claim` writes, it asks Baton
// where the ticket stands — the pickup side of the owner's ruling that Baton owns a ticket's
// course history (B-120; R-BTN-35: about what Baton owns, Baton wins and the disagreement is
// logged). One wrong `status: available` line over an open PR (B-91, 2026-10-27) then hands the
// next session Baton's position — the station, the leg it is ready for, the PRs and branches the
// last claim recorded, the live claims that hold it — instead of a fresh start and a second PR.
//
// The reads are the routes that already exist: the board (`GET /v1/repositories/{repo}/board`)
// answers the station, the ready leg and — the field B-129 adds — the repository's live claims
// (`holders`, each with its holder and when its lease ends); the history
// (`GET …/tickets/{ticket}/history`) answers the path and — B-129's other field — the ended
// claims' branches and PRs (`resume`, R-BTN-24's record pruned); and the branch-holder
// query (§9) answers whether a branch the ticket's change lives on is held, asked only when the
// history names a branch. Nothing here reads the forge: Baton must work without it (value 8),
// and the branch-holder query already maps branches to tickets.
//
// An unanswered read is undetermined, never "no record" — a network fault, a missing or
// unreadable key (judged before any request, so a key problem is never reported as Baton
// unreachable) or a `forbidden` is thrown as `Undetermined` naming which, and the claim refuses rather than fall
// through to the frontmatter (the failure this ticket exists to end). The one exception is the
// branch-holder query asked with a key that is not a worker's: an owner's or an administrator's
// key cannot sign worker routes, and the board's `holders` has already answered the ticket's own
// lock, so that one read is skipped, not fatal.
import { readFileSync } from 'node:fs';
import { send } from '../../cli/baton.mjs';
import { signingKey } from '../../cli/sign.mjs';

/** One live claim on a ticket, as the board's `holders` answers it (B-129). */
export interface Holder {
  ticket_id: string;
  worker_id: number;
  hostname: string | null;
  session_name: string | null;
  /** When the holder's lease ends (`reap_at`); null for a claim with none. */
  lease_ends_at: number | null;
}

/** The ticket's ended claims' record as the history's `resume` answers it (R-BTN-24, pruned):
 *  the branches and PRs of every ended claim, newest first, and how the newest ended. */
export interface Resume {
  end_reason: string;
  ended_at: number;
  branches: string[];
  prs: string[];
}

/** A history row, as the read answers it (R-BTN-81) — the fields the claim reads. */
export interface PathRow {
  kind: string;
  leg?: string | null;
  reached?: string | null;
  next_leg?: string | null;
}

/** Where Baton holds a ticket: the claim's whole picture, from three reads. */
export interface BatonPosition {
  /** The board's row for the ticket when it is ready: its station and the leg it is ready for. */
  ready: { station: string; leg: string } | null;
  /** The history's rows, newest first (the path's evidence). */
  rows: PathRow[];
  /** The ended claims' branches and PRs, when a claim ever ended. */
  resume: Resume | null;
  /** The repository's live claims (the lock Baton holds). */
  holders: Holder[];
  /** The branch-holder query's answer for the branch the change lives on, when one was asked:
   *  `unavailable` names a key that cannot sign worker routes — the board's `holders` answered
   *  the ticket's own lock instead. */
  branch: { branch: string; held_by_other: boolean; fence_pending: boolean; tickets: string[] } | { unavailable: string } | null;
  /** Where Baton holds the ticket now: the board's ready row's station when it is ready, else
   *  the newest history row that reached a station; null when neither says. */
  station: string | null;
  /** Whether Baton holds the ticket past its course's `start` — the takeover witness, judged
   *  from the current position (`station`), never from any row the path ever reached: a ticket
   *  moved back to its start is at its start. With no start known (the checkout names no course
   *  file), only a history row witnesses, as the board's row cannot be compared. */
  pastStart: boolean;
  /** The board's `server_time`: the clock a holder's lease is judged against (R-BTN-32 — the
   *  CLI reads no clock of its own for Baton's leases). */
  serverTime: number | null;
}

/** Why a read could not be answered — thrown, never returned: undetermined, not "no record". */
export class Undetermined extends Error {
  constructor(readonly which: string, readonly why: string) {
    super(`${which}: ${why}`);
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** One GET's JSON, refusing the undetermined: a fault names Baton unreachable, a refusal names
 *  its code and message. `tolerate` names the codes a caller answers null for (the
 *  branch-holder query's principal refusals, for a key that is not a worker's). */
async function getJson(o: { url: string; keyFile: string; path: string; which: string; fetchImpl?: typeof fetch }, tolerate: readonly string[] = []): Promise<Record<string, unknown> | null> {
  let answer: { status: number; json: Record<string, unknown> | null; text: string };
  try {
    answer = await send(o.url, { method: 'GET', path: o.path }, o.keyFile, o.fetchImpl) as typeof answer;
  } catch (e) {
    throw new Undetermined(o.which, `Baton at ${o.url} is unreachable (${(e as Error).message})`);
  }
  const code = typeof answer.json?.code === 'string' ? answer.json.code : null;
  if (answer.status >= 200 && answer.status < 300 && answer.json != null) return answer.json;
  if (code && tolerate.includes(code)) return null;
  throw new Undetermined(o.which, code ? `${code} — ${String(answer.json?.message ?? '')}`.trim() : `HTTP ${answer.status}`);
}

/** An API key's shape (R-BTN-159), which `send` sends as a bearer rather than signing with. */
const API_KEY = /^bak_[0-9a-f]{16}_[0-9a-f]{64}$/;

/** The key the reads sign with, judged before any request (B-129): a key that is missing or
 *  that neither parses as an API key nor as an SSH key is the key's problem, never Baton's — so
 *  it is not reported as Baton unreachable. */
export function checkKey(keyFile: string): void {
  let text: string;
  try {
    text = readFileSync(keyFile, 'utf8').trim();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Undetermined('the key', `no key: ${keyFile} does not exist`);
    throw new Undetermined('the key', `key unreadable: ${keyFile} (${(e as Error).message})`);
  }
  if (API_KEY.test(text)) return;
  try {
    signingKey(keyFile);
  } catch (e) {
    throw new Undetermined('the key', `key unreadable: ${(e as Error).message}`);
  }
}

/** Read where Baton holds `ticket` (a local id) in `repository` (Baton's id for it), with
 *  `start` its course's start station when the checkout's course file names one — the takeover
 *  witness needs it only for a ticket whose history is empty. `forgePath` (`owner/name`) is the
 *  branch-holder query's `repo=`. */
export async function readTicketPosition(o: {
  url: string;
  keyFile: string;
  repository: string;
  ticket: string;
  forgePath: string | null;
  start?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<BatonPosition> {
  const full = `${o.repository}:${o.ticket}`;
  checkKey(o.keyFile);
  const board = await getJson({ ...o, which: `the board of ${o.repository}`, path: `/v1/repositories/${encodeURIComponent(o.repository)}/board` }) ?? {};
  const readyRow = (Array.isArray(board.ready) ? (board.ready as Record<string, unknown>[]) : [])
    .find((t) => t.local_id === o.ticket || t.id === full) ?? null;
  const holders = ((Array.isArray(board.holders) ? board.holders : []) as Record<string, unknown>[]).map((h) => ({
    ticket_id: String(h.ticket_id),
    worker_id: Number(h.worker_id),
    hostname: typeof h.hostname === 'string' ? h.hostname : null,
    session_name: typeof h.session_name === 'string' ? h.session_name : null,
    lease_ends_at: typeof h.lease_ends_at === 'number' ? h.lease_ends_at : null,
  }));
  const history = await getJson({ ...o, which: `${full}'s history`, path: `/v1/repositories/${encodeURIComponent(o.repository)}/tickets/${encodeURIComponent(full)}/history?limit=200` }) ?? {};
  const rows = (Array.isArray(history.rows) ? (history.rows as Record<string, unknown>[]) : []).map((r) => ({
    kind: String(r.kind), ...(r.leg != null ? { leg: String(r.leg) } : {}), ...(r.reached != null ? { reached: String(r.reached) } : {}), ...(r.next_leg != null ? { next_leg: String(r.next_leg) } : {}),
  }));
  const rawResume = (history.resume ?? null) as Record<string, unknown> | null;
  const resume = rawResume == null ? null : {
    end_reason: String(rawResume.end_reason ?? 'unknown'),
    ended_at: typeof rawResume.ended_at === 'number' ? rawResume.ended_at : 0,
    branches: strings(rawResume.branches),
    prs: strings(rawResume.prs),
  };
  // The branch-holder query (§9): asked for the branch the change lives on — the history's
  // `resume` names it — with a key that can sign worker routes. A principal refusal names a key
  // that cannot (an owner's); the board's `holders` answered the ticket's own lock.
  let branch: BatonPosition['branch'] = null;
  const first = resume?.branches[0];
  if (first != null && o.forgePath != null) {
    const q = `?repo=${encodeURIComponent(o.forgePath)}&branch=${encodeURIComponent(first.replace(/^refs\/heads\//, ''))}`;
    const b = await getJson({ ...o, which: `the branch-holder query for ${first}`, path: `/v1/runner/branch-holder${q}` }, ['unauthenticated', 'forbidden']);
    branch = b == null
      ? { unavailable: 'the key cannot sign worker routes — the board\'s holders answered the ticket\'s own lock' }
      : { branch: first, held_by_other: b.held_by_other === true, fence_pending: b.fence_pending === true, tickets: strings(b.tickets) };
  }
  const ready = readyRow && typeof readyRow.station === 'string' && typeof readyRow.leg === 'string'
    ? { station: readyRow.station, leg: readyRow.leg }
    : null;
  const reached = rows.find((r) => r.reached != null)?.reached ?? null;
  const station = ready?.station ?? reached;
  const pastStart = o.start != null ? station != null && station !== o.start : reached != null;
  const serverTime = typeof board.server_time === 'number' ? board.server_time : null;
  return { ready, rows, resume, holders, branch, station, pastStart, serverTime };
}

/** The refusal that names a holder (B-129): who holds it and its lease — not ended yet, ended
 *  (judged against Baton's own `server_time`) with the claim awaiting reaping, or none at all
 *  (a legacy claim, reaped at its own deadline). */
export function holderRefusal(id: string, h: { worker_id: number; hostname: string | null; session_name: string | null; lease_ends_at: number | null }, now: number | null): string {
  const who = `${[h.hostname, h.session_name].filter((x): x is string => x != null).join(' · ') || `worker ${h.worker_id}`} (worker ${h.worker_id})`;
  const lease = h.lease_ends_at == null
    ? 'a claim with no lease to end (a legacy claim); it is released, adopted or reaped first'
    : now != null && h.lease_ends_at <= now
      ? `its lease ended ${new Date(h.lease_ends_at).toISOString()} and the claim awaits reaping; it is reaped first`
      : `its lease ends ${new Date(h.lease_ends_at).toISOString()} — its lease has not ended; it is released or reaped first`;
  return `${id} is held by ${who}, ${lease} (Baton's board, B-129)`;
}
