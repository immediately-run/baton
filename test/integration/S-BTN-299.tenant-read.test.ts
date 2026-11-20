// S-BTN-299 the tenant read and the instance settings read (B-202; BATON_SPEC §2.3 R-BTN-87,
// §2.1 R-BTN-2, §4.8 R-BTN-88, §13.1, §14): `GET /v1/admin/tenant` (`admin.tenant`) and `GET
// /v1/admin/settings` (`admin.settings.show`) answer an administrator's key and session. Must hold:
//   1. `admin.tenant` answers `GET /v1/admin/state`'s `capacity` — the envelope, every figure
//      against it, the day's usage — and the live counts equal the rows: runners, repositories,
//      tickets, history rows; `live_claims` the active claims;
//   2. the request rates are the core's own counter (R-BTN-87): a burst of requests under the
//      fake clock shows as the 5-minute mean and the largest 5 seconds, and falls out of the
//      window five minutes on;
//   3. `needs_you` carries the listings that belong to no repository — the keys notice, the
//      figures over 80% of the envelope and (B-203) the unknown instances, the runners on an
//      old client and those declaring no course — as `GET /v1/admin/state` assembles them;
//   4. `frozen_at` follows a freeze and an unfreeze; `not_built` names the store's size;
//   5. the read is never conditional (its rates move no state version): no `ETag`;
//   6. `admin.settings.show` answers the instance settings as `GET /v1/admin/state` lists them,
//      and follows `PUT /v1/admin/settings`.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, claimItem, cutover, Git, keyCall, ORIGIN, register, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
type Row = Record<string, any>;

let admin: TestKey;
let cookie: string;

async function read(path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(admin, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Row, etag: res.headers.get('ETag') };
}
const figure = (answer: Row, name: string): Row => (answer.figures as Row[]).find((f) => f.figure === name)!;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  expect((await new Git().add('T-1').add('T-2').add('T-3').post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
});

describe('S-BTN-299 the tenant read (B-202)', () => {
  it('answers the envelope’s figures from the rows, the live claims and the day’s usage', async () => {
    const w = await register('vm-a');
    expect((await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' })).status).toBe(200);
    const { status, json, etag } = await read('/v1/admin/tenant');
    expect(status).toBe(200);
    expect(etag).toBeNull();
    expect(Object.keys(json).sort()).toEqual(['day', 'envelope', 'figures', 'frozen_at', 'live_claims', 'needs_you', 'not_built', 'sealed_at', 'server_time']);
    expect(json.envelope).toEqual({ live_runners: 50, repositories: 20, live_tickets: 5000, history_rows: 1000000, requests_per_second: 20, burst_in_5s: 100 });
    const count = async (q: string) => (await rows<{ n: number }>(q))[0].n;
    expect(figure(json, 'live_runners').value).toBe(await count(`SELECT COUNT(*) AS n FROM runners WHERE reaped_at IS NULL AND kind != 'legacy'`));
    expect(figure(json, 'repositories').value).toBe(await count('SELECT COUNT(*) AS n FROM repositories WHERE retired_at IS NULL'));
    // The two growing tables are counted by the envelope's maintained counters (B-236), never scanned.
    const kept = await withCore((c) => c.capacity.counts());
    expect([figure(json, 'live_tickets').value, figure(json, 'history_rows').value]).toEqual([kept.live_tickets, kept.history_rows]);
    expect(figure(json, 'live_tickets').value).toBeGreaterThanOrEqual(await count('SELECT COUNT(*) AS n FROM tickets'));
    expect(json.live_claims).toBe(await count(`SELECT COUNT(*) AS n FROM claims WHERE status = 'active'`));
    expect(json.live_claims).toBe(1);
    for (const f of json.figures as Row[]) expect([f.figure, f.envelope]).toEqual([f.figure, json.envelope[f.figure]]);
    expect(json.day).toMatchObject({ day: '2026-11-20', limits: { requests: expect.any(Number), rows_written: expect.any(Number) } });
    expect(json.day.requests).toBeGreaterThan(0);
    expect([json.frozen_at, json.sealed_at, json.server_time]).toEqual([null, null, T0]);
    expect(json.not_built).toEqual({ storage_bytes: 'B-202' });
    // What `GET /v1/admin/state` serves as `capacity` and under Needs you, from the same state.
    const state = (await read('/v1/admin/state')).json;
    expect(json.envelope).toEqual(state.capacity.envelope);
    expect((json.figures as Row[]).map((f) => f.figure)).toEqual((state.capacity.figures as Row[]).map((f) => f.figure));
    for (const name of ['live_runners', 'repositories', 'live_tickets', 'history_rows']) expect(figure(json, name)).toEqual((state.capacity.figures as Row[]).find((f) => f.figure === name));
    // B-203: with the instance-wide listings the state read lists beside them (S-BTN-305).
    expect(json.needs_you).toEqual({ keys: state.needs_you.keys, capacity: state.needs_you.capacity, instances_unknown: state.needs_you.instances_unknown,
      stale_clients: state.needs_you.stale_clients, stale_skills_no_course: state.needs_you.stale_skills.filter((r: { repository_id: string | null }) => r.repository_id == null) });

    // The session's answer, at the same instant: the same counts.
    const res = await sessionCall(cookie, '/v1/admin/tenant');
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeNull();
    const viaSession = (await res.json()) as Row;
    for (const name of ['live_runners', 'repositories', 'live_tickets', 'history_rows']) expect(figure(viaSession, name)).toEqual(figure(json, name));
    expect([viaSession.live_claims, viaSession.needs_you]).toEqual([json.live_claims, json.needs_you]);
  });

  it('the rates reflect a burst of requests under the fake clock, and the window forgets it', async () => {
    // A quiet instant, far from the setup's requests.
    const T1 = T0 + 3_600_000;
    await setClock(T1);
    cookie = await adminSession(admin);
    await setClock(T1 + 600_000);
    const quiet = (await read('/v1/admin/tenant')).json;
    // The read itself is the window's one request.
    expect([figure(quiet, 'requests_per_second').value, figure(quiet, 'burst_in_5s').value]).toEqual([0, 1]);
    // A burst: 29 more requests in this second — 30 in the window.
    for (let i = 0; i < 28; i++) expect((await sessionCall(cookie, '/v1/admin/settings')).status).toBe(200);
    const burst = (await read('/v1/admin/tenant')).json;
    expect(figure(burst, 'burst_in_5s').value).toBe(30);
    expect(figure(burst, 'requests_per_second').value).toBe(0.1);
    expect(figure(burst, 'burst_in_5s')).toMatchObject({ envelope: 100, over: false });
    // Over 80% of the burst envelope: listed under needs_you.capacity, as the state read lists it.
    for (let i = 0; i < 55; i++) expect((await sessionCall(cookie, '/v1/admin/settings')).status).toBe(200);
    const over = (await read('/v1/admin/tenant')).json;
    expect(figure(over, 'burst_in_5s')).toMatchObject({ value: 86, over: true });
    expect(over.needs_you.capacity).toEqual([{ figure: 'burst_in_5s', value: 86, envelope: 100 }]);
    // Five minutes on, the window holds the read alone.
    await setClock(T1 + 600_000 + 301_000);
    const after = (await read('/v1/admin/tenant')).json;
    expect([figure(after, 'requests_per_second').value, figure(after, 'burst_in_5s').value]).toEqual([0, 1]);
    expect(after.needs_you.capacity).toEqual([]);
  });

  it('carries the keys notice and the freeze mark', async () => {
    await rows(`INSERT INTO baton_settings (key, value) VALUES ('keys_notice', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify({ refused: 'line 2 is no key', revoked_listed: ['SHA256:abc'] }));
    expect((await read('/v1/admin/tenant')).json.needs_you.keys).toEqual({ refused: 'line 2 is no key', revoked_listed: ['SHA256:abc'] });
    expect((await keyCall(admin, '/v1/admin/freeze', {})).status).toBe(200);
    expect((await read('/v1/admin/tenant')).json.frozen_at).toBe(T0);
    expect((await keyCall(admin, '/v1/admin/unfreeze', {})).status).toBe(200);
    expect((await read('/v1/admin/tenant')).json.frozen_at).toBeNull();
  });

  it('admin.settings.show answers the instance settings, and follows a change', async () => {
    const state = (await read('/v1/admin/state')).json;
    const { status, json } = await read('/v1/admin/settings');
    expect(status).toBe(200);
    expect(json).toEqual(state.instance);
    expect(Object.keys(json).sort()).toEqual(['check_app_id', 'link_hosts', 'recommended_client', 'session_hosts']);
    expect((await keyCall(admin, '/v1/admin/settings', { link_hosts: ['ci.example.org'], check_app_id: '12345' }, 'PUT')).status).toBe(200);
    const res = await sessionCall(cookie, '/v1/admin/settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ link_hosts: ['ci.example.org'], check_app_id: '12345', session_hosts: json.session_hosts });
  });
});
