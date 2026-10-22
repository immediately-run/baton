// sign.test.ts — the SSHSIG signer `baton admin`, the runner and now `baton repo sync` share
// (cli/sign.mjs, B-88): the key at a file is read into its fingerprint and each request's
// signature is made by ssh-keygen — `-l` to read the key, `-Y sign` to sign, both bounded. Node
// only: it runs ssh-keygen on real keys.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAMESPACE, signHeaders, signingKey } from '../../cli/sign.mjs';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('cli/sign.mjs — the one signer (B-88)', () => {
  it('signs in the baton-request namespace, its keyid the key’s fingerprint', () => {
    dir = mkdtempSync(join(tmpdir(), 'baton-sign-'));
    const file = join(dir, 'key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file], { stdio: 'ignore' });
    const key = signingKey(file);
    expect(key.file).toBe(file);
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
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
    expect(() => signingKey(file)).toThrow(new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not an SSH key ssh-keygen can read`));
  });

  it('both ssh-keygen calls are bounded (B-88): a key on a stalled mount fails, it never waits for ever', () => {
    // The calls are spawnSyncs in a .mjs module, so their options are read from its source: a
    // stalled filesystem cannot be reproduced in a test, but the bound it needs is visible here.
    const text = readFileSync(join(import.meta.dirname, '..', '..', 'cli', 'sign.mjs'), 'utf8');
    const spawns = [...text.matchAll(/spawnSync\('ssh-keygen', \[[^\]]*\][^)]*\)/g)].map((m) => m[0]);
    expect(spawns.length).toBe(2);
    for (const s of spawns) {
      expect(s).toContain('timeout: KEYGEN_TIMEOUT_MS');
      expect(s).toContain("killSignal: 'SIGKILL'");
    }
  });
});
