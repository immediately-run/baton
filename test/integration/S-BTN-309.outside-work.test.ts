// S-BTN-309 work done outside Baton (BATON_SPEC §15): the sync finds, and core places.
import { expect, it } from 'vitest';
import { course, Git, cutover, rows, claimItem, claimRow, register, advance, endClaim, withCore } from '../helpers';
import { CREATE_PR_COURSE, CREATE_SPEC_COURSE, REVIEW_PR_COURSE, stationsReviewPr, type PrFact } from '../../src/defaults/course-pr';
import { graphOf } from '../../src/core/graph';
import { validateCourse } from '../../src/core/course';
import { outsideAttestations, type OutsideRecord, type MentionCommit } from '../../src/defaults/outside-work';
import { reconcileAnswer, type PrExec } from '../../src/defaults/pr-verify';
import type { SourceTicket } from '../../src/defaults/tickets-markdown';

const record: OutsideRecord = { sha: null, observed_at: 300, head_accepted_at: 100, runner_pushers: ['runner'], positions: {}, verdict_refs: {}, claim_prs: {}, claim_shas: {}, merge_refs: {} };
const sha = (n: number) => String(n).padStart(40, 'a');
const pr = (number: number, extra: Partial<PrFact> = {}): PrFact => ({ number, head: 'feature', state: 'merged', pushedAt: 0, checks: [], reviews: [], repository: 'org/repo', url: `https://github.com/org/repo/pull/${number}`, pusher: true, mergedAt: 200, mergeSha: sha(number), ...extra });
const classify = (facts: PrFact[], overrides: { station?: string; graph?: object; record?: OutsideRecord; since?: number | null; repos?: string[]; commits?: MentionCommit[]; filing?: string } = {}) => outsideAttestations({
  tickets: [{ id: 'B-166', repos: overrides.repos ?? [], course: { prs: [] }, path: 'tickets/B-166.mdx' } as unknown as SourceTicket], facts, graph: graphOf(overrides.graph ?? CREATE_PR_COURSE),
  patterns: ['work/{ticket}'], repository: 'org/repo', record: { ...(overrides.record ?? record), ...(overrides.station ? { positions: { 'B-166': { station: overrides.station, changed_at: 100 } } } : {}) },
  commits: overrides.commits ?? [], mentionSince: overrides.since === undefined ? 100 : overrides.since, ticketDir: 'tickets', filingCommit: () => overrides.filing ?? null, ownPr: (p) => p.head === 'work/B-166',
});
const facts166 = [158, 159, 163, 164].map((n) => pr(n, { title: `Deliver B-166, part ${n}` }));
const placement = () => rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'docs:B-166');
const setup = async (graph = CREATE_PR_COURSE as object) => {
  const git = new Git();
  git.registry = [course(3, 2, { course: graph, step_kinds: [...graphOf(graph).legs.keys()] })];
  expect(await git.add('B-166').post()).toMatchObject({ status: 200 });
  await cutover();
  return git;
};

it('validates the standard graphs and rejects a fact or reconcile as start or next', () => {
  for (const graph of [CREATE_PR_COURSE, CREATE_SPEC_COURSE, REVIEW_PR_COURSE]) expect(validateCourse(graph)).toEqual([]);
  expect(validateCourse({ ...CREATE_PR_COURSE, start_leg: 'opened-by-hand' })).not.toEqual([]);
  expect(validateCourse({ ...CREATE_PR_COURSE, start_leg: 'reconcile' })).not.toEqual([]);
  type MutableLeg = { to?: unknown; max_runs?: number };
  const graph = () => structuredClone(CREATE_PR_COURSE) as {
    legs: Record<string, MutableLeg> & { 'opened-by-hand': MutableLeg & { arrives: { next: string } } };
  };
  for (const mutate of [
    (ls: ReturnType<typeof graph>['legs']) => { ls['opened-by-hand'].to = ['pr-open', 'fixed']; },
    (ls: ReturnType<typeof graph>['legs']) => { ls['opened-by-hand'].arrives.next = 'reconcile'; },
    (ls: ReturnType<typeof graph>['legs']) => { ls['opened-by-hand'].arrives.next = 'reviewed-by-hand'; },
    (ls: ReturnType<typeof graph>['legs']) => { delete ls.reconcile.max_runs; },
    (ls: ReturnType<typeof graph>['legs']) => { ls.reconcile.to = 'merged'; },
    (ls: ReturnType<typeof graph>['legs']) => { ls['also-reconcile'] = ls.reconcile; },
  ]) {
    const bad = graph();
    mutate(bad.legs);
    expect(validateCourse(bad)).not.toEqual([]);
  }
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
  const run: PrExec = (_cmd, args) => args[0] === 'rev-parse' ? 'abcdef0'.padEnd(40, 'a') : '';
  const result = reconcileAnswer(answer, { checkout: '.', ticket: { id: 'B-166' }, ticketText: null, from: 'filed', displaced: 'implement', to: CREATE_PR_COURSE.legs.reconcile.reconciles.to, branch: 'main' }, run);
  expect(await endClaim('vm-a', runner.secret, id, { ...result, end_reason: 'done' })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: result.reached, next_leg: result.next }]);
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toEqual([]);
  expect((await claimRow(id)).confirmed_at).toBeNull();
  expect(await git.refresh()).toMatchObject({ status: 200 });
  expect((await claimRow(id)).confirmed_at).not.toBeNull();
  if (result.next === 'implement') expect((await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B-166' })).json).toMatchObject({ legs: ['implement'] });
  else expect(await rows(`SELECT leg, state FROM ticket_next_legs WHERE ticket_id = 'docs:B-166'`)).toMatchObject([{ leg: 'confirm', state: 'ready' }]);
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
    headPush: { at: 120, actor: 'author', changesWork: true }, reviews: [review] });
  expect(classify([fact], { station: 'pr-open' }).map((a) => a.value)).toMatchObject([{ leg: 'reviewed-by-hand', next: 'merge' }]);
  fact.reviews.push({ ...review, author: 'runner', state: 'CHANGES_REQUESTED', submittedAt: 210, url: `${pr(1).url}#pullrequestreview-3` });
  expect(classify([fact], { station: 'pr-open' })).toEqual([]);
});

it('keeps a partial merge as evidence without suppressing the current-head verdict or reverting it to an older push', () => {
  const headSha = sha(6);
  const open = pr(1, { head: 'work/B-166', state: 'open', headSha, author: 'author', headPush: { at: 160, actor: 'fixer', changesWork: true },
    reviews: [{ author: 'reviewer', state: 'CHANGES_REQUESTED', submittedAt: 150, headSha: sha(2) }] });
  const merged = pr(2, { head: 'work/B-166', repository: 'org/sibling' });
  const options = { station: 'pr-open', repos: ['org/sibling'] };
  expect(classify([open, merged], options).map((a) => a.value)).toMatchObject([{ kind: 'merged-early' }, { leg: 'fixed-by-hand' }]);
  open.reviews.push({ author: 'reviewer', state: 'APPROVED', submittedAt: 200, headSha, url: `${open.url}#pullrequestreview-2` });
  expect(classify([open, merged], options).map((a) => a.value)).toMatchObject([{ kind: 'merged-early' }, { leg: 'reviewed-by-hand' }]);
});

it('posts merged-early to a narrowed course and queues its reconcile leg', async () => {
  const graph = { ...CREATE_PR_COURSE, legs: { ...CREATE_PR_COURSE.legs, 'merged-by-hand': { ...CREATE_PR_COURSE.legs['merged-by-hand'], from: ['reviewed'] } } };
  const git = await setup(graph);
  const opened = classify([pr(1, { head: 'work/B-166', state: 'open', author: 'person' })], { graph });
  expect(await git.post({ attestations: opened })).toMatchObject({ status: 200 });
  const attestations = classify([pr(1, { head: 'work/B-166' })], { station: 'pr-open', graph });
  expect(attestations.map((a) => a.value)).toEqual([{ ref: sha(1), kind: 'merged-early' }]);
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'pr-open', next_leg: 'reconcile' }]);
});

it.each([[3, 1], [1, 3]])('restores the displaced leg at the first exhausted limit (runs %i, retries %i)', async (max_runs, max_failed) => {
  const graph = { ...CREATE_PR_COURSE, legs: { ...CREATE_PR_COURSE.legs, reconcile: { ...CREATE_PR_COURSE.legs.reconcile, max_runs } } };
  const git = await setup(graph);
  await rows(`UPDATE repositories SET retry = ? WHERE id = 'docs'`, JSON.stringify({ backoff_ms: [60_000], max_failed }));
  const attestations = classify(facts166);
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
  const claim = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B-166' });
  expect(claim.json).toMatchObject({ displaced: 'implement' });
  expect((await advance('vm-a', runner.secret, claim.json.claim_id, { leg: 'reconcile' })).status).toBe(200);
  expect((await endClaim('vm-a', runner.secret, claim.json.claim_id, { end_reason: 'released:cannot-finish:transient' })).status).toBe(200);
  expect(await git.refresh({ attestations })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'filed', next_leg: 'implement' }]);
  expect((await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B-166' })).status).toBe(200);
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toHaveLength(4);
});

it.each(['closed', 'rounds spent'] as const)('queues conclude from the new review-pr station function when %s', async (when) => {
  const graph = REVIEW_PR_COURSE;
  const git = new Git();
  git.registry = [course(3, 2, { course: graph, step_kinds: [...graphOf(graph).legs.keys()] })];
  const ticket = { id: 'B-166', repos: [], course: { prs: ['https://github.com/org/repo/pull/1'] }, depends_on: [], blocked_by: [] } as unknown as SourceTicket;
  const stations = (extra: Partial<PrFact>) => stationsReviewPr({ tickets: [ticket], facts: [pr(1, extra)], closed: new Set(), repository: 'org/repo', graph }).stations['B-166'];
  expect(await git.add('B-166', {}, stations({ state: 'open' })).post()).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'requested', next_leg: 'review' }]);
  const trigger = when === 'closed' ? { state: 'closed' as const } : { state: 'open' as const, pushes: [15, 25, 35],
    reviews: [10, 20, 30].map((submittedAt) => ({ author: 'reviewer', state: 'CHANGES_REQUESTED' as const, submittedAt })) };
  expect(await git.place('B-166', stations(trigger)).post()).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'requested', next_leg: 'conclude' }]);
});

it('accepts and keeps the entire outside-work window above the old 100-attestation limit', async () => {
  const git = await setup();
  const attestations = classify(Array.from({ length: 120 }, (_, i) => pr(i + 1, { title: 'Deliver B-166' })));
  expect(attestations).toHaveLength(120);
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toHaveLength(120);
});

it('only posts first-parent commit mentions that survive each exclusion', () => {
  const commits = ['tickets/B-166.mdx', '.baton/baton.json', 'filed', 'claim', 'merged', 'many', 'substring', 'actual'].map((path, i) => ({
    sha: sha(i + 1), paths: [path], message: path === 'many' ? 'B-166 B-1 B-2 B-3' : path === 'substring' ? 'B-1660' : 'B-166',
  }));
  const options = { commits, record: { ...record, claim_shas: { 'B-166': [sha(4)] } }, filing: sha(3) };
  const own = pr(5, { head: 'work/B-166' });
  expect(classify([own], options).filter((a) => a.type === 'std:evidence@1').map((a) => a.ref)).toEqual([sha(8)]);
  expect(classify([own], { ...options, station: 'merged' })).toEqual([]);
});

it('leaves outside evidence waiting behind a person leg', async () => {
  const graph = { ...CREATE_PR_COURSE, legs: { ...CREATE_PR_COURSE.legs, reconcile: { ...CREATE_PR_COURSE.legs.reconcile,
    from: [...CREATE_PR_COURSE.legs.reconcile.from, 'delivered'] } } };
  const git = await setup(graph);
  // Queue a person leg via the real reconcile end; additional evidence cannot displace it.
  const attestations = classify(facts166);
  expect(await git.post({ attestations })).toMatchObject({ status: 200 });
  const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
  const { json: { claim_id: id } } = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B-166' });
  expect((await advance('vm-a', runner.secret, id, { leg: 'reconcile' })).status).toBe(200);
  expect((await endClaim('vm-a', runner.secret, id, { reached: 'delivered', next: 'confirm', end_reason: 'done' })).status).toBe(200);
  expect(await git.refresh({ attestations: classify([pr(9, { title: 'Deliver B-166' })], { station: 'delivered' }) })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'delivered', next_leg: 'confirm' }]);
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toHaveLength(1);
});

it('leaves outside evidence waiting behind a suspended leg', async () => {
  const git = await setup();
  const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
  const { json: { claim_id: id } } = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:B-166' });
  expect((await advance('vm-a', runner.secret, id, { leg: 'implement' })).status).toBe(200);
  expect((await endClaim('vm-a', runner.secret, id, { reached: 'filed', next: 'implement', end_reason: 'suspended:filed' })).status).toBe(200);
  expect(await git.refresh({ attestations: classify(facts166) })).toMatchObject({ status: 200 });
  expect((await claimRow(id)).confirmed_at).not.toBeNull();
  expect(await placement()).toEqual([{ station: 'filed', next_leg: 'implement' }]);
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toHaveLength(4);
});

it('keeps a policy-refused hand merge as evidence, including under a pre-evidence policy', async () => {
  const git = await setup();
  await rows(`INSERT INTO repository_policies (repository_id, version, policy_json, hash, previous_hash, changed_by, at)
    SELECT repository_id, version + 1, json_remove(policy_json, '$.attestations."std:arrival@1"', '$.attestations."std:evidence@1"'), ?, hash, changed_by, at
    FROM repository_policies WHERE repository_id = 'docs'`, 'a'.repeat(64));
  const attestations = classify([pr(1, { head: 'work/B-166' })]);
  expect(await git.post({ attestations: [...attestations, ...classify(facts166)] })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'filed', next_leg: 'reconcile' }]);
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toContainEqual({ ref: sha(1), kind: 'merged-early' });
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toHaveLength(5);
});

it('stores a new fact ref as evidence when the fact leg has no runs left', async () => {
  const graph = { ...CREATE_PR_COURSE, legs: { ...CREATE_PR_COURSE.legs,
    'reviewed-by-hand': { ...CREATE_PR_COURSE.legs['reviewed-by-hand'], max_runs: 1 } } };
  const git = await setup(graph);
  expect(await git.post({ attestations: classify([pr(1, { head: 'work/B-166', state: 'open', author: 'person' })]) })).toMatchObject({ status: 200 });
  const review = (n: number) => ({ type: 'std:arrival@1', ticket: 'B-166', ref: `https://github.com/org/repo/pull/1#pullrequestreview-${n}`,
    value: { leg: 'reviewed-by-hand', reached: 'reviewed', next: 'merge' } });
  expect(await git.post({ attestations: [review(2), review(3)] })).toMatchObject({ status: 200 });
  expect(await placement()).toEqual([{ station: 'reviewed', next_leg: 'reconcile' }]);
  expect(await withCore((core) => core.outsideWork.evidence('docs:B-166'))).toEqual([{ ref: review(3).ref, kind: 'fact' }]);
});

it('checks all mapped repositories before accepting at merged', () => {
  const ask = { checkout: '.', ticket: { id: 'B-166' }, ticketText: null, from: 'filed', displaced: 'implement',
    repositories: ['org/sibling'], branchPatterns: ['work/{ticket}'], to: { merged: null }, branch: 'main' };
  const mapped = (state: 'closed' | 'open', merged: boolean) => ({ number: 1, head: { ref: 'work/B-166' }, base: { ref: 'main' }, state,
    merged_at: merged ? '2026-11-20' : null, merge_commit_sha: merged ? sha(4) : null });
  let sibling: unknown[] = [mapped('open', false)];
  const run: PrExec = (cmd, args) => {
    if (cmd === 'git') return 'https://github.com/org/repo.git';
    if (args[0] === 'pr') return JSON.stringify({ state: 'MERGED', headRefName: 'work/B-166', baseRefName: 'main' });
    if (args.at(-1)?.includes('?state=all')) return JSON.stringify([args.at(-1)?.includes('/sibling/') ? sibling : [mapped('closed', true)]]);
    return JSON.stringify({ default_branch: 'main' });
  };
  const answer = `at merged ${pr(1).url}`;
  expect(() => reconcileAnswer(answer, ask, run)).toThrow(/not all mapped repositories/);
  sibling = [];
  expect(() => reconcileAnswer(answer, ask, run)).toThrow(/not all mapped repositories/);
  sibling = [mapped('closed', true)];
  expect(reconcileAnswer(answer, ask, run)).toMatchObject({ reached: 'merged', next: null });
});

it('rejects a superseded reconcile verdict even when it names the current head', () => {
  const ask = { checkout: '.', ticket: { id: 'B-166' }, ticketText: null, from: 'pr-open', displaced: 'review',
    branchPatterns: ['work/{ticket}'], to: { reviewed: 'merge' }, branch: 'main' };
  const review = (id: number, state: string) => ({ user: { login: 'reviewer' }, state, submitted_at: `2026-11-${id}T00:00:00Z`,
    html_url: `${pr(1).url}#pullrequestreview-${id}`, commit_id: sha(1) });
  const reviews = [review(20, 'APPROVED')];
  const run: PrExec = (cmd, args) => {
    if (cmd === 'git') return 'https://github.com/org/repo.git';
    if (args[0] === 'pr') return JSON.stringify({ state: 'OPEN', headRefName: 'work/B-166', headRefOid: sha(1), baseRefName: 'main' });
    const path = args.at(-1)!;
    if (path.includes('/reviews?')) return JSON.stringify([reviews]);
    if (path.includes('/comments?')) return '[[]]';
    if (path.includes('/permission')) return '{"permission":"write"}';
    return '{"default_branch":"main"}';
  };
  const answer = `at reviewed ${reviews[0].html_url}`;
  expect(reconcileAnswer(answer, ask, run)).toMatchObject({ reached: 'reviewed', next: 'merge' });
  reviews.push(review(21, 'CHANGES_REQUESTED'));
  expect(() => reconcileAnswer(answer, ask, run)).toThrow(/not the latest qualifying verdict/);
});
