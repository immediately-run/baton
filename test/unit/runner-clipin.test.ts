// runner-clipin.test.ts — the CLI's own pinning (B-253, BATON_SPEC §8.3 R-BTN-72): what
// `baton run` and `baton runner start` print at start and every heartbeat carries as
// `profile.cli`. A working tree on a branch is not a pinned commit — the owner's warning, in
// the owner's words — while a tag and a detached commit are; a released copy reads the commit
// its build.json names, unpinned when that build was dirty; a state nothing can read is said
// so, never guessed, and nothing refuses to start. Node only: it writes real git checkouts.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliPinLines, cliProfile, readCliPin } from '../../src/runner/cliPin';

/** A real checkout in whatever state its caller leaves it, with a marker file where the CLI's
 *  own module would sit — `readCliPin` walks up from exactly there (B-138's walk). */
function checkout(): { dir: string; marker: string } {
  const dir = mkdtempSync(join(tmpdir(), 'baton-clipin-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'clipin@test');
  g('config', 'user.name', 'clipin test');
  writeFileSync(join(dir, 'cli.mjs'), 'export {}\n');
  g('add', 'cli.mjs');
  g('commit', '-q', '--no-gpg-sign', '-m', 'one');
  return { dir, marker: join(dir, 'cli.mjs') };
}

/** A released copy (B-138's tree-less CLI): a package's `dist/` holding the module, the
 *  `build.json` `build:cli` writes and the package's own `package.json`. */
function release(build: Record<string, unknown> | null, version = '0.1.3'): string {
  const pkg = mkdtempSync(join(tmpdir(), 'baton-release-'));
  mkdirSync(join(pkg, 'dist'));
  if (build != null) writeFileSync(join(pkg, 'dist', 'build.json'), `${JSON.stringify(build, null, 2)}\n`);
  writeFileSync(join(pkg, 'package.json'), `${JSON.stringify({ name: '@immediately-run/baton', version }, null, 2)}\n`);
  writeFileSync(join(pkg, 'dist', 'baton-run.mjs'), 'export {}\n');
  return join(pkg, 'dist', 'baton-run.mjs');
}

describe('readCliPin (B-253)', () => {
  it('a checkout on a branch is not a pinned commit — the ref is the branch', () => {
    const { dir, marker } = checkout();
    try {
      const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      expect(readCliPin(marker)).toEqual({ commit: sha, ref: 'main', pinned: false, kind: 'branch' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a detached checkout is pinned — at a tag the ref is the tag, else the commit itself', () => {
    const tag = checkout();
    const plain = checkout();
    try {
      execFileSync('git', ['-C', tag.dir, 'tag', 'v0.2.0'], { stdio: 'ignore' });
      execFileSync('git', ['-C', tag.dir, 'checkout', '-q', '--detach', 'HEAD'], { stdio: 'ignore' });
      const sha = execFileSync('git', ['-C', tag.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      expect(readCliPin(tag.marker)).toEqual({ commit: sha, ref: 'v0.2.0', pinned: true, kind: 'tag' });
      execFileSync('git', ['-C', plain.dir, 'checkout', '-q', '--detach', 'HEAD'], { stdio: 'ignore' });
      const sha2 = execFileSync('git', ['-C', plain.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      expect(readCliPin(plain.marker)).toEqual({ commit: sha2, ref: sha2, pinned: true, kind: 'commit' });
    } finally {
      rmSync(tag.dir, { recursive: true, force: true });
      rmSync(plain.dir, { recursive: true, force: true });
    }
  });

  it('a released copy is the commit its build.json names — pinned unless that build was dirty', () => {
    const clean = release({ repository: 'immediately-run/baton', commit: 'a'.repeat(40) });
    expect(readCliPin(clean)).toEqual({ commit: 'a'.repeat(40), ref: '0.1.3', pinned: true, kind: 'release' });
    // A dirty build pins nothing: no commit holds the package's files (the same judgement
    // `baton repo init` makes of its `--pin`).
    const dirty = release({ repository: 'immediately-run/baton', commit: 'b'.repeat(40), dirty: true });
    expect(readCliPin(dirty)).toEqual({ commit: 'b'.repeat(40), ref: '0.1.3', pinned: false, kind: 'release' });
    // A copy that names no commit says none — never a guess.
    const bare = release(null);
    expect(readCliPin(bare)).toEqual({ commit: null, ref: '0.1.3', pinned: false, kind: 'release' });
  });

  it('a checkout whose git cannot answer is unreadable, and nothing throws', () => {
    const { dir, marker } = checkout();
    try {
      writeFileSync(join(dir, '.git', 'HEAD'), 'garbage\n');
      expect(readCliPin(marker)).toEqual({ commit: null, ref: null, pinned: false, kind: 'unknown' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('cliPinLines (B-253)', () => {
  it('a branch warns in the owner\'s words: branch name and full commit, nothing else to do', () => {
    const sha = '5ff20c853a83d698bc5456317d46b2cf1435e8bb';
    expect(cliPinLines({ commit: sha, ref: 'main', pinned: false, kind: 'branch' })).toEqual([
      'baton: cli at 5ff20c853a on branch main',
      `baton: running from branch main at ${sha} — not a pinned commit`,
    ]);
  });

  it('a tag, a detached commit and a clean release say they are pinned, in one line each', () => {
    const sha = 'a'.repeat(40);
    expect(cliPinLines({ commit: sha, ref: 'v0.1.3', pinned: true, kind: 'tag' }))
      .toEqual([`baton: cli at ${'a'.repeat(10)}, tagged v0.1.3 — a pinned release`]);
    expect(cliPinLines({ commit: sha, ref: sha, pinned: true, kind: 'commit' }))
      .toEqual([`baton: cli at ${'a'.repeat(10)}, a detached commit — pinned`]);
    expect(cliPinLines({ commit: sha, ref: '0.1.3', pinned: true, kind: 'release' }))
      .toEqual(['baton: cli 0.1.3 at aaaaaaaaaa — a released copy, pinned']);
  });

  it('a dirty build warns as a branch does, and an unreadable commit says so', () => {
    const sha = 'b'.repeat(40);
    expect(cliPinLines({ commit: sha, ref: '0.1.4', pinned: false, kind: 'release' })).toEqual([
      'baton: cli 0.1.4 at bbbbbbbbbb — built from a modified tree',
      `baton: running from a modified build at ${sha} — not a pinned commit`,
    ]);
    expect(cliPinLines({ commit: null, ref: null, pinned: false, kind: 'unknown' }))
      .toEqual(['baton: cli commit unreadable — not a pinned commit (B-253)']);
  });
});

describe('cliProfile (B-253)', () => {
  it('carries exactly the three fields the owner\'s screen reads — the kind stays with the line', () => {
    expect(cliProfile({ commit: 'c'.repeat(40), ref: 'main', pinned: false, kind: 'branch' }))
      .toEqual({ cli: { commit: 'c'.repeat(40), ref: 'main', pinned: false } });
  });
});
