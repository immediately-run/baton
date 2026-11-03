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
import { gateOfBranch, verifiedMarkers, type BranchCommit, type GateMarker, type RecordedLeg } from './pr-markers';

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
  /** The branch's commits, oldest first, when the adapter reads them (B-110, `pr-markers.ts`):
   *  each one's sha, date, first parent, whether it changes no tree, and message — what the
   *  run-tests gate's state is read from (a counted marker is no push; everything else is). The
   *  GitHub adapter reads them from the forge, a plain-git reading from the checkout's own git
   *  (`commitsOf`). Absent, the gate stays open: no marker can be counted. */
  commits?: BranchCommit[];
  /** The PR's web page, when the forge has one — where its rounds' findings are (B-110: the
   *  owner's decision links it). */
  url?: string;
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
 * and merged or handed to the owner. The course file `baton repo init` writes into git (R-BTN-69).
 *
 * B-110 (the owner, 2026-10-24) revises it twice. `run-tests` — a deterministic gate the stub
 * itself runs (`npm run <test_script>`, no agent) — stands before every review round: a
 * self-loop at `pr-open` and `fixed` so the claim's path can walk it while the posted station
 * stays forge-computable; a red gate routes to `fix` from either edge of the loop
 * (implement → run-tests → fix — making the tests green is fixing, wherever the push came
 * from), and the loop it forms runs to a generous budget of 30 while the review rounds stay
 * at 3. And the third round's blockers are the owner's: `adjudicate` waits on them — a human
 * in the loop — until they answer `merge`, `owner` or `round` through Baton (the owner,
 * 2026-11-03, "Through Baton, not git"), never by a line in git. */
export const CREATE_PR_COURSE = {
  start: 'filed',
  start_leg: 'implement',
  end: ['merged'],
  short_waits: ['ci'],
  // B-110: the deterministic gate's script — `npm run <test_script>` in the checkout.
  test_script: 'test',
  stations: {
    filed: { label: 'Filed, no PR yet' }, 'pr-open': { label: 'PR open' }, reviewed: { label: 'Reviewed' },
    fixed: { label: 'Findings addressed' }, adjudicated: { label: 'Open findings adjudicated' }, merged: { label: 'Merged' },
  },
  legs: {
    implement: { from: ['filed'], to: 'pr-open', label: 'Implement it and open the PR' },
    'run-tests': { from: ['pr-open', 'fixed'], to: ['pr-open', 'fixed'], max_runs: 30, label: 'Run the deterministic tests' },
    // B-110: review also leaves `reviewed` — the owner's `round` answer grants exactly one more
    // round on the same head (the answer itself carries the run, §6.8; the round's verdict is
    // its marker, and a round still asking for changes comes straight back to the owner).
    review: { from: ['pr-open', 'fixed', 'reviewed'], to: 'reviewed', max_runs: 3, label: 'Review round' },
    fix: { from: ['reviewed', 'pr-open', 'fixed'], to: 'fixed', max_runs: 30, label: 'Fix or answer the findings' },
    adjudicate: { from: ['reviewed'], to: 'adjudicated', label: 'The owner answers the third round' },
    merge: { from: ['reviewed', 'adjudicated'], to: 'merged', label: 'Merge and close the ticket' },
  },
};

/** The `create-spec` course's graph (R-BTN-131, B-96): a specification from the owner's design
 * conversation to a merged PR — `converse` (the interactive session that writes the spec file and
 * opens its PR), `review` (adversarial, non-interactive), `address` (the owner's second
 * conversation, on blocking findings, at most three rounds), `adjudicate` after the third, and
 * `merge`. `review`'s verdict chooses: approve queues `merge`, changes queue `address`.
 *
 * The runs mirror `create-pr`'s rule, rounds equal review runs minus one: three address rounds are
 * each followed by a review, so `review` runs four times and the fourth place — a round still
 * asking for changes after the third address — queues `adjudicate`. `review` at 3 would refuse the
 * fourth `max-runs` and leave the ticket offered a review it can never run. */
export const CREATE_SPEC_COURSE = {
  start: 'requested',
  start_leg: 'converse',
  end: ['merged'],
  // B-98: a specification is requested, not found — `baton request "<one sentence>" --course
  // create-spec` files the ticket that starts it.
  starts_from: 'request',
  short_waits: ['ci'],
  stations: {
    requested: { label: 'Requested, no PR yet' }, 'spec-open': { label: 'Spec PR open' }, reviewed: { label: 'Reviewed' },
    adjudicated: { label: 'Open findings adjudicated' }, merged: { label: 'Merged' },
  },
  legs: {
    converse: { from: ['requested'], to: 'spec-open', label: 'Design the specification with the owner' },
    review: { from: ['spec-open'], to: 'reviewed', max_runs: 4, label: 'Adversarial review round' },
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
 * one head — are one review.
 *
 * Under the gate (B-110, `gate`), the walk reads one order of verdicts, content pushes and the
 * branch's counted `Baton-Tests` markers (`markers`, verified against Baton's record): each marker is the `run-tests` leg's own step, at the station
 * the path rested at when it landed; a push after a red marker is the `back` leg's work landing
 * wherever the push came from (the implement → run-tests → fix edge — making the tests green is
 * fixing), so it is a `back` step like a push after a verdict; and a run of pushes with nothing
 * between them is one leg's work, counted once. */
function timelineOf(f: PrFact, legs: TimelineLegs = CREATE_PR_LEGS, gate = false, markers: GateMarker[] = [], rounds: number[] = []): Step[] {
  const path: Step[] = [{ leg: legs.open, reached: legs.opened }];
  const pushes = f.pushes?.length ? f.pushes : [f.pushedAt];
  const verdicts = verdictsOf(f);
  if (!gate) {
    verdicts.forEach((v, i) => {
      if (path.at(-1)!.reached !== 'reviewed') path.push({ leg: 'review', reached: 'reviewed' });
      const until = verdicts[i + 1]?.submittedAt ?? Number.POSITIVE_INFINITY;
      if (pushes.some((p) => p > v.submittedAt && p < until)) path.push({ leg: legs.back, reached: legs.backTo });
    });
    return path;
  }
  type Ev = { t: number; kind: 'verdict' } | { t: number; kind: 'push' } | { t: number; kind: 'tests'; m: GateMarker } | { t: number; kind: 'round' };
  const events: Ev[] = [
    ...verdicts.map((v): Ev => ({ t: v.submittedAt, kind: 'verdict' })),
    ...pushes.map((p): Ev => ({ t: p, kind: 'push' })),
    ...markers.map((m): Ev => ({ t: m.at, kind: 'tests', m })),
    ...rounds.map((t): Ev => ({ t, kind: 'round' })),
  ].sort((a, b) => a.t - b.t);
  let granted = false; // the owner granted a round on this head: its verdict is a round of its own
  let red = false; // a red marker whose fix has not landed: the push that follows is the fix's
  let run = false; // a run of pushes with nothing between: one leg's work, counted once
  for (const ev of events) {
    const rest = path.at(-1)!.reached;
    if (ev.kind === 'round') {
      granted = true;
    } else if (ev.kind === 'verdict') {
      // Verdicts with nothing between them are one round (two reviewers of one head) — unless
      // the owner granted a round since (`review` from `reviewed`, the graph's own edge).
      if (rest !== 'reviewed' || granted) path.push({ leg: 'review', reached: 'reviewed' });
      granted = false;
      red = false;
      run = false;
    } else if (ev.kind === 'push') {
      if (run) continue;
      // A push after a verdict is the back leg's work landing; so is a push after a red marker,
      // at either edge of the gate's loop (the implement → run-tests → fix edge — making the
      // tests green is fixing, wherever the push came from).
      if (rest === 'reviewed' || ((rest === legs.backTo || rest === legs.opened) && red)) {
        path.push({ leg: legs.back, reached: legs.backTo });
        red = false;
        run = true;
      }
    } else if (rest === legs.opened || rest === legs.backTo) {
      // The gate's own step, at the station it ran from. A marker the walk cannot place (one
      // landing while the path rests at `reviewed`) is not an edge the graph holds; it places
      // nothing, and the routing reads its outcome from the gate's own state.
      red = ev.m.tests === 'red';
      run = false;
      path.push({ leg: 'run-tests', reached: rest });
    }
  }
  return path;
}

const backRunsOf = (path: Step[], legs: TimelineLegs = CREATE_PR_LEGS): number => path.filter((s) => s.leg === legs.back).length;

/** A station function's reading of where a ticket is under its course file's bounds: the legs
 *  the timeline walks, the leg a verdict asking for changes queues, how many review rounds
 *  precede an adjudication, whether the file has an `adjudicate` leg, and whether it gates
 *  every round behind `run-tests` (B-110). */
interface PrBounds {
  legs: TimelineLegs;
  /** The leg a `changes` verdict queues. */
  back: string;
  /** How many review rounds precede an adjudication, when the file has an `adjudicate` leg. */
  rounds: number;
  /** Whether the file has an `adjudicate` leg. */
  adjudicates: boolean;
  /** Whether the file has the `run-tests` gate (B-110): every review round waits on it, and a
   *  red one routes to the back leg from either edge of its loop. A file without the leg — the
   *  `pr` course's own — keeps today's reading exactly. */
  gate: boolean;
}

/** `create-pr`'s bounds, and the `pr` course's: `review` 4, `fix` 3, no adjudicate, no gate. The
 *  rounds are the review rounds — the file's `review.max_runs` — read from the timeline's
 *  review steps, so the red-fix loop the gate opens (B-110: `fix` 30 beside `review` 3) never
 *  spends an adjudication. */
const boundsOf = (graph: PrGraph): PrBounds => ({
  legs: CREATE_PR_LEGS, back: 'fix', rounds: graph.legs?.review?.max_runs ?? 3, adjudicates: graph.legs?.adjudicate != null,
  gate: graph.legs?.['run-tests'] != null,
});

/** The `create-spec` course's bounds: `converse` opened the PR at `spec-open`, `address` is the
 *  back leg, and its rounds are the file's (review 4 — B-110 counts rounds as review steps, so
 *  the fourth review is the one that finds the three address rounds spent, exactly as before).
 *  No gate: `create-spec` keeps its own graph (B-110 revised `create-pr` alone). */
const SPEC_BOUNDS: PrBounds = {
  legs: { open: 'converse', opened: 'spec-open', back: 'address', backTo: 'spec-open' },
  back: 'address', rounds: CREATE_SPEC_COURSE.legs.review.max_runs, adjudicates: true, gate: false,
};

const at = (station: string, path: Step[], next: PostedStation['next']): PostedStation =>
  ({ station, path, next_leg: next[0]?.leg ?? null, next_source: 'course', handoff_url: null, next, bars: {} });

/** A station function's return with no PR markers: the PR courses write none (no seats or bars),
 *  so `markers` is empty and `course_data` an empty object. */
const noMarkers = (stations: Record<string, PostedStation>): StationsResult => ({ stations, markers: [], course_data: {} });

/** `create-spec`'s record that a leg has run and is now waiting outside the claim: the close
 *  its `close` commits into the ticket's own frontmatter (R-BTN-83, B-100) — `converse`'s at
 *  `requested`, `address`'s at `reviewed` — read from the ticket's git history as the sync
 *  attached it to its opaque `course` blob (`closes`). Each is a signal, never a step: the path
 *  stays where the PR facts put it. */
interface SpecMarkers {
  /** The tickets whose design conversation has begun (a `converse` close at `requested`). */
  conversed: Set<string>;
  /** How many times each ticket's `address` leg has ended in the owner's hands (an `address`
   *  close at `reviewed`): one more than the timeline's `address` steps while none of its work
   * has landed as a push. */
  addressed: Map<string, number>;
}

/** The closes a ticket's own history holds, as the sync attached them to its `course` blob —
 * read structurally (never an import: this module is type-checked in both hosts). */
const closesOfTicket = (t: { id: string; course?: Record<string, unknown> }): { leg: string; reached: string }[] => {
  const c = t.course?.closes;
  if (!Array.isArray(c)) return [];
  const out: { leg: string; reached: string }[] = [];
  for (const x of c as { leg?: unknown; reached?: unknown }[]) {
    if (x != null && typeof x.leg === 'string' && typeof x.reached === 'string') out.push({ leg: x.leg, reached: x.reached });
  }
  return out;
};

const specMarkersOf = (tickets: { id: string; course?: Record<string, unknown> }[]): SpecMarkers => {
  const out: SpecMarkers = { conversed: new Set(), addressed: new Map() };
  for (const t of tickets) {
    for (const m of closesOfTicket(t)) {
      if (m.leg === 'converse' && m.reached === 'requested') out.conversed.add(t.id);
      if (m.leg === 'address' && m.reached === 'reviewed') out.addressed.set(t.id, (out.addressed.get(t.id) ?? 0) + 1);
    }
  }
  return out;
};

/** The adjudication after the last verdict, when one was written: `merge` (no open blocking
 * finding reproduced) or `owner` (one did — the owner decides). `create-spec`'s own adjudicate,
 * a fresh reader whose close writes the line; `create-pr`'s third round is the owner's, answered
 * through Baton (B-110, `PlaceInput.answers`), never a line any pusher could write. */
function adjudicationOf(fact: PrFact): 'merge' | 'owner' | null {
  const last = verdictsOf(fact).at(-1)?.submittedAt ?? Number.NEGATIVE_INFINITY;
  const marks = fact.reviews.filter((r) => r.submittedAt > last && markerOf(r, ADJUDICATED)).sort((a, b) => a.submittedAt - b.submittedAt);
  const m = marks.length ? markerOf(marks.at(-1)!, ADJUDICATED) : null;
  return m ? (m[1] === 'merge' ? 'merge' : 'owner') : null;
}

/** What the sync read of Baton's own record with its observation number (B-110,
 *  `Claims.syncRecord`): the owner's answers to the decisions the sync posted, and the legs
 *  claims finished with an evidence pointer — what a marker in git is judged against. */
export interface BatonRecord {
  /** Each answer's time is Baton's clock: a `round` answer opens a round of its own on the head
   *  the third round refused, its verdict a round apart from the one before it. */
  answers?: { ticket: string; decision: string; answer: string; answered_at?: number }[];
  legs?: RecordedLeg[];
}

/** The gate's reading of one ticket's PRs (B-110): the run-tests gate's state, the counted
 *  markers the walk places, the owner's answers to the sync's decisions, and where the rounds'
 *  findings are. */
interface PlaceInput {
  /** `open` (no counted marker tested the head), `green`, `red`; `unreachable` when the gate
   *  cannot test the change — a PR outside the home repository, or several in it. */
  gate: 'open' | 'green' | 'red' | 'unreachable';
  markers: GateMarker[];
  answers: Map<string, string>;
  /** When the owner granted each extra round (a `round` answer, Baton's clock). */
  rounds: number[];
  /** The PR whose last round asked for changes, when the forge gives its page. */
  url: string | null;
  /** The PRs the gate cannot test, named for the owner's question. */
  unreachable: string[];
}

const NO_GATE: PlaceInput = { gate: 'green', markers: [], answers: new Map(), rounds: [], url: null, unreachable: [] };

/** `3rd`, `4th`, `21st`: the owner's question names the round it would start. */
const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

/** The decision the rounds' blockers post (B-110): `review-rounds-<n>`, asked of the owner — the
 *  human in the loop — with the owner's own question (2026-10-24) and the three answers, `round`
 *  granting exactly one more review run (the owner, 2026-11-03, "The answer carries the grant").
 *  The id names the rounds spent, so an answer buys the round it was asked about and no later
 *  one: a fourth round still asking for changes asks `review-rounds-4`. */
const roundsDecision = (rounds: number, url: string | null): NonNullable<PostedStation['decisions']>[number] => ({
  id: `review-rounds-${rounds}`, leg: 'adjudicate', asks: 'owner', ...(url ? { url } : {}),
  question: `${rounds} failed reviews — manual review or start a ${ordinal(rounds + 1)} round?`,
  options: [{ id: 'merge' }, { id: 'owner' }, { id: 'round', grants: { leg: 'review', runs: 1 } }],
});

/** The decision a gate that cannot run posts (B-110 round 1, finding 2): the stub tests the home
 *  repository's one PR branch, so a ticket with a PR elsewhere, or several at home, would loop
 *  the gate to its budget with no marker any PR reads. It asks the owner instead — `skip` waives
 *  the gate for this ticket — rather than looping. */
const UNREACHABLE = 'run-tests-unreachable';
const unreachableDecision = (prs: string[], url: string | null): NonNullable<PostedStation['decisions']>[number] => ({
  id: UNREACHABLE, leg: 'run-tests', asks: 'owner', ...(url ? { url } : {}),
  question: `The test gate cannot run on ${prs.slice(0, 3).join(', ')}${prs.length > 3 ? ', …' : ''} — skip it for this ticket?`.slice(0, 200),
  options: [{ id: 'skip' }],
});

/** Where one PR puts the ticket: the end of its timeline, and the queued leg leaving it. The
 *  course file's bounds decide what follows a verdict asking for changes once the rounds run out:
 *  the `adjudicate` leg when the course has one (`create-pr`, `create-spec`), else merge waiting
 *  on the owner (`pr`). `bounds.legs` names the timeline's legs, so the same walk places a
 *  `create-spec` PR as a `create-pr` one.
 *
 *  The gate (B-110, `bounds.gate`) routes at `pr-open` and `fixed`: the open gate is `run-tests`
 *  ready — no review round starts until it stands green on the head — a green one queues `review`
 *  (ci-waited as ever), and a red one queues the back leg from either edge of its loop. And the
 *  rounds spent with blockers still open are the owner's: `adjudicate` waits on them and the
 *  posted decision carries their question, until the owner answers on the branch. */
function placeOf(fact: PrFact, graph: PrGraph, bounds: PrBounds = boundsOf(graph), pending = false, input: PlaceInput = NO_GATE): PostedStation {
  const path = timelineOf(fact, bounds.legs, bounds.gate, input.markers, input.rounds);
  const last = path.at(-1)!.reached;
  // The rounds are the review steps the timeline walked. Under the gate (B-110) the owner's
  // answer is read once they are spent, from Baton's record of the decision they posted — never
  // a line in git or on the forge, which any pusher can write (the owner, 2026-11-03); its id
  // names the rounds spent, so an answer buys the round it was asked about. create-spec keeps
  // its own adjudicate, read from the line its close writes whenever the change rests at
  // `reviewed`, as before.
  const rounds = path.filter((s) => s.leg === 'review').length;
  const spent = rounds >= bounds.rounds;
  const answer = bounds.gate ? input.answers.get(`review-rounds-${rounds}`) : undefined;
  const adjudication: 'merge' | 'owner' | 'round' | null = !bounds.adjudicates || last !== 'reviewed' ? null
    : bounds.gate ? (spent && (answer === 'merge' || answer === 'owner' || answer === 'round') ? answer : null)
      : adjudicationOf(fact);
  if (fact.state === 'merged') {
    // Every PR merged is `merged` — the end station: done for Baton (R-BTN-70) whether or not
    // the file says `done` yet, which the merge leg's script also writes. A merge leaves
    // `reviewed` (or `adjudicated`), so a timeline resting elsewhere was reviewed by the merge itself.
    if (adjudication && adjudication !== 'round') path.push({ leg: 'adjudicate', reached: 'adjudicated' });
    const end = path.at(-1)!.reached;
    if (end !== 'reviewed' && end !== 'adjudicated') path.push({ leg: 'review', reached: 'reviewed' });
    return at('merged', [...path, { leg: 'merge', reached: 'merged' }], []);
  }
  if (adjudication === 'round') {
    // Exactly one more review round: the owner's `round` answer granted its run when Baton
    // accepted it (§6.8) — the ticket stays at `reviewed` with the round ready, on the same
    // head, its marker the next verdict.
    return at('reviewed', path, [{ leg: 'review', state: 'ready', waiting_on: null }]);
  }
  if (adjudication) path.push({ leg: 'adjudicate', reached: 'adjudicated' });
  // Adjudicated: merge, ready — or waiting on the owner when the answer parked it (the owner took
  // the change over by hand).
  if (adjudication) return at('adjudicated', path, [{ leg: 'merge', state: adjudication === 'merge' ? 'ready' : 'waiting', waiting_on: adjudication === 'merge' ? null : 'owner' }]);
  // `review` waits on ci while the head's checks run, and is ready once they finish.
  const wait = checksDone(fact) ? null : 'ci';
  if (last === bounds.legs.opened || last === bounds.legs.backTo) {
    if (bounds.gate) {
      // The gate before every review round (B-110): open — no counted marker tested this head —
      // is `run-tests` ready; green queues `review`, ci-waited as today; red queues the back leg,
      // wherever the push came from, the deterministic gate refusing to spend a review round on
      // red checks. A gate that cannot test the change asks the owner rather than looping.
      if (input.gate === 'unreachable') {
        return { ...at(last, path, [{ leg: 'run-tests', state: 'waiting', waiting_on: 'owner' }]), decisions: [unreachableDecision(input.unreachable, input.url ?? fact.url ?? null)] };
      }
      if (input.gate === 'open') return at(last, path, [{ leg: 'run-tests', state: 'ready', waiting_on: null }]);
      if (input.gate === 'red') return at(last, path, [{ leg: bounds.back, state: 'ready', waiting_on: null }]);
    }
    return at(last, path, [{ leg: 'review', state: wait ? 'waiting' : 'ready', waiting_on: wait }]);
  }
  if (verdictOf(verdictsOf(fact).at(-1)!) === 'approve') return at('reviewed', path, [{ leg: 'merge', state: 'ready', waiting_on: null }]);
  // Changes requested: the back leg (`fix`, `address`), until the course's rounds run out; then
  // adjudicate, or merge waiting on the owner (listed under Needs you, §14) on a course with no
  // adjudicate leg. `pending`: the back leg's last claim ended and its work has not landed yet —
  // the owner's conversation (`create-spec`'s `address`) is under way — so the leg waits on the
  // `owner` rather than being offered again on every sync.
  if (spent) {
    if (!bounds.adjudicates) return at('reviewed', path, [{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }]);
    // The third round's blockers are the owner's (B-110): no agent reproduces anything — the
    // third pair of eyes is the person's. `adjudicate` waits on them, and the decision posted
    // (R-BTN-78) carries their question and the PR holding the blockers to Needs you, answered
    // through Baton (`baton owner resolve <repository> <ticket> review-rounds-<n> merge|owner|round`).
    // A course without the gate keeps its own adjudicate: a fresh reader, ready as before.
    if (!bounds.gate) return at('reviewed', path, [{ leg: 'adjudicate', state: 'ready', waiting_on: null }]);
    return { ...at('reviewed', path, [{ leg: 'adjudicate', state: 'waiting', waiting_on: 'owner' }]), decisions: [roundsDecision(rounds, input.url ?? fact.url ?? null)] };
  }
  if (pending) return at('reviewed', path, [{ leg: bounds.back, state: 'waiting', waiting_on: 'owner' }]);
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
export function stationsPr(ctx: { tickets: SourceTicket[]; facts: PrFact[]; branchPatterns?: string[]; closed: Set<string>; done?: Set<string>; repository?: string | null; graph?: PrGraph; baton?: BatonRecord }): StationsResult {
  const graph = ctx.graph ?? {};
  const stations: Record<string, PostedStation> = {};
  const patterns = matchPatterns(ctx.branchPatterns);
  const markers: StationsResult['markers'] = [];
  const bounds = boundsOf(graph);
  const record = ctx.baton?.legs ?? [];
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
    if (!bounds.gate) {
      stations[t.id] = placeOf(together(mine), graph, bounds);
      continue;
    }
    // The gate (B-110): each PR's markers count only as the evidence Baton recorded for a
    // run-tests leg of this ticket (the claim's nonce and its advance's evidence sha, read with
    // the sync's observation) — a pusher can write any trailer, not Baton's record. A counted
    // marker changes no tree, so it is no push; every other commit is one, a forged marker
    // included. The gate's state is read by commit order from the tested head the marker names.
    const counted = new Map(mine.map((f) => [f, f.commits ? verifiedMarkers(f.commits, t.id, record) : []] as const));
    const facts = mine.map((f) => {
      if (!f.commits) return f;
      const skip = new Set(counted.get(f)!.map((m) => m.sha));
      const pushes = f.commits.filter((c) => !skip.has(c.sha)).map((c) => c.at);
      return { ...f, pushes, pushedAt: Math.max(0, ...pushes) };
    });
    const mineAnswers = (ctx.baton?.answers ?? []).filter((a) => a.ticket === t.id);
    const answers = new Map(mineAnswers.map((a) => [a.decision, a.answer] as const));
    const rounds = mineAnswers.filter((a) => /^review-rounds-\d+$/.test(a.decision) && a.answer === 'round' && typeof a.answered_at === 'number').map((a) => a.answered_at!);
    const open = mine.filter((f) => f.state === 'open');
    // The stub tests the home repository's one PR branch; a PR elsewhere, or several at home,
    // is one it cannot test — the owner is asked (`skip` waives the gate) rather than the gate
    // looping to its budget with no marker any PR reads (round 1, finding 2).
    const home = open.filter((f) => f.repository == null || ctx.repository == null || sameRepo(f.repository, ctx.repository));
    const unreachable = home.length === open.length && home.length <= 1 ? [] : open.map((f) => `${f.repository ?? ctx.repository ?? 'the home repository'}#${f.number}`);
    const gate: PlaceInput['gate'] = answers.get(UNREACHABLE) === 'skip' ? 'green'
      : unreachable.length ? 'unreachable'
        : home.length === 0 ? 'green'
          : home[0].commits ? gateOfBranch(home[0].commits, counted.get(home[0])!) : 'open';
    // The PR the owner reads: the newest open one with a verdict asking for changes, else the
    // first open one.
    const withChanges = open.filter((f) => f.reviews.some((r) => verdictOf(r) === 'changes'));
    const url = (withChanges.at(-1) ?? open[0] ?? mine[0]).url ?? null;
    stations[t.id] = placeOf(together(facts), graph, bounds, false, {
      gate, markers: [...counted.values()].flat().sort((a, b) => a.at - b.at), answers, rounds, url, unreachable,
    });
    // The gate's counted markers: evidence in git (R-BTN-46), each ref a sha Baton recorded and
    // its nonce the claim's — the sync's placement input beside the pushes, never the counter.
    for (const m of [...counted.values()].flat()) markers.push({ ticket: t.id, leg: 'run-tests', ref: m.sha, claim_nonce: m.claim });
  }
  return { stations, markers, course_data: {} };
}

/** The `create-spec` course's stations (R-BTN-131, B-96): a specification's PR is a branch-pattern
 *  PR like any other, so an open or merged one is placed by `create-pr`'s own walk (`placeOf` with
 *  this course's leg names: `converse` opened the PR at `spec-open`, `address` takes a round's
 *  findings to the owner and a push back to `spec-open`, a `changes` verdict queues `address`
 *  until three rounds are spent and then `adjudicate`, and an `approve` queues `merge`).
 *
 *  Both interactive legs are the owner's session, which Baton neither runs nor waits for inside a
 *  claim; each one's `close` commits a marker line (R-BTN-83, `prClose`) — `{ticket, leg:
 *  'converse', reached: 'requested'}` when the design conversation begins, `{ticket, leg:
 *  'address', reached: 'reviewed'}` when an address round ends in the owner's hands. Both are
 *  signals, never steps: no posted path ever carries them, so the board sees no path off the graph
 *  (§2e) and the ticket's path stays where the PR facts put it.
 *
 *  A ticket with no PR has not left `requested`, so:
 *  - no `converse` line, its `converse` is `ready` (a claim runs it: it prints the session's
 *    command and prompt and suspends; its close writes the line), a dependency still open or an
 *    open child holding it as `stationsPr` holds `implement` (`dependencies`, `children`); and
 *  - such a line, the ticket waits on the `owner` — the sync does not offer `converse` again
 *    while the line stands, so one conversation, not one per sync — until its PR lands and the
 *    next reading places it at `spec-open`.
 *
 *  An `address` round, once suspended, is the same: `placeOf` reads the ticket's `address` lines
 *  against its timeline's `address` steps, and one more line than steps means the last round's
 *  claim ended and its work has not landed — `address` waits on the `owner` until the push lands
 *  and the timeline's steps catch it up. */
export function stationsSpec(ctx: {
  tickets: SourceTicket[];
  facts: PrFact[];
  branchPatterns?: string[];
  closed: Set<string>;
  done?: Set<string>;
  repository?: string | null;
  graph?: PrGraph;
}): StationsResult {
  const graph = ctx.graph ?? {};
  const stations: Record<string, PostedStation> = {};
  const patterns = matchPatterns(ctx.branchPatterns);
  const done = ctx.done ?? ctx.closed;
  const bounds: PrBounds = {
    legs: SPEC_BOUNDS.legs, back: SPEC_BOUNDS.back,
    rounds: graph.legs?.review?.max_runs ?? SPEC_BOUNDS.rounds, adjudicates: graph.legs?.adjudicate != null,
    gate: false,
  };
  // A malformed close is the history fold's to skip, never this function's.
  const marks = specMarkersOf(ctx.tickets);
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    // A closed unmerged PR counts as none — the same reading as `stationsPr`, and the rule that
    // takes a conversation's PR closed unmerged back to `requested`: the line still says the
    // conversation ran, so such a ticket waits on the owner until its spec lands; an `address` PR
    // so closed leaves the ticket waiting on the owner at its round, exactly as before the close
    // (closing the PR is not an answer the board can read; the owner re-files or reopens).
    const mine = ctx.facts.filter((f) => f.state !== 'closed' && ticketOwns(t, f, patterns, ctx.repository));
    if (!mine.length) {
      const waiting = t.depends_on.filter((d) => !done.has(d));
      const blocked = waiting.length ? 'dependencies' : t.blocked_by.length ? 'children' : null;
      // A blocked start is `waiting` whatever the conversation did; an unblocked one that has
      // begun waits on the owner in the session; one that has not is ready for its claim. The
      // path stays empty: `converse`'s only outcome is `spec-open`, which no PR has reached.
      const wait = blocked ?? (marks.conversed.has(t.id) ? 'owner' : null);
      stations[t.id] = at('requested', [], [{ leg: 'converse', state: wait ? 'waiting' : 'ready', waiting_on: wait }]);
      continue;
    }
    const fact = together(mine);
    const path = timelineOf(fact, bounds.legs);
    // A suspended address round: the leg's lines outrun the timeline's address steps — the push
    // that lands the round's work is the next `address` step, and until it appears the round's
    // claim has ended with its evidence not on the PR.
    const pending = (marks.addressed.get(t.id) ?? 0) > backRunsOf(path, bounds.legs);
    stations[t.id] = placeOf(fact, graph, bounds, pending);
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
