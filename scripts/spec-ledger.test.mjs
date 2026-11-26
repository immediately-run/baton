import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { basePending, codeTexts, ledgerProblems, pendingBaseRef, pendingIds, PENDING, ruleLedger } from './spec-ledger.mjs';

const SPEC = [
  '- **R-BTN-1 / R-BTN-2 (both).** `status: built B-276` `status: partly` Text.',
  '- **R-BTN-30 (coverage).** `status: specified B-50 B-276` Text.',
  '### Scenarios',
  '| S-BTN-907 scenario | steps | R-BTN-2 |',
  '| S-BTN-908 another scenario | steps | R-BTN-1',
  '### Gates',
].join('\n');

describe('spec ledger (R-BTN-30)', () => {
  it('requires exactly one valid token for each rule id in a heading', () => {
    for (const replacement of ['', '`status: future`', '`status: partly` `status: retiring`']) {
      const ledger = ruleLedger(SPEC.replace('`status: partly`', replacement), []);
      expect(ledger.problems).toEqual(['R-BTN-1 / R-BTN-2 needs one valid status token per rule']);
    }
  });

  it('requires a source citation for a built rule, not a citation in a test, model, or document', () => {
    const evidence = ['test/unit/one.test.ts', 'model/baton.qnt', 'src/README.md'].map((path) => [path, 'R-BTN-1']);
    const pending = new Set(['S-BTN-907', 'S-BTN-908']);
    const check = () => ledgerProblems(ruleLedger(SPEC, evidence), new Set(), pending, pending);
    expect(check()).toEqual(['R-BTN-1 is built but no source file cites it']);
    evidence.push(['src/one.ts', 'R-BTN-1']);
    expect(check()).toEqual([]);
  });

  it('fails specified rules only when all their listed tickets are archived', () => {
    const ledger = ruleLedger(SPEC, [['src/one.ts', 'R-BTN-1']]);
    const pending = new Set(['S-BTN-907', 'S-BTN-908']);
    expect(ledgerProblems(ledger, new Set(['B-50']), pending, pending)).toEqual([]);
    expect(ledgerProblems(ledger, new Set(['B-50', 'B-276']), pending, pending)).toEqual([
      'R-BTN-30 is specified but all its tickets are archived: B-50, B-276',
    ]);
  });

  it('counts a test filename or literal title, and checks rows even without a trailing pipe', () => {
    const evidence = [
      ['src/one.ts', 'R-BTN-1'],
      ['test/integration/S-BTN-907.a.test.ts', ''],
      ['test/unit/one.test.ts', `
        // S-BTN-908 replaced a retired scenario
        const fixture = "it('S-BTN-908 fixture', () => {})";
        it('S-BTN-9080 is a different scenario', () => expect(fixture).toContain('S-BTN-908'));
      `],
      ['test/unit/helpers.ts', '// S-BTN-908'],
    ];
    const ledger = ruleLedger(SPEC, evidence);
    const base = new Set(['S-BTN-907']);
    expect(ledger.rules.get('R-BTN-2').tests).toEqual(['test/integration/S-BTN-907.a.test.ts']);
    expect(ledgerProblems(ledger, new Set(), base, base)).toEqual([
      'S-BTN-908 has neither a test nor a pending entry',
      'S-BTN-907 no longer needs a pending entry; remove it',
    ]);
    expect(ledgerProblems(ledger, new Set(), new Set(['S-BTN-908']), base)).toEqual([
      'S-BTN-908 adds to the pending list without a ticket; a new entry is { "id", "ticket" } naming the open ticket that builds it',
    ]);
    evidence[2][1] = "it('S-BTN-908 checks the result', () => {})";
    expect(ledgerProblems(ruleLedger(SPEC, evidence), new Set(), new Set(), base)).toEqual([]);
    expect(ruleLedger(SPEC, evidence).rules.get('R-BTN-1').tests).toEqual(['test/unit/one.test.ts']);
  });

  it('lets the pending list grow only by an entry naming an open ticket (owner ruling 2026-11-26)', () => {
    const ledger = ruleLedger(SPEC, [['src/one.ts', 'R-BTN-1']]);
    const base = new Set(['S-BTN-907']);
    const open = new Set(['B-338']);
    const tagged = pendingIds('["S-BTN-907", { "id": "S-BTN-908", "ticket": "B-338" }]');
    expect(tagged).toEqual(new Map([['S-BTN-907', null], ['S-BTN-908', 'B-338']]));
    expect(ledgerProblems(ledger, new Set(), tagged, base, open)).toEqual([]);
    expect(ledgerProblems(ledger, new Set(), pendingIds('["S-BTN-907", "S-BTN-908"]'), base, open)).toEqual([
      'S-BTN-908 adds to the pending list without a ticket; a new entry is { "id", "ticket" } naming the open ticket that builds it',
    ]);
    for (const ticket of ['B-1', 'B-9999']) { // a done ticket and a missing one are both absent from `open`
      expect(ledgerProblems(ledger, new Set(), pendingIds(`["S-BTN-907", { "id": "S-BTN-908", "ticket": "${ticket}" }]`), base, open)).toEqual([
        `S-BTN-908 adds to the pending list naming ${ticket}, which is not an open ticket in tickets/`,
      ]);
    }
    // An entry already on the default branch keeps its place, tagged or not.
    expect(ledgerProblems(ledger, new Set(), tagged, new Set(['S-BTN-907', 'S-BTN-908']))).toEqual([]);
    for (const raw of ['[{ "id": "S-BTN-908" }]', '[{ "id": "S-BTN-908", "ticket": "B-338", "x": 1 }]', '["S-BTN-908", { "id": "S-BTN-908", "ticket": "B-338" }]']) {
      expect(() => pendingIds(raw)).toThrow('unique scenario ids');
    }
  });

  it('gives the same ledger before and after generated dashboard output appears', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-ledger-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
      git('init', '-q');
      mkdirSync(join(root, 'src/dashboard'), { recursive: true });
      writeFileSync(join(root, '.gitignore'), '/src/dashboard/dist/\n');
      writeFileSync(join(root, 'src/dashboard/app.ts'), '// R-BTN-1');
      git('add', '.');
      const before = ruleLedger(SPEC, codeTexts(root));
      expect(before.rules.get('R-BTN-1').sources).toEqual(['src/dashboard/app.ts']);
      mkdirSync(join(root, 'src/dashboard/dist'));
      writeFileSync(join(root, 'src/dashboard/dist/app.js'), '// R-BTN-1');
      expect(ruleLedger(SPEC, codeTexts(root))).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the committed base list, or derives it from the base tests before first landing', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-pending-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
      const verification = 'spec/verification.md';
      const commit = () => {
        git('add', '.');
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
      };
      git('init', '-q');
      mkdirSync(join(root, 'spec'));
      mkdirSync(join(root, 'test'));
      writeFileSync(join(root, verification), SPEC);
      writeFileSync(join(root, 'test', 'one.test.ts'), "describe('S-BTN-907', () => { it('works', () => {}) });\n// S-BTN-908");
      commit();
      expect(basePending(root, 'HEAD', verification)).toEqual(new Set(['S-BTN-908']));
      writeFileSync(join(root, PENDING), '[]');
      commit();
      writeFileSync(join(root, PENDING), '["S-BTN-908"]');
      expect(basePending(root, 'HEAD', verification)).toEqual(new Set());
      expect(() => pendingIds('["S-BTN-908", "S-BTN-908"]')).toThrow('unique scenario ids');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compares a shallow Actions push to main with the previous tip, not the new commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-push-'));
    try {
      const origin = join(root, 'origin');
      const clone = join(root, 'clone');
      mkdirSync(origin);
      const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const commit = () => git(origin, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-am', 'fixture');
      git(origin, 'init', '-q', '-b', 'main');
      mkdirSync(join(origin, 'spec'));
      writeFileSync(join(origin, PENDING), '[]');
      git(origin, 'add', PENDING);
      commit();
      const before = git(origin, 'rev-parse', 'HEAD');
      writeFileSync(join(origin, PENDING), '["S-BTN-908"]');
      commit();
      git(root, 'clone', '-q', '--depth=1', `file://${origin}`, clone);
      expect(() => git(clone, 'cat-file', '-e', before)).toThrow();
      const event = join(root, 'event.json');
      writeFileSync(event, JSON.stringify({ before }));
      const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_PATH: event };
      const base = pendingBaseRef(clone, env);
      expect(base).toBe(before);
      expect(basePending(clone, base, 'unused')).toEqual(new Set());
      expect(basePending(clone, pendingBaseRef(clone, { ...env, GITHUB_EVENT_NAME: 'pull_request' }), 'unused')).toEqual(new Set(['S-BTN-908']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
