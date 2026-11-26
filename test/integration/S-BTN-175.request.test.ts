// S-BTN-175 the request (BATON_SPEC §15 S-BTN-175, R-BTN-131, R-BTN-74, §6.1; B-98; B-174): a
// fresh repository runs `baton repo init --course create-spec`, and its request is filed the way
// an operator files one — `baton request "<one sentence>" --course create-spec`, through the CLI's
// own entry, which commits the ticket and pushes it to the default branch. Must hold: the ticket
// lands as one commit on the bare origin's main, the sentence as its title and description,
// `course: create-spec`, `available`, `tags: [request]`; the next sync posts it to the board at
// the course's start station, `requested`, with its start leg `converse` ready; and a runner's
// claim offers `converse` — the course started from one sentence, no hand-written ticket. B-174
// adds the protected default branch: the forge's refusal (spoken into git's stderr by a `git`
// shim) lands the same commit on `baton-request/<ID>` and opens a PR from it with the caller's
// credential (an injected fetch, as the sync's tests inject recorded facts); without one the
// pushed branch is printed and the exit is non-zero; a branch already present takes the next
// free id; a `git` forge, and any refusal that is not protection, stay git's own words, nothing
// opened, non-zero. Node only: it writes a real repository and runs git and the CLI.
import { GitRepo } from '../lib/gitRepo';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { requestMain } from '../../src/defaults/request';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';
import { ORIGIN, claimItem, cutover, register, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-10-28T12:00:00Z');
// The CLI's own entry, as an operator runs it.
const CLI = resolve(import.meta.dirname, '..', '..', 'cli', 'baton.mjs');
/** stderr's lines past B-176's fallback note (`… id by the next-free scan …`): these runs ask no
 *  Baton, so the scan gives the id and says so first; the lines under test follow it. */
const said = (stderr: string): string[] => stderr.split('\n').filter((l) => !l.startsWith('… id by the next-free scan'));
// No --pin: the CLI pins its own commit, the one its courses' sources name (B-33).
const init = (root: string, ...argv: string[]) => initMain(argv, { root, log: () => {} });

class RequestCheckout extends GitRepo {

  constructor() {
    super('baton-175-', { origin: true });
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
  }

  /** The scaffold and the fixtures' first ticket, committed and pushed to the origin's main. */
  publish(): void {
    this.git('add', '-A');
    this.git('commit', '-qm', 'scaffold');
    this.git('push', '-q', 'origin', 'HEAD:main');
  }
  /** `baton request` as an operator runs it: the CLI's entry, the checkout as its home. */
  request(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
    return this.spawn({}, argv);
  }
  /** The CLI's entry under an environment of the caller's choosing — a `git` shim first on
   *  PATH (B-174: the forge's refusal, spoken into git's stderr) or a credential, or none. */
  spawn(extraEnv: Record<string, string>, argv: string[]): { status: number | null; stdout: string; stderr: string } {
    const out = spawnSync(process.execPath, [CLI, 'request', ...argv], { cwd: this.dir, encoding: 'utf8', env: { ...process.env, BATON_HOME: this.dir, ...extraEnv } });
    return { status: out.status, stdout: out.stdout, stderr: out.stderr };
  }
  /** The sync as the workflow runs it: a checkout of the default branch (what the request pushed),
   *  with recorded facts and the harness's sync credential. */
  async sync(): Promise<void> {
    this.git('fetch', '-q', 'origin');
    this.git('checkout', '-q', '--detach', 'origin/main');
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, '[]');
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts], {});
    const log: string[] = [];
    const code = await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: (l) => log.push(l) });
    if (code !== 0) throw new Error(`sync exited ${code}: ${log.join('\n')}`);
  }
}

/** A `git` shim first on PATH that refuses every push to the default branch with the forge's own
 *  words (B-174) and passes everything else — the side branches' pushes included — to the real
 *  git. What a protected github.com says over the `remote:` lines, verbatim. */
const refuseMain = (origin: string): string => {
  const bin = mkdtempSync(join(tmpdir(), 'baton-s175-git-'));
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const shim = [
    '#!/bin/sh',
    // The local rewrite fakes transport only, not the push destination seen by the PR client.
    'if [ "$3 $4 $5 $6" = "remote get-url --push origin" ]; then',
    `  exec ${JSON.stringify(realGit)} -C "$2" config --get remote.origin.url`,
    'fi',
    'n=0',
    'for a in "$@"; do if [ "$a" = "push" ]; then n=1; fi; done',
    'if [ "$n" = "1" ]; then',
    '  for a in "$@"; do',
    '    if [ "$a" = "HEAD:refs/heads/main" ]; then',
    '      echo "remote: error: GH006: Protected branch update failed for refs/heads/main." 1>&2',
    '      echo "remote: error: Cannot push to this protected branch" 1>&2',
    '      echo " ! [remote rejected] HEAD -> main (protected branch hook declined)" 1>&2',
    '      exit 1',
    '    fi',
    '  done',
    'fi',
    `exec ${JSON.stringify(realGit)} "$@"`,
    '',
  ].join('\n');
  writeFileSync(join(bin, 'git'), shim, { mode: 0o755 });
  return bin;
};

/** The PR the request's forge credential opens, answered by an injected fetch (B-174): the forge's
 * API is not reached — as the sync's tests inject recorded facts — but every call is seen. */
const prFetch = (url: string): { calls: Request[]; fetchImpl: typeof fetch } => {
  const calls: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(new Request(String(input), init));
    return new Response(JSON.stringify({ html_url: url }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
};

let repo: RequestCheckout | null;
let minutes = 0;
/** The repository a run works in, or null in a runtime that writes none: this scenario mkdtemps,
 *  pushes and spawns the CLI, so the Workers runtime — which has neither (`node:fs` is a stub
 *  there) — skips it (R-BTN-29, S-BTN-31) instead of failing on them. Asked by the call itself:
 *  `tryMkdtemp` is node's own in Node, and throws on the Workers runtime's stub. */
const onNode = (): RequestCheckout | null => {
  try {
    return new RequestCheckout();
  } catch {
    return null;
  }
};
/** Each sync takes an observation number; the next is refused until ten minutes pass (R-BTN-62). */
const later = () => setClock(T0 + (minutes += 11) * 60_000);
beforeEach(async () => {
  minutes = 0;
  await setClock(T0);
  repo = onNode();
});
afterEach(() => {
  if (!repo) return;
  repo.dispose();
  rmSync(repo.bare, { recursive: true, force: true });
});

type StationRow = { station: string; next_leg: string | null; next_source: string; path_len: number };
const stationOf = async (id: string): Promise<StationRow> => (await rows<StationRow>('SELECT station, next_leg, next_source, path_len FROM ticket_stations WHERE ticket_id = ?', `docs:${id}`))[0];
const nextOf = (id: string) => rows<{ leg: string; state: string; waiting_on: string | null }>('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${id}`);

const SENTENCE = 'Decide the export format, so two implementations agree';

describe('S-BTN-175 the request', () => {
  it('one sentence, one commit on the default branch: the board places it at create-spec’s start with converse ready, and a claim offers converse', async () => {
    if (repo === null) return; // the Workers runtime: no repository, and nothing this scenario tests
    expect(await init(repo.dir, '--course', 'create-spec')).toBe(0);
    repo.publish();
    const before = repo.git('rev-parse', 'HEAD');

    // The request, as an operator files it. B-176: with no key in this environment the id is
    // the scan's, and the fallback's note is said on stderr.
    const filed = repo.request(SENTENCE, '--course', 'create-spec');
    expect(filed).toMatchObject({ status: 0 });
    expect(filed.stderr).toMatch(/^… id by the next-free scan — Baton did not answer/);
    expect(filed.stdout).toBe('baton request: filed B-1 (course create-spec) — the next claim starts converse at requested\n');

    // One commit on the origin's main, on top of the scaffold, the ticket file and nothing else —
    // and the caller's own branch, HEAD and tree untouched by it.
    const published = execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main^'], { encoding: 'utf8' }).trim()).toBe(before);
    expect(execFileSync('git', ['-C', repo.bare, 'show', '--name-only', '--format=%s', published], { encoding: 'utf8' }).trim().split('\n'))
      .toEqual(['B-1: request — Decide the export format, so two implementations agree — create-spec', '', 'tickets/B-1.mdx']);
    expect(repo.git('rev-parse', 'HEAD')).toBe(before);
    // The file is the markdown source's ticket, the sentence its title and description.
    const text = execFileSync('git', ['-C', repo.bare, 'show', 'main:tickets/B-1.mdx'], { encoding: 'utf8' });
    expect(parseFrontmatter(text)).toMatchObject({ id: 'B-1', course: 'create-spec', status: 'available', tags: ['request'], title: `B-1 — ${SENTENCE}`, description: SENTENCE });

    // The next sync posts it at the course's start, its start leg ready — the next claim starts `converse`.
    await later();
    await repo.sync();
    expect(await rows('SELECT id, course_id FROM tickets')).toEqual([{ id: 'docs:B-1', course_id: 'create-spec' }]);
    expect(await stationOf('B-1')).toMatchObject({ station: 'requested', next_leg: 'converse', next_source: 'course', path_len: 0 });
    expect(await nextOf('B-1')).toEqual([{ leg: 'converse', state: 'ready', waiting_on: null }]);

    // A runner's claim offers `converse`: the course starts, from one sentence.
    await cutover();
    const w1 = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-spec', version: 2 }] });
    const { status, json } = await claimItem('vm-a', w1.secret);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ticket_id: 'docs:B-1', station: 'requested', legs: ['converse'] });
  }, 120_000);

  // B-174 (R-BTN-131, R-BTN-180's request bullet): the same request against a protected default
  // branch. The forge's refusal is spoken into git's stderr by a `git` shim on PATH — the words
  // the adapter matches — and the PR the credential opens is answered by an injected fetch, as
  // the sync's tests inject recorded facts: the forge's API is not reached.
  it('protected, with a credential: baton-request/B-1 and a PR from it, nothing on main; after the merge the board as above, no PR among the ticket’s', async () => {
    if (repo === null) return; // the Workers runtime: no repository, and nothing this scenario tests
    expect(await init(repo.dir, '--course', 'create-spec')).toBe(0);
    repo.publish();
    const before = execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

    const bin = refuseMain(repo.bare);
    const url = 'https://github.com/o/requests.git';
    execFileSync('git', ['-C', repo.dir, 'config', `url.${repo.bare}.insteadOf`, url]);
    execFileSync('git', ['-C', repo.dir, 'config', 'remote.origin.url', url]);
    const pr = prFetch('https://github.com/o/requests/pull/7');
    const out: string[] = [];
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    let code: number;
    try {
      code = await requestMain([SENTENCE, '--course', 'create-spec', '--forge', 'github'], {
        root: repo.dir, log: (l) => out.push(l), env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl,
      });
    } finally {
      process.env.PATH = path;
    }
    // The request landed on the side branch — the commit is the ticket file alone — and the PR
    // opened from it with the caller's credential; the default branch never moved.
    expect(code).toBe(0);
    expect(out).toEqual(['baton request: filed B-1 (course create-spec) on baton-request/B-1 — the default branch refused the push as protected; PR https://github.com/o/requests/pull/7; its merge starts converse at requested']);
    expect(pr.calls.length).toBe(1);
    expect(JSON.parse(await pr.calls[0].text())).toMatchObject({ head: 'baton-request/B-1', base: 'main' });
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim()).toBe(before);
    expect(execFileSync('git', ['-C', repo.bare, 'show', '--name-only', '--format=%s', 'refs/heads/baton-request/B-1'], { encoding: 'utf8' }).trim().split('\n'))
      .toEqual(['B-1: request — Decide the export format, so two implementations agree — create-spec', '', 'tickets/B-1.mdx']);

    // The PR merges — the owner's own act — and the sync posts the board exactly as the
    // unprotected case's: the request branch is no `branch_pattern`'s (R-BTN-190), so its PR is
    // never one of the ticket's, and the ticket starts at the course's start with no PR of its own.
    execFileSync('git', ['-C', repo.dir, 'fetch', '-q', 'origin'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo.dir, 'push', '-q', 'origin', 'refs/remotes/origin/baton-request/B-1:refs/heads/main'], { stdio: 'ignore' });
    await later();
    await repo.sync();
    expect(await rows('SELECT id, course_id FROM tickets')).toEqual([{ id: 'docs:B-1', course_id: 'create-spec' }]);
    expect(await stationOf('B-1')).toMatchObject({ station: 'requested', next_leg: 'converse', next_source: 'course', path_len: 0 });
    expect(await nextOf('B-1')).toEqual([{ leg: 'converse', state: 'ready', waiting_on: null }]);
    expect(parseFrontmatter(execFileSync('git', ['-C', repo.bare, 'show', 'main:tickets/B-1.mdx'], { encoding: 'utf8' }))).toMatchObject({ prs: [] });

    // And the claim offers `converse` all the same.
    await cutover();
    const w1 = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-spec', version: 2 }] });
    const { status, json } = await claimItem('vm-a', w1.secret);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ticket_id: 'docs:B-1', station: 'requested', legs: ['converse'] });
  }, 120_000);

  it('protected, no credential: the branch printed and the exit non-zero; again with the branch present: the next free id', async () => {
    if (repo === null) return; // the Workers runtime: no repository, and nothing this scenario tests
    expect(await init(repo.dir, '--course', 'create-spec')).toBe(0);
    repo.publish();
    const before = execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    const bin = refuseMain(repo.bare);

    // No GITHUB_TOKEN: the side branch is pushed, and the command says so and exits non-zero.
    const no = repo.spawn({ PATH: `${bin}:${process.env.PATH}`, GITHUB_TOKEN: '' }, [SENTENCE, '--course', 'create-spec', '--forge', 'github']);
    expect(no.status).toBe(2);
    expect(said(no.stderr)[0])
      .toBe('baton: the push was refused as protected and no GITHUB_TOKEN is set to open a PR — the request is pushed on baton-request/B-1; set the credential and open the PR from it yourself');
    expect(execFileSync('git', ['-C', repo.bare, 'show', 'refs/heads/baton-request/B-1:tickets/B-1.mdx'], { encoding: 'utf8' })).toContain('id: B-1');
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim()).toBe(before);

    // The same request again, the credential now set and the PR injected: `baton-request/B-1` is
    // present and still open, so the request takes the NEXT free id — B-2, its own branch.
    const url = 'https://github.com/o/requests.git';
    execFileSync('git', ['-C', repo.dir, 'config', `url.${repo.bare}.insteadOf`, url]);
    execFileSync('git', ['-C', repo.dir, 'config', 'remote.origin.url', url]);
    const pr = prFetch('https://github.com/o/requests/pull/9');
    const out: string[] = [];
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    let code: number;
    try {
      code = await requestMain([SENTENCE, '--course', 'create-spec', '--forge', 'github'], {
        root: repo.dir, log: (l) => out.push(l), env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl,
      });
    } finally {
      process.env.PATH = path;
    }
    expect(code).toBe(0);
    expect(out[0]).toContain('filed B-2 (course create-spec) on baton-request/B-2');
    expect(execFileSync('git', ['-C', repo.bare, 'show', 'refs/heads/baton-request/B-2:tickets/B-2.mdx'], { encoding: 'utf8' })).toContain('id: B-2');
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim()).toBe(before);
  }, 120_000);

  it('a git forge refusing as protected, and a refusal that is not protection: git’s words, nothing opened, non-zero', async () => {
    if (repo === null) return; // the Workers runtime: no repository, and nothing this scenario tests
    expect(await init(repo.dir, '--course', 'create-spec')).toBe(0);
    repo.publish();
    const before = execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();

    // The origin is a plain git path and --forge names nothing: no adapter, whatever the words.
    // A `git` server has no PRs to open, so the refusal is the operator's, in git's own words.
    const bin = refuseMain(repo.bare);
    const git1 = repo.spawn({ PATH: `${bin}:${process.env.PATH}` }, [SENTENCE, '--course', 'create-spec']);
    expect(git1.status).toBe(2);
    expect(said(git1.stderr)[0]).toBe('baton: the push was refused: remote: error: GH006: Protected branch update failed for refs/heads/main.; remote: error: Cannot push to this protected branch; ! [remote rejected] HEAD -> main (protected branch hook declined)');

    // A refusal that is not protection, adapter or not: the same one line, nothing opened.
    const plain = mkdtempSync(join(tmpdir(), 'baton-s175-git-'));
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const shim = [
      '#!/bin/sh',
      'n=0',
      'for a in "$@"; do if [ "$a" = "push" ]; then n=1; fi; done',
      'if [ "$n" = "1" ]; then',
      '  for a in "$@"; do',
      '    if [ "$a" = "HEAD:refs/heads/main" ]; then',
      '      echo "remote: error: this repository wants no tickets by push" 1>&2',
      '      echo " ! [remote rejected] HEAD -> main (pre-receive hook declined)" 1>&2',
      '      exit 1',
      '    fi',
      '  done',
      'fi',
      `exec ${JSON.stringify(realGit)} "$@"`,
      '',
    ].join('\n');
    writeFileSync(join(plain, 'git'), shim, { mode: 0o755 });
    const other = repo.spawn({ PATH: `${plain}:${process.env.PATH}`, GITHUB_TOKEN: 'tok' }, [SENTENCE, '--course', 'create-spec', '--forge', 'github']);
    expect(other.status).toBe(2);
    expect(said(other.stderr)[0]).toBe('baton: the push was refused: remote: error: this repository wants no tickets by push; ! [remote rejected] HEAD -> main (pre-receive hook declined)');

    // Nothing was opened anywhere, and the default branch never moved.
    expect(execFileSync('git', ['-C', repo.bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/baton-request/*'], { encoding: 'utf8' }).trim()).toBe('');
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim()).toBe(before);
  }, 120_000);
});
