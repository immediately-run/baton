// S-BTN-298 the instance and resource reads (B-202; BATON_SPEC §6.3 R-BTN-76, R-BTN-101, §6.7
// R-BTN-99, §14): `GET /v1/admin/instances` (`admin.instance.list`) and `GET /v1/admin/resources`
// (`admin.resource.list`) answer an administrator's key and session. Must hold:
//   1. each instance is the row `GET /v1/admin/state` lists under `resources.instances` — name,
//      repositories, what it serves, its state and `until` — with every reading in force by
//      instrument, newest first: `{source, writer, kind, available, until, observed_at,
//      lapses_at, detail, stale}`, the detail the validated object;
//   2. a reading whose `lapses_at` has passed is `stale` until the alarm drops it — never
//      served as in force; nothing else is judged;
//   3. each resource carries its scope, its detail schema as an object and its instances, and
//      `probes` lists the instrument keys by fingerprint and label — never a key's line;
//   4. an administrator's session reads what the key reads.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, keyCall, ORIGIN, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { SCHEMA } from '../lib/fleet';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const MIN = 60_000;
type Row = Record<string, any>;

let admin: TestKey;
let probe: TestKey;
let cookie: string;

async function signed(key: TestKey, path: string, body?: unknown) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: res.status, json: (await res.json()) as Row };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  probe = await makeKey('ecdsa-sha2-nistp256', 'probe');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'llm:cap', scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'disk:fs-1', scope: 'service', detail_schema: { type: 'object' } })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/instances', { name: 'acct:one', serves: ['llm:cap'], repositories: ['docs'] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/instances', { name: 'acct:two', serves: ['llm:cap'], repositories: ['docs'] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'quota probe' })).status).toBe(200);
  // An administrator's reading on one instance; a probe's, a minute later, on both.
  expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'acct:one', available: true, valid_for: 3600, detail: { used: 3 } }] })).json).toEqual({ ok: true, refused: [] });
  await setClock(T0 + MIN);
  expect((await signed(probe, '/v1/probe/readings', { readings: [
    { instance: 'acct:one', available: false, until: T0 + 30 * MIN, valid_for: 3600, detail: { used: 9 } },
    { instance: 'acct:two', available: true, valid_for: 600 }] })).json).toEqual({ ok: true, refused: [] });
  cookie = await adminSession(admin);
});

describe('S-BTN-298 the instance and resource reads (B-202)', () => {
  it('lists each instance with its state and every reading by instrument, a lapsed one stale', async () => {
    const state = (await signed(admin, '/v1/admin/state')).json;
    const { status, json } = await signed(admin, '/v1/admin/instances');
    expect(status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(['instances', 'server_time']);
    expect(json.server_time).toBe(T0 + MIN);
    expect((json.instances as Row[]).map(({ readings: _r, ...row }) => row)).toEqual(state.resources.instances);
    const one = (json.instances as Row[]).find((i) => i.name === 'acct:one')!;
    expect([one.state, one.until, one.serves, one.repositories]).toEqual(['unavailable', T0 + 30 * MIN, ['llm:cap'], ['docs']]);
    expect(one.readings).toEqual([
      { source: `probe:${probe.fingerprint}`, writer: 'instrument', kind: 'state', available: false, until: T0 + 30 * MIN, observed_at: T0 + MIN, lapses_at: T0 + 30 * MIN, detail: { used: 9 }, stale: false },
      { source: `admin:${admin.fingerprint}`, writer: 'admin', kind: 'state', available: true, until: null, observed_at: T0, lapses_at: T0 + 60 * MIN, detail: { used: 3 }, stale: false },
    ]);
    const two = (json.instances as Row[]).find((i) => i.name === 'acct:two')!;
    expect([two.state, two.readings.length, two.readings[0].detail]).toEqual(['available', 1, null]);
    const service = (json.instances as Row[]).find((i) => i.name === 'disk:fs-1')!;
    expect([service.state, service.readings]).toEqual(['unknown', []]);

    // 2. A reading past its end that the alarm has not dropped yet is marked, not judged.
    await rows(`UPDATE instance_readings SET lapses_at = ? WHERE instance = 'acct:two'`, T0);
    const later = (await signed(admin, '/v1/admin/instances')).json;
    // (A host whose alarm ran first has dropped the row and the state with it: then no reading
    // is served, and the instance is `unknown` — never a lapsed reading served as in force.)
    const lapsed = (later.instances as Row[]).find((i) => i.name === 'acct:two')!;
    if (lapsed.readings.length) expect(lapsed.readings[0]).toMatchObject({ available: true, stale: true });
    else expect(lapsed.state).toBe('unknown');

    // 4. The session's JSON is the key's (read at one instant).
    const viaKey = (await signed(admin, '/v1/admin/instances')).json;
    const res = await sessionCall(cookie, '/v1/admin/instances');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(viaKey);
  });

  it('lists the resources with their schemas and instances, and the probe keys by fingerprint', async () => {
    const { status, json } = await signed(admin, '/v1/admin/resources');
    expect(status).toBe(200);
    expect(json.resources).toEqual([
      { name: 'disk:fs-1', scope: 'service', detail_schema: { type: 'object' }, instances: ['disk:fs-1'] },
      { name: 'llm:cap', scope: 'account', detail_schema: SCHEMA, instances: ['acct:one', 'acct:two'] },
    ]);
    expect(json.probes).toEqual([{ fingerprint: probe.fingerprint, label: 'quota probe', instances: [], added_by: `admin:${admin.fingerprint}` }]);
    const res = await sessionCall(cookie, '/v1/admin/resources');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(json);
    // No key's line leaves: what the store holds of the probe beside its fingerprint.
    const lines = (await rows<{ public_key: string }>(`SELECT public_key FROM credentials WHERE kind = 'probe'`)).map((r) => r.public_key);
    expect(lines).toHaveLength(1);
    expect(text.includes(lines[0].split(' ')[1])).toBe(false);
    expect(/public_key|secret/.test(text)).toBe(false);
  });
});
