// S-BTN-180 / S-BTN-182 (B-147): grants decide which legs a runner can take, on either host.
import { beforeEach, describe, expect, it } from 'vitest';
import { Git, ORIGIN, course, cutover, hbBody, keyCall, makeApiKey, placed, requestId, rows, setAdminKeys, setClock, setHumanKeys, sha256, withCore } from '../helpers';
import { call as hostCall } from '#host';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const TRUST = { role: 'trusted-runner', domain: 'lab:A_1' };
let owner: TestKey;
let runner: TestKey;
let other: TestKey;
let git: Git;
const graph = {
  start: 'filed', start_leg: 'prepare', end: ['done'], stations: { filed: {}, prepared: {}, done: {} },
  legs: { prepare: { from: ['filed'], to: 'prepared' }, land: { from: ['prepared'], to: 'done', trusted: true } },
};
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
  git = new Git();
  git.registry = [course(3, 3, { course: graph })];
  git.add('T-1', {}, placed('filed', [], [['prepare', 'ready']]));
  git.add('T-2', {}, placed('prepared', [['prepare', 'prepared']], [['land', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-182 trusted legs', () => {
  it('refuses to advance a held claim after a sync moves its ticket to a different course', async () => {
    const held = await claim(other, 'T-1');
    expect(held.status).toBe(200);
    const path = `claims/${held.json.claim_id}`;
    expect((await run(other, `${path}/advance`, { leg: 'prepare' })).status).toBe(200);
    git.registry.push(course(3, 3, { id: 'ordinary', course: { ...graph, legs: { ...graph.legs, land: { ...graph.legs.land, trusted: false } } } }));
    git.add('T-1', { course_id: 'ordinary' }, placed('prepared', [['prepare', 'prepared']], [['land', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await run(other, `${path}/advance`, { leg: 'land', reached: 'prepared' })).json).toMatchObject({ code: 'not-eligible', rule_code: 'off-graph' });
    expect(await rows('SELECT leg, finished_at FROM claim_legs WHERE claim_id = ?', held.json.claim_id)).toEqual([{ leg: 'prepare', finished_at: null }]);
  });

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
  it('admits configured break-glass signatures only to the role route and only under a human entry', async () => {
    const key = await makeKey('ssh-ed25519', 'break-glass');
    await setHumanKeys(key);
    const setRole = () => keyCall(key, rolePath(runner.fingerprint), TRUST, 'PUT');
    expect((await setRole()).json.code).toBe('forbidden');
    const current = await withCore(c => c.policies.current('docs')!.policy);
    expect((await keyCall(owner, '/v1/owner/docs/policy', { base_version: 1, policy: { ...current, approvers: { ...current.approvers, trust: ['owner', 'human'] } } }, 'PUT')).status).toBe(200);
    expect((await setRole()).status).toBe(200);
    expect((await keyCall(key, '/v1/owner/docs/grants', { public_key: other.publicKey })).status).not.toBe(200);
  });

  it('remembers a trusted claim after its history is pruned and the grant is reissued', async () => {
    expect((await role(runner, TRUST)).status).toBe(200);
    const held = await claim(runner, 'T-2');
    expect(held.status).toBe(200);
    expect((await run(runner, `claims/${held.json.claim_id}/end`, { end_reason: 'released:requested', reached: 'prepared' })).status).toBe(200);
    expect(await rows('SELECT failed_attempt FROM claims WHERE id = ?', held.json.claim_id)).toEqual([{ failed_attempt: 0 }]);
    expect((await git.close('T-2', 'done').post()).status).toBe(200);
    // Put the closed ticket at the retention stage where its events are gone and its claims are due.
    await rows('DELETE FROM events WHERE claim_id = ?', held.json.claim_id);
    await rows('UPDATE closed_tickets SET claims_due_at = ? WHERE ticket_id = ?', T0, 'docs:T-2');
    await withCore(c => c.retention.prune());
    expect(await rows('SELECT id FROM claims WHERE id = ?', held.json.claim_id)).toEqual([]);
    expect((await keyCall(owner, `/v1/owner/docs/grants/${encodeURIComponent(runner.fingerprint)}/revoke`, {})).status).toBe(200);
    expect((await grant(runner, 'lab-a')).status).toBe(200);
    expect((await role(runner, { ...TRUST, checker: true })).json.code).toBe('invalid-params');
  });

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
