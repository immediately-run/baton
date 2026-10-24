// runner-main.test.ts — `baton run`'s pure half (BATON_SPEC §6.13; R3-1245): the flag parser,
// the course declarations a heartbeat needs (rule 9), the credential the environment names and
// the worker secret's shape. Node only: it writes temp checkouts and runs ssh-keygen.
import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareCourses, fetchMain, parseRunArgs, runMain, runnerCourse } from '../../src/runner/main';
import { drainLines, withTimestamps } from '../../src/runner/runner';
import { HARNESS_AGENTS } from '../../src/runner/harness';
import { envAuth } from '../../src/runner/api';
import { courseOf, dropCourse, freshSecret, holdHome, loadCourse } from '../../src/runner/home';

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-main-'));
  mkdirSync(join(dir, '.baton', 'courses', 'relay'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'courses', 'relay', 'course.json'), '{"start":"a","start_leg":"b","end":["c"],"stations":{},"legs":{}}');
  return dir;
}

describe('parseRunArgs', () => {
  it('defaults from the environment', () => {
    const a = parseRunArgs([], { BATON_HOME: '/h', BATON_URL: 'https://b', BATON_SESSION: 's', BATON_REPOSITORY: 'docs', BATON_HOSTNAME: 'vm-x' });
    // B-97: the transition's spellings are gone — an IR_ session or hostname is not read.
    const legacy = parseRunArgs([], { IR_BATON_SESSION: 'old', IR_BATON_NAME: 'vm-old' });
    expect(legacy.session).not.toBe('old');
    expect(legacy.hostname).not.toBe('vm-old');
    expect(a).toMatchObject({ harness: 'opencode', home: '/h', url: 'https://b', session: 's', repository: 'docs', hostname: 'vm-x', tier: 'critical', capabilities: ['agent-venue'], testHarness: false, verbose: false });
  });
  it('takes its flags, refusing the unknown and the malformed', () => {
    const a = parseRunArgs(['--harness', 'claude-code', '--home', '/x', '--url', 'https://u', '--session', 's2', '--repository', 'ops', '--tier', 'routine', '--capabilities', 'a,b', '--beat-every', '5000'], {});
    expect(a).toMatchObject({ harness: 'claude-code', home: '/x', url: 'https://u', session: 's2', repository: 'ops', tier: 'routine', capabilities: ['a', 'b'], beatEvery: 5000 });
    expect(() => parseRunArgs(['--nope'], {})).toThrow('not a flag of baton run');
    expect(() => parseRunArgs(['--harness', 'vim'], {})).toThrow('opencode or claude-code');
    expect(() => parseRunArgs(['--beat-every', '10'], {})).toThrow('at least 50 ms');
    expect(() => parseRunArgs(['--home'], {})).toThrow('needs a value');
    expect(parseRunArgs(['--course', 'bug-report'], {}).course).toBe('bug-report');
    // B-83: --test-harness permits the bare-echo stub, and says so on the heartbeat.
    expect(parseRunArgs(['--test-harness'], {}).testHarness).toBe(true);
    // Verbose logging (2026-10-23): timestamps, the claim's id and nonce, the leg's command.
    expect(parseRunArgs(['--verbose'], {}).verbose).toBe(true);
  });
});

// B-83: the agent_command a runner runs. runMain reads process.env directly, and the process
// running these tests may itself be a leg session (BATON_PARENT) with a credential
// (BATON_KEY_FILE) — exactly the env it refuses and uses — so each test clears them and restores
// what was there.
describe('the agent_command a runner runs (B-83)', () => {
  const LEG_ENV = ['BATON_PARENT', 'BATON_TOKEN', 'BATON_KEY', 'BATON_KEY_FILE'];
  const clearLegEnv = (): Record<string, string | undefined> => {
    const saved: Record<string, string | undefined> = {};
    for (const n of LEG_ENV) {
      saved[n] = process.env[n];
      delete process.env[n];
    }
    return saved;
  };
  const restoreLegEnv = (saved: Record<string, string | undefined>): void => {
    for (const [n, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  };
  /** A home whose settings name `agent_command` (or omit it, for null). */
  const homeWith = (agent_command: string | null): string => {
    const dir = home();
    const settings: Record<string, unknown> = { courses: [{ id: 'relay', version: 1 }] };
    if (agent_command != null) settings.agent_command = agent_command;
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify(settings));
    return dir;
  };

  it('runMain refuses the bare echo — a no-op agent — naming the fix; --test-harness permits the stub', async () => {
    const dir = homeWith('echo');
    const saved = clearLegEnv();
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runMain(['--home', dir])).toBe(1);
      const said = err.mock.calls.map((c) => String(c[0])).join('');
      expect(said).toContain('names agent_command "echo"');
      expect(said).toContain('baton repo init --agent opencode');
      expect(said).toContain('--test-harness');
      // The stub permitted: the run proceeds past the refusal, stopping where every runner
      // without a credential stops — never at the echo.
      await expect(runMain(['--home', dir, '--test-harness'])).rejects.toThrow(/no credential/);
    } finally {
      err.mockRestore();
      restoreLegEnv(saved);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('settings naming no agent_command drive from --harness, the command logged; a named one is left to the settings', async () => {
    const none = homeWith(null);
    const named = homeWith('my-agent');
    const lines: string[] = [];
    const saved = clearLegEnv();
    try {
      await expect(runMain(['--home', none, '--harness', 'claude-code'], { log: (l) => lines.push(l) })).rejects.toThrow(/no credential/);
      expect(lines.join('\n')).toContain('names no agent_command');
      expect(lines.join('\n')).toContain('claude-code');
      expect(HARNESS_AGENTS['claude-code']).toContain('--permission-mode bypassPermissions');
      lines.length = 0;
      await expect(runMain(['--home', named], { log: (l) => lines.push(l) })).rejects.toThrow(/no credential/);
      expect(lines.join('\n')).not.toContain('names no agent_command');
    } finally {
      restoreLegEnv(saved);
      rmSync(none, { recursive: true, force: true });
      rmSync(named, { recursive: true, force: true });
    }
  });
});

describe('one runner per home checkout (R-BTN-131)', () => {
  it('a second runner on a held home is refused; a dead holder\'s lock is taken over; release frees it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-main-'));
    try {
      execFileSync('git', ['-C', dir, 'init', '-q']);
      const lock = join(dir, '.git', 'baton-runner.lock');
      const release = holdHome(dir);
      expect(readFileSync(lock, 'utf8').trim()).toBe(String(process.pid));
      // Another live process holds it: this test's parent stands in for a second runner's view.
      // The lock's path is printed resolved (holdHome realpaths it), and on macOS the temp dir
      // is a symlink (/var → /private/var): expect the resolved spelling.
      expect(() => holdHome(dir, process.ppid)).toThrow(`held by another runner (pid ${process.pid}): each runner needs its own clone — pass --home <another clone>; if no runner is running there, remove ${realpathSync(lock)}`);
      release();
      expect(existsSync(lock)).toBe(false);
      // A stale lock — its pid is no process — is taken over.
      writeFileSync(lock, '2147483646\n');
      const again = holdHome(dir);
      expect(readFileSync(lock, 'utf8').trim()).toBe(String(process.pid));
      again();
      // The tree stays clean: the lock lives in the git dir.
      expect(execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadCourse (R-BTN-72)', () => {
  it('extracts each leg\'s script and never a repository\'s <leg>.run.mjs override, which the script loads itself (B-33)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-main-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      const legs = join(dir, '.baton', 'courses', 'relay', 'legs');
      mkdirSync(legs, { recursive: true });
      writeFileSync(join(dir, '.baton', 'courses', 'relay', 'course.json'), JSON.stringify({ start: 'a', start_leg: 'go', end: ['b'], stations: { a: {}, b: {} }, legs: { go: { from: ['a'], to: 'b' } } }));
      writeFileSync(join(legs, 'go.mjs'), 'export async function run() {}\n');
      writeFileSync(join(legs, 'go.run.mjs'), 'export async function run(ctx, standard) { return standard(ctx); }\n');
      git('add', '-A');
      git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'relay');
      const loaded = loadCourse(dir, git('rev-parse', 'HEAD'), 'relay');
      expect([...loaded.scripts.keys()]).toEqual(['go']);
      dropCourse(loaded.scratch);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('one course per runner (R-BTN-131)', () => {
  const two = [{ course: 'create-pr', version: 1 }, { course: 'bug-report', version: 2 }];
  it('runnerCourse: --course picks one of the declared; without it, exactly one must be declared', () => {
    expect(runnerCourse(two, 'bug-report')).toEqual({ course: 'bug-report', version: 2 });
    expect(runnerCourse([two[0]])).toEqual(two[0]);
    expect(() => runnerCourse(two)).toThrow('runs 2 courses (create-pr, bug-report); baton run serves one — pass --course <id>');
    expect(() => runnerCourse(two, 'decision')).toThrow('--course decision: the home checkout declares create-pr, bug-report');
  });
  it('courseOf at the claim\'s snapshot loads the runner\'s course of several, and refuses one the snapshot no longer carries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-main-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      mkdirSync(join(dir, '.baton'));
      writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ courses: [{ id: 'create-pr', version: 1 }, { id: 'bug-report', version: 1 }] }));
      git('add', '-A');
      git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'two courses');
      const sha = git('rev-parse', 'HEAD');
      expect(courseOf(dir, sha, 'bug-report')).toBe('bug-report');
      expect(() => courseOf(dir, sha)).toThrow('names 2 courses: create-pr, bug-report');
      expect(() => courseOf(dir, sha, 'decision')).toThrow('carries no course decision');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('declareCourses (rule 9)', () => {
  it('reads the spec’s baton.json courses[]', () => {
    const dir = home();
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ baton_url: 'https://baton', courses: [{ id: 'relay', version: 7 }] }));
    expect(declareCourses(dir)).toEqual([{ course: 'relay', version: 7 }]);
    rmSync(dir, { recursive: true, force: true });
  });
  it('docs’ interim: a course key with skills_version, or the single directory beside scripts/data', () => {
    const named = home();
    writeFileSync(join(named, '.baton', 'baton.json'), JSON.stringify({ course: 'relay', skills_version: 3 }));
    expect(declareCourses(named)).toEqual([{ course: 'relay', version: 3 }]);
    rmSync(named, { recursive: true, force: true });
    const listed = home();
    mkdirSync(join(listed, 'scripts', 'data'), { recursive: true });
    writeFileSync(join(listed, 'scripts', 'data', 'baton.json'), JSON.stringify({ skills_version: 4 }));
    expect(declareCourses(listed)).toEqual([{ course: 'relay', version: 4 }]);
    rmSync(listed, { recursive: true, force: true });
  });
  it('refuses what it cannot name loudly', () => {
    const several = home();
    mkdirSync(join(several, '.baton', 'courses', 'other'), { recursive: true });
    writeFileSync(join(several, '.baton', 'courses', 'other', 'course.json'), '{}');
    expect(() => declareCourses(several)).toThrow(/2 courses/);
    rmSync(several, { recursive: true, force: true });
    const noVersion = home(); // one course, no version anywhere
    expect(() => declareCourses(noVersion)).toThrow(/no course version/);
    rmSync(noVersion, { recursive: true, force: true });
    const empty = mkdtempSync(join(tmpdir(), 'baton-main-'));
    expect(() => declareCourses(empty)).toThrow(/no .baton\/courses/);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('envAuth (§6.4, R-BTN-13)', () => {
  it('the transition’s bearer token, with the worker secret once known', () => {
    const auth = envAuth({ BATON_TOKEN: 'tok-1' });
    expect(auth('POST', 'https://b.test/v1/runner/heartbeat', '', null)).toEqual({ Authorization: 'Bearer tok-1' });
    expect(auth('POST', 'https://b.test/v1/runner/heartbeat', '', 's3cret')).toEqual({ Authorization: 'Bearer tok-1', 'X-Worker-Secret': 's3cret' });
  });
  it('the IR_BATON_* spellings are gone (B-97): a runner handed only them has no credential', () => {
    for (const env of [{ IR_BATON_TOKEN: 'legacy' }, { IR_BATON_KEY: 'legacy' }, { IR_BATON_KEY_FILE: '/nonexistent/baton.key' }, { IR_BATON_KEY: 'legacy', BATON_TOKEN: '' }]) {
      expect(() => envAuth(env)).toThrow('no credential: BATON_KEY_FILE, BATON_KEY or BATON_TOKEN');
    }
    // The new name alone still serves, and the old one beside it changes nothing.
    expect(envAuth({ BATON_TOKEN: 'new', IR_BATON_TOKEN: 'legacy' })('POST', 'https://b.test/v1/runner/heartbeat', '', null)).toEqual({ Authorization: 'Bearer new' });
    expect(() => envAuth({})).toThrow('no credential: BATON_KEY_FILE, BATON_KEY or BATON_TOKEN');
  });
  it('a key file signs: ssh-keygen makes one, Baton’s verifier shape comes back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-key-'));
    const file = join(dir, 'id_ed25519');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file], { stdio: 'ignore' });
    const auth = envAuth({ BATON_KEY_FILE: file });
    const headers = auth('POST', 'https://b.test/v1/runner/heartbeat', '{}', null);
    expect(headers['Content-Digest']).toMatch(/^sha-256=:/);
    expect(headers['Signature-Input']).toMatch(/tag="baton-request"/);
    expect(headers.Signature).toMatch(/^sig1=:/);
    expect(auth('POST', 'https://b.test/x', '{}', 's')).toHaveProperty('X-Worker-Secret', 's');
    rmSync(dir, { recursive: true, force: true });
  });
  it('an API key, in BATON_KEY or the key file, goes as a bearer with the secret (R-BTN-159)', () => {
    const key = `bak_${'a'.repeat(16)}_${'b'.repeat(64)}`;
    const fromEnv = envAuth({ BATON_KEY: key }, () => { throw new Error('an API key is never written out as an SSH key'); });
    expect(fromEnv('POST', 'https://b.test/v1/runner/heartbeat', '{}', 's')).toEqual({ Authorization: `Bearer ${key}`, 'X-Worker-Secret': 's' });
    const dir = mkdtempSync(join(tmpdir(), 'baton-key-'));
    const file = join(dir, 'worker.key');
    writeFileSync(file, `${key}\n`);
    expect(envAuth({ BATON_KEY_FILE: file })('POST', 'https://b.test/v1/runner/heartbeat', '{}', null)).toEqual({ Authorization: `Bearer ${key}` });
    rmSync(dir, { recursive: true, force: true });
  });
  it('no credential at all is an error, never a silent anonymous call', () => {
    expect(() => envAuth({})).toThrow(/no credential/);
  });
});

describe('the worker secret and the bounded fetch', () => {
  it('freshSecret is R-BTN-14’s 256-bit random, hex', () => {
    expect(freshSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(freshSecret()).not.toBe(freshSecret());
  });
  it('fetchMain swallows a failing fetch — the bound is ensureSha’s release', () => {
    const lines: string[] = [];
    expect(() => fetchMain('/nonexistent-checkout', (l) => lines.push(l))).not.toThrow();
    expect(lines.join('\n')).toMatch(/fetch failed/);
  });
});

describe('withTimestamps (verbose logging)', () => {
  it('prefixes every line with one ISO 8601 instant, whatever the line', () => {
    const lines: string[] = [];
    const log = withTimestamps((l) => lines.push(l));
    log('baton: claimed baton:B-9 at filed, queued leg implement');
    log('two\nlines');
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z baton: claimed baton:B-9 at filed, queued leg implement$/);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z two\nlines$/);
  });
});

describe('drainLines (the leg stream forwarder)', () => {
  it('emits whole lines whatever the chunking, flushes the tail, drops empties', async () => {
    const { PassThrough } = await import('node:stream');
    const stream = new PassThrough();
    const lines: string[] = [];
    drainLines(stream, (l) => lines.push(l));
    stream.write('working on B-9');           // no newline yet — waits
    stream.write(' line one\nline two');       // completes one, starts another
    stream.write('\n\n');                     // an empty line drops
    stream.end('the tail without a newline');  // flushed at the end
    await new Promise((r) => stream.on('end', r));
    expect(lines).toEqual(['working on B-9 line one', 'line two', 'the tail without a newline']);
  });
});
