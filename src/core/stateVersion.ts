// stateVersion.ts — R-BTN-196 / B-287: aggregate, scheduling and screen versions move in
// the source write's transaction. Telemetry moves the aggregate/activity versions without
// expiring idle decisions. Unknown writes invalidate conservatively. Liveness and nonces
// remain unversioned; time-dependent reads add a deadline or clock bucket.
import { sha256HexSync } from './policy';
import type { Cursor, Row, Store } from './ports';

/** The tables whose writes are bookkeeping, never state a reader keys on: the request nonces
 *  (R-BTN-13, a replay guard), the migration ledger and deprecated-field sightings (the audit
 *  event still invalidates activity reads). */
const UNVERSIONED = new Set(['request_nonces', '_baton_migrations', 'state_version', 'sync_fingerprints', 'deprecated_fields']);

const kinds = new Map<string, { write: boolean; table: string | null }>();
/** Whether `query` may write, and the table it names first — read once per statement text. */
export function statementKind(query: string): { write: boolean; table: string | null } {
  let k = kinds.get(query);
  if (!k) {
    const head = /^\s*(\w+)/.exec(query)?.[1]?.toUpperCase() ?? '';
    const write = head === 'WITH' ? /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query) : !['SELECT', 'VALUES', 'EXPLAIN', 'PRAGMA'].includes(head);
    const table = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?(\w+)/i.exec(query)?.[1] ?? null;
    k = { write, table };
    if (kinds.size < 4096) kinds.set(query, k);
  }
  return k;
}

export interface VersionedStore extends Store {
  /** The counter now: one row read. 0 before the migration that creates it has run. */
  version(): number;
  schedulingVersion(): number;
  readVersion(activity: boolean): string;
  /** Observation bookkeeping still changes dashboard state, but not scheduling. */
  nonScheduling<T>(fn: () => T): T;
  /** Run `fn` with its writes not moving the counter — liveness writes only (see the header). */
  liveness<T>(fn: () => T): T;
  /** Start counting (after the migrations: the table exists from 0054 on). */
  track(): void;
  /** R-BTN-2 (R3-1258): the rows the statements since the last take wrote — the cursor's
   *  `rowsWritten`, or one for a statement whose host cannot say. The request's tail reads it
   *  into the day's usage counter, outside `liveness` so the counter's own writes never count. */
  takeWritten(): number;
}

/** A drained write's rows, with the host's counts kept for whoever measures them. */
function cursorOf<T>(rows: T[], from: { rowsRead?: number; rowsWritten?: number }): Cursor<T> & { rowsRead?: number } {
  return {
    rowsRead: from.rowsRead,
    rowsWritten: from.rowsWritten,
    toArray: () => rows,
    one: () => {
      if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
      return rows[0];
    },
  };
}

/** The host's Store, counting writes into `state_version`. */
export function versionedStore(inner: Store): VersionedStore {
  let tracking = false;
  let depth = 0;
  let dirty = false;
  let schedulingDirty = false;
  let boardDirty = false;
  let activityDirty = false;
  let schedulingQuiet = 0;
  let quiet = 0;
  // R-BTN-2: the rows written since the last `takeWritten()` — the day's usage counter's source.
  let written = 0;
  // Through `self`, so read/write measurements include the version update.
  const bump = () => {
    self.exec('UPDATE state_version SET v = v + 1, scheduling_v = scheduling_v + ?, board_v = board_v + ?, activity_v = activity_v + ? WHERE id = 1', Number(schedulingDirty), Number(boardDirty), Number(activityDirty));
  };
  const activityTables = new Set(['activities', 'transcripts', 'pending_transcripts', 'messages', 'events', 'ticket_history']);
  const nonSchedulingTables = new Set([...activityTables, 'board_snapshots', 'push_deliveries', 'webhook_deliveries', 'webhook_dispatch', 'webhook_syncs', 'sequences']);
  const reset = () => { dirty = schedulingDirty = boardDirty = activityDirty = false; };
  const wrote = (rows: number, table: string | null = null) => {
    if (!tracking || quiet || rows <= 0) return;
    written += rows;
    const activity = table != null && activityTables.has(table);
    activityDirty ||= activity;
    boardDirty ||= !activity;
    schedulingDirty ||= !schedulingQuiet && !(table && nonSchedulingTables.has(table));
    dirty = true;
    if (depth === 0) { bump(); reset(); }
  };
  const self: VersionedStore = {
    exec<T = Row>(query: string, ...params: unknown[]): Cursor<T> {
      const kind = tracking && !quiet ? statementKind(query) : null;
      if (!kind?.write || (kind.table && UNVERSIONED.has(kind.table))) return inner.exec<T>(query, ...params);
      const cur = inner.exec<T>(query, ...params);
      // A write's cursor is drained here (its RETURNING rows kept), so its count is final.
      const rows = cur.toArray();
      const counts = cur as { rowsRead?: number; rowsWritten?: number };
      // B-237: a host that cannot say counts as a change; one that says zero changed nothing.
      wrote(counts.rowsWritten == null ? 1 : counts.rowsWritten > 0 ? counts.rowsWritten : 0, kind.table);
      return cursorOf(rows, counts);
    },
    script(sql: string): void {
      inner.script(sql);
      wrote(1);
    },
    transaction<T>(fn: () => T): T {
      const before = { dirty, schedulingDirty, boardDirty, activityDirty, written };
      try {
        return inner.transaction(() => {
          const outer = depth++ === 0;
          try {
            const out = fn();
            if (outer && dirty) bump();
            if (outer) reset();
            return out;
          } finally { depth--; }
        });
      } catch (e) {
        // A rolled-back savepoint must not dirty its parent or leave a cache at a future version.
        ({ dirty, schedulingDirty, boardDirty, activityDirty, written } = before);
        throw e;
      }
    },
    schedulingVersion(): number {
      if (!tracking) return 0;
      return (self.exec<{ v: number }>('SELECT scheduling_v AS v FROM state_version WHERE id = 1').toArray()[0]?.v ?? 0) + Number(schedulingDirty);
    },
    readVersion(activity: boolean): string {
      const v = self.exec<{ board_v: number; activity_v: number }>('SELECT board_v, activity_v FROM state_version WHERE id = 1').one();
      return activity ? `${v.board_v}:${v.activity_v}` : String(v.board_v);
    },
    nonScheduling<T>(fn: () => T): T {
      schedulingQuiet++;
      try { return fn(); } finally { schedulingQuiet--; }
    },
    version(): number {
      if (!tracking) return 0;
      return self.exec<{ v: number }>('SELECT v FROM state_version WHERE id = 1').toArray()[0]?.v ?? 0;
    },
    liveness<T>(fn: () => T): T {
      quiet++;
      try {
        return fn();
      } finally {
        quiet--;
      }
    },
    track(): void {
      tracking = true;
    },
    takeWritten(): number {
      const n = written;
      written = 0;
      return n;
    },
  };
  return self;
}

/** `store.liveness(fn)` where the store counts versions; `fn()` on a bare host store. */
export function liveness<T>(store: Store, fn: () => T): T {
  const s = store as Partial<VersionedStore>;
  return typeof s.liveness === 'function' ? s.liveness(fn) : fn();
}

/** B-242's helper: the state version a reader keys on (0 on a bare host store). */
export function stateVersion(store: Store): number {
  const s = store as Partial<VersionedStore>;
  return typeof s.version === 'function' ? s.version() : 0;
}

// ── B-242: the ETag of a read that polls (§11.4, §14's conventions; B-205) ───────────────

/** B-242: how long a poller may be answered `304` on the clock's own motion. Liveness writes
 *  no version (above), yet what the clock decides — alive, stalled, `reap_at`, a time window —
 *  still has to refresh, so an ETag whose read shows any of it folds in the coarse bucket its
 *  instant falls in. Five minutes, comfortably above §11.4's poll cap: the dashboard polls
 *  every 10 s backing off to at most 60, and the bucket must outlast the interval — a bucket
 *  at the cap lands every backed-off poll in the bucket after its tag's, a full read each
 *  time and the `304` never taken — so keep this above whatever the poller's interval caps at.
 *  What the clock decides then lags at most a bucket, a third of the 15 minutes a lease is
 *  never under (§8's R-BTN-9) — far inside the scale it decides. */
export const CLOCK_BUCKET_MS = 300_000;

/** The bucket `at` falls in — the ETag's clock half (B-242). */
export const clockBucket = (at: number): number => Math.floor(at / CLOCK_BUCKET_MS);

/** B-242 (R-BTN-196): the strong ETag of a read that polls — the state version, the caller,
 *  what is read, and — where the answer shows anything the clock decides — the coarse bucket,
 *  hashed (SHA-256, as the policy hashes: synchronous, on either host). Built before the read
 *  runs, so it never depends on the body it saves and a poll whose `If-None-Match` names it is
 *  answered `304` having read one row, the version's. The caller and the subject are inputs,
 *  so one caller's `304` is never another's and one read's never its neighbour's. B-205's
 *  reads hash theirs the same way, through here. */
export function stateEtag(store: Store, caller: string, subject: string, bucket: number | null = null, activity = true): string {
  return `"${sha256HexSync([activity ? stateVersion(store) : boardVersion(store), caller, subject, bucket].join('\u0000'))}"`;
}

/** B-287: the version a read that shows no activity row hashes — every write but those to the
 *  activity tables (activities, transcripts, messages, events, ticket history) moves it, so a
 *  busy runner's reports leave such a read's tag standing. The whole version where the store
 *  tracks none. */
function boardVersion(store: Store): string | number {
  const s = store as Partial<VersionedStore>;
  return typeof s.readVersion === 'function' ? `b${s.readVersion(false)}` : stateVersion(store);
}

/** B-242: whether `req`'s `If-None-Match` names `etag` — the strong tag itself, or its weak
 *  spelling (`W/`, as a poller may echo one); a list matches on any member. `*` matches
 *  nothing: it asks whether the resource exists, not whether this caller holds today's answer,
 *  and anything else serves the full state as it always did. */
export function ifNoneMatch(req: Request, etag: string): boolean {
  const sent = req.headers.get('If-None-Match');
  if (sent == null) return false;
  return sent.split(',').some((one) => one.trim().replace(/^W\//, '') === etag);
}

/** Scheduling changes include advice, permissions and runner declarations, never telemetry. */
export function schedulingVersion(store: Store): number {
  const s = store as Partial<VersionedStore>;
  return typeof s.schedulingVersion === 'function' ? s.schedulingVersion() : 0;
}
export function nonScheduling<T>(store: Store, fn: () => T): T {
  const s = store as Partial<VersionedStore>;
  return typeof s.nonScheduling === 'function' ? s.nonScheduling(fn) : fn();
}
