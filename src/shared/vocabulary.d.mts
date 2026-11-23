export const CAPABILITIES: readonly string[];
export const ROLES: Readonly<Record<string, readonly string[]>>;
export const RESOURCES: readonly string[];
export const CLAUSE_NAMES: readonly string[];
export const AGENT_HOLDS: ReadonlySet<string>;
export const TIERS: readonly string[];
export function fitsTier(itemTier: string | null | undefined, ceiling: string, ladder?: readonly string[]): boolean;
export function capabilitiesOf(declared?: Iterable<string> | null): Set<string>;
