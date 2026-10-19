// S-BTN-126 people's API keys (BATON_SPEC §10.6 R-BTN-159, R-BTN-57, R-BTN-58): an administrator
// whose BATON_ADMIN_KEYS line is an API key's public line registers `ops` with an owner API key;
// that owner grants a worker SSH key K. Must hold: both API keys work as bearers on their own
// routes and nowhere else; a wrong secret, an unknown key and a malformed bearer are
// `unauthenticated`; an API key is never a worker's — refused on /v1/runner and as a grant's
// key; one role per key holds across kinds; an owner API key owns only its repository; an
// administrator's revoke stops an owner API key at its next call, and a key that leaves
// BATON_ADMIN_KEYS stops at once; a login link minted with an API key opens a session. Runs on
// both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { apiKeyCall, cutover, hbBody, makeApiKey, ORIGIN, setAdminKeys, setClock, sha256, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

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
  await cutover(1, 'ops');
});

describe('S-BTN-126 people’s API keys', () => {
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

  it('an API key is never a worker’s', async () => {
    // Not on the runner's routes: they take a signature (or the transition's worker token) only.
    const runner = await hostCall(new Request(`${ORIGIN}/v1/runner/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${owner.key}`, 'Content-Type': 'application/json' }, body: '{}' }));
    expect(runner.status).toBe(401);
    // Not as a grant's key: a worker's key is an SSH key.
    const other = await makeApiKey();
    expect((await apiKeyCall(owner.key, '/v1/owner/ops/grants', { public_key: other.line, capabilities: [] })).json.code).toBe('invalid-params');
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
