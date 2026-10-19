// S-BTN-63 no review by its author's key (BATON_SPEC §13a, §2m.1 R-BTN-106; B-2): a claim runs
// `implement` and reaches `pr-open`; its runner tries to advance into `review`, which names
// `implement` in `no_chain_from`; it suspends, then claims the ticket again under the same key; the
// course file drops the list while the owners' `required_independence` names it. Must hold: the
// advance and the second claim are refused, rule `chain`; a runner under another key takes
// `review`; with the list dropped from git the owner setting still refuses the first key.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { advance, claimItem, course, cutover, endClaim, Git, keyCall, placed, recommended, register, setAdminKeys, setClock } from '../helpers';
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

  it('with the list dropped from git, the owners’ required_independence still refuses the first key', async () => {
    // The course file in force has no list (the model's own file, so this case replays through
    // the model whole: a refusal is no model action).
    expect((await keyCall(owner, '/v1/owner/docs/settings', { required_independence: { review: ['implement'] } }, 'PUT')).status).toBe(200);
    const a = await implementAndSuspend();
    expect(await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' })).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'chain' } });
    const b = await register('vm-b');
    expect((await claimItem('vm-b', b.secret, { ticket_id: 'docs:T-1' })).json).toMatchObject({ ticket_id: 'docs:T-1', legs: ['review'] });
  });
});
