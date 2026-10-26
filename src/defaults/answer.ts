// answer.ts — how a leg stub reads the answer an agent gave it (B-85, R-BTN-131): the leg's
// result word — a verdict, an adjudication, an outcome — and, after it, the PR URL the leg's
// `close` writes its line on. The instructions still demand the bare last line (`$BATON_ANSWER`,
// the leg's `.md`); prompts drift, and a round is expensive, so the reader is tolerant where the
// answer is right and strict only where it is missing.
//
// The scan runs backwards over the output's non-blank lines and takes the first that begins with
// a value word, as a whole word — `approve.` and `approved` are not `approve` — with at most one
// PR URL after it on that line, in place of the value or beside it. Prose before that line is the
// agent talking; prose after it is a summary. Neither loses the round. A line whose value word
// sits mid-line only (`"my verdict: approve"`) is not the answer: the word must open its line,
// so a stray mention in prose never stands for a verdict nobody gave. With no such line, nothing
// is found and the stub refuses, naming what it read — the last non-blank line — so a missing or
// misspelled verdict still fails the leg, and the failure says why.
//
// `strict` is the reader's old behaviour, kept for the course test kit and its fixtures: the one
// last non-blank line must be exactly the value word, or the value word and one PR URL after it.
//
// The stub carries this module, bundled, like `agent-words.ts`: edit it here, never in a checkout.

/** One answer read from an agent's output: the value word it gave, and the PR its line names. */
export interface ReadAnswer {
  /** The value word, one of `values` as given. */
  answer: string;
  /** The PR URL the answer's line names, or null when it names none. */
  pr: string | null;
  /** The line the answer was read from, trimmed — what is reported when the line is malformed. */
  line: string;
}

/** A PR URL, as `pr-close.ts` writes and reads it (B-29). */
const PR_URL = /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+$/;

/** Markdown and quote marks an agent may wrap a lone value word in — `` `changes` ``,
 *  `**approve**`, `"changes"`: a balanced pair, stripped before the whole-word check. Found
 *  live 2026-10-24: a review's last line `` `changes` `` failed its round — the verdict was
 *  right and the reader was wrong, B-85's tolerance exactly where the answer is right. The
 *  wrapper never widens what counts: the word inside must still be one of `values`, whole. */
const WRAPPED = /^([`'"*_]+)(.+)\1$/;

/** `line` split on whitespace, or null when `line` is not an answer: it must open with one of
 *  `values` as a whole word (a balanced wrapper pair around it is unwrapped), and the rest
 *  must be nothing or exactly one PR URL. */
function answerOn(line: string, values: readonly string[]): ReadAnswer | null {
  const words = line.split(/\s+/);
  let answer = words[0];
  if (answer === undefined) return null;
  const wrapped = WRAPPED.exec(answer);
  if (wrapped && values.includes(wrapped[2])) answer = wrapped[2];
  if (!values.includes(answer)) return null;
  const rest = words.slice(1);
  if (rest.length === 0) return { answer, pr: null, line };
  if (rest.length === 1 && PR_URL.test(rest[0])) return { answer, pr: rest[0], line };
  return null;
}

/**
 * The answer in `out`, or null when the agent gave none: backwards from its last non-blank line,
 * the first that begins with one of `values` (`strict`: only the last non-blank line counts).
 * The result says where it was read (`line`), so a refusal can name what it saw.
 */
export function findAnswer(out: string, values: readonly string[], opts: { strict?: boolean } = {}): ReadAnswer | null {
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (opts.strict ?? false) {
    const last = lines.at(-1);
    return last === undefined ? null : answerOn(last, values);
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = answerOn(lines[i], values);
    if (found != null) return found;
  }
  return null;
}

/** The last non-blank line of `out`, trimmed — what a refusal reports it read. `''` for no output. */
export function lastLine(out: string): string {
  return out.split('\n').map((l) => l.trim()).filter((l) => l !== '').at(-1) ?? '';
}

/**
 * The answer `out` gave, or an error naming the leg, the value it wanted and what it read. `pr`
 * is the PR URL the answer's line names; a line that opens with the value word but carries
 * anything but one PR URL after it is its own error, so a typo'd PR never changes the leg's
 * result silently. `ask` names the ask and its values as the stub's caller wrote them.
 */
export function requireAnswer(out: string, ask: { name: string; values: readonly string[] }, leg: string, opts: { strict?: boolean } = {}): ReadAnswer {
  const values = ask.values.join(' or ');
  const found = findAnswer(out, ask.values, opts);
  if (found != null) return found;
  // A strict reader finds no answer only on a malformed last line; say what was wrong with it
  // when its value word opened the line (a PR URL the leg's `close` cannot use).
  const last = lastLine(out);
  const opened = answerOn(last, ask.values) === null && ask.values.includes(last.split(/\s+/)[0] ?? '');
  if (opened) throw new Error(`the ${leg} agent's last line names no PR URL after its ${ask.name}`);
  throw new Error(`the ${leg} agent printed no ${ask.name} (${values}) as its last line${last === '' ? ' — its output was empty' : ` — its last line was ${JSON.stringify(last)}`}`);
}
