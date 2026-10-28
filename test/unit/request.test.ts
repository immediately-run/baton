// request.test.ts — `baton request "<one sentence>" --course <course>` and its parts (B-98,
// BATON_SPEC §5.8 R-BTN-131, §2f R-BTN-74): a course whose product is tickets or specs is started
// by ONE request ticket, filed by this command instead of written by hand. What must hold: the
// file it writes is the markdown source's ticket — id, course, the sentence as title and
// description, `available`, `tags: [request]` — on the course at its start with the start leg
// ready; the next free id skips archived ones; it is one commit, pushed straight to the default
// branch (the checkout's `origin/HEAD`, else `main`, else `--branch`), made in a throwaway
// worktree so the caller's branch, HEAD and working tree are untouched, and retried when another
// developer's push moves the head first; and it refuses a course not `starts_from: request`, a
// course the checkout's `.baton/baton.json` does not list, an empty sentence and no
// `.baton/baton.json`. After filing, `baton tickets check` finds nothing in the fixture. Node
// only: it writes real repositories and runs git.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTickets } from '../../src/defaults/tickets-check';
import { defaultBranch, fileRequest, nextId, readRequestPlan, requestFile, requestMain, requestMessage } from '../../src/defaults/request';
import { CREATE_SPEC_COURSE, stationsSpec } from '../../src/defaults/course-pr';
import { BUILD_APP_COURSE } from '../../src/defaults/courses';
import { parseFrontmatter, ticketsMarkdown } from '../../src/defaults/tickets-markdown';
import { readItems } from '../../src/defaults/read-items';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const CLI = join(ROOT, 'cli', 'baton.mjs');
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const tmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const git = (dir: string, ...a: string[]): string => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commitAll = (dir: string, message = 'fixture'): void => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', message, '--allow-empty');
};

/** A course file as `baton repo init` writes it, over one of the standard graphs. */
const GRAPH: Record<string, Record<string, unknown>> = {
  'create-spec': CREATE_SPEC_COURSE as unknown as Record<string, unknown>,
  'build-app': BUILD_APP_COURSE as unknown as Record<string, unknown>,
  'create-pr': { start: 'filed', start_leg: 'implement', end: ['merged'], stations: { filed: { label: 'Filed' }, merged: { label: 'Merged' } },
    legs: { implement: { from: ['filed'], to: 'merged', label: 'Implement' } } },
};

/** A fixture repository the CLI's request files into: `main` with `.baton/` (the settings and the
 *  named courses' files), a `tickets/` with `existing` (`path → text`), and a bare `origin` whose
 *  `origin/HEAD` points at `branch` when one is named. `remote` false leaves the checkout without
 *  one, for the refusals. */
function repo(opts: { courses?: Record<string, Record<string, unknown>>; listed?: string[]; items?: string; existing?: Record<string, string>; branch?: string; remote?: boolean; settings?: boolean } = {}): string {
  const dir = tmp('baton-b98-');
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'b98@test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'b98 test'], { stdio: 'ignore' });
  const listed = opts.listed ?? Object.keys(opts.courses ?? { 'create-spec': CREATE_SPEC_COURSE });
  if (opts.settings !== false) {
    mkdirSync(join(dir, '.baton'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'baton.json'), `${JSON.stringify({ items: opts.items ?? 'tickets', default_course: 'create-pr', repos: {}, courses: listed.map((id) => ({ id, version: 1 })) }, null, 2)}\n`);
  }
  for (const [id, graph] of Object.entries(opts.courses ?? { 'create-spec': CREATE_SPEC_COURSE })) {
    mkdirSync(join(dir, '.baton', 'courses', id), { recursive: true });
    writeFileSync(join(dir, '.baton', 'courses', id, 'course.json'), `${JSON.stringify(graph, null, 2)}\n`);
  }
  for (const [path, text] of Object.entries(opts.existing ?? {})) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  commitAll(dir);
  if (opts.remote !== false) {
    const bare = tmp('baton-b98-origin-');
    rmSync(bare, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', '--bare', dir, bare], { stdio: 'ignore' });
    git(dir, 'remote', 'add', 'origin', bare);
    execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'HEAD:main'], { stdio: 'ignore' });
    if (opts.branch) {
      // The remote's HEAD announces `branch`: `origin/HEAD` is what the command resolves.
      const other = opts.branch;
      execFileSync('git', ['-C', bare, 'branch', '-f', other, 'main'], { stdio: 'ignore' });
      execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', `refs/heads/${other}`], { stdio: 'ignore' });
      git(dir, 'fetch', '-q', 'origin');
      git(dir, 'remote', 'set-head', 'origin', other);
    }
  }
  return dir;
}

/** The bare origin a fixture's checkout pushes to. */
const originOf = (dir: string): string => git(dir, 'remote', 'get-url', 'origin');
/** The default branch's file, as the origin has it: the ticket the request pushed. */
const atOrigin = (dir: string, file: string, branch = 'main'): string | null => {
  try {
    return execFileSync('git', ['-C', originOf(dir), 'show', `${branch}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};
const originHead = (dir: string, branch = 'main'): { sha: string; parent: string } => ({
  sha: execFileSync('git', ['-C', originOf(dir), 'rev-parse', branch], { encoding: 'utf8' }).trim(),
  parent: execFileSync('git', ['-C', originOf(dir), 'rev-parse', `${branch}^1`], { encoding: 'utf8' }).trim(),
});

/** `requestMain` with its output captured: the lines it logged, the notices it warned, and the
 *  exit code — or the refusal it threw. */
function request(dir: string, argv: string[], io: { date?: string } = {}): { code: number | null; out: string[]; err: string[]; threw?: string } {
  const out: string[] = [];
  const err: string[] = [];
  try {
    const code = requestMain(argv, { root: dir, ...(io.date ? { date: io.date } : {}), log: (l) => out.push(l), warn: (l) => err.push(l) });
    return { code, out, err };
  } catch (e) {
    return { code: null, out, err, threw: (e as Error).message };
  }
}

const SENTENCE = 'Decide the export format, so two implementations agree';

describe('baton request: the ticket it files (B-98)', () => {
  it('the file is the markdown source’s ticket: id, course, the sentence, available, tags [request], and it reads at the course’s start', () => {
    const dir = repo();
    const r = request(dir, ['--course', 'create-spec', SENTENCE, '--repo', dir]);
    expect(r.threw).toBeUndefined();
    expect(r.code).toBe(0);
    const text = atOrigin(dir, 'tickets/B-1.mdx')!;
    expect(text).not.toBeNull();
    const fm = parseFrontmatter(text)!;
    expect(fm).toMatchObject({ id: 'B-1', course: 'create-spec', status: 'available', tags: ['request'], title: `B-1 — ${SENTENCE}`, description: SENTENCE });
    // The body names the course and the command; it is no **Depends on:** line and cites no id.
    expect(text).toContain('`baton request`');
    expect(text).toContain('`create-spec`');
    expect(text.slice(text.indexOf('\n---\n') + 5).trim()).toMatch(/^[^]*A request on the `create-spec` course, filed with `baton request`\./);
    // The caller's own tree never got it: the commit is on the branch, not in this worktree.
    expect(readItems(dir, 'tickets')).toEqual([]);
    // The fetched default branch holds it — what the sync posts.
    const tree = tmp('baton-b98-tree-');
    execFileSync('git', ['-C', originOf(dir), 'archive', '--format=tar', 'main', '-o', join(tree, 'a.tar')], { stdio: 'ignore' });
    execFileSync('tar', ['-xf', join(tree, 'a.tar'), '-C', tree], { stdio: 'ignore' });
    const synced = ticketsMarkdown(readItems(tree, 'tickets'));
    expect(synced.tickets.map((t) => ({ id: t.id, course_id: t.course_id, title: t.title, path: t.path, display: t.display }))).toEqual([
      { id: 'B-1', course_id: 'create-spec', title: `B-1 — ${SENTENCE}`, path: 'tickets/B-1.mdx', display: { status: 'available' } },
    ]);
    // At its course's start station, its start leg ready — the next claim starts `converse`.
    const placed = stationsSpec({ tickets: synced.tickets, facts: [], closed: new Set(), done: new Set(), branchPatterns: ['claude/{ticket}-*'], repository: null,
      graph: { legs: CREATE_SPEC_COURSE.legs } }).stations['B-1'];
    expect(placed).toMatchObject({ station: 'requested', path: [], next_leg: 'converse', next: [{ leg: 'converse', state: 'ready', waiting_on: null }] });
    // The command's one line: the id and the course's first station.
    expect(r.out).toEqual(['baton request: filed B-1 (course create-spec) — the next claim starts converse at requested']);
  });

  it('a build-app request reads at `requested` with `define` ready too', () => {
    const dir = repo({ courses: { 'build-app': BUILD_APP_COURSE }, listed: ['build-app'] });
    const r = request(dir, ['--course', 'build-app', 'Build an online version of Blokus']);
    expect(r.out).toEqual(['baton request: filed B-1 (course build-app) — the next claim starts define at requested']);
    // build-app is a marker course: its station function reads the course file and no markers.
    const text = atOrigin(dir, 'tickets/B-1.mdx')!;
    expect(parseFrontmatter(text)).toMatchObject({ course: 'build-app', status: 'available' });
  });

  it('the sentence is quoted safely: a colon-and-space and a hash survive as the title and description', () => {
    const dir = repo();
    const sentence = 'Export: what a file must hold #2, so two implementations agree';
    expect(request(dir, ['--course', 'create-spec', sentence]).code).toBe(0);
    const text = atOrigin(dir, 'tickets/B-1.mdx')!;
    const read = ticketsMarkdown([{ path: 'B-1.mdx', text }]).tickets[0];
    expect(read.title).toBe(`B-1 — ${sentence}`);
    expect(parseFrontmatter(text)!.description).toBe(sentence);
    // A sentence with no quote of its own is written bare — no JSON backslashes — because the
    // source splits a field on its FIRST `: ` and reads a `#` on the line as text (1-A-4).
    expect(text).toContain(`title: B-1 — ${sentence}`);
  });

  it('the tier rides when given, and not otherwise', () => {
    const dir = repo();
    expect(request(dir, ['--course', 'create-spec', SENTENCE, '--tier', 'routine']).code).toBe(0);
    const dir2 = repo();
    expect(request(dir2, ['--course', 'create-spec', SENTENCE]).code).toBe(0);
    expect(parseFrontmatter(atOrigin(dir, 'tickets/B-1.mdx')!)!).toMatchObject({ tier: 'routine' });
    expect(parseFrontmatter(atOrigin(dir2, 'tickets/B-1.mdx')!)!).not.toHaveProperty('tier');
  });

  it('every key the request writes is one the item schema admits, and the ticket-shaped ones are there', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'tickets', 'item.schema.json'), 'utf8')) as { required: string[]; propertyNames: { enum: string[] } };
    const fm = parseFrontmatter(requestFile('B-9', 'create-spec', SENTENCE, 'routine', '2026-10-28'))!;
    // The ticket's own required keys are Baton's wiki's, not every repository's: a request
    // carries what the markdown source reads (id, title, description, status, course, tags).
    for (const key of ['title', 'id', 'status', 'description', 'course']) expect(Object.keys(fm), key).toContain(key);
    for (const key of Object.keys(fm)) expect(schema.propertyNames.enum, key).toContain(key);
    expect(fm.updated).toBe('2026-10-28');
  });
});

describe('baton request: what it refuses (B-98)', () => {
  it('a course not starts_from: request — an ordinary course keeps its hand-filed tickets', () => {
    const dir = repo({ courses: { 'create-pr': GRAPH['create-pr'] }, listed: ['create-pr'] });
    const r = request(dir, ['--course', 'create-pr', SENTENCE]);
    expect(r.code).toBeNull();
    expect(r.threw).toMatch(/^origin\/main: course create-pr does not start from a request — its course\.json carries no starts_from: request\./);
    // Nothing was pushed: the origin's head is the fixture's.
    expect(git(originOf(dir), 'rev-parse', 'main')).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(atOrigin(dir, 'tickets/B-1.mdx')).toBeNull();
  });

  it('a course .baton/baton.json does not list', () => {
    const dir = repo({ courses: { 'create-spec': CREATE_SPEC_COURSE }, listed: ['create-pr'] });
    const r = request(dir, ['--course', 'create-spec', SENTENCE]);
    expect(r.threw).toBe('origin/main: course create-spec is not one .baton/baton.json lists (create-pr) — add it to `courses` with `baton repo init --course create-spec`');
  });

  it('an empty sentence, no --course, and no .baton/baton.json', () => {
    const dir = repo();
    expect(request(dir, ['--course', 'create-spec', '   ']).threw).toBe('the request is one sentence, in quotes: baton request "<what to do>" --course <id>');
    expect(request(dir, [SENTENCE]).threw).toBe('--course is required: the course the request starts (a course whose course.json says starts_from: request)');
    const bare = repo({ settings: false });
    expect(request(bare, ['--course', 'create-spec', SENTENCE]).threw).toMatch(/^origin\/main has no \.baton\/baton\.json — `baton request` files a ticket into a repository the sync reads/);
  });

  it('a directory that is no checkout, and a flag it does not take', () => {
    const dir = repo();
    const plain = tmp('baton-b98-plain-');
    expect(request(plain, ['--course', 'create-spec', SENTENCE]).threw).toMatch(/is not a git checkout/);
    expect(request(dir, ['--course', 'create-spec', SENTENCE, '--bogus', 'x']).threw).toBe('--bogus: not a flag of baton request');
  });
});

describe('baton request: the id, the branch and the push (B-98)', () => {
  it('the next free id skips the live and the archived ones', () => {
    const existing = { 'tickets/B-1.mdx': '---\ntitle: "B-1 — x"\nid: B-1\nstatus: available\ntags: [request]\ntopics: [baton]\nowns: {}\nprs: []\ndepends_on: []\n---\n', 'tickets/archive/B-7.mdx': '---\ntitle: "B-7 — y"\nid: B-7\nstatus: done\ntags: [request]\ntopics: [baton]\nowns: {}\nprs: []\ndepends_on: []\n---\n' };
    const dir = repo({ existing });
    expect(nextId(dir, 'tickets')).toBe('B-8');
    expect(requestMain(['--course', 'create-spec', SENTENCE], { root: dir, log: () => {}, warn: () => {} })).toBe(0);
    expect(atOrigin(dir, 'tickets/B-8.mdx')).not.toBeNull();
    // A custom `items` folder is where it files, and the archive under it is scanned there.
    const elsewhere = repo({ items: 'work', existing: { 'work/archive/B-3.mdx': '---\nid: B-3\nstatus: done\n---\n' } });
    expect(request(elsewhere, ['--course', 'create-spec', SENTENCE]).code).toBe(0);
    expect(atOrigin(elsewhere, 'work/B-4.mdx')).not.toBeNull();
    expect(atOrigin(elsewhere, 'tickets/B-4.mdx')).toBeNull();
  });

  it('one commit, pushed straight to the origin’s default branch, and the caller’s branch, HEAD and tree untouched', () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'my-work');
    writeFileSync(join(dir, 'draft.txt'), 'uncommitted\n');
    const head = git(dir, 'rev-parse', 'HEAD');
    const branch = git(dir, 'symbolic-ref', '--short', 'HEAD');
    expect(request(dir, ['--course', 'create-spec', SENTENCE]).code).toBe(0);
    const { sha, parent } = originHead(dir);
    expect(parent).toBe(head);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(dir, 'symbolic-ref', '--short', 'HEAD')).toBe(branch);
    expect(readFileSync(join(dir, 'draft.txt'), 'utf8')).toBe('uncommitted\n');
    expect(git(dir, 'status', '--porcelain')).toBe('?? draft.txt');
    // The commit is the one file and its subject, and nothing else of the fixture's tree moved.
    expect(git(originOf(dir), 'show', '--name-only', '--format=%s', sha).split('\n')).toEqual([requestMessage('B-1', 'create-spec', SENTENCE), '', 'tickets/B-1.mdx']);
    expect(git(originOf(dir), 'rev-parse', 'main^')).toBe(head);
    // The caller's worktree is not left behind by the throwaway one.
    expect(git(dir, 'worktree', 'list').split('\n').length).toBe(1);
  });

  it('resolves the default branch from origin/HEAD, else main, and --branch wins over both', () => {
    const dir = repo();
    expect(defaultBranch(dir)).toBe('main');
    const onTrunk = repo({ branch: 'trunk' });
    expect(defaultBranch(onTrunk)).toBe('trunk');
    expect(defaultBranch(onTrunk, 'release')).toBe('release');
    expect(request(onTrunk, ['--course', 'create-spec', SENTENCE]).code).toBe(0);
    expect(atOrigin(onTrunk, 'tickets/B-1.mdx', 'trunk')).not.toBeNull();
    expect(atOrigin(onTrunk, 'tickets/B-1.mdx', 'main')).toBeNull();
    // --branch names the branch it pushes to; here one the remote already has, else `fetch` of it has nothing to add.
    const absent = repo();
    execFileSync('git', ['-C', originOf(absent), 'branch', 'release', 'main'], { stdio: 'ignore' });
    expect(request(absent, ['--course', 'create-spec', SENTENCE, '--branch', 'release']).code).toBe(0);
    expect(atOrigin(absent, 'tickets/B-1.mdx', 'release')).not.toBeNull();
    expect(atOrigin(absent, 'tickets/B-1.mdx', 'main')).toBeNull();
  });

  it('a push refused because the branch moved is refetched, re-scanned and retried — up to six tries', () => {
    // The loop a request shares with scripts/ticket.mjs's `new`: refetch, take the next free id at
    // the new head, commit and push again. A `git` on PATH turns the first push away as a moved
    // head would, and a peer's request lands on the branch before the retry, so the retry must take
    // the next id after theirs, on their commit.
    const dir = repo();
    const peer = mkdtempSync(join(tmpdir(), 'baton-b98-peer-'));
    rmSync(peer, { recursive: true, force: true });
    dirs.push(peer);
    execFileSync('git', ['clone', '-q', originOf(dir), peer], { stdio: 'ignore' });
    execFileSync('git', ['-C', peer, 'config', 'user.email', 'peer@test'], { stdio: 'ignore' });
    execFileSync('git', ['-C', peer, 'config', 'user.name', 'peer'], { stdio: 'ignore' });
    mkdirSync(join(peer, 'tickets'), { recursive: true });
    for (const id of ['B-8', 'B-9']) writeFileSync(join(peer, 'tickets', `${id}.mdx`), `---\nid: ${id}\ntitle: ${id}\n---\n`);
    commitAll(peer, 'a peer’s requests');
    execFileSync('git', ['-C', peer, 'push', '-q', 'origin', 'main'], { stdio: 'ignore' });

    const bin = mkdtempSync(join(tmpdir(), 'baton-b98-git-'));
    dirs.push(bin);
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    // No backticks and no commas in the shell body: the plan's own tests pin every line.
    const flag = JSON.stringify(join(bin, 'refused'));
    const reject = ' ! [rejected]        HEAD -> main (non-fast-forward)';
    // `git` runs as `-C <dir> push …` here, so the shim scans its words, never `$1`. The shim is one
    // template with no arithmetic: a plan's own tests pin every line.
    const shim = [
      '#!/bin/sh',
      'n=0',
      'for a in "$@"; do if [ "$a" = "push" ]; then n=1; fi; done',
      `if [ "$n" = "1" ] && [ ! -e ${flag} ]; then`,
      `  touch ${flag}`,
      `  ${JSON.stringify(realGit)} -C ${JSON.stringify(peer)} push -q ${JSON.stringify(originOf(dir))} HEAD:main`,
      `  echo "${reject}" 1>&2`,
      '  echo "error: failed to push some refs" >&2',
      '  exit 1',
      'fi',
      `exec ${JSON.stringify(realGit)} "$@"`,
      '',
    ].join('\n');
    writeFileSync(join(bin, 'git'), shim, { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    const warns: string[] = [];
    let filed: { id: string } | null = null;
    let threw: string | null = null;
    try {
      git(dir, 'fetch', '-q', 'origin');
      filed = fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE), { warn: (l) => warns.push(l) });
    } catch (e) {
      threw = (e as Error).message;
    } finally {
      process.env.PATH = path;
    }
    expect(threw).toBeNull();
    // The retry took B-10: B-1 to B-7 in the fixture (one archived), B-8 and B-9 the peer's.
    expect(filed!.id).toBe('B-10');
    expect(warns).toEqual(['baton request: origin/main moved; retrying on the new head (1/6)']);
    // And it landed on the peer's commit, which the first try never saw.
    const log = git(originOf(dir), 'log', '--format=%s', 'main').split('\n');
    expect(log.slice(0, 3)).toEqual([requestMessage('B-10', 'create-spec', SENTENCE), 'a peer’s requests', 'fixture']);
  });

  it('a repository with no remote is the CLI’s one line and exit 2, not a stack trace', () => {
    const dir = repo({ remote: false });
    const out = spawnSync(process.execPath, [CLI, 'request', '--course', 'create-spec', SENTENCE], { cwd: dir, encoding: 'utf8', env: { ...process.env, BATON_HOME: dir } });
    expect(out.status).toBe(2);
    expect(out.stderr.split('\n')[0]).toMatch(/^baton: git in .*: fatal: 'origin' does not appear to be a git repository; fatal: Could not read from remote repository\.$/);
    // And through the CLI's own path a refusal is the same one line and exit 2.
    const refused = spawnSync(process.execPath, [CLI, 'request', '--course', 'create-pr', SENTENCE], { cwd: repo({ courses: { 'create-pr': GRAPH['create-pr'] } }), encoding: 'utf8' });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/^baton: origin\/main: course create-pr does not start from a request — its course\.json carries no starts_from: request\./);
    // And the CLI's happy path: the line, exit 0.
    const ok = spawnSync(process.execPath, [CLI, 'request', '--course', 'create-spec', SENTENCE], { cwd: repo(), encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe('baton request: filed B-1 (course create-spec) — the next claim starts converse at requested\n');
  }, 60_000);
});

describe('baton request: afterwards, the repository still checks (B-98)', () => {
  it('baton tickets check finds nothing in the fixture after a request', async () => {
    const dir = repo({ existing: { 'tickets/B-1.mdx': '---\ntitle: "B-1 — an earlier ticket"\nid: B-1\nstatus: done\ntags: [request]\ntopics: [baton]\nowns: {}\nprs: []\ndepends_on: []\n---\n' } });
    expect(request(dir, ['--course', 'create-spec', SENTENCE]).code).toBe(0);
    // The checkout levels with the branch it pushed to, as the next sync's does.
    git(dir, 'fetch', '-q', 'origin');
    git(dir, 'reset', '-q', '--hard', 'origin/main');
    expect(await checkTickets(dir)).toEqual({ findings: [], counts: { tickets: 1, closed: 1 } });
    // Through the CLI too, on the checkout: exit 0, no findings.
    const out = spawnSync(process.execPath, [CLI, 'tickets', 'check', '--repo', dir], { encoding: 'utf8', cwd: ROOT });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('baton tickets check: 1 ticket(s), ✓ no findings\n');
  }, 60_000);
});
