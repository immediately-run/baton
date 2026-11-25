// S-BTN-279 the attestations read (B-213; BATON_SPEC §12.8 R-BTN-181, R-BTN-185, §6.4
// R-BTN-116, §14): `GET /v1/repositories/{repository}/attestations` (`attestation.list`) lists
// what Baton holds of a repository's attestations — today each applied answer to a person leg,
// a `std:decision@1` — newest first, with its writer, and says which types the caller may
// write. Must hold:
//   1. an answer attested by the sync and one written by an owner key are both listed, newest
//      first, each `{id, type, subject, value, writer: {credential, class}, at}`; `not_built`
//      names B-146 for the store;
//   2. `?subject=` narrows to one ticket, `?type=` to the one type held (another type lists
//      nothing), `?live=1` keeps them all (none lapses or is revoked); an unknown parameter and
//      a malformed one are `invalid-params`;
//   3. `writable_types` is `["std:decision@1"]` for an owner key of the repository under a
//      policy admitting it, and empty under `inputs.answers: attestation`, for an
//      administrator's session, an administrator's key and a granted runner key;
//   4. another repository's attestations are not listed, and a repository that is not the
//      caller's is the one `forbidden`.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { COOPERATIVE } from '../../src/core/policy';
import { keyCall, setClock, setHumanKeys } from '../helpers';
import { atDecide, fixture, MIN, readAs, readSession, T0, type Fixture, type Json } from '../lib/needsYouFixture';

let f: Fixture;
const PATH = '/v1/repositories/docs/attestations';

beforeEach(async () => {
  f = await fixture();
  atDecide(f.git, 'G');
  atDecide(f.git, 'C');
  expect((await f.git.post()).status).toBe(200);
  // The sync attests the answer `G` shows in git; a minute later the owner answers `C`.
  const fromGit = { type: 'std:decision@1', ticket: 'G', ref: 'f'.padEnd(40, '1'), value: { id: 'q-1', leg: 'decide', option: 'hold', reached: 'parked' } };
  expect((await f.git.post({ attestations: [fromGit] })).status).toBe(200);
  await setClock(T0 + MIN);
  expect((await keyCall(f.owner, PATH, { type: 'std:decision@1', subject: { ticket: 'C' }, value: { option: 'ship' } })).status).toBe(200);
});

describe('S-BTN-279 the attestations read (B-213)', () => {
  it('S-BTN-185: a custody-only human key cannot answer under a hardware minimum', async () => {
    await atDecide(f.git, 'H');
    expect((await f.git.post()).status).toBe(200);
    const policy = { ...COOPERATIVE, human_key: 'hardware', inputs: { ...COOPERATIVE.inputs, answers: 'attestation' } };
    expect((await keyCall(f.owner, '/v1/owner/docs/policy', { base_version: 1, policy }, 'PUT')).status).toBe(200);
    await setHumanKeys(f.owner);
    const denied = await keyCall(f.owner, PATH, { type: 'std:decision@1', subject: { ticket: 'H' }, value: { option: 'ship' } });
    expect(denied.status).toBe(403);
    expect(denied.json.message).toMatch(/attested hardware key/);
    expect((await readSession(f.cookie, `${PATH}?subject=H`)).json.attestations).toEqual([]);
  });

  it('lists each applied answer, newest first, with its writer', async () => {
    const res = await readSession(f.cookie, PATH);
    expect(res.status).toBe(200);
    expect(res.json.attestations).toEqual([
      { id: expect.any(Number), type: 'std:decision@1', subject: { ticket: 'docs:C' }, value: { leg: 'decide', option: 'ship' },
        writer: { credential: f.owner.fingerprint, class: 'owner' }, domain: null, at: T0 + MIN, lapses_at: null, revoked_at: null },
      { id: expect.any(Number), type: 'std:decision@1', subject: { ticket: 'docs:G' }, value: { leg: 'decide', option: 'hold' },
        writer: { credential: null, class: 'sync' }, domain: null, at: T0, lapses_at: null, revoked_at: null },
    ]);
    expect(res.json).toMatchObject({ types: ['std:decision@1'], not_built: { store: 'B-146', session_write: 'B-76' } });
    expect('next_cursor' in res.json).toBe(false);
    // Nothing of ops' is here, and ops holds none.
    expect((await readSession(f.cookie, '/v1/repositories/ops/attestations')).json.attestations).toEqual([]);
  });

  it('filters by subject, type and live; refuses what it does not take', async () => {
    const subjects = async (query: string) => ((await readSession(f.cookie, `${PATH}${query}`)).json.attestations as Json[]).map((a) => a.subject.ticket);
    expect(await subjects('?subject=G')).toEqual(['docs:G']);
    expect(await subjects('?subject=docs:C')).toEqual(['docs:C']);
    expect(await subjects('?subject=ops:C')).toEqual([]);
    expect(await subjects('?type=std:decision@1')).toEqual(['docs:C', 'docs:G']);
    expect(await subjects('?type=std:review@1')).toEqual([]);
    expect(await subjects('?live=1')).toEqual(['docs:C', 'docs:G']);
    for (const bad of ['?live=0', '?type=nope', '?subject=a%20b', '?nope=1', '?cursor=junk']) {
      const res = await readSession(f.cookie, `${PATH}${bad}`);
      expect([bad, res.status, res.json.code]).toEqual([bad, 400, 'invalid-params']);
    }
  });

  it('writable_types is the owner key’s where the policy admits it, and nobody else’s', async () => {
    expect((await readAs(f.owner, PATH)).json).toMatchObject({ writable_types: ['std:decision@1'], writable_why: null });
    const session = await readSession(f.cookie, PATH);
    expect(session.json.writable_types).toEqual([]);
    expect(session.json.writable_why).toMatch(/administrator/);
    for (const key of [f.admin, f.reader]) expect((await readAs(key, PATH)).json.writable_types).toEqual([]);
    expect((await readAs(f.opsOwner, PATH)).json.code).toBe('forbidden');
    const policy = { ...COOPERATIVE, inputs: { ...COOPERATIVE.inputs, answers: 'attestation' } };
    expect((await keyCall(f.owner, '/v1/owner/docs/policy', { base_version: 1, policy }, 'PUT')).status).toBe(200);
    const strict = await readAs(f.owner, PATH);
    expect(strict.json.writable_types).toEqual([]);
    expect(strict.json.writable_why).toMatch(/human-only/);
  });
});
