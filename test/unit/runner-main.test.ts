// runner-main.test.ts — `baton run`'s pure half (BATON_SPEC §6.13; R3-1245): the flag parser,
// the course declarations a heartbeat needs (rule 9), the credential the environment names and
// the worker secret's shape. Node only: it writes temp checkouts and runs ssh-keygen.
import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilitiesOf } from '../../src/shared/vocabulary.mjs';
import { asksHelp, declareCourses, fetchMain, parseRunArgs, runMain, servedCourses } from '../../src/runner/main';
import { drainLines, Runner, withTimestamps } from '../../src/runner/runner';
import { BatonApi, BatonRefusal } from '../../src/runner/api';
import { HARNESS_AGENTS } from '../../src/runner/harness';
import { envAuth } from '../../src/runner/api';
import { courseOf, dropCourse, freshSecret, holdHome, legNeeds, loadCourse, readHead } from '../../src/runner/home';
import { declarationFrom } from '../../src/runner/runner';
import { validateCourse } from '../../src/core/course';

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
    // B-86: no --capabilities is null, never a default: the grant's capabilities are declared.
    expect(a).toMatchObject({ harness: 'opencode', home: '/h', url: 'https://b', session: 's', repository: 'docs', hostname: 'vm-x', tier: 'critical', capabilities: null, testHarness: false, verbose: false });
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
    // B-86: --capabilities narrows; no flag is no declaration (`null`), never `agent-venue` alone.
    expect(parseRunArgs(['--capabilities', 'llm-call'], {}).capabilities).toEqual(['llm-call']);
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

  it('--help and -h print the usage — what --capabilities narrows — and exit 0 before any credential (B-86)', async () => {
    const saved = clearLegEnv();
    const lines: string[] = [];
    try {
      expect(await runMain(['--help'], { log: (l) => lines.push(l) })).toBe(0);
      const said = lines.join('\n');
      expect(said).toContain('usage: baton run');
      expect(said).toContain('[--capabilities a,b]');
      // What-to-build 2: the flag narrows, never enables; absent it the grant speaks.
      expect(said).toContain('narrows what the grant allows; it never enables what the grant does not');
      expect(said).toContain('Absent, the runner declares what the grant allows');
      // B-103: --course narrows the courses served; absent it, every course the home declares.
      expect(said).toContain('narrows the courses served to this one, of those the home declares');
      expect(said).toContain('Absent, the runner serves and declares every course the home declares');
      lines.length = 0;
      expect(await runMain(['-h'], { log: (l) => lines.push(l) })).toBe(0);
      expect(lines.join('\n')).toBe(said);
      // Nothing else ran: a help run with no credential would otherwise throw past the usage.
      expect(asksHelp(['--home', '/x', '--help'])).toBe(true);
      expect(asksHelp(['--home', '/x'])).toBe(false);
    } finally {
      restoreLegEnv(saved);
    }
  });

  it('the identity banner names the grant where no --capabilities was given, and the flag\'s own list when it was (B-86)', async () => {
    // B-86's seam: the banner's capabilities field is the flag when given, and the grant (not
    // `agent-venue` alone) when it is not — `runMain` says both.
    const src = readFileSync(join(import.meta.dirname, '../../src/runner/main.ts'), 'utf8');
    expect(src).toContain("a.capabilities?.join(',') ?? 'grant (--capabilities to narrow)'");
    expect(src).not.toContain("a.capabilities ?? ['agent-venue']");
    // B-103: the banner's course field names every served course (`create-pr@1, create-spec@2`),
    // in the singular only when `--course` (or a one-course home) left one.
    expect(src).toContain("course${courses.length === 1 ? '' : 's'} ${courses.map((c) => `${c.course}@${c.version}`).join(', ')}");
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

// B-86: the declaration a runner with no --capabilities makes from its grant, and the legs'
// needs the never-eligible line names (the home checkout's course file).
describe('the grant\'s declaration (B-86)', () => {
  it('declarationFrom: exactly the answered set — deduped, `none` dropped, nothing folded or dropped', () => {
    // Review round 4, finding 1: every name in the answer was answered by the server — a role a
    // bearer or seed key's allow-list names stands as the role (the heartbeat admits it by that
    // name), the capabilities of a granted key stand as themselves. So nothing is folded away.
    expect(declarationFrom(['agent-venue'])).toEqual(['agent-venue']);
    expect(declarationFrom(['agent-venue', 'llm-call'])).toEqual(['agent-venue', 'llm-call']);
    expect(declarationFrom(['agent-venue', 'create-pr', 'llm-call'])).toEqual(['agent-venue', 'create-pr', 'llm-call']);
    // A granted key's expanded answer: the four capabilities, none named as a role.
    expect(declarationFrom(['authentication', 'llm-call', 'create-pr', 'drivable-browser'])).toEqual(['authentication', 'llm-call', 'create-pr', 'drivable-browser']);
    expect(declarationFrom(['create-pr', 'llm-call'])).toEqual(['create-pr', 'llm-call']);
    expect(declarationFrom(['human-operator', 'create-pr'])).toEqual(['human-operator', 'create-pr']);
    expect(declarationFrom([])).toEqual([]);
    // `none` is every runner's and is never declared; duplicates collapse.
    expect(declarationFrom(['none', 'vpn:corp', 'llm-call', 'vpn:corp'])).toEqual(['vpn:corp', 'llm-call']);
  });

  it('declarationFrom: what it returns is what the heartbeat accepts, a name for a name (review round 4, finding 1)', () => {
    // The heartbeat's own check (workerApi.ts `heartbeatTx`), mirrored here: a granted key admits
    // a non-role name in `cred.allowed` and a role when every capability it expands to is; a
    // bearer or seed key (a grant answer, or `credentialAllowed`'s literal allow-list) admits a
    // name when it is the literal list's. The declaration must keep every answered name and add
    // none — a name the check would refuse is a `forbidden` beat, which costs the lease.
    const grantedAccepts = (list: Set<string>) => (n: string) => (n === 'human-operator' ? list.has(n) : [...capabilitiesOf([n])].every((x) => list.has(x)));
    const bearerAccepts = (list: Set<string>) => (n: string) => list.has(n);
    // The seven sets: a granted key's expanded grants (the answer `grantCapabilities` gives), a
    // bearer or seed key's literal allow-list — including the role-only list `testCourse.ts` uses.
    const grantedSets = [
      ['agent-venue', 'create-pr', 'drivable-browser', 'llm-call', 'authentication'],
      ['authentication', 'create-pr', 'drivable-browser', 'llm-call'],
      ['authentication', 'create-pr', 'drivable-browser', 'llm-call', 'mcp-chrome'],
      ['human-operator', 'llm-call'],
      ['create-pr', 'llm-call'],
    ];
    const bearerSets = [['agent-venue'], ['agent-venue', 'llm-call'], ['agent-venue', 'create-pr', 'llm-call'], ['agent-venue', 'human-operator']];
    for (const [held, accepts] of [
      ...grantedSets.map((h): [string[], (n: string) => boolean] => [h, grantedAccepts(new Set([...h, 'none']))]),
      ...bearerSets.map((h): [string[], (n: string) => boolean] => [h, bearerAccepts(new Set(h))]),
    ]) {
      const decl = declarationFrom(held);
      const why = `${JSON.stringify(held)} → ${JSON.stringify(decl)}`;
      // Every answered name is declared, verbatim.
      for (const n of held) if (n !== 'none') expect(decl.includes(n), why).toBe(true);
      // And each declared name passes the same predicate that answered it.
      for (const n of decl) expect(accepts(n), `${why}: ${n}`).toBe(true);
      // Nothing is declared that was not answered, and nothing is declared twice.
      expect(new Set(decl), why).toEqual(new Set(held.filter((n) => n !== 'none')));
      expect(decl.length, why).toBe(new Set(held.filter((n) => n !== 'none')).size);
      // Rule 4 sees every capability the answer carried, through the role where the role stands.
      const carries = capabilitiesOf(held);
      for (const cap of capabilitiesOf(decl)) expect(carries.has(cap), `${why}: ${cap}`).toBe(true);
      for (const cap of carries) expect(capabilitiesOf(decl).has(cap), `${why}: ${cap} kept`).toBe(true);
    }
    // The role that stands keeps its capabilities reachable gates-side: `agent-venue` expands in
    // `capabilitiesOf`, so a clause requiring the four is still met.
    expect([...capabilitiesOf(declarationFrom(['agent-venue']))].sort()).toEqual([...capabilitiesOf(['agent-venue'])].filter((c) => c !== 'agent-venue').sort());
  });
  it('legNeeds: each leg\'s requires.capabilities, expanded as rule 4 reads them, from the course the checkout carries', () => {
    const dir = home();
    writeFileSync(join(dir, '.baton', 'courses', 'relay', 'course.json'), JSON.stringify({
      start: 'a', start_leg: 'b', end: ['c'],
      stations: { a: {}, b: {}, c: {} },
      // The vocabulary role `agent-venue` stands (round 4, finding 5): a runner declaring it is
      // never told it lacks it; a namespaced name is taken as itself.
      // A course role expands through `capability_roles` (R-BTN-121, round 5, finding 3): a leg
      // naming `deployer` asks for what it carries, never a capability called `deployer`.
      capability_roles: { deployer: ['vpn:corp', 'credential:DEPLOY_TOKEN'] },
      legs: { b: { from: ['a'], to: 'b', requires: { capabilities: ['create-pr', 'agent-venue', 'deployer'] } }, c: { from: ['b'], to: 'c' } },
    }));
    const needs = legNeeds(dir, '', 'relay');
    expect([...new Set(needs)].sort()).toEqual(['authentication', 'create-pr', 'credential:DEPLOY_TOKEN', 'drivable-browser', 'llm-call', 'vpn:corp']);
    expect(needs).not.toContain('deployer');
    // A declaration carrying the role meets every need the role carries — the never-eligible
    // line (runner.ts `reportEligibility`) compares needs with `capabilitiesOf(declared)`.
    const held = capabilitiesOf(['agent-venue']);
    expect([...new Set(needs)].filter((n) => !held.has(n))).toEqual(['vpn:corp', 'credential:DEPLOY_TOKEN']);
    expect(legNeeds(dir, '', 'no-such-course')).toEqual([]);
    // Review round 3, finding 3: the keys are the core's own — the file `legNeeds` reads is one
    // `validateCourse` accepts (a role a leg requires is no unknown key).
    expect(validateCourse(JSON.parse(readFileSync(join(dir, '.baton', 'courses', 'relay', 'course.json'), 'utf8')))).toEqual([]);
    // Review round 6, finding 0: `human-operator` is never expanded — a runner declaring the
    // agent venue is told it lacks it, and one declaring it by name has it.
    const before = JSON.parse(readFileSync(join(dir, '.baton', 'courses', 'relay', 'course.json'), 'utf8'));
    before.legs.c.requires = { capabilities: ['human-operator'] };
    writeFileSync(join(dir, '.baton', 'courses', 'relay', 'course.json'), JSON.stringify(before));
    const reserved = legNeeds(dir, '', 'relay');
    expect(reserved).toContain('human-operator');
    expect(capabilitiesOf(['agent-venue']).has('human-operator')).toBe(false);
    expect(capabilitiesOf(['human-operator']).has('human-operator')).toBe(false); // the expansion drops the literal
    // Review round 7, finding 1: the never-eligible line's held set (runner.ts `reportEligibility`)
    // adds the literal exactly when the declaration carries it — so the answer to "does this
    // declaration lack human-operator" is the one rule 4's gate gives. Driven end to end by
    // S-BTN-41's "the never-eligible line holds the literal human-operator" row.
    const heldBy = (declared: string[]) => new Set([...capabilitiesOf(declared), ...(declared.includes('human-operator') ? ['human-operator'] : [])]);
    expect(heldBy(['human-operator']).has('human-operator')).toBe(true);
    expect(heldBy(['agent-venue']).has('human-operator')).toBe(false);
    expect(heldBy(['human-operator', 'agent-venue']).has('create-pr')).toBe(true); // the role still expands
    try {
      expect(readHead(dir)).toBe('');
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

describe('the courses a runner serves (R-BTN-131, B-103)', () => {
  /** A home whose `.baton/baton.json` declares `courses` (with or without versions), in a git
   *  checkout — `runMain` takes the home's lock (`holdHome`) before its first beat. */
  const declaring = (json: Record<string, unknown>): string => {
    const dir = home();
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'runner@test');
    git('config', 'user.name', 'runner test');
    git('add', '-A');
    git('commit', '--no-gpg-sign', '-qm', 'a home');
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify(json));
    return dir;
  };
  it('servedCourses: without --course, every course the home declares; --course narrows to that one', () => {
    // B-103 (the owner's correction, 2026-10-22): a runner serves any course its capabilities
    // serve — several from one checkout, one leg at a time. The several-without-`--course`
    // refusal is gone; before this test it was `runnerCourse`'s error.
    const dir = declaring({ courses: [{ id: 'create-pr', version: 1 }, { id: 'bug-report', version: 2 }] });
    try {
      expect(servedCourses(dir)).toEqual([{ course: 'create-pr', version: 1 }, { course: 'bug-report', version: 2 }]);
      expect(servedCourses(dir, 'bug-report')).toEqual([{ course: 'bug-report', version: 2 }]);
      expect(() => servedCourses(dir, 'decision')).toThrow('--course decision: the home checkout declares create-pr, bug-report');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // One course is one course, flag or not.
    const one = declaring({ courses: [{ id: 'create-pr', version: 1 }] });
    try {
      expect(servedCourses(one)).toEqual([{ course: 'create-pr', version: 1 }]);
      expect(servedCourses(one, 'create-pr')).toEqual([{ course: 'create-pr', version: 1 }]);
    } finally {
      rmSync(one, { recursive: true, force: true });
    }
  });
  it('courseOf at the claim\'s snapshot loads the claim\'s course of several, and refuses one the snapshot no longer carries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-main-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      mkdirSync(join(dir, '.baton'));
      writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ courses: [{ id: 'create-pr', version: 1 }, { id: 'bug-report', version: 1 }] }));
      git('add', '-A');
      git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'two courses');
      const sha = git('rev-parse', 'HEAD');
      // The claim's `course_id` is what the runner loads (B-103): each of the two, by name.
      expect(courseOf(dir, sha, 'bug-report')).toBe('bug-report');
      expect(courseOf(dir, sha, 'create-pr')).toBe('create-pr');
      // With no name and several courses it is refused, never guessed.
      expect(() => courseOf(dir, sha)).toThrow('names 2 courses: create-pr, bug-report');
      expect(() => courseOf(dir, sha, 'decision')).toThrow('carries no course decision');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The wiring: `runMain` passes every served course to the heartbeat. A recording transport
  // answers the calls itself (no Baton), so what it sees is the body the heartbeat path composed.
  // `runMain`'s loop runs until stopped, so the probe drains it the way SIGTERM does: one signal,
  // the first path, which ends `work()` without exiting.
  const probe = async (dir: string, argv: string[] = [], signal: NodeJS.Signals = 'SIGTERM') => {
    const seen = { heartbeats: [] as Record<string, unknown>[] };
    const lines: string[] = [];
    const saved = ['BATON_PARENT', 'BATON_TOKEN', 'BATON_KEY', 'BATON_KEY_FILE'].map((n) => [n, process.env[n]] as const);
    for (const [n] of saved) delete process.env[n];
    process.env.BATON_TOKEN = 'tok-vm-a'; // a credential, so the run gets as far as its beats
    try {
      const running = runMain(['--home', dir, '--test-harness', '--beat-every', '50', '--session', 'courses-probe', ...argv], {
        log: (l) => lines.push(l),
        fetch: () => {}, // the home's snapshot is never needed: no ticket is claimable
        transport: async (req: Request) => {
          const path = new URL(req.url).pathname;
          const body = JSON.parse(req.body ? await new Response(req.body).text() : '{}') as Record<string, unknown>;
          if (path.endsWith('/heartbeat')) seen.heartbeats.push(body);
          // An idle answer throughout: nothing to recommend, nothing to claim.
          const answer = path.endsWith('/heartbeat')
            ? { runner_id: 1, incarnation: 1, grant: { capabilities: ['agent-venue'] }, claim: null, messages: [], stale_courses: [], mode: 'cut-over', server_time: 0 }
            : path.endsWith('/recommendations') ? { recommendations: [] } : { code: 'no-eligible-ticket', message: 'nothing to claim' };
          return new Response(JSON.stringify(answer), { status: path.endsWith('/claim') ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
        },
      });
      // Wait for the first beat, then drain: the SIGTERM handler's own first path, called
      // directly (an emitted signal also reaches vitest's warning wrapper, which unregisters the
      // handler between the two deliveries).
      for (let i = 0; i < 400 && !seen.heartbeats.length; i++) await new Promise((r) => setTimeout(r, 10));
      (signal === 'SIGTERM' ? process.listeners('SIGTERM') : process.listeners(signal)).forEach(() => {});
      (process.listeners(signal).at(-1) as (s: NodeJS.Signals) => void)(signal);
      expect(await running).toBe(signal === 'SIGTERM' ? 0 : signal === 'SIGINT' ? 130 : 129);
      return { lines, seen };
    } finally {
      for (const [n, v] of saved) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
  it('runMain without --course declares every declared course in the heartbeat, and the banner names them (B-103)', async () => {
    const dir = declaring({ skills_version: 3, courses: [{ id: 'create-pr', version: 1 }, { id: 'create-spec', version: 2 }], agent_command: 'true' });
    const { lines, seen } = await probe(dir);
    // Rule 9, per course: the heartbeat carries both, at their declared versions.
    expect(seen.heartbeats.length).toBeGreaterThan(0);
    expect(seen.heartbeats[0].courses).toEqual([
      { repository: 'docs', course: 'create-pr', version: 1 },
      { repository: 'docs', course: 'create-spec', version: 2 }]);
    // The banner names them, so a log says what the runner serves.
    expect(lines.join('\n')).toContain('courses create-pr@1, create-spec@2');
  }, 30_000);
  it('runMain --course narrows the declaration to that course alone (B-103)', async () => {
    const dir = declaring({ skills_version: 3, courses: [{ id: 'create-pr', version: 1 }, { id: 'create-spec', version: 2 }], agent_command: 'true' });
    const { lines, seen } = await probe(dir, ['--course', 'create-spec']);
    expect(seen.heartbeats[0].courses).toEqual([{ repository: 'docs', course: 'create-spec', version: 2 }]);
    // One course reads as one, in the banner's singular field as before.
    expect(lines.join('\n')).toContain('course create-spec@2, host');
  }, 30_000);
  it("the immediate stop ends the loop through the safe point with the signal's code — SIGINT 130, SIGHUP 129 — and the line it leaves names the stop (B-109)", async () => {
    for (const [signal, code] of [['SIGINT', 130], ['SIGHUP', 129]] as const) {
      const dir = declaring({ skills_version: 3, courses: [{ id: 'create-pr', version: 1 }], agent_command: 'true' });
      const { lines } = await probe(dir, ['--verbose'], signal);
      // The safe point's own line (the runner's log): the immediate stop releases, it does not
      // abandon. The signal handler's line goes to the synchronous log, which the probe's
      // injected log does not see; the exit code (asserted in the probe) is the signal's.
      expect(lines.join('\n'), signal).toContain('stopping at once (the immediate stop)');
      void code;
    }
  }, 30_000);
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
    // No baton.json naming the courses: the one-directory fallback cannot choose between them.
    expect(() => declareCourses(several)).toThrow(/2 courses/);
    // B-103: the several-directory refusal is the runner's to answer too — both are served, so
    // neither is refused once the home names them (below and `servedCourses`).
    writeFileSync(join(several, '.baton', 'baton.json'), JSON.stringify({ skills_version: 5, courses: [{ id: 'relay' }, { id: 'other' }] }));
    expect(declareCourses(several)).toEqual([{ course: 'relay', version: 5 }, { course: 'other', version: 5 }]);
    rmSync(several, { recursive: true, force: true });
    const noVersion = home(); // one course, no version anywhere
    expect(() => declareCourses(noVersion)).toThrow(/no course version/);
    rmSync(noVersion, { recursive: true, force: true });
    const empty = mkdtempSync(join(tmpdir(), 'baton-main-'));
    expect(() => declareCourses(empty)).toThrow(/no .baton\/courses/);
    rmSync(empty, { recursive: true, force: true });
  });
  it('B-103: a course entry naming no version runs at the version the home names — never a guess', () => {
    const interim = home();
    writeFileSync(join(interim, '.baton', 'baton.json'), JSON.stringify({ skills_version: 3, courses: [{ id: 'create-pr', version: 1 }, { id: 'create-spec' }] }));
    expect(declareCourses(interim)).toEqual([{ course: 'create-pr', version: 1 }, { course: 'create-spec', version: 3 }]);
    // Both without a version are served at skills_version too (the docs repository's shape).
    writeFileSync(join(interim, '.baton', 'baton.json'), JSON.stringify({ skills_version: 3, courses: [{ id: 'create-pr' }, { id: 'create-spec' }] }));
    expect(declareCourses(interim)).toEqual([{ course: 'create-pr', version: 3 }, { course: 'create-spec', version: 3 }]);
    rmSync(interim, { recursive: true, force: true });
    // No version anywhere: refused, naming the course — a wrong declaration silences rule 9.
    const bare = home();
    writeFileSync(join(bare, '.baton', 'baton.json'), JSON.stringify({ courses: [{ id: 'relay' }] }));
    expect(() => declareCourses(bare)).toThrow(/names no course version for relay/);
    rmSync(bare, { recursive: true, force: true });
    // A version that is not a number is still malformed.
    const malformed = home();
    writeFileSync(join(malformed, '.baton', 'baton.json'), JSON.stringify({ skills_version: 3, courses: [{ id: 'relay', version: 'three' }] }));
    expect(() => declareCourses(malformed)).toThrow(/must be \{id, version/);
    rmSync(malformed, { recursive: true, force: true });
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

describe('the first beat (B-93, S-BTN-159: a runner start says what it does, and nothing else)', () => {
  /** A session's start: no worker yet, the first attempt's beat registering one. Its state lives
   * in this process's memory — a handful of fields, one heartbeat registers them — and its state
   * file and spool are its own, under a fresh temp directory. */
  const runFresh = (api: BatonApi, log: (l: string) => void): Runner => {
    const home = join(mkdtempSync(join(tmpdir(), 'baton-fb-')), 'home');
    mkdirSync(home);
    const r = new Runner({ api, home, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 'fresh',
      courses: [{ course: 'create-pr', version: 1 }], stateFile: join(home, 'fresh.json'), beatEvery: 60_000, log });
    const state: Record<string, unknown> = { worker_id: null, claim: null };
    const live = r as unknown as { state: Record<string, unknown> };
    live.state = {
      get: () => state,
      set: (patch: Record<string, unknown>) => { Object.assign(state, patch); },
      // A spool nobody wrote: the beat takes nothing, and its remove is the runner's own no-op.
      spool: join(home, 'spool.jsonl'),
    };
    return r;
  };

  /** B-86's grant, as a granted machine's answer carries it (S-BTN-41): the beat that declares
   *  `[]` asks with nothing and is still answered with what the key may declare, so its
   *  declaration settles and the claim that follows needs no second beat. `every` is the seed
   *  key's answer (no `grant` at all), the case the settle line is about. */
  const GRANT = { grant: { capabilities: ['agent-venue', 'create-pr', 'drivable-browser', 'llm-call'] } };
  /** B-86's declaration line, said once when a runner's first answered beat settles it. */
  const DECLARED = "baton: declaring agent-venue, create-pr, drivable-browser, llm-call — the grant's capabilities, no --capabilities given";

  /** A Baton that answers every call as the first beat's ordering makes it: the heartbeat
   *  registers the worker, and from then on the recommendation and the claim answer. `refuseWith`
   *  sets what the recommendation throws — counting each throw, so a case can tell the refusal
   *  was reached — or null for none. The heartbeat answers after a turn of the event loop, as a
   *  round trip does: what the quiet start guards is that nothing is asked of Baton while it is
   *  still out. */
  const registeringApi = (grant: Record<string, unknown> = GRANT, order: string[] = []) => {
    const calls = { heartbeats: 0, recommendations: 0, claims: 0 };
    let registered = false;
    let refuse: (() => Error) | null = null;
    const api = {
      setSecret: () => {},
      // `sent` is the list this beat carried, as B-86's `rewriteSettings` records it server-side
      // (S-BTN-41's `recording`): the runner reads its own list back to know it is current, so a
      // beat answered `sent: []` whose grant settles a declaration forces one more beat.
      heartbeat: async (body: Record<string, unknown>) => {
        order.push('heartbeat:start');
        await new Promise((r) => setTimeout(r, 5));
        const register = !registered; // the answer that creates the worker, as Baton's does
        calls.heartbeats++; registered = true;
        await new Promise((r) => setTimeout(r, 5));
        if (register) order.push('heartbeat:registered');
        order.push('heartbeat:answer');
        return { worker_id: 7, incarnation: 1, messages: [], sent: body.capabilities ?? [], ...grant };
      },
      recommendations: async () => {
        order.push(`recommendations(registered:${registered})`);
        calls.recommendations++;
        if (refuse) throw refuse(); // the case's own record of the refusal Baton gave
        if (!registered) throw new BatonRefusal('unauthenticated', undefined, 'no worker holds this secret', 401);
        return { recommendations: [] };
      },
      claim: async () => { order.push('claim'); calls.claims++; throw new BatonRefusal('no-eligible-ticket', undefined, 'nothing to claim', 409); },
    } as unknown as BatonApi;
    return { api, calls, refuseWith: (f: (() => Error) | null) => { refuse = f; } };
  };

  it('the registration beat’s refusal is not logged: a quiet start says nothing', async () => {
    const lines: string[] = [];
    const { api, calls, refuseWith } = registeringApi();
    // The recommendation about to be refused — so an empty `lines` is the refusal swallowed, not
    // the recommendation skipped: a change that never asks it leaves `refused` 0 and fails here.
    let refused = 0;
    refuseWith(() => { refused++; return new BatonRefusal('unauthenticated', undefined, 'no worker holds this secret', 401); });
    const r = runFresh(api, (l) => lines.push(l));
    expect(await r.runOnce()).toBeNull(); // nothing claimable, on a session whose first beat registered it
    // Two beats, as B-86's grant-driven declaration spends them (#104): the first declares nothing
    // — the registration has no list to widen — and is answered the grant; the declaration then
    // differs from what the server holds (`sent: []`), so one more beat carries it before the
    // claim, which is what `rewriteSettings` records. Then the recommendation is the stray this
    // ticket names, and the claim.
    expect(calls).toEqual({ heartbeats: 2, recommendations: 1, claims: 1 });
    expect(refused).toBe(1);
    // The one line such a start says: what it declares, from the grant. Nothing else — not
    // `no recommendation (no worker holds this secret)` on every start.
    expect(lines).toEqual(["baton: declaring agent-venue, create-pr, drivable-browser, llm-call — the grant's capabilities, no --capabilities given"]);
    r.stop();
  });

  it('a settled worker’s forced beat does not make the refusal a stray: it is logged (round 4, 4-r1-2)', async () => {
    const lines: string[] = [];
    // Registered already, its declaration settled, but the server has not recorded it (`sent:
    // null`), so the settle loop forces one beat — and that beat is not a registration's. The
    // refusal that follows is news: the pin for `beating = !registered`, which a revert to the
    // unconditional `beating = true` would swallow as a stray.
    const { api, calls, refuseWith } = registeringApi();
    refuseWith(() => new BatonRefusal('unauthenticated', undefined, 'no worker holds this secret', 401));
    const r = runFresh(api, (l) => lines.push(l));
    const live = r as unknown as { state: Record<string, unknown> };
    live.state = { get: () => ({ worker_id: 7, claim: null, declared: ['agent-venue'], sent: null }), set: () => {}, spool: live.state.spool };
    expect(await r.runOnce()).toBeNull();
    expect(calls.heartbeats).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes('no recommendation (no worker holds this secret)'))).toBe(true);
    r.stop();
  });

  it('a seed key’s start says the grant settle line once, and still nothing of the refusal', async () => {
    const lines: string[] = [];
    // A seed key's answer: no `grant` at all, so the declaration stays unsettled, the settle line
    // is said once (#104's finding 6) and each attempt asks again. That line is the one thing a
    // start on such a key says; the registration's own refusal is not among its noise.
    const { api, calls, refuseWith } = registeringApi({});
    refuseWith(() => new BatonRefusal('unauthenticated', undefined, 'no worker holds this secret', 401));
    const r = runFresh(api, (l) => lines.push(l));
    expect(await r.runOnce()).toBeNull();
    // The boot beat declares nothing and is answered no grant; it is itself the beat that
    // registers the worker in `registeringApi`; the settle beat it forces is answered no grant
    // again — then the recommendation is the stray, then the claim.
    expect(calls).toEqual({ heartbeats: 2, recommendations: 1, claims: 1 });
    expect(lines).toEqual(['baton: the heartbeat answered no grant — the declaration stays unsettled and the next beat asks again (a seed key is granted nothing; a machine key is granted by its owner)']);
    r.stop();
  });

  it('a slow boot beat is waited for: nothing is asked before it answers, so nothing is logged', async () => {
    const lines: string[] = [];
    // What Baton saw, call by call, and whether a worker existed when the recommendation left. A
    // grant-less Baton is the state a fresh credential starts in, and it is also B-86's "no grant
    // yet" answer, which forces no extra beat — but its register beat is still a round trip, and
    // this one is slow (a further 40 ms), so a recommendation sent beside it would reach Baton
    // first if nothing waited for the answer.
    const order: string[] = [];
    const { api, calls, refuseWith } = registeringApi({}, order);
    let refused = 0;
    refuseWith(() => { refused++; return new BatonRefusal('unauthenticated', undefined, 'no worker holds this secret', 401); });
    const heart = api.heartbeat;
    (api as unknown as { heartbeat: (b: unknown) => Promise<unknown> }).heartbeat = async (body: unknown) => {
      await new Promise((res) => setTimeout(res, 40));
      return heart(body as never);
    };

    const r = runFresh(api, (l) => lines.push(l));
    r.start(); // the sidecar's boot beat, not awaited — as `work()` starts it
    expect(await r.runOnce()).toBeNull();
    // The recommendation went out to a worker whose secret Baton already held, never beside a beat
    // still out — the race whose refusal (`no worker holds this secret`, the line this ticket
    // removes) `stray` would otherwise swallow into a quiet log. `refused` proves the
    // recommendation really was asked, so the quiet below is the refusal handled and not skipped.
    expect(order.filter((e) => e.startsWith('recommendations')), order.join(' → ')).toEqual(['recommendations(registered:true)']);
    expect(order.indexOf('recommendations(registered:true)'), order.join(' → ')).toBeGreaterThan(order.indexOf('heartbeat:answer'));
    expect(refused).toBe(1);
    // The one line such a start says: the grant is unsettled, said once.
    expect(lines).toEqual(['baton: the heartbeat answered no grant — the declaration stays unsettled and the next beat asks again (a seed key is granted nothing; a machine key is granted by its owner)']);
    // Two beats is what this attempt spends (B-86's settle beat included); the case is the order,
    // not the count.
    expect(calls.recommendations).toBe(1);
    expect(calls.claims).toBe(1);
    r.stop();
  });

  it('a beat in flight before an attempt is finished first: the recommendation follows its answer', async () => {
    // B-86 settles the declaration before the first claim, so on a fresh session a forced beat
    // always stands between an in-flight boot beat and the recommendation — which is why the boot
    // case above cannot lose the race below. This is the shape that can: a registered worker whose
    // declaration is already settled (`sent` current), and a beat still out when the attempt
    // begins. Without `await this.waitForBeat()` the recommendation leaves beside that beat and
    // Baton's `no worker holds this secret` — the line this ticket removes — is swallowed by
    // `stray`, so nothing in the log would show the race had come back.
    const lines: string[] = [];
    const order: string[] = [];
    const register = registeringApi({}, order);
    register.refuseWith(() => new BatonRefusal('unauthenticated', undefined, 'no worker holds this secret', 401));
    const { api, calls } = register;
    const heart = api.heartbeat;
    // The beat answers every call as a registered worker's — it names the worker on the first
    // beat, so the case does not depend on which beat the state check sees.
    (api as unknown as { heartbeat: (b: unknown) => Promise<unknown> }).heartbeat = async (body: unknown) => {
      await new Promise((res) => setTimeout(res, 40));
      return heart(body as never);
    };
    const r = runFresh(api, (l) => lines.push(l));
    // A worker the state names, its declaration settled as a previous beat left it, so runOnce has
    // no reason to beat of its own.
    const live = r as unknown as { state: { get(): Record<string, unknown>; set(p: Record<string, unknown>): void; spool: string }; sent: string[] };
    live.state = { get: () => ({ worker_id: 7, claim: null, declared: [] }), set: () => {}, spool: live.state.spool };
    live.sent = [];

    const beat = (r as unknown as { tick(): Promise<void> }).tick(); // in flight, not awaited
    expect(await r.runOnce()).toBeNull();
    await beat;
    // The recommendation went to Baton only after that beat answered.
    expect(order.filter((e) => e.startsWith('recommendations')), order.join(' → ')).toEqual(['recommendations(registered:true)']);
    expect(order.indexOf('recommendations(registered:true)'), order.join(' → ')).toBeGreaterThan(order.indexOf('heartbeat:answer'));
    expect(calls.recommendations).toBe(1);
    r.stop();
  });

  it('only that refusal goes quiet: the other unauthenticated answers still name themselves', async () => {
    const lines: string[] = [];
    // The recommendation's answer, set per case below.
    let answer: Error | null = null;
    const rejecting = (message: string) => new BatonRefusal('unauthenticated', undefined, message, 401);
    // `authWorker`'s same code for a replayed nonce (core/workerApi.ts), the message to tell apart.
    const replayed = 'this nonce was already used: a replayed request';
    const api = {
      setSecret: () => {},
      heartbeat: async (body: Record<string, unknown>) => ({ worker_id: 7, incarnation: 1, messages: [], sent: body.capabilities ?? [], ...GRANT }),
      recommendations: async () => {
        if (answer) throw answer;
        return { recommendations: [{ ticket_id: 'B-9' }] };
      },
      claim: async () => { throw new BatonRefusal('no-eligible-ticket', undefined, 'nothing to claim', 409); },
    } as unknown as BatonApi;
    // A worker the state names already: the registration's own exemption does not reach it.
    const r = runFresh(api, (l) => lines.push(l));
    const live = r as unknown as { state: { get(): Record<string, unknown>; set(p: Record<string, unknown>): void; spool: string } };
    const answered: Record<string, unknown> = { worker_id: 7, claim: null };
    live.state = {
      get: () => answered,
      set: (patch: Record<string, unknown>) => { Object.assign(answered, patch); },
      spool: live.state.spool,
    };
    answer = rejecting(replayed);
    await r.runOnce();
    // B-86's once-per-declaration line first (an unsettled runner's first answered beat), then
    // the refusal, which names itself.
    expect(lines).toEqual([DECLARED, `baton: no recommendation (${replayed})`]);
    // On a registration attempt too: only the ticket's own refusal is the stray, never the code.
    lines.length = 0;
    const fresh = runFresh(api, (l) => lines.push(l));
    await fresh.runOnce();
    expect(lines).toEqual([DECLARED, `baton: no recommendation (${replayed})`]);
    // And the ticket's refusal, on that same registration attempt, is the one that goes quiet.
    lines.length = 0;
    answer = rejecting('no worker holds this secret');
    const quiet = runFresh(api, (l) => lines.push(l));
    await quiet.runOnce();
    // The declaration line only — the refusal itself is not logged.
    expect(lines).toEqual([DECLARED]);
    r.stop();
    fresh.stop();
    quiet.stop();
  });

  it('a registered worker still logs the refusal its gates give', async () => {
    const lines: string[] = [];
    const asked: (string | null)[] = [];
    let refuseGates = false;
    const api = {
      setSecret: () => {},
      heartbeat: async (body: Record<string, unknown>) => ({ worker_id: 7, incarnation: 1, messages: [], sent: body.capabilities ?? [], ...GRANT }),
      recommendations: async () => {
        if (refuseGates) throw new BatonRefusal('not-eligible', undefined, 'every gate refused this worker', 403);
        return { recommendations: [{ ticket_id: 'B-9' }] };
      },
      claim: async (body: { ticket_id?: string }) => {
        asked.push(body.ticket_id ?? null); // the recommendation is what the claim asks for
        throw new BatonRefusal('no-eligible-ticket', undefined, 'nothing to claim', 409);
      },
    } as unknown as BatonApi;
    const r = runFresh(api, (l) => lines.push(l));
    // A worker its state names already (a session resumed, or a beat before this attempt).
    const live = r as unknown as { state: { get(): Record<string, unknown>; set(p: Record<string, unknown>): void; spool: string } };
    const answered: Record<string, unknown> = { worker_id: 7, claim: null };
    live.state = {
      get: () => answered,
      set: (patch: Record<string, unknown>) => { Object.assign(answered, patch); },
      spool: live.state.spool,
    };
    await r.runOnce();
    expect(asked).toEqual(['B-9']); // a registered worker is recommended for, and its claim asks for the pick
    // B-86's own once-per-declaration line, and nothing else: no refusal was due, and none was logged.
    expect(lines).toEqual([DECLARED]);
    refuseGates = true;
    lines.length = 0;
    await r.runOnce();
    expect(lines).toEqual(['baton: no recommendation (every gate refused this worker)']);
    r.stop();
  });
});

describe('draining (SIGTERM\'s graceful path, 2026-10-24)', () => {
  const fakeApi = (claim: unknown) => ({
    setSecret: () => {},
    heartbeat: async () => ({ worker_id: 1, incarnation: 1, messages: [] }),
    recommendations: async () => ({ recommendations: [] }),
    claim,
  }) as unknown as BatonApi;

  it('an idle runner ends its loop within a beat of drain(), claiming nothing after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-drain-'));
    let claims = 0;
    const api = fakeApi(async () => { claims++; throw new BatonRefusal('no-eligible-ticket', undefined, 'none', 400); });
    const lines: string[] = [];
    const r = new Runner({ api, home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 'drain',
      courses: [{ course: 'create-pr', version: 1 }], stateFile: join(dir, 's.json'), beatEvery: 60, log: (l) => lines.push(l) });
    const done = r.work();
    await new Promise((res) => setTimeout(res, 150)); // it claims (refused), then idles
    const claimsBefore = claims;
    r.drain('test');
    await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('work() did not end after drain')), 2000))]);
    expect(claims).toBe(claimsBefore); // nothing claimed between the drain and the exit
    expect(lines.join('\n')).toContain('draining (test)');
    r.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a runner drained before work() starts claims nothing at all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-drain-'));
    let claims = 0;
    const api = fakeApi(async () => { claims++; throw new BatonRefusal('no-eligible-ticket', undefined, 'none', 400); });
    const r = new Runner({ api, home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 'drain2',
      courses: [{ course: 'create-pr', version: 1 }], stateFile: join(dir, 's.json'), beatEvery: 60, log: () => {} });
    r.drain('before');
    await r.work();
    expect(claims).toBe(0);
    r.stop();
    rmSync(dir, { recursive: true, force: true });
  });
});
