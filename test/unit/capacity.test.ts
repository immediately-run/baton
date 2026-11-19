// capacity.test.ts — R3-1258's unit half of the capacity envelope and the day's usage
// (BATON_SPEC §2.1 R-BTN-2, §2.3 R-BTN-87): the counters count handled requests and written
// rows, reset at 00:00 UTC, and are drawn against the plan's limits; the alarm logs `capacity`
// on a crossing each way and `baton.capacity` stands under Needs you while one is over.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, keyCall, rows, setAdminKeys, setClock, syncCall, tick, withCore, placed } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { ENVELOPE, planLimitsOf, RequestRing, adjustCounts } from '../../src/core/capacity';

const T0 = Date.parse('2026-11-18T12:00:00Z');

let admin: TestKey;
let owner: TestKey;
let git: Git;

const usage = () => withCore((c) => c.capacity.usage());
const capacityEvents = () => rows<{ detail_json: string; at: number }>(`SELECT detail_json, at FROM events WHERE kind = 'capacity' ORDER BY seq`).then((rs) => rs.map((r) => JSON.parse(r.detail_json)));

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] });
  git = new Git().add('A', {}, placed('filed', [], [['implement', 'ready']]));
  expect((await git.post()).status).toBe(200);
});

describe('R-BTN-2: the day\'s usage counters', () => {
  it('count each request the object handles and the rows its transactions write', async () => {
    const before = await usage();
    expect(before.limits).toEqual({ requests: 100_000, rows_written: 100_000 });
    // A read-only request: one handled request, no rows.
    await syncCall('/v1/sync/head');
    const afterRead = await usage();
    expect(afterRead.requests).toBe(before.requests + 1);
    expect(afterRead.rows_written).toBe(before.rows_written);
    // A board post writes rows: its observation and its post — two requests — and their rows.
    await git.post();
    const afterPost = await usage();
    expect(afterPost.requests).toBe(before.requests + 3);
    expect(afterPost.rows_written).toBeGreaterThan(before.rows_written);
  });

  it('reset at 00:00 UTC', async () => {
    await syncCall('/v1/sync/head');
    expect((await usage()).requests).toBeGreaterThan(0);
    // 23:59 the same UTC day, then past midnight.
    await setClock(Date.parse('2026-11-18T23:59:30Z'));
    expect((await usage()).day).toBe('2026-11-18');
    await syncCall('/v1/sync/head');
    const late = await usage();
    await setClock(Date.parse('2026-11-19T00:00:30Z'));
    const next = await usage();
    expect(next.day).toBe('2026-11-19');
    expect(next.requests).toBe(0);
    expect(next.rows_written).toBe(0);
    expect(late.requests).toBeGreaterThan(0);
  });

  it('draw against the plan\'s limits — the Worker var names them, the default is Workers Free\'s', async () => {
    expect(planLimitsOf(undefined)).toEqual({ requests: 100_000, rows_written: 100_000 });
    expect(planLimitsOf('{"requests": 5, "rows_written": 6}')).toEqual({ requests: 5, rows_written: 6 });
    // A malformed var never stops anything: the default stands.
    expect(planLimitsOf('nonsense')).toEqual({ requests: 100_000, rows_written: 100_000 });
    await withCore((c) => {
      (c as unknown as { ports: { config: Record<string, string | undefined> } }).ports.config.BATON_PLAN_LIMITS = '{"requests": 500, "rows_written": 600}';
    });
    expect((await usage()).limits).toEqual({ requests: 500, rows_written: 600 });
    const view = await withCore((c) => c.capacity.view(c.capacityFigures()));
    expect(view.day.limits).toEqual({ requests: 500, rows_written: 600 });
    expect(view.envelope).toEqual(ENVELOPE);
    expect(view.figures.map((f) => f.figure)).toEqual(Object.keys(ENVELOPE));
  });
});

describe('R-BTN-87: crossings and baton.capacity', () => {
  it('a figure crossing 80% upward logs capacity, stands under Needs you while over, and logs again when it falls back', async () => {
    const cap = 4_000; // 80% of the 5,000-ticket envelope, seeded in one statement
    await rows(`WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ${cap})
                 INSERT INTO tickets (id, repository_id, local_id, path, title, requires_clause, operator_only, depends_on, blocked_by, repos, course_id, expedite, tags, status, node, queue, version, key, snapshot_sha, row_hash, parent)
                 SELECT 'docs:K' || i, 'docs', 'K' || i, 'tickets/K' || i || '.mdx', 'K' || i, 'none', 0, '[]', '[]', '[]', 'roadmap-pr', 0, '[]', '', '', '', '', 'tickets/K' || i || '.mdx', '${'a'.repeat(40)}', '${'b'.repeat(64)}', NULL FROM seq`);
    // The maintained count (R-BTN-87) is moved by the write sites; a raw seed answers for
    // itself — materialize would have counted these.
    await withCore((c) => adjustCounts(c.store, { tickets: cap }));
    await tick();
    let events = await capacityEvents();
    // 4002: the envelope's own fixture ticket and the maintained seed's rounding count too.
    expect(events).toContainEqual(expect.objectContaining({ figure: 'live_tickets', crossing: 'upward', envelope: ENVELOPE.live_tickets }));
    let needs = await withCore((c) => c.capacity.needsYou(c.capacityFigures()));
    expect(needs.capacity).toEqual([expect.objectContaining({ figure: 'live_tickets' })]);
    // Another tick while over logs nothing new.
    await tick();
    expect((await capacityEvents()).filter((e) => e.figure === 'live_tickets')).toHaveLength(1);
    // Back under: the fall is logged, and Needs you empties. The raw delete answers for the
    // maintained count, as materialize would.
    await rows('DELETE FROM tickets WHERE local_id LIKE \'K%\'');
    await withCore((c) => adjustCounts(c.store, { tickets: -cap }));
    await tick();
    events = await capacityEvents();
    expect(events.filter((e) => e.figure === 'live_tickets')).toHaveLength(2);
    expect(events[1]).toMatchObject({ crossing: 'back' });
    needs = await withCore((c) => c.capacity.needsYou(c.capacityFigures()));
    expect(needs.capacity).toEqual([]);
  });

  it('the request ring keeps a 5-minute mean and a 5-second burst', () => {
    const ring = new RequestRing();
    const t = (s: number) => T0 + s * 1000;
    for (let s = 0; s < 60; s++) ring.count(t(s));
    ring.count(t(60)); ring.count(t(60)); ring.count(t(61)); ring.count(t(61));
    const rates = ring.rates(t(120));
    // 64 requests over the window the ring holds: a mean below 1/s; the greatest burst in any
    // 5 seconds is the window 57–61 — three one-a-second beats beside the four of the pair.
    expect(rates.requests_per_second).toBeLessThan(1);
    expect(rates.burst_in_5s).toBe(7);
    // A quiet stretch longer than the window: the burst and the mean are both gone.
    const later = ring.rates(t(400));
    expect(later.burst_in_5s).toBe(0);
    expect(later.requests_per_second).toBe(0);
  });
});
