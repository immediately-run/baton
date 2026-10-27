// course-pr.ts — the station functions of the standard courses that read PRs (BATON_SPEC §2f
// R-BTN-74, R-BTN-131): `create-pr` (and `pr`, the name it replaced), `review-pr` and
// `create-spec` — where each ticket is, from git and PR facts alone (`create-spec` reads, beside
// them, the markers its own start leg writes: course-markers.ts). Pure over injected facts
// (R-BTN-96's fact adapter gathers them from the forge in the sync command), so the same
// functions serve an ejected `.baton/courses/<id>/sync.mjs` through its default export. Course
// code in the CLI, never core (§2b): it may read what a ticket's opaque `course` fields carry.
import type { PostedStation } from '../core/board';
import type { SourceTicket } from './tickets-markdown';
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
  /** Every commit's date on the PR, epoch ms, when the adapter has them (GitHub's does); absent,
   * `pushedAt` alone. A fix is a push between a verdict and the next one. */
  pushes?: number[];
  /** The head's checks; a null conclusion is still running. Empty means none: finished. */
  checks: (string | null)[];
  /** The PR's reviews and its plain comments — a comment is `COMMENTED`, read only for a
   * verdict line (R-BTN-74: "a comment or comment-only review"). */
  reviews: { author: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; submittedAt: number; body?: string }[];
  /** The repository the PR is in, `owner/name` (B-29); absent, the home repository's. */
  repository?: string;
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

/** The `create-pr` course's graph (R-BTN-131), the docs workflow's: filed → pr-open → reviewed,
 * at most three review rounds with a fix between them, then merged — or, when the third round
 * still asks for changes, adjudicated first (a fresh reader reproduces each open blocking finding)
 * and merged or handed to the owner. The course file `baton repo init` writes into git (R-BTN-69). */
export const CREATE_PR_COURSE = {
  start: 'filed',
  start_leg: 'implement',
  end: ['merged'],
  short_waits: ['ci'],
  stations: {
    filed: { label: 'Filed, no PR yet' }, 'pr-open': { label: 'PR open' }, reviewed: { label: 'Reviewed' },
    fixed: { label: 'Findings addressed' }, adjudicated: { label: 'Open findings adjudicated' }, merged: { label: 'Merged' },
  },
  legs: {
    implement: { from: ['filed'], to: 'pr-open', label: 'Implement it and open the PR' },
    review: { from: ['pr-open', 'fixed'], to: 'reviewed', max_runs: 3, label: 'Review round' },
    fix: { from: ['reviewed'], to: 'fixed', max_runs: 2, label: 'Fix or answer the findings' },
    adjudicate: { from: ['reviewed'], to: 'adjudicated', label: 'Reproduce the findings left open' },
    merge: { from: ['reviewed', 'adjudicated'], to: 'merged', label: 'Merge and close the ticket' },
  },
};

/** The `create-spec` course's graph (R-BTN-131, B-96): a specification from the owner's design
 * conversation to a merged PR — `converse` (the interactive session that writes the spec file and
 * opens its PR), `review` (adversarial, non-interactive), `address` (the owner's second
 * conversation, on blocking findings, at most three rounds), `adjudicate` after the third, and
 * `merge`. `review`'s verdict chooses: approve queues `merge`, changes queue `address`. */
export const CREATE_SPEC_COURSE = {
  start: 'requested',
  start_leg: 'converse',
  end: ['merged'],
  short_waits: ['ci'],
  stations: {
    requested: { label: 'Requested, no PR yet' }, 'spec-open': { label: 'Spec PR open' }, reviewed: { label: 'Reviewed' },
    adjudicated: { label: 'Open findings adjudicated' }, merged: { label: 'Merged' },
  },
  legs: {
    converse: { from: ['requested'], to: 'spec-open', label: 'Design the specification with the owner' },
    review: { from: ['spec-open'], to: 'reviewed', max_runs: 3, label: 'Adversarial review round' },
    address: { from: ['reviewed'], to: 'spec-open', max_runs: 3, label: 'Address the blocking findings with the owner' },
    adjudicate: { from: ['reviewed'], to: 'adjudicated', label: 'Reproduce the findings left open' },
    merge: { from: ['reviewed', 'adjudicated'], to: 'merged', label: 'Merge and close the ticket' },
  },
};

/** The `review-pr` course's graph (R-BTN-131): review a PR someone else opened, in rounds — each
 * round's verdict approves (the end) or asks for changes, after which the next round waits on the
 * author's push — and conclude with a summary once the rounds run out or the PR closes. */
export const REVIEW_PR_COURSE = {
  start: 'requested',
  start_leg: 'review',
  end: ['approved', 'concluded'],
  short_waits: ['ci'],
  stations: {
    requested: { label: 'Review requested' }, 'changes-requested': { label: 'Changes requested' },
    approved: { label: 'Approved' }, concluded: { label: 'Review concluded' },
  },
  legs: {
    review: { from: ['requested', 'changes-requested'], to: ['approved', 'changes-requested'], max_runs: 3, label: 'Review round' },
    conclude: { from: ['requested', 'changes-requested'], to: 'concluded', label: 'Summarise and stop' },
  },
};

/** The part of a course file a PR station function reads: its legs' bounds, and whether it has
 * an `adjudicate` leg. The `pr` course's own file (review 4, fix 3, no adjudicate) keeps its
 * behaviour: after its last fix, merge waits on the owner. */
export interface PrGraph {
  legs?: Record<string, { max_runs?: number; [key: string]: unknown } | undefined>;
}

const VERDICT = /^<!--\s*baton:verdict\s+(approve|changes)\s*-->/;
const ADJUDICATED = /^<!--\s*baton:adjudicated\s+(merge|owner)\s*-->/;
const CONCLUDED = /^<!--\s*baton:concluded\s*-->/;
/** A comment's marker line, read like a verdict line: the body's first line. */
const markerOf = (r: PrFact['reviews'][number], re: RegExp): RegExpExecArray | null => (r.state === 'COMMENTED' ? re.exec((r.body ?? '').trim()) : null);
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

/** A PR course's names for the legs its timeline walks (R-BTN-74's steps are the graph's legs,
 *  named): `create-pr`'s `implement` / `fix`, or `create-spec`'s `converse` / `address`, which
 *  open the PR and take a round's findings back to the owner. Everything else about a change's
 *  timeline — the reviews, the verdicts, the adjudication, the merge — is the same shape. */
interface TimelineLegs {
  /** The leg that opened the PR, reaching the station an open PR rests at. */
  open: string;
  /** The station an open PR rests at (`pr-open`, `spec-open`). */
  opened: string;
  /** The leg a push after a verdict counts as: the graph's only way back to `review`. */
  back: string;
  /** The station that leg reaches (`fixed`). */
  backTo: string;
}

const CREATE_PR_LEGS: TimelineLegs = { open: 'implement', opened: 'pr-open', back: 'fix', backTo: 'fixed' };

/** The path a change's timeline implies (R-BTN-74: "the change's timeline in order" — one PR,
 * or `together`'s several): the `open` leg opened it; each verdict is a `review`; a push after a verdict, before the next
 * one, was a `back` leg (the graph's only way back to `review`), whatever that verdict said, since a
 * verdict is on the head it was given on. Verdicts with no push between them — two reviewers of
 * one head — are one review. */
function timelineOf(f: PrFact, legs: TimelineLegs = CREATE_PR_LEGS): Step[] {
  const path: Step[] = [{ leg: legs.open, reached: legs.opened }];
  const pushes = f.pushes?.length ? f.pushes : [f.pushedAt];
  const verdicts = verdictsOf(f);
  verdicts.forEach((v, i) => {
    if (path.at(-1)!.reached !== 'reviewed') path.push({ leg: 'review', reached: 'reviewed' });
    const until = verdicts[i + 1]?.submittedAt ?? Number.POSITIVE_INFINITY;
    if (pushes.some((p) => p > v.submittedAt && p < until)) path.push({ leg: legs.back, reached: legs.backTo });
  });
  return path;
}

const backRunsOf = (path: Step[], legs: TimelineLegs = CREATE_PR_LEGS): number => path.filter((s) => s.leg === legs.back).length;

/** A station function's reading of where a ticket is under its course file's bounds: the legs
 *  the timeline walks and the leg a verdict asking for changes queues (`fix` on `create-pr`,
 *  `address` on `create-spec`). */
interface PrBounds {
  legs: TimelineLegs;
  /** The leg a `changes` verdict queues. */
  back: string;
  /** How many rounds of that leg precede an adjudication, when the file has an `adjudicate` leg. */
  rounds: number;
  /** Whether the file has an `adjudicate` leg. */
  adjudicates: boolean;
}

/** `create-pr`'s bounds, and the `pr` course's: `review` 4, `fix` 3, no adjudicate. */
const boundsOf = (graph: PrGraph): PrBounds => ({
  legs: CREATE_PR_LEGS, back: 'fix', rounds: graph.legs?.fix?.max_runs ?? 3, adjudicates: graph.legs?.adjudicate != null,
});

const at = (station: string, path: Step[], next: PostedStation['next']): PostedStation =>
  ({ station, path, next_leg: next[0]?.leg ?? null, next_source: 'course', handoff_url: null, next, bars: {} });

/** A station function's return with no PR markers: the PR courses write none (no seats or bars),
 *  so `markers` is empty and `course_data` an empty object. */
const noMarkers = (stations: Record<string, PostedStation>): StationsResult => ({ stations, markers: [], course_data: {} });

/** The adjudication after the last verdict, when one was written: `merge` (no open blocking
 * finding reproduced) or `owner` (one did — the owner decides). */
function adjudicationOf(fact: PrFact): 'merge' | 'owner' | null {
  const last = verdictsOf(fact).at(-1)?.submittedAt ?? Number.NEGATIVE_INFINITY;
  const marks = fact.reviews.filter((r) => r.submittedAt > last && markerOf(r, ADJUDICATED)).sort((a, b) => a.submittedAt - b.submittedAt);
  const m = marks.length ? markerOf(marks.at(-1)!, ADJUDICATED) : null;
  return m ? (m[1] === 'merge' ? 'merge' : 'owner') : null;
}

/** Where one PR puts the ticket: the end of its timeline, and the queued leg leaving it. The
 *  course file's bounds decide what follows a verdict asking for changes once the rounds run out:
 *  the `adjudicate` leg when the course has one (`create-pr`, `create-spec`), else merge waiting
 *  on the owner (`pr`). `bounds.legs` names the timeline's legs, so the same walk places a
 *  `create-spec` PR as a `create-pr` one. */
function placeOf(fact: PrFact, graph: PrGraph, bounds: PrBounds = boundsOf(graph)): PostedStation {
  const path = timelineOf(fact, bounds.legs);
  const adjudication = bounds.adjudicates && path.at(-1)!.reached === 'reviewed' ? adjudicationOf(fact) : null;
  if (adjudication) path.push({ leg: 'adjudicate', reached: 'adjudicated' });
  if (fact.state === 'merged') {
    // Every PR merged is `merged` — the end station: done for Baton (R-BTN-70) whether or not
    // the file says `done` yet, which the merge leg's script also writes. A merge leaves
    // `reviewed` (or `adjudicated`), so a timeline resting elsewhere was reviewed by the merge itself.
    const last = path.at(-1)!.reached;
    if (last !== 'reviewed' && last !== 'adjudicated') path.push({ leg: 'review', reached: 'reviewed' });
    return at('merged', [...path, { leg: 'merge', reached: 'merged' }], []);
  }
  // Adjudicated: merge, ready — or waiting on the owner when a finding reproduced (Needs you, §14).
  if (adjudication) return at('adjudicated', path, [{ leg: 'merge', state: adjudication === 'merge' ? 'ready' : 'waiting', waiting_on: adjudication === 'merge' ? null : 'owner' }]);
  // `review` waits on ci while the head's checks run, and is ready once they finish.
  const wait = checksDone(fact) ? null : 'ci';
  const last = path.at(-1)!.reached;
  if (last === bounds.legs.opened || last === bounds.legs.backTo) return at(last, path, [{ leg: 'review', state: wait ? 'waiting' : 'ready', waiting_on: wait }]);
  if (verdictOf(verdictsOf(fact).at(-1)!) === 'approve') return at('reviewed', path, [{ leg: 'merge', state: 'ready', waiting_on: null }]);
  // Changes requested: the back leg (`fix`, `address`), until the course's rounds run out; then
  // adjudicate, or merge waiting on the owner (listed under Needs you, §14) on a course with no
  // adjudicate leg.
  if (backRunsOf(path, bounds.legs) >= bounds.rounds) {
    return at('reviewed', path, [bounds.adjudicates ? { leg: 'adjudicate', state: 'ready', waiting_on: null } : { leg: 'merge', state: 'waiting', waiting_on: 'owner' }]);
  }
  return at('reviewed', path, [{ leg: bounds.back, state: 'ready', waiting_on: null }]);
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

/** GitHub's owner and repository names ignore case. */
export const sameRepo = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The PRs a ticket's `prs:` names, each as its repository and number: a bare number or `#n` is
 * the home repository's (`home`, `owner/name`, null when unknown); a pull-request URL —
 * `https://<host>/<owner>/<name>/pull/<n>` — names its own (B-29). */
export function prRefs(prs: unknown[], home?: string | null): { repository: string | null; number: string }[] {
  const out: { repository: string | null; number: string }[] = [];
  for (const p of prs) {
    const text = String(p).trim();
    if (/^#?\d+$/.test(text)) out.push({ repository: home ?? null, number: text.replace(/^#/, '') });
    const m = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/#?].*)?$/.exec(text);
    if (m) out.push({ repository: m[1], number: m[2] });
  }
  return out;
}

/** Whether `ref` names fact `f`: the same number in the same repository, a fact with no
 * `repository` being the home's (`home`); with the home unknown, any repository's (B-29). */
const refNames = (ref: { repository: string | null; number: string }, f: { number: number; repository?: string }, home?: string | null): boolean => {
  if (ref.number !== String(f.number)) return false;
  const repo = f.repository ?? home ?? null;
  return ref.repository == null || repo == null || sameRepo(ref.repository, repo);
};

/** The course's branch patterns ready to match (R-BTN-51): the current and previous ones, the
 * default when it names none. `{repository}` names the ticket's home repository (its Baton id),
 * whichever repository the branch is in — a sibling's PR branch carries the home's name too
 * (B-29) — so it matches anything: which repositories are read at all is `ticketOwns`'s
 * `repos:` check. */
export const matchPatterns = (branchPatterns?: string[]): string[] =>
  (branchPatterns?.length ? branchPatterns : [DEFAULT_BRANCH_PATTERN]).map((p) => p.replace(/\{repository\}/g, '*'));

/** Whether fact `f` is in a repository ticket `t` reads: its home (`home`; a fact with no
 * `repository` is the home's), or one its `repos:` names (B-29). The adapter reads a sibling's
 * reviews and checks only for a ticket naming it, so a match outside these is a list-only fact. */
const readsRepo = (t: SourceTicket, f: { repository?: string }, home?: string | null): boolean => {
  const repo = f.repository ?? home ?? null;
  return repo == null || home == null || sameRepo(repo, home) || (t.repos ?? []).some((r) => sameRepo(r, repo));
};

/** Whether PR `number` on head branch `head`, in `pr.repository` (absent, the home, `repository`),
 * is one of ticket `t`'s: listed in its `prs:`, or on a branch one of `patterns` (from
 * `matchPatterns`) maps to it. A PR in another repository is the ticket's only when the ticket
 * names that repository in `repos:` (B-29). */
export function ticketOwns(t: SourceTicket, pr: { number: number; head: string; repository?: string }, patterns: string[], repository?: string | null): boolean {
  if (!readsRepo(t, pr, repository)) return false;
  return prRefs((t.course as { prs?: unknown[] } | undefined)?.prs ?? [], repository).some((r) => refNames(r, pr, repository))
    || patterns.some((p) => branchMatches(p.replace(/\{ticket\}/g, t.id), pr.head));
}

/** A ticket's PRs as one change (B-29): `close` writes each line on one PR, so a verdict, an
 * adjudication or a push on any of them is the change's; `review` waits on every open PR's
 * checks; and the change is merged when every PR is. One PR is itself. */
function together(facts: PrFact[]): PrFact {
  if (facts.length === 1) return facts[0];
  const open = facts.filter((f) => f.state === 'open');
  const pushes = facts.flatMap((f) => (f.pushes?.length ? f.pushes : [f.pushedAt])).sort((a, b) => a - b);
  return {
    number: Math.min(...facts.map((f) => f.number)), head: facts[0].head, repository: facts[0].repository,
    state: open.length ? 'open' : 'merged', pushedAt: Math.max(...pushes), pushes,
    checks: open.flatMap((f) => f.checks), reviews: facts.flatMap((f) => f.reviews),
  };
}

/** The `create-pr` course's stations (R-BTN-74, R-BTN-131), and the `pr` course's: the
 * ticket's PRs are its `course.prs` and every open-or-merged fact whose head branch matches the
 * pattern, in its home or a repository its `repos:` names; several are read together as one
 * change (`together`, B-29) — and every PR merged is `merged`, the end station. No PR is
 * `filed`, with `implement` waiting while a dependency or an open child is not done. `graph` is the course file; absent, the `pr` course's bounds. */
export function stationsPr(ctx: { tickets: SourceTicket[]; facts: PrFact[]; branchPatterns?: string[]; closed: Set<string>; done?: Set<string>; repository?: string | null; graph?: PrGraph }): StationsResult {
  const graph = ctx.graph ?? {};
  const stations: Record<string, PostedStation> = {};
  const patterns = matchPatterns(ctx.branchPatterns);
  // A dependency counts once it is closed `done` (R-BTN-74); `done` absent, every closed id.
  const done = ctx.done ?? ctx.closed;
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue; // closed tickets are the `closed` list, not stations
    // A closed unmerged PR counts as none, listed or matched alike.
    const mine = ctx.facts.filter((f) => f.state !== 'closed' && ticketOwns(t, f, patterns, ctx.repository));
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
    stations[t.id] = placeOf(together(mine), graph);
  }
  return noMarkers(stations);
}

/** The `create-spec` course's stations (R-BTN-131, B-96): a specification's PR is a branch-pattern
 *  PR like any other, so an open or merged one is placed by `create-pr`'s own walk (`placeOf` with
 *  this course's leg names: `converse` opened the PR at `spec-open`, `address` takes a round's
 *  findings to the owner and a push back to `spec-open`, a `changes` verdict queues `address`
 *  until three rounds are spent and then `adjudicate`, and an `approve` queues `merge`).
 *
 *  A ticket with no PR has not left `requested`, and the design conversation — the leg that opens
 *  the PR — is the owner's session, which Baton neither runs nor waits for inside a claim. Whether
 *  it has run is read from the repository's own marker file: the leg's instructions append
 *  `{ticket, leg: 'converse', reached: 'requested', next: 'review'}` to `.baton/markers.jsonl` and
 *  commit it before the owner's session starts, so
 *  - no such line, the ticket's `converse` is `ready` (a claim runs it: it prints the session's
 *    command and prompt, writes the line and suspends), a dependency still open or an open child
 *    holding it as `stationsPr` holds `implement` (`dependencies`, `children`); and
 *  - such a line, the ticket waits on the `owner` — the sync does not offer `converse` again
 *    while the line stands, so one conversation, not one per sync — until its PR lands and the
 *    next reading places it at `spec-open`. */
export function stationsSpec(ctx: {
  tickets: SourceTicket[];
  facts: PrFact[];
  branchPatterns?: string[];
  closed: Set<string>;
  done?: Set<string>;
  repository?: string | null;
  graph?: PrGraph;
  /** `.baton/markers.jsonl` as the checkout has it: the start leg's own record that a
   *  conversation has begun. */
  // The marker lines the sync parsed (B-96): a structural type, never an import —
  // course-markers.ts is Node code, and this module is type-checked in both hosts.
  markers?: { ticket: string; leg: string; reached: string }[];
}): StationsResult {
  const graph = ctx.graph ?? {};
  const stations: Record<string, PostedStation> = {};
  const patterns = matchPatterns(ctx.branchPatterns);
  const done = ctx.done ?? ctx.closed;
  const bounds: PrBounds = {
    legs: { open: 'converse', opened: 'spec-open', back: 'address', backTo: 'spec-open' },
    back: 'address', rounds: graph.legs?.address?.max_runs ?? 3, adjudicates: graph.legs?.adjudicate != null,
  };
  // The tickets whose design conversation has begun: one marker line the leg wrote, for the
  // ticket, at the station it opened. A malformed line is `parseMarkers`' to skip, never this
  // function's.
  const conversed = new Set((ctx.markers ?? []).filter((m) => m.leg === 'converse' && m.reached === 'requested').map((m) => m.ticket));
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    // As `stationsPr`: a closed unmerged PR counts as none.
    const mine = ctx.facts.filter((f) => f.state !== 'closed' && ticketOwns(t, f, patterns, ctx.repository));
    if (!mine.length) {
      const waiting = t.depends_on.filter((d) => !done.has(d));
      const blocked = waiting.length ? 'dependencies' : t.blocked_by.length ? 'children' : null;
      // A blocked start is `waiting` whatever the conversation did; an unblocked one that has
      // begun waits on the owner in the session; one that has not is ready for its claim.
      const wait = blocked ?? (conversed.has(t.id) ? 'owner' : null);
      stations[t.id] = at('requested', conversed.has(t.id) ? [{ leg: 'converse', reached: 'requested' }] : [],
        [{ leg: 'converse', state: wait ? 'waiting' : 'ready', waiting_on: wait }]);
      continue;
    }
    stations[t.id] = placeOf(together(mine), graph, bounds);
  }
  return noMarkers(stations);
}

/** The `review-pr` course's stations (R-BTN-131). The ticket names the PR to review in `prs:`
 * (it is someone else's, so no branch pattern finds it). Each verdict is a `review` round,
 * reaching `approved` or `changes-requested`; a `<!-- baton:concluded -->` comment after them is
 * the `conclude` leg. Placed:
 * - no PR found: `requested`, `review` waiting on `pr`;
 * - concluded, or the last verdict approves: that end;
 * - the PR merged or closed, or the course's review rounds spent: `conclude` ready;
 * - otherwise `review` — before its first round waiting while a dependency is not closed done or
 *   an open child blocks it; waiting on ci while the head's checks run; and after a verdict asking
 *   for changes, waiting on the `author` until a push lands after it. */
export function stationsReviewPr(ctx: { tickets: SourceTicket[]; facts: PrFact[]; closed: Set<string>; done?: Set<string>; repository?: string | null; graph?: PrGraph }): StationsResult {
  const rounds = ctx.graph?.legs?.review?.max_runs ?? 3;
  const done = ctx.done ?? ctx.closed;
  const stations: Record<string, PostedStation> = {};
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    // By repository and number: two repositories may both have a PR #7; and only in a
    // repository the ticket reads, as `ticketOwns` (B-29).
    const refs = prRefs((t.course as { prs?: unknown[] } | undefined)?.prs ?? [], ctx.repository);
    const fact = ctx.facts.find((f) => readsRepo(t, f, ctx.repository) && refs.some((r) => refNames(r, f, ctx.repository)));
    if (!fact) {
      stations[t.id] = at('requested', [], [{ leg: 'review', state: 'waiting', waiting_on: 'pr' }]);
      continue;
    }
    const verdicts = verdictsOf(fact);
    const path: Step[] = verdicts.map((v) => ({ leg: 'review', reached: verdictOf(v) === 'approve' ? 'approved' : 'changes-requested' }));
    const station = path.at(-1)?.reached ?? 'requested';
    if (station === 'approved') {
      stations[t.id] = at('approved', path, []);
      continue;
    }
    const lastVerdict = verdicts.at(-1)?.submittedAt ?? Number.NEGATIVE_INFINITY;
    if (fact.reviews.some((r) => r.submittedAt > lastVerdict && markerOf(r, CONCLUDED))) {
      stations[t.id] = at('concluded', [...path, { leg: 'conclude', reached: 'concluded' }], []);
      continue;
    }
    if (fact.state !== 'open' || path.length >= rounds) {
      stations[t.id] = at(station, path, [{ leg: 'conclude', state: 'ready', waiting_on: null }]);
      continue;
    }
    const pushes = fact.pushes?.length ? fact.pushes : [fact.pushedAt];
    // The first round waits like any course's start leg: on a dependency not closed done, then on
    // an open child (R-BTN-74).
    const before = path.length ? null : t.depends_on.some((d) => !done.has(d)) ? 'dependencies' : t.blocked_by.length ? 'children' : null;
    const wait = before ?? (station === 'changes-requested' && !pushes.some((p) => p > lastVerdict) ? 'author' : checksDone(fact) ? null : 'ci');
    stations[t.id] = at(station, path, [
      { leg: 'review', state: wait ? 'waiting' : 'ready', waiting_on: wait },
      { leg: 'conclude', state: 'ready', waiting_on: null },
    ]);
  }
  return { stations, markers: [], course_data: {} };
}
