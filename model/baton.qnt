// Baton's core as a state machine (R3-1243), written against BATON_SPEC in immediately-run/docs
// as merged at b7537395 (docs#212) and brought up to spec/BATON_SPEC.md by R3-1254. Every action
// and helper names the requirement it models.
//
// Modelled: claims and the lease (R-BTN-4); the course file's stations and legs (R-BTN-69);
// a claim as one transaction of Baton's own gates — no hook (R-BTN-98, which retired R-BTN-52's
// await and rule 12) — offering the ticket's queued leg alone (R-BTN-83, §7.2 rule 1); advance
// on the holder's word with per-leg max_runs counted from start_path (R-BTN-63), the first
// into the leg the claim was offered (`not-queued`); ends naming the station reached (R-BTN-71); git first
// (R-BTN-8); observation numbers and whole-post acceptance (R-BTN-62); confirmation by path
// extension (R-BTN-10, R-BTN-71); staleness only when the ticket is taken away and
// regressions flagged (R-BTN-35, §2e); holds (§8, rule 3); barred tags — posted, owner and
// holder bars (R-BTN-60, R-BTN-67, rule 8); required bars (R-BTN-67); reaping a dead worker
// and force-reaping a live one, with the fence (§6.6, R-BTN-19, R-BTN-26); any pusher writing
// git (R-BTN-66); the owner resolving a flagged completion (§6.7).
// Abstracted: wall-clock time (timeouts and the 30-minute and 6-hour flags are
// "eventually"), held histories (R-BTN-11), more than one repository (R-BTN-61), course
// changes and renames (R-BTN-64), tiers, grants and requires (rules 4-7). README.md says why.
module baton {
  // ---- sizes, set by the instance (instances.qnt; regressions.qnt) ----
  const TICKETS: Set[str]
  const WORKERS: Set[str]
  const SLOTS: Set[int]          // sync runs that may overlap (§7.1)
  const MAX_CLAIMS: int          // bounds the state space
  const GIT_BUDGET: int          // foreign pushes, regressions and withdrawals per run
  const OWNER_BUDGET: int        // holds, owner bars and force-reaps per run
  // Set by the instance too, so a scenario's trace replays with its own workers' tags and its
  // repository's required bar (R3-1244); the checked instances keep R3-1243's values.
  const FAMILIES: Set[str]       // the tags a required bar's prefix covers (R-BTN-67)
  const TAGS: str -> Set[str]    // each worker's tags (R-BTN-60)
  const REQUIRED: Set[str]       // the legs the required bar covers (R-BTN-67)
  const MAX_TIME: int            // ticks a run may last
  // R-BTN-122: a leg's retry policy in force — attempts before a hold, and the backoff after a
  // failed attempt in ticks (0: none, the instance that drives a core whose own policy is off);
  // R-BTN-126: the blocked ends a ticket and leg may spend before a hold
  const MAX_ATTEMPTS: int
  const BACKOFF: int
  const MAX_BLOCKED: int

  // ---- the course: roadmap-pr's course.json (BATON_SPEC §2e, R-BTN-69) ----
  pure val START = "filed"
  pure val START_LEG = "implement"   // the course's start_leg: a new ticket's queued leg (R-BTN-83)
  pure val ENDS = Set("merged")
  pure val LEGS = Set("implement", "review", "fix", "adjudicate", "merge")
  pure val FROM: str -> Set[str] = Map(
    "implement" -> Set("filed"),
    "review" -> Set("pr-open", "fixed"),
    "fix" -> Set("reviewed"),
    "adjudicate" -> Set("reviewed"),
    "merge" -> Set("reviewed", "adjudicated"))
  pure val TO: str -> str = Map(
    "implement" -> "pr-open", "review" -> "reviewed", "fix" -> "fixed",
    "adjudicate" -> "adjudicated", "merge" -> "merged")
  // max_runs; 99 stands for none, which R-BTN-69 allows only off every cycle
  pure val MAX_RUNS: str -> int = Map(
    "implement" -> 99, "review" -> 3, "fix" -> 2, "adjudicate" -> 99, "merge" -> 99)
  // R-BTN-69's acceptance, which the course above passes (courseIsAcceptedTest): exactly one
  // start (`START` is one station) and at least one end, an end terminal — no leg leaves it,
  // since a ticket there is done (R3-1254, owner) — `start_leg` leaving `start`, every station
  // reachable from `start`, an end reachable from every station, and every cycle holding a leg
  // with `max_runs`. Without it the properties could hold of a course core would refuse.
  pure def courseOk(start: str, startLeg: str, ends: Set[str], legs: Set[str], froms: str -> Set[str],
                    tos: str -> str, maxRuns: str -> int): bool = {
    val stations = legs.map(l => froms.get(l)).flatten().union(legs.map(l => tos.get(l))).union(Set(start)).union(ends)
    val n = stations.size()
    // the stations `seed` reaches through `via`'s legs, forwards or (back) backwards
    pure def closure(seed: Set[str], via: Set[str], back: bool): Set[str] =
      0.to(n).fold(seed, (r, _) => r.union(
        if (back) via.filter(l => r.contains(tos.get(l))).map(l => froms.get(l)).flatten()
        else via.filter(l => froms.get(l).intersect(r) != Set()).map(l => tos.get(l))))
    val unbounded = legs.filter(l => maxRuns.get(l) >= 99)
    and {
      ends != Set(),
      legs.forall(l => froms.get(l).intersect(ends) == Set()),
      legs.contains(startLeg) and froms.get(startLeg).contains(start),
      closure(Set(start), legs, false) == stations,
      closure(ends, legs, true) == stations,
      // no station is back on itself by unbounded legs alone
      stations.forall(s => not(closure(unbounded.filter(l => froms.get(l).contains(s)).map(l => tos.get(l)), unbounded, false).contains(s))),
    }
  }
  pure val courseWellFormed: bool = courseOk(START, START_LEG, ENDS, LEGS, FROM, TO, MAX_RUNS)

  // ---- prerequisites (R-BTN-120): what a ticket's source posts it waits for ----
  // A `depends_at` entry (§7.1): another ticket `at` one of `stations` now, having `reached` one,
  // or closed `done`; on one leg of this ticket, or every leg (""). The posted `blocked_by` is the
  // whole-ticket `done` entry. `select: posted` only: `children` and `parent` select the same
  // way over another relation, a column comparison (README).
  type Dep = { leg: str, other: str, mode: str, stations: Set[str] }
  // the entries a ticket's source may hold: every other ticket, `at` reviewed, having `reached`
  // pr-open, or `done`, on merge or on every leg — enough to tell the three modes apart
  pure def depChoices(t: str, tickets: Set[str]): Set[Dep] =
    tickets.exclude(Set(t)).map(o => Set(
      { leg: "", other: o, mode: "at", stations: Set("reviewed") },
      { leg: "", other: o, mode: "reached", stations: Set("pr-open") },
      { leg: "", other: o, mode: "done", stations: Set() },
      { leg: "merge", other: o, mode: "at", stations: Set("reviewed") },
      { leg: "merge", other: o, mode: "done", stations: Set() })).flatten()
  // R-BTN-126: a provisional row a `blocked` end writes, until the first accepted snapshot
  // containing the commit that wrote its prerequisite to git (`commit`, git's version then)
  type Prov = { ticket: str, leg: str, kind: str, commit: int, since: int }
  pure val PROV_TTL = 4          // R-BTN-126's hour, in ticks: a provisional row no snapshot confirms

  // ---- time (§6.3, R-BTN-6, R-BTN-26), in abstract ticks ----
  // A lease lasts TIMEOUT ticks from the last heartbeat. A worker's own fence check refuses to
  // act MARGIN ticks before its lease ends by ITS clock, which runs up to MAX_DRIFT ticks
  // behind Baton's — standing for how far the worker's last_ok lags Baton's renewal plus its
  // clock's rate skew, since R-BTN-6 measures now − last_ok on one clock and a constant offset
  // cancels (round 2, 2-A-5). The spec's margin is 4 minutes; the assumption it rests on — drift below
  // the margin — is MAX_DRIFT <= MARGIN here (Baton reaps at the lease end; the worker stops
  // strictly before end − MARGIN by its clock), and a mutation with MAX_DRIFT > MARGIN breaks
  // `noActAfterLoss`.
  pure val TIMEOUT = 4
  pure val MARGIN = 2
  pure val MAX_DRIFT = 1

  // ---- tags (R-BTN-60): course-defined strings core only compares; FAMILIES, TAGS and
  // REQUIRED are constants above. R3-1243's instances: families a and b, w1 and w3 of a, w2 of
  // b, and docs' required bar {course: 'roadmap-pr', leg: '*', except: [implement, review,
  // adjudicate], tag_prefix: 'family:'} (R-BTN-67), covering fix and merge.

  // ---- path helpers ----
  pure def stationOf(p: List[str]): str = p.foldl(START, (s, l) => TO.get(l))
  pure def runs(p: List[str], leg: str): int = p.select(x => x == leg).length()
  pure def isPrefix(p: List[str], q: List[str]): bool =
    p.length() <= q.length() and p.indices().forall(i => p[i] == q[i])
  pure def validPath(q: List[str]): bool =
    q.indices().forall(i => FROM.get(q[i]).contains(stationOf(q.slice(0, i))))
  // R-BTN-71: q extends p — begins with it and continues, if at all, by edges
  pure def extendsPath(p: List[str], q: List[str]): bool = isPrefix(p, q) and validPath(q)
  pure def legsFrom(st: str): Set[str] = LEGS.filter(l => FROM.get(l).contains(st))
  pure def atEnd(p: List[str]): bool = ENDS.contains(stationOf(p))
  // §2e: the legs a ticket may still run from where path p leaves it
  pure def nextLegs(p: List[str]): Set[str] =
    if (atEnd(p)) Set() else legsFrom(stationOf(p)).filter(l => runs(p, l) < MAX_RUNS.get(l))

  // ---- state ----
  type Claim = {
    id: int, ticket: str, worker: str,
    offered: str,        // R-BTN-83: the queued leg the claim was offered; its first advance must be it
    status: str,         // active | completed | released | reaped
    kind: str,           // "" | done | suspended | stale | release | fail | blocked | reap
    station: str,        // R-BTN-63: the last station it reached
    leg: str,            // the leg it is running; "" for none
    startBars: Set[str], // the running leg's family bars when it started: posted plus the holder's
    startPath: List[str],
    finished: List[str], // claim_legs it finished, in order
    claimObs: int,       // counter at the claim or its latest advance (R-BTN-62)
    endObs: int,
    regressed: bool,     // regressed_since IS NOT NULL (§2e)
    endedRegressed: bool,
    confirmed: bool,
    confirmObs: int,     // the observation that confirmed it; -1 for the owner
    fencePending: bool,  // R-BTN-19: reaped while its worker was alive
    leaseUntil: int,     // R-BTN-4: Baton reaps the claim at this tick unless a heartbeat renews it
    gateViolation: bool, // ghost: the claim or one of its advances was granted with a gate failing
  }
  type Sync = { phase: str, obs: int, git: str -> List[str], gone: str -> bool,
                bars: str -> Set[str], queued: str -> str, voided: bool,
                deps: str -> Set[Dep], decisions: str -> Set[str], version: int }
  type Bar = { tag: str, applies: str }   // owner bar (R-BTN-67): claim | claim+advance
  type State = {
    // git (the truth)
    gitPath: str -> List[str], withdrawn: str -> bool, gitBudget: int,
    gitDeps: str -> Set[Dep],        // each ticket's `depends_at` in its source (R-BTN-120)
    gitDecisions: str -> Set[str],   // open decisions: the leg each waits on, "" the whole ticket (R-BTN-78)
    gitVersion: int,                 // commits written to the ticket source, for containment (R-BTN-126)
    // Baton
    counter: int,                    // last observation number handed out
    lastAccepted: int,
    posted: str -> List[str],        // ticket_stations.path of the head snapshot
    postedGone: str -> bool,         // closed_tickets withdrawn
    postedBars: str -> Set[str],     // ticket_bars for the writing legs (REQUIRED)
    queued: str -> str,              // ticket_stations.next_leg: the queued leg ("" none) (R-BTN-83)
    postedDeps: str -> Set[Dep],     // the head snapshot's prerequisites (R-BTN-120)
    postedDecisions: str -> Set[str], // ... and its open decisions (ticket_decisions, R-BTN-78)
    attempts: str -> (str -> int),   // leg_attempts.attempts per ticket and leg (R-BTN-122)
    retryRows: str -> Set[str],      // the legs with a `retry` block row (R-BTN-122)
    retryAfter: str -> (str -> int), // leg_attempts.retry_after
    blockedEnds: str -> (str -> int), // blocked ends per ticket and leg (R-BTN-126's max_blocked)
    provs: Set[Prov],                // provisional rows (R-BTN-126)
    blocked: str -> bool,            // tickets.blocked_since IS NOT NULL (R-BTN-75)
    claims: int -> Claim, nextId: int,
    held: str -> bool,               // ticket_overrides.hold (§8)
    ownerBars: Set[Bar], ownerBudget: int,
    // workers
    up: str -> bool,                 // alive (a crash makes it false)
    pushed: str -> bool,             // evidence of the running leg pushed (R-BTN-8)
    asleep: str -> bool,             // a sleeping laptop: alive, silent, unable to act
    localClaim: str -> int,          // the claim the worker believes it holds (0: none)
    localLease: str -> int,          // the lease end the worker last heard (R-BTN-26)
    drift: str -> int,               // how far its clock runs behind Baton's (0..MAX_DRIFT)
    now: int,                        // Baton's clock
    // sync runs
    syncs: int -> Sync,
    // ghosts
    accepted: List[int], gitRegressedEver: str -> bool,
    actedAfterLoss: bool,            // a worker pushed for a claim Baton had reaped, unfenced
    lastEvent: str -> str,           // each ticket's last `blocked`/`unblocked` event (R-BTN-77)
    unpairedUnblock: bool,           // an `unblocked` logged with no `blocked` open before it
  }
  var st: State

  // ---- derived ----
  def claimsWhere(p: Claim => bool): Set[int] = st.claims.keys().filter(i => p(st.claims.get(i)))
  def activeOf(t: str): Set[int] = claimsWhere(c => c.ticket == t and c.status == "active")
  def workerClaim(w: str): Set[int] = claimsWhere(c => c.worker == w and c.status == "active")
  def fencedOf(t: str): Set[int] =
    claimsWhere(c => c.ticket == t and c.status == "reaped" and c.fencePending)
  def workerFenced(w: str): bool =
    claimsWhere(c => c.worker == w and c.status == "reaped" and c.fencePending).size() > 0
  def unconfirmedOf(t: str): Set[int] =
    claimsWhere(c => c.ticket == t and c.status == "completed" and not(c.confirmed))
  def maxEndObs(t: str): int =
    claimsWhere(c => c.ticket == t and c.status != "active")
      .fold(-1, (m, i) => if (st.claims.get(i).endObs > m) st.claims.get(i).endObs else m)
  pure def expected(c: Claim): List[str] = c.startPath.concat(c.finished)
  def theClaim(w: str): Claim = st.claims.get(workerClaim(w).fold(0, (a, i) => i))

  // R-BTN-60, R-BTN-67, rule 8: the tags barred from `leg` of `t` at a claim or an advance
  def postedBarsOf(t: str, leg: str): Set[str] =
    if (REQUIRED.contains(leg)) st.postedBars.get(t) else Set()
  def ownerBarTags(phase: str): Set[str] =
    st.ownerBars.filter(b => phase == "claim" or b.applies == "claim+advance").map(b => b.tag)
  def barred(t: str, leg: str, phase: str, holderBars: Set[str]): Set[str] =
    postedBarsOf(t, leg).union(ownerBarTags(phase)).union(holderBars)
  // R-BTN-67: a covered leg whose bars hold no family tag is waiting on `policy`
  def policyOk(t: str, leg: str, holderBars: Set[str]): bool =
    not(REQUIRED.contains(leg)) or postedBarsOf(t, leg).union(holderBars).intersect(FAMILIES).size() > 0
  // §2e, R-BTN-70: the ready legs leaving the posted station
  def readyLegs(t: str): Set[str] = nextLegs(st.posted.get(t)).filter(l => policyOk(t, l, Set()))
  // R-BTN-83, §7.2 rule 1: a claim is offered the ticket's queued leg alone, when it is ready
  def queuedReady(t: str): bool = st.queued.get(t) != "" and readyLegs(t).contains(st.queued.get(t))

  // ---- blocks (R-BTN-75), read from a state so a transaction can settle the one it makes ----
  // the stations a path has been at (R-BTN-120's `reached`)
  pure def stationsOn(p: List[str]): Set[str] = p.indices().map(i => TO.get(p[i])).union(Set(START))
  // R-BTN-120: a `depends_at` entry is met from the stations and paths Baton stores; a withdrawn
  // ticket meets none
  pure def depMetIn(s: State, d: Dep): bool = and {
    not(s.postedGone.get(d.other)),
    if (d.mode == "at") d.stations.contains(stationOf(s.posted.get(d.other)))
    else if (d.mode == "reached") d.stations.intersect(stationsOn(s.posted.get(d.other))).size() > 0
    else atEnd(s.posted.get(d.other)),
  }
  pure def onLeg(x: str, l: str): bool = x == "" or x == l
  // the confirmed rows on leg l of t, whole-ticket rows included: an unmet prerequisite, an open
  // decision (R-BTN-78), a backoff (R-BTN-122)
  pure def confirmedRowsIn(s: State, t: str, l: str): bool = or {
    s.postedDeps.get(t).exists(d => onLeg(d.leg, l) and not(depMetIn(s, d))),
    s.postedDecisions.get(t).exists(x => onLeg(x, l)),
    s.retryRows.get(t).contains(l),
  }
  // R-BTN-126: a provisional row refuses a claim or advance into its leg, but is not a block
  pure def provisionalIn(s: State, t: str, l: str): bool = s.provs.exists(p => p.ticket == t and p.leg == l)
  // R-BTN-75's held: an active claim, a completion not yet confirmed, a fence-pending reap
  pure def heldIn(s: State, t: str): bool = s.claims.keys().exists(i => {
    val c = s.claims.get(i)
    c.ticket == t and (c.status == "active" or (c.status == "completed" and not(c.confirmed))
                       or (c.status == "reaped" and c.fencePending))
  })
  // R-BTN-75: blocked when not held, with a queued leg, and a confirmed row on it or the ticket
  pure def blockedIn(s: State, t: str): bool = and {
    not(heldIn(s, t)), not(s.postedGone.get(t)), s.queued.get(t) != "",
    confirmedRowsIn(s, t, s.queued.get(t)),
  }
  // R-BTN-75, R-BTN-77: the transaction that changes a ticket's rows, queued leg or held state
  // sets blocked_since; a claim starting (`silent`) does so without an event, every other cause
  // logs `blocked` or `unblocked` — an end that leaves the ticket blocked logs `blocked` (R-BTN-75
  // as amended by R3-1254: the model found an end blocking silently and the backoff's `unblocked`
  // following with no `blocked` before it)
  pure def settle(s: State, silent: Set[str]): State =
    TICKETS.fold(s, (a, t) => {
      val b = blockedIn(a, t)
      if (b == a.blocked.get(t)) a
      else if (silent.contains(t)) a.with("blocked", a.blocked.set(t, b))
      else a.with("blocked", a.blocked.set(t, b))
             .with("unpairedUnblock", a.unpairedUnblock or (not(b) and a.lastEvent.get(t) != "blocked"))
             .with("lastEvent", a.lastEvent.set(t, if (b) "blocked" else "unblocked"))
    })
  // the leg a claim is on: the one it runs, else the one it was offered
  pure def legOf(c: Claim): str = if (c.leg != "") c.leg else c.offered
  // R-BTN-122: a failed attempt on leg l of t — counted per ticket and leg; a backoff row until
  // now + BACKOFF; at MAX_ATTEMPTS a hold instead (attempts-exhausted)
  pure def failIn(s: State, t: str, l: str): State = {
    val n = s.attempts.get(t).get(l) + 1
    s.with("attempts", s.attempts.set(t, s.attempts.get(t).set(l, n)))
     .with("held", if (n >= MAX_ATTEMPTS) s.held.set(t, true) else s.held)
     .with("retryAfter", s.retryAfter.set(t, s.retryAfter.get(t).set(l, s.now + BACKOFF)))
     .with("retryRows", if (BACKOFF > 0 and n < MAX_ATTEMPTS) s.retryRows.set(t, s.retryRows.get(t).union(Set(l)))
                        else s.retryRows)
  }
  // a ticket's leg l refuses a claim or advance into it (rule 1, R-BTN-122's backing-off)
  def gated(t: str, l: str): bool = confirmedRowsIn(st, t, l) or provisionalIn(st, t, l)

  // §7.2 rules 1, 3, 10 and §6.7: the gates of a ticket, whoever asks
  def ticketClaimable(t: str): bool = and {
    not(st.postedGone.get(t)), not(st.held.get(t)),
    queuedReady(t), not(gated(t, st.queued.get(t))),
    activeOf(t).size() == 0, fencedOf(t).size() == 0, unconfirmedOf(t).size() == 0,
    st.lastAccepted > maxEndObs(t),
  }
  // ... and rule 8 for this worker, on the queued leg (R-BTN-83)
  def claimableBy(t: str, w: str): bool =
    ticketClaimable(t) and barred(t, st.queued.get(t), "claim", Set()).intersect(TAGS.get(w)).size() == 0
  def workerFree(w: str): bool =
    st.up.get(w) and not(st.asleep.get(w)) and workerClaim(w).size() == 0 and not(workerFenced(w))
      and st.localClaim.get(w) == 0
  // R-BTN-6, R-BTN-26: a worker acts only while its lease, by its own clock, is more than
  // MARGIN from its end
  def workerCanAct(w: str): bool =
    st.up.get(w) and not(st.asleep.get(w)) and st.localClaim.get(w) != 0
      and st.now - st.drift.get(w) < st.localLease.get(w) - MARGIN
  // §7.1, R-BTN-62 as amended 2026-10-15: one reading in flight per repository
  def outstanding(s: int): bool =
    (st.syncs.get(s).phase == "numbered" or st.syncs.get(s).phase == "read") and not(st.syncs.get(s).voided)

  // ---- init ----
  // @impl external — an empty Baton, migrated (src/core/baton.ts#start)
  action init = {
    nondet d = WORKERS.setOfMaps(0.to(MAX_DRIFT)).oneOf()
    initWith(d)
  }
  // @impl external — an empty Baton, migrated, with each worker's clock drift
  action initWith(d: str -> int): bool = all {
    st' = {
      gitPath: TICKETS.mapBy(t => List()), withdrawn: TICKETS.mapBy(t => false),
      gitBudget: GIT_BUDGET,
      gitDeps: TICKETS.mapBy(t => Set()), gitDecisions: TICKETS.mapBy(t => Set()), gitVersion: 0,
      counter: 0, lastAccepted: 0,
      posted: TICKETS.mapBy(t => List()), postedGone: TICKETS.mapBy(t => false),
      postedBars: TICKETS.mapBy(t => Set()), queued: TICKETS.mapBy(t => START_LEG),
      postedDeps: TICKETS.mapBy(t => Set()), postedDecisions: TICKETS.mapBy(t => Set()),
      attempts: TICKETS.mapBy(t => LEGS.mapBy(l => 0)), retryRows: TICKETS.mapBy(t => Set()),
      retryAfter: TICKETS.mapBy(t => LEGS.mapBy(l => 0)), blockedEnds: TICKETS.mapBy(t => LEGS.mapBy(l => 0)),
      provs: Set(), blocked: TICKETS.mapBy(t => false),
      claims: Map(), nextId: 1,
      held: TICKETS.mapBy(t => false), ownerBars: Set(), ownerBudget: OWNER_BUDGET,
      up: WORKERS.mapBy(w => true), pushed: WORKERS.mapBy(w => false),
      asleep: WORKERS.mapBy(w => false), localClaim: WORKERS.mapBy(w => 0),
      localLease: WORKERS.mapBy(w => 0), drift: d, now: 0,
      syncs: SLOTS.mapBy(s => { phase: "idle", obs: 0, git: TICKETS.mapBy(t => List()),
                                gone: TICKETS.mapBy(t => false), bars: TICKETS.mapBy(t => Set()),
                                queued: TICKETS.mapBy(t => ""), voided: false,
                                deps: TICKETS.mapBy(t => Set()), decisions: TICKETS.mapBy(t => Set()), version: 0 }),
      accepted: List(), gitRegressedEver: TICKETS.mapBy(t => false),
      actedAfterLoss: false,
      lastEvent: TICKETS.mapBy(t => ""), unpairedUnblock: false,
    }
  }

  // ---- claims: one transaction of Baton's own gates (R-BTN-98, §7.2) ----
  // R-BTN-98 retired the course's claim hook (R-BTN-52's await, rule 12): a claim computes its
  // candidate and checks every gate in one transaction. It is offered the ticket's queued leg
  // (R-BTN-83), and rule 8 is judged on that leg.
  // @impl src/core/claims.ts#claim
  // @impl pending — the per-leg `at`/`reached` prerequisites (R-BTN-120, B-10), the per-leg backoff (R-BTN-122, B-11) and provisional rows (R-BTN-126, B-21) as gates
  action claim(w: str, t: str): bool = all {
    workerFree(w), st.nextId <= MAX_CLAIMS, claimableBy(t, w),
    // ghost, written apart from the guard: the gates as they stand at the grant
    val leg = st.queued.get(t)
    val violated = not(ticketClaimable(t)) or barred(t, leg, "claim", Set()).intersect(TAGS.get(w)).size() > 0
                   or confirmedRowsIn(st, t, leg) or provisionalIn(st, t, leg)
    // a claimed ticket is not waiting: blocked_since clears silently (R-BTN-75)
    st' = settle(st.with("claims", st.claims.put(st.nextId, {
              id: st.nextId, ticket: t, worker: w, offered: leg, status: "active", kind: "",
              station: stationOf(st.posted.get(t)), leg: "", startBars: Set(),
              startPath: st.posted.get(t), finished: List(),
              claimObs: st.counter, endObs: -1, regressed: false, endedRegressed: false,
              confirmed: false, confirmObs: -1, fencePending: false,
              leaseUntil: st.now + TIMEOUT, gateViolation: violated }))
            .with("nextId", st.nextId + 1)
            .with("localClaim", st.localClaim.set(w, st.nextId))
            .with("localLease", st.localLease.set(w, st.now + TIMEOUT))
            .with("pushed", st.pushed.set(w, false)), Set(t)),
  }

  // R-BTN-8: the holder pushes the running leg's evidence. It lands only if the leg leaves
  // the station git is at (else git rejects it), or not at all (lost) — what confirmation
  // guards (R-BTN-10).
  // The push is git's, not Baton's: the worker acts on the claim IT believes it holds, so a
  // worker whose lease Baton has reaped can still push — unless its own fence check stops it
  // (R-BTN-26). `actedAfterLoss` records a push for a claim Baton reaped without a fence.
  // @impl external — the holder pushes to git (R-BTN-8)
  action pushEvidence(w: str, lands: bool): bool = all {
    workerCanAct(w), not(st.pushed.get(w)),
    val c = st.claims.get(st.localClaim.get(w))
    val g = st.gitPath.get(c.ticket)
    all {
      c.leg != "",
      st' = st.with("gitPath", if (lands and FROM.get(c.leg).contains(stationOf(g)))
                                 st.gitPath.set(c.ticket, g.append(c.leg)) else st.gitPath)
              .with("pushed", st.pushed.set(w, true))
              .with("actedAfterLoss", st.actedAfterLoss or (c.status != "active" and not(c.fencePending))),
    },
  }

  // R-BTN-63: finish the running leg (the claim moves to its `to`) and start `leg` when it
  // leaves that station, its runs — start_path plus claim_legs — are under max_runs, and the
  // gates that bind a holder hold (§7.2): the hold check of rule 3, rule 8 with claim+advance
  // owner bars and the holder's own `bars`, and the required bar over posted plus holder bars.
  // The first advance is into the leg the claim was offered (R-BTN-83: `not-queued`). No leg
  // state is checked: the holder's word.
  // @impl src/core/claims.ts#advance
  // @impl pending — prerequisite, backoff and provisional rows as advance gates (R-BTN-120, B-10; R-BTN-122, B-11; R-BTN-126, B-21)
  action advance(w: str, leg: str, bars: Set[str]): bool = all {
    workerCanAct(w), workerClaim(w).size() == 1,
    val c = theClaim(w)
    val fin = if (c.leg == "") c.finished else c.finished.append(c.leg)
    val stn = if (c.leg == "") c.station else TO.get(c.leg)
    val gatesOk = and {
      not(st.held.get(c.ticket)),
      barred(c.ticket, leg, "advance", bars).intersect(TAGS.get(w)).size() == 0,
      policyOk(c.ticket, leg, bars),
      not(gated(c.ticket, leg)),                              // rule 1, backing-off (R-BTN-78, -122, -126)
    }
    all {
      c.leg == "" or st.pushed.get(w),                        // git first
      c.leg != "" or c.finished.length() > 0 or leg == c.offered, // not-queued (R-BTN-83)
      FROM.get(leg).contains(stn),                            // an edge (R-BTN-69)
      runs(c.startPath.concat(fin), leg) < MAX_RUNS.get(leg), // max-runs
      gatesOk,
      // ghost, written apart from the guard
      val violated = st.held.get(c.ticket) or not(policyOk(c.ticket, leg, bars))
                     or (c.leg == "" and c.finished.length() == 0 and leg != c.offered)
                     or confirmedRowsIn(st, c.ticket, leg) or provisionalIn(st, c.ticket, leg)
                     or TAGS.get(w).exists(g => barred(c.ticket, leg, "advance", bars).contains(g))
      st' = st.with("claims", st.claims.set(c.id, c.with("station", stn).with("finished", fin)
                .with("leg", leg).with("startBars", postedBarsOf(c.ticket, leg).union(bars))
                .with("claimObs", st.counter).with("gateViolation", c.gateViolation or violated)))
              .with("pushed", st.pushed.set(w, false)),
    },
  }

  // R-BTN-71, §6.5: an end names the station really reached — the running leg's `to` when
  // its evidence was pushed and `reached`, else its `from`. kind: done, suspended, release, or
  // fail — `released:cannot-finish:transient`, a failed attempt on the claim's leg (R-BTN-122).
  // A `done` may come from any station: the runner also ends done when git shows the ticket
  // closed, the leg having archived it (§11, R-BTN-72), which Baton cannot see at the end — it
  // confirms a done only by an end station or a closure (R-BTN-10, G-BTN-44). (R3-1244: the
  // scenario traces found the model narrower than the spec here; it required an end station.)
  // @impl src/core/claims.ts#end
  // @impl pending — attempts and backoff per leg (R-BTN-122, B-11); `blocked` logged when an end leaves the ticket blocked (R-BTN-75 as amended by R3-1254, B-26)
  action endClaim(w: str, kind: str, reached: bool): bool = all {
    workerCanAct(w), workerClaim(w).size() == 1,
    val c = theClaim(w)
    val reach = reached and c.leg != "" and st.pushed.get(w)
    val fin = if (reach) c.finished.append(c.leg) else c.finished
    val stn = if (reach) TO.get(c.leg) else c.station
    val done = kind == "done"
    // R-BTN-10: a done end is also confirmed by a closure an earlier snapshot recorded,
    // when that snapshot's observation is greater than the claim's own
    val closedEarly = done and atEnd(st.posted.get(c.ticket)) and st.lastAccepted > c.claimObs
    val ended = st.with("claims", st.claims.set(c.id, c.with("station", stn).with("finished", fin)
                .with("leg", "")
                .with("status", if (kind == "release" or kind == "fail") "released" else "completed")
                .with("kind", kind).with("endObs", st.counter).with("endedRegressed", c.regressed)
                .with("regressed", false)                     // §4: regressed_since clears at the end
                .with("confirmed", closedEarly)
                .with("confirmObs", if (closedEarly) st.lastAccepted else -1)))
              .with("localClaim", st.localClaim.set(w, 0))
              .with("pushed", st.pushed.set(w, false))
    all {
      // an end that leaves the ticket blocked logs `blocked` (R-BTN-75 as amended by R3-1254)
      st' = settle(if (kind == "fail") failIn(ended, c.ticket, legOf(c)) else ended, Set()),
    },
  }

  // R-BTN-126: a prerequisite failed during the leg — another ticket's (`ticket`, entry `d` on
  // the claim's leg) or a person's answer (`decision`). The ticket rests at the leg's `from`; the
  // leg first writes the prerequisite to the ticket's source in git (R-BTN-126: the end carries
  // that commit), and the end writes a provisional row on the leg, which refuses a claim or
  // advance into it but is no block. Not a failed attempt, not a run, no backoff: counted, and
  // past MAX_BLOCKED the end holds the ticket (`blocked-exhausted`). (`resource` and
  // `capability` blocked ends are R3-1254's next part.)
  // @impl pending — `released:blocked` for ticket and decision prerequisites (R-BTN-126, B-21)
  action endBlocked(w: str, kind: str, d: Dep): bool = all {
    workerCanAct(w), workerClaim(w).size() == 1, not(st.pushed.get(w)),
    val c = theClaim(w)
    val l = legOf(c)
    val v = st.gitVersion + 1
    val n = st.blockedEnds.get(c.ticket).get(l) + 1
    all {
      kind == "ticket" or kind == "decision",
      kind != "ticket" or d.other != c.ticket,
      st' = settle(st.with("claims", st.claims.set(c.id, c.with("leg", "").with("status", "released")
                .with("kind", "blocked").with("endObs", st.counter).with("endedRegressed", c.regressed)
                .with("regressed", false)))
              .with("gitDeps", if (kind == "ticket") st.gitDeps.set(c.ticket, st.gitDeps.get(c.ticket).union(Set(d.with("leg", l))))
                               else st.gitDeps)
              .with("gitDecisions", if (kind == "decision") st.gitDecisions.set(c.ticket, st.gitDecisions.get(c.ticket).union(Set(l)))
                                    else st.gitDecisions)
              .with("gitVersion", v)
              .with("provs", st.provs.union(Set({ ticket: c.ticket, leg: l, kind: kind, commit: v, since: st.now })))
              .with("blockedEnds", st.blockedEnds.set(c.ticket, st.blockedEnds.get(c.ticket).set(l, n)))
              .with("held", if (n > MAX_BLOCKED) st.held.set(c.ticket, true) else st.held)
              .with("localClaim", st.localClaim.set(w, 0)).with("pushed", st.pushed.set(w, false)),
            Set()),
    },
  }

  // ---- workers dying, and the lease (§6.3, §6.6) ----
  // @impl external — a worker's machine
  action crash(w: str): bool = all {
    st.up.get(w),
    st' = st.with("up", st.up.set(w, false)),
  }
  // @impl external — a worker's machine
  action sleep(w: str): bool = all {
    st.up.get(w), not(st.asleep.get(w)),
    st' = st.with("asleep", st.asleep.set(w, true)),
  }
  // @impl external — a worker's machine
  action wake(w: str): bool = all {
    st.asleep.get(w),
    st' = st.with("asleep", st.asleep.set(w, false)),
  }
  // @impl external — time
  action tick: bool = all {
    st.now < MAX_TIME,
    st' = st.with("now", st.now + 1),
  }
  // §6.3: the sidecar's heartbeat renews the lease, and tells the worker what it holds.
  // @impl src/core/workerApi.ts#heartbeat
  // @impl src/core/claims.ts#fenced
  action heartbeat(w: str): bool = all {
    st.up.get(w), not(st.asleep.get(w)),
    if (workerClaim(w).size() == 1) {
      val c = theClaim(w)
      st' = st.with("claims", st.claims.set(c.id, c.with("leaseUntil", st.now + TIMEOUT)))
              .with("localClaim", st.localClaim.set(w, c.id))
              .with("localLease", st.localLease.set(w, st.now + TIMEOUT))
    } else {
      // no active claim: a fenced worker keeps its local claim until it clears the fence, and
      // its heartbeat keeps the fence alive — R-BTN-19's timeout runs from its last heartbeat
      st' = st.with("localClaim", if (workerFenced(w)) st.localClaim else st.localClaim.set(w, 0))
              .with("claims", st.claims.keys().mapBy(i => {
                 val c = st.claims.get(i)
                 if (c.worker == w and c.fencePending) c.with("leaseUntil", st.now + TIMEOUT) else c }))
    },
  }
  // R-BTN-4, §6.6: the alarm reaps a claim whose lease ran out — its worker dead or silent; a
  // failed attempt on the claim's leg (§6.10, R-BTN-122), and an end (R-BTN-75).
  // @impl src/core/claims.ts#alarm
  // @impl pending — the attempt counted per leg (R-BTN-122, B-11); `blocked` logged when the reap leaves the ticket blocked (R-BTN-75 as amended by R3-1254, B-26)
  action alarmReap(i: int): bool = all {
    st.claims.keys().contains(i),
    val c = st.claims.get(i)
    all {
      c.status == "active", c.leaseUntil <= st.now,
      // the leg stays recorded: the worker, which does not know yet, may still try to push it
      st' = settle(failIn(st.with("claims", st.claims.set(i, c.with("status", "reaped").with("kind", "reap")
                  .with("endObs", st.counter).with("endedRegressed", c.regressed).with("regressed", false))),
                 c.ticket, legOf(c)), Set()),
    },
  }
  // A dead worker restarts once the alarm has reaped its claim and any fence of its own has
  // timed out (below).
  // @impl external — a worker restarting
  action reapDead(w: str): bool = all {
    not(st.up.get(w)), workerClaim(w).size() == 0, not(workerFenced(w)),
    st' = st.with("up", st.up.set(w, true)).with("asleep", st.asleep.set(w, false))
            .with("localClaim", st.localClaim.set(w, 0)).with("pushed", st.pushed.set(w, false)),
  }
  // R-BTN-19: the owner force-reaps a live worker's claim; the ticket is not re-issued until
  // the worker reports `fence-cleared` (or dies and times out, above). Not a failed attempt
  // (§6.10); fenced, the ticket stays held (R-BTN-75).
  // @impl src/core/claims.ts#forceReap
  action forceReap(w: str): bool = all {
    st.ownerBudget > 0, st.up.get(w), workerClaim(w).size() == 1,
    val c = theClaim(w)
    st' = st.with("claims", st.claims.set(c.id, c.with("status", "reaped").with("kind", "reap")
                .with("endObs", st.counter).with("endedRegressed", c.regressed).with("regressed", false)
                .with("fencePending", true)))
            .with("ownerBudget", st.ownerBudget - 1).with("pushed", st.pushed.set(w, false)),
  }
  // R-BTN-19: a fence also clears when its worker has been silent past its own timeout — dead
  // or asleep — measured by time, never by knowing it is dead (baton#10 round 2, 2-A-0). The
  // worker is not told; if it wakes, its own fence check (R-BTN-26) must stop it.
  // @impl src/core/claims.ts#alarm
  action fenceTimeout(i: int): bool = all {
    st.claims.keys().contains(i),
    val c = st.claims.get(i)
    all {
      c.status == "reaped", c.fencePending, c.leaseUntil <= st.now,
      // no longer held: blocked_since follows, with its event (R-BTN-75)
      st' = settle(st.with("claims", st.claims.set(i, c.with("fencePending", false))), Set()),
    },
  }
  // R-BTN-6, R-BTN-26: the worker learns its lease is lost, kills its tool calls and reports.
  // @impl src/core/claims.ts#fenced
  action fenceCleared(w: str): bool = all {
    st.up.get(w), not(st.asleep.get(w)), workerFenced(w),
    st' = settle(st.with("claims", st.claims.keys().mapBy(i => {
              val c = st.claims.get(i)
              if (c.worker == w and c.fencePending) c.with("fencePending", false) else c }))
            .with("localClaim", st.localClaim.set(w, 0)), Set()),
  }

  // ---- the owner (§8, R-BTN-67, §6.7) ----
  // A hold, or its lift — which resets the ticket's attempts and blocked ends (R-BTN-122,
  // R-BTN-126). A hold is no block: it is listed under `other` (R-BTN-75).
  // @impl src/core/claims.ts#setOverride
  // @impl pending — the lift resets per-leg counts (R-BTN-122, B-11) and blocked ends (R-BTN-126, B-21)
  action setHold(t: str, h: bool): bool = all {
    st.ownerBudget > 0, st.held.get(t) != h,
    st' = st.with("held", st.held.set(t, h)).with("ownerBudget", st.ownerBudget - 1)
            .with("attempts", if (h) st.attempts else st.attempts.set(t, LEGS.mapBy(l => 0)))
            .with("blockedEnds", if (h) st.blockedEnds else st.blockedEnds.set(t, LEGS.mapBy(l => 0))),
  }
  // @impl src/core/admin.ts#setBar
  action setOwnerBar(tag: str, applies: str): bool = all {
    st.ownerBudget > 0,
    st' = st.with("ownerBars", st.ownerBars.union(Set({ tag: tag, applies: applies })))
            .with("ownerBudget", st.ownerBudget - 1),
  }
  // @impl src/core/admin.ts#liftBar
  action liftOwnerBars: bool = all {
    st.ownerBars.size() > 0,
    st' = st.with("ownerBars", Set()),
  }
  // §6.7: an unconfirmed completion is flagged; the owner confirms it.
  // @impl src/core/claims.ts#resolve
  action ownerResolve(i: int): bool = all {
    st.claims.keys().contains(i),
    st.claims.get(i).status == "completed", not(st.claims.get(i).confirmed),
    // no longer held: blocked_since follows, with its event (R-BTN-75)
    st' = settle(st.with("claims", st.claims.set(i, st.claims.get(i).with("confirmed", true)
                                                              .with("confirmObs", -1))), Set()),
  }

  // R-BTN-122: the alarm clears a backoff's row at its retry_after; its `unblocked` follows.
  // @impl pending — the per-leg backoff row and its alarm (R-BTN-122, B-11; core keeps §6.10's per-ticket backoff)
  action retryElapse(t: str, l: str): bool = all {
    st.retryRows.get(t).contains(l), st.retryAfter.get(t).get(l) <= st.now,
    st' = settle(st.with("retryRows", st.retryRows.set(t, st.retryRows.get(t).exclude(Set(l)))), Set()),
  }
  // R-BTN-126: a provisional row no accepted snapshot containing its commit replaced within the
  // hour is dropped (`prerequisite-unconfirmed`). It was no block, so nothing is logged.
  // @impl pending — the provisional row's hour (R-BTN-126, B-21)
  action provisionalLapses(t: str, l: str): bool = all {
    st.provs.exists(p => p.ticket == t and p.leg == l and p.since + PROV_TTL <= st.now),
    st' = st.with("provs", st.provs.filter(p => not(p.ticket == t and p.leg == l and p.since + PROV_TTL <= st.now))),
  }

  // ---- git: any pusher writes anything (R-BTN-66) ----
  // @impl external — git: any pusher (R-BTN-66)
  action foreignPush(t: str, leg: str): bool = all {
    st.gitBudget > 0, FROM.get(leg).contains(stationOf(st.gitPath.get(t))),
    st' = st.with("gitPath", st.gitPath.set(t, st.gitPath.get(t).append(leg)))
            .with("gitBudget", st.gitBudget - 1),
  }
  // a PR closed, a branch deleted, a review dismissed: the path loses its last leg
  // @impl external — git: any pusher (R-BTN-66)
  action regress(t: str): bool = {
    val g = st.gitPath.get(t)
    all {
      st.gitBudget > 0, g.length() > 0,
      st' = st.with("gitPath", st.gitPath.set(t, g.slice(0, g.length() - 1)))
              .with("gitBudget", st.gitBudget - 1)
              .with("gitRegressedEver", st.gitRegressedEver.set(t, true)),
    }
  }
  // A ticket's source gains or loses a `depends_at` entry, or a decision opens or is answered —
  // by anyone, in git (R-BTN-66, R-BTN-78, R-BTN-120).
  // @impl external — git: the ticket's source (R-BTN-66)
  action gitDepends(t: str, d: Dep, on: bool): bool = all {
    st.gitBudget > 0, d.other != t, st.gitDeps.get(t).contains(d) != on,
    st' = st.with("gitDeps", st.gitDeps.set(t, if (on) st.gitDeps.get(t).union(Set(d)) else st.gitDeps.get(t).exclude(Set(d))))
            .with("gitVersion", st.gitVersion + 1).with("gitBudget", st.gitBudget - 1),
  }
  // @impl external — git: the ticket's source (R-BTN-66)
  action gitDecides(t: str, leg: str, open: bool): bool = all {
    st.gitBudget > 0, st.gitDecisions.get(t).contains(leg) != open,
    st' = st.with("gitDecisions", if (open) st.gitDecisions.set(t, st.gitDecisions.get(t).union(Set(leg)))
                                  else st.gitDecisions.set(t, st.gitDecisions.get(t).exclude(Set(leg))))
            .with("gitVersion", st.gitVersion + 1).with("gitBudget", st.gitBudget - 1),
  }
  // @impl external — git: any pusher (R-BTN-66)
  action withdraw(t: str): bool = all {
    st.gitBudget > 0, not(st.withdrawn.get(t)), not(atEnd(st.gitPath.get(t))),
    st' = st.with("withdrawn", st.withdrawn.set(t, true)).with("gitBudget", st.gitBudget - 1),
  }

  // ---- the sync: number first, then read, then post (§7.1, R-BTN-62) ----
  // R-BTN-62 as amended 2026-10-15: no number while another is outstanding (`sync-busy`).
  // @impl src/core/observations.ts#observe
  action syncNumber(s: int): bool = all {
    st.syncs.get(s).phase == "idle", SLOTS.forall(o => not(outstanding(o))),
    st' = st.with("counter", st.counter + 1)
            .with("syncs", st.syncs.set(s, st.syncs.get(s).with("phase", "numbered")
                                                           .with("obs", st.counter + 1)
                                                           .with("voided", false))),
  }
  // The course's sync reads git and computes any barred tags consistent with it (here, any
  // set of families on the writing legs — course logic is nondeterministic, R-BTN-50) and each
  // ticket's queued leg: one of the legs leaving the station git shows, or none ("") exactly
  // when no leg leaves it — at an end, or where max_runs leaves none. R-BTN-83 requires a `next`
  // at every station but an end, and `locate` infers one for work without a pair; what core does
  // with a post that breaks this is not yet specified (round 2, 2-r2-4; ticket B-27).
  // Which leg is the course's to say (R-BTN-83: the holder's `next`, a re-route or the start leg).
  pure def queuedValid(git: str -> List[str], queued: str -> str): bool =
    git.keys().forall(t => if (nextLegs(git.get(t)).size() == 0) queued.get(t) == ""
                           else nextLegs(git.get(t)).contains(queued.get(t)))
  // @impl external — the repository's sync reads git and computes the bars and queued legs
  action syncRead(s: int, bars: str -> Set[str], queued: str -> str): bool = all {
    st.syncs.get(s).phase == "numbered", queuedValid(st.gitPath, queued),
    st' = st.with("syncs", st.syncs.set(s, st.syncs.get(s).with("phase", "read")
                     .with("git", st.gitPath).with("gone", st.withdrawn).with("bars", bars)
                     .with("queued", queued)
                     // R-BTN-120, R-BTN-78: the prerequisites and open decisions the source holds,
                     // posted as given; and git's version, for containment (R-BTN-126)
                     .with("deps", st.gitDeps).with("decisions", st.gitDecisions)
                     .with("version", st.gitVersion))),
  }
  // A queued leg for each ticket of `git`: its own pick where that leaves the station, else the
  // first leg in the course's order that does — the schedulers' way to draw a valid one, per
  // ticket, so two tickets at one station may queue different legs (round 1, 1-A-5). (Each reads
  // nextLegs once: Apalache inlines every call.)
  pure val ORDER = List("implement", "review", "fix", "adjudicate", "merge")
  pure def firstOf(n: Set[str]): str = ORDER.foldl("", (q, l) => if (q == "" and n.contains(l)) l else q)
  pure def firstLeg(p: List[str]): str = firstOf(nextLegs(p))
  pure def queuedFor(git: str -> List[str], picks: str -> str): str -> str =
    git.keys().mapBy(t => {
      val n = nextLegs(git.get(t))
      if (n.contains(picks.get(t))) picks.get(t) else firstOf(n)
    })

  // What an accepted snapshot does to one claim (R-BTN-35, §2e, R-BTN-10, R-BTN-71).
  pure def judge(c: Claim, obs: int, snap: List[str], prev: List[str], gone: bool): Claim =
    if (c.status == "active" and obs > c.claimObs) {
      if (gone) c.with("status", "released").with("kind", "stale").with("leg", "")
                 .with("endObs", obs).with("endedRegressed", c.regressed).with("regressed", false)
      else if (snap.length() < prev.length() or snap.length() < c.startPath.length())
        c.with("regressed", true)
      else if (c.regressed and extendsPath(expected(c), snap)) c.with("regressed", false)
      else c
    } else if (c.status == "completed" and not(c.confirmed) and obs > c.endObs) {
      // a done by an end station, or by the ticket's absence from a later snapshot (G-BTN-44); a
      // withdrawn ticket posts no path, so it confirms no suspension (R3-1244's model-based
      // tests found the model reading a withdrawn ticket's last path)
      val ok = if (c.kind == "done") atEnd(snap) or gone
               else not(gone) and (c.endedRegressed or extendsPath(expected(c), snap))
      if (ok) c.with("confirmed", true).with("confirmObs", obs) else c
    } else if (c.status == "completed" and not(c.confirmed) and c.kind == "done"
               and obs > c.claimObs and atEnd(snap)) {
      c.with("confirmed", true).with("confirmObs", obs)
    } else c

  // R-BTN-62: Baton voids a number left outstanding too long (10 minutes); the run may still
  // read and post, and its post is refused.
  // @impl src/core/observations.ts#observe
  // @impl src/core/observations.ts#use
  action syncVoid(s: int): bool = all {
    outstanding(s),
    st' = st.with("syncs", st.syncs.set(s, st.syncs.get(s).with("voided", true))),
  }
  // A post is accepted whole only when its number is greater than the last accepted.
  // @impl src/core/baton.ts#board
  // @impl src/core/observations.ts#use
  // @impl src/core/claims.ts#judge
  // @impl src/core/claims.ts#staleBoard
  // @impl pending — `depends_at` entries posted and their rows kept (R-BTN-120, B-10); provisional rows replaced by a snapshot containing their commit (R-BTN-126, B-21)
  action syncPost(s: int): bool = {
    val r = st.syncs.get(s)
    all {
      r.phase == "read",
      // An accepted post also writes the prerequisites and decisions it carries, and replaces
      // every provisional row whose commit it contains with what it posts — git wins (R-BTN-126,
      // R-BTN-39); blocked_since follows, with its events (R-BTN-75).
      st' = (if (r.obs > st.lastAccepted and not(r.voided))
               settle(st.with("lastAccepted", r.obs).with("posted", r.git).with("postedGone", r.gone)
                 .with("postedBars", r.bars).with("queued", r.queued).with("accepted", st.accepted.append(r.obs))
                 .with("postedDeps", r.deps)
                 // R-BTN-78: a decision on a leg that is not a posted next leg sits on the whole ticket
                 .with("postedDecisions", r.decisions.keys().mapBy(t => r.decisions.get(t).map(x =>
                    if (x == "" or nextLegs(r.git.get(t)).contains(x)) x else "")))
                 .with("provs", st.provs.filter(p => p.commit > r.version))
                 .with("claims", st.claims.keys().mapBy(i => {
                    val c = st.claims.get(i)
                    judge(c, r.obs, r.git.get(c.ticket), st.posted.get(c.ticket),
                          r.gone.get(c.ticket)) })), Set())
             else st)                                    // refused stale-observation
            .with("syncs", st.syncs.set(s, r.with("phase", "idle"))),
    }
  }

  // @impl external — the model's scheduler: every actor
  action step = {
    nondet w = WORKERS.oneOf()
    nondet t = TICKETS.oneOf()
    nondet leg = LEGS.oneOf()
    nondet s = SLOTS.oneOf()
    nondet b = Set(true, false).oneOf()
    nondet kind = Set("done", "suspended", "release", "fail").oneOf()
    nondet holderBars = FAMILIES.powerset().oneOf()
    nondet postBars = TICKETS.setOfMaps(FAMILIES.powerset()).oneOf()
    nondet picks = TICKETS.setOfMaps(LEGS).oneOf()
    nondet tag = FAMILIES.oneOf()
    nondet applies = Set("claim", "claim+advance").oneOf()
    nondet i = 1.to(MAX_CLAIMS).oneOf()
    nondet d = depChoices(t, TICKETS).union(Set({ leg: "", other: t, mode: "done", stations: Set() })).oneOf()
    nondet blockKind = Set("ticket", "decision").oneOf()
    nondet decisionLeg = LEGS.union(Set("")).oneOf()
    any {
      claim(w, t),
      pushEvidence(w, b), advance(w, leg, holderBars), endClaim(w, kind, b), endBlocked(w, blockKind, d),
      heartbeat(w), sleep(w), wake(w), tick, alarmReap(i),
      crash(w), reapDead(w), forceReap(w), fenceCleared(w), fenceTimeout(i),
      setHold(t, b), setOwnerBar(tag, applies), liftOwnerBars, ownerResolve(i),
      foreignPush(t, leg), regress(t), withdraw(t), gitDepends(t, d, b), gitDecides(t, decisionLeg, b),
      retryElapse(t, leg), provisionalLapses(t, leg),
      syncNumber(s), syncRead(s, postBars, queuedFor(st.gitPath, picks)), syncVoid(s), syncPost(s),
    }
  }

  // The happy path's done: once the claim stands at an end station, as the runner ends it (§11).
  // @impl external — the model's scheduler: endClaim's happy-path case
  action endDoneAtEnd(w: str): bool = all {
    workerClaim(w).size() == 1,
    val c = theClaim(w)
    ENDS.contains(if (c.leg != "" and st.pushed.get(w)) TO.get(c.leg) else c.station),
    endClaim(w, "done", true),
  }

  // The happy path's actors only — claims, legs, pushes that land, ends, syncs, git's own
  // regressions — so random runs reach the deep states (merges, fix loops, regressions,
  // confirmations) that the full `step` rarely gets to in 40 steps. Every run of it is a run
  // of `step`, so a violation here is a real one.
  // @impl external — the model's scheduler: the happy path's actors
  action progressStep = {
    nondet w = WORKERS.oneOf()
    nondet t = TICKETS.oneOf()
    nondet leg = LEGS.oneOf()
    nondet postBars = TICKETS.setOfMaps(Set(Set("family:b"))).oneOf()
    nondet picks = TICKETS.setOfMaps(LEGS).oneOf()
    any {
      claim(w, t),
      pushEvidence(w, true), advance(w, leg, Set("family:b")), endDoneAtEnd(w),
      syncNumber(1), syncRead(1, postBars, queuedFor(st.gitPath, picks)), syncPost(1), regress(t),
    }
  }
}
