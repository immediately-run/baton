// S-BTN-209 executor sources (BATON_SPEC §15; §8.3 R-BTN-107; B-184), Node only: the source is
// the runner host's choice — `builtin` by default; `pinned:<dir>@sha256:<digest>` loaded only when
// the bundle's canonical listing matches, a symlink or a foreign import refusing it; `home-signed`
// refused naming B-127 while it is unbuilt. (`home` is refused too until its part of B-184 lands.)
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleDigest, loadExecutor, parseSource } from '../../src/runner/executor';
import { parseRunArgs } from '../../src/runner/main';

const host = { log: () => {}, wrapper: '/x/legProcess.mjs', node: process.execPath };

/** A bundle directory holding `files`. */
function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-209-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const EXECUTOR = `import { helper } from './lib/helper.mjs';
export function createExecutor(host) {
  return { api: 1, provides: ['vpn:corp'], helper: helper(), wrapper: host.wrapper,
    async start({ brief }) { return { session_id: brief.session_id }; },
    exec() { throw new Error('unused'); }, async stop() {}, async end() { return { status: 'ended', result: null }; } };
}
`;

describe('S-BTN-209: the executor source is the host\'s choice (R-BTN-107)', () => {
  it('builtin is the default; --executor and BATON_EXECUTOR name another; a malformed source is refused', async () => {
    expect(parseRunArgs([], {}).executor).toBe('builtin');
    expect(parseRunArgs([], { BATON_EXECUTOR: 'pinned:/b@sha256:' + 'a'.repeat(64) }).executor).toBe('pinned:/b@sha256:' + 'a'.repeat(64));
    expect(parseRunArgs(['--executor', 'home'], { BATON_EXECUTOR: 'builtin' }).executor).toBe('home');
    expect(() => parseSource('pinned:/b@sha256:abc')).toThrow(/pinned:<path>@sha256:<64 hex>/);
    expect(() => parseSource('docker')).toThrow(/builtin, home, home-signed or pinned/);
    const b = await loadExecutor('builtin', host);
    expect({ api: b.api, source: b.source, provides: b.provides }).toEqual({ api: 1, source: 'builtin', provides: [] });
  });

  it('home-signed is refused at start naming B-127; home is refused until built', async () => {
    await expect(loadExecutor('home-signed', host)).rejects.toThrow(/B-127/);
    await expect(loadExecutor('home', host)).rejects.toThrow(/not built/);
  });

  it('a pinned bundle loads only when its digest matches, and its imports stay inside it', async () => {
    const dir = bundle({ 'executor.mjs': EXECUTOR, 'lib/helper.mjs': 'export const helper = () => "inside";\n' });
    try {
      const digest = bundleDigest(dir);
      const ex = await loadExecutor(`pinned:${dir}@sha256:${digest}`, host) as unknown as { source: string; digest: string; provides: string[]; helper: string; wrapper: string };
      expect({ source: ex.source, digest: ex.digest, provides: ex.provides, helper: ex.helper, wrapper: ex.wrapper })
        .toEqual({ source: 'pinned', digest, provides: ['vpn:corp'], helper: 'inside', wrapper: host.wrapper });
      // One byte changed: refused at start, naming both digests.
      writeFileSync(join(dir, 'lib/helper.mjs'), 'export const helper = () => "changed";\n');
      await expect(loadExecutor(`pinned:${dir}@sha256:${digest}`, host)).rejects.toThrow(new RegExp(`not the pinned sha256:${digest}`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the digest is the canonical listing\'s: path order, not creation order; a symlink refuses the bundle', () => {
    const a = bundle({ 'b.mjs': 'b', 'a/z.mjs': 'z', 'executor.mjs': 'e' });
    const b = bundle({ 'executor.mjs': 'e', 'a/z.mjs': 'z', 'b.mjs': 'b' });
    try {
      expect(bundleDigest(a)).toBe(bundleDigest(b));
      symlinkSync('/etc/passwd', join(a, 'link'));
      expect(() => bundleDigest(a)).toThrow(/not a regular file or directory/);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it('a bundle importing outside itself, or providing a runner: name, is refused', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'baton-209-out-'));
    writeFileSync(join(outside, 'evil.mjs'), 'export const x = 1;\n');
    const importing = bundle({ 'executor.mjs': `import { x } from ${JSON.stringify(join(outside, 'evil.mjs'))};\nexport const createExecutor = () => ({ api: 1, x });\n` });
    const runnerName = bundle({ 'executor.mjs': EXECUTOR.replace("'vpn:corp'", "'runner:session'"), 'lib/helper.mjs': 'export const helper = () => 1;\n' });
    try {
      // The fence is Node's resolve hook, which vitest's module runner bypasses: checked in a plain
      // Node process, as the runner loads it.
      const probe = join(outside, 'probe.mts');
      writeFileSync(probe, `import { bundleDigest, loadExecutor } from ${JSON.stringify(join(process.cwd(), 'src/runner/executor.ts'))};
const d = ${JSON.stringify(importing)};
try { await loadExecutor('pinned:' + d + '@sha256:' + bundleDigest(d), { log() {}, wrapper: '', node: '' }); console.log('loaded'); } catch (e) { console.log(e.message); }
`);
      expect(execFileSync(process.execPath, [probe], { encoding: 'utf8' })).toMatch(/outside its bundle/);
      await expect(loadExecutor(`pinned:${runnerName}@sha256:${bundleDigest(runnerName)}`, host)).rejects.toThrow(/never starts runner:/);
    } finally {
      for (const d of [outside, importing, runnerName]) rmSync(d, { recursive: true, force: true });
    }
  });
});
