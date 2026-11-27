// conditionTypes.ts — a condition's type vocabulary (BATON_SPEC §7.1 R-BTN-160, §7.1 R-BTN-195;
// B-234): the grammar a type follows, the standard table every leg may raise from without
// declaring it, and the two checks that read the table — which disposition a type carries (a
// declared subtype inherits its standard or declared ancestor's unless it states its own) and
// the raise check the runner answers on the leg's channel (R-BTN-160, R-BTN-195). Pure, like
// course.ts: the validator, the graph, the runner and the course test kit all import it, so it
// names no store and no platform. What a raise means for the ticket is conditions.ts's, and a
// disposition's full life (bindings, waits, restarts — R-BTN-161, R-BTN-162) is not built here:
// this table only names types.

import { isFreeText } from './text';

/** R-BTN-160: a condition type — dotted segments, each `^[a-z][a-z0-9-]*$`, at most 64 chars. */
export const CONDITION_TYPE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
export const CONDITION_TYPE_MAX = 64;

/** §12.3: a restart id (a decision id) — `baton.` reserved to core. */
export const RESTART_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const RESTARTS_MAX = 8;

/** Shape shared by the channel and HTTP boundary; an empty map offers no restarts. */
export function restartFault(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'restarts must map ids to descriptions';
  const entries = Object.entries(value);
  if (entries.length > RESTARTS_MAX) return `restarts must have at most ${RESTARTS_MAX} entries`;
  for (const [id, description] of entries) {
    if (!RESTART_ID.test(id) || id.startsWith('baton.')) return `restarts.${id}: invalid restart id (§12.3)`;
    if (!isFreeText(description)) return `restarts.${id}: a description is §10.4 free text`;
  }
  return null;
}

export function raiseRestarts(type: string, declared: Map<string, ConditionDeclaration>, offered: unknown, chosen: unknown):
  { ok: true; restarts: Record<string, string>; defaultRestart?: string } | { ok: false; reason: string } {
  const lineage = [type, ...ancestorsOf(type)];
  const declaration = lineage.map((t) => declared.get(t)).find((d) => d?.restarts != null);
  const allowed = declaration?.restarts ?? {};
  const restarts = offered ?? allowed;
  const reason = restartFault(restarts);
  if (reason != null) return { ok: false, reason };
  const options = restarts as Record<string, string>;
  const free = declaration?.restarts == null && lineage.some((t) => STANDARD_CONDITION_TYPES.has(t));
  if (!free && Object.entries(options).some(([id, description]) => !Object.hasOwn(allowed, id) || allowed[id] !== description)) {
    return { ok: false, reason: 'restarts must be a subset of the declared restarts (R-BTN-160)' };
  }
  const defaultRestart = chosen ?? (declaration?.default && Object.hasOwn(options, declaration.default) ? declaration.default : undefined);
  if (defaultRestart != null && (typeof defaultRestart !== 'string' || !Object.hasOwn(options, defaultRestart))) {
    return { ok: false, reason: 'default must name one of the offered restarts (R-BTN-160)' };
  }
  return { ok: true, restarts: options, defaultRestart };
}

/** R-BTN-160: what follows from a raise. */
export type Disposition = 'interrupt' | 'suspend' | 'notify';

/** R-BTN-125: a condition's severity. The default is `normal`. */
export const SEVERITIES = ['critical', 'high', 'normal'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One entry of the standard table (R-BTN-160). */
export interface StandardType {
  disposition: Disposition;
  /** `baton` and its subtypes are core's alone: a leg's raise of one is refused. */
  coreOnly?: boolean;
  /** Where R-BTN-160 states it (`error.needs-person` is not retried, R-BTN-195); absent, the
   *  retry policy's own rules decide — the policy is not built to read the table yet. */
  retryable?: boolean;
}

/** R-BTN-122's class of an `interrupt` type, as the end it makes names it (R-BTN-160): core's
 *  error classes by name — §6.5's `cannot-finish` classes are the built-in `interrupt` types
 *  `error.<class>`, the class a core type names being its own whatever a declaration beside it
 *  says — with `error.needs-person` (R-BTN-195) classed `spec`, non-retryable with no class of
 *  its own; then the type's own declaration (a course's own type is `transient` when its
 *  declaration says `retryable`, `spec` otherwise), then the standard entry's own `retryable`
 *  (a bare `error` and `error.transient` are `transient`); a subtype takes the nearest declared
 *  or standard ancestor's class. */
export function errorClassOf(type: string, declared: Map<string, ConditionDeclaration>): 'transient' | 'capability' | 'spec' | 'contract-input' | 'contract-output' | 'blocked' {
  if (type === 'error' || type === 'error.transient') return 'transient';
  if (type === 'error.blocked') return 'blocked';
  if (type === 'error.capability') return 'capability';
  if (type === 'error.contract-input') return 'contract-input';
  if (type === 'error.contract-output') return 'contract-output';
  if (type === 'error.spec' || type === 'error.needs-person') return 'spec';
  const own = declared.get(type);
  if (own != null) return own.retryable === true ? 'transient' : 'spec';
  const std = STANDARD_CONDITION_TYPES.get(type);
  if (std != null) return std.retryable === false ? 'spec' : 'transient';
  for (const prefix of ancestorsOf(type)) {
    if (declared.has(prefix) || STANDARD_CONDITION_TYPES.has(prefix)) return errorClassOf(prefix, declared);
  }
  return 'spec';
}

/** The standard types (R-BTN-160's table), a subtype inheriting its ancestor's disposition: a
 *  leg may raise any of these, or a subtype of one, without declaring it. */
export const STANDARD_CONDITION_TYPES: ReadonlyMap<string, StandardType> = new Map([
  ['hitl', { disposition: 'suspend' }],
  ['warning', { disposition: 'notify' }],
  // R-BTN-195: a leg asks a person into its session. Delivered from Baton's list (R-BTN-163),
  // never through a handler ticket, so nothing waits on it.
  ['interact', { disposition: 'notify' }],
  ['error', { disposition: 'interrupt' }],
  // Core's error classes (R-BTN-160) — an untyped exception is `error.transient` (R-BTN-122).
  ['error.transient', { disposition: 'interrupt', retryable: true }],
  ['error.capability', { disposition: 'interrupt', retryable: false }],
  ['error.spec', { disposition: 'interrupt', retryable: false }],
  ['error.contract-output', { disposition: 'interrupt', retryable: false }],
  ['error.blocked', { disposition: 'interrupt', retryable: false }],
  ['error.contract-input', { disposition: 'interrupt', retryable: false }],
  // R-BTN-195: an autonomous leg that cannot go on without a person fails, it never asks.
  ['error.needs-person', { disposition: 'interrupt', retryable: false }],
  ['baton', { disposition: 'notify', coreOnly: true }],
]);

/** A course's declaration of one type (R-BTN-69, R-BTN-160): only `disposition` is required. */
export interface ConditionDeclaration {
  disposition: Disposition;
  restarts?: Record<string, string>;
  default?: string;
  waitS?: number;
  retryable?: boolean;
  description?: string;
}

/** The declarations a course file carries, as `graphOf` reads them (`conditions` at the top
 *  level); null when the course declares none. A view, never a check: the validator judged the
 *  file before any of this is read. */
export function declaredConditions(json: unknown): Map<string, ConditionDeclaration> {
  const out = new Map<string, ConditionDeclaration>();
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return out;
  const raw = (json as { conditions?: unknown }).conditions;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  // Parents precede children regardless of the order of declarations in the file.
  for (const [type, def] of Object.entries(raw).sort(([a], [b]) => a.length - b.length)) {
    if (!CONDITION_TYPE.test(type) || type.length > CONDITION_TYPE_MAX || isCoreOnly(type)) continue;
    if (typeof def !== 'object' || def === null || Array.isArray(def)) continue;
    const d = def as Record<string, unknown>;
    const disposition = d.disposition === 'interrupt' || d.disposition === 'suspend' || d.disposition === 'notify' ? d.disposition
      : !Object.hasOwn(d, 'disposition') ? ancestorsOf(type).map((prefix) => out.get(prefix) ?? STANDARD_CONDITION_TYPES.get(prefix)).find((parent) => parent != null)?.disposition : null;
    if (disposition == null) continue;
    const decl: ConditionDeclaration = { disposition };
    if (typeof d.wait_s === 'number') decl.waitS = d.wait_s;
    if (typeof d.retryable === 'boolean') decl.retryable = d.retryable;
    if (typeof d.description === 'string') decl.description = d.description;
    if (typeof d.default === 'string') decl.default = d.default;
    if (typeof d.restarts === 'object' && d.restarts !== null && !Array.isArray(d.restarts)) {
      decl.restarts = Object.fromEntries(Object.entries(d.restarts as Record<string, unknown>).filter(([, v]) => typeof v === 'string') as [string, string][]);
    }
    out.set(type, decl);
  }
  return out;
}

/** A type's own ancestors, longest first, excluding itself: `hitl.x.y` → `hitl.x`, `hitl`. */
function ancestorsOf(type: string): string[] {
  const out: string[] = [];
  let at = type;
  for (let dot = at.lastIndexOf('.'); dot > 0; dot = at.lastIndexOf('.')) {
    at = at.slice(0, dot);
    out.push(at);
  }
  return out;
}

/**
 * The disposition a type carries: its own declaration, else the standard table, else the
 * nearest ancestor's declaration, else that ancestor's standard entry — a declared subtype of a
 * standard type inherits unless it states its own (R-BTN-160). Null when neither table names
 * the type or an ancestor: the course never declared it, so a leg may not raise it.
 */
export function dispositionOf(type: string, declared: Map<string, ConditionDeclaration>): Disposition | null {
  const own = declared.get(type) ?? STANDARD_CONDITION_TYPES.get(type);
  if (own) return own.disposition;
  for (const prefix of ancestorsOf(type)) {
    const inherited = declared.get(prefix) ?? STANDARD_CONDITION_TYPES.get(prefix);
    if (inherited) return inherited.disposition;
  }
  return null;
}

/** Whether `type` names `baton` or a subtype — core's alone (R-BTN-160). */
export function isCoreOnly(type: string): boolean {
  return type === 'baton' || type.startsWith('baton.');
}

/**
 * R-BTN-195's autonomous rule: a leg declared `autonomous` never asks for a person — it may
 * raise no `interact` and no `suspend` type, `hitl` and its subtypes included, nor a subtype of
 * the course's own `suspend` declarations.
 */
export function barredFromAutonomous(type: string, declared: Map<string, ConditionDeclaration>): boolean {
  if (type === 'interact' || type.startsWith('interact.')) return true;
  return dispositionOf(type, declared) === 'suspend';
}

/** Where a leg runs a raise from — what the channel check knows of the leg and its run. */
export interface RaiseAt {
  /** The leg's `conditions` narrowing (R-BTN-160): null when the leg narrows nothing. */
  conditions: string[] | null;
  autonomous: boolean;
  /** R-BTN-167: the leg's `deadline_s` — `interact` is refused without one, so the ask cannot
   *  outlive the run's own clock. Null when the leg has no deadline. */
  deadlineS: number | null;
  /** R-BTN-113: the session link the run holds — `interact` is refused without one, since the
   *  request a person receives points at the session (R-BTN-195). Null when none is held. */
  sessionUrl: string | null;
}

/**
 * The runner's check of a raise (R-BTN-160, R-BTN-195), answered on the channel with the reason
 * and never reaching Baton: the type is well formed, is standard or declared, and is allowed to
 * this leg; an autonomous leg asks for no person; an `interact` needs its leg's deadline and
 * its run's session link. `declared` is the course file's declarations, as the claim's snapshot
 * loaded them.
 */
export function checkRaise(type: string, declared: Map<string, ConditionDeclaration>, at: RaiseAt): { ok: true } | { ok: false; reason: string } {
  if (typeof type !== 'string' || !CONDITION_TYPE.test(type) || type.length > CONDITION_TYPE_MAX) {
    return { ok: false, reason: `the type ${JSON.stringify(type)} is not a condition type: dotted segments of ^[a-z][a-z0-9-]*, at most ${CONDITION_TYPE_MAX} characters (R-BTN-160)` };
  }
  if (isCoreOnly(type)) {
    return { ok: false, reason: `${type} is core's alone: a leg raises no baton condition (R-BTN-160)` };
  }
  if (dispositionOf(type, declared) == null) {
    return { ok: false, reason: `${type} is neither a standard type nor one this course declares (R-BTN-160)` };
  }
  // R-BTN-160: a leg may narrow what it raises — a listed type covers itself and its subtypes.
  if (at.conditions != null && !at.conditions.some((c) => type === c || type.startsWith(`${c}.`))) {
    return { ok: false, reason: `${type} is not allowed to this leg: its conditions narrow what it may raise to ${at.conditions.length ? at.conditions.join(', ') : 'nothing'} (R-BTN-160)` };
  }
  if (at.autonomous && barredFromAutonomous(type, declared)) {
    return { ok: false, reason: `this leg is autonomous: it never asks for a person — raise error.needs-person when it cannot go on (R-BTN-195)` };
  }
  if (type === 'interact' || type.startsWith('interact.')) {
    if (at.deadlineS == null) return { ok: false, reason: 'interact needs a leg with a deadline_s, so the ask cannot outlive the run (R-BTN-195, R-BTN-167)' };
    if (at.sessionUrl == null) return { ok: false, reason: 'interact needs a run with a session link: none is held for this run (R-BTN-113, R-BTN-195)' };
  }
  return { ok: true };
}

/**
 * R-BTN-111's condition half, for the signature `baton course test` prints: the types a course's
 * legs may raise — the course's own declarations, and the standard ones (less `baton`, core's
 * alone) except where a leg narrows them. A narrowing leg lists its own.
 */
export function signatureConditions(json: unknown): { standard: string[]; declared: string[]; narrowed: { leg: string; types: string[] }[] } {
  const declared = [...declaredConditions(json).keys()].sort();
  const standard = [...STANDARD_CONDITION_TYPES.keys()].filter((t) => !isCoreOnly(t)).sort();
  const legs = typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as { legs?: unknown }).legs : null;
  const narrowed: { leg: string; types: string[] }[] = [];
  if (typeof legs === 'object' && legs !== null && !Array.isArray(legs)) {
    for (const [leg, def] of Object.entries(legs as Record<string, unknown>)) {
      const list = typeof def === 'object' && def !== null && !Array.isArray(def) ? (def as { conditions?: unknown }).conditions : undefined;
      if (Array.isArray(list)) narrowed.push({ leg, types: list.filter((t): t is string => typeof t === 'string') });
    }
  }
  return { standard, declared, narrowed };
}
