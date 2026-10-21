// check-spec (R3-1252): spec/BATON_SPEC.md defines every requirement the code cites, cites only
// tickets that exist here, and carries none of the scrubbed terms; every test/integration/ file
// named for a scenario names one §15 defines and not one the history retired (B-71).
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script, no types
import { check, definedIds, retiredIds, retiredScenarioIds, scenarioIds } from '../../scripts/check-spec.mjs';

const SPEC = [
  '- **R-BTN-1 (the lock).** One holder.',
  '- **The worker declares its own lease timeout** (R-BTN-9): a property.',
  '| 4-A-8 = 4-B-13 a review finding id, not a ticket |',
  'Owned by R3-1205.',
].join('\n');

describe('check-spec', () => {
  it('reads both ways a rule is defined', () => {
    expect([...definedIds(SPEC)].sort()).toEqual(['R-BTN-1', 'R-BTN-9']);
  });

  it('passes code that cites only defined rules and a spec that cites existing tickets', () => {
    expect(check(SPEC, [['src/a.ts', '// R-BTN-1, R-BTN-9, R-BTN-27 (the course spec)']], new Set(['R3-1205']))).toEqual([]);
  });

  it('names an undefined rule, a missing ticket and a scrubbed term', () => {
    const problems = check(SPEC + '\nOn garda.', [['src/a.ts', '// R-BTN-2']], new Set());
    expect(problems).toEqual([
      'src/a.ts cites R-BTN-2, which the spec does not define',
      'the spec cites R3-1205, which is not a ticket here',
      'the spec contains the scrubbed term "garda"',
    ]);
  });

  it('reads a merged heading as defining both ids', () => {
    expect([...definedIds('- **R-BTN-117 / R-BTN-159 (keys).** Text.')].sort()).toEqual(['R-BTN-117', 'R-BTN-159']);
  });

  it('warns, and does not fail, on code citing a retired rule', () => {
    const history = '## Retired requirements\n\n| Id | Title |\n|---|---|\n| R-BTN-80 | notices |\n\n## Other\n| R-BTN-3 | not retired |\n';
    expect([...retiredIds(history)]).toEqual(['R-BTN-80']);
    const problems = check(SPEC, [['src/a.ts', '// R-BTN-80, R-BTN-3']], new Set(['R3-1205']), history);
    expect([...problems]).toEqual(['src/a.ts cites R-BTN-3, which the spec does not define']);
    expect(problems.warnings).toEqual(['src/a.ts cites R-BTN-80, which is retired (spec/BATON_SPEC_HISTORY.md)']);
  });

  it('reads the retired scenarios and the §15 rows', () => {
    const history = '## Retired scenarios and gates\n\n| Id | What it tested |\n|---|---|\n| S-BTN-35 | a claim during a hook call |\n| G-BTN-54 | hook sandboxing |\n';
    expect([...retiredScenarioIds(history)]).toEqual(['S-BTN-35']);
    const spec = '### Scenarios\n\n| Scenario | Sets up | Expects |\n|---|---|---|\n| S-BTN-1 claim race | two claims | one holder |\n| S-BTN-45 edges of blocks, a queue over its bound | … | … |\n';
    expect([...scenarioIds(spec)].sort()).toEqual(['S-BTN-1', 'S-BTN-45']);
  });

  it('flags a test file named for a retired scenario and one for an id §15 does not define', () => {
    const history = '## Retired scenarios and gates\n\n| Id | What it tested |\n|---|---|\n| S-BTN-35 | a claim during a hook call |\n| S-BTN-46 | couriers |\n';
    const spec = `${SPEC}\n### Scenarios\n\n| Scenario | Sets up | Expects |\n|---|---|---|\n| S-BTN-1 claim race | two claims | one holder |\n`;
    const names = ['S-BTN-1.claim-race.test.ts', 'S-BTN-35.hook-claim.test.ts', 'S-BTN-999.no-row.test.ts', 'helpers.ts'];
    const problems = check(spec, [['src/a.ts', '// R-BTN-1']], new Set(['R3-1205']), history, names);
    expect([...problems]).toEqual([
      'test/integration/S-BTN-35.hook-claim.test.ts is named for the retired scenario S-BTN-35 (spec/BATON_SPEC_HISTORY.md)',
      `test/integration/S-BTN-999.no-row.test.ts is named for S-BTN-999, which §15's scenario table does not define`,
    ]);
  });

  it('allows the allowlisted retired files (B-67 empties the list)', () => {
    const history = '## Retired scenarios and gates\n\n| Id | What it tested |\n|---|---|\n| S-BTN-46 | couriers |\n';
    const problems = check(SPEC, [['src/a.ts', '// R-BTN-1']], new Set(['R3-1205']), history,
      ['S-BTN-46.decision-reaches-owner.test.ts', 'S-BTN-60.worker-couriers.test.ts']);
    expect([...problems]).toEqual([]);
  });
});
