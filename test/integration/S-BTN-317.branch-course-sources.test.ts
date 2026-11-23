// BATON_SPEC §15 S-BTN-317: a branch source is resolved again for each sync, never for a claim.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { call } from '#host';
import { initMain, syncMain } from '../../src/defaults/cli';
import { readBranchSource } from '../../src/defaults/course-source-git';
import { parseSource } from '../../src/defaults/course-source';
import { loadCourse } from '../../src/runner/home';
import { claimItem, claimRow, cutover, ORIGIN, placed, register, rows, setClock, syncToken } from '../helpers';

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const setup = (dir: string) => {
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'user.email', 'fixture@test');
};
const commit = (dir: string, message: string, ...paths: string[]) => {
  git(dir, 'add', '--', ...paths);
  git(dir, 'commit', '-qm', message);
  return git(dir, 'rev-parse', 'HEAD');
};

it('S-BTN-317 uses and records the current branch commit, warns on each sync, and never falls back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-s317-'));
  const home = join(dir, 'home');
  const remote = join(dir, 'source');
  const logs: string[] = [];
  try {
    setup(home);
    setup(remote);
    const init = (args: string[]) => initMain(args, { root: home, log: () => {} });
    await expect(init(['--course', 'create-pr', '--source-branch', 'a'.repeat(40)])).rejects.toThrow('expected a valid branch');
    await init([]);
    const settings = join(home, '.baton', 'baton.json');
    const pinnedConfig = readFileSync(settings, 'utf8');
    const source = () => JSON.parse(readFileSync(settings, 'utf8')).courses[0].source as string;
    expect(source()).toMatch(/\/[0-9a-f]{40}\/create-pr$/);
    await init(['--course', 'create-pr', '--source-branch', 'main']);
    const branchSource = source();
    expect(branchSource).toMatch(/\/main\/create-pr$/);
    await init([]);
    expect(source()).toBe(branchSource);
    const branchConfig = readFileSync(settings, 'utf8');

    const [, owner, repo] = branchSource.split('/');
    const config = join(dir, 'git-config');
    git(home, 'config', '--file', config, `url.${pathToFileURL(remote).href}.insteadOf`, `https://github.com/${owner}/${repo}.git`);
    const globalConfig = join(dir, 'global-config');
    git(home, 'config', '--file', globalConfig, `includeIf.gitdir:${dir}/.path`, config);
    vi.stubEnv('TMPDIR', dir);
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
    const graphFile = '.baton/courses/create-pr/course.json';
    const graph = JSON.parse(readFileSync(join(home, graphFile), 'utf8'));
    const stations = { 'T-1': placed('filed', [], [['implement', 'ready']], { next_source: 'course' }) };
    mkdirSync(join(remote, 'src/defaults'), { recursive: true });
    const standard = (revision: string, course = graph, readsPrs = true) => {
      writeFileSync(join(remote, 'src/defaults/courses.ts'), `export const builtIn = (id: string) => ({ id, course: ${JSON.stringify(course)}, reads: ${readsPrs ? "'prs'" : 'undefined'}, stations: () => ({ stations: ${JSON.stringify(stations)}, course_data: ${JSON.stringify(revision)} }) });\n`);
      return commit(remote, revision, 'src/defaults/courses.ts');
    };
    const first = standard('first');
    mkdirSync(join(home, 'tickets'), { recursive: true });
    writeFileSync(join(home, 'tickets', 't1.md'), '---\nid: T-1\ntitle: Build it\n---\n');
    writeFileSync(settings, pinnedConfig);
    commit(home, 'scaffold', '.baton', 'tickets');
    writeFileSync(settings, branchConfig);
    const factsFile = join(dir, 'facts.json');
    writeFileSync(factsFile, '[]');
    await setClock(Date.parse('2026-10-18T12:00:00Z'));
    const token = await syncToken();
    await cutover();
    const posted: { course_data: Record<string, string> }[] = [];
    const sync = () => syncMain({ root: home, url: ORIGIN, factsFile, log: (line) => logs.push(line),
      auth: () => ({ Authorization: `Bearer ${token}` }), transport: async (req) => {
        if (new URL(req.url).pathname === '/v1/sync/board') posted.push(await req.clone().json() as typeof posted[number]);
        const response = await call(req);
        if (!response.ok) logs.push(await response.clone().text());
        return response;
      } });
    await expect(sync()).rejects.toThrow('.baton/baton.json differs from the home commit');
    expect(posted).toHaveLength(0);
    expect(logs).not.toContain(`course create-pr follows branch main (unpinned): resolved to ${first.slice(0, 10)}`);
    const homeSha = commit(home, 'follow branch', '.baton/baton.json');

    const homeEnv = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
    vi.stubEnv('GIT_DIR', join(home, '.git'));
    vi.stubEnv('GIT_WORK_TREE', home);
    try {
      expect((await readBranchSource(parseSource(branchSource))).sha).toBe(first);
    } finally {
      vi.stubEnv('GIT_DIR', homeEnv.dir);
      vi.stubEnv('GIT_WORK_TREE', homeEnv.tree);
    }
    expect(git(home, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');
    expect(git(home, 'rev-parse', 'HEAD')).toBe(homeSha);
    expect(existsSync(join(home, '.git', 'FETCH_HEAD'))).toBe(false);
    expect(git(home, 'status', '--porcelain', '--untracked-files=no')).toBe('');

    const snapshot = async () => (await rows<{ course_sources_json: string }>('SELECT course_sources_json FROM board_snapshots WHERE repository_id = ? AND sha = ?', 'docs', homeSha))[0]?.course_sources_json;
    const synced = async (revision: string, resolved: string) => {
      expect(await sync(), logs.join('\n')).toBe(0);
      expect(posted.at(-1)?.course_data).toEqual({ 'create-pr': revision });
      expect(JSON.parse((await snapshot())!)).toEqual({ 'create-pr': { branch: 'main', sha: resolved } });
      expect(logs).toContain(`course create-pr follows branch main (unpinned): resolved to ${resolved.slice(0, 10)}`);
    };
    await synced('first', first);
    const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-pr', version: 1 }] });
    const claim = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:T-1' });
    expect(claim.json).toMatchObject({ snapshot_sha: homeSha, legs: ['implement'] });
    expect(claim.status).toBe(200);
    await synced('moved', standard('moved'));

    const accepted = await snapshot();
    standard('different facts', graph, false);
    expect(await sync()).toBe(1);
    expect(logs).toContain("baton: course create-pr's branch changed which facts it reads — advance the home commit before syncing");
    expect(await snapshot()).toBe(accepted);
    expect(await rows('SELECT facts FROM courses WHERE repository_id = ? AND id = ?', 'docs', 'create-pr')).toEqual([{ facts: '["prs"]' }]);

    const newGraph = { ...graph, legs: { ...graph.legs, review: { ...graph.legs.review, max_runs: 4 } } };
    standard('different graph', newGraph, false);
    await expect(sync()).rejects.toThrow('course.json differs from the source');
    git(remote, 'branch', '-m', 'not-main');
    git(remote, 'tag', 'main', first);
    await expect(sync()).rejects.toThrow('cannot resolve course source branch main');
    expect(posted).toHaveLength(3);
    expect(await snapshot()).toBe(accepted);

    git(remote, 'tag', '-d', 'main');
    git(remote, 'branch', '-m', 'main');
    writeFileSync(join(home, graphFile), `${JSON.stringify(newGraph, null, 2)}\n`);
    const advancedSha = commit(home, 'scaffold the new graph', graphFile);
    expect(await sync()).toBe(0);
    expect(await rows('SELECT facts FROM courses WHERE repository_id = ? AND id = ?', 'docs', 'create-pr')).toEqual([{ facts: '[]' }]);
    expect(await claimRow(claim.json.claim_id)).toMatchObject({ status: 'active' });
    for (const [sha, maxRuns] of [[claim.json.snapshot_sha, 3], [advancedSha, 4]] as const) {
      const loaded = loadCourse(home, sha, claim.json.course_id);
      try {
        expect(loaded.graph.legs.get('review')?.maxRuns).toBe(maxRuns);
      } finally {
        rmSync(loaded.scratch, { recursive: true, force: true });
      }
    }

    const workflow = parse(readFileSync(join(home, '.github/workflows/baton-sync.yml'), 'utf8'));
    const step = workflow.jobs.sync.steps.find((s: { name?: string }) => s.name === 'Annotate unpinned course sources');
    writeFileSync(join(home, 'sync.log'), `${logs.join('\n')}\n`);
    const annotations = execFileSync('bash', ['-e', '-c', step.run], { cwd: home, encoding: 'utf8' });
    expect(annotations).toContain(`::warning title=unpinned course source::course create-pr follows branch main (unpinned): resolved to ${first.slice(0, 10)}`);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
