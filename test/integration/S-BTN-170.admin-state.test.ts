// S-BTN-170 the dashboard's state read with an administrator's key (BATON_SPEC §15, §11, §12.1
// R-BTN-57; B-118): an administrator registers `ops` with one owner, who grants worker key K;
// K heartbeats. Must hold: the administrator's signed `GET /v1/admin/state` — and the same read
// with its API key (R-BTN-159) — answers exactly what an administrator's session reads from
// `GET /v1/ui/state` at the same instant, K's runner included; an owner's key is `forbidden`, an
// unknown key `unauthenticated`, a key with no signature or bearer `unauthenticated`, and a POST
// `not-found`. Runs on both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { adminSession, apiKeyCall, cutover, hbBody, keyCall, makeApiKey, ORIGIN, payload, sessionCall, setAdminKeys, setClock, sha256, syncCall, syncToken, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const board = inject('board');
const T0 = Date.parse('2026-10-26T12:00:00Z');
let admin: TestKey;
let owner: TestKey;
let k: TestKey;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'ops-owner');
  k = await makeKey('ssh-ed25519', 'k');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [owner.publicKey] })).status).toBe(200);
  const ops = await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' });
  await syncCall('/v1/sync/board', payload('f'.repeat(40), null, board.states.A), ops);
  await cutover(1, 'ops');
  expect((await keyCall(owner, '/v1/owner/ops/grants', { public_key: k.publicKey, hostname: 'k-host', capabilities: ['agent-venue'] })).status).toBe(200);
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const hb = await hostCall(await signedRequest(k, `${ORIGIN}/v1/runner/heartbeat`, { created, body: JSON.stringify(hbBody('vm-a', { hostname: 'k-host', session_name: 'k',
    secret_hash: await sha256('s'), courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }] })) }));
  expect(hb.status).toBe(200);
});

describe('S-BTN-170 the dashboard state, read with an administrator’s key', () => {
  it('answers what an administrator’s session reads, with no session', async () => {
    const session = await adminSession(admin);
    const viaSession = await sessionCall(session, '/v1/ui/state');
    expect(viaSession.status).toBe(200);
    const viaKey = await keyCall(admin, '/v1/admin/state');
    expect(viaKey.status).toBe(200);
    expect(viaKey.json).toEqual(await viaSession.json());
    // Not an empty answer that happens to match: the registered repository and K's runner are in it.
    expect(JSON.stringify(viaKey.json)).toContain('immediately-run/ops');
    expect(JSON.stringify(viaKey.json)).toContain('k-host');
  });

  it('an administrator’s API key reads it as its signature does', async () => {
    const api = await makeApiKey('admin');
    await setAdminKeys(api.line);
    const res = await apiKeyCall(api.key, '/v1/admin/state');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).toContain('immediately-run/ops');
  });

  it('an owner’s key, an unknown key, no principal and a write are refused, with their codes', async () => {
    expect((await keyCall(owner, '/v1/admin/state')).json).toMatchObject({ code: 'forbidden' });
    expect((await keyCall(k, '/v1/admin/state')).json).toMatchObject({ code: 'unauthenticated' });
    const bare = await hostCall(new Request(`${ORIGIN}/v1/admin/state`));
    expect((await bare.json()) as Record<string, unknown>).toMatchObject({ code: 'unauthenticated' });
    expect((await keyCall(admin, '/v1/admin/state', {})).json).toMatchObject({ code: 'not-found' });
  });
});
