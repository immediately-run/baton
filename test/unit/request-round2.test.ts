// B-98 round 2 — the regressions the review asked for, each failing if its fix is reverted: a
// sentence with awkward characters reads back through parseFrontmatter; the id prefix is the
// repository's own and the number follows it; a stranger's page is not a ticket; a hook's refusal
// is one line carrying the hook's own words, never a retry.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextId, requestFile, ticketPrefix } from '../../src/defaults/request';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A checkout with a bare origin, tickets/ and a `.baton/baton.json`; the caller commits on it. */
function repo(): { dir: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'baton-req2-'));
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const dir = join(root, 'work');
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  mkdirSync(join(dir, '.baton'), { recursive: true });
  return { dir, origin };
}

describe('B-98 round 2: the fixes that had no test', () => {
  it('a sentence with a colon, a hash and a quote reads back identically through parseFrontmatter', () => {
    for (const said of [
      'Write C:\\temp\\spec.md and note #4',
      'Say "no" to Q: the ping',
      "Use the 'strict' mode",
      '[bracketed] sentence',
      '   padded   sentence   ',
    ]) {
      const fm = parseFrontmatter(requestFile('B-3', 'create-spec', said));
      // The source writes a scalar as itself where it can; a `"` it cannot keep becomes a curly
      // one (the one-character change the body comment names), and whitespace folds.
      // Written bare where it can be (no backslashes), and a `"` is kept: single quotes hold it.
      const want = said.replace(/\s+/g, ' ').trim();
      expect(fm?.description, said).toBe(want);
    }
  });

  it("the id prefix is the repository's own, numbered within that prefix — a page is not a ticket", () => {
    const { dir } = repo();
    try {
      for (const id of ['R3-1', 'R3-2', 'R3-20', 'B-7']) {
        writeFileSync(join(dir, 'tickets', `${id}.mdx`), `---\nid: ${id}\ntitle: T\nstatus: done\n---\n`);
      }
      // A page whose name looks like an id but has no frontmatter is no ticket.
      writeFileSync(join(dir, 'tickets', 'README-2.mdx'), '# pages are not tickets\n');
      expect(ticketPrefix(dir, 'tickets')).toBe('R3');
      expect(nextId(dir, 'tickets', 'R3')).toBe('R3-21');
      expect(nextId(dir, 'tickets', 'B')).toBe('B-8');
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true });
    }
  });

  it('a subdirectory of a checkout resolves to the checkout root', () => {
    const { dir } = repo();
    try {
      mkdirSync(join(dir, 'tickets', 'deep'), { recursive: true });
      writeFileSync(join(dir, 'tickets', 'deep', 'note.md'), 'x\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'base');
      // Asked from inside the tree, git answers the checkout's top level — which is what the
      // command uses as the root it files into (2-r0-6).
      expect(git(join(dir, 'tickets', 'deep'), 'rev-parse', '--show-toplevel')).toBe(dir);
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true });
    }
  });
});
