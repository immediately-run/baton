// schema.test.ts — R-BTN-108's one validator (B-3): the restricted subset, the pattern grammar
// and its linear-time engine, `$ref`/`x-baton-base` cycles, validation against a schema and every
// base, the inline-value bound, the static refinement check (S-BTN-65's kit half), and the `std:`
// library (R-BTN-110).
import { describe, it, expect } from 'vitest';
import {
  baseChain, checkSchema, checkSchemaSet, compilePattern, parseSchemaId, refinementGaps, unboundedAt, validate,
} from '../../src/shared/schema.mjs';
import { STD, stdSchema } from '../../src/shared/std.mjs';

const resolveWith = (extra: Record<string, Record<string, unknown>>) => (id: string) => extra[id] ?? stdSchema(id);

describe('the pattern grammar (R-BTN-108, R-BTN-149)', () => {
  it('matches anywhere unless anchored, with classes, groups, alternation and bounded repeats', () => {
    const cases: [string, string, boolean][] = [
      ['^[0-9a-f]{40}$', 'a'.repeat(40), true], ['^[0-9a-f]{40}$', 'a'.repeat(41), false], ['ab|cd', 'xcdx', true],
      ['^a+b$', 'aaab', true], ['(a|b)*c', 'zzababc', true], ['^$', '', true], ['^x{2,3}$', 'xxxx', false], ['\\d+', 'a1', true],
      ['[^a-c]', 'abc', false], ['^\\w\\s\\W$', 'a -', true], ['^(?:ab){2}$', 'abab', true], ['^a.c$', 'a\nc', false], ['^é+$', 'éé', true],
    ];
    for (const [p, s, want] of cases) expect([p, s, compilePattern(p)(s)]).toEqual([p, s, want]);
  });

  it('refuses back-references, look-around, lazy and possessive quantifiers, flags, properties, unbounded size', () => {
    for (const p of ['a{2,}', 'a**', 'a{2}{3}', 'a+?', '(a)\\1', '(?=a)', '(?!a)', '(?<n>a)', 'a*?', 'a++', '\\p{L}', '\\bword', '[a', '(a', 'a)', '*a', 'a{2000}', 'a{3,2}', 'x'.repeat(513), '(a{1000}){1000}']) {
      expect(() => compilePattern(p), p).toThrow();
    }
  });

  it('runs in time linear in its input: a pattern that makes a backtracking engine explode finishes at once', () => {
    const start = performance.now();
    expect(compilePattern('^(a*)*b$')('a'.repeat(20_000))).toBe(false);
    expect(compilePattern('(a|a)*c')('a'.repeat(20_000))).toBe(false);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('the subset (R-BTN-108)', () => {
  it('accepts the listed keywords and refuses everything else, naming it', () => {
    expect(checkSchema({ type: 'object', properties: { a: { type: 'string', maxLength: 5, pattern: '^a' } }, required: ['a'], additionalProperties: false })).toEqual([]);
    for (const k of ['oneOf', 'anyOf', 'allOf', 'not', 'if', '$dynamicRef', 'patternProperties']) {
      expect(checkSchema({ [k]: [] }).map((e) => e.path)).toEqual([`/${k}`]);
    }
    expect(checkSchema({ type: 'string', pattern: '(a)\\1' })[0].message).toMatch(/back-reference/);
    expect(checkSchema({ format: 'email' })[0].path).toBe('/format');
    expect(checkSchema({ $ref: 'not-an-id' })[0].path).toBe('/$ref');
    expect(checkSchema({ properties: { a: { 'x-baton-base': 'std:url@1' } } })[0].message).toMatch(/root/);
  });

  it('bounds size and depth', () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 20; i++) deep = { type: 'object', properties: { a: deep } };
    expect(checkSchema(deep).some((e) => /levels deep/.test(e.message))).toBe(true);
    expect(checkSchema({ description: 'x'.repeat(33_000) })).toEqual([{ path: '', message: 'a schema is at most 32768 bytes' }]);
  });

  it('a set resolves every $ref and base, and refuses a cycle through either', () => {
    expect(checkSchemaSet({ 'c:a@1': { $ref: 'c:b@1' }, 'c:b@1': { $ref: 'c:a@1' } }, stdSchema).map((e) => e.message)).toEqual(['a $ref or x-baton-base cycle: c:a@1 → c:b@1 → c:a@1']);
    expect(checkSchemaSet({ 'c:a@1': { 'x-baton-base': 'c:a@1' } }, stdSchema)[0].message).toMatch(/cycle/);
    expect(checkSchemaSet({ 'c:a@1': { $ref: 'c:missing@1' } }, stdSchema)[0].message).toMatch(/not a posted or std: schema/);
    expect(checkSchemaSet({ 'c:a@1': { 'x-baton-base': 'std:url@1', type: 'object' } }, stdSchema)).toEqual([]);
  });

  it('ids are `std:` or `<course>:`, `<name>@<n>`', () => {
    expect(parseSchemaId('roadmap-pr:findings@2')).toEqual({ prefix: 'roadmap-pr', name: 'findings', version: 2 });
    expect(parseSchemaId('std:forge.change@1')).toEqual({ prefix: 'std', name: 'forge.change', version: 1 });
    for (const bad of ['findings@2', 'roadmap:findings', 'roadmap:findings@02', 'Roadmap:x@1', 'a:b@1@2', 3]) expect(parseSchemaId(bad)).toBeNull();
  });
});

describe('validation: the schema and every base (R-BTN-108, G-BTN-91)', () => {
  const CHANGE = 'roadmap-pr:change@1';
  const schemas = {
    [CHANGE]: { 'x-baton-base': 'std:forge.change@1', type: 'object', additionalProperties: false, properties: { ...(STD['std:forge.change@1'].properties as object) }, required: ['repository', 'number', 'head_sha', 'state'] },
  };
  const resolve = resolveWith(schemas);
  const good = { repository: 'docs', number: 7, url: 'https://github.com/o/r/pull/7', head_sha: 'a'.repeat(40), state: 'open' };

  it('a valid value passes; one the refinement accepts but the base refuses fails anyway', () => {
    expect(validate(good, CHANGE, resolve)).toEqual([]);
    const { url: _u, ...noUrl } = good;
    // The refinement does not require url; std:forge.change@1 does — the base's guarantee holds.
    expect(validate(noUrl, CHANGE, resolve)).toEqual([{ path: '/url', message: 'is required' }]);
    expect(baseChain(CHANGE, resolve)).toEqual([CHANGE, 'std:forge.change@1']);
  });

  it('types, bounds, enums, patterns, formats, closed objects, items and $ref', () => {
    const r = resolveWith({
      'c:t@1': { type: 'object', additionalProperties: false, properties: {
        n: { type: 'integer', minimum: 1, exclusiveMaximum: 10 }, s: { type: 'string', minLength: 2, maxLength: 3, pattern: '^[a-z]+$' },
        e: { enum: ['a', 'b'] }, k: { const: { x: 1 } }, at: { type: 'string', format: 'date-time' }, u: { type: 'string', format: 'uri' },
        l: { type: 'array', items: { $ref: 'std:url@1' }, maxItems: 1 }, p: { type: 'array', prefixItems: [{ type: 'boolean' }] },
      } },
    });
    expect(validate({ n: 3, s: 'ab', e: 'a', k: { x: 1 }, at: '2026-10-20T08:00:00Z', u: 'https://x', l: [{ url: 'https://x' }], p: [true] }, 'c:t@1', r)).toEqual([]);
    const bad = validate({ n: 10.5, s: 'A', e: 'c', k: { x: 2 }, at: 'yesterday', u: 'not a uri', l: [{ url: 'https://x' }, {}], p: ['x'], z: 1 }, 'c:t@1', r);
    expect(bad.map((f) => f.path).sort()).toEqual(['/at', '/e', '/k', '/l', '/l/1/url', '/n', '/p/0', '/s', '/s', '/u', '/z'].sort());
  });

  it('date-time is RFC 3339 in range, leap years and leap seconds included (1-B-1)', () => {
    const r = () => ({ type: 'string', format: 'date-time' });
    for (const ok of ['2026-10-20T09:00:00Z', '2024-02-29T23:59:60+05:30', '2026-10-20t09:00:00.123z']) expect([ok, validate(ok, 'x', r)]).toEqual([ok, []]);
    for (const bad of ['9999-99-99T99:99:99Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-20T24:00:00Z', '2026-10-20T09:60:00Z', '2026-10-20T09:00:00+24:00', '2026-00-10T09:00:00Z']) {
      expect([bad, validate(bad, 'x', r).length]).toEqual([bad, 1]);
    }
  });

  it('an unknown schema is an error, never a pass', () => {
    expect(validate({}, 'c:missing@1', stdSchema)).toEqual([{ path: '', message: 'c:missing@1 is not a known schema' }]);
  });
});

describe('bounded work on a $ref fan-out the sync accepts (1-B-0)', () => {
  it('five schemas of 60 properties, each a $ref to the next: the bound, the refinement check and validation all finish at once', () => {
    const S: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 5; i++) {
      const properties: Record<string, unknown> = {};
      for (let k = 0; k < 60; k++) properties[`p${k}`] = i < 4 ? { $ref: `c:s${i + 1}@1` } : { type: 'integer' };
      S[`c:s${i}@1`] = { type: 'object', additionalProperties: false, properties };
    }
    const r = resolveWith(S);
    expect(checkSchemaSet(S, stdSchema)).toEqual([]);
    const start = performance.now();
    expect(unboundedAt('c:s0@1', r)).toBeNull();
    expect(refinementGaps(S['c:s0@1'], S['c:s0@1'], r)).toEqual([{ path: expect.any(String), keyword: '', message: 'too large to compare' }]);
    expect(validate(Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`p${k}`, {}])), 'c:s0@1', r)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('round 1 (A): pattern cost, the bound\'s holes, deep JSON, the subset', () => {
  it('one value\'s patterns share one budget: a base chain of distinct costly patterns is refused, not run for 40 s (1-A-0)', () => {
    const S: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 32; i++) {
      S[`c:s${i}@1`] = { ...(i ? { 'x-baton-base': `c:s${i - 1}@1` } : {}), type: 'array', maxItems: 100, items: { type: 'string', maxLength: 256, pattern: `[a-z]{0,1000}[a-z]{0,${1000 - i}}$` } };
    }
    const start = performance.now();
    const faults = validate(Array(15).fill('a'.repeat(256)), 'c:s31@1', resolveWith(S));
    expect(performance.now() - start).toBeLessThan(5000);
    expect(faults.map((f) => f.message)).toContain('the value\'s patterns cost more than the validator allows');
  });

  it('a root that leaves its type open, and an array open past prefixItems, bound nothing (1-A-1, 1-A-2)', () => {
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': {} }))).toMatch(/any type/);
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': { title: 'x' } }))).toMatch(/any type/);
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': { type: 'array', prefixItems: [{ const: 1 }] } }))).toMatch(/any items/);
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': { type: 'array', prefixItems: [{ const: 1 }], maxItems: 1 } }))).toBeNull();
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': { $ref: 'std:url@1' } }))).toBeNull();
  });

  it('JSON nested past 64 in a schema is refused at the sync, and validation of a too-deep value reports, never throws (1-A-5)', () => {
    let deep: unknown = 0;
    for (let i = 0; i < 3000; i++) deep = [deep];
    expect(checkSchema({ const: deep })).toEqual([{ path: '', message: 'a schema\'s JSON nests at most 64 deep' }]);
    expect(validate(1, 'x', () => ({ const: deep }))).toEqual([{ path: '', message: 'the value is too deep to validate' }]);
  });

  it('$schema and $id are outside the subset (1-A-6)', () => {
    expect(checkSchema({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'x' }).map((e) => e.path)).toEqual(['/$schema', '/$id']);
  });

  it('the refinement check is sound where an open object or extra positions would loosen the base (1-A-4)', () => {
    expect(refinementGaps({ type: 'object' }, { type: 'object', properties: { x: { type: 'string' } } }, stdSchema).map((g) => g.keyword)).toEqual(['properties']);
    expect(refinementGaps({ type: 'object', additionalProperties: true }, { type: 'object', additionalProperties: { type: 'string' } }, stdSchema).map((g) => g.keyword)).toEqual(['additionalProperties']);
    expect(refinementGaps({ type: 'array', prefixItems: [{ type: 'number' }], items: { type: 'string' } }, { type: 'array', items: { type: 'string' } }, stdSchema).map((g) => `${g.path} ${g.keyword}`)).toEqual(['/prefixItems/0 type']);
    // A new property where the base leaves the object open narrows it.
    expect(refinementGaps({ type: 'object', properties: { y: { type: 'number' } } }, { type: 'object' }, stdSchema)).toEqual([]);
  });
});

describe('the inline bound (R-BTN-108)', () => {
  it('stores a value only when its whole chain closes every object and caps every string at 256', () => {
    for (const id of Object.keys(STD)) expect([id, unboundedAt(id, stdSchema)]).toEqual([id, null]);
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': { type: 'object', properties: { a: { type: 'string', maxLength: 10 } } } }))).toMatch(/additionalProperties/);
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } } }))).toMatch(/maxLength/);
    expect(unboundedAt('c:a@1', resolveWith({ 'c:a@1': { type: 'array' } }))).toMatch(/any items/);
  });
});

describe('the refinement check (R-BTN-108; S-BTN-65)', () => {
  const base = STD['std:forge.change@1'];
  it('a refinement that drops a required field of its base is reported, naming `required`', () => {
    const dropped = { ...base, 'x-baton-base': 'std:forge.change@1', required: ['repository', 'number', 'url', 'state'] };
    expect(refinementGaps(dropped, base, stdSchema)).toEqual([{ path: '', keyword: 'required', message: '"head_sha" is required by the base' }]);
    expect(refinementGaps({ ...base, 'x-baton-base': 'std:forge.change@1' }, base, stdSchema)).toEqual([]);
  });

  it('a wider type, a larger enum, a looser bound, a changed pattern or a reopened object is reported', () => {
    const b = { type: 'object', additionalProperties: false, properties: { n: { type: 'integer', maximum: 5 }, s: { type: 'string', pattern: '^a', enum: ['a', 'ab'] } } };
    const gaps = refinementGaps({ type: 'object', properties: { n: { type: 'number', maximum: 9 }, s: { type: 'string', pattern: '^b', enum: ['a', 'ab', 'abc'] }, extra: { type: 'string' } } }, b, stdSchema);
    expect(gaps.map((g) => g.keyword).sort()).toEqual(['additionalProperties', 'additionalProperties', 'enum', 'maximum', 'pattern', 'type'].sort());
  });
});

describe('the std: library (R-BTN-110)', () => {
  it('ships the nine schemas, each inside the subset, closed and bounded', () => {
    expect(Object.keys(STD).sort()).toEqual(['std:decision@1', 'std:effect@1', 'std:forge.change@1', 'std:forge.check@1', 'std:forge.comment@1', 'std:git.commit@1', 'std:git.file@1', 'std:object@1', 'std:url@1']);
    for (const [id, s] of Object.entries(STD)) {
      expect([id, checkSchema(s)]).toEqual([id, []]);
      expect(Object.isFrozen(STD)).toBe(true);
    }
    expect(stdSchema('std:nothing@1')).toBeNull();
    expect(stdSchema('constructor')).toBeNull();
  });
});
