// B-229 (R-BTN-9): a claim outlives its runner when the alarm's tick never commits. The tick ran
// the reaper and every other step in one transaction, so any step that threw rolled back every
// reap, every minute (found live: twelve claims held for days past their leases). Must hold: the
// reaps commit whatever a later step does; one claim whose end cannot be written is named and
// passed over, never the end of the others; and a failing tick names its step.
import { describe, it, expect, inject, beforeEach } from 'vitest';
import { beat, claimItem, claimRow, cutover, payload, register, setClock, syncCall, withCore } from '../helpers';

const board = inject('board');
const T0 = Date.parse('2026-10-13T12:00:00Z');
const LEASE = 900_000;

beforeEach(async () => {
  await setClock(T0);
  await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
  await cutover();
});

/** A claim whose worker beats once at T0 and then goes silent. */
async function silentClaim(host: 'vm-a' | 'vm-b', ticket: string): Promise<number> {
  const w = await register(host);
  const { json } = await claimItem(host, w.secret, { ticket_id: ticket });
  await beat(host, w.secret);
  return json.claim_id as number;
}

/** Runs one alarm tick with `patch` applied to the core, restoring it after; the tick's error, if any. */
async function tickWith(patch: (core: any) => () => void): Promise<string | null> {
  return withCore(async (core: any) => {
    const restore = patch(core);
    try {
      await core.alarm();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      restore();
    }
  });
}

describe('B-229 the alarm\'s reaper commits on its own', () => {
  it('a later step that throws leaves the reaps committed, and the error names the step', async () => {
    const id = await silentClaim('vm-a', 'docs:R3-9001');
    await setClock(T0 + LEASE);
    const error = await tickWith((core) => {
      const was = core.notices.alarm;
      core.notices.alarm = () => { throw new Error('a poisoned notice row'); };
      return () => { core.notices.alarm = was; };
    });
    expect(error).toMatch(/the alarm's tick failed at notices \(its reaps committed\): a poisoned notice row/);
    expect(await claimRow(id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent' });
  });

  it('a claim whose end cannot be written is named and passed over; the others are reaped', async () => {
    const bad = await silentClaim('vm-a', 'docs:R3-9001');
    const good = await silentClaim('vm-b', 'docs:R3-9002');
    await setClock(T0 + LEASE);
    const error = await tickWith((core) => {
      const was = core.claims.finish;
      core.claims.finish = function (this: unknown, claimId: number, ...rest: unknown[]) {
        if (claimId === bad) throw new Error('an end that cannot be written');
        return was.call(this, claimId, ...rest);
      };
      return () => { core.claims.finish = was; };
    });
    expect(error).toBe(`the alarm could not reap 1 claim(s): claim ${bad} on docs:R3-9001: an end that cannot be written`);
    expect(await claimRow(good)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent' });
    // The next tick, with the end writable again, reaps it. (Not asserted active in between: the
    // Workers host may fire its own armed alarm once the patch is gone.)
    await tickWith(() => () => {});
    expect(await claimRow(bad)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent' });
  });
});
