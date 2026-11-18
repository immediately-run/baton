// B-242 — an unchanged dashboard poll costs about one row (S-BTN-235; BATON_SPEC §11.4's
// polling, §14's `/v1/ui/state` row, R-BTN-196's `state_version`). Production passed
// Cloudflare's free-tier 5,000,000 `rows_read`/day on 2026-11-14 and 15; `GET /v1/ui/state`
// read ~14.4k rows of a production-sized state every 10 s poll. The answer now carries a strong
// ETag of the state version, the caller and a coarse clock bucket — the state shows what the
// clock decides (alive, stalled, `reap_at`, the time windows), and liveness moves no version
// (R-BTN-196) — decided after the principal and before the read runs: a matching
// `If-None-Match` answers `304` having read the version row alone. Must hold:
//   1. a served answer carries its ETag, and a repeat naming it is `304` with no body and the
//      same ETag;
//   2. any write moves the ETag; a steady heartbeat — liveness, R-BTN-196's exception — does
//      not, within the bucket;
//   3. the clock bucket alone moves it: no write, only the clock past a bucket, and the poll
//      is served in full; inside the new bucket it is `304` again;
//   4. the ETag is the caller's own — another administrator's is served in full — and the
//      principal is decided first: a stranger naming a valid ETag reads `unauthenticated`;
//   5. on the Cloudflare host, the unchanged poll of a production-sized state reads a handful
//      of rows (`SqlStorageCursor.rowsRead`), not thousands.
// Runs on both hosts (the rows_read case on Cloudflare only).
import { describe, it, expect, beforeEach } from 'vitest';
import { HOST, Git, adminSession, beat, call, cutover, register, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const M = 60_000;
/** T0 is a bucket boundary (a whole minute): +30 s stays in T0's bucket, +61 s leaves it. */
const IN_BUCKET = T0 + 30_000;
const NEXT_BUCKET = T0 + 61_000;

let admin: TestKey;
let second: TestKey;
let git: Git;
let cookie: string;

/** `GET /v1/ui/state` under the session, naming `etag` when given. */
function poll(etag?: string) {
  return sessionCall(cookie, '/v1/ui/state', etag === undefined ? {} : { headers: { 'If-None-Match': etag } });
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  second = await makeKey('ssh-ed25519', 'second-admin');
  await setAdminKeys(admin, second);
  git = new Git().add('T-1');
  await git.post();
  await cutover();
  cookie = await adminSession(admin);
});

describe('B-242 the dashboard poll’s ETag', () => {
  it('answers 304 to the ETag it served, and no body; a write moves it', async () => {
    const first = await poll();
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const again = await poll(etag!);
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe('');

    // A board post writes, so the version moves and the poll is served in full, with a new ETag.
    await git.add('T-2').post();
    const after = await poll(etag!);
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).not.toBe(etag);
    expect(await (await poll(after.headers.get('ETag')!)).status).toBe(304);
  });

  it('a heartbeat is liveness, not a write: within the bucket the ETag stands', async () => {
    const etag = (await poll()).headers.get('ETag')!;
    const w = await register('vm-a');
    expect((await beat('vm-a', w.secret)).status).toBe(200);
    // The first heartbeat registered the worker — a write; a steady beat after it is liveness
    // alone (R-BTN-196): the version stands, and so does the poll's answer.
    const etag2 = (await poll()).headers.get('ETag')!;
    expect((await beat('vm-a', w.secret)).status).toBe(200);
    const unchanged = await poll(etag2);
    expect(unchanged.status).toBe(304);
  });

  it('the clock bucket alone moves the ETag: the state refreshes with no write', async () => {
    const etag = (await poll()).headers.get('ETag')!;
    await setClock(IN_BUCKET);
    expect((await poll(etag)).status).toBe(304);
    await setClock(NEXT_BUCKET);
    const refreshed = await poll(etag);
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get('ETag')).not.toBe(etag);
    // Inside the new bucket the poll is `304` again.
    await setClock(NEXT_BUCKET + 30_000);
    expect((await poll(refreshed.headers.get('ETag')!)).status).toBe(304);
  });

  it('the ETag is the caller’s own, and the principal is decided before it is compared', async () => {
    const foreign = (await sessionCall(await adminSession(second), '/v1/ui/state')).headers.get('ETag')!;
    expect(foreign).toMatch(/^"[0-9a-f]{64}"$/);
    // Another administrator's ETag names that caller's answer: this one is served in full.
    const served = await poll(foreign);
    expect(served.status).toBe(200);
    expect(served.headers.get('ETag')).not.toBe(foreign);
    // A stranger naming a valid ETag is refused as ever — no `304` past the principal check.
    const stranger = await call('/v1/ui/state', { headers: { 'If-None-Match': foreign } });
    expect(stranger.status).toBe(401);
  });

  it('a request without If-None-Match, or naming something else, is served as today', async () => {
    const plain = await poll();
    expect(plain.status).toBe(200);
    expect(await (plain.clone()).json()).toMatchObject({ server_time: T0 });
    const other = await poll('"deadbeef"');
    expect(other.status).toBe(200);
    // The weak spelling of the tag matches, as a poller may echo one (§14's weak comparison).
    const weak = await poll(`W/${(await poll()).headers.get('ETag')}`);
    expect(weak.status).toBe(304);
  });
});

describe.runIf(HOST === 'cloudflare')('B-242 an unchanged poll reads about one row (rows_read)', () => {
  type Cur = { rowsRead?: number };
  /** The rows the store's statements read while `f` runs (workerd's `SqlStorageCursor.rowsRead`). */
  async function measured<T>(f: () => Promise<T>): Promise<{ out: T; read: number; n: number }> {
    const log: Cur[] = [];
    await withCore((c) => {
      const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b242r?: (q: string, ...p: unknown[]) => unknown };
      s.__b242r ??= s.exec;
      const orig = s.__b242r;
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
      await withCore((c) => { const s = c.store as unknown as { exec: unknown; __b242r?: unknown }; s.exec = s.__b242r; });
    }
  }

  it('production-sized: the poll naming its ETag reads a handful of rows, not the state', { timeout: 120_000 }, async () => {
    // The state the incident measured (B-237's recipe): 180 tickets, ~600 ended claims, ~3k
    // events, a worker with a steady lease.
    for (let i = 2; i <= 180; i++) git.add(`T-${i}`, { requires: ['human-operator'] });
    expect((await git.post()).status).toBe(200);
    const w = await register('vm-a');
    const other = await register('vm-b');
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 600)
                INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, end_reason, ended_at, ended_at_sha, confirmed_at, end_observation)
                SELECT 'docs:T-' || (1 + i % 180), ?, 'hist-' || i, 'abc123', '', ?, 'completed', 'suspended:reviewed', ?, 'abc', ?, 0 FROM k`, other.id, T0 - 86_400_000, T0 - 86_400_000, T0 - 86_400_000);
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 3000)
                INSERT INTO events (at, kind, actor, detail_json, repository_id) SELECT ?, 'claimed', 'test', '{}', 'docs' FROM k`, T0 - 86_400_000);

    // The full read, once, to prime the answer and show what the 304 saves.
    const full = await measured(() => poll());
    expect(full.out.status).toBe(200);
    const etag = full.out.headers.get('ETag')!;
    const unchanged = await measured(() => poll(etag));
    const later = await measured(() => poll(etag));
    console.log(`B-242 rows_read — full poll ${full.read} rows over ${full.n} statements; `
      + `unchanged poll ${unchanged.read} rows over ${unchanged.n} statements, again ${later.read}`);
    expect(unchanged.out.status).toBe(304);
    expect(unchanged.out.headers.get('ETag')).toBe(etag);
    // The write moved nothing since: both unchanged polls agree, and cost the version row (plus
    // the principal's session and the request's own alarm upkeep), never the state.
    expect(later.read).toBe(unchanged.read);
    expect(unchanged.read).toBeLessThanOrEqual(8);
    expect(full.read).toBeGreaterThan(unchanged.read * 100);

    // A write or a new bucket serves the read again — the 304 never outlives its inputs.
    expect((await git.add('T-181').post()).status).toBe(200);
    const moved = await measured(() => poll(etag));
    console.log(`B-242 rows_read — after a board post, the poll with the old ETag: ${moved.read} rows`);
    expect(moved.out.status).toBe(200);
    expect(moved.out.headers.get('ETag')).not.toBe(etag);
  });
});
