// cloud-runner.test.ts — B-115: scripts/cloud-runner.sh turns a Claude Code cloud session into
// the host of a Baton process-mode runner (BATON_SPEC §8.1's `cloud` host). The preflight's
// every check exits non-zero naming itself when it fails, and the capabilities the runner is
// started with are only what the preflight checked (llm-call, create-pr) — never `baton run`'s
// default declaration, which names agent-venue, a capability a cloud container does not hold
// unless a venue is up. The start is detached (setsid nohup), leaves its pid and log under
// ~/.cache/immediately-run/baton/cloud-runner/, scrubs a leg's BATON_* environment from the
// runner and keeps the credentials a leg needs (R-BTN-144).
//
// Hermetic: claude and gh — the commands that cannot answer without the cloud's logins — are
// stubs on PATH; git runs real, against a local bare origin (paths, no network, no auth), so
// the script's actual git usage is what the test drives. Node only.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'cloud-runner.sh');
const CACHE = (home: string) => join(home, '.cache', 'immediately-run', 'baton', 'cloud-runner');

/** One hermetic preflight world: a HOME the script may write under, a bin of stubs on PATH
 *  (claude, gh — and, for the launch tests, node as a stand-in runner that records its argv and
 *  environment and stays alive), and a real clean clone of a local bare `docs` origin. */
function world(overrides: { claude?: string; gh?: string; node?: string; originName?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-cloud-'));
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  const stub = (name: string, body: string) => {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  };
  stub('claude', overrides.claude ?? 'echo ready');
  stub('gh', overrides.gh ?? 'exit 0');
  if (overrides.node != null) stub('node', overrides.node);
  // The origin every GitHub-shaped check reads: a bare `docs.git`, seeded with one commit, and
  // a clean clone of it as the runner's home checkout.
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const origin = join(dir, `${overrides.originName ?? 'docs'}.git`);
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', origin], { stdio: 'ignore' });
  const seed = join(dir, 'seed');
  execFileSync('git', ['init', '-q', '-b', 'main', seed], { stdio: 'ignore' });
  writeFileSync(join(seed, 'README.md'), '# docs\n');
  git(seed, 'add', '.');
  git(seed, '-c', 'user.email=cloud@test', '-c', 'user.name=cloud test', 'commit', '-qm', 'seed');
  git(seed, 'push', '-q', origin, 'HEAD:main');
  const checkout = join(home, 'checkout');
  execFileSync('git', ['clone', '-q', origin, checkout], { stdio: 'ignore' });
  git(checkout, 'config', 'user.email', 'cloud@test');
  git(checkout, 'config', 'user.name', 'cloud test');
  return { dir, home, bin, checkout, origin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The script as the cloud session would run it, with each external command either stubbed (in
 *  `w.bin`, first on PATH) or real (git, node, setsid — this process's PATH). `env` replaces the
 *  defaults; a value of `undefined` unsets the name. */
function run(w: ReturnType<typeof world>, args: string[], env: Record<string, string | undefined> = {}, timeoutMs = 120_000) {
  const base: Record<string, string> = {
    PATH: `${w.bin}:${process.env.PATH}`,
    HOME: w.home,
    BATON_KEY: 'test-key-material',
    BATON_HOSTNAME: 'cloud-one',
    CLAUDE_CODE_SESSION_ID: 'ses_cloud1',
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete base[name];
    else base[name] = value;
  }
  return spawnSync('bash', [SCRIPT, '--home', w.checkout, ...args], { encoding: 'utf8', env: base, timeout: timeoutMs });
}

describe('the cloud runner script (B-115)', () => {
  it('ships in the package: package.json files and check-package both carry the script and the skill', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    for (const shipped of ['scripts/cloud-runner.sh', 'skills/baton-cloud-runner/SKILL.md']) {
      expect(pkg.files, `package.json files must carry ${shipped}`).toContain(shipped);
      expect(existsSync(join(ROOT, shipped)), `${shipped} must exist`).toBe(true);
    }
    const checkPackage = readFileSync(join(ROOT, 'scripts', 'check-package.mjs'), 'utf8');
    expect(checkPackage).toContain("'scripts/cloud-runner.sh'");
    expect(checkPackage).toContain("'skills/baton-cloud-runner/SKILL.md'");
  });

  it('--check passes a full preflight and names what it would run: only the checked capabilities', () => {
    const w = world();
    try {
      const out = run(w, ['--check'], { GH_TOKEN: 'gh-test-token' });
      expect(out.status).toBe(0);
      expect(out.stderr).toBe('');
      const would = out.stdout.split('\n').find((l) => l.includes('would run:'));
      expect(would).toContain('--harness claude-code');
      expect(would).toContain('--hostname cloud-one');
      expect(would).toContain('--session ses_cloud1');
      expect(would).toContain('--capabilities llm-call,create-pr');
      // Only what was checked is declared: the grant's default (agent-venue, and the role's
      // other three) is never named, not even in the notes.
      expect(out.stdout).not.toMatch(/agent-venue|authentication|drivable-browser/);
      // --check runs nothing and writes nothing: no pid, no log, no cache directory.
      expect(existsSync(CACHE(w.home))).toBe(false);
    } finally {
      w.cleanup();
    }
  });

  it('every failing check exits non-zero naming itself', () => {
    const cases: { name: string; make: () => ReturnType<typeof world>; env: Record<string, string | undefined>; args?: string[]; names: RegExp }[] = [      { name: 'no credential', make: () => world(), env: { BATON_KEY: undefined }, names: /no credential: set BATON_KEY/ },
      { name: 'BATON_KEY_FILE names no file', make: () => world(), env: { BATON_KEY: undefined, BATON_KEY_FILE: '/nonexistent/baton_worker' }, names: /BATON_KEY_FILE \(\/nonexistent\/baton_worker\) does not exist/ },
      { name: 'no BATON_HOSTNAME', make: () => world(), env: { BATON_HOSTNAME: undefined }, names: /BATON_HOSTNAME is not set/ },
      { name: 'no CLAUDE_CODE_SESSION_ID', make: () => world(), env: { CLAUDE_CODE_SESSION_ID: undefined }, names: /CLAUDE_CODE_SESSION_ID is not set/ },
      { name: 'a session id a session_name may not be', make: () => world(), env: { CLAUDE_CODE_SESSION_ID: 'bad id!' }, names: /CLAUDE_CODE_SESSION_ID is not a session_name/ },
      { name: 'a leg session never claims', make: () => world(), env: { BATON_PARENT: '22' }, names: /BATON_PARENT/ },
      { name: 'claude -p fails', make: () => world({ claude: 'exit 1' }), env: {}, names: /claude: the probe failed \(exit 1\)/ },
      { name: 'claude -p answers nothing', make: () => world({ claude: 'true' }), env: {}, names: /claude: the probe answered nothing/ },
      { name: 'claude -p never answers (the probe is bounded)', make: () => world({ claude: 'sleep 300' }), env: { CLOUD_RUNNER_CLAUDE_TIMEOUT_S: '2' }, names: /no answer to the probe within 2s/ },
      { name: 'gh auth status fails', make: () => world({ gh: 'exit 3' }), env: {}, names: /gh: 'gh auth status' failed \(exit 3\)/ },
      { name: 'the home is not a git checkout', make: () => world(), env: {}, args: ['--check', '--home', 'W_BIN'], names: /is not a git checkout/ },
      { name: 'BATON_REPOSITORY names another repository', make: () => world(), env: { BATON_REPOSITORY: 'baton' }, names: /BATON_REPOSITORY names baton/ },
    ];
    for (const c of cases) {
      const w = c.make();
      try {
        const args = (c.args ?? ['--check']).map((a) => (a === 'W_BIN' ? w.bin : a));
        const out = run(w, args, c.env, c.name.includes('bounded') ? 30_000 : 120_000);
        expect(out.status, c.name).not.toBe(0);
        expect(out.stderr, c.name).toMatch(c.names);
      } finally {
        w.cleanup();
      }
    }
  }, 120_000);

  it('a dirty checkout and a failed dry-run push each name their check', () => {
    const dirty = world();
    const noPush = world();
    try {
      writeFileSync(join(dirty.checkout, 'scratch.txt'), 'uncommitted\n');
      const dirtyOut = run(dirty, ['--check']);
      expect(dirtyOut.status).not.toBe(0);
      expect(dirtyOut.stderr).toMatch(/home: .* has uncommitted changes/);

      execFileSync('git', ['-C', noPush.checkout, 'remote', 'set-url', 'origin', join(noPush.dir, 'gone.git')], { stdio: 'ignore' });
      const pushOut = run(noPush, ['--check']);
      expect(pushOut.status).not.toBe(0);
      expect(pushOut.stderr).toMatch(/push: 'git push --dry-run' to origin's scratch ref failed/);
    } finally {
      dirty.cleanup();
      noPush.cleanup();
    }
  });

  it('starts the runner detached: pid and log under the cache, the leg environment scrubbed, the credentials kept', () => {
    const args = join(tmpdir(), `baton-cloud-args-${process.pid}`);
    const envFile = join(tmpdir(), `baton-cloud-env-${process.pid}`);
    const w = world({
      // A stand-in runner: the preflight's CLI probe (`node <cli> run --help`) answers 0; the
      // launch records argv and environment, then stays alive as the real runner would.
      node: `[ "$2" = run ] && [ "$3" = --help ] && exit 0
printf '%s\\n' "$@" >"${args}"
env | sort >"${envFile}"
exec sleep 600`,
    });
    try {
      const out = run(w, [], {
        GH_TOKEN: 'gh-test-token',
        // What a shell launched from a leg would carry down: the start scrubs it (start-runner's
        // precedent), while the forge credential and the identity stay (R-BTN-144).
        BATON_COURSE: 'create-pr', BATON_LEG: 'T-9.implement.1', BATON_INSTRUCTIONS: '/tmp/leg.md',
        BATON_TICKET_FILE: 'tickets/T-9.mdx', BATON_ANSWER: 'done',
      });
      expect(out.stderr).toBe('');
      expect(out.status).toBe(0);
      const pidfile = join(CACHE(w.home), 'runner.pid');
      expect(existsSync(pidfile)).toBe(true);
      expect(existsSync(join(CACHE(w.home), 'runner.log'))).toBe(true);
      const pid = Number(readFileSync(pidfile, 'utf8').trim());
      expect(Number.isInteger(pid)).toBe(true);
      expect(pid).toBeGreaterThan(1);
      // Detached: the script has returned, the runner lives on (and dies with the test's kill).
      expect(() => process.kill(pid, 0)).not.toThrow();
      const argv = readFileSync(args, 'utf8');
      expect(argv).toContain('run');
      expect(argv).toContain('--harness');
      expect(argv).toContain('claude-code');
      expect(argv).toContain('--home');
      expect(argv).toContain(w.checkout);
      expect(argv).toContain('--hostname');
      expect(argv).toContain('cloud-one');
      expect(argv).toContain('--session');
      expect(argv).toContain('ses_cloud1');
      expect(argv).toContain('--capabilities');
      expect(argv).toContain('llm-call,create-pr');
      const childEnv = readFileSync(envFile, 'utf8').split('\n');
      expect(childEnv).toContain('BATON_KEY=test-key-material');
      expect(childEnv).toContain('BATON_HOSTNAME=cloud-one');
      expect(childEnv).toContain('GH_TOKEN=gh-test-token');
      for (const scrubbed of ['BATON_COURSE', 'BATON_LEG', 'BATON_INSTRUCTIONS', 'BATON_TICKET_FILE', 'BATON_ANSWER', 'BATON_PARENT']) {
        expect(childEnv.find((l) => l.startsWith(`${scrubbed}=`)), `${scrubbed} must not reach the runner`).toBeUndefined();
      }
      process.kill(pid, 'SIGTERM');
    } finally {
      rmSync(args, { force: true });
      rmSync(envFile, { force: true });
      w.cleanup();
    }
  });

  it('refuses to start over a live runner and takes over a stale pid file', async () => {
    const w = world();
    const pidfile = join(CACHE(w.home), 'runner.pid');
    let holder: ReturnType<typeof spawn> | null = null;
    try {
      mkdirSync(CACHE(w.home), { recursive: true });
      holder = spawn('sleep', ['60'], { stdio: 'ignore' });
      writeFileSync(pidfile, `${holder.pid}\n`);
      const live = run(w, ['--check']);
      expect(live.status).not.toBe(0);
      expect(live.stderr).toMatch(new RegExp(`a cloud runner is already running \\(pid ${holder.pid}`));

      // Wait for the kill to be reaped: an unreaped child keeps answering kill -0, and the
      // script would keep seeing a live runner (rightly — an undead pid is not stale).
      const reaped = new Promise<void>((resolve) => holder!.once('exit', resolve));
      process.kill(holder.pid as number, 'SIGTERM');
      await reaped;
      holder = null;
      const stale = run(w, ['--check']);
      expect(stale.status).toBe(0);
      expect(stale.stdout).toMatch(/replacing a stale pid file/);
    } finally {
      try { if (holder != null) process.kill(holder.pid as number, 'SIGTERM'); } catch { /* already gone */ }
      w.cleanup();
    }
  }, 60_000);
});
