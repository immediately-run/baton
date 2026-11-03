// tickets-rules.ts — the two process guards on a ticket's text (BATON_SPEC §2f R-BTN-74): the
// rules it cites that the spec's history says were amended after the ticket answered for them, read at
// `baton tickets claim` and reported by `baton tickets check`; and the `### Trust` and
// `### Invariants` sections a ticket filed after `.baton/baton.json`'s `check.sections_since`
// must carry. Both answer what PRs #160 and #161 taught (spec/BATON_SPEC_HISTORY.md, 2026-11-03):
// tickets filed before a ruling were built as written after it, and tickets prescribed inputs with
// no word on who may write them and mechanisms that broke standing rules.
//
// Deterministic and git-only: a ticket answers for its rules by the day it was filed — its
// `_filed` Status line, else its file's first commit — and by its `rules re-read` notes, never by
// an incidental edit; the amendments are the history file's dated entries. Pure over the texts it
// is given, apart from the git readers at the bottom, so the decisions are tested without a
// repository. Course code in the CLI, never core (§2b).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLOSE_TIMEOUT_MS, GIT_NONINTERACTIVE_ENV } from './ticket-state';

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
 *  `YYYY-MM-DD to YYYY-MM-DD — …`, is dated by its last day), to the next entry or heading. The
 *  rule ids it amended are those its bold title names and those of its `Rules changed: <ids>`
 *  line, the line directly under the one the title closes on (`entryIds`). */
export interface HistoryEntry {
  date: string;
  title: string;
  text: string;
  /** The `Rules changed:` line's text after the colon, or null when the entry has none. */
  changed: string | null;
}

/** The line that names the rule ids an entry amended when its title names none (R-BTN-74; the
 *  same grammar as scripts/check-spec.mjs's `rulesChangedLine`, which fails a new entry without
 *  either): `Rules changed: R-BTN-74, R-BTN-51.`, or `Rules changed: none.` */
const RULES_CHANGED = /^\s*Rules changed:\s*(.*?)\s*$/;

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
    // The line under the one the title's bold closes on.
    const close = text.indexOf('**', m[0].length);
    const at = close < 0 ? -1 : text.slice(0, close).split('\n').length;
    const changed = at < 0 ? null : (RULES_CHANGED.exec(cur[at] ?? '')?.[1] ?? null);
    out.push({ date: m[2] ?? m[1], title, text, changed });
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

/** The rule ids a history entry amended: those its bold title names, then those of its `Rules
 *  changed:` line (R-BTN-74). An id only its body mentions — evidence, a review round, a rejected
 *  alternative — is not one it amended. */
export const entryIds = (e: HistoryEntry, prefix = RULES_DEFAULTS.prefix): string[] =>
  [...new Set([...ruleIds(e.title, prefix), ...ruleIds(e.changed ?? '', prefix)])];

/** A ticket's body: its text with the frontmatter cut. */
const bodyOf = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/, '');

/** One cited rule amended after the ticket's date: the id and the entry that names it. */
export interface StaleRule {
  id: string;
  date: string;
  title: string;
}

/** The days a ticket re-read each rule id, from its `rules re-read` notes — the one a claim writes,
 *  `_(YYYY-MM-DD: rules re-read at claim: R-BTN-x (amended …), …)_`, and the one a spec PR adds for
 *  the ids it handled, `_(YYYY-MM-DD: rules re-read: R-BTN-x, …)_` — the latest per id. */
export function rereads(text: string, prefix = RULES_DEFAULTS.prefix): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/_\((\d{4}-\d{2}-\d{2}): rules re-read\b[^:\n]*:([^\n]*)\)_/g)) {
    for (const id of ruleIds(m[2], prefix)) if (!out.has(id) || out.get(id)! < m[1]) out.set(id, m[1]);
  }
  return out;
}

/** The rules a ticket's body cites that a history entry dated after the day the ticket answered
 *  for them names in its title or its `Rules changed:` line: one row per id and entry, by id then date. A rule is answered for on the day
 *  the ticket was `filed` (`YYYY-MM-DD`), or on the day of a later `rules re-read` note naming it.
 *  The comparison is by day: an entry of the same day as that answer is not after it. */
export function staleRules(ticketText: string, filed: string, entries: readonly HistoryEntry[], prefix = RULES_DEFAULTS.prefix): StaleRule[] {
  const body = bodyOf(ticketText);
  const cited = ruleIds(body, prefix);
  if (!cited.length) return [];
  const reread = rereads(body, prefix);
  // An entry amends the ids its bold title names (`**YYYY-MM-DD — R-BTN-74, R-BTN-31: …**`) and
  // those of its `Rules changed:` line; an id its body mentions is not one it amended.
  const named = entries.map((e) => ({ e, ids: new Set(entryIds(e, prefix)) }));
  const out: StaleRule[] = [];
  for (const id of cited) {
    const since = [filed, reread.get(id) ?? ''].sort().at(-1)!;
    for (const { e, ids } of named) if (e.date > since && ids.has(id)) out.push({ id, date: e.date, title: e.title });
  }
  const n = (id: string): number => Number(/(\d+)$/.exec(id)![1]);
  return out.sort((a, b) => n(a.id) - n(b.id) || a.date.localeCompare(b.date));
}

/** Each stale id once, with its latest amendment: the `--rules-reread` note's list. */
export function latestByRule(stale: readonly StaleRule[]): { id: string; date: string }[] {
  const by = new Map<string, string>();
  for (const s of stale) if (!by.has(s.id) || by.get(s.id)! < s.date) by.set(s.id, s.date);
  return [...by].map(([id, date]) => ({ id, date }));
}

/** The ids `--rules-reread` must name: each stale id once. */
export const staleIds = (stale: readonly StaleRule[]): string[] => latestByRule(stale).map((r) => r.id);

/** Why `--rules-reread <ids>` does not match the stale set — the ids it misses and the ids it
 *  names that are not stale — or null when they are the same set. */
export function rereadMismatch(given: readonly string[], stale: readonly StaleRule[]): string | null {
  const want = staleIds(stale);
  const missing = want.filter((id) => !given.includes(id));
  const extra = given.filter((id) => !want.includes(id));
  if (!missing.length && !extra.length) return null;
  return [
    `--rules-reread names ${given.length ? given.join(',') : 'nothing'}; the rules amended since the ticket answered for them are ${want.length ? want.join(',') : 'none'}`,
    ...(missing.length ? [`  not named: ${missing.join(', ')}`] : []),
    ...(extra.length ? [`  not amended since: ${extra.join(', ')}`] : []),
  ].join('\n');
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

/** A file's first commit as git shows it: its author day, and whether that commit is a shallow
 *  clone's boundary — where git shows every file as added, so the day is the clone's, not the
 *  file's. */
export interface FirstCommit {
  date: string;
  boundary: boolean;
}

/** When a ticket was filed: its `_filed` line, else its file's first commit; `undetermined` when
 *  that commit is a shallow clone's boundary; `today` for a file git has never committed (one
 *  being filed now). */
export function filingDate(text: string, first: FirstCommit | null | undefined, today: string): { date: string } | { undetermined: true } {
  const filed = filedDate(text);
  if (filed) return { date: filed };
  if (!first) return { date: today };
  return first.boundary ? { undetermined: true } : { date: first.date };
}

/** When a ticket was filed, for the sections check (R-BTN-74): the later of its `_filed` line and
 *  its file's first commit where git shows that commit — so a `_filed` line copied from an older
 *  ticket cannot date a new one before the cutover where the history is there to say otherwise —
 *  else whichever of the two there is; `undetermined` with no `_filed` line and a first commit
 *  that is a shallow clone's boundary; `today` with neither. */
export function sectionsDate(text: string, first: FirstCommit | null | undefined, today: string): { date: string } | { undetermined: true } {
  const filed = filedDate(text);
  const known = first && !first.boundary ? first.date : null;
  if (filed && known) return { date: filed > known ? filed : known };
  if (filed) return { date: filed };
  return filingDate(text, first, today);
}

/** `check.sections_from_id`: the first id (`B-176`) of the tickets that must carry a `_filed` line
 *  and are judged by it, so a shallow clone can date them; absent, none must. It names a prefix and
 *  a number, and needs `check.sections_since`; anything else is the operator's mistake, refused as
 *  the malformed `baton.json` is. */
export function sectionsFromId(check: { sections_from_id?: unknown; sections_since?: unknown } | undefined): { prefix: string; n: number } | null {
  const v = check?.sections_from_id;
  if (v == null) return null;
  const m = typeof v === 'string' ? /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)-(\d+)$/.exec(v.trim()) : null;
  if (!m) throw new Error(`.baton/baton.json: check.sections_from_id is a ticket id, <prefix>-<n> (B-176), not ${JSON.stringify(v)}`);
  if (check?.sections_since == null) throw new Error('.baton/baton.json: check.sections_from_id needs check.sections_since, the day the tickets it names are judged against');
  return { prefix: m[1], n: Number(m[2]) };
}

/** Whether `id` is at or above `check.sections_from_id`: the same prefix, and a number at or above
 *  its own. A legacy prefix's id (`R3-1205`) never is. */
export function atOrAbove(id: string, from: { prefix: string; n: number }): boolean {
  const m = /^(.*)-(\d+)$/.exec(id);
  return !!m && m[1] === from.prefix && Number(m[2]) >= from.n;
}

/** Why a live ticket is not judged by the sections check at all, or null (R-BTN-74): a project page
 *  (`kind: project`) builds nothing, and a request ticket (`tags: [request]`, as `baton ticket
 *  request` writes it) is one sentence its course's legs turn into the work's own tickets. A child
 *  a leg files (`parent:`) is such a ticket, so it is judged like any other (round 3). */
export function sectionsExempt(fm: Record<string, unknown> | null): 'project' | 'request' | null {
  if (!fm) return null;
  if (fm.kind === 'project') return 'project';
  const tags = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' ? fm.tags.replace(/^\[|\]$/g, '').split(',') : [];
  if (tags.some((t) => String(t).trim() === 'request')) return 'request';
  return null;
}

/** What a required section still needs: the headings a ticket's text lacks (`absent` — a `##`,
 *  `###` or `####` heading of that name, outside a fenced block) and those present whose body is
 *  empty or still a skeleton placeholder, one `_(…)_` and nothing else (`unfilled`). A body runs
 *  to the next heading of the same level or higher. */
export function sectionGaps(text: string): { absent: string[]; unfilled: string[] } {
  const bodies = new Map<string, string[]>();
  let fenced = false;
  let open: { name: string; level: number } | null = null;
  for (const line of bodyOf(text).split('\n')) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) fenced = !fenced;
    const m = fence || fenced ? null : /^(#{1,6}) +(.+?)\s*$/.exec(line);
    if (m) {
      const level = m[1].length;
      if (open && level <= open.level) open = null;
      if (level >= 2 && level <= 4 && (REQUIRED_SECTIONS as readonly string[]).includes(m[2]) && !bodies.has(m[2])) {
        bodies.set(m[2], []);
        open = { name: m[2], level };
        continue;
      }
    }
    if (open) bodies.get(open.name)!.push(line);
  }
  const absent = REQUIRED_SECTIONS.filter((s) => !bodies.has(s));
  const unfilled = REQUIRED_SECTIONS.filter((s) => {
    const body = bodies.get(s)?.join('\n').trim();
    return body != null && (body === '' || /^_\((?:(?!\)_)[\s\S])*\)_$/.test(body));
  });
  return { absent, unfilled };
}

/** The required sections a ticket does not carry filled: absent, empty, or still the skeleton's
 *  placeholder — what `baton tickets check` fails after `check.sections_since`. */
export function missingSections(text: string): string[] {
  const { absent, unfilled } = sectionGaps(text);
  return REQUIRED_SECTIONS.filter((s) => absent.includes(s) || unfilled.includes(s));
}

/** Why one required section counts as missing, for the check's finding and `new`'s refusal or
 *  warning; repository-neutral, since every repository's tickets get it. */
export function sectionHint(section: string): string {
  return section === 'Trust'
    ? 'every new input it adds (a field, a file, a commit trailer, a request), who may write it and how it is verified, or "no new input"'
    : 'the rules it must not break, by id, and how the design keeps each';
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

const gitOut = (root: string, args: string[]): string =>
  execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: CLOSE_TIMEOUT_MS, killSignal: 'SIGKILL', env: { ...process.env, ...GIT_NONINTERACTIVE_ENV } });

/** Whether `root` is a shallow clone (`git rev-parse --is-shallow-repository`); false where it is
 *  no git checkout. */
export function isShallow(root: string): boolean {
  try {
    return gitOut(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return false;
  }
}

/** A shallow clone's boundary commits: the `shallow` file's hashes. Empty for a full clone. */
function boundaries(root: string): Set<string> {
  try {
    const path = resolve(root, gitOut(root, ['rev-parse', '--git-path', 'shallow']).trim());
    return new Set(existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

/** The first commit of every file under `dir` in `root` — the oldest that added it (author day,
 *  `%as`; renames not followed, merges not read), from one `git log` walk. Empty where `root` is
 *  no git checkout. */
export function firstCommits(root: string, dir: string): Map<string, FirstCommit> {
  const out = new Map<string, FirstCommit>();
  let log = '';
  try {
    log = gitOut(root, ['log', '--diff-filter=A', '--no-renames', '--format=@%H %as', '--name-only', '--relative', '--', dir]);
  } catch {
    return out;
  }
  const shallow = boundaries(root);
  let at: FirstCommit = { date: '', boundary: false };
  // Newest first, so the last commit a path is seen with is its oldest.
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) {
      const [sha, date] = line.slice(1).split(' ');
      at = { date, boundary: shallow.has(sha) };
    } else if (line !== '') out.set(line, at);
  }
  return out;
}

/** One file's first commit (`firstCommits` for one path), or null — never committed. */
export const firstCommit = (root: string, path: string): FirstCommit | null => firstCommits(root, path).get(path) ?? null;

/** Deepen a shallow clone to its whole history, quietly and bounded, as the claim needs it to date
 *  a ticket; the error (git's own words) when it cannot. */
export function unshallow(root: string, remote: string): string | null {
  try {
    execFileSync('git', ['-C', root, 'fetch', '-q', '--unshallow', remote], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CLOSE_TIMEOUT_MS, killSignal: 'SIGKILL', env: { ...process.env, ...GIT_NONINTERACTIVE_ENV } });
    return null;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return (err.stderr || err.message || String(e)).trim().split('\n').at(-1) ?? 'no reason given';
  }
}
