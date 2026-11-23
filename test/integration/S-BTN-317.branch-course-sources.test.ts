// BATON_SPEC §15 S-BTN-317: a branch source is resolved again for each sync, never for a claim.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { call } from '#host';
import { initMain, syncMain } from '../../src/defaults/cli';
import { ORIGIN, rows, setClock, syncToken } from '../helpers';

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
    const source = () => JSON.parse(readFileSync(settings, 'utf8')).courses[0].source as string;
    expect(source()).toMatch(/\/[0-9a-f]{40}\/create-pr$/);
    await init(['--course', 'create-pr', '--source-branch', 'main']);
    const branchSource = source();
    expect(branchSource).toMatch(/\/main\/create-pr$/);
    await init([]);
    expect(source()).toBe(branchSource);

    const [, owner, repo] = branchSource.split('/');
    const config = join(dir, 'git-config');
    git(home, 'config', '--file', config, `url.${pathToFileURL(remote).href}.insteadOf`, `https://github.com/${owner}/${repo}.git`);
    vi.stubEnv('TMPDIR', dir);
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', `includeIf.gitdir:${dir}/.path`);
    vi.stubEnv('GIT_CONFIG_VALUE_0', config);
    const graphFile = '.baton/courses/create-pr/course.json';
    const graph = JSON.parse(readFileSync(join(home, graphFile), 'utf8'));
    mkdirSync(join(remote, 'src/defaults'), { recursive: true });
    const standard = (revision: string, course = graph) => {
      writeFileSync(join(remote, 'src/defaults/courses.ts'), `export const builtIn = (id: string) => ({ id, course: ${JSON.stringify(course)}, reads: 'prs', stations: () => ({ stations: {}, course_data: ${JSON.stringify(revision)} }) });\n`);
      return commit(remote, revision, 'src/defaults/courses.ts');
    };
    const first = standard('first');
    const homeSha = commit(home, 'scaffold', '.baton');
    const factsFile = join(dir, 'facts.json');
    writeFileSync(factsFile, '[]');
    await setClock(Date.parse('2026-10-18T12:00:00Z'));
    const token = await syncToken();
    const posted: { course_data: Record<string, string> }[] = [];
    const sync = () => syncMain({ root: home, url: ORIGIN, factsFile, log: (line) => logs.push(line),
      auth: () => ({ Authorization: `Bearer ${token}` }), transport: async (req) => {
        if (new URL(req.url).pathname === '/v1/sync/board') posted.push(await req.clone().json() as typeof posted[number]);
        return call(req);
      } });
    const snapshot = async () => (await rows<{ course_sources_json: string }>('SELECT course_sources_json FROM board_snapshots WHERE repository_id = ? AND sha = ?', 'docs', homeSha))[0]?.course_sources_json;
    for (const revision of ['first', 'moved']) {
      const resolved = revision === 'first' ? first : standard(revision);
      expect(await sync()).toBe(0);
      expect(posted.at(-1)?.course_data).toEqual({ 'create-pr': revision });
      expect(JSON.parse((await snapshot())!)).toEqual({ 'create-pr': { branch: 'main', sha: resolved } });
      expect(logs).toContain(`course create-pr follows branch main (unpinned): resolved to ${resolved.slice(0, 10)}`);
    }

    const accepted = await snapshot();
    standard('different graph', { ...graph, start: 'another-start' });
    await expect(sync()).rejects.toThrow('course.json differs from the source');
    git(remote, 'branch', '-m', 'not-main');
    git(remote, 'tag', 'main', first);
    await expect(sync()).rejects.toThrow('cannot resolve course source branch main');
    expect(posted).toHaveLength(2);
    expect(await snapshot()).toBe(accepted);

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
