// S-BTN-217 pushers across hosts (BATON_SPEC §15 S-BTN-217, §3.4 R-BTN-139; B-182): on a
// plain-git home whose code repository sits on GitHub, whose words count there is decided per
// host — an immutable forge user id in the owners' `pushers` for that host, or someone the
// forge reports can push to the PR's base, read on that repository's own forge with that host's
// token. Must hold: a verdict by an author who can neither push nor is listed is not read; one
// by a listed pusher is. Node only: it writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { keyCall, ORIGIN, rows, setAdminKeys, setClock } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { githubFake } from '../githubFake';

const T0 = Date.now() - 60_000;
let minutes = 0;
const later = () => setClock(T0 + (minutes += 1) * 60_000);

let dir: string;
let remote: string;
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let scratch: string;
function keyPair(name: string): { file: string; publicKey: string } {
  const file = join(scratch, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', file], { stdio: 'ignore' });
  return { file, publicKey: execFileSync('cat', [`${file}.pub`], { encoding: 'utf8' }).trim().split(' ').slice(0, 2).join(' ') };
}

const MONO_IDS = { id: 7001, owner: { id: 31 } };
const pull = () => ({ number: 7, head: { ref: 'claude/LIN-1-fix', sha: 's7' }, state: 'open', merged_at: null });
const detail = (comments: unknown[] = []) => ({
  [`/repos/acme/monorepo/commits/s7/check-runs`]: { check_runs: [{ conclusion: 'success' }] },
  [`/repos/acme/monorepo/pulls/7/commits`]: [{ sha: 'c7', commit: { message: 'the work', committer: { date: '2026-11-12T11:00:00Z' } } }],
  [`/repos/acme/monorepo/pulls/7/reviews`]: [],
  [`/repos/acme/monorepo/issues/7/comments`]: comments,
});
/** A verdict line by `login` — a drive-by contributor as far as the association says. */
const verdict = (login: string) => ({ user: { login }, author_association: 'CONTRIBUTOR', body: '<!-- baton:verdict approve -->\nbaton: home:LIN-1 review', created_at: '2026-11-12T12:30:00Z' });
/** The collaborator permission the fake forge reports for `login`, with the id it carries. */
const permission = (login: string, p: string, id: number) => ({ [`/repos/acme/monorepo/collaborators/${login}/permission`]: { permission: p, user: { id } } });

let github: Record<string, unknown>;
const forge = () => vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => githubFake(github, [])(url, init));

let syncFile: string;
async function sync(): Promise<number> {
  await later();
  const args = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--sync-key', syncFile], {});
  return syncMain({ ...args, transport: (req) => hostCall(req), log: () => {} });
}

const stationOf = async () => (await rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'home:LIN-1'))[0];

beforeEach(async () => {
  await setClock(T0);
  scratch = mkdtempSync(join(tmpdir(), 'baton-s217-keys-'));
  dir = mkdtempSync(join(tmpdir(), 'baton-s217-'));
  remote = mkdtempSync(join(tmpdir(), 'baton-s217-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's217@test'], ['config', 'user.name', 's217'], ['remote', 'add', 'origin', remote]]) execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  const syncKey = keyPair('sync');
  syncFile = syncKey.file;
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'home', github: 'you/home', forge: 'git', remote: 'ssh://git@localhost/home.git', default_branch: 'main',
    sync_keys: [{ public_key: syncKey.publicKey, role: 'sync' }], owner_keys: [owner.publicKey], cut_over: true,
  })).status).toBe(200);
  expect(await initMain(['--course', 'create-pr'], { root: dir, log: () => {} })).toBe(0);
  const batonJson = join(dir, '.baton', 'baton.json');
  const config = JSON.parse(readFileSync(batonJson, 'utf8')) as Record<string, unknown>;
  writeFileSync(batonJson, JSON.stringify({ ...config, baton_url: ORIGIN, repos: { mono: 'acme/monorepo' }, ticket_prefix: 'LIN' }, null, 2));
  writeFileSync(join(dir, 'tickets', 'LIN-1.md'), '---\nid: LIN-1\ntitle: Ship the fix\nrepos: [mono]\n---\n\nWhat to change.\n\n## Status\n');
  git('add', '-A');
  git('commit', '-qm', 'home');
  // The owners list one pusher for the code repository's host, by its immutable id (R-BTN-139):
  // pat, id 77 — whom GitHub itself reports as a mere read-only collaborator.
  expect((await keyCall(owner, '/v1/owner/home/settings', {
    code_repos: [{ path: 'acme/monorepo', forge: 'github', host: 'github.com', repo_id: '7001', owner_id: '31' }],
    pushers: [{ host: 'github.com', id: '77' }],
  }, 'PUT')).status).toBe(200);
  github = { '/repos/acme/monorepo': MONO_IDS, '/repos/acme/monorepo/pulls?state=all': [pull()], ...detail() };
  process.env.GITHUB_TOKEN = 't';
  forge();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
  rmSync(dir, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('S-BTN-217 pushers across hosts', () => {
  it('a verdict by an author who can neither push nor is listed is not read; a listed pusher\'s is', async () => {
    // dan can read but not push, and no listed pusher holds dan's id: the verdict does not
    // count, and the change is not reviewed.
    github = { ...github, ...detail([verdict('dan')]), ...permission('dan', 'read', 999) };
    expect(await sync()).toBe(0);
    expect(await stationOf()).toMatchObject({ station: 'pr-open' });
    // pat's permission is read too, but the owners listed pat's immutable id for this host:
    // pat's word counts (R-BTN-139 — the owners' list is the other way to be a pusher).
    github = { ...github, ...detail([verdict('pat')]), ...permission('pat', 'read', 77) };
    expect(await sync()).toBe(0);
    expect(await stationOf()).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
  });
});
