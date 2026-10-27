// S-BTN-172 the ticket check (B-111, BATON_SPEC R-BTN-74, §4.4): `baton tickets check`, as an
// operator runs it — through the CLI's own entry, `node cli/baton.mjs tickets check`, which bundles
// src/defaults/tickets-check.ts as it bundles `repo sync`. A clean repository exits 0 with a
// count; one whose tickets loop exits 1 with one `path: message` line per finding and the count;
// a repository with no `.baton/` is the CLI's error exit 2; and this repository's own tickets pass,
// which is what CI runs (`npm run check:tickets`). The slow cases (a fixture's `**Depends on:**`
// line, an ejected source, `--quiet`) are test/unit/tickets-check.test.ts's. Node only: it spawns
// the CLI, which writes a real git checkout and bundles the command with esbuild.
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CLI = join(ROOT, 'cli', 'baton.mjs');

/** `baton tickets check --repo <dir>` as the CLI runs it: its exit code, stdout's lines, stderr. */
const check = (dir: string): { status: number | null; lines: string[]; stderr: string } => {
  const out = spawnSync(process.execPath, [CLI, 'tickets', 'check', '--repo', dir], { encoding: 'utf8', cwd: ROOT, env: { PATH: process.env.PATH } });
  return { status: out.status, lines: out.stdout.split('\n').filter(Boolean), stderr: out.stderr };
};

const dirs: string[] = [];
/** A fixture repository: git, `.baton/baton.json`, and the ticket files given, `path → text`. */
function repo(files: Record<string, string>, settings: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-s172-'));
  dirs.push(dir);
  const git = (...a: string[]) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, '.baton'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', default_course: 'create-pr', repos: {}, ...settings }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return dir;
}

const ticket = (fm: string): string => `---\ntitle: A ticket\n${fm}\n---\n\nProse.\n`;

afterAll(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('S-BTN-172 the ticket check', () => {
  it('a clean repository: exit 0 and the count', () => {
    const dir = repo({ 'tickets/A-1.md': ticket('id: A-1'), 'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]') });
    const r = check(dir);
    expect(r).toMatchObject({ status: 0, stderr: '' });
    expect(r.lines).toEqual(['baton tickets check: 2 ticket(s), ✓ no findings']);
  });

  it('a cycle: exit 1, the loop named once at its first ticket’s file, then the count', () => {
    const dir = repo({ 'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]'), 'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]') });
    const r = check(dir);
    expect(r.status).toBe(1);
    expect(r.lines).toEqual(['tickets/A-1.md: a dependency cycle: A-1 → A-2 → A-1', 'baton tickets check: 2 ticket(s), 1 finding(s)']);
  });

  it('a repository with no .baton/baton.json is the CLI’s error: exit 2, the reason on stderr', () => {
    const bare = mkdtempSync(join(tmpdir(), 'baton-s172-bare-'));
    dirs.push(bare);
    const r = check(bare);
    expect(r.status).toBe(2);
    expect(r.lines).toEqual([]);
    expect(r.stderr).toContain('has no .baton/baton.json');
  });

  it('this repository’s own tickets pass — the repository CI runs the check on', () => {
    const r = check(ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.lines.at(-1)).toMatch(/^baton tickets check: \d+ ticket\(s\), ✓ no findings$/);
  });
});
