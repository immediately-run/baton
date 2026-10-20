// check-spec (R3-1252): spec/BATON_SPEC.md defines every requirement the code cites, cites only
// tickets that exist here, and carries none of the scrubbed terms.
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script, no types
import { check, definedIds, retiredIds } from '../../scripts/check-spec.mjs';

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
});
