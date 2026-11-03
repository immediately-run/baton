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

  it('a live ticket citing a rule amended since it was filed: its line and the count, exit 0', () => {
    const env = { GIT_COMMITTER_DATE: '2026-10-29T12:00:00Z', GIT_AUTHOR_DATE: '2026-10-29T12:00:00Z' };
    const saved = { ...process.env };
    Object.assign(process.env, env);
    let dir: string;
    try {
      dir = repo({ 'tickets/A-1.md': ticket('id: A-1').replace('Prose.', 'Reads `prs` (R-BTN-50).'), 'spec/BATON_SPEC_HISTORY.md': '- **2026-11-01 — R-BTN-50: the ruling.** R-BTN-50 changed.\n' });
    } finally {
      for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    const r = check(dir);
    expect(r).toMatchObject({ status: 0, stderr: '' });
    expect(r.lines).toEqual([
      'tickets/A-1.md: cites rules amended since it answered for them (filed 2026-10-29): R-BTN-50 (2026-11-01)',
      'baton tickets check: 1 live ticket(s) cite rules amended since they answered for them (reported, not a finding)',
      'baton tickets check: 1 ticket(s), ✓ no findings',
    ]);
  });

  it('check.sections_since: a ticket filed before it passes, one filed on it without ### Trust fails', () => {
    const body = (day: string) => `---\ntitle: t\nid: A-${day.slice(-1)}\n---\n\n### Invariants\n\nR-BTN-33.\n\n## Status\n\n_filed ${day}._\n`;
    // Committed on 2026-11-02: the sections check takes the later of `_filed` and the first commit.
    const env = { GIT_COMMITTER_DATE: '2026-11-02T12:00:00Z', GIT_AUTHOR_DATE: '2026-11-02T12:00:00Z' };
    const saved = { ...process.env };
    Object.assign(process.env, env);
    let dir: string;
    try {
      dir = repo({ 'tickets/A-2.md': body('2026-11-02'), 'tickets/A-3.md': body('2026-11-03') }, { check: { sections_since: '2026-11-03' } });
    } finally {
      for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    const r = check(dir);
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([
      'tickets/A-3.md: filed 2026-11-03, on or after check.sections_since (2026-11-03), and has no ### Trust section — every new input it adds (a field, a file, a commit trailer, a request), who may write it and how it is verified, or "no new input"',
      'baton tickets check: 2 ticket(s), 1 finding(s)',
    ]);
  });

  it('check.sections_from_id in a depth-1 clone, as CI checks out: a new hand-filed ticket without a _filed line is a finding, exit 1', () => {
    const settings = { check: { sections_since: '2026-11-03', sections_from_id: 'A-10' } };
    const full = repo({ 'tickets/A-9.md': ticket('id: A-9'), 'tickets/A-10.md': ticket('id: A-10') }, settings);
    const clone = mkdtempSync(join(tmpdir(), 'baton-s172-shallow-'));
    dirs.push(clone);
    rmSync(clone, { recursive: true, force: true });
    expect(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${full}`, clone]).status).toBe(0);
    const r = check(clone);
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([
      'tickets/A-10.md: A-10 is at or above check.sections_from_id (A-10) and has no `_filed YYYY-MM-DD` line in its ## Status — the line `baton ticket new` writes; add the day it was filed',
      'baton tickets check: 1 ticket(s) lacking ### Trust or ### Invariants, with no _filed line and a first commit this shallow clone does not show, not judged against check.sections_since (2026-11-03) — each below check.sections_from_id (A-10): A-9',
      'baton tickets check: 2 ticket(s), 1 finding(s)',
    ]);
  });

  it('this repository’s own tickets pass — the repository CI runs the check on', () => {
    const r = check(ROOT);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.lines.at(-1)).toMatch(/^baton tickets check: \d+ ticket\(s\), ✓ no findings$/);
  });
});
