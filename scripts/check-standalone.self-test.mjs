import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkReferences, checkTrackedReferences } from './check-standalone.mjs';

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
    '[Guide](../docs/DEPLOY.md#deploy-and-verify)',
    '<!-- dependency-history: the old instructions used immediately-run/docs -->',
    'Use ../docs/nowhere instead.',
    '> ```md',
    '> <!-- dependency-history: Use immediately-run/docs -->',
    '> ```',
  ].join('\n')), [3, 5]);
});

test('rejects active references between notes and sibling links with fragments', () => {
  assert.deepEqual(checkReferences(root, 'README.md', [
    '<!-- dependency-history: once --> use immediately-run/docs <!-- never again -->',
    '[Old guide](../docs#setup)',
    '`../docs?raw=1`',
  ].join('\n')), [1, 2, 3]);
});

test('checks executable test code even in files with legacy fixture lines', () => {
  assert.deepEqual(checkReferences(root, 'test/helpers.ts', [
    "  repository: 'immediately-run/docs',",
    'readFileSync("content/roadmap/setup.mdx");',
    'readFileSync("immediately-run/docs/scripts/helper.mjs");',
  ].join('\n')), [2, 3]);
});

test('only Markdown links can use a document-relative path into docs', () => {
  const read = 'readFileSync("../docs/DEPLOY.md");';
  assert.deepEqual(checkReferences(root, 'scripts/consumer.mjs', read), [1]);
  assert.deepEqual(checkReferences(root, 'spec/guide.md', [
    '[`DEPLOY.md`](../docs/DEPLOY.md)',
    '`[Guide](../docs/DEPLOY.md)`',
    '```js',
    read,
    '// [Guide](../docs/DEPLOY.md)',
    '```',
  ].join('\n')), [2, 4, 5]);
});

test('only parsed destinations are exempt in MDX, not code, labels or titles', () => {
  assert.deepEqual(checkReferences(root, 'spec/guide.mdx', [
    '[Guide](../docs/DEPLOY.md#deploy-and-verify)',
    '',
    '`',
    '[Guide](../docs/DEPLOY.md)`',
    '',
    '> ```md',
    '> [Guide](../docs/DEPLOY.md)',
    '> ```',
    '',
    '[../docs/DEPLOY.md](../docs/DEPLOY.md)',
    '[Guide](../docs/DEPLOY.md "../docs/DEPLOY.md")',
  ].join('\n')), [4, 7, 10, 11]);
});

test('scans tracked package scripts, test code, skills and nested guides', (t) => {
  const checkout = mkdtempSync(join(tmpdir(), 'baton-standalone-'));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: checkout });
  git('init', '-q');
  const paths = {
    'package.json': '{"scripts":{"x":"node ../docs/path"}}',
    'test/unit/setup.test.ts': 'import "../../../docs/scripts/helper.mjs";',
    '.claude/skills/example/SKILL.md': 'Clone immediately-run/docs first.',
    'docs/nested/setup.md': 'Read `content/plans/setup.mdx`.',
  };
  for (const [file, text] of Object.entries(paths)) {
    mkdirSync(dirname(join(checkout, file)), { recursive: true });
    writeFileSync(join(checkout, file), text);
  }
  git('add', '--', ...Object.keys(paths));
  assert.deepEqual(checkTrackedReferences(checkout), Object.keys(paths).sort()
    .map((file) => `${file}:1: reference to the consumer repository`));
});
