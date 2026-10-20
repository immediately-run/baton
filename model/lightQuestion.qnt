// A light question (R-BTN-173): a `suspend` condition marked `light` whose handler lives in
// Baton's database alone, answered from a channel while the parent waits in its claim, or
// promoted to an ask file in git through the outbox (R-BTN-171) once the parent stops waiting.
//
// Standalone: it imports nothing from baton.qnt and is checked on its own (commands at the end
// of this comment). One parent ticket, one leg that asks QUESTIONS in order, each ask a fresh
// condition id; CHANNELS delivery legs per condition; one outbox writer; one sync.
//
// Actors and failures:
//   Baton    durable; each request one transaction (a Durable Object). R1 off splits the
//            channel report into a read and a later write.
//   parent   claims, asks, waits in its claim, consumes a settled answer, ends blocked when its
//            wait runs out (R-BTN-162), finishes; may die at any step, is then reaped (§9.5;
//            a live-but-hung holder is fenced first, R-BTN-19, so it writes nothing more).
//   delivery one claim per (condition, channel): sends, reads the reply, reports it; may die
//            holding a read reply, or lose the report's response and report again.
//   person   answers at any time on any channel the question reached, with any answer, and in
//            the ask file once it exists; may give different answers on two channels.
//   channel  HISTORY: a reply stays readable by condition id until Baton has accepted it; off,
//            reading consumes it (a fire-and-forget webhook).
//   outbox   a `baton.write` claim pushes an entry, then reports it; dying between the two, or a
//            refused push, leaves the entry queued and the next claim finds `baton_write: <id>`
//            in the file (R-BTN-171's idempotence), so both are the same as not yet reporting.
//   sync     closes a promoted condition when the ask file carries an answer.
//   clock    the parent's wait expiry races every report (`expire` is enabled while waiting).
//
// The rules under test, each a constant so that an instance can drop one (R-BTN-173):
//   R1 settle-or-promote in one transaction: a report settles only an `open` condition, in the
//      transaction that reads it; a report on anything else is never applied in the claim.
//   R2 a reap (or any end) of the claim waiting on an open light condition promotes it and
//      blocks the leg on it, in the reap's transaction.
//   R3 a reply reported after promotion is queued as an outbox `answer` entry into the ask
//      file (the first one only; later ones are recorded ignored).
//   R4 carry: every settled condition of the leg whose answer no end of a consuming claim has
//      recorded is handed to the next claim of the leg as `resume`.
//   R5 a delivery leg is retracted only after every reply on its channel has been reported.
//   R6 an outbox `answer` write never overwrites an answer already in the file; it is then
//      recorded ignored.
//   A1 (assumption, HISTORY) the channel keeps each reply readable by condition id until Baton
//      has accepted it (history, or redelivery until acknowledged).
//
// Properties: `safety` (every state) and `noLostAnswer` (once the run has drained: no failure
// and no new answer, every enabled step taken until none is — weak fairness, bounded).
//
// Run (from the repository root; `full` must pass, each `no*` instance must fail):
//   npx quint typecheck model/lightQuestion.qnt
//   npx quint run model/lightQuestion.qnt --main=full --invariant=allProps --max-samples=20000 --max-steps=80 --backend=typescript
//   npx quint run model/lightQuestion.qnt --main=noR3 --invariant=allProps --max-samples=20000 --max-steps=80 --backend=typescript
//   npx quint run model/lightQuestion.qnt --main=full --invariant=noDrainDone --max-samples=2000 --max-steps=80 --backend=typescript   (a witness: must fail)
//   npx quint verify model/lightQuestion.qnt --main=tiny --invariant=safety --max-steps=8
module lightQuestion {
  // ---- sizes and rules, set by the instance ----
  const QUESTIONS: Set[int]   // the leg's questions, asked in order
  const CONDS: Set[int]       // condition ids, 1..n: every raise takes the next
  const CHANNELS: Set[str]
  const ANSWERS: Set[str]
  const CRASHES: int          // failures in a run: deaths, lost responses
  const HISTORY: bool         // A1
  const R1: bool
  const R2: bool
  const R3: bool
  const R4: bool
  const R5: bool
  const R6: bool
  const DRAIN_ODDS: int       // a chaos step turns to drain with odds 1 in this

  type Reply = (int, str, str)                    // (condition, source: a channel or "file", answer)
  type Cond = { status: str,                      // none | open | settled | promoted | closed
                q: int, claim: int,
                ans: str, src: str, via: str,     // the settled answer; via "channel" | "git"
                settles: int, promotedEver: bool,
                used: bool }                      // an end of a claim that consumed it recorded it
  type Entry = { id: int, kind: str, c: int, src: str, v: str }   // kind handler | answer
  type State = {
    mode: str, drained: bool, crashes: int,
    conds: int -> Cond, nextCond: int,
    // the parent: Baton's claim and the runner's process
    claimActive: bool, claimId: int, alive: bool, phase: str,   // none | run | wait | done
    pCond: int, pKnown: int -> str, pConsumed: Set[int],
    blockedOn: int, lastEnd: str, lastBlocked: int, legDone: bool,
    consumed: int -> Set[str],                                  // ghost: every answer a leg run took, per condition
    // channels and delivery legs, by (condition, channel)
    sent: Set[(int, str)], retracted: Set[(int, str)],
    chReply: (int, str) -> str, held: (int, str) -> str,
    pending: Set[Reply],                                        // R1 off: read open, write later
    // the person (ghost) and Baton's records
    given: Set[Reply], accepted: Set[Reply], ignored: Set[Reply], applied: Set[Reply],
    // the outbox
    outbox: Set[Entry], outPushed: Set[int], outSkipped: Set[int], outDone: Set[int], nextOut: int,
    // git: the ask file per condition, and what the leg's ends wrote (evidence or hand-off)
    gFile: int -> bool, gAns: int -> str, gSrc: int -> str, gLeg: int -> str,
  }

  var st: State

  pure val NOCOND: Cond = { status: "none", q: 0, claim: 0, ans: "", src: "", via: "",
                            settles: 0, promotedEver: false, used: false }

  action init = st' = {
    mode: "chaos", drained: false, crashes: CRASHES,
    conds: CONDS.mapBy(c => NOCOND), nextCond: 1,
    claimActive: false, claimId: 0, alive: true, phase: "none",
    pCond: 0, pKnown: QUESTIONS.mapBy(q => ""), pConsumed: Set(),
    blockedOn: 0, lastEnd: "none", lastBlocked: 0, legDone: false,
    consumed: CONDS.mapBy(c => Set()),
    sent: Set(), retracted: Set(),
    chReply: tuples(CONDS, CHANNELS).mapBy(k => ""), held: tuples(CONDS, CHANNELS).mapBy(k => ""),
    pending: Set(),
    given: Set(), accepted: Set(), ignored: Set(), applied: Set(),
    outbox: Set(), outPushed: Set(), outSkipped: Set(), outDone: Set(), nextOut: 1,
    gFile: CONDS.mapBy(c => false), gAns: CONDS.mapBy(c => ""), gSrc: CONDS.mapBy(c => ""),
    gLeg: QUESTIONS.mapBy(q => ""),
  }

  // ---- helpers ----
  pure def setCond(s: State, c: int, cd: Cond): State = { ...s, conds: s.conds.set(c, cd) }
  def cond(c: int): Cond = st.conds.get(c)
  pure def isSettled(cd: Cond): bool = cd.status == "settled" or cd.status == "closed"

  // R-BTN-173 / R-BTN-171: promotion queues the ask file as an outbox `handler` entry
  pure def promote(s: State, c: int): State =
    val cd = s.conds.get(c)
    { ...setCond(s, c, { ...cd, status: "promoted", promotedEver: true }),
      outbox: s.outbox.union(Set({ id: s.nextOut, kind: "handler", c: c, src: "", v: "" })),
      nextOut: s.nextOut + 1 }

  // R-BTN-173: the channel's answer settles the open condition and rings the waiting parent
  pure def settleChannel(s: State, r: Reply): State =
    val cd = s.conds.get(r._1)
    { ...setCond(s, r._1, { ...cd, status: "settled", ans: r._3, src: r._2, via: "channel",
                             settles: cd.settles + 1 }),
      applied: s.applied.union(Set(r)) }

  pure def hasAnswerEntry(s: State, c: int): bool = s.outbox.exists(e => e.kind == "answer" and e.c == c)

  // R-BTN-173: Baton's handling of a delivery leg's report, in one transaction (R1)
  pure def handleReport(s: State, r: Reply): State =
    if (s.accepted.contains(r)) s   // a repeated report: ok, no second effect
    else
      val s1 = { ...s, accepted: s.accepted.union(Set(r)) }
      val cd = s1.conds.get(r._1)
      if (cd.status == "open") settleChannel(s1, r)
      else if (cd.status == "promoted" and R3 and not(hasAnswerEntry(s1, r._1)))
        { ...s1, outbox: s1.outbox.union(Set({ id: s1.nextOut, kind: "answer", c: r._1, src: r._2, v: r._3 })),
                 nextOut: s1.nextOut + 1 }
      else { ...s1, ignored: s1.ignored.union(Set(r)) }

  // an end of the parent's claim writes the answers its run consumed into git (evidence or
  // hand-off) and reports them; Baton marks them used (R-BTN-173, R-BTN-44)
  pure def recordConsumed(s: State): State =
    { ...s,
      conds: s.conds.keys().mapBy(c => if (s.pConsumed.contains(c)) { ...s.conds.get(c), used: true } else s.conds.get(c)),
      gLeg: s.gLeg.keys().mapBy(q => if (s.pKnown.get(q) != "") s.pKnown.get(q) else s.gLeg.get(q)) }

  pure def firstUnknown(known: int -> str): int =
    known.keys().filter(q => known.get(q) == "").fold(1000, (a, q) => if (q < a) q else a)

  // ---- the parent ----
  // the claim's `resume`: R4 carries every settled, unused condition; without it, only
  // R-BTN-162's resume after a blocked end on a condition that has since settled
  def resumeSet: Set[int] =
    if (R4) CONDS.filter(c => isSettled(cond(c)) and not(cond(c).used))
    else if (st.lastEnd == "blocked" and st.lastBlocked != 0 and isSettled(cond(st.lastBlocked))
             and not(cond(st.lastBlocked).used)) Set(st.lastBlocked)
    else Set()

  def canClaim = all {
    not(st.claimActive), not(st.legDone),
    st.blockedOn == 0 or isSettled(cond(st.blockedOn)),
  }
  action claim = all {
    canClaim,
    val rs = resumeSet
    val known = QUESTIONS.mapBy(q =>
      val hit = rs.filter(c => cond(c).q == q)
      if (hit.size() > 0) hit.fold("", (a, c) => cond(c).ans) else st.gLeg.get(q))
    st' = { ...st, claimActive: true, claimId: st.claimId + 1, alive: true, phase: "run",
            pCond: 0, pKnown: known, pConsumed: rs, blockedOn: 0,
            consumed: st.consumed.keys().mapBy(c => if (rs.contains(c)) st.consumed.get(c).union(Set(cond(c).ans)) else st.consumed.get(c)) },
  }

  def canAsk = all { st.claimActive, st.alive, st.phase == "run", firstUnknown(st.pKnown) != 1000,
                     CONDS.contains(st.nextCond) }
  action ask = all {
    canAsk,
    val c = st.nextCond
    st' = { ...setCond(st, c, { ...NOCOND, status: "open", q: firstUnknown(st.pKnown), claim: st.claimId }),
            nextCond: c + 1, phase: "wait", pCond: c },
  }

  // the heartbeat's `handled` reaches the waiting runner (R-BTN-162)
  def canConsume = all { st.claimActive, st.alive, st.phase == "wait", cond(st.pCond).status == "settled" }
  action consume = all {
    canConsume,
    val cd = cond(st.pCond)
    st' = { ...st, phase: "run", pKnown: st.pKnown.set(cd.q, cd.ans),
            pConsumed: st.pConsumed.union(Set(st.pCond)),
            consumed: st.consumed.set(st.pCond, st.consumed.get(st.pCond).union(Set(cd.ans))) },
  }

  // the wait runs out: the runner ends `released:blocked`; Baton promotes in the end's transaction
  def canExpire = all { st.claimActive, st.alive, st.phase == "wait" }
  action expire = all {
    canExpire,
    val s1 = recordConsumed(st)
    val c = st.pCond
    val s2 = if (cond(c).status == "open") { ...promote(s1, c), blockedOn: c } else s1
    st' = { ...s2, claimActive: false, phase: "none", lastEnd: "blocked", lastBlocked: c,
            pKnown: QUESTIONS.mapBy(q => ""), pConsumed: Set() },
  }

  def canFinish = all { st.claimActive, st.alive, st.phase == "run", firstUnknown(st.pKnown) == 1000 }
  action finish = all {
    canFinish,
    val s1 = recordConsumed(st)
    st' = { ...s1, claimActive: false, phase: "done", legDone: true, lastEnd: "done" },
  }

  action die = all { st.mode == "chaos", st.crashes > 0, st.claimActive, st.alive,
                     st' = { ...st, alive: false, crashes: st.crashes - 1 } }

  // §9.5: the silent holder is reaped; R2 promotes its open light condition and blocks the leg
  def canReap = all { st.claimActive, not(st.alive) }
  action reap = all {
    canReap,
    val open = CONDS.filter(c => cond(c).status == "open" and cond(c).claim == st.claimId)
    val s1 = if (R2) open.fold(st, (s, c) => { ...promote(s, c), blockedOn: c }) else st
    st' = { ...s1, claimActive: false, phase: "none", lastEnd: "reaped", alive: true,
            pKnown: QUESTIONS.mapBy(q => ""), pConsumed: Set() },
  }

  // ---- delivery legs and the channel ----
  def canSend(c: int, ch: str): bool =
    (cond(c).status == "open" or cond(c).status == "promoted") and not(st.sent.contains((c, ch)))
  action send(c: int, ch: str): bool = all { canSend(c, ch), st' = { ...st, sent: st.sent.union(Set((c, ch))) } }

  def canRead(c: int, ch: str): bool =
    val v = st.chReply.get((c, ch))
    all { v != "", st.held.get((c, ch)) == "", not(st.accepted.contains((c, ch, v))),
          not(st.pending.contains((c, ch, v))) }
  action read(c: int, ch: str): bool = all {
    canRead(c, ch),
    val v = st.chReply.get((c, ch))
    st' = { ...st, held: st.held.set((c, ch), v),
            chReply: if (HISTORY) st.chReply else st.chReply.set((c, ch), "") },
  }

  def canReport(c: int, ch: str): bool = st.held.get((c, ch)) != ""
  action report(c: int, ch: str): bool = all {
    canReport(c, ch),
    val r = (c, ch, st.held.get((c, ch)))
    val s1 = { ...st, held: st.held.set((c, ch), "") }
    st' = if (not(R1) and cond(c).status == "open") { ...s1, pending: s1.pending.union(Set(r)) }
          else handleReport(s1, r),
  }
  // R1 off: the write half of a report that read `open` earlier, applied without re-reading
  def canCommit(r: Reply): bool = st.pending.contains(r)
  action commit(r: Reply): bool = all {
    canCommit(r),
    val s1 = { ...st, pending: st.pending.exclude(Set(r)), accepted: st.accepted.union(Set(r)) }
    st' = settleChannel(s1, r),
  }
  // Baton applied the report but the response was lost: the runner still holds the reply
  action reportLost(c: int, ch: str): bool = all {
    st.mode == "chaos", st.crashes > 0, canReport(c, ch), R1,
    st' = { ...handleReport(st, (c, ch, st.held.get((c, ch)))), crashes: st.crashes - 1 },
  }
  // the delivery runner dies holding a reply it read; its claim is reaped and re-claimed
  action deliveryDies(c: int, ch: str): bool = all {
    st.mode == "chaos", st.crashes > 0, canReport(c, ch),
    st' = { ...st, held: st.held.set((c, ch), ""), crashes: st.crashes - 1 },
  }
  // the deliver child is superseded once the condition settles, and `retract` compensates
  def canRetract(c: int, ch: str): bool =
    val v = st.chReply.get((c, ch))
    all { st.sent.contains((c, ch)), not(st.retracted.contains((c, ch))), isSettled(cond(c)),
          st.held.get((c, ch)) == "",
          not(R5) or v == "" or st.accepted.contains((c, ch, v)) }
  action retract(c: int, ch: str): bool = all { canRetract(c, ch),
                                                 st' = { ...st, retracted: st.retracted.union(Set((c, ch))) } }

  // ---- the person ----
  action answerOnChannel(c: int, ch: str, v: str): bool = all {
    st.mode == "chaos", st.sent.contains((c, ch)), not(st.retracted.contains((c, ch))),
    not(ANSWERS.exists(w => st.given.contains((c, ch, w)))),
    st' = { ...st, chReply: st.chReply.set((c, ch), v), given: st.given.union(Set((c, ch, v))) },
  }
  action answerInFile(c: int, v: str): bool = all {
    st.mode == "chaos", st.gFile.get(c), st.gAns.get(c) == "",
    not(ANSWERS.exists(w => st.given.contains((c, "file", w)))),
    st' = { ...st, gAns: st.gAns.set(c, v), gSrc: st.gSrc.set(c, "file"),
            given: st.given.union(Set((c, "file", v))) },
  }

  // ---- the outbox (R-BTN-171) ----
  def canPush(e: Entry): bool = all {
    st.outbox.contains(e), not(st.outPushed.contains(e.id)),
    st.outbox.forall(f => (f.c == e.c and f.id < e.id) implies st.outPushed.contains(f.id)),
  }
  action push(e: Entry): bool = all {
    canPush(e),
    val s1 = { ...st, outPushed: st.outPushed.union(Set(e.id)) }
    st' = if (e.kind == "handler") { ...s1, gFile: s1.gFile.set(e.c, true) }
          else if (R6 and st.gAns.get(e.c) != "") { ...s1, outSkipped: s1.outSkipped.union(Set(e.id)) }
          else { ...s1, gAns: s1.gAns.set(e.c, e.v), gSrc: s1.gSrc.set(e.c, e.src) },
  }
  def canWritten(e: Entry): bool = st.outPushed.contains(e.id) and not(st.outDone.contains(e.id))
  action written(e: Entry): bool = all {
    canWritten(e),
    st' = { ...st, outDone: st.outDone.union(Set(e.id)),
            ignored: if (st.outSkipped.contains(e.id)) st.ignored.union(Set((e.c, e.src, e.v))) else st.ignored },
  }

  // ---- the sync: a promoted condition closes when its ask file carries an answer ----
  def canSync(c: int): bool = cond(c).status == "promoted" and st.gFile.get(c) and st.gAns.get(c) != ""
  action sync(c: int): bool = all {
    canSync(c),
    val cd = cond(c)
    val r = (c, st.gSrc.get(c), st.gAns.get(c))
    st' = { ...setCond(st, c, { ...cd, status: "closed", ans: r._3, src: r._2, via: "git", settles: cd.settles + 1 }),
            applied: st.applied.union(Set(r)) },
  }

  // ---- the run: chaos, then drain (no failure, no new answer) until nothing is enabled ----
  def entries: Set[Entry] = st.outbox
  def progressEnabled: bool = or {
    canClaim, canAsk, canConsume, canExpire, canFinish, canReap,
    tuples(CONDS, CHANNELS).exists(k => or { canSend(k._1, k._2), canRead(k._1, k._2),
                                             canReport(k._1, k._2), canRetract(k._1, k._2) }),
    st.pending.exists(r => canCommit(r)),
    entries.exists(e => canPush(e) or canWritten(e)),
    CONDS.exists(c => canSync(c)),
  }

  action step = {
    nondet c = CONDS.oneOf()
    nondet ch = CHANNELS.oneOf()
    nondet v = ANSWERS.oneOf()
    nondet coin = 1.to(DRAIN_ODDS).oneOf()
    any {
      claim, ask, consume, expire, finish, reap, die,
      send(c, ch), read(c, ch), report(c, ch), reportLost(c, ch), deliveryDies(c, ch), retract(c, ch),
      answerOnChannel(c, ch, v), answerInFile(c, v),
      sync(c),
      all { st.pending != Set(), nondet r = st.pending.oneOf() commit(r) },
      all { st.outbox != Set(), nondet e = st.outbox.oneOf() any { push(e), written(e) } },
      all { st.mode == "chaos", coin == 1, st' = { ...st, mode: "drain" } },
      all { st.mode == "drain", not(st.drained), not(progressEnabled), st' = { ...st, drained: true } },
    }
  }

  // ---- properties ----
  // no double effect: a condition settles at most once, in Baton or from git
  val settlesOnce = CONDS.forall(c => cond(c).settles <= 1)
  // the parent never consumes two different answers for one condition
  val oneAnswerConsumed = CONDS.forall(c => st.consumed.get(c).size() <= 1)
  // at most one answer of a condition is applied, and an applied answer is never also ignored
  val oneApplied = CONDS.forall(c => st.applied.filter(r => r._1 == c).size() <= 1)
                   and st.applied.intersect(st.ignored) == Set()
  // no orphan: the leg never asks a question again while an ask of it is still open
  val noOrphan = CONDS.forall(c1 => CONDS.forall(c2 =>
    (c1 != c2 and cond(c1).q == cond(c2).q
     and (cond(c1).status == "open" or cond(c1).status == "promoted"))
    implies not(cond(c2).status == "open" or cond(c2).status == "promoted")))
  // promotion is safe: once promoted, a condition settles only from git
  val promotionSafe = CONDS.forall(c => cond(c).promotedEver implies cond(c).via != "channel")
  // git agrees with Baton: a closed condition's file holds its answer; the leg's record holds
  // the answer of a used condition
  val gitAgrees = CONDS.forall(c => cond(c).status == "closed" implies st.gAns.get(c) == cond(c).ans)
                  and CONDS.forall(c => cond(c).used implies st.gLeg.get(cond(c).q) == cond(c).ans)
  val safety = settlesOnce and oneAnswerConsumed and oneApplied and noOrphan and promotionSafe and gitAgrees

  // no lost answer (under fairness): once drained, every answer the person gave is applied or
  // recorded ignored; one is ignored only beside an applied answer of the same condition; and
  // every settled condition reached a leg run whose end recorded it in git, unless the leg
  // waits on a later question nobody has answered
  val noLostAnswer = st.drained implies and {
    st.given.forall(r => st.applied.contains(r) or st.ignored.contains(r)),
    st.ignored.forall(r => st.applied.exists(a => a._1 == r._1)),
    CONDS.forall(c => isSettled(cond(c)) implies (cond(c).used or waitsForPerson)),
  }
  // the leg is blocked on a promoted question nobody has answered: what it already holds waits
  // with it (the next claim's resume), and the person is the one who must act
  val waitsForPerson = and {
    not(st.legDone), not(st.claimActive), st.blockedOn != 0, cond(st.blockedOn).status == "promoted",
    not(st.given.exists(r => r._1 == st.blockedOn)),
  }
  val allProps = safety and noLostAnswer

  // ---- witnesses: each must be violated (the state is reached) ----
  val noDrainDone = not(st.drained and st.given != Set())
  val noAnswerInClaim = not(st.legDone and CONDS.exists(c => cond(c).via == "channel" and cond(c).used))
  val noLateAnswerViaOutbox = not(CONDS.exists(c => cond(c).via == "git" and cond(c).src != "file" and cond(c).used))
  val noCarry = not(st.claimActive and st.lastEnd == "reaped" and st.pConsumed != Set())
  val noIgnoredSecond = not(st.ignored != Set() and st.legDone)
  val noTwoChannels = not(CONDS.exists(c => CHANNELS.forall(ch => st.given.exists(r => r._1 == c and r._2 == ch))
                                          and st.given.filter(r => r._1 == c).map(r => r._3).size() == 2 and st.drained))
}

// ---- instances: `full` holds every rule; each `no*` drops one and must fail ----
module full {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = true,
                       R1 = true, R2 = true, R3 = true, R4 = true, R5 = true, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module tiny {
  import lightQuestion(QUESTIONS = Set(1), CONDS = Set(1, 2), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 1, HISTORY = true,
                       R1 = true, R2 = true, R3 = true, R4 = true, R5 = true, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module noR1 {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = true,
                       R1 = false, R2 = true, R3 = true, R4 = true, R5 = true, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module noR2 {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = true,
                       R1 = true, R2 = false, R3 = true, R4 = true, R5 = true, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module noR3 {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = true,
                       R1 = true, R2 = true, R3 = false, R4 = true, R5 = true, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module noR4 {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = true,
                       R1 = true, R2 = true, R3 = true, R4 = false, R5 = true, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module noR5 {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = true,
                       R1 = true, R2 = true, R3 = true, R4 = true, R5 = false, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module noR6 {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = true,
                       R1 = true, R2 = true, R3 = true, R4 = true, R5 = true, R6 = false, DRAIN_ODDS = 25).* from "./lightQuestion"
}
module noHistory {
  import lightQuestion(QUESTIONS = Set(1, 2), CONDS = Set(1, 2, 3, 4), CHANNELS = Set("push", "chat"),
                       ANSWERS = Set("a", "b"), CRASHES = 3, HISTORY = false,
                       R1 = true, R2 = true, R3 = true, R4 = true, R5 = true, R6 = true, DRAIN_ODDS = 25).* from "./lightQuestion"
}
