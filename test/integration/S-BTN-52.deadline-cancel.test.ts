// S-BTN-52, G-BTN-80 (R-BTN-90): run deadlines and the fence before re-issue, on both hosts.
import { beforeEach, describe, expect, it } from 'vitest';
import { advance, beat, claimItem, course, cutover, endClaim, Git, hbBody, register, rows, runnerCall, setClock, sha256, tick } from '../helpers';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';

const T0 = Date.parse('2026-11-14T09:00:00Z');
const MIN = 60_000;
const DUE = T0 + 30 * MIN;
const LEASE = { lease_timeout_s: 3600 };
const ticket = 'docs:A';
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git().add('A');
  git.registry = [course(3, 3, { course: {
    ...roadmapPr,
    legs: { ...roadmapPr.legs, implement: { ...roadmapPr.legs.implement, max_duration: 1800 } },
  } })]; // B-295 owns renaming the course key to deadline_s.
  expect((await git.post()).status).toBe(200);
  await cutover();
});

async function start() {
  const a = await register('vm-a', LEASE);
  const c = await claimItem('vm-a', a.secret, { ticket_id: ticket });
  expect(c.status).toBe(200);
  const id = c.json.claim_id as number;
  const started = await advance('vm-a', a.secret, id, { leg: 'implement' });
  expect(started.status).toBe(200);
  return { a, id, seq: started.json.seq as number };
}

async function alarmAt(at: number) {
  await setClock(at);
  await tick();
}

async function claimRow(id: number) {
  return (await rows<{ status: string; end_reason: string; fence_pending: number; fence_deadline: number | null; failed_attempt: number }>(
    'SELECT status, end_reason, fence_pending, fence_deadline, failed_attempt FROM claims WHERE id = ?', id))[0];
}

describe('S-BTN-52: a run deadline', () => {
  it('arms at advance, re-arms just once on an early finish, and clears on advance into a leg with no deadline', async () => {
    const { a, id, seq } = await start();
    expect((await beat('vm-a', a.secret, LEASE)).json.claim.deadline_at).toBe(DUE);
    await setClock(DUE - 1);
    const finished = { ...LEASE, legs_finished: [{ claim_id: id, seq }] };
    expect((await beat('vm-a', a.secret, finished)).json.claim.deadline_at).toBe(DUE - 1 + 40 * MIN);
    await alarmAt(DUE);
    const retry = await beat('vm-a', a.secret, finished);
    expect(retry.json.claim.deadline_at).toBe(DUE - 1 + 40 * MIN);
    expect(retry.json.messages).toEqual([]);
    expect((await advance('vm-a', a.secret, id, { reached: 'pr-open', leg: 'review' })).status).toBe(200);
    await alarmAt(DUE + 40 * MIN);
    const review = await beat('vm-a', a.secret, LEASE);
    expect(review.json.claim.deadline_at).toBeUndefined();
    expect(review.json.messages).toEqual([]);
  });

  it.each([0, 1])('withdraws a queued but undelivered release when finishing at deadline + %i ms', async (offset) => {
    const { a, id, seq } = await start();
    await alarmAt(DUE);
    await setClock(DUE + offset);
    const finish = await beat('vm-a', a.secret, { ...LEASE, legs_finished: [{ claim_id: id, seq }] });
    expect(finish.json.messages).toEqual([]);
    expect(await rows("SELECT status, withdrawn FROM messages WHERE kind = 'release'"))
      .toEqual([{ status: 'expired', withdrawn: 'leg-finished' }]);
    expect(await rows("SELECT json_extract(detail_json, '$.withdrawn') AS withdrawn FROM events WHERE kind = 'leg-timeout' ORDER BY seq"))
      .toEqual([{ withdrawn: null }, { withdrawn: 1 }]);
  });

  it.each([0, 1])('an already delivered release stands at deadline + %i ms and its end counts once', async (offset) => {
    const { a, id, seq } = await start();
    await alarmAt(DUE);
    const delivery = (await beat('vm-a', a.secret, LEASE)).json.messages;
    expect(delivery).toEqual([expect.objectContaining({ kind: 'release', payload: { ticket_id: ticket, reason: 'leg-timeout', deadline_at: DUE } })]);
    await setClock(DUE + offset);
    expect((await beat('vm-a', a.secret, { ...LEASE, legs_finished: [{ claim_id: id, seq }] })).json.messages).toEqual(delivery);
    const end = { end_reason: 'released:leg-timeout', reached: 'filed', next: 'implement' };
    expect((await endClaim('vm-a', a.secret, id, end)).status).toBe(200);
    expect((await endClaim('vm-a', a.secret, id, end)).status).toBe(200);
    expect(await claimRow(id)).toMatchObject({ status: 'released', failed_attempt: 1, fence_pending: 0 });
    expect((await runnerCall(`/v1/runner/messages/${delivery[0].id}/ack`, { cred: 'vm-a', secret: a.secret, body: {} })).status).toBe(200);
    expect((await beat('vm-a', a.secret, LEASE)).json.messages).toEqual([]);
  });

  it.each(['sidecar', 'deadline'])('reaps only 15 minutes after delivery and clears by %s', async (clear) => {
    const { a, id } = await start();
    await alarmAt(DUE);
    const delivered = DUE + 16 * MIN;
    await alarmAt(delivered); // The still-pending message has no acknowledgment clock.
    expect(await claimRow(id)).toMatchObject({ status: 'active' });
    expect((await beat('vm-a', a.secret, LEASE)).json.messages).toHaveLength(1);
    const reap = delivered + 15 * MIN;
    await alarmAt(reap - 1);
    expect(await claimRow(id)).toMatchObject({ status: 'active' });
    await alarmAt(reap);
    const fenceDeadline = reap + 60 * MIN;
    expect(await claimRow(id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:leg-timeout', failed_attempt: 1, fence_pending: 1, fence_deadline: fenceDeadline });
    expect(await rows('SELECT actor FROM events WHERE claim_id = ? AND kind = ?', id, 'reaped')).toEqual([{ actor: 'alarm:leg-timeout' }]);
    expect(await rows("SELECT status FROM messages WHERE kind = 'release'")).toEqual([{ status: 'expired' }]);
    const b = await register('vm-b', LEASE);
    expect((await git.post()).status).toBe(200);
    expect((await claimItem('vm-b', b.secret, { ticket_id: ticket })).json.rule).toBe(3);
    const fenced = { claim_id: id, terminated: true };
    if (clear === 'sidecar') {
      expect((await beat('vm-a', a.secret, LEASE)).json.claim).toBeNull();
      await beat('vm-a', a.secret, { ...LEASE, fenced });
    } else {
      const secret = 'next-incarnation';
      const rekey = await runnerCall('/v1/runner/heartbeat', { cred: 'vm-a', body: hbBody('vm-a', { rekey: true, secret_hash: await sha256(secret) }) });
      expect(await rekey.json()).toMatchObject({ incarnation: 2 });
      await beat('vm-a', secret, { fenced });
      await alarmAt(reap + 15 * MIN); // The new incarnation's silence does not clear it.
      expect((await claimRow(id)).fence_pending).toBe(1);
      await alarmAt(fenceDeadline - 1);
      await beat('vm-a', secret, { ...LEASE, fenced }); // A new heartbeat does not extend it.
      expect((await claimRow(id)).fence_pending).toBe(1);
      await alarmAt(fenceDeadline);
      expect(await rows("SELECT json_extract(detail_json, '$.deadline') AS deadline FROM events WHERE claim_id = ? AND kind = 'fence-cleared'", id))
        .toEqual([{ deadline: 1 }]);
    }
    expect((await claimRow(id)).fence_pending).toBe(0);
    expect(await rows('SELECT reaped_at FROM runners WHERE id = ?', a.id)).toEqual([{ reaped_at: null }]);
    // Both paths still owe the normal retry backoff and a fresh reading since the end.
    await alarmAt(fenceDeadline);
    await beat('vm-b', b.secret, LEASE);
    expect((await git.post()).status).toBe(200);
    expect((await claimItem('vm-b', b.secret, { ticket_id: ticket })).status).toBe(200);
  });
});
