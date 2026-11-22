import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { basePending, ledgerProblems, pendingIds, PENDING, ruleLedger } from './spec-ledger.mjs';

const SPEC = [
  '- **R-BTN-1 / R-BTN-2 (both).** `status: built B-276` `status: partly` Text.',
  '- **R-BTN-30 (coverage).** `status: specified B-50 B-276` Text.',
  '### Scenarios',
  '| S-BTN-907 scenario | steps | R-BTN-2 |',
  '| S-BTN-908 another scenario | steps | R-BTN-1 |',
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

  it('counts a test filename or a whole-id citation, and rejects gaps and stale or newly pending ids', () => {
    const evidence = [
      ['src/one.ts', 'R-BTN-1'],
      ['test/integration/S-BTN-907.a.test.ts', ''],
      ['test/unit/one.test.ts', '// S-BTN-9080'],
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
      'S-BTN-908 adds to the shrink-only pending list',
    ]);
    evidence[2][1] = '// S-BTN-908';
    expect(ledgerProblems(ruleLedger(SPEC, evidence), new Set(), new Set(), base)).toEqual([]);
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
      writeFileSync(join(root, 'test', 'one.test.ts'), '// S-BTN-907');
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
});
