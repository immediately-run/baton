// spec-files (B-179): BATON_SPEC as one file per section — the join is the spec, the parts are
// well formed and in order, a joined line maps back to its file, the index is generated from the
// parts, check:spec's layout check (`layoutProblems`) fails a stray file, a misordered part or a
// stale index, the move proof compares bytes, and spec-tools reads a directory as its parts joined,
// spec:impact placing each unit at its file and line. B-180: each part is a Grove page whose
// frontmatter spec:index writes; every reader takes the body, and line numbers stay the file's.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error a plain .mjs script, no types
import { SPEC_DIR, SPEC_INDEX, indexText, joinParts, layoutProblems, locate, moveProof, part, partFrontmatter, partProblems, specParts } from '../../scripts/spec-files.mjs';
// @ts-expect-error a plain .mjs script, no types
import { impact, readSpecAt } from '../../scripts/spec-tools.mjs';

type Part = { name: string; path: string; text: string; frontmatter?: string; offset?: number };
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

/** Each part's text as spec:index leaves it: its generated frontmatter, then its body. */
function paged(parts: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(parts).map(([name, text]) => {
    const p: Part = part(name, `${SPEC_DIR}/${name}`, text);
    return [name, partFrontmatter(p) + p.text];
  }));
}

describe('spec-files (B-179)', () => {
  it('the parts, joined in name order, are the spec', () => {
    const root = fixture({ '02-two.md': TWO, '00-front.md': FRONT, '01-one.md': ONE, 'README.txt': 'not a part' });
    const parts: Part[] = specParts(root);
    expect(parts.map((p) => p.name)).toEqual(['00-front.md', '01-one.md', '02-two.md']);
    expect(joinParts(parts)).toBe(FRONT + ONE + TWO);
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
      `${SPEC_DIR}/01-one.md: a numbered part opens with its own number, \`## 1. \``,
      `${SPEC_DIR}/02-two.md: a part holds one \`## \` heading, not 2`,
    ]);
  });

  it('the numbered parts run in order under their own numbers; the appendices carry none', () => {
    const swapped: Part[] = specParts(fixture({ '00-front.md': FRONT, '01-two.md': TWO, '02-one.md': ONE }));
    expect(partProblems(swapped)).toEqual([
      `${SPEC_DIR}/01-two.md: a numbered part opens with its own number, \`## 1. \``,
      `${SPEC_DIR}/02-one.md: a numbered part opens with its own number, \`## 2. \``,
    ]);
    const gap: Part[] = specParts(fixture({ '00-front.md': FRONT, '02-two.md': TWO, '90-decisions.md': '## 3. Decisions\n' }));
    expect(partProblems(gap)).toEqual([
      `${SPEC_DIR}/02-two.md: the numbered parts run 01, 02, 03 … with none missing or repeated; this one should be 01-…`,
      `${SPEC_DIR}/90-decisions.md: a part named 90-… or later is an appendix, with no section number`,
    ]);
    const twice: Part[] = specParts(fixture({ '00-front.md': FRONT, '01-one.md': ONE, '01-uno.md': ONE, '00-again.md': FRONT }));
    expect(partProblems(twice)).toContain(`${SPEC_DIR}/01-uno.md: the numbered parts run 01, 02, 03 … with none missing or repeated; this one should be 02-…`);
    expect(partProblems(twice)).toContain(`${SPEC_DIR}/00-front.md: only the front is named 00-…`);
  });

  it('a part holds whole lines with \\n line ends, so the join never runs one part into the next', () => {
    const parts: Part[] = specParts(fixture({ '00-front.md': FRONT.trimEnd(), '01-one.md': ONE.replace(/\n/g, '\r\n') }));
    expect(joinParts(parts)).toContain('| § | Title |## 1. One');
    expect(partProblems(parts)).toEqual([
      `${SPEC_DIR}/00-front.md: a part ends with a newline`,
      `${SPEC_DIR}/01-one.md: a part has \\n line ends, no \\r`,
    ]);
  });

  it("check:spec's layout check: a stray file, a missing or stale index; a fresh one passes", () => {
    const root = fixture({ ...paged({ '00-front.md': FRONT, '01-one.md': ONE, '02-two.md': TWO }), '03-Three.md': '## 3. Three\n', 'notes.txt': '' });
    expect(layoutProblems(root)).toEqual([
      `${SPEC_DIR}/03-Three.md: not a part — a part is named NN-slug.md, and nothing else lives in ${SPEC_DIR}/ (B-179)`,
      `${SPEC_DIR}/notes.txt: not a part — a part is named NN-slug.md, and nothing else lives in ${SPEC_DIR}/ (B-179)`,
      `${SPEC_INDEX} is missing — \`npm run spec:index\` writes it from ${SPEC_DIR}/ (B-179)`,
    ]);
    const fresh = fixture(paged({ '00-front.md': FRONT, '01-one.md': ONE, '02-two.md': TWO }));
    writeFileSync(join(fresh, SPEC_INDEX), indexText(specParts(fresh)));
    expect(layoutProblems(fresh)).toEqual([]);
    writeFileSync(join(fresh, SPEC_DIR, '02-two.md'), paged({ '02-two.md': TWO + '| G-BTN-10 | another gate |\n' })['02-two.md']);
    expect(layoutProblems(fresh)).toEqual([`${SPEC_INDEX} is stale — \`npm run spec:index\` writes it from ${SPEC_DIR}/ (B-179)`]);
  });

  it('the move proof holds when the joined parts are the old file byte for byte, and only then', () => {
    const parts: Part[] = specParts(fixture({ '00-front.md': FRONT, '01-one.md': ONE, '02-two.md': TWO }));
    const proof = moveProof(FRONT + ONE + TWO, parts);
    expect(proof.ok).toBe(true);
    expect(proof.after).toBe(proof.before);
    expect(proof.parts).toBe(3);
    expect(moveProof(FRONT + ONE + TWO.replace('steps', 'step'), parts).ok).toBe(false);
    expect(moveProof(`${FRONT}${ONE}${TWO}\n`, parts).ok).toBe(false);
  });

  it('the index lists each file, its subsections and their rules, and every rule, scenario and gate id', () => {
    const text: string = indexText(specParts(fixture({ '00-front.md': FRONT, '01-one.md': ONE, '02-two.md': TWO })));
    expect(text).toContain('| [`01-one.md`](BATON_SPEC/01-one.md) | **1. One** | — |');
    expect(text).toContain('| | 1.1 Sub | R-BTN-1, R-BTN-2, R-BTN-3 |');
    expect(text).toContain('| R-BTN-2 | two at once | [`01-one.md`](BATON_SPEC/01-one.md) |');
    expect(text).toContain('| S-BTN-7 | a scenario | [`02-two.md`](BATON_SPEC/02-two.md) |');
    expect(text).toContain('| G-BTN-9 | [`02-two.md`](BATON_SPEC/02-two.md) |');
    expect(text).not.toContain('a gate');
  });

  it('this repository: the directory holds only well-formed parts and the committed index is the generated one', () => {
    expect(layoutProblems(ROOT)).toEqual([]);
    expect(readFileSync(join(ROOT, SPEC_INDEX), 'utf8')).toBe(indexText(specParts(ROOT)));
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

  it('spec:impact on the directory finds the units that cite an id, each at its file and line', () => {
    const root = fixture({ '00-front.md': FRONT, '01-one.md': ONE, '02-two.md': TWO + '- **R-BTN-4 (cites).** See R-BTN-1.\n' });
    const dir = readSpecAt(root, 'spec/BATON_SPEC');
    const files: [string, string][] = [['tickets/B-1.mdx', 'builds R-BTN-1'], ['tickets/B-2.mdx', 'nothing']];
    const a = impact(dir.text, ['R-BTN-1'], [], files);
    expect(a.changed.map((u: { line: number }) => dir.where(u.line))).toEqual([`${SPEC_DIR}/01-one.md:5`]);
    expect(a.spec.map((u: { line: number }) => dir.where(u.line))).toEqual([`${SPEC_DIR}/02-two.md:5`]);
    expect(a.files.map((f: { path: string }) => f.path)).toEqual(['tickets/B-1.mdx']);
  });

  it('the front holds no numbered section, and each appendix keeps its own prefix and heading', () => {
    const front: Part[] = specParts(fixture({ '00-front.md': `${FRONT}\n## 3. Three\n`, '01-one.md': ONE }));
    expect(partProblems(front)).toEqual([`${SPEC_DIR}/00-front.md: the front holds no numbered section; each is its own part`]);
    const swapped: Part[] = specParts(fixture({ '00-front.md': FRONT, '01-one.md': ONE, '90-decisions.md': '## Decisions\n', '91-load.md': '## Load-bearing assumptions\n', '93-more.md': '## More\n' }));
    expect(partProblems(swapped)).toEqual([
      `${SPEC_DIR}/90-decisions.md: appendix 90 opens with \`## Load-bearing assumptions\``,
      `${SPEC_DIR}/91-load.md: appendix 91 opens with \`## Decisions\``,
      `${SPEC_DIR}/93-more.md: no appendix is numbered 93; they are 90 Load-bearing assumptions, 91 Decisions, 92 Open questions`,
    ]);
  });
  it('B-180: a part is a page — its frontmatter is stripped from the text every reader takes, and lines stay the file\'s', () => {
    const files = paged({ '00-front.md': `---\ntitle: "Old"\nstatus: proposal\n---\n${FRONT}`, '01-one.md': `${ONE.split('\n\n')[0]}\n\nOne fact. Then another.\n\n${ONE.split('\n\n').slice(1).join('\n\n')}` });
    expect(files['00-front.md']).toBe(`---\ntitle: "Spec"\ndescription: "BATON_SPEC's front: its title, status, companions and contents."\nstatus: proposal\n---\n${FRONT}`);
    expect(files['01-one.md'].startsWith('---\ntitle: "1. One"\ndescription: "One fact."\n---\n## 1. One *(proposal)*\n')).toBe(true);
    const root = fixture(files);
    const parts: Part[] = specParts(root);
    expect(joinParts(parts)).toBe(FRONT + files['01-one.md'].split('---\n')[2]);
    expect(parts.map((p) => p.offset)).toEqual([5, 4]);
    expect(locate(parts, 1)).toBe(`${SPEC_DIR}/00-front.md:6`);
    expect(locate(parts, FRONT.split('\n').length)).toBe(`${SPEC_DIR}/01-one.md:5`);
    expect(readSpecAt(root, SPEC_DIR).text).toBe(joinParts(parts));
    expect(partProblems(parts)).toEqual([]);
  });

  it('B-180: a part with no frontmatter, or one spec:index would not write, is reported', () => {
    const root = fixture({ ...paged({ '00-front.md': FRONT }), '01-one.md': ONE, '02-two.md': `---\ntitle: "2. Deux"\ndescription: "x"\n---\n${TWO}` });
    writeFileSync(join(root, SPEC_INDEX), indexText(specParts(root)));
    expect(layoutProblems(root)).toEqual([
      `${SPEC_DIR}/01-one.md: its frontmatter is missing — \`npm run spec:index\` writes its title and description (B-180)`,
      `${SPEC_DIR}/02-two.md: its frontmatter is stale — \`npm run spec:index\` writes its title and description (B-180)`,
    ]);
  });

  it("B-180: the move proof compares bodies, each side's frontmatter stripped", () => {
    const parts: Part[] = specParts(fixture(paged({ '00-front.md': `---\ntitle: "T"\n---\n${FRONT}`, '01-one.md': ONE, '02-two.md': TWO })));
    expect(moveProof(`---\ntitle: "T"\n---\n${FRONT}${ONE}${TWO}`, parts).ok).toBe(true);
    expect(moveProof(`${FRONT}${ONE}${TWO}`, parts).ok).toBe(true);
    expect(moveProof(`---\ntitle: "T"\n---\n${FRONT}${ONE}`, parts).ok).toBe(false);
  });
});
