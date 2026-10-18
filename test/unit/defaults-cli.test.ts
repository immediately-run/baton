// defaults-cli.test.ts — `baton repo sync`'s argument parser, `baton repo init`'s scaffolding
// and `close` (BATON_SPEC §2f R-BTN-74, R-BTN-83; R3-1249): the flags; the scaffold's every
// file, run through the BUILT CLI (the esbuild bundle production runs, not the source); the leg
// stubs imported from a scratch copy, as the runner loads them, and run; both ejections
// imported and called, answering what the defaults answer; and `prClose` in a real git repo.
// Node only: init writes a real tree and runs git.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubFacts, parseSyncArgs, syncWorkflow } from '../../src/defaults/cli';
import { PR_COURSE, stationsPr, type PrFact } from '../../src/defaults/course-pr';
import { prClose, verdictLine, type Exec } from '../../src/defaults/pr-close';
import { ticketsMarkdown } from '../../src/defaults/tickets-markdown';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'cli', 'baton.mjs');
const baton = (cwd: string, ...args: string[]) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BATON_HOME: cwd } });
const gitInit = (dir: string) => {
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { stdio: 'ignore' });
};
/** Commit everything in `dir`; its new HEAD. */
const commitAll = (dir: string): string => {
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'scaffold', '--allow-empty'], { stdio: 'ignore' });
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
};
const at = (dir: string) => ({ sha: execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() });
/** A fresh import of an ejected or scaffolded module (the query defeats the module cache). */
const PIN = 'immediately-run/baton@abababababababababababababababababababab';
const load = async (file: string) => import(`${pathToFileURL(file).href}?t=${Math.random()}`);

describe('parseSyncArgs', () => {
  it('defaults from the environment, takes its flags, refuses the unknown', () => {
    expect(parseSyncArgs([], { BATON_HOME: '/h', BATON_URL: 'https://b' })).toMatchObject({ root: '/h', url: 'https://b' });
    expect(parseSyncArgs([], { BATON_HOME: '/h' }).url).toBeUndefined(); // then baton.json's baton_url
    expect(parseSyncArgs(['--root', '/x', '--url', 'https://u', '--facts', '/f.json', '--token', 't1'], {})).toMatchObject({ root: '/x', url: 'https://u', factsFile: '/f.json', token: 't1' });
    expect(() => parseSyncArgs(['--nope'], {})).toThrow('not a flag of baton repo sync');
    expect(() => parseSyncArgs(['--root'], {})).toThrow('needs a value');
  });
});

describe('baton repo init, through the built CLI', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'baton-init-'));
    gitInit(root);
    baton(root, 'repo', 'init', '--pin', PIN);
    commitAll(root);
  }, 120_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes the settings with every R-BTN-51 course field, the course file, the pinned workflow and the tickets directory', () => {
    const settings = JSON.parse(readFileSync(join(root, '.baton', 'baton.json'), 'utf8'));
    expect(settings).toMatchObject({ items: 'tickets', default_course: 'pr', agent_command: 'echo' });
    expect(settings.courses).toEqual([{ id: 'pr', version: 1, min_worker_version: 1, skill: 'baton-pr', step_kinds: ['implement', 'review', 'fix', 'merge'], report_horizon_h: 6, branch_pattern: 'claude/{ticket}-*', protocol_files: [] }]);
    expect(JSON.parse(readFileSync(join(root, '.baton', 'courses', 'pr', 'course.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(PR_COURSE)));
    const workflow = readFileSync(join(root, '.github', 'workflows', 'baton-sync.yml'), 'utf8');
    expect(workflow).toBe(syncWorkflow(PIN));
    // The pinned commit is checked out and run: the CLI is not published to a registry.
    expect(workflow).toContain(`repository: immediately-run/baton\n          ref: ${'ab'.repeat(20)}\n          path: .baton-cli`);
    // §7.1: the newest main read after the number, one run at a time, off until registered,
    // and a 15-minute backstop.
    expect(workflow).toContain('- run: node .baton-cli/cli/baton.mjs repo sync --latest main');
    expect(workflow).toContain('concurrency:\n  group: baton-sync\n  cancel-in-progress: false');
    expect(workflow).toContain("if: vars.BATON_ENABLED == 'true'");
    expect(workflow).toContain("- cron: '*/15 * * * *'");
    expect(workflow).toContain('id-token: write'); // the CLI mints the run's OIDC token itself
    expect(readFileSync(join(root, 'tickets', 'README.md'), 'utf8')).toContain('One `*.md` file per ticket');
  });

  it('without --pin, pins the CLI checkout it runs from to its commit; a pin that is not owner/name@commit is refused', () => {
    const other = mkdtempSync(join(tmpdir(), 'baton-init-'));
    try {
      baton(other, 'repo', 'init');
      const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      expect(readFileSync(join(other, '.github', 'workflows', 'baton-sync.yml'), 'utf8')).toContain(`ref: ${sha}\n`);
      expect(() => syncWorkflow('latest')).toThrow('owner/name@<commit sha>');
      expect(() => syncWorkflow('immediately-run/baton@main')).toThrow('owner/name@<commit sha>');
      expect(() => syncWorkflow('immediately-run/baton@abc1234')).toThrow('all 40 hex characters'); // actions/checkout cannot fetch a short sha
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }, 120_000);

  it('each leg stub imports only Node built-ins, so a scratch copy runs as the runner loads it', async () => {
    const legs = readdirSync(join(root, '.baton', 'courses', 'pr', 'legs')).sort();
    expect(legs).toEqual(['fix.mjs', 'implement.mjs', 'merge.mjs', 'review.mjs']);
    for (const leg of legs) {
      const text = readFileSync(join(root, '.baton', 'courses', 'pr', 'legs', leg), 'utf8');
      const specifiers = [...text.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((m) => m[1]);
      expect(specifiers.every((s) => s.startsWith('node:')), `${leg}: ${specifiers.join(', ')}`).toBe(true);
    }
    // The runner copies each script alone into a scratch directory (src/runner/home.ts).
    const scratch = mkdtempSync(join(tmpdir(), 'baton-legs-'));
    try {
      copyFileSync(join(root, '.baton', 'courses', 'pr', 'legs', 'implement.mjs'), join(scratch, 'implement.mjs'));
      const stub = await load(join(scratch, 'implement.mjs'));
      expect(typeof stub.close).toBe('function');
      expect(await stub.run({ ticket: { id: 'A-1' }, checkout: root, snapshot: at(root) })).toEqual({ reached: 'pr-open', next: 'review' });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('the stubs run the agent_command baton.json names at the claim’s snapshot, arguments and all; the review returns its verdict', async () => {
    const agent = join(root, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\necho "$1 $2 $3 $4" > "$(dirname "$0")/agent.args"\necho "reviewing"\necho "$VERDICT"\n');
    chmodSync(agent, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const before = readFileSync(settingsFile, 'utf8');
    try {
      // Committed after init: the stub reads it at the snapshot, and the command may carry arguments.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: `${agent} --flag` }));
      const snapshot = { sha: commitAll(root) };
      // An uncommitted edit — a branch under review choosing its reviewer — is never read.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: 'echo approve' }));
      const file = join(root, '.baton', 'courses', 'pr', 'legs', 'review.mjs');
      process.env.VERDICT = 'changes';
      expect(await (await load(file)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      expect(readFileSync(join(root, 'agent.args'), 'utf8').trim()).toBe(`--flag A-1 review ${root}`);
      process.env.VERDICT = 'approve';
      expect(await (await load(file)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'merge', verdict: 'approve' });
      process.env.VERDICT = 'maybe';
      await expect((await load(file)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).rejects.toThrow('no verdict');
      await expect((await load(file)).run({ ticket: { id: 'A-1' }, checkout: root })).rejects.toThrow('no snapshot');
      // The fix stub queues review, the only leg leaving `fixed`.
      expect(await (await load(join(root, '.baton', 'courses', 'pr', 'legs', 'fix.mjs'))).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'fixed', next: 'review' });
    } finally {
      delete process.env.VERDICT;
      writeFileSync(settingsFile, before);
      commitAll(root);
    }
  });

  it('re-running init keeps the repository’s files and rewrites only the workflow (the pin); --force overwrites', () => {
    const settingsFile = join(root, '.baton', 'baton.json');
    const stub = join(root, '.baton', 'courses', 'pr', 'legs', 'merge.mjs');
    const settings = readFileSync(settingsFile, 'utf8');
    const stubText = readFileSync(stub, 'utf8');
    try {
      writeFileSync(settingsFile, settings.replace('"repos": {}', '"repos": { "docs": "o/docs" }'));
      writeFileSync(stub, `${stubText}\n// edited by hand\n`);
      const other = `immediately-run/baton@${'cd'.repeat(20)}`;
      expect(baton(root, 'repo', 'init', '--pin', other)).toContain('kept .baton/baton.json');
      expect(readFileSync(settingsFile, 'utf8')).toContain('"docs": "o/docs"');
      expect(readFileSync(stub, 'utf8')).toContain('// edited by hand');
      expect(readFileSync(join(root, '.github', 'workflows', 'baton-sync.yml'), 'utf8')).toContain(`ref: ${'cd'.repeat(20)}`);
      baton(root, 'repo', 'init', '--pin', other, '--force');
      expect(readFileSync(settingsFile, 'utf8')).not.toContain('o/docs');
      expect(readFileSync(stub, 'utf8')).not.toContain('// edited by hand');
    } finally {
      baton(root, 'repo', 'init', '--pin', PIN, '--force');
      commitAll(root);
    }
  }, 120_000);

  it('--eject tickets writes a standalone source that answers what the default answers, and edits take', async () => {
    baton(root, 'repo', 'init', '--eject', 'tickets');
    writeFileSync(join(root, 'tickets', 'a.md'), '---\nid: A-1\ntitle: A\norder: 2\n---\n');
    execFileSync('mkdir', ['-p', join(root, 'tickets', 'archive')]);
    // A done ticket archived in a subdirectory still closes its dependents' dependency.
    writeFileSync(join(root, 'tickets', 'archive', 'b.md'), '---\nid: B-1\nstatus: done\n---\n');
    const ctx = { root, settings: { items: 'tickets', default_course: 'pr' } };
    const files = ['README.md', 'a.md', 'archive/b.md'].map((f) => ({ path: f, text: readFileSync(join(root, 'tickets', f), 'utf8') }));
    const ejected = await load(join(root, '.baton', 'tickets.mjs'));
    const out = await ejected.default.tickets(ctx);
    expect(out).toEqual(ticketsMarkdown(files, ctx.settings));
    expect(out.closed).toEqual([{ id: 'B-1', as: 'done' }]);
    // A second eject would overwrite edits: refused without --force.
    expect(() => baton(root, 'repo', 'init', '--eject', 'tickets')).toThrow();
    baton(root, 'repo', 'init', '--eject', 'tickets', '--force');
    const text = readFileSync(join(root, '.baton', 'tickets.mjs'), 'utf8');
    expect([...text.matchAll(/^import .* from ["']([^"']+)["']/gm)].every((m) => m[1].startsWith('node:'))).toBe(true);
  }, 120_000);

  it('--eject stations writes a standalone function returning {stations, markers, course_data}, the default’s answer', async () => {
    baton(root, 'repo', 'init', '--eject', 'stations');
    const tickets = ticketsMarkdown([{ path: 'a.md', text: '---\nid: A-1\n---\n' }]).tickets;
    const facts: PrFact[] = [{ number: 1, head: 'claude/A-1-x', state: 'open', pushedAt: 1, checks: [], reviews: [] }];
    const ctx = { tickets, facts, closed: new Set<string>(), done: new Set<string>(), branchPatterns: ['claude/{ticket}-*'] };
    const ejected = await load(join(root, '.baton', 'courses', 'pr', 'sync.mjs'));
    const out = await ejected.default.stations(ctx);
    expect(out).toEqual(stationsPr(ctx));
    expect(out.stations['A-1']).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    expect(() => baton(root, 'repo', 'init', '--eject', 'nope')).toThrow();
  }, 120_000);
});

describe('prClose', () => {
  it('a non-review leg appends its marker line, commits it, and returns the commit sha', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-close-'));
    try {
      gitInit(dir);
      execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-qm', 'base'], { stdio: 'ignore' });
      execFileSync('mkdir', ['-p', join(dir, '.baton')]);
      const sha = await prClose({ checkout: dir, ticket: { id: 'A-1' }, leg: 'implement', claim: { nonce: 'n1' } }, { reached: 'pr-open' });
      expect(sha).toBe(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
      expect(readFileSync(join(dir, '.baton', 'markers.jsonl'), 'utf8')).toBe('{"ticket":"A-1","leg":"implement","reached":"pr-open","claim":"n1"}\n');
      expect(execFileSync('git', ['-C', dir, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('baton:close A-1 implement');
      expect(execFileSync('git', ['-C', dir, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('.baton/markers.jsonl');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the review writes the verdict line on the checkout branch’s PR and returns the comment’s URL; no verdict throws', async () => {
    const calls: { cmd: string; args: string[]; cwd: string }[] = [];
    const run: Exec = (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      return 'https://github.com/o/r/pull/7#issuecomment-1';
    };
    const ctx = { checkout: '/co', ticket: { id: 'A-1' }, leg: 'review', claim: { nonce: 'n2' } };
    expect(await prClose(ctx, { reached: 'reviewed', verdict: 'changes' }, run)).toBe('https://github.com/o/r/pull/7#issuecomment-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cmd: 'gh', cwd: '/co' });
    expect(calls[0].args.slice(0, 3)).toEqual(['pr', 'comment', '--body']);
    // The first line is exactly the line the station function reads (course-pr's VERDICT).
    expect(calls[0].args[3].split('\n')[0]).toBe(verdictLine('changes'));
    await expect(prClose(ctx, { reached: 'reviewed' }, run)).rejects.toThrow('no verdict');
  });
});

describe('githubFacts (R-BTN-96’s GitHub adapter) against a recorded GitHub', () => {
  let dir: string;
  const calls: string[] = [];
  /** A fake api.github.com: `routes` maps a path (without host or per_page) to its JSON, and a
   * `[json, next]` pair answers with a Link to the next page. */
  const serve = (routes: Record<string, unknown>) => vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    u.searchParams.delete('per_page');
    const key = `${u.pathname}${u.search}`;
    calls.push(key);
    if (!(key in routes)) return new Response('{}', { status: 404 });
    const r = routes[key];
    const [body, next] = Array.isArray(r) && r.length === 2 && typeof r[1] === 'string' && r[1].startsWith('/') ? r as [unknown, string] : [r, null];
    return new Response(JSON.stringify(body), { headers: next ? { link: `<https://api.github.com${next}>; rel="next"` } : {} });
  });
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'baton-facts-'));
    gitInit(dir);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git']);
    process.env.GITHUB_TOKEN = 't';
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GITHUB_TOKEN;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
  });
  const pr = (number: number, head: string, state: string, merged = false) => ({ number, head: { ref: head, sha: `s${number}` }, state, merged_at: merged ? '2026-10-01T00:00:00Z' : null });
  const who = (author_association: string, body: string, at: string) => ({ user: { login: 'x' }, author_association, body, created_at: at, submitted_at: at, state: 'COMMENTED' });

  it('pages the PR list, reads detail only for PRs a live ticket owns, and keeps verdicts from people with a say', async () => {
    serve({
      '/repos/o/r/pulls?state=all': [[pr(1, 'claude/A-1-x', 'open'), pr(2, 'claude/Z-9-old', 'closed', true)], '/repos/o/r/pulls?state=all&page=2'],
      '/repos/o/r/pulls?state=all&page=2': [pr(3, 'claude/A-1-y', 'closed')],
      '/repos/o/r/commits/s1/check-runs': { check_runs: [{ conclusion: 'success' }, { conclusion: null }] },
      '/repos/o/r/pulls/1/commits': [{ commit: { committer: { date: '2026-10-02T00:00:00Z' } } }, { commit: { committer: { date: '2026-10-03T00:00:00Z' } } }],
      '/repos/o/r/pulls/1/reviews': [],
      '/repos/o/r/issues/1/comments': [who('NONE', '<!-- baton:verdict approve -->', '2026-10-04T00:00:00Z'), who('MEMBER', '<!-- baton:verdict changes -->', '2026-10-05T00:00:00Z')],
    });
    const facts = await githubFacts(dir, () => {}, (p) => p.head.startsWith('claude/A-1-'));
    expect(facts.map((f) => [f.number, f.state])).toEqual([[1, 'open'], [2, 'merged'], [3, 'closed']]);
    // The owned open PR: its checks, every commit's date, and the member's verdict alone.
    expect(facts[0]).toMatchObject({ checks: ['success', null], pushes: [Date.parse('2026-10-02T00:00:00Z'), Date.parse('2026-10-03T00:00:00Z')], pushedAt: Date.parse('2026-10-03T00:00:00Z') });
    expect(facts[0].reviews.map((r) => r.body)).toEqual(['<!-- baton:verdict changes -->']);
    // The unowned merged PR and the closed one cost no request beyond the list.
    expect(calls.filter((c) => /\/(2|3|s2|s3)\//.test(c))).toEqual([]);
    expect(calls).toHaveLength(6);
  });

  it('refuses before the request budget is spent, rather than truncate or starve the next runs', async () => {
    const many = Array.from({ length: 60 }, (_, i) => pr(i + 1, `claude/A-${i + 1}-x`, 'open'));
    const routes: Record<string, unknown> = { '/repos/o/r/pulls?state=all': many };
    for (const p of many) {
      routes[`/repos/o/r/commits/s${p.number}/check-runs`] = { check_runs: [] };
      routes[`/repos/o/r/pulls/${p.number}/commits`] = [];
      routes[`/repos/o/r/pulls/${p.number}/reviews`] = [];
      routes[`/repos/o/r/issues/${p.number}/comments`] = [];
    }
    serve(routes);
    await expect(githubFacts(dir, () => {}, () => true)).rejects.toThrow('more than 200 requests');
  });
});
