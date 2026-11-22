// boundary-host.test.ts — R-BTN-55, G-BTN-56: a check, not a convention. Nothing under
// src/core/ names the Cloudflare platform — no `cloudflare:*` import, no Durable Object type,
// no `ctx` — so the same core runs on the local host; and the local host imports none of it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { scenarioSource, scannerSample } from '../lib/scenarioSource';

const ROOT = resolve(import.meta.dirname, '../..');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|mjs|js)$/.test(e.name) ? [join(dir, e.name)] : []));
}

/** `src` with comments removed, so prose about the platform does not count. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PLATFORM = [
  /['"]cloudflare:[a-z]+['"]/,
  /\bctx\b/,
  /\bDurableObject[A-Za-z]*\b/,
  /\bSqlStorage[A-Za-z]*\b/,
  /\bExportedHandler\b/,
  /\bwaitUntil\s*\(/,
  /from\s+['"]\.\.?\/(\.\.\/)*(cloudflare|local)\b/,
];

describe('the host boundary (R-BTN-55)', () => {
  it('src/core/ imports nothing from Cloudflare or either host, and reads no ctx', () => {
    const hits = files(join(ROOT, 'src/core')).flatMap((p) => {
      const text = code(p);
      return PLATFORM.filter((re) => re.test(text)).map((re) => `${relative(ROOT, p)}: ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it('src/local/ imports nothing from Cloudflare or src/cloudflare/', () => {
    const hits = files(join(ROOT, 'src/local')).filter((p) => /['"]cloudflare:|\/cloudflare\//.test(code(p))).map((p) => relative(ROOT, p));
    expect(hits).toEqual([]);
  });

  it('the scan sees a violation when there is one', () => {
    expect(PLATFORM.some((re) => re.test(code(join(ROOT, 'src/cloudflare/baton.ts'))))).toBe(true);
    for (const line of [`import { durableStore } from '../cloudflare/baton';`, `import { LocalHost } from '../local/host';`]) {
      expect([line, PLATFORM.some((re) => re.test(line))]).toEqual([line, true]);
    }
  });

  // §2b / R-BTN-74: the CLI's defaults are course code, exempt from the word scan (they may
  // name a `ctx` and read the forge), and core may not import them — Baton receives only results.
  it('src/defaults/ is exempt from the scan, and src/core/ imports none of it', () => {
    expect(files(join(ROOT, 'src/defaults')).length).toBeGreaterThan(0); // the exemption is real, not vacuous
    const imports = files(join(ROOT, 'src/core')).filter((p) => /from\s+['"]\.\.\/(\.\.\/)*defaults\b/.test(code(p))).map((p) => relative(ROOT, p));
    expect(imports).toEqual([]);
  });
});

describe('B-279: scenario fixture boundary', () => {
  it('does not add raw SQL writes or per-scenario Repo/Home fixtures', () => {
    const testRoot = join(ROOT, 'test');
    // Historical schema tests, storage probes and legacy bulk seeds. Delete counts as writes
    // move to named helpers; do not add files, tables, verbs or occurrences to this list.
    const allowed: Record<string, Record<string, number>> = JSON.parse(readFileSync(join(testRoot, 'fixtures/scenario-sql-allowlist.json'), 'utf8'));
    const violations: string[] = [];
    for (const dir of ['unit', 'integration']) for (const path of files(join(testRoot, dir))) {
      const file = relative(testRoot, path);
      const { writes, fixtures } = scenarioSource(file, readFileSync(path, 'utf8'));
      const remaining = { ...allowed[file] };
      for (const { key, line } of writes) {
        if ((remaining[key] ?? 0) <= 0) violations.push(`${file}:${line}: ${key} (use a named seeder)`);
        else remaining[key]--;
      }
      for (const line of fixtures) violations.push(`${file}:${line}: use GitRepo`);
      for (const [key, count] of Object.entries(remaining)) {
        if (count > 0) violations.push(`${file}: remove ${count} unused allowlist entries for ${key}`);
      }
      delete allowed[file];
    }
    for (const file of Object.keys(allowed)) violations.push(`${file}: remove unused allowlist entry`);
    expect(violations).toEqual([]);
  });

  it('recognizes multiline writes, CTE writes and fixture classes but not comments or regexes', () => {
    const { writes, fixtures } = scenarioSource('sample.ts', scannerSample);
    expect(writes.map(({ key }) => key)).toEqual(['insert' + ' into claims', 'update <expression>', 'delete' + ' from tickets']);
    expect(fixtures).toEqual([7]);
  });
});
