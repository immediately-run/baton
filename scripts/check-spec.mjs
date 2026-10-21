#!/usr/bin/env node
// check-spec.mjs — the spec and the code agree on what the spec defines (R3-1252).
//
//   npm run check:spec        check spec/BATON_SPEC.md against src/, test/, model/ and cli/ (the
//                             requirement ids they cite) and tickets/ (the tickets it cites)
//
// - every requirement id (`R-BTN-n`) the code cites is defined in the spec — as a bold
//   `**R-BTN-n` rule heading (`**R-BTN-n / R-BTN-m (…)**` defines both) or a bold rule followed
//   by `(R-BTN-n)` — or is one of the `roadmap-pr` course's own (COURSE_IDS), whose spec stays in
//   docs; a citation of a retired id (spec/BATON_SPEC_HISTORY.md's Retired requirements table) is
//   a warning, so the code that still names it can be cleaned up without breaking the check;
// - every ticket the spec cites (`R3-n`, `B-n`) is a ticket in tickets/ or tickets/archive/;
// - none of the scrub's terms (SCRUBBED) is in the spec: the repository is public;
// - every test/integration/ file named for a scenario (`S-BTN-n.*.test.ts`) names one §15's
//   scenario table defines and not one the history retired (B-71) — the RETIRED_TESTS_ALLOWED
//   list holds the two retired files that still test their rows until B-67 deletes them.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 *  title followed by its id (`- **The worker declares its own lease timeout** (R-BTN-9)`). */
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
 *  and B-67 deletes them — empty the list then. */
export const RETIRED_TESTS_ALLOWED = ['S-BTN-46', 'S-BTN-60'];

/** The scenario a test file is named for (`S-BTN-2.silent-runner.test.ts` → `S-BTN-2`), if any. */
export function fileScenario(name) {
  return /^(S-BTN-\d+)\./.exec(name)?.[1] ?? null;
}

/** Every `R-BTN-n` in a text. */
export function citedIds(text) {
  return new Set([...text.matchAll(/\bR-BTN-(\d+)\b/g)].map((m) => `R-BTN-${m[1]}`));
}

/** The problems with a spec, given the code's texts by path, the ticket ids that exist, the
 *  history file and the names of test/integration/'s files. */
export function check(spec, code, tickets, history = '', testNames = []) {
  const problems = [];
  const warnings = [];
  const defined = new Set([...definedIds(spec), ...COURSE_IDS]);
  const retired = retiredIds(history);
  const scenarios = scenarioIds(spec);
  const retiredScenarios = retiredScenarioIds(history);
  for (const [path, text] of code) {
    for (const id of citedIds(text)) {
      if (defined.has(id)) continue;
      if (retired.has(id)) warnings.push(`${path} cites ${id}, which is retired (spec/BATON_SPEC_HISTORY.md)`);
      else problems.push(`${path} cites ${id}, which the spec does not define`);
    }
  }
  for (const name of testNames) {
    const id = fileScenario(name);
    if (!id || RETIRED_TESTS_ALLOWED.includes(id)) continue;
    if (retiredScenarios.has(id)) problems.push(`test/integration/${name} is named for the retired scenario ${id} (spec/BATON_SPEC_HISTORY.md)`);
    else if (!scenarios.has(id)) problems.push(`test/integration/${name} is named for ${id}, which §15's scenario table does not define`);
  }
  for (const id of new Set([...spec.matchAll(/(?<![\w-])(R3-\d+|B-\d+)\b/g)].map((m) => m[1]))) {
    if (!tickets.has(id) && !EXAMPLE_TICKETS.includes(id)) problems.push(`the spec cites ${id}, which is not a ticket here`);
  }
  for (const term of SCRUBBED) {
    if (spec.toLowerCase().includes(term)) problems.push(`the spec contains the scrubbed term "${term}"`);
  }
  Object.defineProperty(problems, 'warnings', { value: warnings, enumerable: false });
  return problems;
}

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|mjs|js|qnt|sql|md)$/.test(name) ? [path] : [];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = readFileSync(join(REPO, 'spec', 'BATON_SPEC.md'), 'utf8');
  const code = ['src', 'test', 'model', 'cli'].flatMap((d) => files(join(REPO, d)))
    .map((p) => [relative(REPO, p), readFileSync(p, 'utf8')]);
  const tickets = new Set(['tickets', 'tickets/archive'].flatMap((d) => readdirSync(join(REPO, d)))
    .filter((n) => n.endsWith('.mdx')).map((n) => n.slice(0, -4)));
  const historyPath = join(REPO, 'spec', 'BATON_SPEC_HISTORY.md');
  const history = existsSync(historyPath) ? readFileSync(historyPath, 'utf8') : '';
  const integration = join(REPO, 'test', 'integration');
  const testNames = existsSync(integration) ? readdirSync(integration) : [];
  const problems = check(spec, code, tickets, history, testNames);
  for (const w of problems.warnings) console.warn(`! ${w}`);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`check-spec: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`check-spec OK — ${definedIds(spec).size} requirements; ${code.length} code files cite only those; ${testNames.filter((n) => fileScenario(n)).length} scenario test files each name a §15 row`);
}
