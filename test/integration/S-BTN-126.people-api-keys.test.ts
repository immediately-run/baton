// S-BTN-126 API keys beside SSH keys (BATON_SPEC §10.6 R-BTN-159, R-BTN-57, R-BTN-58): an administrator
// whose BATON_ADMIN_KEYS line is an API key's public line registers `ops` with an owner API key;
// that owner grants a worker SSH key K and a worker API key W. Must hold: both people's API keys
// work as bearers on their own routes; a wrong secret, an unknown key and a malformed bearer are
// `unauthenticated`; W heartbeats and claims by bearer with its worker secret, and never syncs or
// delivers (R-BTN-117); one role per key holds across kinds; an owner API key owns only its repository; an
// administrator's revoke stops an owner API key at its next call, and a key that leaves
// BATON_ADMIN_KEYS stops at once; a login link minted with an API key opens a session. Runs on
// both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { apiKeyCall, cutover, hbBody, makeApiKey, ORIGIN, payload, setAdminKeys, setClock, sha256, syncCall, syncToken, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const board = inject('board');
const T0 = Date.parse('2026-10-19T12:00:00Z');
let admin: Awaited<ReturnType<typeof makeApiKey>>;
let owner: Awaited<ReturnType<typeof makeApiKey>>;
let k: TestKey;

async function workerAs(key: TestKey, path: string, body?: unknown) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeApiKey('admin');
  owner = await makeApiKey('ops owner');
  k = await makeKey('ssh-ed25519', 'k');
  await setAdminKeys(admin.line);
  expect((await apiKeyCall(admin.key, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [owner.line] })).status).toBe(200);
  const ops = await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' });
  await syncCall('/v1/sync/board', payload('f'.repeat(40), null, board.states.A), ops);
  await cutover(1, 'ops');
});

describe('S-BTN-126 API keys beside SSH keys', () => {
  it('an administrator’s and an owner’s API keys work as bearers on their own routes', async () => {
    const grant = await apiKeyCall(owner.key, '/v1/owner/ops/grants', { public_key: k.publicKey, hostname: 'k-host', capabilities: ['agent-venue'] });
    expect(grant.status).toBe(200);
    // The worker K still signs (R-BTN-13): its heartbeat on ops is accepted.
    const hb = await workerAs(k, '/v1/runner/heartbeat', hbBody('vm-a', { hostname: 'k-host', session_name: 'k', secret_hash: await sha256('s'),
      courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }] }));
    expect(hb.status).toBe(200);
    // The owner key owns ops only, and is no administrator's.
    expect((await apiKeyCall(owner.key, '/v1/owner/docs/grants', { public_key: k.publicKey, capabilities: [] })).json.code).toBe('forbidden');
    expect((await apiKeyCall(owner.key, '/v1/admin/grants', { repository: 'ops', public_key: k.publicKey, capabilities: [] })).json.code).toBe('forbidden');
    // A login link minted with the administrator's API key opens a session.
    const link = await apiKeyCall(admin.key, '/v1/admin/login-links', {});
    const token = (link.json.url as string).split('#')[1];
    const login = await hostCall(new Request(`${ORIGIN}/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ token }) }));
    expect(login.status).toBe(200);
  });

  it('a wrong secret, an unknown key and a malformed bearer are unauthenticated', async () => {
    const wrong = `${owner.key.slice(0, 21)}${'0'.repeat(64)}`;
    expect((await apiKeyCall(wrong, '/v1/owner/ops/grants', { public_key: k.publicKey, capabilities: [] })).json.code).toBe('unauthenticated');
    const stranger = await makeApiKey();
    expect((await apiKeyCall(stranger.key, '/v1/admin/repositories', { id: 'x', github: 'a/x', owner_keys: [owner.line] })).json.code).toBe('unauthenticated');
    expect((await apiKeyCall('bak_short', '/v1/admin/repositories', {})).json.code).toBe('unauthenticated');
    const bare = await hostCall(new Request(`${ORIGIN}/v1/admin/repositories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    expect(bare.status).toBe(401);
  });

  it('a worker may hold an API key: it works where granted, and never syncs or delivers', async () => {
    const w = await makeApiKey('w');
    expect((await apiKeyCall(owner.key, '/v1/owner/ops/grants', { public_key: w.line, hostname: 'w-host', capabilities: ['agent-venue'] })).status).toBe(200);
    const hb = await apiKeyCall(w.key, '/v1/runner/heartbeat', hbBody('vm-a', { hostname: 'w-host', session_name: 'w', secret_hash: await sha256('w-secret'),
      courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }] }));
    expect(hb.status).toBe(200);
    const asWorker = (path: string, body: unknown) => hostCall(new Request(ORIGIN + path, { method: 'POST',
      headers: { Authorization: `Bearer ${w.key}`, 'X-Worker-Secret': 'w-secret', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const claim = await asWorker('/v1/runner/claim', { request_id: 'req-w-0001' });
    expect(await claim.json()).toMatchObject({ ticket_id: expect.stringMatching(/^ops:/) });
    // A wrong secret beside the right key is refused as any worker's is (R-BTN-14).
    const wrong = await hostCall(new Request(`${ORIGIN}/v1/runner/claim`, { method: 'POST',
      headers: { Authorization: `Bearer ${w.key}`, 'X-Worker-Secret': 'nope', 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'req-w-0002' }) }));
    expect(wrong.status).toBe(401);
    // R-BTN-117: syncing and delivering stay with signed machine keys.
    expect((await asWorker('/v1/sync/board', {})).status).toBe(401);
    expect((await asWorker('/v1/courier/deliveries', {})).status).toBe(401);
    // An API key not granted is no worker.
    const stranger = await makeApiKey();
    expect((await apiKeyCall(stranger.key, '/v1/runner/heartbeat', {})).status).toBe(401);
    // An owner's API key is never a worker's (one role per key).
    expect((await apiKeyCall(owner.key, '/v1/owner/ops/grants', { public_key: owner.line, hostname: 'o-host', capabilities: [] })).json.code).toBe('conflict');
  });

  it('one role per key holds across kinds', async () => {
    // The administrator's API key may not become an owner's.
    expect((await apiKeyCall(owner.key, '/v1/owner/ops/owners', { public_key: admin.line })).json.code).toBe('conflict');
    // An SSH owner beside the API-key owner: both own ops.
    const ssh = await makeKey('ssh-ed25519', 'ssh-owner');
    expect((await apiKeyCall(owner.key, '/v1/owner/ops/owners', { public_key: ssh.publicKey })).status).toBe(200);
  });

  it('revoking an owner API key, or removing an administrator’s line, stops it at its next call', async () => {
    expect((await apiKeyCall(admin.key, `/v1/admin/keys/${owner.fingerprint}/revoke`, {})).status).toBe(200);
    const after = await apiKeyCall(owner.key, '/v1/owner/ops/grants', { public_key: k.publicKey, capabilities: [] });
    expect([401, 403]).toContain(after.status);
    await setAdminKeys();
    expect((await apiKeyCall(admin.key, '/v1/admin/login-links', {})).json.code).toBe('unauthenticated');
  });
});
