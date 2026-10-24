// sign.test.ts — the SSHSIG signer `baton admin`, the runner and now `baton repo sync` share
// (cli/sign.mjs, B-88): the key at a file is read into its fingerprint and each request's
// signature is made by ssh-keygen — `-y` to read the key's private half, `-Y sign` to sign, both
// bounded — and a fault is reported by ssh-keygen's reason, never its `@` banner. Node only: it
// runs ssh-keygen on real keys.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEYGEN_TIMEOUT_MS, NAMESPACE, signHeaders, signingKey } from '../../cli/sign.mjs';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A real ed25519 key ssh-keygen makes: its path, in the test's own directory. */
const keyPair = (name = 'key'): string => {
  const file = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file], { stdio: 'ignore' });
  return file;
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
    const blob = Buffer.from((headers.Signature as string).slice('sig1=:'.length, -1), 'base64');
    expect(blob.subarray(0, 6).toString()).toBe('SSHSIG');
    expect(blob.includes(Buffer.from(NAMESPACE))).toBe(true);
  });

  it('a file that is not a key is refused, naming the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = join(dir, 'not-a-key');
    writeFileSync(file, '');
    expect(() => signingKey(file)).toThrow(new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not an SSH private key ssh-keygen can sign with`));
  });

  it('a .pub with no private half is refused when the key is read, naming ssh-keygen’s reason', () => {
    // `-l` answers from the public half alone; `-y` reads the private one, so the laptop's
    // mistake — pointing --sync-key at `key.pub` — is named before the first signature.
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = keyPair();
    expect(() => signingKey(`${file}.pub`)).toThrow(/is not an SSH private key ssh-keygen can sign with \(.*No such file or directory|bad permissions/);
  });

  it('a key another user can read is refused at the read, by ssh-keygen’s reason, never its @ banner', () => {
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = keyPair();
    chmodSync(file, 0o644);
    let message = '';
    try {
      signingKey(file);
    } catch (e) {
      message = (e as Error).message;
    }
    // ssh-keygen writes its `@@@@` warning box first: the operator hears the reason beneath it.
    expect(message).toContain('is not an SSH private key ssh-keygen can sign with');
    expect(message).toContain('bad permissions');
    expect(message).not.toContain('@');
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
      expect(() => signingKey(join(dir, 'key'), keygen)).toThrow(/is not an SSH private key ssh-keygen can sign with \(ETIMEDOUT\)/);
      expect(() => signHeaders({ method: 'POST', url: 'https://baton.test/v1/sync/heartbeat', body: '{}', key: { file: 'key', fingerprint: 'SHA256:x' } }, keygen)).toThrow(/ssh-keygen -Y sign failed \(ETIMEDOUT\)/);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      process.env.PATH = saved;
    }
    // And the bound the calls run with by default is the 30 s every other git and forge call has.
    expect(KEYGEN_TIMEOUT_MS).toBe(30_000);
  });
});
