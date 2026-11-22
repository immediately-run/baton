// S-BTN-180 / S-BTN-182 (B-147): grants decide which legs a runner can take, on either host.
import { beforeEach, describe, expect, it } from 'vitest';
import { Git, ORIGIN, course, cutover, hbBody, keyCall, makeApiKey, placed, requestId, rows, setAdminKeys, setClock, sha256, withCore } from '../helpers';
import { call as hostCall } from '#host';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const TRUST = { role: 'trusted-runner', domain: 'lab:A_1' };
let owner: TestKey;
let runner: TestKey;
let other: TestKey;
const rolePath = (fingerprint: string) => `/v1/owner/docs/grants/${encodeURIComponent(fingerprint)}/role`;
const role = (key: TestKey, body: unknown) => keyCall(owner, rolePath(key.fingerprint), body, 'PUT');
const grant = (key: TestKey, hostname: string) => keyCall(owner, '/v1/owner/docs/grants', { public_key: key.publicKey, hostname, capabilities: ['agent-venue'] });
const SECRET = 'trusted-leg-fixture';

async function run(key: TestKey, path: string, body?: unknown) {
  const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/runner/${path}`, {
    created: T0 / 1000, method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Runner-Secret': SECRET }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() as Record<string, any> };
}

const claim = (key: TestKey, ticket: string) => run(key, 'claim', { ticket_id: `docs:${ticket}`, request_id: requestId() });
const denied = (result: Awaited<ReturnType<typeof run>>) => expect(result.json).toMatchObject({ code: 'not-eligible', rule: 'trusted' });

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  runner = await makeKey('ssh-ed25519', 'runner');
  other = await makeKey('ssh-ed25519', 'other');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await grant(runner, 'lab-a')).status).toBe(200);
  expect((await grant(other, 'lab-b')).status).toBe(200);
  for (const [key, hostname] of [[runner, 'lab-a'], [other, 'lab-b']] as const) {
    expect((await run(key, 'heartbeat', hbBody('vm-a', { hostname, secret_hash: await sha256(SECRET) }))).status).toBe(200);
  }
  const git = new Git();
  git.registry = [course(3, 3, { course: {
    start: 'filed', start_leg: 'prepare', end: ['done'], stations: { filed: {}, prepared: {}, done: {} },
    legs: { prepare: { from: ['filed'], to: 'prepared' }, land: { from: ['prepared'], to: 'done', trusted: true } },
  } })];
  git.add('T-1', {}, placed('filed', [], [['prepare', 'ready']]));
  git.add('T-2', {}, placed('prepared', [['prepare', 'prepared']], [['land', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-182 trusted legs', () => {
  it('offers only the matching kind, even after a role change, on both candidate paths', async () => {
    for (const reference of [false, true]) {
      await withCore(c => { c.claims.reference = reference; });
      expect((await role(runner, { role: 'runner' })).status).toBe(200);
      expect((await run(runner, 'recommendations')).json.recommendations).toMatchObject([{ ticket_id: 'docs:T-1' }]);
      denied(await claim(runner, 'T-2'));
      expect((await role(runner, TRUST)).status).toBe(200);
      expect((await run(runner, 'recommendations')).json.recommendations).toMatchObject([{ ticket_id: 'docs:T-2' }]);
      denied(await claim(runner, 'T-1'));
    }
  });

  it('refuses chaining into trust and completing a trusted run after demotion', async () => {
    const regular = await claim(other, 'T-1');
    const a = `claims/${regular.json.claim_id}`;
    expect((await run(other, `${a}/advance`, { leg: 'prepare' })).status).toBe(200);
    denied(await run(other, `${a}/advance`, { leg: 'land', reached: 'prepared' }));

    expect((await role(runner, TRUST)).status).toBe(200);
    const trusted = await claim(runner, 'T-2');
    expect(trusted.json.trusted).toBe(true);
    const b = `claims/${trusted.json.claim_id}`;
    expect((await run(runner, `${b}/advance`, { leg: 'land' })).status).toBe(200);
    expect(await rows('SELECT domain FROM claim_legs WHERE claim_id = ?', trusted.json.claim_id)).toEqual([{ domain: TRUST.domain }]);
    expect((await role(runner, { role: 'runner' })).status).toBe(200);
    denied(await run(runner, `${b}/end`, { end_reason: 'done', reached: 'done' }));
    expect((await role(runner, { ...TRUST, checker: true })).json.code).toBe('invalid-params');
    expect((await role(runner, { ...TRUST, domain: 'renamed' })).status).toBe(200);
    expect(await rows('SELECT domain FROM claim_legs WHERE claim_id = ?', trusted.json.claim_id)).toEqual([{ domain: TRUST.domain }]);
    expect((await run(runner, `${b}/end`, { end_reason: 'done', reached: 'done' })).status).toBe(200);
  });
});

describe('S-BTN-180 grant roles', () => {
  it('validates signed runner grants and keeps the checker domain exclusive', async () => {
    expect((await keyCall(runner, rolePath(other.fingerprint), TRUST, 'PUT')).status).not.toBe(200);
    expect((await role(runner, { role: 'trusted-runner' })).json.code).toBe('invalid-params');
    expect((await role(runner, { ...TRUST, domain: 'bad label' })).json.code).toBe('invalid-params');
    const api = await makeApiKey();
    expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: api.line, hostname: 'api', capabilities: [] })).status).toBe(200);
    expect((await keyCall(owner, rolePath(api.fingerprint), TRUST, 'PUT')).json.code).toBe('invalid-params');
    expect((await role(other, { role: 'runner', domain: TRUST.domain })).status).toBe(200);
    expect((await role(runner, { ...TRUST, checker: true })).json.code).toBe('invalid-params');
    expect((await role(other, { role: 'runner' })).status).toBe(200);
    expect((await role(runner, { ...TRUST, checker: true })).status).toBe(200);
    expect((await role(other, TRUST)).json.code).toBe('invalid-params');
    expect((await run(runner, 'recommendations')).json.recommendations).toEqual([]);
    denied(await claim(runner, 'T-1'));
    denied(await claim(runner, 'T-2'));
  });
});
