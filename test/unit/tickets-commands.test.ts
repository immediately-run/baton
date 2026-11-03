// tickets.test.ts — `baton tickets new | claim | set | done | check` (B-112, BATON_SPEC §2f
// R-BTN-74, §4.2, R-BTN-31): the ported stopgap's suite (scripts/ticket.mjs), against a throwaway
// bare remote. What must hold: every command is one commit on the remote's default branch, made in
// a throwaway worktree, so the caller's branch and tree are untouched; claim refuses a ticket that
// is not available or whose dependencies are not done; done archives; new takes the next free id
// from the configured prefix with a legacy pattern present; --tags, --project (an unknown or
// unconfigured project refused), the written skeleton and its **Depends on:** line, a --body-file
// that disagrees with the flag refused, and a filing the check would refuse left unpushed.
// Node only: it writes real repositories and runs git.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkTickets } from '../../src/defaults/tickets-check';
import { accepts, readTicketSettings, requiresFrom } from '../../src/defaults/tickets-config';
import { PAGE_NAME, ticketsPage } from '../../src/defaults/tickets-page';
import { moveTicket, reverseMention, skeletonBody } from '../../src/defaults/tickets';
import { appendStatus, filingDate, firstCommit, firstCommits, historyEntries, missingSections, rereadNote, rereads, ruleIds, rulesConfig, sectionGaps, staleRules } from '../../src/defaults/tickets-rules';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';

// Every case spawns the CLI against real git repositories, several times; under the full suite's
// load one spawn can take seconds, so the default 5 s is too tight for this file.
vi.setConfig({ testTimeout: 60_000 });

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
const today = (): string => new Date().toISOString().slice(0, 10);
/** Tomorrow, for a command that must write after one whose `updated:` is today's: a second write
 *  on the same day and the same status changes nothing, which git refuses to commit — the
 *  stopgap's transact also threw on that. */
const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const PROJECT = (id = 'baton'): string => `---\ntitle: ${id}\nid: ${id}\nstatus: active\nkind: project\ntags:\n  - project\ndescription: a project page\n---\n\nProse.\n`;

/** A ticket file as this repository's begin, for a fixture that needs one before a command. */
const ticket = (id: string, extra = ''): string => `---\ntitle: "${id} — a ticket"\nid: ${id}\nproject: baton\nstatus: available\nupdated: 2026-10-01\ntags:\n  - roadmap-item\ndescription: a ticket\nprs: []\ndepends_on: []${extra ? `\n${extra}` : ''}\n---\n\n**Brief:** a ticket\n\n**Depends on:** none.\n\n**Used by:** nothing yet.\n`;

interface Fixture {
  dir: string;
  origin: string;
  /** The remote's head, and its parent. */
  head: () => { sha: string; parent: string };
  /** The remote's file, as the origin has it. */
  at: (file: string, branch?: string) => string | null;
  /** The remote's ticket files, by id. */
  tickets: () => Record<string, string>;
}

/** A repository the commands file into: `main` with `.baton/baton.json` (its settings, `extra`),
 *  the tickets given (`path → text`), and a bare `origin` whose HEAD announces `main`. */
function repo(opts: { settings?: Record<string, unknown>; existing?: Record<string, string>; files?: Record<string, string> } = {}): Fixture {
  const dir = tmp('baton-b112-');
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  git(dir, 'config', 'user.email', 'b112@test');
  git(dir, 'config', 'user.name', 'b112 test');
  mkdirSync(join(dir, '.baton'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'baton.json'), `${JSON.stringify({ items: 'tickets', default_course: 'create-pr', repos: {}, ticket_prefix: 'B', legacy_ids: ['R3-\\d+'], project: 'baton', ...opts.settings }, null, 2)}\n`);
  mkdirSync(join(dir, 'tickets', 'projects'), { recursive: true });
  writeFileSync(join(dir, 'tickets', 'projects', 'baton.mdx'), PROJECT());
  for (const [path, text] of Object.entries(opts.files ?? {})) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  for (const [path, text] of Object.entries(opts.existing ?? {})) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture');
  const bare = tmp('baton-b112-origin-');
  rmSync(bare, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', '--bare', dir, bare], { stdio: 'ignore' });
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
  return {
    dir,
    origin: bare,
    head: () => ({ sha: git(bare, 'rev-parse', 'main'), parent: git(bare, 'rev-list', '--parents', '-n', '1', 'main').split(' ')[1] ?? '' }),
    at: (file, branch = 'main') => {
      try {
        return execFileSync('git', ['-C', bare, 'show', `${branch}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        return null;
      }
    },
    tickets: () => {
      const out = execFileSync('git', ['-C', bare, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' }).split('\n').filter((f) => /^tickets\/(archive\/)?[^/]+\.mdx$/.test(f));
      return Object.fromEntries(out.map((f) => [execFileSync('git', ['-C', bare, 'show', `main:${f}`], { encoding: 'utf8' }), f]));
    },
  };
}

/** `baton tickets …` through the CLI's own entry, as an operator runs it: exit code, stdout, stderr. */
const run = (dir: string, ...argv: string[]): { code: number | null; out: string; err: string } => {
  const r = spawnSync(process.execPath, [CLI, 'tickets', ...argv], { cwd: dir, encoding: 'utf8', env: { ...process.env, BATON_HOME: dir } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

/** The remote's ticket file for an id, read back through the markdown source's frontmatter. */
const fmOf = (f: Fixture, path: string): Record<string, unknown> => parseFrontmatter(f.at(path)!)!;


describe('baton tickets new: the ticket it files (B-112)', () => {
  it('one commit on the default branch, the next free id from the configured prefix, the skeleton, and the caller’s tree untouched', () => {
    const f = repo({ existing: { 'tickets/B-3.mdx': ticket('B-3'), 'tickets/R3-9.mdx': ticket('R3-9') } });
    git(f.dir, 'checkout', '-q', '-b', 'my-work');
    writeFileSync(join(f.dir, 'draft.txt'), 'uncommitted\n');
    const before = f.head().sha;
    const r = run(f.dir, 'new', '--title', 'Write the thing', '--description', 'Write the thing, so two of them agree');
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toBe('✓ tickets: file B-4 — Write the thing\n');
    // One commit on top of the head, the ticket file alone.
    const { sha, parent } = f.head();
    expect(parent).toBe(before);
    expect(execFileSync('git', ['-C', f.origin, 'show', '--name-only', '--format=%s', sha], { encoding: 'utf8' }).trim().split('\n'))
      .toEqual(['tickets: file B-4 — Write the thing', '', 'tickets/B-4.mdx']);
    // The caller's branch, HEAD and tree are as they were.
    expect(git(f.dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(f.dir, 'symbolic-ref', '--short', 'HEAD')).toBe('my-work');
    expect(git(f.dir, 'status', '--porcelain')).toBe('?? draft.txt');
    // The skeleton: the conventional body, the filing's date, the flag's line.
    const text = f.at('tickets/B-4.mdx')!;
    expect(parseFrontmatter(text)).toMatchObject({ id: 'B-4', project: 'baton', status: 'available', updated: today(), tags: ['roadmap-item'], description: 'Write the thing, so two of them agree', title: 'B-4 — Write the thing', depends_on: [] });
    for (const line of ['**Brief:** Write the thing, so two of them agree', '**Spec:**', '**Depends on:** none.', '**Used by:** nothing yet.', '### What to build', '### Tests', '### Exit criteria', '## Status', `_filed ${today()}._`]) {
      expect(text, line).toContain(line);
    }
    // The legacy id was not allocated, and B-4 is the next free number across the live and the archived.
    expect(f.at('tickets/B-5.mdx')).toBeNull();
  });

  it('the next free number skips the archived ones, and the configured prefix is the one allocated', () => {
    const archived = repo({ existing: { 'tickets/archive/B-7.mdx': ticket('B-7', 'status: done').replace('status: available', ''), 'tickets/B-2.mdx': ticket('B-2') }, settings: { ticket_prefix: 'F', legacy_ids: ['R3-\\d+', 'B-\\d+'] } });
    expect(run(archived.dir, 'new', '--title', 'x').out).toBe('✓ tickets: file F-1 — x\n');
    // F was not among the accepted ids before the prefix named it: its own pattern is `\d+`.
    expect(fmOf(archived, 'tickets/F-1.mdx').id).toBe('F-1');
    const again = run(archived.dir, 'new', '--title', 'y');
    expect(again.out).toBe('✓ tickets: file F-2 — y\n');
  });

  it('the legacy patterns the file names are accepted for a dependency and never allocated', () => {
    const f = repo({ existing: { 'tickets/R3-1249.mdx': ticket('R3-1249', 'status: done') } });
    // A closed ticket may be depended on no more than a live one may (a filing does not wait on
    // a done one, but the id is accepted): an unknown pattern is the refusal.
    expect(run(f.dir, 'new', '--title', 'x', '--depends-on', 'R3-1250').err).toContain('--depends-on R3-1250: no such ticket on origin/main');
    expect(run(f.dir, 'new', '--title', 'x', '--depends-on', 'B-9').err).toContain('--depends-on B-9: no such ticket');
    expect(run(f.dir, 'new', '--title', 'x', '--depends-on', 'Q-1').err).toContain('--depends-on Q-1 is not a ticket id of this repository');
    expect(f.at('tickets/B-1.mdx')).toBeNull();
  });

  it('--depends-on writes the depends_on list, the **Depends on:** line and the reverse mention', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1') } });
    const r = run(f.dir, 'new', '--title', 'the second', '--depends-on', 'B-1');
    expect(r.out).toBe('✓ tickets: file B-2 — the second\n');
    expect(parseFrontmatter(f.at('tickets/B-2.mdx')!)!.depends_on).toEqual(['B-1']);
    expect(f.at('tickets/B-2.mdx')).toContain('**Depends on:** B-1.');
    // The dependency says who waits on it.
    expect(f.at('tickets/B-1.mdx')).toContain('**Used by:** B-2.');
    // And its own line is unchanged: only the reverse mention moved.
    expect(f.at('tickets/B-1.mdx')).toContain('**Depends on:** none.');
  });

  it('--tags writes what it names, else the file’s tags', () => {
    const f = repo();
    expect(run(f.dir, 'new', '--title', 'expedited', '--tags', 'EXPEDITE,OP').out).toBe('✓ tickets: file B-1 — expedited\n');
    expect(fmOf(f, 'tickets/B-1.mdx').tags).toEqual(['EXPEDITE', 'OP']);
    expect(run(f.dir, 'new', '--title', 'plain').out).toBe('✓ tickets: file B-2 — plain\n');
    expect(fmOf(f, 'tickets/B-2.mdx').tags).toEqual(['roadmap-item']);
    const named = repo({ settings: { tags: ['feature'] } });
    expect(run(named.dir, 'new', '--title', 'x').code).toBe(0);
    expect(fmOf(named, 'tickets/B-1.mdx').tags).toEqual(['feature']);
  });

  it('--project writes the page it names; an unknown project, or none at all, is refused', () => {
    const f = repo({ files: { 'tickets/projects/other.mdx': PROJECT('other') } });
    expect(run(f.dir, 'new', '--title', 'x', '--project', 'other').code).toBe(0);
    expect(fmOf(f, 'tickets/B-1.mdx').project).toBe('other');
    const missing = run(f.dir, 'new', '--title', 'y', '--project', 'nope');
    expect(missing.code).toBe(2);
    expect(missing.err).toBe('baton: --project nope: no `kind: project` page in tickets/projects/ — write tickets/projects/nope.mdx (frontmatter `id: nope`, `kind: project`) first, or name a project that is there\n');
    // Without a configured default, --project is required — there is no hard-coded one.
    const none = repo({ settings: { project: undefined } });
    const refused = run(none.dir, 'new', '--title', 'z');
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('--project is required: this repository names no default project');
    expect(none.at('tickets/B-1.mdx')).toBeNull();
  });

  it('a --body-file is kept as given, and its **Depends on:** line must agree with the flag', () => {
    const f = repo();
    const body = join(f.dir, 'body.md');
    const withLine = (line: string) => `**Brief:** mine\n\n${line}\n\n### What to build\n\nMine.\n`;
    writeFileSync(body, withLine('**Depends on:** none.'));
    expect(run(f.dir, 'new', '--title', 'a', '--body-file', body).out).toBe('✓ tickets: file B-1 — a\n');
    expect(f.at('tickets/B-1.mdx')).toContain('### What to build\n\nMine.\n');
    // The flag names a dependency the file's line does not: refused, nothing pushed.
    writeFileSync(body, withLine('**Depends on:** none.'));
    const r = run(f.dir, 'new', '--title', 'b', '--body-file', body, '--depends-on', 'B-1');
    expect(r.code).toBe(2);
    expect(r.err).toContain("--body-file's **Depends on:** line does not name B-1, which --depends-on names");
    // The file's line names a dependency the flag does not: refused too.
    writeFileSync(body, withLine('**Depends on:** B-1.'));
    const s = run(f.dir, 'new', '--title', 'c', '--body-file', body);
    expect(s.code).toBe(2);
    expect(s.err).toContain('**Depends on:** names B-1, which --depends-on does not (--depends-on names none)');
    expect(f.at('tickets/B-2.mdx')).toBeNull();
  });

  it('a filing the check would refuse — a cycle, or a prefix it cannot allocate — is written to no branch', () => {
    // B-1 waits on B-2, which does not exist yet: filing B-2 as waiting on B-1 closes the loop,
    // and the board's own cycle check refuses it before the push — as `baton tickets check`
    // would after it.
    const f = repo({ existing: {
      'tickets/B-1.mdx': ticket('B-1').replace('**Depends on:** none.', '**Depends on:** B-2.').replace('depends_on: []', 'depends_on:\n  - B-2'),
    } });
    const head = f.head().sha;
    const r = run(f.dir, 'new', '--title', 'a loop', '--depends-on', 'B-1');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^baton: B-2: a dependency cycle: B-1 → B-2 → B-1\n$/);
    expect(f.head().sha).toBe(head);
    expect(f.at('tickets/B-2.mdx')).toBeNull();
    // A prefix whose pattern names four-digit ids is accepted but never allocated: `new` says so
    // rather than write an id its pattern does not admit.
    const zero = repo({ settings: { prefixes: { 'B-': '\\d{4}' } } });
    const r2 = run(zero.dir, 'new', '--title', 'x');
    expect(r2.code).toBe(2);
    expect(r2.err).toContain('new allocates B-<n>');
    expect(zero.at('tickets/B-1.mdx')).toBeNull();
  });

  it('the Requires: clause a description ends with is written on the requires line, and nowhere else', () => {
    const f = repo();
    expect(run(f.dir, 'new', '--title', 'x', '--description', 'Check the results. Requires: human-operator, drivable-browser.').code).toBe(0);
    const text = f.at('tickets/B-1.mdx')!;
    expect(text).toContain('**Requires:** `human-operator`, `drivable-browser`.');
    expect(text).not.toContain('_A description that ends with a `Requires:` clause');
    expect(requiresFrom('Check the results. Requires: human-operator, drivable-browser.')).toEqual(['human-operator', 'drivable-browser']);
    // The clause is the END of the description: a sentence that merely mentions one is not it.
    expect(requiresFrom('A sentence about Requires: this, and that. Not a clause.')).toEqual([]);
    // A description with no clause says the line is the filer's.
    expect(skeletonBody({ description: 'plain', deps: [], date: '2026-10-30' })).toContain('_A description that ends with a `Requires:` clause');
  });
});

describe('baton tickets claim | set | done (B-112)', () => {
  it('claim sets in-progress, and refuses a ticket that is not available or whose dependencies are not done', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-2.mdx': ticket('B-2').replace('**Depends on:** none.', '**Depends on:** B-1.'), 'tickets/B-3.mdx': ticket('B-3', 'status: in-review') } });
    const r = run(f.dir, 'claim', 'B-1');
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toMatch(/^✓ tickets: claim B-1 \(in progress\) — pushed as [0-9a-f]{7,}\n$/);
    expect(fmOf(f, 'tickets/B-1.mdx')).toMatchObject({ status: 'in-progress', updated: today() });
    // B-1 is held now: a second claim of it is refused.
    const twice = run(f.dir, 'claim', 'B-1');
    expect(twice.code).toBe(2);
    expect(twice.err).toBe('baton: B-1 is in-progress, not available — someone may hold it\n');
    // A ticket already in review is not available.
    expect(run(f.dir, 'claim', 'B-3').err).toBe('baton: B-3 is in-review, not available — someone may hold it\n');
    // An id this repository does not allocate.
    expect(run(f.dir, 'claim', 'Z-1').code).toBe(2);
  });

  it('claim refuses a ticket whose dependency is not done, and takes it once the dependency is archived', () => {
    const depends = (id: string, dep: string) => ticket(id).replace('**Depends on:** none.', `**Depends on:** ${dep}.`).replace('depends_on: []', `depends_on:\n  - ${dep}`);
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-2.mdx': depends('B-2', 'B-1') } });
    const waiting = run(f.dir, 'claim', 'B-2');
    expect(waiting.code).toBe(2);
    expect(waiting.err).toBe('baton: B-2 depends on B-1, not done yet\n');
    expect(run(f.dir, 'done', 'B-1').code).toBe(0);
    expect(run(f.dir, 'claim', 'B-2').code).toBe(0);
  });

  it('a dependency closed in the file but not archived still counts as done', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1').replace('status: available', 'status: superseded'), 'tickets/B-2.mdx': ticket('B-2').replace('**Depends on:** none.', '**Depends on:** B-1.').replace('depends_on: []', 'depends_on:\n  - B-1') } });
    expect(run(f.dir, 'claim', 'B-2').code).toBe(0);
  });

  it('set writes any live status and --pr adds the pull request once', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1') } });
    const url = 'https://github.com/immediately-run/baton/pull/40';
    expect(run(f.dir, 'set', 'B-1', 'in-review', '--pr', url).out).toMatch(/^✓ tickets: B-1 → in-review — pushed as /);
    expect(fmOf(f, 'tickets/B-1.mdx')).toMatchObject({ status: 'in-review' });
    expect(f.at('tickets/B-1.mdx')).toContain(`prs:\n  - ${url}`);
    // The same URL again is not added twice, and the same status on the same day writes nothing
    // at all (`updated:` is what changes, and it is already today's).
    const again = run(f.dir, 'set', 'B-1', 'in-review', '--pr', url);
    expect(again.err).toContain('nothing to commit');
    // moveTicket's own clock, with the date a test hands it: writing the same URL again beside
    // another status adds it once. `deferred` — a live status again, as in the stopgap's LIVE
    // list — carries it; `in-progress` would be refused below, held ticket.
    const before = f.at('tickets/B-1.mdx')!;
    moveTicket(f.dir, { date: tomorrow() }, 'B-1', 'deferred', url);
    const after = f.at('tickets/B-1.mdx')!;
    expect(parseFrontmatter(after)).toMatchObject({ status: 'deferred', updated: tomorrow() });
    expect(after.match(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(before.match(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(f.at('tickets/B-1.mdx')!.match(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    // A URL that is not a GitHub pull request, and a status set does not write.
    expect(run(f.dir, 'set', 'B-1', 'in-review', '--pr', 'https://example.com/x').err).toContain('is not a GitHub pull request URL');
    expect(run(f.dir, 'set', 'B-1', 'done').err).toContain('`baton tickets done <id>`, past this push');
    expect(run(f.dir, 'set', 'B-1', 'nonsense').err).toContain('nonsense is not a status `set` writes');
    // In-progress is the claim status: only an available ticket takes it (the stopgap's rule),
    // and this one is deferred — someone may hold it.
    const second = run(f.dir, 'set', 'B-1', 'in-progress', '--pr', url);
    expect(second.err).toContain('B-1 is closed, not available — someone may hold it'); // deferred left the live list
  });

  it('done archives the file with its status and PR', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1') } });
    const url = 'https://github.com/immediately-run/baton/pull/41';
    const r = run(f.dir, 'done', 'B-1', '--pr', url);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^✓ tickets: B-1 done \(archived\) — pushed as /);
    expect(f.at('tickets/B-1.mdx')).toBeNull();
    const archived = f.at('tickets/archive/B-1.mdx')!;
    expect(parseFrontmatter(archived)).toMatchObject({ id: 'B-1', status: 'done' });
    expect(archived).toContain(url);
    // And a claim of it afterwards is refused: it is archived.
    expect(run(f.dir, 'claim', 'B-1').err).toBe('baton: B-1 is archived (done)\n');
    expect(run(f.dir, 'done', 'B-1').err).toBe('baton: B-1 is archived (done)\n');
  });

  it('a push refused because the branch moved is fetched again and retried on the new head', () => {
    // A peer claims B-1 first, between this command's fetch and its push: a `git` on PATH turns
    // the first push away as a moved head would, and lets the peer's commit land.
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1') } });
    const peer = tmp('baton-b112-peer-');
    rmSync(peer, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', f.origin, peer], { stdio: 'ignore' });
    git(peer, 'config', 'user.email', 'peer@test');
    git(peer, 'config', 'user.name', 'peer');
    writeFileSync(join(peer, 'tickets', 'B-2.mdx'), ticket('B-2'));
    git(peer, 'add', '-A');
    git(peer, 'commit', '-qm', 'a peer files B-2');
    const bin = tmp('baton-b112-git-');
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const flag = JSON.stringify(join(bin, 'refused'));
    const shim = [
      '#!/bin/sh',
      'n=0',
      'for a in "$@"; do if [ "$a" = "push" ]; then n=1; fi; done',
      `if [ "$n" = "1" ] && [ ! -e ${flag} ]; then`,
      `  touch ${flag}`,
      `  ${JSON.stringify(realGit)} -C ${JSON.stringify(peer)} push -q ${JSON.stringify(f.origin)} HEAD:main`,
      '  echo " ! [rejected]        HEAD -> main (non-fast-forward)" 1>&2',
      '  echo "error: failed to push some refs" >&2',
      '  exit 1',
      'fi',
      `exec ${JSON.stringify(realGit)} "$@"`,
      '',
    ].join('\n');
    writeFileSync(join(bin, 'git'), shim, { mode: 0o755 });
    const out = spawnSync(process.execPath, [CLI, 'tickets', 'new', '--title', 'mine'], { cwd: f.dir, encoding: 'utf8', env: { ...process.env, BATON_HOME: f.dir, PATH: `${bin}:${process.env.PATH}` } });
    expect(out.stderr).toContain('origin/main moved; retrying on the new head (1/6)');
    expect(out.stdout).toBe('✓ tickets: file B-3 — mine\n');
    // It landed on the peer's commit, which the first try never saw.
    expect(git(f.origin, 'log', '--format=%s', 'main').split('\n').slice(0, 3)).toEqual(['tickets: file B-3 — mine', 'a peer files B-2', 'fixture']);
  }, 60_000);

  it('a command the CLI does not take, and a flag it does not know, are refusals', () => {
    const f = repo();
    expect(run(f.dir, 'archive', 'B-1').err).toBe('baton: archive: baton tickets new|claim|set|done|check (baton tickets --help)\n');
    expect(run(f.dir, 'claim', 'B-1', '--bogus', 'x').err).toBe('baton: --bogus: not a flag of baton tickets claim\n');
    expect(run(f.dir, 'new').err).toBe('baton: new needs --title\n');
  });
});

describe('baton tickets: the settings and the page (B-112)', () => {
  it('the settings are read as the file writes them, the allocating prefix included', () => {
    const dir = tmp('baton-b112-cfg-');
    mkdirSync(join(dir, '.baton'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'roadmap', ticket_prefix: 'FLDH', legacy_ids: ['R3-\\d+', 'F-\\d{7}'], project: 'fieldhouse', tags: ['feature', 'roadmap-item'] }));
    const s = readTicketSettings(dir);
    expect(s).toMatchObject({ items: 'roadmap', ticket_prefix: 'FLDH', legacy_ids: ['R3-\\d+', 'F-\\d{7}'], project: 'fieldhouse', tags: ['feature', 'roadmap-item'] });
    expect(accepts(s, 'R3-1249')).toBe(true);
    expect(accepts(s, 'FLDH-1')).toBe(true);
    // A fixed seven-digit count is read as one (`\d{7}`), and a short number is not an id.
    expect(accepts(s, 'F-0000007')).toBe(true);
    expect(accepts(s, 'F-7')).toBe(false);
    expect(accepts(s, 'B-1')).toBe(false);
    // A file with no ticket settings takes the defaults.
    const bare = tmp('baton-b112-cfg2-');
    mkdirSync(join(bare, '.baton'), { recursive: true });
    writeFileSync(join(bare, '.baton', 'baton.json'), '{"items":"tickets"}');
    expect(readTicketSettings(bare)).toMatchObject({ ticket_prefix: undefined, legacy_ids: [], tags: ['roadmap-item'], prefixes: { 'B-': '\\d+' }, projects: 'projects' });
    // No settings at all names the fix.
    const none = tmp('baton-b112-cfg3-');
    expect(() => readTicketSettings(none)).toThrow(/has no \.baton\/baton\.json — .*run `baton repo init` there first/);
  });

  it('the page is the same text in every repository, and differs only where the settings do', () => {
    const dir = tmp('baton-b112-page-');
    mkdirSync(join(dir, '.baton'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'roadmap', ticket_prefix: 'FLDH', legacy_ids: ['R3-\\d+'], project: 'fieldhouse' }));
    const page = ticketsPage(readTicketSettings(dir));
    expect(page).toContain('New tickets take `FLDH-<n>`');
    expect(page).toContain('`R3-`');
    expect(page).toContain('This repository’s default project is `fieldhouse`');
    expect(page).toContain('- `EXPEDITE` —');
    expect(page).toContain('- `OP` —');
    expect(page).toContain('**Used by:**');
    expect(page).toContain('**Waits on:**');
    expect(page).toContain('Choose or create the');
    expect(page).toContain('baton tickets claim <id>');
  });

  it('the reverse mention adds a name to the line, or writes the line where the ticket has none', () => {
    const withLine = '**Brief:** x\n\n**Used by:** nothing yet.\n\nProse.\n';
    expect(reverseMention(withLine, 'B-2')).toBe('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n');
    expect(reverseMention('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n', 'B-3')).toBe('**Brief:** x\n\n**Used by:** B-2, B-3.\n\nProse.\n');
    expect(reverseMention('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n', 'B-2')).toBe('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n');
    // No **Used by:** line: one is written at the end of the opening header block.
    expect(reverseMention('**Brief:** x\n\n**Depends on:** none.\n\n### What to build\n', 'B-4')).toBe('**Brief:** x\n**Used by:** B-4.\n\n**Depends on:** none.\n\n### What to build\n');
  });
});

describe('baton repo init and baton tickets check: the generated page (B-112)', () => {
  it('init writes the page; an edited copy is the check’s finding; init --force writes it again', async () => {
    const dir = tmp('baton-b112-init-');
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
    git(dir, 'config', 'user.email', 'b112@test');
    git(dir, 'config', 'user.name', 'b112 test');
    mkdirSync(join(dir, '.baton'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'baton.json'), `${JSON.stringify({ baton_url: 'https://baton.immediately.run', items: 'tickets', default_course: 'create-pr', repos: {}, agent_command: 'echo', ticket_prefix: 'B', project: 'baton' }, null, 2)}\n`);
    mkdirSync(join(dir, 'tickets', 'projects'), { recursive: true });
    writeFileSync(join(dir, 'tickets', 'projects', 'baton.mdx'), PROJECT());
    const page = join(dir, 'tickets', PAGE_NAME);
    const { initMain } = await CLI_MODULE();
    const said: string[] = [];
    const pin = git(ROOT, 'remote', 'get-url', 'origin');
    expect(pin).toContain('github');
    await initMain(['--course', 'create-pr'], { root: dir, log: (l) => said.push(l) });
    expect(said).toContain(`baton: tickets/${PAGE_NAME} — how tickets work in this repository, generated`);
    const want = readFileSync(page, 'utf8');
    expect(want).toContain('# How tickets work');
    expect(want).toBe(ticketsPage(readTicketSettings(dir)));
    // The check finds nothing on a clean repository.
    expect((await checkTickets(dir)).findings).toEqual([]);
    // An edited copy is a finding, one line and the count, exit 1.
    writeFileSync(page, `${want.replace('baton tickets claim <id>', 'claim it by hand')}\n`);
    const r = run(dir, 'check', '--repo', dir);
    expect(r.code).toBe(1);
    expect(r.out.split('\n').filter(Boolean)).toEqual([
      `tickets/${PAGE_NAME}: differs from the "How tickets work" page this release generates — \`baton repo init --force\` writes it again`,
      'baton tickets check: 1 ticket(s), 1 finding(s)',
    ]);
    // --quiet keeps stdout for the exit code.
    expect(run(dir, 'check', '--repo', dir, '--quiet')).toMatchObject({ code: 1, out: '' });
    // init --force writes it again, and the check passes.
    await initMain(['--course', 'create-pr', '--force'], { root: dir, log: () => {} });
    expect(readFileSync(page, 'utf8')).toBe(want);
    expect(run(dir, 'check', '--repo', dir).code).toBe(0);
    expect(existsSync(join(dir, 'tickets', 'README.md'))).toBe(true);
  }, 60_000);
});

/** The CLI's own init, bundled as the CLI runs it (src/defaults/cli.ts through scripts/baton-cli.mjs). */
const CLI_MODULE = async (): Promise<{ initMain: (argv: string[], io: { root?: string; log?: (l: string) => void }) => Promise<number> }> =>
  (await import('../../src/defaults/cli')) as unknown as { initMain: (argv: string[], io: { root?: string; log?: (l: string) => void }) => Promise<number> };

/** A fixture whose commit is dated `day` (the author's date, which `%as` reads): the day a ticket
 *  with no `_filed` line was filed, which the stale-rule reading compares the history with. */
function datedRepo(day: string, opts: Parameters<typeof repo>[0]): Fixture {
  const before = { a: process.env.GIT_COMMITTER_DATE, b: process.env.GIT_AUTHOR_DATE };
  process.env.GIT_COMMITTER_DATE = `${day}T12:00:00Z`;
  process.env.GIT_AUTHOR_DATE = `${day}T12:00:00Z`;
  try {
    return repo(opts);
  } finally {
    if (before.a === undefined) delete process.env.GIT_COMMITTER_DATE; else process.env.GIT_COMMITTER_DATE = before.a;
    if (before.b === undefined) delete process.env.GIT_AUTHOR_DATE; else process.env.GIT_AUTHOR_DATE = before.b;
  }
}

/** Commit `text` to `path` in `dir` as `subject`, authored on `author` (and committed on
 *  `committer`, the same unless given), and push it to the fixture's origin. */
function edit(f: Fixture, path: string, text: string, subject: string, author: string, committer = author): void {
  mkdirSync(join(f.dir, path, '..'), { recursive: true });
  writeFileSync(join(f.dir, path), text);
  git(f.dir, 'add', '-A');
  execFileSync('git', ['-C', f.dir, 'commit', '-q', '-m', subject], { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: `${author}T12:00:00Z`, GIT_COMMITTER_DATE: `${committer}T12:00:00Z` } });
  git(f.dir, 'push', '-q', 'origin', 'HEAD:main');
}

/** A history file in the spec's shape: dated entries, one with a wrapped title, one a range. */
const HISTORY = [
  '# History',
  '',
  '## Changelog',
  '',
  '- **2026-10-01 — R-BTN-50: before the ticket.** Amended R-BTN-50.',
  '',
  '- **2026-10-20 — R-BTN-50: the same day as the ticket.** Amended R-BTN-50 again.',
  '',
  '- **2026-11-01 — R-BTN-50: the owner’s ruling on Needs you.** R-BTN-50 now says the core reads no `prs`;',
  '  R-BTN-7 is cited as evidence only, and the review round’s log names R-BTN-33.',
  '',
  '- **2026-10-27 to 2026-11-02 — R-BTN-33, R-BTN-150: a range, its',
  '  title wrapped** (PR #9). R-BTN-33 and R-BTN-150.',
  '',
  '## Retired requirements',
  '',
  '| R-BTN-50 | never an entry |',
  '',
].join('\n');

/** A live ticket citing rules in its body (and one only in its frontmatter, which is not read),
 *  filed 2026-10-20 by its `_filed` line unless `filed` says otherwise (null: no such line). */
const citing = (id: string, filed: string | null = '2026-10-20'): string => ticket(id, 'description: cites R-BTN-77 in frontmatter only')
  .replace('**Used by:** nothing yet.\n', `**Used by:** nothing yet.\n\nThe core reads \`prs\` (R-BTN-50); keep R-BTN-33 and R-BTN-150 and R-BTN-7.\n${filed ? `\n## Status\n\n_filed ${filed}._\n` : ''}`);

describe('the stale-rule guard: its reading (2026-11-03)', () => {
  it('reads dated entries, a range by its last day, a wrapped title, and no table row', () => {
    expect(historyEntries(HISTORY).map((e) => [e.date, e.title])).toEqual([
      ['2026-10-01', 'R-BTN-50: before the ticket'],
      ['2026-10-20', 'R-BTN-50: the same day as the ticket'],
      ['2026-11-01', 'R-BTN-50: the owner’s ruling on Needs you'],
      ['2026-11-02', 'R-BTN-33, R-BTN-150: a range, its title wrapped'],
    ]);
  });

  it('a rule id is never a longer one’s head', () => {
    expect(ruleIds('R-BTN-5, R-BTN-50 and XR-BTN-6, R-BTN-150.')).toEqual(['R-BTN-5', 'R-BTN-50', 'R-BTN-150']);
    expect(ruleIds('R-FH-3 and R-BTN-3', 'R-FH')).toEqual(['R-FH-3']);
  });

  it('a cited rule named by an entry dated after the filing is stale; one of the filing’s own day or before, an uncited one, or a frontmatter one is not', () => {
    const stale = staleRules(citing('B-1'), '2026-10-20', historyEntries(HISTORY));
    // 2026-10-20's entry is the filing's own day: not after it (the day boundary, R-BTN-74).
    // 2026-11-01's body names R-BTN-7 and R-BTN-33, which its title does not: not amended there.
    expect(stale.map((s) => `${s.id} ${s.date}`)).toEqual(['R-BTN-33 2026-11-02', 'R-BTN-50 2026-11-01', 'R-BTN-150 2026-11-02']);
    expect(staleRules(citing('B-1'), '2026-11-02', historyEntries(HISTORY))).toEqual([]);
    expect(rereadNote('2026-11-03', stale)).toBe('_(2026-11-03: rules re-read at claim: R-BTN-33 (amended 2026-11-02), R-BTN-50 (amended 2026-11-01), R-BTN-150 (amended 2026-11-02))_');
  });

  it('a rules re-read note answers for the ids it names up to its day, and no others — a claim’s, and a spec PR’s', () => {
    const claimed = '## Status\n\n_(2026-11-04: rules re-read at claim: R-BTN-33 (amended 2026-11-02), R-BTN-50 (amended 2026-11-01))_\n';
    expect([...rereads(claimed)]).toEqual([['R-BTN-33', '2026-11-04'], ['R-BTN-50', '2026-11-04']]);
    const specPr = '_(2026-11-01: rules re-read: R-BTN-50)_\n\n_(2026-11-03: rules re-read: R-BTN-50, R-BTN-33)_\n';
    expect([...rereads(specPr)]).toEqual([['R-BTN-50', '2026-11-03'], ['R-BTN-33', '2026-11-03']]);
    // A spec PR that handled R-BTN-50 alone leaves R-BTN-33 and R-BTN-150 stale.
    const handled = `${citing('B-1')}\n_(2026-11-03: rules re-read: R-BTN-50)_\n`;
    expect(staleRules(handled, '2026-10-20', historyEntries(HISTORY)).map((s) => s.id)).toEqual(['R-BTN-33', 'R-BTN-150']);
    expect(rereads('_(2026-11-03: a note naming R-BTN-50)_')).toEqual(new Map());
  });

  it('the note goes at the end of the Status section, or in a Status section of its own', () => {
    expect(appendStatus('a\n\n## Status\n\n_filed x._\n\n## Later\n\nb\n', 'N')).toBe('a\n\n## Status\n\n_filed x._\n\nN\n\n## Later\n\nb\n');
    expect(appendStatus('a\n', 'N')).toBe('a\n\n## Status\n\nN\n');
  });

  it('check.rules overrides the history and the prefix; anything else keeps the defaults', () => {
    expect(rulesConfig(undefined)).toEqual({ prefix: 'R-BTN', history: 'spec/BATON_SPEC_HISTORY.md' });
    expect(rulesConfig({ rules: { prefix: 'R-FH', history: 'spec/FIELDHOUSE_SPEC_HISTORY.md' } })).toEqual({ prefix: 'R-FH', history: 'spec/FIELDHOUSE_SPEC_HISTORY.md' });
    expect(rulesConfig({ rules: { prefix: '' } }).prefix).toBe('R-BTN');
  });
});

describe('the stale-rule guard: how a ticket is dated (2026-11-03)', () => {
  it('by its file’s first commit, never by a later edit: a spec PR’s note or strike answers for nothing', () => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', null) } });
    edit(f, 'tickets/B-1.mdx', `${citing('B-1', null)}\n_(2026-11-05: noted by a spec PR.)_\n`, 'spec: strike the clause the ruling contradicts', '2026-11-05');
    expect(firstCommit(f.dir, 'tickets/B-1.mdx')).toEqual({ date: '2026-10-20', boundary: false });
    expect(firstCommits(f.dir, 'tickets').get('tickets/B-1.mdx')).toEqual({ date: '2026-10-20', boundary: false });
  });

  it('by the author’s day, not the committer’s: a rebase or a cherry-pick moves nothing', () => {
    const f = repo();
    edit(f, 'tickets/B-1.mdx', citing('B-1', null), 'B-1: filed by hand', '2026-10-20', '2026-11-09');
    expect(firstCommit(f.dir, 'tickets/B-1.mdx')!.date).toBe('2026-10-20');
  });

  it('a _filed line wins; a file never committed is filed today; a shallow boundary is undetermined', () => {
    expect(filingDate(citing('B-1', '2026-10-25'), { date: '2026-10-20', boundary: false }, '2026-11-03')).toEqual({ date: '2026-10-25' });
    expect(filingDate(citing('B-1', null), { date: '2026-10-20', boundary: false }, '2026-11-03')).toEqual({ date: '2026-10-20' });
    expect(filingDate(citing('B-1', null), null, '2026-11-03')).toEqual({ date: '2026-11-03' });
    expect(filingDate(citing('B-1', null), { date: '2026-11-03', boundary: true }, '2026-11-03')).toEqual({ undetermined: true });
    expect(filingDate(citing('B-1', '2026-10-25'), { date: '2026-11-03', boundary: true }, '2026-11-03')).toEqual({ date: '2026-10-25' });
  });
});

describe('baton tickets claim: the stale-rule guard (2026-11-03)', () => {
  it('refuses a ticket citing a rule amended after it was filed, naming each id, date and title; nothing lands', () => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    const before = f.head().sha;
    const r = run(f.dir, 'claim', 'B-1');
    expect(r.code).toBe(2);
    expect(r.err).toBe([
      'baton: B-1 cites rules that spec/BATON_SPEC_HISTORY.md amended after the ticket answered for them (filed 2026-10-20, or a later rules re-read note naming the rule):',
      '  R-BTN-33 — 2026-11-02 — R-BTN-33, R-BTN-150: a range, its title wrapped',
      '  R-BTN-50 — 2026-11-01 — R-BTN-50: the owner’s ruling on Needs you',
      '  R-BTN-150 — 2026-11-02 — R-BTN-33, R-BTN-150: a range, its title wrapped',
      'Re-read each rule and entry, rewrite or strike what in the ticket they contradict, then claim with --rules-reread R-BTN-33,R-BTN-50,R-BTN-150.',
      '',
    ].join('\n'));
    expect(f.head().sha).toBe(before);
    expect(fmOf(f, 'tickets/B-1.mdx').status).toBe('available');
    // `set in-progress` is a claim, and is refused the same way.
    expect(run(f.dir, 'set', 'B-1', 'in-progress').code).toBe(2);
  });

  it('--rules-reread claims, and the claim’s commit records the re-read under ## Status', () => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    const r = run(f.dir, 'claim', 'B-1', '--rules-reread', 'R-BTN-50, R-BTN-150,R-BTN-33');
    expect(r).toMatchObject({ code: 0, err: '' });
    const text = f.at('tickets/B-1.mdx')!;
    expect(parseFrontmatter(text)).toMatchObject({ status: 'in-progress', updated: today() });
    expect(text).toContain(`## Status\n\n_filed 2026-10-20._\n\n_(${today()}: rules re-read at claim: R-BTN-33 (amended 2026-11-02), R-BTN-50 (amended 2026-11-01), R-BTN-150 (amended 2026-11-02))_\n`);
    expect(execFileSync('git', ['-C', f.origin, 'show', '--name-only', '--format=%s', 'main'], { encoding: 'utf8' }).trim().split('\n')).toEqual(['tickets: claim B-1 (in progress)', '', 'tickets/B-1.mdx']);
  });

  it('--rules-reread names exactly the stale ids, or refuses listing the difference; nothing lands', () => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    const before = f.head().sha;
    const r = run(f.dir, 'claim', 'B-1', '--rules-reread', 'R-BTN-50,R-BTN-7');
    expect(r.code).toBe(2);
    expect(r.err.split('\n').slice(0, 3)).toEqual([
      'baton: B-1: --rules-reread names R-BTN-50,R-BTN-7; the rules amended since the ticket answered for them are R-BTN-33,R-BTN-50,R-BTN-150',
      '  not named: R-BTN-33, R-BTN-150',
      '  not amended since: R-BTN-7',
    ]);
    expect(run(f.dir, 'claim', 'B-1', '--rules-reread').err).toBe('baton: --rules-reread needs a value\n');
    expect(run(f.dir, 'claim', 'B-1', '--rules-reread', ',').err).toBe('baton: --rules-reread takes the re-read rule ids, comma-separated: --rules-reread <id>,<id>\n');
    expect(run(f.dir, 'set', 'B-1', 'in-review', '--rules-reread', 'R-BTN-50').err).toBe("baton: --rules-reread is a claim's (claim, or set <id> in-progress), not set in-review's\n");
    expect(f.head().sha).toBe(before);
    // A ticket with nothing stale refuses the flag too: it names ids not amended since.
    const fresh = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', '2026-11-02') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    expect(run(fresh.dir, 'claim', 'B-1', '--rules-reread', 'R-BTN-50').err).toContain('the rules amended since the ticket answered for them are none\n  not amended since: R-BTN-50');
    // `set in-progress` with the right ids claims.
    expect(run(f.dir, 'set', 'B-1', 'in-progress', '--rules-reread', 'R-BTN-33,R-BTN-50,R-BTN-150').code).toBe(0);
  });

  it('an edit after the amendments clears nothing, a `tickets: …` subject or not; with no _filed line, the first commit dates the ticket', () => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', null) }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    edit(f, 'tickets/B-1.mdx', `${citing('B-1', null)}\nA clause struck by a spec PR.\n`, 'spec: R-BTN-50 — strike B-1’s clause\n\ntickets: a body line that is not the subject', '2026-11-05');
    edit(f, 'tickets/B-1.mdx', `${citing('B-1', null)}\nA hand edit with a bookkeeping subject.\n`, 'tickets: B-1 — a hand edit', '2026-11-06');
    const r = run(f.dir, 'claim', 'B-1');
    expect(r.code).toBe(2);
    expect(r.err).toContain('(filed 2026-10-20, or a later rules re-read note naming the rule):\n  R-BTN-33 — 2026-11-02');
  });

  it('a ticket filed after the amendments, one whose re-read notes name every stale id, or a repository with no history file, claims without the flag and without a note', () => {
    const fresh = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', '2026-11-02') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    expect(run(fresh.dir, 'claim', 'B-1').code).toBe(0);
    expect(fresh.at('tickets/B-1.mdx')).not.toContain('rules re-read at claim');
    const handled = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': `${citing('B-1')}\n_(2026-11-03: rules re-read: R-BTN-33, R-BTN-50, R-BTN-150)_\n` }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    expect(run(handled.dir, 'claim', 'B-1').code).toBe(0);
    const none = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1') } });
    expect(run(none.dir, 'claim', 'B-1').code).toBe(0);
  });

  it('check.rules points the guard at another spec’s history and prefix (fieldhouse’s shape)', () => {
    const fh = HISTORY.replace(/R-BTN/g, 'R-FH');
    const f = datedRepo('2026-10-20', {
      existing: { 'tickets/B-1.mdx': citing('B-1').replace('(R-BTN-50)', '(R-FH-50)') },
      files: { 'spec/FIELDHOUSE_SPEC_HISTORY.md': fh, 'spec/BATON_SPEC_HISTORY.md': HISTORY },
      settings: { check: { rules: { prefix: 'R-FH', history: 'spec/FIELDHOUSE_SPEC_HISTORY.md' } } },
    });
    const r = run(f.dir, 'claim', 'B-1');
    expect(r.code).toBe(2);
    expect(r.err).toContain('spec/FIELDHOUSE_SPEC_HISTORY.md amended after the ticket answered for them (filed 2026-10-20, or a later rules re-read note naming the rule):\n  R-FH-50 — 2026-11-01');
    expect(r.err).not.toContain('  R-BTN');
  });
});

describe('baton tickets claim in a shallow clone (2026-11-03)', () => {
  /** A full fixture with a ticket filed 2026-10-20 and no `_filed` line, a later commit, and a
   *  `--depth 1` clone of its origin: the clone's boundary commit is the later one. */
  const shallowOf = (): { f: Fixture; clone: string } => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', null) } });
    edit(f, 'spec/BATON_SPEC_HISTORY.md', HISTORY, 'spec: the history', '2026-11-05');
    const clone = tmp('baton-shallow-');
    rmSync(clone, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${f.origin}`, clone], { stdio: 'ignore' });
    git(clone, 'config', 'user.email', 'b112@test');
    git(clone, 'config', 'user.name', 'b112 test');
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true');
    return { f, clone };
  };

  it('deepens the clone first, so the ticket is dated by its real first commit, not the boundary', () => {
    const { clone } = shallowOf();
    const r = run(clone, 'claim', 'B-1');
    expect(r.code).toBe(2);
    expect(r.err).toContain('(filed 2026-10-20, or a later rules re-read note naming the rule):\n  R-BTN-33 — 2026-11-02');
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('false');
  });

  it('refuses, naming the fix, when the clone cannot be deepened; nothing lands', () => {
    const { f, clone } = shallowOf();
    const before = f.head().sha;
    // A `git` on PATH that fails `fetch --unshallow` and runs every other command.
    const bin = tmp('baton-bin-');
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = --unshallow ] && { echo "fatal: unable to access the remote" >&2; exit 128; }; done\nexec ${real} "$@"\n`, { mode: 0o755 });
    const out = spawnSync(process.execPath, [CLI, 'tickets', 'claim', 'B-1'], { cwd: clone, encoding: 'utf8', env: { ...process.env, BATON_HOME: clone, PATH: `${bin}:${process.env.PATH}` } });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("baton: B-1: this clone is shallow, so the day tickets/B-1.mdx was filed cannot be read, and `git fetch --unshallow origin` failed (fatal: unable to access the remote) — deepen the clone (`git fetch --unshallow`, or clone without --depth), then claim again");
    expect(f.head().sha).toBe(before);
  });
});

describe('baton tickets new: the Trust and Invariants sections (2026-11-03)', () => {
  it('the skeleton carries ### Trust and ### Invariants, with repository-neutral placeholders, between the build and the tests', () => {
    const body = skeletonBody({ description: 'd', deps: [], date: '2026-11-03' });
    expect(sectionGaps(body)).toEqual({ absent: [], unfilled: ['Trust', 'Invariants'] });
    expect(missingSections(body)).toEqual(['Trust', 'Invariants']);
    const at = (h: string) => body.indexOf(`\n${h}\n`);
    expect(at('### What to build')).toBeLessThan(at('### Trust'));
    expect(at('### Trust')).toBeLessThan(at('### Invariants'));
    expect(at('### Invariants')).toBeLessThan(at('### Tests'));
    expect(body).toContain('who may write it and how it is verified');
    // No other repository's ids or paths: every repository's `new` writes this text.
    expect(body).not.toMatch(/R-BTN|docs\/|Baton/);
  });

  it('a section counts as missing when absent, empty or still a placeholder; filled once anything else is written', () => {
    const t = (trust: string, inv = 'R-1: kept.') => `---\nid: B-1\n---\n\n### Trust\n\n${trust}\n\n### Invariants\n\n${inv}\n\n### Tests\n\nx\n`;
    expect(sectionGaps(t('no new input'))).toEqual({ absent: [], unfilled: [] });
    expect(sectionGaps(t(''))).toEqual({ absent: [], unfilled: ['Trust'] });
    expect(sectionGaps(t('_(who may write it.)_'))).toEqual({ absent: [], unfilled: ['Trust'] });
    expect(sectionGaps(t('_(who may write it,\nwrapped.)_'))).toEqual({ absent: [], unfilled: ['Trust'] });
    expect(sectionGaps(t('_(a note)_ and the answer: no new input'))).toEqual({ absent: [], unfilled: [] });
    expect(sectionGaps(t('_(a)_\n\n_(b)_'))).toEqual({ absent: [], unfilled: [] });
    // A sub-heading is the section's own content; the next heading of its level ends it.
    expect(sectionGaps(t('#### The trailer\n\nwritten by the runner, verified by its key'))).toEqual({ absent: [], unfilled: [] });
    expect(sectionGaps('### Trust\n\n## Status\n\nx\n### Invariants\n\nR-1.\n')).toEqual({ absent: [], unfilled: ['Trust'] });
    expect(missingSections('---\nid: B-1\n---\n\n### Trust\n\nx\n\n```\n### Invariants\n```\n')).toEqual(['Invariants']);
  });

  it('after check.sections_since, the skeleton lands with its placeholders and a warning to fill them; the check then fails it until filled', async () => {
    const f = repo({ settings: { check: { sections_since: '2000-01-01' } } });
    const r = run(f.dir, 'new', '--title', 'a');
    expect(r.code).toBe(0);
    expect(r.err).toBe("! B-1: fill ### Trust and ### Invariants — still empty or the skeleton's placeholder, which `baton tickets check` fails as missing (check.sections_since)\n");
    git(f.dir, 'pull', '-q', 'origin', 'main');
    expect((await checkTickets(f.dir, {}, { sections_since: '2000-01-01' })).findings.map((x) => x.message.split(' — ')[0])).toEqual([
      `filed ${today()}, on or after check.sections_since (2000-01-01), and its ### Trust section is empty or still the skeleton's placeholder`,
      `filed ${today()}, on or after check.sections_since (2000-01-01), and its ### Invariants section is empty or still the skeleton's placeholder`,
    ]);
    // Before the cutover (no setting), no warning.
    expect(run(repo().dir, 'new', '--title', 'b').err).toBe('');
  });
});

describe('baton tickets new --body-file: filed and judged like the skeleton (2026-11-03)', () => {
  it('a body with no _filed line gains one under ## Status, so the sections check sees it', () => {
    const f = repo();
    const body = join(f.dir, 'body.md');
    writeFileSync(body, '**Brief:** mine\n\n**Depends on:** none.\n\n### What to build\n\nMine.\n');
    expect(run(f.dir, 'new', '--title', 'a', '--body-file', body).code).toBe(0);
    expect(f.at('tickets/B-1.mdx')).toMatch(/\n## Status\n\n_filed \d{4}-\d{2}-\d{2}\._\n/);
    // A body that already has its own _filed line keeps it, once.
    writeFileSync(body, '**Brief:** mine\n\n**Depends on:** none.\n\n## Status\n\n_filed 2026-01-02._\n');
    expect(run(f.dir, 'new', '--title', 'b', '--body-file', body).code).toBe(0);
    expect(f.at('tickets/B-2.mdx')!.match(/_filed /g)).toHaveLength(1);
  });

  it('after check.sections_since, a body without ### Trust and ### Invariants is refused before the push', () => {
    const f = repo({ settings: { check: { sections_since: '2000-01-01' } } });
    const before = f.head().sha;
    const body = join(f.dir, 'body.md');
    writeFileSync(body, '**Brief:** mine\n\n**Depends on:** none.\n\n### What to build\n\nMine.\n\n### Trust\n\nno new input\n');
    const r = run(f.dir, 'new', '--title', 'a', '--body-file', body);
    expect(r.code).toBe(2);
    expect(r.err).toContain('B-1: filed on or after check.sections_since (2000-01-01), so the body needs ### Invariants (the rules it must not break, by id, and how the design keeps each)');
    expect(f.head().sha).toBe(before);
    writeFileSync(body, '**Brief:** mine\n\n**Depends on:** none.\n\n### What to build\n\nMine.\n\n### Trust\n\nno new input\n\n### Invariants\n\nR-BTN-33: posts no prose.\n');
    expect(run(f.dir, 'new', '--title', 'a', '--body-file', body).code).toBe(0);
  });
});
