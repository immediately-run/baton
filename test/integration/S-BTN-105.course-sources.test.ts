// S-BTN-105 / S-BTN-310 (B-139): sourced scripts and graph, home overrides, no home copies.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, showCourseMain, syncMain } from '../../src/defaults/cli';
import { dropCourse, loadCourse, sourceContext } from '../../src/runner/home';
import { BatonApi } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { cutover, ORIGIN, register, rows, setClock, syncToken, TOKENS } from '../helpers';

const T0 = Date.parse('2026-10-18T12:00:00Z');
const ROOT = resolve(import.meta.dirname, '../..');
const SHA = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

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
    expect(settings.courses[0].source).toMatch(new RegExp(`^github/[^/]+/[^/]+/${SHA}/create-pr$`));
    await sync();
    const at = async () => (await rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'docs:T-1'))[0];
    // The gate comes before every review round (B-110): with no marker on the head it is the
    // gate that is ready, not the round.
    expect(await at()).toMatchObject({ station: 'pr-open', next_leg: 'run-tests' });
    // The gate stands green on the head — a Baton-Tests marker commit, the evidence a claim's
    // run-tests leg recorded (B-110 round 1, finding 3) — and the round queues.
    const work = 'c'.repeat(40);
    const commits = [
      { sha: work, at: T0, parent: null, empty: false, message: 'the work' },
      { sha: 'a'.repeat(40), at: T0 + 30_000, parent: work, empty: true, message: `baton: tests green for T-1\n\nBaton-Tests: green\nBaton-Tested: ${work}\nBaton-Claim: n0` },
    ];
    const { id: runner } = await register('vm-a');
    await rows(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason) VALUES ('docs:T-1', ?, 'gate:n0', 'n0', '', 0, 'released', 1, 'released:requested')`, runner);
    const [{ id: claim }] = await rows<{ id: number }>(`SELECT id FROM claims WHERE request_id = 'gate:n0'`);
    await rows(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, to_station, started_at, started_observation, finished_at, evidence) VALUES (?, 1, 'run-tests', 'pr-open', 'pr-open', 0, 0, 1, ?)`, claim, 'a'.repeat(40));
    writeFileSync(facts, JSON.stringify([{ number: 7, head: 'claude/T-1-x', state: 'open', pushedAt: T0 + 30_000, pushes: [T0, T0 + 30_000], checks: ['success'], reviews: [], commits }]));
    await sync();
    expect(await at()).toMatchObject({ station: 'pr-open', next_leg: 'review' });

    // The repository's review: its own check, then the course's run with an agent that asks for changes.
    const agent = join(dir, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\ncat "$BATON_INSTRUCTIONS" > instruction.log\necho changes\n');
    writeFileSync(join(dir, '.baton', 'courses', 'create-pr', 'legs', 'review.md'), 'Home review instructions\n');
    chmodSync(agent, 0o755);
    writeFileSync(settingsFile(), JSON.stringify({ ...settings, agent_command: agent }, null, 2));
    writeFileSync(join(dir, '.baton', 'courses', 'create-pr', 'legs', 'review.run.mjs'), `import { writeFileSync } from 'node:fs';
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
      const result = await leg.run(ctx);
      expect(result).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      expect(readFileSync(join(dir, 'instruction.log'), 'utf8')).toBe('Home review instructions\n');
      expect(readFileSync(join(dir, 'gate.log'), 'utf8')).toContain('two blind reviewers');
      expect(await leg.close(ctx, result)).toBe('https://github.com/o/r/pull/7#issuecomment-1');
      const body = readFileSync(join(bin, 'body'), 'utf8');
      expect(body.split('\n')[0]).toBe('<!-- baton:verdict changes -->');
      // The forge now carries that comment: the next sync reads it as the review's verdict.
      writeFileSync(facts, JSON.stringify([{ number: 7, head: 'claude/T-1-x', state: 'open', pushedAt: T0, pushes: [T0], checks: ['success'], reviews: [{ author: 'baton', state: 'COMMENTED', submittedAt: T0 + 60_000, body }], commits }]));
    } finally {
      process.env.PATH = path;
      dropCourse(loaded.scratch);
      rmSync(bin, { recursive: true, force: true });
    }
    await sync();
    expect(await at()).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
  }, 120_000);

  it('S-BTN-310 refuses a committed copy and loads the source script instead of it', async () => {
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

  it('S-BTN-310 scaffolds only explicitly requested files and prunes identical copies', async () => {
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

  it('S-BTN-310 reads a fetched pin and rechecks ancestry even when its objects are cached', async () => {
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
        courses: [{ course: 'create-pr', version: 1 }], stateFile: join(dir, '.git', 'runner-test.json'), beatEvery: 60_000, log: () => {},
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
