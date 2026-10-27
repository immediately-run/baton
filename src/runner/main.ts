// main.ts — `baton run`'s entry (BATON_SPEC §6.13): parses the flags, refuses to nest (a session
// that carries BATON_PARENT is a leg session — it never claims, advances or ends: the runner
// that started it does), refuses the no-op `echo` agent_command (B-83: a stub for tests, behind
// --test-harness) and hands the legs the `--harness` flag's command when the settings name none,
// wires the API client (the machine's key, or the transition's token),
// the state file, the home checkout and R-BTN-34's bounded fetch, and runs the loop. The pure
// half (`parseRunArgs`, `declareCourses`, `servedCourses`, `envAuth`) is unit-tested in
// test/unit/runner-main.test.ts; the wiring is exercised end-to-end by S-BTN-41 against the
// local host.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { BatonApi, envAuth } from './api';
import { HARNESS_AGENTS, type Harness } from './harness';
import { holdHome, legNeeds, readHead } from './home';
import { GIT_NONINTERACTIVE_ENV } from '../defaults/course-markers';
import { Runner, stampLine, withTimestamps } from './runner';

export interface RunArgs {
  harness: Harness;
  home: string;
  url: string;
  session: string;
  repository: string;
  hostname: string;
  tier: string;
  /** B-86: `--capabilities`, which narrows. Null when the flag is absent — the runner then
   *  declares what the grant allows (`grant.capabilities` on its first answer). */
  capabilities: string[] | null;
  beatEvery: number;
  /** B-103: narrows the courses this runner serves to this one, of those its home checkout
   *  declares (R-BTN-131); absent, it serves and declares every one of them. */
  course?: string;
  /** B-83: the run is a test harness — the heartbeat says so (R-BTN-32, refused from any
   * credential but the test one), and the bare `echo` agent_command is permitted as the stub
   * it is, for tests. */
  testHarness: boolean;
  /** Verbose logging (B-109's slice of B-23): every line timestamped, the claim's id and
   * nonce beside the ticket, the leg's local command, and the leg child's stderr drained
   * into the log — where the stub reports the agent_command it resolved. */
  verbose: boolean;
}

/** `baton run [--harness opencode|claude-code] [--home <checkout>] [--url <url>] [--session <id>]
 * [--repository <id>] [--hostname <name>] [--tier <tier>] [--capabilities a,b] [--beat-every <ms>]
 * [--course <id>] [--test-harness] [--verbose]`.
 * Unknown flags are refused, never dropped. `--capabilities` narrows the grant: without it the
 * runner declares what the grant allows (B-86). `--help` prints this, before any credential. */
export function parseRunArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): RunArgs {
  const out: RunArgs = {
    harness: 'opencode', home: env.BATON_HOME ?? process.cwd(), url: env.BATON_URL ?? DEFAULT_URL,
    session: env.BATON_SESSION ?? `run-${Math.random().toString(16).slice(2, 10)}`,
    repository: env.BATON_REPOSITORY ?? 'docs', hostname: env.BATON_HOSTNAME ?? hostname(),
    tier: 'critical', capabilities: null, beatEvery: 2 * 60_000, testHarness: false, verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--harness') {
      const v = value();
      if (v !== 'opencode' && v !== 'claude-code') throw new Error('--harness: opencode or claude-code');
      out.harness = v;
    } else if (a === '--test-harness') out.testHarness = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--home') out.home = value();
    else if (a === '--url') out.url = value();
    else if (a === '--session') out.session = value();
    else if (a === '--repository') out.repository = value();
    else if (a === '--hostname') out.hostname = value();
    else if (a === '--tier') out.tier = value();
    else if (a === '--course') out.course = value();
    else if (a === '--capabilities') out.capabilities = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--beat-every') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 50) throw new Error('--beat-every: an integer of at least 50 ms');
      out.beatEvery = n;
    } else throw new Error(`${a}: not a flag of baton run`);
  }
  return out;
}

/** B-86: `baton run --help` (and `-h`) — the usage `parseRunArgs` reads, and what the ticket's
 * What-to-build 2 asks the runner to say: `--capabilities` narrows the grant, it never enables
 * what the grant does not allow, and absent it the runner declares the grant; `--course` narrows
 * the courses served, and absent it the runner serves every course its home declares (B-103).
 * Printed before any credential or network work, and the exit is 0. */
export const RUN_USAGE = [
  'usage: baton run [--harness opencode|claude-code] [--home <checkout>] [--url <url>] [--session <id>]',
  '                 [--repository <id>] [--hostname <name>] [--tier <tier>] [--capabilities a,b]',
  '                 [--beat-every <ms>] [--course <id>] [--test-harness] [--verbose]',
  '',
  'Runs this machine\'s worker: it heartbeats, claims a ticket of a course its home checkout',
  'declares and runs each leg — one leg at a time.',
  '',
  '  --capabilities a,b  narrows what the grant allows; it never enables what the grant does not.',
  '                      Absent, the runner declares what the grant allows — no flag is needed to',
  '                      serve the grant. A machine without a browser narrows, e.g. llm-call,create-pr.',
  '  --course <id>       narrows the courses served to this one, of those the home declares.',
  '                      Absent, the runner serves and declares every course the home declares.',
].join('\n');

/** B-86: whether the arguments ask for the usage — `--help` or `-h`, anywhere in them. */
export const asksHelp = (argv: string[]): boolean => argv.includes('--help') || argv.includes('-h');

/** A home checkout's settings files, as JSON (null for one that is absent or not JSON —
 *  `declareCourses` names that failure its own way). */
function settingsOf(home: string, path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(home, path), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The version the home checkout names for every course it declares: `.baton/baton.json`'s
 *  `skills_version` first, then docs' interim `scripts/data/baton.json`; null when neither does. */
const homeVersion = (home: string): number | null => {
  const batonJson = settingsOf(home, '.baton/baton.json');
  if (batonJson && typeof batonJson.skills_version === 'number') return batonJson.skills_version;
  const data = settingsOf(home, 'scripts/data/baton.json');
  return typeof data?.skills_version === 'number' ? data.skills_version : null;
};

/** A repository's course declarations for the heartbeat (rule 9): the spec's
 * `.baton/baton.json` `courses: [{id, version}]` (§2c/R-BTN-51) first; docs' interim is the
 * skills_version every course runs at (`{course}` naming one, or the single directory). The
 * runner refuses to guess a version it cannot find — a wrong declaration silences rule 9.
 * B-103: an entry that names no version (`{"courses": [{"id": "create-spec"}]}`) is served at
 * the version the home names — skills_version is every course's version — never at a guess. */
export function declareCourses(home: string): { course: string; version: number }[] {
  const batonJson = settingsOf(home, '.baton/baton.json');
  const version = homeVersion(home);
  if (batonJson && Array.isArray(batonJson.courses) && batonJson.courses.length) {
    const named: { course: string; version: number | null }[] = [];
    for (const c of batonJson.courses as Record<string, unknown>[]) {
      if (typeof c.id !== 'string' || (c.version !== undefined && typeof c.version !== 'number')) throw new Error('.baton/baton.json courses[] entries must be {id, version?, ...}');
      named.push({ course: c.id, version: typeof c.version === 'number' ? c.version : version });
    }
    const missing = named.filter((c) => c.version == null).map((c) => c.course);
    if (missing.length) throw new Error(`the home checkout names no course version for ${missing.join(', ')} (.baton/baton.json courses[] or skills_version, or scripts/data/baton.json)`);
    return named.map((c) => ({ course: c.course, version: c.version as number }));
  }
  if (typeof batonJson?.course === 'string') {
    if (version == null) throw new Error('the home checkout names no course version (.baton/baton.json courses[] or skills_version, or scripts/data/baton.json)');
    return [{ course: batonJson.course, version }];
  }
  const coursesDir = join(home, '.baton', 'courses');
  if (!existsSync(coursesDir)) throw new Error(`${home} has no .baton/courses`);
  const listed = readdirSync(coursesDir).filter((d) => existsSync(join(coursesDir, d, 'course.json')));
  if (listed.length !== 1) throw new Error(`the home checkout runs ${listed.length} courses and .baton/baton.json names none: ${listed.join(', ')}`);
  if (version == null) throw new Error('the home checkout names no course version (.baton/baton.json courses[] or skills_version, or scripts/data/baton.json)');
  return [{ course: listed[0], version }];
}

/** The courses a runner serves (B-103): every course the home checkout declares, or — when
 * `--course` names one — that one alone, a machine serving a subset of what its home declares.
 * The claim answer names its ticket's `course_id` (and the course's version at the snapshot), so
 * one runner loads each claim's course from the snapshot and serves several courses from one
 * checkout; its only limit is one leg at a time (rule 3, §6.13). The flag is a loud refusal when
 * it names a course the home does not declare — the one thing the runner cannot serve. */
export function servedCourses(home: string, chosen?: string): { course: string; version: number }[] {
  const declared = declareCourses(home);
  if (chosen == null) return declared;
  const one = declared.find((c) => c.course === chosen);
  if (!one) throw new Error(`--course ${chosen}: the home checkout declares ${declared.map((c) => c.course).join(', ')}`);
  return [one];
}

/** The one place `~/.cache/immediately-run` is materialised for a cloud key (§6.4). */
function cacheDir(): string {
  const dir = join(homedir(), '.cache', 'immediately-run', 'baton');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** R-BTN-34's bounded fetch: one `git fetch origin main` in the home checkout, its failure
 * logged and swallowed — `ensureSha` re-checks and releases `stale-board` when the commit is
 * still missing, which is exactly the bound. */
/** The fetch's bound: well under the lease's own (§6.3's 4-minute margin), so a stalled fetch
 * can never cost the lease it was fetching for. */
export const FETCH_TIMEOUT_MS = 20_000;

export function fetchMain(home: string, log: (l: string) => void = () => {}): void {
  try {
    execFileSync('git', ['-C', home, 'fetch', 'origin', 'main'], {
      stdio: 'ignore', timeout: FETCH_TIMEOUT_MS, killSignal: 'SIGKILL', env: { ...process.env, ...GIT_NONINTERACTIVE_ENV },
    });
  } catch (e) {
    log(`baton: the snapshot fetch failed (${e instanceof Error ? e.message : String(e)})`);
  }
}

/** The `agent_command` the home checkout's `.baton/baton.json` names ('' when it names none,
 * has no file, or is not JSON — `declareCourses` names that failure its own way). */
function namedAgentCommand(home: string): string {
  try {
    const v = (JSON.parse(readFileSync(join(home, '.baton', 'baton.json'), 'utf8')) as { agent_command?: unknown }).agent_command;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** B-94: the line a runner leaves when it stops — the signal and the runner's last state. A
 * runner that has not been built yet (the signal came before its first claim) still leaves a
 * line. Exported so the shutdown hook is tested without a process signal. */
export function stopLine(runner: Pick<Runner, 'lastLine'> | null, signal: string): string {
  return runner ? runner.lastLine(`stopping on ${signal}`) : `the runner stopped on ${signal} before its first claim`;
}

/** B-94: the `exit` hook's line, and the log write it goes to. Injected so the hook is tested
 * directly; production passes its `log`. */
export function exitHook(runner: Pick<Runner, 'lastLine'>, log: (l: string) => void): (code: number | undefined) => void {
  return (code) => log(`baton: the runner is exiting, code ${code ?? '?'} (${runner.lastLine('exiting')})`);
}

/** B-94 (review round 1): a death line must survive `process.exit` — a pipe write is
 * asynchronous and Node flushes nothing on exit, so a runner under a supervisor's pipe could
 * die tracelessly exactly as before. The signal, exit and fatal paths therefore write to fd 1
 * synchronously — or nowhere, if stdout is already gone. */
export const syncLog = (l: string): void => {
  try { writeSync(1, `${l}\n`); } catch { /* stdout is gone; the line cannot be written */ }
};

/** The death paths' logger: synchronous (nothing pending survives `process.exit`) and, under
 * verbose, timestamped like every other line (2026-10-23). */
export const syncLogStamped = (verbose: boolean, l: string): void => syncLog(verbose ? stampLine(l) : l);

/** B-94 (review round 1): the exit hook is process-wide and never unregistered by `runMain`'s
 * return, so a second `runMain` in one process (the tests run four) would stack another
 * permanent listener. One slot: the previous hook comes off before the next goes on. */
let exitHookFn: ((code: number | undefined) => void) | null = null;

export async function runMain(argv: string[], io: { log?: (l: string) => void; fetch?: (home: string) => void; transport?: (req: Request) => Promise<Response> } = {}): Promise<number> {
  // §6.13: a leg session never claims — the runner that started it does. A nested `baton run`
  // is exactly that session trying, so it is refused before anything else. BATON_PARENT is the
  // runner's name for it (B-97: the transition's IR_BATON_PARENT is gone).
  const parent = process.env.BATON_PARENT;
  if (parent) {
    process.stderr.write(`baton: this session carries BATON_PARENT=${parent}: a leg session never claims (§6.13)\n`);
    return 1;
  }
  // B-86: `--help` answers the usage and returns before any credential or network work — a
  // machine asking what the flags mean needs no key and no Baton.
  if (asksHelp(argv)) {
    (io.log ?? ((l: string) => process.stdout.write(`${l}\n`)))(RUN_USAGE);
    return 0;
  }
  const a = parseRunArgs(argv);
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  // Verbose (the owner, 2026-10-23): every line carries the time it was written.
  const say = a.verbose ? withTimestamps(log) : log;
  // B-83: a settings file whose `agent_command` is exactly `echo` is the no-op stub — the agent
  // whose every leg "succeeds" while nothing happens. The runner refuses it (only a test
  // harness, which declares itself on its heartbeat, may run the stub), naming the fix.
  const named = namedAgentCommand(a.home);
  if (named === 'echo' && !a.testHarness) {
    process.stderr.write(`baton: .baton/baton.json names agent_command "echo" — a no-op agent: every leg takes its exit 0 and returns its position, so the claim "succeeds" while nothing happens. Run \`baton repo init --agent opencode\` (or --agent claude-code, or --agent-command <cmd>), or pass --test-harness for the test stub\n`);
    return 1;
  }
  // B-83: `--harness` drives — the home's settings name no agent_command, so the legs run the
  // harness the flag names (the snapshot's settings stay authoritative when they name one: the
  // stub prefers them, and BATON_AGENT_COMMAND only ever fills an absence).
  const agentCommand = named === '' && !a.testHarness ? HARNESS_AGENTS[a.harness] : undefined;
  if (agentCommand) say(`baton: .baton/baton.json names no agent_command — the legs will run the ${a.harness} command (--harness); \`baton repo init --agent ${a.harness}\` names it in the settings`);
  const auth = envAuth(process.env, (material) => {
    const file = join(cacheDir(), 'key');
    const text = `${material.replace(/\r\n/g, '\n').trim()}\n`;
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text, { mode: 0o600 });
    chmodSync(file, 0o600);
    return file;
  });
  // Every course the home declares, or the one `--course` narrows to (B-103): refused at startup,
  // loudly, when the flag names one the home does not declare — not per claim.
  const courses = servedCourses(a.home, a.course);
  // B-86: no `--capabilities` asks for nothing — the grant speaks, and each answer's
  // `grant.capabilities` is what the runner declares. The flag narrows that.
  if (a.capabilities == null) say('baton: no --capabilities given — the runner declares what the grant allows (narrow it with --capabilities, e.g. a machine without a browser)');
  // The banner's capabilities field reads the same way: a run with no flag declares the grant,
  // which is only known once its first answer arrives, so it says so rather than implying
  // `agent-venue` alone (B-86).
  const declared = a.capabilities?.join(',') ?? 'grant (--capabilities to narrow)';
  // 2026-10-24: the identity banner — which source, what it declares, which course. Every
  // historical log this week began with no hint of what code produced it. B-103: the courses
  // field names every course the heartbeat declares (`--course` narrowed it, or the home's list).
  try {
    const head = execFileSync('git', ['-C', a.home, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    say(`baton: runner starting: home ${a.home} @ ${head}, capabilities ${declared}, course${courses.length === 1 ? '' : 's'} ${courses.map((c) => `${c.course}@${c.version}`).join(', ')}, host ${a.hostname}, session ${a.session}`);
  } catch { /* a home with no git yet: the rest of the banner still names the run */ }
  // One runner per home checkout: its legs run in the working tree (R-BTN-131). Node's default
  // SIGINT/SIGTERM exit skips \`finally\`, so the lock is released on those signals too.
  const release = holdHome(a.home);
  let runner: Runner | null = null;
  let draining = false;
  const onSignal = (signal: NodeJS.Signals) => {
    // 2026-10-24: SIGTERM drains — the current leg completes, the claim ends at its boundary,
    // and the loop returns to a clean exit 0. A second SIGTERM, or SIGINT any time, is the
    // immediate path (the leg child's group is the lease's to reap; see B-109's note).
    if (signal === 'SIGTERM' && runner != null && !draining) {
      draining = true;
      syncLogStamped(a.verbose, 'baton: SIGTERM — draining: the current leg completes, then this runner exits (a second SIGTERM stops at once)');
      runner.drain('SIGTERM');
      return;
    }
    // B-94: a runner never goes traceless — the signal, the claim it held, the leg in flight
    // and the last beat are logged before the process leaves, synchronously (review round 1:
    // `process.exit` flushes no pending pipe write).
    syncLogStamped(a.verbose, `baton: ${stopLine(runner, signal)}`);
    release();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  // B-103: the transport the runner's API calls go through. Production builds each call's
  // `fetch` (the Worker, or the local host); a test hands one in and sees the bodies the
  // heartbeat path composed without a Baton behind it.
  const transport = io.transport ?? ((req: Request) => fetch(req));
  runner = new Runner({
    api: new BatonApi({ url: a.url, transport, auth }, say),
    home: a.home, repository: a.repository, hostname: a.hostname, harness: a.harness, session: a.session,
    tierCeiling: a.tier, ...(a.capabilities ? { capabilities: a.capabilities } : {}),
    courses,
    // B-86: the legs the runner's courses require, from the home checkout's working tree — what
    // a never-eligible runner says it lacks at startup. B-103: every served course's legs, as each
    // of them must declare by its own version (rule 9 per course).
    legNeeds: () => courses.flatMap((c) => legNeeds(a.home, readHead(a.home), c.course)),
    stateFile: join(cacheDir(), `${a.session}.json`),
    beatEvery: a.beatEvery, log, verbose: a.verbose, // the Runner stamps its own lines under verbose
    fetch: io.fetch ?? ((home) => fetchMain(home, say)),
    ...(agentCommand ? { agentCommand } : {}),
    ...(a.testHarness ? { testHarness: true } : {}),
  });
  try {
    await runner.work();
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    // B-94: every way out of the loop leaves a line — a normal end, a thrown error on its way
    // out (the CLI prints it), and an `exit` from anywhere once a claim could have been held.
    // The lines and the hook write synchronously: nothing pending is lost to `process.exit`.
    syncLogStamped(a.verbose, `baton: the runner's loop ended (${runner.lastLine(draining ? 'drained' : 'idle')})`);
    if (exitHookFn != null) process.removeListener('exit', exitHookFn);
    exitHookFn = exitHook(runner, (l) => syncLogStamped(a.verbose, l));
    process.on('exit', exitHookFn);
    release();
  }
  return 0;
}
