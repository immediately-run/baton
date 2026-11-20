// S-BTN-301 the tenant reads' callers (B-202; BATON_SPEC §11.2 R-BTN-57, §11.4 R-BTN-155,
// §12.1, §14): each of `GET /v1/admin/repositories`, `/capacities`, `/instances`, `/resources`,
// `/settings`, `/tenant` and `/sessions` is an administrator's — a key's or a session's — and
// no one else's. Must hold:
//   1. an administrator's key (signed, or an API key as a bearer) and an administrator's
//      session are answered `200`;
//   2. an owner's key and a granted runner's key are `forbidden`; a key Baton does not know and
//      a request with no principal are `unauthenticated`; a session that ended is
//      `unauthenticated`;
//   3. the registry lists each read for an administrator's session alone, with no `ui.view`
//      (a read is no control), and `GET /v1/admin/state` is still the key's only;
//   4. a sealed Baton still serves them (R-BTN-88: an administrator's reads alone).
// Owner sessions do not exist yet (B-76): the entries' callers refuse them by construction.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, keyCall, makeApiKey, mirrorCall, ORIGIN, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { ACTIONS, sessionCaller } from '../../src/core/actions';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const READS = ['/v1/admin/repositories', '/v1/admin/capacities', '/v1/admin/instances', '/v1/admin/resources', '/v1/admin/settings', '/v1/admin/tenant', '/v1/admin/sessions'];
const IDS = ['admin.repo.list', 'admin.capacity.list', 'admin.instance.list', 'admin.resource.list', 'admin.settings.show', 'admin.tenant', 'admin.session.list'];

let admin: TestKey;
let owner: TestKey;
let granted: TestKey;
let api: { key: string; line: string };
let cookie: string;

async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  granted = await makeKey('ssh-ed25519', 'granted');
  api = await makeApiKey('an administrator');
  await setAdminKeys(admin, api.line);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
  cookie = await adminSession(admin);
});

describe('S-BTN-301 the tenant reads’ callers (B-202)', () => {
  it('an administrator’s key and session read each; every other caller is refused', async () => {
    const stranger = await makeKey('ssh-ed25519', 'stranger');
    for (const path of READS) {
      expect([path, (await read(admin, path)).status]).toEqual([path, 200]);
      expect([path, (await sessionCall(cookie, path)).status]).toEqual([path, 200]);
      const bearer = await hostCall(new Request(ORIGIN + path, { headers: { Authorization: `Bearer ${api.key}` } }));
      expect([path, bearer.status]).toEqual([path, 200]);
      for (const key of [owner, granted]) {
        const refused = await read(key, path);
        expect([path, key.name, refused.status, refused.json.code]).toEqual([path, key.name, 403, 'forbidden']);
      }
      const unknown = await read(stranger, path);
      expect([path, unknown.status, unknown.json.code]).toEqual([path, 401, 'unauthenticated']);
      expect([path, (await hostCall(new Request(ORIGIN + path))).status]).toEqual([path, 401]);
      expect([path, (await sessionCall('__Host-baton_session=' + '0'.repeat(64), path)).status]).toEqual([path, 401]);
    }
    // The session ends: nothing more is read with its cookie.
    const out = await sessionCall(cookie, '/v1/ui/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect([out.status, await out.text()]).toEqual([200, '{"ok":true}']);
    for (const path of READS) expect([path, (await sessionCall(cookie, path)).status]).toEqual([path, 401]);
  });

  it('the registry lists each for an administrator’s session alone, and the state read stays the key’s', async () => {
    for (const id of IDS) {
      const entry = ACTIONS.find((a) => a.id === id)!;
      expect([id, entry.effect, entry.http.method, entry.ui]).toEqual([id, 'read', 'GET', undefined]);
      expect([id, sessionCaller(entry, 'administrator') != null, sessionCaller(entry, 'owner')]).toEqual([id, true, null]);
      expect([id, entry.callers.map((c) => c.principal).sort()]).toEqual([id, ['administrator', 'session']]);
    }
    expect(ACTIONS.filter((a) => a.http.path.startsWith('/v1/admin/')).map((a) => a.id).sort()).toEqual([...IDS].sort());
    const listed = (await (await sessionCall(cookie, '/v1/actions')).json()) as { actions: { id: string }[] };
    for (const id of IDS) expect([id, listed.actions.some((a) => a.id === id)]).toEqual([id, true]);
    // `GET /v1/admin/state` admits no cookie (B-203 and B-216 settle it).
    expect((await sessionCall(cookie, '/v1/admin/state')).status).toBe(401);
    expect((await read(admin, '/v1/admin/state')).status).toBe(200);
  });

  it('a sealed Baton still serves them to an administrator', async () => {
    expect((await keyCall(admin, '/v1/admin/freeze', {})).status).toBe(200);
    // The mirror has read every event: nothing holds the seal.
    await mirrorCall('/v1/sync/events?after=1000000');
    expect((await keyCall(admin, '/v1/admin/seal', {})).status).toBe(200);
    for (const path of READS) expect([path, (await read(admin, path)).status]).toEqual([path, 200]);
    expect((await read(admin, '/v1/admin/tenant')).json.sealed_at).toBe(T0);
  });
});
