// B-98 round 4 — tests that FAIL if their fix is reverted (the round-3 review showed the earlier
// ones could not): the quoting of an awkward value, the subdirectory root, and the refusal naming
// the landing branch. Each drives the real command against a throwaway repository.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestMain } from '../../src/defaults/request';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';
import { CREATE_SPEC_COURSE } from '../../src/defaults/course-pr';

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A checkout with a bare origin, `.baton/` listing create-spec, and `tickets/`. */
function repo(): { dir: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'baton-req4-'));
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const dir = join(root, 'work');
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  mkdirSync(join(dir, '.baton', 'courses', 'create-spec'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', default_branch: 'main', courses: [{ id: 'create-spec', version: 1 }] }));
  writeFileSync(join(dir, '.baton', 'courses', 'create-spec', 'course.json'), JSON.stringify(CREATE_SPEC_COURSE));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'push', '-q', 'origin', 'main');
  return { dir, origin };
}

const run = (dir: string, argv: string[]): { code: number | null; out: string[]; threw?: string } => {
  const out: string[] = [];
  try {
    return { code: requestMain(argv, { root: dir, log: (l) => out.push(l), warn: (l) => out.push(l) }), out };
  } catch (e) {
    return { code: null, out, threw: (e as Error).message };
  }
};

describe('B-98 round 4: the fixes reach the real command', () => {
  it('a value the source would misread is quoted with ONE pair — a backslash inside it survives (3-r1-3)', () => {
    const { dir, origin } = repo();
    try {
      // Opens with `#`, so it must be quoted; carries a backslash, which a JSON escape would double.
      const said = '#4 then C:\\dir\\sub must stay literal';
      expect(run(dir, ['--course', 'create-spec', said]).code).toBe(0);
      const text = git(origin, 'show', 'main:tickets/B-1.mdx');
      expect(text).toContain('description: "');
      expect(text).not.toContain('\\\\\\\\');
      expect(parseFrontmatter(text)!.description).toBe(said);
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true });
    }
  });


  it('a refusal names the branch the ticket would land on, never a throwaway directory (3-r1-1)', () => {
    const { dir } = repo();
    try {
      // The caller's own copy lists no course at all; the landing branch decides.
      writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', courses: [] }));
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'no courses');
      git(dir, 'push', '-q', 'origin', 'main');
      const r = run(dir, ['--course', 'create-spec', 'A sentence.']);
      expect(r.threw).toMatch(/^origin\/main: /);
      expect(r.threw).not.toMatch(/\/tmp\//);
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true });
    }
  });

  it('-- ends the flags but a flag before it still applies (3-r1-2)', () => {
    const { dir, origin } = repo();
    try {
      // The order the help line shows: the sentence after --, the flag before it.
      const r = run(dir, ['--course', 'create-spec', '--', '-v flag means verbose here']);
      expect(r.threw).toBeUndefined();
      expect(r.code).toBe(0);
      expect(parseFrontmatter(git(origin, 'show', 'main:tickets/B-1.mdx'))!.title).toContain('-v flag means verbose here');
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true });
    }
  });
});
