import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { check, sectionPairDifferences } from './check-spec.mjs';
import { newExceptionProblems } from './lib/check-exceptions.mjs';
import { readSpecCode } from './lib/spec-code.mjs';
import { referenceProblems } from './lib/wiki-references.mjs';
import { impact } from './spec-tools.mjs';

const root = resolve(import.meta.dirname, '..');

it('checks plain and linked section/rule pairs against their owning section', () => {
  const parent = { file: 'first' };
  const child = { file: 'first' };
  const sibling = { file: 'first' };
  const rule = 'R-BTN-1';
  const targets = new Map([['1', parent], ['1.1', child], ['1.2', sibling], [rule, child]]);
  const valid = `See §1 ${rule}, [§1.1](first) ([${rule}](first)).`;
  expect([...sectionPairDifferences([['README.md', valid]], targets)]).toEqual([]);
  for (const pair of [`§1.2 ${rule}`, `§1.2 (${rule})`, `[§1.2](first) ([${rule}](first))`, `§1.2\n(${rule})`, `§1.2 (\n${rule})`]) {
    expect([...sectionPairDifferences([['README.md', pair]], targets)]).toEqual([`README.md §1.2 ${rule}`]);
  }
  expect([...sectionPairDifferences([['scripts/example.mjs', `// §1.2\n// (${rule})`]], targets)])
    .toEqual([`scripts/example.mjs §1.2 ${rule}`]);
});

it('checks repository paths and npm scripts without treating routes or snippets as paths', () => {
  const body = '`README.md` `../README.md` `node scripts/missing.mjs --check` `/v1/runner` `npm run check:api`\n\n```sh\nnpm run missing\n```';
  expect(referenceProblems(root, 'docs/example.md', body, { 'check:api': 'node example' })).toEqual([
    { line: 1, path: 'scripts/missing.mjs', message: 'repository path scripts/missing.mjs does not exist' },
    { line: 4, message: 'npm script missing does not exist' },
  ]);
});

it('finds explicit rule references in code and tests', () => {
  const hits = impact('', ['R-BTN-81'], [], readSpecCode(root)).files.map(({ path }) => path);
  expect(hits).toContain('src/core/history.ts');
  expect(hits).toContain('test/unit/history.test.ts');
  expect(hits).toContain('scripts/spec-copy-references.test.mjs');
  const tooling = impact('', ['R-BTN-129'], [], readSpecCode(root)).files.map(({ path }) => path);
  expect(tooling).toContain('scripts/check-actions.mjs');
});

it('reports a retired citation in tooling even with a matching new exception', () => {
  const id = ['R-BTN', '99999'].join('-');
  const code = [['scripts/new.mjs', `// ${id}`]];
  const history = `## Retired requirements\n| ${id} | obsolete |`;
  const key = `scripts/new.mjs ${id}`;
  expect(check('', code, new Set(), history)).toEqual([`retired rule citation: ${key}`]);
  expect(check('', code, new Set(), history, [], [], { [key]: null }))
    .toEqual([`retired rule citation: invalid ticket for exception ${key}`]);
  expect(newExceptionProblems('retired rule citation', { [key]: 'B-277' }, {}))
    .toEqual([`retired rule citation: new exception ${key}; the list may only shrink`]);
});

it('checks script names across inline markup and wraps, and path labels on external links', () => {
  const body = '[`src/missing.ts`](https://example.com) `LICENCE` [`README.md`](../README.md)\n\n'
    + '`npm run` `missing-one` and npm **run**\n`missing-two` and npm run `check:api`.';
  expect(referenceProblems(root, 'docs/example.md', body, { 'check:api': 'node example' })).toEqual([
    { line: 1, path: 'src/missing.ts', message: 'repository path src/missing.ts does not exist' },
    { line: 1, path: 'LICENCE', message: 'repository path LICENCE does not exist' },
    { line: 3, message: 'npm script missing-one does not exist' },
    { line: 3, message: 'npm script missing-two does not exist' },
  ]);
});
