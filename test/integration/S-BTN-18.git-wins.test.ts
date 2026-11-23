// S-BTN-18 git wins (BATON_SPEC §15, R-BTN-10, R-BTN-35, R-BTN-71; R3-1232): a session suspends at
// reviewed naming a commit, but one seat's review never posted; separately, a peer posts a review
// Baton never saw. Must hold: the suspension stays unconfirmed while the sync places the ticket at
// pr-open, and the ticket is not offered, flagged at 6 h; the peer's review moves the ticket to
// reviewed at the next snapshot, which confirms the end. A suspension that named no commit is
// confirmed by the next accepted snapshot whatever git shows: its position is Baton's alone
// (R-BTN-39) — on bering, 2026-11-23, 47 review suspensions waited on a path git never carries.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { advance, claimItem, claimRow, cutover, endClaim, Git, ownerCall, placed, recommended, register, setClock, stateView } from '../helpers';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const H = 3_600_000;
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git().add('T-1', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
  await git.post();
  await cutover();
});

describe('S-BTN-18 git wins', () => {
  it('a suspension that named no commit is confirmed by the next accepted snapshot, though git shows no path for it, and the ticket is offered again', async () => {
    const w1 = await register('vm-a', { lease_timeout_s: 86_400 });
    const w2 = await register('vm-b', { lease_timeout_s: 86_400 });
    const { json: c } = await claimItem('vm-a', w1.secret);
    await advance('vm-a', w1.secret, c.claim_id, { leg: 'review' });
    // A review leg pushes nothing: its end names no ended_at_sha.
    await endClaim('vm-a', w1.secret, c.claim_id, { end_reason: 'suspended:reviewed', reached: 'reviewed' });
    expect((await claimRow(c.claim_id)).confirmed_at).toBeNull();
    // Git carries no position (R-BTN-39): it still shows pr-open, yet the end is confirmed.
    expect(await git.refresh()).toMatchObject({ status: 200, confirmed: 1 });
    expect((await claimRow(c.claim_id)).confirmed_at).toBe(T0);
    expect(await recommended(w2.id)).toEqual(['docs:T-1']);
    expect((await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-1' })).json).toMatchObject({ claim_id: expect.any(Number) });
  });

  it('a suspension that named a commit git does not show stays unconfirmed and unoffered, flagged at 6 h; a later path confirms it', async () => {
    const w1 = await register('vm-a', { lease_timeout_s: 86_400 });
    const w2 = await register('vm-b', { lease_timeout_s: 86_400 });
    const { json: c } = await claimItem('vm-a', w1.secret);
    expect(c).toMatchObject({ station: 'pr-open', legs: ['review'] });
    await advance('vm-a', w1.secret, c.claim_id, { leg: 'review' });
    await endClaim('vm-a', w1.secret, c.claim_id, { end_reason: 'suspended:reviewed', reached: 'reviewed', ended_at_sha: 'a'.repeat(40) });
    // One seat's review never posted: git still has the ticket at pr-open.
    expect(await git.refresh()).toMatchObject({ status: 200, confirmed: 0 });
    expect((await claimRow(c.claim_id)).confirmed_at).toBeNull();
    expect(await recommended(w2.id)).toEqual([]);
    expect((await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-1' })).json).toMatchObject({ code: 'not-eligible', rule: 3 });
    // Flagged on the dashboard at 6 h, never confirmed by the clock.
    await setClock(T0 + 6 * H);
    const state = (await stateView()) as { needs_you: { unconfirmed: { id: number }[] } };
    expect(state.needs_you.unconfirmed.map((u) => u.id)).toEqual([c.claim_id]);
    // A peer's round-one review, marker and all: the next snapshot places the ticket at reviewed,
    // which extends the path the suspension expects — confirmed, and the ticket offered again.
    git.place('T-1', placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready'], ['merge', 'waiting', 'findings']]));
    expect(await git.refresh()).toMatchObject({ status: 200, confirmed: 1 });
    expect(await recommended(w2.id)).toEqual(['docs:T-1']);
  });

  it('a suspension that named a commit is confirmed only by the path, never by the station alone: a second round’s end is not the first’s', async () => {
    const w1 = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w1.secret);
    for (const body of [{ leg: 'review' }, { reached: 'reviewed', leg: 'fix' }, { reached: 'fixed', leg: 'review' }]) {
      expect((await advance('vm-a', w1.secret, c.claim_id, body)).status).toBe(200);
    }
    await endClaim('vm-a', w1.secret, c.claim_id, { end_reason: 'suspended:reviewed', reached: 'reviewed', ended_at_sha: 'a'.repeat(40) });
    // Git shows the first round's reviewed: the same station, not the claim's path.
    git.place('T-1', placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready']]));
    expect(await git.refresh()).toMatchObject({ confirmed: 0 });
    git.place('T-1', placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed'], ['fix', 'fixed'], ['review', 'reviewed']], [['merge', 'ready']]));
    expect(await git.refresh()).toMatchObject({ confirmed: 1 });
  });
});
