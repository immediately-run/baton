// mask.ts — R-BTN-144 classes 5, 6 and 7: what a leg's output may not carry, as it leaves the
// runner for a leg log (R-BTN-128) or a transcript repository (R-BTN-20). Class 5's bearer
// prefixes and class 6's private key block are one pattern, `src/shared/mask.mjs`; class 7 is by
// name (B-170): the value of every variable of an environment whose name ends `_KEY`, `_TOKEN`,
// `_SECRET`, `_PASSWORD` or `_PAT`, or is `PGPASSWORD`, compared exactly as the environment spells
// it, and of every name `runner.json` `mask_env` lists — computed once, from the environment it is
// given, so a model provider's key is masked without core or the runner naming a provider.
//
// Class 7 is a pattern, never a literal handed to `String.prototype.replace`: a provider key may
// hold characters a replacement pattern reads as its own (`$&`, `$'`).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMasker, maskSecrets } from '../shared/mask.mjs';

/** R-BTN-144 class 7: the name endings the environment decides, compared case-sensitively. */
export const SECRET_NAME_SUFFIXES = ['_KEY', '_TOKEN', '_SECRET', '_PASSWORD', '_PAT'];
/** R-BTN-144 class 7: the one name that says nothing by its ending. */
export const SECRET_NAME_EXACT = 'PGPASSWORD';
/** R-BTN-144: a literal value under 8 bytes is not masked — it would redact ordinary words of
 *  the leg's output, and is logged once instead. */
export const MIN_SECRET_BYTES = 8;

/** Whether `name` is one R-BTN-144 class 7 masks by its spelling alone. */
export const namesASecret = (name: string): boolean =>
  name === SECRET_NAME_EXACT || SECRET_NAME_SUFFIXES.some((suffix) => name.endsWith(suffix));

/** R-BTN-144 class 7's values from an environment: every variable `namesASecret` or `mask_env`
 *  names, of `MIN_SECRET_BYTES` bytes or more, each once. A `mask_env` name is taken as written. */
export function secretValues(env: Record<string, string | undefined>, maskEnv: readonly string[] = []): string[] {
  const named = new Set(maskEnv);
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string' || !(named.has(name) || namesASecret(name))) continue;
    if (Buffer.byteLength(value, 'utf8') >= MIN_SECRET_BYTES) out.add(value);
  }
  return [...out];
}

/** KMP's failure table: after matching k characters, the next shorter prefix still possible. */
const prefixTable = (length: number, charAt: (i: number) => number): number[] => {
  const fail = new Array<number>(length + 1).fill(0);
  for (let i = 1, k = 0; i < length; i++) {
    const c = charAt(i);
    while (k > 0 && c !== charAt(k)) k = fail[k];
    if (c === charAt(k)) k++;
    fail[i + 1] = k;
  }
  return fail;
};

/** Where in `text` any class 7 literal stands: every occurrence of every literal, as sorted,
 *  disjoint `[start, end)` runs — occurrences that overlap are one run, whichever literal each is,
 *  so a literal inside, or overlapping, another is masked with it in one piece, in any order of
 *  the set. Memory stays linear in the runs: a periodic run (`aaaa…` against `aaaa`) is taken
 *  whole, never one occurrence at a time. */
export function literalSpans(text: string, literals: readonly string[]): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const literal of literals) {
    const n = literal.length;
    if (n === 0) continue;
    const p = n - prefixTable(n, (i) => literal.charCodeAt(i))[n];
    let from = 0;
    while (from <= text.length - n) {
      const i = text.indexOf(literal, from);
      if (i < 0) break;
      // The text goes on with the literal's period: every window `p` further is an occurrence.
      let j = i + n;
      while (j < text.length && text.charCodeAt(j) === text.charCodeAt(j - p)) j++;
      const end = i + n + Math.floor((j - i - n) / p) * p;
      const last = found.length > 0 && found[found.length - 1][0] <= i ? found[found.length - 1] : null;
      if (last && i < last[1]) last[1] = Math.max(last[1], end);
      else found.push([i, end]);
      // An occurrence starting before `end - n + 1` ends inside the run already found.
      from = Math.max(i + 1, end - n + 1);
    }
  }
  return mergeSpans(found);
}

function mergeSpans(found: Array<[number, number]>): Array<[number, number]> {
  found.sort((a, b) => a[0] - b[0]);
  const runs: Array<[number, number]> = [];
  for (const [s, e] of found) {
    const last = runs[runs.length - 1];
    if (last && s < last[1]) last[1] = Math.max(last[1], e);
    else runs.push([s, e]);
  }
  return runs;
}

/** `text` with every class-7 literal replaced by `***` — the literals alone: class 6 belongs to
 *  whoever sees the whole stream (a block is held line by line), so a line on its way into the
 *  block stream is masked of its literals, never of a block it may be part of. One pass over the
 *  merged runs (`literalSpans`), so one literal inside or overlapping another leaves nothing of
 *  either, whatever order the environment listed them in. */
const maskLiterals = (text: string, literals: readonly string[]): string => {
  let out = '';
  let at = 0;
  for (const [s, e] of literalSpans(text, literals)) {
    out += `${text.slice(at, s)}***`;
    at = e;
  }
  return out + text.slice(at);
};

/** `text` with every class-5, class-6 and class-7 occurrence replaced by `***`. */
export function maskLegOutput(text: string, secrets: readonly string[]): string {
  return maskSecrets(maskLiterals(text, secrets));
}

/** The end `detail` a failed leg's claim carries (§9.4, B-256): the last line of the leg's error —
 *  for an agent stub, the agent's own last line of output — masked as the log line is, then made
 *  §10.4 free text (no control characters, none of `< > { }`) of at most 200 characters, its
 *  head kept. Null when nothing is left. Baton stores and shows it and never reads it. */
export function failureDetail(error: string, secrets: readonly string[]): string | null {
  const last = maskLegOutput(error, secrets).split('\n').map((l) => l.trim()).filter((l) => l !== '').at(-1) ?? '';
  const text = last.replace(/[\u0000-\u001f\u007f-\u009f<>{}]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.length <= FAILURE_DETAIL_MAX ? text : `${text.slice(0, FAILURE_DETAIL_MAX - 1)}…`;
}

/** §9.4: an end's `detail` is at most 200 characters (src/core/validate.ts `checkEnd`). */
export const FAILURE_DETAIL_MAX = 200;

/** Length of the longest proper prefix that is also a suffix of this line. */
function tailLength(line: string, literal: string, fail: number[]): number {
  let k = 0;
  for (let i = Math.max(0, line.length - literal.length + 1); i < line.length; i++) {
    while (k > 0 && line[i] !== literal[k]) k = fail[k];
    if (line[i] === literal[k]) k++;
  }
  return k;
}

/** Hold the longest tail that could begin a class 7 literal. */
export function holdLiteralTail(text: string, literals: readonly string[]): { head: string; tail: string } {
  let longest = 0;
  for (const literal of literals) {
    const fail = prefixTable(literal.length, (i) => literal.charCodeAt(i));
    longest = Math.max(longest, tailLength(text, literal, fail));
  }
  const cut = text.length - longest;
  return { head: text.slice(0, cut), tail: text.slice(cut) };
}

/** Z scan of `linePrefix + sentinel + literal`: how much of the line matches at each literal
 *  offset. Each scan either reuses a known overlap or extends the furthest match. */
function lineOverlaps(line: string, literal: string): number[] {
  const size = Math.min(line.length, literal.length);
  const base = size + 1;
  const z = new Array<number>(base + literal.length).fill(0);
  const charAt = (i: number) => i < size ? line.charCodeAt(i) : i === size ? -1 : literal.charCodeAt(i - base);
  for (let i = 1, left = 0, right = 0; i < z.length; i++) {
    let k = i < right ? Math.min(right - i, z[i - left]) : 0;
    while (i + k < z.length && charAt(k) === charAt(i + k)) k++;
    z[i] = k;
    if (i + k > right) [left, right] = [i, i + k];
  }
  z.push(0);
  return z.slice(base);
}

/** Advance one literal across line boundaries. For each still-possible prefix length, keep its
 *  earliest start: the histories have the same future, and that start covers all their bytes.
 *  Positions count only line contents, so blank lines cannot grow the buffered text. */
function createBoundaryMatcher(literal: string) {
  const n = literal.length;
  const fail = prefixTable(n, (i) => literal.charCodeAt(i));
  let prefixes = new Map<number, number>();
  return {
    push(line: string, offset: number, boundary: boolean) {
      const end = offset + line.length;
      const next = new Map<number, number>();
      let first = end;
      let crossed = offset;
      let leading = offset;
      const keep = (length: number, start: number) => {
        next.set(length, Math.min(start, next.get(length) ?? start));
        first = Math.min(first, start);
      };
      for (let k = tailLength(line, literal, fail); k > 0; k = fail[k]) keep(k, end - k);

      if (boundary && literal[0] === '\n') prefixes.set(0, offset);
      if (prefixes.size > 0) {
        // Comparing the line separately at every active prefix is quadratic on repeats.
        const overlap = lineOverlaps(line, literal);
        const extend = (k: number, start: number) => {
          const matched = overlap[k];
          if (k + matched === n) {
            if (start < offset) crossed = Math.max(crossed, offset + matched);
            else leading = Math.max(leading, offset + matched);
          } else if (matched === line.length) {
            keep(k + matched, start);
          }
        };
        for (const [k, start] of prefixes) {
          if (k > 0) extend(k, start); // a wrapped value: omit the framing boundary
          if (literal[k] === '\n') extend(k + 1, start); // a newline inside the value
        }
      }
      prefixes = next;
      return { first, crossed, leading };
    },
    reset() { prefixes.clear(); },
  };
}

/** R-BTN-144 across a stream, which a line-at-a-time sink cannot do. Class 6's key block is
 *  `src/shared/mask.mjs`'s stream (`createMasker`: a block's lines are held until its `END` line
 *  or `KEY_HOLD` bytes, and classes 5 and 6 are masked on every line as it leaves) — each line
 *  is masked of its class-7 literals and handed to that stream, never the other way round: a
 *  block's body lines must reach the holder as they came, or the holder never sees the block.
 *  Class 7 is masked here, as each line is handed on: the tail `holdLiteralTail` says a literal
 *  still extends is held back, unlogged, until the next line completes the literal (masked as
 *  one) or shows it will never complete — and a hold that never completes leaves as `***`,
 *  never verbatim, for its bytes may be the literal's own.
 *
 *  Three rules keep every byte of a literal out of the log (S-BTN-119):
 *  - the hold never cuts a literal the text holds whole: the run of literals the cut crosses
 *    leaves as `***` with the head, and its bytes past the cut are held only as the next
 *    literal's possible start (a value's last bytes can begin another's: `…9f2c71`, `1abc…`);
 *  - held bytes are masked whatever the next line does — the hold is one masked run with any
 *    literal it is part of — and bytes that already left as such a `***` never leave again,
 *    neither in clear nor as a second `***` of their own;
 *  - literals are masked as merged runs (`literalSpans`), never one after another.
 *
 *  Both interpretations of each line boundary stay live until disproved: with the `\n` the
 *  framing ate (a newline inside the value), or without it (the value wrapped across the line).
 *  Match spans refer to the same line content either way, so mask their union.
 *  `push` takes one line (never with its `\n`: the stream's own) and returns what may leave
 *  now, joined by `\n` — `''` while a block, or a tail, is held; `flush` returns the rest at
 *  the stream's end: the `***` a held tail leaves and an unclosed block's. */
export function createLegMasker(secrets: readonly string[]) {
  // A value's own trailing line ending never arrives (the sink's unit is the line without its
  // `\n`), so one is dropped and the value is masked where it stands; a `\r\n` inside a value is
  // the boundary the framing hands back as `\n` alone.
  const literals = [...new Set(secrets.map((secret) => secret.replace(/\r\n/g, '\n').replace(/\n$/, '')).filter((secret) => secret !== ''))];
  const block = createMasker();
  const matchers = literals.map(createBoundaryMatcher);
  let offset = 0;
  let boundary = false;
  // What is held back, unlogged: a tail some literal may still extend.
  let held = '';
  // How many of `held`'s leading bytes already left, as part of a `***` (a literal the hold's
  // cut crossed): those bytes leave again as nothing, never in clear and never as more `***`.
  let gone = 0;
  const said: string[] = [];
  const out = (text: string) => {
    for (const line of text.split('\n')) said.push(block.push(line));
  };
  const take = (line: string) => {
    const text = held + line;
    const hold = held.length;
    const base = offset - hold;
    const end = offset + line.length;
    let first = end;
    let crossed = offset;
    let leading = offset;
    for (const matcher of matchers) {
      const match = matcher.push(line, offset, boundary);
      first = Math.min(first, match.first);
      crossed = Math.max(crossed, match.crossed);
      leading = Math.max(leading, match.leading);
    }
    const cut = first - base;
    const spans = literalSpans(line, literals).map(([s, e]): [number, number] => [s + hold, e + hold]);
    // Every crossing that started in the hold overlaps its mask. A match starting on a bare
    // boundary, without touching held characters, is a separate run unless the spans overlap.
    if (hold > 0) spans.push([0, crossed - base]);
    if (leading > offset) spans.push([hold, leading - base]);
    let text_ = '';
    let at = 0;
    let nextGone = Math.max(0, gone - cut);
    for (const [s, e] of mergeSpans(spans)) {
      if (s >= cut) break;
      // The run's bytes this push lets go: masked, unless every one of them already left.
      const emitsNew = !(s === 0 && Math.min(e, cut) <= gone);
      text_ += text.slice(at, s) + (emitsNew ? '***' : '');
      at = Math.min(e, cut);
      if (emitsNew && e > cut) nextGone = Math.max(nextGone, e - cut);
      if (e === hold && at < cut) text_ += '\n';
    }
    text_ += text.slice(at, cut);
    if (text_ !== '' || cut > 0) out(text_);
    held = text.slice(cut);
    gone = Math.min(nextGone, held.length);
    offset = end;
    boundary = true;
  };
  return {
    push(line: string): string {
      said.length = 0;
      take(line);
      return said.filter(Boolean).join('\n');
    },
    flush(): string {
      said.length = 0;
      // The stream ended inside what may be a literal: those bytes leave masked, not verbatim —
      // unless every one of them already left as the `***` of a literal the head held whole.
      if (held !== '' && gone < held.length) said.push(block.push('***'));
      held = '';
      gone = 0;
      offset = 0;
      boundary = false;
      for (const matcher of matchers) matcher.reset();
      said.push(block.flush());
      return said.filter(Boolean).join('\n');
    },
  };
}

/** `runner.json`'s location — `$BATON_CONFIG`, else `$XDG_CONFIG_HOME` (or `~/.config`) beside
 *  `baton/runner.json`, the default §5.6 names. */
export function runnerConfigPath(env: Record<string, string | undefined> = process.env): string {
  if (env.BATON_CONFIG) return resolve(env.BATON_CONFIG);
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'baton', 'runner.json');
}

/** Whether `path` lies under a directory named `.baton` — where a checkout keeps its own settings
 *  (a home's, a course's), which are a repository's files and never a runner host's configuration:
 *  no `mask_env` of a repository may name a credential of the runner's host. */
export function underBatonDirectory(path: string): boolean {
  return resolve(path).split(/[\\/]/).includes('.baton');
}

/** R-BTN-144 class 7: the names `runner.json` `mask_env` lists, or null for a file that is absent
 *  or not JSON — a runner with no readable configuration masks by name alone. A `mask_env` that
 *  is not a list of names refuses the runner at start, as the file's other settings do, and so
 *  does a file that is not JSON but says `mask_env` somewhere: the operator asked for masking by
 *  name, and a trailing comma must not turn that off in silence. */
export function readMaskEnv(path: string, read: (path: string) => string = (file) => readFileSync(file, 'utf8')): string[] | null {
  let text: string;
  try {
    text = read(path);
  } catch {
    return null;
  }
  let config: unknown;
  try {
    config = JSON.parse(text) as unknown;
  } catch {
    // A file that is not JSON carries no name a runner could trust: none are masked from it —
    // unless it names mask_env, when the refusal above says the list cannot be read.
    if (/\bmask_env\b/.test(text)) throw new Error(`${path}: not JSON, so its mask_env cannot be read (R-BTN-144)`);
    return null;
  }
  const maskEnv = config && typeof config === 'object' && !Array.isArray(config) ? (config as { mask_env?: unknown }).mask_env : undefined;
  if (maskEnv === undefined) return [];
  if (!Array.isArray(maskEnv) || !maskEnv.every((n) => typeof n === 'string' && n.trim() !== '')) {
    throw new Error(`${path}: mask_env must be a list of environment variable names (R-BTN-144)`);
  }
  return maskEnv as string[];
}
