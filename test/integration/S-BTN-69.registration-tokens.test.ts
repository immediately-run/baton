import { beforeEach, describe, expect, it } from 'vitest';
import { call as hostCall } from '#host';
import { apiKeyCall, makeApiKey, ORIGIN, setAdminKeys, setClock, sha256, withCore } from '../helpers';
import { makeKey, signedRequest } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-19T12:00:00Z');
const DAY = 86_400_000;
const base = '/v1/owner/ops';
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
    const t = await mint({ uses: 2, capabilities: ['agent-venue'], max_tier: 'critical' });
    expect(t.status).toBe(200);
    const { id, token } = t.json;
    const stored = await withCore((c) => c.store.exec('SELECT secret_hash FROM registration_tokens WHERE id = ?', id).toArray()[0]);
    expect(stored.secret_hash).toBe(await sha256(token));
    const ssh = await makeKey('ssh-ed25519', 'registered');
    expect((await register(token, { name: 'ssh', public_key: ssh.publicKey })).json.grant)
      .toMatchObject({ repository_id: 'ops', accepted_at: T0, capabilities: ['authentication', 'create-pr', 'drivable-browser', 'llm-call'], max_tier: 2 });
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
