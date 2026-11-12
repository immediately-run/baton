// S-BTN-204 run ids (BATON_SPEC §15; §5.3 R-BTN-63, §4.7 R-BTN-81, §9.8 R-BTN-24; B-185), on
// both hosts: each run's `advance` reply carries a distinct `run_id` of the stated form — `r_` and
// a ULID whose time half is the clock's — the history's leg rows and `previous_attempts` carry the
// same ids, and a collision with an existing id is refused by the unique index and minted again.
// The migration half (0038's backfill) is in test/unit/migrations.test.ts; the runner half (the
// leg's BATON_RUN_ID and BATON_SESSION_ID) in S-BTN-204.runner-half.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, advance, claimItem, cutover, endClaim, keyCall, placed, register, rows, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { signed } from '../lib/fleet';
import { mintRunId } from '../../src/core/db';

const T0 = Date.parse('2026-11-09T12:00:00Z');
const MIN = 60_000;
const RUN_ID = /^r_[0-9A-HJKMNP-TV-Z]{26}$/;

let owner: TestKey;
let git: Git;

const history = async (local: string) => (await signed(owner, `/v1/repositories/docs/tickets/${local}/history`, { method: 'GET' })).json;

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] });
  git = new Git().add('A');
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
});

describe('S-BTN-204: every leg run has a run id (R-BTN-63)', () => {
  it('mints `r_` and a ULID: 48 bits of the time, then 80 random bits, in Crockford base32', () => {
    const zeros = (n: number) => new Uint8Array(n);
    const ones = (n: number) => new Uint8Array(n).fill(0xff);
    expect(mintRunId(0, zeros)).toBe('r_00000000000000000000000000');
    expect(mintRunId(0, ones)).toBe('r_0000000000ZZZZZZZZZZZZZZZZ');
    // The time half is the milliseconds in base32, most significant first.
    expect(mintRunId(32, zeros).slice(2, 12)).toBe('0000000010');
    expect(mintRunId(T0, ones)).toMatch(RUN_ID);
    // The random half is the source's, not the time's.
    expect(mintRunId(T0, zeros).slice(2, 12)).toBe(mintRunId(T0, ones).slice(2, 12));
    expect(mintRunId(T0, zeros)).not.toBe(mintRunId(T0, ones));
  });

  it('two runs of one leg in two claims: each advance reply carries its own run id, the history rows and previous_attempts the same', async () => {
    const w = await register('vm-a');
    const c1 = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json;
    const a1 = await advance('vm-a', w.secret, c1.claim_id, { leg: 'implement' });
    expect(a1.status).toBe(200);
    expect(a1.json.run_id).toMatch(RUN_ID);
    await setClock(T0 + MIN);
    // The leg is given up at its `from` (a release with no backoff): a second claim runs it again.
    expect((await endClaim('vm-a', w.secret, c1.claim_id, { end_reason: 'released:requested' })).status).toBe(200);
    await git.refresh(); // a later snapshot confirms the end (R-BTN-62)

    await setClock(T0 + 2 * MIN);
    const r2 = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect(r2.status).toBe(200);
    const c2 = r2.json;
    expect(c2.previous_attempts[0].legs).toEqual([expect.objectContaining({ leg: 'implement', run_id: a1.json.run_id, outcome: 'abandoned' })]);
    const a2 = await advance('vm-a', w.secret, c2.claim_id, { leg: 'implement' });
    expect(a2.status).toBe(200);
    expect(a2.json.run_id).toMatch(RUN_ID);
    expect(a2.json.run_id).not.toBe(a1.json.run_id);

    // The rows carry the id of the run they record, the stored one.
    const stored = await rows<{ claim_id: number; run_id: string }>('SELECT claim_id, run_id FROM claim_legs ORDER BY id');
    expect(stored).toEqual([{ claim_id: c1.claim_id, run_id: a1.json.run_id }, { claim_id: c2.claim_id, run_id: a2.json.run_id }]);
    const legRows = (await history('A')).rows.filter((r: { kind: string }) => r.kind.startsWith('leg-'))
      .map((r: { kind: string; claim_id: number; run: number; run_id: string }) => [r.kind, r.claim_id, r.run, r.run_id]);
    expect(legRows).toEqual([
      ['leg-started', c2.claim_id, 2, a2.json.run_id],
      ['leg-abandoned', c1.claim_id, 1, a1.json.run_id],
      ['leg-started', c1.claim_id, 1, a1.json.run_id],
    ]);
  });

  it('a run id that collides with an existing one is refused by the unique index and minted again', async () => {
    // The random source repeats its first draw once: the second advance's first id collides.
    await withCore((core) => {
      let draws = 0;
      core.random = (n) => {
        draws++;
        return new Uint8Array(n).fill(draws <= 2 ? 7 : draws);
      };
    });
    const w = await register('vm-a');
    const c1 = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json;
    const a1 = await advance('vm-a', w.secret, c1.claim_id, { leg: 'implement' });
    expect((await endClaim('vm-a', w.secret, c1.claim_id, { end_reason: 'released:requested' })).status).toBe(200);
    await git.refresh(); // a later snapshot confirms the end (R-BTN-62)
    const c2 = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json;
    const a2 = await advance('vm-a', w.secret, c2.claim_id, { leg: 'implement' });
    expect(a2.status).toBe(200);
    expect(a2.json.run_id).not.toBe(a1.json.run_id);
    expect(await rows('SELECT run_id FROM claim_legs')).toHaveLength(2);
  });
});
