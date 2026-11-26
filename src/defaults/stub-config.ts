// Serializable configuration for a standalone standard-course leg (R-BTN-131).
export const OVERRIDE_SUFFIX = '.run.mjs';

interface Position {
  reached: string;
  next: string | null;
  suspend?: true;
}

type AnswerPosition = Position & { atRun?: { min: number | 'review-limit'; position: Position } };

/** One agent leg's stub: what it asks the agent for (its last line, B-85's `answer.ts`), and the
 * position it returns — one, or one per answer. A position whose next leg waits on someone
 * outside the claim (the owner, the PR's author) carries `suspend: true`: the runner closes the
 * leg and ends the claim there, rather than starting a next leg on a board that cannot yet show
 * the wait (§6.13). */
export type AgentLeg = {
  tests?: never;
  archive?: never;
  /** The stub verifies its outcome on the forge before returning its position (B-81): an open
   * PR on a branch the course's patterns map to the ticket, its head what the checkout pushed.
   * The agent's exit 0 is not the leg's outcome. `merged`: every PR of the ticket on such a
   * branch merged and none open (R-BTN-131) — a merge agent that exits 0 without merging fails
   * the leg rather than report `merged`. */
  verify?: 'pr' | 'merged';
  /** B-231: a leg that answers the gate's red — run from `pr-open` or `fixed` — must push. The
   *  stub reads the ticket's PR branch heads before and after the agent; unchanged, it fails the
   *  leg rather than report a fix of a tree the gate already tested red. */
  pushes?: 'after-red';
  /** B-257: the agent may answer that the ticket is already delivered — `delivered <sha>
   *  <evidence>` — instead of opening a PR. The stub checks each commit is on the default branch
   *  and returns the course's `delivered` station with the person leg `confirm` next, the
   *  evidence in the end's `detail`; a commit that is not there fails the leg. Only beside
   *  `verify: 'pr'`, whose forge read it replaces. */
  delivered?: true;
} & (
  | { ask?: never; reconcile?: never; position: Position }
  | { ask: { name: 'verdict' | 'adjudication' | 'outcome'; values: string[] }; reconcile?: never; positions: Record<string, AnswerPosition> }
  /** B-311: the reconcile leg. The agent reads the claim's context (its station, the displaced
   *  leg, the evidence) appended to its instructions, and its answer — `unchanged …`, or the PR
   *  it moved the ticket onto — is checked on the forge (`reconcileAnswer`) and returned as the
   *  position; the close writes nothing. */
  | { ask?: never; reconcile: true; position?: never }
);

/** B-110's `tests: true` is a stub of another kind: it runs no agent at all. The stub runs the
 * course's deterministic test script itself (`npm run <test_script>`, the course file's field,
 * default `test`) on the PR branch's fetched head in a scratch worktree, green advancing to
 * `review` and red to `fix` — the gate's outcome never depends on a model (R-BTN-131, the owner,
 * 2026-10-24); its close pushes the gate's marker on the tested head (`testsClose`). */
export type LegStub = AgentLeg | ArchiveLeg | { tests: true; ask?: never; delivered?: never; verify?: never; archive?: never; reconcile?: never };

/** B-258: archive in close, from Baton's recorded answer and delivery evidence, without an
 *  agent: `run` returns the position, `close` is `archiveClose`. */
export type ArchiveLeg = { archive: true; position: Position; tests?: never; ask?: never; delivered?: never; verify?: never; pushes?: never; reconcile?: never };

export interface StubConfig {
  course: string;
  leg: string;
  reads: 'prs' | 'markers';
  overridePath: string;
  spec: LegStub;
  /** B-139: what a sourced course's run reads with no course copy in the home — the shipped
   *  instructions for the leg (null when this release ships none), the review leg's bound and
   *  the course's test script. */
  shipped: { instructions: string | null; reviewMaxRuns?: number; testScript?: string };
}

/** The answer has already been checked by requireAnswer; a missing route is a course error. */
export function positionOf(spec: AgentLeg | ArchiveLeg, answer?: string, run = 1, reviewLimit = Infinity): Position & { verdict?: string; adjudication?: string } {
  if (spec.reconcile) throw new Error('a reconcile leg\'s position is its checked answer, not a static one');
  if (!spec.ask) return spec.position;
  const route = answer == null ? undefined : spec.positions[answer];
  if (!route) throw new Error(`no position for ${spec.ask.name} ${JSON.stringify(answer)}`);
  const { atRun, ...position } = route;
  return { ...(atRun && run >= (atRun.min === 'review-limit' ? reviewLimit : atRun.min) ? atRun.position : position), ...(spec.ask.name !== 'outcome' ? { [spec.ask.name]: answer } : {}) };
}
