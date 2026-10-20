# Baton's core as a formal model (R3-1243)

A [Quint](https://quint-lang.org) model of Baton's core state machine, written against
`BATON_SPEC` (now [`spec/BATON_SPEC.md`](../spec/BATON_SPEC.md); written against it in
`immediately-run/docs` as merged at `b7537395`, docs#212) and being brought up to the spec's
§2g–§2m by R3-1254 — so far R-BTN-98's one-transaction claim, R-BTN-83's queued leg, and a leg's
prerequisites with their blocks, retries and blocked ends (R-BTN-75, -77, -78, -120, -122, -126);
*Not modelled* lists the rest. Each action, helper
and property names the requirement it models (`R-BTN-n`, §n). A counterexample is a spec
defect: it is filed against BATON_SPEC with the trace, never fixed by weakening a property.

## Files

| File | What it holds |
|---|---|
| `baton.qnt` | the state (one record, `st`) and every action; the sizes are constants |
| `properties.qnt` | the safety invariants, conjoined as `safety`, over any instance |
| `liveness.qnt` | the liveness properties under weak fairness, over `small` (kept apart: their fairness terms made Apalache's input too large) |
| `witnesses.qnt` | the reachability witnesses, each an invariant that must fail |
| `instances.qnt` | `sim` (R3-1243's bounds: 3 workers, 2 tickets, 2 overlapping sync runs) and `small` (2 workers, 1 ticket, 1 sync run, for Apalache) |
| `regressions.qnt` | one deterministic run per defect the reviews found (75), each asserting the merged spec does not reach it |
| `replay.qnt` | the traces `test/model/replay.test.ts` drives the core with (R3-1244): `sim`'s instance, every action the harness can make the core take |
| `check.mjs` | `npm run model` and `npm run model:quick` |
| `full.mjs` | `npm run model:full`: every check, with a report for the PR |
| `verify.mjs` | `npm run model:verify` |

## Commands

**Where the checks run (R-BTN-68, amended 2026-10-17).** Model checking runs on the
author's machine, not on hosted CI runners, whose time limits it outgrew. A pull request that
changes what the checks read — `model/`, `src/core/` with the `src/shared/` modules and
`src/migrations/` it imports, the replay and its helpers (`test/model/`, `test/helpers.ts`,
`test/lib/`), the scenarios and their hosts (`test/integration/`, `test/hosts/`), the trace check,
or `package-lock.json`, which pins Quint and Apalache — carries
`npm run model:pr`'s report in its body (about half an hour; a weekly `npm run model:full` report
is accepted too). CI's `model-report` workflow
(`scripts/model-report.mjs`) runs no model: it reads the body, and fails until the report is
there, names the PR's head and shows every check passing at full size; editing the body re-runs
it. Since 2026-10-20 hosted CI runs no Quint at all (owner: baton was the org's most expensive
repository in Actions minutes): it runs `npm run test:no-quint`, whose only model check is the
links (`npm run model:links`). `npm test` on your machine still runs `npm run model:quick`, the
scenario traces and 200 model-drawn traces driving the core.

- `npm run model:pr` — the PR report: `npm run model:quick`, the model-based tests with 200 traces,
  and the scenario traces, with the same Markdown report. About 20–30 minutes; paste it into the PR.
- `npm run model:full` — weekly, on `main`'s head (R-BTN-68 as amended 2026-10-20); post the report
  to the pinned "Weekly model check" issue and file a ticket for a failure. Every check below, in order: `npm run model` with 10,000 samples, the
  model-based tests with 1,000 traces, `npm run model:verify` to depth 4, and the scenario traces
  (the integration scenarios write a fresh set, then `npm run traces`). It runs every step
  even after a failure and prints a Markdown report on stdout: the commit (flagged when the
  working tree has any uncommitted or untracked change), the Quint version, and each check's
  result and minutes. `MODEL_SAMPLES`, `REPLAY_TRACES` and `MODEL_VERIFY_DEPTH` lower the sizes
  to try a change, and the report then says it is a reduced run, which `model-report` refuses.
  A PR may carry it instead of `model:pr`'s. Needs Java for the proof; about three hours on 4 CPUs.
- `npm run model` — typecheck, the 75 regression runs, 10,000 random runs of 40 steps of `sim`
  against `safety` with the full `step` and 3,000 with `progressStep` (the happy path's actors,
  so runs reach merges, fix loops and regressions; every run of it is a run of `step`), and
  fifteen reachability witnesses. No JVM; about 6 minutes. `MODEL_SAMPLES` sets the `step` runs
  and scales the `progressStep` runs (30%).
- `npm run model:quick` — the typecheck and the regression runs alone; `npm test` runs it.
- `npm run model:verify` — Apalache's bounded proof of `safety` on `small` to depth 4: about 127
  minutes on 4 CPUs since R3-1254 part 2b's fleet (47 at part 2a). Depth 5 took 15 minutes before R3-1254 and 49 with its queued leg. With part
  2's prerequisites it takes about 23 minutes per enabled transition, roughly 10 hours, so the
  proof is at depth 4 for now (owner, 2026-10-19), and B-37 brings depth 5 back. Needs Java; the first run downloads Apalache. `model/verify.mjs` compiles
  the model to Quint's JSON IR in a file and runs Apalache's command line on it: `quint verify`
  sends the model to an Apalache server in one request, whose reader refuses a string over 20 MB,
  and `small` compiles to just over that since R3-1254 (19.8 MB before it).

Simulation uses Quint's TypeScript backend: the Rust evaluator is fetched from GitHub
releases at first use, which a sandboxed agent cannot always reach.

## Code against the model (R3-1244)

The model checks the design; three checks hold the code to it.

- **Correspondence markers** (`npm run model:links`, `scripts/check-model-links.mjs`, in `npm
  test`). Each action names its implementation above it — `// @impl src/core/<file>.ts#<fn>`, or
  `// @impl external — <who>` for a step only the environment takes (a worker's push, git, time)
  — and each implementing function names the action back with a hash of the action's text,
  `// @model <action> sha256:<12 hex>`. A model change fails the check, naming the functions to
  re-check; re-stamping the hash (`node scripts/check-model-links.mjs --stamp` prints them) is
  the reviewed step. Where the model is ahead of the code, a third form says so —
  `// @impl pending — <what is not built, and the ticket that builds it>` — alone when nothing of
  the action is built, beside its `@impl` functions when part is. A pending-only action
  (`endBlocked`, `retryElapse`, `provisionalLapses` today) is held to no code until its ticket
  (B-10, B-11, B-21, B-26) lands, so a change to it fails nothing; a partly built one's functions
  keep their stamps, which attest the part that is built. Every run of `npm run model:links`
  lists them, `not built` or `partly built`.
- **Scenario traces** (`npm run traces`, `scripts/check-traces.mjs`, in `npm test`). Every S-BTN
  scenario's run on the local host is recorded, one step per request or alarm tick, with the
  state projection after it (`test/integration/trace.ts`: observation numbers, the model's
  repository's tickets as posted, claims and their legs, holds, owner bars, workers' tags, the
  required bar). Each trace replays as a deterministic Quint run: Baton's action with the
  environment's steps that make it possible, then the projection the model must reach. A
  rejection names the scenario, the step, the model action and the field. A step the model has
  no action for — a claim the harness wrote, cutover's legacy claims, a course file that is not
  the model's — ends the part of the trace the model can judge; every trace prints its checked
  steps and why it stopped. Each such stop is pinned, step and reason, in
  `test/integration/trace-scope.json`: a new or moved stop, a stale entry, or a trace with no
  step checked fails the run (`node scripts/check-traces.mjs --write-scope` rewrites the list,
  and the diff is the reviewed step). A step no model action explains, and that is no named
  unmodelled mechanism, rejects the trace.
- **Model-based tests** (`test/model/replay.test.ts`, in `npm test`). 200 traces drawn from
  `replay.qnt` (half from every actor, half from the happy path's) drive the core on the local
  host, comparing its projection with the trace's state after every step. `REPLAY_TRACES` sets
  the count.

To replay scenarios with their own workers and required bar, `FAMILIES`, `TAGS`, `REQUIRED` and
`MAX_TIME` are constants of `baton.qnt`; every checked instance keeps R3-1243's values.

**Where code and model differ, and why it is safe.** Baton renews a lease on every
authenticated call, not only on heartbeats and claims (it reaps later); it force-reaps a worker
already silent past its lease without a fence (R-BTN-19's fence, already timed out: the model's
`forceReap` and `fenceTimeout` in one step); its one alarm reaps every lapsed lease at once; it
voids an observation number by its clock alone. `replay.qnt` draws only traces in which these
coincide with the model's single steps, and says so. The model keeps a reaped claim's leg as its
worker's view; Baton keeps no worker's view, so a leg is compared while its claim is active.
Each post the replay sends carries the queued leg the model's sync read (R-BTN-83), and the
scenario traces read it from `ticket_stations.next_leg`, so both compare it after every step.

## What is modelled

- **The course** is `roadmap-pr`'s `course.json` (§2e, R-BTN-69): `filed` → `pr-open` →
  `reviewed` ⇄ `fixed`, `adjudicated`, `merged`; `review` at most 3 runs, `fix` 2. Core reads it
  as a graph only. `courseOk` is R-BTN-69's acceptance — one start, at least one end, no leg
  leaving an end (an end is terminal: R3-1254, owner), `start_leg` leaving `start`, every
  station reachable from `start` and reaching an end, a `max_runs` leg in every cycle — and the
  course passes it (`courseIsAcceptedTest`); `courseRulesRefuseTest` breaks each rule alone.
- **A claim is one transaction** (R-BTN-98, §7.2): `claim` checks every gate and takes the
  ticket at once. *(R3-1254: it was `claimStart` and `claimFinish` around the course's claim
  hook, R-BTN-52's await and rule 12, which R-BTN-98 retired.)*
- **The queued leg** (R-BTN-83, §7.2 rule 1): each accepted post sets a ticket's queued leg —
  one leaving the station git shows, which the course's sync chooses (here, any such leg), or
  none; a new ticket starts at `start_leg`. A claim is offered that leg alone, rule 8 is judged
  on it, and the claim's first advance must be into it (`not-queued`).
- **Advance** (R-BTN-63): finishes the running leg, starts the next along an edge under its
  `max_runs` (counted from `start_path` plus the claim's legs), on the holder's word, if the
  holder gates hold: the hold (rule 3), barred tags — the sync's, the owner's `claim+advance`
  bars, the holder's own `bars` (rule 8, R-BTN-60, R-BTN-67) — the required bar over posted plus
  holder bars (R-BTN-67), for the first advance the queued leg, and no open decision, backoff or
  provisional row on the leg entered (§7.2, R-BTN-78, R-BTN-122, R-BTN-126). Git first (R-BTN-8): a leg's evidence is
  pushed before the advance that finishes it, and may land, be rejected or be lost.
- **Ends** (R-BTN-71, §6.5): `done`, `suspended` at the `to` reached or the `from` given up,
  `release`. A `done` may come from any station — the runner also ends done when git shows the
  ticket closed (§11, R-BTN-72), which Baton cannot see — and is confirmed only by an end
  station or a closure (R-BTN-10). *(R3-1244's scenario traces found the model requiring an end
  station, narrower than the spec; `progressStep` keeps the runner's own rule, so its runs still
  reach merges.)* Every end — a worker's, a reap, a stale release — clears the claim's
  regression flag and records it as `endedRegressed` (§4: `regressed_since` "cleared … at the
  end"; R3-1254's model-based tests found the model keeping it).
- **Time and the lease** (§6.3, §6.6, R-BTN-4, R-BTN-6, R-BTN-19, R-BTN-26): abstract ticks;
  a claim's lease lasts `TIMEOUT` ticks from the last heartbeat and the alarm reaps it then —
  its worker dead, or alive and silent (asleep). A worker acts on the claim *it believes* it
  holds, and its own fence check stops it `MARGIN` ticks before its lease ends by its own
  clock, which runs up to `MAX_DRIFT` behind Baton's. The owner force-reaps a live worker's
  claim, which stays fenced — the ticket not re-issued — until that worker reports
  `fence-cleared` or has been silent (dead or asleep) past its timeout, measured in ticks
  from its last heartbeat (`fenceTimeout`; round 2, 2-A-0).
- **The sync** (§7.1, R-BTN-62): number, then read, then post, as three actions, so every
  interleaving with workers and git is explored — with at most one reading in flight per
  repository: a second number is refused while one is outstanding, and a voided number's post
  is refused (R-BTN-62 as amended 2026-10-15, after this model found the overlap); the barred tags it posts are any set
  consistent with the contract (course logic is nondeterministic, R-BTN-50). A post is accepted
  whole only when its number is greater than the last accepted; an accepted snapshot judges a
  claim only when its number is greater than the claim's or its end's: staleness only on
  withdrawal (R-BTN-35); a regression when the path is shorter than git showed before (§2e),
  cleared when git extends the expected path; confirmation by path extension, by any path for a
  claim that ended regressed, or by a recorded closure for `done` (R-BTN-10, R-BTN-71).
- **Git is anyone's** (R-BTN-66): any pusher can run the next leg, a PR can close, a ticket can
  be withdrawn, and a ticket's source can gain or lose a `depends_at` entry or open or answer a
  decision. **The owner** holds tickets (a lift resets the attempt and blocked-end counts and clears the backoff, as
  R-BTN-78's `retry` does), sets
  and lifts owner bars, force-reaps, and resolves flagged completions (§8, R-BTN-67, §6.7).
- **A leg's prerequisites** (R-BTN-120): the sync posts each ticket's `depends_at` entries —
  another ticket `at` a station now, having `reached` one, or closed `done`, on one leg or the
  whole ticket — and its open decisions (R-BTN-78), as git holds them; Baton evaluates the
  entries from the stations and paths it stores (a withdrawn ticket meets none), and moves a
  decision on a leg that is not a posted next leg onto the whole ticket. Each unmet prerequisite,
  open decision and backoff is a row on its leg or the ticket; any of them, or a provisional row,
  refuses a claim into its leg, and all but an unmet prerequisite refuse an advance into it too —
  a `ticket` row binds a claim only (§7.2, R-BTN-75; `ticketRowBindsNoAdvanceTest`). Only `select: posted` entries are modelled:
  `children` and `parent` select the same tickets' stations another way.
- **Blocks** (R-BTN-75, R-BTN-77): `blocked_since` is set when the ticket is not held (an active
  claim, an unconfirmed completion, a fence-pending reap), has a queued leg, and a confirmed row
  on it or the ticket, re-evaluated in every transaction that changes one of those. A claim's
  start changes it silently (a claim into a leg with only a `resource` row, advice, reaches it:
  `resourceRowIsAdviceTest`); every other change logs `blocked` or `unblocked` — an end that
  leaves the ticket blocked logs `blocked` (R-BTN-75 as amended by R3-1254, which this model
  found: see *What found something*).
- **Retries per leg** (R-BTN-122): a `fail` end (`cannot-finish:transient`) and an alarm reap are
  failed attempts on the claim's leg, counted per ticket and leg; each backs the leg off — a
  `retry` row until `retry_after`, which the alarm clears (`retryElapse`) — and the
  `MAX_ATTEMPTS`-th holds the ticket instead. A force-reap is no attempt.
- **A prerequisite failing during a leg** (R-BTN-126, `endBlocked`): the holder, its leg's work
  not pushed, ends `released:blocked` naming another ticket or a decision; the leg first writes
  it to the ticket's source in git, and the end writes a provisional row on the leg — refusing
  a claim or advance into it, no block, no event. The first accepted snapshot whose reading
  contains that commit (git's version at the read, not its observation number) replaces it
  with what it posts; one no such snapshot replaces within `PROV_TTL` lapses
  (`provisionalLapses`). Blocked ends are no attempts; past `MAX_BLOCKED` the next holds the
  ticket. `resource` and `capability` blocked ends are `endBlockedOn` (*The fleet*, below).

- **The fleet** (R3-1254 part 2b; R-BTN-75, R-BTN-76, R-BTN-121, §7.2 rule 4): Baton records
  each worker's last authenticated call — a heartbeat (an idle worker heartbeats too; a fence
  report rides one), a claim, an advance, an end (§5, §11) — and what it declares; a worker is
  live while that call is within `TIMEOUT`. Only a heartbeat recounts, the fence report's
  included: any other call that revives a lapsed worker waits for the alarm's check, as in core. **Rule 4**: a claim, and each advance,
  needs the ticket's `requires` within what the worker declares and is granted. A **`capability`
  row** stands on the whole ticket for a capability no live worker both declares and is granted;
  the rows are stored and rewritten where R-BTN-75 says the counts change — a heartbeat from a
  worker that was not live or whose declared set changed (`declare`: its check failed, or passes
  again), the alarm finding the live set changed (`alarmLive`), and a `capability` blocked end
  (`endBlockedOn`), which drops the capability from the runner's declared set in its
  transaction. A force-reap changes no worker's liveness (core marks only a worker already silent
  past its lease reaped), so it recounts nothing. **Resources**: each is one `service` instance,
  `unavailable` for `READING_TTL` ticks after a reading (`reading`) or a `resource` blocked end,
  until an `available` reading or the lapse (`readingLapses`); a leg's needs are the course's and
  the sync's, plus a `resource` end's `end`-sourced need. A **`resource` row** stands on a leg
  that needs an `unavailable` resource while some worker is live to answer; it counts toward
  `blocked_since` and gates nothing — advice (R-BTN-45): a claim into it is granted.
  **`answer_lost`** (R-BTN-77 as amended by R3-1251): a recount whose fleet is empty drops the
  `resource` rows, silently, and the ticket remembers them; blocked again only on rows it lost
  (every row the recount adds was lost, as core reads it), silently; on anything else, logged —
  the owed `unblocked` first, logged only, then the `blocked`; settled — each lost need gone (its
  leg no longer the queued leg: the leg moved past) or the fleet back — the owed `unblocked` is
  logged if the ticket is unblocked, unheld and has a queued leg. A ghost, `events`, counts every
  event logged, the owed `unblocked` included, so a run can tell the silent transitions from the
  logged ones. **One evaluation per recount** (R-BTN-75 as amended here): core's
  `Blocks.recount` evaluates after the capability rows and again after the resource rows, so a
  fleet returning to a ticket that needs both logs an `unblocked` and a `blocked` the model
  does not; the actions that recount carry `@impl pending` notes naming B-49, which fixes core.
  An instance with no requirements and no resources (`FLEET` false: `small`) never recounts.

## Properties (`safety`)

| Property | Requirement |
|---|---|
| `oneLiveHolderPerTicket` — an active claim or a fenced, force-reaped one; never two | R-BTN-4, R-BTN-19, R-BTN-26 |
| `oneClaimPerWorker` | R-BTN-4 |
| `observationsIncrease` | R-BTN-62 |
| `confirmationAfterEnd` — no end confirmed by an observation not greater than its own | R-BTN-10, R-BTN-62 |
| `confirmedIsInGit` — monotone confirmation: a confirmed suspension's path is in git unless git since regressed | R-BTN-10, R-BTN-71 |
| `staleOnlyWhenTakenAway` | R-BTN-35 |
| `regressedOnlyWhenGitRegressed` — lag is never a regression | §2e |
| `boundedLoops` — no claim runs a leg past its `max_runs` | R-BTN-63, R-BTN-69 |
| `writingLegsBarred` — every writing leg started under the required bar, by a worker of no barred family | R-BTN-45, R-BTN-60, R-BTN-67 |
| `gatesHeld` — every claim and advance was granted with every gate in force holding (hold, barred tags, required bar, rule 4, the queued leg, and the leg's rows: an unmet prerequisite at a claim, an open decision, a retry backoff, a provisional row), recorded at the grant apart from the guard | R-BTN-45, R-BTN-83, R-BTN-120, R-BTN-122, R-BTN-126, rules 1, 3, 8 |
| `noActAfterLoss` — no worker pushes for a claim the alarm reaped (unfenced) | R-BTN-6, R-BTN-26 |
| `noStuckTicket` — no deadlock: a ticket git has not finished or withdrawn, once the syncs are idle and the head matches git, is held, fenced, owner-held, its queued leg waiting on `policy`, blocked (a row, listed by R-BTN-75) or held off by a provisional row (R-BTN-126), flagged, or claimable | §6.7, R-BTN-10, R-BTN-35, R-BTN-67, R-BTN-75, R-BTN-83, R-BTN-126 |
| `blockedIsStored` — `blocked_since` is what the rows, the queued leg and the held state say, after every transaction | R-BTN-75 |
| `unblockedFollowsBlocked` — every `unblocked` event follows a `blocked` one | R-BTN-77, R-BTN-75 as amended by R3-1254 |
| `capabilityRowsCounted` — the `capability` rows are what the live set and the declared sets Baton last counted say: no change to either leaves them behind | R-BTN-75, R-BTN-121 |
| `answerLostOwesUnblocked` — a lost answer is remembered only while the ticket is unblocked with its `blocked` still open, the `unblocked` it is owed | R-BTN-77 as amended by R3-1251 |
| `attemptsBounded`, `blockedEndsBounded` — at most `MAX_ATTEMPTS` failed attempts, and `MAX_BLOCKED` blocked ends and the one that holds, per ticket and leg between hold lifts | R-BTN-122, R-BTN-126 |

**Liveness** — `fencesClear`, `endsResolveWithOwner` (implied by the owner's fairness alone, by design: §6.7), `barsLiftClaimable`, `readyIsClaimed` — is stated
in `liveness.qnt` under weak fairness of each resolving step, per worker. The item's fifth,
a held history accepted within 24 hours, is not stated: held histories are not modelled. See
*Checked how* for what has been run.

**What found something.** On its first review this model found a real spec gap: with two
overlapping sync runs, a higher observation number read earlier could be posted later and
make a holder's progress look like a regression. BATON_SPEC R-BTN-62 relied on Actions'
concurrency group, which agents can edit; it now has Baton refuse a second number while one is
outstanding (`sync-busy`). `overlappingSyncRunsRefusedTest` keeps it.

Brought up to §2m (R3-1254), it found a second on its first run: a claim's end changed
`blocked_since` silently (R-BTN-75), so a failed attempt's backoff (R-BTN-122) blocked the
ticket with no event, and the backoff's `unblocked` was then logged with no `blocked` before it
(`unblockedFollowsBlocked`). The owner chose (2026-10-17) to log `blocked` when an end leaves
the ticket blocked; R-BTN-75 is amended, B-26 builds it in core, and
`endLeavingTheTicketBlockedLogsBlockedTest` and `backoffThenHoldTest` keep it.

**Mutation checks** — each mutant fails the run or probe that names its defect:
- restoring the fifth revision's regression rule fails `lostPushIsNotRegressionTest`;
- dropping the first advance's `not-queued` check fails `claimOfferedQueuedLegOnlyTest`;
- judging rule 8 on any ready leg, not the queued one, fails `barredQueuedLegRefusesClaimTest`;
- keeping the regression flag past an end, at any one of the four ends — a worker's, an alarm reap, a
  force-reap, a stale release — fails that end's run (`workerEndClearsRegressedTest`,
  `alarmReapClearsRegressedTest`, `forceReapClearsRegressedTest`, `staleReleaseClearsRegressedTest`);
- dropping the fence from the claim gate fails `forceReapFencesTest`;
- dropping the advance's gate guard reaches a `gateViolation` (`gatesHeld`);
- clearing a fence without its timeout fails `heartbeatingFenceHoldsTest`;
- R3-1254's prerequisites: a claim or an advance that ignores the rows fails
  `atPrerequisiteFollowsTheOtherTicketTest` and `backoffRefusesAdvanceTest` (with others);
  keeping a provisional row past the snapshot that contains it, or dropping it at any snapshot,
  fails `provisionalRowUntilASnapshotContainsItTest`; a silent end fails
  `endLeavingTheTicketBlockedLogsBlockedTest`; a decision on an unposted leg kept on that leg
  fails `decisionOnAnUnpostedLegIsOnTheTicketTest`; a withdrawn ticket meeting prerequisites
  fails `withdrawnMeetsNothingTest`; `reached` read as `at` fails
  `reachedPrerequisiteStaysMetTest`; no hold at `max_blocked` fails
  `blockedEndsHoldPastMaxBlockedTest`; a lift that keeps the blocked-end count fails
  `liftResetsBlockedEndsTest`; a backoff that clears before `retry_after` fails
  `backoffWaitsForRetryAfterTest`; a provisional row that lapses before its hour fails
  `provisionalRowWaitsForTheHourTest`; an alarm reap that counts no attempt fails
  `alarmReapIsAFailedAttemptTest`; a lift that keeps the backoff fails `liftClearsTheBackoffTest`;
  an advance refused on a `ticket` row fails `ticketRowBindsNoAdvanceTest`;
- R3-1254 part 2b, the fleet: a claim, or an advance, without rule 4 fails
  `rule4RefusesTheClaimTest`, `rule4RefusesTheAdvanceTest`; a heartbeat that changes what is
  declared without recounting fails `capabilityRowFollowsTheFleetTest`; an alarm that does not
  recount fails `lapsedFleetWritesTheRowTest`; a `capability` end that keeps the capability
  declared fails `capabilityEndDropsItTest`; a `resource` row that gates fails
  `resourceRowIsAdviceTest`, as does a claim's start that logs its unblocking; a `resource` end with no `end`-sourced need fails
  `resourceEndStoresReadingAndNeedTest`; a reading that lapses early fails
  `readingWaitsOutItsTimeTest`, and one a tick early `readingLapsesNotATickEarlyTest`; a lost
  answer logged, a reblock logged, or an owed `unblocked` never logged fails
  `answerLostIsSilentThenReblocksTest` or `answerLostOwesTheUnblockedTest`; a record a logged
  transition does not end, or an owed `unblocked` left uncounted, fails
  `answerLostThenAnotherBlockLogsTheOwedFirstTest`; a reblock on rows it did not lose fails
  `answerLostBackOnMoreThanItLostIsLoggedTest`; the owed `unblocked` logged while a claim holds
  the ticket fails `answerLostSettledSilentlyWhileHeldTest`; a lost need never gone fails
  `answerLostSettlesWhenTheLegMovesPastTest`; a row counting a worker that declares a
  capability without a grant fails `capabilityRowFollowsTheFleetTest`;
  an advance, an end or a blocked end that does not count as a call fails
  `anAdvanceKeepsItLiveTest`, `anEndKeepsItLiveTest` or `aBlockedEndKeepsItLiveTest`; a fence report
  that does not recount fails `aFenceReportRecountsTest`; a reblock weighed on every leg — more than
  core, which weighs only the next legs — fails `answerLostJudgedOnTheQueuedLegTest`; a course whose end is not terminal passes
  `courseOk` and fails `courseRulesRefuseTest`;
- `MAX_DRIFT = 3`, above `MARGIN = 2`, lets a reaped worker push (`noActAfterLoss`); at
  `MAX_DRIFT = 2` it cannot — the spec's assumption is drift ≤ the margin.

## Checked how

| Check | Instance | Result |
|---|---|---|
| 75 regression runs | `sim` sizes, zero drift | pass |
| `safety`, 10,000 × 40 steps of `step`; 3,000 × 40 of `progressStep` | `sim` | no violation |
| witnesses (a confirmed suspension, a resumed claim, a fence, an alarm reap, a blocked ticket, a provisional row, a backoff, an `unblocked` event, a `capability` row, a `resource` row, a lost answer; a fix leg, a regression, a merge, a confirmed `done`), seeded | `sim` | all 15 reached |
| a second review | — | reached by a regression run only (`maxRunsSurviveResumptionTest`) |
| Apalache, `safety` | `small`, depth 4 | no violation; 127 min on 4 CPUs at R3-1254 part 2b (baton#60's report, 769b5c3), 47 min at part 2a. Depth 5: 15 min 29 s before R3-1254, 49–59 min with its queued leg, about 10 h with part 2's prerequisites (B-37 brings it back). Each model PR's `model:full` report carries the figure for its head (R-BTN-68) |
| liveness, `fencesClear` | `small`, TLC (Apalache cannot check fairness) | **at `b76af9c`, the pre-round-2 formula and model**: no violation in 8,187 distinct states before a 28-minute cap, not exhaustive. The current formulas (rounds 2–3) have not been run; R3-1254 runs them to completion on a narrowed instance |

Depth 4 on `small` reaches claims, advances, pushes and a sync; a fail end's backoff and the
`blocked` it logs; a decision posted and the block it makes; a blocked end on a decision and
its provisional row. It does not reach:
- a judged snapshot (a confirmation, a stale release or a regression needs 6–8 steps);
- an `unblocked` event: the shortest route is a claim, a fail end, two ticks and the backoff
  clearing, 5 steps, and answering a decision needs a second git event, which `small` lacks;
  so `unblockedFollowsBlocked` is not exercised by the proof;
- a prerequisite on another ticket, at any depth: `small` has one ticket, so `gitDepends` and a
  blocked end on a `ticket` are never enabled;
- the fleet's rows, at any depth: `small` requires no capability and needs no resource, so no
  `capability` or `resource` row, and no lost answer, is ever written, and it never recounts
  (`FLEET`). Its state still carries the fleet's fields, so the proof's input grew with part 2b:
  the *Checked how* row gives the time measured on the head.

For those, the evidence is the simulation and the regression runs, not the proof. B-37 brings
depth 5 back, and with it the `unblocked` event.

## Bounds and assumptions

- `sim`: 3 workers (two of family `a`, one of `b`), 2 tickets, 2 overlapping sync runs, at most
  6 claims, 2 git events and 2 owner acts per run; `MAX_ATTEMPTS = 2`, `BACKOFF = 2` ticks,
  `MAX_BLOCKED = 1`, `PROV_TTL = 4` ticks; each ticket's source may name the other ticket `at`
  `reviewed`, having `reached` `pr-open`, or `done`, on the whole ticket or on `merge`. `small`: 2 workers, 1 ticket, 1 sync run, 3
  claims, 1 git event, 1 owner act. The fleet: on `sim`, `t1` requires nothing (so an emptied
  fleet can lose its answer), `t2` `db:orders:rw` (declared by `w2`, which is not granted it, and by
  `w3`, which is), and `implement` needs the resource `llm`; `small` has none of it.
- **Time** is abstract ticks: `TIMEOUT = 4`, `MARGIN = 2`, `MAX_DRIFT = 1`, at most 12 ticks
  a run. The 30-minute regression flag and the 6-hour unconfirmed flag are "eventually".
  **The drift assumption**, checked: R-BTN-6's fence holds while the worker's lag is at most
  the margin (4 minutes in the spec); above it, a reaped worker can push. R-BTN-6 computes
  `now − last_ok` on the worker's own clock, so a constant clock offset cancels; what
  `MAX_DRIFT` really bounds is how far the worker's `last_ok` lags Baton's renewal plus its
  clock's rate skew over one lease (round 2, 2-A-5) — modelled, equivalently, as a clock
  running behind.

## Not modelled, and why

- **Held histories** (R-BTN-11): a force-pushed history's held posts refresh stations exactly as
  a refresh does here; the 24-hour acceptance is an owner/clock event with no new interleaving.
- **More than one repository** (R-BTN-61): repositories share no state but workers and the
  order; the merge across them is advice, not safety.
- **Course changes and renames** (R-BTN-64): a renamed name resolves to the same edge; a removed
  one ends the claim `released:course-changed`, a release the model already has.
- **The retry policy's details** (R-BTN-122): the backoff's growth, jitter and owners' bounds,
  `max_attempts_s` and `in_claim`, and error types — a constant `BACKOFF` and `MAX_ATTEMPTS` stand
  for the policy in force. The instances that drive the core (the scenario traces and the
  model-based tests) set `BACKOFF = 0` and the counts to 100000 or 1000: the core keeps §6.10's
  per-ticket policy until B-11 builds R-BTN-122, and holds it makes are carried as the owner's.
- **Tiers and grants beyond rule 4** (rules 5–7): column comparisons with no interleaving of
  their own; matching tests cover them (G-BTN-40). Rule 4 is modelled (R3-1254 part 2b).
- **A leg's own `requires.capabilities`** (R-BTN-120) and **course `capability_types` and
  roles** (R-BTN-121): core has not built them (B-10); a leg's list joins the ticket's for that
  leg, the same check, and types and roles are the course file's acceptance (`baton course
  test`), not an interleaving.
- **Resources' scopes, instances and readings' precedence** (R-BTN-76, R-BTN-101): each resource
  is one `service` instance. Account and worker instances, `uses`, the administrator's reading
  over an instrument's, `unknown` and the per-worker answer each choose which reading is in
  force, with no interleaving of their own; the fleet's answer is still "a live worker could use
  an instance that is not `unavailable`". The needs are constant per leg, and an `end`-sourced
  need is never dropped (at the leg's next other end, or after 7 days): a lost need is gone
  when its leg is no longer the queued leg, which is how a moved ticket settles its record.
- **Which next legs a need is on** (R-BTN-76, R-BTN-77): core's `leg_needs` hold the needs of the
  station's next legs, and a reblock weighs every row the recount adds; the model's needs are per
  leg, every leg's at once, so it judges a lost answer on the queued leg — a reblock when the
  queued leg's rows were all lost, a lost need gone when its leg is no longer the queued leg. A
  row added on another next leg that was not lost, or a lost need on one, is where the two part:
  core logs the owed `unblocked` and a `blocked` where the model is silent, and keeps a lost need
  on another next leg pending where the model settles it. No run reaches that case yet: it needs
  a station with several next legs and a need on one that is not queued.
- **A worker reaped by the alarm** (`workers.reaped_at`): core's alarm times out a lapsed
  worker's fence in the same transaction that drops it from the live set, and refuses its later
  heartbeats until it re-keys. The model's alarm acts in separate steps and keeps no worker
  record, so it admits a fence report after the live set dropped the worker — a superset of
  core's interleavings, which the safety properties tolerate.
- **Other causes of a recount** (R-BTN-75, R-BTN-58): a worker registering, a grant made,
  changed or revoked, a credential revoked (`LIVE` drops it), and a post changing a ticket's
  `requires` or needs. Each is fixed here — `GRANTED`, `REQUIRES` and `NEEDS` are constants, every
  worker registered at the start — so the rows change only through declarations, liveness and
  the ends above.
- **R-BTN-39** (where a ticket is, replayed from git) is the sync's `syncRead` taking any git
  state as given; **R-BTN-40** (suspend rather than wait on the lease) is a worker's choice, so
  `endClaim(…, "suspended", …)` may happen at any point — both are modelled as nondeterminism,
  not as rules of their own.
- **Baton-raised decisions** (R-BTN-78): `baton:retries` on an `attempts-exhausted` or
  `blocked-exhausted` hold (R-BTN-122, R-BTN-126), `baton:contract`, `baton:stalled`, and the
  owner's answers to them. The model's exhaustion hold keeps the ticket from claims, as the
  spec's does, but writes no whole-ticket decision row, so it leaves `blocked_since` clear and
  logs nothing where the spec logs `blocked`, and the lift logs no `unblocked`. R3-1254's part 3
  models them (its Status names them; round 3, 3-r3-0).
- **The rest of §2g–§2m, still R3-1254's** (part 3): open-world claims (R-BTN-104), sync wants
  (R-BTN-94), `no_chain_from` (R-BTN-106), child tickets' spawned rows (R-BTN-86), `not_before`
  and leg deadlines (R-BTN-89, R-BTN-90; R3-1259 names the deadline's model change), the
  holder's reported `next` (R-BTN-83's provisional queued leg), and exhaustive liveness on a
  narrowed instance. Leg queues (R-BTN-79, now a warning) and notices (R-BTN-80, which no leg
  waits on) gate nothing, so they stay out.
