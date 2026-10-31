// routes.test.ts — R-BTN-176's atoms and R-BTN-177's resolution, pure (BATON_SPEC §6.10, B-105):
// the atom shapes (field paths, the constant alphabet, the one-clock now), blocked over usable
// instances alone, the first-match ordering over (demoted, position), hysteresis as an input,
// and the store-shaped pieces this repository's own ontology file rides on (codegen,
// reviewer-2, the meters facts and the peak rule). The end-to-end scenarios are
// S-BTN-147..154; the clingo agreement is the conformance suite's.
import { describe, expect, it } from 'vitest';
import { fieldAtoms, nowAtoms, resolveRoutes, routeFacts, type RouteInputs } from '../../src/core/routes';
import { boundsFor, maximalEvaluation, parseOntology, validateOntology } from '../../src/core/ontology';
import { mergeOntology } from '../../src/defaults/ontologyMerge';
import { readFileSync } from 'node:fs';

const parse = (program: unknown) => parseOntology(JSON.parse(JSON.stringify(program)), JSON.stringify(program).length);

/** A minimal program with one route choice and meters facts, as a fixture's. */
const program = {
  version: 1,
  derived: ['capability'],
  entries: [
    { id: 'meters-a', fact: ['meters', 'key:a', 'ra'] },
    { id: 'meters-b', fact: ['meters', 'key:b', 'rb'] },
    { id: 'peak', head: ['peak'], body: [['now', 'utc_minute_of_day', '$t'], { cmp: ['$t', '>=', 120] }, { cmp: ['$t', '<', 600] }] },
  ],
  route_choices: [
    {
      id: 'pick',
      alternatives: [
        { id: 'first', needs: ['model:x', 'key:a'], demote_when: [[['peak']]] },
        { id: 'second', needs: ['model:x', 'key:b'] },
      ],
    },
    { id: 'lone', alternatives: [{ id: 'only', needs: ['capability:none'] }] },
  ],
};

const placedOf = (p: unknown = program) => {
  const validated = validateOntology(parse(p));
  if (!validated.ok) throw new Error(validated.violations[0]?.message ?? 'refused');
  return validated.placed;
};

const fixedOf = (placed: ReturnType<typeof placedOf>) => {
  const max = maximalEvaluation(placed);
  if (!max.ok) throw new Error('maximal crossed');
  return new Map([...max.check.fixed.entries()]);
};

const inputs = (over: Partial<RouteInputs> = {}): RouteInputs => ({
  has: ['model:x', 'key:a', 'key:b'],
  wanted: ['pick'],
  usable: [],
  states: [],
  refines: [],
  details: [],
  now: Date.parse('2026-10-29T00:10:00Z'), // 10 minutes of day: off-peak
  wasDemoted: [],
  ...over,
});

describe('R-BTN-176: the atoms', () => {
  it('a detail forms int, str and flag atoms by dotted path, and nothing else', () => {
    const atoms = fieldAtoms('r@acct:one', {
      n: 5, s: 'model:x', t: true, f: false, nul: null, arr: [1], num: 1.5, big: 2 ** 40,
      deep: { nested: { value: 7 } }, 'BAD-NAME': 1, 'x9': 3,
    });
    expect(atoms).toEqual([
      { pred: 'int', path: 'n', value: 5 },
      { pred: 'str', path: 's', value: 'model:x' },
      { pred: 'flag', path: 't' },
      { pred: 'int', path: 'deep.nested.value', value: 7 },
      { pred: 'int', path: 'x9', value: 3 },
    ]);
  });

  it('a string outside the constant alphabet or over 128 characters forms no atom; a path over 128 or five deep forms none; an instance id outside the syntax forms none', () => {
    expect(fieldAtoms('i', { s: 'has space', long: 'x'.repeat(129) })).toEqual([]);
    expect(fieldAtoms('i', { a: { b: { c: { d: { e: { f: 1 } } } } } })).toEqual([]);
    expect(fieldAtoms('i', { ['x'.repeat(120)]: 1 })).toEqual([]);
    expect(fieldAtoms('has space', { n: 1 })).toEqual([]);
  });

  it('now atoms come from the epoch alone: epoch_min, utc_minute_of_day and utc_weekday (1 is Monday)', () => {
    // 2026-10-29 is a Thursday; 08:30:00Z is minute-of-day 510.
    const t = Date.parse('2026-10-29T08:30:00Z');
    expect(nowAtoms(t)).toEqual([['epoch_min', Math.floor(t / 60_000)], ['utc_minute_of_day', 510], ['utc_weekday', 4]]);
    expect(nowAtoms(Date.parse('2026-10-26T00:00:00Z'))[2][1]).toBe(1); // Monday
    expect(nowAtoms(Date.parse('2026-11-01T23:59:00Z'))).toEqual([['epoch_min', Math.floor(Date.parse('2026-11-01T23:59:00Z') / 60_000)], ['utc_minute_of_day', 1439], ['utc_weekday', 7]]);
  });

  it('blocked(R) holds only when a usable instance exists and every one is unavailable', () => {
    const facts = routeFacts(inputs({
      usable: [['ra', 'ra@one'], ['ra', 'ra@two'], ['rb', 'rb@one']],
      states: [['ra@one', 'unavailable'], ['ra@two', 'unavailable'], ['rb@one', 'unknown']],
    }));
    expect(facts.get('blocked')).toEqual([['ra']]);
    expect(facts.get('state')).toEqual([['ra@one', 'unavailable'], ['ra@two', 'unavailable'], ['rb@one', 'unknown']]);
    // A usable instance with no state row is unknown — absent, never blocking (fails open).
    const open = routeFacts(inputs({ usable: [['rb', 'rb@one']], states: [] }));
    expect(open.get('blocked')).toBeUndefined();
  });
});

describe('R-BTN-177: the resolution', () => {
  it('off-peak the first alternative wins; in peak it is demoted behind every undemoted one', () => {
    const placed = placedOf();
    const offPeak = resolveRoutes(placed, inputs(), fixedOf(placed), undefined);
    expect(offPeak.ok).toBe(true);
    if (!offPeak.ok) return;
    expect(offPeak.choices[0]).toMatchObject({ choice: 'pick', alternative: 'first' });
    expect(offPeak.choices[0].ranked.map((r) => r.alternative)).toEqual(['first', 'second']);
    const inPeak = resolveRoutes(placed, inputs({ now: Date.parse('2026-10-29T08:00:00Z') }), fixedOf(placed), undefined);
    expect(inPeak.ok).toBe(true);
    if (!inPeak.ok) return;
    expect(inPeak.choices[0].alternative).toBe('second');
    expect(inPeak.choices[0].ranked.map((r) => r.alternative)).toEqual(['second', 'first']);
    expect(inPeak.choices[0].ranked[1].demoted).toBe(true);
    // The demotion is written for hysteresis whatever was available.
    expect([...inPeak.demoted]).toEqual(['pick\u0000first']);
  });

  it('an alternative the runner lacks nothing for survives; a blocked resource removes its needs; nothing available answers null with none-available', () => {
    const placed = placedOf();
    const lacks = resolveRoutes(placed, inputs({ has: ['model:x', 'key:a'] }), fixedOf(placed), undefined);
    expect(lacks.ok && lacks.choices[0].alternative).toBe('first'); // second lacks key:b
    const blocked = resolveRoutes(placed, inputs({
      usable: [['ra', 'ra@one']], states: [['ra@one', 'unavailable']],
    }), fixedOf(placed), undefined);
    expect(blocked.ok && blocked.choices[0].alternative).toBe('second'); // first's key:a meters ra
    const none = resolveRoutes(placed, inputs({ has: [] }), fixedOf(placed), undefined);
    expect(none.ok && none.choices[0].alternative).toBeNull();
    expect(none.ok && none.choices[0].reason).toBe('none-available');
    expect(none.ok && none.choices[0].ranked).toEqual([]);
  });

  it('was_demoted holds a demotion between resolutions: a threshold entered below 200 is held below 300', () => {
    // Two rules over the same field: enter below 200, hold below 300 while was_demoted — the
    // hysteresis idiom, as S-BTN-148 drives it end to end.
    const p = {
      version: 1, derived: [],
      entries: [
        { id: 'enter', head: ['near', '$i'], body: [['int', '$i', 'remaining_permille', '$v'], { cmp: ['$v', '<', 200] }] },
        { id: 'hold', head: ['near', '$i'], body: [['int', '$i', 'remaining_permille', '$v'], { cmp: ['$v', '<', 300] }, ['was_demoted', 'rev', 'opus']] },
      ],
      route_choices: [{ id: 'rev', alternatives: [{ id: 'opus', needs: ['key:sub'], demote_when: [[['near', '$i']]] }, { id: 'glm', needs: ['key:zai'] }] }],
    };
    const placed = placedOf(p);
    const base = { has: ['key:sub', 'key:zai'], wanted: ['rev'], usable: [['cap', 'cap@one']], refines: [] as [string, string][] };
    const at500 = resolveRoutes(placed, inputs({ ...base, states: [['cap@one', 'available']], details: [['cap@one', { remaining_permille: 500 }]] }), fixedOf(placed), undefined);
    expect(at500.ok && at500.choices[0].alternative).toBe('opus');
    const at150 = resolveRoutes(placed, inputs({ ...base, states: [['cap@one', 'available']], details: [['cap@one', { remaining_permille: 150 }]] }), fixedOf(placed), undefined);
    expect(at150.ok && at150.choices[0].alternative).toBe('glm');
    // 250 with the demotion remembered: held. 250 without: back to opus.
    const held = resolveRoutes(placed, inputs({ ...base, states: [['cap@one', 'available']], details: [['cap@one', { remaining_permille: 250 }]], wasDemoted: [['rev', 'opus']] }), fixedOf(placed), undefined);
    expect(held.ok && held.choices[0].alternative).toBe('glm');
    const released = resolveRoutes(placed, inputs({ ...base, states: [['cap@one', 'available']], details: [['cap@one', { remaining_permille: 250 }]] }), fixedOf(placed), undefined);
    expect(released.ok && released.choices[0].alternative).toBe('opus');
  });

  it('a crossed match bound answers nothing and names the bound', () => {
    const placed = placedOf();
    const out = resolveRoutes(placed, inputs(), fixedOf(placed), { matches: 0 });
    expect(out).toEqual({ ok: false, crossed: 'matches' });
    void boundsFor;
  });

  it('this repository\'s own ontology merges, validates and resolves: peak demotes OpenCode Go, near_limit demotes Opus', () => {
    const file = JSON.parse(readFileSync('.baton/ontology.json', 'utf8'));
    const merged = mergeOntology(file);
    expect('error' in merged).toBe(false);
    if ('error' in merged) return;
    const placed = placedOf(JSON.parse(JSON.stringify(merged.program)) as Record<string, unknown>);
    const fixed = fixedOf(placed);
    const both = ['codegen', 'reviewer-1', 'reviewer-2'];
    const inPeak = resolveRoutes(placed, inputs({
      has: ['key:opencode-go', 'key:deepinfra', 'model:deepseek-v4.1-flash', 'key:claude-subscription', 'key:zai', 'model:claude-opus-5-5', 'model:glm-5.3'],
      wanted: both,
      now: Date.parse('2026-10-29T08:00:00Z'),
      usable: [['anthropic-capacity', 'anthropic-capacity@acct:main']],
      states: [['anthropic-capacity@acct:main', 'available']],
      refines: [['anthropic-capacity', 'std:api-capacity@1']],
      details: [['anthropic-capacity@acct:main', { remaining_permille: 500 }]],
    }), fixed, undefined);
    expect(inPeak.ok).toBe(true);
    if (!inPeak.ok) return;
    const byChoice = new Map(inPeak.choices.map((c) => [c.choice, c.alternative]));
    expect(byChoice.get('codegen')).toBe('deepinfra'); // ocg_peak: 480 ∈ [360, 600)
    expect(byChoice.get('reviewer-2')).toBe('opus'); // 500‰: no near_limit
    expect(byChoice.get('reviewer-1')).toBe('glm');
    const nearLimit = resolveRoutes(placed, inputs({
      has: ['key:opencode-go', 'key:deepinfra', 'model:deepseek-v4.1-flash', 'key:claude-subscription', 'key:zai', 'model:claude-opus-5-5', 'model:glm-5.3'],
      wanted: both,
      now: Date.parse('2026-10-29T08:00:00Z'),
      usable: [['anthropic-capacity', 'anthropic-capacity@acct:main']],
      states: [['anthropic-capacity@acct:main', 'available']],
      refines: [['anthropic-capacity', 'std:api-capacity@1']],
      details: [['anthropic-capacity@acct:main', { remaining_permille: 150 }]],
    }), fixed, undefined);
    expect(nearLimit.ok && new Map(nearLimit.choices.map((c) => [c.choice, c.alternative])).get('reviewer-2')).toBe('glm');
  });
});
