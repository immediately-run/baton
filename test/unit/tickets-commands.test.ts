// tickets.test.ts — `baton tickets new | claim | set | done | check` (B-112, BATON_SPEC §2f
// R-BTN-74, §4.2, R-BTN-31): the ported stopgap's suite (scripts/ticket.mjs), against a throwaway
// bare remote. What must hold: every command is one commit on the remote's default branch, made in
// a throwaway worktree, so the caller's branch and tree are untouched; claim refuses a ticket that
// is not available or whose dependencies are not done; done archives; new takes the next free id
// from the configured prefix with a legacy pattern present; --tags, --project (an unknown or
// unconfigured project refused), the written skeleton and its **Depends on:** line, a --body-file
// that disagrees with the flag refused, and a filing the check would refuse left unpushed.
// Node only: it writes real repositories and runs git.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkTickets } from '../../src/defaults/tickets-check';
import { accepts, readTicketSettings, requiresFrom } from '../../src/defaults/tickets-config';
import { PAGE_NAME, ticketsPage } from '../../src/defaults/tickets-page';
import { courseStart, moveTicket, reverseMention, skeletonBody } from '../../src/defaults/tickets';
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

/** The environment a spawned CLI sees: this harness's own Baton variables (BATON_KEY_FILE, a
 *  live runner key, above) scrubbed, so a test's command reads the stand-in Baton its test
 *  names — or none — never the instance this suite happens to run under. */
const childEnv = (dir: string): NodeJS.ProcessEnv => {
  const { BATON_KEY_FILE: _k, BATON_URL: _u, BATON_HOME: _h, ...rest } = process.env;
  return { ...rest, BATON_HOME: dir };
};

/** `baton tickets …` through the CLI's own entry, as an operator runs it: exit code, stdout, stderr. */
const run = (dir: string, ...argv: string[]): { code: number | null; out: string; err: string } => {
  const r = spawnSync(process.execPath, [CLI, 'tickets', ...argv], { cwd: dir, encoding: 'utf8', env: childEnv(dir) });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

/** `run`, without blocking the event loop: the stand-in Baton of B-129's suite answers in this
 *  process, which a `spawnSync` would starve — the CLI's fetch would hang to its timeout. */
const runAsync = (dir: string, ...argv: string[]): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolve) => {
  const child = spawn(process.execPath, [CLI, 'tickets', ...argv], { cwd: dir, env: childEnv(dir) });
  let out = '';
  let err = '';
  child.stdout.on('data', (d: Buffer) => { out += d; });
  child.stderr.on('data', (d: Buffer) => { err += d; });
  child.on('close', (code) => resolve({ code, out, err }));
});

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
  }, 60_000);

  it('the next free number skips the archived ones, and the configured prefix is the one allocated', () => {
    const archived = repo({ existing: { 'tickets/archive/B-7.mdx': ticket('B-7', 'status: done').replace('status: available', ''), 'tickets/B-2.mdx': ticket('B-2') }, settings: { ticket_prefix: 'F', legacy_ids: ['R3-\\d+', 'B-\\d+'] } });
    expect(run(archived.dir, 'new', '--title', 'x').out).toBe('✓ tickets: file F-1 — x\n');
    // F was not among the accepted ids before the prefix named it: its own pattern is `\d+`.
    expect(fmOf(archived, 'tickets/F-1.mdx').id).toBe('F-1');
    const again = run(archived.dir, 'new', '--title', 'y');
    expect(again.out).toBe('✓ tickets: file F-2 — y\n');
  }, 60_000);

  it('the legacy patterns the file names are accepted for a dependency and never allocated', () => {
    const f = repo({ existing: { 'tickets/R3-1249.mdx': ticket('R3-1249', 'status: done') } });
    // A closed ticket may be depended on no more than a live one may (a filing does not wait on
    // a done one, but the id is accepted): an unknown pattern is the refusal.
    expect(run(f.dir, 'new', '--title', 'x', '--depends-on', 'R3-1250').err).toContain('--depends-on R3-1250: no such ticket on origin/main');
    expect(run(f.dir, 'new', '--title', 'x', '--depends-on', 'B-9').err).toContain('--depends-on B-9: no such ticket');
    expect(run(f.dir, 'new', '--title', 'x', '--depends-on', 'Q-1').err).toContain('--depends-on Q-1 is not a ticket id of this repository');
    expect(f.at('tickets/B-1.mdx')).toBeNull();
  }, 60_000);

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
  }, 60_000);

  it('--tags writes what it names, else the file’s tags', () => {
    const f = repo();
    expect(run(f.dir, 'new', '--title', 'expedited', '--tags', 'EXPEDITE,OP').out).toBe('✓ tickets: file B-1 — expedited\n');
    expect(fmOf(f, 'tickets/B-1.mdx').tags).toEqual(['EXPEDITE', 'OP']);
    expect(run(f.dir, 'new', '--title', 'plain').out).toBe('✓ tickets: file B-2 — plain\n');
    expect(fmOf(f, 'tickets/B-2.mdx').tags).toEqual(['roadmap-item']);
    const named = repo({ settings: { tags: ['feature'] } });
    expect(run(named.dir, 'new', '--title', 'x').code).toBe(0);
    expect(fmOf(named, 'tickets/B-1.mdx').tags).toEqual(['feature']);
  }, 30_000);

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
  }, 60_000);

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
  }, 60_000);

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
  }, 60_000);

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
  }, 60_000);
});

describe('baton tickets claim | set | done (B-112)', () => {
  it('claim sets in-progress, and refuses a ticket that is not available or whose dependencies are not done', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-2.mdx': ticket('B-2').replace('**Depends on:** none.', '**Depends on:** B-1.'), 'tickets/B-3.mdx': ticket('B-3', 'status: in-review') } });
    // --offline: git's own refusals, as B-112 had them — B-129's suite below claims with Baton.
    const r = run(f.dir, 'claim', 'B-1', '--offline');
    expect(r).toMatchObject({ code: 0 });
    expect(r.err).toContain('--offline');
    expect(r.out).toMatch(/^✓ tickets: claim B-1 \(in progress\) — pushed as [0-9a-f]{7,}\n$/);
    expect(fmOf(f, 'tickets/B-1.mdx')).toMatchObject({ status: 'in-progress', updated: today() });
    // B-1 is held now: a second claim of it is refused.
    const twice = run(f.dir, 'claim', 'B-1', '--offline');
    expect(twice.code).toBe(2);
    expect(twice.err).toBe('baton: B-1 is in-progress, not available — someone may hold it (claimed with --offline: Baton was not asked)\n');
    // A ticket already in review is not available.
    expect(run(f.dir, 'claim', 'B-3', '--offline').err).toBe('baton: B-3 is in-review, not available — someone may hold it (claimed with --offline: Baton was not asked)\n');
    // An id this repository does not allocate.
    expect(run(f.dir, 'claim', 'Z-1', '--offline').code).toBe(2);
  }, 30_000);

  it('claim refuses a ticket whose dependency is not done, and takes it once the dependency is archived', () => {
    const depends = (id: string, dep: string) => ticket(id).replace('**Depends on:** none.', `**Depends on:** ${dep}.`).replace('depends_on: []', `depends_on:\n  - ${dep}`);
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-2.mdx': depends('B-2', 'B-1') } });
    const waiting = run(f.dir, 'claim', 'B-2', '--offline');
    expect(waiting.code).toBe(2);
    expect(waiting.err).toBe('baton: B-2 depends on B-1, not done yet\n');
    expect(run(f.dir, 'done', 'B-1').code).toBe(0);
    expect(run(f.dir, 'claim', 'B-2', '--offline').code).toBe(0);
  }, 60_000);

  it('a dependency closed in the file but not archived still counts as done', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1').replace('status: available', 'status: superseded'), 'tickets/B-2.mdx': ticket('B-2').replace('**Depends on:** none.', '**Depends on:** B-1.').replace('depends_on: []', 'depends_on:\n  - B-1') } });
    expect(run(f.dir, 'claim', 'B-2', '--offline').code).toBe(0);
  }, 60_000);

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
  }, 30_000);

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
    expect(run(f.dir, 'claim', 'B-1', '--offline').err).toBe('baton: B-1 is archived (done)\n');
    expect(run(f.dir, 'done', 'B-1').err).toBe('baton: B-1 is archived (done)\n');
  }, 60_000);

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
  }, 60_000);
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
  }, 60_000);

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
  }, 60_000);

  it('the reverse mention adds a name to the line, or writes the line where the ticket has none', () => {
    const withLine = '**Brief:** x\n\n**Used by:** nothing yet.\n\nProse.\n';
    expect(reverseMention(withLine, 'B-2')).toBe('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n');
    expect(reverseMention('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n', 'B-3')).toBe('**Brief:** x\n\n**Used by:** B-2, B-3.\n\nProse.\n');
    expect(reverseMention('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n', 'B-2')).toBe('**Brief:** x\n\n**Used by:** B-2.\n\nProse.\n');
    // No **Used by:** line: one is written at the end of the opening header block.
    expect(reverseMention('**Brief:** x\n\n**Depends on:** none.\n\n### What to build\n', 'B-4')).toBe('**Brief:** x\n**Used by:** B-4.\n\n**Depends on:** none.\n\n### What to build\n');
  }, 60_000);
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

/* ──────────────────────────────────────────────────────────────────────────────────────────
 * B-129 — the claim asks Baton first, and continues the ticket where Baton holds it.
 * Against a fake Baton (node:http) and the bare origin above: the B-91 replay (a release wrote
 * `status: available` / `prs: []` over an open PR; Baton held the ticket at pr-open with review
 * ready), the live claim that refuses naming its holder and the lease's end, a ticket at its
 * start that claims as before, the unreachable Baton that refuses (and --offline that does not),
 * and the release that keeps every prs: entry — refusing the write that would drop an open PR.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/** A stand-in Baton answering the three reads the claim makes, recording what it was asked. */
const PR109 = 'https://github.com/immediately-run/baton/pull/109';
async function fakeBaton(state: {
  ready?: Record<string, unknown>[];
  holders?: Record<string, unknown>[];
  history?: Record<string, unknown>[];
  resume?: Record<string, unknown> | null;
  branchHolder?: Record<string, unknown>;
  boardStatus?: number;
  serverTime?: number;
}): Promise<{ url: string; asked: string[]; close: () => void }> {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://baton.test');
    asked.push(`${req.method} ${url.pathname}${url.search}`);
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return reply(405, { ok: false, code: 'not-found', message: 'the reads are GETs' });
    if (url.pathname === '/v1/repositories/baton/board') {
      if (state.boardStatus != null) return reply(state.boardStatus, { ok: false, code: state.boardStatus === 403 ? 'forbidden' : 'unauthenticated', message: 'not this key' });
      return reply(200, { repository: { id: 'baton' }, ready: state.ready ?? [], ready_by_tier: {}, holders: state.holders ?? [], granted_capabilities: null, server_time: state.serverTime ?? 0 });
    }
    if (/^\/v1\/repositories\/baton\/tickets\/([^/]+)\/history$/.test(url.pathname)) {
      return reply(200, { rows: state.history ?? [], ...(state.resume === undefined ? {} : { resume: state.resume }) });
    }
    if (url.pathname === '/v1/runner/branch-holder') return reply(200, state.branchHolder ?? { tickets: [], held_by_other: false, fence_pending: false });
    return reply(404, { ok: false, code: 'not-found', message: `no route ${url.pathname}` });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { address: string; port: number };
  return { url: `http://${address.address}:${address.port}`, asked, close: () => server.close() };
}

/** A repository whose checkout names its Baton id: the `repos` map carries the origin's own URL,
 * so `batonTarget` resolves `baton` from it, and `.baton/courses/create-pr/course.json` is there
 * for the start station. */
function namedRepo(opts: Parameters<typeof repo>[0] & { courseFile?: boolean } = {}): Fixture {
  const f = repo(opts);
  const settings = JSON.parse(readFileSync(join(f.dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
  settings.repos = { baton: git(f.dir, 'remote', 'get-url', 'origin') };
  writeFileSync(join(f.dir, '.baton', 'baton.json'), `${JSON.stringify(settings, null, 2)}\n`);
  if (opts.courseFile !== false) {
    mkdirSync(join(f.dir, '.baton', 'courses', 'create-pr'), { recursive: true });
    writeFileSync(join(f.dir, '.baton', 'courses', 'create-pr', 'course.json'), JSON.stringify({ start: 'filed', start_leg: 'implement', end: ['merged'], stations: {}, legs: {} }, null, 2));
  }
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'fixture: the repos map and the course file');
  git(f.dir, 'push', '-q', 'origin', 'HEAD:main');
  return f;
}

describe('baton tickets claim asks Baton first (B-129)', () => {
  /** B-91's 2026-10-27 state: the frontmatter says available with no PRs; Baton holds the ticket
   *  at pr-open, review ready, its claim released with #109 on the seeded-owner-keys branch. */
  const B91 = {
    ready: [{ id: 'baton:B-91', local_id: 'B-91', station: 'pr-open', leg: 'review' }],
    history: [
      { id: 3, kind: 'leg-finished', leg: 'review', reached: 'reviewed', next_leg: 'fix' },
      { id: 2, kind: 'leg-started', leg: 'review', reached: null },
      { id: 1, kind: 'leg-finished', leg: 'implement', reached: 'pr-open', next_leg: 'review' },
    ],
    resume: { end_reason: 'released:requested', ended_at: Date.parse('2026-10-27T09:15:00Z'), branches: ['claude/B-91-seed-owner-keys'], prs: [PR109] },
    branchHolder: { tickets: ['baton:B-91'], held_by_other: false, fence_pending: false },
  };
  /** A B-91 file with one `status:` line and the PRs named: no duplicated keys, so what the
   *  commit writes is what the markdown source reads back. */
  const b91File = (status: string, prs: string[]): string =>
    ticket('B-91').replace('status: available', `status: ${status}`).replace('prs: []', prs.length ? `prs:\n${prs.map((p) => `  - ${p}`).join('\n')}` : 'prs: []');
  let key: string;
  let keyFile: string;

  beforeEach(() => {
    keyFile = join(tmp('baton-b129-key-'), 'worker.key');
    mkdirSync(dirname(keyFile), { recursive: true });
    key = `bak_${'0'.repeat(16)}_${'a'.repeat(64)}`;
    writeFileSync(keyFile, `${key}\n`);
  });

  it('replaying B-91: the claim takes the ticket over at pr-open, printing and restoring #109', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const baton = await fakeBaton(B91);
    try {
      const before = f.head().sha;
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      // The session starts from Baton's position: the station, the ready leg, the PR, the branch
      // and where the hand-off is.
      expect(r.out).toContain('B-91: Baton holds it at pr-open, review ready — you are taking it over, not starting it');
      expect(r.out).toContain(`  PR: ${PR109}`);
      expect(r.out).toContain('  branch: claude/B-91-seed-owner-keys — continue on it, never `checkout -b` a new one');
      expect(r.out).toContain('  hand-off: released:requested 2026-10-27T09:15:00.000Z — read it: git log -1 tickets/B-91.mdx');
      // The three reads the ticket names, and only them: the board, the history, and the
      // branch-holder query for the branch the history named.
      expect(baton.asked.map((x) => x.replace(/\?.*$/, ''))).toEqual([
        'GET /v1/repositories/baton/board',
        'GET /v1/repositories/baton/tickets/baton%3AB-91/history',
        'GET /v1/runner/branch-holder',
      ]);
      // The commit writes Baton's record back: in-progress, and `prs:` restored to #109.
      expect(fmOf(f, 'tickets/B-91.mdx')).toMatchObject({ status: 'in-progress' });
      expect(f.at('tickets/B-91.mdx')).toContain(`prs:\n  - ${PR109}`);
      // The hand-off rides on the commit, where the next session reads it.
      const message = git(f.origin, 'log', '-1', '--format=%B', 'main');
      expect(message).toContain('tickets: claim B-91 (in progress — continuing where Baton holds it: pr-open, review ready)');
      expect(message).toContain(`PR ${PR109}`);
      expect(message).toContain('Station: pr-open (Baton)');
      expect(message).toContain("Next: review from pr-open (Baton's ready row) — baton tickets claim B-91 continues there");
      expect(message).toContain('Branch: claude/B-91-seed-owner-keys');
      expect(f.head().parent).toBe(before);
    } finally {
      baton.close();
    }
  }, 60_000);

  it('the same state with a live claim by another worker refuses, naming the holder and the lease', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const leaseEnds = Date.parse('2026-10-27T11:00:00Z');
    const baton = await fakeBaton({ ...B91, holders: [{ ticket_id: 'baton:B-91', worker_id: 7, hostname: 'host-3', session_name: 'claude-review', lease_ends_at: leaseEnds }] });
    try {
      const before = f.head().sha;
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', baton.url);
      expect(r.code).toBe(2);
      expect(r.err).toBe(`baton: B-91 is held by host-3 · claude-review (worker 7), its lease ends 2026-10-27T11:00:00.000Z — its lease has not ended; it is released or reaped first (Baton's board, B-129)\n`);
      expect(f.head().sha).toBe(before);
    } finally {
      baton.close();
    }
  }, 60_000);

  it("a branch another live claim holds refuses the takeover, and a fence-pending branch too", async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const held = await fakeBaton({ ...B91, branchHolder: { tickets: ['baton:B-91'], held_by_other: true, fence_pending: false } });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', held.url);
      expect(r.code).toBe(2);
      expect(r.err).toContain("B-91's branch claude/B-91-seed-owner-keys is held by another live claim");
    } finally {
      held.close();
    }
    const fenced = await fakeBaton({ ...B91, branchHolder: { tickets: ['baton:B-91'], held_by_other: false, fence_pending: true } });
    try {
      expect((await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', fenced.url)).err).toContain('fence-pending');
    } finally {
      fenced.close();
    }
  }, 60_000);

  it('a ticket at its start station with no holder claims as before', async () => {
    const f = namedRepo({ existing: { 'tickets/B-5.mdx': ticket('B-5') } });
    const baton = await fakeBaton({ ready: [], holders: [], history: [], resume: null });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-5', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(r.out).toMatch(/^✓ tickets: claim B-5 \(in progress\) — pushed as [0-9a-f]{7,}\n$/);
      expect(fmOf(f, 'tickets/B-5.mdx')).toMatchObject({ status: 'in-progress' });
      // No branch was named, so the branch-holder query was never asked.
      expect(baton.asked.filter((x) => x.includes('branch-holder'))).toEqual([]);
    } finally {
      baton.close();
    }
  }, 60_000);

  it('an unanswered read refuses — unreachable, forbidden, no key — and --offline claims', async () => {
    const f = namedRepo({ existing: { 'tickets/B-5.mdx': ticket('B-5') } });
    const before = f.head().sha;
    // Unreachable: nothing listens there.
    const dead = await runAsync(f.dir, 'claim', 'B-5', '-i', keyFile, '--url', 'http://127.0.0.1:9');
    expect(dead.code).toBe(2);
    expect(dead.err).toContain('the board of baton: Baton at http://127.0.0.1:9 is unreachable');
    expect(dead.err).toContain("--offline to claim on git's word alone");
    expect(f.head().sha).toBe(before);
    // Forbidden: the key is not granted on the repository.
    const refused = await fakeBaton({ boardStatus: 403 });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-5', '-i', keyFile, '--url', refused.url);
      expect(r.code).toBe(2);
      expect(r.err).toContain('the board of baton: forbidden');
    } finally {
      refused.close();
    }
    // No key at all: the frontmatter is not a fallback.
    const bare = spawnSync(process.execPath, [CLI, 'tickets', 'claim', 'B-5'], { cwd: f.dir, encoding: 'utf8', env: childEnv(f.dir) });
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain("claim reads Baton's record of the ticket first (B-129) — pass -i KEY");
    // --offline claims on git's word alone, saying what it did not know.
    const offline = run(f.dir, 'claim', 'B-5', '--offline');
    expect(offline.code).toBe(0);
    expect(offline.err).toContain("claimed on git's word alone (--offline)");
    expect(fmOf(f, 'tickets/B-5.mdx')).toMatchObject({ status: 'in-progress' });
  }, 30_000);

  it('a release keeps every prs: entry and its commit carries the hand-off', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('in-progress', [PR109]) } });
    const baton = await fakeBaton(B91);
    try {
      const r = await runAsync(f.dir, 'set', 'B-91', 'available', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(fmOf(f, 'tickets/B-91.mdx')).toMatchObject({ status: 'available' });
      expect(f.at('tickets/B-91.mdx')).toContain(`prs:\n  - ${PR109}`);
      const message = git(f.origin, 'log', '-1', '--format=%B', 'main');
      expect(message).toBe([
        'tickets: release B-91 → available',
        '',
        `PR ${PR109}`,
        'Station: pr-open (Baton)',
        "Next: review from pr-open (Baton's ready row) — baton tickets claim B-91 continues there",
        'Branch: claude/B-91-seed-owner-keys',
      ].join('\n'));
    } finally {
      baton.close();
    }
  }, 60_000);

  it('a release\'s --note is the hand-off\'s "what is left", and --note is a release\'s alone', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('in-progress', [PR109]) } });
    const baton = await fakeBaton(B91);
    try {
      const r = await runAsync(f.dir, 'set', 'B-91', 'available', '--note', 'round 3 findings 2 and 5 open;\n the rest fixed', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      const message = git(f.origin, 'log', '-1', '--format=%B', 'main');
      expect(message).toContain("Next: review from pr-open (Baton's ready row)");
      expect(message).toContain('Left: round 3 findings 2 and 5 open; the rest fixed');
      const wrong = await runAsync(f.dir, 'set', 'B-91', 'in-review', '--note', 'x', '-i', keyFile, '--url', baton.url);
      expect(wrong.code).toBe(2);
      expect(wrong.err).toContain('--note is a release\'s hand-off');
    } finally {
      baton.close();
    }
    // Offline, the note is still the hand-off — Baton's lines are left out, never guessed.
    const f2 = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('in-progress', [PR109]) } });
    expect(run(f2.dir, 'set', 'B-91', 'available', '--offline', '--note', 'review round 2 next').code).toBe(0);
    expect(git(f2.origin, 'log', '-1', '--format=%B', 'main')).toBe(`tickets: release B-91 → available\n\nPR ${PR109}\nLeft: review round 2 next`);
  }, 60_000);

  it("a write that would drop an open PR is refused: Baton holds the ticket past its start", async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const baton = await fakeBaton(B91);
    try {
      const before = f.head().sha;
      const r = await runAsync(f.dir, 'set', 'B-91', 'available', '-i', keyFile, '--url', baton.url);
      expect(r.code).toBe(2);
      expect(r.err).toContain(`B-91: this write would drop ${PR109} — Baton's record holds that PR for a ticket it offers ready at pr-open (review), past its start`);
      expect(r.err).toContain('take it over instead');
      expect(f.head().sha).toBe(before);
    } finally {
      baton.close();
    }
    // With Baton unreadable the release proceeds on git's own word, warning as it goes: a
    // release must be possible while Baton is down, and this write drops nothing git had.
    const warned = await runAsync(f.dir, 'set', 'B-91', 'available', '-i', keyFile, '--url', 'http://127.0.0.1:9');
    expect(warned.code).toBe(0);
    expect(warned.err).toContain('continuing on git\'s own record');
    expect(fmOf(f, 'tickets/B-91.mdx')).toMatchObject({ status: 'available' });
  }, 60_000);

  it('done is never refused by the drop-PR guard', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('in-review', []) } });
    const baton = await fakeBaton(B91);
    try {
      const r = await runAsync(f.dir, 'done', 'B-91', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(parseFrontmatter(f.at('tickets/archive/B-91.mdx')!)).toMatchObject({ status: 'done' });
    } finally {
      baton.close();
    }
  }, 60_000);

  it('a takeover overrides only a false available: the git lock, a parked or closed status and an undone dependency still refuse', async () => {
    const baton = await fakeBaton(B91);
    try {
      for (const status of ['in-progress', 'in-review']) {
        const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File(status, [PR109]) } });
        const before = f.head().sha;
        const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', baton.url);
        expect(r.code).toBe(2);
        expect(r.err).toBe(`baton: B-91 is ${status} in git — a git-lock holder may hold it; Baton's position (pr-open) overrides only a false available, never the git lock\n`);
        expect(f.head().sha).toBe(before);
      }
      for (const status of ['deferred', 'deprioritized', 'superseded']) {
        const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File(status, [PR109]) } });
        const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', baton.url);
        expect(r.code).toBe(2);
        expect(r.err).toMatch(/^baton: B-91 is [a-z-]+ in git — parked or closed; Baton's position \(pr-open\) overrides only a false available\n$/);
      }
      const depends = b91File('available', []).replace('**Depends on:** none.', '**Depends on:** B-1.').replace('depends_on: []', 'depends_on:\n  - B-1');
      const f = namedRepo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-91.mdx': depends } });
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', baton.url);
      expect(r.code).toBe(2);
      expect(r.err).toBe('baton: B-91 depends on B-1, not done yet\n');
    } finally {
      baton.close();
    }
  }, 120_000);

  it('a ticket moved back to its start is judged by where Baton holds it now: a fresh claim, not a takeover', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    // The history once reached pr-open; the board now offers implement from filed — the start.
    const baton = await fakeBaton({ ...B91, ready: [{ id: 'baton:B-91', local_id: 'B-91', station: 'filed', leg: 'implement' }] });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(r.out).toMatch(/^✓ tickets: claim B-91 \(in progress\) — pushed as [0-9a-f]{7,}\n$/);
      expect(f.at('tickets/B-91.mdx')).toContain('prs: []');
    } finally {
      baton.close();
    }
  }, 60_000);

  it('with no local course file the start is the standard course\'s: a ticket whose newest reached row is the start is a fresh claim, one past it a takeover', async () => {
    // No `.baton/courses/create-pr/course.json` (a sourced course, a repository with no course
    // code): the start comes from the standard create-pr course (`filed`), never from whichever
    // row the path reached.
    const f = namedRepo({ courseFile: false, existing: { 'tickets/B-91.mdx': b91File('available', []), 'tickets/B-92.mdx': ticket('B-92') } });
    expect(existsSync(join(f.dir, '.baton', 'courses', 'create-pr', 'course.json'))).toBe(false);
    // Moved back to its start: the board offers nothing ready, and the newest row that reached a
    // station reached `filed`, over an older pr-open.
    const back = await fakeBaton({ ...B91, ready: [], history: [{ id: 4, kind: 'git-moved', reached: 'filed', next_leg: 'implement' }, ...B91.history] });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', back.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(r.out).toMatch(/^✓ tickets: claim B-91 \(in progress\) — pushed as [0-9a-f]{7,}\n$/);
      expect(f.at('tickets/B-91.mdx')).toContain('prs: []');
    } finally {
      back.close();
    }
    // Past it (the history's newest reached row is `reviewed`): the takeover, as with a file.
    const past = await fakeBaton({ ...B91, ready: [] });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-92', '-i', keyFile, '--url', past.url);
      expect(r.code).toBe(0);
      expect(r.out).toContain('B-92: Baton holds it at reviewed — you are taking it over, not starting it');
    } finally {
      past.close();
    }
  }, 60_000);

  it('the start follows the repository\'s default_course when the ticket names no course (round 3)', () => {
    // A build-app repository with no course code: a ticket with no `course:` starts at build-app's
    // `requested`, not create-pr's `filed`, so a ticket Baton holds at `requested` is no takeover.
    const root = mkdtempSync(join(tmpdir(), 'baton-start-'));
    mkdirSync(join(root, '.baton'), { recursive: true });
    mkdirSync(join(root, 'tickets'), { recursive: true });
    writeFileSync(join(root, 'tickets', 'T-1.mdx'), '---\nid: T-1\ntitle: probe\nstatus: available\n---\n\nbody\n');
    writeFileSync(join(root, 'tickets', 'T-2.mdx'), '---\nid: T-2\ntitle: probe\nstatus: available\ncourse: create-pr\n---\n\nbody\n');
    writeFileSync(join(root, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', default_course: 'build-app', repos: {} }));
    try {
      expect(courseStart(root, 'T-1')).toBe('requested');
      expect(courseStart(root, 'T-2')).toBe('filed');
      writeFileSync(join(root, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', repos: {} }));
      expect(courseStart(root, 'T-1')).toBe('filed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('every release writes its subject and PR lines; Baton\'s lines only past the start', async () => {
    const PR7 = 'https://github.com/immediately-run/baton/pull/7';
    const f = namedRepo({ existing: { 'tickets/B-5.mdx': ticket('B-5', 'status: in-progress').replace('status: available\n', '').replace('prs: []', `prs:\n  - ${PR7}`) } });
    // At its start, no note: the release subject and the PR line, no Baton line.
    const atStart = await fakeBaton({ ready: [{ id: 'baton:B-5', local_id: 'B-5', station: 'filed', leg: 'implement' }], holders: [], history: [], resume: null });
    try {
      const r = await runAsync(f.dir, 'set', 'B-5', 'available', '-i', keyFile, '--url', atStart.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(git(f.origin, 'log', '-1', '--format=%B', 'main')).toBe(`tickets: release B-5 → available\n\nPR ${PR7}`);
    } finally {
      atStart.close();
    }
    // Offline, no note: the same two lines — git's word, Baton's lines left out.
    expect(run(f.dir, 'set', 'B-5', 'in-progress', '--offline').code).toBe(0);
    expect(run(f.dir, 'set', 'B-5', 'available', '--offline').code).toBe(0);
    expect(git(f.origin, 'log', '-1', '--format=%B', 'main')).toBe(`tickets: release B-5 → available\n\nPR ${PR7}`);
    // A ticket naming no PR: the subject alone.
    const g = namedRepo({ existing: { 'tickets/B-6.mdx': ticket('B-6', 'status: in-progress').replace('status: available\n', '') } });
    expect(run(g.dir, 'set', 'B-6', 'available', '--offline').code).toBe(0);
    expect(git(g.origin, 'log', '-1', '--format=%B', 'main')).toBe('tickets: release B-6 → available');
  }, 60_000);

  it('a holder whose lease has ended awaits reaping, and a legacy holder has no lease: both refuse, naming it', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const ended = Date.parse('2026-10-27T11:00:00Z');
    const stale = await fakeBaton({ ...B91, serverTime: ended + 60_000, holders: [{ ticket_id: 'baton:B-91', worker_id: 7, hostname: 'host-3', session_name: 'claude-review', lease_ends_at: ended }] });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', stale.url);
      expect(r.code).toBe(2);
      expect(r.err).toBe("baton: B-91 is held by host-3 · claude-review (worker 7), its lease ended 2026-10-27T11:00:00.000Z and the claim awaits reaping; it is reaped first (Baton's board, B-129)\n");
    } finally {
      stale.close();
    }
    const legacy = await fakeBaton({ ...B91, holders: [{ ticket_id: 'baton:B-91', worker_id: 3, hostname: 'legacy', session_name: 'item-B-91', lease_ends_at: null }] });
    try {
      const r = await runAsync(f.dir, 'claim', 'B-91', '-i', keyFile, '--url', legacy.url);
      expect(r.code).toBe(2);
      expect(r.err).toBe("baton: B-91 is held by legacy · item-B-91 (worker 3), a claim with no lease to end (a legacy claim); it is released, adopted or reaped first (Baton's board, B-129)\n");
    } finally {
      legacy.close();
    }
  }, 60_000);

  it('a key that is missing or unreadable is named as the key\'s problem, never Baton unreachable — and Baton is not asked', async () => {
    const f = namedRepo({ existing: { 'tickets/B-5.mdx': ticket('B-5') } });
    const baton = await fakeBaton({});
    try {
      const missing = await runAsync(f.dir, 'claim', 'B-5', '-i', join(dirname(keyFile), 'nope.key'), '--url', baton.url);
      expect(missing.code).toBe(2);
      expect(missing.err).toContain(`no key: ${join(dirname(keyFile), 'nope.key')} does not exist — the reads cannot be signed, so Baton was not asked`);
      expect(missing.err).not.toContain('unreachable');
      const junk = join(dirname(keyFile), 'junk.key');
      writeFileSync(junk, 'not a key\n');
      const unreadable = await runAsync(f.dir, 'claim', 'B-5', '-i', junk, '--url', baton.url);
      expect(unreadable.code).toBe(2);
      expect(unreadable.err).toContain('key unreadable:');
      expect(unreadable.err).not.toContain('unreachable');
      expect(baton.asked).toEqual([]);
    } finally {
      baton.close();
    }
  }, 60_000);
});
