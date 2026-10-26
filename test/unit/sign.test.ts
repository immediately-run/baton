// sign.test.ts — the SSHSIG signer `baton admin`, the runner and now `baton repo sync` share
// (cli/sign.mjs, B-88): the key at a file is read into its fingerprint with `-l` — alone, for a
// `.pub` whose private half an agent holds signs as the spec's owner machines do — and each
// request's signature is made by ssh-keygen `-Y sign` into ssh-agent or the key file (R-BTN-13,
// §8.1), both bounded, and a fault is reported by ssh-keygen's reason, never its `@` banner.
// Node only: it runs ssh-keygen on real keys, and stands up a real ssh-agent for the agent cases.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEYGEN_TIMEOUT_MS, NAMESPACE, signHeaders, signingKey } from '../../cli/sign.mjs';

/** A passphrase ssh-keygen decrypts and ssh-add reads from SSH_ASKPASS, so a passphrase key is
 *  loaded without a TTY. */
const PASSPHRASE = 'baton-test-passphrase';

let dir: string;
let agent: { pid: number; sock: string } | null = null;
afterEach(() => {
  if (agent) {
    try {
      process.kill(agent.pid);
    } catch {
      // already gone
    }
    agent = null;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A real ed25519 key ssh-keygen makes: its path, in the test's own directory. */
const keyPair = (name = 'key', passphrase = ''): string => {
  const file = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', passphrase, '-f', file], { stdio: 'ignore' });
  return file;
};

/** A private ssh-agent of this test's own, isolated from the machine's (its socket is a file in
 *  the test's directory and it holds no key it was not handed), running until afterEach. Its
 *  pid and socket are returned by `ssh-agent -s`, whose output is `sh` assignments. */
function startAgent(): void {
  const out = execFileSync('ssh-agent', ['-s'], { encoding: 'utf8' });
  const sock = /SSH_AUTH_SOCK=([^;\n]+)/.exec(out)?.[1];
  const pid = Number(/SSH_AGENT_PID=(\d+)/.exec(out)?.[1]);
  if (!sock || !pid) throw new Error(`ssh-agent did not start: ${out}`);
  agent = { pid, sock };
}

/** Run `fn` with this test's agent as every ssh-keygen's agent — `-Y sign` asks it for a key
 *  whose private half only it holds, and `ssh-add` loads into it — and the passphrase answered
 *  by a script (SSH_ASKPASS), never a TTY. */
function withAgent<T>(fn: () => T): T {
  if (!agent) throw new Error('no agent');
  const saved = { sock: process.env.SSH_AUTH_SOCK, askpass: process.env.SSH_ASKPASS, display: process.env.DISPLAY, require: process.env.SSH_ASKPASS_REQUIRE };
  const askpass = join(dir, 'askpass');
  writeFileSync(askpass, `#!/bin/sh\nprintf '%s\\n' '${PASSPHRASE}'\n`);
  chmodSync(askpass, 0o755);
  process.env.SSH_AUTH_SOCK = agent.sock;
  process.env.SSH_ASKPASS = askpass;
  process.env.SSH_ASKPASS_REQUIRE = 'force';
  process.env.DISPLAY = ':0';
  try {
    return fn();
  } finally {
    for (const [k, v] of [['SSH_AUTH_SOCK', saved.sock], ['SSH_ASKPASS', saved.askpass], ['DISPLAY', saved.display], ['SSH_ASKPASS_REQUIRE', saved.require]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Run `fn` with the agent and NOTHING ELSE: no askpass, so ssh-keygen cannot decrypt a
 *  passphrase file itself — the signature can only come from the agent. This is the signer's
 *  real shape in production (round 5, 5-r1-1: an askpass left set lets the test pass with no
 *  agent at all, guarding nothing). */
function withAgentOnly<T>(fn: () => T): T {
  if (!agent) throw new Error('no agent');
  const saved = { sock: process.env.SSH_AUTH_SOCK, askpass: process.env.SSH_ASKPASS, display: process.env.DISPLAY, require: process.env.SSH_ASKPASS_REQUIRE };
  process.env.SSH_AUTH_SOCK = agent.sock;
  delete process.env.SSH_ASKPASS;
  delete process.env.SSH_ASKPASS_REQUIRE;
  delete process.env.DISPLAY;
  try {
    return fn();
  } finally {
    for (const [k, v] of [['SSH_AUTH_SOCK', saved.sock], ['SSH_ASKPASS', saved.askpass], ['DISPLAY', saved.display], ['SSH_ASKPASS_REQUIRE', saved.require]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Load `file` (which may be passphrase-protected) into this test's agent. */
const addToAgent = (file: string): void => withAgent(() => { execFileSync('ssh-add', [file], { stdio: 'ignore', env: process.env }); });

/** An SSHSIG the verifier can open: its magic and this signer's namespace. */
const opens = (headers: { Signature?: string }): void => {
  const blob = Buffer.from(String(headers.Signature).slice('sig1=:'.length, -1), 'base64');
  expect(blob.subarray(0, 6).toString()).toBe('SSHSIG');
  expect(blob.includes(Buffer.from(NAMESPACE))).toBe(true);
};

describe('cli/sign.mjs — the one signer (B-88)', () => {
  it('signs in the baton-request namespace, its keyid the key’s fingerprint', () => {
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = keyPair();
    const key = signingKey(file);
    expect(key.file).toBe(file);
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    // The fingerprint is ssh-keygen's own for the file (`repo add --sync-key` registers it).
    expect(execFileSync('ssh-keygen', ['-l', '-E', 'sha256', '-f', file], { encoding: 'utf8' })).toContain(key.fingerprint);
    const headers = signHeaders({ method: 'POST', url: 'https://baton.test/v1/sync/observation', body: '{}', key });
    expect(headers['Signature-Input']).toContain(`keyid="${key.fingerprint}"`);
    expect(headers['Signature-Input']).toContain(`tag="${NAMESPACE}"`);
    expect(headers.Signature).toMatch(/^sig1=:[A-Za-z0-9+/]+={0,2}:$/);
    // The base64 is an SSHSIG: it opens with the PROTOCOL.sshsig magic and the namespace.
    opens(headers);
  });

  it('a file that is not a key is refused, naming the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = join(dir, 'not-a-key');
    writeFileSync(file, '');
    expect(() => signingKey(file)).toThrow(new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not an SSH key ssh-keygen can read`));
  });

  it('a passphrase-protected key loaded in ssh-agent reads and signs (R-BTN-13, §8.1)', () => {
    // The case round 4's 4-r0-1 caught: the private file is encrypted, its private half is the
    // agent's, and `ssh-keygen -Y sign -f <file>` asks the agent to sign. Reading the key is
    // `-l` alone, which never decrypts. The signing runs with the agent and NOTHING else — no
    // askpass — so the signature can only be the agent's (round 5, 5-r1-1).
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    startAgent();
    const file = keyPair('sealed', PASSPHRASE);
    addToAgent(file);
    withAgentOnly(() => {
      const key = signingKey(file);
      expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
      const headers = signHeaders({ method: 'POST', url: 'https://baton.test/v1/sync/observation', body: '{}', key });
      expect(headers['Signature-Input']).toContain(`keyid="${key.fingerprint}"`);
      opens(headers);
    });
  });

  it('a .pub whose private half only ssh-agent holds reads and signs — the Secure Enclave case', () => {
    // An owner machine's key behind an agent: the file on disk is the public half, the agent
    // holds the rest, and `ssh-keygen -Y sign -f key.pub` signs with it. A probe that read the
    // private file (`-y`) would refuse this key the spec prescribes.
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    startAgent();
    const file = keyPair('enclave', PASSPHRASE);
    addToAgent(file);
    const publicOnly = join(dir, 'enclave-only.pub');
    writeFileSync(publicOnly, execFileSync('cat', [`${file}.pub`], { encoding: 'utf8' }));
    // The private half is out of the signer's reach: the agent is the only holder.
    rmSync(file, { force: true });
    expect(existsSync(file)).toBe(false);
    withAgent(() => {
      const key = signingKey(publicOnly);
      const headers = signHeaders({ method: 'POST', url: 'https://baton.test/v1/sync/observation', body: '{}', key });
      expect(headers['Signature-Input']).toContain(`keyid="${key.fingerprint}"`);
      opens(headers);
    });
  });

  it('a .pub whose private half no file and no agent holds reads, and the signature names ssh-keygen’s reason', () => {
    // `-l` answers from the public half alone, so the read passes; the signature is where a
    // key neither the file nor any agent holds is named — and it is named, not silently unsigned.
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = keyPair();
    const publicOnly = `${file}.pub`;
    rmSync(file, { force: true });
    const key = signingKey(publicOnly);
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    let message = '';
    try {
      signHeaders({ method: 'POST', url: 'https://baton.test/v1/sync/observation', body: '{}', key });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('ssh-keygen -Y sign failed');
    expect(message).toMatch(/No private key found|check_passphrase|incorrect passphrase/);
    // And no stderr's trailing blank line inside the parenthesis (4-r0-5).
    expect(message).toMatch(/\)$/);
    expect(message).not.toMatch(/ \)$/);
  });

  it('a private key another user can read signs nothing: the @@@@ banner is stripped, the reason kept (5-r1-2)', () => {
    // The one input that really opens with ssh-keygen's `@@@@` warning box: ssh-keygen refuses
    // a too-open private key at the signature (the `-l` read answers from its public half).
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = keyPair();
    chmodSync(file, 0o644);
    const key = signingKey(file);
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    let message = '';
    try {
      signHeaders({ method: 'POST', url: 'https://baton.test/v1/sync/observation', body: '{}', key });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('ssh-keygen -Y sign failed');
    expect(message).toMatch(/bad permissions|Permissions 0644/);
    // The banner never reaches the operator, and no trailing blank rides along.
    expect(message).not.toContain('@');
    expect(message).not.toMatch(/ \)$/);
  });

  it('both ssh-keygen calls are bounded (B-88): a hanging ssh-keygen fails the call, it never waits for ever', () => {
    // A stand-in on PATH that hangs: the production seam is run against it at a short bound, as
    // B-94 proves every git bound, so no source string stands in for the behaviour.
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const hang = join(dir, 'ssh-keygen');
    writeFileSync(hang, '#!/bin/sh\nsleep 30\n');
    chmodSync(hang, 0o755);
    const saved = process.env.PATH;
    process.env.PATH = `${dir}:${saved}`;
    const keygen = { command: 'ssh-keygen', timeout: 100 };
    try {
      const started = Date.now();
      expect(() => signingKey(join(dir, 'key'), keygen)).toThrow(/is not an SSH key ssh-keygen can read \(ETIMEDOUT\)/);
      expect(() => signHeaders({ method: 'POST', url: 'https://baton.test/v1/sync/heartbeat', body: '{}', key: { file: 'key', fingerprint: 'SHA256:x' } }, keygen)).toThrow(/ssh-keygen -Y sign failed \(ETIMEDOUT\)/);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      process.env.PATH = saved;
    }
    // And the bound the calls run with by default is the 30 s every other git and forge call has.
    expect(KEYGEN_TIMEOUT_MS).toBe(30_000);
  });
});
