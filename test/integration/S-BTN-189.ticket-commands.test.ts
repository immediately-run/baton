// S-BTN-189 the ticket commands (BATON_SPEC §15 S-BTN-189, §4.2 R-BTN-74; B-112, B-326): the
// ticket commands as an operator runs them — `node cli/baton.mjs tickets …`, the CLI's own entry.
// Must hold: ticket files are Dibber's to write — `new`, `claim`, `set` and `done` are refused,
// each naming its `dibber` command, and nothing lands; `check <id> --claimable` writes nothing and
// refuses a ticket citing a rule amended since it answered for it until a rules re-read note —
// the line `dibber set <id> --note "rules re-read: …"` writes — names it; and `baton repo init`
// writes the generated "How tickets work" page and `.dibber/config.json`, Baton its coordinator.
// The exhaustive cases are test/unit/tickets-commands.test.ts's. Node only: it writes a real
// repository and runs git and the CLI.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initMain } from '../../src/defaults/cli';

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
  /** `baton tickets …` as an operator runs it: the CLI's entry, the checkout as its home. The
   *  harness's own Baton variables are scrubbed — a test's command reads the stand-in Baton its
   *  test names, or none, never the instance this suite happens to run under. */
  tickets(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
    const { BATON_KEY_FILE: _k, BATON_URL: _u, BATON_HOME: _h, ...env } = process.env;
    const out = spawnSync(process.execPath, [CLI, 'tickets', ...argv], { cwd: this.dir, encoding: 'utf8', env: { ...env, BATON_HOME: this.dir } });
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
  it('new, claim, set and done are refused naming their dibber commands; nothing lands', () => {
    const repo = new Repo();
    repo.publish();
    const before = git(repo.bare, 'rev-parse', 'main');
    for (const [verb, argv] of [['new', ['--title', 'First']], ['claim', ['B-1']], ['set', ['B-1', 'in-review']], ['done', ['B-1']]] as const) {
      const r = repo.tickets(verb, ...argv);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(new RegExp(`^baton: baton tickets ${verb} is retired — ticket files are Dibber's to write \\(B-326\\): .*dibber `));
    }
    expect(git(repo.bare, 'rev-parse', 'main')).toBe(before);
  }, 60_000);

  it('repo init writes the page, check reports an edited copy, and init --force writes it again', async () => {
    const repo = new Repo();
    const said: string[] = [];
    await initMain(['--course', 'create-pr'], { root: repo.dir, log: (l) => said.push(l) });
    expect(said).toContain('baton: tickets/HOW-TICKETS-WORK.md — how tickets work in this repository, generated');
    expect(said).toContain('baton: .dibber/config.json — written: Dibber writes the ticket files, Baton gives their numbers (coordinator)');
    expect(JSON.parse(readFileSync(join(repo.dir, '.dibber', 'config.json'), 'utf8'))).toMatchObject({ store: 'tickets', prefix: 'B', coordinator: { next: expect.arrayContaining(['tickets', 'next', 'ticket-<prefix>', '--coordinator']) } });
    const page = join(repo.dir, 'tickets', 'HOW-TICKETS-WORK.md');
    const want = readFileSync(page, 'utf8');
    expect(want).toContain('# How tickets work');
    // The check passes on the repository as init left it, and on this repository's own tickets.
    expect(repo.tickets('check', '--repo', repo.dir).status).toBe(0);
    // An edited copy is one finding, exit 1.
    writeFileSync(page, want.replace('dibber claim <id>', 'claim by hand'));
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
    // The stale-rule report may precede the count; it is never a finding (S-BTN-172).
    expect(out.stdout).toMatch(/(^|\n)baton tickets check: \d+ ticket\(s\), ✓ no findings\n$/);
  }, 60_000);

  it('check --claimable refuses a ticket citing a rule amended since it was filed, until a rules re-read note names it', () => {
    const repo = new Repo();
    // The scaffold and a ticket citing R-BTN-50, dated 2026-10-29; then a history entry of
    // 2026-11-01 naming R-BTN-50.
    mkdirSync(join(repo.dir, 'tickets'), { recursive: true });
    mkdirSync(join(repo.dir, 'spec'), { recursive: true });
    writeFileSync(join(repo.dir, 'tickets', 'B-1.mdx'), '---\ntitle: "B-1 — x"\nid: B-1\nproject: baton\nstatus: available\nupdated: 2026-10-29\ntags:\n  - roadmap-item\nprs: []\ndepends_on: []\n---\n\nThe core reads `prs` (R-BTN-50).\n');
    const dated = { GIT_COMMITTER_DATE: '2026-10-29T12:00:00Z', GIT_AUTHOR_DATE: '2026-10-29T12:00:00Z' };
    Object.assign(process.env, dated);
    try {
      repo.publish();
    } finally {
      for (const k of Object.keys(dated)) delete process.env[k];
    }
    writeFileSync(join(repo.dir, 'spec', 'BATON_SPEC_HISTORY.md'), '## Changelog\n\n- **2026-11-01 — R-BTN-50: the ruling on prs.** Core reads no `prs`.\n');
    git(repo.dir, 'add', '-A');
    git(repo.dir, 'commit', '-qm', 'the ruling');
    git(repo.dir, 'push', '-q', 'origin', 'HEAD:main');

    const before = git(repo.bare, 'rev-parse', 'main');
    const refused = repo.tickets('check', 'B-1', '--claimable', '--offline');
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain('B-1: not claimable — B-1 cites rules that spec/BATON_SPEC_HISTORY.md amended after the ticket answered for them (filed 2026-10-29, or a later rules re-read note naming the rule):\n  R-BTN-50 — 2026-11-01 — R-BTN-50: the ruling on prs\n');
    expect(refused.stdout).toContain('dibber set B-1 --note "rules re-read: R-BTN-50"');
    expect(git(repo.bare, 'rev-parse', 'main')).toBe(before);
    // The line `dibber set B-1 --note "rules re-read: R-BTN-50"` writes under ## Status, pushed.
    writeFileSync(join(repo.dir, 'tickets', 'B-1.mdx'), `${readFileSync(join(repo.dir, 'tickets', 'B-1.mdx'), 'utf8')}\n## Status\n\n_2026-11-02: rules re-read: R-BTN-50._\n`);
    git(repo.dir, 'commit', '-qam', 'B-1: rules re-read');
    git(repo.dir, 'push', '-q', 'origin', 'HEAD:main');
    const claimable = repo.tickets('check', 'B-1', '--claimable', '--offline');
    expect(claimable.status).toBe(0);
    expect(claimable.stdout).toContain('claim it with: dibber claim B-1');
  }, 120_000);
});
