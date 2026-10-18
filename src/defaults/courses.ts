// courses.ts — the registry of Baton's standard courses (BATON_SPEC R-BTN-131): each built-in
// course the CLI can scaffold (`baton repo init --course <id>`) and place without a `sync.mjs` —
// its course file, the facts its station function reads, how each leg's stub turns the agent's
// answer into a position, and the Markdown instructions shipped for each leg. One table, so a
// course is added in one place. Course code in the CLI, never core (§2b).
import { CREATE_PR_COURSE, REVIEW_PR_COURSE, stationsPr, stationsReviewPr, type PrFact, type PrGraph, type StationsResult } from './course-pr';
import { stationsMarkers, type CourseGraph, type Marker } from './course-markers';
import type { SourceTicket } from './tickets-markdown';

/** What a station function is handed (R-BTN-74's ctx), with the facts its course reads. */
export interface StationCtx {
  tickets: SourceTicket[];
  closed: Set<string>;
  done: Set<string>;
  facts: PrFact[];
  markers: Marker[];
  branchPatterns: string[];
  repository: string | null;
  /** The course file as the checkout has it: the bounds the function reads. */
  graph: Record<string, unknown>;
}

/** What a leg's agent must print as its last line, when the leg's result depends on it: the
 * name the result carries it under and the values it may take. */
export interface Ask {
  name: 'verdict' | 'adjudication' | 'outcome';
  values: string[];
}

/** One leg's stub: what it asks the agent for, and the position it returns — a JavaScript
 * expression over `answer` (the agent's last line, checked against `ask.values`). A position
 * whose next leg waits on someone outside the claim (the owner, the PR's author) carries
 * `suspend: true`: the runner closes the leg and ends the claim there, rather than starting a
 * next leg on a board that cannot yet show the wait (§6.13). */
export interface LegStub {
  ask?: Ask;
  position: string;
}

export interface BuiltIn {
  id: string;
  /** One line for `baton repo init --help` and the docs. */
  summary: string;
  /** The course file `init` writes (R-BTN-69). */
  course: Record<string, any>;
  /** The facts the station function reads: the forge's PRs, or the closing markers in git. */
  reads: 'prs' | 'markers';
  stations: (ctx: StationCtx) => StationsResult;
  legs: Record<string, LegStub>;
  /** The skill a `courses` entry names (R-BTN-51). */
  skill: string;
}

/** The `bug-report` course (R-BTN-131), from the docs `bug-report` skill: trace a reported
 * symptom to its cause and the artifact that seeded it, dedupe against the tickets by cause, file
 * a fix ticket (or fold the report into the ticket that already covers the cause), then weigh
 * prevention. It opens no PR: each leg commits to the default branch. */
export const BUG_REPORT_COURSE = {
  start: 'reported',
  start_leg: 'trace',
  end: ['closed'],
  stations: {
    reported: { label: 'Reported' }, traced: { label: 'Cause found' }, explained: { label: 'Origin traced' },
    'new-cause': { label: 'Not a duplicate' }, duplicate: { label: 'Duplicate of an open ticket' },
    ticketed: { label: 'Fix ticket filed' }, folded: { label: 'Folded into the existing ticket' }, closed: { label: 'Prevention weighed' },
  },
  legs: {
    trace: { from: ['reported'], to: 'traced', label: 'Trace the symptom to a cause' },
    origin: { from: ['traced'], to: 'explained', label: 'Trace the cause to its origin' },
    dedupe: { from: ['explained'], to: ['new-cause', 'duplicate'], label: 'Dedupe by cause' },
    file: { from: ['new-cause'], to: 'ticketed', label: 'File the fix ticket' },
    fold: { from: ['duplicate'], to: 'folded', label: 'Fold into the existing ticket' },
    prevent: { from: ['ticketed', 'folded'], to: 'closed', label: 'Weigh prevention' },
  },
};

/** The `draft-ticket` course (R-BTN-131), from the docs `draft-roadmap-item` skill: research
 * what the ticket will touch, draft a ticket that prescribes the architecture, the tests and what
 * it requires, then check it against the checklist and file it — splitting verification and
 * operator work into tickets of their own. It opens no PR. */
export const DRAFT_TICKET_COURSE = {
  start: 'requested',
  start_leg: 'research',
  end: ['filed'],
  stations: { requested: { label: 'Requested' }, researched: { label: 'Researched' }, drafted: { label: 'Drafted' }, filed: { label: 'Filed' } },
  legs: {
    research: { from: ['requested'], to: 'researched', label: 'Read the code and the sources' },
    draft: { from: ['researched'], to: 'drafted', label: 'Write the ticket' },
    check: { from: ['drafted'], to: 'filed', label: 'Check it, split it, file it' },
  },
};

/** The `decision` course (R-BTN-131), from the docs `prepare-decision-packet` and
 * `process-decision-packets` skills: a question only the owner can settle becomes a one-letter
 * packet in the ticket; the owner answers by setting the ticket's `answer:`; a worker carries the
 * answer out. Until person legs (R-BTN-116) are built, the owner's answer is a wait on the
 * `owner`, not a leg. It opens no PR. */
export const DECISION_COURSE = {
  start: 'raised',
  start_leg: 'prepare',
  end: ['decided'],
  stations: { raised: { label: 'Raised' }, asked: { label: 'Waiting on the owner' }, decided: { label: 'Answer carried out' } },
  legs: {
    prepare: { from: ['raised'], to: 'asked', label: 'Write the decision packet' },
    'carry-out': { from: ['asked'], to: 'decided', label: 'Carry the answer out' },
  },
};

/** The owner's answer to a decision ticket: its `answer:` field, once it is anything but `open`. */
export const answered = (t: SourceTicket): boolean => {
  const a = (t.course as { answer?: unknown } | undefined)?.answer;
  return typeof a === 'string' && a.trim() !== '' && a.trim().toLowerCase() !== 'open';
};

const markers = (waits?: (t: SourceTicket, leg: string) => string | null) => (ctx: StationCtx): StationsResult =>
  stationsMarkers({ tickets: ctx.tickets, closed: ctx.closed, done: ctx.done, graph: ctx.graph as unknown as CourseGraph, markers: ctx.markers, waits });

/** The verdict a review stub asks for, written by `close` as the verdict line. */
const VERDICT: Ask = { name: 'verdict', values: ['approve', 'changes'] };

const CREATE_PR: BuiltIn = {
  id: 'create-pr',
  summary: 'implement a ticket in a PR, review it in up to three blind rounds, fix, adjudicate what stays open, merge',
  course: CREATE_PR_COURSE,
  reads: 'prs',
  stations: (ctx) => stationsPr({ tickets: ctx.tickets, facts: ctx.facts, closed: ctx.closed, done: ctx.done, branchPatterns: ctx.branchPatterns, repository: ctx.repository, graph: ctx.graph as PrGraph }),
  legs: {
    implement: { position: "{ reached: 'pr-open', next: 'review' }" },
    // The verdict decides what the review queues: merge for approve, fix for changes (once the
    // fixes run out the sync queues adjudicate instead, and a refused fix suspends the claim).
    review: { ask: VERDICT, position: "{ reached: 'reviewed', next: answer === 'approve' ? 'merge' : 'fix', verdict: answer }" },
    fix: { position: "{ reached: 'fixed', next: 'review' }" },
    // `merge`: no open blocking finding reproduced; `owner`: one did, and the owner decides —
    // the claim suspends until they do.
    adjudicate: { ask: { name: 'adjudication', values: ['merge', 'owner'] }, position: "{ ...(answer === 'owner' ? { suspend: true } : {}), reached: 'adjudicated', next: 'merge', adjudication: answer }" },
    merge: { position: "{ reached: 'merged', next: null }" },
  },
  skill: 'baton-create-pr',
};

export const BUILT_INS: BuiltIn[] = [
  CREATE_PR,
  {
    id: 'review-pr',
    summary: "review a PR someone else opened, in rounds, and conclude with a summary",
    course: REVIEW_PR_COURSE,
    reads: 'prs',
    stations: (ctx) => stationsReviewPr({ tickets: ctx.tickets, facts: ctx.facts, closed: ctx.closed, done: ctx.done, repository: ctx.repository, graph: ctx.graph as PrGraph }),
    legs: {
      // Changes: the next round waits on the author's push, so the claim suspends.
      review: { ask: VERDICT, position: "{ ...(answer === 'approve' ? {} : { suspend: true }), reached: answer === 'approve' ? 'approved' : 'changes-requested', next: answer === 'approve' ? null : 'review', verdict: answer }" },
      conclude: { position: "{ reached: 'concluded', next: null }" },
    },
    skill: 'baton-review-pr',
  },
  {
    id: 'bug-report',
    summary: 'trace a reported bug to its cause and origin, dedupe it by cause, file the fix ticket, weigh prevention',
    course: BUG_REPORT_COURSE,
    reads: 'markers',
    stations: markers(),
    legs: {
      trace: { position: "{ reached: 'traced', next: 'origin' }" },
      origin: { position: "{ reached: 'explained', next: 'dedupe' }" },
      dedupe: { ask: { name: 'outcome', values: ['new-cause', 'duplicate'] }, position: "{ reached: answer, next: answer === 'duplicate' ? 'fold' : 'file' }" },
      file: { position: "{ reached: 'ticketed', next: 'prevent' }" },
      fold: { position: "{ reached: 'folded', next: 'prevent' }" },
      prevent: { position: "{ reached: 'closed', next: null }" },
    },
    skill: 'baton-bug-report',
  },
  {
    id: 'draft-ticket',
    summary: 'research, draft and file a ticket that prescribes its architecture, tests and requirements',
    course: DRAFT_TICKET_COURSE,
    reads: 'markers',
    stations: markers(),
    legs: {
      research: { position: "{ reached: 'researched', next: 'draft' }" },
      draft: { position: "{ reached: 'drafted', next: 'check' }" },
      check: { position: "{ reached: 'filed', next: null }" },
    },
    skill: 'baton-draft-ticket',
  },
  {
    id: 'decision',
    summary: "turn a question only the owner can settle into a one-letter packet, then carry the answer out",
    course: DECISION_COURSE,
    reads: 'markers',
    // `carry-out` waits on the owner until the ticket's `answer:` is set.
    stations: markers((t, leg) => (leg === 'carry-out' && !answered(t) ? 'owner' : null)),
    legs: {
      // The packet is written; carry-out waits on the owner's answer, so the claim suspends.
      prepare: { position: "{ suspend: true, reached: 'asked', next: 'carry-out' }" },
      'carry-out': { position: "{ reached: 'decided', next: null }" },
    },
    skill: 'baton-decision',
  },
];

/** The course a built-in replaced, still placed for a repository scaffolded before: `pr`, whose
 * own course file (review 4, fix 3, no adjudicate) the `create-pr` station function reads. It is
 * no longer scaffolded: `baton repo init --course pr` names `create-pr`. */
const REPLACED: Record<string, string> = { pr: 'create-pr' };

/** The built-in a course id names, a replaced name included; undefined for any other id. */
export function builtIn(id: string): BuiltIn | undefined {
  const name = REPLACED[id] ?? id;
  return BUILT_INS.find((b) => b.id === name);
}

/** The id `init` scaffolds for `--course <id>`, or a refusal naming the choices. */
export function scaffoldable(id: string): BuiltIn {
  if (REPLACED[id]) throw new Error(`--course ${id}: renamed ${REPLACED[id]} — run \`baton repo init --course ${REPLACED[id]}\``);
  const b = BUILT_INS.find((x) => x.id === id);
  if (!b) throw new Error(`--course ${id}: the CLI scaffolds ${BUILT_INS.map((x) => x.id).join(', ')}; write .baton/courses/${id}/ yourself`);
  return b;
}

/** The course every repository gets when it names none. */
export const DEFAULT_COURSE = CREATE_PR.id;
