// S-BTN-309 work done outside Baton (BATON_SPEC §15): the sync finds, and core places.
import { expect, it } from 'vitest';
import { course, Git, cutover, rows, claimItem, register, advance, endClaim, withCore } from '../helpers';
import { CREATE_PR_COURSE, CREATE_SPEC_COURSE, REVIEW_PR_COURSE, type PrFact } from '../../src/defaults/course-pr';
import { graphOf } from '../../src/core/graph';
import { validateCourse } from '../../src/core/course';
import { outsideAttestations, type OutsideRecord } from '../../src/defaults/outside-work';
import { reconcileAnswer, type PrExec } from '../../src/defaults/pr-verify';
import type { SourceTicket } from '../../src/defaults/tickets-markdown';

const record: OutsideRecord = { sha: null, observed_at: 300, head_accepted_at: 100, runner_pushers: ['runner'], positions: {}, verdict_refs: {}, claim_prs: {}, claim_shas: {}, merge_refs: {} };
const sha = (n: number) => String(n).padStart(40, 'a');
const pr = (number: number, extra: Partial<PrFact> = {}): PrFact => ({ number, head: 'feature', state: 'merged', pushedAt: 0, checks: [], reviews: [], repository: 'org/repo', url: `https://github.com/org/repo/pull/${number}`, pusher: true, mergedAt: 200, mergeSha: sha(number), ...extra });
const classify = (facts: PrFact[], overrides: { station?: string; graph?: object; record?: OutsideRecord; since?: number | null } = {}) => outsideAttestations({
  tickets: [{ id: 'B-166', repos: [], course: { prs: [] } } as unknown as SourceTicket], facts, graph: graphOf(overrides.graph ?? CREATE_PR_COURSE),
  patterns: ['work/{ticket}'], repository: 'org/repo', record: { ...(overrides.record ?? record), ...(overrides.station ? { positions: { 'B-166': { station: overrides.station, changed_at: 100 } } } : {}) },
  commits: [], mentionSince: overrides.since === undefined ? 100 : overrides.since, ticketDir: 'tickets', filingCommit: () => null, ownPr: (p) => p.head === 'work/B-166',
});
const facts166 = [158, 159, 163, 164].map((n) => pr(n, { title: `Deliver B-166, part ${n}` }));
const placement = () => rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'docs:B-166');
const setup = async () => {
  const git = new Git();
  git.registry = [course(3, 2, { course: CREATE_PR_COURSE, step_kinds: Object.keys(CREATE_PR_COURSE.legs) })];
  expect(await git.add('B-166').post()).toMatchObject({ status: 200 });
  await cutover();
  return git;
};

it('validates the standard graphs and rejects a fact or reconcile as start or next', () => {
  for (const graph of [CREATE_PR_COURSE, CREATE_SPEC_COURSE, REVIEW_PR_COURSE]) expect(validateCourse(graph)).toEqual([]);
  expect(validateCourse({ ...CREATE_PR_COURSE, start_leg: 'opened-by-hand' })).not.toEqual([]);
  expect(validateCourse({ ...CREATE_PR_COURSE, start_leg: 'reconcile' })).not.toEqual([]);
});

it('finds four B-166 mentions without a mapped PR, only within a window or backfill', () => {
  expect(classify(facts166, { since: null })).toEqual([]);
  expect(classify(facts166, { since: 250 })).toEqual([]);
  expect(classify([pr(10, { title: 'B-166 B-1 B-2 B-3' }), pr(11, { title: 'B-16' }), ...facts166]).map((a) => a.value)).toEqual(facts166.map((p) => ({ ref: p.url, kind: 'mention' })));
});

it.each(['unchanged verified no change', 'delivered abcdef0 tests passed'])('queues evidence at filed and settles %s', async (answer) => {
  const git = await setup();
  const attestations = classify(facts166);
  expect(await git.post({ attestations: [...attestations, attestations[0]] })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'filed', next_leg: 'reconcile' }]);
  const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
  const claim = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B-166' });
  expect(claim.json).toMatchObject({ displaced: 'implement', evidence: attestations.map((a) => a.value) });
  const id = claim.json.claim_id;
  expect((await advance('vm-a', runner.secret, id, { leg: 'reconcile' })).status).toBe(200);
  const run: PrExec = (_cmd, args) => args[0] === 'rev-parse' ? sha(1) : '';
  const result = reconcileAnswer(answer, { checkout: '.', ticket: { id: 'B-166' }, ticketText: null, from: 'filed', displaced: 'implement', to: CREATE_PR_COURSE.legs.reconcile.reconciles.to, branch: 'main' }, run);
  expect(await endClaim('vm-a', runner.secret, id, { ...result, end_reason: 'done' })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: result.reached, next_leg: result.next }]);
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toEqual([]);
});

it.each(['pr-open', 'reviewed'])('records a hand merge from %s without a test gate', async (station) => {
  const git = await setup();
  const opened = classify([pr(1, { head: 'work/B-166', state: 'open', author: 'person' })]);
  expect(await git.post({ attestations: opened })).toMatchObject({ status: 200 });
  if (station === 'reviewed') {
    const verdict = { type: 'std:arrival@1', ticket: 'B-166', ref: 'https://github.com/org/repo/pull/1#pullrequestreview-2', value: { leg: 'reviewed-by-hand', reached: 'reviewed', next: 'merge' } };
    expect(await git.post({ attestations: [verdict] })).toMatchObject({ status: 200 });
  }
  expect(await placement()).toMatchObject([{ station }]);
  const merge = pr(1, { head: 'work/B-166' });
  const attestations = classify([merge], { station });
  const narrowed = { ...CREATE_PR_COURSE, legs: { ...CREATE_PR_COURSE.legs, 'merged-by-hand': { ...CREATE_PR_COURSE.legs['merged-by-hand'], from: ['reviewed'] } } };
  if (station === 'pr-open') expect(classify([merge], { station, graph: narrowed }).map((a) => a.value)).toEqual([{ ref: merge.mergeSha, kind: 'merged-early' }]);
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'merged', next_leg: null }]);
  expect(await rows('SELECT 1 FROM ticket_history WHERE ticket_id = ? AND kind = ? AND leg = ?', 'docs:B-166', 'fact-arrival', 'merged-by-hand')).toHaveLength(1);
});

it('defers a fact under an owner hold and applies it on lift', async () => {
  const git = await setup();
  const hold = (value: boolean) => withCore((c) => c.store.transaction(() => c.claims.setOverride('owner', 'docs:B-166', { hold: value })));
  await hold(true);
  const attestations = classify([pr(1, { head: 'work/B-166' })]);
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'filed', next_leg: 'implement' }]);
  await hold(false);
  expect(await placement()).toEqual([{ station: 'merged', next_leg: null }]);
});

it('drops an arrival under a claim, then applies a fresh attestation after release', async () => {
  const git = await setup();
  const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
  const claim = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B-166' });
  expect(claim.status).toBe(200);
  const attestations = classify([pr(1, { head: 'work/B-166' })]);
  for (let i = 0; i < 2; i++) expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'filed', next_leg: 'implement' }]);
  expect(await rows("SELECT 1 FROM ticket_history WHERE ticket_id = ? AND kind = 'arrival-unapplied'", 'docs:B-166')).toHaveLength(1);
  expect((await endClaim('vm-a', runner.secret, claim.json.claim_id, { end_reason: 'released:requested' })).status).toBe(200);
  expect(await placement()).toEqual([{ station: 'filed', next_leg: 'implement' }]);
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'merged', next_leg: null }]);
});

it('does not take a hand verdict superseded by a runner on the same head', () => {
  const head = sha(2);
  const review = { author: 'reviewer', state: 'APPROVED' as const, headSha: head, submittedAt: 200, url: `${pr(1).url}#pullrequestreview-2` };
  const fact = pr(1, { head: 'work/B-166', headSha: head, state: 'open', author: 'author', pushedAt: 120,
    commits: [{ sha: head, parent: sha(3), at: 120, pusher: 'author', empty: false, message: 'change' }], reviews: [review] });
  expect(classify([fact], { station: 'pr-open' }).map((a) => a.value)).toMatchObject([{ leg: 'reviewed-by-hand', next: 'merge' }]);
  fact.reviews.push({ ...review, author: 'runner', state: 'CHANGES_REQUESTED', submittedAt: 210, url: `${pr(1).url}#pullrequestreview-3` });
  expect(classify([fact], { station: 'pr-open' })).toEqual([]);
});
