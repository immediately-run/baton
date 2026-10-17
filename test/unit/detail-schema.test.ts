// detail-schema.test.ts — R-BTN-76's JSON Schema subset (R3-1251): every keyword of the subset
// accepted at registration and enforced on a reading's `detail`; anything outside it — `$ref`,
// `pattern`, `format`, a schema over 4 KB or 6 levels deep — refused at registration.
import { describe, it, expect } from 'vitest';
import { detailProblem, schemaProblem, valueProblem, sameSchema, type Schema } from '../../src/core/detailSchema';

const ok = (schema: Schema, value: unknown) => expect(valueProblem(schema, value)).toBeNull();
const fails = (schema: Schema, value: unknown) => expect(valueProblem(schema, value)).toMatch(/detail/);

describe('R-BTN-76: the schema subset at registration', () => {
  it('accepts every keyword of the subset', () => {
    const schema = {
      type: 'object', required: ['used'], additionalProperties: false,
      properties: {
        used: { type: 'number', minimum: 0, maximum: 100 },
        window: { type: 'string', enum: ['5h', 'week', 'month'], minLength: 1, maxLength: 8 },
        plan: { const: 'go_plus' },
        models: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 4 },
        flag: { type: ['boolean', 'null'] },
        count: { type: 'integer' },
      },
    };
    expect(schemaProblem(schema)).toBeNull();
  });

  it.each([
    ['$ref', { $ref: '#/definitions/x' }],
    ['pattern', { type: 'string', pattern: '^a' }],
    ['format', { type: 'string', format: 'email' }],
    ['a nested $ref', { type: 'object', properties: { a: { $ref: '#' } } }],
    ['an unknown type', { type: 'date' }],
    ['additionalProperties as a schema', { additionalProperties: { type: 'string' } }],
    ['a negative maxLength', { maxLength: -1 }],
    ['an empty enum', { enum: [] }],
    ['not an object', ['type']],
  ])('refuses %s', (_, schema) => {
    expect(schemaProblem(schema)).not.toBeNull();
  });

  it('refuses a schema over 4 KB, and one more than 5 levels deep', () => {
    const big = { type: 'object', properties: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field_${i}`, { type: 'string' }])) };
    expect(schemaProblem(big)).toMatch(/4096 bytes/);
    const nest = (n: number): Schema => (n === 1 ? { type: 'string' } : { type: 'object', properties: { a: nest(n - 1) } });
    expect(schemaProblem(nest(5))).toBeNull();
    expect(schemaProblem(nest(6))).toMatch(/5 levels/);
    expect(schemaProblem({ type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'array', items: {} } } } } })).toMatch(/5 levels/);
  });
});

describe('R-BTN-76: a detail checked against its schema', () => {
  it('type, including integer, number and a list of types', () => {
    ok({ type: 'integer' }, 3);
    fails({ type: 'integer' }, 3.5);
    ok({ type: 'number' }, 3.5);
    fails({ type: 'number' }, '3');
    ok({ type: ['string', 'null'] }, null);
    fails({ type: 'object' }, []);
    fails({ type: 'array' }, {});
  });
  it('properties, required and additionalProperties', () => {
    const s = { type: 'object', required: ['a'], properties: { a: { type: 'string' } }, additionalProperties: false };
    ok(s, { a: 'x' });
    fails(s, {});
    fails(s, { a: 1 });
    fails(s, { a: 'x', b: 1 });
    ok({ type: 'object', properties: { a: { type: 'string' } } }, { a: 'x', b: 1 });
  });
  it('enum and const compare JSON values', () => {
    ok({ enum: [1, 'a', { b: [2] }] }, { b: [2] });
    fails({ enum: [1, 'a'] }, 2);
    ok({ const: { a: 1 } }, { a: 1 });
    fails({ const: { a: 1 } }, { a: 1, b: 2 });
  });
  it('minimum and maximum, minLength and maxLength, minItems and maxItems, items', () => {
    fails({ minimum: 1 }, 0);
    fails({ maximum: 1 }, 2);
    ok({ minimum: 1, maximum: 1 }, 1);
    fails({ minLength: 2 }, 'a');
    fails({ maxLength: 2 }, 'abc');
    ok({ maxLength: 2 }, 'é😀');
    fails({ minItems: 1 }, []);
    fails({ maxItems: 1 }, [1, 2]);
    fails({ items: { type: 'string' } }, ['a', 1]);
  });
  it('a detail over 4 KB is refused; the instance’s schemas are each checked', () => {
    expect(detailProblem([{ type: 'string' }], 'x'.repeat(5000))).toMatch(/4096 bytes/);
    expect(detailProblem([{ type: 'object' }, { type: 'object', required: ['a'] }], {})).toMatch(/required/);
    expect(detailProblem([{ type: 'object' }], { a: 1 })).toBeNull();
  });
  it('two schemas are the same by JSON value, not key order', () => {
    expect(sameSchema({ type: 'object', required: ['a'] }, { required: ['a'], type: 'object' })).toBe(true);
    expect(sameSchema({ type: 'object' }, { type: 'array' })).toBe(false);
  });
});
