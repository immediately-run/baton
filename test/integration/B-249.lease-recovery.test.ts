// S-BTN-2 (§9.5): a service gap is not runner silence; the recovery grace is finite.
import { beforeEach, expect, inject, it } from 'vitest';
import { adminSession, beat, claimItem, claimRow, cutover, endClaim, keyCall, payload, register, rows, seedClaim, sessionCall, setAdminKeys, setClock, syncCall, tick, withCore } from '../helpers';
import { makeKey } from '../lib/sshKeys';

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

  const recovery = T0 + 10 * 3_600_000;
  // Model Baton being unreachable at the transport: the finished end gets a 500 and no
  // request reaches the core. Replay the same end before heartbeat, in the runner's order.
  const body = { end_reason: 'done', ended_at_sha: board.shas.A };
  let offline = true;
  const sendEnd = async () => offline
    ? { status: 500, json: { code: 'internal' } }
    : endClaim('vm-a', ready.secret, a.claim_id, body);
  await setClock(recovery - 120_000);
  expect((await sendEnd()).status).toBe(500);
  expect((await claimRow(a.claim_id)).status).toBe('active');

  await setClock(recovery);
  offline = false;
  if (first === 'request') {
    expect((await syncCall('/v1/sync/head')).status).toBe(200);
    await setClock(recovery + 60_000);
  }
  await tick();
  expect((await claimRow(a.claim_id)).status).toBe('active');
  expect((await claimRow(b.claim_id)).status).toBe('active');
  expect(await claimRow(fenced)).toMatchObject({ status: 'reaped', fence_pending: 0 });
  expect(await rows('SELECT last_seen_at FROM runners ORDER BY id')).toEqual([{ last_seen_at: T0 }, { last_seen_at: T0 }]);

  await setClock(recovery + 120_000);
  const end = await sendEnd();
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

it.each(['force-reap', 'retirement'])('keeps a sibling claim usable after %s during recovery', async (action) => {
  const admin = await makeKey('ssh-ed25519', 'recovery-admin');
  await setAdminKeys(admin);
  const w = await register('vm-a');
  const { json: claim } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:R3-9001' });
  const sibling = await seedClaim(w.id, 'baton:B-1', T0);
  await setClock(T0 + 10 * 3_600_000);
  await tick();
  if (action === 'force-reap') {
    await withCore((core) => core.store.transaction(() => core.claims.forceReap('test', sibling, { confirm: true })));
  } else {
    const retired = await keyCall(admin, '/v1/admin/repositories', { id: 'baton', retire: true, confirm: true });
    expect(retired.status).toBe(200);
  }
  expect(await claimRow(sibling)).toMatchObject({ status: 'reaped' });
  const end = await endClaim('vm-a', w.secret, claim.claim_id, { end_reason: 'done', ended_at_sha: board.shas.A });
  expect(end.status, JSON.stringify(end.json)).toBe(200);
});

it('does not infer a full-lease outage from a sampled stamp alone', async () => {
  const w = await register('vm-a');
  const { json: claim } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:R3-9001' });
  await setClock(T0 + 59_000);
  expect((await syncCall('/v1/sync/head')).status).toBe(200);
  await setClock(T0 + LEASE + 1_000);
  await tick();
  expect(await claimRow(claim.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent' });
});

it('counts conditional reads as service even without an alarm tick', async () => {
  const admin = await makeKey('ssh-ed25519', 'recovery-admin');
  await setAdminKeys(admin);
  const cookie = await adminSession(admin);
  const w = await register('vm-a');
  const { json: claim } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:R3-9001' });
  const first = await sessionCall(cookie, '/v1/actions');
  expect(first.status).toBe(200);
  const tag = first.headers.get('ETag')!;
  for (const elapsed of [LEASE / 2, LEASE]) {
    await setClock(T0 + elapsed);
    expect((await sessionCall(cookie, '/v1/actions', { headers: { 'If-None-Match': tag } })).status).toBe(304);
  }
  await setClock(T0 + LEASE + 120_000);
  await tick();
  expect(await claimRow(claim.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent' });
});

it('reports the effective claim deadline without refreshing runner liveness', async () => {
  const admin = await makeKey('ssh-ed25519', 'recovery-admin');
  await setAdminKeys(admin);
  const w = await register('vm-a');
  const { json: claim } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:R3-9001' });
  const recovery = T0 + 10 * 3_600_000;
  await setClock(recovery);
  await tick();
  const cookie = await adminSession(admin);
  const read = async (path: string) => {
    const res = await sessionCall(cookie, `/v1/repositories/docs/${path}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, any>;
  };
  const ends = { lease_ends_at: recovery + LEASE };
  expect((await read('board')).holders).toContainEqual(expect.objectContaining({ ticket_id: 'docs:R3-9001', ...ends }));
  expect((await read('tickets/R3-9001')).claim).toMatchObject(ends);
  expect((await read('tickets')).tickets).toContainEqual(expect.objectContaining({ ticket_id: 'docs:R3-9001', detail: expect.objectContaining(ends) }));
  expect((await read('runners')).runners).toContainEqual(expect.objectContaining({ runner_id: w.id, last_seen_at: T0, alive: false, claim: expect.objectContaining(ends) }));
  expect(await withCore((core) => core.claims.running(core.now()))).toContainEqual(expect.objectContaining({ id: claim.claim_id, reap_at: recovery + LEASE }));
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
