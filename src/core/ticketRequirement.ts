export type TicketRequirement = { at: string[] } | { reached: string[] } | { done: true } | { withdrawn: true } | { closed: true };
export type PostedDependency = TicketRequirement & { ticket: string; leg?: string };
export type TicketSelector = TicketRequirement & {
  select: 'parent' | 'posted'; course?: string; skip_withdrawn?: boolean; allow_empty?: boolean;
};

const predicates = ['at', 'reached', 'done', 'withdrawn', 'closed'] as const;

export function requirementOf(entry: Record<string, unknown>, stationId: RegExp): TicketRequirement | null {
  const keys = predicates.filter((k) => Object.hasOwn(entry, k));
  if (keys.length !== 1) return null;
  const k = keys[0];
  const value = entry[k];
  if (k === 'at' || k === 'reached') {
    if (!Array.isArray(value) || !value.length || value.length > 100 || !value.every((s) => typeof s === 'string' && stationId.test(s))) return null;
  } else if (value !== true) return null;
  return { [k]: value } as TicketRequirement;
}

export const requirementKeys: readonly string[] = predicates;
