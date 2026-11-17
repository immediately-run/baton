// runner.ts — `baton run`'s generic worker loop (BATON_SPEC §6.13 R-BTN-72): it heartbeats (it
// hosts the sidecar of §6.3–6.4), claims, loads the claim's course file and leg scripts from the
// home checkout at the claim's `snapshot_sha` (R-BTN-34), and runs each leg as a child process
// that gets `BATON_PARENT` and `BATON_STATE` and an AbortSignal. It knows no course: the
// graph and the scripts decide, every result is validated against the snapshot's file, the
// finished leg's `close` writes the closing marker before anything is reported (R-BTN-83), and
// its `handoff` runs before any suspension or release (R-BTN-44). A lost lease aborts the leg at
// once and kills its process group with no hand-off (the resume record covers it, R-BTN-24); a
// release message, a releasing owner bar, a regressed path or a course change stop the leg at its
// next safe point first.
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { batonNow } from '../shared/baton.mjs';
import { capabilitiesOf } from '../shared/vocabulary.mjs';
import { verifySignedCommit, nodeKeygen } from '../shared/commitSign.mjs';
import { controlGroupsOf, groupUnchangedAt } from '../defaults/signed-control';
import { checkRaise, dispositionOf, errorClassOf, SEVERITIES, type ConditionDeclaration } from '../core/conditionTypes';
import type { ScopeAction } from '../core/scope';
import { BatonApi, BatonRefusal } from './api';
import { outsideScope, pushesBetween, readRefState, type RefState } from './audit';
import { advanceHome, claimScratch, courseOf, dropCourse, ensureSha, extractTicketSource, freshSecret, git, loadCourse, prepareClone, readHead, type CourseLoad } from './home';
import { builtinExecutor, type Executor, type Handle, type Running, type SessionKind } from './executor';
import { LegChannel, channelPath, type ChannelAnswer, type ChannelRequest } from './channel';
import { MIN_SECRET_BYTES, createLegMasker, failureDetail, maskLegOutput, namesASecret, secretValues } from './mask';
import { decide, refusalKind, runNumber, shortWaitSpent, waitState } from './protocol';
import { StateFile, leaseLostFrom, type PersistedClaim, type RunnerState } from './state';
import { bareTicketId } from '../defaults/ticket-state';
import { digestOfRead, MARKDOWN_SOURCE } from '../defaults/ticket-versions';

const LEG_PROCESS = fileURLToPath(new URL('./legProcess.mjs', import.meta.url));

/** §6.3: the sidecar's cadence — every beat 2 minutes. */
export const BEAT_MS = 2 * 60_000;
/** B-234 (R-BTN-195, R-BTN-145): the default grace a released leg gets to take its safe point
 * and exit by itself before its still-running session is treated as joinable-and-stuck — the
 * stop ladder's own bound. */
export const SIGNAL_GRACE_MS = 30_000;
/** B-86: how many beats one claim attempt spends making the server's record of the declaration
 *  match the list the claim will carry — one for a fresh or legacy runner, one for the change it
 *  settles (review round 4, finding 4). */
const MAX_STALE_BEATS = 2;
/** What one leg's snapshot shows of the legs leaving the claim's station (R-BTN-70). */
type NextLegs = { leg: string; state: string; waiting_on?: string }[];

export interface RunnerOptions {
  api: BatonApi;
  /** B-229: a separate API for another session's worker, by its secret — how a runner that
   *  starts ends the claims its host's earlier sessions left (their state files, beside this
   *  one). Separate, so this runner's own beats never carry the other's secret. Absent: none. */
  apiFor?: (secret: string) => BatonApi;
  /** The home repository's checkout, whose git the course and the scripts come from. */
  home: string;
  /** The Baton repository id that checkout is (the heartbeat's courses are declared for it). */
  repository: string;
  /** The worker's hostname — the credential's registered name (§6.4). */
  hostname: string;
  harness: 'opencode' | 'claude-code';
  session: string;
  /** B-86: what the heartbeat declares — `--capabilities`, which narrows. Absent, the runner asks
   *  once (a beat declaring nothing) and declares the grant the answer carries. */
  capabilities?: string[];
  /** B-86: the rule 4 names the legs of the courses it serves require, read from the home checkout
   *  each time it is asked, so a runner whose declaration lacks one says so at startup. Injected by
   *  `baton run`; absent, no such line. B-103: every served course's legs, not one course's. */
  legNeeds?: () => Promise<string[]> | string[];
  tierCeiling?: string;
  /** The courses this runner serves and declares (B-103, rule 9): every course its home checkout
   *  declares, or the one `--course` narrowed it to. The claim it takes names the ticket's course
   *  (`course_id`), which `runClaim` loads from the claim's snapshot — so one runner, one checkout,
   *  serves several courses, one leg at a time (rule 3). */
  courses: { course: string; version: number }[];
  stateFile: string;
  beatEvery?: number;
  now?: () => number;
  log?: (line: string) => void;
  /** One bounded `git fetch` when the snapshot sha is missing (R-BTN-34). */
  fetch?: (home: string) => void;
  /** B-83: the harness command `--harness` chose, handed to the legs as BATON_AGENT_COMMAND —
   * what runs an agent leg when the snapshot's settings name no `agent_command`. */
  agentCommand?: string;
  /** R-BTN-107 (B-184): the executor the runner's host chose — `builtin` when absent. */
  executor?: Executor;
  /** Verbose (the owner, 2026-10-23): timestamp every line, name the claim's id and nonce,
   * log the leg's local command, and drain the leg child's stderr into the log — where the
   * stub reports the agent_command it resolved. A slice of B-23's leg observability. */
  verbose?: boolean;
  /** B-83: a test harness — declared on the heartbeat (R-BTN-32; Baton refuses it from any
   * credential but the test one). */
  testHarness?: boolean;
  /** B-106 (R-BTN-178): one machine's singleton — a capability mapped to a lock file. The
   *  capability is declared only while this process holds the file's exclusive lock; the lock is
   *  taken before a claim for, or the advance into, a leg requiring it and held until the claim
   *  ends or a leg not requiring it starts. Absent, no lock governs anything. */
  locks?: Record<string, string>;
  /** B-253 (R-BTN-72): the runner's own opaque statement, carried on every heartbeat as
   *  `profile` — `baton run` puts its CLI's pinning under `cli`. Absent (a caller that is not
   *  the CLI), the heartbeat sends none. */
  profile?: Record<string, unknown>;
  /** B-134: one read of the home checkout's remote refs — the runner's evidence for its leg-end
   *  scope audit. The default reads it with the runner's bounded git; a test replaces it. A read
   *  that fails skips the audit (logged), never the leg. */
  auditRefs?: (home: string) => RefState | null;
  /** R-BTN-144 class 7 (B-170): the names `runner.json` `mask_env` lists, which are masked
   *  besides the names that say a secret by their ending. `baton run` reads them before the
   *  loop; absent (a caller that is not the CLI), none are named. */
  maskEnv?: string[];
  /** B-234 (R-BTN-195, R-BTN-145): how long a released leg gets to take its safe point and exit
   *  by itself before its still-running session is treated as joinable-and-stuck — killed,
   *  stopped, the claim ended with the signal's reason. The default is the stop ladder's own
   *  bound (R-BTN-145's 30 s); a test narrows it. */
  signalGraceMs?: number;
  /** R-BTN-4, R-BTN-72 (B-188): how many claims this runner holds at once — `--concurrency`,
   *  1 to 32, default 1 (one claim, in the home checkout, exactly as before). Declared on every
   *  heartbeat; Baton bounds it by the grant's `max_claims`. */
  concurrency?: number;
  /** B-188: where a runner holding several claims keeps its clones, one per claim it may hold
   *  (`<dir>/<n>`). Absent: beside the state file, keyed by the home's path. */
  clonesDir?: string;
}

/** R-BTN-72 (B-188): a reattached leg — where it stands, and the live handle of its session. */
interface Resume {
  leg: string;
  at: string;
  runId: string | null;
  seq: number | null;
  ctx: Record<string, unknown>;
  handle: Handle;
}

/** The leg call in flight: its executor call, through which an abort line or a kill reaches it. */
interface LegChild {
  running: Running;
}

/** The outcome a wrapper call printed on its last stdout line (R-BTN-133). */
function wrapperOutcome(stdout: string): { ok: boolean; result?: unknown; error?: string; aborted?: string | null } | null {
  const last = stdout.trimEnd().split('\n').at(-1) ?? '';
  try {
    const out = JSON.parse(last) as { ok?: unknown };
    return out && typeof out === 'object' && typeof out.ok === 'boolean' ? out as { ok: boolean } : null;
  } catch {
    return null;
  }
}

/** The watcher a held lock runs: prints one line the moment the lock is its own, then polls the
 *  runner's pid and exits when it is gone — the lock dies with the runner within a second, even
 *  a SIGKILL (round 1, finding 3; the test guards exactly this contract). */
export const LOCK_WATCHER = 'echo baton:held; while kill -0 "$1" 2>/dev/null; do sleep 1; done';
/** The watcher's argv tail as `MachineLocks` spawns it (the name the watcher runs under, and the
 *  runner's pid it watches). */
export const lockWatcherArgv = (pid: number): string[] => ['sh', '-c', LOCK_WATCHER, 'baton-lock-watch', String(pid)];

/** B-106 (R-BTN-178): one machine's singleton is the runner's own business, never Baton's. A
 *  configured capability is declared only while this process holds an exclusive lock on its file:
 *  util-linux `flock --nonblock` over a watcher this process keeps alive. The watcher prints one
 *  line once the lock is held — a take is settled fact, not a spawn that may still fail — and
 *  polls this process's pid every second, exiting when it is gone: the lock dies with the runner
 *  within a second, SIGKILL included (review round 1, finding 3), and at once on `release`, which
 *  kills the watcher's process group. `flock` exit 1 is another process on this machine holding
 *  the lock. */
class MachineLocks {
  private readonly held = new Map<string, { child: ReturnType<typeof spawn>; path: string }>();
  private readonly busy = new Set<string>();
  constructor(private readonly paths: Record<string, string>, private readonly log: (line: string) => void) {}

  /** Whether `capability` is one this runner was given a lock file for. */
  manages(capability: string): boolean {
    return Object.hasOwn(this.paths, capability);
  }

  /** Whether the lock is held now. */
  holds(capability: string): boolean {
    return this.held.has(capability);
  }

  /** Try to take the lock without waiting. False when another process on this machine holds it,
   *  or no `flock` could run (said as such: a missing `flock` is not a busy lock); the line is
   *  said once per capability per stretch. */
  take(capability: string): Promise<boolean> {
    if (this.holds(capability)) return Promise.resolve(true);
    const path = this.paths[capability];
    if (path == null) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      let buf = '';
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch { /* an unwritable directory: the spawn below says it */ }
      const child = spawn('flock', ['--exclusive', '--nonblock', path, ...lockWatcherArgv(process.pid)],
        { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
      const done = (ok: boolean, missing = false) => {
        if (settled) return;
        settled = true;
        if (ok) {
          this.held.set(capability, { child, path });
          this.busy.delete(capability);
          this.log(`baton: took the lock of ${capability} (${path}) — held until its claim ends or a leg not requiring it starts (R-BTN-178)`);
        } else {
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
          if (!this.busy.has(capability)) {
            this.busy.add(capability);
            this.log(missing
              ? `baton: no \`flock\` on this machine to take ${capability}'s lock (${path}) — not declaring it, so no leg requiring it is offered here; install util-linux flock (macOS: \`brew install flock\`) (R-BTN-178)`
              : `baton: ${capability}'s lock (${path}) is held by another process on this machine — not declaring it, so no leg requiring it is offered here (R-BTN-178)`);
          }
        }
        resolve(ok);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => {
        buf += d;
        if (buf.includes('baton:held')) done(true);
      });
      child.on('error', (e: NodeJS.ErrnoException) => done(false, e.code === 'ENOENT'));
      child.on('close', () => done(false));
    });
  }

  /** Release one capability's lock. */
  release(capability: string): void {
    const h = this.held.get(capability);
    if (!h) return;
    this.held.delete(capability);
    try { process.kill(-h.child.pid!, 'SIGKILL'); } catch { /* already gone: the lock died with it */ }
  }

  /** Release every lock, or all but those `keep` names — the claim's end, or its next leg's set. */
  releaseAll(keep?: (capability: string) => boolean): void {
    for (const capability of [...this.held.keys()]) {
      if (!keep || !keep(capability)) this.release(capability);
    }
  }

  /** Take every configured lock not held (the idle maintenance of a beat): a lock free again is
   *  taken and declared, one still held elsewhere stays quiet. */
  async takeAll(): Promise<void> {
    await Promise.all(Object.keys(this.paths).map((c) => this.take(c)));
  }
}

/** How a leg ended for the runner's own accounting; the claim's end is `end_reason`. */
export interface ClaimOutcome {
  ticket: string;
  end_reason: string;
  reached: string | null;
  handoff: string | null;
}

/** B-86: what the heartbeat declares when `--capabilities` names nothing — exactly the set the
 *  answer carried, deduplicated, with `none` dropped (it says nothing, `vocabulary.mjs`). Every
 *  name in it is one the server answered: a grant is stored as the roles the owner named and the
 *  capabilities they stay as (admin.ts:423), and the heartbeat admits each name by the same
 *  logic that answered it — a role by its own name in a bearer or seed key's allow-list, a
 *  capability when its expansion is all granted (`credentialAllowed`, workerApi.ts). So a role
 *  the answer carries is declared as the role: rule 4 and the grant check both expand it
 *  gates-side (`capabilitiesOf`), which is why folding it into (or dropping it for) its
 *  capabilities could only lose names the server would have accepted (review round 4, finding 1).
 *  Exported for its test. */
export function declarationFrom(held: string[]): string[] {
  return [...new Set(held)].filter((n) => n !== 'none');
}

/** Why the sidecar asked the running leg to stop (§6.13's three signal reasons). `reason` is the
 * claim-level end it becomes; a regression names its station only when the leg settles, so it
 * carries none and the runner builds `suspended:<the leg's from>` then. */
interface PendingAbort {
  signal: 'release' | 'regressed' | 'course-changed';
  reason?: string;
}

/** The claim the loop is running, as the beat and a death line read it. */
interface Inflight {
  claimId: number;
  ticket: string;
  course: CourseLoad;
  /** B-94: the leg this claim is running, so a death leaves a line naming it. */
  leg: string | null;
  /** B-108: when that leg started — the beat's liveness line reads its duration. */
  legAt: number;
  child: LegChild | null;
  /** Resolved by the next tick's view of the snapshot's next legs (the short-wait re-read). */
  waiters: ((next: NextLegs) => void)[];
}

/** R-BTN-4, R-BTN-72 (B-188): one held claim's own state — its fence, its leg in flight, its
 *  session and channel, its scope audit and its checkout. A runner holds up to `concurrency` of
 *  them; each claim's run is bound to its slot (`AsyncLocalStorage`), so the loop's code reads
 *  its own claim's fields, and the heartbeat walks every slot explicitly. One claim's release,
 *  failure or fence touches no other slot. */
class Slot {
  claimId: number | null = null;
  ticket = '';
  nonce = '';
  /** The claim's `request_id` — a claim retried by it answers the same claim (reattach). */
  requestId: string | undefined;
  inflight: Inflight | null = null;
  /** B-108: the time of the last line drained from the leg child's stderr (—verbose, where the
   *  stub mirrors the agent's streams): a live signal the beat's liveness line counts. */
  legLineAt: number | null = null;
  pendingAbort: PendingAbort | null = null;
  closedDone = false;
  /** B-134: the actions the finished leg's audit found outside the claim's ticket scope —
   *  reported on the advance or end that finishes it, like the taken, and cleared when it is. */
  pendingScope: ScopeAction[] | null = null;
  /** B-134: the out-of-scope actions beyond the report's sixteen, counted here because the
   *  runner keeps the last sixteen — the report carries the count (`dropped`) so the earliest
   *  actions leave a number, not silence. */
  scopeOverflow = 0;
  /** B-134: the claim's scope — the claim answer's `scope` — against which each leg's pushes
   *  are audited at its end; null when the answer carried none (a Baton before B-134) or before
   *  the claim's course loaded. */
  auditScope: string[] | null = null;
  /** B-134: the refs the audit's window starts from, read before the claim's first leg runs and
   *  moved to the last read at each audit — of this claim's own checkout (B-188). */
  auditWindow: RefState | null = null;
  /** B-234 (R-BTN-106, R-BTN-195): the running leg's channel — one socket per leg run, served
   *  while the run's session is live, its address handed to the session as BATON_SOCKET. */
  legChannel: LegChannel | null = null;
  /** B-234 (R-BTN-113): the running leg's session link, as its executor's handle names it —
   *  reported on every beat, and the raise check's word on the run's link once a beat that
   *  carried it has answered (`sessionLinkLanded`). */
  legSessionUrl: string | null = null;
  /** B-234 (R-BTN-113): the run whose link `legSessionUrl` names — bumped each time a run's
   *  session names its link, so a beat built before this run's session named one answers for
   *  the last run, never this. */
  sessionLinkSeq = 0;
  /** B-234 (R-BTN-113, R-BTN-195): Baton holds the running leg's session link — a beat that
   *  carried this run's link was answered and kept it. An `interact` is refused on the channel
   *  until then. */
  sessionLinkLanded = false;
  /** §7.5 R-BTN-90 (B-234): the running run's `claim_legs.seq`, named by the advance that
   *  started it — what the finishing heartbeat's `legs_finished` carries when the run's script
   *  returns. */
  legSeq: number | null = null;
  /** §7.5 R-BTN-90 (B-234): the run whose finish a beat still owes Baton — set when the
   *  script's `run` returns, cleared by the beat that carried it. */
  legFinishedSeq: number | null = null;
  /** R-BTN-107 (B-184): the session of the leg that ran last — its `close` and `handoff` run in
   *  it, and it is stopped when the next leg starts or the claim ends. */
  session: { handle: Handle; checkout: string } | null = null;
  /** R-BTN-144 class 7 (B-170): the last leg's masked set, from the environment it was given. */
  legSecrets: readonly string[] = [];
  /** R-BTN-6 (B-188): Baton's answer no longer lists this claim — it is fenced alone: its leg
   *  stopped at once with no hand-off, the runner's lease and every other claim untouched. Set
   *  on every claim too when the runner's lease is lost. */
  lost = false;
  /** The claim's end has been sent: nothing is judged against the answer for it any more. */
  ended = false;
  /** The release messages routed to this claim, acknowledged when it ends. */
  toAck: number[] = [];
  /** B-188: the clone this claim holds (`<clonesDir>/<n>`), null in the home checkout. */
  cloneIndex: number | null = null;
  /** R-BTN-72 (B-188): the running leg's place, persisted for a restart's reattach. */
  place: Pick<PersistedClaim, 'run_id' | 'seq' | 'leg' | 'at' | 'handle' | 'ctx'> = {};
  constructor(public checkout: string) {}
}

export class Runner {
  private readonly o: RunnerOptions & { beatEvery: number };
  private readonly state: StateFile;
  private readonly log: (line: string) => void;
  private readonly verbose: boolean;
  /** R-BTN-107 (B-184): every leg and every call into repository code runs through it. */
  private readonly executor: Executor;
  private readonly now: () => number;
  private beat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** 2026-10-24: draining — SIGTERM's path (complete the current leg, then stop). Set once;
   * the claim loop ends the claim at the next leg boundary with its hand-off, the idle wait
   * returns, and work() ends without claiming again. */
  private draining = false;
  private lostLease = false;
  private toAck: number[] = [];
  /** R-BTN-19 (B-188): the claims the runner knows it lost, whose fences the next heartbeat
   *  clears — one entry per claim. */
  private fences: number[] = [];
  /** R-BTN-77: set when a heartbeat carried an `unblocked` message, so the idle wait ends early. */
  private unblocked = false;
  /** Bumps with every claim: an answer a beat started before the claim cannot fence it. */
  private epoch = 0;
  /** One beat at a time — the sidecar's answers stay ordered against the loop. The in-flight
   *  beat's promise while one is out, so a caller that needs a beat waits for it (`tick`). */
  private ticking: Promise<void> | null = null;
  /** R-BTN-14: a reaped worker re-keys on its next beat; the fresh secret until it lands. */
  private rekeySecret: string | null = null;
  /** The ends Baton never answered (the network went with the lease), by claim: retried on
   *  every beat. */
  private pendingEnds = new Map<number, Record<string, unknown>>();
  /** B-86: the capabilities the beats declare — null until the grant is known; a restart reads
   *  what the last process settled (state.ts's `declared`) rather than asking again. */
  private declared: string[] | null;
  /** B-86: the declaring list of the last beat Baton answered with a full answer — what the
   *  server will have recorded (`rewriteSettings`), null while no answer has landed. A beat that
   *  carried another list leaves the server on this one until the next answered beat. */
  private sent: string[] | null = null;
  /** B-86: an answer carried no `grant` — the declaration stays unsettled and the next beat is
   *  forced, so a grant that arrives later is still read. */
  private grantAsked = false;
  /** B-86: the startup never-eligible line has been said for the current declaration (itself said
   *  again only when the declaration changes) — never per beat. */
  private saidEligible = false;
  /** B-86: the empty-declaration line has been said, once, since `runOnce` would ask each time. */
  private saidEmpty = false;
  /** B-86: the `forbidden` line has been said for this stretch of refusals (reset by the next
   *  answered beat), so asking again is not narrated on every beat. */
  private saidForbidden = false;
  /** B-106 (R-BTN-178): this machine's locks, null when none were configured. */
  private readonly locks: MachineLocks | null;
  /** R-BTN-4 (B-188): the claims the runner holds — a slot each, bound to its claim's run. */
  private readonly als = new AsyncLocalStorage<Slot>();
  private readonly slots = new Set<Slot>();
  /** The slot code outside any claim's run reads (a test's direct call); never a held claim. */
  private readonly solo: Slot;
  /** The current claim's slot: the one this async context runs for. */
  private get cur(): Slot {
    return this.als.getStore() ?? this.solo;
  }
  private get inflight(): Inflight | null { return this.cur.inflight; }
  private set inflight(v: Inflight | null) { this.cur.inflight = v; }
  private get legLineAt(): number | null { return this.cur.legLineAt; }
  private set legLineAt(v: number | null) { this.cur.legLineAt = v; }
  private get pendingAbort(): PendingAbort | null { return this.cur.pendingAbort; }
  private set pendingAbort(v: PendingAbort | null) { this.cur.pendingAbort = v; }
  private get closedDone(): boolean { return this.cur.closedDone; }
  private set closedDone(v: boolean) { this.cur.closedDone = v; }
  private get pendingScope(): ScopeAction[] | null { return this.cur.pendingScope; }
  private set pendingScope(v: ScopeAction[] | null) { this.cur.pendingScope = v; }
  private get scopeOverflow(): number { return this.cur.scopeOverflow; }
  private set scopeOverflow(v: number) { this.cur.scopeOverflow = v; }
  private get auditScope(): string[] | null { return this.cur.auditScope; }
  private set auditScope(v: string[] | null) { this.cur.auditScope = v; }
  private get auditWindow(): RefState | null { return this.cur.auditWindow; }
  private set auditWindow(v: RefState | null) { this.cur.auditWindow = v; }
  private get legChannel(): LegChannel | null { return this.cur.legChannel; }
  private set legChannel(v: LegChannel | null) { this.cur.legChannel = v; }
  private get legSessionUrl(): string | null { return this.cur.legSessionUrl; }
  private set legSessionUrl(v: string | null) { this.cur.legSessionUrl = v; }
  private get sessionLinkSeq(): number { return this.cur.sessionLinkSeq; }
  private set sessionLinkSeq(v: number) { this.cur.sessionLinkSeq = v; }
  private get sessionLinkLanded(): boolean { return this.cur.sessionLinkLanded; }
  private set sessionLinkLanded(v: boolean) { this.cur.sessionLinkLanded = v; }
  private get legSeq(): number | null { return this.cur.legSeq; }
  private set legSeq(v: number | null) { this.cur.legSeq = v; }
  private get legFinishedSeq(): number | null { return this.cur.legFinishedSeq; }
  private set legFinishedSeq(v: number | null) { this.cur.legFinishedSeq = v; }
  private get session(): { handle: Handle; checkout: string } | null { return this.cur.session; }
  private set session(v: { handle: Handle; checkout: string } | null) { this.cur.session = v; }
  private get legSecrets(): readonly string[] { return this.cur.legSecrets; }
  private set legSecrets(v: readonly string[]) { this.cur.legSecrets = v; }
  /** B-188: the working tree the current claim's legs run in — its own clone at k > 1. */
  private get checkout(): string { return this.cur.checkout; }
  /** R-BTN-6, R-BTN-26: the current claim is fenced — the runner's lease is lost, or Baton no
   *  longer lists this claim alone. */
  private claimLost(): boolean {
    return this.lostLease || this.cur.lost;
  }
  /** R-BTN-4 (B-188): the most claims this runner holds at once. */
  private readonly concurrency: number;
  /** Claim requests out, unanswered: a beat built or answered meanwhile cannot tell a claim
   *  Baton just granted from one this runner does not hold. */
  private claimsOut = 0;
  /** B-106, B-188: which claim's leg holds each machine lock — a leg's lock is never released
   *  by another claim's. */
  private readonly lockOwners = new Map<string, Slot>();
  /** B-188: the clones in use, by index. */
  private readonly clonesBusy = new Set<number>();
  /** R-BTN-72 (B-188): the claims the state file held when this process started — reattached,
   *  ended or let go before the first claim; the beat leaves them alone until then. */
  private persisted: PersistedClaim[];
  /** Those of them written before B-188 (`claim` alone): ended as orphans, as before. */
  private readonly legacy: Set<number>;
  /** Whether the lease still held when this process started (R-BTN-72's reattach window). */
  private readonly startedInLease: boolean;
  /** The claim ids the last answered beat listed, null before any. */
  private answerClaims: Set<number> | null = null;
  /** The claim runs in flight (several at k > 1). */
  private readonly tasks = new Set<Promise<unknown>>();
  /** R-BTN-72 (B-188): the reattached claims' runs at one claim, which `runOnce` returns. */
  private readonly resumed: Promise<ClaimOutcome | null>[] = [];
  /** Set when a claim's run ends, so an idle wait at k > 1 asks again at once. */
  private roomMade = false;

  constructor(options: RunnerOptions) {
    this.o = { beatEvery: BEAT_MS, ...options };
    this.verbose = options.verbose ?? false;
    this.executor = options.executor ?? builtinExecutor();
    this.log = this.verbose ? withTimestamps(options.log ?? (() => {})) : (options.log ?? (() => {}));
    this.now = options.now ?? batonNow;
    this.state = new StateFile(options.stateFile);
    if (!this.state.get().secret) this.state.set({ secret: freshSecret() });
    this.o.api.setSecret(this.state.get().secret);
    this.locks = options.locks && Object.keys(options.locks).length ? new MachineLocks(options.locks, this.log) : null;
    this.solo = new Slot(options.home);
    const k = options.concurrency ?? 1;
    if (!Number.isInteger(k) || k < 1 || k > 32) throw new Error(`concurrency ${String(k)}: an integer from 1 to 32 (R-BTN-4)`);
    this.concurrency = k;
    // R-BTN-72 (B-188): what the last process held — the claims its state file names, and
    // whether its lease still held as this one starts (read before this process's first beat
    // moves `last_ok`).
    const was = this.state.get();
    const listed = Array.isArray(was.claims) ? was.claims : [];
    this.persisted = [...listed];
    this.legacy = new Set();
    if (was.claim && !listed.some((c) => c.id === was.claim!.id)) {
      this.persisted.push({ ...was.claim });
      this.legacy.add(was.claim.id);
    }
    this.startedInLease = was.last_ok != null && !leaseLostFrom(was, this.now());
    // B-86: a restart keeps the declaration the last process settled — a granted runner does not
    // ask again, and `runOnce` has no stale `[]` to force a beat for. `--capabilities` still
    // narrows what was read: a flag is the operator's word, the state file's a past answer.
    this.declared = options.capabilities ?? this.state.get().declared ?? null;
    if (options.capabilities != null && JSON.stringify(options.capabilities) !== JSON.stringify(this.state.get().declared)) {
      this.state.set({ declared: options.capabilities });
      // Settled before any answer, so the first beat already declares the flag's list — and an
      // answer that matches it settles nothing, so the line is said here, once (a restart over
      // the same state file says nothing). The never-eligible line waits for the first answer,
      // which is where the grant (and so `legNeeds`' question) is said with it.
      this.log(`baton: declaring ${options.capabilities.join(', ') || 'none'} (--capabilities — it narrows what the grant allows, never enables what the grant does not)`);
    }
  }

  // ── the sidecar (§6.3–6.4) ───────────────────────────────────────────────────────────────

  start(): void {
    if (this.beat) return;
    this.beat = setInterval(() => void this.tick().catch((e) => this.log(`baton: heartbeat failed (${msg(e)})`)), this.o.beatEvery);
    this.beat.unref?.();
    // The boot beat, as a promise `runOnce` can wait on before it asks Baton anything (B-93).
    const boot = this.tick().catch((e) => this.log(`baton: heartbeat failed (${msg(e)})`));
    this.booting = boot;
    void boot.finally(() => { if (this.booting === boot) this.booting = null; });
  }

  stop(): void {
    this.stopped = true;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    // B-106 (R-BTN-178): the locks die with the process, but released here they free at once.
    this.locks?.releaseAll();
  }

  /** B-94: what a runner says about itself when it leaves — its claim, the leg in flight and the
   * last beat Baton answered, in one line. `why` names the exit; the leg is `none` between
   * claims. Cheap and synchronous by design: it runs on a signal or an `exit` hook. */
  lastLine(why: string): string {
    const s = this.state.get();
    const beat = s.last_ok == null ? 'never' : new Date(s.last_ok).toISOString();
    // B-188: every claim it holds, each with its leg in flight.
    const held = Array.isArray(s.claims) && s.claims.length ? s.claims : s.claim ? [s.claim] : [];
    const legOf = (id: number | null) => {
      const slot = [...this.slots].find((x) => x.claimId === id) ?? (this.solo.inflight && (id == null || this.solo.inflight.claimId === id) ? this.solo : null);
      return slot?.inflight ? `leg ${slot.inflight.leg ?? '?'}` : 'no leg in flight';
    };
    if (held.length <= 1) {
      const claim = held[0] ? `claim ${held[0].id} on ${held[0].ticket_id}` : 'no claim';
      return `${why}: ${claim}, ${legOf(held[0]?.id ?? null)}, last beat ${beat}`;
    }
    return `${why}: ${held.map((c) => `claim ${c.id} on ${c.ticket_id}, ${legOf(c.id)}`).join('; ')}, last beat ${beat}`;
  }

  /** B-188: the slots that hold a claim — and the solo slot when a caller set its claim by hand. */
  private liveSlots(): Slot[] {
    const out = [...this.slots];
    if (this.solo.inflight && !out.includes(this.solo)) out.push(this.solo);
    return out;
  }

  /** R-BTN-72 (B-188): the state file's claims — every held slot's, oldest first, with the leg's
   *  place for a reattach, and the earlier process's still undecided — and `claim`, the oldest,
   *  for the hooks and `BATON_STATE` readers that read one. */
  private writeClaims(): void {
    const held: PersistedClaim[] = [
      ...this.persisted,
      ...[...this.slots].filter((x) => x.claimId != null && !x.ended).map((x) => ({
        id: x.claimId!, ticket_id: x.ticket, nonce: x.nonce,
        ...(x.requestId ? { request_id: x.requestId } : {}), checkout: x.checkout, ...x.place,
      })),
    ];
    this.state.set({ claims: held, claim: held[0] ? { id: held[0].id, ticket_id: held[0].ticket_id, nonce: held[0].nonce } : null });
  }

  /** One heartbeat, by the timer or a test: the §11 answer drives everything local — the lease,
   * the claim git shows, the messages and the snapshot's next legs. Never concurrent with
   * another beat, so an answer always post-dates the claim state it is judged against. A caller
   * that arrives while a beat is out waits for it and returns — review round 5, finding 2:
   * `work()` starts the sidecar and then claims at once, and the boot beat must have landed
   * (registering the worker, settling the declaration) before `runOnce` reads `sent`; returning
   * on the guard let the first claims go out on `null` and `[]`. */
  async tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    // B-188: the beat belongs to no claim — it runs outside any claim's context and walks every
    // slot explicitly, whichever claim's code asked for it.
    this.ticking = this.als.exit(() => this.beatOnce()).finally(() => { this.ticking = null; });
    return this.ticking;
  }

  /** B-93: the beat a `start()` issued, and that registers the worker (review round 2, finding
   * 3). A session's first attempt finds a beat already out — the sidecar's boot beat — and read
   * its worker id before the answer, so `!registered` sent a second, redundant heartbeat and
   * `stray` never applied. This is the promise `waitForBeat` waits on. */
  private booting: Promise<void> | null = null;

  /** B-93: whatever beat was in flight has answered — so the calls after it are a registered
   * worker's, carrying the secret Baton now holds. A beat still out after a minute has lost its
   * claim to the timer and the next attempt; the wait is bounded so an attempt can never hang. */
  private async waitForBeat(): Promise<void> {
    // A beat's own `finally` may clear the flag before this loop first reads it, so the boot beat is
    // followed through its promise whenever one was issued (taken on the first pass, before it can
    // settle) and through the flag for one armed later.
    let awaited: Promise<void> | null = null;
    for (let waited = 0; waited < 60_000; waited += 5) {
      const beat = this.booting;
      if (beat && beat !== awaited) { awaited = beat; await beat.catch(() => {}); continue; }
      if (!beat && !this.ticking) return;
      await sleep(5);
    }
  }

  /** B-234 (R-BTN-113, R-BTN-195): Baton holds the running leg's session link — a heartbeat
   *  carrying it answered. `tick()` joins whatever beat is out, and one built before this run's
   *  session named its link carries the last run's, so at most two beats serve: the first
   *  settles any beat already out, the second carries this run's. A beat that cannot land it
   *  changes nothing here — the leg runs on, and the channel's raise check refuses an
   *  `interact` until a later beat of the cadence lands the link. */
  private async landSessionLink(): Promise<void> {
    for (let beat = 0; beat < 2 && !this.sessionLinkLanded; beat++) {
      try {
        await this.tick();
      } catch (e) {
        this.log(`baton: the heartbeat that lands the session link failed (${msg(e)}) — an interact is refused until one lands it (R-BTN-113)`);
        return;
      }
    }
  }

  /** §7.5 R-BTN-90 (B-234): finishing is not the end — the run's script returned, and an
   *  immediate heartbeat out of the cadence says so (`leg_finished`) before validation,
   *  `close`, hand-off or any wait: Baton withdraws a `leg-timeout` release still pending for
   *  the run (so a finishing that crosses the instant is never cut off, nor the next leg
   *  stopped by a release spent on this one) and re-arms a still-armed deadline to now + 40
   *  minutes, once per run. `tick()` joins whatever beat is out, so at most two beats serve —
   *  the first settles a beat built before the run returned, the second carries the finish. A
   *  beat that cannot land it changes nothing here: the cadence's next beat carries it, before
   *  its own delivery. */
  private async reportLegFinished(): Promise<void> {
    if (this.legSeq == null) return;
    this.legFinishedSeq = this.legSeq;
    for (let beat = 0; beat < 2 && this.legFinishedSeq != null; beat++) {
      try {
        await this.tick();
      } catch (e) {
        this.log(`baton: the heartbeat that reports the finished leg failed (${msg(e)}) — the next beat carries it (R-BTN-90)`);
        return;
      }
    }
  }

  /** The declaration as it goes out on a beat or is compared before a claim (B-86, B-106): the
   *  settled list less every lock capability whose file this process does not hold — of the
   *  runners on one machine only the one holding the lock declares it (R-BTN-178). */
  private declaringList(): string[] {
    const base = this.declared ?? this.o.capabilities ?? [];
    const locks = this.locks;
    return locks ? base.filter((c) => !locks.manages(c) || locks.holds(c)) : base;
  }

  private async beatOnce(): Promise<void> {
    const epoch = this.epoch;
    // B-188: a claim request out while this beat is built or answered — Baton may hold a claim
    // the runner has no slot for yet, so this answer cannot judge one it does not know.
    const claimingAtStart = this.claimsOut > 0;
    const s = this.state.get();
    const spool = this.takeSpool();
    // R-BTN-4 (B-188): the claims held as this beat is built — each judged against the answer.
    const live = this.liveSlots();
    // B-86: `--capabilities` narrows; without it the declaration is the grant's, which the first
    // answer carries (`grant.capabilities`), so the first beat asks and declares nothing — the
    // registration has no declaration to widen, and the beat after it serves the grant.
    // B-106 (R-BTN-178): a lock free again is taken and declared; one another process on this
    // machine holds is not declared, so no leg requiring it is offered here. Mid-claim the set
    // is the claims' own — `ensureLegLocks` holds the legs' locks and releases the rest — so the
    // idle maintenance stays out until every claim ends.
    if (this.locks && !live.some((x) => x.inflight)) await this.locks.takeAll();
    const declaring = this.declaringList();
    // R-BTN-113, R-BTN-90 (B-188): each claim's running leg's link and finished run, by claim;
    // read at build time, so the answer below clears only what this beat carried.
    const links = live.filter((x) => x.claimId != null && x.legSessionUrl).map((x) => ({ slot: x, claim_id: x.claimId!, url: x.legSessionUrl!, seq: x.sessionLinkSeq }));
    const finished = live.filter((x) => x.claimId != null && x.legFinishedSeq != null).map((x) => ({ slot: x, claim_id: x.claimId!, seq: x.legFinishedSeq! }));
    const fences = [...new Set(this.fences)];
    // One claim at a time keeps the shapes a Baton before B-188 reads: the bare `session_url`
    // and `leg_finished`, and a `fenced` object.
    const one = this.concurrency === 1;
    const body: Record<string, unknown> = {
      hostname: this.o.hostname, session_name: this.o.session, harness: this.o.harness, kind: 'vm',
      capabilities: declaring, tier_ceiling: this.o.tierCeiling ?? 'critical',
      // B-253 (R-BTN-72): the runner's own statement about itself, opaque — the CLI's pinning
      // under `cli`, on every beat.
      ...(this.o.profile ? { profile: this.o.profile } : {}),
      ...(this.o.testHarness ? { test_harness: true } : {}),
      lease_timeout_s: s.lease_timeout_s ?? 900,
      // R-BTN-4 (B-188): how many claims this runner holds at once.
      concurrency: this.concurrency,
      courses: this.o.courses.map((c) => ({ repository: this.o.repository, course: c.course, version: c.version })),
      // R-BTN-113 (B-234, B-188): the running legs' session links, kept on their runs' rows
      // (latest wins while each runs); Baton drops and logs one that fails the link rule.
      ...(links.length ? { session_urls: links.map((l) => ({ claim_id: l.claim_id, url: l.url })) } : {}),
      ...(one && links.length ? { session_url: links[0].url } : {}),
      // §7.5 R-BTN-90 (B-234, B-188): the runs whose scripts returned — the finishing half's word.
      ...(finished.length ? { legs_finished: finished.map((f) => ({ claim_id: f.claim_id, seq: f.seq })) } : {}),
      ...(one && finished.length ? { leg_finished: finished[0].seq } : {}),
      ...((s.worker_id == null || this.rekeySecret) ? { secret_hash: await sha256Hex(this.rekeySecret ?? s.secret), ...(this.rekeySecret ? { rekey: true } : {}) } : {}),
      // R-BTN-19 (B-188): one entry per fenced claim.
      ...(fences.length ? { fenced: one && fences.length === 1 ? { claim_id: fences[0], terminated: true } : fences.map((id) => ({ claim_id: id, terminated: true })) } : {}),
      transcripts: spool.transcripts,
    };
    // §6.9: the spool's activity rows go up as their own call, before the beat; anything the
    // calls do not land comes back to the spool, so a leg session's record is never lost.
    const carry = [...spool.overflowTranscripts, ...spool.overflowActivities];
    if (carry.length) appendFileSync(this.state.spool, `${carry.map((t) => JSON.stringify(t)).join('\n')}\n`);
    let leftover: unknown[] = [...spool.overflowActivities];
    try {
      if (spool.activities.length) leftover = [...leftover, ...await this.postActivities(spool.activities)];
      if (this.pendingEnds.size) await this.retryEnd();
    } catch (e) {
      appendFileSync(this.state.spool, `${[...spool.transcripts, ...leftover].map((t) => JSON.stringify(t)).join('\n')}\n`);
      rmSync(spool.taken, { force: true }); // back in the spool; the taken copy is spent
      throw e;
    }
    let answer: Record<string, any>;
    try {
      answer = await this.o.api.heartbeat(body);
    } catch (e) {
      // The transcripts never landed: back to the spool for the next beat.
      appendFileSync(this.state.spool, `${[...spool.transcripts, ...leftover].map((t) => JSON.stringify(t)).join('\n')}\n`);
      void carry;
      rmSync(spool.taken, { force: true }); // back in the spool; the taken copy is spent
      if (e instanceof BatonRefusal && ['session-taken', 'worker-reaped', 'forbidden'].includes(e.code)) {
        // §6.3: a refused heartbeat marks the lease lost exactly as a missed timeout does; a
        // reaped worker re-keys on the beat after (R-BTN-14).
        if (e.code === 'worker-reaped') this.rekeySecret = freshSecret();
        // B-86 (review round 4, finding 3): `forbidden` is a name the server no longer admits —
        // the owner narrowed the grant under this runner (`admin.ts` replaces the list). A
        // refused beat carries no grant, so settling here would replay the stale declaration on
        // every beat and after every restart. A runner that named no flag asks again with none —
        // the first-beat path — and the next answer re-settles its declaration from the grant as
        // it now stands. A flagged runner keeps its word: its list is the operator's, and the
        // grant refusing it is theirs to change.
        if (e.code === 'forbidden' && this.o.capabilities == null) {
          this.declared = null;
          this.sent = null;
          this.saidEligible = false;
          this.state.set({ declared: null });
          // Review round 5, finding 4: the server's message names the cause — a hostname this
          // key is not registered for, a revoked key, a course in an ungranted repository — and
          // not every refusal is a grant that moved. Said once per stretch of refusals.
          if (!this.saidForbidden) this.log(`baton: the heartbeat was refused (forbidden): ${e.message} — asking again with no declaration, so the next answer re-settles what this machine may declare`);
          this.saidForbidden = true;
        }
        this.loseLease(e.code);
        return;
      }
      throw e;
    }
    rmSync(spool.taken, { force: true });
    // R-BTN-113 (B-234): the answer's word on each link — Baton holds a run's session link when
    // the beat carried it and the answer kept it (not dropped: a dropped link failed the rule
    // and was stored nowhere). This is what each claim's raise check reads (R-BTN-195).
    for (const x of live) {
      const carried = links.find((l) => l.slot === x);
      x.sessionLinkLanded = carried != null && carried.seq === x.sessionLinkSeq && answer.session_url_dropped == null;
    }
    // §7.5 R-BTN-90 (B-234): each finish landed — nothing further owes Baton that run's return.
    for (const f of finished) if (f.slot.legFinishedSeq === f.seq) f.slot.legFinishedSeq = null;
    // What Baton recorded from this beat: `rewriteSettings` writes the rows of the list a beat
    // carried, so an answer to this beat leaves the server on `declaring` (B-86: `runOnce` reads
    // this to know whether the next claim would go out on a stale declaration).
    this.sent = [...declaring];
    this.saidForbidden = false;
    // B-86: the declaration settles on the answer — `--capabilities` as given, else the grant the
    // answer carries — and again when the grant moves under a runner that named no flag, so a
    // widened grant needs no restart. Said when it changes, never per beat.
    const grantValues = Array.isArray(answer.grant?.capabilities) ? (answer.grant.capabilities as string[]) : null;
    const grant = grantValues?.length ? grantValues : null;
    // A runner that named no flag declares the grant — an empty one included, which says its key
    // is granted nothing it declares courses in. An answer with no grant at all (a seed key's) is
    // not an answer of "nothing": it settles nothing, the declaration stays as it stands and the
    // next beat asks again, so a grant that arrives later is still read (review round 3).
    const settled = this.o.capabilities ?? (grantValues ? declarationFrom(grantValues) : null);
    if (settled == null) {
      // Said once per stretch of grant-less answers, never per beat. The declaration is not an
      // empty grant: it is unsettled, and `gates.ts` reads a runner that declared nothing as
      // satisfying only what needs nothing.
      if (!this.grantAsked) this.log('baton: the heartbeat answered no grant — the declaration stays unsettled and the next beat asks again (a seed key is granted nothing; a machine key is granted by its owner)');
      this.grantAsked = true;
    } else {
      this.grantAsked = false;
    }
    if (settled != null && (this.declared == null || JSON.stringify(this.declared) !== JSON.stringify(settled))) {
      this.declared = settled;
      this.saidEligible = false; // a new declaration may be the one that can claim
      const held = this.declared.join(', ') || 'none';
      this.state.set({ declared: this.declared });
      // The grant the answer carried, when it carried one: what the flag narrowed.
      this.log(this.o.capabilities
        ? `baton: declaring ${held} (--capabilities, narrowing what the grant allows: ${grantValues ? (grant?.join(', ') || 'none') : 'unknown'})`
        : `baton: declaring ${held} — the grant's capabilities, no --capabilities given`);
      await this.reportEligibility();
    } else if (settled != null && !this.saidEligible) {
      // The first answer settled nothing (a `--capabilities` list it agrees with): the
      // never-eligible line is still owed once, against the grant this answer names.
      await this.reportEligibility();
    }
    if (this.rekeySecret) {
      // The re-key landed: the new secret serves from here (R-BTN-14), and the new incarnation
      // starts on a fresh lease — the old flag fenced a claim the reap already took.
      this.state.set({ secret: this.rekeySecret, lease_lost: false, lease_lost_because: null });
      this.o.api.setSecret(this.rekeySecret);
      this.rekeySecret = null;
      this.lostLease = false;
    }
    this.state.set({
      worker_id: answer.worker_id, incarnation: answer.incarnation, last_ok: this.now(),
      lease_timeout_s: answer.lease_timeout_s ?? s.lease_timeout_s,
    });
    // R-BTN-19: the fences this beat carried cleared with it.
    this.fences = this.fences.filter((id) => !fences.includes(id));
    // R-BTN-4 (B-188): every claim the runner holds, oldest first; a Baton before B-188 answers
    // the one `claim`.
    const answered = (Array.isArray(answer.claims) ? answer.claims : answer.claim && typeof answer.claim === 'object' ? [answer.claim] : []) as Record<string, any>[];
    const byId = new Map(answered.filter((c) => c && typeof c.id === 'number').map((c) => [c.id as number, c]));
    this.answerClaims = new Set(byId.keys());
    // R-BTN-6 and §6.13: the wall clock's own verdict fences the runner — every claim, stop each
    // leg, no hand-off; an answer that no longer lists one claim fences that claim alone.
    const steady = epoch === this.epoch && !claimingAtStart && this.claimsOut === 0;
    if (epoch !== this.epoch) {
      // A claim began while this beat was out: its answer speaks for the claims it was asked
      // about, never one taken since.
    } else if (!this.lostLease && leaseLostFrom(this.state.get(), this.now())) {
      this.loseLease('lease-timeout');
    } else if (!this.lostLease) {
      for (const x of live) {
        const id = x.inflight?.claimId;
        if (id != null && !x.lost && !x.ended && !byId.has(id)) this.loseClaim(x);
      }
    }
    for (const x of live) {
      if (!x.inflight) continue;
      const view = byId.get(x.inflight.claimId)?.git ?? null;
      if (view === 'unknown') this.signalSlot(x, 'course-changed', 'released:course-changed');
      else if (view && typeof view === 'object') {
        if (view.closed === 'done') x.closedDone = true;
        else if (view.regressed) this.signalSlot(x, 'regressed');
        const next = (view.next ?? null) as NextLegs | null;
        for (const w of x.inflight.waiters.splice(0)) w(next ?? []);
      }
      // B-108: the liveness line — while a leg call is in flight, each beat says how long it has
      // run and how old its newest activity signal is, so an operator watches a wedge form (and
      // the leg's ceiling approach) instead of silence. Advice for the operator's eye, never a
      // detector: the stub concludes its agent; this line only makes the wait visible.
      if (x.inflight.child != null && x.inflight.leg != null) {
        const leg = x.inflight.leg;
        const signals = [...legActivity(x.checkout, x.inflight.ticket, leg), ...(x.legLineAt != null ? [{ name: 'drained-line', at: x.legLineAt }] : [])];
        const newest = signals.reduce((a, b) => (b.at > a.at ? b : a));
        this.log(`baton: ${x.inflight.ticket}'s ${leg} has run ${ageWords(this.now() - x.inflight.legAt)}; newest activity ${newest.at > 0 ? `${ageWords(this.now() - newest.at)} ago (${newest.name})` : 'not seen'}`);
      }
    }
    for (const m of (answer.messages ?? []) as { id: number; kind: string; payload?: { reason?: string; ticket_id?: string } }[]) {
      // R-BTN-119 (B-188): a release names its ticket — it stops that claim alone.
      const target = m.kind === 'release' ? this.slotFor(live, m.payload?.ticket_id) : null;
      const about = target?.ticket || m.payload?.ticket_id || (live.length === 1 ? live[0].ticket || live[0].inflight?.ticket : '') || this.state.get().claim?.ticket_id || '';
      // 2026-10-24: every message is logged on receipt — a release or cue the runner acts on
      // silently was the hardest class to debug from the log alone.
      this.log(`baton: message ${m.kind}${m.payload?.reason ? ` (${m.payload.reason})` : ''} received${about ? ` for ${about}` : ''}`);
      if (m.kind === 'release') {
        // A release message's payload reason is one of §6.5's own ('requested', 'owner-cancel',
        // 'provider-suspended') — it names the end directly. (A releasing owner bar arrives
        // the same way, as a release message — §11's heartbeat bars carry no release flag.)
        // One for a ticket no claim here holds is acknowledged with the idle beat.
        if (target) {
          target.toAck.push(m.id);
          this.signalSlot(target, 'release', `released:${m.payload?.reason ?? 'requested'}`);
        } else {
          this.toAck.push(m.id);
        }
      } else if (m.kind === 'unblocked') {
        // R-BTN-77, §9: the idle wait ends with the next claim attempt, and the cue is acknowledged
        // so it is not delivered again with every beat.
        this.unblocked = true;
        this.toAck.push(m.id);
      } else if (m.kind === 'wind-down') {
        // B-109: the owner's wind-down sets the same drain flag SIGTERM does — every leg in
        // flight completes, each claim ends at its boundary with its hand-off, the runner exits
        // without claiming again. drain() is idempotent: a second wind-down changes nothing.
        this.drain(`the owner's wind-down message`);
        this.toAck.push(m.id);
      }
    }
    // R-BTN-6 (B-188): a claim Baton lists that this runner's state does not hold — a lost state
    // file, a claim granted on a request whose answer never came — is ended `released:lease-lost`,
    // loudly, never left to idle. Not one a claim request still out may be granting, one whose
    // end is parked, nor one the earlier process left (reattached or ended before the first
    // claim).
    if (steady && epoch === this.epoch && this.claimsOut === 0) {
      const mine = new Set([...this.slots].map((x) => x.claimId));
      for (const [id, c] of byId) {
        if (mine.has(id) || this.pendingEnds.has(id) || this.persisted.some((p) => p.id === id)) continue;
        this.log(`baton: Baton lists claim ${id} on ${String(c.ticket_id ?? '?')}, which this runner does not hold — ending it released:lease-lost (R-BTN-6)`);
        await this.endQuietly(id, { end_reason: 'released:lease-lost', next: null });
      }
    }
    if (!live.length) for (const id of this.toAck.splice(0)) await this.o.api.ack(id).catch(() => {});
  }

  /** R-BTN-119 (B-188): the claim a release names, by its ticket — the one held claim when the
   *  message names none (a Baton before B-188 always named one). */
  private slotFor(live: Slot[], ticket: string | undefined): Slot | null {
    if (ticket) return live.find((x) => x.ticket === ticket || x.inflight?.ticket === ticket) ?? null;
    return live.length === 1 ? live[0] : null;
  }

  /** B-229 (R-BTN-26): every other state file beside this session's that still names a claim
   *  whose lease is lost by the file's own clock — a session that can no longer act on it, the
   *  same reading its own fence makes — has that claim ended with its own worker's secret, as
   *  `released:lease-lost`, and the file's claim cleared. A sibling session whose lease still
   *  holds is a live runner on this host, and is left alone; a file never answered (no
   *  `last_ok`) holds no lease to read, and is left too. A refusal clears the file (the claim is
   *  ended or not that worker's any more); a failure to reach Baton leaves it for the next start. */
  private async endEarlierSessions(): Promise<void> {
    if (!this.o.apiFor) return;
    const dir = dirname(this.o.stateFile);
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      return;
    }
    const now = this.now();
    for (const name of names) {
      const path = join(dir, name);
      if (resolve(path) === resolve(this.o.stateFile)) continue;
      let s: RunnerState;
      try {
        s = JSON.parse(readFileSync(path, 'utf8')) as RunnerState;
      } catch {
        continue;
      }
      if (!s || typeof s.secret !== 'string' || s.secret === '' || !leaseLostFrom(s, now)) continue;
      // B-188: every claim the file names — its `claims`, else (a file before B-188) its `claim`.
      const held = (Array.isArray(s.claims) && s.claims.length ? s.claims : s.claim ? [s.claim] : [])
        .filter((c): c is PersistedClaim => c != null && typeof c.id === 'number');
      if (!held.length) continue;
      const session = basename(name, '.json');
      let unreached = false;
      for (const claim of held) {
        this.log(`baton: ending claim ${claim.id} on ${claim.ticket_id}, left by the earlier session ${session} (its lease is lost)`);
        try {
          await this.o.apiFor(s.secret).end(claim.id, { end_reason: 'released:lease-lost', next: null });
        } catch (e) {
          if (!(e instanceof BatonRefusal) || e.code === 'unavailable' || e.status >= 500) {
            this.log(`baton: claim ${claim.id} could not be ended now (${e instanceof Error ? e.message : String(e)}); the next start tries again`);
            unreached = true;
            continue;
          }
          if (e.code !== 'claim-ended') this.log(`baton: claim ${claim.id} of the earlier session ${session} was refused (${e.message}); its file lets it go`);
        }
      }
      if (!unreached) new StateFile(path).set({ claim: null, ...(Array.isArray(s.claims) ? { claims: [] } : {}) });
    }
  }

  /** An end whose failure is never fatal: claimed-ended is the answer we wanted anyway, and a
   * network failure parks the end for the beats to retry. */
  private async endQuietly(claimId: number, body: Record<string, unknown>): Promise<void> {
    // An end already parked for this claim keeps its own body — a re-end here must never
    // overwrite a done or suspended end the wire ate.
    if (this.pendingEnds.has(claimId)) return;
    try {
      await this.o.api.end(claimId, body);
    } catch (e) {
      if (e instanceof BatonRefusal && e.code === 'claim-ended') return;
      if (e instanceof BatonRefusal && (e.code === 'unavailable' || e.status >= 500)) {
        this.pendingEnds.set(claimId, body);
        return;
      }
      if (e instanceof BatonRefusal) {
        this.log(`baton: the orphaned claim ${claimId} was refused (${e.message})`);
        return;
      }
      this.pendingEnds.set(claimId, body);
    }
  }

  /** B-86: a runner whose declaration lacks a capability a leg of its course requires says so —
   *  the failure this ticket is about was total silence, and a startup line is what the ticket
   *  asks for. `legNeeds` gives the rule 4 names those legs require; the line names the ones the
   *  declaration lacks. Said when the declaration settles and when it changes, never per beat
   *  (review round 3: the re-say could never recur, so it is gone); a declaration that covers
   *  them says nothing, and an empty one is not asked about here — a ticket with no clause is
   *  still claimable, and `runOnce` is where an empty declaration is told what it means. */
  private async reportEligibility(): Promise<void> {
    if (!this.o.legNeeds) return;
    this.saidEligible = true;
    if (this.declared == null) return;
    // B-104: `human-operator` is the one built-in literal — compared as itself by rule 4 like
    // any capability (rule 6 retired, R-BTN-121 as amended), never an expansion of the four.
    const held = capabilitiesOf(this.declared);
    const declared = this.declared.join(', ') || 'nothing';
    let needs: string[];
    try {
      needs = await this.o.legNeeds();
    } catch (e) {
      this.log(`baton: the course's leg needs could not be read (${msg(e)})`);
      return;
    }
    const short = [...new Set(needs)].filter((n) => !held.has(n));
    if (!short.length) return;
    this.log(`baton: this runner declared ${declared}, which lacks ${short.join(', ')} — a leg requiring it refuses rule 4 (missing-capability), so this runner can never claim one: declare what the machine holds (--capabilities) within what the owner granted`);
  }

  private loseLease(because: string): void {
    this.lostLease = true;
    this.state.set({ lease_lost: true, lease_lost_because: because });
    // R-BTN-19: the claims were taken away from this worker; the next heartbeat reports the
    // fences it cleared, so each ticket is re-issued instead of waiting for the worker to go
    // silent. B-188: the runner's lease is every claim's — each leg stops at once.
    const live = this.liveSlots().filter((x) => x.claimId != null || x.inflight);
    const ids = live.map((x) => x.inflight?.claimId ?? x.claimId).filter((id): id is number => id != null);
    if (!ids.length && this.state.get().claim) ids.push(this.state.get().claim!.id);
    for (const id of ids) if (!this.fences.includes(id)) this.fences.push(id);
    for (const x of live) {
      x.lost = true;
      const child = x.inflight?.child;
      if (child) this.killGroup(child);
      void this.stopSlotSession(x, 'lease-lost');
    }
    if (!live.length) void this.stopSlotSession(this.solo, 'lease-lost');
  }

  /** R-BTN-6 (B-188): Baton's answer no longer lists this claim — a force-reap, a deadline's
   *  release already taken — so this claim alone is fenced: its leg stops at once, no hand-off,
   *  and the next beat reports its fence. The runner's lease and its other claims run on. */
  private loseClaim(x: Slot): void {
    x.lost = true;
    const id = x.inflight?.claimId ?? x.claimId;
    this.log(`baton: Baton no longer lists claim ${id ?? '?'} on ${x.inflight?.ticket ?? x.ticket} — its leg stops at once, no hand-off; this runner's other claims run on (R-BTN-6)`);
    if (id != null && !this.fences.includes(id)) this.fences.push(id);
    const child = x.inflight?.child;
    if (child) this.killGroup(child);
    void this.stopSlotSession(x, 'lease-lost');
  }

  /** The pending signal as the loop reads it — through a call, so a field-narrowed null at one
   * check point never hides the signal a later tick recorded. */
  private abortSignal(): PendingAbort | null {
    return this.pendingAbort;
  }

  /** Ask the claim to stop at its next safe point (§6.13's `release`/`regressed` signals): the
   * signal is recorded whether or not a leg process is running — a release that lands in a
   * short wait or between legs is honoured just the same, never dropped. The claim-level end it
   * turns into is remembered for when the runner next settles. */
  private signalLeg(signal: PendingAbort['signal'], reason?: string): void {
    this.signalSlot(this.cur, signal, reason);
  }

  /** `signalLeg` for a named claim — the beat's, which belongs to no claim (B-188). */
  private signalSlot(x: Slot, signal: PendingAbort['signal'], reason?: string): void {
    if (!x.inflight) return;
    // A release is the strongest signal: it overrides a regression or a course change that
    // landed first, so its message is never acknowledged away (§6.13, §9).
    if (x.pendingAbort && !(signal === 'release' && x.pendingAbort.signal !== 'release')) return;
    x.pendingAbort = { signal, reason };
    // The wire carries §6.13's closed reason set: a course change stops the leg the way a
    // release does — at its next safe point — so that is the signal it gets.
    const child = x.inflight.child;
    const wire = signal === 'course-changed' ? 'release' : signal;
    child?.running.write(JSON.stringify({ abort: wire }));
  }

  private killGroup(child: LegChild): void {
    child.running.kill();
  }

  /** Start a session of `kind` on the executor the host chose. */
  private async startSession(kind: SessionKind, o: { session_id: string; run_id?: string; ticket?: string; leg?: string; snapshot_sha?: string; paths: string[]; env: Record<string, string>; channel?: string | null; autonomous?: boolean }): Promise<Handle> {
    return await this.executor.start({
      brief: { kind, ...o, checkout: this.checkout, wrapper: LEG_PROCESS, ...(o.autonomous ? { autonomous: true } : {}) },
      executor: null, inputs: [], channel: o.channel ?? null,
    });
  }

  /** The session `close` and `handoff` run in: the last leg's, or — a hand-off with no leg run
   *  in this claim yet — a fresh `leg` session over the claim's course scripts. */
  private async legSession(): Promise<Handle> {
    if (this.session) return this.session.handle;
    const paths = this.inflight ? [this.inflight.course.scratch] : [];
    const handle = await this.startSession('leg', { session_id: `leg-${randomBytes(6).toString('hex')}`, paths, env: this.baseEnv() });
    this.session = { handle, checkout: this.checkout };
    return handle;
  }

  /** The environment every session starts from: the runner's, with the parent markers (R-BTN-144). */
  private baseEnv(): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env, BATON_PARENT: String(this.state.get().worker_id ?? ''), BATON_STATE: this.o.stateFile };
    return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }

  private async stopSession(reason: string): Promise<void> {
    await this.stopSlotSession(this.cur, reason);
  }

  /** `stopSession` for a named claim (B-188). */
  private async stopSlotSession(x: Slot, reason: string): Promise<void> {
    const s = x.session;
    x.session = null;
    if (x.place.handle) {
      // R-BTN-72 (B-188): a stopped session is nothing a restart could reattach to.
      x.place = { ...x.place, handle: null };
      if (this.slots.has(x)) this.writeClaims();
    }
    if (s) await this.executor.stop(s.handle, reason).catch((e) => this.log(`baton: the executor's stop failed (${msg(e)})`));
  }

  /** R-BTN-144 (B-170): one leg's class 7 masked stream sink — the leg's `run` call's stderr. The
   *  runner holds a literal's length back across writes, so a value split by a stream is still
   *  one literal, and the sink writes to the runner's log, which is what a leg log reads
   *  (R-BTN-128): the masked bytes are what leaves the runner. `release` is the call's end — the
   *  wrapper's outcome line rides the stream's last writes, so what it held goes first. */
  private legSink(secrets: readonly string[]): { onStderr: (line: string) => void; release: () => void } {
    const sink = createLegMasker(secrets);
    return {
      onStderr: (line) => {
        const out = sink.push(line);
        if (out !== '') this.log(out);
      },
      release: () => {
        const out = sink.flush();
        if (out !== '') this.log(out);
      },
    };
  }

  /** One wrapper call (R-BTN-133) through the executor's `exec`: `node <wrapper> <call> <script>`,
   *  its arguments on stdin's first line, its outcome on stdout's last. `sink` is the leg's
   *  running stream sink (R-BTN-144, B-170), which the leg's `run` passes and the runner releases
   *  at the call's end; every other call's stderr is the verbose drain, masked of classes 5 and
   *  6 and of the leg's class 7 set — those calls run in the leg's session, with the same
   *  environment its literals came from. */
  private wrapperCall(h: Handle, call: string, script: string, args: unknown[], timeout_s?: number, sink?: () => ReturnType<Runner['legSink']>): Running {
    const leg = sink?.();
    return this.executor.exec(h, ['node', LEG_PROCESS, call, script], {
      cwd: this.checkout, stdin: `${JSON.stringify(args)}\n`, ...(timeout_s ? { timeout_s } : {}),
      // R-BTN-144: what a leg's stderr carries leaves masked — class 5 and class 6 by the shared
      // pattern, the leg's own class 7 set with it while its run streams, and by the drain after.
      // B-108: a drained line is leg activity either way — the beat's liveness line counts it.
      onStderr: leg ? (l: string) => { this.legLineAt = Date.now(); leg.onStderr(l); } : this.verbose ? (l: string) => { this.legLineAt = Date.now(); this.log(maskLegOutput(`baton: ${call}: ${l}`, this.legSecrets)); } : undefined,
    });
  }

  /** Take the spool (§6.8, §6.9): RENAME it aside, so lines a leg session appends while this
   * beat is out wait in the fresh file rather than being truncated away, then split what was
   * there into transcript pointers and activity rows. Overflow beyond a call's bound carries to
   * the next beat; only what is neither shape is dropped, loudly. The renamed file lives until
   * the beat landed (the caller removes it), so nothing is lost to a dropped request. */
  private takeSpool(): { transcripts: unknown[]; overflowTranscripts: unknown[]; activities: unknown[]; overflowActivities: unknown[]; taken: string } {
    const taken = `${this.state.spool}.taken`;
    let text: string;
    try {
      renameSync(this.state.spool, taken);
      text = readFileSync(taken, 'utf8');
    } catch {
      return { transcripts: [], overflowTranscripts: [], activities: [], overflowActivities: [], taken };
    }
    const transcripts: unknown[] = [];
    const activities: unknown[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if ('repo' in parsed && 'path' in parsed) transcripts.push(parsed);
        else if ('id' in parsed && 'kind' in parsed) activities.push(parsed);
        else this.log(`baton: a spool line that is neither a transcript pointer nor an activity was dropped (${line.slice(0, 80)})`);
      } catch {
        this.log(`baton: a malformed spool line was dropped (${line.slice(0, 80)})`);
      }
    }
    // Both calls' bounds carry their overflow back to the spool — nothing is dropped silently.
    return { transcripts: transcripts.slice(-50), overflowTranscripts: transcripts.slice(0, -50), activities: activities.slice(0, 200), overflowActivities: activities.slice(200), taken };
  }

  /** §6.9: activity rows go up under their own call. Returns what must carry to the next beat —
   * a transport failure's whole batch; a refused row is the server's word and is only logged. */
  private async postActivities(activities: unknown[]): Promise<unknown[]> {
    try {
      const res = await this.o.api.activities(activities);
      for (const refused of (res.refused ?? []) as { id?: string; message?: string }[]) {
        this.log(`baton: an activity was refused (${refused.id ?? '?'}: ${refused.message ?? '?'})`);
      }
      return [];
    } catch (e) {
      this.log(`baton: the activities call failed (${msg(e)}) — kept for the next beat`);
      return activities;
    }
  }

  /** The end a dropped request never landed: retried on every beat until Baton answers (§6.5's
   * own resumable state — the claim is `in-review`'s sibling, ended in spirit, pending on the
   * wire). */
  private async retryEnd(): Promise<void> {
    for (const [claimId, body] of [...this.pendingEnds]) {
      try {
        await this.o.api.end(claimId, body);
        this.pendingEnds.delete(claimId);
      } catch (e) {
        if (e instanceof BatonRefusal && e.code === 'claim-ended') this.pendingEnds.delete(claimId);
        else this.log(`baton: retrying the end Baton never answered (${msg(e)})`);
      }
    }
  }

  // ── the loop ─────────────────────────────────────────────────────────────────────────────

  /** Claim and run tickets until `stop()`; a failure between claims is logged, never fatal.
   * Idle, the runner asks for recommendations when a heartbeat carried an `unblocked` message
   * (R-BTN-77) and otherwise at its own interval — each idle attempt asks first, then claims. */
  /** Stop taking work, gracefully: the current leg completes, the claim ends at the next leg
   * boundary with its hand-off, and the runner exits cleanly (the owner, 2026-10-24: 'let the
   * runner complete the current leg, then gracefully shut down'). A second signal goes the
   * immediate path — the caller decides what that is. */
  drain(why: string): void {
    if (this.draining) return;
    this.draining = true;
    this.log(`baton: draining (${why}) — the current leg completes, the claim ends at its boundary, then this runner exits without claiming again`);
  }

  /** Whether a drain has been asked (a signal's or a wind-down message's) — B-109's test seam. */
  isDraining(): boolean {
    return this.draining;
  }

  /** B-109: kill the leg in flight's whole process group — the lease-loss mechanism
   *  (`killGroup`, no hand-off; the resume record covers the leg, R-BTN-24), for the immediate
   *  stop's last resort: a leg child that will not take its release must not outlive the
   *  runner as an orphan pushing against a claim the reaper takes. No leg in flight: nothing. */
  killInflight(): void {
    // The call is killed; its session stays for the hand-off the release still writes, and
    // goes when the claim ends. B-188: every claim's leg.
    for (const x of this.liveSlots()) if (x.inflight?.child) this.killGroup(x.inflight.child);
  }

  /** B-227: the immediate stop's last resort, when the leg would not take its release in time:
   *  the call is killed and its session stopped — an executor's sandbox ends with the runner,
   *  never outliving it — before the caller exits. The claim is left to the reaper (R-BTN-24). */
  async hardStop(): Promise<void> {
    this.killInflight();
    const live = this.liveSlots();
    await Promise.all((live.length ? live : [this.solo]).map((x) => this.stopSlotSession(x, 'hard-stop')));
  }

  /** B-109: the immediate stop — a safe point, not an abandonment. The leg in flight is
   *  released at its next safe point (its hand-off written, the claim ended
   *  `released:requested`), and the loop ends without claiming again. `stopped` stays false
   *  by design: it is the lease-loss race's word, and setting it would kill the leg's whole
   *  group with no hand-off — the very abandonment this path exists to prevent (SIGINT, SIGHUP,
   *  a second SIGTERM). */
  stopNow(): void {
    if (!this.draining) {
      this.draining = true;
      this.log('baton: stopping at once (the immediate stop) — the leg in flight is released at its next safe point with its hand-off, the claim ends released, and this runner exits without claiming again');
    }
    // B-188: every leg in flight, each claim ended at its own safe point.
    for (const x of this.liveSlots()) this.signalSlot(x, 'release', 'released:requested');
  }

  async work(): Promise<void> {
    this.ensureFatalHooks();
    this.start();
    while (!this.stopped && !this.draining) {
      try {
        if (this.concurrency === 1) {
          // One claim at a time: today's loop exactly.
          const outcome = await this.runOnce();
          if (!outcome) await this.idleWait();
          continue;
        }
        // R-BTN-72 (B-188): claims side by side, each on its own task — asked for while the
        // runner holds fewer than its bound.
        const next = await this.claimNext();
        if (next) {
          this.track(this.runInSlot(next.claim, next.slot));
          continue;
        }
        if (this.slots.size >= this.concurrency) await this.roomWait();
        else await this.idleWait();
      } catch (e) {
        // R-BTN-197 (B-254): a runner the deploy refuses as too old takes no claim — every call
        // of its own would be refused the same way — logs the versions it and Baton name, and
        // exits non-zero. The claim it held ends as its lease lapses (R-BTN-9); nothing of the
        // runner's own updates it. The version prints as the header writes it (`baton/<version>`,
        // what Baton recorded from this runner's own claim), the warning's one form.
        if (e instanceof BatonRefusal && e.code === 'client-too-old') {
          const v = e.versions;
          this.log(`baton: Baton refuses this client — ${v ? `this runner is baton/${v.client}; Baton serves min ${v.min}, recommended ${v.recommended}` : e.message}; no claim is taken, and this runner exits: update it at your own pace (nothing updates itself, R-BTN-197)`);
          process.exit(1);
        }
        this.log(`baton: the loop failed (${msg(e)}) — retrying after a beat`);
        await this.idleWait();
      }
    }
    // Draining (or stopped): every claim still running ends at its own boundary first.
    await Promise.allSettled([...this.tasks]);
  }

  /** B-188: a claim's run on its own task — a failure is the loop's line, never another claim's. */
  private track(task: Promise<ClaimOutcome>): Promise<ClaimOutcome | null> {
    const t: Promise<ClaimOutcome | null> = task.catch((e) => {
      this.log(`baton: the loop failed (${msg(e)}) — retrying after a beat`);
      return null;
    });
    this.tasks.add(t);
    void t.finally(() => this.tasks.delete(t));
    return t;
  }

  /** B-188: the runner holds its bound — wait until a claim ends (or the runner stops). */
  private async roomWait(): Promise<void> {
    while (!this.stopped && !this.draining && this.slots.size >= this.concurrency) await sleep(Math.min(50, this.o.beatEvery));
  }

  /** B-94: a runner's death always leaves a line. An unhandled rejection the loop did not catch
   * and an uncaught exception are logged with the claim, the leg in flight and the last beat,
   * then the process ends as Node would have ended it (code 1). The handlers are process-wide and
   * installed once across every runner in the process; the picking-up runner's `log` is used. */
  private ensureFatalHooks(): void {
    const g = globalThis as { __batonFatalHooks?: boolean };
    if (g.__batonFatalHooks) return;
    g.__batonFatalHooks = true;
    // B-94 (review round 1): the crash report keeps the stack — `msg` alone discards what
    // Node's default fatal path would have printed — and the line is written to fd 1
    // synchronously, because nothing pending survives the `process.exit` that follows.
    const active = this;
    const fatal = (why: string, e: unknown): never => {
      const report = e instanceof Error ? (e.stack ?? e.message) : msg(e);
      const line = `baton: the runner crashed (${report}) — ${active.lastLine(why)}`;
      try { writeSync(1, (active.verbose ? stampLine(line) : line) + '\n'); } catch { /* stdout gone */ }
      process.exit(1);
    };
    process.on('uncaughtException', (e: unknown) => { fatal('uncaught exception', e); });
    process.on('unhandledRejection', (e: unknown) => { fatal('unhandled rejection', e); });
  }

  /** The idle wait: a beat long, unless an `unblocked` message ends it early. */
  private async idleWait(): Promise<void> {
    const until = this.now() + this.o.beatEvery;
    while (!this.stopped && !this.draining && !this.unblocked && !this.roomMade && this.now() < until) await sleep(Math.min(50, this.o.beatEvery));
    this.unblocked = false;
    this.roomMade = false;
  }

  /** One claim's whole run — or one idle attempt, returning null when nothing was claimable. */
  async runOnce(): Promise<ClaimOutcome | null> {
    const next = await this.claimNext();
    if (next) return await this.runInSlot(next.claim, next.slot);
    // R-BTN-72 (B-188): a claim reattached after a restart runs on its own task; an attempt
    // that claimed nothing beside it is that claim's run.
    const resumed = this.resumed.shift();
    if (resumed) return await resumed;
    return null;
  }

  /** One claim attempt (R-BTN-72): the claim Baton granted, in a fresh slot already held, or
   *  null when nothing was claimable — or when the runner holds its bound (B-188). */
  private async claimNext(): Promise<{ claim: Record<string, any>; slot: Slot } | null> {
    this.roomMade = false;
    // The worker must exist before it can claim (§5): one heartbeat registers it. Whether this
    // attempt is the registration (B-93) is read before this attempt's own beat: an attempt that
    // finds no worker is the one whose heartbeat creates it, so nothing it asks before that beat
    // is authenticated.
    const registered = this.state.get().worker_id != null;
    // B-93 (review round 1): the beat must be *finished* here, not merely started. During it
    // Baton already holds the new worker's secret — `beatOnce` sends `secret_hash` for one the
    // state does not name yet — but the state names neither the worker nor the re-key until the
    // answer, so a recommendation that overlapped a slow beat was refused `unauthenticated` and
    // logged: the first-beat noise again. `tick()` refuses to run beside a beat (it returns at
    // once while the timer's is out), so a beat in flight is waited for, never skipped.
    await this.waitForBeat();
    // The wait may have been the boot beat that registered this worker (review round 2, finding
    // 3): its answer names the worker in the state, so the id is read again here — never before
    // the wait, or every `start()` → `work()` start beat a second time for nothing — and by
    // `stray` too, so a registration attempt is the one that began with no worker at all.
    const worker = this.state.get().worker_id;
    // A beat of the attempt's own, when no worker is named yet; the recommendation after it is the
    // first ask of one Baton may hold no secret for, so it is a registration attempt too.
    let beating = false;
    if (worker == null) { await this.tick(); beating = true; }
    // R-BTN-72 (B-188): the claims the state file named when this process started — reattached
    // within the lease when the executor can, else ended — before any claim of this process.
    await this.settlePersisted();
    // One claim at a time: a reattached claim is this attempt's run (`runOnce` awaits it).
    if (this.concurrency === 1 && this.resumed.length) return null;
    // B-229: and what this host's earlier sessions still hold — each start is a new session with
    // a new state file, so the orphan above never sees them.
    await this.endEarlierSessions();
    // R-BTN-4 (B-188): no room — the runner holds its bound.
    if (this.slots.size >= this.concurrency) return null;
    // B-86: the claim goes out only on the declaration the server holds — `sent` is the list the
    // last answered beat carried, which is what `rewriteSettings` recorded. A runner whose grant
    // arrived on a beat that declared nothing must beat once more before claiming (review round
    // 3): the first claim, and every idle attempt, otherwise goes out while the server still sees
    // `[]` and rule 4 refuses each leg. A grant-less answer leaves the declaration unsettled, so
    // each attempt asks again until a grant arrives (finding 6).
    // Review round 4 (finding 4): one beat may not be enough — a restart from a pre-B-86 state
    // file (`worker_id` set, no `declared`) beats at that moment declaring `[]` and settles the
    // grant, which leaves `sent` ≠ the list this claim carries. So beat again while they differ,
    // at most MAX_STALE_BEATS times a claim attempt; a grant-less answer (`grantAsked`) ends the
    // loop after its one beat, as it always did — the declaration is unsettled and the claim goes
    // out on what this runner named.
    for (let n = 0; n < MAX_STALE_BEATS; n++) {
      const claimOn = this.declaringList();
      const stale = this.grantAsked || this.sent == null || JSON.stringify(this.sent) !== JSON.stringify(claimOn);
      if (!stale) break;
      await this.tick();
      // B-93: this may have been the first beat Baton has an answer of a just-registered worker
      // for (the boot beat carried no grant, so `grantAsked` sent this one). Only an attempt that
      // BEGAN unregistered is a registration's (round 3, 3-r0-2): a settled worker's own forced
      // beat is not one, and its refusal is news like any other.
      beating = !registered;
      if (this.grantAsked) break;
    }
    // An empty declaration is not "nothing to do" (finding 5): rule 4 passes any declaration for
    // a ticket with no `Requires:` clause, so it still claims — the line below explains what it
    // can never take, once, since every idle attempt returns here.
    if (this.declared?.length === 0 && this.o.capabilities == null && !this.saidEmpty) {
      this.saidEmpty = true;
      this.log(`baton: this runner declared nothing — its key's grant allows no capability on the repositories its courses are in, so every leg requiring one refuses it rule 4 (missing-capability); have the owner grant it (baton owner grant <repository> --key …, R-BTN-58)`);
    }
    // R-BTN-72: it recommends, then claims — the first recommendation is what a claim without
    // an id would take anyway, asked for here so the runner knows what it is going for.
    let wanted: string | undefined;
    try {
      const recs = await this.o.api.recommendations();
      wanted = (recs.recommendations ?? [])[0]?.ticket_id;
    } catch (e) {
      if (!(e instanceof BatonRefusal)) throw e;
      // A worker the gates refuse entirely still claims below: Baton's refusal is the answer.
      // B-93: the registration beat's own refusal — the recommendation right after the beat that
      // registered this session, refused `no worker holds this secret` before a worker exists —
      // is not news, and is not logged (2026-10-21's runs: every start printed it). Only that
      // refusal goes quiet: `authWorker` answers `unauthenticated` for a missing
      // `X-Worker-Secret` and a replayed nonce too, and a registered worker's refusal (a
      // replaced secret) still names itself. The registration is either a state with no worker
      // before this attempt or a beat of this attempt's own, whose answer Baton may have no
      // secret for — never a resumed worker's ordinary attempt.
      const stray = (beating || !registered) && e.code === 'unauthenticated' && /no worker holds this secret/.test(e.message);
      if (!stray) this.log(`baton: no recommendation (${e.message})`);
    }
    let claim: Record<string, any>;
    const requestId = `run-${randomBytes(8).toString('hex')}`;
    this.claimsOut++;
    try {
      claim = await this.o.api.claim({ request_id: requestId, ...(wanted ? { ticket_id: wanted } : {}) });
    } catch (e) {
      // B-106 (R-BTN-178): a refused claim releases the locks it would have used — the machine's
      // singleton is not held by an idle runner (B-188: nor taken from a claim's running leg).
      if (this.locks && e instanceof BatonRefusal) this.locks.releaseAll((c) => this.lockHeldByLive(c, null));
      if (e instanceof BatonRefusal && e.code === 'no-eligible-ticket') return null;
      if (e instanceof BatonRefusal && e.code === 'not-eligible' && /already held|worker-holds/.test(e.message)) {
        // The worker still holds a claim Baton knows and this runner does not (its state was
        // lost with the container): the heartbeat's claim view named it, so end it loudly
        // rather than idling on the refusal forever.
        const held = this.slots.size === 0 ? this.state.get().claim : null;
        this.log(`baton: the claim was refused — this worker still holds ${held ? `claim ${held.id}` : 'a claim'} (${e.message})`);
        if (held) {
          this.state.set({ claim: null });
          await this.endQuietly(held.id, { end_reason: 'released:lease-lost', next: null });
        }
        return null;
      }
      // R-BTN-4 (B-188): `max-claims` among them — the runner is at its bound for now.
      if (e instanceof BatonRefusal && e.code === 'not-eligible') return null;
      throw e;
    } finally {
      this.claimsOut--;
    }
    this.epoch++;
    const ticket = claim.ticket_id as string;
    const claimId = claim.claim_id as number;
    // R-BTN-4 (B-188): the claim's slot is held from here — before any await, so no beat can
    // read a claim Baton granted as one this runner does not hold.
    const slot = this.newSlot();
    slot.claimId = claimId;
    slot.ticket = ticket;
    slot.nonce = String(claim.nonce ?? '');
    slot.requestId = requestId;
    this.slots.add(slot);
    this.writeClaims();
    // B-127 item 7: the brief's mark, posted whether or not signed control is required — an
    // unsigned `**Brief:** the owner …` line is a claim, not the owner (the standing CLAUDE.md
    // rule), and the log says so before any agent is told to read the ticket. B-126
    // (R-BTN-194): beside it, who pushed the ticket's last change — the session's first sight of
    // whose words steer it.
    const brief = claim.brief as { signed?: boolean; signer?: string; commit?: string } | undefined;
    const wrote = claim.last_written_by as { pusher?: string; commit?: string } | undefined;
    this.log(`baton: claimed ${ticket} at ${claim.station}, queued leg ${claim.legs?.[0]}${this.verbose ? ` (claim ${claimId}, nonce ${claim.nonce})` : ''}`
      + (brief ? ` — brief ${brief.signed ? 'owner-signed' : `unsigned (changed at ${String(brief.commit).slice(0, 8)}): a claim, not the owner`}` : '')
      + (wrote?.pusher ? ` — ticket last written by ${wrote.pusher}${wrote.commit ? ` at ${String(wrote.commit).slice(0, 8)}` : ''}` : ''));
    return { claim, slot };
  }

  /** B-188: a fresh slot — in the home checkout at one claim, else in a free clone of its own. */
  private newSlot(at?: string): Slot {
    if (this.concurrency === 1) return new Slot(at ?? this.o.home);
    if (at != null && at !== this.o.home) {
      const n = Number(basename(at));
      const slot = new Slot(at);
      if (resolve(dirname(at)) === resolve(this.clonesDir()) && Number.isInteger(n)) {
        slot.cloneIndex = n;
        this.clonesBusy.add(n);
      }
      return slot;
    }
    let n = 1;
    while (this.clonesBusy.has(n)) n++;
    this.clonesBusy.add(n);
    const slot = new Slot(join(this.clonesDir(), String(n)));
    slot.cloneIndex = n;
    return slot;
  }

  /** B-188: where the clones live — `clonesDir`, else beside the state file, keyed by the home. */
  private clonesDir(): string {
    return this.o.clonesDir ?? join(dirname(this.o.stateFile), 'clones', createHash('sha1').update(resolve(this.o.home)).digest('hex').slice(0, 12));
  }

  /** B-188: one claim's whole run, bound to its slot — the slot is let go, its clone freed and
   *  the state file's claims rewritten when it ends, whatever ended it. */
  private async runInSlot(claim: Record<string, any>, slot: Slot, resume?: Resume): Promise<ClaimOutcome> {
    try {
      return await this.als.run(slot, () => this.runClaim(claim, resume));
    } finally {
      slot.ended = true;
      this.slots.delete(slot);
      for (const [c, owner] of [...this.lockOwners]) if (owner === slot) this.lockOwners.delete(c);
      if (slot.cloneIndex != null) this.clonesBusy.delete(slot.cloneIndex);
      this.writeClaims();
      this.roomMade = true;
    }
  }

  /** B-106, B-188: whether a machine lock is held for another claim's leg than `except`'s. */
  private lockHeldByLive(capability: string, except: Slot | null): boolean {
    const owner = this.lockOwners.get(capability);
    return owner != null && owner !== except && this.slots.has(owner) && !owner.ended;
  }

  /** R-BTN-72 (B-188): the claims this process found in its state file, settled once before its
   *  first claim. A claim written before B-188 (`claim` alone), or any when the lease had already
   *  lapsed, is an orphan, ended `released:lease-lost` as before. Within the lease, a claim Baton
   *  still lists is reattached when the executor can reach its leg's session — the persisted
   *  secret was resumed, never re-keyed — and its leg carries on; one it cannot reach is ended
   *  `released:cannot-finish:transient`. One Baton no longer lists is let go. */
  private settledPersisted = false;
  private async settlePersisted(): Promise<void> {
    if (this.settledPersisted) return;
    this.settledPersisted = true;
    for (const p of [...this.persisted]) {
      const drop = () => {
        this.persisted = this.persisted.filter((x) => x.id !== p.id);
        this.writeClaims();
      };
      if (this.legacy.has(p.id) || !this.startedInLease) {
        this.log(`baton: ending the orphaned claim ${p.id} on ${p.ticket_id} before claiming`);
        drop();
        await this.endQuietly(p.id, { end_reason: 'released:lease-lost', next: null });
        continue;
      }
      if (this.answerClaims != null && !this.answerClaims.has(p.id)) {
        this.log(`baton: claim ${p.id} on ${p.ticket_id}, held before this restart, is no longer Baton's to give back — let go`);
        drop();
        continue;
      }
      const reattached = await this.reattach(p);
      if ('handle' in reattached) {
        const slot = this.newSlot(p.checkout ?? this.o.home);
        slot.claimId = p.id;
        slot.ticket = p.ticket_id;
        slot.nonce = p.nonce;
        slot.requestId = p.request_id;
        this.epoch++;
        this.slots.add(slot);
        this.persisted = this.persisted.filter((x) => x.id !== p.id);
        this.writeClaims();
        this.log(`baton: reattached to claim ${p.id} on ${p.ticket_id}'s ${p.leg} (session ${String(p.handle?.session_id ?? '?')}) after the restart — it carries on (R-BTN-72)`);
        const task = this.track(this.runInSlot(reattached.claim, slot, {
          leg: p.leg!, at: p.at!, runId: p.run_id ?? null, seq: p.seq ?? null, ctx: p.ctx!, handle: reattached.handle,
        }));
        if (this.concurrency === 1) this.resumed.push(task);
        continue;
      }
      this.log(`baton: claim ${p.id} on ${p.ticket_id} was held before this restart and its leg cannot be reattached (${reattached.why}) — ending it released:cannot-finish:transient (R-BTN-72)`);
      drop();
      await this.endQuietly(p.id, { end_reason: 'released:cannot-finish:transient', next: null });
    }
  }

  /** R-BTN-72 (B-188): reconnect to a persisted claim's running leg — the executor's `reattach`
   *  over the handle its state kept, and the claim's answer again by its `request_id` (the same
   *  claim, G-BTN-2) — or why not. */
  private async reattach(p: PersistedClaim): Promise<{ handle: Handle; claim: Record<string, any> } | { why: string }> {
    const reattach = this.executor.reattach;
    if (typeof reattach !== 'function') return { why: `the ${this.executor.source} executor offers no reattach` };
    if (!p.handle || !p.leg || !p.at || !p.ctx || !p.request_id) return { why: 'no leg session was running' };
    let handle: Handle | null;
    try {
      handle = await reattach.call(this.executor, p.handle);
    } catch (e) {
      return { why: `the executor's reattach failed (${msg(e)})` };
    }
    if (handle == null) return { why: 'the executor cannot reach its session' };
    try {
      const claim = await this.o.api.claim({ request_id: p.request_id });
      if (claim?.claim_id !== p.id) throw new Error(`the request answered claim ${String(claim?.claim_id)}`);
      return { handle, claim };
    } catch (e) {
      await this.executor.stop(handle, 'cannot-resume').catch(() => {});
      return { why: `the claim's answer could not be read again (${msg(e)})` };
    }
  }

  /** The course a claim runs (B-103, §11's claim answer): the one its answer names — `course_id`, the ticket's
   *  course at the claim's snapshot — which one runner loads per claim, so a `create-spec` leg and
   *  the next claim's `create-pr` leg are consecutive legs of the same runner. A claim answered
   *  with no course (a pre-B-103 answer) falls back to the one course the runner declares, and is
   *  refused loudly with several rather than guessed: the snapshot's own several-course list is
   *  never a choice the runner may make (`courseOf`). */
  private claimCourse(claim: Record<string, any>): string {
    const named = claim.course_id as string | null | undefined;
    // A narrowed runner (--course) serves ONE course; a claim answered for another is refused
    // here as well as by the server's rule 9 — the two must agree on their own, and a server
    // bug or an older instance must never make a narrowed machine run a course it never
    // declared (round 1, 1-A-1).
    if (named != null && named !== '' && !this.o.courses.some((c) => c.course === named)) {
      throw new Error(`the claim is for course ${named}, but this runner serves ${this.o.courses.map((c) => c.course).join(', ')} — a --course runner never runs one it did not declare`);
    }
    // The claim's own course; a pre-B-103 answer's fallback is the one course a one-course runner
    // declares — and with several the refusal below, never a guess at the snapshot's list.
    const want = named != null && named !== '' ? named : this.o.courses.length === 1 ? this.o.courses[0].course : null;
    if (want == null) throw new Error(`the claim names no course and this runner declares ${this.o.courses.length} (${this.o.courses.map((c) => c.course).join(', ')}) — the runner never guesses which course a claim is on`);
    // The snapshot must carry it — `courseOf`'s refusal is what makes a moved course loud.
    return courseOf(this.o.home, claim.snapshot_sha as string, want);
  }

  /** B-183 (§4.5): whether the claim's ticket still reads at the version the claim names. The
   *  `why` is null when it does — or there is nothing to compare, a board that held no version
   *  for the ticket or a source that declared no way of reading, which run exactly as before. A
   *  string is why not, for the log, and the claim releases `stale-board` before any leg runs.
   *  The version is the source's opaque string (the markdown source's is the ticket file's blob
   *  id); the source at the claim's snapshot decides how it is read — `pinned` at the version,
   *  `current` as the store holds the ticket now — and Baton, never the runner, orders nothing.
   *  A source that declares `versions` but exports no `read` cannot read at all — the CLI
   *  refuses one at load (§4.2), so this is a source the snapshot broke — and the claim releases
   *  rather than run with no re-verification (round 1).
   *
   *  B-190 (R-BTN-84): a read that succeeded is also the claim's recorded read — its digest
   *  joins the run's inputs (`leg_run_inputs`), so replay re-reads the same way and compares.
   *  B-252: the read's `ticket` rides back too, for a pathless ticket's leg file (below). */
  private async verifyTicketVersion(claim: Record<string, any>, scratch: string): Promise<{ why: string | null; read: { version: string; read_digest: string } | null; ticket?: unknown }> {
    const version = typeof claim.version === 'string' ? claim.version : '';
    const how = (claim.ticket_source ?? null) as { versions?: string | null } | null;
    if (version === '' || how?.versions == null) return { why: null, read: null };
    // R-BTN-107 (B-184): the repository's ticket source runs only through the executor, in a
    // `source` session; the CLI's own markdown source (no `.baton/tickets.mjs`) runs here.
    const file = extractTicketSource(this.o.home, claim.snapshot_sha as string, scratch);
    if (file != null) return await this.verifyBySource(file, claim, version, scratch);
    const src = MARKDOWN_SOURCE as unknown as Record<string, unknown>;
    // A source that declares neither `versions` nor `read` is read as declaring nothing (§4.2):
    // an existing custom source keeps working until it opts in.
    if (typeof src.versions !== 'string' || !['pinned', 'current'].includes(src.versions)) return { why: null, read: null };
    if (typeof src.read !== 'function') return { why: `the ticket source declares versions: ${JSON.stringify(src.versions)} but exports no read — the ticket cannot be re-verified at it (R-BTN-74)`, read: null };
    const read = src.read as (id: string, o: { version?: string; checkout?: string }) => Promise<{ version?: unknown; ticket?: unknown } | null>;
    const id = bareTicketId({ id: claim.ticket_id as string });
    try {
      if (src.versions === 'pinned') {
        const out = await read(id, { version, checkout: this.checkout });
        if (out == null || out.ticket == null) return { why: `the ticket cannot be read at its version ${version.slice(0, 16)}`, read: null };
        return { why: null, read: { version, read_digest: digestOfRead(out.ticket) }, ticket: out.ticket };
      }
      const out = await read(id, { checkout: this.checkout });
      if (out == null) return { why: 'the ticket source no longer reads the ticket', read: null };
      if (out.version !== version) return { why: `the ticket's version is ${typeof out.version === 'string' && out.version !== '' ? out.version.slice(0, 16) : '(none)'}, the claim's ${version.slice(0, 16)}`, read: null };
      return { why: null, read: { version, read_digest: digestOfRead(out.ticket) }, ticket: out.ticket };
    } catch (e) {
      return { why: `the ticket source's read failed (${msg(e)})`, read: null };
    }
  }

  /** §4.5 (R-BTN-74) through the executor: the source's `versions` and `read`, each a wrapper call
   *  in one `source` session, stopped when the check ends. Same answers as the in-process check. */
  private async verifyBySource(file: string, claim: Record<string, any>, version: string, scratch: string): Promise<{ why: string | null; read: { version: string; read_digest: string } | null; ticket?: unknown }> {
    let handle: Handle;
    try {
      handle = await this.startSession('source', { session_id: `source-${randomBytes(6).toString('hex')}`, snapshot_sha: String(claim.snapshot_sha ?? ''), paths: [scratch], env: this.baseEnv() });
    } catch (e) {
      return { why: `the executor could not start the ticket source's session (${msg(e)})`, read: null };
    }
    try {
      const call = async (fn: string, args: unknown[]) => {
        const out = wrapperOutcome((await this.wrapperCall(handle, fn, file, args, 120).result).stdout);
        if (out == null) throw new Error(`the ticket source's ${fn} wrote no outcome`);
        if (!out.ok) throw new Error(out.error ?? `the ticket source's ${fn} failed`);
        return out.result;
      };
      let versions: unknown;
      try {
        versions = await call('describe', []);
      } catch (e) {
        return { why: `the ticket source at the snapshot would not load (${msg(e)})`, read: null };
      }
      const v = (versions ?? {}) as { versions?: unknown; read?: boolean };
      if (typeof v.versions !== 'string' || !['pinned', 'current'].includes(v.versions)) return { why: null, read: null };
      if (!v.read) return { why: `the ticket source declares versions: ${JSON.stringify(v.versions)} but exports no read — the ticket cannot be re-verified at it (R-BTN-74)`, read: null };
      const id = bareTicketId({ id: claim.ticket_id as string });
      try {
        if (v.versions === 'pinned') {
          const out = await call('read', [id, { version, checkout: this.checkout }]) as { ticket?: unknown } | null;
          if (out == null || out.ticket == null) return { why: `the ticket cannot be read at its version ${version.slice(0, 16)}`, read: null };
          return { why: null, read: { version, read_digest: digestOfRead(out.ticket) }, ticket: out.ticket };
        }
        const out = await call('read', [id, { checkout: this.checkout }]) as { version?: unknown; ticket?: unknown } | null;
        if (out == null) return { why: 'the ticket source no longer reads the ticket', read: null };
        if (out.version !== version) return { why: `the ticket's version is ${typeof out.version === 'string' && out.version !== '' ? out.version.slice(0, 16) : '(none)'}, the claim's ${version.slice(0, 16)}`, read: null };
        return { why: null, read: { version, read_digest: digestOfRead(out.ticket) }, ticket: out.ticket };
      } catch (e) {
        return { why: `the ticket source's read failed (${msg(e)})`, read: null };
      }
    } finally {
      await this.executor.stop(handle, 'source-checked').catch(() => {});
    }
  }

  /** B-106 (R-BTN-178): take every lock the leg requires before the claim's work or the advance
   *  starts, and release those an earlier leg of the claim needed and this one does not — the
   *  lock is held from before the leg starts until the claim ends or leaves the legs requiring
   *  it. False when a lock another process on this machine holds could not be taken: the caller
   *  suspends rather than run the leg, or send the advance (R-BTN-121, R-BTN-71). */
  private async ensureLegLocks(leg: string, course: CourseLoad): Promise<boolean> {
    const locks = this.locks;
    if (!locks) return true;
    const needed = (course.graph.legs.get(leg)?.requires ?? []).filter((c) => locks.manages(c));
    const slot = this.cur;
    let ok = true;
    for (const capability of needed) {
      // B-188: one machine's singleton is one leg's, whichever claim runs it — another claim's
      // leg holding it is a lock this claim cannot take.
      if (this.lockHeldByLive(capability, slot)) ok = false;
      else if (!(await locks.take(capability))) ok = false;
      else this.lockOwners.set(capability, slot);
    }
    // Released: what this claim's earlier leg needed and this one does not — never a lock
    // another claim's leg holds.
    locks.releaseAll((c) => needed.includes(c) || this.lockHeldByLive(c, slot));
    for (const [c, owner] of [...this.lockOwners]) if (owner === slot && !needed.includes(c)) this.lockOwners.delete(c);
    if (!ok) {
      this.log(`baton: ${leg} requires a lock another process on this machine holds — the claim suspends rather than run it (R-BTN-178)`);
      return false;
    }
    // A take the last answered beat did not declare is followed by a beat before the caller
    // goes on: rule 4 re-checks the advance against the server's record of the declaration, so
    // a lock re-taken mid-claim (an unlocked leg between two locked ones released it) must be
    // declared again before the advance that needs it is sent, or the server refuses
    // `missing-capability` a machine that holds the thing cannot be refused (review round 1,
    // finding 2). At most two beats: the first may join the timer's in-flight one, which built
    // its declaration before the take (round 2, finding 2) — the second is fresh. A capability
    // the runner's own list never names cannot be declared at all, so it asks for no beat
    // (round 2, finding 4).
    const sendable = needed.filter((c) => (this.declared ?? this.o.capabilities ?? []).includes(c));
    for (let beats = 0; beats < 2 && sendable.some((c) => this.sent != null && !this.sent.includes(c)); beats++) await this.tick();
    return true;
  }

  /** B-127 (R-BTN-66 as amended, R-BTN-133's verified tree extended): the signed-control record
   *  of a claim whose repository requires it — verified here, never only by the sync that posted
   *  it (the adversarial review's finding 4): each group's `read` commit must be in the home
   *  checkout, carry a valid `git`-namespace SSHSIG by one of the owner keys the answer names
   *  (the keys Baton served, never any the post chose), be an ancestor of the claim's
   *  snapshot, and be the commit the walk itself names — round 2: `--is-ancestor` refuses an
   *  off-branch commit, but an OLD owner-signed commit on the snapshot's own line (the rollback
   *  the first-parent rule exists to prevent) still verifies and descends, so the runner
   *  recomputes the group walk at the claim's snapshot, with `controlGroupsOf` — the same walk,
   *  code and key order the sync ran — and refuses a `read` that disagrees; an old or off-branch
   *  signed commit never loads, whatever a record says. A group naming a signing key is what
   *  the legs load `agent_command`, the overrides and `rank.mjs` from, and what the course
   *  group's commit — the course's graph, its leg scripts and their instruction `.md` files,
   *  one coherent tree — loads at; a group naming no key is the pre-adoption baseline, honest
   *  only as the claim's own snapshot and only while the walk there finds no change to the
   *  group (round 4: the keyless shape is held to the walk like the keyed one), and gates
   *  nothing; a group with no
   *  signed version at all fails closed: Baton hands out no claim in that state (round 1,
   *  unpenalised), and this check remains the last line; the runbook
   *  (docs/runbooks/owner-signed-control.mdx) walks the owner through signing once. */
  private async verifyControl(claim: Record<string, any>): Promise<Record<string, string> | { error: string }> {
    const control = claim.control as { required?: boolean; keys?: unknown } & Partial<Record<'agent_command' | 'overrides' | 'rank' | 'course', { read?: unknown; key?: unknown }>> | null | undefined;
    if (!control?.required) return {};
    const keys = Array.isArray(control.keys) ? control.keys.filter((k): k is string => typeof k === 'string' && k !== '') : [];
    // Round 2 (the on-branch rollback): recomputed once, compared per group — the walk is the
    // runner's own word over its home checkout's history, never the record's.
    const recomputed = keys.length ? controlGroupsOf(String(claim.snapshot_sha), keys.map((k) => ({ public_key: k, fingerprint: '' })), (...args) => git(this.o.home, args), nodeKeygen) : null;
    const out: Record<string, string> = {};
    for (const group of ['agent_command', 'overrides', 'rank', 'course'] as const) {
      const read = control[group]?.read;
      const key = control[group]?.key;
      if (typeof read !== 'string' || read === '') {
        return { error: `the repository requires owner-signed control and no owner-signed version of ${group} exists — an owner signs the current state once and the next post names it (B-127)` };
      }
      // The baseline: no signing key named, nothing gated for this group — and honest only as
      // the claim's own snapshot (round 1: a record naming any other commit with no key is a
      // lie or an edge, and never ungates the group on its word alone).
      if (key == null) {
        if (read !== claim.snapshot_sha) {
          return { error: `the ${group} group names commit ${read.slice(0, 10)} with no signing key — only the snapshot itself (${String(claim.snapshot_sha).slice(0, 10)}) may stand as the unsigned baseline (B-127)` };
        }
        // Round 4 (the keyless lie): the keyless shape is held to the walk too — honest only
        // when no commit in the walk's window changed the group at the snapshot (the group
        // predates the walk's memory). A group with changes is either signed (a keyed read) or
        // the fail-closed no-signed-version state, so a record naming the snapshot with no key
        // over a nonempty log — `{read: <head>, key: null}` written over an unsigned push —
        // refuses here, before the stub would read the group at the snapshot's pushed bytes.
        let unchanged: boolean;
        try {
          unchanged = groupUnchangedAt(group, String(claim.snapshot_sha), (...args) => git(this.o.home, args));
        } catch (e) {
          return { error: `the ${group} group's history at the snapshot would not read (${msg(e).slice(0, 80)}) — refusing the keyless baseline (B-127)` };
        }
        if (!unchanged) {
          return { error: `the ${group} record names the snapshot with no signing key, but the walk there finds changes to the group — not the unsigned baseline; refusing to load it (B-127)` };
        }
        continue;
      }
      if (!ensureSha(this.o.home, read, () => this.o.fetch?.(this.o.home))) {
        return { error: `the owner-signed ${group} commit ${read.slice(0, 10)} is not in the home checkout — one fetch could not find it (B-127)` };
      }
      let raw: string;
      try {
        raw = git(this.o.home, ['cat-file', 'commit', read]);
      } catch (e) {
        return { error: `the owner-signed ${group} commit ${read.slice(0, 10)} would not read (${msg(e)}) (B-127)` };
      }
      if (!verifySignedCommit(raw, keys, nodeKeygen)) {
        return { error: `the ${group} commit ${read.slice(0, 10)} the board post named carries no signature of an owner key — refusing to load it (B-127)` };
      }
      try {
        git(this.o.home, ['merge-base', '--is-ancestor', read, String(claim.snapshot_sha)]);
      } catch {
        return { error: `the owner-signed ${group} commit ${read.slice(0, 10)} is not an ancestor of the claim's snapshot — refusing to load it (B-127)` };
      }
      // Round 2 (the on-branch rollback): the record's word on WHICH ancestor counts is never
      // trusted alone — the walk at the snapshot, verified signature by verified signature,
      // names the one commit that may load, and a record naming any other refuses the claim.
      const walkRead = recomputed?.[group]?.read ?? null;
      if (walkRead !== read) {
        return { error: `the ${group} record names commit ${read.slice(0, 10)}, and the walk at the claim's snapshot names ${walkRead == null ? 'no signed version' : walkRead.slice(0, 10)} — the record does not match its own history, refusing to load it (B-127)` };
      }
      out[group] = read;
    }
    return out;
  }

  /** B-134: one read of the home checkout's remote refs for the leg-end scope audit — the
   *  injected reader's, or the runner's bounded git of the home checkout. A read that fails is
   *  logged and returns null: an unreadable audit is no audit, and never fails a leg. */
  private readRefs(): RefState | null {
    const read = this.o.auditRefs ?? ((home: string) => readRefState((args) => git(home, args)));
    try {
      return read(this.checkout);
    } catch (e) {
      this.log(`baton: the scope audit could not read the checkout's refs (${msg(e)}) — the audit is skipped for this leg`);
      return null;
    }
  }

  /** B-134: the leg-end scope audit. The refs the leg's window moved, mapped to the repositories
   *  their remotes point at and named by the reflog as pushes, are the runner's own evidence
   *  (the agent supplies none of it); the pushes outside the claim answer's `scope` are parked
   *  for the advance or end that finishes the leg, and the window moves to what was just read.
   *  A read that fails keeps the window — a later read may still see the movements — and a
   *  claim whose answer carried no scope audits nothing (a Baton before B-134). Called after
   *  the leg's close and hand-off have run wherever they run before the finishing call, so
   *  their pushes are the leg's too; the last sixteen out-of-scope actions are parked and the
   *  count of earlier ones rides with them. */
  private auditLeg(): void {
    if (this.auditScope == null || this.auditWindow == null) return;
    const after = this.readRefs();
    if (after == null) return; // unreadable: the window stays open for the next read
    const before = this.auditWindow;
    this.auditWindow = after;
    const outside = outsideScope(pushesBetween(before, after), this.auditScope);
    if (!outside.length) return;
    const ticket = this.inflight?.ticket ?? this.state.get().claim?.ticket_id ?? '';
    const leg = this.inflight?.leg ?? 'the leg';
    const parked = [...(this.pendingScope ?? []), ...outside];
    this.pendingScope = parked.slice(-16);
    this.scopeOverflow += Math.max(0, parked.length - 16);
    if (parked.length > 16) this.log(`baton: ${ticket}'s ${leg} pushed outside its ticket's scope ${parked.length} times — the report carries the last 16 and the count of the other ${parked.length - 16} (B-134)`);
    this.log(`baton: ${ticket}'s ${leg} pushed outside its ticket's scope: ${outside.map((a) => `${a.target}${a.ref ? ` (${a.ref})` : ''}`).join(', ')} — reported with the leg's finish (B-134)`);
  }

  private async runClaim(claim: Record<string, any>, reattached?: Resume): Promise<ClaimOutcome> {
    const claimId = claim.claim_id as number;
    const ticket = claim.ticket_id as string;
    let course: CourseLoad | null = null;
    let signedControl: Record<string, string> = {};
    // B-134: the parked report, its overflow count and the audit window belong to one claim
    // alone — an earlier claim's throw between parking and its finishing call must not land
    // that ticket's actions on this claim's report (and its end), so every claim starts clean.
    this.pendingScope = null;
    this.scopeOverflow = 0;
    this.auditWindow = null;
    this.auditScope = null;
    try {
      // R-BTN-34: the snapshot must be in the home checkout — one fetch, else stale-board.
      if (!ensureSha(this.o.home, claim.snapshot_sha, () => this.o.fetch?.(this.o.home))) {
        return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
      }
      // B-127 (R-BTN-133's verified tree, extended): where the repository requires owner-signed
      // control, verify the commits the board post names — here, in the runner, never only by
      // the sync that posted them — BEFORE the course loads (round 1: the leg scripts are the
      // code that enforces the gate, so they may not load from an unsigned snapshot). A failure
      // fails the claim closed: the ticket stays on the board for the owner's signature (the
      // `unsigned-control` notice names what to sign), and no agent runs code a push alone
      // placed. Baton hands out no claim while a group has no signed version, so this path is
      // a lying or stale record's.
      signedControl = await this.verifyControl(claim);
      if ('error' in signedControl) {
        this.log(`baton: ${signedControl.error}`);
        // Round 4: while the owner key register has moved since the record was computed (Baton
        // says so, comparing the record's keys with today's), a refusal is the record's age —
        // released as a stale board, unpenalised, until the next post re-computes it. Either
        // way nothing loads.
        if (claim.control?.register_moved === true) {
          this.log(`baton: the owner key register changed since the board post computed this record — released as a stale board until the next post (B-127)`);
          return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
        }
        return await this.finish(claimId, { end_reason: 'released:cannot-finish:spec', reached: claim.station, detail: signedControl.error, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
      }
      // B-127 (round 1, the course group): the course's graph and its leg scripts load — one
      // coherent tree — at the commit the record named and this runner verified; with the gate
      // off, the pre-adoption baseline, or a group that gates nothing, that is the claim's
      // snapshot itself. A course the signed commit does not carry refuses here (stale-board,
      // unpenalised): an unsigned course change keeps the last signed course in force, and a
      // course no owner signed does not run.
      const courseSha = typeof signedControl.course === 'string' && signedControl.course !== '' ? signedControl.course : claim.snapshot_sha as string;
      course = loadCourse(this.o.home, courseSha, this.claimCourse(claim));
      // B-228: the legs start from the snapshot's code — the home fast-forwarded to it when it
      // can be; otherwise it runs as it stands, and the log says why. A reattached leg's tree is
      // its running session's, and a claim in a clone of its own is put there below (B-188).
      if (!reattached && this.checkout === this.o.home) {
        let stays: string | null;
        try {
          stays = advanceHome(this.o.home, claim.snapshot_sha, typeof claim.default_branch === 'string' && claim.default_branch !== '' ? claim.default_branch : null);
        } catch (e) {
          stays = `the fast-forward failed (${msg(e)})`;
        }
        if (stays) this.log(`baton: the home stays at its own commit for ${ticket}, not the snapshot ${String(claim.snapshot_sha).slice(0, 10)}: ${stays}`);
      }
    } catch (e) {
      this.log(`baton: the claim's course would not load (${msg(e)})`);
      return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
    }
    // R-BTN-72 (B-188): a claim beside others works in a clone of its own — its own git dir, put
    // at the snapshot — so concurrent legs never write one tree, and its audit reads its own refs.
    if (!reattached && this.checkout !== this.o.home) {
      try {
        await prepareClone(this.o.home, this.checkout, String(claim.snapshot_sha), typeof claim.default_branch === 'string' && claim.default_branch !== '' ? claim.default_branch : null);
      } catch (e) {
        this.log(`baton: ${ticket}'s checkout ${this.checkout} could not be prepared (${msg(e)})`);
        dropCourse(course.scratch);
        return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
      }
      if (this.verbose) this.log(`baton: ${ticket} works in its own clone ${this.checkout} (R-BTN-72)`);
    }
    const scratch = claimScratch();
    // B-183 (§4.5, R-BTN-5/R-BTN-34): re-verify the ticket by its version before any leg runs.
    // The claim names the ticket's `version` as the board holds it and how its source reads; the
    // source at the claim's snapshot (else the CLI's markdown default) is the reader. A ticket
    // that moved under the claim releases `stale-board`; one that did not runs. The two
    // file-less cases (check tickets, a `cancel` claim) carry no version and are re-verified
    // against Baton's record as before. B-190: a read that succeeded is the claim's recorded
    // read — its digest joins every run's inputs (R-BTN-84), reported on each advance.
    const versionCheck = reattached ? { why: null, read: null } as Awaited<ReturnType<Runner['verifyTicketVersion']>> : await this.verifyTicketVersion(claim, course.scratch);
    if (versionCheck.why != null) {
      this.log(`baton: ${ticket}'s ticket moved under the claim — ${versionCheck.why}`);
      dropCourse(course.scratch);
      rmSync(scratch, { recursive: true, force: true });
      return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
    }
    // B-252 (R-BTN-74): a ticket with no `path` has no file in the checkout for the legs to read.
    // When the source's read handed its ticket back as text — the markdown a pathless source
    // returns, its frontmatter the markdown source's keys — that text is the legs' ticket file:
    // written once, mode 0600, into the claim's scratch (every leg session's path, removed at
    // the claim's end) and named to each leg as `ctx.ticket.file`. A ticket with a path, the
    // markdown source's every ticket, gets no file and its ctx is unchanged.
    let ticketFile: string | null = null;
    const resumedFile = (reattached?.ctx.ticket as { file?: unknown } | undefined)?.file;
    if (typeof resumedFile === 'string') ticketFile = resumedFile;
    else if ((claim.path == null || claim.path === '') && typeof versionCheck.ticket === 'string') {
      ticketFile = join(scratch, 'ticket.md');
      writeFileSync(ticketFile, versionCheck.ticket, { mode: 0o600 });
    }
    this.inflight = { claimId, ticket, course, leg: null, legAt: this.now(), child: null, waiters: [] };
    this.closedDone = false;
    // §2e/R-BTN-63: the legs git evidences are every earlier attempt's, flattened; the claim's
    // own legs are counted beside them when a leg's run number is taken.
    let gitPath = (claim.previous_attempts ?? []).flatMap((a: { legs?: { leg: string; reached: string | null }[] }) =>
      (a.legs ?? []).map((l) => ({ leg: l.leg, reached: l.reached ?? '' })));
    let handoffUrl = (claim.handoff_url ?? null) as string | null;
    let resume = (claim.previous_attempts?.[0]?.resume ?? null) as Record<string, any> | null;
    // R3-1236's course slot: the claim answer's advice, handed to the stub as `ctx.advice`.
    let advice = (claim.advice ?? null) as unknown;
    let session: string | null = null;
    const own: string[] = [];
    let ranScript: string | null = null;
    let ranCtx: Record<string, unknown> | null = null;
    // B-134: the claim answer's scope — the ticket's home and its `repos:` — against which each
    // leg's pushes are audited at its end. A claim whose answer carried none audits nothing (a
    // Baton before B-134) and opens no window.
    this.auditScope = Array.isArray(claim.scope) && claim.scope.every((s: unknown) => typeof s === 'string')
      ? claim.scope as string[] : null;
    this.auditWindow = this.auditScope == null ? null : this.readRefs();
    // The first leg is the claim response's queued leg (R-BTN-83); the first advance starts it.
    let legName = (reattached?.leg ?? claim.legs?.[0] ?? null) as string | null;
    let at = (reattached?.at ?? claim.station) as string;
    let nextLegs = (claim.next ?? []) as NextLegs;
    // R-BTN-72 (B-188): a reattached leg is already running — its first pass waits for it.
    let resuming = reattached;
    try {
      if (legName == null) return await this.finish(claimId, { end_reason: 'done', reached: at }, null);
      // B-106 (R-BTN-178): the claim's first leg may require a lock this runner can no longer
      // take — the server's declaration can be a beat behind the lock (the staleness loop's
      // grant-less break, a lost state file). The claim suspends at once, touching nothing: no
      // advance, no leg run, and the locks the claim would have used are released.
      if (!(await this.ensureLegLocks(legName, course))) {
        if (!reattached) return await this.finish(claimId, { end_reason: `suspended:${claim.station}`, reached: claim.station, next: legName }, null);
        this.log(`baton: ${ticket}'s reattached ${legName} runs on without its lock (R-BTN-178)`);
      }
      let runId: string | null = reattached?.runId ?? null;
      if (reattached) {
        this.legSeq = reattached.seq;
        const g = reattached.ctx.snapshot as { path?: { leg: string; reached: string }[]; next?: NextLegs } | undefined;
        if (Array.isArray(g?.path)) gitPath = g.path;
        if (Array.isArray(g?.next)) nextLegs = g.next;
      } else {
        const firstAnswer = await this.advance(claimId, { leg: legName, ...this.runInputsReport(versionCheck.read) }, at);
        if ('settle' in firstAnswer) return await this.finish(claimId, firstAnswer.settle, null);
        at = firstAnswer.station ?? at;
        nextLegs = (firstAnswer.next ?? nextLegs) as NextLegs;
        advice = firstAnswer.advice ?? advice;
        // R-BTN-63 (B-185): the run's id, minted by Baton at the advance that started it.
        runId = typeof firstAnswer.run_id === 'string' ? firstAnswer.run_id : null;
        // §7.5 R-BTN-90 (B-234): the run's `claim_legs.seq`, likewise — the finishing
        // heartbeat's word when the script returns.
        this.legSeq = typeof firstAnswer.seq === 'number' ? firstAnswer.seq : null;
      }
      for (;;) {
        if (!resuming) {
          // A drain (2026-10-24): the leg that ran is complete; the claim ends here with its
          // hand-off and the runner exits without claiming again — SIGTERM's graceful path.
          if (this.draining) {
            return await this.finish(claimId, { end_reason: 'released:requested', reached: at, next: legName }, await this.callHandoff(ranScript, ranCtx ?? {}) ?? handoffUrl);
          }
          // A signal that landed while no leg was running (a short wait, or the steps between
          // legs) ends the claim just the same — a release is never dropped (§6.13).
          const whileWaiting = this.abortSignal();
          if (whileWaiting) {
            const reason = whileWaiting.reason ?? `suspended:${at}`;
            return await this.finish(claimId, { end_reason: reason, reached: at, next: legName }, await this.callHandoff(ranScript, ranCtx ?? {}) ?? handoffUrl);
          }
          // §6.13: a leg the latest snapshot shows waiting suspends — unless its wait is one of the
          // course's short_waits, when the claim is kept and the station is re-read each beat for
          // up to 30 minutes (R-BTN-40). A signal that landed in the wait ends the claim as the
          // signal says, never as the suspension it interrupted.
          const wait = waitState(nextLegs, legName, course.graph.shortWaits);
          let held: 'cleared' | 'suspend' = wait === 'run' ? 'cleared' : 'suspend';
          if (wait === 'short') {
            if (this.inflight) this.inflight.leg = legName;
            const out = await this.waitOut(legName, course);
            if (out === 'abort') {
              const signal = this.abortSignal()!;
              const reason = signal.reason ?? `suspended:${at}`;
              return await this.finish(claimId, { end_reason: reason, reached: at, next: legName }, await this.callHandoff(ranScript, ranCtx ?? {}) ?? handoffUrl);
            }
            if (out === 'lost') {
              // The lease went while the wait held it: stop at once, no hand-off (R-BTN-24).
              return await this.finish(claimId, { end_reason: 'released:lease-lost', reached: at, next: legName }, null);
            }
            held = out === 'cleared' ? 'cleared' : 'suspend';
          }
          if (held === 'suspend') {
            // §6.13: the hand-off of the leg that ran comes before the suspension (R-BTN-44).
            const url = await this.callHandoff(ranScript, ranCtx ?? {}) ?? handoffUrl;
            return await this.finish(claimId, { end_reason: `suspended:${at}`, reached: at, next: legName }, url);
          }
          if (this.closedDone) return await this.finish(claimId, { end_reason: 'done', reached: at }, handoffUrl);
        }
        // B-108: the leg's own start — its clock (the beat's liveness line) and a fresh drain.
        if (this.inflight) { this.inflight.leg = legName; this.inflight.legAt = this.now(); }
        this.legLineAt = null;
        const run = resuming && typeof resuming.ctx.run === 'number' ? resuming.ctx.run : runNumber(course.graph, gitPath, legName, own);
        own.push(legName);
        const ctx: Record<string, unknown> = resuming ? resuming.ctx : {
          ticket: { id: ticket, path: claim.path ?? null, home: this.o.repository, ...(typeof claim.version === 'string' && claim.version !== '' ? { version: claim.version } : {}), ...(ticketFile != null ? { file: ticketFile } : {}) },
          claim: { id: claimId, nonce: claim.nonce, station: at },
          leg: legName, run, ...(runId ? { run_id: runId } : {}),
          snapshot: { sha: claim.snapshot_sha, path: gitPath, next: nextLegs },
          // B-127: the owner-signed commits a verified board post named — where the repository
          // requires signed control, the legs read `agent_command` and the overrides at these
          // (and the course itself — the graph, these scripts — loaded at the `course` one),
          // never the snapshot's newer bytes (verified above, in this runner, before anything
          // loaded).
          ...(Object.keys(signedControl).length ? { signed_control: signedControl } : {}),
          // The claim answer names the repository's default branch (R-BTN-34; §5.8's marker
          // legs, B-96's review round 2): the stub hands it to the close, so a marker line goes
          // to the branch the sync reads whatever branch this checkout is on.
          ...(typeof claim.default_branch === 'string' && claim.default_branch !== '' ? { default_branch: claim.default_branch } : {}),
          handoff: handoffUrl, resume, advice,
          checkout: this.checkout, session,
          state: this.o.stateFile, worker: this.state.get().worker_id,
        };
        const outcome = resuming ? await this.reattachedLeg(course, legName, resuming.handle) : await this.runLeg(course, legName, ctx, scratch);
        resuming = undefined;
        // R-BTN-72 (B-188): the run is over — nothing of it is left for a restart to reattach to.
        if (this.cur.place.handle) {
          this.cur.place = {};
          if (this.slots.has(this.cur)) this.writeClaims();
        }
        const script = course.scripts.get(legName) ?? null;
        if (outcome.kind !== 'lease-lost' && outcome.kind !== 'missing') {
          ranScript = script;
          ranCtx = ctx;
        }
        // §7.5 R-BTN-90 (B-234): finishing is not the end — the script's `run` returned (a
        // crash included), and the immediate `leg_finished` heartbeat goes out now, before the
        // validation, `close`, hand-off or advance that follows, each of which can cross the
        // deadline's instant. A lease lost or a missing script ran nothing to finish, and a leg
        // a delivered release already stopped never returned: its release stands (§7.5), and
        // the claim ends as the release says without a word from here.
        if ((outcome.kind === 'ok' || outcome.kind === 'crashed') && !this.abortSignal()) await this.reportLegFinished();
        // B-134: the leg's end — its window's pushes are audited at the finish or the advance
        // below whatever the outcome was (a crashed or aborted leg can have pushed; a lost
        // lease still audits at its no-hand-off end; a `missing` leg never ran), and the read
        // happens AFTER the leg's close and hand-off have run — their pushes are the leg's
        // too, and reading before them left those outside every window.
        if (outcome.kind === 'lease-lost') {
          // The group is dead; no close, no hand-off (R-BTN-24's resume record covers the leg).
          return await this.finish(claimId, { end_reason: 'released:lease-lost', reached: at, next: legName }, null);
        }
        if (outcome.kind === 'missing') {
          this.log(`baton: the snapshot has no legs/${legName}.mjs — a script bug the test kit owns (§2d)`);
          return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: at, next: legName }, null);
        }
        // A sidecar signal that landed mid-leg decides the end, whatever the script then says —
        // the leg stops at its next safe point (§6.13). A release may name the outcome the
        // finished leg reached, validated and closed like any result (R-BTN-83: a position not
        // in git is not reported); a regression rests at the leg's `from` whatever it said.
        const abort = this.abortSignal();
        if (abort) {
          let reached = at;
          let next: string | null = legName; // a give-up queues the leg itself (R-BTN-83)
          let closed: string | null | undefined = null;
          if (abort.signal === 'release' && outcome.kind === 'ok') {
            const verdict = decide(outcome.result, course.graph, legName, at);
            if (!('bug' in verdict)) closed = await this.callClose(script, ctx, outcome.result);
            if (closed != null && !('bug' in verdict)) {
              reached = verdict.reached;
              // A leg that finished queues a leg leaving where it rests — the script's own word
              // when it named one, nothing at an end station (R-BTN-83).
              next = verdict.kind === 'advance' ? verdict.leg : verdict.kind === 'done' ? null : verdict.next;
            }
          }
          const reason = abort.reason ?? `suspended:${at}`;
          // A released end points at no evidence (§6.5); the marker close wrote is in git.
          return await this.finish(claimId, { end_reason: reason, reached, ...(next != null ? { next } : {}) }, await this.callHandoff(script, ctx));
        }
        if (outcome.kind === 'crashed') {
          // R-BTN-144 (B-170): the leg's own error text leaves masked — a provider-auth message
          // is the one that quotes the key. It was masked at its source too; this is the log.
          this.log(`baton: ${ticket}'s ${legName} failed (${maskLegOutput(outcome.error, this.legSecrets)})`);
          // B-256: the end carries the failure's last line — an agent stub's, the agent's own last
          // output — masked the same way and bounded to §9.4's detail, so Baton's record of a leg
          // that exited 0 with nothing done says what the agent said, after the sandbox is gone.
          const detail = failureDetail(outcome.error, this.legSecrets);
          return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: at, next: legName, ...(detail != null ? { detail } : {}) }, await this.callHandoff(script, ctx));
        }
        const result = outcome.result;
        session = typeof (result as { session?: unknown } | null)?.session === 'string'
          ? (result as { session: string }).session : session;
        const verdict = decide(result, course.graph, legName, at);
        if ('bug' in verdict) {
          this.log(`baton: ${ticket}'s ${legName} script bug: ${maskLegOutput(verdict.why, this.legSecrets)}`);
          return await this.finish(claimId, { end_reason: `suspended:${verdict.reached}`, reached: verdict.reached, next: verdict.next }, await this.callHandoff(script, ctx, verdict.why));
        }
        // R-BTN-83: `close` writes the closing marker from the validated result before anything
        // is reported; a suspension or release follows with `handoff`, so it can cite the position.
        const closed = await this.callClose(script, ctx, result);
        if (closed === undefined) {
          return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: at, next: legName }, await this.callHandoff(script, ctx));
        }
        if (verdict.kind === 'done') {
          // A done end carries no hand-off (R-BTN-44 writes one for suspensions and releases);
          // the closing marker and the resume record are its record.
          const done = { end_reason: 'done', reached: verdict.reached, ...(verdict.detail ? { detail: verdict.detail } : {}), ...(verdict.outputs ? { outputs: verdict.outputs } : {}), ...(closed ? { ended_at_sha: closed } : {}) };
          return await this.finish(claimId, done, null);
        }
        if (verdict.kind === 'suspend' || verdict.kind === 'release') {
          const reason = verdict.kind === 'suspend' ? `suspended:${verdict.reached}` : `released:${verdict.reason}`;
          // §6.5: only a completed end points at its evidence — a released end carries none.
          return await this.finish(claimId, {
            end_reason: reason, reached: verdict.reached, next: verdict.next,
            ...(verdict.kind === 'suspend' && verdict.outputs ? { outputs: verdict.outputs } : {}),
            ...(verdict.kind === 'suspend' && closed ? { ended_at_sha: closed } : {}),
          }, await this.callHandoff(script, ctx));
        }
        // The go-on decision: the advance carries the result's bars on the edge (R-BTN-63) and
        // the evidence `close` wrote; it finishes this leg and starts the next. The finished leg
        // joins the evidenced path only now — the next leg's run number counts what ran. Its
        // scope audit (B-134) reports here, on the advance that finishes it — read after the
        // close, above, so the evidence push is in the window too.
        // B-106 (R-BTN-178): the lock of a leg the next one requires is taken before the advance
        // is sent; one this runner cannot take suspends the claim rather than sending it, the
        // finished leg's evidence already in git (R-BTN-121, R-BTN-71).
        if (!(await this.ensureLegLocks(verdict.leg, course))) {
          return await this.finish(claimId, { end_reason: `suspended:${verdict.reached}`, reached: verdict.reached, next: verdict.leg }, await this.callHandoff(script, ctx) ?? handoffUrl);
        }
        this.auditLeg();
        // R-BTN-113 (B-4): the advance that finishes the leg carries its session link beside the
        // beats — the last word for the finished run, as the end's is for a claim's last one.
        const answer = await this.advance(claimId, { reached: verdict.reached, leg: verdict.leg, bars: verdict.bars, ...(verdict.outputs ? { outputs: verdict.outputs } : {}), ...(closed ? { evidence: closed } : {}), ...(this.legSessionUrl != null ? { session_url: this.legSessionUrl } : {}), ...(this.pendingScope ? { scope_exceeded: { actions: this.pendingScope, dropped: this.scopeOverflow } } : {}), ...this.runInputsReport(versionCheck.read) }, verdict.reached);
        // The parked report is cleared only when the advance DELIVERED it: a refused advance
        // (§6.13, settled below) never reached the core's report handling, and the end that
        // settles the claim carries it instead — the report rides "the advance or end that
        // finishes the leg", whichever one it turns out to be.
        if (!('settle' in answer)) {
          this.pendingScope = null;
          this.scopeOverflow = 0;
        }
        // 2026-10-24: the advance trail — every finished leg names where it landed and what it
        // queued, so a suspension or an odd end position reads as a trail, not a riddle. B-108:
        // a leg whose agent a bound concluded says so — the how-ended of the wait is the log's.
        const howEnded = typeof (result as { conclusion?: { cause?: unknown } } | null)?.conclusion?.cause === 'string' ? ` — the agent ${(result as { conclusion: { cause: string } }).conclusion.cause}` : '';
        this.log(`baton: ${ticket}'s ${legName} finished: reached ${verdict.reached}, next ${'settle' in answer ? 'the end' : (answer.next?.[0]?.leg ?? verdict.leg)} (run ${run} of ${course.graph.legs.get(legName)?.maxRuns ?? 1})${howEnded}`);
        if ('settle' in answer) return await this.finish(claimId, answer.settle, await this.callHandoff(script, ctx) ?? handoffUrl);
        gitPath = [...gitPath, { leg: legName, reached: verdict.reached }];
        at = answer.station ?? verdict.reached;
        nextLegs = (answer.next ?? nextLegs) as NextLegs;
        advice = answer.advice ?? advice;
        runId = typeof answer.run_id === 'string' ? answer.run_id : null;
        // §7.5 R-BTN-90 (B-234): the next run's seq, as the first advance's above.
        this.legSeq = typeof answer.seq === 'number' ? answer.seq : null;
        legName = verdict.leg;
        handoffUrl = null;
        resume = null;
      }
    } finally {
      for (const w of this.inflight?.waiters.splice(0) ?? []) w([]);
      await this.stopSession('claim-ended');
      this.legChannel?.close();
      this.legChannel = null;
      this.legSessionUrl = null;
      this.legSeq = null;
      this.legFinishedSeq = null;
      this.inflight = null;
      this.pendingAbort = null;
      dropCourse(course!.scratch);
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  /** B-190 (R-BTN-82, R-BTN-84): what each advance reports of the run it starts — the claim's
   *  recorded ticket read (`version` and `read_digest`, absent when the source declared no way of
   *  reading or the board held no version), the resolved inputs (none until R-BTN-82's resolution
   *  hands the runner any), and the home checkout's head: where replay checks the ticket's code
   *  out. Reported at the run's start, stored in `leg_run_inputs` and on the run's row. */
  private runInputsReport(read: { version: string; read_digest: string } | null): { run_inputs: { ticket?: { version: string; read_digest: string }; inputs: [] }; head_sha: string | null } {
    const head = readHead(this.checkout);
    return {
      run_inputs: { ...(read ? { ticket: read } : {}), inputs: [] },
      head_sha: /^[0-9a-f]{40}$/.test(head) ? head : null,
    };
  }

  /** One `advance`, its refusal settled by §6.13: off-graph ends `released:course-changed`; an
   * `entry` refusal (R-BTN-109) ends `released:cannot-finish:contract-output`; every other
   * refusal suspends at the station the claim reached, never releasing. */
  private async advance(claimId: number, body: { leg: string; reached?: string; bars?: string[]; evidence?: string; outputs?: unknown[]; run_inputs?: { ticket?: { version: string; read_digest: string }; inputs: unknown[] }; head_sha?: string | null; session_url?: string }, fallbackStation: string): Promise<{ station?: string; next?: NextLegs; advice?: unknown; run_id?: string; seq?: number } | { settle: Record<string, unknown> }> {
    try {
      return await this.o.api.advance(claimId, body) as { station?: string; next?: NextLegs; advice?: unknown; run_id?: string; seq?: number };
    } catch (e) {
      if (!(e instanceof BatonRefusal)) throw e;
      const kind = refusalKind(e.ruleCode);
      if (kind === 'course-changed') {
        return { settle: { end_reason: 'released:course-changed', reached: body.reached ?? fallbackStation, ...(body.leg ? { next: body.leg } : {}) } };
      }
      // The leg's outputs did not meet its arrival: the leg is given up where the claim rests.
      if (kind === 'contract-output') return { settle: { end_reason: 'released:cannot-finish:contract-output' } };
      // The suspension arrives where the advance would have (R-BTN-109): its outputs go with it,
      // so a refusal for any other reason still suspends rather than failing the entry (3-r3-2).
      return { settle: { end_reason: `suspended:${body.reached ?? fallbackStation}`, reached: body.reached ?? fallbackStation, next: body.leg, ...(body.outputs ? { outputs: body.outputs } : {}) } };
    }
  }

  /** Hold a short wait (R-BTN-40): each beat re-reads the snapshot's legs; 30 minutes spends it.
   * A beat that brought no reading (the fallback timeout) settles nothing — only the clock — and
   * a signal that landed while no leg ran aborts the wait, honoured by the caller. */
  private async waitOut(leg: string, course: CourseLoad): Promise<'cleared' | 'spent' | 'abort' | 'lost'> {
    const waitedSince = this.now();
    for (;;) {
      if (this.claimLost() || leaseLostFrom(this.state.get(), this.now())) return 'lost';
      if (this.pendingAbort) return 'abort';
      const shown = await new Promise<NextLegs | null>((resolve) => {
        if (!this.inflight) return resolve(null);
        this.inflight.waiters.push((n) => resolve(n));
        // Ref'd, as idleWait's sleeps are: through this wait no leg child is alive and the
        // beat's own interval is unref'd, so this timer is what keeps the process alive.
        // 2026-11-05, run-20261104-144136: unref'd here, the event loop emptied the moment the
        // wait began — the runner exited 0 mid-claim, no line, no hand-off, the home lock left
        // behind (S-BTN-201).
        setTimeout(() => resolve(null), this.o.beatEvery);
      });
      if (shown == null) {
        if (shortWaitSpent(waitedSince, this.now())) return 'spent';
        continue;
      }
      const state = waitState(shown, leg, course.graph.shortWaits);
      if (state === 'run') return 'cleared';
      if (state === 'suspend' || shortWaitSpent(waitedSince, this.now())) return 'spent';
    }
  }

  private async runLeg(course: CourseLoad, leg: string, ctx: Record<string, unknown>, scratch: string): Promise<{ kind: 'ok'; result: unknown } | { kind: 'crashed'; error: string } | { kind: 'missing' } | { kind: 'lease-lost' }> {
    const script = course.scripts.get(leg);
    if (script == null) return { kind: 'missing' };
    const tag = randomBytes(4).toString('hex');
    // R-BTN-107 (B-184): the session key — its run id's first session, or a tag when the advance
    // named none.
    const sessionId = typeof ctx.run_id === 'string' ? `${ctx.run_id}.r0` : `leg-${tag}`;
    // B-234 (R-BTN-106, R-BTN-195): the leg run's channel — one Unix socket beside the state
    // file, mode 0600, its address the session's BATON_SOCKET, where a raise is answered and a
    // joinable session posts its ending. The previous run's channel, if it is still up (its
    // session lives on for the close and hand-off), comes down first.
    this.legChannel?.close();
    this.legChannel = null;
    this.legSessionUrl = null;
    this.sessionLinkLanded = false;
    let channel: LegChannel | null = null;
    try {
      channel = await LegChannel.serve(channelPath(this.o.stateFile, sessionId));
    } catch (e) {
      this.log(`baton: the leg's channel could not serve (${msg(e)}) — the leg runs with no way to raise (R-BTN-106)`);
    }
    if (channel) {
      this.legChannel = channel;
      // B-188: the channel's requests are this claim's, whatever context the socket calls from.
      const slot = this.cur;
      channel.listen((req) => this.als.run(slot, () => this.onChannel(req, course, leg, ctx)));
    }
    // Detached: its own process group, so a lost lease kills the leg and everything it started
    // (§6.13) without touching the runner. The env names the parent every leg session checks
    // (BATON_PARENT — such a session never claims; BATON_STATE — the fence and the spool). B-97
    // dropped the transition's IR_BATON_* spellings: these two names are the only ones set.
    const parent = String(this.state.get().worker_id ?? '');
    const childEnv: Record<string, string | undefined> = {
      ...process.env, BATON_PARENT: parent, BATON_STATE: this.o.stateFile,
      // R-BTN-144 (B-185): the run's id, and its session — `<run_id>.r0`, the first session;
      // a refresh (R-BTN-123, B-12) counts on from there. Absent when the advance named none.
      ...(typeof ctx.run_id === 'string' ? { BATON_RUN_ID: ctx.run_id, BATON_SESSION_ID: `${ctx.run_id}.r0` } : {}),
      // B-83: the harness command of `--harness`, for a stub whose snapshot's settings name no
      // agent_command — a fill for an absence, never an override.
      ...(this.o.agentCommand ? { BATON_AGENT_COMMAND: this.o.agentCommand } : {}),
      // Verbose: the stub reports the agent_command it resolved on stderr, which the runner
      // then drains below — the one place the actual local command completing the leg is
      // known (it is resolved at the claim's snapshot, not here).
      ...(this.verbose ? { BATON_VERBOSE: '1' } : {}),
      // The claim's own `default_branch` (B-96): the environment form, for a stub whose close
      // runs in the leg child. The close the RUNNER calls gets the same value through `ctx`
      // (`runLeg`'s context), which is the primary path (round 4).
      ...(typeof ctx.default_branch === 'string' && ctx.default_branch !== '' ? { BATON_DEFAULT_BRANCH: ctx.default_branch } : {}),
      // B-234 (R-BTN-106): the leg's channel, its address as the session's CLI reads it.
      ...(channel ? { BATON_SOCKET: channel.path } : {}),
    };
    // R-BTN-107 (B-184): the leg runs in a session of the executor the host chose, keyed by its
    // run id's first session; the previous leg's session goes first (its close and hand-off ran).
    await this.stopSession('next-leg');
    const env = Object.fromEntries(Object.entries(childEnv).filter((e): e is [string, string] => typeof e[1] === 'string'));
    // R-BTN-144 class 7 (B-170): the leg's masked set is computed once, here, from the environment
    // the leg is given — every variable whose name says a secret, and every name `runner.json`
    // `mask_env` lists. The environment spreads the runner's own, so the host's values are in it;
    // a non-secret that matches is masked too (a readable log line lost, nothing else), and a
    // value under 8 bytes is not masked at all (said once under --verbose). The set is the
    // Runner's, not the call's: the close and handoff that follow run in the leg's session, and
    // what a leg's own failure says reaches this log after its stream closed.
    const maskEnv = this.o.maskEnv ?? [];
    // `mask_env` names every other environment it reaches: a name the host keeps under no
    // ending (a provider's key in `ANTHROPIC_API_KEY`, say) stays masked when a repository's
    // environment spells it too.
    const legSecrets = this.legSecrets = secretValues(env, maskEnv);
    if (this.verbose) {
      const short = Object.keys(env).filter((n) => (maskEnv.includes(n) || namesASecret(n)) && Buffer.byteLength(env[n], 'utf8') < MIN_SECRET_BYTES);
      if (short.length) this.log(`baton: ${leg}'s ${short.join(', ')} ${short.length === 1 ? 'is' : 'are'} under ${MIN_SECRET_BYTES} bytes, so not masked (R-BTN-144)`);
    }
    const sink = this.legSink(legSecrets);
    let handle: Handle;
    try {
      handle = await this.startSession('leg', {
        session_id: sessionId, ...(typeof ctx.run_id === 'string' ? { run_id: ctx.run_id } : {}), ticket: String((ctx.ticket as { id?: string })?.id ?? ''), leg,
        snapshot_sha: String((ctx.snapshot as { sha?: string })?.sha ?? ''), paths: [scratch, course.scratch], env,
        channel: channel ? channel.path : null,
        // R-BTN-107: the brief carries the leg's autonomy as a hint — the raise check below is
        // what enforces it, whatever the executor does with the hint.
        autonomous: course.graph?.legs.get(leg)?.autonomous === true,
      });
    } catch (e) {
      // The leg's own failure text leaves masked, whatever of it the executor quoted.
      channel?.close();
      if (this.legChannel === channel) this.legChannel = null;
      return { kind: 'crashed', error: maskLegOutput(`the executor could not start the leg's session (${msg(e)})`, legSecrets) };
    }
    // R-BTN-113: an executor whose handle names its session's link — the runner reports it on
    // every beat and the raise check reads it as the run's link.
    if (typeof handle.link === 'string' && handle.link !== '') {
      this.legSessionUrl = handle.link;
      this.sessionLinkSeq++;
    }
    // R-BTN-195: the ending a joinable session posts on its channel — `end(handle)` resolves at
    // it (R-BTN-107), so the runner hands it to the session.
    handle.posted = channel ? channel.posted : null;
    this.session = { handle, checkout: this.checkout };
    // R-BTN-72 (B-188): what a restart within the lease reattaches with — the run, the
    // executor's handle (its data) and the leg's place.
    this.persistPlace(handle, leg, ctx);
    // R-BTN-113/R-BTN-195 (B-234): Baton holds the link before the leg can ask a person into
    // its session — a beat carrying this run's link answers first, so the leg's first
    // `interact` cannot race the beat that lands it. Raised before any beat carried the link,
    // the report would reach Baton only to be refused there (`invalid-params`), its reason
    // lost to the leg; the raise check refuses on the channel until the link has landed.
    if (this.legSessionUrl != null) await this.landSessionLink();
    if (this.verbose) this.log(`baton: ${leg} runs: node ${basename(LEG_PROCESS)} run ${basename(script)} (session ${sessionId}, executor ${this.executor.source})`);
    const running = this.wrapperCall(handle, 'run', script, [ctx], undefined, () => sink);
    const inflight = this.inflight!;
    inflight.child = { running };
    // The call is over: the stream's held tail may leave with the outcome the wrapper prints last.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      sink.release();
    };
    let done = false;
    const exited = running.result.then((r) => {
      // R-BTN-144 (B-170): the call is over — its held tail goes, before the outcome may be read.
      release();
      done = true;
      return r;
    });
    // R-BTN-195: the posted ending of a joinable session — the agent done, the session not
    // exited (a person still in it). `posted` holds the ending once the channel's `done` verb
    // carries it; the box names which of the two won the race.
    const postedBox: { ending?: { result: unknown } } = {};
    const postedRace = channel ? channel.posted.then((ending) => { postedBox.ending = ending; }) : null;
    // A signal that landed while the session ran on: a normal leg takes its release at the next
    // safe point and the call exits by itself, so the race is only woken after a grace — a
    // joinable session nobody ends (unjoined, unreleased-acknowledged) is the one left hanging,
    // and the loop's release ends it (R-BTN-90's `leg-timeout` the unjoined ask's own end).
    const signalled = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (this.pendingAbort == null) return;
        clearInterval(timer);
        setTimeout(resolve, this.o.signalGraceMs ?? SIGNAL_GRACE_MS).unref?.();
      }, Math.min(100, this.o.beatEvery));
      timer.unref?.();
      void exited.then(() => clearInterval(timer));
    });
    const lost = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        // R-BTN-26: the fence computes the lease itself from the state file — the wall clock
        // against `last_ok` — never trusting only the sidecar's flag.
        if (leaseLostFrom(this.state.get(), this.now()) || this.claimLost() || this.stopped) {
          clearInterval(timer);
          resolve();
        }
      }, Math.min(200, this.o.beatEvery));
      timer.unref?.();
      void exited.then(() => clearInterval(timer));
    });
    await Promise.race([exited, lost, ...(postedRace ? [postedRace] : []), signalled]);
    if (postedBox.ending != null && !done && !this.claimLost()) {
      // R-BTN-107/R-BTN-195: a session that does not exit when its agent is done ends at the
      // result posted on its channel — `end` resolves there — and the runner then stops it,
      // whether or not a person is in it. The close and hand-off that follow run in a fresh
      // session; what the agent left in git is its own evidence, checked as any result is.
      await this.executor.end(handle).catch((e) => this.log(`baton: the executor's end failed (${msg(e)})`));
      await this.stopSession('leg-result');
      inflight.child = null;
      release();
      this.log(`baton: ${inflight.ticket}'s ${leg} ended at the result posted on its channel — the session is stopped (R-BTN-195)`);
      return { kind: 'ok', result: postedBox.ending.result };
    }
    if (!done && this.abortSignal() != null && !this.claimLost()) {
      // A release (the claim's deadline among its reasons, R-BTN-90) reached a session that
      // neither exited nor posted: kill it, stop its session, and let the loop's abort branch
      // end the claim with the signal's reason — the unjoined ask's own end (R-BTN-195).
      const signal = this.abortSignal()!;
      this.killGroup(inflight.child);
      await this.stopSession(`signal:${signal.signal}`);
      inflight.child = null;
      release();
      return { kind: 'crashed', error: `the leg's session was asked to stop (${signal.reason ?? signal.signal}) and neither exited nor posted its result` };
    }
    if (!done || this.claimLost()) {
      // The lease went (or the runner stops): kill the leg at once, no hand-off — the resume
      // record covers it (R-BTN-24) — and stop its session.
      this.killGroup(inflight.child);
      inflight.child = null;
      release();
      await this.stopSession('lease-lost');
      return { kind: 'lease-lost' };
    }
    // A leg's end is its whole group's end whatever ended it (R-BTN-72, S-BTN-200): the
    // executor's call kills what it left behind; the session lives on for close and hand-off.
    const exit = await exited;
    inflight.child = null;
    const out = wrapperOutcome(exit.stdout);
    if (out == null) return { kind: 'crashed', error: 'the leg wrote no result' };
    // A crashed leg's error is its own text (the thrown message the wrapper printed), masked
    // here — where the set lives — so the log it reaches carries no literal of the leg's env.
    return out.ok ? { kind: 'ok', result: out.result } : { kind: 'crashed', error: maskLegOutput(out.error ?? 'the leg script failed', legSecrets) };
  }

  /** R-BTN-72 (B-188): the running leg's place in the state file, for a reattach. */
  private persistPlace(handle: Handle, leg: string, ctx: Record<string, unknown>): void {
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(JSON.stringify({ ...handle, posted: undefined })) as Record<string, unknown>;
    } catch {
      data = null; // a handle that is not data: nothing a restart could reattach with
    }
    this.cur.place = {
      run_id: typeof ctx.run_id === 'string' ? ctx.run_id : null, seq: this.legSeq, leg,
      at: String((ctx.claim as { station?: unknown } | undefined)?.station ?? ''), handle: data, ctx,
    };
    if (this.slots.has(this.cur)) this.writeClaims();
  }

  /** R-BTN-72 (B-188): a leg reattached after a restart — its session found again by the
   *  executor, its channel served again at the same address, and its end awaited as any run's:
   *  the session's posted or final result is the leg's, checked as any result is. A lost lease
   *  or claim stops it, no hand-off; a release stops it after the grace, as a leg that will not
   *  take its release is stopped. */
  private async reattachedLeg(course: CourseLoad, leg: string, handle: Handle): Promise<{ kind: 'ok'; result: unknown } | { kind: 'crashed'; error: string } | { kind: 'lease-lost' }> {
    let channel: LegChannel | null = null;
    try {
      channel = await LegChannel.serve(channelPath(this.o.stateFile, handle.session_id));
      const slot = this.cur;
      channel.listen((req) => this.als.run(slot, () => this.onChannel(req, course, leg, (this.cur.place.ctx ?? {}) as Record<string, unknown>)));
      this.legChannel = channel;
    } catch (e) {
      this.log(`baton: the reattached leg's channel could not serve (${msg(e)}) — the leg runs on with no way to raise (R-BTN-106)`);
    }
    handle.posted = channel ? channel.posted : null;
    this.session = { handle, checkout: this.checkout };
    if (typeof handle.link === 'string' && handle.link !== '') {
      this.legSessionUrl = handle.link;
      this.sessionLinkSeq++;
    }
    const ended = this.executor.end(handle).then((r) => ({ r }), (e: unknown) => ({ e }));
    let timer: ReturnType<typeof setInterval> | null = null;
    let signalledAt: number | null = null;
    const stop = new Promise<'lost' | 'signal'>((resolve) => {
      timer = setInterval(() => {
        if (leaseLostFrom(this.state.get(), this.now()) || this.claimLost() || this.stopped) resolve('lost');
        else if (this.pendingAbort != null) {
          signalledAt ??= this.now();
          if (this.now() - signalledAt >= (this.o.signalGraceMs ?? SIGNAL_GRACE_MS)) resolve('signal');
        }
      }, Math.min(200, this.o.beatEvery));
    });
    const first = await Promise.race([ended, stop]);
    if (timer) clearInterval(timer);
    if (first === 'lost') {
      await this.stopSession('lease-lost');
      return { kind: 'lease-lost' };
    }
    if (first === 'signal') {
      await this.stopSession(`signal:${this.pendingAbort?.signal ?? 'release'}`);
      return { kind: 'crashed', error: `the reattached leg's session was asked to stop (${this.pendingAbort?.reason ?? 'release'}) and did not end` };
    }
    if ('e' in first) return { kind: 'crashed', error: `the reattached leg's session could not be awaited (${msg(first.e)})` };
    const result = first.r.result;
    if (result == null) return { kind: 'crashed', error: 'the reattached leg ended with no result' };
    // The session's result is the wrapper's outcome or the leg's own result (R-BTN-107).
    const out = typeof result === 'object' && typeof (result as { ok?: unknown }).ok === 'boolean' ? result as { ok: boolean; result?: unknown; error?: string } : null;
    if (out) return out.ok ? { kind: 'ok', result: out.result } : { kind: 'crashed', error: maskLegOutput(out.error ?? 'the leg script failed', this.legSecrets) };
    return { kind: 'ok', result };
  }

  /**
   * B-234 (R-BTN-160, R-BTN-195): one request off the leg run's channel. `raise` is checked as
   * the runner checks a move — on the facts of the leg and its run, from the claim's snapshot —
   * and a failing check is answered with the reason, nothing reaching Baton. A passing raise is
   * reported once, with filter fields only: the subject and body are the leg's own text, logged
   * masked (R-BTN-33, R-BTN-144) and never sent. An `interact` needs no answer the runner can
   * give — the raise returns at once (R-BTN-116: nothing waits on it) — and an autonomous leg's
   * substitute is `error.needs-person`, which it raises like any error. The suspend wait
   * (R-BTN-162) is not built: a `suspend` raise records and returns, nothing waits.
   */
  private async onChannel(req: ChannelRequest, course: CourseLoad, leg: string, ctx: Record<string, unknown>): Promise<ChannelAnswer> {
    if (req.op !== 'raise') return { ok: false, error: `the channel carries raise and done, nothing else (R-BTN-106)` };
    const ticket = String((ctx.ticket as { id?: string })?.id ?? '');
    const claimId = Number((ctx.claim as { id?: number } | undefined)?.id ?? 0);
    const subject = typeof req.subject === 'string' ? req.subject : '';
    if (subject.trim() === '') return { ok: false, error: 'a raise carries a subject (--subject, R-BTN-160)' };
    const type = typeof req.type === 'string' ? req.type : '';
    const def = course.graph?.legs.get(leg);
    const declared: Map<string, ConditionDeclaration> = course.graph?.conditionTypes ?? new Map();
    const verdict = checkRaise(type, declared, {
      conditions: def?.conditionTypes ?? null,
      autonomous: def?.autonomous === true,
      deadlineS: def?.maxDuration ?? null,
      // R-BTN-113/R-BTN-195: the link BATON holds for this run — the handle's once a beat
      // carrying it answered, never the handle's alone. Baton sets an `interact`'s url from
      // the link it holds, so a raise reported before the beat landed it would be refused BY
      // Baton (`invalid-params`) instead of on this channel, its reason never reaching the
      // leg — the one refusal R-BTN-195 gives the channel.
      sessionUrl: this.sessionLinkLanded ? this.legSessionUrl : null,
    });
    if (!verdict.ok) {
      this.log(`baton: ${ticket}'s ${leg} raise of ${type || '(none)'} was refused on the channel: ${verdict.reason}`);
      return { ok: false, error: verdict.reason };
    }
    // The report's fields — the runner's resolution of what the course file declares, the
    // severity checked here (R-BTN-125) and the restarts as given; `url` is never the leg's to
    // choose: an `interact`'s is Baton's own and a `suspend`'s points into git (R-BTN-92).
    const severity = req.severity === undefined || req.severity === null ? 'normal'
      : SEVERITIES.includes(req.severity as never) ? req.severity : null;
    if (severity == null) return { ok: false, error: `severity must be one of ${SEVERITIES.join(', ')} (R-BTN-125)` };
    const restarts = req.restarts != null && typeof req.restarts === 'object' && !Array.isArray(req.restarts)
      ? req.restarts as Record<string, string> : undefined;
    if (restarts != null) {
      for (const [id, text] of Object.entries(restarts)) {
        if (typeof text !== 'string') return { ok: false, error: `restarts.${id}: a description is text (R-BTN-160)` };
      }
    }
    const body = typeof req.body === 'string' ? req.body : null;
    // R-BTN-33: the subject and body stay here — the runner's log, masked of the leg's own
    // secrets — and nothing of them is reported. The raise's line is what an operator reads.
    this.log(maskLegOutput(`baton: ${ticket}'s ${leg} raised ${type} — ${subject.slice(0, 200)}${body != null ? ` (body ${Buffer.byteLength(body, 'utf8')} bytes, kept in this log only)` : ''}`, this.legSecrets));
    const disposition = dispositionOf(type, declared) ?? 'notify';
    let answer: Record<string, any>;
    try {
      answer = await this.o.api.conditions(claimId, {
        type,
        disposition,
        ...(restarts != null ? { restarts } : {}),
        ...(typeof req.default === 'string' ? { default: req.default } : {}),
        ...(severity !== 'normal' ? { severity } : {}),
      });
    } catch (e) {
      const why = e instanceof BatonRefusal ? `${e.code}: ${e.message}` : msg(e);
      this.log(`baton: ${ticket}'s ${leg} raise of ${type} was refused by Baton (${maskLegOutput(why, this.legSecrets)})`);
      return { ok: false, error: `Baton refused the raise: ${why}` };
    }
    // R-BTN-160's dispositions, the runner's own two: an `interrupt` ends the leg
    // `released:cannot-finish:<class>` (the class the type names, R-BTN-122), signalled here so
    // the loop ends the claim at its next safe point with its hand-off written — the retry
    // policy routes what follows. A `notify` — `interact` among them — returns at once and the
    // leg goes on (R-BTN-116: nothing waits on it). A `suspend` records and returns too: its
    // wait (R-BTN-162) is not built.
    const end = disposition === 'interrupt' ? `released:cannot-finish:${errorClassOf(type, declared)}` : null;
    if (end != null) this.signalLeg('release', end);
    return { ok: true, condition_id: answer.condition_id, disposition: answer.disposition ?? disposition, ...(severity !== 'normal' ? { severity } : {}), ...(end != null ? { end } : {}) };
  }

  /** `close(ctx, result)`: the closing marker from the validated result (R-BTN-83), retried
   * twice; when it cannot write, nothing is reported for the leg (§6.13) — `undefined`.
   * §6.13's default-export shape and the named-export shape both serve. */
  private async callClose(script: string | null, ctx: Record<string, unknown>, result: unknown): Promise<string | null | undefined> {
    if (script == null) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // R-BTN-107/R-BTN-133 (B-184): through the executor, in the leg's session, bounded at 2 minutes.
        const out = wrapperOutcome((await this.wrapperCall(await this.legSession(), 'close', script, [ctx, result], 120).result).stdout);
        if (out == null) throw new Error('the close wrote no outcome');
        if (!out.ok) throw new Error(out.error ?? 'the close failed');
        return typeof out.result === 'string' ? out.result : null;
      } catch (e) {
        this.log(`baton: the leg's close failed (${maskLegOutput(msg(e), this.legSecrets)}), attempt ${attempt + 1} of 3`);
      }
    }
    return undefined;
  }

  /** `handoff(ctx)` (R-BTN-44): before any suspension or release; its failure is logged and the
   * resume record covers the rest. */
  private async callHandoff(script: string | null, ctx: Record<string, unknown>, why?: string): Promise<string | null> {
    if (script == null) return null;
    try {
      // R-BTN-107/R-BTN-133 (B-184): through the executor, in the leg's session, bounded at 2 minutes.
      const out = wrapperOutcome((await this.wrapperCall(await this.legSession(), 'handoff', script, [why != null ? { ...ctx, bug: why } : ctx], 120).result).stdout);
      if (out == null) throw new Error('the hand-off wrote no outcome');
      if (!out.ok) throw new Error(out.error ?? 'the hand-off failed');
      return typeof out.result === 'string' ? out.result : null;
    } catch (e) {
      this.log(`baton: the leg's handoff failed (${maskLegOutput(msg(e), this.legSecrets)}) — the resume record covers it (R-BTN-24)`);
      return null;
    }
  }

  /** End the claim, clear the local claim state, and ack what the sidecar delivered. The local
   * flags clear whatever the wire said — a lost lease belongs to the claim that lost it — and an
   * end the network ate is parked and retried on every beat until Baton answers. */
  private async finish(claimId: number, body: Record<string, unknown>, handoff: string | null): Promise<ClaimOutcome> {
    // B-134: the end is the audit's last read — after the caller's close and hand-off have run
    // (both always precede this call), so a push either of them made is the leg's, inside the
    // window, not after it.
    this.auditLeg();
    const ticket = this.cur.ticket || (this.inflight?.ticket ?? this.state.get().claim?.ticket_id ?? '');
    // B-134: the end carries the leg's scope audit the same way — the advance that finished the
    // leg clears it once it has delivered it — with the count of the actions beyond its
    // sixteen, parked beside them.
    if (this.pendingScope != null && body.scope_exceeded === undefined) body = { ...body, scope_exceeded: { actions: this.pendingScope, dropped: this.scopeOverflow } };
    this.pendingScope = null;
    this.scopeOverflow = 0;
    // R-BTN-113 (B-4): the end carries the finished leg's session link when this run holds one
    // and the body names none — the belt-and-braces beside the beats, so a run whose landing
    // beat never reached Baton still reports its link on the call that finishes it.
    if (this.legSessionUrl != null && body.session_url === undefined) body = { ...body, session_url: this.legSessionUrl };
    try {
      await this.o.api.end(claimId, body);
    } catch (e) {
      if (e instanceof BatonRefusal && e.code === 'claim-ended') {
        // Baton already ended it (a stale-board release under a sync, §6.5) — its end stands.
        this.log(`baton: ${ticket} was already ended (${e.message})`);
      } else if (e instanceof BatonRefusal && (e.code === 'unavailable' || e.status >= 500)) {
        // A 5xx is a Baton that could not answer, not one that refused: park it like a
        // transport failure, or the orphan path would re-end the claim with another reason.
        this.log(`baton: the end of ${ticket} did not reach Baton (${e.message}) — retried on every beat`);
        this.pendingEnds.set(claimId, body);
      } else if (e instanceof BatonRefusal && refusalKind(e.ruleCode) === 'contract-output' && !String(body.end_reason).startsWith('released:')) {
        // R-BTN-109: a completed end whose outputs fail its station's entry gives the leg up, as
        // a refused advance does — an output contract failure (R-BTN-82).
        this.log(`baton: ${ticket}'s outputs do not meet its arrival (${e.message}) — the leg is given up`);
        return await this.finish(claimId, { end_reason: 'released:cannot-finish:contract-output' }, handoff);
      } else if (e instanceof BatonRefusal) {
        throw e;
      } else {
        this.log(`baton: the end of ${ticket} did not reach Baton (${msg(e)}) — retried on every beat`);
        this.pendingEnds.set(claimId, body);
      }
    }
    const slot = this.cur;
    slot.ended = true;
    for (const id of [...slot.toAck.splice(0), ...this.toAck.splice(0)]) await this.o.api.ack(id).catch(() => {});
    // B-188: the state file holds the claims still held — this one no longer.
    if (this.slots.has(slot)) this.writeClaims();
    else this.state.set({ claim: null });
    // R-BTN-113 (B-4): the run's link is spent with its claim — never carried into another.
    this.legSessionUrl = null;
    this.sessionLinkLanded = false;
    // B-106 (R-BTN-178): the claim ended — its locks release, and a beat takes them again if
    // they are free, so an idle runner does not hold the machine's singleton. B-188: never a
    // lock another claim's leg holds.
    this.locks?.releaseAll((c) => this.lockHeldByLive(c, slot));
    for (const [c, owner] of [...this.lockOwners]) if (owner === slot) this.lockOwners.delete(c);
    // The lost lease belonged to that claim (R-BTN-6): a fresh claim starts on a fresh lease,
    // so the flag never outlives the claim it fenced — cleared here, not only on success.
    // B-188: once no other claim is still held under it.
    if (![...this.slots].some((x) => x !== slot && !x.ended)) {
      this.lostLease = false;
      this.state.set({ lease_lost: false, lease_lost_because: null });
    }
    this.closedDone = false;
    this.log(`baton: ${ticket} ${body.end_reason} at ${body.reached ?? '?'}`);
    return { ticket, end_reason: body.end_reason as string, reached: (body.reached as string) ?? null, handoff };
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** B-23's slice (the owner, 2026-10-23): every log line carries the time it was written —
 * an ISO 8601 instant, one timezone-free spelling on every machine. */
export const stampLine = (line: string): string => `${new Date().toISOString()} ${line}`;

/** B-108: a path's newest write — itself, or the newest file under it, the walk bounded (a
 *  store a live session grows without end is walked no further). A path that does not exist
 *  answers 0: a signal that was never live. */
export function newestWrite(path: string, depth = 0): number {
  let st: { mtimeMs: number; isDirectory(): boolean } | null = null;
  try {
    st = statSync(path);
  } catch {
    return 0;
  }
  let best = st.mtimeMs;
  if (!st.isDirectory() || depth >= 5) return best;
  let names: string[] = [];
  try {
    names = readdirSync(path);
  } catch {
    return best;
  }
  for (let i = 0; i < names.length && i < 512; i++) best = Math.max(best, newestWrite(join(path, names[i]), depth + 1));
  return best;
}

/** B-108: the leg in flight's disk activity signals — the wrapper's log (B-95's example path
 *  under the home checkout) and the harness stores keyed by the home checkout, the same paths
 *  the stub's idle bound reads. Which harnesses' stores are looked at is not narrowed by the
 *  agent command here (the runner does not resolve it — the stub does, at its snapshot): every
 *  path that does not exist answers 0 and never reads as live, so watching all of them is only
 *  ever the safe direction for the line that reads them. */
export function legActivity(home: string, ticket: string, leg: string): { name: string; at: number }[] {
  const dashed = home.split('/').join('-');
  const dataHome = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME !== '' ? process.env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
  const opencode = join(dataHome, 'opencode');
  const store = [join(opencode, 'opencode.db'), join(opencode, 'opencode.db-wal'), join(opencode, 'opencode.db-shm'), join(opencode, 'project', dashed)];
  const key = createHash('sha1').update(home).digest('hex');
  const snapshots = join(opencode, 'snapshot');
  let instances: string[] = [];
  try {
    instances = readdirSync(snapshots);
  } catch {
    // No snapshots directory: no instances to walk.
  }
  for (const i of instances) store.push(join(snapshots, i, key));
  const claude = process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR !== '' ? process.env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude');
  store.push(join(claude, 'projects', dashed));
  return [
    { name: 'wrapper-log', at: newestWrite(join(home, '.baton', 'logs', `${ticket}-${leg}.log`)) },
    { name: 'harness-store', at: store.reduce((best, p) => Math.max(best, newestWrite(p)), 0) },
  ];
}

/** B-108: an age in the beat's liveness line — seconds under 90, minutes above; a negative age
 *  (a clock the runner does not own) reads as zero. */
export const ageWords = (ms: number): string => {
  const age = Math.max(0, ms);
  return age < 90_000 ? `${Math.round(age / 1000)}s` : `${Math.round(age / 60_000)}m`;
};

/** B-108's streaming half (2026-10-24): drain a leg child's stream line by line into the log —
 * chunks are not line-aligned and a stamp per chunk would land mid-prose, so a buffer holds the
 * partial tail until its newline arrives (the stream's end flushes it; empty lines are dropped,
 * keeping the log tight). */
export const drainLines = (stream: NodeJS.ReadableStream, emit: (line: string) => void): void => {
  let tail = '';
  stream.on('data', (c) => {
    tail += String(c);
    let at: number;
    while ((at = tail.indexOf('\n')) >= 0) {
      const line = tail.slice(0, at);
      tail = tail.slice(at + 1);
      if (line.trim() !== '') emit(line);
    }
  });
  stream.on('end', () => { if (tail.trim() !== '') emit(tail); });
};
export const withTimestamps = (log: (line: string) => void): ((line: string) => void) =>
  (line) => log(stampLine(line));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
