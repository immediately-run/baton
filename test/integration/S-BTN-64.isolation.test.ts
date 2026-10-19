// S-BTN-64 isolation floors (BATON_SPEC §13a, §2m.1 R-BTN-107; B-2): a leg requires
// `isolation: session`; an `attached`, a `process` and a `session` worker ask for
// recommendations. Must hold: only the `session` worker is offered it; the others' claims and
// advances into it are refused, rule `isolation`. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { adminSession, advance, beat, claimItem, course, cutover, Git, placed, recommended, register, rows, sessionCall, setAdminKeys, setClock } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-19T12:00:00Z');
const ISOLATED = { ...roadmapPr, legs: { ...roadmapPr.legs, review: { ...roadmapPr.legs.review, isolation: 'session' } } };
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  git.registry = [course(3, 3, { course: ISOLATED })];
  git.add('R-1', { rank: 1 }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']])).add('F-1', { rank: 2 });
  await git.post();
  await cutover();
});

describe('S-BTN-64 isolation floors', () => {
  it('only the session worker is offered the leg; the others’ claims and advances into it are refused, rule isolation', async () => {
    const attached = await register('vm-a', { isolation: 'attached' });
    const proc = await register('vm-b');
    const session = await register('mac', { isolation: 'session' });
    expect(await rows('SELECT isolation FROM workers ORDER BY id')).toEqual([{ isolation: 'attached' }, { isolation: 'process' }, { isolation: 'session' }]);
    // The dashboard's Workers view carries each worker's mode (R-BTN-107, §14).
    const admin = await makeKey('ssh-ed25519', 'admin');
    await setAdminKeys(admin);
    const state = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as { workers: { id: number; isolation: string }[] };
    expect(Object.fromEntries(state.workers.map((w) => [w.id, w.isolation]))).toEqual({ [attached.id]: 'attached', [proc.id]: 'process', [session.id]: 'session' });

    expect(await recommended(session.id)).toEqual(['docs:R-1', 'docs:F-1']);
    expect(await recommended(attached.id)).toEqual(['docs:F-1']);
    expect(await recommended(proc.id)).toEqual(['docs:F-1']);
    for (const [cred, w] of [['vm-a', attached], ['vm-b', proc]] as const) {
      expect(await claimItem(cred, w.secret, { ticket_id: 'docs:R-1' })).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'isolation', rule_code: 'isolation' } });
    }

    // An advance into the leg: the process worker implements F-1, then may not review it.
    const { json: c } = await claimItem('vm-b', proc.secret, { ticket_id: 'docs:F-1' });
    expect((await advance('vm-b', proc.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    expect(await advance('vm-b', proc.secret, c.claim_id, { reached: 'pr-open', leg: 'review' }))
      .toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'isolation' } });

    expect((await claimItem('mac', session.secret, { ticket_id: 'docs:R-1' })).json).toMatchObject({ ticket_id: 'docs:R-1', legs: ['review'] });
  });

  it('the declaration is the worker’s latest heartbeat: one that stops declaring session is refused', async () => {
    const w = await register('mac', { isolation: 'session' });
    expect(await recommended(w.id)).toEqual(['docs:R-1', 'docs:F-1']);
    expect((await beat('mac', w.secret)).status).toBe(200);
    expect(await recommended(w.id)).toEqual(['docs:F-1']);
    expect((await beat('mac', w.secret, { isolation: 'sandbox' })).json).toMatchObject({ code: 'invalid-params' });
  });
});
