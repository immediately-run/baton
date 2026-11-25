#!/usr/bin/env node
// check-spec.mjs — the spec and the code agree on what the spec defines (R3-1252).
//
//   npm run check:spec        check spec/BATON_SPEC/ (its parts joined, B-179) against src/, test/, model/, cli/ and scripts/ (the
//                             requirement ids they cite) and tickets/ (the tickets it cites)
//
// - every requirement id (`R-BTN-n`) the code cites is defined in the spec — as a bold
//   `**R-BTN-n` rule heading (`**R-BTN-n / R-BTN-m (…)**` defines both) or a bold rule followed
//   by `(R-BTN-n)` — or is one of the `roadmap-pr` course's own (COURSE_IDS), whose spec stays in
//   docs; retired ids fail except for existing, shrink-only path/id exceptions (B-277);
// - every ticket the spec cites (`R3-n`, `B-n`) is a ticket in tickets/ or tickets/archive/;
// - none of the scrub's terms (SCRUBBED) is in the spec: the repository is public;
// - every test/integration/ file named for a scenario (`S-BTN-n.*.test.ts`) names one §15's
//   scenario table defines and not one the history retired (B-71) — the RETIRED_TESTS_ALLOWED
//   list holds the retired files that still test their rows until B-67 and B-167 delete them;
// - no rule opens with an italic patch note (`- **R-BTN-35 (…).** *Except …*`): an amendment
//   rewrites the rule instead of stating an exception on top of a body that still says the
//   opposite (spec-tools.mjs's `patchNotes`). PATCH_NOTES_ALLOWED holds the ones written before
//   this check; it only shrinks (B-150);
// - every dated history entry after RULES_LINE_SINCE names the rule ids it amended — in its bold
//   title, or on a `Rules changed: <ids>` line (or `Rules changed: none.`) directly under the line
//   the title closes on — since the stale-rule guard reads only those (R-BTN-74).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchNotes } from './spec-tools.mjs';
import { joinParts, layoutProblems, specParts } from './spec-files.mjs';
import { stripFrontmatter } from './lib/stripFrontmatter.mjs';
import { exceptionProblems, newExceptionProblems, priorExceptions } from './lib/check-exceptions.mjs';
import { readSpecCode } from './lib/spec-code.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Terms the move removed (R3-1267's scrub list): a hostname that is not Baton's, and docs'
 *  private study and its plans. This keeps them out; it does not prove the scrub complete —
 *  the owner reviewed what stays (R3-1252, 2026-10-17). */
export const SCRUBBED = ['garda', 'publication/', 'study-log', 'the study', 'skill-history'];

/** Ticket ids the spec uses only as examples of a value (`'remainder:R3-9'`, §4). */
export const EXAMPLE_TICKETS = ['R3-9'];

/** Requirement ids defined in docs' `BATON_ROADMAP_PR_COURSE`, the reference deployment's course
 *  spec, which stays in docs: the code that serves that course may cite them. */
export const COURSE_IDS = ['R-BTN-21', 'R-BTN-27', 'R-BTN-42', 'R-BTN-43', 'R-BTN-49'];

/** The requirement ids the spec defines: each `**R-BTN-n` that opens a rule, and each bold rule
 *  title followed by its id (`- **The runner declares its own lease timeout** (R-BTN-9)`). */
export function definedIds(spec) {
  return new Set([
    ...[...spec.matchAll(/\*\*(R-BTN-\d+)\b/g)].map((m) => m[1]),
    ...[...spec.matchAll(/\*\*R-BTN-\d+((?: \/ R-BTN-\d+)+)/g)]
      .flatMap((m) => [...m[1].matchAll(/R-BTN-\d+/g)].map((n) => n[0])),
    ...[...spec.matchAll(/^\s*- \*\*[^*\n]+\*\* \((R-BTN-\d+)\)/gm)].map((m) => m[1]),
  ]);
}

/** The retired requirement ids: the first cell of each row of the history file's
 *  `## Retired requirements` table. */
export function retiredIds(history) {
  const section = history.split(/^## /m).find((s) => s.startsWith('Retired requirements')) ?? '';
  return new Set([...section.matchAll(/^\| *(R-BTN-\d+)\b/gm)].map((m) => m[1]));
}

/** The scenario ids the spec's §15 scenario table defines: the first cell of each row of its
 *  `### Scenarios` table (ids named in a row's other cells, or by a gate, are not rows). */
export function scenarioIds(spec) {
  const table = spec.split(/^### /m).find((s) => s.startsWith('Scenarios')) ?? '';
  return new Set([...table.matchAll(/^\| *(S-BTN-\d+)\b/gm)].map((m) => m[1]));
}

/** The retired scenario ids: the S-BTN ids of the history's `## Retired scenarios and gates`
 *  table (its G-BTN rows are gates, not scenarios). */
export function retiredScenarioIds(history) {
  const section = history.split(/^## /m).find((s) => s.startsWith('Retired scenarios and gates')) ?? '';
  return new Set([...section.matchAll(/^\| *(S-BTN-\d+)\b/gm)].map((m) => m[1]));
}

/** Test files that may stay named for a retired scenario: they still test their (retired) rows,
 *  and B-67 (S-BTN-46, S-BTN-60) deletes them — empty the list then. (B-167 deleted S-BTN-139 and
 *  S-BTN-147 with the ontology and route choices, the spec restructure's part 4.) B-263 deletes
 *  S-BTN-218 and S-BTN-219 with signed control, retired 2026-11-19. */
export const RETIRED_TESTS_ALLOWED = ['S-BTN-46', 'S-BTN-60', 'S-BTN-218', 'S-BTN-219'];

/** The scenario a test file is named for (`S-BTN-2.silent-runner.test.ts` → `S-BTN-2`), if any. */
export function fileScenario(name) {
  return /^(S-BTN-\d+)\./.exec(name)?.[1] ?? null;
}

/** Rules that carried an italic patch note when the check was added (B-150 folds each into its
 *  rule's body). Only shrinks: a new patch note fails, and so does a listed rule that no longer
 *  has one, so the list stays exact. */
export const PATCH_NOTES_ALLOWED = [];

/** The last day whose history entries may name their rule ids nowhere (R-BTN-74): an entry dated
 *  after it names them in its title or on a `Rules changed:` line, which the stale-rule guard
 *  (src/defaults/tickets-rules.ts's `historyEntries`, the same grammar) reads. */
export const RULES_LINE_SINCE = '2026-11-03';

const ENTRY = /^- \*\*(\d{4}-\d{2}-\d{2})(?: to (\d{4}-\d{2}-\d{2}))? — /;

/** The history's dated entries dated after `since` (a range by its last day) that name no rule id
 *  in their bold title and have no `Rules changed:` line directly under the line the title closes
 *  on: `{date, title}` each, in file order. */
export function unnamedEntries(history, since = RULES_LINE_SINCE, prefix = 'R-BTN') {
  const id = new RegExp(`(?<![A-Za-z0-9_-])${prefix}-\\d+(?!\\d)`);
  const out = [];
  const lines = history.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = ENTRY.exec(lines[i]);
    if (!m) continue;
    const date = m[2] ?? m[1];
    if (date <= since) continue;
    // The title runs to the bold's close, which may be on a later line of the entry.
    let j = i;
    let text = lines[i].slice(m[0].length);
    while (!text.includes('**') && j + 1 < lines.length && lines[j + 1].trim() !== '' && !ENTRY.test(lines[j + 1])) text += ` ${lines[++j].trim()}`;
    const title = text.split('**')[0].trim().replace(/\.$/, '');
    if (id.test(title)) continue;
    if (/^\s*Rules changed:\s*\S/.test(lines[j + 1] ?? '')) continue;
    out.push({ date, title });
  }
  return out;
}

/** Lines of the spec that carry its lineage instead of its current state (spec-writing rule 4:
 *  dates, the owner's words and replaced choices live in BATON_SPEC_HISTORY.md): a calendar
 *  date, or the owner quoted. A date that is itself a fact a rule states is allowed by the
 *  phrase beside it (DATED_FACTS): the page's own Updated line, a measurement's span, the
 *  cutoff a check reads, a protocol revision. Returns `{line, text}` each. */
export const DATED_FACTS = [/\*\*Updated:\*\*/, /^updated: /, /`\*\/15` cron/, /entry dated (after|on or before)/, /amendments from \d{4}-\d{2}-\d{2} on/, /MCP_VERSIONS|MCP-Protocol-Version|an absent header means/];
export function lineage(spec) {
  const out = [];
  const lines = spec.split(/\r?\n/);
  lines.forEach((text, i) => {
    // The phrase that makes a date a fact may sit on the wrapped line before or after it.
    const around = [lines[i - 1] ?? '', text, lines[i + 1] ?? ''];
    const dated = /(?<![\d-])\d{4}-\d{2}-\d{2}(?![\d-])/.test(text) && !DATED_FACTS.some((re) => around.some((l) => re.test(l)));
    const quoted = /\bthe owner[,:]\s+"|",?\s+the owner\b/.test(text);
    if (dated || quoted) out.push({ line: i + 1, text: text.trim().slice(0, 80) });
  });
  return out;
}

/** Every `R-BTN-n` in a text. */
export function citedIds(text) {
  return new Set([...text.matchAll(/\bR-BTN-(\d+)\b/g)].map((m) => `R-BTN-${m[1]}`));
}

/** The problems with a spec, given the code's texts by path, the ticket ids that exist, the
 *  history file and the names of test/integration/'s files. */
/** @returns {string[] & {warnings: string[]}} */
export function check(spec, code, tickets, history = '', testNames = [], allowed = [], retiredAllowed = {}) {
  const problems = [];
  const retiredCitations = [];
  const defined = new Set([...definedIds(spec), ...COURSE_IDS]);
  const retired = retiredIds(history);
  const scenarios = scenarioIds(spec);
  const retiredScenarios = retiredScenarioIds(history);
  for (const [path, text] of code) {
    for (const id of citedIds(text)) {
      if (retired.has(id)) retiredCitations.push(`${path} ${id}`);
      else if (!defined.has(id)) problems.push(`${path} cites ${id}, which the spec does not define`);
    }
  }
  problems.push(...exceptionProblems('retired rule citation', retiredCitations, retiredAllowed));
  for (const name of testNames) {
    const id = fileScenario(name);
    if (!id || RETIRED_TESTS_ALLOWED.includes(id)) continue;
    if (retiredScenarios.has(id)) problems.push(`test/integration/${name} is named for the retired scenario ${id} (spec/BATON_SPEC_HISTORY.md)`);
    else if (!scenarios.has(id)) problems.push(`test/integration/${name} is named for ${id}, which §15's scenario table does not define`);
  }
  for (const id of new Set([...spec.matchAll(/(?<![\w-])(R3-\d+|B-\d+)\b/g)].map((m) => m[1]))) {
    if (!tickets.has(id) && !EXAMPLE_TICKETS.includes(id)) problems.push(`the spec cites ${id}, which is not a ticket here`);
  }
  const notes = patchNotes(spec, 'R-BTN');
  for (const id of notes) {
    if (!allowed.includes(id)) problems.push(`${id} opens with an italic patch note: rewrite the rule so its body says it`);
  }
  for (const id of allowed) {
    if (!notes.includes(id)) problems.push(`${id} no longer has a patch note: remove it from PATCH_NOTES_ALLOWED`);
  }
  for (const e of unnamedEntries(history)) {
    problems.push(`spec/BATON_SPEC_HISTORY.md: the ${e.date} entry "${e.title.length > 60 ? `${e.title.slice(0, 59)}…` : e.title}" names no rule id in its title and has no \`Rules changed: <ids>\` line under it (R-BTN-74)`);
  }
  for (const l of lineage(spec)) {
    problems.push(`the spec carries lineage, not current state ("${l.text}…"): move the date or the owner's words to spec/BATON_SPEC_HISTORY.md`);
  }
  for (const term of SCRUBBED) {
    if (spec.toLowerCase().includes(term)) problems.push(`the spec contains the scrubbed term "${term}"`);
  }
  return problems;
}

/** A section-wide citation may point to a rule in one of its subsections, not another section. */
export function sectionPairDifferences(files, targets) {
  const differences = new Set();
  for (const [path, text] of files) {
    const visible = text.replace(/\[([^\][\n]*)\]\([^\n)]*\)/g, '$1').replace(/[`*_]/g, '');
    // Strip source comment leaders so a wrapped pair in code is checked like one in prose.
    const prose = visible.replace(/\r?\n[ \t]*(?:\/\/+[ \t]*)?/g, '\n');
    for (const [, section, rule] of prose.matchAll(/§(\d+[a-z]?(?:\.\d+[a-z]?)*)\b(?=[ \t\n(])[ \t]*(?:\n[ \t]*)?(?:\([ \t]*(?:\n[ \t]*)?)?(R-BTN-\d+)\b/g)) {
      const at = targets.get(section);
      const ruleAt = targets.get(rule);
      if (!at || !ruleAt || (at !== ruleAt && (section.includes('.') || at.file !== ruleAt.file))) {
        differences.add(`${path} §${section} ${rule}`);
      }
    }
  }
  return differences;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { defaultPages, specTargets } = await import('./link-spec-refs.mjs');
  // The spec is spec/BATON_SPEC/'s parts joined (B-179); spec/BATON_SPEC.md is their generated index.
  const parts = specParts(REPO);
  const spec = joinParts(parts);
  const code = readSpecCode(REPO);
  const read = (p) => readFileSync(join(REPO, p), 'utf8');
  const tickets = new Set(['tickets', 'tickets/archive'].flatMap((d) => readdirSync(join(REPO, d)))
    .filter((n) => n.endsWith('.mdx')).map((n) => n.slice(0, -4)));
  const historyPath = join(REPO, 'spec', 'BATON_SPEC_HISTORY.md');
  // The history is a page of the spec bundle (B-180): its body, past the frontmatter.
  const history = existsSync(historyPath) ? stripFrontmatter(readFileSync(historyPath, 'utf8')) : '';
  const integration = join(REPO, 'test', 'integration');
  const testNames = existsSync(integration) ? readdirSync(integration) : [];
  const file = 'scripts/retired-rule-exceptions.json';
  const exceptions = JSON.parse(read(file));
  const problems = check(spec, code, tickets, history, testNames, PATCH_NOTES_ALLOWED, exceptions);
  // check() owns citation matching; validate against the independently committed ceiling here.
  problems.push(...newExceptionProblems('retired rule citation', exceptions, priorExceptions(REPO, file)));
  problems.push(...layoutProblems(REPO));
  const pages = ['README.md', 'AGENTS.md', ...defaultPages(REPO)].map((p) => [p, read(p)]);
  const pairs = sectionPairDifferences([...code, ...pages, ['spec/BATON_SPEC/', spec]], specTargets(REPO));
  problems.push(...exceptionProblems('section does not own rule', pairs, JSON.parse(read('scripts/section-pair-exceptions.json'))));
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`check-spec: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`check-spec OK — ${definedIds(spec).size} requirements; ${code.length} code files checked for rule citations; ${testNames.filter((n) => fileScenario(n)).length} scenario test files checked`);
}
