// The runner allocates checkouts and machine locks, claims tickets and supervises their runs.
import type { ClaimAnswer } from '../shared/runner-wire';
import { createHash, randomBytes } from 'node:crypto';
import { writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { batonNow } from '../shared/baton.mjs';
import type { LocalQueue } from './queue';
import type { RefState } from './audit';
import { BatonApi, BatonRefusal, batonUnreachable } from './api';
import { courseOf, dropCourse, freshSecret, loadCourse, readHead, type CourseLoad } from './home';
import { builtinExecutor, type Executor, type Handle } from './executor';
import { StateFile, leaseLostFrom, type PersistedClaim } from './state';
import { ClaimRun, type ClaimOutcome, type Resume } from './claimRun';
import { Sidecar, BEAT_MS } from './sidecar';
import { MachineLocks } from './machineLocks';
import { msg, sleep, stampLine, withTimestamps } from './log';

export { BEAT_MS, declarationFrom } from './sidecar';
export { SIGNAL_GRACE_MS, type ClaimOutcome } from './claimRun';
export { LOCK_WATCHER, lockWatcherArgv } from './machineLocks';
export { stampLine, newestWrite, legActivity, ageWords, drainLines, withTimestamps } from './log';

export interface RunnerOptions {
  /** R-BTN-202 (B-248): this home checkout's local work queue — the host user's orders and the
   *  legs run offline awaiting their report. Absent, the runner never runs offline. */
  queue?: LocalQueue;
  api: BatonApi;
  /** B-229: a separate API for another session's runner, by its secret — how a runner that
   *  starts ends the claims its host's earlier sessions left (their state files, beside this
   *  one). Separate, so this runner's own beats never carry the other's secret. Absent: none. */
  apiFor?: (secret: string) => BatonApi;
  /** The home repository's checkout, whose git the course and the scripts come from. */
  home: string;
  /** The Baton repository id that checkout is (the heartbeat's courses are declared for it). */
  repository: string;
  /** The runner's hostname — the credential's registered name (§6.4). */
  hostname: string;
  harness: 'opencode' | 'claude-code';
  session: string;
  /** B-86: what the heartbeat declares — `--capabilities`, which narrows. Absent, the runner asks
   *  once (a beat declaring nothing) and declares the grant the answer carries. */
  capabilities?: string[];
  /** B-86: the rule 4 names the legs of the courses it serves require, read from the home checkout
   *  each time it is asked, so a runner whose declaration lacks one says so at startup. Injected by
   *  `baton run`; absent, no such line. B-103: every served course's legs, not one course's. */
  legNeeds?: (courses: RunnerOptions['courses']) => Promise<string[]> | string[];
  tierCeiling?: string;
  /** The courses this runner serves and declares (B-103, rule 9): every course its home checkout
   *  declares, or the one `--course` narrowed it to. The claim it takes names the ticket's course
   *  (`course_id`), which `runClaim` loads from the claim's snapshot — so one runner, one checkout,
   *  serves several courses, one leg at a time (rule 3). */
  courses: { course: string; version: number }[];
  /** Re-read the home declaration after a successful advance. */
  readCourses?: () => RunnerOptions['courses'];
  /** Bring an idle home to its default branch's fetched snapshot. True when safe to re-read. */
  refreshHome?: () => boolean;
  /** Return the reason to restart, or null. Called only with no claim or leg in flight. */
  restartReason?: () => string | null;
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

export class Runner {
  private readonly o: RunnerOptions & { beatEvery: number };
  private readonly state: StateFile;
  private readonly log: (line: string) => void;
  private readonly verbose: boolean;
  /** R-BTN-107 (B-184): every leg and every call into repository code runs through it. */
  private readonly executor: Executor;
  private readonly now: () => number;
  private stopped = false;
  /** 2026-10-24: draining — SIGTERM's path (complete the current leg, then stop). Set once;
   * the claim loop ends the claim at the next leg boundary with its hand-off, the idle wait
   * returns, and work() ends without claiming again. */
  private draining = false;
  /** Bumps with every claim: an answer a beat started before the claim cannot fence it. */
  private epoch = 0;
  /** B-86: the empty-declaration line has been said, once, since `runOnce` would ask each time. */
  private saidEmpty = false;
  private readonly locks: MachineLocks | null;
  private readonly sidecar: Sidecar;
  private readonly slots = new Set<ClaimRun>();
  private readonly concurrency: number;
  /** Claim requests out, unanswered: a beat built or answered meanwhile cannot tell a claim
   *  Baton just granted from one this runner does not hold. */
  private claimsOut = 0;
  /** B-106, B-188: which claim's leg holds each machine lock — a leg's lock is never released
   *  by another claim's. */
  private readonly lockOwners = new Map<string, ClaimRun>();
  /** B-188: the clones in use, by index. */
  private readonly clonesBusy = new Set<number>();
  /** R-BTN-72 (B-188): the claims the state file held when this process started — reattached,
   *  ended or let go before the first claim; the beat leaves them alone until then. */
  private persisted: PersistedClaim[];
  /** Those of them written before B-188 (`claim` alone): ended as orphans, as before. */
  private readonly legacy: Set<number>;
  /** Whether the lease still held when this process started (R-BTN-72's reattach window). */
  private readonly startedInLease: boolean;
  /** The claim runs in flight (several at k > 1). */
  private readonly tasks = new Set<Promise<unknown>>();
  /** R-BTN-72 (B-188): the reattached claims' runs at one claim, which `runOnce` returns. */
  private readonly resumed: Promise<ClaimOutcome | null>[] = [];
  /** Set when a claim's run ends, so an idle wait at k > 1 asks again at once. */
  private roomMade = false;
  /** R-BTN-202 (B-248): the leg running under a local order while Baton is unreachable — held
   *  by no claim, so no beat reports it; the stop paths reach it here. */
  private offlineSlot: ClaimRun | null = null;
  private restartRequested = false;
  /** R-BTN-202: why each order waits, once said — idle retries say it again only when it changes. */
  private saidOffline = new Map<string, string>();

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
    this.sidecar = new Sidecar({ ...this.o, readCourses: () => this.o.courses, concurrency: k, now: this.now, log: this.log }, this.state, this.locks,
      () => ({ live: [...this.slots], persisted: this.persisted, epoch: this.epoch, pendingRequests: this.claimsOut }),
      (why) => this.drain(why));
  }

  start(): void { this.sidecar.start(); }
  tick(): Promise<void> { return this.sidecar.tick(); }

  stop(): void {
    this.stopped = true;
    this.sidecar.stop();
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
      const slot = [...this.slots].find((x) => x.claimId === id);
      return slot?.inflight ? `leg ${slot.inflight.leg ?? '?'}` : 'no leg in flight';
    };
    if (held.length <= 1) {
      const claim = held[0] ? `claim ${held[0].id} on ${held[0].ticket_id}` : 'no claim';
      return `${why}: ${claim}, ${legOf(held[0]?.id ?? null)}, last beat ${beat}`;
    }
    return `${why}: ${held.map((c) => `claim ${c.id} on ${c.ticket_id}, ${legOf(c.id)}`).join('; ')}, last beat ${beat}`;
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
    for (const x of this.slots) x.killLeg();
    this.offlineSlot?.killLeg();
  }

  /** B-227: the immediate stop's last resort, when the leg would not take its release in time:
   *  the call is killed and its session stopped — an executor's sandbox ends with the runner,
   *  never outliving it — before the caller exits. The claim is left to the reaper (R-BTN-24). */
  async hardStop(): Promise<void> {
    this.killInflight();
    const live = this.offlineSlot ? [...this.slots, this.offlineSlot] : [...this.slots];
    await Promise.all(live.map((x) => x.stopSession('hard-stop')));
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
    for (const x of this.slots) x.signalLeg('release', 'released:requested');
    this.offlineSlot?.signalLeg('release', 'released:requested');
  }

  async work(): Promise<number> {
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
        // R-BTN-202 (B-248): Baton is unreachable — an order queued on this host runs its leg
        // without a claim, and Baton is asked again after it.
        if (batonUnreachable(e) && !this.draining && !this.stopped && await this.runOffline(msg(e))) continue;
        await this.idleWait();
      }
    }
    // Draining (or stopped): every claim still running ends at its own boundary first.
    await Promise.allSettled([...this.tasks]);
    this.stop();
    await this.sidecar.waitForBeat();
    return this.restartRequested ? 75 : 0;
  }

  private refreshCourses(): void {
    if (!this.o.readCourses) return;
    try {
      const next = this.o.readCourses();
      const previous = new Map(this.o.courses.map(({ course, version }) => [course, version]));
      let changed = false;
      for (const { course, version } of next) {
        const was = previous.get(course);
        if (was !== version) {
          this.log(`baton: course ${course} now version ${version}${was == null ? '' : ` (was ${was})`}`);
          changed = true;
        }
        previous.delete(course);
      }
      for (const [course, version] of previous) this.log(`baton: course ${course} no longer declared (was ${version})`);
      if (changed || previous.size) this.o.courses = next;
    } catch (e) {
      this.log(`baton: keeping the last course declaration (${msg(e)})`);
    }
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
    while (!this.stopped && !this.draining && !this.sidecar.takeUnblocked() && !this.roomMade && this.now() < until) await sleep(Math.min(50, this.o.beatEvery));
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
  private async claimNext(): Promise<{ claim: ClaimAnswer; slot: ClaimRun } | null> {
    this.roomMade = false;
    // The runner must exist before it can claim (§5): one heartbeat registers it. Whether this
    // attempt is the registration (B-93) is read before this attempt's own beat: an attempt that
    // finds no runner is the one whose heartbeat creates it, so nothing it asks before that beat
    // is authenticated.
    const registered = this.state.get().runner_id != null;
    // B-93 (review round 1): the beat must be *finished* here, not merely started. During it
    // Baton already holds the new runner's secret — `beatOnce` sends `secret_hash` for one the
    // state does not name yet — but the state names neither the runner nor the re-key until the
    // answer, so a claim that overlapped a slow beat was refused `unauthenticated` and
    // logged: the first-beat noise again. `tick()` refuses to run beside a beat (it returns at
    // once while the timer's is out), so a beat in flight is waited for, never skipped.
    await this.sidecar.waitForBeat();
    // The wait may have been the boot beat that registered this runner (review round 2, finding
    // 3): its answer names the runner in the state, so the id is read again here — never before
    // the wait, or every `start()` → `work()` start beat a second time for nothing — and by
    // `stray` too, so a registration attempt is the one that began with no runner at all.
    const runner = this.state.get().runner_id;
    // A beat of the attempt's own, when no runner is named yet; the claim after it is the
    // first ask of one Baton may hold no secret for, so it is a registration attempt too.
    let beating = false;
    if (runner == null) { await this.tick(); beating = true; }
    // R-BTN-72 (B-188): the claims the state file named when this process started — reattached
    // within the lease when the executor can, else ended — before any claim of this process.
    await this.settlePersisted();
    // One claim at a time: a reattached claim is this attempt's run (`runOnce` awaits it).
    if (this.concurrency === 1 && this.resumed.length) return null;
    // B-229: and what this host's earlier sessions still hold — each start is a new session with
    // a new state file, so the orphan above never sees them.
    await this.sidecar.endEarlierSessions();
    if (this.stopped || this.draining) return null;
    if (this.slots.size === 0 && this.claimsOut === 0 && !this.offlineSlot) {
      if (this.o.refreshHome?.()) this.refreshCourses();
      // The home fetch may also move the CLI's upstream when they share a checkout.
      const reason = !this.sidecar.hasPendingEnds && this.o.restartReason?.();
      if (reason) {
        this.restartRequested = true;
        this.drain(reason);
        return null;
      }
    }
    // R-BTN-4 (B-188): no room — the runner holds its bound.
    if (this.slots.size >= this.concurrency) return null;
    // B-86: the claim goes out only on the declaration the server holds — `sent` is the list the
    // last answered beat carried, which is what `rewriteSettings` recorded. A runner whose grant
    // arrived on a beat that declared nothing must beat once more before claiming (review round
    // 3): the first claim, and every idle attempt, otherwise goes out while the server still sees
    // `[]` and rule 4 refuses each leg. A grant-less answer leaves the declaration unsettled, so
    // each attempt asks again until a grant arrives (finding 6).
    // Review round 4 (finding 4): one beat may not be enough — a restart from a pre-B-86 state
    // file (`runner_id` set, no `declared`) beats at that moment declaring `[]` and settles the
    // grant, which leaves `sent` ≠ the list this claim carries. So beat again while they differ,
    // at most MAX_STALE_BEATS times a claim attempt; a grant-less answer (`grantAsked`) ends the
    // loop after its one beat, as it always did — the declaration is unsettled and the claim goes
    // out on what this runner named.
    // Only an attempt that began unregistered can receive a registration's stray refusal.
    if (await this.sidecar.settleDeclaration()) beating = !registered;
    if (!this.sidecar.coursesSettled || this.stopped || this.draining) return null;
    // An empty declaration is not "nothing to do" (finding 5): rule 4 passes any declaration for
    // a ticket with no `Requires:` clause, so it still claims — the line below explains what it
    // can never take, once, since every idle attempt returns here.
    if (this.sidecar.declaredNothing && !this.saidEmpty) {
      this.saidEmpty = true;
      this.log(`baton: this runner declared nothing — its key's grant allows no capability on the repositories its courses are in, so every leg requiring one refuses it rule 4 (missing-capability); have the owner grant it (baton owner grant <repository> --key …, R-BTN-58)`);
    }
    return this.requestClaim(beating || !registered);
  }

  private async requestClaim(registering: boolean): Promise<{ claim: ClaimAnswer; slot: ClaimRun } | null> {
    // R-BTN-202 (B-248): the local queue first — a leg run offline whose result waits for Baton,
    // then the host user's oldest order, each claimed by name: Baton's claim decides, every gate
    // in force. Otherwise R-BTN-72 / B-287: an unnamed claim selects and claims atomically.
    const q = this.o.queue;
    const queued = q?.read() ?? null;
    const preworked = queued?.worked[0] ?? null;
    const order = preworked == null ? (queued?.orders[0] ?? null) : null;
    const wanted: string | undefined = preworked?.ticket_id ?? order?.ticket_id;
    let claim: ClaimAnswer;
    const requestId = `run-${randomBytes(8).toString('hex')}`;
    this.claimsOut++;
    try {
      claim = await this.o.api.claim({ request_id: requestId, ...(wanted ? { ticket_id: wanted } : {}) });
    } catch (e) {
      // B-106 (R-BTN-178): a refused claim releases the locks it would have used — the machine's
      // singleton is not held by an idle runner (B-188: nor taken from a claim's running leg).
      if (this.locks && e instanceof BatonRefusal) this.locks.releaseAll((c) => this.lockReservedByOther(c, null));
      // R-BTN-202 (B-248): Baton refused the order's ticket (or the offline result's) — a gate,
      // another holder, a ticket no longer on the board. The order goes; an offline result is
      // not reported, and what its leg pushed stays in git. An unreachable Baton keeps both.
      if (q && (order || preworked) && e instanceof BatonRefusal && !batonUnreachable(e)) {
        if (preworked) {
          q.takeWorked(preworked.ticket_id);
          this.log(`baton: Baton refused the claim on ${preworked.ticket_id} (${e.message}) — the ${preworked.leg} run offline under ${preworked.by}'s order is not reported; what it pushed stays in git (R-BTN-202)`);
        } else {
          q.dropOrder(order!.ticket_id);
          this.log(`baton: Baton refused the claim on ordered ${order!.ticket_id} (${e.message}) — the order is dropped (R-BTN-202)`);
        }
        return null;
      }
      if (e instanceof BatonRefusal && e.code === 'no-eligible-ticket') return null;
      if (e instanceof BatonRefusal && e.code === 'unauthenticated') {
        // B-93: only the registration's own missing-secret refusal is quiet. A replaced
        // secret or replayed nonce still names itself, now on the single claim request.
        const stray = registering && /no runner holds this secret/.test(e.message);
        if (!stray) this.log(`baton: no claim (${e.message})`);
        return null;
      }
      if (e instanceof BatonRefusal && e.code === 'not-eligible' && /already held|runner-holds/.test(e.message)) {
        // The runner still holds a claim Baton knows and this runner does not (its state was
        // lost with the container): the heartbeat's claim view named it, so end it loudly
        // rather than idling on the refusal forever.
        const held = this.slots.size === 0 ? this.state.get().claim : null;
        this.log(`baton: the claim was refused — this runner still holds ${held ? `claim ${held.id}` : 'a claim'} (${e.message})`);
        if (held) {
          this.state.set({ claim: null });
          await this.sidecar.endQuietly(held.id, { end_reason: 'released:lease-lost', next: null });
        }
        return null;
      }
      // R-BTN-4 (B-188): `max-claims` among them — the runner is at its bound for now.
      if (e instanceof BatonRefusal && e.code === 'not-eligible') {
        this.log(`baton: no claim (${e.message})`);
        return null;
      }
      throw e;
    } finally {
      this.claimsOut--;
    }
    this.epoch++;
    const ticket = claim.ticket_id;
    const claimId = claim.claim_id;
    // R-BTN-4 (B-188): the claim's slot is held from here — before any await, so no beat can
    // read a claim Baton granted as one this runner does not hold.
    const slot = this.newSlot();
    slot.claimId = claimId;
    slot.ticket = ticket;
    slot.nonce = String(claim.nonce ?? '');
    slot.requestId = requestId;
    this.slots.add(slot);
    this.writeClaims();
    if (q) {
      // R-BTN-202 (B-248): whether this repository requires owner-signed control, as the last
      // claim answer said — what decides whether an order may run offline.
      q.setControlRequired(claim.control?.required === true);
      if (preworked && ticket === preworked.ticket_id) slot.preworked = q.takeWorked(ticket);
      if (order && ticket === order.ticket_id) {
        q.dropOrder(ticket);
        this.log(`baton: claimed ${ticket} under ${order.by}'s order (R-BTN-202)`);
      }
    }
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

  /** R-BTN-202 (B-248): Baton is unreachable — run the first order queued on this host that can
   *  run offline, its leg started without a claim. Returns whether a leg ran. An order runs
   *  offline only at one claim (`--concurrency 1`, the home checkout), on a one-course runner,
   *  where the last claim answer said the repository requires no owner-signed control (B-127:
   *  only Baton's record names the signed commits), and when its leg is known — the order's
   *  `@leg` — and leaves exactly one station.
   *  Nothing tells this runner whether another runner works the same leg meanwhile; it says so
   *  and runs. A finished leg is closed (its evidence in git) and its result kept in the queue,
   *  reported through an ordinary claim when Baton answers again; nothing else is decided here. */
  private async runOffline(why: string): Promise<boolean> {
    const q = this.o.queue;
    if (!q) return false;
    const d = q.read();
    const wait = (ticket: string, reason: string) => {
      if (this.saidOffline.get(ticket) === reason) return;
      this.saidOffline.set(ticket, reason);
      this.log(`baton: the order for ${ticket} waits for Baton — ${reason} (R-BTN-202)`);
    };
    for (const order of d.orders) {
      if (this.concurrency !== 1) { wait(order.ticket_id, 'an order runs offline only at --concurrency 1'); continue; }
      if (d.control_required !== false) {
        wait(order.ticket_id, d.control_required ? 'the repository requires owner-signed control (B-127), whose signed commits only Baton\'s record names' : 'no claim answer has yet said whether the repository requires owner-signed control (B-127)');
        continue;
      }
      if (this.o.courses.length !== 1) { wait(order.ticket_id, `this runner serves ${this.o.courses.length} courses, and without Baton it cannot tell which one the ticket is on`); continue; }
      const leg = order.leg;
      if (leg == null) { wait(order.ticket_id, `it names no leg — queue it as ${order.ticket_id}@<leg> to run it without Baton`); continue; }
      let sha: string;
      let course: CourseLoad;
      try {
        sha = readHead(this.o.home);
        course = loadCourse(this.o.home, sha, courseOf(this.o.home, sha, this.o.courses[0].course));
      } catch (e) {
        wait(order.ticket_id, `the home's course would not load (${msg(e)})`);
        continue;
      }
      const def = course.graph.legs.get(leg);
      const at = def?.from.length === 1 ? def.from[0] : null;
      if (def == null || at == null) {
        dropCourse(course.scratch);
        wait(order.ticket_id, def == null ? `${leg} is not a leg of course ${course.course}` : `${leg} leaves ${def.from.join(' or ')}, and without Baton the runner cannot tell where the ticket rests`);
        continue;
      }
      if (Object.keys(def.inputs ?? {}).length || def.outputs || def.to.some((station) => course.graph.entry.has(station))) {
        dropCourse(course.scratch);
        wait(order.ticket_id, `${leg} needs Baton for its contract or station entry (R-BTN-82)`);
        continue;
      }
      this.saidOffline.delete(order.ticket_id);
      const slot = this.makeRun(this.o.home);
      slot.offline = true;
      slot.ticket = order.ticket_id;
      this.offlineSlot = slot;
      try {
        await slot.runOfflineLeg(q, order, leg, at, sha, course, why);
      } finally {
        this.releaseLegLocks(slot);
        this.offlineSlot = null;
      }
      return true;
    }
    return false;
  }
  /** B-188: a fresh slot — in the home checkout at one claim, else in a free clone of its own. */
  private newSlot(at?: string): ClaimRun {
    if (this.concurrency === 1) return this.makeRun(at ?? this.o.home);
    if (at != null && at !== this.o.home) {
      const n = Number(basename(at));
      const slot = this.makeRun(at);
      if (resolve(dirname(at)) === resolve(this.clonesDir()) && Number.isInteger(n)) {
        slot.cloneIndex = n;
        this.clonesBusy.add(n);
      }
      return slot;
    }
    let n = 1;
    while (this.clonesBusy.has(n)) n++;
    this.clonesBusy.add(n);
    const slot = this.makeRun(join(this.clonesDir(), String(n)));
    slot.cloneIndex = n;
    return slot;
  }

  /** B-188: where the clones live — `clonesDir`, else beside the state file, keyed by the home. */
  private clonesDir(): string {
    return this.o.clonesDir ?? join(dirname(this.o.stateFile), 'clones', createHash('sha1').update(resolve(this.o.home)).digest('hex').slice(0, 12));
  }

  /** B-188: one claim's whole run, bound to its slot — the slot is let go, its clone freed and
   *  the state file's claims rewritten when it ends, whatever ended it. */
  private async runInSlot(claim: ClaimAnswer, slot: ClaimRun, resume?: Resume): Promise<ClaimOutcome> {
    try {
      return await slot.runClaim(claim, resume);
    } finally {
      slot.ended = true;
      this.slots.delete(slot);
      for (const [c, owner] of this.lockOwners) {
        if (owner !== slot) continue;
        this.locks?.release(c);
        this.lockOwners.delete(c);
      }
      if (slot.cloneIndex != null) this.clonesBusy.delete(slot.cloneIndex);
      this.writeClaims();
      this.roomMade = true;
    }
  }

  /** Ownership survives `ended`: an acknowledgement can still be in flight (S-BTN-21). */
  private lockReservedByOther(capability: string, except: ClaimRun | null): boolean {
    const owner = this.lockOwners.get(capability);
    return owner != null && owner !== except;
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
        await this.sidecar.endQuietly(p.id, { end_reason: 'released:lease-lost', next: null });
        continue;
      }
      if (this.sidecar.claimListed(p.id) === false) {
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
      await this.sidecar.endQuietly(p.id, { end_reason: 'released:cannot-finish:transient', next: null });
    }
  }

  /** R-BTN-72 (B-188): reconnect to a persisted claim's running leg — the executor's `reattach`
   *  over the handle its state kept, and the claim's answer again by its `request_id` (the same
   *  claim, G-BTN-2) — or why not. */
  private async reattach(p: PersistedClaim): Promise<{ handle: Handle; claim: ClaimAnswer } | { why: string }> {
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
  /** B-106 (R-BTN-178): take every lock the leg requires before the claim's work or the advance
   *  starts, and release those an earlier leg of the claim needed and this one does not — the
   *  lock is held from before the leg starts until the claim ends or leaves the legs requiring
   *  it. False when a lock another process on this machine holds could not be taken: the caller
   *  suspends rather than run the leg, or send the advance (R-BTN-121, R-BTN-71). */
  private async ensureLegLocks(slot: ClaimRun, leg: string, course: CourseLoad): Promise<boolean> {
    const locks = this.locks;
    if (!locks) return true;
    const needed = (course.graph.legs.get(leg)?.requires ?? []).filter((c) => locks.manages(c));
    let ok = true;
    for (const capability of needed) {
      // B-188: one machine's singleton is one leg's, whichever claim runs it — another claim's
      // leg holding it is a lock this claim cannot take.
      if (this.lockReservedByOther(capability, slot)) {
        ok = false;
        continue;
      }
      // Even an already-held flock yields in take(); reserve before that yield.
      this.lockOwners.set(capability, slot);
      if (!(await locks.take(capability))) {
        this.lockOwners.delete(capability);
        ok = false;
      }
    }
    // Released: what this claim's earlier leg needed and this one does not — never a lock
    // another claim's leg holds.
    locks.releaseAll((c) => needed.includes(c) || this.lockReservedByOther(c, slot));
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
    await this.sidecar.declareLocks(needed);
    return true;
  }

  private makeRun(checkout: string): ClaimRun {
    return new ClaimRun(checkout, { ...this.o, now: this.now, verbose: this.verbose, log: this.log },
      this.state, this.executor, this.sidecar, {
        homeAdvanced: () => this.refreshCourses(),
        ensureLegLocks: (run, leg, course) => this.ensureLegLocks(run, leg, course),
        savePlace: (run) => { if (this.slots.has(run)) this.writeClaims(); },
        retire: (run) => {
          this.writeClaims();
          this.releaseLegLocks(run);
          if (![...this.slots].some((x) => !x.ended)) this.sidecar.clearLeaseLoss();
        },
        isStopping: () => this.stopped,
        isDraining: () => this.draining,
      });
  }

  private releaseLegLocks(run: ClaimRun): void {
    this.locks?.releaseAll((c) => this.lockReservedByOther(c, run));
    for (const [c, owner] of this.lockOwners) if (owner === run) this.lockOwners.delete(c);
  }
}
