// B-278: this source gate runs in npm test's Node project. The host adapters and historical
// migrations are included, rather than giving whole files an exemption for intentional SQL.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { dialectUses, excess, inventory, sourceUses } from './lib/sql-dialect.mjs';

const root = resolve(import.meta.dirname, '..');
const path = 'scripts/sql-dialect-allowlist.json';

function baseAllowlist(cwd, env, file = path) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
  const hasCommit = (ref) => {
    try { git('rev-parse', '--verify', `${ref}^{commit}`); return true; } catch { return false; }
  };
  let base = 'origin/main';
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'pull_request') {
    // Checkout is shallow in PR CI. Fetch the event's exact base, not the moving main tip.
    base = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.base?.sha;
    if (!/^[0-9a-f]{40}$/.test(base ?? '')) throw new Error('Missing pull request base SHA');
    if (!hasCommit(base)) git('fetch', '--no-tags', '--depth=1', 'origin', base);
  } else if (!hasCommit(base)) return undefined;

  // Only a successful tree lookup proving the file is absent permits its first introduction.
  if (!git('ls-tree', base, '--', file)) return undefined;
  return JSON.parse(git('show', `${base}:${file}`));
}

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

it('checks quoted function and dialect names and parenthesized parameters in syntax positions', () => {
  expect(dialectUses(`SELECT "changes"(), [last_insert_rowid](), \`max\`(a, b),
    a IS ((?)), b COLLATE 'NOCASE'; PRAGMA 'foreign_keys'`).uses).toEqual([
    'changes()', 'last_insert_rowid()', 'scalar MAX', 'IS ?', 'COLLATE NOCASE', 'PRAGMA',
  ]);
  expect(dialectUses(`SELECT 'changes', 'max', 'PRAGMA' AS name, 'COLLATE', 'NOCASE', 'IS (?)', "max"(a)`).uses).toEqual([]);
});

it('finds debt in SQL constants, concatenated strings and template branches, not TS comments', () => {
  expect(sourceUses('src/core/example.ts', [
    '// "PRAGMA foreign_keys"',
    'const from = "SELECT changes" + "()";',
    'const q = `DELETE FROM ${from} ${old ? "WHERE rowid = ?" : ""}`;',
  ].join('\n')).map(({ key, line }) => [key.split(' | ')[1], line])).toEqual([['changes()', 2], ['rowid', 3]]);
});

it('detects constructs split across static template fragments and conditional branches', () => {
  const uses = sourceUses('src/core/example.ts', [
    'const q = `INSERT ${ignore ? "OR IGNORE" : ""} INTO t VALUES (1)`;',
    'const p = `SELECT ${old ? "chan" : "sum"}${old ? "ges" : ""}()`;',
    'const safe = `SELECT \'${debug ? "changes()" : "rowid"}\'`;',
  ].join('\n'));
  expect(uses.map(({ key, line }) => [key.split(' | ')[1], line])).toEqual([['INSERT OR', 1], ['changes()', 2]]);
});

it('does not transfer an allowance to another file or statement, or allow more copies', () => {
  const [a] = sourceUses('src/a.ts', 'const q = "SELECT rowid FROM a"');
  const [b] = sourceUses('src/b.ts', 'const q = "SELECT rowid FROM a"');
  const [c] = sourceUses('src/a.ts', 'const q = "SELECT rowid FROM b"');
  const allowed = { [a.key]: 1 };
  expect(excess({ [a.key]: 2, [b.key]: 1, [c.key]: 1 }, allowed)).toHaveLength(3);
  expect(excess({}, allowed)).toEqual([]);
});

it('caps SQL debt at the checked-in allowlist and requires unused entries to be removed', { timeout: 65_000 }, () => {
  const allowed = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const { counts, locations } = inventory(root);
  expect(excess(counts, allowed).map((key) => `${locations[key].join(', ')}: ${key}`), 'new SQLite-only SQL').toEqual([]);
  expect(excess(allowed, counts), 'remove or lower unused allowances').toEqual([]);

  const baseline = baseAllowlist(root, process.env);
  if (baseline !== undefined) expect(excess(allowed, baseline), 'the allowlist may only shrink').toEqual([]);
});

it('requires the exact PR base even in a depth-one checkout', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'sql-dialect-base-'));
  const remote = resolve(dir, 'remote');
  const clone = resolve(dir, 'clone');
  const event = resolve(dir, 'event.json');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const commit = (message) => git(remote, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--no-gpg-sign', '-qam', message, '--allow-empty');
  const baseline = (sha) => {
    writeFileSync(event, JSON.stringify({ pull_request: { base: { sha } } }));
    return baseAllowlist(clone, { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event }, 'allow.json');
  };
  try {
    git(dir, 'init', '-qb', 'main', remote);
    commit('before allowlist');
    const before = git(remote, 'rev-parse', 'HEAD');
    writeFileSync(resolve(remote, 'allow.json'), '{"old":1}');
    git(remote, 'add', 'allow.json');
    commit('base allowlist');
    const base = git(remote, 'rev-parse', 'HEAD');
    writeFileSync(resolve(remote, 'allow.json'), '{"old":1,"new":1}');
    commit('new debt');
    git(dir, 'clone', '-q', '--depth=1', `file://${remote}`, clone);
    expect(() => git(clone, 'cat-file', '-e', base)).toThrow();
    expect(excess({ old: 1, new: 1 }, baseline(base))).toEqual(['new']);
    expect(baseline(before)).toBeUndefined();
    expect(() => baseline('f'.repeat(40))).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
