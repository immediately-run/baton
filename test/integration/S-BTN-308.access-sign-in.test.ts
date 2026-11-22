// S-BTN-308 sign-in through Cloudflare Access (BATON_SPEC §15; R-BTN-155, R-BTN-16, R-BTN-57).
// Run against both hosts, using only the test JWT keys.
import { importJWK, SignJWT, generateKeyPair } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '#host';
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
    const assertion = (claims: Record<string, unknown>, exp: string, issuer = `https://${config.ACCESS_TEAM_DOMAIN}`) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'baton-test' }).setIssuer(issuer).setAudience(config.ACCESS_AUD!).setExpirationTime(exp);
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

  it('reports an unreadable key set as unavailable and ignores an assertion for link sign-in', async () => {
    const to = vi.fn(async () => new Response('{}'));
    const headers = { ...JSON_HEADERS, [ASSERTION]: await accessToken(EMAIL) };
    const broken = { ...config, TEST_MIN_CLIENT: undefined, TEST_ACCESS_JWKS: '{' };
    const request = (body: unknown) => new Request(`${ORIGIN}/v1/login`, { method: 'POST', headers, body: JSON.stringify(body) });
    await refused(await front(request({ access: true }), broken, to), 503, 'unavailable');
    expect(to).not.toHaveBeenCalled();
    expect((await front(request({ token: 'b'.repeat(64) }), broken, to)).status).toBe(200);
    expect(to.mock.calls).toHaveLength(1);
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

  it('returns unauthenticated rather than forbidden behind Access when an administrator key is configured', async () => {
    // The harness overrides keys inside the object, so exercise the Worker's configured-key
    // branch at the front boundary as well as the legacy allowlisted email at the host.
    const headers = { [ASSERTION]: await accessToken(EMAIL) };
    const req = new Request(`${ORIGIN}/v1/ui/session`, { headers });
    await refused(await front(req, { ...config, TEST_MIN_CLIENT: undefined }, vi.fn(), async () => true), 401, 'unauthenticated');
    await refused(await call('/v1/ui/session', { headers: { [ASSERTION]: await accessToken() } }), 401, 'unauthenticated');
    expect((await call('/login', { headers })).status).toBe(200);
  });
});
