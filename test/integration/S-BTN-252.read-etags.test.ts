// S-BTN-252 every session-readable GET answers a strong ETag decided before the read runs
// (B-205; BATON_SPEC §2 R-BTN-196, §14's Requests): the state version, the caller, the action,
// its path and query, and — where the answer shows what the clock decides — B-242's coarse
// clock bucket. Must hold:
//   1. two reads of an unchanged board carry the same ETag; the second naming it is `304` with
//      no body; a write moves it; the clock bucket alone moves a read that shows liveness, and
//      does not move one that shows none;
//   2. the ETag is the caller's and the read's own: another caller's, another read's and
//      another query's are served in full;
//   3. a `304` is never answered to a caller the read refuses;
//   4. a key's answers are as before — `board` and `history?before=` byte for byte — with the
//      ETag beside them; a runner's own `?runner=me` is never conditional;
//   5. on the Cloudflare host, the unchanged poll reads a handful of rows, not the read.
// Runs on both hosts (the rows_read case on Cloudflare only).
import { describe, it, expect, beforeEach } from 'vitest';
import { CLOCK_BUCKET_MS } from '../../src/core/stateVersion';
import { HOST, adminSession, cutover, Git, keyCall, ORIGIN, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const NEXT_BUCKET = T0 + CLOCK_BUCKET_MS + 60_000;
const BOARD = '/v1/repositories/docs/board';

let admin: TestKey;
let second: TestKey;
let owner: TestKey;
let git: Git;
let cookie: string;

const poll = (path: string, etag?: string, as = cookie) => sessionCall(as, path, etag === undefined ? {} : { headers: { 'If-None-Match': etag } });
async function signed(key: TestKey, path: string, headers: Record<string, string> = {}) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  return hostCall(await signedRequest(key, ORIGIN + path, { created, headers }));
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  second = await makeKey('ssh-ed25519', 'second-admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin, second);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  git = new Git().add('T-1').add('T-2', { parent: 'T-1' });
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
});

describe('S-BTN-252 the reads’ ETags (B-205)', () => {
  it('an unchanged board is 304 to the ETag it served; a write and the clock bucket move it', async () => {
    const first = await poll(BOARD);
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag')!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    await setClock(T0 + 1000);
    const second_ = await poll(BOARD);
    expect(second_.headers.get('ETag')).toBe(etag);
    const again = await poll(BOARD, etag);
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe('');
    expect((await poll(BOARD, `W/${etag}`)).status).toBe(304);
    // A write — a changed row — moves it.
    expect((await git.add('T-3').post()).status).toBe(200);
    const after = await poll(BOARD, etag);
    expect(after.status).toBe(200);
    const moved = after.headers.get('ETag')!;
    expect(moved).not.toBe(etag);
    // The board shows the holders' leases: the clock bucket alone moves it, with no write.
    await setClock(NEXT_BUCKET);
    const refreshed = await poll(BOARD, moved);
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get('ETag')).not.toBe(moved);
  });

  it('a read that shows nothing the clock decides stands across the bucket', async () => {
    const children = '/v1/repositories/docs/tickets/T-1/children';
    const etag = (await poll(children)).headers.get('ETag')!;
    await setClock(NEXT_BUCKET);
    expect((await poll(children, etag)).status).toBe(304);
  });

  it('the ETag is the caller’s and the read’s own', async () => {
    const etag = (await poll(BOARD)).headers.get('ETag')!;
    // Another administrator's session.
    const other = await adminSession(second);
    const theirs = await poll(BOARD, etag, other);
    expect(theirs.status).toBe(200);
    expect(theirs.headers.get('ETag')).not.toBe(etag);
    // Another read, and the same read with another query.
    expect((await poll('/v1/repositories/docs/blocked', etag)).status).toBe(200);
    const history = '/v1/repositories/docs/tickets/T-1/history';
    const page = (await poll(history)).headers.get('ETag')!;
    expect((await poll(`${history}?limit=10`, page)).status).toBe(200);
    expect((await poll(history, page)).status).toBe(304);
    // Each of the session's reads carries one.
    for (const path of ['/v1/repositories', '/v1/actions', '/v1/repositories/docs/courses', '/v1/repositories/docs/schemas?ids=std:decision@1',
      '/v1/repositories/docs/stats', '/v1/repositories/docs/conditions', '/v1/repositories/docs/tickets/T-1', '/v1/repositories/docs/tickets/T-1/blocks',
      '/v1/repositories/docs/tickets/T-1/legs/implement/runs', '/v1/owner/docs/grants', '/v1/owner/docs/policy/log']) {
      const res = await poll(path);
      expect([path, res.status]).toEqual([path, 200]);
      const tag = res.headers.get('ETag')!;
      expect([path, tag]).toEqual([path, expect.stringMatching(/^"[0-9a-f]{64}"$/)]);
      expect([path, (await poll(path, tag)).status]).toEqual([path, 304]);
    }
  });

  it('a 304 is never answered to a caller the read refuses', async () => {
    const etag = (await poll(BOARD)).headers.get('ETag')!;
    // A stranger naming a valid ETag.
    expect((await hostCall(new Request(ORIGIN + BOARD, { headers: { 'If-None-Match': etag } }))).status).toBe(401);
    // The session's key leaves BATON_ADMIN_KEYS: the session ends, and the old ETag opens nothing.
    await setAdminKeys(second);
    const ended = await poll(BOARD, etag);
    expect(ended.status).toBe(401);
    // An owner whose ETag was good, once it owns the repository no more.
    const mine = (await signed(owner, BOARD)).headers.get('ETag')!;
    expect((await signed(owner, BOARD, { 'If-None-Match': mine })).status).toBe(304);
    await rows('UPDATE repository_owners SET removed_at = ? WHERE fingerprint = ?', T0, owner.fingerprint);
    const revoked = await signed(owner, BOARD, { 'If-None-Match': mine });
    expect([401, 403]).toContain(revoked.status);
  });

  it('a key’s board and history answer exactly as before, with the ETag beside them', async () => {
    const board = await signed(owner, BOARD);
    expect(board.status).toBe(200);
    expect(board.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/);
    const body = (await board.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['granted_capabilities', 'holders', 'ready', 'ready_by_tier', 'repository', 'server_time']);
    expect(body.server_time).toBe(T0);
    const direct = await withCore((c) => JSON.stringify(c.boardView('docs', null)));
    expect(JSON.stringify(body)).toBe(direct);
    // `history` keeps `?before=&limit=` (the CLI reads `next_before`).
    const history = (await (await signed(owner, '/v1/repositories/docs/tickets/T-1/history?limit=1')).json()) as { rows: { id: number }[]; next_before?: number };
    expect(history.rows.length).toBe(1);
    const older = await signed(owner, `/v1/repositories/docs/tickets/T-1/history?before=${history.rows[0].id}&limit=50`);
    expect(older.status).toBe(200);
    expect(((await older.json()) as { rows: { id: number }[] }).rows.every((r) => r.id < history.rows[0].id)).toBe(true);
    expect((await signed(owner, '/v1/repositories/docs/tickets/T-1/history?before=nope')).status).toBe(400);
    // `blocked` keeps its own cursor: a ticket id, not B-205's.
    expect((await signed(owner, '/v1/repositories/docs/blocked?cursor=docs:T-1')).status).toBe(200);
    // A runner session's own answer is decided by its secret: never conditional.
    const mine = await poll('/v1/repositories/docs/tickets/T-1/blocks?runner=me');
    expect(mine.status).toBe(400);
    expect(mine.headers.get('ETag')).toBeNull();
  });
});

describe.runIf(HOST === 'cloudflare')('S-BTN-252 an unchanged poll reads about one row (rows_read)', () => {
  type Cur = { rowsRead?: number };
  async function measured<T>(f: () => Promise<T>): Promise<{ out: T; read: number; n: number }> {
    const log: Cur[] = [];
    await withCore((c) => {
      const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b205r?: (q: string, ...p: unknown[]) => unknown };
      s.__b205r ??= s.exec;
      const orig = s.__b205r;
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
      await withCore((c) => { const s = c.store as unknown as { exec: unknown; __b205r?: unknown }; s.exec = s.__b205r; });
    }
  }

  it('the board and the repositories list: the poll naming its ETag reads a handful of rows', { timeout: 120_000 }, async () => {
    for (let i = 3; i <= 150; i++) git.add(`T-${i}`);
    expect((await git.post()).status).toBe(200);
    for (const path of [BOARD, '/v1/repositories']) {
      const full = await measured(() => poll(path));
      expect(full.out.status).toBe(200);
      const etag = full.out.headers.get('ETag')!;
      const unchanged = await measured(() => poll(path, etag));
      console.log(`S-BTN-252 rows_read ${path} — full ${full.read} rows over ${full.n} statements; unchanged ${unchanged.read} rows over ${unchanged.n} statements`);
      expect(unchanged.out.status).toBe(304);
      // The version row, the session's row and the request's own upkeep — and, for a
      // repository read, the registry row the authorization reads. Never the read.
      expect(unchanged.read).toBeGreaterThan(0);
      expect(unchanged.read).toBeLessThanOrEqual(8);
      expect(full.read).toBeGreaterThan(unchanged.read * 10);
    }
  });
});
