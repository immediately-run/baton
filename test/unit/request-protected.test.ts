// request-protected.test.ts — B-174 (BATON_SPEC §5.8 R-BTN-131, R-BTN-180's request bullet):
// where the forge refuses `baton request`'s push because the default branch is protected, the
// command decides by the forge's answer — the same commit lands on `baton-request/<ID>`, a PR
// opens from it with the caller's forge credential, and without one the pushed branch is
// printed and the exit is non-zero. A `git` forge (no adapter) and any other refusal stay git's
// own words, nothing opened, non-zero. And the id allocators count the open request branches,
// so two requests never share an id. Node only, real repositories: the refusals come from a
// `git` shim on PATH that speaks the forge's own words, exactly as github.com's push does, and
// the PR answers an injected fetch — the forge's API is not reached.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileRequest, readRequestPlan, requestMain } from '../../src/defaults/request';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';
import { CREATE_SPEC_COURSE } from '../../src/defaults/course-pr';

// Real git, filesystem and process launches share CPU with the full suite.
vi.setConfig({ testTimeout: 30_000 });

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The refusals a forge writes into git's stderr, the shim's own words. */
const GH006 = [
  'remote: error: GH006: Protected branch update failed for refs/heads/main.',
  'remote: error: Cannot push to this protected branch',
  ' ! [remote rejected]        HEAD -> main (protected branch hook declined)',
  'error: failed to push some refs',
];
const GH013_SECRETS = [
  'remote: error: GH013: Rule violation found for refs/heads/main.',
  'remote: error: - Push cannot contain secrets.',
  ' ! [remote rejected]        HEAD -> main (push declined due to repository ruleset violation)',
];
const NO_TICKETS_BY_PUSH = ['remote: error: this repository wants no tickets by push', ' ! [remote rejected]        HEAD -> main (pre-receive hook declined)'];

/** One throwaway repository: a bare origin, `.baton/` listing create-spec, and `tickets/`. */
function repo(): { dir: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'baton-b174-'));
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

/** A `git` shim first on PATH that refuses each listed push once — the first to each refspec
 *  `to`, with that refusal's `words` on stderr, as the forge would — and passes everything
 *  else (other refspecs, later pushes) to the real git. */
function refuseOnceEach(dirs: string[], refusals: { to: string; words: string[] }[]): { bin: string } {
  const bin = mkdtempSync(join(tmpdir(), 'baton-b174-git-'));
  dirs.push(bin);
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  // No backticks and no commas in the shell body: the plan's own tests pin every line.
  const shim = [
    '#!/bin/sh',
    'n=0',
    'for a in "$@"; do if [ "$a" = "push" ]; then n=1; fi; done',
    'if [ "$n" = "1" ]; then',
    '  for a in "$@"; do',
    ...refusals.flatMap(({ to, words }) => {
      const flag = JSON.stringify(join(bin, to.replace(/[^a-zA-Z0-9]/g, '_')));
      return [
        `    if [ "$a" = ${JSON.stringify(to)} ] && [ ! -e ${flag} ]; then`,
        `      touch ${flag}`,
        ...words.map((l) => `      echo ${JSON.stringify(l)} 1>&2`),
        '      exit 1',
        '    fi',
      ];
    }),
    '  done',
    'fi',
    `exec ${JSON.stringify(realGit)} "$@"`,
    '',
  ].join('\n');
  writeFileSync(join(bin, 'git'), shim, { mode: 0o755 });
  return { bin };
}

/** A `git` shim first on PATH that refuses ONE push — the first to the refspec `to`, with
 *  `words` on stderr, as the forge would — and passes everything else to the real git. */
function refuseOnce(dirs: string[], to: string, words: string[]): { bin: string } {
  return refuseOnceEach(dirs, [{ to, words }]);
}

/** A `git` shim first on PATH that answers the ONE `ls-remote` of the request-branch scan as
 *  told — a failure, or one printed head line — and passes everything else to the real git:
 *  the scan's view of the remote, whatever the remote itself would say. */
function listOnce(dirs: string[], answer: { fail: true } | { line: string }): { bin: string } {
  const bin = mkdtempSync(join(tmpdir(), 'baton-b174-git-'));
  dirs.push(bin);
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const flag = JSON.stringify(join(bin, 'answered'));
  const shim = [
    '#!/bin/sh',
    'n=0',
    'for a in "$@"; do if [ "$a" = "ls-remote" ]; then n=1; fi; done',
    `if [ "$n" = "1" ] && [ ! -e ${flag} ]; then`,
    `  touch ${flag}`,
    ...('fail' in answer ? ['  exit 1'] : [`  printf '%b\\n' ${JSON.stringify(answer.line)}`]),
    '  exit 0',
    'fi',
    `exec ${JSON.stringify(realGit)} "$@"`,
    '',
  ].join('\n');
  writeFileSync(join(bin, 'git'), shim, { mode: 0o755 });
  return { bin };
}

/** The shim's refusal, with PATH first in line: `run` runs under it and gives the PATH back. */
const refusing = <T>(bin: string, run: () => Promise<T>): Promise<T> => {
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  return run().finally(() => {
    process.env.PATH = path;
  });
};

/** The PR the injected fetch answers, and every call it saw. */
const prAnswer = (url = 'https://github.com/immediately-run/baton/pull/7'): { calls: Request[]; fetchImpl: typeof fetch } => {
  const calls: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(new Request(String(input), init));
    return new Response(JSON.stringify({ html_url: url }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
};

const SENTENCE = 'Decide the export format, so two implementations agree';
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('B-174: the protected default branch, decided by the forge’s answer (R-BTN-131)', () => {
  it('the same commit lands on baton-request/B-1, nothing on main, and the PR opens with the caller’s credential', async () => {
    const { dir, origin } = repo();
    const before = git(origin, 'rev-parse', 'main');
    const shim = refuseOnce(dirs, 'HEAD:refs/heads/main', GH006);
    const pr = prAnswer();
    const filed = await refusing(shim.bin, () =>
      fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE), { forge: 'github', env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl }),
    );
    // The branch, not the default branch: the commit is the request's one file, nothing else.
    expect(filed).toMatchObject({ id: 'B-1', onBranch: 'baton-request/B-1', pr: 'https://github.com/immediately-run/baton/pull/7' });
    expect(git(origin, 'rev-parse', 'main')).toBe(before);
    expect(git(origin, 'show', '--name-only', '--format=%s', 'refs/heads/baton-request/B-1').split('\n'))
      .toEqual(['B-1: request — Decide the export format, so two implementations agree — create-spec', '', 'tickets/B-1.mdx']);
    expect(parseFrontmatter(git(origin, 'show', 'refs/heads/baton-request/B-1:tickets/B-1.mdx'))).toMatchObject({ id: 'B-1', course: 'create-spec' });
    // The PR opens from the side branch onto the refused branch, titled with the commit.
    expect(pr.calls.length).toBe(1);
    expect(pr.calls[0].url).toContain('/repos/');
    expect(pr.calls[0].url).toContain('/pulls');
    expect(JSON.parse(await pr.calls[0].text())).toEqual({ title: 'B-1: request — Decide the export format, so two implementations agree — create-spec', head: 'baton-request/B-1', base: 'main' });
  });

  it('GH013 naming an update rule is protection too — secret push protection never is', async () => {
    const { dir, origin } = repo();
    const before = git(origin, 'rev-parse', 'main');
    // GH013, a pull request required: protected.
    const rule = refuseOnce(dirs, 'HEAD:refs/heads/main', [
      'remote: error: GH013: Rule violation found for refs/heads/main.',
      'remote: error: Changes must be made through a pull request.',
      ' ! [remote rejected]        HEAD -> main (push declined due to repository ruleset violation)',
    ]);
    const pr = prAnswer();
    const filed = await refusing(rule.bin, () => fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE), { forge: 'github', env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl }));
    expect(filed.onBranch).toBe('baton-request/B-1');
    // GH013 about secrets: not protection — git's own words, nothing opened, non-zero.
    const secrets = refuseOnce(dirs, 'HEAD:refs/heads/main', GH013_SECRETS);
    await expect(refusing(secrets.bin, () => fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE), { forge: 'github', env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl })))
      .rejects.toThrow('the push was refused: remote: error: GH013: Rule violation found for refs/heads/main.; remote: error: - Push cannot contain secrets.; ! [remote rejected]        HEAD -> main (push declined due to repository ruleset violation)');
    expect(git(origin, 'rev-parse', 'main')).toBe(before);
    expect(git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/baton-request/*').split('\n').filter(Boolean)).toEqual(['baton-request/B-1']);
  });

  it('no forge credential: the branch is pushed and printed, and the exit is non-zero', async () => {
    const { dir, origin } = repo();
    const before = git(origin, 'rev-parse', 'main');
    const shim = refuseOnce(dirs, 'HEAD:refs/heads/main', GH006);
    const out: string[] = [];
    const threw = await refusing(shim.bin, async () => {
      try {
        await requestMain(['--course', 'create-spec', SENTENCE, '--forge', 'github'], { root: dir, log: (l) => out.push(l), env: {} });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    // The pushed branch is the refusal's own words, and nothing opened a PR.
    expect(threw).toBe('the push was refused as protected and no GITHUB_TOKEN is set to open a PR — the request is pushed on baton-request/B-1; set the credential and open the PR from it yourself');
    expect(git(origin, 'show', 'refs/heads/baton-request/B-1:tickets/B-1.mdx')).toContain('id: B-1');
    expect(git(origin, 'rev-parse', 'main')).toBe(before);
  });

  it('a side branch that already exists takes the next free id — open, or left behind by its merge', async () => {
    const { dir, origin } = repo();
    // An OPEN request branch holds B-1: the allocator counts it and the new request is B-2
    // before any push is refused.
    git(dir, 'checkout', '-q', '-b', 'prior', 'origin/main');
    writeFileSync(join(dir, 'tickets', 'B-1.mdx'), `---\nid: B-1\ntitle: B-1\nstatus: available\ntags: [request]\ncourse: create-spec\n---\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'B-1 earlier');
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/baton-request/B-1');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'fetch', '-q', 'origin');
    git(dir, 'branch', '-D', 'prior');
    const before = git(origin, 'rev-parse', 'main');
    const shim = refuseOnce(dirs, 'HEAD:refs/heads/main', GH006);
    const pr = prAnswer('https://github.com/immediately-run/baton/pull/9');
    const filed = await refusing(shim.bin, () => fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE), { forge: 'github', env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl }));
    expect(filed).toMatchObject({ id: 'B-2', onBranch: 'baton-request/B-2' });
    expect(git(origin, 'show', 'refs/heads/baton-request/B-2:tickets/B-2.mdx')).toContain('id: B-2');
    expect(git(origin, 'rev-parse', 'main')).toBe(before);

    // A branch whose request MERGED keeps its name: its id is free again (the allocator gave
    // B-1 back), the branch is taken, and the request moves to B-2 — one commit on the default
    // branch's head, as the first one was.
    const merged = repo();
    git(merged.dir, 'checkout', '-q', '-b', 'side', 'origin/main');
    writeFileSync(join(merged.dir, 'tickets', 'B-1.mdx'), `---\nid: B-1\ntitle: B-1\nstatus: available\ntags: [request]\ncourse: create-spec\n---\n`);
    git(merged.dir, 'add', '-A');
    git(merged.dir, 'commit', '-q', '-m', 'B-1 request');
    const sideHead = git(merged.dir, 'rev-parse', 'HEAD');
    git(merged.dir, 'push', '-q', 'origin', `HEAD:refs/heads/baton-request/B-1`, `HEAD:refs/heads/main`);
    git(merged.dir, 'checkout', '-q', 'main');
    git(merged.dir, 'fetch', '-q', 'origin');
    git(merged.dir, 'branch', '-D', 'side');
    const mainNow = git(merged.origin, 'rev-parse', 'main');
    expect(mainNow).toBe(sideHead); // the branch's commit is the default branch's head: merged
    const shim2 = refuseOnce(dirs, 'HEAD:refs/heads/main', GH006);
    const trailers = 'Claude-Session: test-session';
    const filed2 = await refusing(shim2.bin, () =>
      fileRequest(readRequestPlan(merged.dir, 'create-spec', SENTENCE), {
        allocated: 'B-1', forge: 'github', env: { GITHUB_TOKEN: 'tok', TICKET_TRAILERS: trailers },
        fetchImpl: prAnswer('https://github.com/immediately-run/baton/pull/10').fetchImpl,
      }),
    );
    expect(filed2).toMatchObject({ id: 'B-2', onBranch: 'baton-request/B-2' });
    // One commit on the default branch's head, the new ticket alone — never the old one.
    expect(git(merged.origin, 'show', '--name-only', '--format=%s', 'refs/heads/baton-request/B-2').split('\n'))
      .toEqual(['B-2: request — Decide the export format, so two implementations agree — create-spec', '', 'tickets/B-2.mdx']);
    expect(git(merged.origin, 'log', '-1', '--format=%B', 'baton-request/B-2')).toBe(`${filed2.message}\n\n${trailers}`);
    expect(git(merged.origin, 'rev-parse', 'baton-request/B-2^')).toBe(mainNow);
    expect(git(merged.origin, 'rev-parse', 'main')).toBe(mainNow);
  });

  it('a git forge and any other refusal are git’s own words, nothing opened, non-zero', async () => {
    const noAdapter = repo();
    const beforeNoAdapter = git(noAdapter.origin, 'rev-parse', 'main');
    // The origin is a local path and --forge names nothing: no adapter, whatever the words say.
    const gh = refuseOnce(dirs, 'HEAD:refs/heads/main', GH006);
    const pr = prAnswer();
    await expect(refusing(gh.bin, () => fileRequest(readRequestPlan(noAdapter.dir, 'create-spec', SENTENCE), { fetchImpl: pr.fetchImpl })))
      .rejects.toThrow('the push was refused: remote: error: GH006: Protected branch update failed for refs/heads/main.');
    // --forge git says so by name, on a github.com origin too.
    const named = refuseOnce(dirs, 'HEAD:refs/heads/main', GH006);
    await expect(refusing(named.bin, () => fileRequest(readRequestPlan(noAdapter.dir, 'create-spec', SENTENCE), { forge: 'git', fetchImpl: pr.fetchImpl })))
      .rejects.toThrow('the push was refused:');
    // A refusal that is not protection, adapter or not: the same one line.
    const other = refuseOnce(dirs, 'HEAD:refs/heads/main', NO_TICKETS_BY_PUSH);
    await expect(refusing(other.bin, () => fileRequest(readRequestPlan(noAdapter.dir, 'create-spec', SENTENCE), { forge: 'github', fetchImpl: pr.fetchImpl })))
      .rejects.toThrow('the push was refused: remote: error: this repository wants no tickets by push');
    // Nothing was opened anywhere, and the default branch never moved.
    expect(pr.calls.length).toBe(0);
    expect(git(noAdapter.origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/baton-request/*').trim()).toBe('');
    expect(git(noAdapter.origin, 'rev-parse', 'main')).toBe(beforeNoAdapter);
  });

  it('the side branch refused too — refs.other under protected — is git’s own words, nothing opened, non-zero', async () => {
    const { dir, origin } = repo();
    const before = git(origin, 'rev-parse', 'main');
    // The default branch refuses as protected; the side branch's own push is refused as well —
    // R-BTN-188's `refs.other` refusing `baton-request/<ID>` to a runner under `protected`
    // (R-BTN-131: "it reports git's own words (R-BTN-74), opens nothing and exits non-zero").
    const words = [
      'remote: error: refs.other admits no runner on this repository: baton-request/B-1 is a branch outside the course pattern',
      'remote: error: and the policy names its updater human alone (protected)',
      '! [remote rejected] HEAD -> baton-request/B-1 (pre-receive hook declined)',
    ];
    const shim = refuseOnceEach(dirs, [
      { to: 'HEAD:refs/heads/main', words: GH006 },
      { to: 'HEAD:refs/heads/baton-request/B-1', words },
    ]);
    const pr = prAnswer();
    await expect(refusing(shim.bin, () => fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE), { forge: 'github', env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl })))
      .rejects.toThrow(`the push was refused: ${words.join('; ')}`);
    // Nothing was opened, no branch was left, and the default branch never moved.
    expect(pr.calls.length).toBe(0);
    expect(git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/baton-request/*').trim()).toBe('');
    expect(git(origin, 'rev-parse', 'main')).toBe(before);
  });

  it('the PR opens on the remote the request was pushed to — never origin’s, when --remote names another', async () => {
    const { dir, origin } = repo();
    // A second bare repository as `upstream`, level with main: the request is pushed to it.
    const upstream = join(dirname(origin), 'upstream.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', upstream]);
    git(dir, 'remote', 'add', 'upstream', upstream);
    git(dir, 'push', '-q', 'upstream', 'main');
    const shim = refuseOnce(dirs, 'HEAD:refs/heads/main', GH006);
    const pr = prAnswer();
    const filed = await refusing(shim.bin, () =>
      fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE), { remote: 'upstream', forge: 'github', env: { GITHUB_TOKEN: 'tok' }, fetchImpl: pr.fetchImpl }),
    );
    // The branch is upstream's, and the PR's repository is upstream's own slug — never
    // origin's beside a host read from upstream (round 1): both facts, one remote.
    expect(filed).toMatchObject({ id: 'B-1', onBranch: 'baton-request/B-1' });
    expect(git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/baton-request/*').trim()).toBe('');
    expect(git(upstream, 'show', '--name-only', '--format=%s', 'refs/heads/baton-request/B-1').split('\n'))
      .toEqual(['B-1: request — Decide the export format, so two implementations agree — create-spec', '', 'tickets/B-1.mdx']);
    expect(pr.calls[0].url).toBe(`https://api.github.com/repos/${upstream.replace(/\.git$/, '')}/pulls`);
  });

  it('a listing that fails, and a head that vanishes before its fetch, cost their ids nothing — and each says one line', async () => {
    // The listing itself refused: no heads are counted, one warning line, the request goes on.
    const silent = repo();
    const warned: string[] = [];
    const failList = listOnce(dirs, { fail: true });
    const filed = await refusing(failList.bin, () => fileRequest(readRequestPlan(silent.dir, 'create-spec', SENTENCE), { warn: (l) => warned.push(l) }));
    expect(filed.id).toBe('B-1');
    expect(git(silent.origin, 'show', 'main:tickets/B-1.mdx')).toContain('id: B-1');
    expect(warned.join('\n')).toContain('could not be listed');

    // A head listed but gone before its fetch — deleted between the ls-remote and the fetch —
    // is dropped, not fatal: its branch is gone, its id is free again, the request goes on.
    const vanished = repo();
    const ghost = listOnce(dirs, { line: `${'e'.repeat(40)}\trefs/heads/baton-request/B-7` });
    const warnedToo: string[] = [];
    const filedToo = await refusing(ghost.bin, () => fileRequest(readRequestPlan(vanished.dir, 'create-spec', SENTENCE), { warn: (l) => warnedToo.push(l) }));
    expect(filedToo.id).toBe('B-1'); // B-7 is uncounted: the branch cannot be fetched at all
    expect(git(vanished.origin, 'show', 'main:tickets/B-1.mdx')).toContain('id: B-1');
    expect(warnedToo.join('\n')).toContain('baton-request/B-7 on origin could not be fetched');
  });

  it('the allocator counts the open request branches even when the push is admitted', async () => {
    const { dir, origin } = repo();
    // No shim: the default branch takes the push. The open request branch's B-4 still counts.
    git(dir, 'checkout', '-q', '-b', 'prior', 'origin/main');
    writeFileSync(join(dir, 'tickets', 'B-4.mdx'), `---\nid: B-4\ntitle: B-4\nstatus: available\ntags: [request]\ncourse: create-spec\n---\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'B-4 waiting');
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/baton-request/B-4');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'fetch', '-q', 'origin');
    git(dir, 'branch', '-D', 'prior');
    // The push's own opportunistic tracking ref aside, the caller's repository starts clean:
    // the scan must leave it exactly so.
    git(dir, 'branch', '-rd', 'origin/baton-request/B-4');
    const filed = await fileRequest(readRequestPlan(dir, 'create-spec', SENTENCE));
    expect(filed.id).toBe('B-5');
    expect(git(origin, 'show', 'main:tickets/B-5.mdx')).toContain('id: B-5');
    // And the caller's repository keeps no ref the scan wrote: FETCH_HEAD aside, nothing moved.
    expect(git(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/baton-request/*').trim()).toBe('');
  });
});

describe('B-174: --forge is the caller’s word, checked before anything runs', () => {
  it('a forge it does not know is one refusal, and git is a name', async () => {
    const { dir } = repo();
    await expect(requestMain(['--course', 'create-spec', SENTENCE, '--forge', 'gogs'], { root: dir, log: () => {} }))
      .rejects.toThrow('--forge gogs: not a forge (one of github, gitlab, gitea, git) — git names the plain servers, which have no adapter');
    await expect(requestMain(['--course', 'create-spec', SENTENCE, '--forge', 'gitlab'], { root: dir, log: () => {} })).resolves.toBe(0);
  });
});
