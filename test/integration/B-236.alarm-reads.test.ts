// B-236 — the alarm reads tens of rows, not tables (BATON_SPEC §3's one alarm, §13's indexes).
// Production passed Cloudflare's 5,000,000 rows_read/day on 2026-11-14: a tick read 0.8–1.3k
// rows, scanning `claims` for pending fences, `ticket_next_legs` for the 72-hour stall and
// `runners` for the live set — tables that only grow. On a production-sized state (180 tickets,
// ~700 ended claims, 300 reaped runner sessions, 3,000 events, 600 snapshots, 300 purged
// tickets) every statement a tick runs is captured from the store and explained: none scans a
// growing table, and the named lookups search their index. On the Cloudflare host the tick's
// rows_read (`SqlStorageCursor.rowsRead`) is at most 100. The liveness rewrite (`last_seen_at +
// lease_timeout_ms > now`, R-BTN-9 and R-BTN-19's fencing) is S-BTN-2's and the alarm-reaper
// scenarios'; the two edges of the lease are checked here too. Runs on both hosts.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Git, HOST, cutover, register, rows, setClock, tick, withCore } from '../helpers';
import type { Ports } from '../../src/core/ports';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const H = 3_600_000;
const DAY = 24 * H;
const TICKETS = 180;

type Captured = { sql: string; params: unknown[]; cursor: { rowsRead?: number } };

/** Every statement `fn` runs, with its cursor. */
async function capture(fn: () => Promise<unknown>): Promise<Captured[]> {
  const log: Captured[] = [];
  await withCore((c) => {
    const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b236?: (q: string, ...p: unknown[]) => unknown };
    s.__b236 ??= s.exec;
    const orig = s.__b236;
    s.exec = (q: string, ...p: unknown[]) => {
      const cursor = orig.call(s, q, ...p) as Captured['cursor'];
      log.push({ sql: q, params: p, cursor });
      return cursor;
    };
  });
  try {
    await fn();
    return log;
  } finally {
    await withCore((c) => {
      const s = c.store as unknown as { exec: unknown; __b236?: unknown };
      if (s.__b236) s.exec = s.__b236;
    });
  }
}

const plan = async (sql: string, params: unknown[]) =>
  (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)).map((r) => r.detail);

/** The tables that grow with time; a full scan of one is what this ticket removes. */
const GROWING = ['claims', 'runners', 'events', 'ticket_next_legs', 'ticket_stations', 'messages', 'board_snapshots', 'closed_tickets',
  'claim_legs', 'activities', 'ticket_decisions', 'runner_capabilities', 'transcripts'];

/** The claims, runner sessions, events, snapshots and closures of a few months' work. */
async function productionSized(runnerId: number) {
  const seq = (n: number) => `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ${n})`;
  // 600 released and 100 confirmed claims, spread over the tickets; 3 reaped whose fences cleared.
  await rows(`${seq(600)} INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason)
              SELECT 'docs:T-' || (i % ${TICKETS} + 1), ?, 'seed-r-' || i, 'abc123', '', ? + i, 'released', ? + i + 1000, 'released:abandoned' FROM k`,
  runnerId, T0 - 30 * DAY, T0 - 30 * DAY);
  await rows(`${seq(100)} INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason, ended_at_sha, confirmed_at)
              SELECT 'docs:T-' || (i % ${TICKETS} + 1), ?, 'seed-c-' || i, 'abc123', '', ? + i, 'completed', ? + i + 1000, 'completed:merged', 'aa', ? + i + 2000 FROM k`,
  runnerId, T0 - 20 * DAY, T0 - 20 * DAY, T0 - 20 * DAY);
  await rows(`${seq(3)} INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason, fence_pending)
              SELECT 'docs:T-' || i, ?, 'seed-f-' || i, 'abc123', '', ? + i, 'reaped', ? + i + 1000, 'reaped:silent', 0 FROM k`, runnerId, T0 - 10 * DAY, T0 - 10 * DAY);
  // 300 earlier sessions of the runner, reaped (R-BTN-3 keeps their rows).
  const cols = (await rows<{ name: string; pk: number }>(`PRAGMA table_info(runners)`)).filter((c) => !c.pk).map((c) => c.name);
  const sel = cols.map((c) => (c === 'session_name' ? `session_name || '-' || i` : c === 'secret_hash' ? `secret_hash || i` : c === 'reaped_at' ? `${T0 - 2 * DAY}`
    : c === 'last_seen_at' ? `${T0 - 3 * DAY} + i` : c)).join(', ');
  await rows(`${seq(300)} INSERT INTO runners (${cols.join(', ')}) SELECT ${sel} FROM runners, k WHERE runners.id = ?`, runnerId);
  // 3,000 events of the last weeks; 600 snapshots; 300 tickets closed and purged long ago.
  await rows(`${seq(3000)} INSERT INTO events (at, kind, actor, detail_json, ticket_id, repository_id) SELECT ? + i * 1000, 'claimed', 'test', '{}', 'docs:T-1', 'docs' FROM k`, T0 - 20 * DAY);
  await rows(`${seq(600)} INSERT INTO board_snapshots (repository_id, sha, parent_sha, received_at, ticket_count) SELECT 'docs', printf('%040x', 100000 + i), NULL, ? + i, ${TICKETS} FROM k`, T0 - 20 * DAY);
  await rows(`${seq(300)} INSERT INTO closed_tickets (ticket_id, closed_as, observation, closed_at, purged_at) SELECT 'docs:C-' || i, 'done', 1, ?, ? FROM k`, T0 - 200 * DAY, T0 - 100 * DAY);
  // Half the tickets' queued legs posted waiting for an hour; five waiting four days — stalled.
  await rows(`UPDATE ticket_next_legs SET state = 'waiting', waiting_on = 'findings', ready_since = NULL, waiting_since = ?
              WHERE CAST(substr(ticket_id, 8) AS INTEGER) % 2 = 0`, T0 - H);
  await rows(`UPDATE ticket_next_legs SET waiting_since = ? WHERE ticket_id IN ('docs:T-2', 'docs:T-4', 'docs:T-6', 'docs:T-8', 'docs:T-10')`, T0 - 4 * DAY);
}

let runner: { id: number; secret: string };

type Scheduler = { get(): Promise<number | null>; set(at: number): Promise<void> };
let scheduler: Scheduler | null = null;

/** Only the ticks the test runs: the fake clock sits behind the real one, so every alarm the core
 *  arms is overdue and the host would run it beside the measured tick. The armed one is moved an
 *  hour past the real clock and the core arms nothing more until the test ends. */
async function quietAlarm() {
  await withCore(async (c) => {
    const ports = (c as unknown as { ports: { scheduler: Scheduler } }).ports;
    scheduler ??= ports.scheduler;
    await scheduler.set(Date.now() + H);
    ports.scheduler = { get: async () => Date.now() + H, set: async () => {} };
  });
}

afterEach(async () => {
  await withCore((c) => {
    if (scheduler) (c as unknown as { ports: { scheduler: Scheduler } }).ports.scheduler = scheduler;
    (c as unknown as { ports: Ports }).ports.archiveEvents = undefined;
  });
  scheduler = null;
});

beforeEach(async () => {
  await setClock(T0);
  await quietAlarm();
  const git = new Git();
  for (let i = 1; i <= TICKETS; i++) git.add(`T-${i}`, { rank: i });
  expect((await git.post()).status).toBe(200);
  await cutover();
  runner = await register('vm-a');
  await productionSized(runner.id);
  // Exercise the event lookup with an opted-in archive and a caught-up mirror.
  await withCore((c) => {
    (c as unknown as { ports: Ports }).ports.archiveEvents = async () => {
      throw new Error('no events should be old enough to archive');
    };
    c.store.exec(`UPDATE repositories SET mirror_acked_seq = (SELECT MAX(seq) FROM events) WHERE id = 'docs'`);
  });
  // The first ticks do their one-off work: the stalled five are raised, the live set recounted.
  await setClock(T0 + 60_000);
  await tick();
  await setClock(T0 + 120_000);
  await tick();
});

describe('B-236 the alarm reads through indexes', () => {
  it('no statement of a tick scans a growing table, and the named lookups search their index', async () => {
    expect((await rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ticket_decisions WHERE decision_id = 'baton:stalled'`))[0].n).toBe(5);
    await setClock(T0 + 180_000);
    const log = await capture(() => tick());
    const partial = new Set((await rows<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE '% WHERE %'`)).map((r) => r.name));
    const used = new Set<string>();
    for (const { sql, params } of log) {
      if (!/^\s*(SELECT|UPDATE|DELETE|INSERT|WITH)/i.test(sql)) continue;
      const detail = await plan(sql, params);
      for (const d of detail) for (const m of d.matchAll(/USING (?:COVERING )?INDEX (\w+)/g)) used.add(m[1]);
      // `SCAN <table or alias>[ USING …]`: a whole table or index read — but a partial index's
      // rows are only those its WHERE keeps (the active claims, the pending fences).
      const scans = detail.filter((d) => {
        const m = /^SCAN (\w+)(?: USING (?:COVERING )?INDEX (\w+))?/.exec(d);
        return m != null && GROWING.includes(aliasOf(sql, m[1])) && !(m[2] && partial.has(m[2]));
      });
      expect(scans, `${sql}\n${detail.join('\n')}`).toEqual([]);
    }
    for (const index of ['claims_fence_pending', 'claims_deadline', 'runners_live', 'next_legs_waiting_since', 'messages_by_status',
      'events_retention', 'board_snapshots_received', 'runners_last_seen', 'closed_claims_due']) {
      expect([...used], index).toContain(index);
    }
  });

  it.runIf(HOST === 'cloudflare')("a tick's rows_read is at most 100 on a production-sized state", async () => {
    await setClock(T0 + 180_000);
    const log = await capture(() => tick());
    const read = log.reduce((n, l) => n + (l.cursor.rowsRead ?? 0), 0);
    const top = log.filter((l) => (l.cursor.rowsRead ?? 0) > 0).map((l) => `${l.cursor.rowsRead} ${l.sql.replace(/\s+/g, ' ').slice(0, 220)}`);
    expect(read, top.join('\n')).toBeLessThanOrEqual(100);
  });

  it('the live set is the lease to the millisecond (R-BTN-9): live while last_seen_at + lease > now', async () => {
    const lease = (await rows<{ seen: number; lease: number }>('SELECT last_seen_at AS seen, lease_timeout_ms AS lease FROM runners WHERE id = ?', runner.id))[0];
    const live = async (at: number) => (await rows<{ id: number }>(
      `SELECT id FROM runners WHERE reaped_at IS NULL AND last_seen_at + lease_timeout_ms > ? ORDER BY id`, at)).map((r) => r.id);
    expect(await live(lease.seen + lease.lease - 1)).toEqual([runner.id]);
    expect(await live(lease.seen + lease.lease)).toEqual([]);
    expect(await plan(`SELECT id FROM runners WHERE reaped_at IS NULL AND last_seen_at + lease_timeout_ms > ?`, [0]))
      .toEqual([expect.stringMatching(/^SEARCH runners USING INDEX runners_live \(<expr>>\?\)$/)]);
  });

  it("the dashboard's and the runner calls' claim and runner lookups search their index", async () => {
    // As src/core/claims.ts (needsYou, timeline) and src/core/runnerApi.ts write them.
    const cases: [string, unknown[], string, boolean?][] = [
      [`SELECT id, ticket_id, runner_id, ended_at FROM claims WHERE status = 'reaped' AND fence_pending = 1 ORDER BY ended_at`, [], 'claims_fence_pending'],
      [`SELECT id, ticket_id, runner_id, ended_at, end_reason, ended_at_sha FROM claims
        WHERE status = 'completed' AND confirmed_at IS NULL AND ended_at <= ? ORDER BY ended_at`, [T0], 'claims_unconfirmed_by_end'],
      [`SELECT id, reaped_at FROM runners WHERE credential_id = ? AND secret_hash = ?`, ['x', 'y'], 'runners_by_secret'],
      // B-250 pinned the lanes read to the live set's index: 0063's name-ordered
      // `runners_by_hostname` would otherwise walk every runner ever registered.
      [`SELECT id, hostname, session_name FROM runners INDEXED BY runners_live WHERE reaped_at IS NULL AND last_seen_at + lease_timeout_ms > ? ORDER BY hostname, id`, [T0], 'runners_live', true],
    ];
    for (const [sql, params, index, sorts] of cases) {
      const detail = await plan(sql, params);
      // A search of the index, or a walk of all of a partial one (the pending fences, in order).
      expect(detail.some((d) => new RegExp(`^(SEARCH|SCAN) \\w+ USING (COVERING )?INDEX ${index}\\b`).test(d)), `${sql}\n${detail.join('\n')}`).toBe(true);
      // The live lanes are sorted by name: a sort of the few live rows, not of the table.
      expect(detail.filter((d) => /^SCAN \w+$/.test(d) || (!sorts && /TEMP B-TREE FOR ORDER BY/.test(d))), `${sql}\n${detail.join('\n')}`).toEqual([]);
    }
  });
});

/** The table a query's alias names (`FROM claims c` → `claims`). */
function aliasOf(sql: string, alias: string): string {
  const m = new RegExp(`\\b(?:FROM|JOIN)\\s+"?(\\w+)"?\\s+(?:AS\\s+)?${alias}\\b`, 'i').exec(sql);
  return m ? m[1] : alias;
}
