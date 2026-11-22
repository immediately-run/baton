// runner-bundle.test.ts — S-BTN-41's runner as it ships (BATON_SPEC §6.13 R-BTN-72): run from
// a bundle, not from source. The runner spawns each leg through legProcess.mjs by a path beside
// its own module (src/runner/runner.ts LEG_PROCESS), which esbuild does not follow — so each
// bundle must carry the file, or every leg crashes with no outcome. Both bundles: a checkout's
// `.local/baton-run.mjs` (scripts/baton-run.mjs) and the published `dist/baton.mjs`
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

const ROOT = resolve(import.meta.dirname, '../..');

/** Run one trivial leg through the leg process `bundle` names, as the runner does. */
function runLegVia(bundle: string): unknown {
  const named = /new URL\("\.\/legProcess\.mjs", import\.meta\.url\)/.test(readFileSync(bundle, 'utf8'));
  expect(named, `${bundle} names ./legProcess.mjs beside itself`).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), 'baton-bundle-leg-'));
  try {
    const script = join(dir, 'leg.mjs');
    writeFileSync(script, 'export async function run(ctx) { return { echoed: ctx.leg }; }\n');
    // R-BTN-133 (B-184): `node legProcess.mjs <call> <script>`, the arguments on stdin's first
    // line, the outcome on stdout's last.
    const child = spawnSync(process.execPath, [join(dirname(bundle), 'legProcess.mjs'), 'run', script], { input: `${JSON.stringify([{ leg: 'implement' }])}\n`, encoding: 'utf8' });
    expect(child.stderr).toBe('');
    return JSON.parse(child.stdout.trim().split('\n').at(-1)!);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('S-BTN-41 the runner from its bundle (R-BTN-72)', () => {
  it("a checkout's .local bundle runs a leg", () => {
    // Importing it bundles, as `baton run` from a checkout does.
    execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(join(ROOT, 'scripts', 'baton-run.mjs'))})`], { cwd: ROOT });
    expect(runLegVia(join(ROOT, '.local', 'baton-run.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });

  it('the published dist bundle runs a leg', () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-cli.mjs')], { cwd: ROOT });
    expect(runLegVia(join(ROOT, 'dist', 'baton.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });

  it('S-BTN-109: runner start executes a locked TypeScript leg from checkout and dist', async () => {
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
      for (const [i, cli] of ['cli/baton.mjs', 'dist/baton.mjs'].entries()) {
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
        write('.baton/courses/chore/course.json', graph);
        write('.baton/package.json', { dependencies });
        write('.baton/package-lock.json', { lockfileVersion: 3, packages: {
          '': { dependencies }, 'node_modules/fixture-value': { version: '1.0.0', resolved: `${url}/package.tgz`, integrity: `sha512-${createHash('sha512').update(tar).digest('base64')}` },
        } });
        put(join(home, '.baton/courses/chore/legs/do.ts'), `import value from 'fixture-value';
import { writeFileSync } from 'node:fs';
export function run(ctx: { checkout: string }) {
  writeFileSync(ctx.checkout + '/result.json', JSON.stringify({ value, file: import.meta.filename, cwd: process.cwd(), mode: ${i} }));
  return { suspend: true, reached: 'done-once' };
}
export const close = () => 'https://example.test/close';
`);
        git('add', '.baton');
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--no-gpg-sign', '-qm', 'course');
        const sha = git('rev-parse', 'HEAD');
        const id = `C-${i + 1}`;
        const board = await syncCall('/v1/sync/board', {
          registry: [course(3, 3, { id: 'chore', skill: 'run-chore', course: graph })], sha, parent_sha: parent, closed: [],
          tickets: [ticket(id, { course_id: 'chore', path: `content/chore/${id}.mdx` })], stations: { [id]: placed('open', [], [['do', 'ready']]) },
        });
        expect(board.status, await board.text()).toBe(200);
        parent = sha;
        const env = { ...cleanNodeEnv(process.env), HOME: tmp, BATON_TOKEN: TOKENS['vm-a'], BATON_KEY: '', BATON_KEY_FILE: '', BATON_PARENT: '' };
        const child = spawn(process.execPath, [join(ROOT, cli), 'runner', 'start', '--home', home, '--url', url,
          '--session', `leg-tree-cli-${i}`, '--hostname', 'vm-a', '--prepare-timeout', '5s', '--beat-every', '100'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
          expect(await rows('SELECT end_reason FROM claims WHERE ticket_id = ?', `docs:${id}`), log).toEqual([{ end_reason: 'suspended:done-once' }]);
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
