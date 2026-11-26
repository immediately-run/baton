// B-276 / R-BTN-30: rule metadata and scenario evidence. Both spec:index and check:spec
// consume this ledger; neither reads the generated index as evidence.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
export const fileScenario = (name) => /^(S-BTN-\d+)\.(?:.*\.)?test\.[cm]?[jt]sx?$/.exec(name)?.[1] ?? null;

function testScenarios(path, text) {
  const ids = new Set();
  const inName = fileScenario(path.split('/').at(-1));
  if (inName) ids.add(inName);
  if (!text.includes('S-BTN-')) return ids;
  // Read literal test/suite titles, not comments, fixtures, or expected values.
  const ts = createRequire(import.meta.url)('typescript');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
  const walk = (node) => {
    if (ts.isCallExpression(node)) {
      const { expression: callee, arguments: [title] } = node;
      if (ts.isIdentifier(callee) && /^(test|it|describe)$/.test(callee.text)
        && title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
        for (const id of title.text.match(/\bS-BTN-\d+\b/g) ?? []) ids.add(id);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
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

/** A scenario or gate names itself in the first cell. Outer pipes are optional. */
export function verificationRow(line) {
  const cells = line.trim().split(/(?<!\\)\|/);
  if (cells[0] === '') cells.shift();
  if (cells.at(-1) === '') cells.pop();
  if (cells.length < 2) return null;
  const name = /^([SG]-BTN-\d+)\b(.*)$/.exec(cells[0].trim());
  return name && { id: name[1], title: name[2].trim(), rules: citedIds(cells.at(-1)) };
}

function scenarioRules(spec) {
  const rows = spec.split('\n').map(verificationRow);
  return new Map(rows.filter((row) => row?.id.startsWith('S-')).map(({ id, rules }) => [id, rules]));
}

export const scenarioIds = (spec) => new Set(scenarioRules(spec).keys());

const gitAt = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'] });

export function codeTexts(root) {
  // Stage new evidence files before generating; read working-tree edits to tracked files.
  const paths = gitAt(root, ['ls-files', '-z', '--cached', '--', 'src', 'test', 'model', 'cli', 'scripts']).split('\0');
  return [...new Set(paths)].sort()
    .filter((path) => /\.(?:[cm]?[jt]sx?|qnt|sql|md)$/.test(path) && lstatSync(join(root, path), { throwIfNoEntry: false })?.isFile())
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

/** The pending list: an array whose entries are a scenario id (`"S-BTN-3"`) or, for an entry
 * added since the owner's 2026-11-26 ruling, `{ "id": "S-BTN-321", "ticket": "B-338" }` naming
 * the open ticket that builds it. Returns id → ticket (null for a bare id). */
export function pendingIds(raw) {
  const entries = JSON.parse(raw);
  const bad = () => new Error(`${PENDING}: expected a JSON array of unique scenario ids, each a string or { "id", "ticket" }`);
  if (!Array.isArray(entries)) throw bad();
  const pending = new Map();
  for (const entry of entries) {
    const tagged = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    const id = tagged ? entry.id : entry;
    if (typeof id !== 'string' || !SCENARIO_ID.test(id) || pending.has(id)) throw bad();
    if (tagged && (typeof entry.ticket !== 'string' || Object.keys(entry).some((k) => k !== 'id' && k !== 'ticket'))) throw bad();
    pending.set(id, tagged ? entry.ticket : null);
  }
  return pending;
}

/** Read the default branch's list, not the branch being checked. At first landing the
 * default branch has no list yet: derive its exact gaps from its committed tests. */
export function basePending(root, base, verificationPath) {
  const git = (...args) => gitAt(root, args);
  const tree = git('ls-tree', '-r', '--name-only', base, '--', PENDING, 'test').trim().split('\n');
  if (tree.includes(PENDING)) return new Set(pendingIds(git('show', `${base}:${PENDING}`)).keys());
  const scenarios = scenarioIds(git('show', `${base}:${verificationPath}`));
  for (const path of tree.filter(isScenarioTest)) {
    for (const id of testScenarios(path, git('show', `${base}:${path}`))) scenarios.delete(id);
  }
  return scenarios;
}

/** On Actions pushes to main, origin/main already points at the new tree. Fetch only the
 * previous tip if the depth-one checkout lacks it. PRs use the workflow's fetched base. */
export function pendingBaseRef(root, env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') return 'origin/main';
  const { before } = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  if (typeof before !== 'string' || !/^[a-f0-9]{40}$/.test(before) || /^0+$/.test(before)) {
    throw new Error('main push event has no valid previous commit');
  }
  try {
    gitAt(root, ['cat-file', '-e', `${before}^{commit}`]);
  } catch {
    gitAt(root, ['fetch', '--no-tags', '--depth=1', 'origin', before]);
  }
  return before;
}

/** `pending` is pendingIds' map (a Set of bare ids also works); `baseline` the default
 * branch's ids. An entry not in the baseline must name a ticket in `open` (openTickets). */
export function ledgerProblems(ledger, archived, pending, baseline, open = new Set()) {
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
  const tickets = pending instanceof Map ? pending : new Map([...pending].map((id) => [id, null]));
  for (const [id, ticket] of tickets) {
    if (!baseline.has(id)) {
      if (ticket === null) out.push(`${id} adds to the pending list without a ticket; a new entry is { "id", "ticket" } naming the open ticket that builds it`);
      else if (!open.has(ticket)) out.push(`${id} adds to the pending list naming ${ticket}, which is not an open ticket in tickets/`);
    }
    if (!scenarios.has(id) || covered.has(id)) out.push(`${id} no longer needs a pending entry; remove it`);
  }
  return out;
}
