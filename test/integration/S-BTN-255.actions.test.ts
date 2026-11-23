// S-BTN-255 the session's actions (B-204; BATON_SPEC §11.3 R-BTN-129): `GET /v1/actions`
// (`actions.list`) answers a dashboard session the registry entries it may call — `id`,
// `summary`, the matching caller, `effect`, `input`, `http` and `ui` — and nothing else draws
// the dashboard's controls. Must hold: an administrator's session is answered every entry
// listing its role, `ticket.hold` and `claim.force-reap` with their `ui.view` among them, each
// `view` a screen of `screens.ts`, `delegated` on none; every entry it is shown is one whose
// route admits the session. S-BTN-100: SSH and API keys see their own entries; unknown keys
// are `unauthenticated`. An owner's session (B-76) is covered by
// test/unit/actions.test.ts, which filters the table by role. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, actionsFor, type ListedAction } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { adminSession, apiKeyCall, keyCall, makeApiKey, ORIGIN, sessionCall, setAdminKeys, setClock, TOKENS, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
let admin: TestKey;
let owner: TestKey;
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
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  cookie = await adminSession(admin);
});

describe('S-BTN-255 the session’s actions (B-204)', () => {
  it('an administrator’s session is answered its entries, with ui and without delegated', async () => {
    const res = await sessionCall(cookie, '/v1/actions');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: ListedAction[]; session: { role: string } };
    expect(body.session).toEqual({ role: 'administrator' });
    // The registry, filtered for the role — as the table holds it.
    expect(body.actions).toEqual(JSON.parse(JSON.stringify(actionsFor('administrator'))));
    const by = new Map(body.actions.map((a) => [a.id, a]));
    expect(by.get('ticket.hold')).toMatchObject({
      effect: 'write', http: { method: 'POST', path: '/v1/ui/overrides/{ticket}', match: { hold: true } },
      callers: [{ principal: 'session', scope: 'instance' }], ui: { view: ['repository/tickets/{ticket}'] },
    });
    expect(by.get('claim.force-reap')).toMatchObject({ effect: 'destructive', ui: { view: ['repository/tickets/{ticket}'] } });
    expect(by.get('leg.stop')!.ui!.view).toEqual(['repository/tickets/{ticket}', 'repository/runners/{runner}']);
    expect(by.get('runner.status-request')!.http.match).toEqual({ kind: 'status_request' });
    expect(by.get('repo.cutover')!.ui!.view).toEqual(['repository/sync']);
    expect(by.get('repo.list')).toMatchObject({ effect: 'read', http: { method: 'GET', path: '/v1/repositories' } });
    const screens = new Set(SCREENS.map((s) => s.id));
    for (const a of body.actions) {
      expect([a.id, 'delegated' in a]).toEqual([a.id, false]);
      expect([a.id, a.callers.length, a.callers[0].principal]).toEqual([a.id, 1, 'session']);
      expect([a.id, a.callers[0].roles]).toEqual([a.id, expect.arrayContaining(['administrator'])]);
      for (const v of a.ui?.view ?? []) expect([a.id, v, screens.has(v)]).toEqual([a.id, v, true]);
      expect(typeof a.summary).toBe('string');
      expect(a.input.type).toBe('object');
    }
    // Every entry of the table lists a session of some role: an administrator is shown all
    // that list its own.
    expect(body.actions.length).toBe(ACTIONS.filter((a) => a.callers.some((c) => c.principal === 'session' && c.roles?.includes('administrator'))).length);
  });

  it('a caller is never shown a read it cannot take: each listed GET without parameters answers the session', async () => {
    const body = (await (await sessionCall(cookie, '/v1/actions')).json()) as { actions: ListedAction[] };
    for (const a of body.actions.filter((x) => x.http.method === 'GET' && x.id !== 'repo.schemas')) {
      const path = a.http.path.replace('{repository}', 'docs').replace('{ticket}', 'NOPE').replace('{leg}', 'implement');
      const res = await sessionCall(cookie, path);
      // Admitted: the answer is the read's own (a ticket that is not there is `not-found`),
      // never the front's or the core's refusal of the principal.
      expect([a.id, [200, 404].includes(res.status)]).toEqual([a.id, true]);
    }
  });

  it('S-BTN-100: a signed key sees its role’s entries, never session-only or other roles’ entries', async () => {
    const a = await read(admin, '/v1/actions');
    const o = await read(owner, '/v1/actions');
    expect(a.status).toBe(200);
    expect(o.status).toBe(200);
    expect(a.json.actions.map((entry: ListedAction) => entry.id)).toContain('admin.repo.list');
    expect(o.json.actions.map((entry: ListedAction) => entry.id)).toContain('condition.list');
    expect(o.json.actions.map((entry: ListedAction) => entry.id)).not.toContain('admin.repo.list');
    for (const [result, principal] of [[a, 'administrator'], [o, 'owner']] as const) {
      expect(result.json.session).toBeNull();
      for (const entry of result.json.actions as ListedAction[]) {
        expect(entry.callers).toEqual([expect.objectContaining({ principal })]);
      }
    }
  });

  it('S-BTN-100: the owner API key lists the same actions until removed', async () => {
    const api = await makeApiKey();
    expect((await keyCall(owner, '/v1/owner/docs/owners', { public_key: api.line })).status).toBe(200);
    const signed = await read(owner, '/v1/actions');
    const bearer = await apiKeyCall(api.key, '/v1/actions');
    expect(bearer).toEqual(signed);
    expect((await keyCall(owner, '/v1/owner/docs/owners', { fingerprint: api.fingerprint, remove: true })).status).toBe(200);
    expect(await apiKeyCall(api.key, '/v1/actions')).toMatchObject({ status: 401, json: { code: 'unauthenticated' } });
  });

  it('rejects legacy runner tokens and unauthenticated requests', async () => {
    const token = await hostCall(new Request(`${ORIGIN}/v1/actions`, { headers: { Authorization: `Bearer ${TOKENS['vm-a']}` } }));
    expect(token.status).toBe(403);
    const api = await makeApiKey();
    expect((await hostCall(new Request(`${ORIGIN}/v1/actions`, { headers: { Authorization: `Bearer ${api.key}` } }))).status).toBe(401);
    expect((await read(await makeKey('ssh-ed25519', 'stranger'), '/v1/actions')).status).toBe(401);
    expect((await hostCall(new Request(`${ORIGIN}/v1/actions`))).status).toBe(401);
  });

  it('S-BTN-100: the dashboard dispatches one registered action and enforces its confirmation', async () => {
    const post = async (path: string, body: unknown) => {
      const res = await sessionCall(cookie, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return [res.status, (await res.json() as { code: string }).code];
    };
    expect(await post('/v1/ui/unregistered-action', {})).toEqual([404, 'not-found']);
    expect(await post('/v1/ui/overrides/docs:T-1', { hold: true, expedite: true })).toEqual([400, 'invalid-params']);
    expect(await post('/v1/ui/overrides/docs:T-1', { hold: true, cancel: true })).toEqual([400, 'invalid-params']);
    const stop = { to_runner_id: 1, kind: 'release', payload: { ticket_id: 'docs:T-1', reason: 'requested' } };
    expect(await post('/v1/ui/messages', stop)).toEqual([428, 'confirm-required']);
    expect(await post('/v1/ui/messages', { ...stop, confirm: 'true' })).toEqual([428, 'confirm-required']);
    expect(await post('/v1/ui/messages', { ...stop, confirm: true })).toEqual([404, 'not-found']);
  });
});
