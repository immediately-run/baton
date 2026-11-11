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

/** One class 7 literal as a pattern: every occurrence of `secret`, as it stands. */
const literalOf = (secret: string): RegExp => new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

/** `text` with every class-5, class-6 and class-7 occurrence replaced by `***`. */
export function maskLegOutput(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.replace(literalOf(secret), () => '***');
  return maskSecrets(out);
}

/** Hold back the part of `text` that could be the start of a class 7 literal — its longest tail
 *  that one still extends — so a value split across two writes is still masked as one. Returns
 *  what may go, and what waits for the next write. */
export function holdLiteralTail(text: string, literals: readonly string[]): { head: string; tail: string } {
  // A tail waits only if a literal could still complete it in the next line: one no literal
  // extends would never be masked, and holding it would stall the stream.
  for (let n = 0; n < text.length; n++) {
    const tail = n === 0 ? text : text.slice(-n);
    if (literals.some((literal) => literal.startsWith(tail) && literal.length > tail.length)) return { head: text.slice(0, text.length - tail.length), tail };
  }
  return { head: text, tail: '' };
}

/** R-BTN-144 across a stream, which a line-at-a-time sink cannot do. Class 6's key block is
 *  `src/shared/mask.mjs`'s stream (`createMasker`: a block's lines are held until its `END` line
 *  or `KEY_HOLD` bytes, and classes 5 and 6 are masked on every line as it leaves). Class 7 is
 *  masked here, as each line is handed on, with the tail `holdLiteralTail` says a literal still
 *  extends kept back for the line after it — so a value split across two writes is masked as
 *  one, and a word that only resembles a literal leaves whole.
 *
 *  `push` takes one line (never with its `\n`: the stream's own) and returns what may leave now,
 *  joined by `\n` — `''` while a block, or a tail, is held; `flush` returns the rest at the
 *  stream's end: the `***` a held tail leaves and an unclosed block's. */
export function createLegMasker(secrets: readonly string[]) {
  // A literal's own line ending (a multi-line value) never matches inside a line; a stream masks
  // the value where it can see it whole.
  const literals = [...new Set(secrets.map((secret) => secret.replace(/\r?\n$/, '')).filter((secret) => secret !== ''))];
  const block = createMasker();
  let held = '';
  return {
    push(line: string): string {
      const { head, tail } = holdLiteralTail(maskSecrets(held === '' ? line : held + line), literals);
      held = tail;
      if (tail === '') return block.push(maskLegOutput(head, literals));
      // The tail that waits rides the line after the head, never a line of its own.
      return block.push(maskLegOutput(head, literals) + '\n' + maskLegOutput(tail, literals));
    },
    flush(): string {
      const tail = held === '' ? '' : block.push(maskLegOutput(held, literals));
      held = '';
      return [tail, block.flush()].filter(Boolean).join('\n');
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
 *  is not a list of names refuses the runner at start, as the file's other settings do. */
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
    // A file that is not JSON carries no name a runner could trust: none are masked from it.
    return null;
  }
  const maskEnv = config && typeof config === 'object' && !Array.isArray(config) ? (config as { mask_env?: unknown }).mask_env : undefined;
  if (maskEnv === undefined) return [];
  if (!Array.isArray(maskEnv) || !maskEnv.every((n) => typeof n === 'string' && n.trim() !== '')) {
    throw new Error(`${path}: mask_env must be a list of environment variable names (R-BTN-144)`);
  }
  return maskEnv as string[];
}
