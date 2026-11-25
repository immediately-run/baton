import { beforeEach, describe, expect, inject, it } from 'vitest';
import { call as hostCall } from '#host';
import { apiKeyCall, claimRow, cutover, hbBody, makeApiKey, ORIGIN, payload, setAdminKeys, setClock, sha256, syncCall, tick, withCore } from '../helpers';
import { makeKey, signedRequest } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-19T12:00:00Z');
const DAY = 86_400_000;
const base = '/v1/owner/ops';
const board = inject('board');
let owner: Awaited<ReturnType<typeof makeApiKey>>;
let admin: Awaited<ReturnType<typeof makeApiKey>>;

const mint = (scope = {}) => apiKeyCall(owner.key, `${base}/tokens`, { role: 'runner', ...scope });
async function register(token: string, body: unknown, bearer?: string) {
  const headers = { 'Content-Type': 'application/json', Authorization: bearer ? `Bearer ${bearer}` : `Baton-Token ${token}`,
    ...(bearer ? { 'Baton-Registration-Token': token } : {}) };
  const res = await hostCall(new Request(`${ORIGIN}/v1/register`, { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeApiKey();
  owner = await makeApiKey();
  await setAdminKeys(admin.line);
  for (const id of ['ops', 'other']) {
    const result = await apiKeyCall(admin.key, '/v1/admin/repositories', { id, github: `immediately-run/${id}`, default_branch: 'main',
      sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [owner.line] });
    expect(result.status, JSON.stringify(result.json)).toBe(200);
  }
});

describe('S-BTN-69 registration and API keys', () => {
  it('scopes SSH and API registration, stores hashes, and revokes both credentials', async () => {
    const t = await mint({ uses: 2, capabilities: ['agent-venue'] });
    expect(t.status).toBe(200);
    const { id, token } = t.json;
    const stored = await withCore((c) => c.store.exec('SELECT secret_hash FROM registration_tokens WHERE id = ?', id).toArray()[0]);
    expect(stored.secret_hash).toBe(await sha256(token));
    const ssh = await makeKey('ssh-ed25519', 'registered');
    expect((await register(token, { name: 'ssh', public_key: ssh.publicKey })).json.grant)
      .toMatchObject({ repository_id: 'ops', accepted_at: T0, capabilities: ['authentication', 'create-pr', 'drivable-browser', 'llm-call'] });
    expect((await register(token, { name: 'api', api_key: true, capabilities: ['human-operator'] })).status).toBe(400);
    const api = await register(token, { name: 'api', api_key: true });
    expect(api.status).toBe(200);
    expect((await register(token, { name: 'extra', api_key: true })).status).toBe(401);
    const check = '/v1/runner/tickets/ops:B-1/holder';
    expect((await apiKeyCall(api.json.api_key, check)).status).toBe(200);
    expect((await apiKeyCall(api.json.api_key, '/v1/runner/tickets/other:B-1/holder')).status).toBe(403);
    const signed = async () => hostCall(await signedRequest(ssh, ORIGIN + check, { created: T0 / 1000 }));
    expect((await signed()).status).toBe(200);
    expect((await apiKeyCall(owner.key, `/v1/owner/other/tokens/${id}/revoke`, { confirm: true })).status).toBe(404);
    expect((await apiKeyCall(owner.key, `${base}/tokens/${id}/revoke`, { confirm: true })).status).toBe(200);
    expect((await apiKeyCall(api.json.api_key, check)).status).toBe(401);
    expect((await signed()).status).toBe(401);
  });

  it('renews only with the current key and does not spend a use', async () => {
    const { json: { token } } = await mint({ uses: 2 });
    const initial = await register(token, { name: 'api', api_key: true });
    expect(initial.status).toBe(200);
    expect((await register(token, { name: 'api', api_key: true })).status).toBe(409);
    const rotated = await register(token, { name: 'api', api_key: true }, initial.json.api_key);
    expect(rotated.status).toBe(200);
    expect(rotated.json.credential_id).not.toBe(initial.json.credential_id);
    expect((await register(token, { name: 'another', api_key: true })).status).toBe(200);
    expect((await register(token, { name: 'api', api_key: true }, rotated.json.api_key)).status).toBe(200);
    expect((await register(token, { name: 'api', api_key: true }, initial.json.api_key)).status).toBe(401);
  });

  it('a token-registered API runner can heartbeat and claim a modeled ticket', async () => {
    expect((await apiKeyCall(admin.key, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.line] })).status).toBe(200);
    await syncCall('/v1/sync/board', payload('f'.repeat(40), null, board.states.A));
    await cutover();
    const t = await apiKeyCall(owner.key, '/v1/owner/docs/tokens', { role: 'runner', capabilities: ['agent-venue'] });
    expect(t.status).toBe(200);
    const key = await register(t.json.token, { name: 'registered', api_key: true });
    expect(key.status).toBe(200);
    const beat = await apiKeyCall(key.json.api_key, '/v1/runner/heartbeat', hbBody('vm-a', {
      hostname: 'registered', session_name: 'registered', secret_hash: await sha256('registered-secret'),
    }));
    expect(beat.status).toBe(200);
    const claim = await hostCall(new Request(`${ORIGIN}/v1/runner/claim`, {
      method: 'POST', headers: { Authorization: `Bearer ${key.json.api_key}`, 'X-Runner-Secret': 'registered-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: 'registered-key-1' }),
    }));
    expect(await claim.json()).toMatchObject({ ticket_id: expect.stringMatching(/^docs:/) });
  });

  it('rejects the retired tier parameter on a token', async () => {
    expect((await mint({ max_tier: 'critical' })).status).toBe(400);
  });

  it('installs a prepared API public line without returning or storing the secret', async () => {
    const { json: { token } } = await mint();
    const old = await register(token, { name: 'api', api_key: true });
    const prepared = await makeApiKey();
    const check = '/v1/runner/tickets/ops:B-1/holder';
    expect((await apiKeyCall(owner.key, `${base}/settings`, { api_keys: false }, 'PUT')).status).toBe(200);
    expect((await register(token, { name: 'api', public_key: prepared.line }, old.json.api_key)).status).toBe(403);
    expect((await apiKeyCall(owner.key, `${base}/settings`, { api_keys: true }, 'PUT')).status).toBe(200);
    expect((await apiKeyCall(old.json.api_key, check)).status).toBe(200);
    const rotated = await register(token, { name: 'api', public_key: prepared.line }, old.json.api_key);
    expect(rotated.status).toBe(200);
    expect(rotated.json.credential_id).toBe(prepared.key.slice(0, 20));
    expect(rotated.json).not.toHaveProperty('api_key');
    expect(await withCore((c) => c.store.exec('SELECT public_key FROM credentials WHERE id = ?', rotated.json.credential_id).toArray()[0].public_key)).toBe(prepared.line);
    expect((await apiKeyCall(prepared.key, check)).status).toBe(200);
    expect((await apiKeyCall(old.json.api_key, check)).status).toBe(401);
  });

  it('refuses API-key access only on the repository that disabled it', async () => {
    const runner = await makeApiKey();
    for (const repo of ['ops', 'other']) {
      expect((await apiKeyCall(owner.key, `/v1/owner/${repo}/grants`, {
        hostname: 'shared-runner', public_key: runner.line, capabilities: [],
      })).status).toBe(200);
    }
    expect((await apiKeyCall(owner.key, `${base}/settings`, { api_keys: false }, 'PUT')).status).toBe(200);
    for (const [repo, status] of [['ops', 403], ['other', 200]] as const) {
      expect((await apiKeyCall(runner.key, `/v1/runner/tickets/${repo}:B-1/holder`)).status).toBe(status);
      expect((await apiKeyCall(runner.key, `/v1/repositories/${repo}/blocked`)).status).toBe(status);
      const beat = hbBody('vm-a', { hostname: 'shared-runner', secret_hash: await sha256('shared-secret'),
        courses: [{ repository: repo, course: 'roadmap-pr', version: 3 }] });
      expect((await apiKeyCall(runner.key, '/v1/runner/heartbeat', beat)).status).toBe(status);
    }
  });

  it.each(['fence acknowledgment', 'fence expiry', 'lease expiry'])('scopes %s to API-key policy', async (scenario) => {
    expect((await apiKeyCall(admin.key, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.line] })).status).toBe(200);
    await syncCall('/v1/sync/board', payload('f'.repeat(40), null, board.states.A));
    await cutover();
    const runner = await makeApiKey();
    for (const repo of ['docs', 'other']) {
      expect((await apiKeyCall(owner.key, `/v1/owner/${repo}/grants`, {
        hostname: 'shared-runner', public_key: runner.line, capabilities: ['agent-venue'],
      })).status).toBe(200);
    }
    const secret = 'shared-secret';
    const headers = { Authorization: `Bearer ${runner.key}`, 'X-Runner-Secret': secret, 'Content-Type': 'application/json' };
    const post = (path: string, body: unknown) => hostCall(new Request(ORIGIN + path, { method: 'POST', headers, body: JSON.stringify(body) }));
    const beat = hbBody('vm-a', { hostname: 'shared-runner', secret_hash: await sha256(secret) });
    expect((await post('/v1/runner/heartbeat', beat)).status).toBe(200);
    const claim = await post('/v1/runner/claim', { request_id: 'shared-key-1' });
    const { claim_id, ticket_id } = await claim.json() as { claim_id: number; ticket_id: string };
    expect(ticket_id).toMatch(/^docs:/);
    const fenced = scenario !== 'lease expiry';
    if (fenced) await withCore((c) => c.claims.forceReap('admin:test', claim_id, { confirm: true }));
    const allowKeys = (allow: boolean) => apiKeyCall(owner.key, '/v1/owner/docs/settings', { api_keys: allow }, 'PUT');
    expect((await allowKeys(false)).status).toBe(200);
    await setClock(T0 + 899_999);
    const ack = { ...beat, courses: [{ repository: 'other', course: 'roadmap-pr', version: 3 }],
      fenced: fenced ? [{ claim_id, terminated: true }] : [] };
    expect((await post('/v1/runner/heartbeat', ack)).status).toBe(200);
    await tick();
    expect(await claimRow(claim_id)).toMatchObject({ status: fenced ? 'reaped' : 'active', fence_pending: Number(fenced) });
    if (scenario === 'fence acknowledgment') {
      expect((await allowKeys(true)).status).toBe(200);
      expect((await post('/v1/runner/heartbeat', ack)).status).toBe(200);
    } else {
      await setClock(T0 + 900_000);
      await tick();
      expect(await withCore((c) => c.store.exec('SELECT reaped_at FROM runners WHERE hostname = ?', 'shared-runner').toArray()[0].reaped_at)).toBeNull();
    }
    expect(await claimRow(claim_id)).toMatchObject({ status: 'reaped', fence_pending: 0 });
  });

  it('honors token and key lifetimes and rejects API runners at the next call', async () => {
    expect((await mint({ role: 'courier' })).status).toBe(400);
    expect((await mint({ capabilities: ['capability:human-operator'] })).status).toBe(400);
    expect((await mint({ uses: 101 })).status).toBe(400);
    const { json: { token } } = await mint({ ttl_s: 1, uses: 3, grant_ttl_s: 90 * DAY / 1000 });
    const { json: { api_key } } = await register(token, { name: 'api', api_key: true });
    const check = '/v1/runner/tickets/ops:B-1/holder';
    expect((await apiKeyCall(api_key, check)).status).toBe(200);
    const settings = async (allow: boolean) => hostCall(new Request(`${ORIGIN}${base}/settings`, { method: 'PUT',
      headers: { Authorization: `Bearer ${owner.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ api_keys: allow }) }));
    expect((await settings(false)).status).toBe(200);
    expect((await apiKeyCall(api_key, check)).status).toBe(403);
    expect((await register(token, { name: 'another', api_key: true })).status).toBe(403);
    expect((await settings(true)).status).toBe(200);
    await setClock(T0 + 6 * DAY);
    expect((await register(token, { name: 'another', api_key: true })).status).toBe(401);
    expect((await apiKeyCall(api_key, check)).status).toBe(200);
    await setClock(T0 + 13 * DAY);
    expect((await apiKeyCall(api_key, check)).status).toBe(401);
  });

  it('records a burst on the eleventh registration', async () => {
    const { json: { token } } = await mint({ uses: 12 });
    for (let n = 0; n < 12; n++) expect((await register(token, { name: `burst-${n}`, api_key: true })).status).toBe(200);
    const events = await withCore((c) => c.store.exec(`SELECT json_extract(detail_json, '$.act') AS act FROM events
      WHERE kind = 'admin' AND repository_id = 'ops'`).toArray().map((r) => r.act));
    expect(events.filter((a) => a === 'runner-registered')).toHaveLength(12);
    expect(events.filter((a) => a === 'baton.token-burst')).toHaveLength(1);
  });

  it('rechecks freeze after the request body is read for each token write', async () => {
    const { json: { id, token } } = await mint({ uses: 2 });
    const run = (path: string, headers: Record<string, string>, body: unknown) => withCore(async (c) => {
      const req = new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const read = req.json.bind(req);
      req.json = async <T>() => {
        const parsed = await read<T>();
        c.store.transaction(() => c.ownerState.freeze('admin:test'));
        return parsed;
      };
      const res = await c.fetch(req);
      c.store.transaction(() => c.ownerState.unfreeze('admin:test'));
      return (await res.json() as { code: string }).code;
    });
    const ownerHeaders = { 'X-Baton-Api-Key': owner.key };
    expect(await run(`${base}/tokens`, ownerHeaders, { role: 'runner' })).toBe('frozen');
    expect(await run(`${base}/tokens/${id}/revoke`, ownerHeaders, { confirm: true })).toBe('frozen');
    expect(await run('/v1/register', { Authorization: `Baton-Token ${token}` }, { name: 'racing', api_key: true })).toBe('frozen');
    expect(await withCore((c) => c.store.exec('SELECT uses_left, revoked_at FROM registration_tokens').toArray())).toEqual([{ uses_left: 2, revoked_at: null }]);
    expect((await register(token, { name: 'racing', api_key: true })).status).toBe(200);
  });

  it('S-BTN-198: retirement exhausts tokens but does not revoke their key', async () => {
    const { json: { id, token } } = await mint({ uses: 2 });
    const key = await register(token, { name: 'before-retire', api_key: true });
    expect(key.status).toBe(200);
    expect((await apiKeyCall(admin.key, '/v1/admin/repositories', { id: 'ops', retire: true, confirm: true })).status).toBe(200);
    expect((await register(token, { name: 'after-retire', api_key: true })).status).toBe(401);
    expect(await withCore((c) => c.store.exec(`SELECT t.uses_left, c.revoked_at FROM registration_tokens t
      JOIN credentials c ON c.registration_token_id = t.id WHERE t.id = ?`, id).toArray())).toEqual([{ uses_left: 0, revoked_at: null }]);
  });
});
