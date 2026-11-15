// B-235 — the dashboard's event lookups read their window, not the event log (BATON_SPEC §13's
// indexes, §14's Needs you and Discrepancies). `GET /v1/ui/state` reads the recent
// `bars-mismatch`, `unsigned-control` and `discrepancy` events; the event log is never pruned,
// so a lookup that scans it costs every event on every poll (production passed Cloudflare's
// 5,000,000 rows_read/day on 2026-11-14). Each lookup the state answer runs is captured from the
// store and explained: it searches an index, scans no table and sorts nothing, and the served
// lists keep the log's order. On the Cloudflare host the lookups' rows_read
// (`SqlStorageCursor.rowsRead`) stays the same while the log grows. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, HOST, adminSession, cutover, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const H = 3_600_000;

/** `applyControl`'s prior-notice read (src/core/baton.ts): run only by a post onto unsigned
 *  control inputs of a repository that requires them signed, so it is explained as written. */
const PRIOR_NOTICES = `SELECT detail_json FROM events WHERE kind = 'unsigned-control' AND repository_id = ? AND at > ? ORDER BY at DESC, seq DESC LIMIT 100`;

type Captured = { sql: string; params: unknown[]; cursor: { rowsRead?: number } };

/** The statements over `events` one state answer runs, with their cursors. */
async function stateLookups(session: string): Promise<{ state: Record<string, any>; lookups: Captured[] }> {
  const log: Captured[] = [];
  await withCore((c) => {
    const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b235?: (q: string, ...p: unknown[]) => unknown };
    s.__b235 ??= s.exec;
    const orig = s.__b235;
    s.exec = (q: string, ...p: unknown[]) => {
      const cursor = orig.call(s, q, ...p) as Captured['cursor'];
      if (/\bFROM events\b/.test(q)) log.push({ sql: q, params: p, cursor });
      return cursor;
    };
  });
  try {
    const res = await sessionCall(session, '/v1/ui/state');
    expect(res.status).toBe(200);
    return { state: (await res.json()) as Record<string, any>, lookups: log };
  } finally {
    await withCore((c) => {
      const s = c.store as unknown as { exec: unknown; __b235?: unknown };
      if (s.__b235) s.exec = s.__b235;
    });
  }
}

const plan = async (sql: string, params: unknown[]) =>
  (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)).map((r) => r.detail);

/** `n` events of `kind` at `at`, one statement. */
const fill = (n: number, kind: string, at: number, detail: string) => rows(
  `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
   INSERT INTO events (at, kind, actor, detail_json, repository_id) SELECT ?, ?, 'test', ?, 'docs' FROM k`, n, at, kind, detail);

const event = (at: number, kind: string, detail: unknown, ticket: string | null = null) =>
  rows(`INSERT INTO events (at, kind, actor, detail_json, ticket_id, repository_id) VALUES (?, ?, 'test', ?, ?, 'docs')`, at, kind, JSON.stringify(detail), ticket);

let admin: TestKey;
let session: string;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  await new Git().add('T-1').post();
  await cutover();
  session = await adminSession(admin);
  // The window's own events — two at one instant each, so the order rests on `seq` too — and
  // older ones of the same kinds, outside every window.
  for (const [i, at] of [T0 - 2 * H, T0 - H, T0 - H, T0 - 1].entries()) {
    await event(at, 'bars-mismatch', { leg: 'review', n: i }, 'docs:T-1');
    await event(at, 'unsigned-control', { sha: `s${i}`, changes: [] });
    await event(at, 'discrepancy', { sub: i % 2 ? 'regressed' : 'off-graph', n: i }, 'docs:T-1');
  }
  for (const kind of ['bars-mismatch', 'unsigned-control', 'discrepancy']) await fill(200, kind, T0 - 30 * 86_400_000, '{"sub":"regressed"}');
  // The log's bulk: events of other kinds, inside the windows.
  await fill(2000, 'claimed', T0 - H, '{}');
});

describe('B-235 the state answer reads its event windows through an index', () => {
  it('every event lookup searches an index, scans no table and sorts nothing', async () => {
    const { lookups } = await stateLookups(session);
    const kinds = lookups.map((l) => /kind = '([a-z-]+)'/.exec(l.sql)?.[1]);
    expect(kinds).toEqual(expect.arrayContaining(['bars-mismatch', 'unsigned-control', 'discrepancy']));
    expect(kinds.filter((k) => k === 'discrepancy')).toHaveLength(2);
    const plans: [string, unknown[]][] = [...lookups.map((l): [string, unknown[]] => [l.sql, l.params]), [PRIOR_NOTICES, ['docs', T0 - 7 * 86_400_000]]];
    for (const [sql, params] of plans) {
      const detail = await plan(sql, params);
      expect(detail.some((d) => /^SEARCH \w+ USING (COVERING )?INDEX events_/.test(d)), `${sql}\n${detail.join('\n')}`).toBe(true);
      expect(detail.filter((d) => /^SCAN /.test(d) || /TEMP B-TREE FOR ORDER BY/.test(d)), `${sql}\n${detail.join('\n')}`).toEqual([]);
    }
  });

  it('serves the same rows in the log order', async () => {
    const { state } = await stateLookups(session);
    const bySeq = <T,>(kind: string, since: number, dir: 'ASC' | 'DESC') =>
      rows<T>(`SELECT at, detail_json FROM events WHERE kind = ? AND at > ? ORDER BY seq ${dir}`, kind, since);
    const bars = await bySeq<{ detail_json: string }>('bars-mismatch', T0 - 24 * H, 'ASC');
    expect(bars).toHaveLength(4);
    expect(state.needs_you.bars_mismatch.map((b: { detail_json: string }) => b.detail_json)).toEqual(bars.map((b) => b.detail_json));
    const unsigned = await bySeq<{ detail_json: string }>('unsigned-control', T0 - 7 * 86_400_000, 'DESC');
    expect(state.needs_you.unsigned_control.map((u: { sha: string }) => u.sha)).toEqual(unsigned.map((u) => JSON.parse(u.detail_json).sha));
    expect(state.needs_you.unsigned_control.map((u: { sha: string }) => u.sha)).toEqual(['s3', 's2', 's1', 's0']);
    const disc = await bySeq<{ detail_json: string }>('discrepancy', T0 - 7 * 86_400_000, 'DESC');
    expect(state.discrepancies.rows.map((d: { n: number }) => d.n)).toEqual(disc.map((d) => JSON.parse(d.detail_json).n));
    expect(state.discrepancies.rows.map((d: { n: number }) => d.n)).toEqual([3, 2, 1, 0]);
    expect(state.discrepancies.by_kind).toEqual({ 'off-graph': 2, regressed: 2 });
  });

  it.runIf(HOST === 'cloudflare')("the lookups' rows_read stays at their windows while the log grows", async () => {
    const read = (ls: Captured[]) => ls.reduce((n, l) => n + (l.cursor.rowsRead ?? 0), 0);
    const before = read((await stateLookups(session)).lookups);
    await fill(5000, 'advanced', T0 - H, '{}');
    await fill(1000, 'discrepancy', T0 - 30 * 86_400_000, '{"sub":"regressed"}');
    const after = read((await stateLookups(session)).lookups);
    // Four rows per window, each list read twice at most (the discrepancy list and its count),
    // against ~7,600 events before and ~13,600 after — a scan read ~3× the log.
    expect(before).toBeLessThanOrEqual(40);
    expect(after).toBe(before);
  });
});
