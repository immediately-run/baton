// S-BTN-63 no review by its author's key (BATON_SPEC §15, §8.3 R-BTN-106; B-2): a claim runs
// `implement` and reaches `pr-open`; its runner tries to advance into `review`, which names
// `implement` in `no_chain_from`; it suspends, then claims the ticket again under the same key; the
// course file drops the list while the owners' `required_independence` names it. Must hold: the
// advance and the second claim are refused, rule `chain`; a runner under another key takes
// `review`; with the list dropped from git the owner setting still refuses the first key.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { adminSession, advance, claimItem, course, cutover, endClaim, Git, keyCall, placed, recommended, register, sessionCall, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-19T12:00:00Z');
const CHAINED = { ...roadmapPr, legs: { ...roadmapPr.legs, review: { ...roadmapPr.legs.review, no_chain_from: ['implement'] } } };
const AT_PR_OPEN = placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]);
let git: Git;
let admin: TestKey;
let owner: TestKey;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  git = new Git();
  git.add('T-1', { rank: 1 });
  await git.post();
  await cutover();
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

/** vm-a implements T-1 and is refused the advance into `review`; it suspends at `pr-open`, which
 *  the next snapshot confirms. Returns vm-a's session. */
async function implementAndSuspend() {
  const a = await register('vm-a');
  const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
  expect((await advance('vm-a', a.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
  expect(await advance('vm-a', a.secret, c.claim_id, { reached: 'pr-open', leg: 'review' }))
    .toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'chain', rule_code: 'chain' } });
  expect((await endClaim('vm-a', a.secret, c.claim_id, { end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'review' })).status).toBe(200);
  git.place('T-1', AT_PR_OPEN);
  expect(await git.post()).toMatchObject({ confirmed: 1 });
  return a;
}

describe('S-BTN-63 no review by its author’s key', () => {
  it('the course file’s no_chain_from refuses the advance and a second claim by the same key; another key takes review', async () => {
    git.registry = [course(3, 3, { course: CHAINED })];
    await git.post();
    const a = await implementAndSuspend();
    // The same key, in the same session or another, is neither offered nor given review.
    expect(await recommended(a.id)).toEqual([]);
    expect(await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' })).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'chain' } });
    const a2 = await register('vm-a', { session_name: 's-other' });
    expect(await claimItem('vm-a', a2.secret, { ticket_id: 'docs:T-1' })).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'chain' } });
    // A runner under another key takes it.
    const b = await register('vm-b');
    expect(await recommended(b.id)).toEqual(['docs:T-1']);
    const { json: c } = await claimItem('vm-b', b.secret, { ticket_id: 'docs:T-1' });
    expect(c).toMatchObject({ ticket_id: 'docs:T-1', station: 'pr-open', legs: ['review'] });
    expect((await advance('vm-b', b.secret, c.claim_id, { leg: 'review' })).status).toBe(200);
  });

  it('the owners have no second statement of it: required_independence is refused, and the course file is the one', async () => {
    // B-168 (§8.3, R-BTN-106): the owners' setting is gone — the file's `no_chain_from` alone holds.
    // The settings route reads it as no setting at all, and the dashboard's Settings lists none.
    expect((await keyCall(owner, '/v1/owner/docs/settings', { required_independence: { review: ['implement'] } }, 'PUT')).json).toMatchObject({ code: 'invalid-params' });
    const state = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as { limits: { settings: Record<string, unknown>[] } };
    expect(state.limits.settings.find((s) => s.repository_id === 'docs')).not.toHaveProperty('required_independence');
    // With no list in the course file in force, the same key that implemented takes review: the
    // file is the one statement of it, and it says nothing here.
    const a = await register('vm-a');
    const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', a.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    expect((await endClaim('vm-a', a.secret, c.claim_id, { end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'review' })).status).toBe(200);
    git.place('T-1', AT_PR_OPEN);
    expect(await git.post()).toMatchObject({ confirmed: 1 });
    const { json: again } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
    expect(again).toMatchObject({ ticket_id: 'docs:T-1', station: 'pr-open', legs: ['review'] });
  });

  it('a course file that renames the leg it keys on keeps the list, so the rename is no loosening', async () => {
    git.registry = [course(3, 3, { course: CHAINED })];
    await git.post();
    // The file renames review and keeps its list on the renamed leg: a key that ran implement is
    // refused peer-review as it was review — the rename loosens nothing.
    const { review, ...legs } = roadmapPr.legs;
    git.registry = [course(4, 3, { course: { ...roadmapPr, legs: { ...legs, 'peer-review': { ...review, no_chain_from: ['implement'], renamed_from: ['review'] } } } })];
    await git.post();
    const a = await register('vm-a');
    const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', a.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    // The same key ends suspended at pr-open with the renamed leg queued; a later snapshot posts
    // the ticket there, and the key is refused that leg — the refusal follows the rename.
    expect((await endClaim('vm-a', a.secret, c.claim_id, { end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'peer-review' })).status).toBe(200);
    git.place('T-1', { ...placed('pr-open', [['implement', 'pr-open']], [['peer-review', 'ready']]) });
    expect(await git.post()).toMatchObject({ confirmed: 1 });
    // The key cannot even be offered the leg (R-BTN-106's read), and asking for it by id refuses
    // it `chain`: the renamed leg's list names implement, and the rename is no loosening.
    expect(await recommended(a.id)).toEqual([]);
    expect((await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' })).json).toMatchObject({ code: 'not-eligible', rule: 'chain' });
  });
});
