#!/usr/bin/env node
// check-spec.mjs — the spec and the code agree on what the spec defines (R3-1252).
//
//   npm run check:spec        check spec/BATON_SPEC.md against src/, test/, model/, cli/ and tickets/
//
// - every requirement id (`R-BTN-n`) the code cites is defined in the spec — as a bold
//   `**R-BTN-n` rule heading or a bold rule followed by `(R-BTN-n)` — or is one of the
//   `roadmap-pr` course's own (COURSE_IDS), whose spec stays in docs;
// - every ticket the spec cites (`R3-n`, `B-n`) is a ticket in tickets/ or tickets/archive/;
// - none of the scrub's terms (SCRUBBED) is in the spec: the repository is public.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Terms removed when the spec moved here (R3-1267's scrub list): a hostname that is not
 *  Baton's, and docs' private publication. */
export const SCRUBBED = ['garda', 'publication/', 'study-log', 'the study'];

/** Requirement ids defined in docs' `BATON_ROADMAP_PR_COURSE`, the reference deployment's course
 *  spec, which stays in docs: the code that serves that course may cite them. */
/** Ticket ids the spec uses only as examples of a value (`'remainder:R3-9'`, §4). */
export const EXAMPLE_TICKETS = ['R3-9'];

export const COURSE_IDS = ['R-BTN-21', 'R-BTN-27', 'R-BTN-42', 'R-BTN-43', 'R-BTN-49'];

/** The requirement ids the spec defines: each `**R-BTN-n` that opens a rule, and each bold rule
 *  title followed by its id (`- **The worker declares its own lease timeout** (R-BTN-9)`). */
export function definedIds(spec) {
  return new Set([
    ...[...spec.matchAll(/\*\*(R-BTN-\d+)\b/g)].map((m) => m[1]),
    ...[...spec.matchAll(/^\s*- \*\*[^*\n]+\*\* \((R-BTN-\d+)\)/gm)].map((m) => m[1]),
  ]);
}

/** Every `R-BTN-n` in a text. */
export function citedIds(text) {
  return new Set([...text.matchAll(/\bR-BTN-(\d+)\b/g)].map((m) => `R-BTN-${m[1]}`));
}

/** The problems with a spec, given the code's texts by path and the ticket ids that exist. */
export function check(spec, code, tickets) {
  const problems = [];
  const defined = new Set([...definedIds(spec), ...COURSE_IDS]);
  for (const [path, text] of code) {
    for (const id of citedIds(text)) if (!defined.has(id)) problems.push(`${path} cites ${id}, which the spec does not define`);
  }
  for (const id of new Set([...spec.matchAll(/(?<![\w-])(R3-\d+|B-\d+)\b/g)].map((m) => m[1]))) {
    if (!tickets.has(id) && !EXAMPLE_TICKETS.includes(id)) problems.push(`the spec cites ${id}, which is not a ticket here`);
  }
  for (const term of SCRUBBED) {
    if (spec.toLowerCase().includes(term)) problems.push(`the spec contains the scrubbed term "${term}"`);
  }
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
  const problems = check(spec, code, tickets);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`check-spec: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`check-spec OK — ${definedIds(spec).size} requirements; ${code.length} code files cite only those`);
}
