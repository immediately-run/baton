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

/** The smallest period of `literal`: the least shift at which it overlaps itself (KMP's failure
 *  function). Two of its occurrences that overlap start a multiple of it apart in a run, so a
 *  periodic run is covered in one step rather than one per occurrence. */
const periodOf = (literal: string): number => {
  const fail = new Array<number>(literal.length + 1).fill(0);
  fail[0] = -1;
  for (let i = 1, k = 0; i < literal.length; i++) {
    while (k > 0 && literal[i] !== literal[k]) k = fail[k];
    if (literal[i] === literal[k]) k++;
    fail[i + 1] = k;
  }
  return literal.length - fail[literal.length];
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
    const p = periodOf(literal);
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

/** Hold back the part of `text` that could be the start of a class 7 literal — its longest tail
 *  that one still extends — so a value split across two writes is still masked as one. Returns
 *  what may go, and what waits for the next write. The longest tail wins: a shorter suffix that
 *  happens to prefix some other literal must not cut short the one actually being split. */
export function holdLiteralTail(text: string, literals: readonly string[]): { head: string; tail: string } {
  // A tail waits only if a literal could still complete it in the next line: one no literal
  // extends would never be masked, and holding it would stall the stream. No tail longer than
  // the longest literal minus one can be a proper prefix of any of them.
  let longest = 0;
  for (const literal of literals) longest = Math.max(longest, literal.length);
  for (let n = Math.min(text.length, longest - 1); n >= 1; n--) {
    const tail = text.slice(-n);
    if (literals.some((literal) => literal.startsWith(tail) && literal.length > tail.length)) return { head: text.slice(0, text.length - tail.length), tail };
  }
  return { head: text, tail: '' };
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
 *  A literal the line framing split can re-form two ways, and both are tried: with the `\n` the
 *  framing ate (a newline inside the value) and without it (the value wrapped across the line).
 *  `push` takes one line (never with its `\n`: the stream's own) and returns what may leave
 *  now, joined by `\n` — `''` while a block, or a tail, is held; `flush` returns the rest at
 *  the stream's end: the `***` a held tail leaves and an unclosed block's. */
export function createLegMasker(secrets: readonly string[]) {
  // A value's own trailing line ending never arrives (the sink's unit is the line without its
  // `\n`), so one is dropped and the value is masked where it stands; a `\r\n` inside a value is
  // the boundary the framing hands back as `\n` alone.
  const literals = [...new Set(secrets.map((secret) => secret.replace(/\r\n/g, '\n').replace(/\r?\n$/, '')).filter((secret) => secret !== ''))];
  const block = createMasker();
  // What is held back, unlogged: a tail some literal may still extend.
  let held = '';
  // How many of `held`'s leading bytes already left, as part of a `***` (a literal the hold's
  // cut crossed): those bytes leave again as nothing, never in clear and never as more `***`.
  let gone = 0;
  const said: string[] = [];
  const out = (text: string) => {
    for (const line of text.split('\n')) said.push(block.push(line));
  };
  /** Take `text` — the held bytes first (`hold` of them, `gone` of those already left), then the
   *  new ones — emit all of it but the tail a literal may still extend, and hold that. The held
   *  bytes are one masked run, merged with any literal they are part of; a run wholly of bytes
   *  that already left emits nothing. */
  const take = (text: string, hold: number, left: number) => {
    const { tail } = holdLiteralTail(text, literals);
    const cut = text.length - tail.length;
    const runs = literalSpans(text, literals);
    if (hold > 0) {
      runs.unshift([0, hold]);
      runs.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < runs.length; i++) {
        if (runs[i][0] < runs[i - 1][1]) {
          runs[i - 1][1] = Math.max(runs[i - 1][1], runs[i][1]);
          runs.splice(i--, 1);
        }
      }
    }
    let text_ = '';
    let at = 0;
    let nextGone = 0;
    for (const [s, e] of runs) {
      if (s >= cut) break;
      // The run's bytes this push lets go: masked, unless every one of them already left.
      const emitsNew = !(s === 0 && Math.min(e, cut) <= left);
      text_ += text.slice(at, s) + (emitsNew ? '***' : '');
      at = Math.min(e, cut);
      if (e > cut) nextGone = emitsNew ? e - cut : Math.max(0, left - cut);
    }
    text_ += text.slice(at, cut);
    if (text_ !== '' || cut > 0) out(text_);
    held = tail;
    gone = Math.min(nextGone, tail.length);
  };
  return {
    push(line: string): string {
      said.length = 0;
      if (held === '') {
        take(line, 0, 0);
      } else {
        // The line before ended inside what may be a literal, and this line may complete it:
        // with the boundary the framing ate (`held\nline` — a newline inside the value) or
        // without it (`heldline` — the value wrapped across the line). The candidate a literal
        // crosses the boundary of wins; else the one whose hold stays open the longest; else the
        // hold was never a literal's start, and leaves masked, before the line on its own.
        const h = held.length;
        const joined = [held + line, `${held}\n${line}`];
        const crosses = joined.find((text) => literalSpans(text, literals).some(([s, e]) => s < h && e > h));
        const open = joined
          .map((text) => ({ text, tail: holdLiteralTail(text, literals).tail }))
          .filter((j) => j.tail !== '' && j.text.length - j.tail.length < h)
          .sort((a, b) => b.tail.length - a.tail.length)[0]?.text;
        take(crosses ?? open ?? `${held}\n${line}`, h, gone);
      }
      return said.filter(Boolean).join('\n');
    },
    flush(): string {
      said.length = 0;
      // The stream ended inside what may be a literal: those bytes leave masked, not verbatim —
      // unless every one of them already left as the `***` of a literal the head held whole.
      if (held !== '' && gone < held.length) said.push(block.push('***'));
      held = '';
      gone = 0;
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
