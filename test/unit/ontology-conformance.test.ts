// ontology-conformance.test.ts — R-BTN-175's conformance (B-104): core's evaluator agrees
// with clingo on every fixture under `test/fixtures/ontology/` (G-BTN-160), and a refused
// fixture is refused by the validator. Node project only: `clingo-wasm` needs
// `worker_threads`, and clingo never runs on a host (R-BTN-68's posture).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, it, expect } from 'vitest';
import { maximalEvaluation, parseOntology, validateOntology, evaluate, boundsFor } from '../../src/core/ontology';
import { SHOW_GATE, toAsp } from '../../src/defaults/ontology-asp';
import { mergeOntology } from '../../src/defaults/ontologyMerge';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'ontology');
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'refused.json');
const refused = JSON.parse(readFileSync(join(DIR, 'refused.json'), 'utf8')) as { name: string; program: Record<string, unknown> }[];

/** clingo-wasm's `run`, initialised once (it compiles the module). */
let clingo: ((program: string, models: number, args?: string[]) => Promise<ClingoOut>) | null = null;
/** clingo-wasm's answer, the fields the suite reads (its result type omits `Models.Optimal`,
 * which R-BTN-177's fixtures will read through a cast). */
interface ClingoOut {
  Result: string;
  Solver?: string;
  Warnings?: string[];
  Models?: { More: string; Number: number; Optimal?: number };
  Call?: { Witnesses?: { Value: string[] }[] }[];
}
beforeAll(async () => {
  const m = await import('clingo-wasm');
  await m.init();
  clingo = m.run as typeof clingo;
});

const parse = (program: Record<string, unknown>) => parseOntology(JSON.parse(JSON.stringify(program)), JSON.stringify(program).length);

it.each(fixtures.map((f) => [f]))('conformance: %s agrees with clingo and the evaluator', async (file) => {
  const fixture = JSON.parse(readFileSync(join(DIR, file as string), 'utf8')) as {
    program: Record<string, unknown>;
    holdings: string[];
    derived: string[];
  };
  expect(() => parse(fixture.program)).not.toThrow();
  const parsed = parse(fixture.program);
  const validated = validateOntology(parsed);
  expect(validated.ok).toBe(true);
  if (!validated.ok) return;
  // The maximal evaluation accepts (constraints, condition 4, the 256 limit).
  const maximal = maximalEvaluation(validated.placed);
  expect(maximal.ok).toBe(true);
  if (maximal.ok) expect(maximal.check.violations).toEqual([]);
  // The evaluator's answer for this fixture's holdings…
  const mine = evaluate(validated.placed, fixture.holdings, null, boundsFor('gate'));
  expect(mine.ok).toBe(true);
  if (!mine.ok) return;
  expect([...mine.derived].sort()).toEqual([...fixture.derived].sort());
  // …equals clingo's, on the translated program: one answer set, its derived/1 atoms exactly.
  const text = `${toAsp(parsed, fixture.holdings)}\n#show ${SHOW_GATE}`;
  const out = await clingo!(text, 0);
  expect(out.Result).toBe('SATISFIABLE');
  expect(out.Models?.More).toBe('no');
  const atoms = (out.Call?.[0]?.Witnesses?.at(-1) ?? { Value: [] as string[] }).Value
    .filter((v) => v.startsWith('derived('))
    .map((v) => v.replace(/^derived\("/, '').replace(/"\)$/, ''))
    .sort();
  expect(atoms).toEqual([...mine.derived].sort());
  // The only warnings, once empty strings are dropped, are clingo's two info notices — each
  // wrapping onto a second line with the atom it names — so the joined text with those notices
  // (and their continuations) removed is empty.
  const joined = (out.Warnings ?? []).join('\n').replace(/\n+/g, '\n');
  const notices = /-:?\d+:\d+-\d+: info: (atom does not occur in any rule head|no atoms over signature occur in program):\n[^\n]*/g;
  expect(joined.replace(notices, '').trim()).toEqual('');
});

it('a refused fixture is refused by the validator, naming its entry and rule', () => {
  expect(refused.length).toBeGreaterThan(0);
  for (const { name, program } of refused) {
    let violation: string | null = null;
    try {
      const parsed = parse(program);
      const validated = validateOntology(parsed);
      violation = validated.ok ? `${name}: validation accepted it` : null;
      if (validated.ok) {
        const maximal = maximalEvaluation(validated.placed);
        violation = maximal.ok && !maximal.check.violations.length ? `${name}: the maximal evaluation accepted it` : null;
      }
    } catch (e) {
      violation = e instanceof Error ? e.message : String(e);
    }
    expect(violation, `${name} must be refused`).toBeNull();
  }
});

it('the strict-syntax parser accepts every emitted program and rejects a production outside the fragment', async () => {
  const { parseAsp } = await import('../../src/defaults/ontology-asp-grammar');
  for (const file of fixtures) {
    const fixture = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as { program: Record<string, unknown>; holdings: string[] };
    const text = toAsp(parse(fixture.program), fixture.holdings);
    expect(() => parseAsp(text), file).not.toThrow();
  }
  // A production outside R-BTN-175's fragment fails the parser: disjunction, an aggregate the
  // fragment lacks, a function symbol.
  expect(() => parseAsp('a(X) | b(X) :- c(X).')).toThrow();
  expect(() => parseAsp('a(X) :- #count{ Y : c(X,Y) } > 1.')).toThrow();
  expect(() => parseAsp('a(f(X)) :- c(X).')).toThrow();
});

it('the merge: baton@1 with a retraction, a replacement, an extension and a derived type', () => {
  const file = {
    version: 1, builtin: 'baton@1', retract: ['model-haiku'],
    derived: ['capability', 'model', 'scale'],
    entries: [
      { id: 'offers-key-opus', fact: ['offers', 'key:anthropic', 'model:claude-opus-5-6'] },
      { id: 'scale-rule', head: ['derived', 'scale:large'], body: [['model', '$m'], ['holds', 'key:anthropic']] },
    ],
    route_choices: [],
  };
  const merged = mergeOntology(file);
  expect('error' in merged).toBe(false);
  if ('error' in merged) return;
  // The replaced entry keeps its built-in position; the extension follows; the retraction is gone.
  const entries = merged.program.entries as { id: string }[];
  expect(entries.find((e) => e.id === 'offers-key-opus')).toBeDefined();
  expect(entries.find((e) => e.id === 'model-haiku')).toBeUndefined();
  expect(entries.at(-1)?.id).toBe('scale-rule');
  expect(merged.program.derived).toContain('scale');
  // The merged program still validates.
  const parsed = parse(merged.program);
  expect(validateOntology(parsed).ok).toBe(true);
});

it('the merge refuses a missing version, a kind change, an unknown retraction and a retracted reuse', () => {
  expect('error' in mergeOntology({ version: 1, builtin: 'baton@9', entries: [] })).toBe(true);
  expect('error' in mergeOntology({ version: 1, builtin: 'baton@1', entries: [{ id: 'model-opus', head: ['p', 'x'], body: [] }], route_choices: [] })).toBe(true);
  expect('error' in mergeOntology({ version: 1, builtin: 'baton@1', retract: ['no-such-entry'], entries: [] })).toBe(true);
  expect('error' in mergeOntology({ version: 1, builtin: 'baton@1', retract: ['model-opus'], entries: [{ id: 'model-opus', fact: ['model', 'model:claude-opus-5-5'] }], route_choices: [] })).toBe(true);
});

it('baton@1 itself validates and its chains derive (S-BTN-139)', () => {
  const builtIn = mergeOntology({ version: 1, builtin: 'baton@1', entries: [], route_choices: [] });
  expect('error' in builtIn).toBe(false);
  if ('error' in builtIn) return;
  const parsed = parse(builtIn.program);
  const validated = validateOntology(parsed);
  expect(validated.ok).toBe(true);
  if (!validated.ok) return;
  const maximal = maximalEvaluation(validated.placed);
  expect(maximal.ok).toBe(true);
  if (maximal.ok) expect(maximal.check.violations).toEqual([]);
  const opusChain = evaluate(validated.placed, ['key:anthropic', 'dependency:claude-code'], null, boundsFor('gate'));
  expect(opusChain.ok).toBe(true);
  if (opusChain.ok) {
    expect(opusChain.derived).toContain('capability:code-generation-llm');
    expect(opusChain.derived).toContain('model:claude-opus-5-5');
  }
  const keyAlone = evaluate(validated.placed, ['key:anthropic'], null, boundsFor('gate'));
  expect(keyAlone.ok).toBe(true);
  if (keyAlone.ok) {
    expect(keyAlone.derived).toContain('model:claude-opus-5-5');
    expect(keyAlone.derived).not.toContain('capability:code-generation-llm');
  }
});
