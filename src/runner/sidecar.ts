// The runner's heartbeat cadence, lease and spool delivery (R-BTN-6, R-BTN-26).
import { appendFileSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { capabilitiesOf } from '../shared/vocabulary.mjs';
import { BatonRefusal } from './api';
import type { MachineLocks } from './machineLocks';
import type { RunnerOptions } from './runner';
import { ageWords, legActivity, msg, sleep } from './log';
import { StateFile, leaseLostFrom, type PersistedClaim, type RunnerState } from './state';
import { freshSecret } from './home';

/** §6.3: the sidecar's cadence — every beat 2 minutes. */
export const BEAT_MS = 2 * 60_000;
/** B-86: how many beats one claim attempt spends making the server's record of the declaration
 *  match the list the claim will carry — one for a fresh or legacy runner, one for the change it
 *  settles (review round 4, finding 4). */
const MAX_STALE_BEATS = 2;
/** B-86: what the heartbeat declares when `--capabilities` names nothing — exactly the set the
 *  answer carried, deduplicated, with `none` dropped (it says nothing, `vocabulary.mjs`). Every
 *  name in it is one the server answered: a grant is stored as the roles the owner named and the
 *  capabilities they stay as (admin.ts:423), and the heartbeat admits each name by the same
 *  logic that answered it — a role by its own name in a bearer or seed key's allow-list, a
 *  capability when its expansion is all granted (`credentialAllowed`, runnerApi.ts). So a role
 *  the answer carries is declared as the role: rule 4 and the grant check both expand it
 *  gates-side (`capabilitiesOf`), which is why folding it into (or dropping it for) its
 *  capabilities could only lose names the server would have accepted (review round 4, finding 1).
 *  Exported for its test. */
export function declarationFrom(held: string[]): string[] {
  return [...new Set(held)].filter((n) => n !== 'none');
}

type SidecarOptions = Pick<RunnerOptions, 'api' | 'apiFor' | 'stateFile' | 'hostname' | 'session' |
  'harness' | 'activityPaths' | 'capabilities' | 'tierCeiling' | 'profile' | 'testHarness' | 'courses' | 'repository' | 'legNeeds'> & {
  beatEvery: number;
  concurrency: number;
  now: () => number;
  log: (line: string) => void;
};

interface HeartbeatClaim {
  readonly claimId: number | null;
  readonly ticket: string;
  readonly checkout: string;
  readonly ended: boolean;
  readonly lost: boolean;
  readonly legSessionUrl: string | null;
  readonly sessionLinkSeq: number;
  readonly legFinishedSeq: number | null;
  readonly legLineAt: number | null;
  readonly heartbeatLeg: { claimId: number; ticket: string; leg: string | null; legAt: number; running: boolean } | null;
  acceptHeartbeatReports(linkSeq: number | undefined, finishedSeq: number | undefined): void;
  applyGitView(view: unknown): void;
  receiveRelease(id: number, reason: string): void;
  fence(): void;
}

interface ClaimRegistry {
  live: readonly HeartbeatClaim[];
  pendingRequests: number;
  epoch: number;
  persisted: readonly PersistedClaim[];
}

export class Sidecar {
  private beat: ReturnType<typeof setInterval> | null = null;
  private lostLease = false;
  private toAck: number[] = [];
  /** R-BTN-77: the cues (`unblocked`, `wind-down`) acknowledged at the beat that carried them,
   *  whether or not a claim is running — they act on the runner, not on a claim, so nothing is
   *  gained by holding them to a claim's end, and until acknowledged Baton delivers them again
   *  with every beat (found live 2026-11-18: one `unblocked` logged on each of a 40-minute leg's
   *  beats). */
  private ackNow: number[] = [];
  /** The message ids already logged, so a message Baton delivers again before its acknowledgement
   *  lands (a release held for its claim's end) is logged once, not on every beat. Bounded. */
  private seenMessages = new Set<number>();
  /** R-BTN-19 (B-188): the claims the runner knows it lost, whose fences the next heartbeat
   *  clears — one entry per claim. */
  private fences: number[] = [];
  /** R-BTN-77: set when a heartbeat carried an `unblocked` message, so the idle wait ends early. */
  private unblocked = false;
  /** Bumps with every claim: an answer a beat started before the claim cannot fence it. */
  private ticking: Promise<void> | null = null;
  /** R-BTN-14: a reaped runner re-keys on its next beat; the fresh secret until it lands. */
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
  /** B-86: the `forbidden` line has been said for this stretch of refusals (reset by the next
   *  answered beat), so asking again is not narrated on every beat. */
  private saidForbidden = false;
  /** B-106 (R-BTN-178): this machine's locks, null when none were configured. */
  /** B-93: the beat a `start()` issued, and that registers the runner (review round 2, finding
   * 3). A session's first attempt finds a beat already out — the sidecar's boot beat — and read
   * its runner id before the answer, so `!registered` sent a second, redundant heartbeat and
   * `stray` never applied. This is the promise `waitForBeat` waits on. */
  private booting: Promise<void> | null = null;
  private answerClaims: Set<number> | null = null;

  constructor(
    private readonly o: SidecarOptions,
    private readonly state: StateFile,
    private readonly locks: Pick<MachineLocks, 'manages' | 'holds' | 'takeAll'> | null,
    private readonly claims: () => ClaimRegistry,
    private readonly drain: (why: string) => void,
  ) {
    // B-86: a restart keeps the declaration the last process settled — a granted runner does not
    // ask again, and `runOnce` has no stale `[]` to force a beat for. `--capabilities` still
    // narrows what was read: a flag is the operator's word, the state file's a past answer.
    this.declared = o.capabilities ?? this.state.get().declared ?? null;
    if (o.capabilities != null && JSON.stringify(o.capabilities) !== JSON.stringify(this.state.get().declared)) {
      this.state.set({ declared: o.capabilities });
      // Settled before any answer, so the first beat already declares the flag's list — and an
      // answer that matches it settles nothing, so the line is said here, once (a restart over
      // the same state file says nothing). The never-eligible line waits for the first answer,
      // which is where the grant (and so `legNeeds`' question) is said with it.
      this.o.log(`baton: declaring ${o.capabilities.join(', ') || 'none'} (--capabilities — it narrows what the grant allows, never enables what the grant does not)`);
    }
  }
  start(): void {
    if (this.beat) return;
    this.beat = setInterval(() => void this.tick().catch((e) => this.o.log(`baton: heartbeat failed (${msg(e)})`)), this.o.beatEvery);
    this.beat.unref?.();
    // The boot beat, as a promise `runOnce` can wait on before it asks Baton anything (B-93).
    const boot = this.tick().catch((e) => this.o.log(`baton: heartbeat failed (${msg(e)})`));
    this.booting = boot;
    void boot.finally(() => { if (this.booting === boot) this.booting = null; });
  }
  stop(): void {
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
  }

  get leaseLost(): boolean { return this.lostLease; }

  clearLeaseLoss(): void {
    this.lostLease = false;
    this.state.set({ lease_lost: false, lease_lost_because: null });
  }

  takeUnblocked(): boolean {
    const unblocked = this.unblocked;
    this.unblocked = false;
    return unblocked;
  }

  /** Null means no answer has established which claims Baton still holds. */
  claimListed(id: number): boolean | null {
    return this.answerClaims?.has(id) ?? null;
  }

  parkEnd(id: number, body: Record<string, unknown>): void {
    this.pendingEnds.set(id, body);
  }

  async ackEnd(ids: number[]): Promise<void> {
    for (const id of [...ids, ...this.toAck.splice(0)]) await this.o.api.ack(id).catch(() => {});
  }

  /** One heartbeat, by the timer or a test: the §11 answer drives everything local — the lease,
   * the claim git shows, the messages and the snapshot's next legs. Never concurrent with
   * another beat, so an answer always post-dates the claim state it is judged against. A caller
   * that arrives while a beat is out waits for it and returns — review round 5, finding 2:
   * `work()` starts the sidecar and then claims at once, and the boot beat must have landed
   * (registering the runner, settling the declaration) before `runOnce` reads `sent`; returning
   * on the guard let the first claims go out on `null` and `[]`. */
  async tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.beatOnce().finally(() => { this.ticking = null; });
    return this.ticking;
  }
  /** B-93: whatever beat was in flight has answered — so the calls after it are a registered
   * runner's, carrying the secret Baton now holds. A beat still out after a minute has lost its
   * claim to the timer and the next attempt; the wait is bounded so an attempt can never hang. */
  async waitForBeat(): Promise<void> {
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
  /** The declaration as it goes out on a beat or is compared before a claim (B-86, B-106): the
   *  settled list less every lock capability whose file this process does not hold — of the
   *  runners on one machine only the one holding the lock declares it (R-BTN-178). */
  private declaringList(): string[] {
    const base = this.declared ?? this.o.capabilities ?? [];
    const locks = this.locks;
    return locks ? base.filter((c) => !locks.manages(c) || locks.holds(c)) : base;
  }

  private async beatOnce(): Promise<void> {
    const { epoch, pendingRequests, live } = this.claims();
    // B-188: a claim request out while this beat is built or answered — Baton may hold a claim
    // the runner has no slot for yet, so this answer cannot judge one it does not know.
    const claimingAtStart = pendingRequests > 0;
    const s = this.state.get();
    const spool = this.takeSpool();
    // R-BTN-4 (B-188): the claims held as this beat is built — each judged against the answer.
    // B-86: `--capabilities` narrows; without it the declaration is the grant's, which the first
    // answer carries (`grant.capabilities`), so the first beat asks and declares nothing — the
    // registration has no declaration to widen, and the beat after it serves the grant.
    // B-106 (R-BTN-178): a lock free again is taken and declared; one another process on this
    // machine holds is not declared, so no leg requiring it is offered here. Mid-claim the set
    // is the claims' own — `ensureLegLocks` holds the legs' locks and releases the rest — so the
    // idle maintenance stays out until every claim ends.
    if (this.locks && !live.some((x) => x.heartbeatLeg)) await this.locks.takeAll();
    const declaring = this.declaringList();
    // R-BTN-113, R-BTN-90 (B-188): each claim's running leg's link and finished run, by claim;
    // read at build time, so the answer below clears only what this beat carried.
    const links = live.filter((x) => x.claimId != null && x.legSessionUrl).map((x) => ({ slot: x, claim_id: x.claimId!, url: x.legSessionUrl!, seq: x.sessionLinkSeq }));
    const finished = live.filter((x) => x.claimId != null && x.legFinishedSeq != null).map((x) => ({ slot: x, claim_id: x.claimId!, seq: x.legFinishedSeq! }));
    const fences = [...new Set(this.fences)];
    // One claim at a time keeps the shapes a Baton before B-188 reads: the bare `session_url`
    // and `leg_finished`, and a `fenced` object.
    const one = this.o.concurrency === 1;
    const body: Record<string, unknown> = {
      hostname: this.o.hostname, session_name: this.o.session, harness: this.o.harness, kind: 'vm',
      capabilities: declaring, tier_ceiling: this.o.tierCeiling ?? 'critical',
      // B-253 (R-BTN-72): the runner's own statement about itself, opaque — the CLI's pinning
      // under `cli`, on every beat.
      ...(this.o.profile ? { profile: this.o.profile } : {}),
      ...(this.o.testHarness ? { test_harness: true } : {}),
      lease_timeout_s: s.lease_timeout_s ?? 900,
      // R-BTN-4 (B-188): how many claims this runner holds at once.
      concurrency: this.o.concurrency,
      courses: this.o.courses.map((c) => ({ repository: this.o.repository, course: c.course, version: c.version })),
      // R-BTN-113 (B-234, B-188): the running legs' session links, kept on their runs' rows
      // (latest wins while each runs); Baton drops and logs one that fails the link rule.
      ...(links.length ? { session_urls: links.map((l) => ({ claim_id: l.claim_id, url: l.url })) } : {}),
      ...(one && links.length ? { session_url: links[0].url } : {}),
      // §7.5 R-BTN-90 (B-234, B-188): the runs whose scripts returned — the finishing half's word.
      ...(finished.length ? { legs_finished: finished.map((f) => ({ claim_id: f.claim_id, seq: f.seq })) } : {}),
      ...(one && finished.length ? { leg_finished: finished[0].seq } : {}),
      ...((s.runner_id == null || this.rekeySecret) ? { secret_hash: await sha256Hex(this.rekeySecret ?? s.secret), ...(this.rekeySecret ? { rekey: true } : {}) } : {}),
      // R-BTN-19 (B-188): one entry per fenced claim.
      ...(fences.length ? { fenced: one && fences.length === 1 ? { claim_id: fences[0], terminated: true } : fences.map((id) => ({ claim_id: id, terminated: true })) } : {}),
      transcripts: spool.transcripts,
    };
    const result = await this.sendHeartbeat(body, spool);
    if (!result) return;
    const { answer, sentAt } = result;
    // R-BTN-113 (B-234): the answer's word on each link — Baton holds a run's session link when
    // the beat carried it and the answer kept it (not dropped: a dropped link failed the rule
    // and was stored nowhere). This is what each claim's raise check reads (R-BTN-195).
    for (const x of live) {
      const carried = links.find((l) => l.slot === x);
      x.acceptHeartbeatReports(answer.session_url_dropped == null ? carried?.seq : undefined, finished.find((f) => f.slot === x)?.seq);
    }
    await this.recordDeclaration(declaring, answer);
    if (this.rekeySecret) {
      // The re-key landed: the new secret serves from here (R-BTN-14), and the new incarnation
      // starts on a fresh lease — the old flag fenced a claim the reap already took.
      this.state.set({ secret: this.rekeySecret, lease_lost: false, lease_lost_because: null });
      this.o.api.setSecret(this.rekeySecret);
      this.rekeySecret = null;
      this.lostLease = false;
    }
    this.state.set({
      runner_id: answer.runner_id, incarnation: answer.incarnation, last_ok: sentAt,
      lease_timeout_s: answer.lease_timeout_s ?? s.lease_timeout_s,
    });
    // R-BTN-19: the fences this beat carried cleared with it.
    this.fences = this.fences.filter((id) => !fences.includes(id));
    await this.applyClaimViews(answer, live, epoch, claimingAtStart);
  }

  private async sendHeartbeat(body: Record<string, unknown>, spool: ReturnType<Sidecar['takeSpool']>): Promise<{ answer: Record<string, any>; sentAt: number } | null> {
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
    // R-BTN-26: the lease this beat renews counts from when the beat left, never from when its
    // answer was read — Baton counts from no later than its receipt, so the later reading would
    // have the runner believe in a lease Baton has already ended.
    const sentAt = this.o.now();
    try {
      answer = await this.o.api.heartbeat(body);
    } catch (e) {
      // The transcripts never landed: back to the spool for the next beat.
      appendFileSync(this.state.spool, `${[...spool.transcripts, ...leftover].map((t) => JSON.stringify(t)).join('\n')}\n`);
      rmSync(spool.taken, { force: true }); // back in the spool; the taken copy is spent
      if (e instanceof BatonRefusal && ['session-taken', 'runner-reaped', 'worker-reaped', 'forbidden'].includes(e.code)) {
        // §6.3: a refused heartbeat marks the lease lost exactly as a missed timeout does; a
        // reaped runner re-keys on the beat after (R-BTN-14).
        if (e.code === 'runner-reaped' || e.code === 'worker-reaped') this.rekeySecret = freshSecret();
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
          if (!this.saidForbidden) this.o.log(`baton: the heartbeat was refused (forbidden): ${e.message} — asking again with no declaration, so the next answer re-settles what this machine may declare`);
          this.saidForbidden = true;
        }
        this.loseLease(e.code);
        return null;
      }
      throw e;
    }
    rmSync(spool.taken, { force: true });
    return { answer, sentAt };
  }

  private async recordDeclaration(declaring: string[], answer: Record<string, any>): Promise<void> {
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
      if (!this.grantAsked) this.o.log('baton: the heartbeat answered no grant — the declaration stays unsettled and the next beat asks again (a seed key is granted nothing; a machine key is granted by its owner)');
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
      this.o.log(this.o.capabilities
        ? `baton: declaring ${held} (--capabilities, narrowing what the grant allows: ${grantValues ? (grant?.join(', ') || 'none') : 'unknown'})`
        : `baton: declaring ${held} — the grant's capabilities, no --capabilities given`);
      await this.reportEligibility();
    } else if (settled != null && !this.saidEligible) {
      // The first answer settled nothing (a `--capabilities` list it agrees with): the
      // never-eligible line is still owed once, against the grant this answer names.
      await this.reportEligibility();
    }
  }

  private async applyClaimViews(answer: Record<string, any>, live: readonly HeartbeatClaim[], epoch: number, claimingAtStart: boolean): Promise<void> {
    // R-BTN-4 (B-188): every claim the runner holds, oldest first; a Baton before B-188 answers
    // the one `claim`.
    const answered = (Array.isArray(answer.claims) ? answer.claims : answer.claim && typeof answer.claim === 'object' ? [answer.claim] : []) as Record<string, any>[];
    const byId = new Map(answered.filter((c) => c && typeof c.id === 'number').map((c) => [c.id as number, c]));
    this.answerClaims = new Set(byId.keys());
    // R-BTN-6 and §6.13: the wall clock's own verdict fences the runner — every claim, stop each
    // leg, no hand-off; an answer that no longer lists one claim fences that claim alone.
    const steady = epoch === this.claims().epoch && !claimingAtStart && this.claims().pendingRequests === 0;
    if (epoch !== this.claims().epoch) {
      // A claim began while this beat was out: its answer speaks for the claims it was asked
      // about, never one taken since.
    } else if (!this.lostLease && leaseLostFrom(this.state.get(), this.o.now())) {
      this.loseLease('lease-timeout');
    } else if (!this.lostLease) {
      for (const x of live) {
        const id = x.heartbeatLeg?.claimId;
        if (id != null && !x.lost && !x.ended && !byId.has(id)) this.loseClaim(x);
      }
    }
    for (const x of live) {
      const running = x.heartbeatLeg;
      if (!running) continue;
      x.applyGitView(byId.get(running.claimId)?.git ?? null);
      // B-108: the liveness line — while a leg call is in flight, each beat says how long it has
      // run and how old its newest activity signal is, so an operator watches a wedge form (and
      // the leg's ceiling approach) instead of silence. Advice for the operator's eye, never a
      // detector: the stub concludes its agent; this line only makes the wait visible.
      if (running.running && running.leg != null) {
        const leg = running.leg;
        const signals = [...legActivity(x.checkout, running.ticket, leg, this.o.activityPaths), ...(x.legLineAt != null ? [{ name: 'drained-line', at: x.legLineAt }] : [])];
        const newest = signals.reduce((a, b) => (b.at > a.at ? b : a));
        this.o.log(`baton: ${running.ticket}'s ${leg} has run ${ageWords(this.o.now() - running.legAt)}; newest activity ${newest.at > 0 ? `${ageWords(this.o.now() - newest.at)} ago (${newest.name})` : 'not seen'}`);
      }
    }
    this.deliverMessages(answer.messages ?? [], live);
    // R-BTN-6 (B-188): a claim Baton lists that this runner's state does not hold — a lost state
    // file, a claim granted on a request whose answer never came — is ended `released:lease-lost`,
    // loudly, never left to idle. Not one a claim request still out may be granting, one whose
    // end is parked, nor one the earlier process left (reattached or ended before the first
    // claim).
    if (steady && epoch === this.claims().epoch && this.claims().pendingRequests === 0) {
      const mine = new Set(this.claims().live.map((x) => x.claimId));
      for (const [id, c] of byId) {
        if (mine.has(id) || this.pendingEnds.has(id) || this.claims().persisted.some((p) => p.id === id)) continue;
        this.o.log(`baton: Baton lists claim ${id} on ${String(c.ticket_id ?? '?')}, which this runner does not hold — ending it released:lease-lost (R-BTN-6)`);
        await this.endQuietly(id, { end_reason: 'released:lease-lost', next: null });
      }
    }
    for (const id of this.ackNow.splice(0)) await this.o.api.ack(id).catch(() => {});
    if (!live.length) for (const id of this.toAck.splice(0)) await this.o.api.ack(id).catch(() => {});
  }

  private deliverMessages(messages: { id: number; kind: string; payload?: { reason?: string; ticket_id?: string } }[], live: readonly HeartbeatClaim[]): void {
    for (const m of messages) {
      // R-BTN-119 (B-188): a release names its ticket — it stops that claim alone.
      const target = m.kind === 'release' ? this.slotFor(live, m.payload?.ticket_id) : null;
      const about = target?.ticket || m.payload?.ticket_id || (live.length === 1 ? live[0].ticket || live[0].heartbeatLeg?.ticket : '') || this.state.get().claim?.ticket_id || '';
      // 2026-10-24: every message is logged on receipt — a release or cue the runner acts on
      // silently was the hardest class to debug from the log alone.
      if (!this.seenMessages.has(m.id)) {
        this.seenMessages.add(m.id);
        if (this.seenMessages.size > 1000) this.seenMessages.delete(this.seenMessages.values().next().value as number);
        this.o.log(`baton: message ${m.kind}${m.payload?.reason ? ` (${m.payload.reason})` : ''} received${about ? ` for ${about}` : ''}`);
      }
      if (m.kind === 'release') {
        // A release message's payload reason is one of §6.5's own ('requested', 'owner-cancel',
        // 'provider-suspended') — it names the end directly. (A releasing owner bar arrives
        // the same way, as a release message — §11's heartbeat bars carry no release flag.)
        // One for a ticket no claim here holds is acknowledged with the idle beat.
        if (target) {
          target.receiveRelease(m.id, `released:${m.payload?.reason ?? 'requested'}`);
        } else if (!this.toAck.includes(m.id)) {
          this.toAck.push(m.id);
        }
      } else if (m.kind === 'unblocked') {
        // R-BTN-77, §9: the idle wait ends with the next claim attempt, and the cue is acknowledged
        // so it is not delivered again with every beat.
        this.unblocked = true;
        if (!this.ackNow.includes(m.id)) this.ackNow.push(m.id);
      } else if (m.kind === 'wind-down') {
        // B-109: the owner's wind-down sets the same drain flag SIGTERM does — every leg in
        // flight completes, each claim ends at its boundary with its hand-off, the runner exits
        // without claiming again. drain() is idempotent: a second wind-down changes nothing.
        this.drain(`the owner's wind-down message`);
        if (!this.ackNow.includes(m.id)) this.ackNow.push(m.id);
      }
    }

  }

  /** R-BTN-119 (B-188): the claim a release names, by its ticket — the one held claim when the
   *  message names none (a Baton before B-188 always named one). */
  private slotFor(live: readonly HeartbeatClaim[], ticket: string | undefined): HeartbeatClaim | null {
    if (ticket) return live.find((x) => x.ticket === ticket || x.heartbeatLeg?.ticket === ticket) ?? null;
    return live.length === 1 ? live[0] : null;
  }

  /** B-229 (R-BTN-26): every other state file beside this session's that still names a claim
   *  whose lease is lost by the file's own clock — a session that can no longer act on it, the
   *  same reading its own fence makes — has that claim ended with its own runner's secret, as
   *  `released:lease-lost`, and the file's claim cleared. A sibling session whose lease still
   *  holds is a live runner on this host, and is left alone; a file never answered (no
   *  `last_ok`) holds no lease to read, and is left too. A refusal clears the file (the claim is
   *  ended or not that runner's any more); a failure to reach Baton leaves it for the next start. */
  async endEarlierSessions(): Promise<void> {
    if (!this.o.apiFor) return;
    const dir = dirname(this.o.stateFile);
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      return;
    }
    const now = this.o.now();
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
        this.o.log(`baton: ending claim ${claim.id} on ${claim.ticket_id}, left by the earlier session ${session} (its lease is lost)`);
        try {
          await this.o.apiFor(s.secret).end(claim.id, { end_reason: 'released:lease-lost', next: null });
        } catch (e) {
          if (!(e instanceof BatonRefusal) || e.code === 'unavailable' || e.status >= 500) {
            this.o.log(`baton: claim ${claim.id} could not be ended now (${e instanceof Error ? e.message : String(e)}); the next start tries again`);
            unreached = true;
            continue;
          }
          if (e.code !== 'claim-ended') this.o.log(`baton: claim ${claim.id} of the earlier session ${session} was refused (${e.message}); its file lets it go`);
        }
      }
      if (!unreached) new StateFile(path).set({ claim: null, ...(Array.isArray(s.claims) ? { claims: [] } : {}) });
    }
  }

  /** An end whose failure is never fatal: claimed-ended is the answer we wanted anyway, and a
   * network failure parks the end for the beats to retry. */
  async endQuietly(claimId: number, body: Record<string, unknown>): Promise<void> {
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
        this.o.log(`baton: the orphaned claim ${claimId} was refused (${e.message})`);
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
      this.o.log(`baton: the course's leg needs could not be read (${msg(e)})`);
      return;
    }
    const short = [...new Set(needs)].filter((n) => !held.has(n));
    if (!short.length) return;
    this.o.log(`baton: this runner declared ${declared}, which lacks ${short.join(', ')} — a leg requiring it refuses rule 4 (missing-capability), so this runner can never claim one: declare what the machine holds (--capabilities) within what the owner granted`);
  }

  private loseLease(because: string): void {
    this.lostLease = true;
    this.state.set({ lease_lost: true, lease_lost_because: because });
    // R-BTN-19: the claims were taken away from this runner; the next heartbeat reports the
    // fences it cleared, so each ticket is re-issued instead of waiting for the runner to go
    // silent. B-188: the runner's lease is every claim's — each leg stops at once.
    const live = this.claims().live.filter((x) => x.claimId != null || x.heartbeatLeg);
    const ids = live.map((x) => x.heartbeatLeg?.claimId ?? x.claimId).filter((id): id is number => id != null);
    if (!ids.length && this.state.get().claim) ids.push(this.state.get().claim!.id);
    for (const id of ids) if (!this.fences.includes(id)) this.fences.push(id);
    for (const x of live) x.fence();
  }

  /** R-BTN-6 (B-188): Baton's answer no longer lists this claim — a force-reap, a deadline's
   *  release already taken — so this claim alone is fenced: its leg stops at once, no hand-off,
   *  and the next beat reports its fence. The runner's lease and its other claims run on. */
  private loseClaim(x: HeartbeatClaim): void {
    const id = x.heartbeatLeg?.claimId ?? x.claimId;
    this.o.log(`baton: Baton no longer lists claim ${id ?? '?'} on ${x.heartbeatLeg?.ticket ?? x.ticket} — its leg stops at once, no hand-off; this runner's other claims run on (R-BTN-6)`);
    if (id != null && !this.fences.includes(id)) this.fences.push(id);
    x.fence();
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
        else this.o.log(`baton: a spool line that is neither a transcript pointer nor an activity was dropped (${line.slice(0, 80)})`);
      } catch {
        this.o.log(`baton: a malformed spool line was dropped (${line.slice(0, 80)})`);
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
        this.o.log(`baton: an activity was refused (${refused.id ?? '?'}: ${refused.message ?? '?'})`);
      }
      return [];
    } catch (e) {
      this.o.log(`baton: the activities call failed (${msg(e)}) — kept for the next beat`);
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
        else this.o.log(`baton: retrying the end Baton never answered (${msg(e)})`);
      }
    }
  }
  async settleDeclaration(): Promise<boolean> {
    let beat = false;
    for (let n = 0; n < MAX_STALE_BEATS; n++) {
      const claimOn = this.declaringList();
      const stale = this.grantAsked || this.sent == null || JSON.stringify(this.sent) !== JSON.stringify(claimOn);
      if (!stale) break;
      await this.tick();
      beat = true;
      if (this.grantAsked) break;
    }
    return beat;
  }

  get declaredNothing(): boolean {
    return this.declared?.length === 0 && this.o.capabilities == null;
  }

  async declareLocks(needed: string[]): Promise<void> {
    const sendable = needed.filter((c) => (this.declared ?? this.o.capabilities ?? []).includes(c));
    for (let beats = 0; beats < 2 && sendable.some((c) => this.sent != null && !this.sent.includes(c)); beats++) await this.tick();
  }

}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
