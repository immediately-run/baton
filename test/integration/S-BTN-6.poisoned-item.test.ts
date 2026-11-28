// S-BTN-6 poisoned item (BATON_SPEC §15, §9.7, §7.4): three claimants fail — reaped for silence,
// lease-lost, cannot-finish:transient. Must hold: held attempts-exhausted (the mirror's note and
// the owner-inbox report are R3-1218's and the witness's); lifting the hold resets the count.
import { describe, it, expect, inject, beforeEach } from 'vitest';
import { advance, beat, claimItem, cutover, endClaim, Git, grantRunnerConcurrency, ORIGIN, ownerCall, payload, refresh, register, rows, setClock, syncCall, tick, stateView } from '../helpers';

const board = inject('board');
const T0 = Date.parse('2026-10-13T12:00:00Z');
const H = 3_600_000;
const owner = (path: string, body: unknown) =>
  ownerCall(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });

describe('S-BTN-6 poisoned item', () => {
  beforeEach(async () => {
    await setClock(T0);
    await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
    await cutover();
  });
  it('three different failures hold it attempts-exhausted; Needs you lists it with its attempts; a lift resets the count', async () => {
    // 1. Reaped for silence.
    const a = await register('vm-a');
    const c1 = (await claimItem('vm-a', a.secret, { ticket_id: 'docs:R3-9001' })).json;
    await setClock(T0 + 900_000);
    await tick();
    // 2. lease-lost, after the 1 h backoff.
    await setClock(T0 + 900_000 + H);
    const b = await register('vm-b');
    await refresh(); // §6.7: a reading after the end
    const c2 = (await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })).json;
    await endClaim('vm-b', b.secret, c2.claim_id, { end_reason: 'released:lease-lost' });
    // 3. cannot-finish:transient, after the 4 h backoff.
    await setClock(T0 + 900_000 + 5 * H);
    await beat('vm-b', b.secret);
    await refresh(); // §6.7: a reading after the end
    const c3 = (await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })).json;
    await endClaim('vm-b', b.secret, c3.claim_id, { end_reason: 'released:cannot-finish:transient' });

    expect(await rows(`SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = 'docs:R3-9001'`)).toEqual([{ hold: 1, hold_reason: 'attempts-exhausted' }]);
    expect(await rows(`SELECT kind FROM events WHERE kind IN ('attempts-exhausted', 'held')`)).toEqual([{ kind: 'attempts-exhausted' }, { kind: 'held' }]);
    const state = (await stateView()) as { needs_you: { held_items: { ticket_id: string; hold_reason: string; attempts: { id: number }[] }[] } };
    expect(state.needs_you.held_items).toEqual([expect.objectContaining({ ticket_id: 'docs:R3-9001', hold_reason: 'attempts-exhausted' })]);
    expect(state.needs_you.held_items[0].attempts.map((x) => x.id)).toEqual([c1.claim_id, c2.claim_id, c3.claim_id]);

    // The owner lifts it: the count starts again, so one more failure backs off, not holds.
    await owner('/v1/ui/overrides/docs:R3-9001', { hold: false });
    await refresh(); // §6.7: a reading after the end
    const c4 = await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' });
    expect(c4.status).toBe(200);
    await endClaim('vm-b', b.secret, c4.json.claim_id, { end_reason: 'released:cannot-finish:transient' });
    expect(await rows(`SELECT hold, hold_reason, retry_after FROM ticket_overrides WHERE ticket_id = 'docs:R3-9001'`)).toEqual([{ hold: 0, hold_reason: null, retry_after: T0 + 900_000 + 6 * H }]);
  });
});


const start = Date.parse('2026-11-27T12:00:00Z');
const minute = 60_000;
const transient = 'released:cannot-finish:transient';
type Key = 'vm-a' | 'vm-b';

async function board(size: number) {
  await setClock(start);
  const git = new Git();
  for (let n = 0; n < size; n++) git.add(`FAULT-${n}`);
  expect((await git.post()).status).toBe(200);
  await cutover();
  return git;
}

async function runner(key: Key) {
  const { id, secret } = await register(key, { concurrency: 20 });
  await grantRunnerConcurrency(id, 20);
  return {
    secret,
    claim: (n?: number) => claimItem(key, secret, n === undefined ? {} : { ticket_id: `docs:FAULT-${n}` }),
    fail: async (claim: number, reason = transient, type = 'error.gateway') => {
      expect(await endClaim(key, secret, claim, { end_reason: reason, error: { type, message: 'not condition detail' } })).toMatchObject({ status: 200 });
    },
  };
}

async function take(w: Awaited<ReturnType<typeof runner>>, ...tickets: number[]) {
  const ids: number[] = [];
  for (const n of tickets) {
    const res = await w.claim(n);
    expect(res, JSON.stringify(res.json)).toMatchObject({ status: 200 });
    ids.push(res.json.claim_id);
  }
  return ids;
}

const notices = () => rows<{ id: number; type: string; detail_json: string }>(
  `SELECT id, type, detail_json FROM conditions WHERE outcome = 'open' AND type LIKE 'baton.%faulting' ORDER BY id`);

it('S-BTN-6 restores ten tickets, lifts only burst holds, and recovers on a leg outcome', async () => {
  const git = await board(12);
  // A one-attempt repository exercises the retroactive hold/decision removal.
  await rows('UPDATE repositories SET retry = ? WHERE id = ?', JSON.stringify({ backoff_ms: [minute], max_failed: 1 }), 'docs');
  const a = await runner('vm-a');
  const b = await runner('vm-b');
  const ids = await take(a, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  // Already-held work can finish during the backoff, and can restore admission early.
  const [healthy] = await take(a, 10);
  expect((await advance('vm-a', a.secret, healthy, { leg: 'implement' })).status).toBe(200);
  await a.fail(ids[0], transient, 'error.other');
  expect(await rows(`SELECT hold FROM ticket_overrides WHERE ticket_id = 'docs:FAULT-0'`)).toEqual([{ hold: 1 }]);
  for (const id of ids.slice(1)) await a.fail(id);
  expect(await rows('SELECT id, end_reason FROM claims WHERE failed_attempt = 0 AND end_reason = ? ORDER BY id', transient))
    .toEqual(ids.map((id) => ({ id, end_reason: transient })));
  expect(await rows('SELECT 1 FROM ticket_overrides WHERE hold = 1 OR retry_after IS NOT NULL')).toEqual([]);
  expect(await rows(`SELECT 1 FROM ticket_decisions WHERE decision_id = 'baton:retries'`)).toEqual([]);
  expect(await rows(`SELECT claim_id FROM events WHERE json_extract(detail_json, '$.hold_lifted') = 1 ORDER BY claim_id`))
    .toEqual(ids.slice(0, 2).map((claim_id) => ({ claim_id })));
  expect(await a.claim()).toMatchObject({ status: 409, json: { code: 'runner-backing-off', until: start + 5 * minute } });
  const [notice] = await notices();
  expect(await notices()).toHaveLength(1);
  expect(notice.type).toBe('baton.runner-faulting');
  expect(JSON.parse(notice.detail_json).reasons).toEqual([
    { end_reason: transient, error_type: 'error.gateway', count: 9 },
    { end_reason: transient, error_type: 'error.other', count: 1 },
  ]);
  expect((await git.refresh()).status).toBe(200);
  await take(b, 0);
  expect(await endClaim('vm-a', a.secret, healthy, { end_reason: 'suspended:pr-open' })).toMatchObject({ status: 200 });
  expect(await notices()).toEqual([]);
  await take(a, 11);
});

it('S-BTN-6 deduplicates fleet and runner notices and doubles a repeated backoff', async () => {
  await board(12);
  const a = await runner('vm-a');
  const b = await runner('vm-b');
  const first = await take(a, 0, 1, 2);
  const second = await take(b, 3, 4, 5, 6);
  for (const id of first) await a.fail(id);
  for (const id of second) await b.fail(id);
  const open = await notices();
  expect(open.map((c) => c.type)).toEqual(['baton.runner-faulting', 'baton.runner-faulting', 'baton.fleet-faulting']);
  expect(JSON.parse(open[2].detail_json).reasons[0].count).toBe(7);
  await setClock(start + 5 * minute);
  expect((await beat('vm-a', a.secret, { concurrency: 20 })).status).toBe(200);
  for (const id of await take(a, 7, 8, 9)) await a.fail(id);
  expect(await a.claim(10)).toMatchObject({ status: 409, json: { code: 'runner-backing-off', until: start + 15 * minute } });
  expect((await notices()).map((c) => c.id)).toEqual(open.map((c) => c.id));
});

it('S-BTN-6 keeps a solitary ticket exhausted and non-retryable ends out of a burst', async () => {
  const git = await board(4);
  await rows('UPDATE repositories SET retry = ? WHERE id = ?', JSON.stringify({ backoff_ms: [minute], max_failed: 3 }), 'docs');
  const a = await runner('vm-a');
  for (let i = 0; i < 3; i++) {
    await setClock(start + i * minute);
    if (i) expect((await git.refresh()).status).toBe(200);
    await a.fail((await take(a, 0))[0]);
  }
  for (const id of await take(a, 1, 2)) await a.fail(id, 'released:cannot-finish:spec', 'error.permanent');
  expect(await rows('SELECT hold_reason FROM ticket_overrides WHERE hold = 1 ORDER BY ticket_id'))
    .toEqual(['attempts-exhausted', 'non-retryable:spec', 'non-retryable:spec'].map((hold_reason) => ({ hold_reason })));
  expect(await notices()).toEqual([]);
  await take(a, 3);
});
