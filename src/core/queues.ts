// queues.ts — legs are queues (BATON_SPEC §2g R-BTN-79; R3-1255). The one writer of `leg_queues`
// and `leg_queue_members`. Leg L's queue, per repository, is the tickets of L's course whose
// queued leg is L (R-BTN-83) and that no claim holds (R-BTN-75). Each ticket is counted in at most
// one queue, and `touch` moves it between two when its queued leg, its course or whether it is
// held changed — in the transaction that changed it — so a depth is counted, never scanned.
//
// A leg's `max_queue` is a warning threshold, never a gate: no ticket is held, refused or
// reordered here. A depth rising above it logs `queue-over` and queues one notice per `owner`
// courier (R-BTN-80), updated in place while the leg stays over and closed once it is back within
// its bound; and a course with any leg over has its intake `closed`, which recommendations read
// (Claims.recommend) as advice.
import { logEvent } from './db';
import type { Graph } from './graph';
import type { Store } from './ports';

/** A course's intake (R-BTN-79): `closed` while any of its legs is over its `max_queue`. */
export type Intake = 'open' | 'closed';

/** The `queue-over` notice's payload (R-BTN-80, §4 `notices.payload_json`). */
export interface QueueOver {
  course: string;
  leg: string;
  depth: number;
  max_queue: number;
  intake: Intake;
}

/** One leg's queue as stats, the dashboard and the fleet view read it. */
export interface LegQueue {
  course: string;
  leg: string;
  depth: number;
  max_queue: number | null;
}

interface QueueRow {
  depth: number;
  max_queue: number | null;
}

/** A `leg_queues` row over its bound, in SQL: the one statement of R-BTN-79's crossing that
 *  every reader shares (`intake`, Notices.registered, Stats). */
export const OVER_SQL = 'max_queue IS NOT NULL AND depth > max_queue';

const over = (r: QueueRow | undefined) => r != null && r.max_queue != null && r.depth > r.max_queue;

export class Queues {
  constructor(private readonly c: {
    store: Store;
    now: () => number;
    /** Whether a claim holds the ticket (R-BTN-75; Blocks.isHeld, the one definition). */
    held: (ticket: string) => boolean;
    /** The repository's course in force (Stations.graph). */
    graph: (repo: string, course: string) => Graph | null;
    /** The `queue-over` notices (Notices): one per `owner` courier, updated in place, closed. */
    notices: { over: (repo: string, ref: string, payload: QueueOver) => void; within: (repo: string, ref: string) => void };
  }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  // ── membership ──────────────────────────────────────────────────────────────────────────

  /**
   * Ticket `id`'s queued leg, course or hold may have changed, in the caller's transaction: it is
   * moved to the queue it now belongs to — none when it left the board, has no queued leg or is
   * held. Called for every ticket a snapshot, a claim's start or end, a confirmation, a fence
   * clearing or a re-route touches (Blocks.evaluate, and the snapshot's deletions).
   */
  touch(id: string) {
    const t = this.rows<{ repository_id: string; course_id: string; next_leg: string | null }>(
      `SELECT t.repository_id, t.course_id, s.next_leg FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.id = ?`, id)[0];
    const want = t?.next_leg != null && !this.c.held(id) ? { repository_id: t.repository_id, course_id: t.course_id, leg: t.next_leg } : null;
    const have = this.rows<{ repository_id: string; course_id: string; leg: string }>(
      'SELECT repository_id, course_id, leg FROM leg_queue_members WHERE ticket_id = ?', id)[0] ?? null;
    if (have && want && have.repository_id === want.repository_id && have.course_id === want.course_id && have.leg === want.leg) return;
    if (have) {
      this.exec('DELETE FROM leg_queue_members WHERE ticket_id = ?', id);
      this.move(have.repository_id, have.course_id, have.leg, -1);
    }
    if (want) {
      this.exec('INSERT INTO leg_queue_members (ticket_id, repository_id, course_id, leg) VALUES (?, ?, ?, ?)', id, want.repository_id, want.course_id, want.leg);
      this.move(want.repository_id, want.course_id, want.leg, +1);
    }
  }

  /**
   * A post was applied with `course` in force (R-BTN-69), in the snapshot's transaction: its tickets
   * whose queued leg it renamed are touched (R-BTN-64), and every leg's bound is judged
   * again — a bound lowered below the depth is a crossing as much as a ticket arriving.
   */
  coursed(repo: string, course: string) {
    for (const m of this.rows<{ ticket_id: string }>(
      `SELECT m.ticket_id FROM leg_queue_members m LEFT JOIN ticket_stations s ON s.ticket_id = m.ticket_id
       WHERE m.repository_id = ? AND m.course_id = ? AND s.next_leg IS NOT m.leg ORDER BY m.ticket_id`, repo, course)) this.touch(m.ticket_id);
    const g = this.c.graph(repo, course);
    for (const r of this.rows<{ leg: string; depth: number; max_queue: number | null }>(
      'SELECT leg, depth, max_queue FROM leg_queues WHERE repository_id = ? AND course_id = ? ORDER BY leg', repo, course)) {
      const bound = g?.legs.get(r.leg)?.maxQueue ?? null;
      if (bound === r.max_queue) continue;
      this.judge(repo, course, r.leg, r, { depth: r.depth, max_queue: bound });
    }
  }

  /** The courses of `repo` in force are `courses`, in the snapshot's transaction: any other's
   *  queues go, and with them its members and its `queue-over` notices (R-BTN-80). A ticket
   *  cannot name a course the registry dropped (the post is refused), so no queued ticket is lost. */
  retain(repo: string, courses: string[]) {
    const keep = JSON.stringify(courses);
    for (const r of this.rows<{ course_id: string; leg: string }>(
      `SELECT course_id, leg FROM leg_queues WHERE repository_id = ? AND course_id NOT IN (SELECT value FROM json_each(?)) ORDER BY course_id, leg`, repo, keep)) {
      this.c.notices.within(repo, `${r.course_id}:${r.leg}`);
    }
    this.exec('DELETE FROM leg_queues WHERE repository_id = ? AND course_id NOT IN (SELECT value FROM json_each(?))', repo, keep);
    this.exec('DELETE FROM leg_queue_members WHERE repository_id = ? AND course_id NOT IN (SELECT value FROM json_each(?))', repo, keep);
  }

  /** Add `delta` to a leg's depth, its row made at the course's bound when it has none. */
  private move(repo: string, course: string, leg: string, delta: number) {
    const before = this.row(repo, course, leg);
    const bound = before ? before.max_queue : this.c.graph(repo, course)?.legs.get(leg)?.maxQueue ?? null;
    const after = { depth: Math.max(0, (before?.depth ?? 0) + delta), max_queue: bound };
    this.judge(repo, course, leg, before, after);
  }

  /** Write a leg's queue and act on what crossed: the leg's bound, and its course's intake. */
  private judge(repo: string, course: string, leg: string, before: QueueRow | undefined, after: QueueRow) {
    const closedBefore = this.intake(repo, course) === 'closed';
    if (after.depth === 0 && after.max_queue == null) {
      this.exec('DELETE FROM leg_queues WHERE repository_id = ? AND course_id = ? AND leg = ?', repo, course, leg);
    } else {
      this.exec(`INSERT INTO leg_queues (repository_id, course_id, leg, depth, max_queue) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (repository_id, course_id, leg) DO UPDATE SET depth = excluded.depth, max_queue = excluded.max_queue`,
        repo, course, leg, after.depth, after.max_queue);
    }
    const intake = this.intake(repo, course);
    const now = this.c.now();
    const ref = `${course}:${leg}`;
    if (over(after)) {
      // Rising above the bound logs once; a leg staying over only updates its notices (R-BTN-79).
      if (!over(before)) logEvent(this.c.store, now, 'queue-over', 'baton', { course, leg, depth: after.depth, max_queue: after.max_queue }, null, null, repo);
      this.c.notices.over(repo, ref, { course, leg, depth: after.depth, max_queue: after.max_queue!, intake });
    } else if (over(before)) {
      this.c.notices.within(repo, ref);
    }
    if (closedBefore !== (intake === 'closed')) {
      logEvent(this.c.store, now, intake === 'closed' ? 'course-closed' : 'course-opened', 'baton', { course }, null, null, repo);
      // The intake is in every over leg's notice: the other legs' notices say so too.
      for (const o of this.legs(repo, course)) {
        if (o.leg !== leg && over(o)) this.c.notices.over(repo, `${course}:${o.leg}`, { course, leg: o.leg, depth: o.depth, max_queue: o.max_queue!, intake });
      }
    }
  }

  private row(repo: string, course: string, leg: string): QueueRow | undefined {
    return this.rows<QueueRow>('SELECT depth, max_queue FROM leg_queues WHERE repository_id = ? AND course_id = ? AND leg = ?', repo, course, leg)[0];
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  /** A course's intake: `closed` while any of its legs is over its bound (R-BTN-79). */
  intake(repo: string, course: string): Intake {
    return this.rows(`SELECT 1 FROM leg_queues WHERE repository_id = ? AND course_id = ? AND ${OVER_SQL} LIMIT 1`,
      repo, course).length ? 'closed' : 'open';
  }

  /** A course's queues, by leg; a leg with no row has depth 0 and is not listed. */
  legs(repo: string, course: string): LegQueue[] {
    return this.rows<LegQueue>(`SELECT course_id AS course, leg, depth, max_queue FROM leg_queues WHERE repository_id = ? AND course_id = ? ORDER BY leg`, repo, course);
  }

  /** Every queue of a repository (stats, the dashboard, R3-1269's fleet view). */
  all(repo: string): LegQueue[] {
    return this.rows<LegQueue>(`SELECT course_id AS course, leg, depth, max_queue FROM leg_queues WHERE repository_id = ? ORDER BY course_id, leg`, repo);
  }
}
