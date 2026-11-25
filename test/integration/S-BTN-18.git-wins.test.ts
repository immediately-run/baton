// S-BTN-18 Baton owns the position (BATON_SPEC §15, R-BTN-10, R-BTN-35, R-BTN-39): a completed
// end is confirmed by its evidence, never by where git puts the ticket. A suspension that named no
// evidence is confirmed by the next accepted snapshot; one that named a commit or a URL is listed
// by the observation and confirmed only by a post carrying the sync's `std:git.evidence@1` for that
// claim and that evidence with `found: true` — until then unconfirmed, unoffered and flagged at
// 6 h. On bering, 2026-11-23–24, 47 review suspensions waited on a git path that no longer carries
// positions. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { advance, claimItem, claimRow, cutover, endClaim, Git, observe, placed, recommended, register, setClock, stateView } from '../helpers';

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

  it('a suspension that named evidence is listed by the observation and confirmed only by the sync attesting that evidence found; never by a git path, the clock, found: false or another claim’s word', async () => {
    const w1 = await register('vm-a', { lease_timeout_s: 86_400 });
    const w2 = await register('vm-b', { lease_timeout_s: 86_400 });
    const { json: c } = await claimItem('vm-a', w1.secret);
    expect(c).toMatchObject({ station: 'pr-open', legs: ['review'] });
    await advance('vm-a', w1.secret, c.claim_id, { leg: 'review' });
    // The review leg names its verdict comment (R-BTN-8): on bering, 2026-11-24, 44 review
    // suspensions named theirs and waited on a git path that no longer carries positions.
    const url = 'https://github.com/o/r/pull/7#issuecomment-123';
    await endClaim('vm-a', w1.secret, c.claim_id, { end_reason: 'suspended:reviewed', reached: 'reviewed', ended_at_sha: url });
    const evidence = (claim: number, named: string, found: boolean, ticket = 'T-1') => ({ attestations: [{ type: 'std:git.evidence@1', ticket, ref: String(claim), value: { claim, evidence: named, found } }] });
    const postWith = async (extra: Record<string, unknown>) => {
      const o = await observe();
      return { listed: (o.json as { unconfirmed?: unknown }).unconfirmed, post: await git.refresh({ observation: o.json.observation, ...extra }) };
    };
    // The observation lists the end with what it named; a post without the sync's word confirms nothing.
    const first = await postWith({});
    expect(first.listed).toEqual([{ ticket: 'T-1', claim: c.claim_id, evidence: url }]);
    expect(first.post).toMatchObject({ status: 200, confirmed: 0 });
    // Git placing the ticket where the claim left it is not evidence (R-BTN-39: the position is Baton's).
    git.place('T-1', placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['fix', 'ready']]));
    expect((await postWith({})).post).toMatchObject({ status: 200, confirmed: 0 });
    // Not found, another evidence, another claim or another ticket: still unconfirmed and unoffered.
    expect((await postWith(evidence(c.claim_id, url, false))).post).toMatchObject({ status: 200, confirmed: 0 });
    expect((await postWith(evidence(c.claim_id, 'https://github.com/o/r/pull/7#issuecomment-999', true))).post).toMatchObject({ status: 200, confirmed: 0 });
    expect((await postWith(evidence(c.claim_id + 1, url, true))).post).toMatchObject({ status: 200, confirmed: 0 });
    expect((await postWith(evidence(c.claim_id, url, true, 'T-2'))).post).toMatchObject({ status: 200, confirmed: 0 });
    expect((await claimRow(c.claim_id)).confirmed_at).toBeNull();
    expect(await recommended(w2.id)).toEqual([]);
    expect((await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-1' })).json).toMatchObject({ code: 'not-eligible', rule: 3 });
    // Flagged on the dashboard at 6 h, never confirmed by the clock.
    await setClock(T0 + 6 * H);
    const state = (await stateView()) as { needs_you: { unconfirmed: { id: number }[] } };
    expect(state.needs_you.unconfirmed.map((u) => u.id)).toEqual([c.claim_id]);
    // The sync attests the very evidence found: confirmed, no longer listed, and offered again.
    expect((await postWith(evidence(c.claim_id, url, true))).post).toMatchObject({ status: 200, confirmed: 1 });
    expect((await claimRow(c.claim_id)).confirmed_at).toBe(T0 + 6 * H);
    expect((await postWith({})).listed).toEqual([]);
    expect(await recommended(w2.id)).toEqual(['docs:T-1']);
  });

  it('a malformed std:git.evidence@1 refuses the post', async () => {
    const bad = { attestations: [{ type: 'std:git.evidence@1', ticket: 'T-1', value: { claim: 1, evidence: 'x', found: 'yes' } }] };
    expect(await git.refresh(bad)).toMatchObject({ status: 400, code: 'invalid-params' });
  });
});
