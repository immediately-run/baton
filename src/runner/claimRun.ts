// One claim's checkout, executor session, verification and course progression.
import { git } from '../defaults/git.mjs';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySignedCommit, nodeKeygen } from '../shared/commitSign.mjs';
import { controlGroupsOf, groupUnchangedAt } from '../defaults/signed-control';
import { checkRaise, dispositionOf, errorClassOf, raiseRestarts, SEVERITIES, type ConditionDeclaration } from '../core/conditionTypes';
import type { ScopeAction } from '../core/scope';
import { BatonRefusal, batonUnreachable } from './api';
import { outsideScope, pushesBetween, readRefState, type RefState } from './audit';
import { advanceHome, claimScratch, courseOf, dropCourse, ensureSha, extractTicketSource, loadCourse, prepareClone, readHead, type CourseLoad } from './home';
import type { ExecOptions, Executor, Handle, Running, SessionKind } from './executor';
import { LegChannel, channelPath, type ChannelAnswer, type ChannelRequest } from './channel';
import { MIN_SECRET_BYTES, createLegMasker, failureDetail, maskLegOutput, namesASecret, secretValues } from './mask';
import { decide, refusalKind, runNumber, shortWaitSpent, waitState } from './protocol';
import { leaseLostFrom, type PersistedClaim, type StateFile } from './state';
import { bareTicketId } from '../defaults/ticket-state';
import { digestOfRead, MARKDOWN_SOURCE } from '../defaults/ticket-versions';
import type { LocalOrder, LocalQueue, WorkedLeg } from './queue';
import type { RunnerOptions } from './runner';
import type { Sidecar } from './sidecar';
import { msg } from './log';
import type { AdvanceAnswer, ClaimAnswer, NextLegs } from '../shared/runner-wire';

export type { NextLegs } from '../shared/runner-wire';
import { checkLegOutputs, readLegInputs } from './contracts';
import type { ResolvedInput } from '../core/contracts';
import type { PointerReach } from '../core/contractPointers';

const NO_REACH: PointerReach = { git: [], web: [], buckets: [] };

const LEG_PROCESS = fileURLToPath(new URL('./legProcess.mjs', import.meta.url));
/** B-234 (R-BTN-195, R-BTN-145): the default grace a released leg gets to take its safe point
 * and exit by itself before its still-running session is treated as joinable-and-stuck — the
 * stop ladder's own bound. */
export const SIGNAL_GRACE_MS = 30_000;
/** R-BTN-72 (B-188): a reattached leg — where it stands, and the live handle of its session. */
export interface Resume {
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
type WrapperOutcome = { ok: boolean; result?: unknown; error?: string; errorType?: unknown; aborted?: string | null };
function wrapperOutcome(stdout: string): WrapperOutcome | null {
  const last = stdout.trimEnd().split('\n').at(-1) ?? '';
  try {
    const out = JSON.parse(last) as { ok?: unknown };
    return out && typeof out === 'object' && typeof out.ok === 'boolean' ? out as { ok: boolean } : null;
  } catch {
    return null;
  }
}

/** How a leg ended for the runner's own accounting; the claim's end is `end_reason`. */
export interface ClaimOutcome {
  ticket: string;
  end_reason: string;
  reached: string | null;
  handoff: string | null;
}
/** Why the sidecar asked the running leg to stop (§6.13's three signal reasons). `reason` is the
 * claim-level end it becomes; a regression names its station only when the leg settles, so it
 * carries none and the runner builds `suspended:<the leg's from>` then. */
interface PendingAbort {
  signal: 'release' | 'regressed' | 'course-changed';
  reason?: string;
  error?: { type: string; message: string };
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

interface PreparedClaim {
  course: CourseLoad;
  scratch: string;
  signedControl: Record<string, string>;
  ticketFile: string | null;
  read: { version: string; read_digest: string } | null;
}

interface LegProgress {
  reach: PointerReach;
  resolvedInputs: ResolvedInput[];
  at: string;
  legName: string;
  nextLegs: NextLegs;
  gitPath: { leg: string; reached: string }[];
  /** B-335 (R-BTN-63): the run's number as Baton's advance reply named it — the count its
   *  `max_runs` check reads; null from a server that does not send it. */
  run: number | null;
  runId: string | null;
  handoffUrl: string | null;
  resume: Record<string, any> | null;
  advice: unknown;
  session: string | null;
  resuming?: Resume;
  ranScript: string | null;
  ranCtx: Record<string, unknown> | null;
}

type LegOutcome = { kind: 'contract-input'; detail: string | null } | { kind: 'ok'; result: unknown } | { kind: 'crashed'; error: string; errorType?: unknown } | { kind: 'missing' } | { kind: 'lease-lost' };

interface LegExecution {
  outcome: LegOutcome;
  pre: WorkedLeg | null;
  ctx: Record<string, unknown>;
  script: string | null;
  run: number;
}

type ClaimOptions = Pick<RunnerOptions, 'api' | 'home' | 'repository' | 'courses' | 'fetch' |
  'stateFile' | 'agentCommand' | 'maskEnv' | 'signalGraceMs' | 'auditRefs'> & {
  beatEvery: number;
  verbose: boolean;
  now: () => number;
  log: (line: string) => void;
};

/** Process-wide resources which a claim cannot allocate or release on its own. */
interface ClaimHost {
  ensureLegLocks(run: ClaimRun, leg: string, course: CourseLoad): Promise<boolean>;
  savePlace(run: ClaimRun): void;
  retire(run: ClaimRun): void;
  isStopping(): boolean;
  isDraining(): boolean;
  homeAdvanced?(): void;
}

/** R-BTN-4: a fresh run owns all of its mutable claim state, including when reattached. */
export class ClaimRun {
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
  private readonly toAck: number[] = [];
  /** B-188: the clone this claim holds (`<clonesDir>/<n>`), null in the home checkout. */
  cloneIndex: number | null = null;
  /** R-BTN-72 (B-188): the running leg's place, persisted for a restart's reattach. */
  place: Pick<PersistedClaim, 'run_id' | 'seq' | 'leg' | 'at' | 'handle' | 'ctx'> = {};
  /** R-BTN-202 (B-248): a leg run under a local order while Baton is unreachable — no claim, no
   *  lease: nothing fences it, and no beat reports it. */
  offline = false;
  /** R-BTN-202 (B-248): the leg this claim's ticket already ran under a local order, offline —
   *  its result reported in place of running it again when Baton offers that same leg. */
  preworked: WorkedLeg | null = null;
  /** R-BTN-202: the provenance the call that finishes the preworked leg carries, once. */
  localOrder: { by: string; ran_at: string } | null = null;
  constructor(
    readonly checkout: string,
    private readonly o: ClaimOptions,
    private readonly state: Pick<StateFile, 'get'>,
    private readonly executor: Pick<Executor, 'source' | 'start' | 'stop' | 'exec' | 'end'>,
    private readonly sidecar: Pick<Sidecar, 'tick' | 'leaseLost' | 'parkEnd' | 'ackEnd'>,
    private readonly host: ClaimHost,
  ) {}

  /** R-BTN-6, R-BTN-26: the current claim is fenced — the runner's lease is lost, or Baton no
   *  longer lists this claim alone. */
  private claimLost(): boolean {
    // R-BTN-202 (B-248): an offline leg holds no lease to lose.
    if (this.offline) return false;
    return this.sidecar.leaseLost || this.lost;
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
        await this.sidecar.tick();
      } catch (e) {
        this.o.log(`baton: the heartbeat that lands the session link failed (${msg(e)}) — an interact is refused until one lands it (R-BTN-113)`);
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
        await this.sidecar.tick();
      } catch (e) {
        this.o.log(`baton: the heartbeat that reports the finished leg failed (${msg(e)}) — the next beat carries it (R-BTN-90)`);
        return;
      }
    }
  }

  /** The pending signal as the loop reads it — through a call, so a field-narrowed null at one
   * check point never hides the signal a later tick recorded. */
  private abortSignal(): PendingAbort | null {
    return this.pendingAbort;
  }

  /** Ask the claim to stop at its next safe point (§6.13's `release`/`regressed` signals): the
   * signal is recorded whether or not a leg process is running — a release that lands in a
   * short wait or between legs is honoured just the same, never dropped. */

  signalLeg(signal: PendingAbort['signal'], reason?: string, error?: PendingAbort['error']): void {
    if (!this.inflight) return;
    // A release is the strongest signal: it overrides a regression or a course change that
    // landed first, so its message is never acknowledged away (§6.13, §9).
    if (this.pendingAbort && !(signal === 'release' && this.pendingAbort.signal !== 'release')) return;
    this.pendingAbort = { signal, reason, error };
    // The wire carries §6.13's closed reason set: a course change stops the leg the way a
    // release does — at its next safe point — so that is the signal it gets.
    const child = this.inflight.child;
    const wire = signal === 'course-changed' ? 'release' : signal;
    child?.running.write(JSON.stringify({ abort: wire }));
  }

  killLeg(): void {
    this.inflight?.child?.running.kill();
  }

  fence(): void {
    this.lost = true;
    this.killLeg();
    void this.stopSession('lease-lost');
  }

  get heartbeatLeg() {
    const leg = this.inflight;
    return leg && { claimId: leg.claimId, ticket: leg.ticket, leg: leg.leg, legAt: leg.legAt, running: leg.child != null };
  }

  acceptHeartbeatReports(linkSeq: number | undefined, finishedSeq: number | undefined): void {
    // R-BTN-113, R-BTN-90: a reply only confirms the generations its request carried.
    this.sessionLinkLanded = linkSeq === this.sessionLinkSeq;
    if (this.legFinishedSeq === finishedSeq) this.legFinishedSeq = null;
  }

  applyGitView(view: unknown): void {
    if (!this.inflight) return;
    if (view === 'unknown') this.signalLeg('course-changed', 'released:course-changed');
    else if (view && typeof view === 'object') {
      const { closed, regressed, next } = view as { closed?: string; regressed?: boolean; next?: NextLegs | null };
      if (closed === 'done') this.closedDone = true;
      else if (regressed) this.signalLeg('regressed');
      for (const w of this.inflight.waiters.splice(0)) w(next ?? []);
    }
  }

  receiveRelease(id: number, reason: string): void {
    if (!this.toAck.includes(id)) this.toAck.push(id);
    this.signalLeg('release', reason);
  }

  /** Start a session of `kind` on the executor the host chose. */
  private async startSession(kind: SessionKind, o: { session_id: string; run_id?: string; ticket?: string; leg?: string; snapshot_sha?: string; paths: string[]; env: Record<string, string>; channel?: string | null; autonomous?: boolean; reads_only?: boolean }): Promise<Handle> {
    const run = kind === 'leg' ? o.run_id : undefined;
    return await this.executor.start({
      brief: { kind, ...o, checkout: this.checkout, wrapper: LEG_PROCESS, ...(o.autonomous ? { autonomous: true } : {}) },
      ...(run && this.executor.source === 'pinned' ? { forgeProof: () => this.o.api.forgeProof(run) } : {}),
      executor: null, inputs: [], channel: o.channel ?? null,
    });
  }

  /** The session `close` and `handoff` run in: the last leg's, or — a hand-off with no leg run
   *  in this claim yet — a fresh `leg` session over the claim's course scripts. */
  private async legSession(ctx: Record<string, unknown>, run = typeof ctx.run_id === 'string' ? ctx.run_id : undefined): Promise<Handle | null> {
    if (this.claimLost()) return null;
    if (this.session) return this.session.handle;
    const paths = this.inflight ? [this.inflight.course.scratch] : [];
    const handle = await this.startSession('leg', { session_id: `leg-${randomBytes(6).toString('hex')}`, ...(run ? { run_id: run } : {}), paths, env: this.baseEnv() });
    this.session = { handle, checkout: this.checkout };
    if (this.claimLost()) {
      await this.stopSession('lease-lost');
      return null;
    }
    return handle;
  }

  /** The environment every session starts from: the runner's, with the parent markers (R-BTN-144). */
  private baseEnv(): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env, BATON_PARENT: String(this.state.get().runner_id ?? ''), BATON_STATE: this.o.stateFile };
    return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }
  async stopSession(reason: string): Promise<void> {
    const s = this.session;
    this.session = null;
    if (this.place.handle) {
      // R-BTN-72 (B-188): a stopped session is nothing a restart could reattach to.
      this.place = { ...this.place, handle: null };
      this.host.savePlace(this);
    }
    if (s) await this.executor.stop(s.handle, reason).catch((e) => this.o.log(`baton: the executor's stop failed (${msg(e)})`));
  }

  /** R-BTN-144 (B-170): one leg's class 7 masked stream sink — the leg's `run` call's stderr. The
   *  runner holds a literal's length back across writes, so a value split by a stream is still
   *  one literal, and the sink writes to the runner's log, which is what a leg log reads
   *  (R-BTN-128): the masked bytes are what leaves the runner. `release` is the call's end — the
   *  wrapper's outcome line rides the stream's last writes, so what it held goes first. */
  private legSink(secrets: readonly string[]): { onStderr: NonNullable<ExecOptions['onStderr']>; release: () => void } {
    const sink = createLegMasker(secrets);
    return {
      onStderr: (line, frame) => {
        const out = sink.push(line, frame);
        if (out !== '') this.o.log(out);
      },
      release: () => {
        const out = sink.flush();
        if (out !== '') this.o.log(out);
      },
    };
  }

  /** One wrapper call (R-BTN-133) through the executor's `exec`: `node <wrapper> <call> <script>`,
   *  its arguments on stdin's first line, its outcome on stdout's last. `sink` is the leg's
   *  running stream sink (R-BTN-144, B-170), which the leg's `run` passes and the runner releases
   *  at the call's end; every other call's stderr is the verbose drain, masked of classes 5 and
   *  6 and of the leg's class 7 set — those calls run in the leg's session, with the same
   *  environment its literals came from. */
  private wrapperCall(h: Handle, call: string, script: string, args: unknown[], timeout_s?: number, sink?: () => ReturnType<ClaimRun['legSink']>): Running {
    const leg = sink?.();
    // R-BTN-144 (S-BTN-119): the call's slot and its class 7 set are bound here, as the call
    // starts, not re-read as each line arrives: a set assigned or replaced while the
    // call streams (the slot's next leg) never masks this call's lines.
    const secrets = this.legSecrets;
    return this.executor.exec(h, ['node', LEG_PROCESS, call, script], {
      cwd: this.checkout, stdin: `${JSON.stringify(args)}\n`, ...(timeout_s ? { timeout_s } : {}),
      // R-BTN-144: what a leg's stderr carries leaves masked — class 5 and class 6 by the shared
      // pattern, the leg's own class 7 set with it while its run streams, and by the drain after.
      // B-108: a drained line is leg activity either way — the beat's liveness line counts it.
      onStderr: leg ? (l, frame) => { this.legLineAt = this.o.now(); leg.onStderr(l, frame); } : this.o.verbose ? (l: string) => { this.legLineAt = this.o.now(); this.o.log(maskLegOutput(`baton: ${call}: ${l}`, secrets)); } : undefined,
    });
  }

  /** The course a claim runs (B-103, §11's claim answer): the one its answer names — `course_id`, the ticket's
   *  course at the claim's snapshot — which one runner loads per claim, so a `create-spec` leg and
   *  the next claim's `create-pr` leg are consecutive legs of the same runner. A claim answered
   *  with no course (a pre-B-103 answer) falls back to the one course the runner declares, and is
   *  refused loudly with several rather than guessed: the snapshot's own several-course list is
   *  never a choice the runner may make (`courseOf`). */
  private claimCourse(claim: ClaimAnswer): string {
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
  private async verifyTicketVersion(claim: ClaimAnswer, scratch: string): Promise<{ why: string | null; read: { version: string; read_digest: string } | null; ticket?: unknown }> {
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
    const id = bareTicketId({ id: claim.ticket_id });
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
  private async verifyBySource(file: string, claim: ClaimAnswer, version: string, scratch: string): Promise<{ why: string | null; read: { version: string; read_digest: string } | null; ticket?: unknown }> {
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
      const id = bareTicketId({ id: claim.ticket_id });
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
  private async verifyControl(claim: ClaimAnswer): Promise<Record<string, string> | { error: string }> {
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
      this.o.log(`baton: the scope audit could not read the checkout's refs (${msg(e)}) — the audit is skipped for this leg`);
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
    if (parked.length > 16) this.o.log(`baton: ${ticket}'s ${leg} pushed outside its ticket's scope ${parked.length} times — the report carries the last 16 and the count of the other ${parked.length - 16} (B-134)`);
    this.o.log(`baton: ${ticket}'s ${leg} pushed outside its ticket's scope: ${outside.map((a) => `${a.target}${a.ref ? ` (${a.ref})` : ''}`).join(', ')} — reported with the leg's finish (B-134)`);
  }

  async runClaim(claim: ClaimAnswer, reattached?: Resume): Promise<ClaimOutcome> {
    const prepared = await this.prepareClaim(claim, reattached);
    if ('end_reason' in prepared) return prepared;
    try {
      return await this.legLoop(claim, prepared, reattached);
    } finally {
      await this.cleanupClaim(prepared);
    }
  }

  private async prepareClaim(claim: ClaimAnswer, reattached?: Resume): Promise<PreparedClaim | ClaimOutcome> {
    const claimId = claim.claim_id;
    const ticket = claim.ticket_id;
    let course: CourseLoad | null = null;
    let signedControl: Record<string, string> = {};
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
        this.o.log(`baton: ${signedControl.error}`);
        // Round 4: while the owner key register has moved since the record was computed (Baton
        // says so, comparing the record's keys with today's), a refusal is the record's age —
        // released as a stale board, unpenalised, until the next post re-computes it. Either
        // way nothing loads.
        if (claim.control?.register_moved === true) {
          this.o.log(`baton: the owner key register changed since the board post computed this record — released as a stale board until the next post (B-127)`);
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
        if (stays) this.o.log(`baton: the home stays at its own commit for ${ticket}, not the snapshot ${String(claim.snapshot_sha).slice(0, 10)}: ${stays}`);
        else this.host.homeAdvanced?.();
      }
    } catch (e) {
      this.o.log(`baton: the claim's course would not load (${msg(e)})`);
      return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
    }
    // R-BTN-72 (B-188): a claim beside others works in a clone of its own — its own git dir, put
    // at the snapshot — so concurrent legs never write one tree, and its audit reads its own refs.
    if (!reattached && this.checkout !== this.o.home) {
      try {
        await prepareClone(this.o.home, this.checkout, String(claim.snapshot_sha), typeof claim.default_branch === 'string' && claim.default_branch !== '' ? claim.default_branch : null);
      } catch (e) {
        this.o.log(`baton: ${ticket}'s checkout ${this.checkout} could not be prepared (${msg(e)})`);
        dropCourse(course.scratch);
        return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
      }
      if (this.o.verbose) this.o.log(`baton: ${ticket} works in its own clone ${this.checkout} (R-BTN-72)`);
    }
    const scratch = claimScratch();
    // B-183 (§4.5, R-BTN-5/R-BTN-34): re-verify the ticket by its version before any leg runs.
    // The claim names the ticket's `version` as the board holds it and how its source reads; the
    // source at the claim's snapshot (else the CLI's markdown default) is the reader. A ticket
    // that moved under the claim releases `stale-board`; one that did not runs. The two
    // file-less cases (check tickets, a `cancel` claim) carry no version and are re-verified
    // against Baton's record as before. B-190: a read that succeeded is the claim's recorded
    // read — its digest joins every run's inputs (R-BTN-84), reported on each advance.
    const versionCheck = reattached ? { why: null, read: null } as Awaited<ReturnType<ClaimRun['verifyTicketVersion']>> : await this.verifyTicketVersion(claim, course.scratch);
    if (versionCheck.why != null) {
      this.o.log(`baton: ${ticket}'s ticket moved under the claim — ${versionCheck.why}`);
      dropCourse(course.scratch);
      rmSync(scratch, { recursive: true, force: true });
      return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
    }
    // B-252 (R-BTN-74): a ticket with no `path` has no file in the checkout for the legs to read.
    // When the source's read handed its ticket back as text — the markdown a pathless source
    // returns, its frontmatter the markdown source's keys — that text is the legs' ticket file:
    // written once, mode 0600, into the claim's scratch (every leg session's path, removed at
    // the claim's end). A read-only leg also uses the verified text for tickets with a path;
    // ordinary legs with a path still see the checkout copy.
    let ticketFile: string | null = null;
    const resumedFile = (reattached?.ctx.ticket as { file?: unknown } | undefined)?.file;
    if (typeof resumedFile === 'string') ticketFile = resumedFile;
    else if (typeof versionCheck.ticket === 'string' && (!claim.path || [...course.graph.legs.values()].some((leg) => leg.readsOnly))) {
      ticketFile = join(scratch, 'ticket.md');
      writeFileSync(ticketFile, versionCheck.ticket, { mode: 0o600 });
    }
    this.inflight = { claimId, ticket, course, leg: null, legAt: this.o.now(), child: null, waiters: [] };
    // B-134: the claim answer's scope — the ticket's home and its `repos:` — against which each
    // leg's pushes are audited at its end. A claim whose answer carried none audits nothing (a
    // Baton before B-134) and opens no window.
    this.auditScope = Array.isArray(claim.scope) && claim.scope.every((s: unknown) => typeof s === 'string')
      ? claim.scope as string[] : null;
    this.auditWindow = this.auditScope == null ? null : this.readRefs();
    return { course, scratch, signedControl, ticketFile, read: versionCheck.read };
  }

  private async legLoop(claim: ClaimAnswer, prepared: PreparedClaim, reattached?: Resume): Promise<ClaimOutcome> {
    const claimId = claim.claim_id;
    const ticket = claim.ticket_id;
    const { course } = prepared;
    // §2e/R-BTN-63: the legs git evidences are every earlier attempt's, flattened; each leg this
    // claim finishes joins them (the advance trail), so a fallback run number counts them once.
    let gitPath = (claim.previous_attempts ?? []).flatMap((a: { legs?: { leg: string; reached: string | null }[] }) =>
      (a.legs ?? []).map((l) => ({ leg: l.leg, reached: l.reached ?? '' })));
    const handoffUrl = (claim.handoff_url ?? null) as string | null;
    const resume = (claim.previous_attempts?.[0]?.resume ?? null) as Record<string, any> | null;
    // R3-1236's course slot: the claim answer's advice, handed to the stub as `ctx.advice`.
    let advice = (claim.advice ?? null) as unknown;
    // The first leg is the claim response's queued leg (R-BTN-83); the first advance starts it.
    const legName = (reattached?.leg ?? claim.legs?.[0] ?? null) as string | null;
    let at = (reattached?.at ?? claim.station) as string;
    let nextLegs = claim.next ?? [];
    if (legName == null) return await this.finish(claimId, { end_reason: 'done', reached: at }, null);
    // B-106 (R-BTN-178): the claim's first leg may require a lock this runner can no longer
    // take — the server's declaration can be a beat behind the lock (the staleness loop's
    // grant-less break, a lost state file). The claim suspends at once, touching nothing: no
    // advance, no leg run, and the locks the claim would have used are released.
    if (!(await this.host.ensureLegLocks(this, legName, course))) {
      if (!reattached) return await this.finish(claimId, { end_reason: `suspended:${claim.station}`, reached: claim.station, next: legName }, null);
      this.o.log(`baton: ${ticket}'s reattached ${legName} runs on without its lock (R-BTN-178)`);
    }
    let runId: string | null = reattached?.runId ?? null;
    let run: number | null = null;
    let resolvedInputs: ResolvedInput[] = [];
    if (reattached) {
      this.legSeq = reattached.seq;
      const g = reattached.ctx.snapshot as { path?: { leg: string; reached: string }[]; next?: NextLegs } | undefined;
      if (Array.isArray(g?.path)) gitPath = g.path;
      if (Array.isArray(g?.next)) nextLegs = g.next;
    } else {
      const firstAnswer = await this.advance(claimId, { leg: legName, ...this.runInputsReport(prepared.read) }, at);
      if ('settle' in firstAnswer) return await this.finish(claimId, firstAnswer.settle, null);
      resolvedInputs = firstAnswer.inputs ?? [];
      at = firstAnswer.station ?? at;
      nextLegs = firstAnswer.next ?? nextLegs;
      advice = firstAnswer.advice ?? advice;
      // R-BTN-63 (B-185): the run's id, minted by Baton at the advance that started it.
      runId = typeof firstAnswer.run_id === 'string' ? firstAnswer.run_id : null;
      // B-335: and its number, from Baton's own count.
      run = typeof firstAnswer.run === 'number' ? firstAnswer.run : null;
      // §7.5 R-BTN-90 (B-234): the run's `claim_legs.seq`, likewise — the finishing
      // heartbeat's word when the script returns.
      this.legSeq = typeof firstAnswer.seq === 'number' ? firstAnswer.seq : null;
    }
    const state: LegProgress = {
      reach: claim.pointer_reach ?? NO_REACH, resolvedInputs,
      gitPath, handoffUrl, resume, advice, legName, at, nextLegs, run, runId, resuming: reattached,
      session: null, ranScript: null, ranCtx: null,
    };
    for (;;) {
      if (!state.resuming) {
        const stopped = await this.beforeLeg(claimId, course, state);
        if (stopped) return stopped;
      }
      const execution = await this.executeLeg(claim, prepared, state);
      const settled = await this.settleLeg(claimId, ticket, prepared, state, execution);
      if (settled) return settled;
    }
  }

  private async beforeLeg(claimId: number, course: CourseLoad, state: LegProgress): Promise<ClaimOutcome | null> {
    const { at, legName, nextLegs, ranScript, ranCtx, handoffUrl, runId } = state;
    if (this.claimLost()) return await this.finish(claimId, { end_reason: 'released:lease-lost', reached: at, next: legName }, null);
    // A drain (2026-10-24): the leg that ran is complete; the claim ends here with its
    // hand-off and the runner exits without claiming again — SIGTERM's graceful path.
    if (this.host.isDraining()) {
      return await this.finish(claimId, { end_reason: 'released:requested', reached: at, next: legName }, await this.callHandoff(ranScript, ranCtx ?? {}, undefined, runId ?? undefined) ?? handoffUrl);
    }
    // A signal that landed while no leg was running (a short wait, or the steps between
    // legs) ends the claim just the same — a release is never dropped (§6.13).
    const whileWaiting = this.abortSignal();
    if (whileWaiting) {
      const reason = whileWaiting.reason ?? `suspended:${at}`;
      return await this.finish(claimId, { end_reason: reason, reached: at, next: legName }, await this.callHandoff(ranScript, ranCtx ?? {}, undefined, runId ?? undefined) ?? handoffUrl);
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
        return await this.finish(claimId, { end_reason: reason, reached: at, next: legName }, await this.callHandoff(ranScript, ranCtx ?? {}, undefined, runId ?? undefined) ?? handoffUrl);
      }
      if (out === 'lost') {
        // The lease went while the wait held it: stop at once, no hand-off (R-BTN-24).
        return await this.finish(claimId, { end_reason: 'released:lease-lost', reached: at, next: legName }, null);
      }
      held = out === 'cleared' ? 'cleared' : 'suspend';
    }
    if (held === 'suspend') {
      // §6.13: the hand-off of the leg that ran comes before the suspension (R-BTN-44).
      const url = await this.callHandoff(ranScript, ranCtx ?? {}, undefined, runId ?? undefined) ?? handoffUrl;
      return await this.finish(claimId, { end_reason: `suspended:${at}`, reached: at, next: legName }, url);
    }
    if (this.closedDone) return await this.finish(claimId, { end_reason: 'done', reached: at }, handoffUrl);
    return null;
  }

  private async executeLeg(claim: ClaimAnswer, prepared: PreparedClaim, state: LegProgress): Promise<LegExecution> {
    const claimId = claim.claim_id;
    const ticket = claim.ticket_id;
    const { course, scratch, signedControl, ticketFile } = prepared;
    const { at, legName, nextLegs, gitPath, runId, handoffUrl, resume, advice, resuming } = state;
    // B-108: the leg's own start — its clock (the beat's liveness line) and a fresh drain.
    if (this.inflight) { this.inflight.leg = legName; this.inflight.legAt = this.o.now(); }
    this.legLineAt = null;
    // B-335 (R-BTN-63): Baton's number for the run; else git's runs, which already hold this
    // claim's finished legs — counted once (the claim's own legs were once added again, so a
    // claim's runs were numbered 1, 3, 5 and a stub's bound ran out at half its size).
    const run = resuming && typeof resuming.ctx.run === 'number' ? resuming.ctx.run : state.run ?? runNumber(course.graph, gitPath, legName, []);
    let inputs;
    try {
      inputs = resuming ? resuming.ctx.inputs : await readLegInputs(this.checkout, course, state.resolvedInputs, state.reach);
    } catch (e) {
      return { outcome: { kind: 'contract-input', detail: failureDetail(msg(e), this.legSecrets) }, pre: null, ctx: {}, script: null, run };
    }
    const ctx: Record<string, unknown> = resuming ? resuming.ctx : {
      inputs,
      ticket: { id: ticket, path: claim.path ?? null, home: this.o.repository, ...(typeof claim.version === 'string' && claim.version !== '' ? { version: claim.version } : {}), ...(ticketFile != null && (!claim.path || course.graph.legs.get(legName)?.readsOnly) ? { file: ticketFile } : {}) },
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
      checkout: this.checkout, session: state.session,
      state: this.o.stateFile, runner: this.state.get().runner_id,
    };
    // R-BTN-202 (B-248): the leg this ticket already ran under a local order while Baton was
    // unreachable — Baton offered that same leg from that same station, so its result is
    // reported (the gates below judge it as any other) instead of running it again. Any other
    // offer runs as offered: the offline result is not Baton's position, and what it left in
    // git stays there for the leg that runs now.
    const pre = this.preworked;
    this.preworked = null;
    const usePre = pre != null && !resuming && pre.leg === legName && pre.at === at;
    if (pre != null && !usePre) this.o.log(`baton: ${ticket}'s ${pre.leg} ran offline from ${pre.at} under ${pre.by}'s order, but Baton offers ${legName} at ${at} — the offline result is not reported, and ${legName} runs as offered (what the offline leg pushed stays in git) (R-BTN-202)`);
    if (usePre) {
      this.localOrder = { by: pre.by, ran_at: pre.ran_at };
      this.o.log(`baton: ${ticket}'s ${legName} ran offline at ${pre.ran_at} under ${pre.by}'s order — its result is reported now, gated as usual (R-BTN-202)`);
    }
    const outcome = usePre ? { kind: 'ok' as const, result: pre.result } : resuming ? await this.reattachedLeg(course, legName, resuming.handle) : await this.runLeg(course, legName, ctx, scratch);
    state.resuming = undefined;
    // R-BTN-72 (B-188): the run is over — nothing of it is left for a restart to reattach to.
    if (this.place.handle) {
      this.place = {};
      this.host.savePlace(this);
    }
    const script = course.scripts.get(legName) ?? null;
    if (outcome.kind !== 'lease-lost' && outcome.kind !== 'missing') {
      state.ranScript = script;
      state.ranCtx = ctx;
    }
    // §7.5 R-BTN-90 (B-234): finishing is not the end — the script's `run` returned (a
    // crash included), and the immediate `leg_finished` heartbeat goes out now, before the
    // validation, `close`, hand-off or advance that follows, each of which can cross the
    // deadline's instant. A lease lost or a missing script ran nothing to finish, and a leg
    // a delivered release already stopped never returned: its release stands (§7.5), and
    // the claim ends as the release says without a word from here.
    if ((outcome.kind === 'ok' || outcome.kind === 'crashed') && !this.abortSignal()) await this.reportLegFinished();
    return { outcome, pre: usePre ? pre : null, ctx, script, run };
  }

  private async settleLeg(claimId: number, ticket: string, prepared: PreparedClaim, state: LegProgress, execution: LegExecution): Promise<ClaimOutcome | null> {
    const { course } = prepared;
    const { at, legName } = state;
    const { outcome, pre, ctx, script } = execution;
    // B-134: the leg's end — its window's pushes are audited at the finish or the advance
    // below whatever the outcome was (a crashed or aborted leg can have pushed; a lost
    // lease still audits at its no-hand-off end; a `missing` leg never ran), and the read
    // happens AFTER the leg's close and hand-off have run — their pushes are the leg's
    // too, and reading before them left those outside every window.
    if (outcome.kind === 'lease-lost' || this.claimLost()) {
      // The group is dead; no close, no hand-off (R-BTN-24's resume record covers the leg).
      return await this.finish(claimId, { end_reason: 'released:lease-lost', reached: at, next: legName }, null);
    }
    if (outcome.kind === 'missing') {
      this.o.log(`baton: the snapshot has no legs/${legName}.mjs — a script bug the test kit owns (§2d)`);
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
      if (abort.signal === 'release' && abort.error == null && outcome.kind === 'ok') {
        const verdict = decide(outcome.result, course.graph, legName, at);
        if (!('bug' in verdict)) {
          try {
            await checkLegOutputs(this.checkout, course, legName, verdict.reached, (outcome.result as { outputs?: unknown }).outputs, state.reach, verdict.reached !== at || verdict.kind !== 'release');
            closed = await this.callClose(script, ctx, outcome.result);
          } catch { /* The delivered release stands, but invalid results do not close. */ }
        }
        if (closed != null && !('bug' in verdict)) {
          reached = verdict.reached;
          // A leg that finished queues a leg leaving where it rests — the script's own word
          // when it named one, nothing at an end station (R-BTN-83).
          next = verdict.kind === 'advance' ? verdict.leg : verdict.kind === 'done' ? null : verdict.next;
        }
      }
      const reason = abort.reason ?? `suspended:${at}`;
      // A released end points at no evidence (§6.5); the marker close wrote is in git.
      return await this.finish(claimId, { end_reason: reason, reached, ...(next != null ? { next } : {}), ...(abort.error ? { error: abort.error } : {}) }, await this.callHandoff(script, ctx));
    }
    if (outcome.kind === 'contract-input') {
      return await this.finish(claimId, { end_reason: 'released:cannot-finish:contract-input', reached: at, next: legName, ...(outcome.detail ? { detail: outcome.detail } : {}) }, null);
    }
    if (outcome.kind === 'crashed') {
      // R-BTN-144 (B-170): the leg's own error text leaves masked — a provider-auth message
      // is the one that quotes the key. It was masked at its source too; this is the log.
      this.o.log(`baton: ${ticket}'s ${legName} failed (${maskLegOutput(outcome.error, this.legSecrets)})`);
      // B-256: the end carries the failure's last line — an agent stub's, the agent's own last
      // output — masked the same way and bounded to §9.4's detail, so Baton's record of a leg
      // that exited 0 with nothing done says what the agent said, after the sandbox is gone.
      const detail = failureDetail(outcome.error, this.legSecrets);
      if (typeof outcome.errorType === 'string') {
        const answer = await this.onChannel({ op: 'raise', type: outcome.errorType, subject: 'The leg threw a LegError.' }, course, legName, ctx, detail ?? 'The leg failed.');
        if (!answer.ok) this.o.log(`baton: the typed error was refused (${maskLegOutput(answer.error, this.legSecrets)})`);
        const release = this.abortSignal();
        if (release) return await this.finish(claimId, { end_reason: release.reason ?? `suspended:${at}`, reached: at, next: legName, ...(release.error ? { error: release.error } : {}) }, await this.callHandoff(script, ctx));
      }
      return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: at, next: legName, error: { type: 'error.transient', message: detail ?? 'The leg failed.' }, ...(detail != null ? { detail } : {}) }, await this.callHandoff(script, ctx));
    }
    const result = outcome.result;
    state.session = typeof (result as { session?: unknown } | null)?.session === 'string'
      ? (result as { session: string }).session : state.session;
    const verdict = decide(result, course.graph, legName, at);
    if ('bug' in verdict) {
      this.o.log(`baton: ${ticket}'s ${legName} script bug: ${maskLegOutput(verdict.why, this.legSecrets)}`);
      return await this.finish(claimId, { end_reason: `suspended:${verdict.reached}`, reached: verdict.reached, next: verdict.next }, await this.callHandoff(script, ctx, verdict.why));
    }
    // R-BTN-83: `close` writes the closing marker from the validated result before anything
    // is reported; a suspension or release follows with `handoff`, so it can cite the position.
    try {
      await checkLegOutputs(this.checkout, course, legName, verdict.reached, (result as { outputs?: unknown }).outputs, state.reach, verdict.reached !== at || verdict.kind !== 'release');
    } catch (e) {
      const detail = failureDetail(msg(e), this.legSecrets);
      return await this.finish(claimId, { end_reason: 'released:cannot-finish:contract-output', reached: at, next: legName, ...(detail ? { detail } : {}) }, await this.callHandoff(script, ctx));
    }
    const closed = pre ? pre.closed : await this.callClose(script, ctx, result);
    if (closed === undefined) {
      return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: at, next: legName }, await this.callHandoff(script, ctx));
    }
    if (verdict.kind === 'done') {
      // A done end carries no hand-off (R-BTN-44 writes one for suspensions and releases);
      // the closing marker and the resume record are its record.
      const done = { end_reason: 'done', reached: verdict.reached, ...(verdict.detail ? { detail: verdict.detail } : {}), ...(verdict.outputs ? { outputs: verdict.outputs } : {}), ...(closed ? { ended_at_sha: closed } : {}) };
      return await this.finish(claimId, done, null, () => this.callHandoff(script, ctx));
    }
    if (verdict.kind === 'suspend' || verdict.kind === 'release') {
      const reason = verdict.kind === 'suspend' ? `suspended:${verdict.reached}` : `released:${verdict.reason}`;
      // §6.5: only a completed end points at its evidence — a released end carries none.
      return await this.finish(claimId, {
        end_reason: reason, reached: verdict.reached, next: verdict.next,
        ...(verdict.kind === 'suspend' && verdict.outputs ? { outputs: verdict.outputs } : {}),
        ...(verdict.kind === 'suspend' && verdict.detail ? { detail: verdict.detail } : {}),
        ...(verdict.kind === 'suspend' && closed ? { ended_at_sha: closed } : {}),
      }, await this.callHandoff(script, ctx));
    }
    return await this.advanceLeg(claimId, ticket, prepared, state, execution, verdict, result, closed);
  }

  private async advanceLeg(claimId: number, ticket: string, prepared: PreparedClaim, state: LegProgress, execution: LegExecution,
    verdict: Extract<ReturnType<typeof decide>, { kind: 'advance' }>, result: unknown, closed: string | null): Promise<ClaimOutcome | null> {
    const { course } = prepared;
    const { legName, handoffUrl } = state;
    const { ctx, script, run } = execution;
    // The go-on decision: the advance carries the result's bars on the edge (R-BTN-63) and
    // the evidence `close` wrote; it finishes this leg and starts the next. The finished leg
    // joins the evidenced path only now — the next leg's run number counts what ran. Its
    // scope audit (B-134) reports here, on the advance that finishes it — read after the
    // close, above, so the evidence push is in the window too.
    // B-106 (R-BTN-178): the lock of a leg the next one requires is taken before the advance
    // is sent; one this runner cannot take suspends the claim rather than sending it, the
    // finished leg's evidence already in git (R-BTN-121, R-BTN-71).
    // S-BTN-63 (B-30): distinguish a closed self-loop from abandoning the run at its start.
    const loopEnd = closed && verdict.reached === state.at ? { finished_self_loop: true, ended_at_sha: closed } : {};
    const locked = await this.host.ensureLegLocks(this, verdict.leg, course);
    if (this.claimLost()) return await this.finish(claimId, { end_reason: 'released:lease-lost', reached: state.at, next: legName }, null);
    if (!locked) {
      return await this.finish(claimId, { end_reason: `suspended:${verdict.reached}`, reached: verdict.reached, next: verdict.leg, ...(verdict.outputs ? { outputs: verdict.outputs } : {}), ...loopEnd, ...(closed ? { ended_at_sha: closed } : {}) }, await this.callHandoff(script, ctx) ?? handoffUrl);
    }
    this.auditLeg();
    // R-BTN-113 (B-4): the advance that finishes the leg carries its session link beside the
    // beats — the last word for the finished run, as the end's is for a claim's last one.
    const answer = await this.advance(claimId, { reached: verdict.reached, leg: verdict.leg, bars: verdict.bars, ...(verdict.outputs ? { outputs: verdict.outputs } : {}), ...(closed ? { evidence: closed } : {}), ...(this.legSessionUrl != null ? { session_url: this.legSessionUrl } : {}), ...(this.pendingScope ? { scope_exceeded: { actions: this.pendingScope, dropped: this.scopeOverflow } } : {}), ...this.runInputsReport(prepared.read) }, verdict.reached);
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
    this.o.log(`baton: ${ticket}'s ${legName} finished: reached ${verdict.reached}, next ${'settle' in answer ? 'the end' : verdict.leg} (run ${run} of ${course.graph.legs.get(legName)?.maxRuns ?? 1})${howEnded}`);
    if ('settle' in answer) {
      const end = answer.settle.end_reason === `suspended:${verdict.reached}` ? { ...answer.settle, ...loopEnd } : answer.settle;
      return await this.finish(claimId, end, await this.callHandoff(script, ctx) ?? handoffUrl);
    }
    state.gitPath = [...state.gitPath, { leg: legName, reached: verdict.reached }];
    state.at = answer.station ?? verdict.reached;
    state.nextLegs = answer.next ?? state.nextLegs;
    state.advice = answer.advice ?? state.advice;
    state.resolvedInputs = answer.inputs ?? [];
    state.runId = typeof answer.run_id === 'string' ? answer.run_id : null;
    // The previous run has ended in Baton, even if the next leg waits before executing.
    await this.stopSession('next-leg');
    state.run = typeof answer.run === 'number' ? answer.run : null;
    this.legSeq = typeof answer.seq === 'number' ? answer.seq : null;
    state.legName = verdict.leg;
    state.handoffUrl = null;
    state.resume = null;
    return null;
  }

  private async cleanupClaim(prepared: PreparedClaim): Promise<void> {
    for (const w of this.inflight?.waiters.splice(0) ?? []) w([]);
    await this.stopSession('claim-ended');
    this.legChannel?.close();
    this.legChannel = null;
    this.legSessionUrl = null;
    this.legSeq = null;
    this.legFinishedSeq = null;
    this.inflight = null;
    this.pendingAbort = null;
    dropCourse(prepared.course.scratch);
    rmSync(prepared.scratch, { recursive: true, force: true });
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
   * `entry` refusal (R-BTN-109) ends `released:cannot-finish:contract-output`; a delivered
   * deadline ends `released:leg-timeout` (R-BTN-90); other refusals suspend. */
  private async advance(claimId: number, body: { leg: string; reached?: string; bars?: string[]; evidence?: string; outputs?: unknown[]; run_inputs?: { ticket?: { version: string; read_digest: string }; inputs: unknown[] }; head_sha?: string | null; session_url?: string; local_order?: { by: string; ran_at: string } }, fallbackStation: string): Promise<AdvanceAnswer | { settle: Record<string, unknown> }> {
    // R-BTN-202 (B-248): the advance that finishes a leg run under a local order says who gave
    // it — once; a refused advance's settling end carries it instead (`finish`).
    if (this.localOrder && body.reached) {
      body = { ...body, local_order: this.localOrder };
    }
    try {
      const answer = await this.o.api.advance(claimId, body);
      if (body.local_order) this.localOrder = null;
      return answer;
    } catch (e) {
      if (!(e instanceof BatonRefusal)) throw e;
      if (e.ruleCode === 'leg-timeout') return { settle: { end_reason: 'released:leg-timeout' } };
      const kind = refusalKind(e.ruleCode);
      if (kind === 'course-changed') {
        return { settle: { end_reason: 'released:course-changed', reached: body.reached ?? fallbackStation, ...(body.leg ? { next: body.leg } : {}) } };
      }
      // The leg's outputs did not meet its arrival: the leg is given up where the claim rests.
      if (kind === 'contract-output') return { settle: { end_reason: 'released:cannot-finish:contract-output' } };
      // The suspension arrives where the advance would have (R-BTN-109): its outputs go with it,
      // so a refusal for any other reason still suspends rather than failing the entry (3-r3-2).
      return { settle: { end_reason: `suspended:${body.reached ?? fallbackStation}`, reached: body.reached ?? fallbackStation, next: body.leg, ...(body.outputs ? { outputs: body.outputs } : {}), ...(body.evidence ? { ended_at_sha: body.evidence } : {}) } };
    }
  }

  /** Hold a short wait (R-BTN-40): each beat re-reads the snapshot's legs; 30 minutes spends it.
   * A beat that brought no reading (the fallback timeout) settles nothing — only the clock — and
   * a signal that landed while no leg ran aborts the wait, honoured by the caller. */
  private async waitOut(leg: string, course: CourseLoad): Promise<'cleared' | 'spent' | 'abort' | 'lost'> {
    const waitedSince = this.o.now();
    for (;;) {
      if (this.claimLost() || leaseLostFrom(this.state.get(), this.o.now())) return 'lost';
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
        if (shortWaitSpent(waitedSince, this.o.now())) return 'spent';
        continue;
      }
      const state = waitState(shown, leg, course.graph.shortWaits);
      if (state === 'run') return 'cleared';
      if (state === 'suspend' || shortWaitSpent(waitedSince, this.o.now())) return 'spent';
    }
  }

  private async runLeg(course: CourseLoad, leg: string, ctx: Record<string, unknown>, scratch: string): Promise<LegOutcome> {
    const script = course.scripts.get(leg);
    if (script == null) return { kind: 'missing' };
    if (course.graph?.legs.get(leg)?.readsOnly) {
      ctx.reads_only = true;
      ctx.review_store = this.o.home;
    }
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
      this.o.log(`baton: the leg's channel could not serve (${msg(e)}) — the leg runs with no way to raise (R-BTN-106)`);
    }
    if (channel) {
      this.legChannel = channel;
      // B-188: the channel's requests are this claim's, whatever context the socket calls from.
      channel.listen((req) => this.onChannel(req, course, leg, ctx));
    }
    // Detached: its own process group, so a lost lease kills the leg and everything it started
    // (§6.13) without touching the runner. The env names the parent every leg session checks
    // (BATON_PARENT — such a session never claims; BATON_STATE — the fence and the spool). B-97
    // dropped the transition's IR_BATON_* spellings: these two names are the only ones set.
    const parent = String(this.state.get().runner_id ?? '');
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
      ...(this.o.verbose ? { BATON_VERBOSE: '1' } : {}),
      // The claim's own `default_branch` (B-96): the environment form, for a stub whose close
      // runs in the leg child. The close the RUNNER calls gets the same value through `ctx`
      // (`runLeg`'s context), which is the primary path (round 4).
      ...(typeof ctx.default_branch === 'string' && ctx.default_branch !== '' ? { BATON_DEFAULT_BRANCH: ctx.default_branch } : {}),
      // B-234 (R-BTN-106): the leg's channel, its address as the session's CLI reads it.
      BATON_SOCKET: channel?.path,
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
    if (this.o.verbose) {
      const short = Object.keys(env).filter((n) => (maskEnv.includes(n) || namesASecret(n)) && Buffer.byteLength(env[n], 'utf8') < MIN_SECRET_BYTES);
      if (short.length) this.o.log(`baton: ${leg}'s ${short.join(', ')} ${short.length === 1 ? 'is' : 'are'} under ${MIN_SECRET_BYTES} bytes, so not masked (R-BTN-144)`);
    }
    const sink = this.legSink(legSecrets);
    if (this.claimLost()) return { kind: 'lease-lost' };
    let handle: Handle;
    try {
      handle = await this.startSession('leg', {
        session_id: sessionId, ...(typeof ctx.run_id === 'string' ? { run_id: ctx.run_id } : {}), ticket: String((ctx.ticket as { id?: string })?.id ?? ''), leg,
        snapshot_sha: String((ctx.snapshot as { sha?: string })?.sha ?? ''), paths: [scratch, course.scratch, ...(ctx.reads_only === true && this.o.home !== this.checkout ? [this.o.home] : [])], env,
        channel: channel ? channel.path : null,
        // R-BTN-107: the brief carries the leg's autonomy as a hint — the raise check below is
        // what enforces it, whatever the executor does with the hint.
        autonomous: course.graph?.legs.get(leg)?.autonomous === true,
        ...(ctx.reads_only === true ? { reads_only: true } : {}),
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
    if (!this.claimLost() && this.legSessionUrl != null) await this.landSessionLink();
    if (this.claimLost()) {
      await this.stopSession('lease-lost');
      return { kind: 'lease-lost' };
    }
    if (this.o.verbose) this.o.log(`baton: ${leg} runs: node ${basename(LEG_PROCESS)} run ${basename(script)} (session ${sessionId}, executor ${this.executor.source})`);
    // The stub cannot observe a pending harness question or its answer (R-BTN-195).
    // Give it potential eligibility: a cadence beat can still land the link if startup failed.
    // The actual raise is checked separately against the link Baton already holds.
    const canInteract = channel != null && checkRaise('interact', course.graph?.conditionTypes ?? new Map(), this.raisePolicy(course, leg, this.legSessionUrl)).ok;
    const running = this.wrapperCall(handle, 'run', script, [{ ...ctx, can_interact: canInteract }], undefined, () => sink);
    return await this.awaitLeg(leg, handle, channel, running, sink);
  }

  private async awaitLeg(leg: string, handle: Handle, channel: LegChannel | null, running: Running, sink: ReturnType<ClaimRun['legSink']>): Promise<LegOutcome> {
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
        if ((!this.offline && leaseLostFrom(this.state.get(), this.o.now())) || this.claimLost() || this.host.isStopping()) {
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
      await this.executor.end(handle).catch((e) => this.o.log(`baton: the executor's end failed (${msg(e)})`));
      await this.stopSession('leg-result');
      inflight.child = null;
      release();
      this.o.log(`baton: ${inflight.ticket}'s ${leg} ended at the result posted on its channel — the session is stopped (R-BTN-195)`);
      return { kind: 'ok', result: postedBox.ending.result };
    }
    if (!done && this.abortSignal() != null && !this.claimLost()) {
      // A release (the claim's deadline among its reasons, R-BTN-90) reached a session that
      // neither exited nor posted: kill it, stop its session, and let the loop's abort branch
      // end the claim with the signal's reason — the unjoined ask's own end (R-BTN-195).
      const signal = this.abortSignal()!;
      this.killLeg();
      await this.stopSession(`signal:${signal.signal}`);
      inflight.child = null;
      release();
      return { kind: 'crashed', error: `the leg's session was asked to stop (${signal.reason ?? signal.signal}) and neither exited nor posted its result` };
    }
    if (!done || this.claimLost()) {
      // The lease went (or the runner stops): kill the leg at once, no hand-off — the resume
      // record covers it (R-BTN-24) — and stop its session.
      this.killLeg();
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
    return out.ok ? { kind: 'ok', result: out.result } : { kind: 'crashed', error: maskLegOutput(out.error ?? 'the leg script failed', this.legSecrets), errorType: out.errorType };
  }

  /** R-BTN-72 (B-188): the running leg's place in the state file, for a reattach. */
  private persistPlace(handle: Handle, leg: string, ctx: Record<string, unknown>): void {
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(JSON.stringify({ ...handle, posted: undefined })) as Record<string, unknown>;
    } catch {
      data = null; // a handle that is not data: nothing a restart could reattach with
    }
    this.place = {
      run_id: typeof ctx.run_id === 'string' ? ctx.run_id : null, seq: this.legSeq, leg,
      at: String((ctx.claim as { station?: unknown } | undefined)?.station ?? ''), handle: data, ctx,
    };
    this.host.savePlace(this);
  }

  /** R-BTN-72 (B-188): a leg reattached after a restart — its session found again by the
   *  executor, its channel served again at the same address, and its end awaited as any run's:
   *  the session's posted or final result is the leg's, checked as any result is. A lost lease
   *  or claim stops it, no hand-off; a release stops it after the grace, as a leg that will not
   *  take its release is stopped. */
  private async reattachedLeg(course: CourseLoad, leg: string, handle: Handle): Promise<{ kind: 'ok'; result: unknown } | { kind: 'crashed'; error: string; errorType?: unknown } | { kind: 'lease-lost' }> {
    let channel: LegChannel | null = null;
    try {
      channel = await LegChannel.serve(channelPath(this.o.stateFile, handle.session_id));
      channel.listen((req) => this.onChannel(req, course, leg, this.place.ctx ?? {}));
      this.legChannel = channel;
    } catch (e) {
      this.o.log(`baton: the reattached leg's channel could not serve (${msg(e)}) — the leg runs on with no way to raise (R-BTN-106)`);
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
        if (leaseLostFrom(this.state.get(), this.o.now()) || this.claimLost() || this.host.isStopping()) resolve('lost');
        else if (this.pendingAbort != null) {
          signalledAt ??= this.o.now();
          if (this.o.now() - signalledAt >= (this.o.signalGraceMs ?? SIGNAL_GRACE_MS)) resolve('signal');
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
    const out = typeof result === 'object' && typeof (result as { ok?: unknown }).ok === 'boolean' ? result as WrapperOutcome : null;
    if (out) return out.ok ? { kind: 'ok', result: out.result } : { kind: 'crashed', error: maskLegOutput(out.error ?? 'the leg script failed', this.legSecrets), errorType: out.errorType };
    return { kind: 'ok', result };
  }

  // By default, check what Baton holds, not just what the executor's handle names.
  private raisePolicy(course: CourseLoad, leg: string, sessionUrl = this.sessionLinkLanded ? this.legSessionUrl : null) {
    const def = course.graph?.legs.get(leg);
    return {
      conditions: def?.conditionTypes ?? null,
      autonomous: def?.autonomous === true,
      deadlineS: def?.maxDuration ?? null,
      sessionUrl,
    };
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
  private async onChannel(req: ChannelRequest, course: CourseLoad, leg: string, ctx: Record<string, unknown>, typedMessage?: string): Promise<ChannelAnswer> {
    if (req.op !== 'raise') return { ok: false, error: `the channel carries raise and done, nothing else (R-BTN-106)` };
    const ticket = String((ctx.ticket as { id?: string })?.id ?? '');
    const claimId = Number((ctx.claim as { id?: number } | undefined)?.id ?? 0);
    const subject = typeof req.subject === 'string' ? req.subject : '';
    if (subject.trim() === '') return { ok: false, error: 'a raise carries a subject (--subject, R-BTN-160)' };
    const type = typeof req.type === 'string' ? req.type : '';
    const declared: Map<string, ConditionDeclaration> = course.graph?.conditionTypes ?? new Map();
    const verdict = checkRaise(type, declared, this.raisePolicy(course, leg));
    if (!verdict.ok) {
      this.o.log(`baton: ${ticket}'s ${leg} raise of ${type || '(none)'} was refused on the channel: ${verdict.reason}`);
      return { ok: false, error: verdict.reason };
    }
    // The report's fields — the runner's resolution of what the course file declares, the
    // severity checked here (R-BTN-125) and the restarts as given; `url` is never the leg's to
    // choose: an `interact`'s is Baton's own and a `suspend`'s points into git (R-BTN-92).
    const severity = req.severity === undefined || req.severity === null ? 'normal'
      : SEVERITIES.includes(req.severity as never) ? req.severity : null;
    if (severity == null) return { ok: false, error: `severity must be one of ${SEVERITIES.join(', ')} (R-BTN-125)` };
    const options = raiseRestarts(type, declared, req.restarts, req.default);
    if (!options.ok) return { ok: false, error: options.reason };
    const disposition = dispositionOf(type, declared) ?? 'notify';
    if (typedMessage != null && disposition !== 'interrupt') return { ok: false, error: 'LegError must name an interrupt condition (R-BTN-160)' };
    const body = typeof req.body === 'string' ? req.body : null;
    // R-BTN-33: the subject and body stay here — the runner's log, masked of the leg's own
    // secrets — and nothing of them is reported. The raise's line is what an operator reads.
    this.o.log(maskLegOutput(`baton: ${ticket}'s ${leg} raised ${type} — ${subject.slice(0, 200)}${body != null ? ` (body ${Buffer.byteLength(body, 'utf8')} bytes, kept in this log only)` : ''}`, this.legSecrets));
    let answer: Record<string, any>;
    try {
      answer = await this.o.api.conditions(claimId, {
        type,
        disposition,
        // Older servers accept omission, but reject an explicitly empty map.
        ...(Object.keys(options.restarts).length ? { restarts: options.restarts } : {}),
        ...(options.defaultRestart != null ? { default: options.defaultRestart } : {}),
        ...(severity !== 'normal' ? { severity } : {}),
      });
    } catch (e) {
      const why = e instanceof BatonRefusal ? `${e.code}: ${e.message}` : msg(e);
      this.o.log(`baton: ${ticket}'s ${leg} raise of ${type} was refused by Baton (${maskLegOutput(why, this.legSecrets)})`);
      return { ok: false, error: `Baton refused the raise: ${why}` };
    }
    // R-BTN-160's dispositions, the runner's own two: an `interrupt` ends the leg
    // `released:cannot-finish:<class>` (the class the type names, R-BTN-122), signalled here so
    // the loop ends the claim at its next safe point with its hand-off written — the retry
    // policy routes what follows. A `notify` — `interact` among them — returns at once and the
    // leg goes on (R-BTN-116: nothing waits on it). A `suspend` records and returns too: its
    // wait (R-BTN-162) is not built.
    const end = disposition === 'interrupt' ? `released:cannot-finish:${errorClassOf(type, declared)}` : null;
    if (end != null) this.signalLeg('release', end, { type, message: typedMessage ?? `The leg raised ${type}.` });
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
        const handle = await this.legSession(ctx);
        if (!handle || this.claimLost()) return undefined;
        const out = wrapperOutcome((await this.wrapperCall(handle, 'close', script, [ctx, result], 120).result).stdout);
        if (out == null) throw new Error('the close wrote no outcome');
        if (!out.ok) throw new Error(out.error ?? 'the close failed');
        return typeof out.result === 'string' ? out.result : null;
      } catch (e) {
        this.o.log(`baton: the leg's close failed (${maskLegOutput(msg(e), this.legSecrets)}), attempt ${attempt + 1} of 3`);
      }
    }
    return undefined;
  }

  /** `handoff(ctx)` (R-BTN-44): before any suspension or release; its failure is logged and the
   * resume record covers the rest. */
  private async callHandoff(script: string | null, ctx: Record<string, unknown>, why?: string, liveRun?: string): Promise<string | null> {
    if (script == null) return null;
    try {
      // R-BTN-107/R-BTN-133 (B-184): through the executor, in the leg's session, bounded at 2 minutes.
      const handle = await this.legSession(ctx, liveRun);
      if (!handle || this.claimLost()) return null;
      const out = wrapperOutcome((await this.wrapperCall(handle, 'handoff', script, [why != null ? { ...ctx, bug: why } : ctx], 120).result).stdout);
      if (out == null) throw new Error('the hand-off wrote no outcome');
      if (!out.ok) throw new Error(out.error ?? 'the hand-off failed');
      return typeof out.result === 'string' ? out.result : null;
    } catch (e) {
      this.o.log(`baton: the leg's handoff failed (${maskLegOutput(msg(e), this.legSecrets)}) — the resume record covers it (R-BTN-24)`);
      return null;
    }
  }

  /** End the claim, clear the local claim state, and ack what the sidecar delivered. The local
   * flags clear whatever the wire said — a lost lease belongs to the claim that lost it — and an
   * end the network ate is parked and retried on every beat until Baton answers. */
  private async finish(claimId: number, body: Record<string, unknown>, handoff: string | null,
    timeoutHandoff?: () => Promise<string | null>): Promise<ClaimOutcome> {
    // A fence may land while a hook is already in flight. Do not report its result.
    if (this.claimLost() && body.end_reason !== 'released:lease-lost') {
      body = { end_reason: 'released:lease-lost', ...(this.inflight?.leg ? { next: this.inflight.leg } : {}) };
      handoff = null;
    }
    // B-134: the end is the audit's last read — after the caller's close and hand-off have run
    // (both always precede this call), so a push either of them made is the leg's, inside the
    // window, not after it.
    this.auditLeg();
    const ticket = this.ticket || (this.inflight?.ticket ?? this.state.get().claim?.ticket_id ?? '');
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
    // R-BTN-202 (B-248): an end that finishes a leg run under a local order says who gave it.
    if (this.localOrder && body.local_order === undefined) body = { ...body, local_order: this.localOrder };
    this.localOrder = null;
    try {
      await this.o.api.end(claimId, body);
    } catch (e) {
      if (e instanceof BatonRefusal && e.code === 'claim-ended') {
        // Baton already ended it (a stale-board release under a sync, §6.5) — its end stands.
        this.o.log(`baton: ${ticket} was already ended (${e.message})`);
      } else if (e instanceof BatonRefusal && (e.code === 'unavailable' || e.status >= 500)) {
        // A 5xx is a Baton that could not answer, not one that refused: park it like a
        // transport failure, or the orphan path would re-end the claim with another reason.
        this.o.log(`baton: the end of ${ticket} did not reach Baton (${e.message}) — retried on every beat`);
        this.sidecar.parkEnd(claimId, body);
      } else if (e instanceof BatonRefusal && e.ruleCode === 'leg-timeout' && body.end_reason !== 'released:leg-timeout') {
        // Delivery may win even after close, without the heartbeat reply reaching us yet.
        // Keep the audit and provenance, but do not report the refused leg outcome.
        const { scope_exceeded, local_order } = body;
        return await this.finish(claimId, { end_reason: 'released:leg-timeout', scope_exceeded, local_order },
          timeoutHandoff ? await timeoutHandoff() : handoff);
      } else if (e instanceof BatonRefusal && refusalKind(e.ruleCode) === 'contract-output' && !String(body.end_reason).startsWith('released:')) {
        // R-BTN-109: a completed end whose outputs fail its station's entry gives the leg up, as
        // a refused advance does — an output contract failure (R-BTN-82).
        this.o.log(`baton: ${ticket}'s outputs do not meet its arrival (${e.message}) — the leg is given up`);
        return await this.finish(claimId, { end_reason: 'released:cannot-finish:contract-output' }, handoff, timeoutHandoff);
      } else if (e instanceof BatonRefusal) {
        throw e;
      } else {
        this.o.log(`baton: the end of ${ticket} did not reach Baton (${msg(e)}) — retried on every beat`);
        this.sidecar.parkEnd(claimId, body);
      }
    }
    this.ended = true;
    await this.sidecar.ackEnd(this.toAck.splice(0));
    this.legSessionUrl = null;
    this.sessionLinkLanded = false;
    this.host.retire(this);
    this.closedDone = false;
    this.o.log(`baton: ${ticket} ${body.end_reason} at ${body.reached ?? '?'}`);
    return { ticket, end_reason: body.end_reason as string, reached: (body.reached as string) ?? null, handoff };
  }

  /** R-BTN-202: one order's leg, run offline in the home checkout — see `runOffline`. */
  async runOfflineLeg(q: LocalQueue, order: LocalOrder, leg: string, at: string, sha: string, course: CourseLoad, why: string): Promise<void> {
    const ticket = order.ticket_id;
    const ranAt = new Date(this.o.now()).toISOString();
    this.o.log(`baton: Baton is unreachable (${why}) — running ${ticket}'s ${leg} from ${at} WITHOUT A CLAIM, under ${order.by}'s local order, at the home's ${sha.slice(0, 10)} (R-BTN-202)`);
    this.o.log(`baton: WARNING: nothing guarantees that another runner is not executing ${ticket}'s ${leg} at this moment — with Baton down, no one holds the ticket's lease. The result is reported to Baton through an ordinary claim when it answers again, and its gates decide it then`);
    const scratch = claimScratch();
    try {
      if (!(await this.host.ensureLegLocks(this, leg, course))) {
        this.o.log(`baton: ${ticket}'s ${leg} needs a machine lock another process holds — the order waits (R-BTN-178)`);
        return;
      }
      this.inflight = { claimId: 0, ticket, course, leg, legAt: this.o.now(), child: null, waiters: [] };
      const bare = bareTicketId({ id: ticket, home: this.o.repository });
      let path: string | null = null;
      try {
        path = git(this.o.home, ['ls-files', '--', `*/${bare}.md`, `*/${bare}.mdx`]).split('\n').find((l) => l.trim() !== '') ?? null;
      } catch { path = null; }
      const ctx: Record<string, unknown> = {
        ticket: { id: ticket, path, home: this.o.repository },
        // No claim: the leg runs under a local order (R-BTN-202) — no id, no nonce, only the
        // station it leaves, which leg scripts read (`ctx.claim?.station`).
        claim: { id: null, nonce: null, station: at },
        local_order: { by: order.by, ran_at: ranAt },
        leg, run: runNumber(course.graph, [], leg, []),
        snapshot: { sha, path: [], next: [] },
        handoff: null, resume: null, advice: null,
        checkout: this.o.home, session: null,
        state: this.o.stateFile, runner: this.state.get().runner_id,
      };
      const outcome = await this.runLeg(course, leg, ctx, scratch);
      if (outcome.kind !== 'ok') {
        const what = outcome.kind === 'crashed' ? `failed (${maskLegOutput(outcome.error, this.legSecrets)})` : outcome.kind === 'missing' ? `has no legs/${leg}.mjs at ${sha.slice(0, 10)}` : 'was stopped';
        q.dropOrder(ticket);
        this.o.log(`baton: ${ticket}'s offline ${leg} ${what} — the order is dropped, nothing is reported, and Baton offers the ticket as it stands (R-BTN-202)`);
        return;
      }
      const verdict = decide(outcome.result, course.graph, leg, at);
      if ('bug' in verdict) {
        q.dropOrder(ticket);
        this.o.log(`baton: ${ticket}'s offline ${leg} script bug: ${maskLegOutput(verdict.why, this.legSecrets)} — the order is dropped (R-BTN-202)`);
        return;
      }
      const outputs = (outcome.result as { outputs?: unknown }).outputs;
      if (outputs != null && (!Array.isArray(outputs) || outputs.length !== 0)) {
        q.dropOrder(ticket);
        this.o.log(`baton: ${ticket}'s offline ${leg} returned outputs; no closing evidence was written (R-BTN-82)`);
        return;
      }
      const closed = await this.callClose(course.scripts.get(leg) ?? null, ctx, outcome.result);
      if (closed === undefined) {
        q.dropOrder(ticket);
        this.o.log(`baton: ${ticket}'s offline ${leg} would not close — the order is dropped (R-BTN-202)`);
        return;
      }
      q.recordWorked({ ticket_id: ticket, leg, at, result: outcome.result, closed: closed ?? null, by: order.by, ran_at: ranAt });
      this.o.log(`baton: ${ticket}'s offline ${leg} finished: reached ${verdict.reached} — kept for Baton, and reported through a claim when it answers (R-BTN-202)`);
    } finally {
      await this.stopSession('offline-ended');
      this.legChannel?.close();
      this.legChannel = null;
      this.legSessionUrl = null;
      this.inflight = null;
      this.pendingAbort = null;
      dropCourse(course.scratch);
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
