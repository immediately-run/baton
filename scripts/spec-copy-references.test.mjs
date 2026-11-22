import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { sectionPairDifferences } from './check-spec.mjs';
import { readSpecCode } from './lib/spec-code.mjs';
import { referenceProblems } from './lib/wiki-references.mjs';
import { impact } from './spec-tools.mjs';

const root = resolve(import.meta.dirname, '..');

it('checks plain and linked section/rule pairs against their owning section', () => {
  const parent = { file: 'first' };
  const child = { file: 'first' };
  const sibling = { file: 'first' };
  const targets = new Map([['1', parent], ['1.1', child], ['1.2', sibling], ['R-BTN-1', child]]);
  const text = 'See §1 R-BTN-1, [§1.1](first) [R-BTN-1](first), §1.2 R-BTN-1 and §2 R-BTN-1.';
  expect([...sectionPairDifferences([['README.md', text]], targets)]).toEqual([
    'README.md §1.2 R-BTN-1', 'README.md §2 R-BTN-1',
  ]);
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
});
