// S-BTN-216 the ids decide for a code repository (BATON_SPEC §15 S-BTN-216, §3.1 R-BTN-138,
// §3.4 R-BTN-140; B-182): reach is by `{host, id}`, never by a path alone. Must hold: a forge
// reporting different ids for a `code_repos` entry than it stores fails the sync naming the
// entry, and nothing is posted — the re-created path gains no reach; a `repos:` repository the
// home's list does not name is not read at all (R-BTN-140's reach). Node only: it writes a real
// repository and runs git.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { keyCall, ORIGIN, rows, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
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

let owner: TestKey;

/** The ids the fake forge reports, and PR routes for one PR on a head LIN-1 owns. */
const ids = (repo: number, owner: number) => ({ id: repo, owner: { id: owner } });
const pull = (n: number) => ({ number: n, head: { ref: 'claude/LIN-1-fix', sha: `s${n}` }, state: 'open', merged_at: null });
const detail = (n: number) => ({
  [`/repos/acme/monorepo/commits/s${n}/check-runs`]: { check_runs: [{ conclusion: 'success' }] },
  [`/repos/acme/monorepo/pulls/${n}/commits`]: [{ sha: `c${n}`, commit: { message: 'the work', committer: { date: '2026-11-12T11:00:00Z' } } }],
  [`/repos/acme/monorepo/pulls/${n}/reviews`]: [],
  [`/repos/acme/monorepo/issues/${n}/comments`]: [],
});

let github: Record<string, unknown>;
const asked: string[] = [];
const forge = () => vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => githubFake(github, asked)(url, init));

let syncFile: string;
async function sync(): Promise<number> {
  await later();
  const args = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--sync-key', syncFile], {});
  return syncMain({ ...args, transport: (req) => hostCall(req), log: () => {} });
}

const headOf = async () => (await rows<{ sha: string | null }>('SELECT sha FROM board_head WHERE repository_id = ?', 'home'))[0].sha;

beforeEach(async () => {
  await setClock(T0);
  scratch = mkdtempSync(join(tmpdir(), 'baton-s216-keys-'));
  dir = mkdtempSync(join(tmpdir(), 'baton-s216-'));
  remote = mkdtempSync(join(tmpdir(), 'baton-s216-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's216@test'], ['config', 'user.name', 's216'], ['remote', 'add', 'origin', remote]]) execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
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
  // The ticket names two repositories: the listed one and one the list does not name.
  writeFileSync(join(dir, 'tickets', 'LIN-1.md'), '---\nid: LIN-1\ntitle: Ship the fix\nrepos: [mono, unlisted/org]\n---\n\nWhat to change.\n\n## Status\n');
  git('add', '-A');
  git('commit', '-qm', 'home');
  expect((await keyCall(owner, '/v1/owner/home/settings', {
    code_repos: [{ path: 'acme/monorepo', forge: 'github', host: 'github.com', repo_id: '7001', owner_id: '31' }],
  }, 'PUT')).status).toBe(200);
  github = { '/repos/acme/monorepo': ids(7001, 31), '/repos/unlisted/org': ids(8, 9) };
  asked.length = 0;
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

describe('S-BTN-216 the ids decide for a code repository', () => {
  it('a forge reporting different ids fails the sync naming the entry, and nothing is posted', async () => {
    github = { ...github, '/repos/acme/monorepo': ids(8888, 31), '/repos/acme/monorepo/pulls?state=all': [pull(7)], ...detail(7) };
    await expect(sync()).rejects.toThrow(/ids 8888\/31 for acme\/monorepo.*entry holds 7001\/31/);
    // The failing run posted nothing: no board, no tickets, the head unmoved.
    expect(await headOf()).toBeNull();
    expect(await rows('SELECT id FROM tickets')).toEqual([]);
    // The same forge with the ids the entry stores reads on and posts.
    github = { ...github, '/repos/acme/monorepo': ids(7001, 31) };
    expect(await sync()).toBe(0);
    expect(await rows<{ station: string }>('SELECT station FROM ticket_stations WHERE ticket_id = ?', 'home:LIN-1')).toEqual([{ station: 'pr-open' }]);
  });

  it('a repos: repository the home\'s list does not name is not read', async () => {
    github = { ...github, '/repos/acme/monorepo/pulls?state=all': [pull(7)], ...detail(7), '/repos/unlisted/org/pulls?state=all': [pull(9)], ...detail(9) };
    expect(await sync()).toBe(0);
    // Only the listed repository was asked of the forge — the unlisted one has no reach
    // (R-BTN-140), its PRs place nothing, and the sync does not fail on it.
    expect([...new Set(asked.map((k) => (k.startsWith('graphql ') ? k : k.split('/').slice(2, 4).join('/'))))].sort()).toEqual(['acme/monorepo', 'graphql acme/monorepo 7']);
    expect(await rows<{ station: string }>('SELECT station FROM ticket_stations WHERE ticket_id = ?', 'home:LIN-1')).toEqual([{ station: 'pr-open' }]);
  });

  it('a GitHub host other than github.com is read at its own endpoints', async () => {
    // R-BTN-96/B-182: the entry names an Enterprise host — `host` is any lowercased DNS name
    // (R-BTN-140) — which serves REST under `/api/v3` and GraphQL at `/api/graphql`, not
    // github.com's paths. A kept path keeps its whole row (R-BTN-140), so moving the entry to
    // the other host takes the list without it, then with it again.
    expect((await keyCall(owner, '/v1/owner/home/settings', { code_repos: [] }, 'PUT')).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/home/settings', {
      code_repos: [{ path: 'acme/monorepo', forge: 'github', host: 'github.acme.example.com', repo_id: '7001', owner_id: '31' }],
    }, 'PUT')).status).toBe(200);
    github = { ...github, '/repos/acme/monorepo/pulls?state=all': [pull(7)], ...detail(7) };
    asked.length = 0;
    expect(await sync()).toBe(0);
    // The ids decided on that host too, the PR list came over its REST and the owned PR's
    // detail over its GraphQL — a doubled or missing endpoint prefix fails the read, so the
    // station proves both halves were asked and answered.
    expect(asked.filter((k) => k.startsWith('graphql '))).toEqual(['graphql acme/monorepo 7']);
    expect(await rows<{ station: string }>('SELECT station FROM ticket_stations WHERE ticket_id = ?', 'home:LIN-1')).toEqual([{ station: 'pr-open' }]);
  });
});
