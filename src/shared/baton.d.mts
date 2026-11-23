interface Families { families: Record<string, readonly string[]> }
interface Seat { agent: string; from?: string | null; until?: string | null }
interface Row { author: string; a: readonly Seat[]; b: readonly Seat[] }
interface Matrix extends Families { rows: readonly Row[] }
interface Agent { reviews_on: string; bills: readonly string[]; models?: Record<string, string>; cost: number }
interface Suspension { provider_id: string; model_id?: string | null; starts_at: number; ends_at?: number | null; lifted_at?: number | null }
interface Claim { status: string; confirmed_at?: number | null; fence_pending?: boolean | number }
interface Runner {
  tier_ceiling?: string | null;
  declared?: readonly string[] | null;
  derived?: readonly string[] | null;
  model_id?: string | null;
  model_provider_id?: string | null;
  billing?: Record<string, string> | null;
  courses?: readonly { repository: string; course: string; version: number }[];
}
interface Item { id: string; repository: string; course: string; tier?: string | null; requires?: readonly string[] | null; expedite?: boolean }
type ReviewMatrix = Matrix & { agents: Record<string, Agent> };
type ReviewContext =
  | { lastEndReason?: null; matrix?: ReviewMatrix }
  // An arbitrary reason can select the legacy review-capacity path, which needs a matrix.
  | { lastEndReason: string | null; matrix: ReviewMatrix };
type Context = ReviewContext & {
  now?: number;
  claims?: readonly Claim[];
  override?: { hold?: boolean | number; retry_after?: number | null } | null;
  suspensions?: readonly Suspension[];
  minRunnerVersion?: number;
  expediteActive?: number;
  expediteBound?: number;
  authorFamilies?: readonly (string | null)[];
  catalog?: Record<string, Agent>;
  tiers?: readonly string[];
};
export const RULE_CODES: Readonly<Record<2 | 3 | 4 | 5 | 7 | 8 | 9 | 10, string>>;
type Refusal = { rule: keyof typeof RULE_CODES; code: string };
export function batonNow(): number;
export function setTestClock(fn: (() => number) | null): void;
export function familyOf(modelId: string | null | undefined, matrix: Families): string | null;
export function seatOn(seat: readonly Seat[] | null | undefined, day: string): string | null;
export function resolveFamily(name: string | null | undefined, matrix: Families): string | null | undefined;
export function rowFor(family: string | null, matrix: Matrix): Row | undefined;
export function seatedOn(day: string, matrix: Matrix): Set<string>;
export function suspended(suspensions: readonly Suspension[] | null | undefined, providerId: string | null | undefined, modelId: string | null | undefined, now: number): boolean;
export function qualifyingPair(authorFamilies: readonly (string | null)[] | null, billing: Record<string, string> | null | undefined, suspensions: readonly Suspension[] | null | undefined, date: string | number, catalog: Record<string, Agent>, matrix: Matrix): {
  a: string; b: string; substituted: { seat: 'a' | 'b'; for: string | null; agent: string }[];
} | null;
export function claimBlocks(claim: Claim): boolean;
export function isEligible(runner: Runner, item: Item, context: Context): { ok: true } | ({ ok: false } & Refusal);
export function firstEligible<T extends Item>(runner: Runner, ranked: Iterable<T>, contextFor: (item: T) => Context): { item: T | null; refusals: ({ id: string } & Refusal)[] };
