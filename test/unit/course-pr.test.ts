// course-pr.test.ts — the `pr` course's default station function (BATON_SPEC §2f R-BTN-74;
// R3-1249): every station from recorded PR facts — a merged PR before and after the file says
// done, two PRs, a closed unmerged PR, a red check, a head with no checks, a comment-only
// review with and without a verdict line, one identity authoring and reviewing — and the
// three-fix limit. Pure and host-neutral.
import { describe, it, expect } from 'vitest';
import { branchMatches, stationsPr, type PrFact } from '../../src/defaults/course-pr';
import type { PostedTicket } from '../../src/core/board';

const T0 = 1_000_000;
const ticket = (id: string, over: Partial<PostedTicket> = {}): PostedTicket => ({ id, course_id: 'pr', path: `tickets/${id}.md`, title: id, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], rank: null, ...over });
const pr = (over: Partial<PrFact> & { number: number }): PrFact => ({ head: `claude/A-${over.number}`, state: 'open', pushedAt: T0 - 1000, checks: ['success'], reviews: [], ...over });
const run = (tickets: PostedTicket[], facts: PrFact[], closed = new Set<string>(), more: { done?: Set<string>; branchPatterns?: string[] } = {}) =>
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

  it('the three-fix limit: after three fixes, a fourth changes verdict leaves merge waiting on the owner', () => {
    // Three changes verdicts each followed by a fix push (the head's last push at T0-75), then
    // a fourth review asking for changes again: the fixes are spent, merge needs the owner.
    const reviews = [100, 90, 80, 70].map((d) => ({ author: 'r', state: 'CHANGES_REQUESTED' as const, submittedAt: T0 - d }));
    const out = run([ticket('A')], [pr({ number: 1, pushedAt: T0 - 75, reviews })]);
    expect(out.A).toMatchObject({ station: 'reviewed', next_leg: 'merge', next: [{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }] });
    // The whole timeline: implement, then three review → fix rounds, then the fourth review.
    expect(out.A.path.map((s) => s.leg)).toEqual(['implement', 'review', 'fix', 'review', 'fix', 'review', 'fix', 'review']);
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

  it('the least advanced open PR decides; a merged sibling does not outrank it', () => {
    const out = run([ticket('A')], [
      pr({ number: 1, state: 'merged' }),
      pr({ number: 2, reviews: [{ author: 'r', state: 'CHANGES_REQUESTED', submittedAt: T0 - 10 }] }),
    ]);
    expect(out.A).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
  });

  it("a ticket's own prs list counts, and the branch pattern matches any of its PRs", () => {
    const byList = run([ticket('A', { course: { prs: [9] } })], [pr({ number: 9, head: 'feature/unrelated' })]);
    expect(byList.A).toMatchObject({ station: 'pr-open' });
    const byBranch = run([ticket('A')], [pr({ number: 3, head: 'claude/A-runner' })]);
    expect(byBranch.A).toMatchObject({ station: 'pr-open' });
    const foreign = run([ticket('A')], [pr({ number: 4, head: 'claude/B-runner' })]);
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
