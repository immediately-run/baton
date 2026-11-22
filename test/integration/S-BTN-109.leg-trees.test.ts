// G-BTN-128: the script and its Node imports come from verified snapshots, not the checkout.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { builtinExecutor } from '../../src/runner/executor';
import { removeSealed } from '../../src/runner/leg-dependencies';
import { LegTrees } from '../../src/runner/leg-trees';
import { cleanNodeEnv, prepareExec, requireLegNode } from '../../src/runner/preparation';
import { readInputs } from '../../src/local/testCourse';

const wrapper = fileURLToPath(new URL('../../src/runner/legProcess.mjs', import.meta.url));
const signal = () => AbortSignal.timeout(10_000);
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await removeSealed(path); });

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'baton-leg-trees-test-'));
  dirs.push(home);
  const git = (...args: string[]) => execFileSync('git', ['-C', home, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'registered');
  git('config', 'user.name', 'Baton test');
  git('config', 'user.email', 'test@baton.invalid');
  git('remote', 'add', 'origin', home);
  const put = (path: string, text: string) => {
    const file = join(home, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const leg = (name: string, text: string) => put(`.baton/courses/sample/legs/${name}`, text);
  return { home, git, put, commit, leg };
}

function run(script: string, roots: string[], checkout: string) {
  const child = spawnSync(process.execPath, [wrapper, 'run', script], {
    cwd: checkout, input: `${JSON.stringify({ args: [{ checkout }], roots })}\n`, encoding: 'utf8', env: cleanNodeEnv(process.env),
  });
  return JSON.parse(child.stdout.trimEnd().split('\n').at(-1)!);
}

describe('S-BTN-109 leg trees', () => {
  it('runs all six extensions with Node from a sealed sparse commit', async () => {
    const f = fixture();
    for (const ext of ['mjs', 'js', 'cjs', 'mts', 'ts', 'cts']) {
      const body = `function run(ctx${ext.endsWith('ts') ? ': { checkout: string }' : ''}) { return ctx.checkout; }`;
      f.leg(`${ext}.${ext}`, ext.startsWith('c') ? `${body}\nmodule.exports = { run };` : `export ${body}`);
    }
    f.put('unrelated.txt', 'not in the leg tree');
    const sha = f.commit();
    const trees = new LegTrees(f.home, builtinExecutor(), wrapper);
    expect(await trees.onDefault('repo', sha, 'registered', signal())).toBe(true);
    const ready = await trees.prepare('repo', sha, 'sample', signal());
    try {
      expect(() => readFileSync(join(ready.tree, 'unrelated.txt'))).toThrow();
      for (const path of ready.scripts.values()) {
        expect(statSync(path).mode & 0o222).toBe(0);
        expect(run(path, ready.roots, f.home)).toEqual({ ok: true, result: f.home });
      }
    } finally { await ready.release(); }
  });

  it('rejects a commit on another branch, even though the object and checkout exist', async () => {
    const f = fixture();
    f.leg('start.mjs', 'export const run = () => 1');
    const registered = f.commit();
    f.git('switch', '-qc', 'other');
    f.leg('start.mjs', 'export const run = () => 2');
    const other = f.commit();
    const trees = new LegTrees(f.home, builtinExecutor(), wrapper);
    expect(await trees.onDefault('repo', other, 'registered', signal())).toBe(false);
    expect(await trees.onDefault('repo', registered, 'registered', signal())).toBe(true);
    expect(f.git('rev-parse', 'refs/baton/repo/default')).toBe(registered);
  });

  it('refuses an import of a checkout file and an ambiguous leg name', async () => {
    const f = fixture();
    f.put('outside.mjs', 'export const value = 1');
    f.leg('start.mjs', `export async function run(ctx) { return (await import(ctx.checkout + '/outside.mjs')).value; }`);
    const trees = new LegTrees(f.home, builtinExecutor(), wrapper);
    const ready = await trees.prepare('repo', f.commit(), 'sample', signal());
    try { expect(run(ready.scripts.get('start')!, ready.roots, f.home).error).toMatch(/outside the verified leg tree/); }
    finally { await ready.release(); }
    f.leg('start.ts', 'export const run = () => 2');
    await expect(trees.prepare('repo', f.commit(), 'sample', signal())).rejects.toThrow(/two scripts/);
  });

  it('rebuilds a dirty tree rather than running the changed bytes', async () => {
    const f = fixture();
    f.leg('start.mjs', 'export const run = () => 1');
    const sha = f.commit();
    const trees = new LegTrees(f.home, builtinExecutor(), wrapper);
    const first = await trees.prepare('repo', sha, 'sample', signal());
    await first.release();
    const file = first.scripts.get('start')!;
    chmodSync(file, 0o644);
    writeFileSync(file, 'export const run = () => 2');
    const second = await trees.prepare('repo', sha, 'sample', signal());
    try { expect(run(second.scripts.get('start')!, second.roots, f.home)).toEqual({ ok: true, result: 1 }); }
    finally { await second.release(); }
  });

  it('refuses a foreign lockfile and Node 22.17', async () => {
    const f = fixture();
    f.put('.baton/yarn.lock', '');
    const trees = new LegTrees(f.home, builtinExecutor(), wrapper);
    await expect(trees.prepare('repo', f.commit(), 'sample', signal())).rejects.toThrow(/unsupported yarn.lock/);
    expect(() => requireLegNode('22.17.9')).toThrow(/22.17.9/);
    expect(() => requireLegNode('22.18.0')).not.toThrow();
  });

  it('loads a locked .baton dependency from a TypeScript leg, reuses its digest, and repairs tampering', async () => {
    const f = fixture();
    const pkg = { name: 'fixture-value', version: '1.0.0', main: 'index.cjs' };
    const source = mkdtempSync(join(tmpdir(), 'baton-test-package-'));
    dirs.push(source);
    mkdirSync(join(source, 'package'));
    writeFileSync(join(source, 'package', 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(source, 'package', 'index.cjs'), 'module.exports = 42;');
    const tar = execFileSync('tar', ['-C', source, '-czf', '-', 'package']);
    const server = createServer((_req, response) => response.end(tar));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const port = (server.address() as { port: number }).port;
      const dependencies = { [pkg.name]: pkg.version };
      f.put('.baton/package.json', JSON.stringify({ dependencies }));
      f.put('.baton/package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
        '': { dependencies },
        'node_modules/fixture-value': { version: pkg.version, resolved: `http://127.0.0.1:${port}/fixture.tgz`, integrity: `sha512-${createHash('sha512').update(tar).digest('base64')}` },
      } }));
      f.put('.baton/courses/sample/course.json', JSON.stringify({ start: 'filed', start_leg: 'start', stations: { filed: {}, done: { end: true } }, legs: { start: { from: ['filed'], to: ['done'], requires: { capabilities: ['runner:leg-trees'] } } } }));
      f.leg('start.ts', 'import value from "fixture-value"; export const run = (): number => value; export function close() {} export function handoff() {}');
      const sha = f.commit();
      const executor = builtinExecutor();
      let installs = 0;
      const trees = new LegTrees(f.home, { ...executor, exec(h, argv, opts) {
        if (argv[0] === 'npm' && argv[1] === 'ci') installs++;
        return executor.exec(h, argv, opts);
      } }, wrapper);
      let cache: string;
      for (let i = 0; i < 3; i++) {
        const ready = await trees.prepare('repo', sha, 'sample', signal());
        try {
          expect(run(ready.scripts.get('start')!, ready.roots, f.home)).toEqual({ ok: true, result: 42 });
          expect(installs).toBe(i === 2 ? 2 : 1);
          cache = join(ready.roots[1], 'fixture-value', 'index.cjs');
        } finally { await ready.release(); }
        if (i === 1) { chmodSync(cache!, 0o644); writeFileSync(cache!, 'module.exports = 0;'); }
      }
      expect((await readInputs(f.home, 'sample')).legScripts?.[0]).toMatchObject({ name: 'start', exports: ['run', 'handoff', 'close'] });
    } finally {
      server.close();
      await once(server, 'close');
    }
  }, 20_000);

  it('stops a preparation process group on loss or owner Cancel', async () => {
    const f = fixture();
    for (const reason of ['lease-lost', 'released:owner-cancel']) {
      const owner = new AbortController();
      const handler = `for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {}); require('node:fs').writeFileSync('ready',''); setInterval(() => {},1000);`;
      const executor = builtinExecutor({ term: 10, kill: 30 });
      const result = prepareExec(executor, wrapper, { argv: ['node', '-e', handler], cwd: f.home, signal: owner.signal });
      const check = expect(result).rejects.toBe(reason);
      const timer = setTimeout(() => owner.abort(reason), 150);
      try { await check; } finally { clearTimeout(timer); }
    }
  });
});
