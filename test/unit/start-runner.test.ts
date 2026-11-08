// start-runner.test.ts — B-138: the runner's own CLI is a pinned release installed outside
// every checkout, never a checkout's cli/ — the finding (2026-10-27, 5) was a branch a leg
// checks out changing the runner's code at the next restart. The preflight installs
// @immediately-run/baton@<version> (the version this checkout's package.json names — the
// release this tree is) into ~/.local/share/immediately-run/baton/cli (outside every
// checkout, its version and a sha256 of its CLI re-verified at every start), probes it with
// the run itself — `run` under exactly the launch arguments, every credential variable
// stripped, must stop at today's credential check (`no credential: BATON_KEY_FILE`) — and
// refuses — exit 2, naming B-138 — any CLI that lives inside a git working tree, whichever way
// it was named (through symlinks; a `.git` above a node_modules boundary owns nothing below
// it, so a released copy under a `$HOME` that is itself a repository stays released). A
// --cli-version that is not one version is refused before anything installs.
//
// Hermetic: npm is a stub on PATH (it records its argv and lays down the release it was asked
// to install, complete with the package.json whose version the start re-verifies); git runs
// real, against a throwaway checkout; node runs real, so the probe, the realpath, the version
// read and the hash are the script's actual path. Nothing contacts a Baton.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'start-runner.sh');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/** One hermetic preflight world: a HOME (outside every checkout) the script may install under,
 *  a bin of stubs on PATH (npm, and opencode — the settings' agent_command), and a real clean
 *  git checkout as the runner's --home. `stale` lays the transition's IR_BATON_* credential
 *  spelling — a release that predates the interface this script speaks (0.1.2's shape). */
function world(stale = false) {
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
  // The credential line the laid-down CLI's `run` stops at when no credential is handed it —
  // the probe demands today's BATON_KEY_FILE spelling, so a `stale` release fails it exactly
  // as the registry's 0.1.2 would.
  const cred = stale
    ? 'no credential: IR_BATON_KEY_FILE, IR_BATON_KEY or IR_BATON_TOKEN (a stale release)'
    : 'no credential: BATON_KEY_FILE, BATON_KEY or BATON_TOKEN (§6.4, R-BTN-13)';
  // The install the script asks for, laid down as the release would be: package.json naming
  // the version (re-read at every start) and a dist/baton.mjs whose `run` stops at the
  // credential check before any network — what the probe runs.
  stub('npm', `LOG=${JSON.stringify(npmLog)}
echo "npm $*" >>"$LOG"
DEST=""
PKG=""
while [ $# -gt 0 ]; do
  [ "$1" = "--prefix" ] && DEST="$2"
  case "$1" in @immediately-run/baton@*) PKG="$1" ;; esac
  shift
done
V="\${PKG##*@}"
mkdir -p "$DEST/node_modules/@immediately-run/baton/dist"
echo "{\\"name\\":\\"@immediately-run/baton\\",\\"version\\":\\"$V\\"}" >"$DEST/node_modules/@immediately-run/baton/package.json"
echo 'if (process.argv[2] === "run") { process.stderr.write("baton: ${cred}\\n"); process.exit(2); }' >"$DEST/node_modules/@immediately-run/baton/dist/baton.mjs"`);
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
      // The install recorded its hash — the pin the next start re-verifies.
      expect(existsSync(join(dest, 'install.sha256'))).toBe(true);
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
      // Through a symlink — the npm-link layout: the same refusal, at the tree it lands in.
      const link = join(w.dir, 'linked-baton.mjs');
      symlinkSync(join(ROOT, 'cli', 'baton.mjs'), link);
      const linked = run(w, ['--check', '--cli', link]);
      expect(linked.status).toBe(2);
      expect(linked.stderr).toContain('is inside the git working tree at');
      // Nothing installed for a refused start.
      expect(existsSync(w.npmLog)).toBe(false);
    } finally {
      w.cleanup();
    }
  });

  it('a released copy under a $HOME that is itself a git repository is not working-tree code', () => {
    const w = world();
    try {
      // The dotfiles pattern: $HOME is a git repository, and the default install lands below
      // it. npm's node_modules boundary sits between the .git and the CLI, so the walk lets
      // the released copy through — the CLI's own guard walks the same line.
      execFileSync('git', ['init', '-q', w.home], { stdio: 'ignore' });
      const out = run(w, ['--check']);
      expect(out.stderr).toBe('');
      expect(out.status).toBe(0);
      expect(out.stdout).toContain(`cli:          ${installedCli(w)}`);
    } finally {
      w.cleanup();
    }
  });

  it('a relative --cli is resolved absolute: the preflight proves the path the launch runs', () => {
    const w = world();
    try {
      // A released copy outside every checkout, named relative to this process's directory —
      // the preflight must speak the absolute path it would run, not one the launch's `cd`
      // would strand.
      const cli = join(w.dir, 'rel', 'node_modules', '@immediately-run', 'baton', 'dist', 'baton.mjs');
      mkdirSync(dirname(cli), { recursive: true });
      writeFileSync(cli, 'if (process.argv[2] === "run") { process.stderr.write("baton: no credential: BATON_KEY_FILE, BATON_KEY or BATON_TOKEN (probe)\\n"); process.exit(2); }\n');
      const out = run(w, ['--check', '--cli', relative(process.cwd(), cli)]);
      expect(out.stderr).toBe('');
      expect(out.status).toBe(0);
      expect(out.stdout).toContain(`would run: node ${cli} run`);
    } finally {
      w.cleanup();
    }
  });

  it('a pin that predates the interface is refused by the probe, not discovered at 2am', () => {
    const w = world(true);
    try {
      // 0.1.2's shape: the release installs, loads and runs — and its `run` reads the
      // transition's IR_BATON_* names, so it never reaches today's credential check. The
      // probe refuses it at --check, naming the release and the remedy.
      const out = run(w, ['--check']);
      expect(out.status).toBe(2);
      expect(out.stderr).toMatch(/does not speak this start script's interface/);
      expect(out.stderr).toContain('no credential: IR_BATON_KEY_FILE');
      expect(out.stderr).toContain('--cli-version <version>');
    } finally {
      w.cleanup();
    }
  });

  it('the installed CLI is re-verified at every start: a wrong version or a changed CLI refuses', () => {
    const w = world();
    try {
      expect(run(w, ['--check']).status).toBe(0);
      const cli = installedCli(w);
      const pkg = join(dirname(dirname(cli)), 'package.json');
      const was = readFileSync(pkg, 'utf8');
      // Something swapped the release under the pin: the package npm laid beside the CLI names
      // another version than the one pinned, and no start runs it.
      writeFileSync(pkg, JSON.stringify({ name: '@immediately-run/baton', version: '9.9.9' }));
      const swapped = run(w, ['--check']);
      expect(swapped.status).toBe(2);
      expect(swapped.stderr).toContain(`is version 9.9.9, not ${VERSION}`);
      // Something rewrote the CLI itself after the install — finding 5's shape through the
      // install path: the hash recorded at install no longer matches, so no start runs it.
      writeFileSync(pkg, was);
      writeFileSync(cli, 'if (process.argv[2] === "run") { process.exit(0); }\n');
      const tampered = run(w, ['--check']);
      expect(tampered.status).toBe(2);
      expect(tampered.stderr).toMatch(/changed since it was installed .*B-138/s);
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
