// S-BTN-308 sign-in through Cloudflare Access (BATON_SPEC §15; R-BTN-155, R-BTN-16, R-BTN-57).
// Run against both hosts, using test JWT keys and no live Access requests.
import { importJWK, SignJWT, generateKeyPair } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '#host';
import { verifyAccess } from '../../src/core/auth';
import { front } from '../../src/core/front';
import type { AccessIdentities } from '../../src/core/ports';
import { accessToken, adminSession, call, makeApiKey, ORIGIN, rows, sessionCall, setAdminKeys, setClock, sha256, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const AT = Date.parse('2026-11-21T12:00:00Z');
const EMAIL = 'operator@example.com'; // Deliberately not in OWNER_EMAILS.
const JSON_HEADERS = { Origin: ORIGIN, 'Content-Type': 'application/json' };
const ASSERTION = 'Cf-Access-Jwt-Assertion';
let admin: TestKey;
let other: TestKey;

function bind(text: string) {
  return withCore((core) => {
    (core as unknown as { ports: { accessIdentities: AccessIdentities } }).ports.accessIdentities = { read: () => text };
  });
}

const login = (body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
  call('/v1/login', { method: 'POST', headers, body: JSON.stringify(body) });
const signIn = (assertion: string) => login({ access: true }, { ...JSON_HEADERS, [ASSERTION]: assertion });
const assertion = (claims: Record<string, unknown>, exp: string, issuer = `https://${config.ACCESS_TEAM_DOMAIN}`) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'baton-test' }).setIssuer(issuer).setAudience(config.ACCESS_AUD!).setExpirationTime(exp);

async function refused(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ code });
  expect(res.headers.get('Set-Cookie')).toBeNull();
  expect(res.headers.get('Cache-Control')).toBe('no-store');
}

async function cookieFor(email = EMAIL) {
  const res = await signIn(await accessToken(email));
  expect(res.status).toBe(200);
  return res.headers.get('Set-Cookie')!.split(';')[0];
}

beforeEach(async () => {
  await setClock(AT);
  admin = await makeKey('ssh-ed25519', 'admin');
  other = await makeKey('ssh-ed25519', 'other');
  await setAdminKeys(admin, other);
  await bind(`${EMAIL} ${admin.fingerprint}`);
});

describe('S-BTN-308 sign-in through Cloudflare Access', () => {
  it('opens the bound key’s session with a link’s cookie and lifetime and logs only the email hash', async () => {
    await bind(`Operator@EXAMPLE.COM ${admin.fingerprint}\r\nsecond@example.com ${admin.fingerprint}\r\n`);
    const res = await signIn(await accessToken('OPERATOR@example.com'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie).toMatch(/^__Host-baton_session=[0-9a-f]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200$/);
    const cookie = setCookie.split(';')[0];
    await adminSession(admin);
    const list = await sessionCall(cookie, '/v1/admin/sessions', { headers: { [ASSERTION]: 'no-longer-valid' } });
    expect(list.status).toBe(200);
    const text = await list.text();
    const emailHash = await sha256(EMAIL);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(emailHash);
    expect(JSON.parse(text).sessions).toEqual(expect.arrayContaining([
      { role: 'administrator', key_fingerprint: admin.fingerprint, via: 'access', current: true, created_at: AT, expires_at: AT + 43_200_000 },
      { role: 'administrator', key_fingerprint: admin.fingerprint, via: 'link', current: false, created_at: AT, expires_at: AT + 43_200_000 },
    ]));
    expect(await rows('SELECT access_email_hash FROM dashboard_sessions WHERE access_email_hash IS NOT NULL')).toEqual([{ access_email_hash: emailHash }]);
    expect(await rows("SELECT actor, detail_json FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'login'")).toEqual([
      { actor: `admin:${admin.fingerprint}`, detail_json: JSON.stringify({ act: 'login', via: 'access', email_sha256: emailHash }) },
    ]);
    await setClock(AT + 43_200_000);
    expect((await sessionCall(cookie, '/v1/ui/session')).status).toBe(401);
  });

  it('supports a binding to an administrator API key fingerprint', async () => {
    const api = await makeApiKey();
    await setAdminKeys(api.line);
    await bind(`${EMAIL} ${api.fingerprint}`);
    const res = await sessionCall(await cookieFor(), '/v1/admin/sessions');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sessions: [{ key_fingerprint: api.fingerprint, via: 'access' }] });
  });

  it('refuses missing, unverified, expired, wrong-audience, wrong-issuer and missing or non-ASCII email assertions', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const key = await importJWK(JSON.parse(config.TEST_SIGNING_JWK!), 'ES256');
    await refused(await login({ access: true }), 401, 'unauthenticated');
    for (const token of [
      'not-a-jwt',
      await assertion({ email: EMAIL }, '5m').sign(privateKey),
      await assertion({ email: EMAIL }, '0s').sign(key),
      await accessToken(EMAIL, { audience: 'other-app' }),
      await assertion({ email: EMAIL }, '5m', 'https://other.example').sign(key),
      await assertion({}, '5m').sign(key),
      await accessToken('op\u00e9rator@example.com'),
    ]) await refused(await signIn(token), 401, 'unauthenticated');
    expect(await rows('SELECT id_hash FROM dashboard_sessions')).toEqual([]);
  });

  it('refuses unbound emails, bindings to unknown keys and a client-supplied principal header', async () => {
    await refused(await signIn(await accessToken('unbound@example.com')), 401, 'unauthenticated');
    await refused(await login({ access: true }, { ...JSON_HEADERS, 'x-baton-access-email': EMAIL }), 401, 'unauthenticated');
    await setAdminKeys(other);
    await refused(await signIn(await accessToken(EMAIL)), 401, 'unauthenticated');
    expect(await rows('SELECT id_hash FROM dashboard_sessions')).toEqual([]);
  });

  it('S-BTN-318: the verifier distinguishes missing settings, missing assertions and failed verification', async () => {
    const request = (assertion?: string) => new Request(`${ORIGIN}/v1/login`, { headers: assertion ? { [ASSERTION]: assertion } : {} });
    const valid = request(await accessToken(EMAIL));
    for (const setting of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'] as const) {
      expect(await verifyAccess(valid, { ...config, [setting]: undefined })).toEqual({ reason: 'not-configured' });
    }
    expect(await verifyAccess(request(), config)).toEqual({ reason: 'no-assertion' });
    const key = await importJWK(JSON.parse(config.TEST_SIGNING_JWK!), 'ES256');
    for (const token of [await accessToken(EMAIL, { audience: 'other-app' }), await assertion({ email: EMAIL }, '0s').sign(key), await assertion({}, '5m').sign(key)]) {
      expect(await verifyAccess(request(token), config)).toEqual({ reason: 'unverified' });
    }
    expect(await verifyAccess(valid, config)).toEqual({ email: EMAIL });
  });

  it('S-BTN-318: the front answers verification refusals without forwarding or setting a cookie', async () => {
    const valid = await accessToken(EMAIL);
    const to = vi.fn(async () => new Response('{}'));
    for (const [reason, env, assertion] of [
      ['not-configured', { ...config, ACCESS_AUD: undefined }, valid],
      ['no-assertion', config, undefined],
      ['unverified', config, await accessToken(EMAIL, { audience: 'other-app' })],
    ] as const) {
      const headers = assertion ? { ...JSON_HEADERS, [ASSERTION]: assertion } : { ...JSON_HEADERS, 'X-Baton-Access-Email': EMAIL };
      const req = new Request(`${ORIGIN}/v1/login`, { method: 'POST', headers, body: JSON.stringify({ access: true }) });
      const res = await front(req, { ...env, TEST_MIN_CLIENT: undefined }, to);
      await refused(res.clone(), 401, 'unauthenticated');
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ reason });
      expect(text).not.toContain(EMAIL);
    }
    expect(to).not.toHaveBeenCalled();
  });

  it('S-BTN-318: both binding refusals return the same body without the email or key', async () => {
    const assertion = await accessToken(EMAIL);
    await bind('');
    const unbound = await signIn(assertion);
    await setAdminKeys(admin);
    await bind(`${EMAIL} ${other.fingerprint}`);
    const notAdmin = await signIn(assertion);
    for (const res of [unbound, notAdmin]) await refused(res.clone(), 401, 'unauthenticated');
    const body = await unbound.text();
    expect(await notAdmin.text()).toBe(body);
    expect(JSON.parse(body)).toMatchObject({ reason: 'not-bound' });
    expect(body).not.toContain(EMAIL);
    expect(body).not.toContain(other.fingerprint);
    expect(await rows('SELECT id_hash FROM dashboard_sessions')).toEqual([]);
    expect(await rows("SELECT actor FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'login'")).toEqual([]);
  });

  it('reports an unreadable key set as unavailable and ignores an assertion for link sign-in', async () => {
    const to = vi.fn(async () => new Response('{}'));
    const headers = { ...JSON_HEADERS, [ASSERTION]: await accessToken(EMAIL) };
    const remote = { ...config, BATON_TEST_BINDINGS: undefined };
    const fetchKeys = vi.fn(async () => new Response(null, { status: 503 }));
    const request = (body: unknown) => new Request(`${ORIGIN}/v1/login`, { method: 'POST', headers, body: JSON.stringify(body) });
    const keyUrl = `https://${remote.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
    vi.stubGlobal('fetch', fetchKeys);
    try {
      await refused(await front(request({ access: true }), remote, to), 503, 'unavailable');
      expect(fetchKeys).toHaveBeenCalledExactlyOnceWith(keyUrl, expect.anything());
      expect(to).not.toHaveBeenCalled();
      expect((await front(request({ token: 'b'.repeat(64) }), remote, to)).status).toBe(200);
      expect(to.mock.calls).toHaveLength(1);
      expect(fetchKeys).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['duplicate', 'malformed'] as const)('rejects a %s binding file without affecting link sign-in', async (problem) => {
    await bind(`${EMAIL} ${admin.fingerprint}\n${problem === 'duplicate' ? `${EMAIL.toUpperCase()} ${other.fingerprint}` : 'broken@example.com not-a-fingerprint'}`);
    await refused(await signIn(await accessToken(EMAIL)), 503, 'unavailable');
    expect((await sessionCall(await adminSession(admin), '/v1/ui/session')).status).toBe(200);
  });

  it('validates exactly one sign-in method, JSON content type, and the instance origin', async () => {
    const headers = { ...JSON_HEADERS, [ASSERTION]: await accessToken(EMAIL) };
    for (const body of [{ token: 'b'.repeat(64), access: true }, {}, { access: false }, { access: true, email: EMAIL }]) {
      await refused(await login(body, headers), 400, 'invalid-params');
    }
    const invalidHeaders: Record<string, string>[] = [{ 'Content-Type': 'application/json' }, { Origin: ORIGIN }, { ...JSON_HEADERS, Origin: 'https://other.example' }];
    for (const invalid of invalidHeaders) {
      await refused(await login({ access: true }, { ...invalid, [ASSERTION]: headers[ASSERTION] }), 403, 'forbidden');
    }
  });

  it.each(['removed', 'retargeted', 'key removed'] as const)('ends a session when its binding is %s', async (change) => {
    const cookie = await cookieFor();
    expect((await sessionCall(cookie, '/v1/ui/session')).status).toBe(200);
    if (change === 'removed') await bind('');
    if (change === 'retargeted') await bind(`${EMAIL} ${other.fingerprint}`);
    if (change === 'key removed') await setAdminKeys(other);
    const list = await sessionCall(await adminSession(other), '/v1/admin/sessions');
    expect(await list.json()).toMatchObject({ sessions: [{ via: 'link' }] });
    expect((await sessionCall(cookie, '/v1/repositories')).status).toBe(401);
    expect(await rows('SELECT revoked_at FROM dashboard_sessions WHERE access_email_hash IS NOT NULL')).toEqual([{ revoked_at: AT }]);
    await setAdminKeys(admin, other);
    await bind(`${EMAIL} ${admin.fingerprint}`);
    expect((await sessionCall(cookie, '/v1/ui/session')).status).toBe(401);
  });

  it('applies the session list limit after excluding dead bindings', async () => {
    const cookie = await adminSession(admin);
    const emailHash = await sha256(EMAIL);
    await bind(`${EMAIL} ${other.fingerprint}`);
    // Seed newer sessions still within their lifetime, but whose binding now names another key.
    await withCore((core) => {
      core.store.exec(`WITH RECURSIVE series(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM series WHERE n < 500)
        INSERT INTO dashboard_sessions (id_hash, admin_key, access_email_hash, created_at, expires_at)
        SELECT printf('%064x', n), ?, ?, ?, ? FROM series`, admin.fingerprint, emailHash, AT + 1, AT + 43_200_000);
    });
    await setClock(AT + 1);
    const res = await sessionCall(cookie, '/v1/admin/sessions');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sessions: [{ key_fingerprint: admin.fingerprint, via: 'link', current: true }] });
  });

  it('still accepts a legacy Access assertion with a stale cookie when no admin key is configured', async () => {
    const cookie = await adminSession(admin);
    await setAdminKeys();
    const headers = { [ASSERTION]: await accessToken() };
    expect((await call('/v1/ui/session', { headers })).status).toBe(200);
    expect((await sessionCall(cookie, '/v1/ui/session', { headers })).status).toBe(200);
    await refused(await sessionCall(cookie, '/v1/ui/session'), 401, 'unauthenticated');
  });

  it('returns unauthenticated rather than forbidden behind Access when an administrator key is configured', async () => {
    // The harness overrides keys inside the object, so exercise the Worker's configured-key
    // branch at the front boundary as well as the legacy allowlisted email at the host.
    const headers = { [ASSERTION]: await accessToken(EMAIL) };
    const req = new Request(`${ORIGIN}/v1/ui/session`, { headers });
    await refused(await front(req, { ...config, TEST_MIN_CLIENT: undefined }, vi.fn(), async () => true), 401, 'unauthenticated');
    await refused(await call('/v1/ui/session', { headers: { [ASSERTION]: await accessToken() } }), 401, 'unauthenticated');
    expect((await call('/login', { headers })).status).toBe(200);
  });

  it('forwards an existing session without verifying Access when an administrator key is configured', async () => {
    const cookie = await cookieFor();
    const req = new Request(`${ORIGIN}/v1/ui/session`, { headers: { Cookie: cookie, [ASSERTION]: 'not-a-jwt' } });
    const to = vi.fn(async (r: Request) => {
      expect(r.headers.get('X-Baton-Session')).toBe(cookie.split('=')[1]);
      expect(r.headers.has('X-Baton-Owner')).toBe(false);
      expect(r.headers.has(ASSERTION)).toBe(false);
      return new Response('{}');
    });
    expect((await front(req, { ...config, TEST_MIN_CLIENT: undefined }, to, async () => true)).status).toBe(200);
    expect(to).toHaveBeenCalledTimes(1);
  });
});
