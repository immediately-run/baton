// S-BTN-327 (R-BTN-10): shipped create-pr scripts, real runner and git, fake GitHub.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call as hostCall } from '#host';
import { gitText } from '../../src/defaults/git.mjs';
import { syncMain } from '../../src/defaults/sync';
import { courseReader } from '../../src/runner/main';
import { keyCall, ORIGIN, putRunnerGrant, register, rows, setAdminKeys, setClock } from '../helpers';
import { CODE_REPO, createPrForge, PR_URL } from '../lib/createPrForge';
import { testRunner } from '../lib/runnerRig';
import { makeKey } from '../lib/sshKeys';
import config from '../../.baton/baton.json';

const coursePath = '.baton/courses/create-pr';
const source = join(import.meta.dirname, '../..');
const fixture = join(import.meta.dirname, '../fixtures/create-pr-forge');
const ticket = 'home:T-1';
const file = 'tickets/T-1.md';
const branch = 'claude/T-1-fixture';
const refused = 'released:cannot-finish:transient';
let dir: string, home: string, mirror: string, remote: string, syncKey: string, time: number;
let forge: Awaited<ReturnType<typeof createPrForge>> | undefined;
let board: { attestations?: unknown[]; closed?: unknown[] };

function identity(root: string) {
  gitText(root, 'config', 'user.name', 'Baton Fixture');
  gitText(root, 'config', 'user.email', 'fixture@example.test');
  gitText(root, 'config', 'commit.gpgsign', 'false');
}

beforeEach(async () => {
  time = Date.now();
  await setClock(time);
  dir = mkdtempSync(join(tmpdir(), 'baton-s327-'));
  home = join(dir, 'home');
  mirror = join(dir, 'sync');
  remote = join(dir, 'remote.git');
  syncKey = join(dir, 'sync-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', syncKey]);
  const publicKey = execFileSync('ssh-keygen', ['-y', '-f', syncKey], { encoding: 'utf8' }).trim();
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  const repo = await keyCall(admin, '/v1/admin/repositories', {
    id: 'home', github: 'acme/home', forge: 'git', remote: 'ssh://git@localhost/home.git', default_branch: 'main',
    sync_keys: [{ public_key: publicKey, role: 'sync' }], owner_keys: [owner.publicKey], cut_over: true,
  });
  expect(repo.status, JSON.stringify(repo.json)).toBe(200);
  const settings = await keyCall(owner, '/v1/owner/home/settings', {
    code_repos: [{ path: CODE_REPO, forge: 'github', host: 'github.com', repo_id: '7001', owner_id: '31' }],
  }, 'PUT');
  expect(settings.status, JSON.stringify(settings.json)).toBe(200);
  await register();
  await putRunnerGrant({ credential_id: 'vm-a', repository_id: 'home', capabilities: ['agent-venue'], granted_by: 'admin:test', granted_at: time });

  gitText(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  gitText(dir, 'clone', '-q', remote, home);
  identity(home);
  cpSync(join(source, coursePath), join(home, coursePath), { recursive: true });
  writeFileSync(join(home, '.baton/baton.json'), JSON.stringify({
    items: 'tickets', ticket_prefix: 'T', default_course: 'create-pr', courses: config.courses,
    agent_command: `node '${join(fixture, 'agent.mjs')}'`, repos: { code: CODE_REPO },
  }));
  mkdirSync(join(home, 'tickets'));
  writeFileSync(join(home, file), '---\nid: T-1\ntitle: Fixture change\nstatus: available\nrepos: [code]\n---\n\nFixture work.\n');
  gitText(home, 'add', '.baton', 'tickets');
  gitText(home, 'commit', '-qm', 'Fixture home');
  gitText(home, 'push', '-q', 'origin', 'main');
  gitText(home, 'switch', '-qc', branch);
  writeFileSync(join(home, 'change.txt'), 'Fixture change\n');
  gitText(home, 'add', 'change.txt');
  gitText(home, 'commit', '-qm', 'Fixture change');
  const head = gitText(home, 'rev-parse', 'HEAD');
  gitText(home, 'push', '-q', 'origin', branch);
  gitText(home, 'switch', '-q', 'main');
  gitText(home, 'branch', '-D', branch);
  gitText(dir, 'clone', '-q', remote, mirror);
  forge = await createPrForge(head, () => time);
  const gh = join(dir, 'gh');
  cpSync(join(fixture, 'gh.mjs'), gh);
  // No extension at the executable path; the fixture's package is ESM.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  execFileSync('chmod', ['+x', gh]);
  vi.stubEnv('PATH', `${dir}:${process.env.PATH}`);
  vi.stubEnv('TEST_FORGE_URL', forge.url);
  vi.stubEnv('TEST_FORGE_REPO', CODE_REPO);
  vi.stubEnv('TEST_PR_URL', PR_URL);
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'BATON_AGENT_WRAPPER']) vi.stubEnv(name, undefined);
  const fetchLocal = fetch;
  const url = forge.url;
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const at = new URL(input);
    if (at.origin !== 'https://api.github.com') throw new Error(`unexpected forge origin ${at.origin}`);
    return fetchLocal(`${url}${at.pathname}${at.search}`, init);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await forge?.close();
  forge = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function sync() {
  await setClock(time += 1000);
  gitText(mirror, 'pull', '-q', '--ff-only');
  const logs: string[] = [];
  board = {};
  process.env.GITHUB_TOKEN = 'fixture-token';
  try {
    expect(await syncMain({ root: mirror, url: ORIGIN, syncKey, log: (line) => logs.push(line), transport: async (req) => {
      if (new URL(req.url).pathname.endsWith('/board') && req.method === 'POST') {
        board = await req.clone().json();
      }
      return hostCall(req);
    } }), logs.join('\n')).toBe(0);
  } finally {
    delete process.env.GITHUB_TOKEN;
  }
}

async function run(leg: string) {
  const log: string[] = [];
  const runner = testRunner({ home, repository: 'home', session: 's327', courses: courseReader(home, 'home')(),
    stateFile: join(dir, 'runner.json'), now: () => time, bounds: { legs: [leg], maxLegs: 1 }, log: (line) => log.push(line) });
  try {
    const outcome = await runner.runOnce();
    expect(outcome, log.join('\n')).toMatchObject({ ticket });
    return { outcome, log };
  } finally {
    runner.stop();
  }
}

const station = async () => (await rows<{ station: string; next_leg: string | null }>(
  'SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', ticket))[0];
const end = async () => (await rows<{ id: number; ended_at_sha: string; confirmed_at: number | null }>(
  'SELECT id, ended_at_sha, confirmed_at FROM claims WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', ticket))[0];

async function confirmEvidence(evidence: string) {
  const claim = await end();
  expect(claim).toMatchObject({ ended_at_sha: evidence, confirmed_at: null });
  await sync();
  expect(board.attestations).toContainEqual({ ref: String(claim.id), ticket: 'T-1', type: 'std:git.evidence@1', value: { claim: claim.id, evidence, found: true } });
  expect(await end()).toMatchObject({ id: claim.id, confirmed_at: time });
}

async function review(verdict: 'approve' | 'changes') {
  await sync();
  expect(await station()).toEqual({ station: 'pr-open', next_leg: 'review' });
  vi.stubEnv('TEST_VERDICT', verdict);
  const { outcome, log } = await run('review');
  expect(outcome, log.join('\n')).toMatchObject({ end_reason: 'suspended:reviewed' });
  const [comment] = forge!.comments;
  expect(comment?.body).toContain(`<!-- baton:verdict ${verdict} -->`);
  await confirmEvidence(comment.html_url);
  expect(await station()).toEqual({ station: 'reviewed', next_leg: verdict === 'approve' ? 'merge' : 'fix' });
}

describe('S-BTN-327 shipped create-pr against a fake forge', () => {
  it('confirms the review comment URL through the forge evidence read', async () => {
    await review('approve');
    expect(forge!.calls).toContain(`/repos/${CODE_REPO}/issues/comments/${forge!.comments[0].id}`);
  });

  it('confirms the fix commit pushed by the agent', async () => {
    await review('changes');
    const { outcome, log } = await run('fix');
    expect(outcome, log.join('\n')).toMatchObject({ end_reason: 'suspended:fixed' });
    const evidence = gitText(remote, 'rev-parse', `refs/heads/${branch}`);
    expect(evidence).not.toBe(forge!.pr.head.sha);
    await confirmEvidence(evidence);
  });

  it.each(['still open', 'conflicting', 'red', 'pending'])('does not land when the PR is %s', async (state) => {
    await review('approve');
    const f = forge!;
    if (state === 'still open' || state === 'conflicting') f.merge.refusal = state === 'conflicting' ? 'merge conflict' : 'merge refused';
    else f.checks[0].conclusion = state === 'red' ? 'failure' : null;
    const { outcome, log } = await run('merge');
    expect(f.merge.attempts).toBe(1);
    expect(outcome, log.join('\n')).toMatchObject({ end_reason: refused });
    expect(log.join('\n')).toContain('is still open');
    expect(f.pr.state).toBe('open');
    expect(await station()).toMatchObject({ station: 'reviewed' });
    await sync();
    expect(await station()).toMatchObject({ station: 'reviewed' });
    expect((await end()).ended_at_sha).toBeNull();
  });

  it('confirms the successful merge by ticket closure', async () => {
    await review('approve');
    vi.stubEnv('TEST_MERGE_BASE', 'main');
    const { outcome, log } = await run('merge');
    expect(outcome, log.join('\n')).toMatchObject({ end_reason: 'done' });
    expect(forge!.pr.merged_at).not.toBeNull();
    expect(gitText(remote, 'branch', '--contains', forge!.pr.head.sha)).toContain('main');
    const claim = await end();
    expect(claim.confirmed_at).toBeNull();
    await sync();
    expect(await end()).toMatchObject({ id: claim.id, confirmed_at: time });
    expect(board.closed).toContainEqual(expect.objectContaining({ id: 'T-1', as: 'done' }));
    expect(await rows(`SELECT actor FROM events WHERE kind = 'confirmed' AND claim_id = ?`, claim.id)).toEqual([{ actor: 'sync' }]);
  });

  // The shipped verifier reads `state` but not the base ref. Keep the desired assertion
  // executable without changing the production leg in this test-only ticket.
  describe('when GitHub merged into staging, not main', () => {
    let result: Awaited<ReturnType<typeof run>>;
    beforeEach(async () => {
      await review('approve');
      forge!.pr.base.ref = 'staging';
      vi.stubEnv('TEST_MERGE_BASE', 'staging');
      result = await run('merge');
      expect(forge!.pr.merged_at).not.toBeNull();
      expect(gitText(remote, 'rev-parse', 'staging')).toBe(forge!.pr.head.sha);
      expect(gitText(remote, 'branch', '--contains', forge!.pr.head.sha)).not.toContain('main');
    });
    it.fails('does not report merged', () => {
      expect(result.outcome, result.log.join('\n')).toMatchObject({ end_reason: refused });
    });
  });
});
