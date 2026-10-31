// courses.ts — the registry of Baton's standard courses (BATON_SPEC R-BTN-131): each built-in
// course the CLI can scaffold (`baton repo init --course <id>`) and place without a `sync.mjs` —
// its course file, the facts its station function reads, how each leg's stub turns the agent's
// answer into a position, and the Markdown instructions shipped for each leg. One table, so a
// course is added in one place. Course code in the CLI, never core (§2b).
import { CREATE_PR_COURSE, CREATE_SPEC_COURSE, REVIEW_PR_COURSE, stationsPr, stationsReviewPr, stationsSpec, type PrFact, type PrGraph, type StationsResult } from './course-pr';
import { stationsTickets, type CourseGraph } from './ticket-state';
import type { SourceTicket } from './tickets-markdown';

/** What a station function is handed (R-BTN-74's ctx), with the facts its course reads. The
 * marker courses read no second input (B-100): each ticket carries its own record — the closes
 * its git history holds and its frontmatter's machine state — on its opaque `course` blob. */
export interface StationCtx {
  tickets: SourceTicket[];
  closed: Set<string>;
  done: Set<string>;
  facts: PrFact[];
  branchPatterns: string[];
  repository: string | null;
  /** The course file as the checkout has it: the bounds the function reads. */
  graph: Record<string, unknown>;
}

/** What a leg's agent must print as its last line, when the leg's result depends on it: the
 * name the result carries it under and the values it may take. The stub reads the last line that
 * opens with one of `values`, backwards past any prose after it (B-85, `answer.ts`). */
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
  /** The stub verifies its outcome on the forge before returning its position (B-81): an open
   * PR on a branch the course's patterns map to the ticket, its head what the checkout pushed.
   * The agent's exit 0 is not the leg's outcome. */
  verify?: 'pr';
}

export interface BuiltIn {
  id: string;
  /** One line for `baton repo init --help` and the docs. */
  summary: string;
  /** The course file `init` writes (R-BTN-69). */
  course: Record<string, any>;
  /** The facts the station function reads: the forge's PRs, or the closing markers in git. */
  reads: 'prs' | 'markers';
  /** B-101: this course carries the review-rounds file protocol — the review close commits each
   *  round to the PR branch as `.baton/reviews/<round>.md`, the fix/address close its replies
   *  beside it, and the merge leg clears the directory before its agent merges, so the squash
   *  lands none of it. The courses whose rounds run through Baton's own legs (`create-pr`,
   *  `create-spec`); not `review-pr`, whose PR is someone else's and whose rounds stay in the
   *  conversation. */
  review_files?: true;
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

/** The `spec-to-tickets` course (R-BTN-131, B-99): a merged specification decomposes into its
 * child tickets. Entered by `baton request` (`starts_from: request`, B-98) — the sentence names
 * the spec. `decompose` drafts one ticket per spec section or decision into the request,
 * `check` holds the set against the spec's coverage, and `file` commits the children `parent:`-ed
 * to the request and closes it done. The owner deciding against filing withdraws the request —
 * a ticket status, not a course station. It opens no PR. */
export const SPEC_TO_TICKETS_COURSE = {
  start: 'reading',
  start_leg: 'decompose',
  end: ['filed'],
  // B-98: entered by `baton request "<one sentence naming the spec>"`, like create-spec and build-app.
  starts_from: 'request',
  stations: {
    reading: { label: 'Reading the spec' }, drafted: { label: 'Child tickets drafted' },
    checked: { label: 'Set checked against the spec' }, filed: { label: 'Children filed' },
  },
  legs: {
    decompose: { from: ['reading'], to: 'drafted', label: 'Draft one child ticket per spec section' },
    check: { from: ['drafted'], to: 'checked', label: 'Check the set against the spec' },
    file: { from: ['checked'], to: 'filed', label: 'File the children, close the request' },
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

/** The `build-app` course (R-BTN-131, B-40, B-98): an application from a one-line request to a
 * verified build — `starts_from: request`, so `baton request` files it. Four drafting legs each
 * write one document under `product/` and leave it to the
 * owner, who refines it in a conversation of their own and approves it; `file` turns the approved
 * plan into child tickets (R-BTN-86) on `create-pr`; `verify` waits on them, tests the build
 * against the product definition's acceptance criteria, and files fix tickets for what fails. It
 * opens no PR of its own. Until interactive legs are built (B-34), the conversation is the
 * owner's own session, and the approval is the ticket's `answer:` (`APPROVAL_STAGES`). */
export const BUILD_APP_COURSE = {
  start: 'requested',
  start_leg: 'define',
  end: ['shipped'],
  // B-98: its request pattern, made a command's.
  starts_from: 'request',
  stations: {
    requested: { label: 'Requested' }, defined: { label: 'Product definition drafted' }, designed: { label: 'Interface designed' },
    architected: { label: 'Architecture drafted' }, planned: { label: 'Plan drafted' }, building: { label: 'Tickets filed, being built' },
    shipped: { label: 'Verified against the definition' },
  },
  legs: {
    define: { from: ['requested'], to: 'defined', label: 'Draft the product definition' },
    design: { from: ['defined'], to: 'designed', label: 'Design the interface and mock it up' },
    architect: { from: ['designed'], to: 'architected', label: 'Decide the architecture and operations' },
    plan: { from: ['architected'], to: 'planned', label: 'Plan the tickets' },
    file: { from: ['planned'], to: 'building', label: 'File the planned tickets' },
    verify: { from: ['building'], to: ['shipped', 'building'], max_runs: 3, label: 'Verify the build, file fixes' },
  },
};

/** The documents the owner approves, in order. A `build-app` ticket's `answer:` names the last
 * one approved, so each approval opens the next leg and an earlier name holds it. */
export const APPROVAL_STAGES = ['define', 'design', 'architect', 'plan'];

/** The approval each `build-app` leg waits on: the stage whose document it builds on. */
const BUILD_APP_GATES: Record<string, string> = { design: 'define', architect: 'design', plan: 'architect', file: 'plan' };

/** What a `build-app` leg waits on: the owner, until the ticket's `answer:` approves the document
 * it builds on; for `verify`, the open children `file` and earlier verifications filed. */
export const buildAppWaits = (t: SourceTicket, leg: string): string | null => {
  if (leg === 'verify') return t.blocked_by.length ? 'children' : null;
  const gate = BUILD_APP_GATES[leg];
  if (gate == null) return null;
  const a = (t.course as { answer?: unknown } | undefined)?.answer;
  const approved = typeof a === 'string' ? APPROVAL_STAGES.indexOf(a.trim().toLowerCase()) : -1;
  return approved >= APPROVAL_STAGES.indexOf(gate) ? null : 'owner';
};

/** The owner's answer to a decision ticket: its `answer:` field, once it is anything but `open`. */
export const answered = (t: SourceTicket): boolean => {
  const a = (t.course as { answer?: unknown } | undefined)?.answer;
  return typeof a === 'string' && a.trim() !== '' && a.trim().toLowerCase() !== 'open';
};

const ticketStations = (waits?: (t: SourceTicket, leg: string) => string | null) => (ctx: StationCtx): StationsResult =>
  stationsTickets({ tickets: ctx.tickets, closed: ctx.closed, done: ctx.done, graph: ctx.graph as unknown as CourseGraph, waits });

/** The verdict a review stub asks for, written by `close` as the verdict line. */
const VERDICT: Ask = { name: 'verdict', values: ['approve', 'changes'] };

const CREATE_PR: BuiltIn = {
  id: 'create-pr',
  summary: 'implement a ticket in a PR, review it in up to three blind rounds, fix, adjudicate what stays open, merge',
  course: CREATE_PR_COURSE,
  reads: 'prs',
  review_files: true,
  stations: (ctx) => stationsPr({ tickets: ctx.tickets, facts: ctx.facts, closed: ctx.closed, done: ctx.done, branchPatterns: ctx.branchPatterns, repository: ctx.repository, graph: ctx.graph as PrGraph }),
  legs: {
    // B-81: the stub verifies its PR on the forge (open, on a branch the patterns map to this
    // ticket, its head pushed) before returning pr-open — never the agent's exit code alone.
    implement: { position: "{ reached: 'pr-open', next: 'review' }", verify: 'pr' },
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
    stations: ticketStations(),
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
    stations: ticketStations(),
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
    stations: ticketStations((t, leg) => (leg === 'carry-out' && !answered(t) ? 'owner' : null)),
    legs: {
      // The packet is written; carry-out waits on the owner's answer, so the claim suspends.
      prepare: { position: "{ suspend: true, reached: 'asked', next: 'carry-out' }" },
      'carry-out': { position: "{ reached: 'decided', next: null }" },
    },
    skill: 'baton-decision',
  },
  {
    id: 'build-app',
    summary: 'define a product, design it, decide its architecture and plan it with the owner, file the tickets, verify the build',
    course: BUILD_APP_COURSE,
    reads: 'markers',
    stations: ticketStations(buildAppWaits),
    legs: {
      // Each drafted document waits on the owner's approval, so the claim suspends.
      define: { position: "{ suspend: true, reached: 'defined', next: 'design' }" },
      design: { position: "{ suspend: true, reached: 'designed', next: 'architect' }" },
      architect: { position: "{ suspend: true, reached: 'architected', next: 'plan' }" },
      plan: { position: "{ suspend: true, reached: 'planned', next: 'file' }" },
      // The filed tickets are children: verify waits on them.
      file: { position: "{ suspend: true, reached: 'building', next: 'verify' }" },
      // `building`: fix tickets were filed, and the next verification waits on them.
      verify: { ask: { name: 'outcome', values: ['shipped', 'building'] }, position: "{ ...(answer === 'building' ? { suspend: true } : {}), reached: answer, next: answer === 'shipped' ? null : 'verify' }" },
    },
    skill: 'baton-build-app',
  },
  {
    id: 'create-spec',
    summary: 'design a specification in conversation with the owner, review it adversarially, address blocking findings in conversation, merge',
    course: CREATE_SPEC_COURSE,
    reads: 'prs',
    review_files: true,
    stations: (ctx) => stationsSpec({ tickets: ctx.tickets, facts: ctx.facts, branchPatterns: ctx.branchPatterns, closed: ctx.closed, done: ctx.done, repository: ctx.repository, graph: ctx.graph as PrGraph }),
    legs: {
      // The design conversation is the owner's session, which Baton neither runs nor waits for:
      // the leg writes its marker at `requested`, ends the claim, and the ticket waits there —
      // on the owner, the sync reading the marker — until the conversation's work lands as a PR.
      converse: { position: "{ suspend: true, reached: 'requested', next: 'converse' }" },
      // The verdict decides what the review queues: merge for approve, address for changes (once
      // the address rounds run out the sync queues adjudicate instead, and a refused fix suspends).
      review: { ask: VERDICT, position: "{ reached: 'reviewed', next: answer === 'approve' ? 'merge' : 'address', verdict: answer }" },
      // The owner's second conversation: the findings are answered, suspended like `converse`.
      address: { position: "{ suspend: true, reached: 'reviewed', next: 'address' }" },
      // `merge`: no open blocking finding reproduced; `owner`: one did, and the owner decides —
      // the claim suspends until they do.
      adjudicate: { ask: { name: 'adjudication', values: ['merge', 'owner'] }, position: "{ ...(answer === 'owner' ? { suspend: true } : {}), reached: 'adjudicated', next: 'merge', adjudication: answer }" },
      merge: { position: "{ reached: 'merged', next: null }" },
    },
    skill: 'baton-create-spec',
  },
  {
    id: 'spec-to-tickets',
    summary: 'decompose a merged specification into child tickets, check the set against the spec, and file them',
    course: SPEC_TO_TICKETS_COURSE,
    reads: 'markers',
    stations: ticketStations(),
    legs: {
      decompose: { position: "{ reached: 'drafted', next: 'check' }" },
      check: { position: "{ reached: 'checked', next: 'file' }" },
      file: { position: "{ reached: 'filed', next: null }" },
    },
    skill: 'baton-spec-to-tickets',
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
