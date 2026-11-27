// BATON_SPEC §15 S-BTN-325 (B-315, R-BTN-134; the owner, 2026-11-26: "there is no trust model when
// course is pinned to a branch … should trigger a warning saying so"): every reader of a branch
// source — init, course show, the sync, the Sync read, a runner's claim — says it is unpinned and
// unchecked, in one line. S-BTN-317 covers what a branch source reads and records.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { call } from '#host';
import { initMain, parseSyncArgs, showCourseMain, syncMain } from '../../src/defaults/cli';
import { dropCourse, loadCourse } from '../../src/runner/home';
import { cutover, keyCall, ORIGIN, setAdminKeys, setClock, syncToken } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-26T12:00:00Z');
const run = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const repo = (dir: string) => {
  mkdirSync(dir);
  run(dir, 'init', '-q', '-b', 'main');
  run(dir, 'config', 'user.name', 'Fixture');
  run(dir, 'config', 'user.email', 'fixture@test');
};
const commitAll = (dir: string, message: string) => {
  run(dir, 'add', '-A');
  run(dir, 'commit', '--allow-empty', '-qm', message);
  return run(dir, 'rev-parse', 'HEAD');
};
const warning = (sha?: string) => `baton: warning: course create-pr follows branch dev of fixture/course${sha ? ` (resolved to ${sha.slice(0, 10)})` : ''}: unpinned, no trust check — for development only; pin a commit for production`;

let dir: string;
let home: string;
let upstream: string;
let minutes = 0;
const logs: string[] = [];
const settingsFile = () => join(home, '.baton', 'baton.json');

/** The source's `dev` branch, off `main` — never on the default branch's ancestry. */
const publish = (revision: string, facts: string[] = ['prs']) => {
  const course = join(upstream, '.baton', 'courses', 'create-pr');
  mkdirSync(join(course, 'legs'), { recursive: true });
  writeFileSync(join(course, 'course.json'), JSON.stringify({ start: 'filed', start_leg: 'implement', end: ['done'], stations: { filed: {}, done: {} }, legs: { implement: { from: ['filed'], to: 'done' } } }));
  writeFileSync(join(course, 'entry.json'), JSON.stringify({ facts }));
  writeFileSync(join(course, 'sync.mjs'), `export function stations() {
  return { stations: { 'T-1': { station: 'filed', path: [], next_leg: 'implement', next_source: 'marker', next: [{ leg: 'implement', state: 'ready' }], bars: {} } }, markers: [], course_data: ${JSON.stringify(revision)} };
}\n`);
  writeFileSync(join(course, 'legs', 'implement.md'), 'source instructions');
  writeFileSync(join(course, 'legs', 'implement.mjs'), "export const run = () => ({ reached: 'done' });\nexport const close = () => 'closed';\n");
  return commitAll(upstream, revision);
};

const sync = async () => {
  setClock(T0 + (minutes += 11) * 60_000);
  const token = await syncToken();
  const args = parseSyncArgs(['--root', home, '--url', ORIGIN, '--facts', join(dir, 'facts.json')], {});
  return syncMain({ ...args, log: (line) => logs.push(line), auth: () => ({ Authorization: `Bearer ${token}` }), transport: async (req) => {
    const response = await call(req);
    if (!response.ok) logs.push(await response.clone().text());
    return response;
  } });
};

beforeEach(async () => {
  minutes = 0;
  logs.length = 0;
  await setClock(T0);
  dir = mkdtempSync(join(tmpdir(), 'baton-s317-'));
  home = join(dir, 'home');
  upstream = join(dir, 'source');
  repo(upstream);
  commitAll(upstream, 'base');
  run(upstream, 'checkout', '-q', '-b', 'dev');
  repo(home);
  writeFileSync(join(dir, 'facts.json'), '[]');
  // A branch fetch drops Git's repository-local variables (GIT_CONFIG_COUNT among them), so the
  // fixture's remote is named in a global config file, as S-BTN-317 does.
  const globalConfig = join(dir, 'global-config');
  run(dir, 'config', '--file', globalConfig, `url.${pathToFileURL(upstream).href}.insteadOf`, 'https://github.com/fixture/course.git');
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** A home whose create-pr follows the fixture's `dev`, committed. */
const followDev = async () => {
  expect(await initMain([], { root: home, log: () => {} })).toBe(0);
  const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  delete settings.courses[0].skill;
  settings.courses[0].source = 'github/fixture/course/dev/create-pr';
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  mkdirSync(join(home, 'tickets'), { recursive: true });
  writeFileSync(join(home, 'tickets', 't1.md'), '---\nid: T-1\ntitle: Build it\n---\n');
  return commitAll(home, 'follow dev');
};

describe('the unpinned warning (B-315)', () => {
  it('S-BTN-325 every reader of a branch source warns that it is unpinned and unchecked; a pin warns of nothing', async () => {
    // A pin: no warning at init.
    const initLogs: string[] = [];
    expect(await initMain([], { root: home, log: (l) => initLogs.push(l) })).toBe(0);
    expect(initLogs.join('\n')).not.toContain('unpinned');
    const pinned = JSON.parse(readFileSync(settingsFile(), 'utf8')).courses[0].source as string;
    const [, owner, name] = pinned.split('/');
    await expect(initMain(['--course', 'create-pr', '--source-branch', 'a'.repeat(40)], { root: home, log: () => {} })).rejects.toThrow('expected a valid branch name');

    // init --source-branch writes the branch source of the CLI's repository and says so, as does
    // every later init, which leaves the branch alone.
    initLogs.length = 0;
    expect(await initMain(['--course', 'create-pr', '--source-branch', 'dev'], { root: home, log: (l) => initLogs.push(l) })).toBe(0);
    const branchSource = JSON.parse(readFileSync(settingsFile(), 'utf8')).courses[0].source as string;
    expect(branchSource).toBe(`github/${owner}/${name}/dev/standard-create-pr`);
    const own = `baton: warning: course create-pr follows branch dev of ${owner}/${name}: unpinned, no trust check — for development only; pin a commit for production`;
    expect(initLogs).toContain(own);
    initLogs.length = 0;
    expect(await initMain([], { root: home, log: (l) => initLogs.push(l) })).toBe(0);
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8')).courses[0].source).toBe(branchSource);
    expect(initLogs).toContain(own);

    // The fixture's branch: course show, the sync, the Sync read and a runner's load all say so.
    rmSync(join(home, '.baton'), { recursive: true, force: true });
    const sha = publish('first');
    const at = await followDev();
    const shown: string[] = [];
    expect(await showCourseMain(['create-pr'], home, (l: string) => shown.push(l))).toBe(0);
    expect(shown[0]).toBe(warning(sha));
    expect(shown.join('\n')).toContain('source instructions');

    await cutover();
    expect(await sync(), logs.join('\n')).toBe(0);
    expect(logs.filter((l) => l.includes('unpinned'))).toEqual([warning(sha)]);
    const admin = await makeKey('ssh-ed25519', 'admin');
    await setAdminKeys(admin);
    const read = (await keyCall(admin, '/v1/repositories/docs/sync')).json as { head: { sha: string; course_sources?: unknown } };
    expect(read.head.sha).toBe(at);
    expect(read.head.course_sources).toEqual({ 'create-pr': { branch: 'dev', sha, warning: `course create-pr follows branch dev (resolved to ${sha.slice(0, 10)}): unpinned, no trust check — for development only; pin a commit for production` } });

    const loaded = await loadCourse(home, at, 'create-pr', at, { branch: 'dev', sha });
    try {
      expect(loaded.warning).toBe(warning(sha));
    } finally {
      dropCourse(loaded.scratch);
    }

    // The generated workflow turns the sync's line into an annotation.
    const workflow = parse(readFileSync(join(home, '.github/workflows/baton-sync.yml'), 'utf8'));
    const step = workflow.jobs.sync.steps.find((s: { name?: string }) => s.name === 'Annotate unpinned course sources');
    writeFileSync(join(home, 'sync.log'), `${logs.join('\n')}\n`);
    expect(execFileSync('bash', ['-e', '-c', step.run], { cwd: home, encoding: 'utf8' }))
      .toBe(`::warning title=unpinned course source::${warning(sha).replace(/^baton: warning: /, '')}\n`);
  }, 120_000);
});
