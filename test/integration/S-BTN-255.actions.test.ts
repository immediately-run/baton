// S-BTN-255 the session's actions (B-204; BATON_SPEC §11.3 R-BTN-129): `GET /v1/actions`
// (`actions.list`) answers a dashboard session the registry entries it may call — `id`,
// `summary`, the matching caller, `effect`, `input`, `http` and `ui` — and nothing else draws
// the dashboard's controls. Must hold: an administrator's session is answered every entry
// listing its role, `ticket.hold` and `claim.force-reap` with their `ui.view` among them, each
// `view` a screen of `screens.ts`, `delegated` on none; every entry it is shown is one whose
// route admits the session; a key — an administrator's, an owner's, a runner's — is
// `forbidden`, an unknown one `unauthenticated`. An owner's session (B-76) is covered by
// test/unit/actions.test.ts, which filters the table by role. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, actionsFor, type ListedAction } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { adminSession, keyCall, makeApiKey, ORIGIN, sessionCall, setAdminKeys, setClock, TOKENS, withCore } from '../helpers';
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

  it('a key is not answered: forbidden for a known one, unauthenticated for an unknown one', async () => {
    for (const key of [admin, owner]) {
      const res = await read(key, '/v1/actions');
      expect([res.status, res.json.code]).toEqual([403, 'forbidden']);
    }
    const token = await hostCall(new Request(`${ORIGIN}/v1/actions`, { headers: { Authorization: `Bearer ${TOKENS['vm-a']}` } }));
    expect(token.status).toBe(403);
    // A bearer Baton does not know — what a delegated key is until B-124 builds one (R-BTN-130).
    const api = await makeApiKey();
    expect((await hostCall(new Request(`${ORIGIN}/v1/actions`, { headers: { Authorization: `Bearer ${api.key}` } }))).status).toBe(401);
    expect((await read(await makeKey('ssh-ed25519', 'stranger'), '/v1/actions')).status).toBe(401);
    expect((await hostCall(new Request(`${ORIGIN}/v1/actions`))).status).toBe(401);
  });
});
