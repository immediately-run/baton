// tickets-rules.ts — the two process guards on a ticket's text (BATON_SPEC §2f R-BTN-74): the
// rules it cites that the spec's history says were amended after the ticket last changed, read at
// `baton tickets claim` and reported by `baton tickets check`; and the `### Trust` and
// `### Invariants` sections a ticket filed after `.baton/baton.json`'s `check.sections_since`
// must carry. Both answer what PRs #160 and #161 taught (spec/BATON_SPEC_HISTORY.md, 2026-11-03):
// tickets filed before a ruling were built as written after it, and tickets prescribed inputs with
// no word on who may write them and mechanisms that broke standing rules.
//
// Deterministic and git-only: the ticket's date is its file's last commit, the amendments are the
// history file's dated entries, and nothing is fetched. Pure over the texts it is given, apart from
// the two `git log` readers at the bottom, so the decisions are tested without a repository.
// Course code in the CLI, never core (§2b).
import { execFileSync } from 'node:child_process';

/** Where the amendments are, and the rule ids they name: the shape spec-tools.mjs's CONFIG has
 *  (fieldhouse's copy names `R-FH` and its own history), overridden by `.baton/baton.json`'s
 *  `check.rules: {history, prefix}`. */
export interface RulesConfig {
  /** The rule id prefix, without the number's dash: `R-BTN`. */
  prefix: string;
  /** The spec's history file, relative to the repository root. */
  history: string;
}

export const RULES_DEFAULTS: RulesConfig = { prefix: 'R-BTN', history: 'spec/BATON_SPEC_HISTORY.md' };

/** `check.rules` read over the defaults; a value that is not a non-empty string keeps the default. */
export function rulesConfig(check: { rules?: unknown } | undefined): RulesConfig {
  const r = (check?.rules ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  return { prefix: str(r.prefix) ?? RULES_DEFAULTS.prefix, history: str(r.history) ?? RULES_DEFAULTS.history };
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One dated entry of the history's changelog: `- **YYYY-MM-DD — title.** …` (a range,
 *  `YYYY-MM-DD to YYYY-MM-DD — …`, is dated by its last day), to the next entry or heading. */
export interface HistoryEntry {
  date: string;
  title: string;
  text: string;
}

const ENTRY = /^- \*\*(\d{4}-\d{2}-\d{2})(?: to (\d{4}-\d{2}-\d{2}))? — /;

/** The history file's dated entries, in file order. A title may wrap onto the next line: it runs
 *  to the bold's close. */
export function historyEntries(history: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  let cur: string[] | null = null;
  const close = (): void => {
    if (!cur) return;
    const text = cur.join('\n');
    const m = ENTRY.exec(text)!;
    const rest = text.slice(m[0].length).replace(/\s+/g, ' ');
    const title = (/^(.*?)\*\*/.exec(rest)?.[1] ?? rest).trim().replace(/\.$/, '');
    out.push({ date: m[2] ?? m[1], title, text });
    cur = null;
  };
  for (const line of history.split(/\r?\n/)) {
    if (ENTRY.test(line)) {
      close();
      cur = [line];
    } else if (/^#{1,6} /.test(line) || /^- \*\*/.test(line)) close();
    else if (cur) cur.push(line);
  }
  close();
  return out;
}

/** The rule ids (`R-BTN-n`) a text names, each once, in first-seen order — never a longer id's
 *  head (`R-BTN-1` is not in `R-BTN-10`). */
export function ruleIds(text: string, prefix = RULES_DEFAULTS.prefix): string[] {
  const re = new RegExp(`(?<![A-Za-z0-9_-])${esc(prefix)}-(\\d+)(?!\\d)`, 'g');
  return [...new Set([...text.matchAll(re)].map((m) => `${prefix}-${m[1]}`))];
}

/** A ticket's body: its text with the frontmatter cut. */
const bodyOf = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/, '');

/** One cited rule amended after the ticket's date: the id and the entry that names it. */
export interface StaleRule {
  id: string;
  date: string;
  title: string;
}

/** The rules a ticket's body cites that a history entry dated after `since` (the ticket file's
 *  last commit, `YYYY-MM-DD`) names: one row per id and entry, by id then date. A day's entry is
 *  after a ticket of the day before, never after one of its own day. */
export function staleRules(ticketText: string, since: string, entries: readonly HistoryEntry[], prefix = RULES_DEFAULTS.prefix): StaleRule[] {
  const cited = ruleIds(bodyOf(ticketText), prefix);
  if (!cited.length) return [];
  const later = entries.filter((e) => e.date > since).map((e) => ({ e, ids: new Set(ruleIds(e.text, prefix)) }));
  const out: StaleRule[] = [];
  for (const id of cited) for (const { e, ids } of later) if (ids.has(id)) out.push({ id, date: e.date, title: e.title });
  const n = (id: string): number => Number(/(\d+)$/.exec(id)![1]);
  return out.sort((a, b) => n(a.id) - n(b.id) || a.date.localeCompare(b.date));
}

/** Each stale id once, with its latest amendment: the `--rules-reread` note's list. */
export function latestByRule(stale: readonly StaleRule[]): { id: string; date: string }[] {
  const by = new Map<string, string>();
  for (const s of stale) if (!by.has(s.id) || by.get(s.id)! < s.date) by.set(s.id, s.date);
  return [...by].map(([id, date]) => ({ id, date }));
}

const shortTitle = (t: string): string => (t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t);

/** The rows as a list a person reads, one per line: `  R-BTN-33 — 2026-11-01 — the owner's
 *  rulings` — the claim's refusal. */
export const staleList = (stale: readonly StaleRule[]): string => stale.map((s) => `  ${s.id} — ${s.date} — ${shortTitle(s.title)}`).join('\n');

/** Each id once, with its latest amendment and how many entries name it — the check's one line
 *  per ticket: `R-BTN-33 (2026-11-01), R-BTN-50 (2026-11-02, 3 entries)`. */
export const staleSummary = (stale: readonly StaleRule[]): string =>
  latestByRule(stale).map((r) => {
    const n = stale.filter((s) => s.id === r.id).length;
    return `${r.id} (${r.date}${n > 1 ? `, ${n} entries` : ''})`;
  }).join(', ');

/** The Status line `claim --rules-reread` writes: `_(YYYY-MM-DD: rules re-read at claim: R-BTN-x
 *  (amended YYYY-MM-DD), …)_`. */
export const rereadNote = (date: string, stale: readonly StaleRule[]): string =>
  `_(${date}: rules re-read at claim: ${latestByRule(stale).map((r) => `${r.id} (amended ${r.date})`).join(', ')})_`;

/** `text` with `line` appended to its `## Status` section (after the section's last line, before
 *  the next `## ` heading), or a `## Status` section of its own at the end. */
export function appendStatus(text: string, line: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  let fenced = false;
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
    else if (!fenced && /^## Status\s*$/.test(lines[i])) at = i;
  }
  if (at < 0) return `${lines.join('\n')}\n\n## Status\n\n${line}\n`;
  let end = lines.length;
  fenced = false;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fenced = !fenced;
    else if (!fenced && /^#{1,2} /.test(lines[i])) {
      end = i;
      break;
    }
  }
  let last = end - 1;
  while (last > at && lines[last].trim() === '') last--;
  return [...lines.slice(0, last + 1), '', line, ...(end < lines.length ? ['', ...lines.slice(end)] : [])].join('\n') + '\n';
}

/* ------------------------------------------------------------------------------------------
 * Trust and Invariants
 * ---------------------------------------------------------------------------------------- */

/** The headings a ticket filed on or after `check.sections_since` carries (the skeleton's). */
export const REQUIRED_SECTIONS = ['Trust', 'Invariants'] as const;

/** The day the skeleton's Status line says the ticket was filed (`_filed YYYY-MM-DD…_`), or null. */
export const filedDate = (text: string): string | null => /^_filed (\d{4}-\d{2}-\d{2})\b/m.exec(text)?.[1] ?? null;

/** The required headings a ticket's text lacks — a `##`, `###` or `####` heading of that name,
 *  outside a fenced block. */
export function missingSections(text: string): string[] {
  const have = new Set<string>();
  let fenced = false;
  for (const line of bodyOf(text).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const m = /^#{2,4} +(.+?)\s*$/.exec(line);
      if (m) have.add(m[1]);
    }
  }
  return REQUIRED_SECTIONS.filter((s) => !have.has(s));
}

/** `check.sections_since`: a `YYYY-MM-DD` day, or absent (the check off). Anything else is the
 *  operator's mistake, refused as the malformed `baton.json` is. */
export function sectionsSince(check: { sections_since?: unknown } | undefined): string | null {
  const v = check?.sections_since;
  if (v == null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`.baton/baton.json: check.sections_since is a day, YYYY-MM-DD, not ${JSON.stringify(v)}`);
  return v;
}

/* ------------------------------------------------------------------------------------------
 * git
 * ---------------------------------------------------------------------------------------- */

/** The commits that count as someone editing a ticket: not the ticket commands' own bookkeeping
 *  (`tickets: …` — a claim, a move, a reverse mention, a reservation) and not a merge, either
 *  of which would otherwise clear a stale reading without anyone re-reading the rules. */
const EDITS = ['--no-merges', '--invert-grep', '--grep=^tickets: '];

/** The day a ticket's rules were last answered for: the later of its last edit and the newest
 *  `rules re-read at claim` note in its Status — the note a claim with `--rules-reread` writes
 *  is itself a `tickets:` commit, so it is read from the text. */
export function rulesSince(edited: string | null, text: string): string | null {
  const notes = [...text.matchAll(/_\((\d{4}-\d{2}-\d{2}): rules re-read at claim:/g)].map((m) => m[1]);
  const all = [edited, ...notes].filter((d): d is string => !!d).sort();
  return all.length ? all[all.length - 1] : null;
}

/** The day (`%cs`, the committer's) of the last commit that touched `path` in `root`, or null —
 *  not a git checkout, or the file never committed. */
export function fileDate(root: string, path: string): string | null {
  const day = (args: string[]): string | null => {
    try {
      const out = execFileSync('git', ['-C', root, 'log', ...args, '--format=%cs', '--', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
      const d = args.includes('--diff-filter=A') ? out[out.length - 1] : out[0];
      return /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? d : null;
    } catch {
      return null;
    }
  };
  // The last edit, else — a ticket only the ticket commands ever wrote — the day it was filed.
  return day(['-1', ...EDITS]) ?? day(['--diff-filter=A']);
}

/** The last commit day of every file under `dir` in `root`, from one `git log` walk (the first
 *  date a path appears with is its latest). Empty where `root` is no git checkout. */
export function fileDates(root: string, dir: string): Map<string, string> {
  const walk = (extra: string[], latest: boolean): Map<string, string> => {
    const out = new Map<string, string>();
    let log = '';
    try {
      log = execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', 'log', ...extra, '--format=@%cs', '--name-only', '--relative', '--', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return out;
    }
    let date = '';
    for (const line of log.split('\n')) {
      if (line.startsWith('@')) date = line.slice(1);
      else if (line !== '' && (!latest || !out.has(line))) out.set(line, date);
    }
    return out;
  };
  // A path's last edit; a path only the ticket commands ever wrote takes the day it was filed
  // (its oldest commit: the walk runs newest first, so the last date seen wins).
  const edits = walk(EDITS, true);
  for (const [path, date] of walk([], false)) if (!edits.has(path)) edits.set(path, date);
  return edits;
}
