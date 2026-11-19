// B-237 — recommendations and the claim read lazily, and an idle runner's beat costs about
// nothing (BATON_SPEC §7.2 R-BTN-61, §6.13 R-BTN-72, §3 R-BTN-196). Production passed
// Cloudflare's 5,000,000 rows_read/day on 2026-11-14 and 15: each idle runner's beat (every
// 2 minutes) read ~3.7k rows recommending and ~4k refusing its claim. Must hold:
//   1. the answers are the ones gating every candidate gives (`claims.reference`, the reading
//      before B-237) — the same tickets in the same order for every limit, the same `next`, the
//      same refusals — over two groups, owner bars that only the gate sees, a full expedite
//      lane, a stale course and an idle board;
//   2. `state_version` moves with a write, not with a steady heartbeat or a call's liveness;
//   3. an idle runner's "nothing eligible" is memoised: a write, a heartbeat changing what it
//      declares, or a passing clock deadline (an owner bar ending, a backoff lapsing) ends it;
//   4. on the Cloudflare host, an idle beat's recommendations and refused claim read at most
//      ~50 rows (`SqlStorageCursor.rowsRead`) on a production-sized state.
// Runs on both hosts (the rows_read case on Cloudflare only).
import { describe, it, expect, beforeEach } from 'vitest';
import chore from '../fixtures/courses/chore/course.json';
import { HOST, Git, beat, claimItem, course, cutover, placed, register, rows, seedClaim, setClock, withCore, runnerCall } from '../helpers';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const M = 60_000;
const ROADMAP = { repository: 'docs', course: 'roadmap-pr', version: 3 };
const CHORE = { repository: 'docs', course: 'chore', version: 1 };
const AT_PR_OPEN = () => placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]);

/** A deterministic sequence, so a scenario is the same board on both hosts and every run. */
function lcg(seed: number) {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

const reference = (on: boolean) => withCore((c) => { c.claims.reference = on; });
const version = () => withCore((c) => c.stateVersion());

async function recs(secret: string, limit = 10, cred: 'vm-a' | 'mac' = 'vm-a'): Promise<string[]> {
  const res = await runnerCall(`/v1/runner/recommendations?limit=${limit}`, { cred, secret });
  const body = (await res.json()) as { recommendations: { ticket_id: string }[] };
  expect(res.status).toBe(200);
  return body.recommendations.map((r) => r.ticket_id);
}

/** Every answer a runner can get without claiming: each limit's full recommendation list, and
 *  `next` (the claim's own decision). */
async function answers(secret: string) {
  const out: Record<string, unknown> = {};
  for (const limit of [1, 2, 3, 5, 10, 25, 50]) {
    const res = await runnerCall(`/v1/runner/recommendations?limit=${limit}`, { secret });
    out[`limit=${limit}`] = { status: res.status, body: await res.json() };
  }
  const next = await runnerCall('/v1/runner/next', { secret });
  out.next = { status: next.status, body: await next.json() };
  return out;
}

/** The answers now, read lazily, and as gating every candidate reads them: equal. */
async function same(secret: string) {
  await reference(true);
  const before = await answers(secret);
  await reference(false);
  const after = await answers(secret);
  // Twice: the second reading may come from the idle memo.
  const again = await answers(secret);
  expect(after).toEqual(before);
  expect(again).toEqual(before);
  return after as Record<string, { status: number; body: any }>;
}

const bar = (course: string, tag: string, legs: string[], startsAt: number, endsAt: number | null) => rows(
  `INSERT INTO owner_bars (repository_id, course, tag, legs, applies, starts_at, ends_at, reason, set_by)
   VALUES ('docs', ?, ?, ?, 'claim', ?, ?, 'b-237', 'admin:test')`, course, tag, JSON.stringify(legs), startsAt, endsAt);

beforeEach(async () => {
  await setClock(T0);
});

// Each case reads every limit three times over 130 tickets: more than the default 5 s on a busy host.
describe('B-237 the lazy reading answers as gating every candidate does', { timeout: 60_000 }, () => {
  let git: Git;
  let w: { id: number; secret: string };

  beforeEach(async () => {
    git = new Git();
    git.registry = [course(), course(1, 1, { id: 'chore', skill: 'chore', course: chore, step_kinds: ['other'] })];
    const r = lcg(237);
    // Two groups past one page of 50 each: ranks with ties and gaps, some expedited, a fifth at
    // pr-open whose `review` an owner bar may bar (rule 8, which only the gate reads).
    for (let i = 1; i <= 70; i++) {
      const rank = r() < 0.1 ? null : Math.floor(r() * 40);
      git.add(`R-${i}`, { rank, expedite: r() < 0.15 }, r() < 0.2 ? AT_PR_OPEN() : undefined);
    }
    for (let i = 1; i <= 60; i++) git.add(`C-${i}`, { course_id: 'chore', rank: Math.floor(r() * 30), expedite: r() < 0.1 }, placed('open', [], [['do', 'ready']]));
    expect((await git.post()).status).toBe(200);
    await cutover();
    w = await register('vm-a', { tags: ['x'], courses: [ROADMAP, CHORE] });
  });

  it('two groups: every limit and next', async () => {
    const a = await same(w.secret);
    expect(a['limit=50'].body.recommendations).toHaveLength(50);
    expect(a['limit=10'].body.recommendations.map((x: { ticket_id: string }) => x.ticket_id).some((t: string) => t.startsWith('docs:C-'))).toBe(true);
  });

  it('an owner bar only the gate sees, on a subset of each page', async () => {
    await bar('roadmap-pr', 'x', ['review'], T0 - M, null);
    await same(w.secret);
    // And on most of the board, so the groups read their next pages.
    await bar('chore', 'x', [], T0 - M, null);
    const a = await same(w.secret);
    expect(a['limit=50'].body.recommendations.length).toBeGreaterThan(0);
  });

  it('a full expedite lane re-sorts each group', async () => {
    const expedited = [...git.tickets.values()].filter((t) => t.expedite).map((t) => `docs:${t.id as string}`);
    const b = await register('vm-b');
    const t = await register('test');
    await seedClaim(b.id, expedited[0], T0);
    await seedClaim(t.id, expedited[1], T0);
    const a = await same(w.secret);
    expect(a['limit=10'].body.recommendations.some((x: { flags: string[] }) => x.flags.includes('expedite-bound'))).toBe(true);
    await bar('roadmap-pr', 'x', ['review'], T0 - M, null);
    await same(w.secret);
  });

  it('a stale course, then an idle board: the same refusals', async () => {
    expect((await beat('vm-a', w.secret, { tags: ['x'], courses: [ROADMAP, { ...CHORE, version: 0 }] })).status).toBe(200);
    await same(w.secret);
    // Rule 8 on every roadmap-pr leg: only the stale chore group is left — `stale-skills`.
    await bar('roadmap-pr', 'x', [], T0 - M, null);
    const stale = await same(w.secret);
    expect(stale.next.body).toMatchObject({ code: 'stale-skills' });
    for (const ref of [true, false, false]) {
      await reference(ref);
      expect((await claimItem('vm-a', w.secret)).json).toMatchObject({ code: 'stale-skills', rule: 9 });
    }
    // And on every course: nothing eligible.
    await bar('*', 'x', [], T0 - M, null);
    const idle = await same(w.secret);
    expect(idle.next.body).toMatchObject({ code: 'no-eligible-ticket' });
    expect(idle['limit=10'].body).toEqual({ recommendations: [] });
  });
});

describe('B-237 the state version and the idle memo (R-BTN-196)', () => {
  let git: Git;
  let w: { id: number; secret: string };

  beforeEach(async () => {
    git = new Git();
    for (let i = 1; i <= 5; i++) git.add(`T-${i}`, { rank: i, requires: ['human-operator'] });
    expect((await git.post()).status).toBe(200);
    await cutover();
    w = await register('vm-a', { tags: ['x'] });
  });

  it('moves with a write, not with a steady heartbeat or a call', async () => {
    // The first beat presenting the secret is a change (`secret_seen`); the next ones are not.
    expect((await beat('vm-a', w.secret, { tags: ['x'] })).status).toBe(200);
    const v0 = await version();
    expect(v0).toBeGreaterThan(0);
    await setClock(T0 + M);
    expect((await beat('vm-a', w.secret, { tags: ['x'] })).status).toBe(200);
    await setClock(T0 + 2 * M);
    expect((await beat('vm-a', w.secret, { tags: ['x'], last_activity_at: T0 + M })).status).toBe(200);
    expect(await recs(w.secret)).toEqual([]);
    expect((await claimItem('vm-a', w.secret)).json).toMatchObject({ code: 'no-eligible-ticket' });
    expect(await version()).toBe(v0);
    // A heartbeat that changes what the runner declares is a change.
    expect((await beat('vm-a', w.secret, { tags: ['y'] })).status).toBe(200);
    const v1 = await version();
    expect(v1).toBeGreaterThan(v0);
    // So is any write, and one that changes no row is not.
    await rows(`UPDATE tickets SET rank = rank WHERE id = 'docs:T-1'`);
    expect(await version()).toBe(v1 + 1);
    await rows(`UPDATE tickets SET rank = 0 WHERE id = 'docs:nothing'`);
    expect(await version()).toBe(v1 + 1);
    // A transaction's writes move it once.
    await withCore((c) => c.store.transaction(() => {
      c.store.exec(`UPDATE tickets SET rank = 7 WHERE id = 'docs:T-1'`);
      c.store.exec(`UPDATE tickets SET rank = 8 WHERE id = 'docs:T-2'`);
    }));
    expect(await version()).toBe(v1 + 2);
  });

  it('an idle answer is memoised until a write', async () => {
    expect(await recs(w.secret)).toEqual([]);
    const reads = async (f: () => Promise<unknown>) => {
      let n = 0;
      await withCore((c) => {
        const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b237?: (q: string, ...p: unknown[]) => unknown };
        s.__b237 ??= s.exec;
        const orig = s.__b237;
        s.exec = (q: string, ...p: unknown[]) => { n++; return orig.call(s, q, ...p); };
      });
      try {
        await f();
      } finally {
        await withCore((c) => { const s = c.store as unknown as { exec: unknown; __b237?: unknown }; s.exec = s.__b237; });
      }
      return n;
    };
    // The memo: a recommendation that finds nothing runs a handful of statements, not the gates.
    const hit = await reads(() => recs(w.secret));
    expect(hit).toBeLessThan(25);
    expect((await claimItem('vm-a', w.secret)).json).toMatchObject({ code: 'no-eligible-ticket' });
    expect(await reads(() => claimItem('vm-a', w.secret))).toBeLessThan(25);
    // A write ends it: the sync drops T-1's requirement.
    git.add('T-1', { rank: 1 });
    expect((await git.post()).status).toBe(200);
    expect(await recs(w.secret)).toEqual(['docs:T-1']);
    expect((await claimItem('vm-a', w.secret)).json).toMatchObject({ ticket_id: 'docs:T-1' });
  });

  it('a heartbeat declaring a capability ends it', async () => {
    const m = await register('mac', { capabilities: ['agent-venue'] });
    expect(await recs(m.secret, 10, 'mac')).toEqual([]);
    expect((await beat('mac', m.secret, { capabilities: ['agent-venue', 'human-operator'] })).status).toBe(200);
    expect(await recs(m.secret, 10, 'mac')).toEqual(['docs:T-1', 'docs:T-2', 'docs:T-3', 'docs:T-4', 'docs:T-5']);
  });

  it('a passing clock deadline ends it: an owner bar ending, a backoff lapsing', async () => {
    git.add('T-1', { rank: 1 });
    expect((await git.post()).status).toBe(200);
    // An owner bar on the runner's tag until +5 min: nothing eligible, memoised.
    await bar('*', 'x', [], T0 - M, T0 + 5 * M);
    expect(await recs(w.secret)).toEqual([]);
    expect((await claimItem('vm-a', w.secret)).json).toMatchObject({ code: 'no-eligible-ticket' });
    const v = await version();
    await setClock(T0 + 5 * M - 1);
    expect(await recs(w.secret)).toEqual([]);
    // The bar ends with no write: the memo ends with it.
    await setClock(T0 + 5 * M);
    expect(await version()).toBe(v);
    expect(await recs(w.secret)).toEqual(['docs:T-1']);
    // A backoff until +12 min on the one eligible ticket: idle, then the memo's 10-minute cap
    // and the deadline both pass with no write.
    await rows(`INSERT INTO ticket_overrides (ticket_id, expedite, hold, hold_reason, retry_after, set_by, set_at) VALUES ('docs:T-1', 0, 0, NULL, ?, 'test', ?)`, T0 + 12 * M, T0);
    expect(await recs(w.secret)).toEqual([]);
    expect((await claimItem('vm-a', w.secret)).json).toMatchObject({ code: 'no-eligible-ticket' });
    await setClock(T0 + 11 * M);
    expect(await recs(w.secret)).toEqual([]);
    await setClock(T0 + 12 * M + 1);
    expect(await recs(w.secret)).toEqual(['docs:T-1']);
  });
});

describe.runIf(HOST === 'cloudflare')('B-237 an idle beat reads about nothing (rows_read)', () => {
  type Cur = { rowsRead?: number };
  /** The rows the store's statements read while `f` runs (workerd's `SqlStorageCursor.rowsRead`). */
  async function measured<T>(f: () => Promise<T>): Promise<{ out: T; read: number; n: number }> {
    const log: Cur[] = [];
    await withCore((c) => {
      const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b237r?: (q: string, ...p: unknown[]) => unknown };
      s.__b237r ??= s.exec;
      const orig = s.__b237r;
      s.exec = (q: string, ...p: unknown[]) => {
        const cur = orig.call(s, q, ...p) as Cur;
        log.push(cur);
        return cur;
      };
    });
    try {
      const out = await f();
      return { out, read: log.reduce((n, c) => n + (c.rowsRead ?? 0), 0), n: log.length };
    } finally {
      await withCore((c) => { const s = c.store as unknown as { exec: unknown; __b237r?: unknown }; s.exec = s.__b237r; });
    }
  }

  it('production-sized and gated: recommendations and the refused claim cost ≤ 50 rows on a repeat', { timeout: 120_000 }, async () => {
    // 180 tickets every one requiring a capability the runner lacks (production's idle state on
    // 2026-11-15), ~600 ended claims and ~3k events.
    const git = new Git();
    for (let i = 1; i <= 180; i++) git.add(`T-${i}`, { rank: i, requires: ['human-operator'] });
    expect((await git.post()).status).toBe(200);
    await cutover();
    const w = await register('vm-a');
    const other = await register('vm-b');
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 600)
                INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, end_reason, ended_at, ended_at_sha, confirmed_at, end_observation)
                SELECT 'docs:T-' || (1 + i % 180), ?, 'hist-' || i, 'abc123', '', ?, 'completed', 'suspended:reviewed', ?, 'abc', ?, 0 FROM k`, other.id, T0 - 86_400_000, T0 - 86_400_000, T0 - 86_400_000);
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 3000)
                INSERT INTO events (at, kind, actor, detail_json, repository_id) SELECT ?, 'claimed', 'test', '{}', 'docs' FROM k`, T0 - 86_400_000);
    await setClock(T0 + 2 * M);

    const claim = () => claimItem('vm-a', w.secret);
    const rec = () => recs(w.secret, 5);
    // Before B-237's reading: gating every candidate, the refusal's second query, no memo.
    await reference(true);
    const before = { recs: await measured(rec), claim: await measured(claim) };
    await reference(false);
    // The first idle beat computes; the next ones are memo hits.
    const first = { recs: await measured(rec), claim: await measured(claim) };
    await setClock(T0 + 4 * M);
    const hb = await measured(() => beat('vm-a', w.secret));
    const second = { recs: await measured(rec), claim: await measured(claim) };
    console.log(`B-237 rows_read — before: recommendations ${before.recs.read}, claim ${before.claim.read}; `
      + `first idle beat: recommendations ${first.recs.read}, claim ${first.claim.read}; `
      + `memo hit: heartbeat ${hb.read}, recommendations ${second.recs.read}, claim ${second.claim.read}`);
    expect(before.recs.out).toEqual([]);
    expect(second.recs.out).toEqual([]);
    expect(second.claim.out.json).toEqual(before.claim.out.json);
    expect(before.claim.out.json).toMatchObject({ code: 'no-eligible-ticket' });
    // The refusal no longer reads the candidates twice.
    expect(first.claim.read).toBeLessThan(before.claim.read * 0.7);
    expect(second.recs.read + second.claim.read).toBeLessThanOrEqual(50);
    expect(hb.read).toBeLessThanOrEqual(40);
  });

  it('with work ready: recommendations gate only what they return', { timeout: 120_000 }, async () => {
    const git = new Git();
    for (let i = 1; i <= 180; i++) git.add(`T-${i}`, { rank: i });
    expect((await git.post()).status).toBe(200);
    await cutover();
    const w = await register('vm-a');
    await reference(true);
    const before = await measured(() => recs(w.secret, 5));
    await reference(false);
    const after = await measured(() => recs(w.secret, 5));
    console.log(`B-237 rows_read (180 ready) — recommendations limit=5: before ${before.read}, after ${after.read}`);
    expect(after.out).toEqual(before.out);
    expect(after.read).toBeLessThan(before.read);
  });
});
