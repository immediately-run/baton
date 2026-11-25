// S-BTN-250 sessions read the repository reads (B-192; BATON_SPEC §11.3 R-BTN-129, §11.4
// R-BTN-155, §12.4 R-BTN-16, §14): a dashboard session reads every repository and owner read a
// screen draws — the same entry, query and JSON a key gets (R-BTN-179) — and a repository the
// caller cannot read answers the one `forbidden`, whoever asks. Must hold:
//   1. an administrator's session reads board, blocked, stats, policy, conditions, a ticket,
//      its blocks, history and children, a leg's runs, and the owner's grants and policy log,
//      with no signature — and the body is the key's;
//   2. an unregistered and a retired repository answer `forbidden` to a session, an
//      administrator's key, an owner's key and a runner's key alike (never `not-found`), while
//      an id absent from a readable repository stays `not-found`;
//   3. the keys' answers are otherwise as before: an owner reads its own repository and no
//      other, a granted runner its repository, a leg's runs never a runner's;
//   4. a session reads nothing outside the registry's session reads, and ends with its key.
// Owner sessions do not exist yet (B-76): their branch is written and not reachable here.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, cutover, Git, keyCall, ORIGIN, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');

let admin: TestKey;
let docsOwner: TestKey;
let opsOwner: TestKey;
let granted: TestKey;
let cookie: string;

async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}
async function session(path: string) {
  const res = await sessionCall(cookie, path);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  granted = await makeKey('ssh-ed25519', 'granted');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
  const git = new Git().add('T-1').add('T-2', { parent: 'T-1' });
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
});

const READS = [
  '/v1/repositories/docs/board',
  '/v1/repositories/docs/policy',
  '/v1/repositories/docs/blocked',
  '/v1/repositories/docs/stats',
  '/v1/repositories/docs/conditions',
  '/v1/repositories/docs/tickets/T-1',
  '/v1/repositories/docs/tickets/T-1/blocks',
  '/v1/repositories/docs/tickets/T-1/history',
  '/v1/repositories/docs/tickets/T-1/children',
  '/v1/repositories/docs/tickets/T-1/legs/implement/runs',
  '/v1/owner/docs/grants',
  '/v1/owner/docs/policy/log',
];

describe('S-BTN-250 sessions read the repository reads (B-192)', () => {
  it('an administrator’s session reads each read with no signature, and gets the key’s JSON', async () => {
    for (const path of READS) {
      const viaSession = await session(path);
      expect([path, viaSession.status]).toEqual([path, 200]);
      // R-BTN-179: the same entry, query and JSON a key gets — the repository's owner signs it.
      const viaKey = await read(docsOwner, path);
      expect([path, viaKey.status]).toEqual([path, 200]);
      expect(viaSession.json).toEqual(viaKey.json);
    }
    // An administrator's session reads every live repository — the owner routes of one it
    // does not own among them — where its key signs no `/v1/owner/*` route (R-BTN-57).
    expect((await session('/v1/owner/ops/grants')).status).toBe(200);
    expect((await session('/v1/repositories/ops/board')).status).toBe(200);
    expect((await read(admin, '/v1/owner/docs/grants')).json.code).toBe('forbidden');
    expect((await session('/v1/repositories/docs/tickets/T-1/children')).json.children).toEqual([{ ticket_id: 'docs:T-2', station: 'filed', blocked: false }]);
  });

  it('a repository the caller cannot read is forbidden for every principal — unregistered, retired, unowned, ungranted', async () => {
    const refused = (r: { status: number; json: Record<string, any> }) => [r.status, r.json.code];
    for (const path of ['/v1/repositories/nope/board', '/v1/repositories/nope/tickets/T-1/history', '/v1/repositories/nope/stats', '/v1/repositories/nope/conditions']) {
      expect([path, ...refused(await session(path))]).toEqual([path, 403, 'forbidden']);
      expect([path, ...refused(await read(admin, path))]).toEqual([path, 403, 'forbidden']);
      expect([path, ...refused(await read(docsOwner, path))]).toEqual([path, 403, 'forbidden']);
      expect([path, ...refused(await read(granted, path))]).toEqual([path, 403, 'forbidden']);
    }
    expect(refused(await session('/v1/owner/nope/grants'))).toEqual([403, 'forbidden']);
    expect(refused(await read(docsOwner, '/v1/owner/nope/grants'))).toEqual([403, 'forbidden']);
    // The same message for each: nothing tells an unregistered repository from another's.
    const unowned = await read(docsOwner, '/v1/repositories/ops/board');
    const absent = await read(docsOwner, '/v1/repositories/nope/board');
    expect(refused(unowned)).toEqual([403, 'forbidden']);
    expect(unowned.json.message).toBe(absent.json.message);
    expect(refused(await read(granted, '/v1/repositories/ops/board'))).toEqual([403, 'forbidden']);
    expect(refused(await read(granted, '/v1/repositories/ops/policy'))).toEqual([403, 'forbidden']);
    expect(refused(await read(docsOwner, '/v1/owner/ops/grants'))).toEqual([403, 'forbidden']);
    // Retired: as one never registered (R-BTN-47).
    await rows('UPDATE repositories SET retired_at = ? WHERE id = ?', T0, 'ops');
    expect(refused(await session('/v1/repositories/ops/board'))).toEqual([403, 'forbidden']);
    expect(refused(await read(admin, '/v1/repositories/ops/board'))).toEqual([403, 'forbidden']);
    // Its owner's key owns nothing live any more: Baton does not know it (R-BTN-58), and still
    // says nothing of the repository.
    expect(refused(await read(opsOwner, '/v1/repositories/ops/board'))).toEqual([401, 'unauthenticated']);
    expect(refused(await session('/v1/owner/ops/grants'))).toEqual([403, 'forbidden']);
    // An entity id absent from a readable repository stays `not-found`.
    expect(refused(await session('/v1/repositories/docs/tickets/NOPE'))).toEqual([404, 'not-found']);
    expect(refused(await read(granted, '/v1/repositories/docs/tickets/NOPE'))).toEqual([404, 'not-found']);
    // A malformed repository id is a bad request, as before.
    expect(refused(await session('/v1/repositories/no%20pe/board'))).toEqual([400, 'invalid-params']);
  });

  it('the keys read as before: an owner its repository, a granted runner its repository, never a leg’s runs', async () => {
    const board = await read(granted, '/v1/repositories/docs/board');
    expect(board.status).toBe(200);
    expect(Object.keys(board.json).sort()).toEqual(['granted_capabilities', 'holders', 'ready', 'ready_by_tier', 'repository', 'server_time']);
    expect(board.json.granted_capabilities).toEqual(['authentication', 'create-pr', 'drivable-browser', 'llm-call']);
    expect((await read(docsOwner, '/v1/repositories/docs/board')).json.granted_capabilities).toBeNull();
    expect((await read(admin, '/v1/repositories/docs/board')).status).toBe(200);
    expect((await read(granted, '/v1/repositories/docs/tickets/T-1/legs/implement/runs')).json.code).toBe('forbidden');
    expect((await read(granted, '/v1/owner/docs/grants')).json.code).toBe('forbidden');
    const unknown = await read(await makeKey('ssh-ed25519', 'stranger'), '/v1/repositories/docs/board');
    expect([unknown.status, unknown.json.code]).toEqual([401, 'unauthenticated']);
    const none = await hostCall(new Request(`${ORIGIN}/v1/repositories/docs/board`));
    expect(none.status).toBe(401);
  });

  it('a session reads only what the registry admits it to, and ends with its key', async () => {
    // An administrator key's own reads take no session (§11.4: nothing changes authority from a cookie).
    // (B-202 admits an administrator's session to the tenant reads — the registry among them, S-BTN-301.)
    expect((await session('/v1/admin/repositories')).status).toBe(200);
    expect((await session('/v1/admin/state')).status).toBe(401);
    expect((await session('/v1/owner/docs/signing-keys')).status).toBe(401);
    // A write is no read: the cookie is admitted on a GET alone.
    const post = await sessionCall(cookie, '/v1/repositories/docs/sequences/ticket/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(post.status).toBe(401);
    // A cookie that is no session's.
    expect((await sessionCall('__Host-baton_session=bds_nope', '/v1/repositories/docs/board')).status).toBe(401);
    // The session dies with its key's role (R-BTN-155): out of BATON_ADMIN_KEYS, it reads nothing.
    await setAdminKeys(await makeKey('ssh-ed25519', 'another-admin'));
    const ended = await session('/v1/repositories/docs/board');
    expect([ended.status, ended.json.code]).toEqual([401, 'unauthenticated']);
  });
});
