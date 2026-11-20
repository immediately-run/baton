// S-BTN-251 a request is the key's or the session's, never both, and a session's request is
// same-origin (B-192; BATON_SPEC §12.4 R-BTN-16, §12.1). Must hold:
//   1. a request carrying a signature and the session cookie is the key's: the cookie decides
//      nothing, so a page cannot borrow a key's reach and a key cannot borrow a session's;
//   2. the same for a bearer, an API key's or a runner token's;
//   3. a session's read with a foreign `Origin`, or a `Sec-Fetch-Site` that is not
//      `same-origin`, is `forbidden` — on the repository reads and under `/v1/ui/*` alike — and
//      one from the dashboard's own origin is served.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, cutover, Git, keyCall, makeApiKey, ORIGIN, sessionCall, setAdminKeys, setClock, TOKENS, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');

let admin: TestKey;
let docsOwner: TestKey;
let opsOwner: TestKey;
let cookie: string;

/** A GET signed by `key` that also carries the session cookie. */
async function signedWithCookie(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, headers: { Cookie: cookie } }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  expect((await new Git().add('T-1').post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
});

describe('S-BTN-251 the key’s or the session’s, and same-origin (B-192)', () => {
  it('a signed request with a cookie is the key’s', async () => {
    // The session alone reads ops; the docs owner's key does not — and the cookie beside its
    // signature changes nothing.
    expect((await sessionCall(cookie, '/v1/repositories/ops/board')).status).toBe(200);
    const borrowed = await signedWithCookie(docsOwner, '/v1/repositories/ops/board');
    expect([borrowed.status, borrowed.json.code]).toEqual([403, 'forbidden']);
    expect((await signedWithCookie(docsOwner, '/v1/repositories/docs/board')).status).toBe(200);
    // A key Baton does not know is unauthenticated, cookie or not.
    const unknown = await signedWithCookie(await makeKey('ssh-ed25519', 'stranger'), '/v1/repositories/docs/board');
    expect([unknown.status, unknown.json.code]).toEqual([401, 'unauthenticated']);
    // …and the key's own refusals stand: an administrator's key signs no owner route, though
    // its session reads it.
    expect((await sessionCall(cookie, '/v1/owner/docs/grants')).status).toBe(200);
    expect((await signedWithCookie(admin, '/v1/owner/docs/grants')).json.code).toBe('forbidden');
  });

  it('a bearer with a cookie is the bearer’s', async () => {
    // A runner token granted nowhere reads no board; the cookie beside it changes nothing.
    const token = await hostCall(new Request(`${ORIGIN}/v1/repositories/docs/board`, { headers: { Authorization: `Bearer ${TOKENS['vm-a']}`, Cookie: cookie } }));
    expect(token.status).toBe(403);
    // An API key Baton does not know.
    const api = await makeApiKey();
    const unknown = await hostCall(new Request(`${ORIGIN}/v1/repositories/docs/board`, { headers: { Authorization: `Bearer ${api.key}`, Cookie: cookie } }));
    expect(unknown.status).toBe(401);
    // A bearer that is nothing at all is not a session either.
    const junk = await hostCall(new Request(`${ORIGIN}/v1/repositories/docs/board`, { headers: { Authorization: 'Bearer nothing', Cookie: cookie } }));
    expect(junk.status).toBe(401);
  });

  it('a session’s read from another origin is forbidden; from the dashboard’s own it is served', async () => {
    for (const path of ['/v1/repositories/docs/board', '/v1/owner/docs/grants', '/v1/repositories', '/v1/ui/session']) {
      const foreign = await sessionCall(cookie, path, { headers: { Origin: 'https://evil.example' } });
      expect([path, foreign.status, ((await foreign.json()) as { code: string }).code]).toEqual([path, 403, 'forbidden']);
      for (const site of ['cross-site', 'same-site', 'none']) {
        const fetched = await sessionCall(cookie, path, { headers: { 'Sec-Fetch-Site': site } });
        expect([path, site, fetched.status]).toEqual([path, site, 403]);
      }
      const own = await sessionCall(cookie, path, { headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' } });
      expect([path, own.status]).toEqual([path, 200]);
      expect(own.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});
