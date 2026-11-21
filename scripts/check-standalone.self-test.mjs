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
  ].join('\n')), [3]);
});

test('rejects active references between notes and sibling links with fragments', () => {
  assert.deepEqual(checkReferences(root, 'README.md', [
    '<!-- dependency-history: once --> use immediately-run/docs <!-- never again -->',
    '[Old guide](../docs#setup)',
    '`../docs?raw=1`',
  ].join('\n')), [1, 2, 3]);
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
