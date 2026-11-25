// S-BTN-270 logout (B-206; BATON_SPEC §11.4 R-BTN-155, §12.4 R-BTN-16): `POST /v1/ui/logout`
// (`ui.logout`) ends the calling dashboard session and nothing else. Must hold: a signed-in
// session's logout answers `{ok: true}`, withheld from caches, and clears the session cookie
// with the attributes it was set with; from that request on the cookie's value is
// `unauthenticated` on a session route and on a repository read, and a second logout with it
// is `unauthenticated` too; another session of the same key stands; the session's row is
// revoked, not deleted, and the logout is recorded; a logout with no JSON body or from a
// foreign Origin is `forbidden` and ends nothing (R-BTN-16); with no cookie it is
// `unauthenticated`; a `GET` of the route is not served; and `GET /v1/actions` lists
// `ui.logout` among the session's entries. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, call, ORIGIN, rows, sessionCall, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const JSON_BODY = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } as const;
let admin: TestKey;
let cookie: string;

const stands = async (c: string) => (await sessionCall(c, '/v1/ui/session')).status;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  cookie = await adminSession(admin);
});

describe('S-BTN-270 logout (B-206)', () => {
  it('ends the caller’s own session and clears its cookie', async () => {
    const other = await adminSession(admin);
    expect([await stands(cookie), await stands(other)]).toEqual([200, 200]);
    expect((await sessionCall(cookie, '/v1/repositories')).status).toBe(200);

    await setClock(T0 + 1000);
    const res = await sessionCall(cookie, '/v1/ui/logout', JSON_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('Set-Cookie')).toBe('__Host-baton_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    // The cookie's value authorizes nothing from here on — a session route, a repository read.
    expect(await stands(cookie)).toBe(401);
    expect((await sessionCall(cookie, '/v1/repositories')).status).toBe(401);
    const again = await sessionCall(cookie, '/v1/ui/logout', JSON_BODY);
    expect([again.status, ((await again.json()) as { code: string }).code]).toEqual([401, 'unauthenticated']);
    // Its own session only: the key's other session stands.
    expect(await stands(other)).toBe(200);

    // Revoked, not deleted; and recorded.
    const sessions = await rows<{ revoked_at: number | null }>('SELECT revoked_at FROM dashboard_sessions ORDER BY created_at, revoked_at');
    expect(sessions.map((s) => s.revoked_at).sort()).toEqual([T0 + 1000, null].sort());
    const logged = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'admin' AND detail_json LIKE '%"logout"%'`);
    expect(logged).toHaveLength(1);
  });

  it('is a state-changing session request: JSON from this origin, with a session (R-BTN-16)', async () => {
    const plain = await sessionCall(cookie, '/v1/ui/logout', { method: 'POST' });
    expect([plain.status, ((await plain.json()) as { code: string }).code]).toEqual([403, 'forbidden']);
    const foreign = await call('/v1/ui/logout', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
    expect(foreign.status).toBe(403);
    expect(await stands(cookie)).toBe(200); // neither ended it

    const none = await call('/v1/ui/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{}' });
    expect([none.status, ((await none.json()) as { code: string }).code]).toEqual([401, 'unauthenticated']);

    const get = await sessionCall(cookie, '/v1/ui/logout');
    expect(get.status).not.toBe(200);
    expect(await stands(cookie)).toBe(200);
  });

  it('is in the session’s registry entries as ui.logout', async () => {
    const res = await sessionCall(cookie, '/v1/actions');
    expect(res.status).toBe(200);
    const { actions } = (await res.json()) as { actions: { id: string; effect: string; http: { method: string; path: string }; ui?: unknown }[] };
    const logout = actions.find((a) => a.id === 'ui.logout');
    expect(logout).toMatchObject({ effect: 'write', http: { method: 'POST', path: '/v1/ui/logout' } });
    expect(logout?.ui).toBeUndefined(); // the frame's footer draws it; no screen's control
  });
});
