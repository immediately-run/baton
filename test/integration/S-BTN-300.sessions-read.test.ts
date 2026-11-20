// S-BTN-300 the sessions read (B-202; BATON_SPEC §11.4 R-BTN-155, §12.4 R-BTN-16, §14): `GET
// /v1/admin/sessions` (`admin.session.list`) lists the live dashboard sessions to an
// administrator's key or session. Must hold:
//   1. a live session is `{role, key_fingerprint, created_at, expires_at, current}`, newest
//      first; the calling session's own is `current`, and no row is for a key's call;
//   2. an ended session is not listed: logged out, expired, or its key no longer an
//      administrator's;
//   3. NO SECRET leaves: not the cookie's value, not the hash the store keeps of it, no id;
//   4. the read is never conditional (two sessions of one key would share an ETag): no `ETag`.
// Owner sessions do not exist yet (B-76). Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, ORIGIN, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const H = 3_600_000;
type Row = Record<string, any>;

let admin: TestKey;
let second: TestKey;

async function read(key: TestKey) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/admin/sessions`, { created }));
  return { status: res.status, json: (await res.json()) as Row };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  second = await makeKey('ssh-ed25519', 'second-admin');
  await setAdminKeys(admin, second);
});

describe('S-BTN-300 the sessions read (B-202)', () => {
  it('lists the live sessions, the caller’s own marked, and serves nothing of a session but its key and times', async () => {
    const a = await adminSession(admin);
    await setClock(T0 + H);
    const b = await adminSession(admin);
    await setClock(T0 + 2 * H);
    const c = await adminSession(second);

    const res = await sessionCall(a, '/v1/admin/sessions');
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeNull();
    const text = await res.text();
    const json = JSON.parse(text) as Row;
    expect(Object.keys(json).sort()).toEqual(['not_built', 'server_time', 'sessions']);
    expect(json.sessions).toEqual([
      { role: 'administrator', key_fingerprint: second.fingerprint, created_at: T0 + 2 * H, expires_at: T0 + 14 * H, current: false },
      { role: 'administrator', key_fingerprint: admin.fingerprint, created_at: T0 + H, expires_at: T0 + 13 * H, current: false },
      { role: 'administrator', key_fingerprint: admin.fingerprint, created_at: T0, expires_at: T0 + 12 * H, current: true },
    ]);
    expect(json.not_built).toEqual({ last_seen_at: 'B-76', client_addr: 'B-76' });
    // Another session of the same key: its own row is the current one.
    const viaB = (await (await sessionCall(b, '/v1/admin/sessions')).json()) as Row;
    expect((viaB.sessions as Row[]).map((s) => s.current)).toEqual([false, true, false]);
    // A key's call lists them all, and none is its own.
    const viaKey = await read(admin);
    expect(viaKey.status).toBe(200);
    expect((viaKey.json.sessions as Row[]).map((s) => s.current)).toEqual([false, false, false]);

    // 3. What the store holds of each session, and the cookies' values: none of it leaves.
    const held = (await rows<{ id_hash: string }>('SELECT id_hash FROM dashboard_sessions')).map((r) => r.id_hash);
    expect(held).toHaveLength(3);
    const answers = [text, JSON.stringify(viaB), JSON.stringify(viaKey.json)];
    for (const secret of [...held, ...[a, b, c].map((cookie) => cookie.split('=')[1])]) {
      expect(secret.length).toBe(64);
      for (const answer of answers) expect(answer.includes(secret)).toBe(false);
    }
    for (const answer of answers) expect(/id_hash|"id"|cookie|token/i.test(answer)).toBe(false);
  });

  it('lists no ended session: logged out, expired, or its key no longer an administrator’s', async () => {
    const a = await adminSession(admin);
    const b = await adminSession(admin);
    const c = await adminSession(second);
    expect(((await read(admin)).json.sessions as Row[])).toHaveLength(3);
    // Logged out.
    expect((await sessionCall(b, '/v1/ui/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(200);
    expect(((await read(admin)).json.sessions as Row[]).map((s) => s.key_fingerprint).sort()).toEqual([admin.fingerprint, second.fingerprint].sort());
    // Its key leaves BATON_ADMIN_KEYS.
    await setAdminKeys(admin);
    expect(((await read(admin)).json.sessions as Row[]).map((s) => s.key_fingerprint)).toEqual([admin.fingerprint]);
    expect((await sessionCall(c, '/v1/admin/sessions')).status).toBe(401);
    // Expired: 12 hours on, nothing is live.
    await setClock(T0 + 12 * H);
    expect((await read(admin)).json.sessions).toEqual([]);
    expect((await sessionCall(a, '/v1/admin/sessions')).status).toBe(401);
  });
});
