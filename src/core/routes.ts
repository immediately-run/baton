// routes.ts — R-BTN-176's atoms and R-BTN-177's resolution (BATON_SPEC §6.10, B-105): pure, like
// ontology.ts beside it — no I/O, no clock, no store — so both hosts resolve a route choice the
// same way and the conformance suite can check the evaluator against clingo. The store's side is
// ontologies.ts (the atoms' inputs, route_last) and claims.ts (the advance that resolves, the
// taken a finishing leg reports); this module forms the atoms from structured inputs and runs the
// one evaluation R-BTN-177 fixes: the route-choice stratum, the generated guard rules and the
// fixed prelude, under the 50,000-match bound, answered as the equivalent first-match.
import {
  boundsFor, evaluate, CONSTANT, type Alternative, type EvalBounds, type FactEntry,
  type Literal, type RouteChoice, type RuleEntry, type Tuple, type ValidatedProgram,
} from './ontology';

// ── R-BTN-176: the atoms, formed from structured inputs ──────────────────────────────────

/** What the store hands the pure side to form the atoms from (R-BTN-176). `usable`, `states`,
 * `refines` and `details` name only the asking runner's usable instances — the store shapes
 * them; the pure side forms the atoms, applying every shape rule the spec fixes. */
export interface RouteInputs {
  /** H ∪ D(H) for the runner and the repository — what `has` reads. */
  has: string[];
  /** The route choices attached to the leg being started — what `wanted` reads. */
  wanted: string[];
  /** (resource, instance): the runner's usable instances of each resource. */
  usable: [string, string][];
  /** (instance, route-choice state) for those instances. */
  states: [string, 'available' | 'unavailable' | 'unknown'][];
  /** (resource, schema id): each resource's `x-baton-base` chain, one row per base. */
  refines: [string, string][];
  /** (instance, the field reading's `detail`) for those instances. */
  details: [string, unknown][];
  /** `this.now` in epoch ms — `now` atoms are formed from it alone (R-BTN-32). */
  now: number;
  /** (choice, alternative) demoted at this runner's last resolution, within 24 hours. */
  wasDemoted: [string, string][];
}

/** A field path's segment (R-BTN-176: `^[a-z][a-z0-9_]{0,31}$`, at most five deep, the path at
 *  most 128 characters). */
const FIELD = /^[a-z][a-z0-9_]{0,31}$/;
/** A path is at most five segments and 128 characters. */
const FIELD_DEPTH_MAX = 5;
const FIELD_PATH_MAX = 128;

/** The field atoms one `detail` forms, by dotted path: integers within 32 bits as `int`, strings
 *  of at most 128 characters in R-BTN-175's constant alphabet as `str`, `true` as `flag`. Nothing
 *  else forms an atom — not `false`, `null`, an array, a non-integer number, a longer string, or
 *  a field a partial reading omits (R-BTN-176). */
export function fieldAtoms(instance: string, detail: unknown): { pred: 'int' | 'str' | 'flag'; path: string; value?: string | number }[] {
  // An instance whose id falls outside R-BTN-175's constant syntax forms no atoms.
  if (!CONSTANT.test(instance) || instance.length > 128) return [];
  const out: { pred: 'int' | 'str' | 'flag'; path: string; value?: string | number }[] = [];
  const walk = (v: unknown, segments: string[]) => {
    if (segments.length >= FIELD_DEPTH_MAX) return;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    for (const [name, x] of Object.entries(v)) {
      if (!FIELD.test(name)) continue;
      const path = [...segments, name].join('.');
      if (path.length > FIELD_PATH_MAX) continue;
      if (typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 0x7fffffff) out.push({ pred: 'int', path, value: x });
      else if (typeof x === 'string' && x.length <= 128 && CONSTANT.test(x)) out.push({ pred: 'str', path, value: x });
      else if (x === true) out.push({ pred: 'flag', path });
      else if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, [...segments, name]);
    }
  };
  walk(detail, []);
  return out;
}

/** `now` atoms from the epoch (R-BTN-176): `epoch_min`, `utc_minute_of_day` (0–1439) and
 *  `utc_weekday` (1 is Monday). */
export function nowAtoms(at: number): Tuple[] {
  const d = new Date(at);
  return [
    ['epoch_min', Math.floor(at / 60_000)],
    ['utc_minute_of_day', d.getUTCHours() * 60 + d.getUTCMinutes()],
    ['utc_weekday', ((d.getUTCDay() + 6) % 7) + 1],
  ];
}

/** R-BTN-176's atoms as relations: `has`, `wanted`, `usable`, `state`, `blocked`, `refines`,
 *  `int`, `str`, `flag`, `now` and `was_demoted` — everything the route-choice stratum and the
 *  guards may read, and nothing else. `blocked(R)` holds when the runner has a usable instance
 *  of R and every one is `"unavailable"` in its route-choice state. */
export function routeFacts(inputs: RouteInputs): Map<string, Tuple[]> {
  const facts = new Map<string, Tuple[]>();
  const put = (pred: string, tuple: Tuple) => {
    if (!facts.has(pred)) facts.set(pred, []);
    facts.get(pred)!.push(tuple);
  };
  for (const k of inputs.has) put('has', [k]);
  for (const c of inputs.wanted) put('wanted', [c]);
  const stateOf = new Map(inputs.states);
  const byResource = new Map<string, string[]>();
  for (const [resource, instance] of inputs.usable) {
    if (!byResource.has(resource)) byResource.set(resource, []);
    byResource.get(resource)!.push(instance);
  }
  for (const [resource, instance] of inputs.usable) {
    put('usable', [resource, instance]);
    const state = stateOf.get(instance) ?? 'unknown';
    put('state', [instance, state]);
    for (const { pred, path, value } of fieldAtoms(instance, inputs.details.find(([i]) => i === instance)?.[1])) {
      if (pred === 'flag') put('flag', [instance, path]);
      else put(pred, [instance, path, value as string | number]);
    }
  }
  // blocked(R): a usable instance of R exists and every one is unavailable.
  for (const [resource, instances] of byResource) {
    if (instances.length && instances.every((i) => (stateOf.get(i) ?? 'unknown') === 'unavailable')) put('blocked', [resource]);
  }
  for (const [resource, base] of inputs.refines) put('refines', [resource, base]);
  for (const t of nowAtoms(inputs.now)) put('now', t);
  for (const [choice, alternative] of inputs.wasDemoted) put('was_demoted', [choice, alternative]);
  return facts;
}

// ── R-BTN-177: the resolution — the encoding, the guards, the first match ─────────────────

/** One resolved route choice, identifiers only (R-BTN-177's delivery). */
export interface ResolvedChoice {
  choice: string;
  /** The advised alternative, or null with a `reason`. */
  alternative: string | null;
  /** Every available alternative in the evaluator's order, (demoted, position). */
  ranked: { alternative: string; needs: string[]; demoted: boolean }[];
  reason?: 'none-available' | 'limit';
}

/** The terms of a generated rule: a variable or a string constant. */
const v = (name: string): { k: 'var'; v: string } => ({ k: 'var', v: name });
const c = (value: string): { k: 'const'; v: string } => ({ k: 'const', v: value });

/** One generated guard rule: `demoted(C, A) :- <literals>` or `excluded(C, A) :- <literals>`. */
const guardRule = (choice: string, alternative: string, which: 'demoted' | 'excluded', body: Literal[]): RuleEntry => ({
  id: `${choice}:${alternative}:${which}`, kind: 'rule',
  head: { pred: which, args: [c(choice), c(alternative)] }, body,
});

/** The route-choice evaluation's synthetic program: the placed route strata (repository rules
 *  that depend on R-BTN-176's atoms, with their facts), then the generated guard rules, then the
 *  prelude — `lacks` and `blocked_alt` over the facts, `available` over their negations. Each
 *  stage's rules read only what earlier stages settled, so `evaluate`'s round semantics resolve
 *  them exactly (a negated same-stratum literal is never re-read: no stratum mixes them). */
function syntheticProgram(placed: ValidatedProgram, wanted: RouteChoice[]): ValidatedProgram {
  const routeStrata = placed.strata
    .filter((s) => [...s.facts.map((e) => e.head.pred), ...s.rules.map((e) => e.head.pred)].some((p) => placed.routePredicates.has(p)))
    .map((s) => ({ facts: [...s.facts], rules: [...s.rules], constraints: [] }));
  const guards: RuleEntry[] = [];
  const altFacts: FactEntry[] = [];
  const needsFacts: FactEntry[] = [];
  for (const rc of wanted) {
    rc.alternatives.forEach((a: Alternative, i: number) => {
      altFacts.push({ id: `${rc.id}:${a.id}:alt`, kind: 'fact', head: { pred: 'alt', args: [c(rc.id), c(a.id), { k: 'int', v: i + 1 }] } });
      for (const n of a.needs) needsFacts.push({ id: `${rc.id}:${a.id}:needs`, kind: 'fact', head: { pred: 'alt_needs', args: [c(rc.id), c(a.id), c(n)] } });
      for (const g of a.demote_when ?? []) guards.push(guardRule(rc.id, a.id, 'demoted', g));
      for (const g of a.exclude_when ?? []) guards.push(guardRule(rc.id, a.id, 'excluded', g));
    });
  }
  const prelude: RuleEntry[] = [
    { id: 'prelude:lacks', kind: 'rule', head: { pred: 'lacks', args: [v('c'), v('a')] }, body: [{ t: 'atom', atom: { pred: 'alt_needs', args: [v('c'), v('a'), v('k')] } }, { t: 'not', atom: { pred: 'has', args: [v('k')] } }] },
    { id: 'prelude:blocked-alt', kind: 'rule', head: { pred: 'blocked_alt', args: [v('c'), v('a')] }, body: [{ t: 'atom', atom: { pred: 'alt_needs', args: [v('c'), v('a'), v('k')] } }, { t: 'atom', atom: { pred: 'meters', args: [v('k'), v('r')] } }, { t: 'atom', atom: { pred: 'blocked', args: [v('r')] } }] },
  ];
  const availability: RuleEntry = {
    id: 'prelude:available', kind: 'rule', head: { pred: 'available', args: [v('c'), v('a')] },
    body: [
      { t: 'atom', atom: { pred: 'wanted', args: [v('c')] } },
      { t: 'atom', atom: { pred: 'alt', args: [v('c'), v('a'), v('p')] } },
      { t: 'not', atom: { pred: 'lacks', args: [v('c'), v('a')] } },
      { t: 'not', atom: { pred: 'blocked_alt', args: [v('c'), v('a')] } },
      { t: 'not', atom: { pred: 'excluded', args: [v('c'), v('a')] } },
    ],
  };
  return {
    ...placed,
    fixedPredicates: new Set<string>(),
    strata: [
      ...routeStrata,
      { facts: [...altFacts, ...needsFacts], rules: [...prelude, ...guards], constraints: [] },
      { facts: [], rules: [availability], constraints: [] },
    ],
  };
}

/** One route-choice evaluation's result: every wanted choice resolved, or the bound it crossed. */
export type RouteResolution =
  | { ok: true; choices: ResolvedChoice[]; demoted: Set<string>; matches: number }
  | { ok: false; crossed: 'matches' };

/**
 * R-BTN-177's resolution: evaluate exactly the route-choice stratum — the repository rules that
 * depend on R-BTN-176's atoms, the generated guard rules and the fixed prelude — over the atoms
 * `inputs` forms and the fixed strata's stored tuples, under the 50,000-match bound, and read the
 * answer as the equivalent first-match: the available alternatives ordered by (demoted, position),
 * the first of them advised. `lowered` is the test bindings' override, as the caller computed it.
 */
export function resolveRoutes(placed: ValidatedProgram, inputs: RouteInputs, fixed: Map<string, Tuple[]>, lowered?: Partial<EvalBounds>): RouteResolution {
  const wanted = inputs.wanted
    .map((id) => placed.program.routeChoices.find((rc) => rc.id === id))
    .filter((rc): rc is RouteChoice => rc != null);
  if (!wanted.length) return { ok: true, choices: [], demoted: new Set(), matches: 0 };
  const facts = new Map<string, Tuple[]>(fixed);
  for (const [pred, tuples] of routeFacts(inputs)) {
    if (!facts.has(pred)) facts.set(pred, []);
    facts.get(pred)!.push(...tuples);
  }
  // `wanted` twice — the fact names the choice this evaluation is over; the synthetic program's
  // guards name the alternatives. Both are facts; the evaluation never re-derives them.
  const run = evaluate(syntheticProgram(placed, wanted), [], facts, boundsFor('route', lowered));
  // A route-choice evaluation is bounded by matches alone (atoms: null), so a refusal is always
  // the match bound — narrowed here for the caller, which answers `limit`.
  if (!run.ok) return { ok: false, crossed: 'matches' as const };
  const available = new Set((run.relations.get('available') ?? []).map((t) => `${t[0]}\u0000${t[1]}`));
  const demotedSet = new Set((run.relations.get('demoted') ?? []).map((t) => `${t[0]}\u0000${t[1]}`));
  const choices: ResolvedChoice[] = wanted.map((rc) => {
    const ranked = rc.alternatives
      .map((a, i) => ({ a, position: i + 1 }))
      .filter(({ a }) => available.has(`${rc.id}\u0000${a.id}`))
      .sort((x, y) => Number(demotedSet.has(`${rc.id}\u0000${x.a.id}`)) - Number(demotedSet.has(`${rc.id}\u0000${y.a.id}`)) || x.position - y.position)
      .map(({ a }) => ({ alternative: a.id, needs: [...a.needs], demoted: demotedSet.has(`${rc.id}\u0000${a.id}`) }));
    const first = ranked[0] ?? null;
    return { choice: rc.id, alternative: first?.alternative ?? null, ranked, ...(first ? {} : { reason: 'none-available' as const }) };
  });
  return { ok: true, choices, demoted: demotedSet, matches: run.matches };
}


