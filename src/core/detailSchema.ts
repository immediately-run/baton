// detailSchema.ts — the JSON Schema subset an external resource's readings' `detail` must satisfy
// (BATON_SPEC §2g R-BTN-76; R3-1251). Interpreted here, never compiled: a Worker may not `eval`,
// so no code generation. Exactly the keywords `type`, `properties`, `required`,
// `additionalProperties` (a boolean), `items`, `enum`, `const`, `minimum`, `maximum`, `minLength`,
// `maxLength`, `minItems`, `maxItems` and `x-baton-base` (the root alone, naming a `std:` schema:
// R-BTN-176); a schema of at most 4 KB and 5 levels. Anything else — `$ref`, `pattern`, `format`,
// a keyword this list lacks — is refused at registration. Pure.

/** R-BTN-76's bounds on a schema and on a `detail`. */
export const SCHEMA_MAX_BYTES = 4096;
export const SCHEMA_MAX_DEPTH = 5;
export const DETAIL_MAX_BYTES = 4096;

const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'x-baton-base']);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** A schema id as `x-baton-base` names one (R-BTN-175's shape, checked here without importing the
 *  output-schema machinery: `<name>@<version>`). */
const SCHEMA_ID = /^[a-z][a-z0-9:._-]*@[0-9]+$/;

export type Schema = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** Why `schema` is outside the subset, or null when it is inside. */
export function schemaProblem(schema: unknown): string | null {
  if (bytes(schema) > SCHEMA_MAX_BYTES) return `is over ${SCHEMA_MAX_BYTES} bytes`;
  return problemAt(schema, '#', 1);
}

function problemAt(s: unknown, at: string, depth: number): string | null {
  if (depth > SCHEMA_MAX_DEPTH) return `${at}: is more than ${SCHEMA_MAX_DEPTH} levels deep`;
  if (!isObj(s)) return `${at}: must be an object`;
  for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) return `${at}: ${k} is not in the subset`;
  if (s['x-baton-base'] !== undefined) {
    if (at !== '#') return `${at}.x-baton-base: is the root schema's only`;
    if (typeof s['x-baton-base'] !== 'string' || !SCHEMA_ID.test(s['x-baton-base'])) return `${at}.x-baton-base: names a std: schema as <id>@<version>`;
  }
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.length || !types.every((t) => typeof t === 'string' && TYPES.has(t))) return `${at}.type: must name JSON types`;
  }
  if (s.properties !== undefined) {
    if (!isObj(s.properties)) return `${at}.properties: must be an object`;
    for (const [name, sub] of Object.entries(s.properties)) {
      const p = problemAt(sub, `${at}.properties.${name}`, depth + 1);
      if (p) return p;
    }
  }
  if (s.required !== undefined && !(Array.isArray(s.required) && s.required.every((r) => typeof r === 'string'))) return `${at}.required: must list names`;
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') return `${at}.additionalProperties: must be a boolean`;
  if (s.items !== undefined) {
    const p = problemAt(s.items, `${at}.items`, depth + 1);
    if (p) return p;
  }
  if (s.enum !== undefined && !(Array.isArray(s.enum) && s.enum.length > 0)) return `${at}.enum: must be a non-empty list`;
  for (const k of ['minimum', 'maximum'] as const) if (s[k] !== undefined && !(typeof s[k] === 'number' && Number.isFinite(s[k]))) return `${at}.${k}: must be a number`;
  for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) if (s[k] !== undefined && !isCount(s[k])) return `${at}.${k}: must be a non-negative integer`;
  return null;
}

/** JSON equality of two parsed values (for `enum` and `const`). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return false;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function hasType(v: unknown, t: string): boolean {
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeOf(v) === t;
}

/** Why `value` fails `schema` (a schema `schemaProblem` accepted), or null when it passes. */
export function valueProblem(schema: Schema, value: unknown, at = 'detail'): string | null {
  const s = schema;
  if (s.type !== undefined) {
    const types = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
    if (!types.some((t) => hasType(value, t))) return `${at}: must be ${types.join(' or ')}`;
  }
  if (s.const !== undefined && !same(value, s.const)) return `${at}: must equal the schema's const`;
  if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => same(value, e))) return `${at}: must be one of the schema's enum`;
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) return `${at}: must be at least ${s.minimum}`;
    if (typeof s.maximum === 'number' && value > s.maximum) return `${at}: must be at most ${s.maximum}`;
  }
  if (typeof value === 'string') {
    const n = [...value].length;
    if (typeof s.minLength === 'number' && n < s.minLength) return `${at}: must be at least ${s.minLength} characters`;
    if (typeof s.maxLength === 'number' && n > s.maxLength) return `${at}: must be at most ${s.maxLength} characters`;
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) return `${at}: must have at least ${s.minItems} items`;
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) return `${at}: must have at most ${s.maxItems} items`;
    if (isObj(s.items)) {
      for (const [i, x] of value.entries()) {
        const p = valueProblem(s.items, x, `${at}[${i}]`);
        if (p) return p;
      }
    }
  }
  if (isObj(value)) {
    const props = isObj(s.properties) ? s.properties : {};
    for (const r of (s.required as string[] | undefined) ?? []) if (!Object.hasOwn(value, r)) return `${at}.${r}: is required`;
    for (const [k, x] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) {
        const p = valueProblem(props[k] as Schema, x, `${at}.${k}`);
        if (p) return p;
      } else if (s.additionalProperties === false) {
        return `${at}.${k}: is not allowed`;
      }
    }
  }
  return null;
}

/** Why `detail` fails every one of `schemas` — the served resources share one, so it is any — or
 *  is too large; null when it passes. */
export function detailProblem(schemas: Schema[], detail: unknown): string | null {
  if (bytes(detail) > DETAIL_MAX_BYTES) return `detail: is over ${DETAIL_MAX_BYTES} bytes`;
  for (const s of schemas) {
    const p = valueProblem(s, detail);
    if (p) return p;
  }
  return null;
}

/** Two registered schemas are the same schema (R-BTN-76: an instance's resources share one). */
export function sameSchema(a: Schema, b: Schema): boolean {
  return same(a, b);
}

/**
 * R-BTN-176: the `x-baton-base` chain a schema names — the base it refines, then that base's own
 * base, outermost first, stopping at a schema that names none (or that `resolve` does not know,
 * which registration refuses first). `sameSchema` compares schemas without the keyword's chain:
 * re-registering with the same schema is idempotent, and the chain lives beside it.
 */
export function baseChainOf(schema: Schema, resolve: (id: string) => Schema | null): string[] {
  const out: string[] = [];
  let base = typeof schema['x-baton-base'] === 'string' ? schema['x-baton-base'] as string : null;
  while (base && !out.includes(base) && out.length < 64) {
    out.push(base);
    const next = resolve(base);
    base = next && typeof next['x-baton-base'] === 'string' ? next['x-baton-base'] as string : null;
  }
  return out;
}
