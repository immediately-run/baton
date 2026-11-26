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
import { resolveSource } from '../../src/defaults/cli';
import { builtIn } from '../../src/defaults/courses';
import { dropCourse, loadCourse } from '../../src/runner/home';
import { claimItem, claimRow, cutover, observe, ORIGIN, placed, register, rows, setClock, syncCall, syncToken } from '../helpers';

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
    expect(source()).toMatch(/\/[0-9a-f]{40}\/standard-create-pr$/);
    await init(['--course', 'create-pr', '--source-branch', 'main']);
    const branchSource = source().replace(/\/standard-create-pr$/, '/create-pr');
    expect(source()).toMatch(/\/main\/standard-create-pr$/);
    writeFileSync(settings, readFileSync(settings, 'utf8').replace('/main/standard-create-pr', '/main/create-pr'));
    expect(branchSource).toMatch(/\/main\/create-pr$/);
    await init([]);
    expect(source()).toBe(branchSource);
    const branchConfig = readFileSync(settings, 'utf8');

    const [, owner, repo] = branchSource.split('/');
    const globalConfig = join(dir, 'global-config');
    git(home, 'config', '--file', globalConfig, `url.${pathToFileURL(remote).href}.insteadOf`, `https://github.com/${owner}/${repo}.git`);
    vi.stubEnv('TMPDIR', dir);
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
    const graphFile = '.baton/courses/create-pr/course.json';
    const graph = builtIn('create-pr')!.course;
    const stations = { 'T-1': placed('filed', [], [['implement', 'ready']], { next_source: 'course' }) };
    mkdirSync(join(remote, '.baton/courses/create-pr/legs'), { recursive: true });
    const standard = (revision: string, course = graph, readsPrs = true) => {
      const path = join(remote, '.baton/courses/create-pr');
      writeFileSync(join(remote, graphFile), JSON.stringify(course));
      writeFileSync(join(path, 'entry.json'), JSON.stringify({ facts: readsPrs ? ['prs'] : [] }));
      writeFileSync(join(path, 'sync.mjs'), `export default { stations: () => ({ stations: ${JSON.stringify(stations)}, markers: [], course_data: ${JSON.stringify(revision)} }) };\n`);
      writeFileSync(join(path, 'legs/implement.mjs'), `// ${revision}\n`);
      return commit(remote, revision, '.baton');
    };
    const first = standard('first');
    const fixturePin = pinnedConfig.replace(/github\/[^/]+\/[^/]+\/[0-9a-f]{40}\/standard-create-pr/, `github/${owner}/${repo}/${first}/create-pr`);
    mkdirSync(join(home, 'tickets'), { recursive: true });
    writeFileSync(join(home, 'tickets', 't1.md'), '---\nid: T-1\ntitle: Build it\n---\n');
    writeFileSync(settings, fixturePin);
    commit(home, 'scaffold', '.baton', 'tickets');
    writeFileSync(settings, branchConfig);
    const factsFile = join(dir, 'facts.json');
    writeFileSync(factsFile, '[]');
    await setClock(Date.parse('2026-10-18T12:00:00Z'));
    const token = await syncToken();
    await cutover();
    const posted: (Record<string, unknown> & { course_data: Record<string, string> })[] = [];
    const sync = () => syncMain({ root: home, url: ORIGIN, factsFile, log: (line) => logs.push(line),
      auth: () => ({ Authorization: `Bearer ${token}` }), transport: async (req) => {
        if (new URL(req.url).pathname === '/v1/sync/board') posted.push(await req.clone().json() as typeof posted[number]);
        const response = await call(req);
        if (!response.ok) logs.push(await response.clone().text());
        return response;
      } });
    expect(await sync()).toBe(0);
    expect(posted.at(-1)?.course_sources).toBeUndefined();
    expect(logs).not.toContain(`course create-pr follows branch main (unpinned): resolved to ${first.slice(0, 10)}`);
    const homeSha = commit(home, 'follow branch', '.baton/baton.json');

    const homeEnv = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
    vi.stubEnv('GIT_DIR', join(home, '.git'));
    vi.stubEnv('GIT_WORK_TREE', home);
    try {
      expect((await resolveSource('create-pr', branchSource, join(dir, 'isolated'))).resolution?.sha).toBe(first);
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
    writeFileSync(settings, fixturePin);
    await synced('first', first);
    writeFileSync(settings, branchConfig);
    // Advertise the scaffolded course version, as a runner loading this home would.
    const { version } = JSON.parse(branchConfig).courses[0] as { version: number };
    const runner = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-pr', version }] });
    const claim = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:T-1' });
    expect(claim.json).toMatchObject({ snapshot_sha: homeSha, legs: ['implement'], course_source: { branch: 'main', sha: first } });
    expect(claim.status).toBe(200);
    await synced('moved', standard('moved'));

    const accepted = await snapshot();
    standard('different facts', graph, false);
    expect(await sync()).toBe(1);
    const incompatible = posted.at(-1)!;
    for (const variant of [{ read_sha: 'a'.repeat(40) }, { sha: 'b'.repeat(40), force: true }]) {
      const { json: { observation } } = await observe(token);
      const reply = await syncCall('/v1/sync/board', { ...incompatible, ...variant, observation }, token);
      expect(await reply.json()).toMatchObject({ code: 'conflict', message: expect.stringContaining('branch registry differs') });
    }
    expect(await snapshot()).toBe(accepted);
    expect(await rows('SELECT facts FROM courses WHERE repository_id = ? AND id = ?', 'docs', 'create-pr')).toEqual([{ facts: '["prs"]' }]);

    const newGraph = { ...graph, legs: { ...graph.legs, review: { ...graph.legs.review, max_runs: 4 } } };
    standard('different graph', newGraph);
    expect(await sync()).toBe(1);
    const posts = posted.length;
    git(remote, 'branch', '-m', 'not-main');
    git(remote, 'tag', 'main', first);
    await expect(sync()).rejects.toThrow('cannot load course source branch main');
    expect(posted).toHaveLength(posts);
    expect(await snapshot()).toBe(accepted);

    git(remote, 'tag', '-d', 'main');
    git(remote, 'branch', '-m', 'main');
    git(home, 'commit', '--allow-empty', '-qm', 'accept new registry');
    const advancedSha = git(home, 'rev-parse', 'HEAD');
    expect(await sync()).toBe(0);
    expect(await claimRow(claim.json.claim_id)).toMatchObject({ status: 'active' });
    expect(await rows('SELECT course_source_json FROM claims WHERE id = ?', claim.json.claim_id)).toEqual([{ course_source_json: JSON.stringify({ branch: 'main', sha: first }) }]);
    const advanced = posted.at(-1)?.course_sources as { 'create-pr': { branch: string; sha: string } };
    for (const [sha, resolution, maxRuns] of [[homeSha, claim.json.course_source, graph.legs.review.max_runs], [advancedSha, advanced['create-pr'], 4]] as const) {
      const loaded = await loadCourse(home, sha, 'create-pr', sha, resolution);
      try {
        expect(loaded.graph.legs.get('review')?.maxRuns).toBe(maxRuns);
      } finally {
        dropCourse(loaded.scratch);
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
