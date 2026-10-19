// history.ts — each ticket's history and Baton's disagreements with git (BATON_SPEC §2h R-BTN-81,
// R-BTN-85; R3-1257). The one writer of `ticket_history`: every transaction that changes what it
// records — a leg started, finished or given up, git moving a ticket no claim moved, a regression,
// a block, a decision opened or answered, a discrepancy — calls `record` inside itself. It is a
// running record for people and for replay, never an event-sourced log: nothing is rebuilt from
// it, and git stays the truth. Rows hold names, ids, versions and pointers, never content (R-BTN-33).
import { logEvent } from './db';
import { repositoryOf } from './validate';
import type { Store } from './ports';

/** R-BTN-81: the kinds of row, as §4 lists them. `inputs`, `outputs`, `position-confirmed`,
 *  `position-replaced` and `re-routed` are written by B-38 and B-39; `spawned` by R3-1258. */
export const HISTORY_KINDS = ['leg-started', 'leg-finished', 'leg-abandoned', 'position-confirmed', 'position-replaced', 'git-moved', 'regressed',
  're-routed', 'blocked', 'unblocked', 'decision-opened', 'decision-answered', 'inputs', 'outputs', 'discrepancy', 'spawned'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** R-BTN-85: the cases a discrepancy names, exactly. `position-replaced` and `route-overridden`
 *  arrive with B-38, `spawned-unposted` with R3-1258. */
export const DISCREPANCY_SUBS = ['position-replaced', 'regressed', 'off-graph', 'bars-mismatch', 'foreign-write', 'closed-under-claim',
  'spawned-unposted', 'route-overridden'] as const;
export type DiscrepancySub = (typeof DISCREPANCY_SUBS)[number];

/** R-BTN-81: a row's `detail_json` is at most 2 KB; a larger one is replaced by a note saying so,
 *  never refused — the record must not stop the transaction it rides on. */
export const DETAIL_MAX_BYTES = 2048;
/** R-BTN-81: kept while the ticket is live and 90 days after it closes; the alarm deletes in batches. */
export const KEEP_AFTER_CLOSE_MS = 90 * 86_400_000;
export const PURGE_BATCH = 100;
/** §11: `GET …/history` pages at most 200 rows. */
export const HISTORY_PAGE_MAX = 200;
/** §14: the dashboard's Discrepancies list, the last 7 days, at most this many rows. */
export const DISCREPANCY_WINDOW_MS = 7 * 86_400_000;
const DISCREPANCY_LIST_MAX = 200;

export interface HistoryRow {
  kind: HistoryKind;
  claim_id?: number | null;
  worker_id?: number | null;
  leg?: string | null;
  reached?: string | null;
  next_leg?: string | null;
  run?: number | null;
  snapshot_sha?: string | null;
  head_sha?: string | null;
  course_version?: number | null;
  leg_version?: number | null;
  detail?: Record<string, unknown> | null;
}

/** A row's detail as stored: JSON of at most 2 KB, else a note naming the cut. */
export function detailJson(detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail) return null;
  const text = JSON.stringify(detail);
  return new TextEncoder().encode(text).length <= DETAIL_MAX_BYTES ? text : JSON.stringify({ omitted: `detail over ${DETAIL_MAX_BYTES} bytes` });
}

export class History {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }

  /** Append one row to `ticket`'s history, in the caller's transaction. */
  record(ticket: string, r: HistoryRow) {
    this.c.store.exec(`INSERT INTO ticket_history (repository_id, ticket_id, at, kind, claim_id, worker_id, leg, reached, next_leg, run, snapshot_sha,
                         head_sha, course_version, leg_version, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      repositoryOf(ticket), ticket, this.c.now(), r.kind, r.claim_id ?? null, r.worker_id ?? null, r.leg ?? null, r.reached ?? null, r.next_leg ?? null,
      r.run ?? null, r.snapshot_sha ?? null, r.head_sha ?? null, r.course_version ?? null, r.leg_version ?? null, detailJson(r.detail));
  }

  /**
   * R-BTN-85: an accepted snapshot overrides something Baton holds. Logged — an event and a
   * history row, each `{sub, baton, git, observation}` — in the transaction that adopts git's
   * value, before it does; it never delays or refuses the adoption.
   */
  discrepancy(ticket: string, sub: DiscrepancySub, baton: unknown, git: unknown, observation: number | null, claimId: number | null = null) {
    const detail = { sub, baton, git, observation };
    logEvent(this.c.store, this.c.now(), 'discrepancy', 'sync', detail, ticket, claimId);
    this.record(ticket, { kind: 'discrepancy', claim_id: claimId, detail });
  }

  /** `GET …/tickets/{ticket}/history?before=&limit=` (§11): newest first, paged by id. */
  list(ticket: string, before: number | null, limit: number) {
    const rows = this.rows<{ id: number; at: number; kind: string; claim_id: number | null; worker_id: number | null; leg: string | null; reached: string | null;
      next_leg: string | null; run: number | null; snapshot_sha: string | null; head_sha: string | null; course_version: number | null; leg_version: number | null; detail_json: string | null }>(
      `SELECT id, at, kind, claim_id, worker_id, leg, reached, next_leg, run, snapshot_sha, head_sha, course_version, leg_version, detail_json
       FROM ticket_history WHERE ticket_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`, ticket, before, before, limit + 1);
    const page = rows.slice(0, limit).map(({ detail_json, ...r }) => ({
      id: r.id, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null)), detail: detail_json ? JSON.parse(detail_json) : null,
    }));
    return { rows: page, ...(rows.length > limit ? { next_before: page[page.length - 1].id } : {}) };
  }

  /** The alarm (R-BTN-81): the history of tickets closed more than 90 days ago, a batch at a
   *  time through `closed_unpurged`; each such closure is marked purged so it is never scanned again.
   *  A ticket that came back is not closed (its `closed_tickets` row is deleted when it returns). */
  purge() {
    const cutoff = this.c.now() - KEEP_AFTER_CLOSE_MS;
    const due = this.rows<{ ticket_id: string }>(`SELECT ticket_id FROM closed_tickets WHERE purged_at IS NULL AND closed_at <= ? ORDER BY closed_at LIMIT ?`, cutoff, PURGE_BATCH);
    for (const t of due) {
      this.c.store.exec('DELETE FROM ticket_history WHERE ticket_id = ?', t.ticket_id);
      this.c.store.exec('UPDATE closed_tickets SET purged_at = ? WHERE ticket_id = ?', this.c.now(), t.ticket_id);
    }
    return due.length;
  }

  /** §14 Discrepancies: the last 7 days', newest first, with a count per kind. */
  view(now: number) {
    const rows = this.rows<{ ticket_id: string; claim_id: number | null; at: number; detail_json: string }>(
      `SELECT ticket_id, claim_id, at, detail_json FROM events WHERE kind = 'discrepancy' AND at > ? ORDER BY seq DESC LIMIT ?`, now - DISCREPANCY_WINDOW_MS, DISCREPANCY_LIST_MAX)
      .map((r) => ({ ticket_id: r.ticket_id, claim_id: r.claim_id, at: r.at, ...(JSON.parse(r.detail_json) as { sub: string } & Record<string, unknown>) }));
    // Counted over the whole window, not the capped list.
    const by = Object.fromEntries(this.rows<{ sub: string; n: number }>(
      `SELECT json_extract(detail_json, '$.sub') AS sub, COUNT(*) AS n FROM events WHERE kind = 'discrepancy' AND at > ? GROUP BY sub ORDER BY sub`,
      now - DISCREPANCY_WINDOW_MS).map((r) => [r.sub, r.n]));
    return { by_kind: by, rows };
  }
}
