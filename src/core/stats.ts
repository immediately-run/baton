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
    legs: Record<string, { started: number; finished: number; abandoned: number; ran: Durations }>;
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

    // Legs: started in the window; run time is start to finish.
    const legs = this.rows<{ course_id: string | null; leg: string; started_at: number; finished_at: number | null; abandoned_at: number | null }>(
      `SELECT c.course_id, l.leg, l.started_at, l.finished_at, l.abandoned_at FROM claim_legs l JOIN claims c ON c.id = l.claim_id
       WHERE ${mine} AND l.started_at >= ? AND l.started_at <= ?`, prefix, prefix, since, now);
    const ran = new Map<string, number[]>();
    for (const l of legs) {
      const r = (course(l.course_id).legs[l.leg] ??= { started: 0, finished: 0, abandoned: 0, ran: durations([]) });
      r.started++;
      if (l.finished_at != null) {
        r.finished++;
        const k = `${l.course_id ?? '?'}\u0000${l.leg}`;
        ran.set(k, [...(ran.get(k) ?? []), l.finished_at - l.started_at]);
      }
      if (l.abandoned_at != null) r.abandoned++;
    }
    for (const [k, ms] of ran) {
      const [c, leg] = k.split('\u0000');
      course(c === '?' ? null : c).legs[leg].ran = durations(ms);
    }

    // Stations: how long a ticket waited there for a claimant — from a claim's end at a station
    // to the next claim of the same ticket, when that claim began in the window.
    const claims = this.rows<{ ticket_id: string; course_id: string | null; claimed_at: number; ended_at: number | null; station: string }>(
      `SELECT c.ticket_id, c.course_id, c.claimed_at, c.ended_at, c.station FROM claims c WHERE ${mine} ORDER BY c.ticket_id, c.claimed_at, c.id`, prefix, prefix);
    const waited = new Map<string, number[]>();
    for (let i = 1; i < claims.length; i++) {
      const [a, b] = [claims[i - 1], claims[i]];
      if (a.ticket_id !== b.ticket_id || a.ended_at == null || b.claimed_at < since || b.claimed_at > now) continue;
      const k = `${b.course_id ?? '?'}\u0000${a.station}`;
      waited.set(k, [...(waited.get(k) ?? []), Math.max(0, b.claimed_at - a.ended_at)]);
    }
    for (const [k, ms] of waited) {
      const [c, station] = k.split('\u0000');
      course(c === '?' ? null : c).stations[station] = { waited: durations(ms) };
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
      // Core calls no hook yet (R3-1236): nothing has failed.
      hook_failures: [],
      off_graph: events('off-graph'),
      foreign_writes: events('foreign-claim'),
    };
  }
}
