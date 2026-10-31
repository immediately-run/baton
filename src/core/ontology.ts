// ontology.ts — the capability ontology (BATON_SPEC §5.9, R-BTN-174 and R-BTN-175): a
// repository's program derives capabilities from a runner's holdings. Pure and fully
// determined — no I/O, no clock, no store — so it runs unchanged on both hosts and never
// counts as running repository code (R-BTN-98): interpreting a total, bounded logic program
// is reading data, like a course file.
//
// The layering: `parseOntology` reads the JSON shape, `validateOntology` checks R-BTN-175's
// language (safety, types, strata, the gate stratum's four conditions, placement, bounds)
// and answers the program placed into strata; `evaluate` is the bottom-up evaluator the rule
// fixes (semi-naive, entry order, counted matches); `maximalEvaluation` is the one run every
// acceptance makes, with every string constant held; `whyNot` walks a derived atom's
// canonical proof. The bounds are counted, never timed, so both hosts stop at the same point.
import { BatonError } from './http';

// ── the language's shapes (R-BTN-175, Serialization) ─────────────────────────────────────

/** A term as the file writes it: a string constant, a 32-bit integer, or `$x` a variable. */
export type Term = { k: 'const'; v: string } | { k: 'int'; v: number } | { k: 'var'; v: string };

/** One atom: a predicate and its arguments. */
export type Atom = { pred: string; args: Term[] };

/** A body literal: an atom, its default negation, or a comparison of two terms. */
export type Literal =
  | { t: 'atom'; atom: Atom }
  | { t: 'not'; atom: Atom }
  | { t: 'cmp'; left: Term; op: '=' | '!=' | '<' | '<=' | '>' | '>='; right: Term };

/** One entry: a fact, a rule, or an integrity constraint. */
export type Entry = FactEntry | RuleEntry | ConstraintEntry;
export type FactEntry = { id: string; kind: 'fact'; head: Atom };
export type RuleEntry = { id: string; kind: 'rule'; head: Atom; body: Literal[] };
export type ConstraintEntry = { id: string; kind: 'constraint'; body: Literal[] };

/** R-BTN-177: a route choice with its ordered alternatives (validated here; B-105 resolves). */
export interface Alternative {
  id: string;
  needs: string[];
  demote_when?: Literal[][];
  exclude_when?: Literal[][];
}
export interface RouteChoice {
  id: string;
  alternatives: Alternative[];
}

/** The merged program the sync posts and core evaluates. */
export interface Program {
  version: 1;
  builtin: string | null;
  derived: string[];
  entries: Entry[];
  routeChoices: RouteChoice[];
}

/** A validation violation, naming its entry and rule (S-BTN-140's refusals). */
export interface OntologyViolation {
  entry: string | null;
  rule: string;
  message: string;
}

// ── bounds (R-BTN-175) ───────────────────────────────────────────────────────────────────

/** Counted, never timed, so both hosts stop at the same point. */
export const BOUNDS = {
  /** A program has at most 512 entries and alternatives counted together. */
  entriesMax: 512,
  /** Each rule, and each guard as a rule, has at most 8 body literals and 4 variables. */
  bodyLiteralsMax: 8,
  variablesMax: 4,
  /** The file and the merged program are each at most 64 KB. */
  bytesMax: 64 * 1024,
  /** The maximal evaluation may derive at most 5,000 atoms in at most 200,000 matches. */
  maximalAtoms: 5_000,
  maximalMatches: 200_000,
  /** Any other gate evaluation may make at most 400,000 matches. */
  gateMatches: 400_000,
  /** A route-choice evaluation may make at most 50,000 matches. */
  routeMatches: 50_000,
  /** At most 256 derived capabilities per runner and repository (R-BTN-174). */
  derivedMax: 256,
  /** At most 8 needs per alternative (R-BTN-177). */
  needsMax: 8,
} as const;

// ── syntax (R-BTN-175, Terms; the id and value patterns of R-BTN-174/177) ────────────────

export const PREDICATE = /^[a-z][a-z0-9_]{0,31}$/;
export const ENTRY_ID = /^[a-z][a-z0-9-]{0,63}$/;
export const CONSTANT = /^[A-Za-z0-9:._/@-]{1,128}$/;
const VARIABLE = /^\$[a-z][a-z0-9_]{0,31}$/;
const TYPE_ID = /^[a-z][a-z0-9-]{0,31}$/;
export const DERIVED_CAP = /^([a-z][a-z0-9-]{0,31}):(.+)$/;

/** The reserved predicates (R-BTN-175): core's own (`holds`, R-BTN-176's atoms) and
 * R-BTN-177's encoding, which only the translator writes. `derived` and `meters` are the
 * repository's to write. */
const RESERVED_READINGS = ['has', 'wanted', 'usable', 'state', 'blocked', 'refines', 'int', 'str', 'flag', 'now', 'was_demoted'] as const;
const RESERVED_ENCODING = ['alt', 'alt_needs', 'lacks', 'available', 'blocked_alt', 'route', 'demoted', 'excluded'] as const;

/** Each reserved predicate's argument types. */
const RESERVED: Record<string, { types: ('str' | 'int')[]; encoding?: boolean; reading?: boolean }> = {
  holds: { types: ['str'] },
  has: { types: ['str'], reading: true },
  wanted: { types: ['str'], reading: true },
  usable: { types: ['str', 'str'], reading: true },
  state: { types: ['str', 'str'], reading: true },
  blocked: { types: ['str'], reading: true },
  refines: { types: ['str', 'str'], reading: true },
  int: { types: ['str', 'str', 'int'], reading: true },
  str: { types: ['str', 'str', 'str'], reading: true },
  flag: { types: ['str', 'str'], reading: true },
  now: { types: ['str', 'int'], reading: true },
  was_demoted: { types: ['str', 'str'], reading: true },
  alt: { types: ['str', 'str', 'int'], encoding: true },
  alt_needs: { types: ['str', 'str', 'str'], encoding: true },
  lacks: { types: ['str', 'str'], encoding: true },
  available: { types: ['str', 'str'], encoding: true },
  blocked_alt: { types: ['str', 'str'], encoding: true },
  route: { types: ['str', 'str'], encoding: true },
  demoted: { types: ['str', 'str'], encoding: true },
  excluded: { types: ['str', 'str'], encoding: true },
};

const isReading = (p: string) => !!RESERVED[p]?.reading;
/** Core-formed: `holds` and R-BTN-176's atoms — what core itself forms (R-BTN-175). */
const coreFormed = (p: string) => p === 'holds' || isReading(p);

// ── parsing ─────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** A term as the file writes it: a string (constant or `$x` variable) or a 32-bit integer. */
function parseTerm(v: unknown, at: string, out: OntologyViolation[]): Term | null {
  if (isStr(v)) {
    if (v.startsWith('$')) {
      if (!VARIABLE.test(v)) {
        out.push({ entry: null, rule: 'terms', message: `${at}: a variable is $ followed by a lowercase word (R-BTN-175)` });
        return null;
      }
      return { k: 'var', v: v.slice(1) };
    }
    if (!CONSTANT.test(v)) {
      out.push({ entry: null, rule: 'terms', message: `${at}: the constant "${v}" is outside R-BTN-175's alphabet` });
      return null;
    }
    return { k: 'const', v };
  }
  if (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 0x7fffffff) return { k: 'int', v };
  out.push({ entry: null, rule: 'terms', message: `${at}: a term is a string constant or a 32-bit integer` });
  return null;
}

function parseAtom(v: unknown, at: string, out: OntologyViolation[]): Atom | null {
  if (!Array.isArray(v) || v.length < 1 || !isStr(v[0])) {
    out.push({ entry: null, rule: 'serialization', message: `${at}: an atom is [predicate, argument…]` });
    return null;
  }
  if (!PREDICATE.test(v[0]) || v[0] === 'not') {
    out.push({ entry: null, rule: 'terms', message: `${at}: the predicate "${v[0]}" is not a predicate name` });
    return null;
  }
  const args: Term[] = [];
  for (const [i, t] of v.slice(1).entries()) {
    const term = parseTerm(t, `${at}[${i + 1}]`, out);
    if (!term) return null;
    args.push(term);
  }
  return { pred: v[0], args };
}

function parseLiterals(v: unknown, at: string, out: OntologyViolation[]): Literal[] | null {
  if (!Array.isArray(v)) {
    out.push({ entry: null, rule: 'serialization', message: `${at}: must be a list of literals` });
    return null;
  }
  const lits: Literal[] = [];
  for (const [i, raw] of v.entries()) {
    const where = `${at}[${i}]`;
    if (isObj(raw) && 'not' in raw) {
      const atom = parseAtom(raw.not, `${where}.not`, out);
      if (!atom) return null;
      lits.push({ t: 'not', atom });
    } else if (isObj(raw) && 'cmp' in raw) {
      const c = raw.cmp;
      const ops = ['=', '!=', '<', '<=', '>', '>='];
      if (!Array.isArray(c) || c.length !== 3 || !ops.includes(c[1] as string)) {
        out.push({ entry: null, rule: 'serialization', message: `${where}.cmp: must be [term, op, term] with op = != < <= > >=` });
        return null;
      }
      const left = parseTerm(c[0], `${where}.cmp[0]`, out);
      const right = parseTerm(c[2], `${where}.cmp[2]`, out);
      if (!left || !right) return null;
      lits.push({ t: 'cmp', left, op: c[1] as Literal extends { t: 'cmp'; op: infer O } ? O : never, right });
    } else {
      const atom = parseAtom(raw, where, out);
      if (!atom) return null;
      lits.push({ t: 'atom', atom });
    }
  }
  return lits;
}

function parseGuards(v: unknown, at: string, out: OntologyViolation[]): Literal[][] | null {
  if (!Array.isArray(v) || v.length < 1) {
    out.push({ entry: null, rule: 'serialization', message: `${at}: must be a non-empty list of literal lists — an empty body would always hold (R-BTN-177)` });
    return null;
  }
  const guards: Literal[][] = [];
  for (const [i, g] of v.entries()) {
    const lits = parseLiterals(g, `${at}[${i}]`, out);
    if (!lits) return null;
    guards.push(lits);
  }
  return guards;
}

/** R-BTN-175's Serialization: read the posted program JSON. Malformed shape is thrown (the
 * post is malformed); language violations are collected and thrown with them, so a refused
 * program names its entry and rule (S-BTN-140). */
export function parseOntology(v: unknown, bytes: number): Program {
  const bad: (why: string) => never = (why) => {
    throw new BatonError('invalid-params', `ontology: ${why}`);
  };
  if (!isObj(v)) bad('the program must be a JSON object');
  if (v.version !== 1) bad('version must be 1');
  if (v.builtin !== undefined && v.builtin !== null && !isStr(v.builtin)) bad('builtin must be "baton@<n>" or null');
  const derived = v.derived ?? [];
  if (!Array.isArray(derived) || !derived.every((t) => isStr(t) && TYPE_ID.test(t))) bad('derived must be a list of type ids');
  for (const t of derived as string[]) {
    if (t === 'credential' || t === 'runner' || t === 'human-operator') bad(`derived may never name "${t}" (R-BTN-175)`);
  }
  if (!Array.isArray(v.entries)) bad('entries must be a list');
  if (bytes > BOUNDS.bytesMax) bad(`the program is over ${BOUNDS.bytesMax} bytes`);
  const violations: OntologyViolation[] = [];
  const entries: Entry[] = [];
  const ids = new Set<string>();
  // At most 512 entries and alternatives counted together (R-BTN-175) — a route choice
  // counts each of its alternatives.
  const alternatives = Array.isArray(v.route_choices)
    ? (v.route_choices as { alternatives?: unknown[] }[]).reduce((n, rc) => n + (Array.isArray(rc.alternatives) ? rc.alternatives.length : 0), 0)
    : 0;
  const total = (v.entries as unknown[]).length + alternatives;
  if (total > BOUNDS.entriesMax) bad(`at most ${BOUNDS.entriesMax} entries and alternatives together (R-BTN-175)`);
  for (const [i, raw] of (v.entries as unknown[]).entries()) {
    const at = `entries[${i}]`;
    if (!isObj(raw) || !isStr(raw.id)) bad(`${at}: an entry has an id`);
    if (!ENTRY_ID.test(raw.id)) bad(`${at}.id: "${raw.id}" is not an entry id`);
    if (ids.has(raw.id)) bad(`${at}.id: "${raw.id}" appears twice — ids are one namespace (R-BTN-174)`);
    ids.add(raw.id);
    if ('constraint' in raw) {
      const body = parseLiterals(raw.constraint, `${at}.constraint`, violations);
      if (!body) continue;
      entries.push({ id: raw.id, kind: 'constraint', body });
    } else if ('fact' in raw) {
      const head = parseAtom(raw.fact, `${at}.fact`, violations);
      if (!head) continue;
      entries.push({ id: raw.id, kind: 'fact', head });
    } else if ('head' in raw) {
      const head = parseAtom(raw.head, `${at}.head`, violations);
      const body = parseLiterals(raw.body, `${at}.body`, violations);
      if (!head || !body) continue;
      entries.push({ id: raw.id, kind: 'rule', head, body });
    } else {
      bad(`${at}: an entry is a fact, a head with a body, or a constraint`);
    }
  }
  const routeChoices: RouteChoice[] = [];
  if (v.route_choices !== undefined) {
    if (!Array.isArray(v.route_choices)) bad('route_choices must be a list');
    for (const [i, raw] of (v.route_choices as unknown[]).entries()) {
      const at = `route_choices[${i}]`;
      if (!isObj(raw) || !isStr(raw.id) || !ENTRY_ID.test(raw.id)) bad(`${at}.id is not an entry id`);
      if (ids.has(raw.id)) bad(`${at}.id: "${raw.id}" appears twice — ids are one namespace (R-BTN-174)`);
      ids.add(raw.id);
      if (!Array.isArray(raw.alternatives) || raw.alternatives.length < 1) bad(`${at}.alternatives must be a non-empty list`);
      const alternatives: Alternative[] = [];
      const altIds = new Set<string>();
      for (const [j, a] of (raw.alternatives as unknown[]).entries()) {
        const where = `${at}.alternatives[${j}]`;
        if (!isObj(a) || !isStr(a.id) || !ENTRY_ID.test(a.id)) bad(`${where}.id is not an alternative id`);
        if (altIds.has(a.id)) bad(`${where}.id: "${a.id}" appears twice within its route choice`);
        altIds.add(a.id);
        if (!Array.isArray(a.needs) || a.needs.length > BOUNDS.needsMax) bad(`${where}.needs must be a list of at most ${BOUNDS.needsMax}`);
        for (const need of a.needs as unknown[]) {
          if (!isStr(need) || !DERIVED_CAP.test(need) || !CONSTANT.test(need)) bad(`${where}.needs: "${String(need)}" is not a <type>:<value> capability`);
          const type = String(need).split(':')[0];
          if (type === 'credential' || type === 'runner' || need === 'human-operator') bad(`${where}.needs: "${String(need)}" is never a need (R-BTN-177)`);
        }
        const alternative: Alternative = { id: a.id, needs: [...(a.needs as string[])] };
        if (a.demote_when !== undefined) {
          const g = parseGuards(a.demote_when, `${where}.demote_when`, violations);
          if (g) alternative.demote_when = g;
        }
        if (a.exclude_when !== undefined) {
          const g = parseGuards(a.exclude_when, `${where}.exclude_when`, violations);
          if (g) alternative.exclude_when = g;
        }
        alternatives.push(alternative);
      }
      routeChoices.push({ id: raw.id, alternatives });
    }
  }
  if (violations.length) {
    const err = new BatonError('invalid-params', `ontology: ${violations[0].message}`);
    (err as unknown as { violations: OntologyViolation[] }).violations = violations;
    throw err;
  }
  return { version: 1, builtin: isStr(v.builtin) ? v.builtin : null, derived: [...new Set(derived as string[])], entries, routeChoices };
}

// ── validation: safety, types, strata, the gate stratum, placement ───────────────────────

/** What validation answers: the program, placed into strata. */
export interface ValidatedProgram {
  program: Program;
  /** Every predicate's argument types, as validation inferred or the reserved declare. */
  types: Map<string, ('str' | 'int')[]>;
  /** Each predicate's stratum: 0-based, evaluated in this order (ties: smallest entry index). */
  stratum: Map<string, number>;
  /** The strata, each with the facts and rules evaluated in it, in entry order. */
  strata: { facts: FactEntry[]; rules: RuleEntry[]; constraints: ConstraintEntry[] }[];
  /** The predicates the gate evaluation evaluates: `derived` and all it depends on. */
  gatePredicates: Set<string>;
  /** The predicates that depend on R-BTN-176's atoms (the route-choice stratum). */
  routePredicates: Set<string>;
  /** The fixed predicates (R-BTN-175): depend on no core-formed atom; their maximal result is
   * stored with the program and later evaluations read them as facts. */
  fixedPredicates: Set<string>;
  /** The program's string constants — the only holdings that can take part (condition 2). */
  constants: Set<string>;
}

const varsOf = (t: Term): string[] => (t.k === 'var' ? [t.v] : []);
const atomVars = (a: Atom): string[] => a.args.flatMap(varsOf);
const litVars = (l: Literal): string[] => (l.t === 'cmp' ? [...varsOf(l.left), ...varsOf(l.right)] : atomVars(l.atom));

/**
 * A rule body's evaluation order (R-BTN-175's evaluator bullet): positive literals as
 * written, then each comparison and negated literal at the first place every variable it
 * reads is bound. `pos` is the literal's index among the body's positive literals, -1 for a
 * comparison or negation.
 */
export function bodyOrder(body: Literal[]): { lit: Literal; pos: number }[] {
  const positives = body.filter((l) => l.t === 'atom');
  const deferred = body.filter((l) => l.t !== 'atom');
  const order: { lit: Literal; pos: number }[] = [];
  const placed = new Set<Literal>();
  const bound = new Set<string>();
  const release = () => {
    let moved = true;
    while (moved) {
      moved = false;
      for (const lit of deferred) {
        if (placed.has(lit)) continue;
        if (litVars(lit).every((x) => bound.has(x))) {
          placed.add(lit);
          order.push({ lit, pos: -1 });
          moved = true;
        }
      }
    }
  };
  for (const [i, lit] of positives.entries()) {
    order.push({ lit, pos: i });
    atomVars((lit as { atom: Atom }).atom).forEach((x) => bound.add(x));
    release();
  }
  for (const lit of deferred) if (!placed.has(lit)) order.push({ lit, pos: -1 });
  return order;
}

/**
 * R-BTN-175's validation, minus what only an evaluation can check (constraints over fixed
 * predicates, condition 4's typed atoms, the 256 limit — those in `maximalEvaluation`).
 * Answers the placed program, or the violations, each naming its entry and rule.
 */
export function validateOntology(program: Program): { ok: true; placed: ValidatedProgram } | { ok: false; violations: OntologyViolation[] } {
  const v: OntologyViolation[] = [];
  const add = (entry: string | null, rule: string, message: string) => v.push({ entry, rule, message });

  // Reserved predicates: never a repository head (derived and meters excepted); the
  // encoding's never in a repository body or guard.
  for (const e of program.entries) {
    if (e.kind !== 'constraint') {
      const p = e.head.pred;
      if (RESERVED[p] || p === 'holds') add(e.id, 'reserved', `the head ${p}/${e.head.args.length} is reserved (R-BTN-175)`);
      if (e.kind === 'fact' && e.head.args.some((a) => a.k === 'var')) add(e.id, 'safety', 'a fact is ground — no variables (R-BTN-175)');
    }
    if (e.kind !== 'fact') for (const lit of e.body) {
      if (lit.t !== 'cmp' && RESERVED_ENCODING.includes(lit.atom.pred as never)) {
        add(e.id, 'reserved', `the body literal ${lit.atom.pred}/${lit.atom.args.length} is the encoding's, which a repository never reads (R-BTN-175)`);
      }
    }
  }
  for (const rc of program.routeChoices) for (const a of rc.alternatives) {
    for (const [which, guards] of [['demote_when', a.demote_when], ['exclude_when', a.exclude_when]] as const) {
      for (const g of guards ?? []) for (const lit of g) {
        if (lit.t !== 'cmp' && RESERVED_ENCODING.includes(lit.atom.pred as never)) {
          add(rc.id, 'reserved', `${which}: the guard reads ${lit.atom.pred}/${lit.atom.args.length}, which is the encoding's (R-BTN-177)`);
        }
      }
    }
  }

  // Safety: every variable of a rule, constraint or guard occurs in a positive body literal
  // that is not a comparison; the literals and variables are within their bounds.
  const checkSafety = (id: string, body: Literal[], what: string) => {
    const positive = new Set(body.filter((l) => l.t === 'atom').flatMap((l) => atomVars(l.atom)));
    const all = new Set(body.flatMap(litVars));
    if (all.size > BOUNDS.variablesMax) add(id, 'bounds', `${what} reads ${all.size} variables — at most ${BOUNDS.variablesMax} (R-BTN-175)`);
    if (body.length > BOUNDS.bodyLiteralsMax) add(id, 'bounds', `${what} has ${body.length} body literals — at most ${BOUNDS.bodyLiteralsMax} (R-BTN-175)`);
    for (const x of all) if (!positive.has(x)) add(id, 'safety', `${what}: the variable $${x} occurs in no positive body literal (R-BTN-175)`);
  };
  for (const e of program.entries) {
    if (e.kind === 'fact') continue;
    checkSafety(e.id, e.body, e.kind === 'rule' ? 'the rule' : 'the constraint');
  }
  for (const rc of program.routeChoices) for (const a of rc.alternatives) {
    for (const [which, guards] of [['demote_when', a.demote_when], ['exclude_when', a.exclude_when]] as const) {
      for (const [i, g] of (guards ?? []).entries()) checkSafety(rc.id, g, `${which}[${i}]`);
    }
  }

  // One arity per predicate.
  const arity = new Map<string, number>();
  const noteArity = (id: string, p: string, n: number) => {
    const prior = arity.get(p);
    if (prior === undefined) arity.set(p, n);
    else if (prior !== n) add(id, 'terms', `${p} appears with arity ${n} and ${prior} — one arity per predicate (R-BTN-175)`);
  };
  const everyLiteral = (id: string, body: Literal[], fn: (l: Literal) => void) => {
    for (const lit of body) fn(lit);
  };
  const noteBody = (id: string, body: Literal[]) => everyLiteral(id, body, (lit) => {
    if (lit.t !== 'cmp') noteArity(id, lit.atom.pred, lit.atom.args.length);
  });
  for (const e of program.entries) {
    if (e.kind !== 'constraint') noteArity(e.id, e.head.pred, e.head.args.length);
    if (e.kind !== 'fact') noteBody(e.id, e.body);
  }
  for (const rc of program.routeChoices) for (const a of rc.alternatives) for (const guards of [a.demote_when, a.exclude_when]) {
    for (const g of guards ?? []) noteBody(rc.id, g);
  }

  // Types (R-BTN-175): every argument position of every predicate has one type, string or
  // integer — declared for the reserved, inferred elsewhere "by propagating types from facts,
  // constants and heads, through variables shared between positions, to a fixpoint". The
  // propagation is a union-find over positions and rule-scoped variables: a variable at a
  // position links them, a constant asserts its position's type, and a component carrying
  // both types is refused. A position that receives none holds no atom and is typed string.
  for (const [p, t] of Object.entries(RESERVED)) {
    if (arity.has(p) && arity.get(p) !== t.types.length) add(null, 'types', `${p} appears with arity ${arity.get(p)} — the reserved predicate takes ${t.types.length}`);
  }
  const typeAsserts: [string, 'str' | 'int'][] = [];
  const posOf = (p: string, i: number) => `${p}/${i}`;
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const node = (x: string) => find(x);
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [p, t] of Object.entries(RESERVED)) {
    if (!arity.has(p)) continue;
    t.types.forEach((type, i) => typeAsserts.push([posOf(p, i), type]));
  }
  // R-BTN-177's prelude reads meters/2 with string arguments, so a repository meters of any
  // other shape clashes here (S-BTN-152): one arity per predicate, one type per position.
  if (arity.has('meters')) {
    if (arity.get('meters') !== 2) add(null, 'terms', `meters appears with arity ${arity.get('meters')} — the prelude reads meters(K, R) with two strings (R-BTN-177)`);
    typeAsserts.push([posOf('meters', 0), 'str']);
    typeAsserts.push([posOf('meters', 1), 'str']);
  }
  const linkAtom = (atom: Atom, varScope: string | null) => {
    if (atom.args.length > 0) atom.args.forEach((_, i) => node(posOf(atom.pred, i)));
    for (const [i, t] of atom.args.entries()) {
      if (t.k === 'var') {
        if (varScope) union(`${varScope}:$${t.v}`, posOf(atom.pred, i));
      } else {
        typeAsserts.push([posOf(atom.pred, i), t.k === 'int' ? 'int' : 'str']);
      }
    }
  };
  for (const e of program.entries) {
    if (e.kind !== 'constraint') linkAtom(e.head, e.id);
    if (e.kind !== 'fact') for (const lit of e.body) {
      if (lit.t === 'cmp') {
        // A comparison links its terms: `=` and `!=` two of one type, `< <= > >=` two
        // integers — an integer term types every variable it is compared with.
        if (lit.left.k === 'var' && lit.right.k === 'var') union(`${e.id}:$${lit.left.v}`, `${e.id}:$${lit.right.v}`);
        if (lit.left.k === 'int' || lit.right.k === 'int') {
          typeAsserts.push([`${e.id}:$cmp-int`, 'int']);
          for (const t of [lit.left, lit.right]) {
            if (t.k === 'var') union(`${e.id}:$${t.v}`, `${e.id}:$cmp-int`);
          }
        }
        continue;
      }
      linkAtom(lit.atom, e.id);
    }
  }
  for (const rc of program.routeChoices) for (const a of rc.alternatives) for (const guards of [a.demote_when, a.exclude_when]) {
    for (const [gi, g] of (guards ?? []).entries()) for (const lit of g) {
      if (lit.t === 'cmp') continue;
      linkAtom(lit.atom, `${rc.id}:${a.id}:${gi}`);
    }
  }
  // After every link: a position's type is its component's asserted type — 'str' when none —
  // and a component carrying both types is a clash the program is refused for.
  const types = new Map<string, ('str' | 'int')[]>();
  const componentTypes = new Map<string, Set<'str' | 'int'>>();
  for (const [pos, type] of typeAsserts) {
    const root = find(pos);
    if (!componentTypes.has(root)) componentTypes.set(root, new Set());
    componentTypes.get(root)!.add(type);
  }
  const clashes = [...componentTypes.entries()].filter(([, ts]) => ts.size > 1);
  if (clashes.length) {
    const clashRoot = clashes[0][0];
    const where = [...arity.keys()].filter((p) => [...Array(arity.get(p)!).keys()].some((i) => find(posOf(p, i)) === clashRoot));
    const entry = program.entries.find((e) => e.kind !== 'constraint' && where.includes(e.head.pred))?.id ?? null;
    add(entry, 'types', `${where.join(', ')} share a variable or a constant across a string and an integer position (R-BTN-175)`);
  }
  for (const [p, n] of arity) {
    const ts: ('str' | 'int')[] = [];
    for (let i = 0; i < n; i++) {
      const root = find(posOf(p, i));
      ts.push([...(componentTypes.get(root) ?? ['str' as const])][0]);
    }
    types.set(p, ts);
  }
  // Comparisons: `< <= > >=` compare two integers — a variable joined to a string position and
  // compared with one of them is caught above by the propagation; a constant string is here.
  for (const e of program.entries) if (e.kind !== 'fact') for (const lit of e.body) {
    if (lit.t !== 'cmp') continue;
    const ty = (t: Term): 'str' | 'int' | null => (t.k === 'int' ? 'int' : t.k === 'const' ? 'str' : null);
    const lt = ty(lit.left);
    const rt = ty(lit.right);
    if (['<', '<=', '>', '>='].includes(lit.op) && (lt === 'str' || rt === 'str')) add(e.id, 'types', `"${lit.op}" compares two integers (R-BTN-175)`);
    if ((lit.op === '=' || lit.op === '!=') && lt != null && rt != null && lt !== rt) add(e.id, 'types', `"${lit.op}" compares two values of one type (R-BTN-175)`);
  }

  // The dependency graph, with R-BTN-177's generated guard rules included: each guard is a
  // rule `demoted/excluded(C, A) :- <literals>`, and the prelude's rules are generated too.
  const deps = new Map<string, Set<string>>();
  const negDeps = new Map<string, Set<string>>();
  const link = (head: string, body: Literal[]) => {
    if (!deps.has(head)) deps.set(head, new Set());
    for (const lit of body) {
      if (lit.t === 'cmp') continue;
      deps.get(head)!.add(lit.atom.pred);
      if (lit.t === 'not') {
        if (!negDeps.has(head)) negDeps.set(head, new Set());
        negDeps.get(head)!.add(lit.atom.pred);
      }
    }
  };
  const CONSTRAINT = '\u0000constraint';
  for (const e of program.entries) {
    if (e.kind === 'fact') {
      if (!deps.has(e.head.pred)) deps.set(e.head.pred, new Set());
      continue;
    }
    if (e.kind === 'rule') link(e.head.pred, e.body);
    else link(CONSTRAINT, e.body);
  }
  for (const p of RESERVED_ENCODING) if (!deps.has(p)) deps.set(p, new Set());
  for (const rc of program.routeChoices) {
    link('demoted', rc.alternatives.flatMap((a) => a.demote_when ?? []).flat());
    link('excluded', rc.alternatives.flatMap((a) => a.exclude_when ?? []).flat());
    link('lacks', [{ t: 'atom', atom: { pred: 'alt_needs', args: [] } }, { t: 'not', atom: { pred: 'has', args: [] } }]);
    link('blocked_alt', [{ t: 'atom', atom: { pred: 'alt_needs', args: [] } }, { t: 'atom', atom: { pred: 'meters', args: [] } }, { t: 'atom', atom: { pred: 'blocked', args: [] } }]);
    link('available', [{ t: 'atom', atom: { pred: 'wanted', args: [] } }, { t: 'atom', atom: { pred: 'alt', args: [] } }, { t: 'not', atom: { pred: 'lacks', args: [] } }, { t: 'not', atom: { pred: 'blocked_alt', args: [] } }, { t: 'not', atom: { pred: 'excluded', args: [] } }]);
    link('route', [{ t: 'atom', atom: { pred: 'available', args: [] } }]);
  }

  // The reflexive-transitive closure of the dependency graph, to a fixpoint: a later
  // predicate's growth must reach everything that read it.
  const closureOf = new Map<string, Set<string>>();
  for (const p of deps.keys()) closureOf.set(p, new Set([p]));
  for (let grew = true; grew;) {
    grew = false;
    for (const [p, acc] of closureOf) {
      for (const d of deps.get(p) ?? []) {
        const before = acc.size;
        for (const x of closureOf.get(d) ?? [d]) acc.add(x);
        if (acc.size !== before) grew = true;
      }
    }
  }
  const dependsOnHolds = (p: string) => (closureOf.get(p) ?? new Set([p])).has('holds');
  const dependsOnReadings = (p: string) => [...(closureOf.get(p) ?? new Set([p]))].some(isReading);

  const gatePredicates = new Set([...(closureOf.get('derived') ?? new Set(['derived']))].filter((p) => p !== CONSTRAINT));
  const routePredicates = new Set([...deps.keys()].filter((p) => p !== CONSTRAINT && !RESERVED_ENCODING.includes(p as never) && !RESERVED[p]?.encoding && dependsOnReadings(p)));
  const fixedPredicates = new Set([...deps.keys()].filter((p) => p !== CONSTRAINT && !dependsOnHolds(p) && !dependsOnReadings(p)));

  // Strata: no cycle through a negated literal, the generated guard rules included.
  for (const [p, negs] of negDeps) {
    for (const q of negs) {
      if (!(closureOf.get(q) ?? new Set([q])).has(p)) continue;
      const entry = program.entries.find((e) => e.kind !== 'fact' && e.body.some((l) => l.t === 'not' && l.atom.pred === q && (e.kind === 'rule' ? e.head.pred : CONSTRAINT) === p))?.id
        ?? program.routeChoices.find((rc) => rc.alternatives.some((a) => [...(a.demote_when ?? []), ...(a.exclude_when ?? [])].some((g) => g.some((l) => l.t === 'not' && l.atom.pred === q))))?.id
        ?? null;
      add(entry, 'strata', `a cycle through the negation of ${q} — the program is not stratified (R-BTN-175)`);
    }
  }

  // Constraints range only over predicates that depend on no core-formed atom.
  for (const e of program.entries) {
    if (e.kind !== 'constraint') continue;
    for (const lit of e.body) {
      if (lit.t === 'cmp') continue;
      if (dependsOnHolds(lit.atom.pred) || dependsOnReadings(lit.atom.pred)) {
        add(e.id, 'constraints', `the constraint reads ${lit.atom.pred}, which depends on a core-formed atom (R-BTN-175)`);
      }
    }
  }

  // The gate stratum's four conditions (R-BTN-175), the fourth at the maximal evaluation.
  for (const e of program.entries) {
    if (e.kind !== 'rule' || !gatePredicates.has(e.head.pred)) continue;
    for (const lit of e.body) {
      if (lit.t === 'not' && dependsOnHolds(lit.atom.pred)) {
        add(e.id, 'gate-stratum', `the rule negates ${lit.atom.pred}, which depends on holds — condition 1 (R-BTN-175)`);
      }
      if (lit.t === 'atom' && lit.atom.pred === 'holds') {
        const elsewhere = new Set(e.body.flatMap((l) => (l.t === 'atom' && l.atom.pred !== 'holds' && !coreFormed(l.atom.pred) ? atomVars(l.atom) : [])));
        for (const x of atomVars(lit.atom)) if (!elsewhere.has(x)) {
          add(e.id, 'gate-stratum', `$${x} of the holds literal is bound by holds alone — condition 2 (R-BTN-175)`);
        }
      }
    }
  }
  for (const p of gatePredicates) {
    for (const q of closureOf.get(p) ?? [p]) {
      if (q !== 'holds' && coreFormed(q)) add(null, 'gate-stratum', `${p} depends on ${q}, a reading atom — condition 3 (R-BTN-175)`);
      if (RESERVED_ENCODING.includes(q as never)) add(null, 'gate-stratum', `${p} depends on ${q}, the encoding's — condition 3 (R-BTN-175)`);
    }
  }

  // Placement: a repository predicate that depends on holds is in the gate stratum, so it
  // reaches derived, or the program is refused; one that depends on R-BTN-176's atoms is in
  // the route-choice stratum; the gate stratum may read only fixed predicates besides its own.
  for (const p of deps.keys()) {
    if (p === CONSTRAINT || RESERVED[p]) continue;
    if (dependsOnHolds(p) && !gatePredicates.has(p)) add(null, 'placement', `${p} depends on holds but never reaches derived — every predicate is placed (R-BTN-175)`);
    if (routePredicates.has(p) && dependsOnHolds(p)) add(null, 'placement', `${p} depends on both holdings and readings — every predicate is placed (R-BTN-175)`);
  }
  for (const p of gatePredicates) {
    for (const q of closureOf.get(p) ?? []) {
      if (q === p || RESERVED[q]) continue;
      if (routePredicates.has(q)) add(null, 'placement', `the gate stratum's ${p} reads ${q}, which is route-choice stratum (R-BTN-175)`);
    }
  }
  // A guard or meters rule depends on no holding or derived capability (R-BTN-176).
  for (const rc of program.routeChoices) for (const a of rc.alternatives) {
    for (const [which, guards] of [['demote_when', a.demote_when], ['exclude_when', a.exclude_when]] as const) {
      for (const g of guards ?? []) for (const lit of g) {
        if (lit.t === 'cmp') continue;
        const rs = closureOf.get(lit.atom.pred) ?? new Set([lit.atom.pred]);
        if (rs.has('holds') || rs.has('derived')) add(rc.id, 'placement', `${which} reads ${lit.atom.pred}, which depends on holdings or derived capabilities (R-BTN-176)`);
      }
    }
  }
  for (const e of program.entries) {
    if (e.kind === 'fact' && e.head.pred === 'meters' && (e.head.args.length !== 2 || e.head.args.some((t) => t.k !== 'const'))) {
      add(e.id, 'terms', 'a meters fact is two string constants (R-BTN-177)');
    }
  }

  if (v.length) return { ok: false, violations: v };

  // Strata: SCCs of the dependency graph over the program's own predicates (the encoding's
  // are evaluated only in a route-choice evaluation), topologically ordered, ties broken by
  // the smallest entry index.
  const placedPreds = [...deps.keys()].filter((p) => p !== CONSTRAINT && !RESERVED_ENCODING.includes(p as never) && !RESERVED[p]?.encoding);
  const sccs = tarjan(placedPreds, (p) => [...(deps.get(p) ?? [])].filter((q) => placedPreds.includes(q)));
  const firstIndex = (p: string) => {
    const i = program.entries.findIndex((e) => e.kind !== 'constraint' && e.head.pred === p);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sccOf = new Map(sccs.flatMap((scc, i) => scc.map((p) => [p, i] as const)));
  // Kahn's order, the ready component with the smallest entry index first (R-BTN-175's tie
  // break), so the order is fully determined.
  const remaining = new Set(sccs.map((_, i) => i));
  const ordered: string[][] = [];
  const ready = () => sccs.map((_, i) => i).filter((i) => remaining.has(i)
    && sccs[i].every((p) => [...(deps.get(p) ?? [])].every((q) => {
      const j = sccOf.get(q);
      return j === undefined || j === i || !remaining.has(j);
    })));
  while (remaining.size) {
    const candidates = ready();
    if (!candidates.length) break; // unreachable: no cycle through negation survived validation
    const pick = candidates.reduce((a, b) => (Math.min(...sccs[a].map(firstIndex)) <= Math.min(...sccs[b].map(firstIndex)) ? a : b));
    remaining.delete(pick);
    ordered.push(sccs[pick]);
  }
  const stratum = new Map<string, number>();
  ordered.forEach((scc, i) => scc.forEach((p) => stratum.set(p, i)));
  const strata: ValidatedProgram['strata'] = ordered.map(() => ({ facts: [] as FactEntry[], rules: [] as RuleEntry[], constraints: [] as ConstraintEntry[] }));
  const constants = new Set<string>();
  const collect = (terms: Term[]) => {
    for (const t of terms) if (t.k === 'const') constants.add(t.v);
  };
  for (const e of program.entries) {
    if (e.kind !== 'constraint' && stratum.has(e.head.pred)) {
      const s = stratum.get(e.head.pred)!;
      if (e.kind === 'fact') strata[s].facts.push(e);
      else strata[s].rules.push(e);
      collect(e.head.args);
    } else if (e.kind === 'constraint') {
      const own = e.body.filter((l) => l.t !== 'cmp').map((l) => stratum.get(l.atom.pred) ?? 0);
      const s = own.length ? Math.max(...own) : 0;
      strata[s].constraints.push(e);
    }
    if (e.kind !== 'fact') for (const lit of e.body) {
      if (lit.t === 'cmp') {
        collect([lit.left, lit.right]);
        continue;
      }
      collect(lit.atom.args);
    }
  }
  return { ok: true, placed: { program, types, stratum, strata, gatePredicates, routePredicates, fixedPredicates, constants } };
}

/** Tarjan's strongly connected components, iterative, over `nodes` with `edges`. */
function tarjan(nodes: string[], edges: (p: string) => string[]): string[][] {  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let next = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: [string, number][] = [[root, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const [node, ei] = top;
      if (ei === 0) {
        index.set(node, next);
        low.set(node, next);
        next++;
        stack.push(node);
        onStack.add(node);
      }
      const out = edges(node);
      let recursed = false;
      for (let i = ei; i < out.length; i++) {
        const to = out[i];
        if (!index.has(to)) {
          work[work.length - 1][1] = i + 1;
          work.push([to, 0]);
          recursed = true;
          break;
        }
        if (onStack.has(to)) low.set(node, Math.min(low.get(node)!, index.get(to)!));
      }
      if (recursed) continue;
      work.pop();
      if (low.get(node) === index.get(node)) {
        const scc: string[] = [];
        for (let p = stack.pop()!; ; p = stack.pop()!) {
          onStack.delete(p);
          scc.push(p);
          if (p === node) break;
        }
        sccs.push(scc);
      }
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
      }
    }
  }
  return sccs;
}


// ── the evaluator (R-BTN-175) ────────────────────────────────────────────────────────────

/** One ground tuple of a relation. */
export type Tuple = (string | number)[];

/** A rule's first derivation of an atom: the entry id and the body atoms it joined, each a
 * relation key — the canonical proof's nodes (R-BTN-174). */
export interface Derivation {
  entry: string;
  body: { pred: string; tuple: Tuple }[];
}

/** What one evaluation answered. */
export interface Evaluation {
  ok: true;
  /** Every relation the program derives, insertion-ordered, the fixed strata included when
   * the evaluation ran them. */
  relations: Map<string, Tuple[]>;
  /** `derived/1`'s tuples as capability strings. */
  derived: string[];
  /** The matches spent — counted, never timed. */
  matches: number;
  /** The atoms derived. */
  atoms: number;
  /** Each derived atom's first derivation, for the canonical proof. */
  proofs: Map<string, Derivation>;
}

export interface EvaluationRefusal {
  ok: false;
  crossed: 'atoms' | 'matches';
}

/** A relation key, as a proof names one. */
const keyOf = (pred: string, tuple: Tuple) => `${pred}(${tuple.map((x) => (typeof x === 'number' ? x : JSON.stringify(x))).join(',')})`;

/** One evaluation's bounds: which match ceiling applies, and the atom ceiling (the maximal
 * evaluation's; a runner's gate evaluation is bounded by matches alone — its input is smaller
 * than the maximal one's, but a smaller input does not always cost fewer matches). */
export interface EvalBounds {
  matches: number;
  atoms: number | null;
}

/** The bounds of each evaluation kind (R-BTN-175), as the caller names the kind; a test's
 * lowered bounds reach the core only through the test bindings (vitest.config.ts), so the
 * override here is a value the caller computed there. */
export function boundsFor(kind: 'maximal' | 'gate' | 'route', lowered?: Partial<EvalBounds>): EvalBounds {
  const base: EvalBounds = kind === 'maximal'
    ? { matches: BOUNDS.maximalMatches, atoms: BOUNDS.maximalAtoms }
    : { matches: kind === 'gate' ? BOUNDS.gateMatches : BOUNDS.routeMatches, atoms: null };
  return lowered ? { matches: lowered.matches ?? base.matches, atoms: lowered.atoms ?? base.atoms } : base;
}

/** Bind an atom's arguments to a tuple under a substitution, or null when they clash. */
function bind(args: Term[], tuple: Tuple, sub: Map<string, string | number>): Map<string, string | number> | null {
  const out = sub;
  for (const [i, t] of args.entries()) {
    if (t.k === 'var') {
      const held = out.get(t.v);
      if (held === undefined) out.set(t.v, tuple[i]);
      else if (held !== tuple[i]) return null;
    } else if ((t.k === 'const' ? t.v : t.v) !== tuple[i]) return null;
  }
  return out;
}

/** A term's value under a substitution. */
const valueOf = (t: Term, sub: Map<string, string | number>): string | number | undefined => (t.k === 'var' ? sub.get(t.v) : t.v);

/**
 * The evaluator R-BTN-175 fixes: strata in topological order of the dependency graph's
 * strongly connected components, ties by the smallest entry index; within a stratum round 0
 * applies every rule in entry order to the full relations and each later round is semi-naive;
 * a round's new tuples join the relations only when the round ends; in a later round a rule is
 * applied once per positive body literal over the stratum's own predicates — that literal
 * reads the last round's new tuples, earlier literals the tuples from before the round, and
 * later literals every tuple; body literals are taken in the order `bodyOrder` fixed; each
 * relation is scanned in insertion order. `holds` arrives sorted; the fixed strata's facts
 * arrive from `fixed`. Crossing a bound yields nothing — H alone for the gate stratum, which
 * fails closed.
 */
export function evaluate(
  placed: ValidatedProgram,
  holds: string[],
  fixed: Map<string, Tuple[]> | null,
  bounds: EvalBounds,
): Evaluation | EvaluationRefusal {
  const relations = new Map<string, Tuple[]>();
  const proofs = new Map<string, Derivation>();
  const seen = new Set<string>();
  const counter = { matches: 0, atoms: 0 };
  const over = () => counter.matches > bounds.matches || (bounds.atoms != null && counter.atoms > bounds.atoms);

  // Seed: the fixed strata's stored facts (a maximal evaluation runs them itself), then
  // holds, sorted — the only core-formed input a gate evaluation reads. Both are facts the
  // evaluator never re-derives, so their keys enter `seen` and their atoms the counter — a
  // later evaluation reads them exactly once (R-BTN-175: "later evaluations read them as
  // facts"), never twice.
  for (const [p, tuples] of fixed ?? []) {
    relations.set(p, [...tuples]);
    for (const tuple of tuples) {
      const k = keyOf(p, tuple);
      if (!seen.has(k)) {
        seen.add(k);
        counter.atoms++;
      }
    }
  }
  relations.set('holds', [...holds].sort().map((v) => [v] as Tuple));
  for (const t of relations.get('holds')!) {
    const k = keyOf('holds', t);
    if (!seen.has(k)) {
      seen.add(k);
      proofs.set(k, { entry: 'holds', body: [] });
      counter.atoms++;
    }
  }
  if (over()) return { ok: false, crossed: bounds.atoms != null && counter.atoms > bounds.atoms ? 'atoms' : 'matches' };

  /** Insert a tuple, first-derivation only; false when it is already there. */
  const add = (pred: string, tuple: Tuple, derivation: Derivation, into: Map<string, Tuple[]>): boolean => {
    const k = keyOf(pred, tuple);
    if (seen.has(k)) return false;
    seen.add(k);
    proofs.set(k, derivation);
    if (!into.has(pred)) into.set(pred, []);
    into.get(pred)!.push(tuple);
    counter.atoms++;
    return true;
  };

  for (const stratum of placed.strata) {
    // A runner's gate evaluation runs only the gate strata; the fixed strata's tuples arrive
    // from `fixed` as facts (R-BTN-175: "later evaluations read them as facts"), and the
    // route-choice strata are B-105's, over other inputs. A maximal evaluation (fixed null)
    // runs everything. A stratum is fixed exactly when every predicate it writes is fixed —
    // SCCs partition cleanly, so there is no mixed stratum to half-run.
    const preds = new Set<string>([...stratum.facts.map((e) => e.head.pred), ...stratum.rules.map((e) => e.head.pred)]);
    if (fixed && [...preds].every((p) => placed.fixedPredicates.has(p))) continue;
    const own = preds;
    for (const e of [...stratum.facts, ...stratum.rules]) if (!relations.has(e.head.pred)) relations.set(e.head.pred, []);
    // The stratum's facts are inserted in merged entry order before its round 0.
    for (const e of stratum.facts) add(e.head.pred, e.head.args.map((t) => t.v), { entry: e.id, body: [] }, relations);
    // The rules, in entry order, each with its evaluation order fixed once.
    const rules = stratum.rules.map((e) => ({ entry: e, order: bodyOrder(e.body) }));
    // A round's new tuples join the relations only when the round ends, so every rule
    // instance reads atoms produced in earlier rounds (R-BTN-175).
    const runRound = (plan: ((pred: string, pos: number) => Tuple[]) | null): { pred: string; tuple: Tuple }[] | null => {
      const joined: { pred: string; tuple: Tuple }[] = [];
      const pending = new Map<string, Tuple[]>();
      const addRound = (pred: string, tuple: Tuple, derivation: Derivation): boolean => {
        const k = keyOf(pred, tuple);
        if (seen.has(k)) return false;
        seen.add(k);
        proofs.set(k, derivation);
        if (!pending.has(pred)) pending.set(pred, []);
        pending.get(pred)!.push(tuple);
        counter.atoms++;
        return true;
      };
      for (const { entry, order } of rules) {
        for (const head of derive(entry, order, plan, relations, counter)) {
          if (addRound(entry.head.pred, head.tuple, { entry: entry.id, body: head.body })) joined.push({ pred: entry.head.pred, tuple: head.tuple });
        }
        if (over()) return null;
      }
      for (const [p, ts] of pending) {
        if (!relations.has(p)) relations.set(p, []);
        relations.get(p)!.push(...ts);
      }
      return joined;
    };
    // Round 0: every rule applied to the full relations, in entry order.
    const r0 = runRound(null);
    if (r0 === null) return { ok: false, crossed: bounds.atoms != null && counter.atoms > bounds.atoms ? 'atoms' : 'matches' };
    // Later rounds: semi-naive, one application per positive own-predicate literal — that
    // literal reads the last round's new tuples; every other literal reads the relations,
    // which a round's new tuples join only when it ends, so mid-round they are exactly the
    // tuples from before the round (and "every tuple" for the later ones).
    let delta = r0;
    while (delta.length) {
      const carried = delta;
      const round: { pred: string; tuple: Tuple }[] = [];
      const pending = new Map<string, Tuple[]>();
      const addRound = (pred: string, tuple: Tuple, derivation: Derivation): boolean => {
        const k = keyOf(pred, tuple);
        if (seen.has(k)) return false;
        seen.add(k);
        proofs.set(k, derivation);
        if (!pending.has(pred)) pending.set(pred, []);
        pending.get(pred)!.push(tuple);
        counter.atoms++;
        return true;
      };
      // R-BTN-175's semi-naive letter: in a later round the literal at i reads the last
      // round's new tuples, literals BEFORE it the tuples from before that round (the
      // relations the last round's join left — the carried delta is not in them), and later
      // literals every tuple.
      const carriedPreds = new Map<string, Set<string>>();
      for (const d of carried) {
        if (!carriedPreds.has(d.pred)) carriedPreds.set(d.pred, new Set());
        carriedPreds.get(d.pred)!.add(keyOf(d.pred, d.tuple));
      }
      const beforeRound = (pred: string): Tuple[] => {
        const skip = carriedPreds.get(pred);
        return skip ? (relations.get(pred) ?? []).filter((tuple) => !skip.has(keyOf(pred, tuple))) : relations.get(pred) ?? [];
      };
      for (const { entry, order } of rules) {
        const positives = order.filter((o) => o.lit.t === 'atom');
        for (let i = 0; i < positives.length; i++) {
          const lit = positives[i].lit;
          if (lit.t !== 'atom' || !own.has(lit.atom.pred)) continue; // only the stratum's own predicates carry the delta
          const read = (pred: string, pos: number): Tuple[] =>
            pos === i ? carried.filter((d) => d.pred === pred).map((d) => d.tuple) : pos >= 0 && pos < i ? beforeRound(pred) : relations.get(pred) ?? [];
          for (const head of derive(entry, order, read, relations, counter)) {
            if (addRound(entry.head.pred, head.tuple, { entry: entry.id, body: head.body })) round.push({ pred: entry.head.pred, tuple: head.tuple });
          }
          if (over()) return { ok: false, crossed: bounds.atoms != null && counter.atoms > bounds.atoms ? 'atoms' : 'matches' };
        }
      }
      for (const [p, ts] of pending) {
        if (!relations.has(p)) relations.set(p, []);
        relations.get(p)!.push(...ts);
      }
      delta = round;
    }
  }
  const derived = (relations.get('derived') ?? []).map((t) => String(t[0]));
  return { ok: true, relations, derived, matches: counter.matches, atoms: counter.atoms, proofs };
}

/** Walk one rule's evaluation order, answering its head tuples with the body atoms each
 * joined. `read` serves each positive literal's tuples (null: every literal reads the full
 * relations — round 0); a semi-naive application hands the one that reads the last round's
 * new tuples. One tuple tried against one literal, and one comparison or negation test, is
 * one match (R-BTN-175) — counted in `counter`. */
function derive(
  entry: RuleEntry,
  order: { lit: Literal; pos: number }[],
  read: ((pred: string, pos: number) => Tuple[]) | null,
  relations: Map<string, Tuple[]>,
  counter: { matches: number; atoms: number },
): { tuple: Tuple; body: { pred: string; tuple: Tuple }[] }[] {
  const out: { tuple: Tuple; body: { pred: string; tuple: Tuple }[] }[] = [];
  const tuplesOf = (pred: string, pos: number): Tuple[] => (read ? read(pred, pos) : relations.get(pred) ?? []);
  const rec = (i: number, sub: Map<string, string | number>, body: { pred: string; tuple: Tuple }[]) => {
    if (i >= order.length) {
      const tuple = entry.head.args.map((t) => valueOf(t, sub));
      if (tuple.some((x) => x === undefined)) return;
      out.push({ tuple: tuple as Tuple, body: [...body] });
      return;
    }
    const { lit, pos } = order[i];
    if (lit.t === 'cmp') {
      const l = valueOf(lit.left, sub);
      const r = valueOf(lit.right, sub);
      if (l === undefined || r === undefined) return;
      counter.matches++;
      const ok = lit.op === '=' ? l === r : lit.op === '!=' ? l !== r
        : typeof l === 'number' && typeof r === 'number'
          ? (lit.op === '<' ? l < r : lit.op === '<=' ? l <= r : lit.op === '>' ? l > r : l >= r)
          : false;
      if (ok) rec(i + 1, sub, body);
      return;
    }
    if (lit.t === 'not') {
      // Validation guarantees the negated atom's variables are bound by now (bodyOrder placed
      // it at the first place they are), so it grounds against the substitution.
      const ground = lit.atom.args.map((t) => valueOf(t, sub));
      if (ground.some((x) => x === undefined)) return;
      counter.matches++;
      const full = keyOf(lit.atom.pred, ground as Tuple);
      const present = (relations.get(lit.atom.pred) ?? []).some((c) => keyOf(lit.atom.pred, c) === full);
      if (!present) rec(i + 1, sub, body);
      return;
    }
    for (const tuple of tuplesOf(lit.atom.pred, pos)) {
      counter.matches++;
      const next = new Map(sub);
      let clash = false;
      for (const [j, t] of lit.atom.args.entries()) {
        if (t.k === 'var') {
          const held = next.get(t.v);
          if (held === undefined) next.set(t.v, tuple[j]);
          else if (held !== tuple[j]) {
            clash = true;
            break;
          }
        } else if (t.v !== tuple[j]) {
          clash = true;
          break;
        }
      }
      if (!clash) rec(i + 1, next, [...body, { pred: lit.atom.pred, tuple }]);
    }
  };
  rec(0, new Map(), []);
  return out;
}

// ── the maximal evaluation, acceptance's one run (R-BTN-174, R-BTN-175) ──────────────────

/** What acceptance checks on the maximal evaluation: constraints over fixed predicates,
 * condition 4's typed atoms, the 256 limit, and the fixed strata's result. */
export interface MaximalCheck {
  violations: OntologyViolation[];
  /** The fixed predicates' atoms, at most 5,000, to store with the program. */
  fixed: Map<string, Tuple[]>;
  /** The maximal evaluation's derived capabilities (every string constant held). */
  derived: string[];
}

/** Every string constant held — the program's own constants are the only holdings that can
 * take part (condition 2), so this is the largest evaluation any runner's H can drive. */
export function maximalEvaluation(placed: ValidatedProgram, lowered?: Partial<EvalBounds>): { ok: true; check: MaximalCheck } | { ok: false; crossed: 'atoms' | 'matches'; at?: OntologyViolation } {
  const bounds = boundsFor('maximal', lowered);
  const result = evaluate(placed, [...placed.constants], null, bounds);
  if (!result.ok) return result;
  // Constraints over fixed predicates are checked at validation (R-BTN-175): each ranges
  // only over predicates that depend on no core-formed atom, so it is checked here, once.
  const violations: OntologyViolation[] = [];
  for (const stratum of placed.strata) {
    for (const e of stratum.constraints) {
      const violated = constraintHolds(e.body, result.relations);
      if (violated) violations.push({ entry: e.id, rule: 'constraints', message: `the constraint is violated by the maximal evaluation (${violated})` });
    }
  }
  // Condition 4: every derived atom is a string `<type>:<value>` whose type is in the
  // program's `derived` list — and never credential, runner or human-operator (parseOntology
  // refuses those in the list; a derived atom of such a type is refused here).
  const derivedTypes = new Set(placed.program.derived);
  for (const d of result.derived) {
    const m = DERIVED_CAP.exec(d);
    const bad = !m || !derivedTypes.has(m[1]) || m[1] === 'credential' || m[1] === 'runner' || d === 'human-operator';
    if (bad) {
      const entry = result.proofs.get(keyOf('derived', [d]))?.entry ?? null;
      violations.push({ entry, rule: 'gate-stratum', message: `the derived atom "${d}" is not a capability of a declared derived type — condition 4 (R-BTN-175)` });
    }
  }
  if (result.derived.length > BOUNDS.derivedMax) {
    violations.push({ entry: null, rule: 'bounds', message: `the maximal evaluation derives ${result.derived.length} capabilities — at most ${BOUNDS.derivedMax} (R-BTN-174)` });
  }
  // The fixed predicates' result is stored with the program (R-BTN-175).
  const fixed = new Map<string, Tuple[]>();
  let fixedAtoms = 0;
  for (const p of placed.fixedPredicates) {
    const tuples = result.relations.get(p) ?? [];
    fixed.set(p, tuples);
    fixedAtoms += tuples.length;
  }
  if (fixedAtoms > BOUNDS.maximalAtoms) {
    return { ok: false, crossed: 'atoms', at: { entry: null, rule: 'bounds', message: `the fixed predicates derive ${fixedAtoms} atoms — at most ${BOUNDS.maximalAtoms} (R-BTN-175)` } };
  }
  return { ok: true, check: { violations, fixed, derived: result.derived } };
}

/** Whether a constraint's body holds for some substitution — violated when it does. */
function constraintHolds(body: Literal[], relations: Map<string, Tuple[]>): string | null {
  const order = bodyOrder(body);
  let found: string | null = null;
  const rec = (i: number, sub: Map<string, string | number>) => {
    if (found) return;
    if (i >= order.length) {
      found = 'ground';
      return;
    }
    const { lit } = order[i];
    if (lit.t === 'cmp') {
      const l = valueOf(lit.left, sub);
      const r = valueOf(lit.right, sub);
      if (l === undefined || r === undefined) return;
      const ok = lit.op === '=' ? l === r : lit.op === '!=' ? l !== r : typeof l === 'number' && typeof r === 'number'
        ? (lit.op === '<' ? l < r : lit.op === '<=' ? l <= r : lit.op === '>' ? l > r : l >= r)
        : false;
      if (ok) rec(i + 1, sub);
      return;
    }
    const tuples = relations.get(lit.atom.pred) ?? [];
    for (const tuple of tuples) {
      if (lit.t === 'not') {
        const ground = lit.atom.args.map((t) => valueOf(t, sub));
        if (ground.some((x) => x === undefined)) continue;
        const full = keyOf(lit.atom.pred, ground as Tuple);
        if (!(relations.get(lit.atom.pred) ?? []).some((c) => keyOf(lit.atom.pred, c) === full)) rec(i + 1, sub);
        continue;
      }
      const next = new Map(sub);
      if (!bind(lit.atom.args, tuple, next)) continue;
      rec(i + 1, next);
    }
  };
  rec(0, new Map());
  return found;
}

// ── why-not (R-BTN-174's canonical proofs) ───────────────────────────────────────────────

/** A why-not answer: what a derived capability's canonical proof needs. */
export interface WhyNot {
  why: 'not-derived' | 'not-derivable';
  /** The distinct holdings of X's canonical proof in the maximal evaluation, sorted. */
  needs: string[];
  /** Those the asking runner does not declare. */
  missing: string[];
  /** Those it declares that its grant does not admit. */
  ungranted: string[];
  /** The distinct entry ids met in a depth-first walk of the proof from X. */
  chain: string[];
  /** Declaring X directly, where the grant admits it, satisfies it too. */
  direct: boolean;
}

/**
 * Why a runner lacks capability X: walk X's canonical proof in the maximal evaluation — its
 * first derivation's rule instance, then each body atom's, depth-first, each atom once and
 * its body atoms in body order (R-BTN-174). `memoised` carries the maximal evaluation by
 * digest, computed once per program; the answer is advice and stores nothing.
 */
export function whyNot(placed: ValidatedProgram, maximal: Evaluation, declared: Set<string>, granted: Set<string> | null, x: string): WhyNot | null {
  const start = keyOf('derived', [x]);
  if (maximal.proofs.has(start) || (maximal.relations.get('derived') ?? []).some((t) => t[0] === x)) {
    // A proof exists in the maximal evaluation: walk it.
    const needs = new Set<string>();
    const chain: string[] = [];
    const visited = new Set<string>();
    const walk = (k: string) => {
      if (visited.has(k)) return;
      visited.add(k);
      const proof = maximal.proofs.get(k);
      if (!proof) return;
      if (!chain.includes(proof.entry)) chain.push(proof.entry);
      for (const b of proof.body) {
        const bk = keyOf(b.pred, b.tuple);
        if (b.pred === 'holds') {
          needs.add(String(b.tuple[0]));
          continue;
        }
        walk(bk);
      }
    };
    walk(start);
    const all = [...needs].sort();
    return {
      why: 'not-derived',
      needs: all,
      missing: all.filter((c) => !declared.has(c)),
      ungranted: granted ? all.filter((c) => declared.has(c) && !granted.has(c)) : [],
      chain,
      direct: declared.has(x) && (!granted || granted.has(x)),
    };
  }
  // No proof in the maximal evaluation: no holdings derive it under this program.
  return { why: 'not-derivable', needs: [], missing: [], ungranted: [], chain: [], direct: declared.has(x) && (!granted || granted.has(x)) };
}

// ── the program digest (R-BTN-174: RFC 8785 canonical JSON, SHA-256) ─────────────────────

/**
 * SHA-256, pure and synchronous (FIPS 180-4). The digest is protocol-level — the program's
 * digest is what every CLI's post agrees on and what an input digest builds on — so it is
 * computed here, identically on both hosts, without a host crypto API or an async boundary
 * inside a transaction.
 */
export function sha256Hex(text: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(text);
  const l = bytes.length;
  const bitLenHi = Math.floor((l / 0x20000000)) | 0;
  const bitLenLo = (l << 3) >>> 0;
  const withOne = l + 1;
  const total = (((withOne + 8 + 63) / 64) | 0) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLenHi);
  dv.setUint32(total - 4, bitLenLo);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** RFC 8785 canonical JSON: object keys sorted by their UTF-16 code units, numbers by ES6's
 * number-to-string (which RFC 8785 §3.2.2.3's serialization matches for every IEEE double a
 * JSON number can carry; -0 becomes 0, NaN and Infinity never appear in a program). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('a program number is not finite');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** The program a board post carries, re-serialized canonically — the digest every CLI
 * agrees on for the same commit (R-BTN-174). `digest` is the SHA-256 of this text, which the
 * caller computes with the host's crypto (pure here, so both hosts share the canonicalization). */
export function canonicalProgram(program: unknown): string {
  return canonicalJson(program);
}
