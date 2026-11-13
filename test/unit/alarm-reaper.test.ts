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

// B-229, found live after the reaper's fix: no tick ran at all — the alarm was armed only by a
// start that found none, so one the platform stopped firing was never set again. Must hold: any
// request sets a missing or long-overdue alarm for the next period, and leaves a due one alone.
describe('B-229 every request keeps the one alarm', () => {
  /** The alarm the core holds after one request, starting from `armed`. */
  async function afterRequest(armed: number | null, host: 'vm-a' | 'vm-b' = 'vm-a'): Promise<number | null> {
    const seen: { at: number | null } = { at: armed };
    const restore = await withCore((core: any) => {
      const real = core.ports.scheduler;
      core.alarmCheckedAt = -Infinity; // each case is a request the once-a-period check makes
      core.ports.scheduler = { get: async () => seen.at, set: async (at: number) => { seen.at = at; } };
      return () => { core.ports.scheduler = real; };
    });
    try {
      await register(host);
    } finally {
      await withCore(() => restore());
    }
    return seen.at;
  }

  it('a missing alarm is set for the next period', async () => {
    expect(await afterRequest(null)).toBe(T0 + 60_000);
  });

  it('an alarm more than two periods overdue is set again', async () => {
    expect(await afterRequest(T0 - 3 * 60_000)).toBe(T0 + 60_000);
  });

  it('an alarm set for later, or only just due, is left as it is', async () => {
    expect(await afterRequest(T0 + 30_000)).toBe(T0 + 30_000);
    expect(await afterRequest(T0 - 60_000, 'vm-b')).toBe(T0 - 60_000);
  });

  it('a request within a period of the last check does not read the alarm again', async () => {
    await afterRequest(T0 + 30_000);
    let reads = 0;
    const restore = await withCore((core: any) => {
      const real = core.ports.scheduler;
      core.ports.scheduler = { get: async () => { reads++; return null; }, set: async () => {} };
      return () => { core.ports.scheduler = real; };
    });
    try {
      await register('vm-b');
    } finally {
      await withCore(() => restore());
    }
    expect(reads).toBe(0);
  });
});
