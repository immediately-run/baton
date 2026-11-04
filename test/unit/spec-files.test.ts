// spec-files (B-179): BATON_SPEC as one file per section — the join is the spec, the parts are
// well formed, a joined line maps back to its file, the index is generated from the parts and
// check:spec fails a stale one, and spec-tools reads a directory as its parts joined.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error a plain .mjs script, no types
import { SPEC_DIR, SPEC_INDEX, indexText, joinParts, locate, partProblems, readSpec, specParts } from '../../scripts/spec-files.mjs';
// @ts-expect-error a plain .mjs script, no types
import { readSpecAt } from '../../scripts/spec-tools.mjs';

type Part = { name: string; path: string; text: string };
const ROOT = resolve(import.meta.dirname, '..', '..');

function fixture(parts: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'baton-spec-'));
  mkdirSync(join(root, 'spec', 'BATON_SPEC'), { recursive: true });
  for (const [name, text] of Object.entries(parts)) writeFileSync(join(root, 'spec', 'BATON_SPEC', name), text);
  return root;
}

const FRONT = '# Spec\n\n## Contents\n\n| § | Title |\n';
const ONE = '## 1. One *(proposal)*\n\n### 1.1 Sub\n\n- **R-BTN-1 (one home per fact).** Each fact.\n- **R-BTN-2 / R-BTN-3 (two at once).** Both.\n';
const TWO = '## 2. Two\n\n| S-BTN-7 a scenario | steps | expected |\n| G-BTN-9 | a gate |\n';

describe('spec-files (B-179)', () => {
  it('the parts, joined in name order, are the spec; readSpec reads the join', () => {
    const root = fixture({ '02-two.md': TWO, '00-front.md': FRONT, '01-one.md': ONE, 'README.txt': 'not a part' });
    const parts: Part[] = specParts(root);
    expect(parts.map((p) => p.name)).toEqual(['00-front.md', '01-one.md', '02-two.md']);
    expect(joinParts(parts)).toBe(FRONT + ONE + TWO);
    expect(readSpec(root)).toBe(FRONT + ONE + TWO);
  });

  it('a joined line maps back to its file and line', () => {
    const parts: Part[] = specParts(fixture({ '00-front.md': FRONT, '01-one.md': ONE, '02-two.md': TWO }));
    expect(locate(parts, 1)).toBe(`${SPEC_DIR}/00-front.md:1`);
    expect(locate(parts, FRONT.split('\n').length)).toBe(`${SPEC_DIR}/01-one.md:1`);
    expect(locate(parts, (FRONT + ONE).split('\n').length + 1)).toBe(`${SPEC_DIR}/02-two.md:2`);
  });

  it('a part opens with its one `## ` heading; the first part is the front', () => {
    const ok: Part[] = specParts(fixture({ '00-front.md': FRONT, '01-one.md': ONE }));
    expect(partProblems(ok)).toEqual([]);
    const bad: Part[] = specParts(fixture({ '00-front.md': FRONT, '01-one.md': `text first\n${ONE}`, '02-two.md': TWO + '## 3. Three\n' }));
    expect(partProblems(bad)).toEqual([
      `${SPEC_DIR}/01-one.md: a part opens with its \`## \` heading`,
      `${SPEC_DIR}/02-two.md: a part holds one \`## \` heading, not 2`,
    ]);
  });

  it('the index lists each file, its subsections and their rules, and every rule, scenario and gate id', () => {
    const text: string = indexText(specParts(fixture({ '00-front.md': FRONT, '01-one.md': ONE, '02-two.md': TWO })));
    expect(text).toContain('| [`01-one.md`](BATON_SPEC/01-one.md) | **1. One** | — |');
    expect(text).toContain('| | 1.1 Sub | R-BTN-1, R-BTN-2, R-BTN-3 |');
    expect(text).toContain('| R-BTN-2 | two at once | [`01-one.md`](BATON_SPEC/01-one.md) |');
    expect(text).toContain('| S-BTN-7 | a scenario | [`02-two.md`](BATON_SPEC/02-two.md) |');
    expect(text).toContain('| G-BTN-9 | — | [`02-two.md`](BATON_SPEC/02-two.md) |');
  });

  it('this repository: the parts are well formed and the committed index is the generated one', () => {
    const parts: Part[] = specParts(ROOT);
    expect(partProblems(parts)).toEqual([]);
    expect(readFileSync(join(ROOT, SPEC_INDEX), 'utf8')).toBe(indexText(parts));
  });

  it('spec-tools reads a directory as its parts joined, and a file as itself', () => {
    const root = fixture({ '00-front.md': FRONT, '01-one.md': ONE });
    const dir = readSpecAt(root, 'spec/BATON_SPEC');
    expect(dir.text).toBe(FRONT + ONE);
    expect(dir.where(FRONT.split('\n').length)).toBe('spec/BATON_SPEC/01-one.md:1');
    writeFileSync(join(root, 'spec', 'ONE.md'), ONE);
    const file = readSpecAt(root, 'spec/ONE.md');
    expect(file.text).toBe(ONE);
    expect(file.where(3)).toBe('l. 3');
  });
});
