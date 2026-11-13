// replay.ts — `baton leg replay`'s entry (BATON_SPEC §9.8 R-BTN-84; B-190): re-run one recorded
// leg run on a runner, without a claim and writing nothing to Baton. What it does, in the order
// the rule states it:
//
//   baton leg replay <ticket> <leg> [--run <n> | --run-id <id>] [--against <sha>] [--accept-moved]
//                    [--home <dir>] [--url <url>] [-i KEY] [--env NAME]… [--report <file>]
//                    [--executor <source>] [--timeout-s <s>]
//
// — reads the run from Baton (`GET …/legs/{leg}/runs`, an owner's or an administrator's key):
//   its snapshot, the head the holder reported, and its recorded inputs (`leg_run_inputs`) with
//   the ticket's version and the digest of what the source's `read` returned for the run;
// — checks the recorded snapshot sha as R-BTN-143 says a runner checks a claim's: an ancestor of
//   its own ref of the registered default branch, one bounded fetch into that ref (`--against`
//   excepted — the rule binds the recorded sha, never the flag's);
// — loads the course's scripts at the snapshot (R-BTN-143 again — an off-branch sha is never
//   loaded) and refuses a leg marked `"replay_safe": false`;
// — reads the ticket at its source the way the run read it — a `pinned` source at the recorded
//   version, a `current` one as its store holds the ticket now — and, when the version or the
//   read's digest moved, stops and reports the mismatch (`--accept-moved` runs anyway and the
//   report says so);
// — checks each recorded input's digest, fetching it read-only;
// — runs the leg script's `run(ctx)` with `ctx.replay` set, through the executor's `exec` in a
//   `leg` session (R-BTN-107, B-184), in R-BTN-144's replay environment — an allowlist, never
//   the runner's own environment, so no write-capable credential reaches the leg;
// — calls no `close`, and writes a masked local report of what ran and what it would have
//   written (`--against <sha>` compares a second run of the scripts at that sha on the same
//   inputs).
//
// The pure half (`parseReplayArgs`, `pickRun`, `replayEnvironment`, `compareRead`, `slugOf`) is
// unit-tested in test/unit/runner-replay.test.ts; the whole is exercised end-to-end by S-BTN-48
// against the local host, over a real repository.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { requestCredential, signHeaders } from '../../cli/sign.mjs';
import { bareTicketId } from '../defaults/ticket-state';
import { digestOfRead, MARKDOWN_SOURCE } from '../defaults/ticket-versions';
import { dropCourse, git, loadCourse, extractTicketSource, type CourseLoad } from './home';
import { loadExecutor, type Executor, type Handle } from './executor';
import { maskLegOutput, readMaskEnv, runnerConfigPath, secretValues } from './mask';

/** The wrapper (R-BTN-133) every call into repository code runs, as the runner passes it. */
const LEG_PROCESS = fileURLToPath(new URL('./legProcess.mjs', import.meta.url));

/** A replay's bound: no lease fences it, so the call itself is bounded — an hour by default,
 *  `--timeout-s` to change (a real agent leg's replay is the operator's own judgement). */
export const REPLAY_TIMEOUT_S = 3600;
/** A ticket argument: `<repository>:<id>`, as the ticket commands take it. */
const QUALIFIED = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;
/** A course id, as the spec's grammar takes it (§12.3). */
const LEG_ID = /^[a-z][a-z0-9-]{0,39}$/;

export const REPLAY_USAGE = `baton leg replay <repository>:<ticket> <leg> [--run <n> | --run-id <id>] [--against <sha>]
                [--accept-moved] [--home <dir>] [--url <url>] [-i KEY] [--env NAME]…
                [--report <file>] [--executor <source>] [--timeout-s <seconds>]
  re-run one recorded leg run without a claim; nothing is written to Baton (R-BTN-84). -i KEY is
  an owner's or an administrator's key, with which the run is read; --home is the home checkout
  whose git holds the course's scripts and the ticket's code (default: $BATON_HOME, else .);
  --env names one more variable the replay environment keeps (a model provider's key), beside
  PATH, LANG, TZ, TERM and an isolated HOME — nothing else of the runner's own reaches the leg.`;

export interface ReplayArgs {
  repository: string;
  ticket: string;
  leg: string;
  /** The run to replay by its number (`--run`), or `--run-id`; absent, the newest. */
  run?: number;
  runId?: string;
  /** `--against <sha>`: compare with a run of the scripts at that sha on the same inputs. */
  against?: string;
  /** `--accept-moved`: replay a current source whose content moved, deliberately. */
  acceptMoved: boolean;
  home: string;
  url: string;
  /** `-i KEY`: the owner's or administrator's key the run is read with. */
  key: string;
  /** `--env NAME`: one more name the replay environment keeps. */
  envNames: string[];
  /** `--report <file>`: where the masked report lands (default: ./baton-replay-<ticket>-<leg>-<run>.json). */
  report?: string;
  /** R-BTN-107 (B-184): the executor source the host chose. */
  executor: string;
  timeoutS: number;
}

/** Pure: the flags, unknown ones refused (never dropped), `--` never taken. */
export function parseReplayArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ReplayArgs {
  const out: Omit<ReplayArgs, 'repository' | 'ticket' | 'leg' | 'key'> & { key?: string } = {
    acceptMoved: false,
    home: env.BATON_HOME ?? process.cwd(),
    url: env.BATON_URL ?? DEFAULT_URL,
    envNames: [],
    executor: env.BATON_EXECUTOR ?? 'builtin',
    timeoutS: REPLAY_TIMEOUT_S,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--run') {
      if (out.run != null) throw new Error('--run is given once');
      const v = Number(value());
      if (!Number.isInteger(v) || v < 1) throw new Error('--run must be a run number of at least 1');
      out.run = v;
    } else if (a === '--run-id') {
      if (out.runId != null) throw new Error('--run-id is given once');
      out.runId = value();
    } else if (a === '--against') out.against = value();
    else if (a === '--accept-moved') out.acceptMoved = true;
    else if (a === '--home') out.home = value();
    else if (a === '--url') out.url = value();
    else if (a === '-i' || a === '--identity') out.key = value();
    else if (a === '--env') out.envNames.push(value());
    else if (a === '--report') out.report = value();
    else if (a === '--executor') out.executor = value();
    else if (a === '--timeout-s') {
      const v = Number(value());
      if (!Number.isInteger(v) || v < 1) throw new Error('--timeout-s must be a positive number of seconds');
      out.timeoutS = v;
    } else if (a === '--help' || a === '-h') throw new Error(REPLAY_USAGE);
    else if (a.startsWith('-')) throw new Error(`${a} is not a flag of \`baton leg replay\` (see --help)`);
    else positional.push(a);
  }
  if (out.run != null && out.runId != null) throw new Error('--run and --run-id name one run; give one');
  const q = QUALIFIED.exec(positional[0] ?? '');
  if (!q) throw new Error('the ticket is <repository>:<id>');
  if (positional.length !== 2) throw new Error('baton leg replay takes <repository>:<ticket> <leg>');
  if (!LEG_ID.test(positional[1])) throw new Error('the leg is a leg id of the ticket\'s course');
  if (out.key == null) throw new Error('-i KEY (an owner\'s or an administrator\'s key the run is read with)');
  return { repository: q[1], ticket: q[2], leg: positional[1], key: out.key, ...out, envNames: [...new Set(out.envNames)] };
}

/** One run as the runs read carries it (§14's, with what replay needs beside it). */
export interface RecordedRun {
  run: number;
  run_id?: string;
  claim: number;
  runner?: number;
  from?: string;
  started_at: number;
  ended_at?: number | null;
  end?: string | null;
  snapshot_sha: string;
  head_sha?: string | null;
  course?: string | null;
  course_version?: number | null;
  ticket?: { version?: string; read_digest?: string };
  inputs: { name: string; from_leg?: string; from_run?: number; uri?: string; digest?: string; value?: unknown; leg_version?: number }[];
}

/** Pure: which run the flags name — `--run` its number, `--run-id` its id, absent the newest
 *  (the list is oldest first). */
export function pickRun(runs: RecordedRun[], want: { run?: number; runId?: string }): { run: RecordedRun; why: string } | { run: null; why: string } {
  if (!runs.length) return { run: null, why: 'the leg has no recorded runs' };
  if (want.run != null) {
    const r = runs.find((x) => x.run === want.run);
    return r ? { run: r, why: `run ${r.run} of ${runs.length}` } : { run: null, why: `no run ${want.run} is recorded (the leg has ${runs.length}, newest ${runs[runs.length - 1].run})` };
  }
  if (want.runId != null) {
    const r = runs.find((x) => x.run_id === want.runId);
    return r ? { run: r, why: `run ${r.run}, by its id ${want.runId}` } : { run: null, why: `no run with id ${want.runId} is recorded` };
  }
  const r = runs[runs.length - 1];
  return { run: r, why: `the newest, run ${r.run} of ${runs.length}` };
}

/** Pure: R-BTN-144's replay environment, from the allowlist — `PATH`, `LANG`, `TZ`, `TERM`, an
 *  isolated `HOME` (the caller's), every `--env` name, and the names `runner.json` `replay_env`
 *  lists — nothing else of the runner's own environment, so no write-capable git or forge
 *  credential, ssh-agent or credential helper reaches the replayed leg (R-BTN-144). */
export function replayEnvironment(env: NodeJS.ProcessEnv, o: { home: string; envNames?: string[]; replayEnv?: string[] }): Record<string, string> {
  const out: Record<string, string> = { HOME: o.home };
  for (const name of ['PATH', 'LANG', 'TZ', 'TERM']) {
    const v = env[name];
    if (typeof v === 'string' && v !== '') out[name] = v;
  }
  for (const name of [...(o.replayEnv ?? []), ...(o.envNames ?? [])]) {
    const v = env[name];
    if (typeof v === 'string' && v !== '') out[name] = v;
  }
  // The one marker of its own: the leg may read that it is a replay, never a claim's run.
  out.BATON_REPLAY = '1';
  return out;
}

/** What the version check found: the two readings, and why they differ when they do. */
export interface ReadComparison {
  how: 'pinned' | 'current' | 'none';
  ok: boolean;
  why?: string;
  recorded_version?: string;
  read_version?: string;
  recorded_digest?: string;
  read_digest?: string;
}

/** Pure: the version check's comparison (R-BTN-84) — a `current` source read now whose version
 *  or read digest differs from the recorded one is a mismatch; a `pinned` source is read at its
 *  version, so the digest agreeing is the whole check (its version names the bytes themselves). */
export function compareRead(
  recorded: { version?: string; read_digest?: string } | undefined,
  read: { version?: string; digest?: string } | null,
  how: 'pinned' | 'current',
): ReadComparison {
  if (recorded?.version == null || recorded.read_digest == null) {
    return { how, ok: false, why: 'the run recorded no ticket version — the check has nothing to stand on (a source that declared no way of reading, or a Baton before it recorded one)' };
  }
  const base: ReadComparison = { how, ok: true, recorded_version: recorded.version, recorded_digest: recorded.read_digest };
  if (read == null) return { ...base, ok: false, why: 'the source no longer reads the ticket' };
  if (read.version !== recorded.version) {
    return { ...base, ok: false, why: `the ticket's version is ${read.version || '(none)'}, the run's ${recorded.version}`, read_version: read.version };
  }
  if (read.digest !== recorded.read_digest) {
    return { ...base, ok: false, why: 'the ticket\'s content moved under the same version (the read digest differs)', read_version: read.version, read_digest: read.digest };
  }
  return { ...base, read_version: read.version, read_digest: read.digest };
}

/** A remote's `<owner>/<name>` as a `git:` pointer spells it, whatever the URL's shape. */
export function slugOf(url: string): string {
  return url.trim().replace(/\.git$/, '').replace(/^.*[:/]([^/:]+\/[^/:]+)$/, '$1').toLowerCase();
}

/** The wrapper's outcome: stdout's last line (R-BTN-133), as the runner reads it. */
function wrapperOutcome(stdout: string): { ok: boolean; result?: unknown; error?: string } | null {
  const last = stdout.trimEnd().split('\n').at(-1) ?? '';
  try {
    const out = JSON.parse(last) as { ok?: unknown };
    return out && typeof out === 'object' && typeof out.ok === 'boolean' ? out as { ok: boolean } : null;
  } catch {
    return null;
  }
}

const sha256 = (bytes: Buffer | string): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** One git command's bytes as a Buffer (a path's bytes at a commit are not text). */
function gitBytes(home: string, args: string[]): Buffer | null {
  try {
    return execFileSync('git', ['-C', home, ...args], { encoding: 'buffer', maxBuffer: 16 << 20, timeout: 30_000, killSignal: 'SIGKILL' }) as Buffer;
  } catch {
    return null;
  }
}

export interface ReplayIo {
  log?: (line: string) => void;
  /** The transport the one Baton read goes through; production `fetch`. */
  transport?: (req: Request) => Promise<Response>;
  env?: NodeJS.ProcessEnv;
  /** The one bounded fetch R-BTN-143 makes into the runner's own ref (a test stands in). */
  fetch?: (home: string, branch: string, ref: string) => void;
}

/** `baton leg replay`'s entry: everything below `parseReplayArgs`, returning the process's exit
 *  code — 0 the replay ran, 1 the replay was refused before the leg ran (no run, off-branch, an
 *  unsafe leg, a moved ticket, a tampered input) or the leg ran and failed, 2 a usage error
 *  (thrown, as the CLI prints it). The report is written either way, masked. */
export async function replayMain(argv: string[], io: ReplayIo = {}): Promise<number> {
  // `--help` answers the usage before any credential or network work (B-86's rule for the
  // runner's own flags).
  if (argv.includes('--help') || argv.includes('-h')) {
    (io.log ?? ((l: string) => process.stdout.write(`${l}\n`)))(REPLAY_USAGE);
    return 0;
  }
  const a = parseReplayArgs(argv, io.env ?? process.env);
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const say = (l: string) => log(`baton: ${l}`);
  const env = io.env ?? process.env;
  const ticketId = `${a.repository}:${a.ticket}`;
  const report: Record<string, unknown> = { ticket: ticketId, leg: a.leg, wrote_to_baton: false };
  const reportPath = a.report ?? `baton-replay-${a.ticket}-${a.leg}-${a.run ?? a.runId ?? 'newest'}.json`;
  const refuse = (why: string, secrets: readonly string[] = []): number => {
    report.refused = why;
    writeReport(reportPath, report, secrets);
    say(`replay refused: ${why}`);
    return 1;
  };

  // 1. The run's record, read with the owner's or administrator's key (§14).
  const read = await readRuns(a, io);
  report.runs_recorded = read.runs.length;
  const picked = pickRun(read.runs, { run: a.run, runId: a.runId });
  if (picked.run == null) return refuse(`${picked.why} (GET the leg's runs for what is)`);
  const run = picked.run;
  say(`replaying ${ticketId}'s ${a.leg} run ${run.run}${run.run_id ? ` (${run.run_id})` : ''} — claim ${run.claim}, snapshot ${run.snapshot_sha.slice(0, 10)} — ${picked.why}`);
  Object.assign(report, {
    run: run.run, run_id: run.run_id ?? null, claim: run.claim,
    recorded: { snapshot_sha: run.snapshot_sha, head_sha: run.head_sha ?? null, course: run.course ?? null, course_version: run.course_version ?? null, started_at: run.started_at },
  });

  // 2. R-BTN-143: the recorded snapshot must be code the default branch holds — the runner's
  //    own ref of the registered default branch, one bounded fetch into it, `--against` excepted.
  const branch = read.default_branch ?? null;
  if (branch == null) return refuse('Baton names no default branch for the repository — the snapshot cannot be checked against one (R-BTN-143)');
  const ref = `refs/baton/${a.repository}/default`;
  const onBranch = (sha: string): boolean => {
    try {
      git(a.home, ['merge-base', '--is-ancestor', sha, ref]);
      return true;
    } catch {
      return false;
    }
  };
  if (!onBranch(run.snapshot_sha)) {
    say(`the snapshot is not (yet) an ancestor of ${ref} — one bounded fetch of ${branch} into it (R-BTN-143)`);
    (io.fetch ?? ((home, b, r) => {
      try {
        git(home, ['fetch', 'origin', `+refs/heads/${b}:${r}`]);
      } catch { /* said below, by the check's own failure */ }
    }))(a.home, branch, ref);
    if (!onBranch(run.snapshot_sha)) {
      return refuse(`the recorded snapshot ${run.snapshot_sha.slice(0, 10)} is not code the default branch ${branch} holds (R-BTN-143) — its ref was fetched once and still does not carry it`);
    }
  }

  // 3. The course's scripts at the snapshot, and the leg's own safety marker.
  let course: CourseLoad;
  try {
    course = loadCourse(a.home, run.snapshot_sha, run.course ?? courseAt(a.home, run.snapshot_sha));
  } catch (e) {
    return refuse(`the course's scripts would not load at the snapshot (${msg(e)})`);
  }
  const script = course.scripts.get(a.leg) ?? null;
  if (script == null) {
    dropCourse(course.scratch);
    return refuse(`the snapshot's course has no legs/${a.leg}.mjs`);
  }
  if (course.graph.legs.get(a.leg)?.replaySafe === false) {
    dropCourse(course.scratch);
    return refuse(`${a.leg} is marked "replay_safe": false — it has side effects outside git and its forge, and is never replayed (R-BTN-84)`);
  }
  report.course = { course: course.course, at: run.snapshot_sha };

  // The replay environment, before any repository code runs (R-BTN-144): the allowlist, and a
  // masking set computed from it — the report and every logged line leave masked.
  const config = readRunnerJson(env);
  const maskEnv = config?.mask_env ?? [];
  const scratchHome = mkdtempSync(join(tmpdir(), 'baton-replay-home-'));
  const replayEnv = replayEnvironment(env, { home: scratchHome, envNames: a.envNames, replayEnv: config?.replay_env ?? [] });
  const secrets = secretValues(replayEnv, maskEnv);
  try {
    // 4. The version check: the ticket read the way the run read it — the source at the RECORDED
    //    snapshot, through the executor like any repository code (R-BTN-107).
    const executor = await loadExecutor(a.executor, { log: say, wrapper: LEG_PROCESS, node: process.execPath });
    const sourceFile = extractTicketSource(a.home, run.snapshot_sha, course.scratch);
    const versionCheck = await readTicket(executor, replayEnv, { file: sourceFile, home: a.home, id: bareTicketId({ id: ticketId }), recorded: run.ticket, scratch: course.scratch });
    report.version_check = versionCheck;
    if (!versionCheck.ok && versionCheck.how !== 'none' && !a.acceptMoved) {
      return refuse(`the ticket moved since the run — ${versionCheck.why}; re-run deliberately with --accept-moved (R-BTN-84)`, secrets);
    }
    if (!versionCheck.ok && versionCheck.how !== 'none' && a.acceptMoved) {
      report.accepted_moved = true;
      say('the ticket\'s content moved since the run — replaying against the new content (--accept-moved); the report says so');
    }

    // 5. The inputs, fetched read-only and checked by digest (R-BTN-82, R-BTN-140).
    const inputs: Record<string, unknown>[] = [];
    let tampered = false;
    for (const input of run.inputs) {
      const checked = await checkInput(a.home, input);
      inputs.push({ name: input.name, ...(input.uri ? { uri: input.uri } : {}), ...(input.digest ? { digest: input.digest } : {}), ...checked });
      if (!checked.ok) tampered = true;
    }
    report.inputs = inputs;
    if (tampered) return refuse('a recorded input failed its digest (R-BTN-84) — nothing was replayed against it', secrets);

    // 6. The ticket's code at the recorded head — a scratch worktree of the home checkout, so
    //    the leg's writes land nowhere the runner works and the report reads them as would-be.
    const checkoutSha = worktreeSha(a.home, run, say);
    report.checked_out_at = checkoutSha;
    if (checkoutSha !== (run.head_sha ?? run.snapshot_sha)) report.checkout_note = 'the recorded head is not in the checkout — the run replays at the snapshot';
    const worktree = join(mkdtempSync(join(tmpdir(), 'baton-replay-')), 'checkout');
    git(a.home, ['worktree', 'add', '--detach', '--quiet', worktree, checkoutSha]);
    try {
      const ran = await runOnce(executor, replayEnv, { repository: a.repository, home: a.home, worktree, script, run, ticketId, leg: a.leg, secrets, timeoutS: a.timeoutS, say });
      report.ran = ran.outcome;
      report.would_have_written = ran.writes;
      report.close = 'not called (R-BTN-84): the runner records what it would have written, and writes nothing';

      // 7. `--against <sha>`: the same inputs through the scripts at that sha (R-BTN-143 does
      //    not bind the flag's sha), compared with the recorded run's.
      if (a.against != null) {
        const againstCourse = loadCourse(a.home, a.against, course.course);
        const againstScript = againstCourse.scripts.get(a.leg) ?? null;
        if (againstScript == null) {
          dropCourse(againstCourse.scratch);
          return refuse(`the scripts at ${a.against.slice(0, 10)} have no legs/${a.leg}.mjs (--against)`, secrets);
        }
        const againstWorktree = join(mkdtempSync(join(tmpdir(), 'baton-replay-')), 'checkout');
        git(a.home, ['worktree', 'add', '--detach', '--quiet', againstWorktree, checkoutSha]);
        try {
          const other = await runOnce(executor, replayEnv, { repository: a.repository, home: a.home, worktree: againstWorktree, script: againstScript, run, ticketId, leg: a.leg, secrets, timeoutS: a.timeoutS, say, against: a.against });
          report.against = {
            sha: a.against, ran: other.outcome, would_have_written: other.writes,
            same: JSON.stringify(other.outcome) === JSON.stringify(ran.outcome) && JSON.stringify(other.writes) === JSON.stringify(ran.writes),
          };
        } finally {
          try { git(a.home, ['worktree', 'remove', '--force', againstWorktree]); } catch { /* already gone */ }
          dropCourse(againstCourse.scratch);
        }
      }
      writeReport(reportPath, report, secrets);
      const ok = (report.ran as { ok?: boolean }).ok === true;
      say(`replay of ${ticketId}'s ${a.leg} run ${run.run} ${ok ? 'ran' : 'failed'}; the masked report is ${reportPath}`
        + (a.against != null ? ` (--against ${a.against.slice(0, 10)}: ${(report.against as { same: boolean }).same ? 'the same result' : 'a different result'})` : ''));
      return ok ? 0 : 1;
    } finally {
      try { git(a.home, ['worktree', 'remove', '--force', worktree]); } catch { /* already gone */ }
    }
  } finally {
    dropCourse(course.scratch);
    rmSync(scratchHome, { recursive: true, force: true });
  }
}

/** The run's record and the repository's default branch, read with the caller's key (§14). */
async function readRuns(a: ReplayArgs, io: ReplayIo): Promise<{ runs: RecordedRun[]; default_branch?: string }> {
  const path = `/v1/repositories/${encodeURIComponent(a.repository)}/tickets/${encodeURIComponent(a.ticket)}/legs/${encodeURIComponent(a.leg)}/runs`;
  const target = new URL(path, a.url).toString();
  const cred = requestCredential(a.key);
  const headers = cred.bearer ? { Authorization: `Bearer ${cred.bearer}` } : signHeaders({ method: 'GET', url: target, body: '', key: cred.key });
  const transport = io.transport ?? ((req) => fetch(req));
  const res = await transport(new Request(target, { method: 'GET', headers, signal: AbortSignal.timeout(30_000) }));
  const json = await res.json().catch(() => null) as { runs?: RecordedRun[]; default_branch?: string; message?: string } | null;
  if (!res.ok) throw new Error(`reading the leg's runs failed (${res.status}: ${json?.message ?? 'no message'}) — the key must be an owner's or an administrator's (§14)`);
  return { runs: json?.runs ?? [], ...(json?.default_branch ? { default_branch: json.default_branch } : {}) };
}

/** The course id the snapshot's own settings name (§2c): one, else the refusal — the recorded
 *  run names which course it ran, and a replay never guesses. */
function courseAt(home: string, sha: string): string {
  const file = git(home, ['show', `${sha}:.baton/baton.json`]);
  const parsed = JSON.parse(file) as { courses?: { id?: unknown }[] };
  const ids = (parsed.courses ?? []).map((c) => c.id).filter((id): id is string => typeof id === 'string');
  if (ids.length === 1) return ids[0];
  throw new Error(`the snapshot names ${ids.length} courses (${ids.join(', ') || 'none'}) — the run's record names which (§14), and does not here`);
}

/** Read the ticket as the run read it: the source at the RECORDED snapshot (else the CLI's
 *  markdown default, in-process — CLI code, never repository code), `pinned` at the recorded
 *  version, `current` as its store holds the ticket now — the same read the runner verified the
 *  claim by (§4.5), whose digest the run recorded. */
async function readTicket(executor: Executor, env: Record<string, string>, o: { file: string | null; home: string; id: string; recorded: { version?: string; read_digest?: string } | undefined; scratch: string }): Promise<ReadComparison> {
  if (o.recorded == null || o.recorded.version == null) {
    return { how: 'none', ok: false, why: 'the run recorded no ticket version — the check has nothing to stand on' };
  }
  if (o.file == null) {
    const read = await MARKDOWN_SOURCE.read(o.id, { version: o.recorded.version, checkout: o.home });
    return compareRead(o.recorded, read.ticket == null ? null : { version: read.version, digest: digestOfRead(read.ticket) }, MARKDOWN_SOURCE.versions);
  }
  let handle: Handle;
  try {
    handle = await executor.start({ brief: { kind: 'source', session_id: `replay-source-${Math.random().toString(16).slice(2, 8)}`, paths: [o.scratch], checkout: o.home, wrapper: LEG_PROCESS, env } });
  } catch (e) {
    return { how: 'current', ok: false, why: `the executor could not start the ticket source's session (${msg(e)})` };
  }
  try {
    const call = async (fn: string, args: unknown[]): Promise<unknown> => {
      const r = await executor.exec(handle, ['node', LEG_PROCESS, fn, o.file!], { cwd: o.home, stdin: `${JSON.stringify(args)}\n`, timeout_s: 120, env }).result;
      const out = wrapperOutcome(r.stdout);
      if (out == null) throw new Error(`the ticket source's ${fn} wrote no outcome`);
      if (!out.ok) throw new Error(out.error ?? `the ticket source's ${fn} failed`);
      return out.result;
    };
    const described = (await call('describe', [])) as { versions?: string | null; read?: boolean };
    if (typeof described.versions !== 'string' || !['pinned', 'current'].includes(described.versions)) {
      return { how: 'none', ok: false, why: 'the source at the snapshot declares no way of reading — the check has nothing to stand on' };
    }
    const how = described.versions as 'pinned' | 'current';
    if (!described.read) return { how, ok: false, why: 'the source declares versions but exports no read (R-BTN-74)' };
    const args = how === 'pinned' ? [o.id, { version: o.recorded.version, checkout: o.home }] : [o.id, { checkout: o.home }];
    const read = (await call('read', args)) as { version?: unknown; ticket?: unknown } | null;
    return compareRead(o.recorded, read == null ? null : { version: typeof read.version === 'string' ? read.version : undefined, digest: digestOfRead(read.ticket) }, how);
  } catch (e) {
    return { how: 'current', ok: false, why: `the ticket source's read failed (${msg(e)})` };
  } finally {
    await executor.stop(handle, 'replay-source-read').catch(() => {});
  }
}

/** One recorded input, fetched read-only and checked by digest (R-BTN-82, R-BTN-140): an inline
 *  value is its own bytes (no digest to check, R-BTN-108), a `git:` pointer of the home
 *  repository from the checkout's object store, an `https://` pointer with no credential. What
 *  replay cannot fetch it names, never skips. */
async function checkInput(home: string, input: { name: string; uri?: string; digest?: string; value?: unknown }): Promise<{ ok: boolean; why?: string }> {
  if (input.value !== undefined) return { ok: true };
  const uri = input.uri ?? '';
  const named = (why: string): { ok: boolean; why: string } => ({ ok: false, why });
  if (input.digest == null) {
    return uri === '' ? named('the input records neither a pointer nor a value') : { ok: true, why: 'content-addressed by its pointer; no digest recorded to check' };
  }
  const digest = input.digest;
  let bytes: Buffer | null = null;
  let why = '';
  if (uri.startsWith('https://')) {
    try {
      const res = await fetch(uri, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        why = `the pointer answered ${res.status}`;
      } else {
        bytes = Buffer.from(await res.arrayBuffer());
      }
    } catch (e) {
      why = `the pointer could not be fetched read-only (${msg(e)})`;
    }
  } else {
    // The pointer shapes §5.5 names: a path at a commit, or a blob by its id (either sha
    // length — the validator takes a sha1 or sha256 repository's).
    const at = /^git:([^@]+)@([0-9a-f]{40,64}):(.+)$/.exec(uri);
    const blob = /^git:([^#]+)#blob=([0-9a-f]{40,64})$/.exec(uri);
    if (at != null || blob != null) {
      const repo = (at ?? blob)![1];
      const sha = at != null ? at[2] : blob![2];
      const path = at != null ? at[3] : '';
      let mine = '';
      try {
        // `git config remote.origin.url`, not `git remote get-url`: the config value is the
        // repository's own spelling (what a `git:` pointer names); get-url expands an
        // `insteadOf` rewrite, which is this checkout's local plumbing, not its identity.
        mine = slugOf(git(home, ['config', 'remote.origin.url']).trim());
      } catch {
        mine = '';
      }
      if (mine !== slugOf(repo)) {
        why = `${uri} names ${slugOf(repo)}, not the home checkout (${mine || 'none named'}) — replay fetches no other repository`;
      } else {
        bytes = path === '' ? gitBytes(home, ['cat-file', 'blob', sha]) : gitBytes(home, ['show', `${sha}:${path}`]);
        if (bytes == null) why = `the pointer's bytes are not in the checkout (${sha.slice(0, 10)})`;
      }
    } else {
      why = `replay cannot fetch ${uri || '(no uri)'}: a git: pointer of the home repository, an https:// one, or an inline value`;
    }
  }
  if (bytes == null) return named(why || 'the input could not be fetched');
  if (sha256(bytes) !== digest) return named(`the fetched bytes digest to ${sha256(bytes).slice(0, 17)}…, the recorded ${digest.slice(0, 17)}… — a substitution, not the run's input`);
  return { ok: true };
}

/** Where the leg runs: the recorded head when the checkout holds it, else the snapshot — said
 *  either way in the report, never silently. */
function worktreeSha(home: string, run: RecordedRun, say: (l: string) => void): string {
  const head = run.head_sha ?? null;
  if (head != null && gitBytes(home, ['cat-file', '-e', `${head}^{commit}`]) != null) return head;
  if (head != null) say(`the recorded head ${head.slice(0, 10)} is not in the checkout — replaying at the snapshot instead`);
  return run.snapshot_sha;
}

/** One run of the script, through the executor's `exec` in a `leg` session (R-BTN-107), with
 *  `ctx.replay` set (R-BTN-84): the recorded facts as the run held them, the worktree as its
 *  checkout, no close. Its would-be writes are the worktree's changes. */
async function runOnce(executor: Executor, env: Record<string, string>, o: {
  repository: string; home: string; worktree: string; script: string; run: RecordedRun; ticketId: string; leg: string;
  secrets: readonly string[]; timeoutS: number; say: (l: string) => void; against?: string;
}): Promise<{ outcome: { ok: boolean; result?: unknown; error?: string }; writes: string[] }> {
  const sessionId = `${o.run.run_id ?? `claim-${o.run.claim}`}.replay`;
  let handle: Handle;
  try {
    handle = await executor.start({
      brief: {
        kind: 'leg', session_id: sessionId, ...(o.run.run_id ? { run_id: o.run.run_id } : {}), ticket: o.ticketId, leg: o.leg,
        snapshot_sha: o.run.snapshot_sha, checkout: o.worktree, paths: [dirname(o.script)], wrapper: LEG_PROCESS, env,
      },
    });
  } catch (e) {
    return { outcome: { ok: false, error: `the executor could not start the leg's session (${msg(e)})` }, writes: [] };
  }
  const ctx = {
    replay: {
      recorded: { run: o.run.run, run_id: o.run.run_id ?? null, claim: o.run.claim, started_at: o.run.started_at, snapshot_sha: o.run.snapshot_sha, head_sha: o.run.head_sha ?? null, inputs: o.run.inputs },
      ...(o.against ? { against: o.against } : {}),
    },
    ticket: { id: o.ticketId, home: o.repository, ...(o.run.ticket?.version ? { version: o.run.ticket.version } : {}) },
    claim: { id: o.run.claim, nonce: null, station: o.run.from ?? null },
    leg: o.leg, run: o.run.run, ...(o.run.run_id ? { run_id: o.run.run_id } : {}),
    snapshot: { sha: o.run.snapshot_sha, path: [], next: [] },
    checkout: o.worktree, session: sessionId,
  };
  try {
    const exit = await executor.exec(handle, ['node', LEG_PROCESS, 'run', o.script], {
      cwd: o.worktree, stdin: `${JSON.stringify([ctx])}\n`, timeout_s: o.timeoutS, env,
      onStderr: (line) => o.say(maskLegOutput(line, o.secrets)),
    }).result;
    const out = wrapperOutcome(exit.stdout);
    const outcome = out == null
      ? { ok: false, error: maskLegOutput(`the leg wrote no result (exit ${exit.status ?? '?'}${exit.stderr ? `: ${exit.stderr.trim().split('\n').at(-1) ?? ''}` : ''})`, o.secrets) }
      : out.ok
        ? { ok: true, result: out.result }
        : { ok: false, error: maskLegOutput(out.error ?? 'the leg script failed', o.secrets) };
    return { outcome, writes: changes(o.worktree) };
  } finally {
    await executor.stop(handle, 'replay-run').catch(() => {});
  }
}

/** A worktree's changes — what the leg would have written had it run under a claim (R-BTN-84). */
function changes(dir: string): string[] {
  try {
    return git(dir, ['status', '--porcelain']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** The masked report, written once, at the end whatever the end was (R-BTN-144). */
function writeReport(path: string, report: Record<string, unknown>, secrets: readonly string[]): void {
  writeFileSync(path, maskLegOutput(`${JSON.stringify(report, null, 2)}\n`, secrets));
}

/** `runner.json` as replay reads it (§5.6): `replay_env` for the environment's allowlist,
 *  `mask_env` for the report's set — validated by `readMaskEnv`, whose refusal a replay shares
 *  (an operator who asked for masking by name gets the refusal, not silence). Null when there is
 *  no file. (`replay_clone_credential` is read for completeness; a clone replay runs without is
 *  the honest default, the home checkout already holding the code.) */
function readRunnerJson(env: NodeJS.ProcessEnv): { mask_env?: string[]; replay_env?: string[] } | null {
  const path = runnerConfigPath(env);
  const mask = readMaskEnv(path); // throws for a mask_env that cannot be read
  let config: unknown = null;
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return mask == null ? null : { mask_env: mask };
  }
  const c = (config && typeof config === 'object' && !Array.isArray(config) ? config : {}) as { replay_env?: unknown };
  if (c.replay_env === undefined) return mask == null ? null : { mask_env: mask };
  if (!Array.isArray(c.replay_env) || !c.replay_env.every((n) => typeof n === 'string' && n.trim() !== '')) {
    throw new Error(`${path}: replay_env must be a list of environment variable names (R-BTN-144)`);
  }
  return { ...(mask != null ? { mask_env: mask } : {}), replay_env: c.replay_env as string[] };
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
