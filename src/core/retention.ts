// retention.ts — R-BTN-149's retention (BATON_SPEC §2; B-238): the alarm's prunes of what Baton
// would otherwise keep forever. Each tick deletes at most `RETENTION_BATCH` rows, oldest first:
//   1. repository `events` older than 90 days below every live mirror's `mirror_acked_seq`;
//   2. `board_snapshots` older than 90 days, never a repository's head;
//   3. the capability, tag and course rows of runners unseen for 30 days — the runner rows stay
//      (R-BTN-3);
//   4. the claims of tickets whose history R-BTN-81 purged, with their legs, activities and the
//      rows that hang off them — a claim an event, a condition or a scope finding still names
//      waits for it, so its events go first (step 1).
// Every step finds its rows through an index (0053) and reads a row or two when there is nothing
// to delete: the retention must not cost more than it saves (B-238).
import { HELD_CLAIMS_SQL } from './blocks';
import type { Store } from './ports';

/** B-238: the rows one tick deletes, at most, across the steps. */
export const RETENTION_BATCH = 1000;
const DAY_MS = 86_400_000;
/** R-BTN-149: repository events and board snapshots are kept 90 days. */
export const EVENTS_KEEP_MS = 90 * DAY_MS;
export const SNAPSHOTS_KEEP_MS = 90 * DAY_MS;
/** R-BTN-149: a runner unseen this long loses its capability, tag and course rows. */
export const RUNNER_UNSEEN_MS = 30 * DAY_MS;
/** A purged ticket whose claims could not all go yet is tried again this much later. */
const CLAIMS_RETRY_MS = DAY_MS;
/** `baton_settings` key: the last runner (`[last_seen_at, id]`) whose dependents went. A runner
 *  seen again moves past it, so it is pruned again when it next falls silent. */
const RUNNERS_CURSOR = 'retention_runners';
/** The rows a claim's prune deletes before the claim, children first. */
const CLAIM_ROWS = ['leg_run_inputs', 'claim_legs', 'activities', 'transcripts', 'claim_seats', 'adoptions'] as const;

export interface Ctx {
  store: Store;
  now: () => number;
}

export interface Pruned {
  events: number;
  snapshots: number;
  runner_rows: number;
  claims: number;
}

export class Retention {
  constructor(private readonly c: Ctx) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }

  /** The alarm's share: one batch across the four steps, in order. */
  prune(batch = RETENTION_BATCH): Pruned {
    const now = this.c.now();
    let left = batch;
    const events = this.events(now, left);
    left -= events;
    const snapshots = left > 0 ? this.snapshots(now, left) : 0;
    left -= snapshots;
    const runner_rows = left > 0 ? this.runners(now, left) : 0;
    left -= runner_rows;
    const claims = left > 0 ? this.claims(now, left) : 0;
    return { events, snapshots, runner_rows, claims };
  }

  /** The lowest acknowledged cursor among the live repositories with a mirror (a workflow or a
   *  mirror key), or null when none has one. A retired repository's mirror holds back nothing. */
  private mirrorBound(): number | null {
    return this.rows<{ b: number | null }>(
      `SELECT MIN(r.mirror_acked_seq) AS b FROM repositories r WHERE r.retired_at IS NULL
         AND (r.mirror_workflow IS NOT NULL
              OR EXISTS (SELECT 1 FROM sync_keys k WHERE k.repository_id = r.id AND k.role = 'mirror' AND k.revoked_at IS NULL))`)[0]?.b ?? null;
  }

  /** Step 1, through `events_retention`. The oldest old event is read first: none, or one a
   *  mirror has not acknowledged, ends the step at one row. Otherwise at most `n` index rows are
   *  read, oldest first, and those below the bound go. */
  private events(now: number, n: number): number {
    const cutoff = now - EVENTS_KEEP_MS;
    const bound = this.mirrorBound() ?? Number.MAX_SAFE_INTEGER;
    const front = this.rows<{ seq: number }>(`SELECT seq FROM events WHERE repository_id IS NOT NULL AND at < ? ORDER BY at LIMIT 1`, cutoff)[0];
    if (!front || front.seq >= bound) return 0;
    return this.rows(
      `DELETE FROM events WHERE seq IN (SELECT seq FROM (SELECT seq FROM events WHERE repository_id IS NOT NULL AND at < ? ORDER BY at LIMIT ?) WHERE seq < ?)
       RETURNING seq`, cutoff, n, bound).length;
  }

  /** Step 2, through `board_snapshots_received`: a head's snapshot is skipped, never deleted. */
  private snapshots(now: number, n: number): number {
    return this.rows(
      `DELETE FROM board_snapshots WHERE rowid IN (
         SELECT s.rowid FROM board_snapshots s WHERE s.received_at < ?
           AND NOT EXISTS (SELECT 1 FROM board_head h WHERE h.repository_id = s.repository_id AND h.sha = s.sha)
         ORDER BY s.received_at LIMIT ?)
       RETURNING sha`, now - SNAPSHOTS_KEEP_MS, n).length;
  }

  /** Step 3, through `runners_last_seen`, from the cursor: the runners that fell silent since the
   *  last prune, oldest first, each one's rows deleted whole. */
  private runners(now: number, n: number): number {
    const raw = this.rows<{ value: string }>('SELECT value FROM baton_settings WHERE key = ?', RUNNERS_CURSOR)[0]?.value;
    let [at, id] = raw ? (JSON.parse(raw) as [number, number]) : [-1, 0];
    let deleted = 0;
    const due = this.rows<{ id: number; last_seen_at: number }>(
      `SELECT id, last_seen_at FROM runners WHERE last_seen_at >= ? AND last_seen_at < ? AND NOT (last_seen_at = ? AND id <= ?)
       ORDER BY last_seen_at, id LIMIT ?`, at, now - RUNNER_UNSEEN_MS, at, id, n);
    for (const w of due) {
      if (deleted >= n) break;
      for (const t of ['runner_capabilities', 'runner_tags', 'runner_courses']) deleted += this.rows(`DELETE FROM ${t} WHERE runner_id = ? RETURNING runner_id`, w.id).length;
      [at, id] = [w.last_seen_at, w.id];
    }
    if (due.length) {
      this.c.store.exec(`INSERT INTO baton_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, RUNNERS_CURSOR, JSON.stringify([at, id]));
    }
    return deleted;
  }

  /** Step 4, through `closed_claims_due`: a purged ticket's ended claims that nothing else names
   *  go with their rows; a ticket with one left is tried again a day later, one with none is done. */
  private claims(now: number, n: number): number {
    let deleted = 0;
    const due = this.rows<{ ticket_id: string }>(
      `SELECT ticket_id FROM closed_tickets WHERE claims_due_at IS NOT NULL AND claims_due_at <= ? ORDER BY claims_due_at LIMIT ?`, now, n);
    for (const t of due) {
      if (deleted >= n) break;
      const claims = this.rows<{ id: number; free: number }>(
        `SELECT c.id, NOT ${HELD_CLAIMS_SQL}
                 AND NOT EXISTS (SELECT 1 FROM events e WHERE e.claim_id = c.id)
                 AND NOT EXISTS (SELECT 1 FROM conditions k WHERE k.claim_id = c.id)
                 AND NOT EXISTS (SELECT 1 FROM scope_findings f WHERE f.claim_id = c.id) AS free
         FROM claims c WHERE c.ticket_id = ? ORDER BY c.id`, t.ticket_id);
      let held = 0;
      let stopped = false;
      for (const c of claims) {
        if (!c.free) {
          held++;
          continue;
        }
        // The batch spent: the ticket stays due, and the next tick goes on with it.
        if (deleted >= n) {
          stopped = true;
          break;
        }
        for (const table of CLAIM_ROWS) deleted += this.rows(`DELETE FROM ${table} WHERE claim_id = ? RETURNING claim_id`, c.id).length;
        deleted += this.rows('DELETE FROM claims WHERE id = ? RETURNING id', c.id).length;
      }
      if (!stopped) this.c.store.exec('UPDATE closed_tickets SET claims_due_at = ? WHERE ticket_id = ?', held ? now + CLAIMS_RETRY_MS : null, t.ticket_id);
    }
    return deleted;
  }
}
