// runner-bundle.test.ts — S-BTN-41's runner as it ships (BATON_SPEC §6.13 R-BTN-72): run from
// a bundle, not from source. The runner spawns each leg through legProcess.mjs by a path beside
// its own module (src/runner/runner.ts LEG_PROCESS), which esbuild does not follow — so each
// bundle must carry the file, or every leg crashes with no outcome. Both bundles: a checkout's
// `.local/` runner bundle (scripts/baton-run.mjs) and the published `dist/baton.mjs`
// (scripts/build-cli.mjs). Node only: it bundles and spawns.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { call as hostCall } from '#host';
import { course, cutover, placed, rows, syncCall, ticket, TOKENS } from '../helpers';
import chore from '../fixtures/courses/chore/course.json';
import { cleanNodeEnv } from '../../src/runner/preparation';
import { removeSealed } from '../../src/runner/leg-dependencies';
import { bundleDigest } from '../../src/runner/executor';
import { checkCliDispatch } from '../../scripts/check-cli-dispatch.mjs';
import { CLI_ENTRIES } from '../../scripts/cli-entries.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

/** Run one trivial leg through the leg process `bundle` names, as the runner does. */
function runLegVia(wrapper: string): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'baton-bundle-leg-'));
  try {
    const script = join(dir, 'leg.mjs');
    writeFileSync(script, 'export async function run(ctx) { return { echoed: ctx.leg }; }\n');
    // R-BTN-133 (B-184): `node legProcess.mjs <call> <script>`, the arguments on stdin's first
    // line, the outcome on stdout's last.
    const child = spawnSync(process.execPath, [wrapper, 'run', script], { input: `${JSON.stringify([{ leg: 'implement' }])}\n`, encoding: 'utf8' });
    expect(child.stderr).toBe('');
    return JSON.parse(child.stdout.trim().split('\n').at(-1)!);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('S-BTN-41 the runner from its bundle (R-BTN-72)', () => {
  it('runs the checkout CLI without loading native TypeScript', () => {
    const home = mkdtempSync(join(tmpdir(), 'baton-checkout-cli-'));
    try {
      const result = spawnSync(process.execPath, ['--no-experimental-strip-types', 'cli/baton.mjs', 'home', 'list'], {
        cwd: ROOT, env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8',
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('no homes configured');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects a command missing from the export table before building the package', () => {
    const cli = readFileSync(join(ROOT, 'cli/baton.mjs'), 'utf8');
    const entries = { ...CLI_ENTRIES, 'baton-run.mjs': CLI_ENTRIES['baton-run.mjs'].map(({ entry, exports }) => ({
      entry, exports: exports.filter((name) => name !== 'queueCommand'),
    })) };
    expect(() => checkCliDispatch(cli, entries)).toThrow(/baton-run\.mjs.*queueCommand/);
  });

  it("a checkout's .local bundle runs a leg", () => {
    // Importing it bundles, as `baton run` from a checkout does.
    const entry = JSON.stringify(join(ROOT, 'scripts', 'baton-run.mjs'));
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', `console.log(typeof (await import(${entry})).default.runMain);`], { cwd: ROOT, encoding: 'utf8' }).trim()).toBe('function');
    expect(runLegVia(join(ROOT, '.local', 'legProcess.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });

  it('the published dist bundle runs a leg', () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-cli.mjs')], { cwd: ROOT });
    expect(readFileSync(join(ROOT, 'dist', 'baton.mjs'), 'utf8')).toMatch(/new URL\("\.\/legProcess\.mjs", import\.meta\.url\)/);
    expect(runLegVia(join(ROOT, 'dist', 'legProcess.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });

  it('S-BTN-109: runner start runs locked TypeScript from checkout and dist and fences preparation', async () => {
    // Build once before the HTTP fixture starts; both clients then talk to the actual local core.
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-cli.mjs')], { cwd: ROOT, timeout: 30_000 });
    const tmp = mkdtempSync(join(tmpdir(), 'baton-109-cli-'));
    let stop: (() => void) | undefined;
    let relayError: unknown;
    let tar: Buffer;
    const server = createServer(async (req, res) => {
      try {
        if (req.url === '/package.tgz') { res.end(tar); return; }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
        const reply = await hostCall(new Request(`https://baton.test${req.url}`, {
          method: req.method, headers, ...(req.method !== 'GET' ? { body: Buffer.concat(chunks) } : {}),
        }));
        reply.headers.forEach((value, key) => res.setHeader(key, value));
        res.writeHead(reply.status);
        res.end(Buffer.from(await reply.arrayBuffer()));
        if (reply.ok && req.url?.endsWith('/end')) stop?.();
      } catch (e) {
        relayError = e;
        res.writeHead(500).end();
        stop?.();
      }
    });
    try {
      const put = (path: string, text: string) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      };
      put(join(tmp, 'package/package.json'), JSON.stringify({ name: 'fixture-value', version: '1.0.0', main: 'index.cjs' }));
      put(join(tmp, 'package/index.cjs'), 'module.exports = 42;');
      tar = execFileSync('tar', ['-C', tmp, '-czf', '-', 'package']);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      await cutover();
      const graph = structuredClone(chore);
      Object.assign(graph.legs.do, { requires: { capabilities: ['runner:leg-trees'] } });
      let parent: string | null = null;
      for (const [i, cli] of ['cli/baton.mjs', 'dist/baton.mjs', 'dist/baton.mjs', 'dist/baton.mjs', 'dist/baton.mjs', 'dist/baton.mjs'].entries()) {
        const failSecondPreparation = i === 2;
        const failClone = i === 3;
        const failCourseRead = i === 4;
        const offBranch = i === 5;
        // Keep the board ancestry linear but use fresh checkout and cache directories per CLI.
        const home = join(tmp, `home-${i}`);
        const git = (...args: string[]) => execFileSync('git', ['-C', home, ...args], { encoding: 'utf8' }).trim();
        mkdirSync(home);
        if (i === 0) git('init', '-q', '-b', 'main');
        else git('clone', '-q', join(tmp, 'home-0'), '.');
        if (i === 0) git('remote', 'add', 'origin', home);
        else git('remote', 'set-url', 'origin', home);
        const dependencies = { 'fixture-value': '1.0.0' };
        const write = (name: string, value: unknown) => put(join(home, name), JSON.stringify(value));
        write('.baton/baton.json', { courses: [{ id: 'chore', version: 3 }], agent_command: 'unused-fixture-agent' });
        const courseGraph = offBranch ? { ...graph, legs: { ...graph.legs, do: { ...graph.legs.do, requires: {} } } } : graph;
        write('.baton/courses/chore/course.json', courseGraph);
        write('.baton/package.json', { dependencies });
        write('.baton/package-lock.json', { lockfileVersion: 3, packages: {
          '': { dependencies }, 'node_modules/fixture-value': { version: '1.0.0', resolved: `${url}/package.tgz`, integrity: `sha512-${createHash('sha512').update(tar).digest('base64')}` },
        } });
        put(join(home, '.baton/courses/chore/legs/do.ts'), `import value from 'fixture-value';
import { writeFileSync } from 'node:fs';
export function run(ctx: { checkout: string }) {
  writeFileSync(ctx.checkout + '/result.json', JSON.stringify({ value, file: import.meta.filename, cwd: process.cwd(), mode: ${i} }));
  return ${failSecondPreparation ? "{ reached: 'done-once', next: 'verify' }" : "{ suspend: true, reached: 'done-once' }"};
}
export const close = () => 'https://example.test/close';
`);
        git('add', '.baton');
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--no-gpg-sign', '-qm', 'course');
        const sha = git('rev-parse', 'HEAD');
        if (offBranch) git('update-ref', 'refs/heads/main', `${sha}^`);
        const id = `C-${i + 1}`;
        const board = await syncCall('/v1/sync/board', {
          registry: [course(3, 3, { id: 'chore', skill: 'run-chore', course: courseGraph })], sha, parent_sha: parent, closed: [],
          tickets: [ticket(id, { course_id: 'chore', path: `tickets/${id}.mdx` })], stations: { [id]: placed('open', [], [['do', 'ready']]) },
        });
        expect(board.status, await board.text()).toBe(200);
        parent = sha;
        const env = { ...cleanNodeEnv(process.env), HOME: tmp, BATON_TOKEN: TOKENS['vm-a'], BATON_KEY: '', BATON_KEY_FILE: '', BATON_PARENT: '' };
        if (failSecondPreparation) {
          const npm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
          const bin = join(tmp, 'bin');
          const shim = join(bin, 'npm');
          mkdirSync(bin);
          writeFileSync(shim, `#!/bin/sh\nif [ "$1" = --version ] && [ -f "$BATON_TEST_PREPARED" ]; then exec sleep 60; fi\nexec "$BATON_TEST_NPM" "$@"\n`, { mode: 0o755 });
          Object.assign(env, { PATH: `${bin}:${process.env.PATH}`, BATON_TEST_NPM: npm, BATON_TEST_PREPARED: join(home, 'result.json') });
        }
        if (failClone || failCourseRead) {
          const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
          const bin = join(tmp, `git-shim-${i}`);
          mkdirSync(bin);
          // Only stall the claim-owned Git call, not the startup eligibility probe.
          const match = failClone ? "*' clone '*" : "' -c '*' show '*':.baton/courses/chore/course.json '*";
          writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase " $* " in ${match}) : > "$BATON_TEST_GIT_STARTED"; exec sleep 60;; esac\nexec "$BATON_TEST_GIT" "$@"\n`, { mode: 0o755 });
          Object.assign(env, { PATH: `${bin}:${process.env.PATH}`, BATON_TEST_GIT: git, BATON_TEST_GIT_STARTED: join(home, 'git.started') });
        }
        const pinned: string[] = [];
        if (offBranch) {
          const dir = join(tmp, 'pinned');
          put(join(dir, 'executor.mjs'), `export function createExecutor() {
  const unexpected = () => { throw new Error('off-branch claim reached executor'); };
  return { api: 1, provides: [], start: unexpected, exec: unexpected, stop: unexpected, end: unexpected };
}`);
          pinned.push('--executor', `pinned:${dir}@sha256:${bundleDigest(dir)}`);
        }
        const child = spawn(process.execPath, [join(ROOT, cli), 'runner', 'start', '--home', home, '--url', url,
          '--session', `leg-tree-cli-${i}`, '--hostname', 'vm-a', '--prepare-timeout', '5s', '--beat-every', '100',
          ...(failClone ? ['--concurrency', '2'] : []), ...pinned], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        child.stdout.on('data', (bytes) => { log += bytes; });
        child.stderr.on('data', (bytes) => { log += bytes; });
        stop = () => { child.kill('SIGTERM'); stop = undefined; };
        const interrupt = setTimeout(() => child.kill('SIGINT'), 10_000);
        const kill = setTimeout(() => child.kill('SIGKILL'), 25_000);
        try {
          const [code] = await once(child, 'close');
          expect(relayError).toBeUndefined();
          expect(code, log).toBe(0);
          expect(await rows('SELECT station, end_reason FROM claims WHERE ticket_id = ?', `docs:${id}`), log).toEqual([{
            station: failClone || offBranch || failCourseRead ? 'open' : 'done-once',
            end_reason: offBranch ? 'released:off-branch' : failSecondPreparation || failClone || failCourseRead ? 'released:cannot-finish:transient' : 'suspended:done-once',
          }]);
          if (failClone || offBranch || failCourseRead) {
            if (!offBranch) expect(readFileSync(join(home, 'git.started'), 'utf8')).toBe('');
            expect(() => readFileSync(join(home, 'result.json'))).toThrow(/ENOENT/);
            continue;
          }
          const result = JSON.parse(readFileSync(join(home, 'result.json'), 'utf8'));
          expect(result).toMatchObject({ value: 42, cwd: home, mode: i });
          expect(result.file).toContain('/baton/trees/docs/');
          expect(statSync(result.file).mode & 0o222).toBe(0);
        } finally { clearTimeout(interrupt); clearTimeout(kill); stop = undefined; }
      }
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await removeSealed(tmp);
    }
  }, 90_000);
});
