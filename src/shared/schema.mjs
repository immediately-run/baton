// schema.mjs — Baton's one validator for leg outputs and readings (BATON_SPEC §2m.2 R-BTN-108,
// R-BTN-149; B-3). The restricted JSON Schema subset, a pattern engine that runs in time linear in
// its input (a Thompson automaton, no backtracking), the `$ref`/`x-baton-base` cycle check and
// the static refinement check. Baton's own module, not vendored from docs: the server, the CLI
// and runner, the sync and `baton course test` all import it, so no two parts of Baton disagree
// on validity. No dependency, and nothing here reads what a schema means (R-BTN-50).

/** A schema's id: `std:<name>@<n>` or `<course>:<name>@<n>` (R-BTN-108). */
export const SCHEMA_ID = /^(std|[a-z][a-z0-9-]{0,39}):([A-Za-z][A-Za-z0-9._-]{0,63})@(0|[1-9][0-9]{0,5})$/;
export const SCHEMA_MAX_BYTES = 32 * 1024;
export const SCHEMA_MAX_DEPTH = 16;
/** Nesting of any JSON in a schema — a `const`, an `enum` member, a view — so nothing that
 *  compares or copies it recursively can overflow the stack (1-A-5). */
const JSON_MAX_DEPTH = 64;

/** The nesting depth of a JSON value, measured without recursion; stops past `limit`. */
function jsonDepth(v, limit) {
  let max = 0;
  const stack = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (d > max) max = d;
    if (max > limit) return max;
    if (x && typeof x === 'object') for (const y of Array.isArray(x) ? x : Object.values(x)) stack.push([y, d + 1]);
  }
  return max;
}
export const PATTERN_MAX_CHARS = 512;
export const PATTERN_MAX_REPEAT = 1000;
/** R-BTN-149: the expanded automaton's states, whatever the pattern's repeats. */
export const PATTERN_MAX_STATES = 4096;
/** R-BTN-108: an inline value, serialized. */
export const VALUE_MAX_BYTES = 4096;
/** R-BTN-108: a stored inline string's bound. */
export const INLINE_STRING_MAX = 256;
const VIEW_MAX_BYTES = 4096;
/** The validator's own bound on errors returned, so a hostile value costs no more than this. */
const ERRORS_MAX = 50;
/** The schema nodes one walk visits at most — `$ref`s fan out, so a 32 KB schema bounds nothing
 *  by itself (baton#69 round 1, 1-B-0). A walk that runs out reports, never passes. */
const WALK_BUDGET = 10_000;

const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'prefixItems', 'enum', 'const', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format', '$ref', 'title', 'description',
  'x-baton-base', 'x-baton-view']);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const FORMATS = new Set(['date-time', 'uri']);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const byteLength = (s) => new TextEncoder().encode(s).length;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Parse `id@version` into its parts, or null. */
export function parseSchemaId(id) {
  const m = typeof id === 'string' ? SCHEMA_ID.exec(id) : null;
  return m ? { prefix: m[1], name: m[2], version: Number(m[3]) } : null;
}

// ── the pattern engine ──────────────────────────────────────────────────────────────────────

/** A pattern's grammar, parsed by recursive descent into an AST:
 *  alt | seq | rep {node, min, max} | char {test} | bol | eol | group {node}. */
function parsePattern(src) {
  if (typeof src !== 'string') throw new Error('a pattern is a string');
  if (src.length > PATTERN_MAX_CHARS) throw new Error(`a pattern is at most ${PATTERN_MAX_CHARS} characters`);
  const cps = [...src];
  let i = 0;
  const peek = () => cps[i];
  const fail = (why) => { throw new Error(`${why} at ${i}`); };

  const classEscape = (c) => {
    switch (c) {
      case 'd': return (x) => x >= '0' && x <= '9';
      case 'D': return (x) => !(x >= '0' && x <= '9');
      case 'w': return (x) => /^[A-Za-z0-9_]$/.test(x);
      case 'W': return (x) => !/^[A-Za-z0-9_]$/.test(x);
      case 's': return (x) => /^[ \t\n\r\f\v]$/.test(x);
      case 'S': return (x) => !/^[ \t\n\r\f\v]$/.test(x);
      default: return null;
    }
  };
  const literalEscape = (c) => {
    const map = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v' };
    if (own(map, c)) return map[c];
    if (/^[\\^$.|?*+()[\]{}\/-]$/.test(c)) return c;
    fail(`the escape \\${c} is outside the grammar`);
  };

  const parseClass = () => {
    i++; // [
    let negate = false;
    if (peek() === '^') { negate = true; i++; }
    const parts = [];
    while (i < cps.length && peek() !== ']') {
      const c = cps[i++];
      let test = null;
      let lo = null;
      if (c === '\\') {
        const e = cps[i++];
        if (e === undefined) fail('a class ends in \\');
        test = classEscape(e);
        if (!test) lo = literalEscape(e);
      } else if (c === '[') {
        fail('a nested class is outside the grammar');
      } else {
        lo = c;
      }
      if (lo !== null && peek() === '-' && cps[i + 1] !== undefined && cps[i + 1] !== ']') {
        i++;
        let hi = cps[i++];
        if (hi === '\\') {
          const e = cps[i++];
          if (classEscape(e)) fail('a range ends in a class escape');
          hi = literalEscape(e);
        }
        if (hi.codePointAt(0) < lo.codePointAt(0)) fail('a range out of order');
        const a = lo.codePointAt(0), b = hi.codePointAt(0);
        parts.push((x) => { const p = x.codePointAt(0); return p >= a && p <= b; });
      } else if (lo !== null) {
        const l = lo;
        parts.push((x) => x === l);
      } else {
        parts.push(test);
      }
    }
    if (peek() !== ']') fail('an unclosed class');
    i++;
    return { t: 'char', test: (x) => parts.some((p) => p(x)) !== negate };
  };

  const parseAtom = () => {
    const c = peek();
    if (c === '(') {
      i++;
      if (peek() === '?') {
        // (?: is the only group modifier the grammar admits; look-around and named groups are refused.
        if (cps[i + 1] === ':') i += 2;
        else fail('look-around and named groups are outside the grammar');
      }
      const node = parseAlt();
      if (peek() !== ')') fail('an unclosed group');
      i++;
      return { t: 'group', node };
    }
    if (c === '[') return parseClass();
    if (c === '.') { i++; return { t: 'char', test: (x) => x !== '\n' && x !== '\r' }; }
    if (c === '^') { i++; return { t: 'bol' }; }
    if (c === '$') { i++; return { t: 'eol' }; }
    if (c === '\\') {
      i++;
      const e = cps[i++];
      if (e === undefined) fail('a pattern ends in \\');
      if (/^[1-9]$/.test(e) || e === 'k') fail('a back-reference is outside the grammar');
      if (/^[bBpPuxc0]$/.test(e)) fail(`the escape \\${e} is outside the grammar`);
      const test = classEscape(e);
      if (test) return { t: 'char', test };
      const l = literalEscape(e);
      return { t: 'char', test: (x) => x === l };
    }
    if (c === ')' || c === '|' || c === undefined) fail('an empty atom');
    if ('*+?{'.includes(c)) fail('a quantifier with nothing to repeat');
    if (c === ']' || c === '}') fail(`a bare ${c}`);
    i++;
    return { t: 'char', test: (x) => x === c };
  };

  const parseQuantified = () => {
    let node = parseAtom();
    for (;;) {
      const c = peek();
      let min, max;
      if (c === '*') { min = 0; max = Infinity; i++; }
      else if (c === '+') { min = 1; max = Infinity; i++; }
      else if (c === '?') { min = 0; max = 1; i++; }
      else if (c === '{') {
        const rest = cps.slice(i).join('');
        const m = /^\{(\d{1,4})(?:(,)(\d{1,4})?)?\}/.exec(rest);
        if (!m) fail('a malformed {n,m}');
        // R-BTN-108 lists {n} and {n,m}: an open {n,} is outside the grammar (1-B-2).
        if (m[2] && m[3] === undefined) fail('{n,} is outside the grammar; write {n,m}');
        min = Number(m[1]);
        max = m[2] ? Number(m[3]) : min;
        if (max !== Infinity && max < min) fail('{n,m} with m below n');
        if (min > PATTERN_MAX_REPEAT || (max !== Infinity && max > PATTERN_MAX_REPEAT)) fail(`a repeat over ${PATTERN_MAX_REPEAT}`);
        i += [...m[0]].length;
      } else break;
      if (peek() === '?' || peek() === '+') fail('lazy and possessive quantifiers are outside the grammar');
      if (node.t === 'bol' || node.t === 'eol') fail('a quantified anchor');
      if (node.t === 'rep') fail('a quantifier on a quantifier is outside the grammar');
      node = { t: 'rep', node, min, max };
    }
    return node;
  };

  const parseSeq = () => {
    const items = [];
    while (i < cps.length && peek() !== '|' && peek() !== ')') items.push(parseQuantified());
    return { t: 'seq', items };
  };

  function parseAlt() {
    const alts = [parseSeq()];
    while (peek() === '|') { i++; alts.push(parseSeq()); }
    return alts.length === 1 ? alts[0] : { t: 'alt', alts };
  }

  const ast = parseAlt();
  if (i < cps.length) fail(peek() === ')' ? 'an unopened )' : 'trailing input');
  return ast;
}

/** Thompson's construction: states are {k: 'char', test, out} | {k: 'split', out, out2} |
 *  {k: 'bol'|'eol', out} | {k: 'match'}; a fragment is {start, outs: [setters]}. */
function compileAst(ast) {
  const states = [];
  const add = (s) => {
    if (states.length >= PATTERN_MAX_STATES) throw new Error(`the pattern expands past ${PATTERN_MAX_STATES} states`);
    states.push(s);
    return s;
  };
  const patch = (outs, target) => { for (const set of outs) set(target); };
  const frag = (node) => {
    switch (node.t) {
      case 'char': {
        const s = add({ k: 'char', test: node.test, out: null });
        return { start: s, outs: [(t) => { s.out = t; }] };
      }
      case 'bol': case 'eol': {
        const s = add({ k: node.t, out: null });
        return { start: s, outs: [(t) => { s.out = t; }] };
      }
      case 'group': return frag(node.node);
      case 'seq': {
        if (!node.items.length) {
          const s = add({ k: 'split', out: null, out2: null });
          return { start: s, outs: [(t) => { s.out = t; s.out2 = t; }] };
        }
        let first = null, outs = null;
        for (const it of node.items) {
          const f = frag(it);
          if (!first) first = f;
          else patch(outs, f.start);
          outs = f.outs;
        }
        return { start: first.start, outs };
      }
      case 'alt': {
        const fs = node.alts.map(frag);
        let start = fs[fs.length - 1].start;
        for (let j = fs.length - 2; j >= 0; j--) start = add({ k: 'split', out: fs[j].start, out2: start });
        return { start, outs: fs.flatMap((f) => f.outs) };
      }
      case 'rep': {
        // x{n,m} as n copies then m−n optional ones (or a star for an open bound).
        const parts = [];
        for (let j = 0; j < node.min; j++) parts.push(frag(node.node));
        if (node.max === Infinity) {
          const f = frag(node.node);
          const s = add({ k: 'split', out: f.start, out2: null });
          patch(f.outs, s);
          parts.push({ start: s, outs: [(t) => { s.out2 = t; }] });
        } else {
          for (let j = node.min; j < node.max; j++) {
            const f = frag(node.node);
            const s = add({ k: 'split', out: f.start, out2: null });
            parts.push({ start: s, outs: [...f.outs, (t) => { s.out2 = t; }] });
          }
        }
        if (!parts.length) {
          const s = add({ k: 'split', out: null, out2: null });
          return { start: s, outs: [(t) => { s.out = t; s.out2 = t; }] };
        }
        for (let j = 1; j < parts.length; j++) patch(parts[j - 1].outs, parts[j].start);
        return { start: parts[0].start, outs: parts[parts.length - 1].outs };
      }
      default: throw new Error('unknown node');
    }
  };
  const f = frag(ast);
  const match = add({ k: 'match' });
  patch(f.outs, match);
  return { start: f.start, states: states.length };
}

/** Thrown when a meter runs out (1-A-0, 2-r2-0): one value's validation — every pattern's
 *  states and steps, every `const` and `enum` comparison — draws on one budget. */
export class PatternBudget extends Error {
  constructor() { super('the work costs more than the validator\'s budget'); }
}

/** The work one request's validation may spend, in steps: compiling a pattern costs its
 *  states, matching a string its length times the live states, comparing with a `const` or an
 *  `enum` the bytes compared (baton#69 rounds 1–2, 1-A-0, 2-r2-0). Measured well under a second. */
export const PATTERN_STEPS_MAX = 2_000_000;
/** The pattern states one sync's schemas may compile together, so a registry of costly patterns
 *  cannot spend seconds at the sync (2-r2-1). */
export const POST_STATES_MAX = 1_000_000;

const charge = (meter, n) => {
  if (meter && (meter.steps -= n) < 0) throw new PatternBudget();
};

/** Compiled patterns by source, per process: a pattern is compiled once however many values
 *  meet it (bounded, so a hostile set of patterns cannot grow it without end). */
const COMPILED = new Map();
const COMPILED_MAX = 1024;

/**
 * Compile a pattern in R-BTN-108's grammar into a matcher: `(s) => boolean`, true when the
 * pattern matches anywhere in `s` (JSON Schema's unanchored search). Throws a pattern outside
 * the grammar or over its bounds. Matching simulates the automaton's state set over the input
 * once, so it runs in time linear in the input for a fixed pattern.
 */
export function compilePattern(src) {
  const hit = COMPILED.get(src);
  if (hit) return hit;
  const { start, states } = compileAst(parsePattern(src));
  const matcher = (input, meter = null) => {
    const chars = [...input];
    const n = chars.length;
    let gen = 0;
    const mark = new Map();
    const close = (set, s, pos) => {
      // Follow empty moves; an anchor passes only where it holds.
      const stack = [s];
      while (stack.length) {
        const x = stack.pop();
        if (meter && --meter.steps < 0) throw new PatternBudget();
        if (!x || mark.get(x) === gen) continue;
        mark.set(x, gen);
        if (x.k === 'split') { stack.push(x.out2, x.out); }
        else if (x.k === 'bol') { if (pos === 0) stack.push(x.out); }
        else if (x.k === 'eol') { if (pos === n) stack.push(x.out); }
        else set.push(x);
      }
    };
    let current = [];
    for (let pos = 0; pos <= n; pos++) {
      gen++;
      const next = [];
      for (const s of current) next.push(s);
      current = [];
      // A fresh thread at every position: the search is unanchored.
      for (const s of next) close(current, s, pos);
      close(current, start, pos);
      if (current.some((s) => s.k === 'match')) return true;
      if (pos === n) break;
      const c = chars[pos];
      const moved = [];
      for (const s of current) if (s.k === 'char' && s.test(c)) moved.push(s.out);
      current = moved;
    }
    return false;
  };
  matcher.states = states;
  if (COMPILED.size >= COMPILED_MAX) COMPILED.clear();
  COMPILED.set(src, matcher);
  return matcher;
}

// ── the subset ──────────────────────────────────────────────────────────────────────────────

/**
 * Every way `schema` falls outside R-BTN-108's subset, as `{path, message}`; empty when it is
 * inside. Checks the keywords, their values, the 32 KB and 16-level bounds, every `pattern`
 * against the grammar, `$ref` and `x-baton-base` as schema ids, and `x-baton-view`'s size.
 * It reads nothing else: references are resolved by `checkSchemaSet`.
 */
export function checkSchema(schema, meter = null) {
  const errors = [];
  const add = (path, message) => { if (errors.length < ERRORS_MAX) errors.push({ path, message }); };
  let size = Infinity;
  try { size = byteLength(JSON.stringify(schema)); } catch { /* not JSON */ }
  if (size > SCHEMA_MAX_BYTES) return [{ path: '', message: `a schema is at most ${SCHEMA_MAX_BYTES} bytes` }];
  if (jsonDepth(schema, JSON_MAX_DEPTH) > JSON_MAX_DEPTH) return [{ path: '', message: `a schema's JSON nests at most ${JSON_MAX_DEPTH} deep` }];
  const walk = (s, path, depth) => {
    if (depth > SCHEMA_MAX_DEPTH) return add(path, `a schema is at most ${SCHEMA_MAX_DEPTH} levels deep`);
    if (!isObj(s)) return add(path, 'a schema is an object');
    for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) add(`${path}/${k}`, `"${k}" is outside the subset`);
    if (own(s, 'type')) {
      const ts = Array.isArray(s.type) ? s.type : [s.type];
      if (!ts.length || !ts.every((t) => TYPES.has(t)) || new Set(ts).size !== ts.length) add(`${path}/type`, 'type is one of the JSON types, or a list of distinct ones');
    }
    if (own(s, 'properties')) {
      if (!isObj(s.properties)) add(`${path}/properties`, 'properties is an object');
      else for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}/properties/${k}`, depth + 1);
    }
    if (own(s, 'required') && !(Array.isArray(s.required) && s.required.every((r) => typeof r === 'string') && new Set(s.required).size === s.required.length)) {
      add(`${path}/required`, 'required is a list of distinct names');
    }
    if (own(s, 'additionalProperties')) {
      if (typeof s.additionalProperties !== 'boolean') walk(s.additionalProperties, `${path}/additionalProperties`, depth + 1);
    }
    if (own(s, 'items')) walk(s.items, `${path}/items`, depth + 1);
    if (own(s, 'prefixItems')) {
      if (!Array.isArray(s.prefixItems)) add(`${path}/prefixItems`, 'prefixItems is a list of schemas');
      else s.prefixItems.forEach((p, j) => walk(p, `${path}/prefixItems/${j}`, depth + 1));
    }
    if (own(s, 'enum') && !(Array.isArray(s.enum) && s.enum.length > 0)) add(`${path}/enum`, 'enum is a non-empty list');
    for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) if (own(s, k) && !isNum(s[k])) add(`${path}/${k}`, `${k} is a number`);
    for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (own(s, k) && !isCount(s[k])) add(`${path}/${k}`, `${k} is a non-negative integer`);
    if (own(s, 'pattern')) {
      try { charge(meter, compilePattern(s.pattern).states); } catch (e) {
        add(`${path}/pattern`, e instanceof PatternBudget ? 'the schemas\' patterns compile to more states than one sync allows' : `pattern: ${e.message}`);
      }
    }
    if (own(s, 'format') && !FORMATS.has(s.format)) add(`${path}/format`, 'format is date-time or uri');
    if (own(s, '$ref') && !parseSchemaId(s.$ref)) add(`${path}/$ref`, '$ref names a schema as <id>@<version>');
    if (own(s, 'x-baton-base')) {
      if (path !== '') add(`${path}/x-baton-base`, 'x-baton-base is the root schema\'s only');
      else if (!parseSchemaId(s['x-baton-base'])) add(`${path}/x-baton-base`, 'x-baton-base names a schema as <id>@<version>');
    }
    for (const k of ['title', 'description']) if (own(s, k) && typeof s[k] !== 'string') add(`${path}/${k}`, `${k} is a string`);
    if (own(s, 'x-baton-view')) {
      // R-BTN-112's view is rendered by Baton's renderers; here only its size and shape bound it.
      const v = s['x-baton-view'];
      if (!isObj(v) || byteLength(JSON.stringify(v)) > VIEW_MAX_BYTES || (own(v, 'fields') && !(Array.isArray(v.fields) && v.fields.length <= 24))) {
        add(`${path}/x-baton-view`, 'x-baton-view is an object of at most 4 KB and 24 fields');
      }
    }
  };
  walk(schema, '', 1);
  return errors;
}

/** The ids `schema` reaches directly: its `$ref`s anywhere and its `x-baton-base`. */
export function schemaRefs(schema) {
  const out = new Set();
  const walk = (s, depth) => {
    if (!isObj(s) || depth > SCHEMA_MAX_DEPTH + 1) return;
    if (typeof s.$ref === 'string') out.add(s.$ref);
    if (typeof s['x-baton-base'] === 'string') out.add(s['x-baton-base']);
    if (isObj(s.properties)) for (const v of Object.values(s.properties)) walk(v, depth + 1);
    if (isObj(s.additionalProperties)) walk(s.additionalProperties, depth + 1);
    walk(s.items, depth + 1);
    if (Array.isArray(s.prefixItems)) for (const p of s.prefixItems) walk(p, depth + 1);
  };
  walk(schema, 0);
  return [...out];
}

/**
 * A set of schemas checked together, as the sync posts them with a course (R-BTN-108): each
 * inside the subset; every `$ref` and `x-baton-base` resolving through `resolve` (the same
 * repository's schemas and the `std:` library); and no schema reaching itself through them.
 * `schemas` maps id → schema; returns `{id, path, message}` for every fault.
 */
export function checkSchemaSet(schemas, resolve, { subset = true, meter = null } = {}) {
  const errors = [];
  for (const [id, s] of Object.entries(schemas)) {
    if (subset) for (const e of checkSchema(s, meter)) errors.push({ id, ...e });
    for (const r of schemaRefs(s)) if (!own(schemas, r) && !resolve(r)) errors.push({ id, path: '', message: `${r} is not a posted or std: schema` });
  }
  // A cycle through $ref or x-baton-base, by depth-first search with colours.
  const colour = new Map();
  const get = (id) => (own(schemas, id) ? schemas[id] : resolve(id));
  const visit = (id, trail) => {
    colour.set(id, 1);
    const s = get(id);
    for (const r of s ? schemaRefs(s) : []) {
      if (colour.get(r) === 1) { errors.push({ id, path: '', message: `a $ref or x-baton-base cycle: ${[...trail, id, r].join(' → ')}` }); continue; }
      if (!colour.has(r) && get(r)) visit(r, [...trail, id]);
    }
    colour.set(id, 2);
  };
  for (const id of Object.keys(schemas)) if (!colour.has(id)) visit(id, []);
  return errors;
}

// ── validation ──────────────────────────────────────────────────────────────────────────────

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const typeMatches = (want, v) => {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
};
const deepEqual = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;
/** RFC 3339 §5.6, in range: month, the month's days (leap years too), hour, minute, second (60
 *  for a leap second) and the offset's hour and minute. */
function isDateTime(s) {
  const m = DATE_TIME.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (!days || d < 1 || d > days || h > 23 || mi > 59 || se > 60) return false;
  return m[9] === undefined || (Number(m[9]) <= 23 && Number(m[10]) <= 59);
}
const isUri = (s) => { try { return !!new URL(s).protocol; } catch { return false; } };

/**
 * Every way `value` fails `id`, as `{path, message}` (at most 50); empty when valid. Valid means
 * valid against the schema **and** every schema up its `x-baton-base` chain (R-BTN-108).
 * `resolve(id)` returns a schema or null; an unknown id is itself an error. Patterns compile
 * once per call; the chain and `$ref`s are bounded by the cycle check the sync applies, and
 * here again by a visit limit.
 */
export function validate(value, id, resolve, meter = { steps: PATTERN_STEPS_MAX }) {
  const errors = [];
  const add = (path, message) => { if (errors.length < ERRORS_MAX) errors.push({ path, message }); };
  // Every kind of work draws on `meter` — shared by a caller validating several values — and is
  // done once: a pattern compiled and charged once, each (pattern, string) matched once, a
  // `const` or an `enum` canonicalized once, the value at each node canonicalized once (2-r2-0).
  const charged = new Set();
  const matched = new Map();
  const constKeys = new Map();
  const enumSets = new Map();
  const valueKeys = new Map();
  const keyOf = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    let k = valueKeys.get(v);
    if (k === undefined) { k = JSON.stringify(canonical(v)); charge(meter, k.length); valueKeys.set(v, k); }
    return k;
  };
  let budget = 10_000;
  const check = (s, v, path, depth) => {
    if (errors.length >= ERRORS_MAX || --budget < 0 || depth > SCHEMA_MAX_DEPTH * 4) return add(path, 'the value is too deep or too large to validate');
    if (!isObj(s)) return;
    if (typeof s.$ref === 'string') {
      const r = resolve(s.$ref);
      if (!r) add(path, `${s.$ref} is not a known schema`);
      else check(r, v, path, depth + 1);
    }
    if (own(s, 'type')) {
      const ts = Array.isArray(s.type) ? s.type : [s.type];
      if (!ts.some((t) => typeMatches(t, v))) return add(path, `must be ${ts.join(' or ')}`);
    }
    if (own(s, 'const')) {
      let k = constKeys.get(s);
      if (k === undefined) { k = JSON.stringify(canonical(s.const)); charge(meter, k.length); constKeys.set(s, k); }
      if (k !== keyOf(v)) add(path, 'must equal the schema\'s const');
    }
    if (own(s, 'enum')) {
      let set = enumSets.get(s.enum);
      if (!set) {
        set = new Set();
        for (const e of s.enum) { const k = JSON.stringify(canonical(e)); charge(meter, k.length); set.add(k); }
        enumSets.set(s.enum, set);
      }
      if (!set.has(keyOf(v))) add(path, 'must be one of the schema\'s enum');
    }
    if (typeof v === 'number') {
      if (own(s, 'minimum') && v < s.minimum) add(path, `must be at least ${s.minimum}`);
      if (own(s, 'maximum') && v > s.maximum) add(path, `must be at most ${s.maximum}`);
      if (own(s, 'exclusiveMinimum') && v <= s.exclusiveMinimum) add(path, `must be above ${s.exclusiveMinimum}`);
      if (own(s, 'exclusiveMaximum') && v >= s.exclusiveMaximum) add(path, `must be below ${s.exclusiveMaximum}`);
    }
    if (typeof v === 'string') {
      const len = [...v].length;
      if (own(s, 'minLength') && len < s.minLength) add(path, `must be at least ${s.minLength} characters`);
      if (own(s, 'maxLength') && len > s.maxLength) add(path, `must be at most ${s.maxLength} characters`);
      if (own(s, 'pattern')) {
        const m = compilePattern(s.pattern);
        if (!charged.has(s.pattern)) { charge(meter, m.states); charged.add(s.pattern); }
        // Per pattern, by string: no key can stand for two pairs (2-r2-2).
        let byString = matched.get(s.pattern);
        if (!byString) { byString = new Map(); matched.set(s.pattern, byString); }
        let ok = byString.get(v);
        if (ok === undefined) { ok = m(v, meter); byString.set(v, ok); }
        if (!ok) add(path, 'must match the schema\'s pattern');
      }
      if (s.format === 'date-time' && !isDateTime(v)) add(path, 'must be an RFC 3339 date-time');
      if (s.format === 'uri' && !isUri(v)) add(path, 'must be a URI');
    }
    if (Array.isArray(v)) {
      if (own(s, 'minItems') && v.length < s.minItems) add(path, `must have at least ${s.minItems} items`);
      if (own(s, 'maxItems') && v.length > s.maxItems) add(path, `must have at most ${s.maxItems} items`);
      const prefix = Array.isArray(s.prefixItems) ? s.prefixItems : [];
      v.forEach((item, j) => {
        if (j < prefix.length) check(prefix[j], item, `${path}/${j}`, depth + 1);
        else if (own(s, 'items')) check(s.items, item, `${path}/${j}`, depth + 1);
      });
    }
    if (isObj(v)) {
      const props = isObj(s.properties) ? s.properties : {};
      for (const r of Array.isArray(s.required) ? s.required : []) if (!own(v, r)) add(`${path}/${r}`, 'is required');
      for (const [k, item] of Object.entries(v)) {
        if (own(props, k)) check(props[k], item, `${path}/${k}`, depth + 1);
        else if (s.additionalProperties === false) add(`${path}/${k}`, 'is not allowed');
        else if (isObj(s.additionalProperties)) check(s.additionalProperties, item, `${path}/${k}`, depth + 1);
      }
    }
  };
  // The schema, then each base up the chain: a refinement never weakens what a base guarantees.
  const seen = new Set();
  for (let cur = id; cur && !seen.has(cur); ) {
    seen.add(cur);
    const s = resolve(cur);
    if (!s) { add('', `${cur} is not a known schema`); break; }
    try { check(s, value, '', 0); } catch (e) {
      // A value too costly for the meter, or too deep for the comparisons' recursion, is
      // invalid, never a stall or a crash (1-A-0, 1-A-5, 2-r2-0).
      if (e instanceof PatternBudget) { add('', 'the value costs more than the validator allows'); break; }
      if (!(e instanceof RangeError)) throw e;
      add('', 'the value is too deep to validate');
      break;
    }
    cur = typeof s['x-baton-base'] === 'string' ? s['x-baton-base'] : null;
  }
  return errors;
}

/** `id` and each id up its `x-baton-base` chain, nearest first (bounded: a cycle stops it). */
export function baseChain(id, resolve) {
  const out = [];
  for (let cur = id; cur && !out.includes(cur) && out.length <= 64; ) {
    out.push(cur);
    const s = resolve(cur);
    cur = s && typeof s['x-baton-base'] === 'string' ? s['x-baton-base'] : null;
  }
  return out;
}

/**
 * R-BTN-108: whether an inline value of `id` may be stored — its whole chain bounds it: every
 * object schema sets `additionalProperties: false` and every string schema a `maxLength` of at
 * most 256. Returns the first unbounded place, or null when bounded.
 */
export function unboundedAt(id, resolve) {
  // Whether a schema bounds its value does not depend on where it is referenced from, so each
  // `$ref` target is walked once; and the whole walk is budgeted.
  const walked = new Set();
  let budget = WALK_BUDGET;
  for (const cid of baseChain(id, resolve)) {
    const s = resolve(cid);
    if (!s) return `${cid}: not a known schema`;
    let found = null;
    const walk = (x, path, depth) => {
      if (found || !isObj(x)) return;
      if (--budget < 0 || depth > SCHEMA_MAX_DEPTH * 4) { found = `${cid}${path}: too large to bound`; return; }
      if (typeof x.$ref === 'string') {
        const r = resolve(x.$ref);
        if (!r) { found = `${cid}${path}: ${x.$ref} unknown`; return; }
        if (!walked.has(x.$ref)) { walked.add(x.$ref); walk(r, path, depth + 1); }
      }
      const ts = own(x, 'type') ? (Array.isArray(x.type) ? x.type : [x.type]) : [];
      if ((ts.includes('object') || own(x, 'properties')) && x.additionalProperties !== false) { found = `${cid}${path}: an object without additionalProperties: false`; return; }
      if (ts.includes('string') && !own(x, 'enum') && !own(x, 'const') && !(isCount(x.maxLength) && x.maxLength <= INLINE_STRING_MAX)) { found = `${cid}${path}: a string without maxLength ≤ ${INLINE_STRING_MAX}`; return; }
      // The root too: a schema that leaves its value's type open bounds nothing (1-A-1).
      if (!ts.length && !own(x, 'const') && !own(x, 'enum') && !own(x, '$ref')) { found = `${cid}${path}: a value of any type`; return; }
      if (isObj(x.properties)) for (const [k, v] of Object.entries(x.properties)) walk(v, `${path}/${k}`, depth + 1);
      if (isObj(x.items)) walk(x.items, `${path}/items`, depth + 1);
      // Items past `prefixItems` are bounded by `items`, or forbidden by a `maxItems` within it (1-A-2).
      if (ts.includes('array') && !own(x, 'items')) {
        const fixed = Array.isArray(x.prefixItems) ? x.prefixItems.length : 0;
        if (!(isCount(x.maxItems) && x.maxItems <= fixed)) { found = `${cid}${path}: an array of any items`; return; }
      }
      if (Array.isArray(x.prefixItems)) x.prefixItems.forEach((p, j) => walk(p, `${path}/${j}`, depth + 1));
    };
    walk(s, '', 0);
    if (found) return found;
  }
  return null;
}

// ── refinement ──────────────────────────────────────────────────────────────────────────────

/**
 * The static refinement check `baton course test` runs (R-BTN-108): every place `schema` does
 * not provably refine `base`, as `{path, keyword, message}`. Sound but conservative: a
 * refinement it cannot prove is reported with its keyword, and a course fixes it by restating
 * the base's keyword. `$ref`s are resolved through `resolve` on both sides.
 */
export function refinementGaps(schema, base, resolve) {
  const gaps = [];
  const add = (path, keyword, message) => { if (gaps.length < ERRORS_MAX) gaps.push({ path, keyword, message }); };
  const deref = (s, depth = 0) => (isObj(s) && typeof s.$ref === 'string' && depth < 16 ? deref(resolve(s.$ref), depth + 1) ?? s : s);
  let budget = WALK_BUDGET;
  let spent = false;
  const NOT_CONSTRAINTS = new Set(['$ref', 'title', 'description', 'x-baton-base', 'x-baton-view']);
  const cmp = (sRaw, bRaw, path, depth) => {
    if (--budget < 0) { if (!spent) add(path, '', 'too large to compare'); spent = true; return; }
    if (depth > SCHEMA_MAX_DEPTH) return add(path, '', 'too deep to compare');
    // A base node constrains by its `$ref` and its own keywords together, as validate checks
    // both: compare the refinement with each (2-r2-3).
    if (isObj(bRaw) && typeof bRaw.$ref === 'string' && Object.keys(bRaw).some((k) => !NOT_CONSTRAINTS.has(k))) {
      const { $ref, ...rest } = bRaw;
      const target = resolve($ref);
      if (!target) return add(path, '$ref', `${$ref} is not a known schema`);
      cmp(sRaw, target, path, depth + 1);
      cmp(sRaw, rest, path, depth + 1);
      return;
    }
    const s = deref(sRaw), b = deref(bRaw);
    if (!isObj(b)) return;
    if (!isObj(s)) return add(path, '', 'not a schema');
    const types = (x) => (own(x, 'type') ? (Array.isArray(x.type) ? x.type : [x.type]) : null);
    const bt = types(b), st = types(s);
    if (bt && (!st || !st.every((t) => bt.includes(t) || (t === 'integer' && bt.includes('number'))))) add(path, 'type', 'the type is not the same or narrower');
    if (Array.isArray(b.required)) for (const r of b.required) if (!(Array.isArray(s.required) && s.required.includes(r))) add(path, 'required', `"${r}" is required by the base`);
    if (own(b, 'const') && !(own(s, 'const') && deepEqual(s.const, b.const))) add(path, 'const', 'const must equal the base\'s');
    if (own(b, 'enum')) {
      const sEnum = own(s, 'const') ? [s.const] : s.enum;
      const baseSet = new Set(b.enum.map((x) => JSON.stringify(canonical(x))));
      if (!Array.isArray(sEnum) || !sEnum.every((e) => baseSet.has(JSON.stringify(canonical(e))))) add(path, 'enum', 'enum must be a subset of the base\'s');
    }
    const tighter = (k, lower) => {
      if (!own(b, k)) return;
      if (!own(s, k) || (lower ? s[k] < b[k] : s[k] > b[k])) add(path, k, `${k} must equal or tighten the base's`);
    };
    tighter('minimum', true); tighter('exclusiveMinimum', true); tighter('minLength', true); tighter('minItems', true);
    tighter('maximum', false); tighter('exclusiveMaximum', false); tighter('maxLength', false); tighter('maxItems', false);
    if (own(b, 'pattern') && s.pattern !== b.pattern) add(path, 'pattern', 'pattern must equal the base\'s');
    if (own(b, 'format') && s.format !== b.format) add(path, 'format', 'format must equal the base\'s');
    const bp = isObj(b.properties) ? b.properties : {};
    const sp = isObj(s.properties) ? s.properties : {};
    // Every base property against what the refinement says of it: its own schema, else its
    // additionalProperties — an open object leaves the property open, which is no narrowing
    // unless the base's says nothing either (1-A-4).
    const anything = (x) => x === true || (isObj(x) && Object.keys(x).every((k) => k === 'title' || k === 'description' || k === 'x-baton-view'));
    for (const [k, v] of Object.entries(bp)) {
      if (own(sp, k)) cmp(sp[k], v, `${path}/properties/${k}`, depth + 1);
      else if (s.additionalProperties === false) {
        // Dropping an optional base property while closing the object narrows it (a required
        // one is reported under `required`).
      } else if (isObj(s.additionalProperties)) {
        cmp(s.additionalProperties, v, `${path}/properties/${k}`, depth + 1);
      } else if (!anything(v)) {
        add(`${path}/properties/${k}`, 'properties', `"${k}" is left open where the base constrains it; restate the base's property`);
      }
    }
    for (const k of Object.keys(sp)) {
      if (own(bp, k)) continue;
      if (b.additionalProperties === false) add(`${path}/properties/${k}`, 'additionalProperties', `"${k}" is new where the base's additionalProperties forbids it`);
      else if (isObj(b.additionalProperties)) cmp(sp[k], b.additionalProperties, `${path}/properties/${k}`, depth + 1);
    }
    if (b.additionalProperties === false && s.additionalProperties !== false) add(path, 'additionalProperties', 'additionalProperties must stay false');
    else if (isObj(b.additionalProperties) && isObj(s.additionalProperties)) cmp(s.additionalProperties, b.additionalProperties, `${path}/additionalProperties`, depth + 1);
    else if (isObj(b.additionalProperties) && (s.additionalProperties === undefined || s.additionalProperties === true)) add(path, 'additionalProperties', 'additionalProperties must restate or narrow the base\'s');
    if (own(b, 'items')) {
      if (!own(s, 'items')) add(path, 'items', 'items must restate or narrow the base\'s');
      else cmp(s.items, b.items, `${path}/items`, depth + 1);
    }
    const bPrefix = Array.isArray(b.prefixItems) ? b.prefixItems : [];
    if (bPrefix.length && (!Array.isArray(s.prefixItems) || s.prefixItems.length < bPrefix.length)) add(path, 'prefixItems', 'prefixItems must restate the base\'s');
    else if (Array.isArray(s.prefixItems)) {
      // Each of the refinement's positions against the base's: its prefix item, else its items.
      s.prefixItems.forEach((p, j) => {
        if (j < bPrefix.length) cmp(p, bPrefix[j], `${path}/prefixItems/${j}`, depth + 1);
        else if (own(b, 'items')) cmp(p, b.items, `${path}/prefixItems/${j}`, depth + 1);
      });
    }
  };
  cmp(schema, base, '', 0);
  return gaps;
}
