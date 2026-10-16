// stats.ts — a course's own record (BATON_SPEC §2d "A course can see how it performs", §11
// `GET /v1/repositories/{repository}/stats`; R3-1248): per station and leg how long tickets waited
// and legs ran, claims by end and detail, suspensions by station and what they waited on, advice
// overridden, hook failures, `off-graph` transitions and foreign writes — over a window, for one
// repository. Aggregates and ids only: no worker, no profile, no report (G-BTN-64).
import type { Row, Store } from './ports';

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
    legs: Record<string, { started: number; finished: number; abandoned: number; waited: Durations; ran: Durations; ready_now: { tickets: number; oldest_s: number | null } }>;
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
  constructor(private readonly store: Store) {}

  private rows<T = Row>(q: string, ...p: unknown[]): T[] {
    return this.store.exec(q, ...p).toArray() as T[];
  }

  /** The repository's record from `since` to `now`. */
  of(repository: string, since: number, now: number): CourseStats {
    const prefix = `${repository}:`;
    const mine = 'substr(c.ticket_id, 1, length(?)) = ?';
    const courses: CourseStats['courses'] = {};
    const course = (id: string | null) => (courses[id ?? '?'] ??= { legs: {}, stations: {} });
    const leg = (c: string | null, name: string) =>
      (course(c).legs[name] ??= { started: 0, finished: 0, abandoned: 0, waited: durations([]), ran: durations([]), ready_now: { tickets: 0, oldest_s: null } });
    const samples = new Map<string, number[]>();
    const add = (key: string, ms: number) => {
      const xs = samples.get(key);
      if (xs) xs.push(ms);
      else samples.set(key, [ms]);
    };
    const key = (...parts: (string | null)[]) => parts.map((x) => x ?? '?').join('\u0000');

    // Legs started in the window, each with when it arrived at its `from` station: the claim's
    // previous leg's finish, or — for a claim's first leg — the end of the ticket's previous claim.
    const legs = this.rows<{ course_id: string | null; leg: string; started_at: number; finished_at: number | null; abandoned_at: number | null; arrived: number | null }>(
      `SELECT c.course_id, l.leg, l.started_at, l.finished_at, l.abandoned_at,
              COALESCE((SELECT p.finished_at FROM claim_legs p WHERE p.claim_id = l.claim_id AND p.seq < l.seq ORDER BY p.seq DESC LIMIT 1),
                       CASE WHEN l.seq = (SELECT min(f.seq) FROM claim_legs f WHERE f.claim_id = l.claim_id)
                            THEN (SELECT max(e.ended_at) FROM claims e WHERE e.ticket_id = c.ticket_id AND e.id <> c.id AND e.ended_at <= l.started_at) END) AS arrived
       FROM claim_legs l JOIN claims c ON c.id = l.claim_id
       WHERE ${mine} AND l.started_at >= ? AND l.started_at <= ?`, prefix, prefix, since, now);
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
      `SELECT * FROM (
         SELECT c.course_id, c.claimed_at,
                (SELECT p.ended_at FROM claims p WHERE p.ticket_id = c.ticket_id AND p.ended_at <= c.claimed_at AND p.id <> c.id ORDER BY p.ended_at DESC, p.id DESC LIMIT 1) AS prev_ended,
                (SELECT p.station FROM claims p WHERE p.ticket_id = c.ticket_id AND p.ended_at <= c.claimed_at AND p.id <> c.id ORDER BY p.ended_at DESC, p.id DESC LIMIT 1) AS prev_station
         FROM claims c WHERE ${mine} AND c.claimed_at >= ? AND c.claimed_at <= ?)
       WHERE prev_ended IS NOT NULL`, prefix, prefix, since, now);
    for (const c of claims) add(key('s', c.course_id, c.prev_station), Math.max(0, c.claimed_at - c.prev_ended));

    for (const [k, ms] of samples) {
      const [kind, c, name] = k.split('\u0000');
      const cid = c === '?' ? null : c;
      if (kind === 'w') leg(cid, name).waited = durations(ms);
      else if (kind === 'r') leg(cid, name).ran = durations(ms);
      else course(cid).stations[name] = { waited: durations(ms) };
    }

    // Legs ready now and not yet claimed: how many tickets, and the oldest wait.
    for (const r of this.rows<{ course_id: string; leg: string; tickets: number; oldest: number | null }>(
      `SELECT t.course_id, n.leg, count(*) AS tickets, min(n.ready_since) AS oldest FROM ticket_next_legs n JOIN tickets t ON t.id = n.ticket_id
       WHERE substr(t.id, 1, length(?)) = ? AND n.state = 'ready'
         AND NOT EXISTS (SELECT 1 FROM claims a WHERE a.ticket_id = t.id AND a.status = 'active')
       GROUP BY t.course_id, n.leg`, prefix, prefix)) {
      leg(r.course_id, r.leg).ready_now = { tickets: r.tickets, oldest_s: r.oldest == null ? null : Math.round(Math.max(0, now - r.oldest) / 1000) };
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
