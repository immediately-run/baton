// course-pr.test.ts — the `pr` course's default station function (BATON_SPEC §2f R-BTN-74;
// R3-1249): every station from recorded PR facts — a merged PR before and after the file says
// done, two PRs, a closed unmerged PR, a red check, a head with no checks, a comment-only
// review with and without a verdict line, one identity authoring and reviewing — and the
// three-fix limit. Pure and host-neutral.
import { describe, it, expect } from 'vitest';
import { CREATE_PR_COURSE, REVIEW_PR_COURSE, branchMatches, prNumbers, stationsPr, stationsReviewPr, type PrFact } from '../../src/defaults/course-pr';
import type { SourceTicket as PostedTicket } from '../../src/defaults/tickets-markdown';

const T0 = 1_000_000;
const ticket = (id: string, over: Partial<PostedTicket> = {}): PostedTicket => ({ id, course_id: 'pr', path: `tickets/${id}.md`, title: id, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], rank: null, ...over });
const pr = (over: Partial<PrFact> & { number: number }): PrFact => ({ head: `claude/A-${over.number}`, state: 'open', pushedAt: T0 - 1000, checks: ['success'], reviews: [], ...over });
const run = (tickets: PostedTicket[], facts: PrFact[], closed = new Set<string>(), more: { done?: Set<string>; branchPatterns?: string[]; repository?: string } = {}) =>
  stationsPr({ tickets, facts, closed, ...more }).stations;

describe('no PR, or a closed unmerged one', () => {
  it('no PR is filed; implement waits while a dependency is not closed done, ready after', () => {
    const out = run([ticket('A', { depends_on: ['B'] }), ticket('B')], [], new Set(['B']));
    expect(out.A).toMatchObject({ station: 'filed', next_leg: 'implement', next: [{ leg: 'implement', state: 'ready', waiting_on: null }] });
    const waiting = run([ticket('A', { depends_on: ['B'] }), ticket('B')], []);
    // The queued leg is implement even while it waits (R-BTN-83: the queue is the queued leg).
    expect(waiting.A).toMatchObject({ station: 'filed', next_leg: 'implement', next: [{ leg: 'implement', state: 'waiting', waiting_on: 'dependencies' }] });
  });

  it('a dependency closed withdrawn is not done: implement still waits', () => {
    const out = run([ticket('A', { depends_on: ['B'] })], [], new Set(['B']), { done: new Set() });
    expect(out.A.next[0]).toMatchObject({ state: 'waiting', waiting_on: 'dependencies' });
  });

  it('a closed unmerged PR counts as none; an open child waits implement on children', () => {
    const out = run([ticket('A')], [pr({ number: 1, state: 'closed' })]);
    expect(out.A).toMatchObject({ station: 'filed', next_leg: 'implement' });
    // Listed in the ticket's prs too, a closed PR is none — not a station, not a crash.
    const listed = run([ticket('A', { course: { prs: ['1'] } })], [pr({ number: 1, state: 'closed' })]);
    expect(listed.A).toMatchObject({ station: 'filed', next_leg: 'implement' });
    const blocked = run([ticket('P', { blocked_by: ['K'] }), ticket('K')], []);
    expect(blocked.P.next[0]).toMatchObject({ state: 'waiting', waiting_on: 'children' });
  });
});

describe('an open PR', () => {
  it('pr-open; review waits on ci while checks run, ready when they finish — red counts as finished, and so does none', () => {
    const out = run([ticket('A')], [pr({ number: 1, checks: [null] })]);
    // The queued leg is review while it waits on ci and once it is ready.
    expect(out.A).toMatchObject({ station: 'pr-open', next_leg: 'review', next: [{ leg: 'review', state: 'waiting', waiting_on: 'ci' }] });
    expect(run([ticket('A')], [pr({ number: 1, checks: ['failure'] })]).A.next[0]).toMatchObject({ state: 'ready', waiting_on: null });
    expect(run([ticket('A')], [pr({ number: 1, checks: [] })]).A.next[0]).toMatchObject({ state: 'ready', waiting_on: null });
  });

  it('a verdict from a review state: approving makes merge ready; changes makes fix ready', () => {
    const approved = run([ticket('A')], [pr({ number: 1, reviews: [{ author: 'r', state: 'APPROVED', submittedAt: T0 - 10 }] })]);
    expect(approved.A).toMatchObject({ station: 'reviewed', next_leg: 'merge', next: [{ leg: 'merge', state: 'ready' }] });
    const changes = run([ticket('A')], [pr({ number: 1, reviews: [{ author: 'r', state: 'CHANGES_REQUESTED', submittedAt: T0 - 10 }] })]);
    expect(changes.A).toMatchObject({ station: 'reviewed', next_leg: 'fix', next: [{ leg: 'fix', state: 'ready' }] });
  });

  it('a comment-only review with a verdict line counts; without one it changes nothing', () => {
    const verdict = run([ticket('A')], [pr({ number: 1, reviews: [{ author: 'me', state: 'COMMENTED', submittedAt: T0 - 10, body: '<!-- baton:verdict approve -->\nlooks good' }] })]);
    expect(verdict.A).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    const changes = run([ticket('A')], [pr({ number: 1, reviews: [{ author: 'me', state: 'COMMENTED', submittedAt: T0 - 10, body: '<!-- baton:verdict changes -->\none thing' }] })]);
    expect(changes.A).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
    const plain = run([ticket('A')], [pr({ number: 1, reviews: [{ author: 'me', state: 'COMMENTED', submittedAt: T0 - 10, body: 'just a question' }] })]);
    expect(plain.A).toMatchObject({ station: 'pr-open' });
  });

  it('one identity authoring and reviewing: the marker line carries it (GitHub refuses self-approval)', () => {
    const one = run([ticket('A')], [pr({ number: 1, reviews: [{ author: 'same', state: 'COMMENTED', submittedAt: T0 - 10, body: '<!-- baton:verdict approve -->' }] })]);
    expect(one.A).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
  });

  it('a push after the verdict is fixed: review again, and the path counts the rounds', () => {
    const out = run([ticket('A')], [pr({ number: 1, pushedAt: T0 + 5, reviews: [{ author: 'r', state: 'CHANGES_REQUESTED', submittedAt: T0 - 10 }] })]);
    expect(out.A).toMatchObject({ station: 'fixed', next_leg: 'review', next: [{ leg: 'review', state: 'ready', waiting_on: null }] });
    expect(out.A.path).toEqual([{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }, { leg: 'fix', reached: 'fixed' }]);
  });

  it('a push after an approval is fixed too: review again, merge is not offered over unreviewed commits', () => {
    const out = run([ticket('A')], [pr({ number: 1, pushedAt: T0 + 5, reviews: [{ author: 'r', state: 'APPROVED', submittedAt: T0 - 10 }] })]);
    expect(out.A).toMatchObject({ station: 'fixed', next_leg: 'review', next: [{ leg: 'review', state: 'ready' }] });
  });

  it('two reviewers of one head are one review: no push between them is no fix, however many verdicts', () => {
    // Three rounds of two reviewers each asking for changes, with no push at all.
    const reviews = [60, 55, 40, 35, 20, 15].map((d, i) => ({ author: i % 2 ? 'b' : 'a', state: 'CHANGES_REQUESTED' as const, submittedAt: T0 - d }));
    const out = run([ticket('A')], [pr({ number: 1, pushedAt: T0 - 100, pushes: [T0 - 100], reviews })]);
    expect(out.A.path.map((s) => s.leg)).toEqual(['implement', 'review']);
    expect(out.A).toMatchObject({ station: 'reviewed', next_leg: 'fix', next: [{ leg: 'fix', state: 'ready' }] });
    // One push between the rounds is one fix.
    const fixedOnce = run([ticket('A')], [pr({ number: 1, pushedAt: T0 - 30, pushes: [T0 - 100, T0 - 30], reviews })]);
    expect(fixedOnce.A.path.map((s) => s.leg)).toEqual(['implement', 'review', 'fix', 'review']);
  });

  it('the three-fix limit: after three fixes, a fourth changes verdict leaves merge waiting on the owner', () => {
    // Three changes verdicts each followed by a fix push (the head's last push at T0-75), then
    // a fourth review asking for changes again: the fixes are spent, merge needs the owner.
    const reviews = [100, 90, 80, 70].map((d) => ({ author: 'r', state: 'CHANGES_REQUESTED' as const, submittedAt: T0 - d }));
    const out = run([ticket('A')], [pr({ number: 1, pushedAt: T0 - 75, pushes: [T0 - 200, T0 - 95, T0 - 85, T0 - 75], reviews })]);
    expect(out.A).toMatchObject({ station: 'reviewed', next_leg: 'merge', next: [{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }] });
    // The whole timeline: implement, then three review → fix rounds, then the fourth review.
    expect(out.A.path.map((s) => s.leg)).toEqual(['implement', 'review', 'fix', 'review', 'fix', 'review', 'fix', 'review']);
  });
});

describe('a ticket\'s PRs in other repositories (B-29)', () => {
  const home = 'o/docs';
  const sib = (over: Partial<PrFact> & { number: number }) => pr({ repository: 'o/site', ...over });
  const placed = (t: PostedTicket, facts: PrFact[]) => run([t], facts, new Set(), { repository: home }).A;

  it('a PR in a repository the ticket names is its own, by branch or by URL; one in a repository it does not name is not', () => {
    const named = ticket('A', { repos: ['o/site'] });
    expect(placed(named, [sib({ number: 3, head: 'claude/A-x' })])).toMatchObject({ station: 'pr-open' });
    expect(placed(ticket('A', { repos: ['O/Site'], course: { prs: ['https://github.com/o/site/pull/9'] } }), [sib({ number: 9, head: 'feature/x' })])).toMatchObject({ station: 'pr-open' });
    expect(placed(ticket('A'), [sib({ number: 3, head: 'claude/A-x' })])).toMatchObject({ station: 'filed' });
    // A bare prs: number is the home's: never another repository's PR of that number.
    expect(placed(ticket('A', { repos: ['o/site'], course: { prs: ['9'] } }), [sib({ number: 9, head: 'feature/x' })])).toMatchObject({ station: 'filed' });
  });

  it('a home with no PR is placed from the others: a verdict on one moves the change; it is merged when every PR is', () => {
    const t = ticket('A', { repos: ['o/site', 'o/sdk'] });
    const verdict = { author: 'r', state: 'COMMENTED' as const, submittedAt: T0, body: '<!-- baton:verdict approve -->' };
    expect(placed(t, [sib({ number: 3, head: 'claude/A-x' }), pr({ number: 3, head: 'claude/A-x', repository: 'o/sdk', reviews: [verdict] })])).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    expect(placed(t, [sib({ number: 3, head: 'claude/A-x', state: 'merged', reviews: [verdict] }), pr({ number: 3, head: 'claude/A-x', repository: 'o/sdk' })])).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    expect(placed(t, [sib({ number: 3, head: 'claude/A-x', state: 'merged', reviews: [verdict] }), pr({ number: 3, head: 'claude/A-x', repository: 'o/sdk', state: 'merged' })])).toMatchObject({ station: 'merged', next: [] });
  });

  it('review-pr finds its PR by repository and number, never by number alone', () => {
    const t = (prs: string[]) => ticket('R', { course_id: 'review-pr', repos: ['o/site'], course: { prs } });
    const review = (prs: string[], facts: PrFact[]) => stationsReviewPr({ tickets: [t(prs)], facts, closed: new Set(), repository: home, graph: REVIEW_PR_COURSE }).stations.R;
    const facts = [pr({ number: 5, head: 'x', repository: home, checks: [null] }), sib({ number: 5, head: 'y' })];
    expect(review(['https://github.com/o/site/pull/5'], facts).next[0]).toMatchObject({ leg: 'review', state: 'ready' }); // the sibling's, checks done
    expect(review(['5'], facts).next[0]).toMatchObject({ leg: 'review', state: 'waiting', waiting_on: 'ci' }); // the home's
  });
});

describe('several PRs, and merged ones', () => {
  it('every PR merged is merged — the end station, before the file says done', () => {
    const out = run([ticket('A')], [pr({ number: 1, state: 'merged' }), pr({ number: 2, state: 'merged' })], new Set());
    expect(out.A).toMatchObject({ station: 'merged', next_leg: null, next: [] });
    // A merged PR's path ends review → merge, so it rests at the end station by edges.
    expect(out.A.path).toEqual([{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }, { leg: 'merge', reached: 'merged' }]);
  });

  it('returns R-BTN-74\'s shape: stations by id, no markers, empty course data; closed tickets get no station', () => {
    const out = stationsPr({ tickets: [ticket('A'), ticket('Z')], facts: [], closed: new Set(['Z']) });
    expect(Object.keys(out.stations)).toEqual(['A']);
    expect(out).toMatchObject({ markers: [], course_data: {} });
  });

  it('several PRs are one change: a merged sibling does not end it; a verdict on any of them stands for all (B-29)', () => {
    const out = run([ticket('A')], [
      pr({ number: 1, state: 'merged' }),
      pr({ number: 2, reviews: [{ author: 'r', state: 'CHANGES_REQUESTED', submittedAt: T0 - 10 }] }),
    ]);
    expect(out.A).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
    // close writes one verdict line on one PR: the other open PR does not hold the change at pr-open.
    const one = run([ticket('A')], [pr({ number: 1 }), pr({ number: 2, reviews: [{ author: 'r', state: 'COMMENTED', submittedAt: T0, body: '<!-- baton:verdict approve -->' }] })]);
    expect(one.A).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    // A push on either PR after the verdict is the change's fix.
    const fixed = run([ticket('A')], [pr({ number: 1, pushes: [T0 - 1000, T0 + 5] }), pr({ number: 2, reviews: [{ author: 'r', state: 'COMMENTED', submittedAt: T0, body: '<!-- baton:verdict changes -->' }] })]);
    expect(fixed.A).toMatchObject({ station: 'fixed', next_leg: 'review' });
    // review waits on ci while any open PR's checks run; a merged PR's checks no longer count.
    expect(run([ticket('A')], [pr({ number: 1 }), pr({ number: 2, checks: [null] })]).A.next[0]).toMatchObject({ leg: 'review', state: 'waiting', waiting_on: 'ci' });
    expect(run([ticket('A')], [pr({ number: 1, state: 'merged', checks: [null] }), pr({ number: 2 })]).A.next[0]).toMatchObject({ leg: 'review', state: 'ready' });
  });

  it("a ticket's own prs list counts, and the branch pattern matches any of its PRs", () => {
    const byList = run([ticket('A', { course: { prs: [9] } })], [pr({ number: 9, head: 'feature/unrelated' })]);
    expect(byList.A).toMatchObject({ station: 'pr-open' });
    const byBranch = run([ticket('A')], [pr({ number: 3, head: 'claude/A-runner' })]);
    expect(byBranch.A).toMatchObject({ station: 'pr-open' });
    const foreign = run([ticket('A')], [pr({ number: 4, head: 'claude/B-runner' })]);
    expect(foreign.A).toMatchObject({ station: 'filed' });
  });

  it("prs: takes numbers and this repository's pull-request URLs, never another repository's", () => {
    expect(prNumbers(['#6', 7, '8', 'https://github.com/o/r/pull/9', 'https://github.com/o/r/pull/10/files', 'https://github.com/x/y/pull/11', 'junk'], 'o/r')).toEqual(['6', '7', '8', '9', '10']);
    expect(prNumbers(['https://github.com/x/y/pull/11'])).toEqual(['11']); // the repository unknown: recorded facts
    const byUrl = run([ticket('A', { course: { prs: ['https://github.com/o/r/pull/9'] } })], [pr({ number: 9, head: 'feature/unrelated' })], new Set(), { repository: 'O/R' });
    expect(byUrl.A).toMatchObject({ station: 'pr-open' });
    const foreign = run([ticket('A', { course: { prs: ['https://github.com/x/y/pull/9'] } })], [pr({ number: 9, head: 'feature/unrelated' })], new Set(), { repository: 'o/r' });
    expect(foreign.A).toMatchObject({ station: 'filed' });
  });

  it("the course's current and previous patterns both match; {repository} matches this repository's own branches", () => {
    const patterns = ['work/{ticket}/*', 'claude/{ticket}-*'];
    expect(run([ticket('A')], [pr({ number: 1, head: 'work/A/x' })], new Set(), { branchPatterns: patterns }).A).toMatchObject({ station: 'pr-open' });
    expect(run([ticket('A')], [pr({ number: 2, head: 'claude/A-old' })], new Set(), { branchPatterns: patterns }).A).toMatchObject({ station: 'pr-open' });
    // The default pattern is not consulted once the course names its own.
    expect(run([ticket('A')], [pr({ number: 3, head: 'claude/A-old' })], new Set(), { branchPatterns: ['work/{ticket}/*'] }).A).toMatchObject({ station: 'filed' });
    expect(run([ticket('A')], [pr({ number: 4, head: 'baton/docs/A' })], new Set(), { branchPatterns: ['baton/{repository}/{ticket}'] }).A).toMatchObject({ station: 'pr-open' });
  });
});

describe('branchMatches', () => {
  it('stars match any run, never backtracking twice; {ticket} is substituted before', () => {
    expect(branchMatches('claude/a-*', 'claude/a-runner')).toBe(true);
    expect(branchMatches('claude/a-*', 'claude/b-runner')).toBe(false);
    expect(branchMatches('*', 'anything')).toBe(true);
    expect(branchMatches('claude/*/*', 'claude/a/b')).toBe(true);
    expect(branchMatches('fixed', 'fixed')).toBe(true);
  });
});

// B-28 (R-BTN-131): `create-pr`, which replaced `pr`, reads its own course file's bounds — review
// three rounds, fix twice — and adjudicates what the third round leaves open.
describe('create-pr: three rounds, then adjudicate', () => {
  const graph = CREATE_PR_COURSE;
  const v = (at: number, verdict: 'approve' | 'changes', author = 'r') => ({ author, state: (verdict === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED') as 'APPROVED' | 'CHANGES_REQUESTED', submittedAt: at });
  const note = (at: number, body: string) => ({ author: 'a', state: 'COMMENTED' as const, submittedAt: at, body });
  const three = [v(T0, 'changes'), v(T0 + 20, 'changes'), v(T0 + 40, 'changes')];
  const pushes = [T0 - 1000, T0 + 10, T0 + 30];
  const place = (reviews: PrFact['reviews'], over: Partial<PrFact> = {}) =>
    stationsPr({ tickets: [ticket('A')], facts: [pr({ number: 1, pushes, pushedAt: T0 + 30, reviews, ...over })], closed: new Set(), graph }).stations.A;

  it('a third round asking for changes queues adjudicate, not a fix and not the owner', () => {
    const at = place(three);
    expect(at).toMatchObject({ station: 'reviewed', next_leg: 'adjudicate', next: [{ leg: 'adjudicate', state: 'ready', waiting_on: null }] });
    expect(at.path.map((s) => s.leg)).toEqual(['implement', 'review', 'fix', 'review', 'fix', 'review']);
    // A second round asking for changes, not yet fixed, still queues the fix.
    expect(place(three.slice(0, 2), { pushes: [T0 - 1000, T0 + 10], pushedAt: T0 + 10 })).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
  });

  it('adjudicated merge: merge ready; adjudicated owner: merge waiting on the owner; an adjudication before the last verdict counts for nothing', () => {
    expect(place([...three, note(T0 + 50, '<!-- baton:adjudicated merge -->\nnothing reproduced')])).toMatchObject({
      station: 'adjudicated', next_leg: 'merge', next: [{ leg: 'merge', state: 'ready', waiting_on: null }],
    });
    const owner = place([...three, note(T0 + 50, '<!-- baton:adjudicated owner -->')]);
    expect(owner).toMatchObject({ station: 'adjudicated', next: [{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }] });
    expect(owner.path.at(-1)).toEqual({ leg: 'adjudicate', reached: 'adjudicated' });
    expect(place([three[0], three[1], note(T0 + 35, '<!-- baton:adjudicated merge -->'), three[2]])).toMatchObject({ station: 'reviewed', next_leg: 'adjudicate' });
  });

  it('merged after adjudication: the path ends adjudicate, merge', () => {
    const at = place([...three, note(T0 + 50, '<!-- baton:adjudicated merge -->')], { state: 'merged' });
    expect(at.station).toBe('merged');
    expect(at.path.slice(-2)).toEqual([{ leg: 'adjudicate', reached: 'adjudicated' }, { leg: 'merge', reached: 'merged' }]);
  });

  it('a pr course file (fix three, no adjudicate) keeps the three-fix limit and the owner wait', () => {
    const prGraph = { legs: { review: { max_runs: 4 }, fix: { max_runs: 3 } } };
    const out = stationsPr({ tickets: [ticket('A')], facts: [pr({ number: 1, pushes, pushedAt: T0 + 30, reviews: three })], closed: new Set(), graph: prGraph }).stations.A;
    expect(out).toMatchObject({ next_leg: 'fix' }); // two fixes so far, three allowed
  });
});

// B-28 (R-BTN-131): `review-pr` reviews a PR someone else opened, named in the ticket's `prs:`.
describe('review-pr', () => {
  const t = (prs: string[] = ['5']) => ticket('R', { course_id: 'review-pr', course: { prs } });
  const place = (facts: PrFact[], prs?: string[]) => stationsReviewPr({ tickets: [t(prs)], facts, closed: new Set(), graph: REVIEW_PR_COURSE }).stations.R;
  const fact = (over: Partial<PrFact> = {}) => pr({ number: 5, head: 'someone/feature', ...over });
  const verdict = (at: number, approve: boolean) => ({ author: 'r', state: 'COMMENTED' as const, submittedAt: at, body: `<!-- baton:verdict ${approve ? 'approve' : 'changes'} -->` });

  it('no PR found: requested, review waiting on the pr; found, review ready once checks finish', () => {
    expect(place([], ['9'])).toMatchObject({ station: 'requested', next_leg: 'review', next: [{ leg: 'review', state: 'waiting', waiting_on: 'pr' }] });
    expect(place([fact({ checks: [null] })]).next[0]).toMatchObject({ leg: 'review', state: 'waiting', waiting_on: 'ci' });
    expect(place([fact()])).toMatchObject({ station: 'requested', next_leg: 'review', next: [{ leg: 'review', state: 'ready', waiting_on: null }, { leg: 'conclude', state: 'ready', waiting_on: null }] });
  });

  it('changes requested: the next round waits on the author until a push lands after the verdict', () => {
    const waiting = place([fact({ pushes: [T0 - 1000], reviews: [verdict(T0, false)] })]);
    expect(waiting).toMatchObject({ station: 'changes-requested', path: [{ leg: 'review', reached: 'changes-requested' }], next: [{ leg: 'review', state: 'waiting', waiting_on: 'author' }, { leg: 'conclude', state: 'ready' }] });
    expect(place([fact({ pushes: [T0 - 1000, T0 + 5], reviews: [verdict(T0, false)] })]).next[0]).toMatchObject({ leg: 'review', state: 'ready' });
  });

  it('the first round waits on a dependency not closed done, then on an open child; a later round does not', () => {
    const of = (over: Parameters<typeof ticket>[1], done = new Set<string>(), reviews: PrFact['reviews'] = []) =>
      stationsReviewPr({ tickets: [ticket('R', { course_id: 'review-pr', course: { prs: ['5'] }, ...over })], facts: [fact({ pushes: [T0 + 5], reviews })], closed: done, done, graph: REVIEW_PR_COURSE }).stations.R.next[0];
    expect(of({ depends_on: ['A'] })).toMatchObject({ leg: 'review', state: 'waiting', waiting_on: 'dependencies' });
    expect(of({ depends_on: ['A'] }, new Set(['A']))).toMatchObject({ leg: 'review', state: 'ready' });
    expect(of({ blocked_by: ['C'] })).toMatchObject({ leg: 'review', state: 'waiting', waiting_on: 'children' });
    expect(of({ depends_on: ['A'] }, new Set(), [verdict(T0, false)])).toMatchObject({ leg: 'review', state: 'ready' });
  });

  it('approved is the end; three rounds spent, or the PR merged or closed, queues conclude alone; a concluded comment is the other end', () => {
    expect(place([fact({ reviews: [verdict(T0, false), verdict(T0 + 10, true)] })])).toMatchObject({ station: 'approved', next_leg: null, next: [] });
    const spent = place([fact({ pushes: [T0 + 5, T0 + 15, T0 + 25], reviews: [verdict(T0, false), verdict(T0 + 10, false), verdict(T0 + 20, false)] })]);
    expect(spent).toMatchObject({ station: 'changes-requested', next_leg: 'conclude', next: [{ leg: 'conclude', state: 'ready', waiting_on: null }] });
    expect(place([fact({ state: 'closed' })])).toMatchObject({ station: 'requested', next_leg: 'conclude' });
    const done = place([fact({ state: 'merged', reviews: [verdict(T0, false), { author: 'r', state: 'COMMENTED', submittedAt: T0 + 9, body: '<!-- baton:concluded -->\nsummary' }] })]);
    expect(done).toMatchObject({ station: 'concluded', next: [], path: [{ leg: 'review', reached: 'changes-requested' }, { leg: 'conclude', reached: 'concluded' }] });
  });
});
