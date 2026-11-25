// S-BTN-313 (BATON_SPEC §15, R-BTN-22, R-BTN-34, R-BTN-72), Node only: a real local
// Baton, git checkouts, and legs that finish across a course update.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { BatonApi } from '../../src/runner/api';
import { cliBehind, readCliPin } from '../../src/runner/cliPin';
import { git } from '../../src/defaults/git.mjs';
import { courseReader, refreshHome } from '../../src/runner/main';
import { Runner } from '../../src/runner/runner';
import { claimItem, course, cutover, placed, register, rows, setClock, syncCall, syncToken, ticket, TOKENS } from '../helpers';
import relay from '../fixtures/courses/relay/course.json';

const settings = '.baton/baton.json';
const graph = { ...relay, legs: { ...relay.legs, build: { ...relay.legs.build, requires: undefined } } };
const writeCourses = (repo: string, version: number) => writeFileSync(join(repo, settings), JSON.stringify({ courses: [{ id: 'relay', version }] }));
const commit = (repo: string) => {
  git(repo, ['add', settings, '.baton/courses']);
  git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-q', '--no-gpg-sign', '-m', 'snapshot']);
  return git(repo, ['rev-parse', 'HEAD']).trim();
};

let dir: string, source: string, home: string, start: string;
let lines: string[];
let runner: Runner | undefined;
beforeEach(async () => {
  await setClock(Date.parse('2026-11-23T12:00:00Z'));
  await cutover();
  dir = mkdtempSync(join(tmpdir(), 'baton-s313-'));
  source = join(dir, 'source');
  home = join(dir, 'home');
  lines = [];
  mkdirSync(join(source, '.baton/courses/relay/legs'), { recursive: true });
  git(source, ['init', '-q', '-b', 'main']);
  writeCourses(source, 1);
  writeFileSync(join(source, '.baton/courses/relay/course.json'), JSON.stringify(graph));
  start = commit(source);
  git(dir, ['clone', '-q', source, home]);
});
afterEach(() => {
  runner?.stop();
  runner = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const path = (checkout: string, leg: string) => join(checkout, `.baton/courses/relay/legs/${leg}.mjs`);
const log = (line: string) => lines.push(line);

async function post(sha: string, parent: string | null, version: number, ids: string[], token?: string) {
  const result = await syncCall('/v1/sync/board', {
    sha, parent_sha: parent, registry: [course(version, version, { id: 'relay', course: graph })],
    tickets: ids.map((id) => ticket(id, { course_id: 'relay' })), closed: [],
    stations: Object.fromEntries(ids.map((id) => [id, placed('filed', [], [['build', 'ready']])])),
  }, token);
  expect(result.status, await result.text()).toBe(200);
}

function makeRunner(options: Partial<ConstructorParameters<typeof Runner>[0]> = {}) {
  const api = new BatonApi({
    url: 'https://baton.test', transport: (req) => hostCall(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) }),
  });
  const readCourses = options.readCourses ?? courseReader(home, 'docs');
  return runner = new Runner({
    api, home, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 's313',
    courses: readCourses(), readCourses, refreshHome: () => refreshHome(home, log),
    stateFile: join(dir, 'runner.json'), beatEvery: 100, log, ...options,
  });
}

const built = `export async function run() { return { suspend: true, reached: 'built' }; }
  export async function close() { return 'https://example.test/close'; }
  export async function handoff() { return 'https://example.test/handoff'; }`;

describe('S-BTN-313 refresh course versions and request a restart', () => {
  it('finishes the held protocol, then declares v2 before the next claim', async () => {
    const marker = join(dir, 'started');
    const release = join(dir, 'release');
    // The new script will throw. The held claim must instead finish both old legs.
    writeFileSync(path(source, 'build'), `import { existsSync, writeFileSync } from 'node:fs';
      export async function run() {
        writeFileSync(${JSON.stringify(marker)}, '');
        while (!existsSync(${JSON.stringify(release)})) await new Promise(r => setTimeout(r, 20));
        return { reached: 'built', next: 'check' };
      }
      export async function close() { return 'https://example.test/close'; }`);
    writeFileSync(path(source, 'check'), built.replace("reached: 'built'", "reached: 'checked'"));
    const v1 = commit(source);
    await post(v1, null, 1, ['T-1']);
    const r = makeRunner();
    const held = r.runOnce();
    try {
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 15_000 });
      writeCourses(source, 2);
      writeFileSync(path(source, 'check'), `export function run() { throw new Error('not the held protocol'); }`);
      writeFileSync(path(source, 'build'), built);
      const v2 = commit(source);
      await post(v2, v1, 2, ['T-1', 'T-2']);
      const late = await register('vm-b', { courses: [{ repository: 'docs', course: 'relay', version: 1 }] });
      expect(await claimItem('vm-b', late.secret, { ticket_id: 'docs:T-2' })).toMatchObject({ status: 409, json: { code: 'stale-skills' } });
      await r.tick();
      expect(await rows('SELECT version FROM runner_courses WHERE course_id = ? ORDER BY version', 'relay')).toEqual([{ version: 1 }, { version: 1 }]);
    } finally {
      writeFileSync(release, '');
      expect(await held).toMatchObject({ ticket: 'docs:T-1', end_reason: 'suspended:checked' });
    }
    expect(await r.runOnce()).toMatchObject({ ticket: 'docs:T-2', end_reason: 'suspended:built' });
    expect(await rows('SELECT version FROM runner_courses WHERE course_id = ? ORDER BY version', 'relay')).toEqual([{ version: 1 }, { version: 2 }]);
    expect(lines).toContain('baton: course relay now version 2 (was 1)');
  }, 30_000);

  it.each(['{"courses":[]}', '{"skills_version":2}'])('refreshes after a claim fast-forward and omits a removed selected course (%s)', async (replacement) => {
    writeCourses(source, 2);
    writeFileSync(path(source, 'build'), built);
    const v2 = commit(source);
    // Rule 9 still allows v1 to take this claim; only the claim path fetches and advances.
    await post(v2, null, 1, ['T-1']);
    let refreshBetweenClaims = false;
    const r = makeRunner({
      refreshHome: () => refreshBetweenClaims && refreshHome(home, log),
      fetch: () => { git(home, ['fetch', '-q', 'origin', 'main']); },
      readCourses: courseReader(home, 'docs', 'relay'),
    });
    expect(await r.runOnce()).toMatchObject({ end_reason: 'suspended:built' });
    await r.tick();
    expect(await rows('SELECT version FROM runner_courses')).toEqual([{ version: 2 }]);
    writeFileSync(join(source, settings), replacement);
    commit(source);
    refreshBetweenClaims = true;
    expect(await r.runOnce()).toBeNull();
    expect(await rows('SELECT version FROM runner_courses')).toEqual([]);
  }, 30_000);

  it('refreshes a non-main default branch without a local origin/HEAD before applying Rule 9', async () => {
    git(source, ['branch', '-m', 'trunk']);
    git(home, ['fetch', '-q', 'origin', 'trunk']);
    git(home, ['switch', '-q', '--track', 'origin/trunk']);
    git(home, ['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD']);
    await rows("UPDATE repositories SET default_branch = 'trunk' WHERE id = 'docs'");
    const token = await syncToken({ ref: 'refs/heads/trunk', job_workflow_ref: 'immediately-run/docs/.github/workflows/baton-sync.yml@refs/heads/trunk' });
    const r = makeRunner();
    writeCourses(source, 2);
    writeFileSync(path(source, 'build'), built);
    await post(commit(source), null, 2, ['T-1'], token);
    expect(await r.runOnce()).toMatchObject({ ticket: 'docs:T-1', end_reason: 'suspended:built' });
    expect(await rows('SELECT version FROM runner_courses')).toEqual([{ version: 2 }]);
  });

  it.each([-1, 1.5, 1_000_000_001])('keeps a valid heartbeat and can claim when the refreshed version is %s', async (invalid) => {
    const r = makeRunner();
    writeCourses(source, invalid);
    writeFileSync(path(source, 'build'), built);
    await post(commit(source), null, 1, ['T-1']);
    expect(await r.runOnce()).toMatchObject({ ticket: 'docs:T-1', end_reason: 'suspended:built' });
    expect(await rows('SELECT version FROM runner_courses')).toEqual([{ version: 1 }]);
    expect(lines.join('\n')).toMatch(/keeping the last course declaration .*courses\[0\]\.version/);
  });

  it('does not claim when refreshing the shared CLI and home reveals an update', async () => {
    const cliFile = join(home, 'baton.mjs');
    // A tag of the same name must not hide the branch's configured upstream.
    git(home, ['tag', 'main']);
    const pin = readCliPin(cliFile);
    const r = makeRunner({ restartReason: () => cliBehind(cliFile, pin) });
    writeFileSync(path(source, 'build'), built);
    const sha = commit(source);
    await post(sha, null, 1, ['T-1']);
    expect(cliBehind(cliFile, pin)).toBeNull();
    expect(await r.runOnce()).toBeNull();
    expect(git(home, ['rev-parse', 'HEAD']).trim()).toBe(sha);
    expect(await rows('SELECT id FROM claims')).toEqual([]);
    expect(await r.work()).toBe(75);
  });

  it.each(['ahead', 'diverged', 'edited'] as const)('keeps the last declaration when the home is %s', async (kind) => {
    const r = makeRunner();
    await post(start, null, 1, []);
    await r.tick();
    writeCourses(home, 9);
    if (kind !== 'edited') commit(home);
    if (kind !== 'ahead') { writeCourses(source, 2); commit(source); }
    await r.runOnce();
    expect(await rows('SELECT version FROM runner_courses')).toEqual([{ version: 1 }]);
    expect(lines.join('\n')).toContain(kind === 'edited' ? 'the home has tracked changes' : 'is not behind the snapshot');
  });

  it.each([true, false])('checks its own tracking ref at the claim boundary (flag: %s)', async (restart) => {
    // A CLI checkout distinct from the home. Its upstream moves only after a leg has started.
    const cli = join(dir, 'cli');
    git(dir, ['clone', '-q', source, cli]);
    const cliFile = join(cli, 'baton.mjs');
    const pin = readCliPin(cliFile);
    const release = join(dir, 'release');
    const active = join(dir, 'active');
    writeFileSync(path(source, 'build'), `import { existsSync, writeFileSync } from 'node:fs';
      ${built.replace('return {', `writeFileSync(${JSON.stringify(active)}, '');
      while (!existsSync(${JSON.stringify(release)})) await new Promise(r => setTimeout(r, 20));
      return {`)}`);
    const sha = commit(source);
    await post(sha, null, 1, ['T-1', 'T-2']);
    const r = makeRunner({ restartReason: restart ? () => cliBehind(cliFile, pin) : undefined });
    const work = r.work();
    try {
      await vi.waitFor(() => expect(existsSync(active)).toBe(true), { timeout: 15_000 });
      // Update only the CLI's tracking ref, not its working tree.
      git(cli, ['fetch', '-q', 'origin', 'main']);
      expect(cliBehind(cliFile, pin)).toContain('restart requested');
      expect(await rows('SELECT status FROM claims')).toEqual([{ status: 'active' }]);
      writeFileSync(release, '');
      if (restart) {
        expect(await work).toBe(75);
        expect(await rows('SELECT end_reason FROM claims')).toEqual([{ end_reason: 'suspended:built' }]);
      } else {
        await vi.waitFor(async () => expect(await rows('SELECT end_reason FROM claims ORDER BY id')).toEqual([{ end_reason: 'suspended:built' }, { end_reason: 'suspended:built' }]), { timeout: 15_000 });
      }
      expect(lines.some((line) => line.includes('restart requested'))).toBe(restart);
    } finally {
      writeFileSync(release, '');
      r.stop();
      await work;
    }
  }, 40_000);
});
