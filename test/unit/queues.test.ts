// queues.test.ts — the one writer of `leg_queues` (BATON_SPEC §2g R-BTN-79; R3-1255): a ticket's
// membership through each transaction that changes it — a snapshot moving it, a claim's start and
// its end, a confirmation, a fence clearing, a ticket leaving the board, a leg renamed — a crossing
// of the bound both ways, a course file changing the bound, and the notice updated in place while
// the leg stays over.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { Git, adminSession, advance, beat, claimItem, course, cutover, endClaim, keyCall, placed, refresh, register, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-20T09:00:00Z');
const AT_PR_OPEN = placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]);
const REVIEWED = placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready']]);
const bounded = (fix: number | null, review: number | null = null) => {
  const legs = { ...roadmapPr.legs, fix: { ...roadmapPr.legs.fix }, review: { ...roadmapPr.legs.review } } as Record<string, Record<string, unknown>>;
  if (fix != null) legs.fix.max_queue = fix;
  if (review != null) legs.review.max_queue = review;
  return { ...roadmapPr, legs };
};

let admin: TestKey;
let owner: TestKey;
let cli: TestKey;
let git: Git;

const depths = async () => Object.fromEntries((await rows<{ leg: string; depth: number }>(
  `SELECT leg, depth FROM leg_queues WHERE repository_id = 'docs' AND depth > 0 ORDER BY leg`)).map((r) => [r.leg, r.depth]));
const member = async (id: string) => (await rows<{ leg: string }>('SELECT leg FROM leg_queue_members WHERE ticket_id = ?', id))[0]?.leg ?? null;
const kinds = async () => (await rows<{ kind: string }>(`SELECT kind FROM events WHERE kind IN ('queue-over', 'course-closed', 'course-opened') ORDER BY seq`)).map((e) => e.kind);
const overNotices = () => rows<{ state: string; payload_json: string }>(`SELECT state, payload_json FROM notices WHERE kind = 'queue-over' ORDER BY id`);
const reap = async (claimId: number) => sessionCall(await adminSession(admin), `/v1/ui/claims/${claimId}/reap`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  cli = await makeKey('ssh-ed25519', 'owner-cli');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(owner, '/v1/owner/docs/couriers', { public_key: cli.publicKey, asks: ['owner'] })).status).toBe(200);
  git = new Git();
  git.registry = [course(3, 3, { course: bounded(1) })];
  git.add('T-1', {}, AT_PR_OPEN).add('T-2', {}, AT_PR_OPEN).add('T-3');
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('R-BTN-79: membership follows the queued leg and the hold', () => {
  it('a snapshot places tickets in their queued leg\'s queue and moves them; a ticket leaving the board leaves it', async () => {
    expect(await depths()).toEqual({ implement: 1, review: 2 });
    git.place('T-1', REVIEWED);
    expect((await git.post()).status).toBe(200);
    expect(await depths()).toEqual({ fix: 1, implement: 1, review: 1 });
    expect(await member('docs:T-1')).toBe('fix');
    git.close('T-2', 'withdrawn');
    expect((await git.post()).status).toBe(200);
    expect(await depths()).toEqual({ fix: 1, implement: 1 });
    expect(await member('docs:T-2')).toBeNull();
  });

  it('a claim takes its ticket out; a release puts it back; a completed end stays out until git confirms it', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect(await depths()).toEqual({ implement: 1, review: 1 });
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:requested' })).status).toBe(200);
    expect(await depths()).toEqual({ implement: 1, review: 2 });

    await refresh(); // §6.7: a reading since the end
    const { json: d } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', w.secret, d.claim_id, { leg: 'review' })).status).toBe(200);
    expect((await endClaim('vm-a', w.secret, d.claim_id, { end_reason: 'suspended:reviewed', reached: 'reviewed', next: 'fix' })).status).toBe(200);
    // Completed and unconfirmed: still held, in no queue.
    expect(await member('docs:T-1')).toBeNull();
    git.place('T-1', REVIEWED);
    expect((await git.post()).status).toBe(200);
    expect(await member('docs:T-1')).toBe('fix');
    expect(await depths()).toEqual({ fix: 1, implement: 1, review: 1 });
  });

  it('a reaped claim keeps its ticket out until the fence clears', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect((await reap(c.claim_id)).status).toBe(200);
    expect(await member('docs:T-1')).toBeNull();
    await beat('vm-a', w.secret, { fenced: { claim_id: c.claim_id, terminated: true } });
    expect(await member('docs:T-1')).toBe('review');
  });

  it('a renamed leg keeps its tickets, under the new name', async () => {
    const { review, ...legs } = roadmapPr.legs;
    git.registry = [course(4, 3, { course: { ...roadmapPr, legs: { ...legs, check: { ...review, renamed_from: 'review' } } } })];
    expect((await git.post()).status).toBe(200);
    expect(await rows(`SELECT course_id FROM course_refusals`)).toEqual([]);
    expect(await member('docs:T-1')).toBe('check');
    expect((await depths()).check).toBe(2);
    expect((await depths()).review).toBeUndefined();
  });
});

describe('R-BTN-79: the bound, as a warning', () => {
  it('rising above it warns once and closes the intake; the notice is updated in place; falling to it closes both', async () => {
    const w = await register('vm-a');
    git.place('T-1', REVIEWED);
    expect((await git.post()).status).toBe(200);
    expect(await kinds()).toEqual([]);
    git.place('T-2', REVIEWED);
    expect((await git.post()).status).toBe(200);
    expect(await kinds()).toEqual(['queue-over', 'course-closed']);
    // Visible: the repository's stats and the dashboard's courses carry the queue and the intake.
    const stats = await withCore((o) => (o.stats as unknown as { of: (r: string, since: number, now: number) => Record<string, any> }).of('docs', 0, T0));
    expect(stats.courses['roadmap-pr']).toMatchObject({ intake: 'closed', legs: { fix: { queue: { depth: 2, max_queue: 1 } } } });
    const ui = await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json() as { repositories: { id: string; courses: unknown[] }[] };
    expect(ui.repositories.find((r) => r.id === 'docs')!.courses).toEqual([expect.objectContaining({ id: 'roadmap-pr', intake: 'closed',
      queues: expect.arrayContaining([{ leg: 'fix', depth: 2, max_queue: 1 }]) })]);
    const [first] = await overNotices();
    expect(JSON.parse(first.payload_json)).toEqual({ course: 'roadmap-pr', leg: 'fix', depth: 2, max_queue: 1, intake: 'closed' });
    // A third: logged no more, the one notice updated in place.
    git.add('T-4', {}, REVIEWED);
    expect((await git.post()).status).toBe(200);
    expect(await kinds()).toEqual(['queue-over', 'course-closed']);
    const now = await overNotices();
    expect(now).toHaveLength(1);
    expect(JSON.parse(now[0].payload_json)).toMatchObject({ depth: 3 });
    // Two claims bring it back to its bound: the notice closes and the course reopens.
    await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect((await overNotices())[0].state).toBe('queued');
    const v = await register('vm-b');
    await claimItem('vm-b', v.secret, { ticket_id: 'docs:T-2' });
    expect((await overNotices())[0].state).toBe('closed');
    expect(await kinds()).toEqual(['queue-over', 'course-closed', 'course-opened']);
  });

  it('a course file lowering the bound below the depth is a crossing; raising it again ends it', async () => {
    expect(await kinds()).toEqual([]);
    git.registry = [course(4, 3, { course: bounded(1, 1) })];
    expect((await git.post()).status).toBe(200);
    expect(await rows(`SELECT depth, max_queue FROM leg_queues WHERE leg = 'review'`)).toEqual([{ depth: 2, max_queue: 1 }]);
    expect(await kinds()).toEqual(['queue-over', 'course-closed']);
    git.registry = [course(5, 3, { course: bounded(1) })];
    expect((await git.post()).status).toBe(200);
    expect(await kinds()).toEqual(['queue-over', 'course-closed', 'course-opened']);
    expect((await overNotices()).map((n) => n.state)).toEqual(['closed']);
  });

  it('no ticket is held, blocked or refused for a full queue', async () => {
    git.registry = [course(4, 3, { course: bounded(1, 1) })];
    expect((await git.post()).status).toBe(200);
    expect(await rows('SELECT id FROM tickets WHERE blocked_since IS NOT NULL')).toEqual([]);
    const w = await register('vm-a');
    // T-1 is not new: the closed intake gives no advice about it.
    expect((await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' })).status).toBe(200);
    expect(await rows(`SELECT detail_json FROM events WHERE kind = 'advice-overridden' AND detail_json LIKE '%intake%'`)).toEqual([]);
  });
});
