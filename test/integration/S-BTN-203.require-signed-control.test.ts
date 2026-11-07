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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

/** The course group's ceremony files: every leg script AND instruction file of the scaffolded
 *  course (the group is atomic per file — an unsigned change to one leg must not ride in
 *  through a signed change to another, and round 2 made the `.md` files group paths beside the
 *  scripts, so the owner signs a change touching each; the graph file stays out of the group, a
 *  sourced course's being pinned byte-equal by the sync, B-33). */
function bumpLegs(): void {
  const legs = join(dir, '.baton', 'courses', 'create-pr', 'legs');
  for (const f of readdirSync(legs)) {
    if ((!f.endsWith('.mjs') && !f.endsWith('.md')) || f.endsWith('.run.mjs')) continue;
    const file = join(legs, f);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
    execFileSync('git', ['-C', dir, 'add', `.baton/courses/create-pr/legs/${f}`], { stdio: 'ignore' });
  }
}

/** The scaffolded home: one ticket with an unsigned-filed brief, a stub-written agent that
 *  records its own argv, an evil agent, and — with `ceremony` — the owner-signed baseline of
 *  every control group: the settings (the commit that names the agent, so the walk sees a real
 *  change) and a bump of the course's leg scripts (the course group round 1 added). Returns
 *  the signed baseline's sha. Without the ceremony, every group's changes stay unsigned: the
 *  pre-adoption window the claim-refusal test needs. */
async function scaffold(ceremony = true): Promise<{ baseline: string; filed: string }> {
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
  if (!ceremony) return { baseline: '', filed };
  const settings = JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
  settings.agent_command = 'node ./agent.mjs';
  write('.baton/baton.json', `${JSON.stringify(settings, null, 2)}\n`);
  bumpLegs();
  const baseline = commit('owner', 'the owner-signed baseline of the control inputs');
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
    const control = JSON.parse(record.control_json) as { groups: { agent_command: { read: string; key: string }; course: { read: string; key: string } }; unsigned: { path: string; commits: string[] }[] };
    expect(control.groups.agent_command).toMatchObject({ read: baseline, key: ownerFp });
    expect(control.groups.course).toMatchObject({ read: baseline, key: ownerFp });
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

  it('an unsigned REMOVAL of an owner-signed EXPEDITE keeps it in force (round 1, both directions)', async () => {
    const { baseline } = await scaffold();
    // The tag added by the owner: the ceremony's state, then a signed change that adds the tag.
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\ntags: [EXPEDITE]\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork.\n');
    commit('owner', 'the owner adds EXPEDITE');
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    expect(await rows('SELECT expedite FROM tickets WHERE id = ?', 'docs:B-9001')).toEqual([{ expedite: 1 }]);
    // The worker removes the tag unsigned: the last signed state — present — stays in force.
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork.\n');
    const removed = commit(null, 'the worker removes EXPEDITE');
    await tick();
    expect((await sync()).code).toBe(0);
    expect(await rows('SELECT expedite FROM tickets WHERE id = ?', 'docs:B-9001')).toEqual([{ expedite: 1 }]);
    const record = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(record.unsigned).toContainEqual({ path: 'tickets/B-9001.mdx', commits: [removed], fields: ['EXPEDITE'] });
    // With the setting off, the same removal counts as today's.
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: false }, 'PUT')).status).toBe(200);
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork, and a later change.\n');
    commit(null, 'a later change');
    await tick();
    expect((await sync()).code).toBe(0);
    expect(await rows('SELECT expedite FROM tickets WHERE id = ?', 'docs:B-9001')).toEqual([{ expedite: 0 }]);
  }, 120_000);

  it('an unsigned change to a course\'s leg scripts never runs: the runner loads the signed course (round 1, blocking)', async () => {
    await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // The push rewrites the implement leg itself — the code that enforces the gate — to run
    // anything.
    const legFile = join(dir, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs');
    writeFileSync(legFile, "import { appendFileSync } from 'node:fs';\nappendFileSync('ran-leg.txt', 'THE PUSHED LEG RAN\\n');\nexport async function run(ctx) { return { reached: 'pr-open', next: 'run-tests' }; }\n");
    execFileSync('git', ['-C', dir, 'add', '.baton/courses/create-pr/legs/implement.mjs'], { stdio: 'ignore' });
    const pushed = commit(null, 'the pushed leg script');
    await tick();
    expect((await sync()).code).toBe(0);
    const control = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(control.groups.course.unsigned).toContain(pushed);
    // The runner claims and runs the SIGNED leg (the scaffold's stub, which runs the signed
    // agent): the pushed leg script never executes, whatever it would have run.
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      const out = await runner.runOnce();
      expect(out).not.toBeNull();
      expect(readFileSync(join(dir, 'ran-agent.txt'), 'utf8')).not.toContain('PUSHED');
      expect(existsSync(join(dir, 'ran-leg.txt'))).toBe(false);
      const claim = (await rows<{ snapshot_sha: string }>('SELECT snapshot_sha FROM claims ORDER BY id DESC LIMIT 1'))[0];
      expect(claim.snapshot_sha).toBe(pushed);
    } finally {
      runner.stop();
    }
  }, 120_000);

  it('a record that names a keyless commit other than the snapshot is refused by the runner (round 1, blocking)', async () => {
    const { baseline, filed } = await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // A lying record of the {read, key: null} shape: only the snapshot itself may stand as the
    // unsigned baseline; any other keyless read ungates the group on the post's word alone.
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork, changed.\n');
    const pushed = commit(null, 'an unsigned change the record will lie about');
    await tick();
    expect((await sync()).code).toBe(0); // the snapshot moves past the baseline: the lie becomes tellable
    const record = (await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0];
    const lying = JSON.parse(record.control_json);
    lying.groups.agent_command = { read: baseline, key: null };
    await rows('UPDATE signed_control SET control_json = ? WHERE repository_id = ?', JSON.stringify(lying), 'docs');
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      const out = await runner.runOnce();
      expect(out).not.toBeNull();
      expect(log.join('\n')).toContain('no signing key');
      const end = (await rows<{ status: string; end_reason: string }>('SELECT status, end_reason FROM claims ORDER BY id DESC LIMIT 1'))[0];
      expect([end.status, end.end_reason]).toEqual(['released', 'released:cannot-finish:spec']);
      expect(await rows(`SELECT COUNT(*) AS n FROM claim_legs`)).toEqual([{ n: 0 }]);
    } finally {
      runner.stop();
    }
  }, 120_000);

  it('a named commit off the branch — or older than the snapshot\'s line — never loads (round 1)', async () => {
    await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // An owner-signed commit on a side branch: a good signature, but not where the snapshot
    // came from — the rollback the first-parent rule exists to prevent, off-branch.
    execFileSync('git', ['-C', dir, 'checkout', '-q', '-b', 'side', 'HEAD~1'], { stdio: 'ignore' });
    const sideSettings = JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
    sideSettings.side_branch_note = 'a real change, signed';
    write('.baton/baton.json', `${JSON.stringify(sideSettings, null, 2)}\n`);
    const side = commit('owner', 'a signed change off the branch');
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'main'], { stdio: 'ignore' });
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork, changed.\n');
    commit(null, 'a later head move');
    await tick();
    expect((await sync()).code).toBe(0);
    const record = (await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0];
    const lying = JSON.parse(record.control_json);
    lying.groups.agent_command = { read: side, key: ownerFp };
    await rows('UPDATE signed_control SET control_json = ? WHERE repository_id = ?', JSON.stringify(lying), 'docs');
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      const out = await runner.runOnce();
      expect(out).not.toBeNull();
      expect(log.join('\n')).toContain('not an ancestor');
      expect(await rows(`SELECT COUNT(*) AS n FROM claim_legs`)).toEqual([{ n: 0 }]);
    } finally {
      runner.stop();
    }
  }, 120_000);

  it('the leg instructions are the course group\'s: an unsigned .md keeps the signed words in force; a signed .md change takes effect (round 2, blocking)', async () => {
    const { baseline } = await scaffold();
    // The agent copies the file BATON_INSTRUCTIONS names into its output, so the test sees
    // exactly which instructions the stub served — the strongest behaviour-shaping input a
    // course has, and round 2's blocking finding: the .md files belonged to no group, loaded
    // from the agent_command group's signed tree, where a signed .md change never took effect
    // and an unsigned one rode into force with the next signed settings change.
    write('agent.mjs', "import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync('ran-agent.txt', 'INSTRUCTIONS:' + (process.env.BATON_INSTRUCTIONS ? readFileSync(process.env.BATON_INSTRUCTIONS, 'utf8') : '<none>') + '\\n');\n");
    commit(null, 'the agent records the instructions it was served');
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // The push rewrites the implement instructions unsigned: the notice names them, the course
    // group holds at the signed baseline, and the leg runs with the SIGNED words.
    const mdRel = '.baton/courses/create-pr/legs/implement.md';
    write(mdRel, `${readFileSync(join(dir, mdRel), 'utf8')}\nPUSHED-INSTRUCTIONS-MARKER\n`);
    const pushed = commit(null, 'the pushed instructions');
    await tick();
    expect((await sync()).code).toBe(0);
    const control = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(control.groups.course.read).toBe(baseline);
    expect(control.groups.course.unsigned).toEqual([pushed]);
    expect(control.unsigned).toContainEqual({ path: '.baton/courses/create-pr/legs/implement.md', commits: [pushed] });
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      const out = await runner.runOnce();
      expect(out).toMatchObject({ ticket: 'docs:B-9001', end_reason: 'released:cannot-finish:transient' });
      const served = readFileSync(join(dir, 'ran-agent.txt'), 'utf8');
      expect(served).toContain('INSTRUCTIONS:');
      expect(served).not.toContain('PUSHED-INSTRUCTIONS-MARKER');
    } finally {
      runner.stop();
    }
    // The owner signs the pushed instructions: the group moves to that commit and the SAME leg
    // serves the owner-signed words — a signed .md change takes effect on its own, with no
    // settings or scripts change to carry it.
    await setClock(clock += 2 * 60_000_000); // past the failed attempt's one-hour backoff
    write(mdRel, `${readFileSync(join(dir, mdRel), 'utf8')}\n`);
    const signed = commit('owner', 'the owner signs the pushed instructions');
    await tick();
    expect((await sync()).code).toBe(0);
    const control2 = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(control2.groups.course).toMatchObject({ read: signed, key: ownerFp });
    const log2: string[] = [];
    const runner2 = makeRunner(log2);
    try {
      expect(await runner2.runOnce()).not.toBeNull();
      const served2 = readFileSync(join(dir, 'ran-agent.txt'), 'utf8');
      expect(served2.slice(served2.lastIndexOf('INSTRUCTIONS:'))).toContain('PUSHED-INSTRUCTIONS-MARKER');
    } finally {
      runner2.stop();
    }
  }, 240_000);

  it('a record naming an OLD on-branch owner-signed commit never loads: the runner recomputes the walk (round 2)', async () => {
    const { baseline } = await scaffold();
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // The owner signs a NEWER settings change: the version in force, the commit the walk names.
    const settings = JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
    settings.control_note = 'v2';
    write('.baton/baton.json', `${JSON.stringify(settings, null, 2)}\n`);
    const signed2 = commit('owner', 'the owner signs a newer settings change');
    await tick();
    expect((await sync()).code).toBe(0);
    const control = JSON.parse((await rows<{ control_json: string }>('SELECT control_json FROM signed_control WHERE repository_id = ?', 'docs'))[0].control_json);
    expect(control.groups.agent_command).toMatchObject({ read: signed2, key: ownerFp });
    // The lying record rolls the group back to the baseline — on the snapshot's own line,
    // owner-signed, an ancestor: the signature and ancestry checks alone load it (the round-2
    // finding), and the baseline's settings would run in place of the owner's newest words.
    // The runner recomputes the walk at the claim's snapshot and refuses what disagrees.
    control.groups.agent_command.read = baseline;
    await rows('UPDATE signed_control SET control_json = ? WHERE repository_id = ?', JSON.stringify(control), 'docs');
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      const out = await runner.runOnce();
      expect(out).not.toBeNull();
      expect(log.join('\n')).toContain('does not match its own history');
      const end = (await rows<{ status: string; end_reason: string }>('SELECT status, end_reason FROM claims ORDER BY id DESC LIMIT 1'))[0];
      expect([end.status, end.end_reason]).toEqual(['released', 'released:cannot-finish:spec']);
      expect(await rows(`SELECT COUNT(*) AS n FROM claim_legs`)).toEqual([{ n: 0 }]);
    } finally {
      runner.stop();
    }
  }, 120_000);

  it('the pre-ceremony window hands out no claim — no ticket pays an attempt (round 1)', async () => {
    const { filed } = await scaffold(false);
    await tick();
    expect((await keyCall(ownerHttp, '/v1/owner/docs/settings', { require_signed_control: true }, 'PUT')).status).toBe(200);
    expect((await sync()).code).toBe(0);
    // The notice names what to sign once the head moves onto it (§7.1: a first post raises
    // nothing), and no claim is made: not a `cannot-finish:spec` the ticket would pay an
    // attempt and a non-retryable hold for.
    write('tickets/B-9001.mdx', '---\nid: B-9001\ntitle: Signed control\n---\n\n**Brief:** the owner, 2026-11-06: hold the line.\n\nWork, and a head move.\n');
    commit(null, 'a head move');
    await tick();
    expect((await sync()).code).toBe(0);
    expect(await rows(`SELECT COUNT(*) AS n FROM events WHERE kind = 'unsigned-control'`)).toEqual([{ n: 1 }]);
    const log: string[] = [];
    const runner = makeRunner(log);
    try {
      expect(await runner.runOnce()).toBeNull();
      expect(await rows(`SELECT COUNT(*) AS n FROM claims`)).toEqual([{ n: 0 }]);
    } finally {
      runner.stop();
    }
    // The ceremony: the owner signs the current state once, and claims flow again.
    const settings = JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as Record<string, unknown>;
    settings.agent_command = 'node ./agent.mjs';
    write('.baton/baton.json', `${JSON.stringify(settings, null, 2)}\n`);
    bumpLegs();
    commit('owner', 'the ceremony: the owner signs the state once');
    await tick();
    expect((await sync()).code).toBe(0);
    const log2: string[] = [];
    const runner2 = makeRunner(log2);
    try {
      expect(await runner2.runOnce()).not.toBeNull();
      expect(readFileSync(join(dir, 'ran-agent.txt'), 'utf8')).not.toContain('PUSHED');
    } finally {
      runner2.stop();
    }
  }, 120_000);
});
