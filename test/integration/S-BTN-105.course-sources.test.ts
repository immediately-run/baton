// S-BTN-105 / S-BTN-110 (B-139): sourced scripts and graph, home overrides, no home copies.
import { describe, it, expect, beforeEach, afterEach, inject, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { RECOMMENDED_CLIENT } from '../../src/core/http';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, showCourseMain, syncMain } from '../../src/defaults/cli';
import { dropCourse, loadCourse, sourceContext } from '../../src/runner/home';
import { BatonApi } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { advance, claimItem, confirmClaimForScenario, cutover, endClaim, ORIGIN, register, rows, setClock, syncToken, TOKENS } from '../helpers';

const headerPairs = (headers: Pick<Headers, 'forEach'>): [string, string][] => {
  const pairs: [string, string][] = [];
  headers.forEach((value, name) => pairs.push([name, value]));
  return pairs;
};

const T0 = Date.parse('2026-10-18T12:00:00Z');
const ROOT = resolve(import.meta.dirname, '../..');
const SHA = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const LEGACY = '17ae8cce1411b71c413a123e54e4030b967a6e13';
const hasLegacy = spawnSync('git', ['-C', ROOT, 'cat-file', '-e', `${LEGACY}^{commit}`]).status === 0;

let dir: string;
let minutes = 0;
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const commit = (): string => {
  git('add', '-A');
  git('commit', '--allow-empty', '-qm', 'step');
  return git('rev-parse', 'HEAD');
};
const settingsFile = () => join(dir, '.baton', 'baton.json');
const facts = join(tmpdir(), `baton-s105-facts-${process.pid}.json`);
/** One sync through the local host, with the recorded PR facts. */
const sync = async () => {
  setClock(T0 + (minutes += 11) * 60_000);
  const token = await syncToken();
  const args = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--facts', facts], {});
  await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: () => {} });
};

beforeEach(async () => {
  minutes = 0;
  await setClock(T0);
  dir = mkdtempSync(join(tmpdir(), 'baton-s105-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's105@test'], ['config', 'user.name', 's105']]) git(...a);
  expect(await initMain(['--override', 'review'], { root: dir, log: () => {} })).toBe(0);
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  writeFileSync(join(dir, 'tickets', 't1.md'), '---\nid: T-1\ntitle: Build it\n---\n');
  writeFileSync(facts, JSON.stringify([{ number: 7, head: 'claude/T-1-x', state: 'open', pushedAt: T0, pushes: [T0], checks: ['success'], reviews: [] }]));
  commit();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(facts, { force: true });
});

describe('S-BTN-105 a course from its source, one leg overridden', () => {
  it('posts the sourced course, runs the override at the snapshot, and the standard close moves the ticket', async () => {
    const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    expect(settings.courses[0].source).toMatch(new RegExp(`^github/[^/]+/[^/]+/${SHA}/standard-create-pr$`));
    await sync();
    const at = async () => (await rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'docs:T-1'))[0];
    expect(await at()).toMatchObject({ station: 'filed', next_leg: 'implement' });
    await cutover();
    const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-pr', version: 3 }] });
    const held = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:T-1' });
    expect(held.status).toBe(200);
    const claim = held.json.claim_id;
    expect((await advance('vm-a', runner.secret, claim, { leg: 'implement' })).status).toBe(200);
    expect((await advance('vm-a', runner.secret, claim, { leg: 'run-tests', reached: 'pr-open' })).status).toBe(200);
    // B-30: the implementer's key never chains into the review; its gate run suspends at
    // `pr-open`, finished, and another key takes the round.
    expect((await endClaim('vm-a', runner.secret, claim, { end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'review',
      finished_self_loop: true, ended_at_sha: 'a'.repeat(40) })).status).toBe(200);
    await sync();
    // What this scenario reads is the review's source; git's confirmation of the gate's end
    // (R-BTN-10) is S-BTN-63's, so it is taken as given here.
    await confirmClaimForScenario(claim, T0);
    expect(await at()).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    const reviewer = await register('vm-b', { courses: [{ repository: 'docs', course: 'create-pr', version: 3 }] });
    const round = await claimItem('vm-b', reviewer.secret, { ticket_id: 'docs:T-1' });
    expect(round.status).toBe(200);
    const reviewClaim = round.json.claim_id;
    expect((await advance('vm-b', reviewer.secret, reviewClaim, { leg: 'review' })).status).toBe(200);

    // The repository's review: its own check, then the course's run with an agent that asks for changes.
    const agent = join(dir, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\ncat "$BATON_INSTRUCTIONS" > instruction.log\necho changes\n');
    writeFileSync(join(dir, '.baton', 'courses', 'create-pr', 'legs', 'review.md'), 'Home review instructions\n');
    chmodSync(agent, 0o755);
    writeFileSync(settingsFile(), JSON.stringify({ ...settings, agent_command: agent }, null, 2));
    rmSync(join(dir, '.baton', 'courses', 'create-pr', 'legs', 'review.run.mjs'));
    writeFileSync(join(dir, '.baton', 'courses', 'create-pr', 'legs', 'review.run.js'), `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function run(ctx, standard) {
  writeFileSync(join(ctx.checkout, 'gate.log'), 'two blind reviewers, then the matcher');
  return standard(ctx);
}
`);
    const sha = commit();
    const loaded = await loadCourse(dir, sha, 'create-pr');
    // A fake gh records the comment the standard close posts.
    const bin = mkdtempSync(join(tmpdir(), 'baton-s105-gh-'));
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s' "$4" > "${join(bin, 'body')}"\necho https://github.com/o/r/pull/7#issuecomment-1\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const leg = await import(`${pathToFileURL(loaded.scripts.get('review')!).href}?t=${Date.now()}`);
      const ctx = { ticket: { id: 'docs:T-1', path: 'tickets/t1.md', home: 'docs' }, checkout: dir, snapshot: { sha }, sourced_course: loaded.sourced, leg: 'review', claim: { nonce: 'n1' } };
      const run = spawnSync(process.execPath, [join(ROOT, 'src/runner/legProcess.mjs'), 'run', loaded.scripts.get('review')!], {
        input: `${JSON.stringify([{ ...ctx, ...sourceContext(loaded) }])}\n`, encoding: 'utf8',
      });
      expect(run.status, run.stdout || run.stderr).toBe(0);
      const result = JSON.parse(run.stdout.trim().split('\n').at(-1)!).result;
      expect(result).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      expect(readFileSync(join(dir, 'instruction.log'), 'utf8')).toBe('Home review instructions\n');
      expect(readFileSync(join(dir, 'gate.log'), 'utf8')).toContain('two blind reviewers');
      expect(await leg.close(ctx, result)).toBe('https://github.com/o/r/pull/7#issuecomment-1');
      const body = readFileSync(join(bin, 'body'), 'utf8');
      expect(body.split('\n')[0]).toBe('<!-- baton:verdict changes -->');
      expect((await endClaim('vm-b', reviewer.secret, reviewClaim, { end_reason: 'done', reached: result.reached, next: result.next,
        ended_at_sha: 'https://github.com/o/r/pull/7#issuecomment-1' })).status).toBe(200);
    } finally {
      process.env.PATH = path;
      dropCourse(loaded.scratch);
      rmSync(bin, { recursive: true, force: true });
    }
    await sync();
    expect(await at()).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
  }, 120_000);

  it('S-BTN-110 refuses a committed copy and loads the source script instead of it', async () => {
    const copy = join(dir, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs');
    writeFileSync(copy, 'throw new Error("home copy must not run");\n');
    const sha = commit();
    await expect(sync()).rejects.toThrow('.baton/courses/create-pr/legs/implement.mjs: not an override');
    expect(await rows('SELECT ticket_id FROM ticket_stations')).toEqual([]);
    const course = await loadCourse(dir, sha, 'create-pr');
    try {
      expect(readFileSync(course.scripts.get('implement')!, 'utf8')).not.toContain('home copy must not run');
      expect((await import(pathToFileURL(course.scripts.get('implement')!).href)).run).toBeTypeOf('function');
    } finally {
      dropCourse(course.scratch);
    }
  });

  it.each([
    ['review.run.ts', 'not an override'],
    ['review.run.cjs', 'multiple run overrides for legs/review.run'],
  ])('S-BTN-110 refuses %s before posting the board', async (name, error) => {
    writeFileSync(join(dir, '.baton/courses/create-pr/legs', name), 'throw new Error("invalid override must not run");');
    commit();
    await expect(sync()).rejects.toThrow(error);
    expect(await rows('SELECT ticket_id FROM ticket_stations')).toEqual([]);
  });

  // Use the actual historical commit when present; CI's shallow checkout may not have it.
  it.skipIf(!hasLegacy)('S-BTN-110 adapts the verified legacy pin for an entry-only home', async () => {
    const upstream = join(dir, '.git', 'fixture-upstream');
    git('init', '--bare', '-q', '-b', 'main', upstream);
    execFileSync('git', ['-C', ROOT, 'push', '-q', upstream, `${LEGACY}:refs/heads/main`]);
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', `url.${upstream}.insteadOf`);
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'https://github.com/immediately-run/baton.git');
    try {
      rmSync(join(dir, '.baton/courses/create-pr'), { recursive: true });
      const agent = join(dir, 'legacy-agent.sh');
      // Stop before querying the forge, but only after capturing the actual agent input.
      writeFileSync(agent, '#!/bin/sh\ncat "$BATON_INSTRUCTIONS" > instruction.log\nexit 7\n', { mode: 0o755 });
      const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
      settings.courses[0].source = `github/immediately-run/baton/${LEGACY}/create-pr`;
      settings.agent_command = agent;
      writeFileSync(settingsFile(), JSON.stringify(settings));
      const graph = JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${LEGACY}:.baton/courses/create-pr/course.json`], { encoding: 'utf8' }));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { [graph.test_script]: 'true' } }));
      const sha = commit();
      const remote = join(dir, '.git', 'fixture-origin');
      git('init', '--bare', '-q', '-b', 'main', remote);
      git('remote', 'add', 'origin', remote);
      git('push', '-q', 'origin', 'HEAD:refs/heads/claude/T-1-x');
      await sync();
      const loaded = await loadCourse(dir, sha, 'create-pr');
      try {
        const run = (leg: string, at: string) => {
          const ctx = { ...sourceContext(loaded), leg, checkout: dir, snapshot: { sha: at }, claim: { station: 'pr-open' }, ticket: { id: 'docs:T-1', path: 'tickets/t1.md', home: 'docs' } };
          const result = spawnSync(process.execPath, [join(ROOT, 'src/runner/legProcess.mjs'), 'run', loaded.scripts.get(leg)!], {
            input: `${JSON.stringify([ctx])}\n`, encoding: 'utf8', timeout: 30_000,
          });
          expect(result.error, result.stderr).toBeUndefined();
          return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
        };
        expect(run('implement', sha)).toMatchObject({ ok: false, error: expect.stringContaining('exited with code 7') });
        expect(readFileSync(join(dir, 'instruction.log'))).toEqual(execFileSync('git', ['-C', ROOT, 'show', `${LEGACY}:.baton/courses/create-pr/legs/implement.md`]));
        expect(run('run-tests', sha)).toMatchObject({ ok: true, result: { tests: 'green', script: graph.test_script } });

        const legs = join(dir, '.baton/courses/create-pr/legs');
        mkdirSync(legs, { recursive: true });
        writeFileSync(join(legs, 'implement.md'), 'Snapshot instructions\n');
        writeFileSync(join(legs, 'implement.run.cjs'), 'exports.run = (ctx, standard) => standard(ctx).catch(e => ({ error: e.message, override: true }));');
        const overridden = commit();
        expect(run('implement', overridden)).toMatchObject({ ok: true, result: { error: expect.stringContaining('exited with code 7'), override: true } });
        expect(readFileSync(join(dir, 'instruction.log'), 'utf8')).toBe('Snapshot instructions\n');
      } finally {
        dropCourse(loaded.scratch);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it('S-BTN-110 scaffolds only explicitly requested files and prunes identical copies', async () => {
    const graphDir = join(dir, '.baton', 'courses', 'create-pr');
    expect(readdirSync(join(graphDir, 'legs'))).toEqual(['review.run.mjs']);
    rmSync(graphDir, { recursive: true });
    const settings = readFileSync(settingsFile(), 'utf8');
    await initMain(['--force', '--own'], { root: dir, log: () => {} });
    writeFileSync(settingsFile(), settings);
    const modified = join(graphDir, 'legs', 'review.md');
    writeFileSync(modified, 'Home review instructions\n');
    const log: string[] = [];
    await initMain(['--prune'], { root: dir, log: (line) => log.push(line) });
    expect(existsSync(join(graphDir, 'course.json'))).toBe(false);
    expect(readdirSync(join(graphDir, 'legs'))).toEqual(['review.md']);
    expect(log.join('\n')).toContain('review.md (differs from source');
    rmSync(graphDir, { recursive: true });
    await initMain([], { root: dir, log: () => {} });
    expect(existsSync(graphDir)).toBe(false);
    commit();
    await sync();
    const shown: string[] = [];
    expect(await showCourseMain(['create-pr', 'implement'], dir, (line) => shown.push(line))).toBe(0);
    expect(shown.join('\n')).toContain('--- legs/implement.md ---');
  });

  it.each(['local', 'cloudflare'])('S-BTN-110 runs an entry-only standard claim on %s', async (host) => {
    const remote = join(dir, '.git', 'fixture-origin');
    const agent = join(dir, 'decision-agent.sh');
    writeFileSync(agent, '#!/bin/sh\ncat "$BATON_INSTRUCTIONS" > instruction.log\n', { mode: 0o755 });
    await initMain(['--course', 'decision', '--agent-command', agent], { root: dir, log: () => {} });
    const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    settings.default_course = 'decision';
    settings.courses = settings.courses.filter((c: { id: string }) => c.id === 'decision');
    writeFileSync(settingsFile(), JSON.stringify(settings));
    expect(existsSync(join(dir, '.baton/courses/decision'))).toBe(false);
    writeFileSync(join(dir, 'tickets/t1.md'), '---\nid: T-1\ntitle: Build it\n---\n\n## prepare\n\nFixture decision.\n');
    git('init', '--bare', '-q', '-b', 'main', remote);
    git('remote', 'add', 'origin', remote);
    const sha = commit();
    git('push', '-q', 'origin', 'main');
    git('update-ref', 'refs/baton/docs/default', sha);
    let mf: Miniflare | undefined;
    let transport = hostCall;
    try {
      if (host === 'cloudflare') {
        const { outputFiles } = await build({
          entryPoints: [join(ROOT, 'src/cloudflare/worker.ts')], bundle: true, write: false,
          format: 'esm', external: ['cloudflare:workers'], loader: { '.sql': 'text', '.html': 'text', '.css': 'text' },
          plugins: [{ name: 'dashboard-text', setup(b) {
            b.onLoad({ filter: /dashboard\/dist\/app\.js$/ }, ({ path }) => ({ contents: readFileSync(path, 'utf8'), loader: 'text' }));
          } }],
        });
        const config = inject('localConfig');
        const repos = JSON.parse(config.BATON_REPOSITORIES ?? '[]');
        repos.find((r: { id: string }) => r.id === 'docs').cut_over = true;
        mf = new Miniflare(convertV4MiniflareOptions({
          modules: true, script: outputFiles[0].text, compatibilityDate: '2026-09-01',
          bindings: { ...config, BATON_REPOSITORIES: JSON.stringify(repos) },
          durableObjects: { BATON: { className: 'Baton', useSQLite: true } },
        }));
        const worker = mf;
        transport = async (req) => {
          const headers = new Headers(req.headers);
          if (!headers.has('Baton-Client')) headers.set('Baton-Client', `baton/${RECOMMENDED_CLIENT}`);
          const response = await worker.dispatchFetch(req.url, {
            method: req.method, headers: headerPairs(headers), ...(req.body ? { body: await req.text() } : {}),
          });
          return new Response(await response.arrayBuffer(), { status: response.status, headers: headerPairs(response.headers) });
        };
      } else {
        await cutover();
      }
      const token = await syncToken();
      const args = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--facts', facts], {});
      expect(await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport, log: () => {} })).toBe(0);
      const logs: string[] = [];
      const runner = new Runner({
        api: new BatonApi({ url: ORIGIN, transport, auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) }) }),
        home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 's110-entry',
        courses: [{ course: 'decision', version: 1 }], stateFile: join(dir, '.git', 'runner-test.json'), beatEvery: 60_000, log: (line) => logs.push(line),
      });
      try {
        const outcome = await runner.runOnce();
        expect(outcome, logs.join('\n')).toMatchObject({ reached: 'asked' });
        expect(readFileSync(join(dir, 'instruction.log'), 'utf8')).toBe(readFileSync(join(ROOT, 'src/defaults/courses/decision/prepare.md'), 'utf8'));
      } finally {
        runner.stop();
      }
    } finally {
      await mf?.dispose();
    }
  }, 60_000);

  it('S-BTN-110 reads a fetched pin and rechecks ancestry even when its objects are cached', async () => {
    const upstream = mkdtempSync(join(tmpdir(), 'baton-s105-source-'));
    const env = { GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0 };
    const remote = (...args: string[]) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' }).trim();
    try {
      remote('init', '-q', '-b', 'main');
      remote('config', 'user.email', 'source@test');
      remote('config', 'user.name', 'source');
      remote('commit', '--allow-empty', '-qm', 'base');
      remote('branch', 'unrelated');
      const courseDir = join(upstream, '.baton', 'courses', 'create-pr');
      mkdirSync(join(courseDir, 'legs'), { recursive: true });
      writeFileSync(join(courseDir, 'course.json'), JSON.stringify({ start: 'filed', start_leg: 'implement', end: ['done'], stations: { filed: {}, done: {} }, legs: { implement: { from: ['filed'], to: 'done' } } }));
      writeFileSync(join(courseDir, 'entry.json'), '{"skill":"fetched-skill"}');
      writeFileSync(join(courseDir, 'sync.mjs'), `export function stations() {
  return { stations: { 'T-1': { station: 'filed', path: [], next_leg: 'implement', next_source: 'marker', next: [{ leg: 'implement', state: 'ready' }], bars: {} } }, markers: [], course_data: null };
}`);
      writeFileSync(join(courseDir, 'legs', 'implement.md'), 'source instructions');
      writeFileSync(join(courseDir, 'legs', 'implement.mjs'), `import { readFileSync } from 'node:fs';
export const run = (ctx) => ({ reached: 'done', text: readFileSync(ctx.instructions, 'utf8') });
export const close = () => 'source close';`);
      remote('add', '.baton');
      remote('commit', '-qm', 'course');
      const pin = remote('rev-parse', 'HEAD');
      process.env.GIT_CONFIG_COUNT = '1';
      process.env.GIT_CONFIG_KEY_0 = `url.${upstream}.insteadOf`;
      process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/fixture/course.git';
      const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
      delete settings.courses[0].skill;
      settings.courses[0].source = `github/fixture/course/${pin}/create-pr`;
      writeFileSync(settingsFile(), JSON.stringify(settings));
      const sha = commit();
      await cutover();
      await sync();
      const legs = join(dir, '.baton', 'courses', 'create-pr', 'legs');
      writeFileSync(join(legs, 'implement.md'), 'home instructions');
      writeFileSync(join(legs, 'implement.run.mjs'), 'export async function run(ctx, standard) { return { ...await standard(ctx), override: true }; }');
      const overridden = commit();
      writeFileSync(join(legs, 'implement.md'), 'uncommitted instructions');
      const loaded = await loadCourse(dir, sha, 'create-pr');
      try {
        const script = loaded.scripts.get('implement')!;
        const run = (call: string, at: string, signed_control?: Record<string, string>) => {
          const ctx = { ...sourceContext(loaded), snapshot: { sha: at }, signed_control, checkout: dir, leg: 'implement' };
          return JSON.parse(spawnSync(process.execPath, [join(ROOT, 'src/runner/legProcess.mjs'), call, script], {
            input: `${JSON.stringify([ctx])}\n`, encoding: 'utf8',
          }).stdout.trim());
        };
        expect(statSync(join(loaded.scratch, 'source', 'legs')).mode & 0o777).toBe(0o555);
        expect(run('run', sha).result).toEqual({ reached: 'done', text: 'source instructions' });
        expect(run('run', overridden).result).toEqual({ reached: 'done', text: 'home instructions', override: true });
        expect(run('run', overridden, { course: sha, overrides: sha }).result).toEqual({ reached: 'done', text: 'source instructions' });
        expect(run('close', overridden).result).toBe('source close');
        chmodSync(script, 0o644);
        writeFileSync(script, 'export const run = () => "wrong bytes";');
        chmodSync(script, 0o444);
        expect(run('close', overridden)).toMatchObject({ ok: false, error: expect.stringMatching(/verified source file .* changed/) });
      } finally {
        dropCourse(loaded.scratch);
      }
      remote('symbolic-ref', 'HEAD', 'refs/heads/unrelated');
      await expect(loadCourse(dir, sha, 'create-pr')).rejects.toThrow(new RegExp(`${pin}.*CLI commit ${SHA}.*not an ancestor`));
      const runner = new Runner({
        api: new BatonApi({ url: ORIGIN, transport: hostCall, auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) }) }),
        home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 's105-source',
        // create-pr's entry asks runner course version 2 since B-258 (min_runner_version).
        courses: [{ course: 'create-pr', version: settings.courses[0].min_runner_version ?? 1 }], stateFile: join(dir, '.git', 'runner-test.json'), beatEvery: 60_000, log: () => {},
      });
      git('update-ref', 'refs/baton/docs/default', sha);
      try {
        expect(await runner.runOnce()).toMatchObject({ end_reason: 'released:cannot-finish:capability', reached: 'filed' });
      } finally {
        runner.stop();
      }
    } finally {
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      rmSync(upstream, { recursive: true, force: true });
    }
  });
});
