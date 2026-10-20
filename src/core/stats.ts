// stats.ts — a course's own record (BATON_SPEC §2d "A course can see how it performs", §11
// `GET /v1/repositories/{repository}/stats`; R3-1248): per station and leg how long tickets waited
// and legs ran, claims by end and detail, suspensions by station and what they waited on, advice
// overridden, hook failures, `off-graph` transitions and foreign writes — over a window, for one
// repository. Aggregates and ids only: no worker, no profile, no report (G-BTN-64).
import type { Row, Store } from './ports';
import type { Queues } from './queues';

/** Seconds, summarised: how many, the median and the longest. */
export interface Durations {
  count: number;
  median_s: number | null;
  max_s: number | null;
}

export interface CourseStats {
  repository: string;
  since: number;
  until: number;
  courses: Record<string, {
    /** Per leg: runs started in the window; how long each waited at its `from` station before it
     *  started (from the previous leg's finish in the claim, or the previous claim's end on the
     *  ticket), and how long it ran; and the tickets whose leg is ready and unclaimed now. */
    legs: Record<string, { started: number; finished: number; abandoned: number; waited: Durations; ran: Durations; ready_now: { tickets: number; oldest_s: number | null };
      /** R-BTN-79: the leg's queue now — its unheld tickets queued for it — and its bound. */
      queue: { depth: number; max_queue: number | null } }>;
    /** R-BTN-79: `closed` while any leg is over its `max_queue`. */
    intake: 'open' | 'closed';
    /** Per station: how long a ticket rested there between one claim's end and the next claim. */
    stations: Record<string, { waited: Durations }>;
  }>;
  ends: { end_reason: string; detail: string | null; claims: number }[];
  suspensions: { station: string; detail: string | null; claims: number }[];
  advice_overridden: { count: number; tickets: string[] };
  hook_failures: { hook: string; error: string; count: number }[];
  off_graph: { count: number; tickets: string[] };
  foreign_writes: { count: number; tickets: string[] };
}

/** The default window when `since` is not given: the last 30 days. */
export const STATS_WINDOW_MS = 30 * 86_400_000;
/** At most this many ids per list, newest first. */
const IDS_MAX = 50;

export function durations(ms: number[]): Durations {
  if (!ms.length) return { count: 0, median_s: null, max_s: null };
  const s = [...ms].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { count: s.length, median_s: Math.round(median / 1000), max_s: Math.round(s[s.length - 1] / 1000) };
}

export class Stats {
  /** `queues`: the one reader of `leg_queues` and the intake (R-BTN-79). */
  constructor(private readonly store: Store, private readonly queues?: Queues) {}

  private rows<T = Row>(q: string, ...p: unknown[]): T[] {
    return this.store.exec(q, ...p).toArray() as T[];
  }

  /** The repository's record from `since` to `now`. */
  of(repository: string, since: number, now: number): CourseStats {
    const prefix = `${repository}:`;
    const mine = 'substr(c.ticket_id, 1, length(?)) = ?';
    const courses: CourseStats['courses'] = {};
    const course = (id: string | null) => (courses[id ?? '?'] ??= { legs: {}, intake: 'open', stations: {} });
    const leg = (c: string | null, name: string) =>
      (course(c).legs[name] ??= { started: 0, finished: 0, abandoned: 0, waited: durations([]), ran: durations([]), ready_now: { tickets: 0, oldest_s: null }, queue: { depth: 0, max_queue: null } });
    const samples = new Map<string, number[]>();
    const add = (key: string, ms: number) => {
      const xs = samples.get(key);
      if (xs) xs.push(ms);
      else samples.set(key, [ms]);
    };
    const key = (...parts: (string | null)[]) => parts.map((x) => x ?? '?').join('\u0000');

    // Each claim of the repository with the end of the ticket's previous claim, in one ordered pass
    // (LAG over claims_by_ticket — never a scan per claim, 2-r2-0).
    const history = `SELECT id, ticket_id, course_id, claimed_at, offered_ready_since,
         LAG(ended_at) OVER t AS prev_ended, LAG(station) OVER t AS prev_station
       FROM claims WHERE substr(ticket_id, 1, length(?)) = ?
       WINDOW t AS (PARTITION BY ticket_id ORDER BY claimed_at, id)`;

    // Legs started in the window, each with when it arrived at its `from` station: the claim's
    // previous leg's finish; for a claim's first leg, the later of the ticket's previous claim's
    // end and when the offered leg turned ready (2-r2-2, 3-r3-0) — a leg not yet ready is not waiting.
    const legs = this.rows<{ course_id: string | null; leg: string; started_at: number; finished_at: number | null; abandoned_at: number | null; arrived: number | null }>(
      `WITH c AS (${history}),
            l AS (SELECT claim_id, seq, leg, started_at, finished_at, abandoned_at,
                         LAG(finished_at) OVER (PARTITION BY claim_id ORDER BY seq) AS prev_finished,
                         ROW_NUMBER() OVER (PARTITION BY claim_id ORDER BY seq) AS nth
                  FROM claim_legs WHERE started_at >= ? AND started_at <= ? OR claim_id IN (SELECT claim_id FROM claim_legs WHERE started_at >= ? AND started_at <= ?))
       SELECT c.course_id, l.leg, l.started_at, l.finished_at, l.abandoned_at,
              CASE WHEN l.nth = 1 THEN max(COALESCE(c.prev_ended, c.offered_ready_since), COALESCE(c.offered_ready_since, c.prev_ended)) ELSE l.prev_finished END AS arrived
       FROM l JOIN c ON c.id = l.claim_id
       WHERE l.started_at >= ? AND l.started_at <= ?`, prefix, prefix, since, now, since, now, since, now);
    for (const l of legs) {
      const r = leg(l.course_id, l.leg);
      r.started++;
      if (l.arrived != null) add(key('w', l.course_id, l.leg), Math.max(0, l.started_at - l.arrived));
      if (l.finished_at != null) {
        r.finished++;
        add(key('r', l.course_id, l.leg), l.finished_at - l.started_at);
      }
      if (l.abandoned_at != null) r.abandoned++;
    }

    // Stations: a claim that began in the window, after the ticket's previous claim ended there.
    const claims = this.rows<{ course_id: string | null; claimed_at: number; prev_ended: number; prev_station: string }>(
      `WITH c AS (${history})
       SELECT course_id, claimed_at, prev_ended, prev_station FROM c
       WHERE claimed_at >= ? AND claimed_at <= ? AND prev_ended IS NOT NULL`, prefix, prefix, since, now);
    for (const c of claims) add(key('s', c.course_id, c.prev_station), Math.max(0, c.claimed_at - c.prev_ended));

    for (const [k, ms] of samples) {
      const [kind, c, name] = k.split('\u0000');
      const cid = c === '?' ? null : c;
      if (kind === 'w') leg(cid, name).waited = durations(ms);
      else if (kind === 'r') leg(cid, name).ran = durations(ms);
      else course(cid).stations[name] = { waited: durations(ms) };
    }

    // Queued legs ready now that a claimant could take (2-r2-1), by the candidate query's own
    // conditions (claims.ts candidates): no active or fenced claim, no hold or backoff
    // (rule 3, rule 10), no unconfirmed completion, and a reading since the ticket's last end
    // (§6.7) — each waiting since it turned ready or the ticket's last claim ended, whichever is later.
    const head = this.rows<{ observation: number }>('SELECT observation FROM board_head WHERE repository_id = ?', repository)[0]?.observation ?? 0;
    for (const r of this.rows<{ course_id: string; leg: string; tickets: number; oldest: number | null }>(
      `WITH last AS (SELECT ticket_id, max(ended_at) AS ended_at, max(end_observation) AS end_observation,
                            max(status = 'active' OR (status = 'reaped' AND fence_pending = 1)) AS active, max(status = 'completed' AND confirmed_at IS NULL) AS unconfirmed
                     FROM claims WHERE substr(ticket_id, 1, length(?)) = ? GROUP BY ticket_id)
       SELECT t.course_id, n.leg, count(*) AS tickets, min(max(n.ready_since, COALESCE(last.ended_at, 0))) AS oldest
       FROM ticket_next_legs n JOIN tickets t ON t.id = n.ticket_id
         JOIN ticket_stations s ON s.ticket_id = t.id AND s.next_leg = n.leg
         LEFT JOIN last ON last.ticket_id = t.id
         LEFT JOIN ticket_overrides o ON o.ticket_id = t.id
       WHERE substr(t.id, 1, length(?)) = ? AND n.state = 'ready'
         AND COALESCE(last.active, 0) = 0 AND COALESCE(last.unconfirmed, 0) = 0
         AND (last.end_observation IS NULL OR last.end_observation < ?)
         AND NOT (COALESCE(o.hold, 0) = 1 OR COALESCE(o.retry_after, 0) > ?)
       GROUP BY t.course_id, n.leg`, prefix, prefix, prefix, prefix, head, now)) {
      leg(r.course_id, r.leg).ready_now = { tickets: r.tickets, oldest_s: r.oldest == null ? null : Math.round(Math.max(0, now - r.oldest) / 1000) };
    }

    // Each leg's queue as Baton counts it (R-BTN-79), and the intake it closes — Queues' own reads.
    for (const q of this.queues?.all(repository) ?? []) {
      leg(q.course, q.leg).queue = { depth: q.depth, max_queue: q.max_queue };
      course(q.course).intake = this.queues!.intake(repository, q.course);
    }

    // Ends in the window, by reason and the course's detail; suspensions by station.
    const ends = this.rows<{ end_reason: string; detail: string | null; claims: number }>(
      `SELECT c.end_reason, c.end_detail AS detail, count(*) AS claims FROM claims c
       WHERE ${mine} AND c.ended_at >= ? AND c.ended_at <= ? GROUP BY c.end_reason, c.end_detail ORDER BY claims DESC, c.end_reason, c.end_detail`,
      prefix, prefix, since, now);
    const suspensions = ends.filter((e) => e.end_reason.startsWith('suspended:'))
      .map((e) => ({ station: e.end_reason.slice('suspended:'.length), detail: e.detail, claims: e.claims }));

    // The event log's counts, with the tickets they name.
    const events = (kind: string) => {
      const rows = this.rows<{ ticket_id: string | null }>(
        `SELECT e.ticket_id FROM events e WHERE e.kind = ? AND e.at >= ? AND e.at <= ?
           AND (e.repository_id = ? OR substr(e.ticket_id, 1, length(?)) = ?) ORDER BY e.seq DESC`, kind, since, now, repository, prefix, prefix);
      return { count: rows.length, tickets: [...new Set(rows.map((r) => r.ticket_id).filter((t): t is string => !!t))].slice(0, IDS_MAX) };
    };

    return {
      repository, since, until: now, courses, ends, suspensions,
      advice_overridden: events('advice-overridden'),
      // Baton runs no repository code (hooks retired with R3-1236): nothing can fail.
      hook_failures: [],
      off_graph: events('off-graph'),
      foreign_writes: events('foreign-claim'),
    };
  }
}
