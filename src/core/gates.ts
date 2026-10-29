// gates.ts — what stays a gate (BATON_SPEC §7.2, R-BTN-45): the rules refused at a claim and at an
// advance whatever the worker decides, in one pure function. The matching query (claims.ts) is
// its mirror, and G-BTN-40 checks the two against each other. Everything else Baton says about
// scheduling — the order, the expedite lane's bound, a course's advice — is advice and never
// refuses (`advice-overridden`). No rule reads what a leg, a station or a tag means.
import { capabilitiesOf, fitsTier } from '../shared/vocabulary.mjs';

/** Who asks: the worker as its heartbeat declared it (§5, R-BTN-60). */
export interface GateWorker {
  /** Capability and role names as declared. */
  declared: string[];
  /** B-104 (R-BTN-174): the capabilities the repository's ontology derives from the worker's
   * granted holdings, by repository — D(H), read only from a current set (the caller brings
   * it up to date first). Absent, nothing is derived. */
  derived?: Record<string, string[]>;
  /** Its ceiling in the ticket's repository's ladder, resolved by the caller (R-BTN-66). */
  tier_ceiling: string;
  tags: string[];
  courses: { repository: string; course: string; version: number }[];
  /** R-BTN-58: the key's grants by repository, each with the capabilities it may use there; null
   *  for a key no owner or administrator granted — a bearer token or a BATON_KEYS seed key, which
   *  keep their interim reach until the seed retires (spec-silent, recorded on R3-1240). */
  grants: Record<string, { capabilities: string[] }> | null;
  /** R-BTN-107: the isolation its heartbeat declared; `process` when none. */
  isolation?: 'attached' | 'process' | 'session';
}

/** What is asked for: the ticket's filter fields (R-BTN-33). */
export interface GateTicket {
  repository: string;
  course: string;
  tier: string | null;
  /** The clause's names, null with none (rule 4). */
  requires: string[] | null;
  /** Shown, never read: rule 6 is retired (R-BTN-121 as amended, B-104), so an operator-only
   *  ticket is held by rule 4's `human-operator` literal like any capability. */
  operator_only: boolean;
  /** Its repository's tier ladder, lowest first (R-BTN-66). */
  tiers: string[];
}

/** The leg: at a claim the ticket's queued leg as posted; at an advance the leg being started. */
export interface GateLeg {
  name: string;
  /** As the latest snapshot posted it; null when no snapshot posts the leg (an advance into a
   *  leg no sync has posted yet is fine, R-BTN-63). */
  state: 'ready' | 'waiting' | null;
  /** The tags the sync posted barred from this leg of the ticket (`ticket_bars`). */
  bars: string[];
  /** R-BTN-106: the course file's `no_chain_from` joined to the owners' `required_independence`
   *  for this leg, as current leg names. */
  noChainFrom?: string[];
  /** R-BTN-107: the course file's floor, `session`, or null. */
  isolation?: 'session' | null;
  /** R-BTN-120, R-BTN-121: the capabilities the leg requires of whoever takes it — rule 4's own
   *  input beside the ticket's clause (`spec/BATON_SPEC.md` §2e); empty or absent, nothing extra.
   *  Capabilities only, never a role name: `graphOf` expands the course's `capability_roles` and
   *  the vocabulary (§12.5), and rule 4 checks each one as the clause's names are checked. The one
   *  literal name is `human-operator`, which R-BTN-121 compares as a string; rule 4 checks it as
   *  rule 6 checks the ticket side (review round 6, finding 0). */
  requires?: string[];
}

export interface GateContext {
  now: number;
  /** The ticket's claims; at an advance, without the advancing one. */
  claims: { status: string; confirmed_at: number | null; fence_pending: number }[];
  override: { hold: number; retry_after: number | null } | null;
  /** The ticket's course's (rule 9). */
  minWorkerVersion: number;
  /** §6.7: the repository head's observation, and the newest `end_observation` of the ticket's
   *  claims (-1 with none): claimable only after a sync since the last end. */
  headObservation: number;
  lastEndObservation: number;
  /** At an advance, the tags the holder bars from the new leg itself (R-BTN-63). */
  holderBars?: string[];
  /** R-BTN-75, R-BTN-78: the ticket's stored `ticket` and `decision` blocks — the kinds that
   *  refuse (`leg` '' for the whole ticket). `capability` refuses through rule 4; `resource` is advice. */
  blocks?: { kind: string; leg: string }[];
  /** R-BTN-106: the legs the asking worker's credential has run on the ticket, in any claim
   *  (`claim_legs` through each claim's worker to its credential), as current leg names. */
  ranByKey?: string[];
}

export type Phase = 'claim' | 'advance';

/** A numbered rule of §7.2, or one §2m names: `chain` (R-BTN-106), `isolation` (R-BTN-107). */
export type GateRule = keyof typeof GATE_CODES | 'chain' | 'isolation';

export type GateVerdict = { ok: true } | { ok: false; rule: GateRule; code: string };

/** The refusal code of each rule (§7.2, §11). Rule 6 is retired (R-BTN-121 as amended, B-104)
 * and never refuses; its number stays unused, like 12's. */
export const GATE_CODES = {
  1: 'not-ready',
  3: 'claimed',
  7: 'not-granted',
  4: 'missing-capability',
  5: 'above-tier-ceiling',
  8: 'barred-tag',
  9: 'stale-skills',
  10: 'backing-off',
} as const;

const refuse = (rule: GateRule, code: string = typeof rule === 'number' ? GATE_CODES[rule] : rule): GateVerdict => ({ ok: false, rule, code });

/** Whether a claim row still holds its ticket (rule 3): active, completed but unconfirmed (§6.7),
 *  or reaped while its worker was alive and not yet fenced (R-BTN-19). */
export function claimHolds(c: { status: string; confirmed_at: number | null; fence_pending: number }): boolean {
  return c.status === 'active' || (c.status === 'completed' && c.confirmed_at == null) || (c.status === 'reaped' && !!c.fence_pending);
}

/**
 * Whether `worker` may take `leg` of `ticket` now, at a claim or at an advance, naming the first
 * rule that refuses. At a claim: the leg is ready and a sync has run since the ticket's last end
 * (rule 1), the lease (3), the grant (7), capabilities (4), tier (5), operator-only (6), the
 * barred tags — posted and owner bars — (8), `chain` and `isolation` (§2m), the course version
 * (9) and the backoff (10). At an advance only the rules that bind a holder (§7.2): the hold
 * (3), 4–7, 8 with the holder's own bars and the owner bars that apply at advances joined,
 * `chain`, `isolation` and 10 — rule 1 is the
 * edge and run limit the caller checks against the course file, the lease is the holder's own,
 * and rule 9 is not re-checked, so a course change never strands a claim halfway (R-BTN-22).
 */
export function gatesFor(worker: GateWorker, ticket: GateTicket, leg: GateLeg, phase: Phase, facts: GateContext): GateVerdict {
  // Rule 1's blocks (R-BTN-75, R-BTN-78): an open dependency refuses a claim; an open decision on
  // the whole ticket or on the leg refuses a claim of it and an advance into it — never fails open.
  const blocks = facts.blocks ?? [];
  const decided = blocks.some((b) => b.kind === 'decision' && (b.leg === '' || b.leg === leg.name));
  if (phase === 'claim') {
    if (leg.state !== 'ready') return refuse(1);
    if (decided || blocks.some((b) => b.kind === 'ticket')) return refuse(1, 'blocked');
    if (facts.claims.some(claimHolds)) return refuse(3);
  } else if (decided) {
    return refuse(1, 'blocked');
  }
  if (facts.override?.hold) return refuse(3, 'held');

  // Rule 7 (R-BTN-58): the key holds a grant for the ticket's repository.
  const grant = worker.grants ? worker.grants[ticket.repository] ?? null : undefined;
  if (grant === null) return refuse(7);

  // Rule 4 (R-BTN-174, B-104): what a runner has for this repository is H ∪ D(H) — its
  // holdings (declared ∩ grant, its `runner:` capabilities beside them, R-BTN-133) and what
  // the repository's ontology derives from them. The grant is checked against holdings only:
  // authority bounds H, never a derivation — a grant that names a derived capability admits a
  // runner that declares it directly, and a derivation satisfies a need the grant never names.
  // The leg's own `requires.capabilities` is rule 4's input beside the ticket's clause
  // (R-BTN-120, B-86); both arrive expanded, capabilities only (§12.5), `human-operator`
  // included as the literal R-BTN-121 compares — rule 6 is retired, so it is met by declaring
  // it and granted like any capability (R-BTN-121 as amended).
  const held = capabilitiesOf(worker.declared);
  const granted = grant ? new Set(grant.capabilities) : null;
  const derived = new Set(worker.derived?.[ticket.repository] ?? []);
  for (const need of new Set([...capabilitiesOf(ticket.requires), ...(leg.requires ?? [])])) {
    const isHolding = need.startsWith('runner:') || (granted ? granted.has(need) : true);
    if ((!held.has(need) || !isHolding) && !derived.has(need)) return refuse(4);
  }

  // Rule 5: the caller passes the lower of the declared ceiling and the grant's max_tier.
  if (!fitsTier(ticket.tier, worker.tier_ceiling, ticket.tiers)) return refuse(5);

  // Rule 6 is retired (R-BTN-121 as amended): `human-operator` is a runner's own statement,
  // checked by rule 4 like any capability — declared by that name and granted by that name.

  const barred = new Set([...leg.bars, ...(phase === 'advance' ? facts.holderBars ?? [] : [])]);
  if (worker.tags.some((t) => barred.has(t))) return refuse(8);

  // R-BTN-106: the key that ran a leg this one names may not take it — at a claim or an advance.
  const ran = new Set(facts.ranByKey ?? []);
  if ((leg.noChainFrom ?? []).some((l) => ran.has(l))) return refuse('chain');

  // R-BTN-107: a leg's isolation floor, against the worker's own word.
  if (leg.isolation && (worker.isolation ?? 'process') !== leg.isolation) return refuse('isolation');

  if (phase === 'claim') {
    const declared = worker.courses.find((c) => c.repository === ticket.repository && c.course === ticket.course);
    if (!declared || declared.version < facts.minWorkerVersion) return refuse(9);
  }

  if (facts.override?.retry_after != null && facts.override.retry_after > facts.now) return refuse(10);

  // §6.7, checked last so a ticket that fails a gate says which: a ticket is claimable again only
  // after a snapshot observed after its last end, so its next claimant is never offered legs from
  // before the holder's last push.
  if (phase === 'claim' && facts.headObservation <= facts.lastEndObservation) return refuse(1, 'awaiting-sync');

  return { ok: true };
}
