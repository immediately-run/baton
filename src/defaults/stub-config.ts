// Serializable configuration for a standalone standard-course leg (R-BTN-131).
export const OVERRIDE_SUFFIX = '.run.mjs';

interface Position {
  reached: string;
  next: string | null;
  suspend?: true;
}

type AnswerPosition = Position & { atRun?: { min: number | 'review-limit'; position: Position } };

export type AgentLeg = {
  tests?: never;
  verify?: 'pr' | 'merged';
  pushes?: 'after-red';
  delivered?: true;
} & (
  | { ask?: never; position: Position }
  | { ask: { name: 'verdict' | 'adjudication' | 'outcome'; values: string[] }; positions: Record<string, AnswerPosition> }
);

export type LegStub = AgentLeg | { tests: true; ask?: never; delivered?: never; verify?: never };

export interface StubConfig {
  course: string;
  leg: string;
  reads: 'prs' | 'markers';
  overridePath: string;
  spec: LegStub;
}

/** The answer has already been checked by requireAnswer; a missing route is a course error. */
export function positionOf(spec: AgentLeg, answer?: string, run = 1, reviewLimit = Infinity): Position & { verdict?: string; adjudication?: string } {
  if (!spec.ask) return spec.position;
  const route = answer == null ? undefined : spec.positions[answer];
  if (!route) throw new Error(`no position for ${spec.ask.name} ${JSON.stringify(answer)}`);
  const { atRun, ...position } = route;
  return { ...(atRun && run >= (atRun.min === 'review-limit' ? reviewLimit : atRun.min) ? atRun.position : position), ...(spec.ask.name !== 'outcome' ? { [spec.ask.name]: answer } : {}) };
}
