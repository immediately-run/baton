// S-BTN-63 no review by its author's key (BATON_SPEC §15, §8.3 R-BTN-106; B-2): a claim runs
// `implement` and reaches `pr-open`; its runner tries to advance into `review`, which names
// `implement` in `no_chain_from`; it suspends, then claims the ticket again under the same key.
// Must hold: the advance and the second claim are refused, rule `chain`; a runner under another
// key takes `review`. The course file is the only statement of the rule.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { CREATE_PR_COURSE, stationsPr } from '../../src/defaults/course-pr';
import type { BranchCommit, RecordedLeg } from '../../src/defaults/pr-markers';
import type { SourceTicket } from '../../src/defaults/tickets-markdown';
import { advance, claimItem, course, cutover, endClaim, evidenceFound, Git, keyCall, observe, placed, recommended, register, setAdminKeys, setClock } from '../helpers';
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
  it('create-pr refuses both the implementer and the fixer after the test gate; a third key reviews', async () => {
    git.registry = [course(1, 1, { id: 'create-pr', course: CREATE_PR_COURSE })];
    git.add('T-1', { rank: 1, course_id: 'create-pr' });
    expect((await git.post()).status).toBe(200);
    const runner = { courses: [{ repository: 'docs', course: 'create-pr', version: 1 }] };
    const ticket = { ticket_id: 'docs:T-1' };
    const refused = { status: 409, json: { code: 'not-eligible', rule: 'chain' } };
    const sha = (n: number) => n.toString(16).padStart(40, '1');
    const commits: BranchCommit[] = [];
    const push = (n: number, marker?: { tests: 'red' | 'green'; nonce: string }) => {
      const parent = commits.at(-1)?.sha ?? null;
      commits.push({ sha: sha(n), parent, at: T0 + n, empty: marker != null,
        message: marker ? `baton: tests ${marker.tests} for T-1\n\nBaton-Tests: ${marker.tests}\nBaton-Tested: ${parent}\nBaton-Claim: ${marker.nonce}` : 'work' });
    };
    const sync = async (next: string) => {
      const { json } = await observe();
      const { legs } = json as typeof json & { legs: RecordedLeg[] };
      const { stations, markers } = stationsPr({
        tickets: [git.tickets.get('T-1') as unknown as SourceTicket], closed: new Set(), graph: CREATE_PR_COURSE,
        facts: [{ number: 1, head: 'claude/T-1-work', state: 'open', pushedAt: commits.at(-1)!.at, checks: [], reviews: [], commits }],
        baton: { legs },
      });
      expect(stations['T-1'].next_leg).toBe(next);
      git.place('T-1', stations['T-1']);
      // R-BTN-10: the sync attests the evidence each unconfirmed end named.
      const unconfirmed = ((json as { unconfirmed?: { ticket: string; claim: number; evidence: string }[] }).unconfirmed ?? []);
      const attestations = unconfirmed.flatMap((u) => evidenceFound(u.claim, u.evidence, u.ticket).attestations);
      expect(await git.post({ observation: json.observation, markers, attestations })).toMatchObject({ status: 200, confirmed: 1 });
    };
    const a = await register('vm-a', runner);
    const { json: impl } = await claimItem('vm-a', a.secret, ticket);
    expect((await advance('vm-a', a.secret, impl.claim_id, { leg: 'implement' })).status).toBe(200);
    const loopEnd = { finished_self_loop: true, end_reason: 'suspended:filed' };
    expect(await endClaim('vm-a', a.secret, impl.claim_id, loopEnd))
      .toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(await endClaim('vm-a', a.secret, impl.claim_id, { ...loopEnd, ended_at_sha: sha(1) }))
      .toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    push(1);
    expect((await advance('vm-a', a.secret, impl.claim_id, { reached: 'pr-open', leg: 'run-tests' })).status).toBe(200);
    push(2, { tests: 'red', nonce: impl.nonce });
    // Hand off the red result so fix can run under a key that never implemented.
    expect((await endClaim('vm-a', a.secret, impl.claim_id, { end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'fix', finished_self_loop: true, ended_at_sha: sha(2) })).status).toBe(200);
    await sync('fix');

    const b = await register('vm-b', runner);
    const { json: fix } = await claimItem('vm-b', b.secret, ticket);
    expect((await advance('vm-b', b.secret, fix.claim_id, { leg: 'fix' })).status).toBe(200);
    push(3);
    expect((await advance('vm-b', b.secret, fix.claim_id, { reached: 'fixed', leg: 'run-tests' })).status).toBe(200);
    push(4, { tests: 'green', nonce: fix.nonce });
    expect(await advance('vm-b', b.secret, fix.claim_id, { reached: 'fixed', leg: 'review', evidence: sha(4) })).toMatchObject(refused);
    expect((await endClaim('vm-b', b.secret, fix.claim_id, { end_reason: 'suspended:fixed', reached: 'fixed', next: 'review', finished_self_loop: true, ended_at_sha: sha(4) })).status).toBe(200);
    await sync('review');

    expect(await claimItem('vm-a', a.secret, ticket)).toMatchObject(refused);
    expect(await claimItem('vm-b', b.secret, ticket)).toMatchObject(refused);
    const c = await register('mac', runner);
    const review = await claimItem('mac', c.secret, ticket);
    expect(review).toMatchObject({ status: 200, json: { station: 'fixed', legs: ['review'] } });
    expect((await advance('mac', c.secret, review.json.claim_id, { leg: 'review' })).status).toBe(200);
  });

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
    const state = (await keyCall(admin, '/v1/admin/state')).json as { limits: { settings: Record<string, unknown>[] } };
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
