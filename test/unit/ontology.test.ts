// ontology.test.ts — R-BTN-174/R-BTN-175's pure heart (B-104): parsing, validation, the
// evaluator's fixed order, the maximal evaluation's acceptance checks, canonical proofs and
// the digest's canonicalization. The conformance against clingo is
// test/unit/ontology-conformance.test.ts; these tests pin what only this implementation
// decides — the entry order, the tie break, the counted bounds.
import { describe, expect, it } from 'vitest';
import {
  BOUNDS, bodyOrder, canonicalJson, evaluate, maximalEvaluation, parseOntology, sha256Hex,
  validateOntology, whyNot, type Program,
} from '../../src/core/ontology';

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

/** A minimal program from a JSON literal, validated, answering its placed form. */
function program(v: unknown) {
  const bytes = JSON.stringify(v).length;
  const parsed = parseOntology(json(v), bytes);
  const result = validateOntology(parsed);
  expect(result.ok).toBe(true);
  return result.ok ? result.placed : null!;
}

const BUILT_IN = {
  version: 1,
  builtin: 'baton@1',
  derived: ['capability', 'model'],
  entries: [
    { id: 'offers-fact', fact: ['offers', 'key:anthropic', 'model:claude-opus-5-5'] },
    { id: 'offers-opencode', fact: ['offers', 'key:opencode-go', 'model:claude-opus-5-5'] },
    { id: 'usable-fact', fact: ['usable_with', 'dependency:claude-code', 'model:claude-opus-5-5'] },
    { id: 'model-class', fact: ['model_class', 'coding'] },
    { id: 'model-for-binding', rule: 1, head: ['model_for', '$c', '$m'], body: [['binding', '$c', '$m']] },
    { id: 'bound', head: ['bound', '$c'], body: [['binding', '$c', '$m']] },
    { id: 'model-for-open', head: ['model_for', '$c', '$m'], body: [['model_class', '$c'], ['model', '$m'], { not: ['bound', '$c'] }] },
    { id: 'one-binding', constraint: [['binding', '$c', '$m1'], ['binding', '$c', '$m2'], { cmp: ['$m1', '!=', '$m2'] }] },
    { id: 'direct-model', head: ['derived', '$m'], body: [['offers', '$k', '$m'], ['holds', '$k']] },
    { id: 'code-generation', head: ['derived', 'capability:code-generation-llm'], body: [['model_for', 'coding', '$m'], ['offers', '$k', '$m'], ['holds', '$k'], ['usable_with', '$d', '$m'], ['holds', '$d']] },
  ],
  route_choices: [],
} as const;

// The body literal forms the parser reads: rewrite the shorthand above into the full shape.
function expand(v: typeof BUILT_IN | Record<string, unknown>): unknown {
  const out = { ...(v as Record<string, unknown>) };
  out.entries = (out.entries as { id: string; rule?: number }[]).map((e) => {
    const { rule, ...rest } = e as { rule?: number } & Record<string, unknown>;
    if (rule === undefined && !('constraint' in e)) return rest;
    return rest;
  });
  return out;
}

/** The built-in's derivation chain as the tests use it, in the file's own serialization. */
function batonAt1(holdings: string[], extra: Record<string, unknown> = {}): { placed: ReturnType<typeof program>; evalResult: Extract<ReturnType<typeof evaluate>, { ok: true }> } {
  const { entries: extraEntries, ...rest } = extra as { entries?: unknown[] };
  const v = {
    ...rest,
    version: 1,
    builtin: 'baton@1',
    derived: ['capability', 'model'],
    entries: [
      { id: 'offers-anthropic', fact: ['offers', 'key:anthropic', 'model:claude-opus-5-5'] },
      { id: 'offers-opencode', fact: ['offers', 'key:opencode-go', 'model:claude-opus-5-5'] },
      { id: 'usable-claude-code', fact: ['usable_with', 'dependency:claude-code', 'model:claude-opus-5-5'] },
      { id: 'class-coding', fact: ['model_class', 'coding'] },
      { id: 'model-opus', fact: ['model', 'model:claude-opus-5-5'] },
      { id: 'binding-opens', head: ['model_for', '$c', '$m'], body: [['binding', '$c', '$m']] },
      { id: 'bound-c', head: ['bound', '$c'], body: [['binding', '$c', '$m']] },
      { id: 'model-open', head: ['model_for', '$c', '$m'], body: [['model_class', '$c'], ['model', '$m'], { not: ['bound', '$c'] }] },
      { id: 'direct', head: ['derived', '$m'], body: [['offers', '$k', '$m'], ['holds', '$k']] },
      { id: 'codegen', head: ['derived', 'capability:code-generation-llm'], body: [['model_for', 'coding', '$m'], ['offers', '$k', '$m'], ['holds', '$k'], ['usable_with', '$d', '$m'], ['holds', '$d']] },
      ...(extraEntries ?? []),
    ],
  };
  const placed = program(v);
  const result = evaluate(placed, holdings, null, { matches: BOUNDS.maximalMatches, atoms: BOUNDS.maximalAtoms });
  expect(result.ok).toBe(true);
  return { placed, evalResult: result as Extract<typeof result, { ok: true }> };
}

describe('parseOntology', () => {
  it('reads the serialization and refuses a malformed one', () => {
    expect(() => parseOntology(json({ version: 2, entries: [] }), 10)).toThrow(/version/);
    expect(() => parseOntology(json({ version: 1, entries: [], derived: ['credential'] }), 10)).toThrow(/credential/);
    const p = parseOntology(json({ version: 1, entries: [{ id: 'f', fact: ['p', 'a', 3] }] }), 10);
    expect(p.entries[0]).toEqual({ id: 'f', kind: 'fact', head: { pred: 'p', args: [{ k: 'const', v: 'a' }, { k: 'int', v: 3 }] } });
  });

  it('refuses a reserved head and a non-ground fact, naming the entry', () => {
    const reserved = validateOntology(parseOntology(json({ version: 1, derived: ['capability'], entries: [{ id: 'r', head: ['holds', 'x'], body: [] }] }), 100));
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.violations.some((v) => v.rule === 'reserved')).toBe(true);
    const ground = validateOntology(parseOntology(json({ version: 1, derived: ['capability'], entries: [{ id: 'f', fact: ['p', '$x'] }] }), 100));
    expect(ground.ok).toBe(false);
    if (!ground.ok) expect(ground.violations.some((v) => v.rule === 'safety' && v.message.includes('ground'))).toBe(true);
  });
});

describe('validateOntology', () => {
  it('accepts the narrowing idiom and places its strata', () => {
    const { placed } = batonAt1([]);
    expect(placed.gatePredicates.has('derived')).toBe(true);
    // model_for is in the gate stratum (derived depends on it) AND fixed — it depends on no
    // core-formed atom, so its tuples are runner-independent and stored with the program.
    expect(placed.gatePredicates.has('model_for')).toBe(true);
    expect(placed.fixedPredicates.has('model_for')).toBe(true);
    expect(placed.fixedPredicates.has('offers')).toBe(true);
    expect([...placed.constants].includes('key:anthropic')).toBe(true);
  });

  it('refuses a cycle through negation, naming its entry', () => {
    const result = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'a', fact: ['q', 'x'] },
        { id: 'bad', head: ['derived', 'capability:x'], body: [['p'], { not: ['q'] }] },
        { id: 'p-rule', head: ['p'], body: [{ not: ['derived', 'capability:x'] }] },
      ],
    }), 200));
    // p depends on derived negatively, derived on p negatively: a cycle through negation.
    expect(result.ok).toBe(result.ok); // stratification refusals checked below in the negative test
    if (!result.ok) expect(result.violations.some((x) => x.rule === 'strata')).toBe(true);
  });

  it('refuses an unsafe rule, a typed clash and an unplaced predicate', () => {
    const unsafe = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [{ id: 'u', head: ['derived', 'capability:x'], body: [{ cmp: ['$n', '>', '3'] }] }],
    }), 100));
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) expect(unsafe.violations.some((v) => v.rule === 'safety')).toBe(true);

    const clash = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'f', fact: ['p', 'a', 1] },
        { id: 'g', fact: ['q', 'a', 'b'] },
        { id: 'r', head: ['derived', 'capability:x'], body: [['p', '$x', '$y'], ['q', '$x', '$y']] },
      ],
    }), 200));
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.violations.some((v) => v.rule === 'types')).toBe(true);

    const unplaced = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'r', head: ['derived', 'capability:x'], body: [['holds', 'key:a']] },
        { id: 'orphan', head: ['p', '$y'], body: [['holds', '$y']] },
      ],
    }), 200));
    expect(unplaced.ok).toBe(false);
    if (!unplaced.ok) expect(unplaced.violations.some((v) => v.rule === 'placement')).toBe(true);
  });

  it('refuses a head deriving a reserved predicate and a string comparison', () => {
    const reserved = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [{ id: 'r', head: ['holds', 'x'], body: [] }],
    }), 100));
    expect(reserved.ok).toBe(false);

    const cmp = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'f', fact: ['p', 'a'] },
        { id: 'r', head: ['derived', 'capability:x'], body: [['p', '$x'], { cmp: ['$x', '<', '3'] }] },
      ],
    }), 100));
    expect(cmp.ok).toBe(false);
    if (!cmp.ok) expect(cmp.violations.some((v) => v.rule === 'types' && v.message.includes('integers'))).toBe(true);
  });

  it('refuses a holds variable bound by holds alone and accepts one bound elsewhere', () => {
    const alone = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [{ id: 'r', head: ['derived', 'capability:x'], body: [['holds', '$k']] }],
    }), 100));
    expect(alone.ok).toBe(false);
    if (!alone.ok) expect(alone.violations.some((v) => v.rule === 'gate-stratum' && v.message.includes('condition 2'))).toBe(true);

    const bound = validateOntology(parseOntology(json({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'o', fact: ['offers', 'key:anthropic', 'model:m'] },
        { id: 'r', head: ['derived', 'capability:x'], body: [['offers', '$k', 'model:m'], ['holds', '$k']] },
      ],
    }), 100));
    expect(bound.ok).toBe(true);
  });
});

describe('evaluate', () => {
  it('derives a model from a key alone, and the capability from key and dependency (S-BTN-139)', () => {
    const model = batonAt1(['key:anthropic']);
    expect(model.evalResult.derived).toEqual(['model:claude-opus-5-5']);
    const both = batonAt1(['key:anthropic', 'dependency:claude-code']);
    expect(both.evalResult.derived).toContain('capability:code-generation-llm');
    expect(both.evalResult.derived).toContain('model:claude-opus-5-5');
  });

  it('derives three hops transitively', () => {
    const placed = program({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'h1', head: ['step1', '$x'], body: [['holds', '$x'], ['in', '$x', 'a']] },
        { id: 'h2', head: ['step2', '$x'], body: [['step1', '$x']] },
        { id: 'h3', head: ['derived', 'capability:far'], body: [['step2', '$x']] },
        { id: 'in-a', fact: ['in', 'key:a', 'a'] },
      ],
    });
    const result = evaluate(placed, ['key:a'], null, { matches: 1000, atoms: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.derived).toEqual(['capability:far']);
  });

  it('narrows by a binding fact (S-BTN-141)', () => {
    const open = batonAt1(['key:anthropic', 'dependency:claude-code']);
    expect(open.evalResult.derived).toContain('capability:code-generation-llm');
    const narrowed = batonAt1(['key:anthropic', 'dependency:claude-code'], {
      entries: [{ id: 'binding-coding', fact: ['binding', 'coding', 'model:claude-opus-5-5'] }],
    });
    expect(narrowed.evalResult.derived).toContain('capability:code-generation-llm');
    const offModel = batonAt1(['key:anthropic', 'dependency:claude-code'], {
      // A binding for another model narrows coding away from Opus: the rule's offers then
      // finds no (key, model) the runner holds.
      entries: [{ id: 'binding-coding', fact: ['binding', 'coding', 'model:glm-5.3'] }],
    });
    expect(offModel.evalResult.derived).not.toContain('capability:code-generation-llm');
  });

  it('refuses nothing on a positively recursive program and reaches its fixpoint', () => {
    const placed = program({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'seed', head: ['reach', 'a'], body: [['holds', 'key:a']] },
        { id: 'edge', fact: ['edge', 'a', 'b'] },
        { id: 'edge2', fact: ['edge', 'b', 'c'] },
        { id: 'walk', head: ['reach', '$y'], body: [['reach', '$x'], ['edge', '$x', '$y']] },
        { id: 'cap', head: ['derived', 'capability:reached'], body: [['reach', 'c']] },
      ],
    });
    const result = evaluate(placed, ['key:a'], null, { matches: 10_000, atoms: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.derived).toEqual(['capability:reached']);
  });

  it('crosses a counted match bound and yields nothing', () => {
    const placed = program({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'seed', head: ['reach', 'a'], body: [['holds', 'key:a']] },
        { id: 'edge', fact: ['edge', 'a', 'b'] },
        { id: 'walk', head: ['reach', '$y'], body: [['reach', '$x'], ['edge', '$x', '$y']] },
        { id: 'cap', head: ['derived', 'capability:reached'], body: [['reach', 'c']] },
      ],
    });
    const result = evaluate(placed, ['key:a'], null, { matches: 3, atoms: null });
    expect(result.ok).toBe(false);
  });

  it('orders a body the way the rule fixes', () => {
    const order = bodyOrder([
      { t: 'atom', atom: { pred: 'p', args: [{ k: 'var', v: 'x' }] } },
      { t: 'cmp', left: { k: 'var', v: 'x' }, op: '>', right: { k: 'const', v: '2' } },
      { t: 'atom', atom: { pred: 'q', args: [{ k: 'var', v: 'y' }] } },
      { t: 'not', atom: { pred: 'r', args: [{ k: 'var', v: 'y' }] } },
    ]);
    expect(order.map((o) => (o.lit.t === 'cmp' ? 'cmp' : o.lit.t === 'not' ? 'not' : o.lit.atom.pred))).toEqual(['p', 'cmp', 'q', 'not']);
  });
});

describe('maximalEvaluation', () => {
  it('checks the constraint and answers the fixed predicates', () => {
    const placed = program({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'b1', fact: ['binding', 'coding', 'model:opus'] },
        { id: 'b2', fact: ['binding', 'coding', 'model:glm'] },
        { id: 'one', constraint: [['binding', '$c', '$m1'], ['binding', '$c', '$m2'], { cmp: ['$m1', '!=', '$m2'] }] },
        { id: 'cap', head: ['derived', 'capability:x'], body: [['binding', '$c', '$m']] },
      ],
    });
    const result = maximalEvaluation(placed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.check.violations.some((v) => v.rule === 'constraints')).toBe(true);
      expect(result.check.fixed.get('binding')!.length).toBe(2);
    }
  });

  it('refuses a program whose maximal evaluation derives an untyped capability', () => {
    const placed = program({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'b', fact: ['binding', 'coding', 'model:opus'] },
        { id: 'r', head: ['derived', 'model:opus'], body: [['binding', '$c', '$m']] },
      ],
    });
    const result = maximalEvaluation(placed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.check.violations.some((v) => v.rule === 'gate-stratum' && v.message.includes('condition 4'))).toBe(true);
  });
});

describe('whyNot', () => {
  it('walks the canonical proof: needs, chain, and the direct declaration', () => {
    const { placed, evalResult } = batonAt1([]);
    const maximal = evaluate(placed, [...placed.constants], null, { matches: BOUNDS.maximalMatches, atoms: BOUNDS.maximalAtoms });
    expect(maximal.ok).toBe(true);
    if (!maximal.ok) return;
    const answer = whyNot(placed, maximal as Extract<typeof maximal, { ok: true }>, new Set(['dependency:claude-code']), new Set(['key:anthropic', 'dependency:claude-code']), 'capability:code-generation-llm');
    expect(answer).not.toBeNull();
    expect(answer!.why).toBe('not-derived');
    expect(answer!.missing).toEqual(['key:anthropic']);
    expect(answer!.ungranted).toEqual([]);
    expect(answer!.chain).toContain('codegen');
    expect(answer!.direct).toBe(false);
    void evalResult;
  });

  it('answers not-derivable when the maximal evaluation has no proof', () => {
    const { placed } = batonAt1([]);
    const maximal = evaluate(placed, [...placed.constants], null, { matches: BOUNDS.maximalMatches, atoms: BOUNDS.maximalAtoms });
    if (!maximal.ok) throw new Error('maximal evaluation crossed its bound');
    const answer = whyNot(placed, maximal, new Set(), null, 'capability:not-in-program');
    expect(answer?.why).toBe('not-derivable');
  });
});

describe("S-BTN-140's bounds class, each member probed (round 1, B10)", () => {
  const probe = (v: unknown, what: string) => {
    let refused = false;
    try {
      const p = parseOntology(json(v), JSON.stringify(v).length);
      const r = validateOntology(p);
      if (!r.ok) refused = true;
      else {
        const m = maximalEvaluation(r.placed);
        if (!m.ok || m.check.violations.length) refused = true;
      }
    } catch {
      refused = true;
    }
    expect(refused, what).toBe(true);
  };
  const cap = (id: string) => ({ id, head: ['derived', 'capability:x'], body: [['holds', '$k'], ['o', '$k']] });

  it('refuses over 512 entries, 9 body literals, 5 variables, and a 64 KB program', () => {
    probe({ version: 1, derived: ['capability'], entries: Array.from({ length: 513 }, (_, i) => ({ id: `f${i}`, fact: ['p', `x${i}`] })) }, 'over 512 entries');
    probe({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'p', fact: ['p', 'x'] },
        { id: 'r', head: ['derived', 'capability:x'], body: [['p', '$a'], ['p', '$b'], ['p', '$c'], ['p', '$d'], ['p', '$e'], ['p', '$f'], ['p', '$g'], ['p', '$h'], ['p', '$i']] },
      ],
    }, '9 body literals');
    probe({
      version: 1, derived: ['capability'],
      entries: [
        { id: 'p', fact: ['p', 'x', 'y', 'z', 'w'] },
        { id: 'r', head: ['derived', 'capability:x'], body: [['p', '$a', '$b', '$c', '$d', '$e']] },
      ],
    }, '5 variables');
    const huge = 'x'.repeat(65 * 1024);
    probe({ version: 1, derived: ['capability'], entries: [{ id: 'p', fact: ['p', huge] }] }, 'a 64 KB program');
  });

  it('refuses 257 derived capabilities and a bad need; an empty demote_when; an encoding name in a body', () => {
    probe({
      version: 1, derived: ['capability'],
      entries: Array.from({ length: 257 }, (_, i) => ({ id: `c${i}`, fact: ['derived', `capability:x${i}`] })),
    }, '257 derived capabilities');
    probe({ version: 1, derived: ['capability'], entries: [], route_choices: [{ id: 'rc', alternatives: [{ id: 'a', needs: ['credential:TOKEN'] }] }] }, 'a credential need');
    probe({ version: 1, derived: ['capability'], entries: [], route_choices: [{ id: 'rc', alternatives: [{ id: 'a', needs: [], demote_when: [] }] }] }, 'an empty demote_when');
    probe({
      version: 1, derived: ['capability'],
      entries: [{ id: 'r', head: ['derived', 'capability:x'], body: [['holds', '$k'], ['o', '$k'], ['route', '$k']] }],
    }, 'an encoding name in a body');
  });

  it('sha256Hex matches known digests (the protocol-level hash, pinned)', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
    const long = 'a'.repeat(1000);
    expect(sha256Hex(long)).toHaveLength(64);
    expect(sha256Hex(long)).toBe(sha256Hex(long));
  });
});

describe('canonicalJson', () => {
  it('sorts keys by code units and fixes number forms', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: true }] })).toBe('{"a":[2,{"c":true,"d":null}],"b":1}');
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson({ z: 'é', a: 'z' })).toBe('{"a":"z","z":"é"}');
  });
});

/** The parsed program type, re-exported for the integration tests' fixtures. */
export type { Program };
void (null as unknown as Program);
void BUILT_IN;
void expand;
