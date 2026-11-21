import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkReferences } from './check-standalone.mjs';

const root = new URL('..', import.meta.url).pathname;

test('rejects consumer paths and reports their lines', () => {
  assert.deepEqual(checkReferences(root, 'README.md', [
    'Read the manual.',
    'Import from `../docs/scripts/lib/baton.mjs`.',
    'Clone immediately-run/docs first.',
    'Load content/plans/example.mdx.',
  ].join('\n')), [2, 3, 4]);
});

test('allows repository-local links and single-line history notes', () => {
  assert.deepEqual(checkReferences(root, 'spec/BATON_SPEC.md', [
    '[Guide](../docs/DEPLOY.md)',
    '<!-- dependency-history: the old instructions used immediately-run/docs -->',
    'Use ../docs/nowhere instead.',
  ].join('\n')), [3]);
});
