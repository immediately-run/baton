// start-runner.test.ts — B-138: the runner's own CLI is a pinned release installed outside
// every checkout, never a checkout's cli/ — the finding (2026-10-27, 5) was a branch a leg
// checks out changing the runner's code at the next restart. The preflight installs
// @immediately-run/baton@<version> (the version this checkout's package.json names — the
// release this tree is) into ~/.local/share/immediately-run/baton/cli (a directory no leg
// writes), probes it (`run --help`) and refuses — exit 2, naming B-138 — any CLI that lives
// inside a git working tree, whichever way it was named; a --cli-version that is not one
// version is refused before anything installs.
//
// Hermetic: npm is a stub on PATH (it records its argv and lays down the release it was asked
// to install); git runs real, against a throwaway checkout; node runs real, so the probe and
// the version read are the script's actual path. Nothing contacts a Baton.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'start-runner.sh');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/** One hermetic preflight world: a HOME (outside every checkout) the script may install under,
 *  a bin of stubs on PATH (npm, and opencode — the settings' agent_command), and a real clean
 *  git checkout as the runner's --home. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-start-'));
  const home = join(dir, 'home');          // the operator's HOME: the install lives under it
  const checkout = join(dir, 'checkout');  // the runner's working checkout (--home)
  const bin = join(dir, 'bin');
  const npmLog = join(dir, 'npm.log');
  mkdirSync(home);
  mkdirSync(bin);
  const stub = (name: string, body: string) => {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  };
  // The install the script asks for, laid down as the release would be: dist/baton.mjs — empty,
  // which `node <file> run --help` exits 0 on, all the script's probe needs.
  stub('npm', `LOG=${JSON.stringify(npmLog)}
echo "npm $*" >>"$LOG"
DEST=""
while [ $# -gt 0 ]; do
  [ "$1" = "--prefix" ] && DEST="$2"
  shift
done
mkdir -p "$DEST/node_modules/@immediately-run/baton/dist"
: > "$DEST/node_modules/@immediately-run/baton/dist/baton.mjs"`);
  stub('opencode', 'exit 0');
  execFileSync('git', ['init', '-q', '-b', 'main', checkout], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  git('config', 'user.email', 'start@test');
  git('config', 'user.name', 'start test');
  mkdirSync(join(checkout, '.baton'));
  writeFileSync(join(checkout, '.baton', 'baton.json'), JSON.stringify({ agent_command: 'opencode run' }));
  git('add', '.');
  git('commit', '-qm', 'seed');
  return { dir, home, checkout, bin, npmLog, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The script as its operator runs it. `env` replaces the defaults — this suite's own leg
 *  environment (BATON_PARENT among them) never reaches the script, which would refuse it. */
function run(w: ReturnType<typeof world>, args: string[], env: Record<string, string | undefined> = {}, timeoutMs = 120_000) {
  const base: Record<string, string> = {
    PATH: `${w.bin}:${process.env.PATH}`,
    HOME: w.home,
    BATON_KEY: 'test-key-material',
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete base[name];
    else base[name] = value;
  }
  return spawnSync('bash', [SCRIPT, '--home', w.checkout, ...args], { encoding: 'utf8', env: base, timeout: timeoutMs });
}

/** Where the pinned release's CLI lands for `w`'s HOME. */
const installedCli = (w: ReturnType<typeof world>) =>
  join(w.home, '.local', 'share', 'immediately-run', 'baton', 'cli', `@immediately-run__baton@${VERSION}`, 'node_modules', '@immediately-run', 'baton', 'dist', 'baton.mjs');

describe('start-runner runs a pinned released CLI, never a working tree\'s (B-138)', () => {
  it('--check installs the pinned release outside every checkout and names it as what would run', () => {
    const w = world();
    try {
      const out = run(w, ['--check']);
      expect(out.stderr).toBe('');
      expect(out.status).toBe(0);
      const cli = installedCli(w);
      const dest = join(w.home, '.local', 'share', 'immediately-run', 'baton', 'cli', `@immediately-run__baton@${VERSION}`);
      // The install: the version this checkout's package.json names, npm-installed under HOME.
      expect(readFileSync(w.npmLog, 'utf8')).toBe(`npm install --no-fund --no-audit --prefix ${dest} @immediately-run/baton@${VERSION}\n`);      // Outside every checkout: under the operator's HOME, never the runner's working tree.
      expect(cli.startsWith(w.home)).toBe(true);
      expect(cli.startsWith(w.checkout)).toBe(false);
      // The preflight says what it would run: the installed CLI, not a checkout's.
      expect(out.stdout).toContain(`cli:          ${cli}`);
      expect(out.stdout).toContain(`would run: node ${cli} run`);
    } finally {
      w.cleanup();
    }
  });

  it('a pinned release already installed starts no install (a restart needs no network)', () => {
    const w = world();
    try {
      expect(run(w, ['--check']).status).toBe(0);
      const first = readFileSync(w.npmLog, 'utf8');
      expect(run(w, ['--check']).status).toBe(0);
      expect(readFileSync(w.npmLog, 'utf8')).toBe(first);
    } finally {
      w.cleanup();
    }
  });

  it('refuses a CLI inside a git working tree, whichever way it was named', () => {
    const w = world();
    try {
      // This repository's own cli/ — the finding's shape.
      const checkoutCli = run(w, ['--check', '--cli', join(ROOT, 'cli', 'baton.mjs')]);
      expect(checkoutCli.status).toBe(2);
      expect(checkoutCli.stderr).toMatch(/is inside the git working tree at .* — a pushed branch would change the runner's own code \(B-138\)/);
      // A dist/ built inside the working tree is as pushable as its cli/: the same refusal.
      const built = join(w.checkout, 'dist', 'baton.mjs');
      mkdirSync(dirname(built));
      writeFileSync(built, '');
      const distCli = run(w, ['--check', '--cli', built]);
      expect(distCli.status).toBe(2);
      expect(distCli.stderr).toContain(`is inside the git working tree at ${w.checkout}`);
      // Nothing installed for a refused start.
      expect(existsSync(w.npmLog)).toBe(false);
    } finally {
      w.cleanup();
    }
  });

  it('a --cli-version that is not one version is refused, never installed as a range', () => {
    const w = world();
    try {
      const range = run(w, ['--check', '--cli-version', '^0.1']);
      expect(range.status).toBe(2);
      expect(range.stderr).toMatch(/a range would not be a pin/);
      expect(existsSync(w.npmLog)).toBe(false);
    } finally {
      w.cleanup();
    }
  });
});
