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
  /** When the head commit was made, epoch ms (its committer date) — a head newer than the
   * verdict is a push after it: `fixed`. Never the PR's `updated_at`, which a comment moves. */
  pushedAt: number;
  /** The head's checks; a null conclusion is still running. Empty means none: finished. */
  checks: (string | null)[];
  /** The PR's reviews and its plain comments — a comment is `COMMENTED`, read only for a
   * verdict line (R-BTN-74: "a comment or comment-only review"). */
  reviews: { author: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; submittedAt: number; body?: string }[];
}

/** What a station function returns (R-BTN-74): the stations, the markers it saw and its
 * course's opaque data. The default `pr` course writes no PR markers (no seats or bars), so its
 * `markers` is empty and its `course_data` an empty object. */
export interface StationsResult {
  stations: Record<string, PostedStation>;
  markers: { ticket: string; leg: string; ref: string; claim_nonce: string | null }[];
  course_data: Record<string, unknown>;
}

/** R-BTN-51's default `branch_pattern`. */
export const DEFAULT_BRANCH_PATTERN = 'claude/{ticket}-*';

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

/** A PR's verdicts, oldest first. */
const verdictsOf = (f: PrFact) => [...f.reviews].filter((r) => verdictOf(r) != null).sort((a, b) => a.submittedAt - b.submittedAt);

/** The path one PR's timeline implies (R-BTN-74: "the least advanced PR's timeline in order"):
 * `implement` opened it; each verdict is a `review`; a changes verdict followed by a later
 * verdict or by the head's push was a `fix` (the graph's only way back to `review`). Verdicts
 * with no fix between them are one review. The facts carry only the latest push, so a fix is
 * known by what followed it, not by its own push. */
function timelineOf(f: PrFact): Step[] {
  const path: Step[] = [{ leg: 'implement', reached: 'pr-open' }];
  const verdicts = verdictsOf(f);
  verdicts.forEach((v, i) => {
    if (path.at(-1)!.reached !== 'reviewed') path.push({ leg: 'review', reached: 'reviewed' });
    const followed = i + 1 < verdicts.length || f.pushedAt > v.submittedAt;
    if (verdictOf(v) === 'changes' && followed) path.push({ leg: 'fix', reached: 'fixed' });
  });
  return path;
}

const fixRunsOf = (path: Step[]): number => path.filter((s) => s.leg === 'fix').length;

/** Where one PR puts the ticket: the end of its timeline, and the queued leg leaving it. */
function placeOf(fact: PrFact): PostedStation {
  const at = (station: string, path: Step[], next: PostedStation['next']): PostedStation =>
    ({ station, path, next_leg: next[0]?.leg ?? null, next_source: 'course', handoff_url: null, next, bars: {} });
  const path = timelineOf(fact);
  if (fact.state === 'merged') {
    // Every PR merged is `merged` — the end station: done for Baton (R-BTN-70) whether or not
    // the file says `done` yet, which the merge leg's script also writes. A merge leaves
    // `reviewed`, so a timeline resting elsewhere was reviewed by the merge itself.
    if (path.at(-1)!.reached !== 'reviewed') path.push({ leg: 'review', reached: 'reviewed' });
    return at('merged', [...path, { leg: 'merge', reached: 'merged' }], []);
  }
  // `review` waits on ci while the head's checks run, and is ready once they finish.
  const wait = checksDone(fact) ? null : 'ci';
  const last = path.at(-1)!.reached;
  if (last === 'pr-open' || last === 'fixed') return at(last, path, [{ leg: 'review', state: wait ? 'waiting' : 'ready', waiting_on: wait }]);
  if (verdictOf(verdictsOf(fact).at(-1)!) === 'approve') return at('reviewed', path, [{ leg: 'merge', state: 'ready', waiting_on: null }]);
  // Changes requested: fix, or — once fix has run three times — merge waiting on the owner
  // (listed under Needs you, §14).
  if (fixRunsOf(path) >= 3) return at('reviewed', path, [{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }]);
  return at('reviewed', path, [{ leg: 'fix', state: 'ready', waiting_on: null }]);
}

const LEAST: Record<string, number> = { filed: 0, 'pr-open': 1, fixed: 2, reviewed: 3, merged: 4 };

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
export function stationsPr(ctx: { tickets: PostedTicket[]; facts: PrFact[]; branchPatterns?: string[]; closed: Set<string>; done?: Set<string> }): StationsResult {
  const stations: Record<string, PostedStation> = {};
  // The course's current and previous patterns (R-BTN-51). `{repository}` matches anything: the
  // facts are this repository's own PRs, so it can only ever name this repository.
  const patterns = (ctx.branchPatterns?.length ? ctx.branchPatterns : [DEFAULT_BRANCH_PATTERN]).map((p) => p.replace(/\{repository\}/g, '*'));
  // A dependency counts once it is closed `done` (R-BTN-74); `done` absent, every closed id.
  const done = ctx.done ?? ctx.closed;
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue; // closed tickets are the `closed` list, not stations
    const prs = ((t.course as { prs?: unknown[] } | undefined)?.prs ?? []).map(String);
    // A closed unmerged PR counts as none, listed or matched alike.
    const mine = ctx.facts.filter((f) => f.state !== 'closed'
      && (prs.includes(String(f.number)) || patterns.some((p) => branchMatches(p.replace(/\{ticket\}/g, t.id), f.head))));
    if (!mine.length) {
      // No PR is `filed`; `implement` is the queued leg, waiting while a dependency is not
      // closed done or an open child blocks it (R-BTN-74, R-BTN-83: the queue is the queued leg).
      const waiting = t.depends_on.filter((d) => !done.has(d));
      const ready = waiting.length === 0 && t.blocked_by.length === 0;
      const waitingOn = waiting.length ? 'dependencies' : t.blocked_by.length ? 'children' : null;
      stations[t.id] = {
        station: 'filed', path: [], next_leg: 'implement', next_source: 'course', handoff_url: null,
        next: [{ leg: 'implement', state: ready ? 'ready' : 'waiting', waiting_on: waitingOn }], bars: {},
      };
      continue;
    }
    if (mine.every((f) => f.state === 'merged')) {
      stations[t.id] = placeOf(mine[0]);
      continue;
    }
    // The least advanced open PR decides, and its timeline is the path.
    const placed = mine.filter((f) => f.state === 'open').map((f) => ({ f, st: placeOf(f) }));
    placed.sort((a, b) => (LEAST[a.st.station] ?? 0) - (LEAST[b.st.station] ?? 0) || a.f.number - b.f.number);
    stations[t.id] = placed[0].st;
  }
  return { stations, markers: [], course_data: {} };
}
