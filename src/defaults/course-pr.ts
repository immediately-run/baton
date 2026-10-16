// course-pr.ts — the `pr` course's default station function (BATON_SPEC §2f R-BTN-74): where
// each ticket is, from git and PR facts alone. Pure over injected facts (R-BTN-96's fact
// adapter gathers them from the forge in the sync command), so the same function serves an
// ejected `.baton/courses/pr/sync.mjs` through its default export. Course code in the CLI,
// never core (§2b): it may read what a ticket's opaque `course` fields carry.
import type { PostedStation, PostedTicket } from '../core/board';
import type { Step } from '../core/graph';

/** One PR as the fact adapter records it (R-BTN-96): GitHub's shape, GitLab's and Gitea's
 * mapped to the same fields. */
export interface PrFact {
  number: number;
  /** The head branch's name. */
  head: string;
  state: 'open' | 'merged' | 'closed';
  /** The head's latest push, epoch ms — a push after a verdict is `fixed`. */
  pushedAt: number;
  /** The head's checks; a null conclusion is still running. Empty means none: finished. */
  checks: (string | null)[];
  reviews: { author: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; submittedAt: number; body?: string }[];
}

/** The `pr` course's graph: filed → pr-open → reviewed → merged, with fixed between reviewed
 * and the next review (the course file `baton init` writes into git, R-BTN-69). */
export const PR_COURSE = {
  start: 'filed',
  start_leg: 'implement',
  end: ['merged'],
  short_waits: ['ci'],
  stations: { filed: { label: 'Filed, no PR yet' }, 'pr-open': { label: 'PR open' }, reviewed: { label: 'Reviewed' }, fixed: { label: 'Findings addressed' }, merged: { label: 'Merged' } },
  legs: {
    implement: { from: ['filed'], to: 'pr-open' },
    review: { from: ['pr-open', 'fixed'], to: 'reviewed', max_runs: 4 },
    fix: { from: ['reviewed'], to: 'fixed', max_runs: 3 },
    merge: { from: ['reviewed'], to: 'merged' },
  },
} as const;

const VERDICT = /^<!--\s*baton:verdict\s+(approve|changes)\s*-->/;
/** A review's verdict: its state, or the marker line a comment-only review opens with (GitHub
 * refuses approve/request-changes on one's own PR, so a shared identity still advances). */
export function verdictOf(r: PrFact['reviews'][number]): 'approve' | 'changes' | null {
  if (r.state === 'APPROVED') return 'approve';
  if (r.state === 'CHANGES_REQUESTED') return 'changes';
  if (r.state === 'COMMENTED') {
    const m = VERDICT.exec((r.body ?? '').trim());
    if (m) return m[1] === 'approve' ? 'approve' : 'changes';
  }
  return null;
}

/** Whether the head's checks have finished: every conclusion non-null. No checks counts as
 * finished — the review reads what there is (red included) and asks for a fix. */
export const checksDone = (f: PrFact): boolean => f.checks.every((c) => c != null);

/** Where one PR puts the ticket, with the path its own timeline implies. */
function placeOf(fact: PrFact, fixRuns: number): PostedStation {
  const none: PostedStation = { station: 'filed', path: [], next_leg: null, next_source: 'course', handoff_url: null, next: [], bars: {} };
  if (fact.state === 'merged') {
    // Every PR merged is `merged` — the end station: done for Baton (R-BTN-70) whether or not
    // the file says `done` yet, which the merge leg's script also writes.
    return { ...none, station: 'merged' };
  }
  if (fact.state === 'closed') return none; // a closed unmerged PR counts as none
  // An open PR: `pr-open`, review waiting on ci while the checks run, ready when they finish.
  const wait = checksDone(fact) ? null : 'ci';
  // The verdict the head carries: the newest with one.
  const verdicts = [...fact.reviews].filter((r) => verdictOf(r) != null).sort((a, b) => a.submittedAt - b.submittedAt);
  const newest = verdicts.at(-1);
  const pushedAfter = newest != null && fact.pushedAt > newest.submittedAt;
  if (newest == null) {
    return { ...none, station: 'pr-open', next: [{ leg: 'review', state: wait ? 'waiting' : 'ready', waiting_on: wait }] };
  }
  if (pushedAfter) {
    // A push after the verdict is `fixed`: review again, the checks re-run.
    return { ...none, station: 'fixed', path: [{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }, { leg: 'fix', reached: 'fixed' }], next: [{ leg: 'review', state: wait ? 'waiting' : 'ready', waiting_on: wait }] };
  }
  if (verdictOf(newest!) === 'approve') {
    return { ...none, station: 'reviewed', path: [{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }], next_leg: 'merge', next: [{ leg: 'merge', state: 'ready', waiting_on: null }] };
  }
  // Changes requested: fix, or — once fix has run three times — merge waiting on the owner
  // (listed under Needs you, §14).
  const path: Step[] = [{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }];
  if (fixRuns >= 3) {
    path.push({ leg: 'fix', reached: 'fixed' }, { leg: 'review', reached: 'reviewed' });
    return { ...none, station: 'reviewed', path, next_leg: 'merge', next: [{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }] };
  }
  return { ...none, station: 'reviewed', path, next_leg: 'fix', next: [{ leg: 'fix', state: 'ready', waiting_on: null }] };
}

const LEAST: Record<string, number> = { filed: 0, 'pr-open': 1, fixed: 2, reviewed: 3, merged: 4 };

/** Where a fact's own state puts it, for the least-advanced comparison. */
function stationOfFact(f: PrFact): string {
  if (f.state === 'merged') return 'merged';
  const verdicts = [...f.reviews].filter((r) => verdictOf(r) != null).sort((a, b) => a.submittedAt - b.submittedAt);
  const newest = verdicts.at(-1);
  if (newest == null) return 'pr-open';
  if (f.pushedAt > newest.submittedAt) return 'fixed';
  return 'reviewed';
}

/** A fix run is a changes verdict followed by a push to the head: count each — one step of the
 * path per round, the same count `max_runs` reads (R-BTN-63's start_path is this timeline). */
function fixRunsOf(f: PrFact): number {
  return [...f.reviews].filter((r) => verdictOf(r) === 'changes' && f.pushedAt > r.submittedAt).length;
}

/** A wildcard match, not a regex: `*` matches any run of characters (the same walk the core's
 * branch-holder uses, at most |branch| × |pattern| steps — a star never backtracks twice). */
export function branchMatches(pattern: string, branch: string): boolean {
  const p = pattern.toLowerCase();
  const b = branch.toLowerCase();
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (i < b.length) {
    if (j < p.length && (p[j] === b[i] || p[j] === '*')) {
      if (p[j] === '*') {
        star = j++;
        mark = i;
      } else {
        i++;
        j++;
      }
    } else if (star >= 0) {
      i = ++mark;
      j = star + 1;
    } else {
      return false;
    }
  }
  while (j < p.length && p[j] === '*') j++;
  return j === p.length;
}

/** The `pr` course's stations (R-BTN-74): the ticket's PRs are its `course.prs` numbers and
 * every open-or-merged fact whose head branch matches the pattern; with several, the least
 * advanced decides — but every PR merged is `merged`, the end station. No PR is `filed`, with
 * `implement` waiting while a dependency or an open child is not done. */
export function stationsPr(ctx: { tickets: PostedTicket[]; facts: PrFact[]; branchPattern?: string; closed: Set<string> }): Map<string, PostedStation> {
  const out = new Map<string, PostedStation>();
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue; // closed tickets are the `closed` list, not stations
    const prs = ((t.course as { prs?: number[] } | undefined)?.prs ?? []).map(String);
    const pattern = (ctx.branchPattern ?? 'claude/{ticket}-*').replace('{ticket}', t.id).replace('{repository}', 'x');
    const mine = ctx.facts.filter((f) => prs.includes(String(f.number)) || ((f.state === 'open' || f.state === 'merged') && branchMatches(pattern, f.head)));
    if (!mine.length) {
      // No PR is `filed`; `implement` waits while a dependency is not closed done (R-BTN-74).
      const waiting = t.depends_on.filter((d) => !ctx.closed.has(d));
      const ready = waiting.length === 0 && t.blocked_by.length === 0;
      const waitingOn = waiting.length ? 'dependencies' : t.blocked_by.length ? 'children' : null;
      out.set(t.id, {
        station: 'filed', path: [], next_leg: ready ? 'implement' : null, next_source: 'course', handoff_url: null,
        next: [{ leg: 'implement', state: ready ? 'ready' : 'waiting', waiting_on: waitingOn }], bars: {},
      });
      continue;
    }
    if (mine.every((f) => f.state === 'merged')) {
      out.set(t.id, placeOf(mine[0], 0));
      continue;
    }
    // The least advanced open PR decides, and its timeline is the path.
    const open = mine.filter((f) => f.state === 'open').sort((a, b) => (LEAST[stationOfFact(a)] ?? 0) - (LEAST[stationOfFact(b)] ?? 0) || a.number - b.number);
    out.set(t.id, placeOf(open[0], fixRunsOf(open[0])));
  }
  return out;
}
