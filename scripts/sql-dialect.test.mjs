// B-278: this source gate runs in npm test's Node project. The host adapters and historical
// migrations are included, rather than giving whole files an exemption for intentional SQL.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { dialectUses, excess, inventory, sourceUses } from './lib/sql-dialect.mjs';

const root = resolve(import.meta.dirname, '..');
const path = 'scripts/sql-dialect-allowlist.json';

it('detects the eight SQLite constructs, including nested scalar MAX and quoted rowid', () => {
  expect(dialectUses(`insert /* x */ or ignore into t select
    LAST_INSERT_ROWID(), changes (), t."rowid", MAX(f(a,b), (SELECT 1)), a IS /* x */ ?, b COLLATE NOCASE;
    PRAGMA foreign_keys = ON`).uses).toEqual([
    'INSERT OR', 'last_insert_rowid()', 'changes()', 'rowid', 'scalar MAX', 'IS ?', 'COLLATE NOCASE', 'PRAGMA',
  ]);
});

it('ignores comments, SQL string values, and aggregate MAX', () => {
  expect(dialectUses(`-- PRAGMA and rowid
    SELECT 'x''rowid', MAX(COALESCE(a, b)) FROM t WHERE a IS NULL /* INSERT OR */`).uses).toEqual([]);
});

it('finds debt in SQL constants, concatenated strings and template branches, not TS comments', () => {
  expect(sourceUses('src/core/example.ts', [
    '// "PRAGMA foreign_keys"',
    'const from = "SELECT changes" + "()";',
    'const q = `DELETE FROM ${from} ${old ? "WHERE rowid = ?" : ""}`;',
  ].join('\n')).map(({ key, line }) => [key.split(' | ')[1], line])).toEqual([['changes()', 2], ['rowid', 3]]);
});

it('does not transfer an allowance to another file or statement, or allow more copies', () => {
  const [a] = sourceUses('src/a.ts', 'const q = "SELECT rowid FROM a"');
  const [b] = sourceUses('src/b.ts', 'const q = "SELECT rowid FROM a"');
  const [c] = sourceUses('src/a.ts', 'const q = "SELECT rowid FROM b"');
  const allowed = { [a.key]: 1 };
  expect(excess({ [a.key]: 2, [b.key]: 1, [c.key]: 1 }, allowed)).toHaveLength(3);
  expect(excess({}, allowed)).toEqual([]);
});

it('caps SQL debt at the checked-in allowlist and requires unused entries to be removed', () => {
  const allowed = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const { counts, locations } = inventory(root);
  expect(excess(counts, allowed).map((key) => `${locations[key].join(', ')}: ${key}`), 'new SQLite-only SQL').toEqual([]);
  expect(excess(allowed, counts), 'remove or lower unused allowances').toEqual([]);

  // Full development checkouts can also check the list itself against main. The inventory
  // check above still runs in shallow CI and in exported source trees with no Git history.
  let baseline;
  try {
    baseline = execFileSync('git', ['show', `origin/main:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return; }
  expect(excess(allowed, JSON.parse(baseline)), 'the allowlist may only shrink').toEqual([]);
});
