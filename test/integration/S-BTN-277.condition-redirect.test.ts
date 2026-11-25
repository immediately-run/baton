// S-BTN-277 the address of a condition (B-195; BATON_SPEC §7.3 R-BTN-163, §12.4 R-BTN-16):
// `GET /conditions/{id}` is the address a notification carries. Must hold:
//   1. with a session whose repositories hold the id, the front answers `302` to
//      `/repositories/{repository}/conditions/{id}`, uncached;
//   2. with no cookie, an ended session, an id no repository holds, a malformed id, or a request
//      R-BTN-16 would refuse a session (another site's), the front serves the shell — the same
//      bytes each time — and reveals nothing;
//   3. `GET /v1/conditions/{condition}` (`condition.locate`) answers the session
//      `{condition_id, repository, path}`, `not-found` for an id it does not hold, and is no
//      key's read.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { call, ORIGIN, sessionCall, TOKENS } from '../helpers';
import { fixture, raise, readAs, readSession, running, type Fixture } from '../lib/needsYouFixture';

let f: Fixture;
let id: number;

beforeEach(async () => {
  f = await fixture();
  id = await raise(await running(), { type: 'ask.owner' });
});

const page = (path: string, headers: Record<string, string> = {}) => call(path, { headers, redirect: 'manual' });

describe('S-BTN-277 the address of a condition (B-195)', () => {
  it('a session holding the repository is sent to the Resolve page in the tree', async () => {
    const res = await sessionCall(f.cookie, `/conditions/${id}`, { redirect: 'manual', headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/repositories/docs/conditions/${id}`);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    // A client that sends no fetch metadata (R-BTN-16 judges the headers it carries).
    expect((await sessionCall(f.cookie, `/conditions/${id}`, { redirect: 'manual' })).status).toBe(302);
  });

  it('every other request gets the shell, the same bytes, and learns nothing', async () => {
    const shell = await (await page('/')).text();
    const same = async (res: Response) => {
      expect(res.status).toBe(200);
      expect(res.headers.get('Location')).toBeNull();
      expect(await res.text()).toBe(shell);
    };
    await same(await page(`/conditions/${id}`)); // signed out
    await same(await page(`/conditions/${id}`, { Cookie: '__Host-baton_session=' + '0'.repeat(64) })); // no such session
    await same(await sessionCall(f.cookie, '/conditions/9999', { redirect: 'manual' })); // no such condition
    await same(await sessionCall(f.cookie, '/conditions/nope', { redirect: 'manual' })); // not an id of the table
    // Another site's navigation is no session request (R-BTN-16): no lookup is made for it.
    await same(await sessionCall(f.cookie, `/conditions/${id}`, { redirect: 'manual', headers: { 'Sec-Fetch-Site': 'cross-site' } }));
    await same(await sessionCall(f.cookie, `/conditions/${id}`, { redirect: 'manual', headers: { Origin: 'https://elsewhere.example' } }));
    // A segment that is not id-shaped is no page at all.
    expect((await page('/conditions/a/b')).status).toBe(404);
  });

  it('condition.locate answers the session within its repositories, and no key', async () => {
    const found = await readSession(f.cookie, `/v1/conditions/${id}`);
    expect([found.status, found.json]).toEqual([200, { condition_id: id, repository: 'docs', path: `/repositories/docs/conditions/${id}` }]);
    for (const missing of ['9999', 'nope']) {
      const res = await readSession(f.cookie, `/v1/conditions/${missing}`);
      expect([res.status, res.json.code]).toEqual([404, 'not-found']);
    }
    for (const key of [f.admin, f.owner, f.reader]) {
      const res = await readAs(key, `/v1/conditions/${id}`);
      expect([res.status, res.json.code]).toEqual([403, 'forbidden']);
    }
    const bearer = await call(`/v1/conditions/${id}`, { headers: { Authorization: `Bearer ${TOKENS['vm-a']}` } });
    expect(bearer.status).toBe(403);
    expect((await call(`/v1/conditions/${id}`)).status).toBe(401);
    expect(ORIGIN).toMatch(/^https:/);
  });
});
