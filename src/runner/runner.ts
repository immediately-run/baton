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
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { batonNow } from '../shared/baton.mjs';
import { capabilitiesOf } from '../shared/vocabulary.mjs';
import { BatonApi, BatonRefusal } from './api';
import { claimScratch, courseOf, dropCourse, ensureSha, freshSecret, loadCourse, type CourseLoad } from './home';
import { decide, refusalKind, runNumber, shortWaitSpent, waitState } from './protocol';
import { StateFile, leaseLostFrom } from './state';

const LEG_PROCESS = fileURLToPath(new URL('./legProcess.mjs', import.meta.url));
/** §6.3: the sidecar's cadence — every beat 2 minutes. */
export const BEAT_MS = 2 * 60_000;
/** B-86: how many beats one claim attempt spends making the server's record of the declaration
 *  match the list the claim will carry — one for a fresh or legacy runner, one for the change it
 *  settles (review round 4, finding 4). */
const MAX_STALE_BEATS = 2;
/** What one leg's snapshot shows of the legs leaving the claim's station (R-BTN-70). */
type NextLegs = { leg: string; state: string; waiting_on?: string }[];

export interface RunnerOptions {
  api: BatonApi;
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
  /** Verbose (the owner, 2026-10-23): timestamp every line, name the claim's id and nonce,
   * log the leg's local command, and drain the leg child's stderr into the log — where the
   * stub reports the agent_command it resolved. A slice of B-23's leg observability. */
  verbose?: boolean;
  /** B-83: a test harness — declared on the heartbeat (R-BTN-32; Baton refuses it from any
   * credential but the test one). */
  testHarness?: boolean;
}

interface LegChild {
  process: ReturnType<typeof spawn>;
  resultPath: string;
  ctxPath: string;
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

export class Runner {
  private readonly o: RunnerOptions & { beatEvery: number };
  private readonly state: StateFile;
  private readonly log: (line: string) => void;
  private readonly verbose: boolean;
  private readonly now: () => number;
  private beat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** 2026-10-24: draining — SIGTERM's path (complete the current leg, then stop). Set once;
   * the claim loop ends the claim at the next leg boundary with its hand-off, the idle wait
   * returns, and work() ends without claiming again. */
  private draining = false;
  private inflight: {
    claimId: number;
    ticket: string;
    course: CourseLoad;
    /** B-94: the leg this claim is running, so a death leaves a line naming it. */
    leg: string | null;
    child: LegChild | null;
    /** Resolved by the next tick's view of the snapshot's next legs (the short-wait re-read). */
    waiters: ((next: NextLegs) => void)[];
  } | null = null;
  private pendingAbort: PendingAbort | null = null;
  private lostLease = false;
  private closedDone = false;
  private toAck: number[] = [];
  /** R-BTN-19: a claim the runner knows it lost, whose fence the next heartbeat clears. */
  private fenceToReport: number | null = null;
  /** R-BTN-77: set when a heartbeat carried an `unblocked` message, so the idle wait ends early. */
  private unblocked = false;
  /** Bumps with every claim: an answer a beat started before the claim cannot fence it. */
  private epoch = 0;
  /** One beat at a time — the sidecar's answers stay ordered against the loop. The in-flight
   *  beat's promise while one is out, so a caller that needs a beat waits for it (`tick`). */
  private ticking: Promise<void> | null = null;
  /** R-BTN-14: a reaped worker re-keys on its next beat; the fresh secret until it lands. */
  private rekeySecret: string | null = null;
  /** An end Baton never answered (the network went with the lease): retried on every beat. */
  private pendingEnd: { claimId: number; body: Record<string, unknown> } | null = null;
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

  constructor(options: RunnerOptions) {
    this.o = { beatEvery: BEAT_MS, ...options };
    this.verbose = options.verbose ?? false;
    this.log = this.verbose ? withTimestamps(options.log ?? (() => {})) : (options.log ?? (() => {}));
    this.now = options.now ?? batonNow;
    this.state = new StateFile(options.stateFile);
    if (!this.state.get().secret) this.state.set({ secret: freshSecret() });
    this.o.api.setSecret(this.state.get().secret);
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
  }

  /** B-94: what a runner says about itself when it leaves — its claim, the leg in flight and the
   * last beat Baton answered, in one line. `why` names the exit; the leg is `none` between
   * claims. Cheap and synchronous by design: it runs on a signal or an `exit` hook. */
  lastLine(why: string): string {
    const s = this.state.get();
    const claim = s.claim ? `claim ${s.claim.id} on ${s.claim.ticket_id}` : 'no claim';
    const leg = this.inflight ? `leg ${this.inflight.leg ?? '?'}` : 'no leg in flight';
    const beat = s.last_ok == null ? 'never' : new Date(s.last_ok).toISOString();
    return `${why}: ${claim}, ${leg}, last beat ${beat}`;
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
    this.ticking = this.beatOnce().finally(() => { this.ticking = null; });
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

  private async beatOnce(): Promise<void> {
    const epoch = this.epoch;
    const s = this.state.get();
    const spool = this.takeSpool();
    // B-86: `--capabilities` narrows; without it the declaration is the grant's, which the first
    // answer carries (`grant.capabilities`), so the first beat asks and declares nothing — the
    // registration has no declaration to widen, and the beat after it serves the grant.
    const declaring = this.declared ?? this.o.capabilities ?? [];
    const body: Record<string, unknown> = {
      hostname: this.o.hostname, session_name: this.o.session, harness: this.o.harness, kind: 'vm',
      billing: {}, capabilities: declaring, tier_ceiling: this.o.tierCeiling ?? 'critical',
      ...(this.o.testHarness ? { test_harness: true } : {}),
      lease_timeout_s: s.lease_timeout_s ?? 900,
      courses: this.o.courses.map((c) => ({ repository: this.o.repository, course: c.course, version: c.version })),
      ...((s.worker_id == null || this.rekeySecret) ? { secret_hash: await sha256Hex(this.rekeySecret ?? s.secret), ...(this.rekeySecret ? { rekey: true } : {}) } : {}),
      ...(this.fenceToReport != null ? { fenced: { claim_id: this.fenceToReport, terminated: true } } : {}),
      transcripts: spool.transcripts,
    };
    // §6.9: the spool's activity rows go up as their own call, before the beat; anything the
    // calls do not land comes back to the spool, so a leg session's record is never lost.
    const carry = [...spool.overflowTranscripts, ...spool.overflowActivities];
    if (carry.length) appendFileSync(this.state.spool, `${carry.map((t) => JSON.stringify(t)).join('\n')}\n`);
    let leftover: unknown[] = [...spool.overflowActivities];
    try {
      if (spool.activities.length) leftover = [...leftover, ...await this.postActivities(spool.activities)];
      if (this.pendingEnd) await this.retryEnd();
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
    if (epoch === this.epoch) {
      this.state.set({
        worker_id: answer.worker_id, incarnation: answer.incarnation, last_ok: this.now(),
        lease_timeout_s: answer.lease_timeout_s ?? s.lease_timeout_s,
        claim: answer.claim ? { id: answer.claim.id, ticket_id: answer.claim.ticket_id, nonce: answer.claim.nonce } : null,
      });
    } else {
      // A claim began while this beat was out: its claim view is stale — only the lease facts.
      this.state.set({
        worker_id: answer.worker_id, incarnation: answer.incarnation, last_ok: this.now(),
        lease_timeout_s: answer.lease_timeout_s ?? s.lease_timeout_s,
      });
    }
    // R-BTN-19: the fence of a claim this runner lost cleared with this beat.
    this.fenceToReport = null;
    const view = answer.claim && typeof answer.claim === 'object' ? answer.claim.git : null;
    // R-BTN-6 and §6.13: the wall clock's own verdict, or an answer that no longer lists the
    // claim, fence the runner at once — stop the leg, no hand-off.
    if (epoch !== this.epoch) {
      // A claim began while this beat was out: its answer speaks for the lease it was asked
      // about, never the one now held.
    } else if (!this.lostLease && (leaseLostFrom(this.state.get(), this.now()) || (this.inflight && answer.claim == null))) {
      this.loseLease('lease-timeout');
    }
    if (this.inflight) {
      if (view === 'unknown') this.signalLeg('course-changed', 'released:course-changed');
      else if (view && typeof view === 'object') {
        if (view.closed === 'done') this.closedDone = true;
        else if (view.regressed) this.signalLeg('regressed');
        const next = (view.next ?? null) as NextLegs | null;
        for (const w of this.inflight.waiters.splice(0)) w(next ?? []);
      }
    }
    for (const m of (answer.messages ?? []) as { id: number; kind: string; payload?: { reason?: string } }[]) {
      // 2026-10-24: every message is logged on receipt — a release or cue the runner acts on
      // silently was the hardest class to debug from the log alone.
      this.log(`baton: message ${m.kind}${m.payload?.reason ? ` (${m.payload.reason})` : ''} received${this.state.get().claim ? ` for ${this.state.get().claim!.ticket_id}` : ''}`);
      if (m.kind === 'release') {
        this.toAck.push(m.id);
        // A release message's payload reason is one of §6.5's own ('requested', 'owner-cancel',
        // 'provider-suspended') — it names the end directly. (A releasing owner bar arrives
        // the same way, as a release message — §11's heartbeat bars carry no release flag.)
        this.signalLeg('release', `released:${m.payload?.reason ?? 'requested'}`);
      } else if (m.kind === 'unblocked') {
        // R-BTN-77, §9: the idle wait ends with the next claim attempt, and the cue is acknowledged
        // so it is not delivered again with every beat.
        this.unblocked = true;
        this.toAck.push(m.id);
      } else if (m.kind === 'wind-down') {
        // B-109: the owner's wind-down sets the same drain flag SIGTERM does — the current leg
        // completes, the claim ends at its boundary with its hand-off, the runner exits without
        // claiming again. drain() is idempotent: a second wind-down changes nothing.
        this.drain(`the owner's wind-down message`);
        this.toAck.push(m.id);
      }
    }
    if (!this.inflight) for (const id of this.toAck.splice(0)) await this.o.api.ack(id).catch(() => {});
  }

  /** An end whose failure is never fatal: claimed-ended is the answer we wanted anyway, and a
   * network failure parks the end for the beats to retry. */
  private async endQuietly(claimId: number, body: Record<string, unknown>): Promise<void> {
    // An end already parked for this claim keeps its own body — a re-end here must never
    // overwrite a done or suspended end the wire ate.
    if (this.pendingEnd?.claimId === claimId) return;
    try {
      await this.o.api.end(claimId, body);
    } catch (e) {
      if (e instanceof BatonRefusal && e.code === 'claim-ended') return;
      if (e instanceof BatonRefusal && (e.code === 'unavailable' || e.status >= 500)) {
        this.pendingEnd = { claimId, body };
        return;
      }
      if (e instanceof BatonRefusal) {
        this.log(`baton: the orphaned claim ${claimId} was refused (${e.message})`);
        return;
      }
      this.pendingEnd = { claimId, body };
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
    // R-BTN-19: the claim was taken away from this worker; the next heartbeat reports the fence
    // it cleared, so the ticket is re-issued instead of waiting for the worker to go silent.
    this.fenceToReport = this.inflight?.claimId ?? this.state.get().claim?.id ?? null;
    const child = this.inflight?.child;
    if (child) this.killGroup(child);
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
    if (!this.inflight) return;
    // A release is the strongest signal: it overrides a regression or a course change that
    // landed first, so its message is never acknowledged away (§6.13, §9).
    if (this.pendingAbort && !(signal === 'release' && this.pendingAbort.signal !== 'release')) return;
    this.pendingAbort = { signal, reason };
    // The wire carries §6.13's closed reason set: a course change stops the leg the way a
    // release does — at its next safe point — so that is the signal it gets.
    const child = this.inflight.child;
    const wire = signal === 'course-changed' ? 'release' : signal;
    if (child?.process.stdin && !child.process.stdin.destroyed) child.process.stdin.write(`${JSON.stringify({ abort: wire })}\n`);
  }

  private killGroup(child: LegChild): void {
    try {
      if (child.process.pid) process.kill(-child.process.pid, 'SIGKILL');
    } catch {
      // The group is already gone — the leg ended before the lease did.
    }
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
    const pending = this.pendingEnd;
    if (!pending) return;
    try {
      await this.o.api.end(pending.claimId, pending.body);
      this.pendingEnd = null;
    } catch (e) {
      if (e instanceof BatonRefusal && e.code === 'claim-ended') this.pendingEnd = null;
      else this.log(`baton: retrying the end Baton never answered (${msg(e)})`);
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
    if (this.inflight?.child) this.killGroup(this.inflight.child);
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
    this.signalLeg('release', 'released:requested');
  }

  async work(): Promise<void> {
    this.ensureFatalHooks();
    this.start();
    while (!this.stopped && !this.draining) {
      try {
        const outcome = await this.runOnce();
        if (!outcome) await this.idleWait();
      } catch (e) {
        this.log(`baton: the loop failed (${msg(e)}) — retrying after a beat`);
        await this.idleWait();
      }
    }
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
    while (!this.stopped && !this.draining && !this.unblocked && this.now() < until) await sleep(Math.min(50, this.o.beatEvery));
    this.unblocked = false;
  }

  /** One claim's whole run — or one idle attempt, returning null when nothing was claimable. */
  async runOnce(): Promise<ClaimOutcome | null> {
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
    // A claim the state file still names with nothing in flight is an orphan — a restart, or an
    // end the network ate. It is ended (its resume record already says why) rather than held:
    // Baton would refuse every claim of this worker otherwise (rule 3, one claim per worker).
    const orphan = this.state.get().claim;
    if (orphan && !this.inflight) {
      this.log(`baton: ending the orphaned claim ${orphan.id} on ${orphan.ticket_id} before claiming`);
      this.state.set({ claim: null });
      await this.endQuietly(orphan.id, { end_reason: 'released:lease-lost', next: null });
    }
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
      const claimOn = this.declared ?? this.o.capabilities ?? [];
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
    try {
      claim = await this.o.api.claim({ request_id: `run-${randomBytes(8).toString('hex')}`, ...(wanted ? { ticket_id: wanted } : {}) });
    } catch (e) {
      if (e instanceof BatonRefusal && e.code === 'no-eligible-ticket') return null;
      if (e instanceof BatonRefusal && e.code === 'not-eligible' && /already held|worker-holds/.test(e.message)) {
        // The worker still holds a claim Baton knows and this runner does not (its state was
        // lost with the container): the heartbeat's claim view named it, so end it loudly
        // rather than idling on the refusal forever.
        const held = this.state.get().claim;
        this.log(`baton: the claim was refused — this worker still holds ${held ? `claim ${held.id}` : 'a claim'} (${e.message})`);
        if (held) {
          this.state.set({ claim: null });
          await this.endQuietly(held.id, { end_reason: 'released:lease-lost', next: null });
        }
        return null;
      }
      if (e instanceof BatonRefusal && e.code === 'not-eligible') return null;
      throw e;
    }
    this.epoch++;
    const ticket = claim.ticket_id as string;
    const claimId = claim.claim_id as number;
    this.state.set({ claim: { id: claimId, ticket_id: ticket, nonce: claim.nonce } });
    this.log(`baton: claimed ${ticket} at ${claim.station}, queued leg ${claim.legs?.[0]}${this.verbose ? ` (claim ${claimId}, nonce ${claim.nonce})` : ''}`);
    return this.runClaim(claim);
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

  private async runClaim(claim: Record<string, any>): Promise<ClaimOutcome> {
    const claimId = claim.claim_id as number;
    const ticket = claim.ticket_id as string;
    let course: CourseLoad | null = null;
    try {
      // R-BTN-34: the snapshot must be in the home checkout — one fetch, else stale-board.
      if (!ensureSha(this.o.home, claim.snapshot_sha, () => this.o.fetch?.(this.o.home))) {
        return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
      }
      course = loadCourse(this.o.home, claim.snapshot_sha, this.claimCourse(claim));
    } catch (e) {
      this.log(`baton: the claim's course would not load (${msg(e)})`);
      return await this.finish(claimId, { end_reason: 'released:stale-board', reached: claim.station, ...(claim.legs?.[0] ? { next: claim.legs[0] } : {}) }, null);
    }
    const scratch = claimScratch();
    this.inflight = { claimId, ticket, course, leg: null, child: null, waiters: [] };
    this.closedDone = false;
    // §2e/R-BTN-63: the legs git evidences are every earlier attempt's, flattened; the claim's
    // own legs are counted beside them when a leg's run number is taken.
    let gitPath = (claim.previous_attempts ?? []).flatMap((a: { legs?: { leg: string; reached: string | null }[] }) =>
      (a.legs ?? []).map((l) => ({ leg: l.leg, reached: l.reached ?? '' })));
    let handoffUrl = (claim.handoff_url ?? null) as string | null;
    let resume = (claim.previous_attempts?.[0]?.resume ?? null) as Record<string, any> | null;
    let advice = (claim.advice ?? null) as unknown;
    let session: string | null = null;
    const own: string[] = [];
    let ranScript: string | null = null;
    let ranCtx: Record<string, unknown> | null = null;
    // The first leg is the claim response's queued leg (R-BTN-83); the first advance starts it.
    let legName = (claim.legs?.[0] ?? null) as string | null;
    let at = claim.station as string;
    let nextLegs = (claim.next ?? []) as NextLegs;
    try {
      if (legName == null) return await this.finish(claimId, { end_reason: 'done', reached: at }, null);
      const firstAnswer = await this.advance(claimId, { leg: legName }, at);
      if ('settle' in firstAnswer) return await this.finish(claimId, firstAnswer.settle, null);
      at = firstAnswer.station ?? at;
      nextLegs = (firstAnswer.next ?? nextLegs) as NextLegs;
      advice = firstAnswer.advice ?? advice;
      for (;;) {
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
        if (this.inflight) this.inflight.leg = legName;
        const run = runNumber(course.graph, gitPath, legName, own);
        own.push(legName);
        const ctx = {
          ticket: { id: ticket, path: claim.path ?? null, home: this.o.repository },
          claim: { id: claimId, nonce: claim.nonce, station: at },
          leg: legName, run,
          snapshot: { sha: claim.snapshot_sha, path: gitPath, next: nextLegs },
          // The claim answer names the repository's default branch (R-BTN-34; §5.8's marker
          // legs, B-96's review round 2): the stub hands it to the close, so a marker line goes
          // to the branch the sync reads whatever branch this checkout is on.
          ...(typeof claim.default_branch === 'string' && claim.default_branch !== '' ? { default_branch: claim.default_branch } : {}),
          handoff: handoffUrl, resume, advice,
          checkout: this.o.home, session,
          state: this.o.stateFile, worker: this.state.get().worker_id,
        };
        const outcome = await this.runLeg(course, legName, ctx, scratch);
        const script = course.scripts.get(legName) ?? null;
        if (outcome.kind !== 'lease-lost' && outcome.kind !== 'missing') {
          ranScript = script;
          ranCtx = ctx;
        }
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
          this.log(`baton: ${ticket}'s ${legName} failed (${outcome.error})`);
          return await this.finish(claimId, { end_reason: 'released:cannot-finish:transient', reached: at, next: legName }, await this.callHandoff(script, ctx));
        }
        const result = outcome.result;
        session = typeof (result as { session?: unknown } | null)?.session === 'string'
          ? (result as { session: string }).session : session;
        const verdict = decide(result, course.graph, legName, at);
        if ('bug' in verdict) {
          this.log(`baton: ${ticket}'s ${legName} script bug: ${verdict.why}`);
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
        // joins the evidenced path only now — the next leg's run number counts what ran.
        const answer = await this.advance(claimId, { reached: verdict.reached, leg: verdict.leg, bars: verdict.bars, ...(verdict.outputs ? { outputs: verdict.outputs } : {}), ...(closed ? { evidence: closed } : {}) }, verdict.reached);
        // 2026-10-24: the advance trail — every finished leg names where it landed and what it
        // queued, so a suspension or an odd end position reads as a trail, not a riddle.
        this.log(`baton: ${ticket}'s ${legName} finished: reached ${verdict.reached}, next ${'settle' in answer ? 'the end' : (answer.next?.[0]?.leg ?? verdict.leg)} (run ${run} of ${course.graph.legs.get(legName)?.maxRuns ?? 1})`);
        if ('settle' in answer) return await this.finish(claimId, answer.settle, await this.callHandoff(script, ctx) ?? handoffUrl);
        gitPath = [...gitPath, { leg: legName, reached: verdict.reached }];
        at = answer.station ?? verdict.reached;
        nextLegs = (answer.next ?? nextLegs) as NextLegs;
        advice = answer.advice ?? advice;
        legName = verdict.leg;
        handoffUrl = null;
        resume = null;
      }
    } finally {
      for (const w of this.inflight?.waiters.splice(0) ?? []) w([]);
      this.inflight = null;
      this.pendingAbort = null;
      dropCourse(course!.scratch);
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  /** One `advance`, its refusal settled by §6.13: off-graph ends `released:course-changed`; an
   * `entry` refusal (R-BTN-109) ends `released:cannot-finish:contract-output`; every other
   * refusal suspends at the station the claim reached, never releasing. */
  private async advance(claimId: number, body: { leg: string; reached?: string; bars?: string[]; evidence?: string; outputs?: unknown[] }, fallbackStation: string): Promise<{ station?: string; next?: NextLegs; advice?: unknown } | { settle: Record<string, unknown> }> {
    try {
      return await this.o.api.advance(claimId, body) as { station?: string; next?: NextLegs; advice?: unknown };
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
      if (this.lostLease || leaseLostFrom(this.state.get(), this.now())) return 'lost';
      if (this.pendingAbort) return 'abort';
      const shown = await new Promise<NextLegs | null>((resolve) => {
        if (!this.inflight) return resolve(null);
        this.inflight.waiters.push((n) => resolve(n));
        setTimeout(() => resolve(null), this.o.beatEvery).unref?.();
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
    const ctxPath = join(scratch, `ctx-${leg}-${tag}.json`);
    const resultPath = join(scratch, `result-${leg}-${tag}.json`);
    writeFileSync(ctxPath, JSON.stringify(ctx));
    // Detached: its own process group, so a lost lease kills the leg and everything it started
    // (§6.13) without touching the runner. The env names the parent every leg session checks
    // (BATON_PARENT — such a session never claims; BATON_STATE — the fence and the spool). B-97
    // dropped the transition's IR_BATON_* spellings: these two names are the only ones set.
    const parent = String(this.state.get().worker_id ?? '');
    const childEnv = {
      ...process.env, BATON_PARENT: parent, BATON_STATE: this.o.stateFile,
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
    };
    if (this.verbose) this.log(`baton: ${leg} runs: node ${basename(LEG_PROCESS)} ${basename(script)} (ctx ${basename(ctxPath)})`);
    const child = spawn(process.execPath, [LEG_PROCESS, script, ctxPath, resultPath], {
      detached: true, stdio: ['pipe', 'ignore', this.verbose ? 'pipe' : 'ignore'],
      env: childEnv,
    });
    // B-108's streaming half: the leg child's stderr carries the stub's own verbose lines and
    // its mirror of the agent's two streams — line-drained, every line timestamped.
    if (this.verbose) drainLines(child.stderr!, (l) => this.log(`baton: ${leg}: ${l}`));
    const inflight = this.inflight!;
    inflight.child = { process: child, resultPath, ctxPath };
    let done = false;
    const exited = new Promise<void>((resolve) => child.on('exit', () => {
      done = true;
      resolve();
    }));
    const lost = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        // R-BTN-26: the fence computes the lease itself from the state file — the wall clock
        // against `last_ok` — never trusting only the sidecar's flag.
        if (leaseLostFrom(this.state.get(), this.now()) || this.lostLease || this.stopped) {
          clearInterval(timer);
          resolve();
        }
      }, Math.min(200, this.o.beatEvery));
      timer.unref?.();
      void exited.then(() => clearInterval(timer));
    });
    await Promise.race([exited, lost]);
    if (!done || this.lostLease) {
      // The lease went (or the runner stops): kill the leg's whole group at once, no hand-off —
      // the resume record covers it (R-BTN-24).
      this.killGroup(inflight.child);
      return { kind: 'lease-lost' };
    }
    inflight.child = null;
    try {
      const out = JSON.parse(readFileSync(resultPath, 'utf8')) as { ok: boolean; result?: unknown; error?: string };
      return out.ok ? { kind: 'ok', result: out.result } : { kind: 'crashed', error: out.error ?? 'the leg script failed' };
    } catch {
      return { kind: 'crashed', error: 'the leg wrote no result' };
    }
  }

  /** `close(ctx, result)`: the closing marker from the validated result (R-BTN-83), retried
   * twice; when it cannot write, nothing is reported for the leg (§6.13) — `undefined`.
   * §6.13's default-export shape and the named-export shape both serve. */
  private async callClose(script: string | null, ctx: Record<string, unknown>, result: unknown): Promise<string | null | undefined> {
    if (script == null) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mod = (await import(`${pathToFileURL(script).href}?close=${randomBytes(4).toString('hex')}`)) as { close?: (ctx: unknown, result: unknown) => unknown; default?: { close?: (ctx: unknown, result: unknown) => unknown } };
        const close = mod.close ?? mod.default?.close;
        if (typeof close !== 'function') throw new Error('the script exports no close(ctx, result)');
        const ref = await close(ctx, result);
        return typeof ref === 'string' ? ref : null;
      } catch (e) {
        this.log(`baton: the leg's close failed (${msg(e)}), attempt ${attempt + 1} of 3`);
      }
    }
    return undefined;
  }

  /** `handoff(ctx)` (R-BTN-44): before any suspension or release; its failure is logged and the
   * resume record covers the rest. */
  private async callHandoff(script: string | null, ctx: Record<string, unknown>, why?: string): Promise<string | null> {
    if (script == null) return null;
    try {
      const mod = (await import(`${pathToFileURL(script).href}?handoff=${randomBytes(4).toString('hex')}`)) as { handoff?: (ctx: unknown) => unknown; default?: { handoff?: (ctx: unknown) => unknown } };
      const handoff = mod.handoff ?? mod.default?.handoff;
      if (typeof handoff !== 'function') throw new Error('the script exports no handoff(ctx)');
      const url = await handoff(why != null ? { ...ctx, bug: why } : ctx);
      return typeof url === 'string' ? url : null;
    } catch (e) {
      this.log(`baton: the leg's handoff failed (${msg(e)}) — the resume record covers it (R-BTN-24)`);
      return null;
    }
  }

  /** End the claim, clear the local claim state, and ack what the sidecar delivered. The local
   * flags clear whatever the wire said — a lost lease belongs to the claim that lost it — and an
   * end the network ate is parked and retried on every beat until Baton answers. */
  private async finish(claimId: number, body: Record<string, unknown>, handoff: string | null): Promise<ClaimOutcome> {
    const ticket = this.state.get().claim?.ticket_id ?? this.inflight?.ticket ?? '';
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
        this.pendingEnd = { claimId, body };
      } else if (e instanceof BatonRefusal && refusalKind(e.ruleCode) === 'contract-output' && !String(body.end_reason).startsWith('released:')) {
        // R-BTN-109: a completed end whose outputs fail its station's entry gives the leg up, as
        // a refused advance does — an output contract failure (R-BTN-82).
        this.log(`baton: ${ticket}'s outputs do not meet its arrival (${e.message}) — the leg is given up`);
        return await this.finish(claimId, { end_reason: 'released:cannot-finish:contract-output' }, handoff);
      } else if (e instanceof BatonRefusal) {
        throw e;
      } else {
        this.log(`baton: the end of ${ticket} did not reach Baton (${msg(e)}) — retried on every beat`);
        this.pendingEnd = { claimId, body };
      }
    }
    for (const id of this.toAck.splice(0)) await this.o.api.ack(id).catch(() => {});
    this.state.set({ claim: null });
    // The lost lease belonged to that claim (R-BTN-6): a fresh claim starts on a fresh lease,
    // so the flag never outlives the claim it fenced — cleared here, not only on success.
    this.lostLease = false;
    this.state.set({ lease_lost: false, lease_lost_because: null });
    this.closedDone = false;
    this.log(`baton: ${ticket} ${body.end_reason} at ${body.reached ?? '?'}`);
    return { ticket, end_reason: body.end_reason as string, reached: (body.reached as string) ?? null, handoff };
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** B-23's slice (the owner, 2026-10-23): every log line carries the time it was written —
 * an ISO 8601 instant, one timezone-free spelling on every machine. */
export const stampLine = (line: string): string => `${new Date().toISOString()} ${line}`;

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
