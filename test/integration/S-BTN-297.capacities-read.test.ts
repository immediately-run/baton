// S-BTN-297 the capacities read (B-202; BATON_SPEC §6.11 R-BTN-178, §14): `GET
// /v1/admin/capacities` (`admin.capacity.list`) answers an administrator's key as it did —
// `baton admin capacity set` reads it before it asks to confirm — and an administrator's
// session the same JSON, each capacity with the seats held. Must hold:
//   1. `{capacities: [{capability, capacity, set_by, set_at}]}` and, with `?capability=`, the
//      `requiring` courses, are what `Resources.capacities` answers (additions only);
//   2. each capacity carries `held` and `holders: [{claim_id, ticket_id, runner_id}]`, equal to
//      the `claim_seats` rows — a capacity half held shows it;
//   3. an administrator's session reads what the key reads.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  adminSession, claimItem, cutover, Git, keyCall, ORIGIN, register, rows, sessionCall, setAdminKeys, setClock,
  withCore, seedClaimSeat,
} from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const CAP = 'capability:rdp-lab';
type Row = Record<string, any>;

let admin: TestKey;
let cookie: string;

async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Row };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  expect((await new Git().add('T-1').add('T-2').post()).status).toBe(200);
  await cutover(T0);
  expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: 2 }, 'PUT')).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/capacities', { capability: 'capability:bench', capacity: 1 }, 'PUT')).status).toBe(200);
  cookie = await adminSession(admin);
});

describe('S-BTN-297 the capacities read (B-202)', () => {
  it('answers what it answered, with the seats held and their claims', async () => {
    const before = JSON.parse(JSON.stringify(await withCore((c) => c.resources.capacities()))) as Row;
    const empty = (await read(admin, '/v1/admin/capacities')).json;
    expect(Object.keys(empty)).toEqual(['capacities']);
    expect(empty.capacities).toEqual((before.capacities as Row[]).map((c) => ({ ...c, held: 0, holders: [] })));
    expect((empty.capacities as Row[]).map((c) => [c.capability, c.capacity, c.set_by])).toEqual([
      ['capability:bench', 1, `admin:${admin.fingerprint}`], [CAP, 2, `admin:${admin.fingerprint}`]]);

    // A claim holds one of the lab's two seats.
    const w = await register('vm-a');
    const claim = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect(claim.status).toBe(200);
    await seedClaimSeat({ claim_id: claim.json.claim_id, capability: CAP });
    const { json } = await read(admin, '/v1/admin/capacities');
    const lab = (json.capacities as Row[]).find((c) => c.capability === CAP)!;
    expect([lab.capacity, lab.held]).toEqual([2, 1]);
    expect(lab.holders).toEqual([{ claim_id: claim.json.claim_id, ticket_id: 'docs:T-1', runner_id: w.id }]);
    expect((json.capacities as Row[]).find((c) => c.capability === 'capability:bench')).toMatchObject({ held: 0, holders: [] });
    const seats = await rows<{ claim_id: number; capability: string }>('SELECT claim_id, capability FROM claim_seats');
    expect((json.capacities as Row[]).flatMap((c) => (c.holders as Row[]).map((h) => ({ claim_id: h.claim_id, capability: c.capability })))).toEqual(seats);

    // `?capability=`: the confirm print's read, as before, with the seats beside it.
    const one = (await read(admin, `/v1/admin/capacities?capability=${encodeURIComponent(CAP)}`)).json;
    const old = JSON.parse(JSON.stringify(await withCore((c) => c.resources.capacities('capability:rdp-lab')))) as Row;
    expect(Object.keys(one).sort()).toEqual(['capacities', 'requiring']);
    expect(one.requiring).toEqual(old.requiring);
    expect(one.capacities).toEqual(json.capacities);

    // 3. The session's JSON is the key's.
    const res = await sessionCall(cookie, '/v1/admin/capacities');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(json);
  });
});
