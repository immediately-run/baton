// model-report.test.ts — R3-1254 round 1 (1-A-2, 1-A-3): the model:full report is written on the
// author's machine and checked in CI against the PR's head (R-BTN-68, amended 2026-10-17).
import { describe, it, expect } from 'vitest';
import { CHECKS, needsReport, renderReport, reportProblem, stepEnv } from '../../scripts/model-report.mjs';

const HEAD = 'a'.repeat(40);
const passing: [string, boolean, number][] = [['npm run model (10000 samples)', true, 6], ['model-based tests (1000 traces)', true, 9], ['npm run model:verify (depth 4)', true, 20]];
const report = (over: Partial<Parameters<typeof renderReport>[0]> = {}) =>
  renderReport({ head: HEAD, dirty: '', quintVersion: '0.33.0', platform: 'linux-x64', rows: passing, ...over });

describe('renderReport', () => {
  it('passes when every check passed on a clean tree, and names the commit', () => {
    const r = report();
    expect(r.ok).toBe(true);
    expect(r.text).toContain(`Commit \`${HEAD}\`; Quint 0.33.0; linux-x64.`);
    expect(r.text).toContain('| npm run model:verify (depth 4) | pass | 20 |');
    expect(CHECKS).toEqual(passing.map(([label]) => label));
  });
  it('fails a failing check, a dirty tree, and no checks at all', () => {
    expect(report({ rows: [passing[0], [passing[1][0], false, 9], passing[2]] }).ok).toBe(false);
    expect(report({ rows: [passing[0], [passing[1][0], false, 9], passing[2]] }).text).toContain('| model-based tests (1000 traces) | **FAIL** | 9 |');
    const dirty = report({ dirty: ' M model/baton.qnt' });
    expect(dirty.ok).toBe(false);
    expect(dirty.text).toContain('with uncommitted changes');
    expect(report({ rows: [] }).ok).toBe(false);
  });
  it('fails a reduced run — fewer samples, fewer traces or a shallower proof — and says so (2-r2-1)', () => {
    for (const reduced of [['npm run model (10 samples)', true, 1], ['model-based tests (5 traces)', true, 1], ['npm run model:verify (depth 1)', true, 1]] as [string, boolean, number][]) {
      const rows = passing.map((row) => (row[0].split(' (')[0] === reduced[0].split(' (')[0] ? reduced : row));
      const r = report({ rows });
      expect(r.ok).toBe(false);
      expect(r.text).toContain('a reduced run — not a report for a PR');
    }
  });
});

describe('reportProblem: the CI check on a PR body', () => {
  const body = (text: string) => `## Tests\n\nSome prose.\n\n${text}\n\n## Untested and why\n\n- liveness`;
  it('accepts a passing report for the head, CRLF line ends included', () => {
    expect(reportProblem(body(report().text), HEAD)).toBeNull();
    expect(reportProblem(body(report().text).replace(/\n/g, '\r\n'), HEAD)).toBeNull();
  });
  it('refuses no report, another commit, a dirty run, a failed or missing check', () => {
    expect(reportProblem('## Tests\n\nnone', HEAD)).toMatch(/no ".*" report/);
    expect(reportProblem(body(report({ head: 'b'.repeat(40) }).text), HEAD)).toBe(`the report is for bbbbbbb, not the head aaaaaaa`);
    expect(reportProblem(body(report({ dirty: ' M x' }).text), HEAD)).toMatch(/uncommitted/);
    expect(reportProblem(body(report({ rows: [passing[0], passing[1], [passing[2][0], false, 20]] }).text), HEAD)).toBe('"npm run model:verify (depth 4)" did not pass');
    expect(reportProblem(body(report({ rows: [passing[0], passing[2]] }).text), HEAD)).toBe('the report has no "model-based tests (1000 traces)" row');
  });
  it('refuses a reduced run\'s rows, each check at its full size only (2-r2-1)', () => {
    const reduced = report({ rows: [['npm run model (10 samples)', true, 1], passing[1], passing[2]] }).text;
    expect(reportProblem(body(reduced), HEAD)).toBe('the report has no "npm run model (10000 samples)" row');
    const shallow = report({ rows: [passing[0], passing[1], ['npm run model:verify (depth 1)', true, 1]] }).text;
    expect(reportProblem(body(shallow), HEAD)).toBe('the report has no "npm run model:verify (depth 4)" row');
  });
  it('reads only the report: a later section\'s table does not count', () => {
    const r = report({ rows: [passing[0], passing[2]] }).text;
    expect(reportProblem(`${r}\n\n## Other\n\n| model-based tests (1000 traces) | pass | 1 |`, HEAD)).toBe('the report has no "model-based tests (1000 traces)" row');
  });
});

describe('needsReport: what the model checks read', () => {
  it('the model, the core, the replay and the trace check need a report; the rest does not', () => {
    for (const f of ['model/baton.qnt', 'src/core/claims.ts', 'test/model/replay.test.ts', 'test/integration/trace.ts', 'scripts/check-traces.mjs']) expect(needsReport([f])).toBe(true);
    // what the core and the replay import, and the lock file that pins Quint and Apalache (2-r2-0)
    for (const f of ['src/shared/vocabulary.mjs', 'src/migrations/0016_blocks.sql', 'test/helpers.ts', 'test/lib/sshKeys.mjs', 'package-lock.json']) expect(needsReport([f])).toBe(true);
    expect(needsReport(['tickets/R3-1254.mdx', 'src/defaults/cli.ts', 'test/integration/S-BTN-43.defaults.test.ts', 'CHANGELOG.md'])).toBe(false);
    expect(needsReport([])).toBe(false);
  });
});

describe('stepEnv: what each model:full step runs with (baton#48 round 3, 3-r3-0)', () => {
  it('drops REPLAY_ONLY, which would replay a subset under the full-size label; keeps the rest and sets the step\'s sizes', () => {
    expect(stepEnv({ PATH: '/bin', REPLAY_ONLY: 'rlegs_5', REPLAY_TRACES: '5' }, { REPLAY_TRACES: '1000' })).toEqual({ PATH: '/bin', REPLAY_TRACES: '1000' });
  });
});
