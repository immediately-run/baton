// ontology-asp.ts — the reference semantics' side of B-104's conformance (BATON_SPEC §5.9,
// R-BTN-175): translate a merged program to ASP-Core-2 text, so `npm test` can check core's
// evaluator against clingo on every fixture under `test/fixtures/ontology/`. Course code in
// name only: `src/defaults/` is exempt from the boundary test, and core imports nothing here —
// the test alone reads this, in vitest's Node project (`clingo-wasm` needs `worker_threads`).
import type { Entry, Literal, Program, RouteChoice, Term } from '../core/ontology';

/** A term as ASP-Core-2 writes it: constants as quoted strings, `$m` as `V_m` (R-BTN-175). */
const term = (t: Term): string => (t.k === 'var' ? `V_${t.v}` : typeof t.v === 'number' ? String(t.v) : JSON.stringify(t.v));

/** An atom: `pred(args…)`, or the bare `pred` when it has none (ASP-Core-2 writes a 0-ary
 * atom without parentheses — `peak()`, as a naive join would emit, does not parse). */
const atom = (pred: string, args: Term[]): string => (args.length ? `${pred}(${args.map(term).join(',')})` : pred);

const literal = (l: Literal): string => {
  if (l.t === 'atom') return atom(l.atom.pred, l.atom.args);
  if (l.t === 'not') return `not ${atom(l.atom.pred, l.atom.args)}`;
  return `${term(l.left)} ${l.op} ${term(l.right)}`;
};

const body = (lits: Literal[]): string => lits.map(literal).join(';');

/** One entry as a program statement. Facts of `holds` arrive as input facts instead (the
 * harness adds the fixture's holdings), so a repository entry never writes them. */
const entry = (e: Entry): string => {
  if (e.kind === 'fact') return `${atom(e.head.pred, e.head.args)}.`;
  if (e.kind === 'constraint') return `:- ${body(e.body)}.`;
  return `${atom(e.head.pred, e.head.args)} :- ${body(e.body)}.`;
};

/** R-BTN-177's encoding prelude for one route choice, as the reference semantics writes it:
 * facts `alt/3` and `alt_needs/3`, a rule per guard, and the fixed prelude. */
const routeChoice = (rc: RouteChoice): string => {
  const out: string[] = [];
  rc.alternatives.forEach((a, i) => {
    out.push(`alt(${JSON.stringify(rc.id)},${JSON.stringify(a.id)},${i + 1}).`);
    for (const n of a.needs) out.push(`alt_needs(${JSON.stringify(rc.id)},${JSON.stringify(a.id)},${JSON.stringify(n)}).`);
  });
  for (const a of rc.alternatives) {
    for (const g of a.demote_when ?? []) out.push(`demoted(${JSON.stringify(rc.id)},${JSON.stringify(a.id)}) :- ${body(g)}.`);
    for (const g of a.exclude_when ?? []) out.push(`excluded(${JSON.stringify(rc.id)},${JSON.stringify(a.id)}) :- ${body(g)}.`);
  }
  out.push('lacks(C,A) :- alt_needs(C,A,K), not has(K).');
  out.push('blocked_alt(C,A) :- alt_needs(C,A,K), meters(K,R), blocked(R).');
  out.push('available(C,A) :- wanted(C), alt(C,A,P), not lacks(C,A), not blocked_alt(C,A), not excluded(C,A).');
  out.push('1 <= { route(C,A) : available(C,A) } <= 1 :- wanted(C), available(C,X).');
  out.push(`:~ route(C,A), demoted(C,A). [1@2,C,A]`);
  out.push(`:~ route(C,A), alt(C,A,P). [P@1,C,A]`);
  return out.join('\n');
};

/** The whole program as ASP-Core-2 text: entries in merged order, the route choices' encoding
 * after them. What a fixture's `derived/1` is checked against is the evaluator's own answer;
 * this text is what clingo computes it from. */
export function toAsp(program: Program, holdings: string[]): string {
  const parts: string[] = [];
  for (const e of program.entries) parts.push(entry(e));
  for (const rc of program.routeChoices) parts.push(routeChoice(rc));
  for (const h of holdings) parts.push(`holds(${JSON.stringify(h)}).`);
  return parts.join('\n');
}

/** R-BTN-175's harness-only shows, one per kind of check: the gate fixtures show `derived/1`,
 * the route-choice fixtures `route/2`, `available/2` and `demoted/2` (R-BTN-177) — each its own
 * `#show` statement, as ASP-Core-2 asks. */
export const SHOW_GATE = 'derived/1.';
export const SHOW_ROUTES = 'route/2. #show available/2. #show demoted/2.';
