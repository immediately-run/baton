// B-276 / R-BTN-30: rule metadata and scenario evidence. Both spec:index and check:spec
// consume this ledger; neither reads the generated index as evidence.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PENDING = 'spec/scenarios-pending.json';
const RULE = /^- \*\*(R-BTN-\d+(?: \/ R-BTN-\d+)*)\b(.*)$/;
const LABEL = /^- \*\*([^*\n]+)\*\* \((R-BTN-\d+)\)(.*)$/;
const TOKEN = /^`status: (built|partly|specified|retiring)((?: (?:R3|B)-\d+)*)`$/;
const SCENARIO_ID = /^S-BTN-\d+$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const isScenarioTest = (path) => path.startsWith('test/') && TEST_FILE.test(path);
const SOURCE = /^(src|cli|scripts)\/.*\.(?:[cm]?[jt]sx?|sql)$/;

export const citedIds = (text) => new Set(text.match(/\bR-BTN-\d+\b/g));
const namedScenarios = (text) => new Set(text.match(/\bS-BTN-\d+\b/g));
export const fileScenario = (name) => /^(S-BTN-\d+)\.(?:.*\.)?test\.[cm]?[jt]sx?$/.exec(name)?.[1] ?? null;

function testScenarios(path, text) {
  const ids = namedScenarios(text);
  const inName = fileScenario(path.split('/').at(-1));
  if (inName) ids.add(inName);
  return ids;
}

/** The rule heading, including the older bold-label form. Labels for rules defined by a
 * canonical heading elsewhere are citations, not second definitions. */
export function ruleHeading(line) {
  const rule = RULE.exec(line);
  if (rule) {
    const close = rule[2].indexOf('**');
    return { ids: rule[1].split(' / '), title: /^ \(([^)]*)/.exec(rule[2])?.[1] ?? '', rest: close === -1 ? '' : rule[2].slice(close + 2) };
  }
  const label = LABEL.exec(line);
  if (label) return { ids: [label[2]], title: label[1], rest: label[3], label: true };
  return null;
}

export function ruleDefinitions(spec) {
  const headings = new Map();
  spec.split('\n').forEach((line, i) => {
    const h = ruleHeading(line);
    if (h) headings.set(i, h);
  });
  const canonical = new Set([...headings.values()].filter((h) => !h.label).flatMap((h) => h.ids));
  for (const [i, h] of headings) if (h.label && canonical.has(h.ids[0])) headings.delete(i);
  return headings;
}

export const definedIds = (spec) => new Set([...ruleDefinitions(spec).values()].flatMap((h) => h.ids));

function scenarioRules(spec) {
  const table = spec.split(/^#{1,3} /m).find((section) => section.startsWith('Scenarios\n')) ?? '';
  return new Map([...table.matchAll(/^\| *(S-BTN-\d+)\b.*\|([^|\n]*)\|[ \t]*$/gm)]
    .map(([, id, rules]) => [id, citedIds(rules)]));
}

export const scenarioIds = (spec) => new Set(scenarioRules(spec).keys());

export function codeTexts(root) {
  const files = (dir) => existsSync(join(root, dir)) ? readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return files(path);
    return entry.isFile() && /\.(?:[cm]?[jt]sx?|qnt|sql|md)$/.test(path) ? [path] : [];
  }) : [];
  return ['src', 'test', 'model', 'cli', 'scripts'].flatMap(files).sort()
    .map((path) => [path, readFileSync(join(root, path), 'utf8')]);
}

export function ruleLedger(spec, code) {
  const rules = new Map();
  const problems = [];
  for (const { ids, rest } of ruleDefinitions(spec).values()) {
    const tokens = [...rest.matchAll(/`status:[^`]*`/g)].map((m) => TOKEN.exec(m[0]));
    if (tokens.length !== ids.length || tokens.some((m) => !m)) {
      problems.push(`${ids.join(' / ')} needs one valid status token per rule`);
    }
    ids.forEach((id, i) => {
      if (rules.has(id)) problems.push(`${id} is defined more than once`);
      const [, status, tickets = ''] = tokens[i] ?? [];
      rules.set(id, { status, tickets: tickets.trim().split(/ +/).filter(Boolean), sources: [], tests: [] });
    });
  }
  const scenarios = scenarioRules(spec);
  const covered = new Set();
  for (const [path, text] of code) {
    if (isScenarioTest(path)) {
      const cited = citedIds(text);
      let scenarioTest = false;
      for (const id of testScenarios(path, text)) {
        if (!scenarios.has(id)) continue;
        scenarioTest = true;
        covered.add(id);
        for (const rule of scenarios.get(id)) cited.add(rule);
      }
      if (scenarioTest) for (const id of cited) rules.get(id)?.tests.push(path);
    } else if (SOURCE.test(path) && !TEST_FILE.test(path)) {
      for (const id of citedIds(text)) rules.get(id)?.sources.push(path);
    }
  }
  return { rules, scenarios, covered, problems };
}

export function pendingIds(raw) {
  const ids = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !SCENARIO_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error(`${PENDING}: expected a JSON array of unique scenario ids`);
  }
  return new Set(ids);
}

/** Read the default branch's list, not the branch being checked. At first landing the
 * default branch has no list yet: derive its exact gaps from its committed tests. */
export function basePending(root, base, verificationPath) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 });
  const tree = git('ls-tree', '-r', '--name-only', base, '--', PENDING, 'test').trim().split('\n');
  if (tree.includes(PENDING)) return pendingIds(git('show', `${base}:${PENDING}`));
  const scenarios = scenarioIds(git('show', `${base}:${verificationPath}`));
  for (const path of tree.filter(isScenarioTest)) {
    for (const id of testScenarios(path, git('show', `${base}:${path}`))) scenarios.delete(id);
  }
  return scenarios;
}

export function ledgerProblems(ledger, archived, pending, baseline) {
  const { rules, scenarios, covered, problems } = ledger;
  const out = [...problems];
  for (const [id, rule] of rules) {
    if (rule.status === 'built' && !rule.sources.length) out.push(`${id} is built but no source file cites it`);
    if (rule.status === 'specified' && rule.tickets.length && rule.tickets.every((ticket) => archived.has(ticket))) {
      out.push(`${id} is specified but all its tickets are archived: ${rule.tickets.join(', ')}`);
    }
  }
  for (const id of scenarios.keys()) {
    if (!covered.has(id) && !pending.has(id)) out.push(`${id} has neither a test nor a pending entry`);
  }
  for (const id of pending) {
    if (!baseline.has(id)) out.push(`${id} adds to the shrink-only pending list`);
    if (!scenarios.has(id) || covered.has(id)) out.push(`${id} no longer needs a pending entry; remove it`);
  }
  return out;
}
