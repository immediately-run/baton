// S-BTN-189 the ticket commands (BATON_SPEC §15 S-BTN-189, §2f R-BTN-74; B-112): the ticket
// commands as an operator runs them — `node cli/baton.mjs tickets …`, the CLI's own entry, which
// bundles src/defaults/tickets.ts as it bundles `repo sync`. Must hold: each command is one commit
// pushed straight to the bare origin's default branch, the caller's branch and tree untouched; a
// new ticket takes the next free id under the configured prefix with the skeleton body, and its
// dependency's `**Used by:**` line names it; a filing the check would refuse lands nothing; and
// the generated "How tickets work" page is written by `baton repo init`, reported by
// `baton tickets check` once edited, and written again by `init --force`. The exhaustive cases —
// every refusal, the retry, the settings — are test/unit/tickets.test.ts's. Node only: it writes a
// real repository and runs git and the CLI.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initMain } from '../../src/defaults/cli';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';

const ROOT = resolve(import.meta.dirname, '..', '..');
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

class Repo {
  readonly dir = tmp('baton-s189-');
  readonly bare = tmp('baton-s189-origin-');
  constructor() {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.bare], { stdio: 'ignore' });
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's189@test'], ['config', 'user.name', 's189'], ['remote', 'add', 'origin', this.bare]]) {
      execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
    }
  }
  /** `.baton/baton.json` and a project page, committed and pushed to the origin's main. */
  publish(settings: Record<string, unknown> = {}): void {
    mkdirSync(join(this.dir, '.baton'), { recursive: true });
    mkdirSync(join(this.dir, 'tickets', 'projects'), { recursive: true });
    writeFileSync(join(this.dir, '.baton', 'baton.json'), `${JSON.stringify({ baton_url: 'https://baton.immediately.run', items: 'tickets', default_course: 'create-pr', repos: {}, agent_command: 'echo', ticket_prefix: 'B', legacy_ids: ['R3-\\d+'], project: 'baton', ...settings }, null, 2)}\n`);
    writeFileSync(join(this.dir, 'tickets', 'projects', 'baton.mdx'), '---\ntitle: baton\nid: baton\nstatus: active\nkind: project\ntags:\n  - project\ndescription: the project\n---\n\nProse.\n');
    git(this.dir, 'add', '-A');
    git(this.dir, 'commit', '-qm', 'scaffold');
    git(this.dir, 'push', '-q', 'origin', 'HEAD:main');
  }
  /** `baton tickets …` as an operator runs it: the CLI's entry, the checkout as its home. */
  tickets(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
    const out = spawnSync(process.execPath, [CLI, 'tickets', ...argv], { cwd: this.dir, encoding: 'utf8', env: { ...process.env, BATON_HOME: this.dir } });
    return out;
  }
  at(file: string): string | null {
    try {
      return execFileSync('git', ['-C', this.bare, 'show', `main:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  }
}

describe('S-BTN-189 the ticket commands', () => {
  it('new, claim, set and done: one commit each on the origin’s main, the caller’s tree untouched', () => {
    const repo = new Repo();
    repo.publish();
    git(repo.dir, 'checkout', '-q', '-b', 'my-work');
    writeFileSync(join(repo.dir, 'draft.txt'), 'uncommitted\n');
    const head = git(repo.dir, 'rev-parse', 'HEAD');

    // A request-style filing: the flag's dependency, tags and project, and the skeleton.
    const first = repo.tickets('new', '--title', 'First', '--tags', 'EXPEDITE');
    expect(first).toMatchObject({ status: 0, stderr: '' });
    expect(first.stdout).toBe('✓ tickets: file B-1 — First\n');
    const second = repo.tickets('new', '--title', 'Second', '--depends-on', 'B-1', '--project', 'baton');
    expect(second.stdout).toBe('✓ tickets: file B-2 — Second\n');

    // One commit per command, the files of that command alone, and B-1's reverse mention.
    const log = git(repo.bare, 'log', '--format=%s', 'main').split('\n');
    expect(log.slice(0, 3)).toEqual(['tickets: file B-2 — Second', 'tickets: file B-1 — First', 'scaffold']);
    expect(parseFrontmatter(repo.at('tickets/B-1.mdx')!)).toMatchObject({ id: 'B-1', project: 'baton', status: 'available', tags: ['EXPEDITE'] });
    expect(repo.at('tickets/B-1.mdx')).toContain('**Depends on:** none.');
    expect(repo.at('tickets/B-1.mdx')).toContain('**Used by:** B-2.');
    const two = repo.at('tickets/B-2.mdx')!;
    expect(parseFrontmatter(two)).toMatchObject({ id: 'B-2', project: 'baton', tags: ['roadmap-item'], depends_on: ['B-1'] });
    expect(two).toContain('**Depends on:** B-1.');
    for (const line of ['**Brief:** Second', '**Spec:**', '### What to build', '### Tests', '### Exit criteria', '## Status']) expect(two, line).toContain(line);

    // The caller's branch, HEAD and tree are as they were.
    expect(git(repo.dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(repo.dir, 'symbolic-ref', '--short', 'HEAD')).toBe('my-work');
    expect(readFileSync(join(repo.dir, 'draft.txt'), 'utf8')).toBe('uncommitted\n');

    // The rest of a session: claim, a PR, done (archived).
    expect(repo.tickets('claim', 'B-1').stdout).toMatch(/^✓ tickets: claim B-1 \(in progress\) — pushed as /);
    expect(parseFrontmatter(repo.at('tickets/B-1.mdx') as string)?.status).toBe('in-progress');
    const url = 'https://github.com/immediately-run/baton/pull/7';
    expect(repo.tickets('set', 'B-1', 'in-review', '--pr', url).status).toBe(0);
    expect(parseFrontmatter(repo.at('tickets/B-1.mdx') as string)?.status).toBe('in-review');
    expect(repo.at('tickets/B-1.mdx')).toContain(`prs:\n  - ${url}`);
    expect(repo.tickets('done', 'B-1', '--pr', url).status).toBe(0);
    expect(repo.at('tickets/B-1.mdx')).toBeNull();
    expect(parseFrontmatter(repo.at('tickets/archive/B-1.mdx')!)).toMatchObject({ id: 'B-1', status: 'done' });

    // A filing the check would refuse lands nothing: B-3 waiting on nothing, but `--body-file`
    // says otherwise.
    const body = join(repo.dir, 'body.md');
    writeFileSync(body, '**Brief:** a third\n\n**Depends on:** B-2.\n');
    const before = git(repo.bare, 'rev-parse', 'main');
    const refused = repo.tickets('new', '--title', 'Third', '--body-file', body);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('**Depends on:** names B-2, which --depends-on does not');
    expect(git(repo.bare, 'rev-parse', 'main')).toBe(before);
    expect(repo.at('tickets/B-3.mdx')).toBeNull();
  }, 120_000);

  it('repo init writes the page, check reports an edited copy, and init --force writes it again', async () => {
    const repo = new Repo();
    const said: string[] = [];
    await initMain(['--course', 'create-pr'], { root: repo.dir, log: (l) => said.push(l) });
    expect(said).toContain('baton: tickets/HOW-TICKETS-WORK.md — how tickets work in this repository, generated');
    const page = join(repo.dir, 'tickets', 'HOW-TICKETS-WORK.md');
    const want = readFileSync(page, 'utf8');
    expect(want).toContain('# How tickets work');
    // The check passes on the repository as init left it, and on this repository's own tickets.
    expect(repo.tickets('check', '--repo', repo.dir).status).toBe(0);
    // An edited copy is one finding, exit 1.
    writeFileSync(page, want.replace('baton tickets claim <id>', 'claim by hand'));
    const edited = repo.tickets('check', '--repo', repo.dir);
    expect(edited.status).toBe(1);
    expect(edited.stdout).toContain('tickets/HOW-TICKETS-WORK.md: differs from the "How tickets work" page this release generates');
    // `init --force` writes it again, and the check passes.
    await initMain(['--course', 'create-pr', '--force'], { root: repo.dir, log: () => {} });
    expect(readFileSync(page, 'utf8')).toBe(want);
    expect(repo.tickets('check', '--repo', repo.dir).status).toBe(0);
  }, 120_000);

  it('this repository’s tickets pass the check, its page among them', () => {
    const out = spawnSync(process.execPath, [CLI, 'tickets', 'check', '--repo', ROOT], { encoding: 'utf8', cwd: ROOT });
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/^baton tickets check: \d+ ticket\(s\), ✓ no findings\n$/);
  }, 60_000);
});
