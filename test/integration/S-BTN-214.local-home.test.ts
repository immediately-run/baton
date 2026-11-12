// S-BTN-214 a plain-git home on a GitHub code repository (BATON_SPEC §15 S-BTN-214, §3.4
// R-BTN-96/R-BTN-140/R-BTN-139, §5.8 R-BTN-190; B-182): the owner's dogfood shape — a local
// Baton, a home repository that is plain git, and a `create-pr` ticket whose `repos:` names a
// GitHub repository the home's `code_repos` lists with its ids. Must hold: the sync reads only
// the code repository (verifying its ids at every read, under that host's budget), the ticket
// walks `filed` → `pr-open` → `reviewed` → `merged` from fixture GitHub facts with its rounds
// in the PR's conversation — the claim answer carries `leg_state: forge` — and a ticket on a
// course that reads no PR facts keeps `leg_state: branch`; the registry carries each course's
// `facts` (R-BTN-134) and the claim's scope resolves `repos:` through the list. Node only: it
// writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { claimItem, endClaim, keyCall, ORIGIN, register, rows, setAdminKeys, setClock } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { githubFake } from '../githubFake';

// The sync signs with the system clock (the stub runs under the real one), so the two must
// agree within the signature window; a minute is inside it, as S-BTN-156 sets out.
const T0 = Date.now() - 60_000;
let minutes = 0;
const later = () => setClock(T0 + (minutes += 1) * 60_000);

/** A home checkout on a bare local remote — a plain git home (R-BTN-105's shape, over its path). */
let dir: string;
let remote: string;
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** An ed25519 key ssh-keygen makes, as S-BTN-156's: a private file the CLI itself signs with. */
let scratch: string;
function keyPair(name: string): { file: string; publicKey: string } {
  const file = join(scratch, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', file], { stdio: 'ignore' });
  return { file, publicKey: execFileSync('cat', [`${file}.pub`], { encoding: 'utf8' }).trim().split(' ').slice(0, 2).join(' ') };
}

/** The ids the fake forge reports for `acme/monorepo`, and the routes reading PR 7. */
const MONO_IDS = { id: 7001, owner: { id: 31 } };
const pull = (merged = false) => ({ number: 7, head: { ref: 'claude/LIN-1-fix', sha: 's7' }, state: merged ? 'closed' : 'open', merged_at: merged ? '2026-11-12T13:00:00Z' : null });
const detail = (comments: unknown[] = []) => ({
  [`/repos/acme/monorepo/commits/s7/check-runs`]: { check_runs: [{ conclusion: 'success' }] },
  [`/repos/acme/monorepo/pulls/7/commits`]: [{ sha: 'c7', commit: { message: 'the work', committer: { date: '2026-11-12T11:00:00Z' } } }],
  [`/repos/acme/monorepo/pulls/7/reviews`]: [],
  [`/repos/acme/monorepo/issues/7/comments`]: comments,
});
const verdict = (login: string, at = '2026-11-12T12:30:00Z') => ({ user: { login }, author_association: 'CONTRIBUTOR', body: '<!-- baton:verdict approve -->\nbaton: home:LIN-1 review', created_at: at });
const permission = (login: string, p: string, id: number) => ({ [`/repos/acme/monorepo/collaborators/${login}/permission`]: { permission: p, user: { id } } });

/** A recorded GitHub for the code repository, and the requests the adapter made. */
let github: Record<string, unknown>;
const asked: string[] = [];
const forge = () => vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => githubFake(github, asked)(url, init));

/** One sync, signed by the home's sync key. */
let syncFile: string;
async function sync(): Promise<number> {
  await later();
  const args = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--sync-key', syncFile], {});
  return syncMain({ ...args, transport: (req) => hostCall(req), log: () => {} });
}

const stationOf = async (id: string) => (await rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', `home:${id}`))[0];
const nextOf = (id: string) => rows<{ leg: string; state: string; waiting_on: string | null }>('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `home:${id}`);

beforeEach(async () => {
  await setClock(T0);
  scratch = mkdtempSync(join(tmpdir(), 'baton-s214-keys-'));
  dir = mkdtempSync(join(tmpdir(), 'baton-s214-'));
  remote = mkdtempSync(join(tmpdir(), 'baton-s214-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's214@test'], ['config', 'user.name', 's214'], ['remote', 'add', 'origin', remote]]) execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  // The home: registered as plain git, with its owner and sync keys; `code_repos` names the
  // GitHub repository with the ids the fake forge reports.
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  const syncKey = keyPair('sync');
  syncFile = syncKey.file;
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'home', github: 'you/home', forge: 'git', remote: 'ssh://git@localhost/home.git', default_branch: 'main',
    sync_keys: [{ public_key: syncKey.publicKey, role: 'sync' }], owner_keys: [owner.publicKey], cut_over: true,
  })).status).toBe(200);
  // The scaffold: create-pr (a PR course) and bug-report (a marker course, no PR facts).
  expect(await initMain(['--course', 'create-pr'], { root: dir, log: () => {} })).toBe(0);
  expect(await initMain(['--course', 'bug-report'], { root: dir, log: () => {} })).toBe(0);
  const batonJson = join(dir, '.baton', 'baton.json');
  const config = JSON.parse(readFileSync(batonJson, 'utf8')) as Record<string, unknown>;
  writeFileSync(batonJson, JSON.stringify({ ...config, baton_url: ORIGIN, repos: { mono: 'acme/monorepo' }, ticket_prefix: 'LIN' }, null, 2));
  writeFileSync(join(dir, 'tickets', 'LIN-1.md'), '---\nid: LIN-1\ntitle: Ship the fix\nrepos: [mono]\n---\n\nWhat to change.\n\n## Status\n');
  writeFileSync(join(dir, 'tickets', 'LIN-2.md'), '---\nid: LIN-2\ntitle: The save button does nothing\ncourse: bug-report\n---\n\n## trace\n\nWhat the trace found.\n\n## origin\n\nWhere it began.\n\n## dedupe\n\nThe dedupe verdict.\n\n## fold\n\nThe fold.\n\n## prevent\n\nThe prevention weighed.\n');
  git('add', '-A');
  git('commit', '-qm', 'home');
  const set = await keyCall(owner, '/v1/owner/home/settings', {
    code_repos: [{ path: 'acme/monorepo', forge: 'github', host: 'github.com', repo_id: '7001', owner_id: '31' }],
  }, 'PUT');
  if (set.status !== 200) throw new Error(`settings: ${JSON.stringify(set.json)}`);
  github = { '/repos/acme/monorepo': MONO_IDS };
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

describe('S-BTN-214 a plain-git home on a GitHub code repository', () => {
  it('a create-pr ticket walks to merged from the code repository\'s PRs, and its rounds live in the PR conversation', async () => {
    github = { '/repos/acme/monorepo': MONO_IDS, '/repos/acme/monorepo/pulls?state=all': [pull()], ...detail() };
    expect(await sync()).toBe(0);
    // The adapter read the code repository alone — the home is plain git — verifying its ids
    // first (R-BTN-138) and the owned PR's detail over GraphQL, never the home's.
    expect(asked).toContain('/repos/acme/monorepo');
    expect(asked.filter((k) => k.startsWith('graphql '))).toEqual(['graphql acme/monorepo 7']);
    expect(asked.filter((k) => k.startsWith('/repos/') && !k.startsWith('/repos/acme/monorepo'))).toEqual([]);
    expect(await stationOf('LIN-1')).toMatchObject({ station: 'pr-open' });
    // B-110: the run-tests gate cannot reach a PR outside the home, so it asks the owner —
    // through Baton, never a line in git (S-BTN-106's shape, one host further out).
    expect(await nextOf('LIN-1')).toEqual([{ leg: 'run-tests', state: 'waiting', waiting_on: 'owner' }]);
    const admin = await makeKey('ssh-ed25519', 'admin-r');
    const owner = await makeKey('ssh-ed25519', 'owner-r');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'home', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/home/tickets/home:LIN-1/resolve', { decision: 'run-tests-unreachable', answer: 'skip' })).status).toBe(200);

    // A verdict by someone who can push to the code repository (R-BTN-139) reviews the change.
    github = { ...github, ...detail([verdict('baton')]), ...permission('baton', 'write', 99) };
    expect(await sync()).toBe(0);
    expect(await stationOf('LIN-1')).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    // The PR merges on GitHub: the change is merged and the ticket ends.
    github = { ...github, '/repos/acme/monorepo/pulls?state=all': [pull(true)] };
    expect(await sync()).toBe(0);
    expect(await stationOf('LIN-1')).toMatchObject({ station: 'merged', next_leg: null });
  });

  it('the claim answer follows the PRs: forge for the PR course, branch for the marker course', async () => {
    // No PR yet: both tickets are claimable at their start legs.
    github = { '/repos/acme/monorepo': MONO_IDS, '/repos/acme/monorepo/pulls?state=all': [] };
    expect(await sync()).toBe(0);
    expect(await stationOf('LIN-1')).toMatchObject({ station: 'filed', next_leg: 'implement' });
    // R-BTN-134: the registry carries what each course declares it reads, and R-BTN-190 follows
    // it — no policy knob chooses (a git home's policy carries no leg_state at all).
    expect(await rows<{ facts: string }>('SELECT facts FROM courses WHERE repository_id = ? AND id = ?', 'home', 'create-pr')).toEqual([{ facts: '["prs"]' }]);
    expect(await rows<{ facts: string }>('SELECT facts FROM courses WHERE repository_id = ? AND id = ?', 'home', 'bug-report')).toEqual([{ facts: '[]' }]);
    expect(await rows<{ policy_json: string }>('SELECT policy_json FROM repository_policies WHERE repository_id = ?', 'home')).toMatchObject([{ policy_json: expect.not.stringContaining('"leg_state"') }]);
    const courses = [{ repository: 'home', course: 'create-pr', version: 1 }, { repository: 'home', course: 'bug-report', version: 1 }];
    const a = await register('vm-a', { courses, capabilities: ['agent-venue', 'runner:leg-trees'] });
    const claim = await claimItem('vm-a', a.secret, { ticket_id: 'home:LIN-1' });
    if (claim.status !== 200) throw new Error(`claim: ${JSON.stringify(claim.json)}`);
    expect(claim.json.leg_state).toBe('forge');
    // B-134/B-182: the claim's scope resolves `repos:` through the home's list — the entry's
    // path is in, and nothing else is.
    expect(claim.json.scope).toEqual(['acme/monorepo', 'you/home']);
    await endClaim('vm-a', a.secret, claim.json.claim_id, { end_reason: 'completed', status: 'completed', legs: [] });
    const b = await register('vm-b', { courses, capabilities: ['agent-venue', 'runner:leg-trees'] });
    const marker = await claimItem('vm-b', b.secret, { ticket_id: 'home:LIN-2' });
    if (marker.status !== 200) throw new Error(`claim: ${JSON.stringify(marker.json)}`);
    expect(marker.json.leg_state).toBe('branch');
  });
});
