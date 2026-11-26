// tickets.test.ts — `baton tickets next | check` (B-112, B-326; BATON_SPEC §4.2 R-BTN-74, S-BTN-189):
// against a throwaway bare remote. Ticket files are Dibber's to write (B-326): `new`, `claim`,
// `set` and `done` are refused, each naming its `dibber` command, and nothing lands. What a claim
// must know first is `check <id> --claimable`, which writes nothing: it is not claimable (exit 1)
// for a ticket that is not available or whose dependencies are not done, one citing a rule amended
// since it answered for it (until a rules re-read note, Dibber's included, names the ids), and one
// another live claim holds in Baton; a ticket Baton holds past its start is a takeover, printed.
// The commit-message builder (B-16) is `baton request`'s, and stays tested here.
// Node only: it writes real repositories and runs git.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkTickets } from '../../src/defaults/tickets-check';
import { accepts, readTicketSettings } from '../../src/defaults/tickets-config';
import { PAGE_NAME, ticketsPage } from '../../src/defaults/tickets-page';
import { courseStart, ticketCommitMessage } from '../../src/defaults/tickets';
import { unnamedEntries } from '../../scripts/check-spec.mjs';
import { appendStatus, entryIds, filingDate, firstCommit, firstCommits, historyEntries, missingSections, rereadNote, rereads, ruleIds, rulesConfig, sectionGaps, sectionsDate, staleRules } from '../../src/defaults/tickets-rules';
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

/** The environment a spawned CLI sees: this harness's own Baton variables (BATON_KEY_FILE, a
 *  live runner key, above) and trailer variables (TICKET_TRAILERS, TICKET_REQUIRE_TRAILERS — B-16,
 *  set by the agent workflow this suite may run under) scrubbed, so a test's command reads the
 *  stand-in Baton its test names — or none — never the instance this suite happens to run under,
 *  and no test's commit grows trailers the harness left in the environment. */
const childEnv = (dir: string): NodeJS.ProcessEnv => {
  const { BATON_KEY_FILE: _k, BATON_URL: _u, BATON_HOME: _h, TICKET_TRAILERS: _t, TICKET_REQUIRE_TRAILERS: _r, ...rest } = process.env;
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



/** `check <id> --claimable` as an operator runs it, offline unless Baton is named. */
const claimable = (dir: string, id: string, ...more: string[]) => run(dir, 'check', id, '--claimable', ...(more.length ? more : ['--offline']));

describe('the retired verbs (B-326, S-BTN-189)', () => {
  it('new, claim, set and done are refused, each naming its dibber command, and nothing lands', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1') } });
    const before = f.head().sha;
    const want: Record<string, string> = {
      new: 'dibber new --title',
      claim: 'baton tickets check <id> --claimable, then dibber claim <id>',
      set: 'dibber set <id> <status>',
      done: 'dibber done <id>',
    };
    for (const [verb, replacement] of Object.entries(want)) {
      const r = run(f.dir, verb, ...(verb === 'new' ? ['--title', 'x'] : ['B-1', '--offline']));
      expect(r.code).toBe(2);
      expect(r.err).toContain(`baton: baton tickets ${verb} is retired — ticket files are Dibber's to write (B-326): `);
      expect(r.err).toContain(replacement);
    }
    expect(f.head().sha).toBe(before);
    expect(fmOf(f, 'tickets/B-1.mdx').status).toBe('available');
    // A verb the CLI never had names the two it keeps.
    expect(run(f.dir, 'grab', 'B-1').err).toBe('baton: grab: baton tickets next|check (baton tickets --help)\n');
    expect(run(f.dir, '--help').out).toContain('baton tickets check <id> --claimable');
  }, 30_000);
});

describe('baton tickets check --claimable: git\'s word (B-326, S-BTN-189)', () => {
  const depends = (id: string, dep: string) => ticket(id).replace('**Depends on:** none.', `**Depends on:** ${dep}.`).replace('depends_on: []', `depends_on:\n  - ${dep}`);

  it('an available ticket is claimable, and the claim to make is named; nothing is written', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-3.mdx': ticket('B-3', 'status: in-review').replace('status: available\n', '') } });
    const before = f.head().sha;
    const r = claimable(f.dir, 'B-1');
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toBe("B-1: claimable on git's word alone (--offline: Baton's position is unknown, not refuted) — claim it with: dibber claim B-1\n");
    // A ticket that is not available is not claimable: exit 1, the reason on stdout.
    expect(claimable(f.dir, 'B-3')).toMatchObject({ code: 1, out: 'B-3: not claimable — B-3 is in-review, not available — someone may hold it (--offline: Baton was not asked)\n' });
    // An id this repository does not take is a refusal, not a finding.
    expect(claimable(f.dir, 'Z-1').code).toBe(2);
    expect(f.head().sha).toBe(before);
    expect(git(f.dir, 'worktree', 'list').split('\n')).toHaveLength(1);
  }, 30_000);

  it('an undone dependency is not claimable; an archived or a closed one is done', () => {
    const f = repo({ existing: {
      'tickets/B-1.mdx': ticket('B-1'),
      'tickets/B-2.mdx': depends('B-2', 'B-1'),
      'tickets/archive/B-4.mdx': ticket('B-4').replace('status: available', 'status: done'),
      'tickets/B-5.mdx': depends('B-5', 'B-4'),
      'tickets/B-6.mdx': ticket('B-6').replace('status: available', 'status: superseded'),
      'tickets/B-7.mdx': depends('B-7', 'B-6'),
      'tickets/B-8.mdx': ticket('B-8').replace('status: available', 'status: done'),
      'tickets/B-9.mdx': depends('B-9', 'B-8'),
    } });
    expect(claimable(f.dir, 'B-2')).toMatchObject({ code: 1, out: 'B-2: not claimable — B-2 depends on B-1, not done yet\n' });
    expect(claimable(f.dir, 'B-5').code).toBe(0);
    expect(claimable(f.dir, 'B-7').code).toBe(0);
    // Dibber's `done` leaves the file in place: done all the same.
    expect(claimable(f.dir, 'B-9').code).toBe(0);
  }, 60_000);

  it('a qualified dependency resolves through the repos map and gates the claim on the target\'s own board (B-113)', () => {
    const target = tmp('baton-b113-target-');
    execFileSync('git', ['init', '-q', '-b', 'main', target], { stdio: 'ignore' });
    git(target, 'config', 'user.email', 'b113@test');
    git(target, 'config', 'user.name', 'b113');
    mkdirSync(join(target, '.baton'), { recursive: true });
    writeFileSync(join(target, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', repos: {} }));
    mkdirSync(join(target, 'tickets', 'archive'), { recursive: true });
    writeFileSync(join(target, 'tickets', 'archive', 'B-1.mdx'), ticket('B-1').replace('status: available', 'status: done'));
    writeFileSync(join(target, 'tickets', 'B-2.mdx'), ticket('B-2').replace('status: available', 'status: done'));
    writeFileSync(join(target, 'tickets', 'B-3.mdx'), ticket('B-3'));
    git(target, 'add', '-A');
    git(target, 'commit', '-qm', 'target fixture');
    const f = repo({
      settings: { repos: { target } },
      existing: {
        'tickets/B-9.mdx': depends('B-9', 'target:B-1'),
        'tickets/B-10.mdx': depends('B-10', 'target:B-2'),
        'tickets/B-11.mdx': depends('B-11', 'target:B-3'),
        'tickets/B-12.mdx': depends('B-12', 'target:B-99'),
        'tickets/B-13.mdx': depends('B-13', 'ghost:B-1'),
      },
    });
    expect(claimable(f.dir, 'B-9').code).toBe(0);
    expect(claimable(f.dir, 'B-10').code).toBe(0);
    expect(claimable(f.dir, 'B-11').out).toBe('B-11: not claimable — B-11 depends on target:B-3, not done yet\n');
    expect(claimable(f.dir, 'B-12').err).toContain('target:B-99, which is neither live nor archived on');
    expect(claimable(f.dir, 'B-13').err).toContain('ghost: the baton.json repos map does not resolve it');
  }, 60_000);

  it('a self-qualified dependency reads as its local id: the same checkout answers it, offline and all (B-113 round 1)', () => {
    const f = repo({ existing: {
      'tickets/B-1.mdx': ticket('B-1').replace('status: available', 'status: superseded'),
      'tickets/B-2.mdx': ticket('B-2'),
      'tickets/B-9.mdx': depends('B-9', 'baton:B-1'),
      'tickets/B-10.mdx': depends('B-10', 'baton:B-2'),
    } });
    writeFileSync(join(f.dir, '.baton', 'baton.json'), `${JSON.stringify({ items: 'tickets', default_course: 'create-pr', repos: { baton: f.origin }, ticket_prefix: 'B', legacy_ids: ['R3-\\d+'], project: 'baton' }, null, 2)}\n`);
    git(f.dir, 'add', '-A');
    git(f.dir, 'commit', '-qm', 'name the own repository in the repos map');
    git(f.dir, 'push', '-q', 'origin', 'HEAD:main');
    expect(claimable(f.dir, 'B-9').code).toBe(0);
    expect(claimable(f.dir, 'B-10').out).toBe('B-10: not claimable — B-10 depends on baton:B-2, not done yet\n');
    const unnamed = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-9.mdx': depends('B-9', 'baton:B-1') } });
    expect(claimable(unnamed.dir, 'B-9').err).toContain('baton: the baton.json repos map does not resolve it');
  }, 60_000);

  it('dependencyRemote reads the repos map: a forge path is GitHub\'s, a remote as written', async () => {
    const { dependencyRemote } = await import('../../src/defaults/tickets');
    expect(dependencyRemote({ baton: 'immediately-run/baton' }, 'baton')).toBe('https://github.com/immediately-run/baton');
    expect(dependencyRemote({ local: '/srv/git/local.git' }, 'local')).toBe('/srv/git/local.git');
    expect(dependencyRemote({ ssh: 'git@github.com:immediately-run/baton.git' }, 'ssh')).toBe('git@github.com:immediately-run/baton.git');
    expect(() => dependencyRemote({}, 'ghost')).toThrow('ghost: the baton.json repos map does not resolve it');
  });

  it('the check reads the fetched default head, never the caller\'s branch', () => {
    const f = repo({ existing: { 'tickets/B-1.mdx': ticket('B-1') } });
    // The caller's own branch says in-progress; the remote's default branch says available.
    git(f.dir, 'checkout', '-q', '-b', 'mine');
    writeFileSync(join(f.dir, 'tickets', 'B-1.mdx'), ticket('B-1', 'status: in-progress').replace('status: available\n', ''));
    git(f.dir, 'commit', '-qam', 'local');
    expect(claimable(f.dir, 'B-1').code).toBe(0);
    expect(git(f.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('mine');
  }, 30_000);
});

describe('the ticket commands’ commits: provenance trailers (B-16)', () => {
  it('the builder appends TICKET_TRAILERS after a blank line, keeps a message without them, and refuses an empty one under TICKET_REQUIRE_TRAILERS=1', () => {
    const trailers = 'Agent-Role: implement\nClaude-Session: ses-1\nCo-Authored-By: Claude <noreply@anthropic.com>';
    // With trailers: the command's message, a blank line, then the value whole.
    expect(ticketCommitMessage('tickets: claim B-1 (in progress)', trailers)).toBe(`tickets: claim B-1 (in progress)\n\n${trailers}`);
    // A message that already carries a body (a PR, a hand-off) takes them after it: the trailers
    // are the last paragraph, where git reads them.
    const done = 'tickets: B-1 done (archived)\n\nhttps://github.com/immediately-run/baton/pull/9';
    expect(ticketCommitMessage(done, trailers)).toBe(`${done}\n\n${trailers}`);
    // Without trailers — unset, empty or whitespace — the message is the command's own.
    expect(ticketCommitMessage('tickets: file B-2 — x', '')).toBe('tickets: file B-2 — x');
    expect(ticketCommitMessage('tickets: file B-2 — x', '  \n')).toBe('tickets: file B-2 — x');
    expect(ticketCommitMessage('tickets: file B-2 — x', '', false)).toBe('tickets: file B-2 — x');
    // Required and empty: refused, naming both variables and the rule.
    expect(() => ticketCommitMessage('tickets: file B-2 — x', '', true)).toThrow("TICKET_REQUIRE_TRAILERS=1, but TICKET_TRAILERS is empty — set it to the session's provenance lines (the agent-provenance trailers, then Claude-Session and Co-Authored-By), or unset TICKET_REQUIRE_TRAILERS to commit without them");
  }, 30_000);

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
    expect(page).toContain('**Waits on:**');
    expect(page).toContain('Choose or create the');
    expect(page).toContain('dibber claim <id>');
    expect(page).toContain('baton tickets check <id> --claimable');
    expect(page).not.toMatch(/baton tickets (new|claim|set|done)/);
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
    writeFileSync(page, `${want.replace('dibber claim <id>', 'claim it by hand')}\n`);
    const r = run(dir, 'check', '--repo', dir);
    expect(r.code).toBe(1);
    expect(r.out.split('\n').filter(Boolean)).toEqual([
      `tickets/${PAGE_NAME}: differs from the "How tickets work" page this release generates — \`baton repo init --force\` writes it again`,
      'baton tickets check: 0 ticket(s), 1 finding(s)',
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

describe('baton repo init writes .dibber/config.json: Baton is Dibber\'s coordinator (B-326, S-BTN-189)', () => {
  const initRepo = (settings: Record<string, unknown> = {}): string => {
    const dir = tmp('baton-b326-init-');
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
    mkdirSync(join(dir, '.baton'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'baton.json'), `${JSON.stringify({ baton_url: 'https://baton.immediately.run', items: 'roadmap', default_course: 'create-pr', repos: {}, agent_command: 'echo', ticket_prefix: 'FLDH', ...settings }, null, 2)}\n`);
    return dir;
  };
  const config = (dir: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, '.dibber', 'config.json'), 'utf8')) as Record<string, unknown>;

  it('writes the store, the prefix and the coordinator from .baton/baton.json, and says so', async () => {
    const dir = initRepo();
    const { initMain } = await CLI_MODULE();
    const said: string[] = [];
    await initMain(['--course', 'create-pr'], { root: dir, log: (l) => said.push(l) });
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    expect(config(dir)).toEqual({
      store: 'roadmap',
      prefix: 'FLDH',
      coordinator: { next: ['npx', '--yes', `@immediately-run/baton@${version}`, 'tickets', 'next', 'ticket-<prefix>', '--coordinator'] },
    });
    expect(said).toContain('baton: .dibber/config.json — written: Dibber writes the ticket files, Baton gives their numbers (coordinator)');
    // A second init changes nothing and says nothing of it.
    const again: string[] = [];
    await initMain(['--course', 'create-pr'], { root: dir, log: (l) => again.push(l) });
    expect(again.filter((l) => l.includes('.dibber'))).toEqual([]);
  }, 60_000);

  it('over an existing file it adds what is missing, keeps every value and names a disagreement', async () => {
    const dir = initRepo();
    mkdirSync(join(dir, '.dibber'), { recursive: true });
    writeFileSync(join(dir, '.dibber', 'config.json'), JSON.stringify({ store: 'tickets', ids: 'numeric', mine: true }));
    const { initMain } = await CLI_MODULE();
    const said: string[] = [];
    await initMain(['--course', 'create-pr'], { root: dir, log: (l) => said.push(l) });
    expect(config(dir)).toMatchObject({ store: 'tickets', ids: 'numeric', mine: true, prefix: 'FLDH', coordinator: { next: expect.arrayContaining(['ticket-<prefix>', '--coordinator']) } });
    expect(said).toContain('baton: .dibber/config.json — added prefix, coordinator: Dibber writes the ticket files, Baton gives their numbers (coordinator)');
    expect(said).toContain('baton: .dibber/config.json kept — its store is "tickets", .baton/baton.json says "roadmap"');
    // A coordinator of the repository's own is kept as written.
    writeFileSync(join(dir, '.dibber', 'config.json'), JSON.stringify({ store: 'roadmap', prefix: 'FLDH', coordinator: { next: ['node', 'cli/baton.mjs', 'tickets', 'next', 'ticket-<prefix>', '--coordinator'] } }));
    await initMain(['--course', 'create-pr'], { root: dir, log: () => {} });
    expect((config(dir).coordinator as { next: string[] }).next[0]).toBe('node');
    // A file that is not a settings object is refused, never overwritten.
    writeFileSync(join(dir, '.dibber', 'config.json'), '[1]');
    await expect(initMain(['--course', 'create-pr'], { root: dir, log: () => {} })).rejects.toThrow('.dibber/config.json is not a settings object (not a JSON object)');
    expect(readFileSync(join(dir, '.dibber', 'config.json'), 'utf8')).toBe('[1]');
  }, 60_000);
});

describe('the dibber a leg runs: pinned, never a command a ticket names (B-326)', () => {
  it('the setting pins a release version; the host\'s BATON_DIBBER wins; anything else is refused', async () => {
    const { DIBBER_VERSION, dibberVersion, dibberWords } = await import('../../src/defaults/dibber');
    expect(DIBBER_VERSION).toBe('0.4.0');
    expect(dibberWords({}, {})).toEqual(['npx', '--yes', '@immediately-run/dibber@0.4.0']);
    expect(dibberWords({ dibber: '0.5.1-rc.0' }, {})).toEqual(['npx', '--yes', '@immediately-run/dibber@0.5.1-rc.0']);
    expect(dibberWords({ dibber: '0.4.0' }, { BATON_DIBBER: "node '/opt/dibber/bin/dibber.mjs'" })).toEqual(['node', '/opt/dibber/bin/dibber.mjs']);
    for (const bad of ['latest', '0.4.0; rm -rf /', '../dibber', 4, '0.4']) {
      expect(() => dibberVersion({ dibber: bad })).toThrow("it pins @immediately-run/dibber, it never names a command");
    }
  });
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

  it('round 2, finding 1: an entry amends the ids of its Rules changed line, the line directly under its title’s close; one further down, or none, amends nothing', () => {
    const history = [
      '- **2026-11-04 — the restructure, part 5.**',
      '  Rules changed: R-BTN-33, R-BTN-150.',
      '  The body names R-BTN-50 as evidence.',
      '',
      '- **2026-11-05 — the owner’s rulings on the',
      '  review’s tickets.**',
      '  Rules changed: R-BTN-7.',
      '',
      '- **2026-11-06 — R-BTN-50: a titled one.** Text.',
      '  Rules changed: R-BTN-33.',
      '',
      '- **2026-11-07 — a later line is not the one.** The owner said so.',
      '  More text.',
      '  Rules changed: R-BTN-50.',
      '',
      '- **2026-11-08 — scenarios only.**',
      '  Rules changed: none.',
      '',
    ].join('\n');
    const entries = historyEntries(history);
    expect(entries.map((e) => [e.date, e.changed, entryIds(e)])).toEqual([
      ['2026-11-04', 'R-BTN-33, R-BTN-150.', ['R-BTN-33', 'R-BTN-150']],
      ['2026-11-05', 'R-BTN-7.', ['R-BTN-7']],
      ['2026-11-06', 'R-BTN-33.', ['R-BTN-50', 'R-BTN-33']],
      ['2026-11-07', null, []],
      ['2026-11-08', 'none.', []],
    ]);
    expect(staleRules(citing('B-1'), '2026-10-20', entries).map((s) => `${s.id} ${s.date}`)).toEqual(['R-BTN-7 2026-11-05', 'R-BTN-33 2026-11-04', 'R-BTN-33 2026-11-06', 'R-BTN-50 2026-11-06', 'R-BTN-150 2026-11-04']);
  });

  it('round 2, finding 1: check:spec passes exactly the entries whose ids the guard reads (one grammar, two copies)', () => {
    const history = [
      '- **2026-11-04 — R-BTN-74: titled.** Text.',
      '',
      '- **2026-11-04 — wrapped',
      '  title.**',
      '  Rules changed: R-BTN-50.',
      '',
      '- **2026-11-05 — inline.** The body cites R-BTN-7.',
      '  Rules changed: R-BTN-7.',
      '',
      '- **2026-11-05 — further down.** Text,',
      '  more.',
      '  Rules changed: R-BTN-9.',
      '',
      '- **2026-11-06 — no ids.** R-BTN-1 in the body only.',
      '',
    ].join('\n');
    const unnamed = (unnamedEntries(history) as { title: string }[]).map((e) => e.title);
    const blind = historyEntries(history).filter((e) => e.changed == null && !entryIds(e).length).map((e) => e.title);
    expect(unnamed).toEqual(['further down', 'no ids']);
    expect(blind).toEqual(unnamed);
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

  it('by the merge that brings it in, when no commit before it adds it: never today (2026-11-04)', () => {
    // B-49 was born in a merge's conflict resolution, the R3 tickets in a merge joining docs'
    // history: a merge shows no diff by default, so they read as never committed — filed today.
    const f = datedRepo('2026-10-19', { existing: {} });
    git(f.dir, 'checkout', '-q', '-b', 'side');
    edit(f, 'tickets/side.txt', 'x\n', 'side: a commit to merge', '2026-10-19');
    git(f.dir, 'checkout', '-q', 'main');
    mkdirSync(join(f.dir, 'tickets'), { recursive: true });
    execFileSync('git', ['-C', f.dir, 'merge', '-q', '--no-ff', '--no-commit', 'side'], { stdio: 'ignore' });
    writeFileSync(join(f.dir, 'tickets', 'B-1.mdx'), citing('B-1', null));
    git(f.dir, 'add', '-A');
    execFileSync('git', ['-C', f.dir, 'commit', '-q', '-m', 'Merge side; B-1 filed in the resolution'], { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-19T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-19T12:00:00Z' } });
    expect(firstCommits(f.dir, 'tickets').get('tickets/B-1.mdx')).toEqual({ date: '2026-10-19', boundary: false });
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

  it('round 2, finding 6: the sections check takes the later of _filed and a first commit git shows', () => {
    expect(sectionsDate(citing('B-1', '2026-10-25'), { date: '2026-11-04', boundary: false }, '2026-11-09')).toEqual({ date: '2026-11-04' });
    expect(sectionsDate(citing('B-1', '2026-11-05'), { date: '2026-11-04', boundary: false }, '2026-11-09')).toEqual({ date: '2026-11-05' });
    expect(sectionsDate(citing('B-1', '2026-10-25'), { date: '2026-11-04', boundary: true }, '2026-11-09')).toEqual({ date: '2026-10-25' });
    expect(sectionsDate(citing('B-1', '2026-10-25'), null, '2026-11-09')).toEqual({ date: '2026-10-25' });
    expect(sectionsDate(citing('B-1', null), { date: '2026-11-04', boundary: true }, '2026-11-09')).toEqual({ undetermined: true });
    expect(sectionsDate(citing('B-1', null), null, '2026-11-09')).toEqual({ date: '2026-11-09' });
  });
});

describe('baton tickets check --claimable: the stale-rule guard (2026-11-03, B-326)', () => {
  it('a ticket citing a rule amended after it was filed is not claimable, naming each id, date and title and the note that answers it', () => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    const before = f.head().sha;
    const r = claimable(f.dir, 'B-1');
    expect(r.code).toBe(1);
    expect(r.out).toBe([
      'B-1: not claimable — B-1 cites rules that spec/BATON_SPEC_HISTORY.md amended after the ticket answered for them (filed 2026-10-20, or a later rules re-read note naming the rule):',
      '  R-BTN-33 — 2026-11-02 — R-BTN-33, R-BTN-150: a range, its title wrapped',
      '  R-BTN-50 — 2026-11-01 — R-BTN-50: the owner’s ruling on Needs you',
      '  R-BTN-150 — 2026-11-02 — R-BTN-33, R-BTN-150: a range, its title wrapped',
      'Re-read each rule and entry, rewrite or strike what in the ticket they contradict, then record it — dibber set B-1 --note "rules re-read: R-BTN-33, R-BTN-50, R-BTN-150" — and check again.',
      '',
    ].join('\n'));
    expect(f.head().sha).toBe(before);
  });

  it('Dibber\'s rules re-read note, naming every stale id, answers for them; one naming fewer does not', () => {
    const dibberNote = (ids: string) => `${citing('B-1')}\n_2026-11-03: rules re-read: ${ids}._\n`;
    const all = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': dibberNote('R-BTN-33, R-BTN-50, R-BTN-150') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    expect(claimable(all.dir, 'B-1').code).toBe(0);
    const some = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': dibberNote('R-BTN-50') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    const r = claimable(some.dir, 'B-1');
    expect(r.code).toBe(1);
    expect(r.out).toContain('  R-BTN-33 — 2026-11-02');
    expect(r.out).not.toContain('  R-BTN-50 —');
  });

  it('an edit after the amendments clears nothing; with no _filed line, the first commit dates the ticket', () => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', null) }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    edit(f, 'tickets/B-1.mdx', `${citing('B-1', null)}\nA clause struck by a spec PR.\n`, 'spec: R-BTN-50 — strike B-1’s clause\n\ntickets: a body line that is not the subject', '2026-11-05');
    const r = claimable(f.dir, 'B-1');
    expect(r.code).toBe(1);
    expect(r.out).toContain('(filed 2026-10-20, or a later rules re-read note naming the rule):\n  R-BTN-33 — 2026-11-02');
  });

  it('a ticket filed after the amendments, one whose spec-PR note names every stale id, or a repository with no history file, is claimable', () => {
    const fresh = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', '2026-11-02') }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    expect(claimable(fresh.dir, 'B-1').code).toBe(0);
    const handled = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': `${citing('B-1')}\n_(2026-11-03: rules re-read: R-BTN-33, R-BTN-50, R-BTN-150)_\n` }, files: { 'spec/BATON_SPEC_HISTORY.md': HISTORY } });
    expect(claimable(handled.dir, 'B-1').code).toBe(0);
    const none = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1') } });
    expect(claimable(none.dir, 'B-1').code).toBe(0);
  });

  it('check.rules points the guard at another spec’s history and prefix (fieldhouse’s shape)', () => {
    const fh = HISTORY.replace(/R-BTN/g, 'R-FH');
    const f = datedRepo('2026-10-20', {
      existing: { 'tickets/B-1.mdx': citing('B-1').replace('(R-BTN-50)', '(R-FH-50)') },
      files: { 'spec/FIELDHOUSE_SPEC_HISTORY.md': fh, 'spec/BATON_SPEC_HISTORY.md': HISTORY },
      settings: { check: { rules: { prefix: 'R-FH', history: 'spec/FIELDHOUSE_SPEC_HISTORY.md' } } },
    });
    const r = claimable(f.dir, 'B-1');
    expect(r.code).toBe(1);
    expect(r.out).toContain('spec/FIELDHOUSE_SPEC_HISTORY.md amended after the ticket answered for them (filed 2026-10-20, or a later rules re-read note naming the rule):\n  R-FH-50 — 2026-11-01');
    expect(r.out).not.toContain('  R-BTN');
  });
});

describe('baton tickets check --claimable in a shallow clone (2026-11-03)', () => {
  const shallowOf = (): { f: Fixture; clone: string } => {
    const f = datedRepo('2026-10-20', { existing: { 'tickets/B-1.mdx': citing('B-1', null) } });
    edit(f, 'spec/BATON_SPEC_HISTORY.md', HISTORY, 'spec: the history', '2026-11-05');
    const clone = tmp('baton-shallow-');
    rmSync(clone, { recursive: true, force: true });
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${f.origin}`, clone], { stdio: 'ignore' });
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true');
    return { f, clone };
  };

  it('deepens the clone first, so the ticket is dated by its real first commit, not the boundary', () => {
    const { clone } = shallowOf();
    const r = claimable(clone, 'B-1');
    expect(r.code).toBe(1);
    expect(r.out).toContain('(filed 2026-10-20, or a later rules re-read note naming the rule):\n  R-BTN-33 — 2026-11-02');
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('false');
  });

  it('refuses, naming the fix, when the clone cannot be deepened', () => {
    const { clone } = shallowOf();
    const bin = tmp('baton-bin-');
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = --unshallow ] && { echo "fatal: unable to access the remote" >&2; exit 128; }; done\nexec ${real} "$@"\n`, { mode: 0o755 });
    const out = spawnSync(process.execPath, [CLI, 'tickets', 'check', 'B-1', '--claimable', '--offline'], { cwd: clone, encoding: 'utf8', env: { ...childEnv(clone), PATH: `${bin}:${process.env.PATH}` } });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("baton: B-1: this clone is shallow, so the day tickets/B-1.mdx was filed cannot be read, and `git fetch --unshallow origin` failed (fatal: unable to access the remote) — deepen the clone (`git fetch --unshallow`, or clone without --depth), then check again");
  });
});

describe('the Trust and Invariants sections: their reading (2026-11-03)', () => {
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

});

/* ──────────────────────────────────────────────────────────────────────────────────────────
 * B-129, B-326 — check --claimable asks Baton first, and a takeover continues the ticket where
 * Baton holds it.
 * Against a fake Baton (node:http) and the bare origin above: the B-91 replay (a release wrote
 * `status: available` / `prs: []` over an open PR; Baton held the ticket at pr-open with review
 * ready), the live claim that refuses naming its holder and the lease's end, a ticket at its
 * start that claims as before, the unreachable Baton that refuses (and --offline that does not),
 * and the release that keeps every prs: entry — refusing the write that would drop an open PR.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/** A stand-in Baton answering the three reads the check makes, recording what it was asked. */
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
      return reply(200, { repository: { id: 'baton' }, ready: state.ready ?? [], holders: state.holders ?? [], granted_capabilities: null, server_time: state.serverTime ?? 0 });
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

describe('baton tickets check --claimable asks Baton first (B-129, B-326, S-BTN-199)', () => {
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
    keyFile = join(tmp('baton-b129-key-'), 'runner.key');
    mkdirSync(dirname(keyFile), { recursive: true });
    key = `bak_${'0'.repeat(16)}_${'a'.repeat(64)}`;
    writeFileSync(keyFile, `${key}\n`);
  });


  it('replaying B-91: the takeover at pr-open is printed with #109, the branch and the hand-off; nothing is written', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const baton = await fakeBaton(B91);
    try {
      const before = f.head().sha;
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '' });
      expect(r.out.split('\n')).toEqual([
        'B-91: Baton holds it at pr-open, review ready — you are taking it over, not starting it',
        `  PR: ${PR109} — Baton's record holds it and the file does not: dibber set B-91 --pr ${PR109}`,
        '  branch: claude/B-91-seed-owner-keys — continue on it, never `checkout -b` a new one',
        '  hand-off: released:requested 2026-10-27T09:15:00.000Z — read it: git log -1 tickets/B-91.mdx',
        'B-91: claimable — claim it with: dibber claim B-91',
        '',
      ]);
      expect(baton.asked.map((x) => x.replace(/\?.*$/, ''))).toEqual([
        'GET /v1/repositories/baton/board',
        'GET /v1/repositories/baton/tickets/baton%3AB-91/history',
        'GET /v1/runner/branch-holder',
      ]);
      expect(f.head().sha).toBe(before);
      expect(f.at('tickets/B-91.mdx')).toContain('prs: []');
    } finally {
      baton.close();
    }
  }, 60_000);

  it('a PR the file already names is printed without the dibber set', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', [PR109]) } });
    const baton = await fakeBaton(B91);
    try {
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', baton.url);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`  PR: ${PR109}\n`);
    } finally {
      baton.close();
    }
  }, 60_000);

  it('a live claim by another runner is not claimable, naming the holder and the lease', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const leaseEnds = Date.parse('2026-10-27T11:00:00Z');
    const baton = await fakeBaton({ ...B91, holders: [{ ticket_id: 'baton:B-91', runner_id: 7, hostname: 'host-3', session_name: 'claude-review', lease_ends_at: leaseEnds }] });
    try {
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', baton.url);
      expect(r.code).toBe(1);
      expect(r.out).toBe(`B-91: not claimable — B-91 is held by host-3 · claude-review (runner 7), its lease ends 2026-10-27T11:00:00.000Z — its lease has not ended; it is released or reaped first (Baton's board, B-129)\n`);
    } finally {
      baton.close();
    }
  }, 60_000);

  it('a branch another live claim holds is not claimable, and a fence-pending branch neither', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const held = await fakeBaton({ ...B91, branchHolder: { tickets: ['baton:B-91'], held_by_other: true, fence_pending: false } });
    try {
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', held.url);
      expect(r.code).toBe(1);
      expect(r.out).toContain("B-91's branch claude/B-91-seed-owner-keys is held by another live claim");
    } finally {
      held.close();
    }
    const fenced = await fakeBaton({ ...B91, branchHolder: { tickets: ['baton:B-91'], held_by_other: false, fence_pending: true } });
    try {
      expect((await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', fenced.url)).out).toContain('fence-pending');
    } finally {
      fenced.close();
    }
  }, 60_000);

  it('a ticket at its start station with no holder is a fresh claim, and the branch-holder query is not asked', async () => {
    const f = namedRepo({ existing: { 'tickets/B-5.mdx': ticket('B-5') } });
    const baton = await fakeBaton({ ready: [], holders: [], history: [], resume: null });
    try {
      const r = await runAsync(f.dir, 'check', 'B-5', '--claimable', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '', out: 'B-5: claimable — claim it with: dibber claim B-5\n' });
      expect(baton.asked.filter((x) => x.includes('branch-holder'))).toEqual([]);
    } finally {
      baton.close();
    }
  }, 60_000);

  it('an unanswered read exits 2 — unreachable, forbidden, no key — and --offline judges git\'s word', async () => {
    const f = namedRepo({ existing: { 'tickets/B-5.mdx': ticket('B-5') } });
    const dead = await runAsync(f.dir, 'check', 'B-5', '--claimable', '-i', keyFile, '--url', 'http://127.0.0.1:9');
    expect(dead.code).toBe(2);
    expect(dead.err).toContain('the board of baton: Baton at http://127.0.0.1:9 is unreachable');
    expect(dead.err).toContain("--offline to judge git's word alone");
    const refused = await fakeBaton({ boardStatus: 403 });
    try {
      const r = await runAsync(f.dir, 'check', 'B-5', '--claimable', '-i', keyFile, '--url', refused.url);
      expect(r.code).toBe(2);
      expect(r.err).toContain('the board of baton: forbidden');
    } finally {
      refused.close();
    }
    const bare = spawnSync(process.execPath, [CLI, 'tickets', 'check', 'B-5', '--claimable'], { cwd: f.dir, encoding: 'utf8', env: childEnv(f.dir) });
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain("the check reads Baton's record of the ticket first (B-129) — pass -i KEY");
    expect(claimable(f.dir, 'B-5').code).toBe(0);
  }, 30_000);

  it('a takeover overrides only a false available: the git lock, a parked or closed status and an undone dependency are not claimable', async () => {
    const baton = await fakeBaton(B91);
    try {
      for (const status of ['in-progress', 'in-review']) {
        const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File(status, [PR109]) } });
        const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', baton.url);
        expect(r.code).toBe(1);
        expect(r.out).toBe(`B-91: not claimable — B-91 is ${status} in git — a git-lock holder may hold it; Baton's position (pr-open) overrides only a false available, never the git lock\n`);
      }
      for (const status of ['deferred', 'deprioritized', 'superseded']) {
        const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File(status, [PR109]) } });
        const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', baton.url);
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/^B-91: not claimable — B-91 is [a-z-]+ in git — parked or closed; Baton's position \(pr-open\) overrides only a false available\n$/);
      }
      const depends = b91File('available', []).replace('**Depends on:** none.', '**Depends on:** B-1.').replace('depends_on: []', 'depends_on:\n  - B-1');
      const f = namedRepo({ existing: { 'tickets/B-1.mdx': ticket('B-1'), 'tickets/B-91.mdx': depends } });
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 1, out: 'B-91: not claimable — B-91 depends on B-1, not done yet\n' });
    } finally {
      baton.close();
    }
  }, 120_000);

  it('a ticket moved back to its start is judged by where Baton holds it now: a fresh claim, not a takeover', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const baton = await fakeBaton({ ...B91, ready: [{ id: 'baton:B-91', local_id: 'B-91', station: 'filed', leg: 'implement' }] });
    try {
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', baton.url);
      expect(r).toMatchObject({ code: 0, err: '', out: 'B-91: claimable — claim it with: dibber claim B-91\n' });
    } finally {
      baton.close();
    }
  }, 60_000);

  it('with no local course file the start is the standard course\'s: a ticket whose newest reached row is the start is a fresh claim, one past it a takeover', async () => {
    const f = namedRepo({ courseFile: false, existing: { 'tickets/B-91.mdx': b91File('available', []), 'tickets/B-92.mdx': ticket('B-92') } });
    expect(existsSync(join(f.dir, '.baton', 'courses', 'create-pr', 'course.json'))).toBe(false);
    const back = await fakeBaton({ ...B91, ready: [], history: [{ id: 4, kind: 'git-moved', reached: 'filed', next_leg: 'implement' }, ...B91.history] });
    try {
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', back.url);
      expect(r).toMatchObject({ code: 0, err: '', out: 'B-91: claimable — claim it with: dibber claim B-91\n' });
    } finally {
      back.close();
    }
    const past = await fakeBaton({ ...B91, ready: [] });
    try {
      const r = await runAsync(f.dir, 'check', 'B-92', '--claimable', '-i', keyFile, '--url', past.url);
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

  it('a holder whose lease has ended awaits reaping, and a legacy holder has no lease: both refuse, naming it', async () => {
    const f = namedRepo({ existing: { 'tickets/B-91.mdx': b91File('available', []) } });
    const ended = Date.parse('2026-10-27T11:00:00Z');
    const stale = await fakeBaton({ ...B91, serverTime: ended + 60_000, holders: [{ ticket_id: 'baton:B-91', runner_id: 7, hostname: 'host-3', session_name: 'claude-review', lease_ends_at: ended }] });
    try {
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', stale.url);
      expect(r.code).toBe(1);
      expect(r.out).toBe("B-91: not claimable — B-91 is held by host-3 · claude-review (runner 7), its lease ended 2026-10-27T11:00:00.000Z and the claim awaits reaping; it is reaped first (Baton's board, B-129)\n");
    } finally {
      stale.close();
    }
    const legacy = await fakeBaton({ ...B91, holders: [{ ticket_id: 'baton:B-91', runner_id: 3, hostname: 'legacy', session_name: 'item-B-91', lease_ends_at: null }] });
    try {
      const r = await runAsync(f.dir, 'check', 'B-91', '--claimable', '-i', keyFile, '--url', legacy.url);
      expect(r.code).toBe(1);
      expect(r.out).toBe("B-91: not claimable — B-91 is held by legacy · item-B-91 (runner 3), a claim with no lease to end (a legacy claim); it is released, adopted or reaped first (Baton's board, B-129)\n");
    } finally {
      legacy.close();
    }
  }, 60_000);

  it('a key that is missing or unreadable is named as the key\'s problem, never Baton unreachable — and Baton is not asked', async () => {
    const f = namedRepo({ existing: { 'tickets/B-5.mdx': ticket('B-5') } });
    const baton = await fakeBaton({});
    try {
      const missing = await runAsync(f.dir, 'check', 'B-5', '--claimable', '-i', join(dirname(keyFile), 'nope.key'), '--url', baton.url);
      expect(missing.code).toBe(2);
      expect(missing.err).toContain(`no key: ${join(dirname(keyFile), 'nope.key')} does not exist — the reads cannot be signed, so Baton was not asked`);
      expect(missing.err).not.toContain('unreachable');
      const junk = join(dirname(keyFile), 'junk.key');
      writeFileSync(junk, 'not a key\n');
      const unreadable = await runAsync(f.dir, 'check', 'B-5', '--claimable', '-i', junk, '--url', baton.url);
      expect(unreadable.code).toBe(2);
      expect(unreadable.err).toContain('key unreadable:');
      expect(unreadable.err).not.toContain('unreachable');
      expect(baton.asked).toEqual([]);
    } finally {
      baton.close();
    }
  }, 60_000);
});
