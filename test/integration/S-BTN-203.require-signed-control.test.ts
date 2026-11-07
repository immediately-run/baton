// S-BTN-203 require_signed_control (B-127, BATON_SPEC §7.1, R-BTN-66 as amended, R-BTN-133's
// verified tree extended): the whole gate over a real repository — real SSH-signed commits, the
// sync's own walks, the post, Baton's record, and the runner loading what the post names. Must
// hold: with the setting on, an unsigned change to `agent_command` leaves the runner running the
// owner-signed one and raises the `unsigned-control` notice; an owner-signed change takes
// effect; a commit signed by a non-owner key, or a forged signature, counts as unsigned (the
// runner refuses to load what the post named); an EXPEDITE added unsigned does not expedite; a
// brief filed unsigned is marked unsigned and the claim answer says so. Node only: it runs git,
// ssh-keygen and the runner's leg child processes (the S-BTN-157 and S-BTN-26 patterns); the
// server half of every clause runs on both hosts in S-BTN-202.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { BatonApi } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { capabilitiesOf } from '../../src/shared/vocabulary.mjs';
import { initMain, parseSyncArgs, syncMain, type SyncArgs } from '../../src/defaults/cli';
import { cutover, keyCall, ORIGIN, rows, setAdminKeys, setClock, syncToken, TOKENS } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

// A clock a minute behind the real one `syncMain` signs with (S-BTN-157's reason: the CI
// identity token carries the real clock's `iat`).
const T0 = Date.now() - 60_000;
const SLUG = 'immediately-run/docs';

let dir: string;
let ownerFile: string;       // the owner's private key, on disk: git signs with it
let ownerPub: string;
let ownerFp: string;
let otherFile: string;       // a non-owner's key, equally able to sign a commit
let token: string;
let admin: TestKey;
let ownerHttp: TestKey;   // an owner's key for the routes (WebCrypto, as keyCall signs)
let clock = T0;
const tick = () => setClock(clock += 60_000);

/** A checkout as `baton repo init` writes it, plus our ticket and the agent the settings name. */
function home(): void {
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'relay@test');
  g('config', 'user.name', 'relay test');
  g('remote', 'add', 'origin', `https://github.com/${SLUG}.git`);
}

/** One commit, signed by the owner's key (`gpg.format ssh`) or not. */
function commit(sign: 'owner' | 'other' | null, message: string): string {
  const config = sign ? ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${sign === 'owner' ? ownerFile : otherFile}`] : [];
  try {
    execFileSync('git', ['-C', dir, ...config, 'commit', ...(sign ? ['-S'] : ['--no-gpg-sign']), '-qm', message], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`git commit (${message}): ${(e as { stderr?: string }).stderr}`);
  }
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
const head = (): string => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const write = (path: string, text: string): void => {
  writeFileSync(join(dir, path), text);
  execFileSync('git', ['-C', dir, 'add', path], { stdio: 'ignore' });
};

/** `baton repo sync` over the real checkout, its exit code and log. */
async function sync(): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const args: Omit<SyncArgs, 'log'> = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--token', token, '--facts', join(dir, '.baton', 'facts.json')], {});
  const code = await syncMain({ ...args, transport: (req) => hostCall(req), log: (l) => lines.push(l) });
  return { code, lines };
}

/** A runner against this test's Baton (S-BTN-26's shape), its log captured. */
function makeRunner(log: string[]): Runner {
  const api = new BatonApi({
    url: 'https://baton.test',
    transport: (req) => hostCall(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
  });
  const runner = new Runner({
    api, home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
    capabilities: [...capabilitiesOf(['agent-venue'])],
    session: `s203-${Date.now()}`, courses: [{ course: 'create-pr', version: 1 }], stateFile: join(tmpdir(), `baton-s203-${process.pid}-${Date.now()}.json`),
    beatEvery: 60_000, log: (l) => log.push(l),
  });
  return runner;
}

beforeEach(async () => {
  await setClock(clock = T0);
  dir = mkdtempSync(join(tmpdir(), 'baton-s203-'));
  const keys = mkdtempSync(join(tmpdir(), 'baton-s203-keys-'));
  ownerFile = join(keys, 'owner');
  otherFile = join(keys, 'other');
  for (const [f, name] of [[ownerFile, 'owner'], [otherFile, 'other']] as const) {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', f, '-C', `${name}@test`], { stdio: 'ignore' });
  }
  ownerPub = readFileSync(`${ownerFile}.pub`, 'utf8').trim();
  ownerFp = /(\bSHA256:[A-Za-z0-9+/]{43}\b)/.exec(execFileSync('ssh-keygen', ['-lf', `${ownerFile}.pub`], { encoding: 'utf8' }))![1];
  admin = await makeKey('ssh-ed25519', 'admin');
  ownerHttp = await makeKey('ssh-ed25519', 'docs-owner-http');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [ownerPub, ownerHttp.publicKey] })).status).toBe(200);
  await rows('INSERT INTO human_keys (fingerprint, public_key, added_by, added_at) VALUES (?, ?, ?, ?)', ownerFp, ownerPub, 'admin:test', T0);
  home();
  token = await syncToken();
  await cutover();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The scaffolded home: one ticket with an unsigned-filed brief, a stub-written agent that
 *  records its own argv, and the owner-signed baseline of the settings. Returns the signed
 *  baseline's sha. */
async function scaffold(): Promise<{ baseline: string; filed: string }> {
  // No --agent-command at the scaffold: the owner-signed baseline must CHANGE the settings to
  // count (the walk reads the commit that last changed a group; an empty signature signs
  // nothing), so it is the commit that names the agent.
  expect(await initMain([], { root: dir, log: () => {} })).toBe(0);
  write('agent.mjs', "import { appendFileSync } from 'node:fs';\nappendFileSync('ran-agent.txt', process.argv.slice(2).join(' ') + '\\n');\n");
  write('evil-agent.mjs', "import { appendFileSync } from 'node:fs';\nappendFileSync('ran-agent.txt', 'THE PUSHED AGENT\\n');\n");
  write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork.\n');
  writeFileSync(join(dir, '.baton', 'facts.json'), '[]');
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' }); // the scaffold's own files
  const filed = commit(null, 'scaffold, unsigned');
  const settings = JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
  settings.agent_command = 'node ./agent.mjs';
  write('.baton/baton.json', `${JSON.stringify(settings, null, 2)}\n`);
  const baseline = commit('owner', 'the owner-signed baseline of the settings');
  return { baseline, filed };
}

describe('S-BTN-203 require_signed_control', () => {
  it('an unsigned change to agent_command leaves the runner running the signed one, and the notice is raised', async () => {
    const { baseline } = await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // The worker pushes a new agent_command.
    const settings = JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
    settings.agent_command = 'node ./evil-agent.mjs';
    write('.baton/baton.json', `${JSON.stringify(settings, null, 2)}\n`);
    const pushed = commit(null, 'the pushed settings');
    await tick();
    expect((await sync()).code).toBe(0);
    // The record names the signed baseline for the group, the unsigned change in its list.
    const record = (await rows<{ sha: string; control_json: string }>('SELECT sha, control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0];
    const control = JSON.parse(record.control_json) as { groups: { agent_command: { read: string; key: string } }; unsigned: { path: string; commits: string[] }[] };
    expect(control.groups.agent_command).toMatchObject({ read: baseline, key: ownerFp });
    expect(control.unsigned).toContainEqual({ path: '.baton/baton.json', commits: [pushed] });
    expect(await rows(`SELECT COUNT(*) AS n FROM events WHERE kind = 'unsigned-control'`)).toEqual([{ n: 1 }]);
    // The claim answer carries the record (Baton's own setting and keys with it), and the leg
    // that runs reads the settings at the baseline: the signed agent runs, the pushed one never.
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      const out = await runner.runOnce();
      expect(out).not.toBeNull();
      expect(readFileSync(join(dir, 'ran-agent.txt'), 'utf8')).not.toContain('THE PUSHED AGENT');
      // And the answer's own control said what was loaded.
      expect(log.join('\n')).not.toContain('THE PUSHED AGENT');
      const claim = (await rows<{ snapshot_sha: string }>('SELECT snapshot_sha FROM claims ORDER BY id DESC LIMIT 1'))[0];
      expect(claim.snapshot_sha).toBe(pushed);
    } finally {
      runner.stop();
    }
  }, 120_000);

  it('an owner-signed change takes effect; a non-owner key\'s counts as unsigned', async () => {
    const { baseline } = await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // A commit signed by a key that is not an owner's: the gate reads it as unsigned.
    const settings = JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
    settings.agent_command = 'node ./evil-agent.mjs';
    write('.baton/baton.json', `${JSON.stringify(settings, null, 2)}\n`);
    const others = commit('other', 'signed by a non-owner');
    await tick();
    expect((await sync()).code).toBe(0);
    let control = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(control.groups.agent_command).toMatchObject({ read: baseline, key: ownerFp });
    expect(control.groups.agent_command.unsigned).toContain(others);
    // The owner signs the change: the head itself becomes the version in force.
    settings.agent_command = 'node ./agent.mjs';
    write('.baton/baton.json', `${JSON.stringify(settings, null, 2)}\n`);
    const signed = commit('owner', 'the owner signs the new settings');
    await tick();
    expect((await sync()).code).toBe(0);
    control = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(control.groups.agent_command).toMatchObject({ read: signed, key: ownerFp });
    expect(control.groups.agent_command.unsigned).toEqual([]);
  }, 120_000);

  it('a forged named commit is refused by the runner itself: the claim ends, nothing runs', async () => {
    const { baseline } = await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // A lying record — the finding-4 case: the post (here, the stored record) names an unsigned
    // commit for the group. The runner verifies before loading and refuses the claim closed.
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork, changed.\n');
    const pushed = commit(null, 'an unsigned change the record will lie about');
    const record = (await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0];
    const forgedRecord = JSON.parse(record.control_json);
    forgedRecord.groups.agent_command.read = pushed;
    forgedRecord.groups.agent_command.key = ownerFp;
    await rows('UPDATE signed_control SET control_json = ? WHERE repository_id = ?', JSON.stringify(forgedRecord), 'docs');
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      const out = await runner.runOnce();
      expect(out).not.toBeNull();
      const said = log.join('\n');
      expect(said).toContain('carries no signature of an owner key');
      const end = (await rows<{ status: string; end_reason: string }>('SELECT status, end_reason FROM claims ORDER BY id DESC LIMIT 1'))[0];
      expect([end.status, end.end_reason]).toEqual(['released', 'released:cannot-finish:spec']);
      // No leg ran: the runner loaded nothing from the named commit.
      expect(await rows(`SELECT COUNT(*) AS n FROM claim_legs`)).toEqual([{ n: 0 }]);
    } finally {
      runner.stop();
    }
  }, 120_000);

  it('an EXPEDITE added unsigned does not expedite; the brief filed unsigned is marked so', async () => {
    const { baseline, filed } = await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // Even with the setting off the brief is marked; turn it off to prove the marking stands.
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\ntags: [EXPEDITE]\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork.\n');
    const expedited = commit(null, 'the worker adds EXPEDITE');
    await tick();
    expect((await sync()).code).toBe(0);
    expect(await rows('SELECT expedite FROM tickets WHERE id = ?', 'docs:B-9001')).toEqual([{ expedite: 0 }]);
    const record = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(record.unsigned).toContainEqual({ path: 'tickets/B-9001.mdx', commits: [expedited], fields: ['EXPEDITE'] });
    expect(await rows('SELECT brief FROM tickets WHERE id = ?', 'docs:B-9001')).toEqual([
      { brief: JSON.stringify({ signed: false, commit: filed }) },
    ]);
    // The setting off: the tag counts as today (nothing is gated), and the marking still posts.
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: false }, 'PUT')).status).toBe(200);
    // A head move (§7.1: a refresh replaces the stations, not the tickets).
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\ntags: [EXPEDITE]\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork, and a later change.\n');
    commit(null, 'a later change');
    await tick();
    expect((await sync()).code).toBe(0);
    expect(await rows('SELECT expedite FROM tickets WHERE id = ?', 'docs:B-9001')).toEqual([{ expedite: 1 }]);
    expect(await rows('SELECT brief FROM tickets WHERE id = ?', 'docs:B-9001')).toEqual([
      { brief: JSON.stringify({ signed: false, commit: filed }) },
    ]);
  }, 120_000);
});
