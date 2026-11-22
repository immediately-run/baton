// S-BTN-2 (§9.5): a service gap is not runner silence; the recovery grace is finite.
import { beforeEach, expect, inject, it } from 'vitest';
import { beat, claimItem, claimRow, cutover, endClaim, payload, register, rows, seedClaim, setClock, syncCall, tick, withCore } from '../helpers';

const board = inject('board');
const LEASE = 900_000;
const T0 = Date.now() + 3_600_000; // Only explicit ticks run: the host's real alarm is in the future.

beforeEach(async () => {
  await setClock(T0);
  await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
  await cutover();
});

it.each(['alarm', 'request'])('gives held claims one lease from recovery via %s', async (first) => {
  const ready = await register('vm-a');
  const dead = await register('vm-b');
  const { json: a } = await claimItem('vm-a', ready.secret, { ticket_id: 'docs:R3-9001' });
  const { json: b } = await claimItem('vm-b', dead.secret, { ticket_id: 'docs:R3-9002' });
  // A separate claim of the returning runner was force-reaped before the outage.
  const fenced = await seedClaim(ready.id, 'docs:R3-9003', T0);
  expect(await withCore((core) => core.store.transaction(() => core.claims.forceReap('test', fenced, { confirm: true }))))
    .toMatchObject({ fence_pending: true });
  await tick();

  // No alarm or requests for ten hours. The finished leg's next beat is two minutes later.
  const recovery = T0 + 10 * 3_600_000;
  await setClock(recovery);
  if (first === 'request') {
    expect((await syncCall('/v1/sync/head')).status).toBe(200);
    await setClock(recovery + 60_000);
  }
  await tick();
  expect((await claimRow(a.claim_id)).status).toBe('active');
  expect((await claimRow(b.claim_id)).status).toBe('active');
  expect(await claimRow(fenced)).toMatchObject({ status: 'reaped', fence_pending: 0 });
  expect(await rows('SELECT last_seen_at FROM runners WHERE id = ?', dead.id)).toEqual([{ last_seen_at: T0 }]);

  await setClock(recovery + 120_000);
  expect((await beat('vm-a', ready.secret)).status).toBe(200);
  const end = await endClaim('vm-a', ready.secret, a.claim_id, { end_reason: 'done', ended_at_sha: board.shas.A });
  expect(end.status, JSON.stringify(end.json)).toBe(200);
  expect(await claimRow(a.claim_id)).toMatchObject({ status: 'completed' });

  await setClock(recovery + LEASE - 1);
  await tick();
  expect((await claimRow(b.claim_id)).status).toBe('active');
  await setClock(recovery + LEASE);
  await tick();
  expect(await claimRow(b.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent', fence_pending: 0 });
  expect((await beat('vm-b', dead.secret)).json.code).toBe('runner-reaped');
});

it('does not excuse runner silence when requests kept reaching Baton but the alarm did not run', async () => {
  const dead = await register('vm-a');
  const { json: claim } = await claimItem('vm-a', dead.secret, { ticket_id: 'docs:R3-9001' });
  await tick();

  for (const elapsed of [LEASE / 2, LEASE]) {
    await setClock(T0 + elapsed);
    expect((await syncCall('/v1/sync/head')).status).toBe(200);
  }
  await setClock(T0 + LEASE + 60_000);
  await tick();
  expect(await claimRow(claim.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent' });
});
