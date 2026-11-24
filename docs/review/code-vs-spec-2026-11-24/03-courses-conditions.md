---
title: "Area report — §5 and §7: courses and conditions"
description: "One of eight area reports behind the 2026-11-24 review of the code against the simplified spec, at main 5758cdb: deprecated concepts, unnecessary complexity, missing and stale anchors, each finding at file and line."
tags: [review]
order: 3
---


Read: `spec/BATON_SPEC/05-courses.md`, `07-conditions.md`, `docs/standard-courses.mdx`, `spec/proposals/courses.md` and `conditions.md` (only to see what is unbuilt), the 2026-11-19..23 changelog, the Retired requirements table and "Migrations the implementation still carries". Code: every file in the brief. Each finding was checked against the rule body and the code. Tickets were read as data. None of the files contained instructions addressed to the reviewer.

The short version: the course validator and the conditions slice (R-BTN-160, R-BTN-195, R-BTN-163's list) match the spec closely. Most of the drift is in three places:
1. Placement by snapshot ("git wins"). The spec now says Baton owns the position (R-BTN-39). B-120 covers this.
2. The retired posted-decision and notice machinery (R-BTN-78, R-BTN-80), which create-pr's adjudicate and queues still run on.
3. Old § numbers, and anchors that point at proposal-only ids.

---

### A. Deprecated concepts retained

- **`max_duration` instead of `deadline_s`.**
  - Where: `src/core/course.ts:66` (`LEG_KEYS`), `:283` (bound), `:352` (person-leg refusal); `src/core/graph.ts:42-43,108,117` (`maxDuration`); readers at `src/core/claims.ts:1615-1617` and `src/runner/claimRun.ts:1435` (`deadlineS: def?.maxDuration`).
  - Spec: R-BTN-69's table and R-BTN-167 name `deadline_s` (60–604,800). The §7 intro lists the old name as "not built either".
  - Covered by B-295. Its plan lists course.ts, graph.ts, claims.ts and conditionTypes.ts. It does **not** list `src/runner/claimRun.ts:1435` or `src/dashboard/screens/courses/types.ts:118`, which reads `max_duration ?? timeout ?? deadline_s`. `timeout` is no field at all.
  - Confirmed.

- **Leg field `isolation: "session"` accepted.**
  - Where: `src/core/course.ts:66-67,293-294`, `src/core/graph.ts:24-25,107,115`.
  - Spec: R-BTN-69's field table no longer lists `isolation`, and "An unknown field is refused". But §8's heartbeat table (`08-runners.md:47`) still honours a course file's `"isolation": "session"`. The proposal lists it among refused fields. So the spec contradicts itself.
  - Covered by B-70 (isolation becomes `runner:session`) and B-298.
  - Confirmed.

- **Ticket placement by snapshot ("git wins").**
  - Where: `src/core/stations.ts:1-6` ("A cache each accepted snapshot overwrites: Baton never computes a station, and on any conflict git wins"), `:126-157` (writes the posted station/path/queued leg, the `next_source === 'baton'` guard, `git-moved`).
  - Related: `src/core/graph.ts:268-288` (`extendsPath`/`onGraph`, the old §2e off-graph rule); `src/core/history.ts:5-6` ("git stays the truth"); `src/core/board.ts:107` and `src/defaults/course-pr.ts:324` (`next_source: 'course' | 'marker' | 'inferred' | 'holder'`).
  - The marker courses' station functions (`src/defaults/ticket-state.ts:1-10`, `courses.ts:218-219`) place tickets from `station`/`next_leg` frontmatter that `close` writes.
  - Spec: R-BTN-39 says "No ticket file, marker, PR or snapshot places a ticket … The station function … never sets one". R-BTN-83 says `next_source` is `holder` | `baton` | `owner`, and "No snapshot confirms or replaces it".
  - Covered by B-120 (exit criterion "no snapshot path in src/core/ writes a ticket's station, path or queued leg") and B-149 for the marker courses.
  - Confirmed.

- **Posted decisions (R-BTN-78, retired 2026-11-01) drive create-pr's owner round and the test-gate escape.**
  - Where:
    - `src/defaults/course-pr.ts:442-463` (`roundsDecision` `review-rounds-<n>` with option `grants: {leg:'review', runs:1}`; `unreachableDecision` `run-tests-unreachable`), `:521,543` (posts `decisions`), `:704-706` (reads `baton.answers`);
    - `src/core/validate.ts:1116-1139` (`checkDecisionAnswer`, "a decision the ticket's sync posted");
    - core's `ticket_decisions` and the `grants` option handling in `blocks.ts`.
  - Spec: R-BTN-78 is retired ("`hitl.decision`, the `decision` block kind and `ticket_decisions` go with it"). One way to ask a person is the person leg (R-BTN-116). `docs/standard-courses.mdx:56-63` still documents `baton owner resolve … review-rounds-3 merge|owner|round` as the shipped contract.
  - This is standard-course behaviour (create-pr's adjudicate) carried by a core mechanism the spec retired.
  - Partly covered: B-161 deletes `ticket_decisions`. No ticket names create-pr's `review-rounds-<n>`, `run-tests-unreachable` or the option `grants` that must become person legs. That part is **NOT covered**.
  - Confirmed.

- **`baton:retries` / `baton:stalled` as decisions, not `baton.*` conditions.**
  - In my files: `src/core/validate.ts:1122-1139` (and `blocks.ts:73-107`, `claims.ts:1964-1971`, outside my list), the comments at `src/core/stations.ts:40,340-341`, and `src/core/conditions.ts:8-11`.
  - Spec: R-BTN-163 makes them `suspend` conditions named `baton.retries`, `baton.contract` and `baton.stalled`. The §7 intro concedes that "Baton's code spells the two conditions with a colon".
  - Covered by B-56.
  - Confirmed.

- **queue-over as R-BTN-80 courier notices.**
  - Where: `src/core/queues.ts:7-11,19-20,56,110-117,143-155` ("queues one notice per `owner` courier (R-BTN-80)").
  - Spec: R-BTN-79 says depth over `max_queue` "raises `baton.queue-over`, closed when the depth is back within it". R-BTN-80 and R-BTN-103 were retired by R-BTN-164.
  - Covered by B-57 (adds `baton.queue-over`) and B-67 (removes the notice).
  - Confirmed.

- **The `pr` course compatibility.**
  - Where: `src/defaults/courses.ts:383-392` (`REPLACED = {pr: 'create-pr'}`, `builtIn`/`scaffoldable`); `src/defaults/course-pr.ts:44-46,154-159,305-312,465-469,535-536`. The `!bounds.adjudicates` branch ("merge waiting on the owner") exists only for `pr`'s own file.
  - Spec: R-BTN-131 lists eight standard courses and no `pr`. No local home (baton, fieldhouse, docs) declares `pr`. Only the doc (`standard-courses.mdx:30-31`) keeps it.
  - Covered by B-43 ("No `pr` directory: `--course pr` is refused").
  - Likely.

- **Signed-control fields in the station functions' record.**
  - Where: `src/defaults/course-pr.ts:396-401` (`BatonRecord.signing_keys`, `require_signed_control`); used by `src/defaults/cli.ts:462,480,743-744`.
  - Spec: signed control was retired 2026-11-19 ("no commit signature is verified").
  - Covered by B-263.
  - Confirmed.

- **`min_worker_version` dual-read.**
  - Where: `src/core/courses.ts:176-183`.
  - Spec: the history's "Worker is runner" window.
  - Covered by B-69.
  - Confirmed.

- **The interim post's stations (docs' factory-state, "until R3-1233").**
  - Where: `src/core/stations.ts:74-89` (`interim()`, called from `baton.ts:1761`).
  - Spec: ruling 4 says docs has cut over. §4.4 has no interim shape.
  - Covered by B-302 (item 3).
  - Confirmed.

- **Retired or never-emitted history and discrepancy names.**
  - Where: `src/core/history.ts:16-18` keeps `decision-opened`/`decision-answered` (R-BTN-78), `git-moved`/`regressed` (B-120 retires regression), and `position-confirmed`/`position-replaced`/`re-routed`, which nothing writes. `:24-25` `DISCREPANCY_SUBS` keeps `foreign-write` (retired with S-BTN-25/G-BTN-50), `route-overridden` and `position-replaced` (never emitted), `regressed` and `off-graph` (not in R-BTN-85's table), and `position-disagrees` (B-289). It lacks `output-invalid`, which R-BTN-85 lists.
  - Spec: R-BTN-81's row list and R-BTN-85's five subs.
  - Partly covered: B-120 (`position-replaced`, regression, `git-moved`), B-289 (`position-disagrees`), B-161 (decision rows), B-39 (`output-invalid`). `foreign-write` and `route-overridden` are **NOT covered**.
  - Confirmed.

- **Retry state per ticket, not per ticket and leg.**
  - Where: `src/core/attempts.ts:4-44` (`BACKOFF_MS = [1h, 4h]`, `ATTEMPTS_HOLD_AT = 3`, `afterFailure(count, {backoff_ms, max_failed})`). It is applied through `ticket_overrides.retry_after` (`claims.ts:1973-1977`; `courseView.ts:86,94,117`). No `leg_attempts` table exists in any migration.
  - Spec:
    - R-BTN-122 "State": "Attempts are counted **per ticket and leg** … in `leg_attempts`", default `max_attempts` 3 and `backoff_s` 3600 with ±10% jitter.
    - §9.7 says the same, as built.
    - The §7 intro only marks the per-leg *policy* unbuilt. The state bullet and the default (code uses 4 h on the second failure, and no jitter) are stated as built.
  - Covered by B-11 and B-56.
  - Confirmed.

- **Retired markers file still described.**
  - Where: `src/defaults/pr-close.ts:10-17` (`.baton/markers.jsonl`, `commitMarkerOnDefault` in `course-markers.ts`); `src/defaults/pr-verify.ts:16,30` (``course-markers`' `exec` shape``). Neither file nor function exists any more. B-100 (done) moved the state into frontmatter (`pr-close.ts:116` calls `closeTicket`).
  - The shipped-course contract says the same: `docs/standard-courses.mdx:361-373,519-523` tells readers each close "appends a line to `.baton/markers.jsonl`".
  - **NOT covered.**
  - Confirmed.

- **`handler` accepted on a condition report.**
  - Where: `src/core/validate.ts:1021-1027,1060`.
  - Spec: R-BTN-160's body is `{type, disposition, restarts, default?, severity?, url?}`. `handler`/`handler_id` exist only in the proposal (conditions §1).
  - **NOT covered** (B-58 would build it).
  - Likely; low impact.

### B. Unnecessary complexity

- **`checkDecisionAnswer` refuses not-built answers one by one.**
  - Where: `src/core/validate.ts:1127,1136`. It refuses `baton:contract` "with leg contracts (B-39), not yet" and `answer: 'route'` "needs the owner's re-route (B-38), not yet", carries an unused `leg` key, and has a third branch for sync-posted decisions.
  - What R-BTN-163 says: `baton.*` resolves with `retry` or `park`. `route:<leg>` exists only in the proposal (conditions §3). Once posted decisions go (above), this reduces to one check.
  - Partly covered by B-56 and B-161.
  - Confirmed.

- **Two parallel timeline walks in `timelineOf`.**
  - Where: `src/defaults/course-pr.ts:230-283`. There is a gate and a no-gate branch, and the no-gate branch serves only `create-spec` and the legacy `pr` file. `boundsOf`/`SPEC_BOUNDS`/the `PrBounds.adjudicates`/`gate` knobs (`:291-321`) exist mainly to keep `pr`'s reading alive.
  - What the spec says: R-BTN-131 shapes nothing here; the contract is in the docs. Dropping `pr` (B-43) removes `adjudicates: false`. Fact legs (B-311) replace much of this walk.
  - Covered by B-43 and B-311.
  - Likely.

- **Snapshot-placement guard machinery.**
  - Where: `src/core/stations.ts:126-146` (the `next_source === 'baton'` "as far" guard using `toEnd` and `onGraph`) and `graph.ts:268-288`. This complexity exists only because snapshots still place tickets.
  - What R-BTN-39 says: Baton's own record is the position, so none of it is needed.
  - Covered by B-120.
  - Confirmed.

- **`capability_types` entries only partly shape-checked.**
  - Where: `src/core/course.ts:135-149` checks `description` and `values` but does not refuse other keys.
  - What the spec says: R-BTN-121's `"from": "executor"` passes silently and is never read, while R-BTN-69 says "An unknown field is refused". Either refuse unknown keys or build `from`.
  - B-184 builds `from: executor`. The silent acceptance is **NOT covered**.
  - Confirmed.

### C. Missing anchors

- `src/core/course.ts:282-286` (`validateCourse`, leg bounds): `max_runs` ≥ 1 should cite R-BTN-63/R-BTN-69. `max_queue` 1–10,000 should cite R-BTN-79. `max_duration` 60–604,800 should cite R-BTN-167. `version` and `replay_safe` should cite R-BTN-82/R-BTN-84.
- `src/core/course.ts:490-509` (`renames`): implements R-BTN-142's refused-file list (and R-BTN-64). It cites neither. It also skips part of the rule; see Notes.
- `src/core/course.ts:467-488` (inputs resolve to a leg's declared output): should cite R-BTN-82 / R-BTN-69 ("every `inputs.from` names a leg and one of its outputs").
- `src/core/course.ts:530-541` (reachability, `no-end`, `terminal`) and `:543-567` (unbounded cycles): only the file header cites R-BTN-69. Add R-BTN-69 inline at each refusal rule.
- `src/core/course.ts:462-465` (`short_waits`): should cite R-BTN-72 (R-BTN-69's table names it).
- `src/core/courses.ts:284-293` (`apply`, the required-bar refusal): cites R-BTN-67. The rule that refuses a file lacking a leg a required bar names is R-BTN-142 (§5.6).
- `src/defaults/agent-words.ts:1-14` (`splitWords`): implements R-BTN-131's "each command string splits into words as `sh` would, with no substitutions". It should cite R-BTN-131 (see D for its R-BTN-74).
- `src/defaults/courses.ts:35-71` (`LegStub.verify`, `pushes`, `delivered`): implements R-BTN-131's "A stub whose leg claims a PR verifies it on the forge … A stub reports failure and never retries". It cites tickets (B-81, B-231, B-257) but not R-BTN-131.
- `src/core/attempts.ts:19-25` (`countsAsFailed`): implements §9's end table and §9.7 (failed attempts). It should cite R-BTN-122 (§7.4) and the §9.4 table, not "§6.10".
- `src/core/graph.ts:128-145` (`toEnd`): implements `to_end`, which §6.6 matching cites as R-BTN-69. Its comment says "§2e".

### D. Stale or wrong anchors

- `src/core/course.ts:100,218` cite R-BTN-162 for "`wait_s` ≤ 900". R-BTN-162 is not built (proposal). The 0–900 bound is stated in R-BTN-160's *Declaring*. Cite R-BTN-160.
- `src/core/validate.ts:803-805,818` say `done` takes no `spawned` because "its open children are superseded by the close, R-BTN-168". R-BTN-168 (§7.7) says "Baton supersedes no ticket". The refusal itself is right per R-BTN-86 (`done` with `spawned` is `invalid-params`). Drop the supersession claim and cite R-BTN-86 only.
- `src/defaults/course-pr.ts:539` cites R-BTN-78 (retired) for "the decision posted". `src/core/stations.ts:40,341` cite "R-BTN-78's `BATON_WAITS`" and "`baton:stalled` counts posted waits only (R-BTN-78)". Both belong to R-BTN-167/R-BTN-163 now. `src/core/validate.ts:1116` also cites R-BTN-78. check-spec already warns on R-BTN-78.
- `src/core/queues.ts:9,19,110` cite R-BTN-80 (retired). The behaviour belongs to R-BTN-79, and the notice is to go.
- `src/core/attempts.ts:1,5,7,34` cite only R-BTN-23. R-BTN-23 is merged into R-BTN-122 (heading "R-BTN-122 / R-BTN-23"), so cite R-BTN-122. `:1,11,27` say "§6.10", which is now "How a leg runs: the course's choice"; use §7.4 / §9.7.
- `src/defaults/agent-words.ts:2` says "the documented interface (R-BTN-74)". R-BTN-74 is the ticket source and station function. `agent_command` is R-BTN-131's.
- `src/defaults/courses.ts:150-153` ("Until person legs (R-BTN-116) are built, the owner's answer is a wait on the `owner`"): person legs are built. create-pr's `confirm` uses them, and `questions.ts` implements R-BTN-116. Reword: the `decision` course has not moved onto one yet (B-149).
- `src/defaults/pr-markers.ts:13-14` names "the `branch` course's `Baton-Verdict` family (R-BTN-96)". The `branch` course does not ship; it exists only in the courses proposal §4/§8.
- `src/core/course.ts:374-377` says "`call` and `arrives` are not built". `arrives` is now an R-BTN-69 table field, stated as built (see Notes), so the comment and the spec disagree.
- **Old § numbers.** None of these match the current numbering:
  - `§2a`: `courses.ts:1`.
  - `§2b`: `defaults/courses.ts:5`, `course-pr.ts:7`, `pr-verify.ts:11,102`. The boundary is §1 R-BTN-50.
  - `§2e`: `course.ts:1`, `courses.ts:2`, `graph.ts:1,65,269`, `stations.ts:1,132,147`, `course-pr.ts:770`. Now §5.2/§5.3.
  - `§2f`: `course-pr.ts:1`, `pr-verify.ts:2`. Now §4.2.
  - `§2g`: `queues.ts:1`. Now §5.4.
  - `§2h`: `history.ts:1`. Now §4.7.
  - `§6.13`: `defaults/courses.ts:39`, `pr-close.ts:2`. No such section; suspension is R-BTN-71 §5.3 and R-BTN-72 §8.3.
  - `§6.10`: `attempts.ts:1,11,27`.
  - `§6.5`: `conditionTypes.ts:36`, "§6.5's `cannot-finish` classes". Those are §9.4's table; §6.5 is "Waiting for a time".
  - `§6.8`: `course-pr.ts:93,502`, "the answer itself carries the run, §6.8". §6.8 is expedite/hold; the grant was R-BTN-78.
  - `§7.1` as the board post: `courses.ts:2`, `stations.ts:2,240`, `course.ts:73`. §7.1 is now Raising a condition; use §4.4 (and §6.4 R-BTN-116 for `asks`).
  - `§10.4` as the free-text rule: `course.ts:2,211,221,257,396`, `courses.ts:48,160`, `validate.ts:1052`, `pr-verify.ts:309`. §10 has no subsections now; the rule is §12.3.
  - `§12.5` for role expansion: `graph.ts:29,77,149,213`. §12.5 is now the local host; capability roles are §12.6.
- **Stale module names.** `pr-close.ts:11-17` and `pr-verify.ts:16,30` cite `course-markers.ts` / `commitMarkerOnDefault`, which no longer exist (see A).

### Notes

**Where the spec states unbuilt behaviour as built** (ruling 1 not applied):

1. **Fact and reconcile legs.** R-BTN-69's table (`05-courses.md:81-82`) lists `reconciles` and `arrives` as course-file fields. R-BTN-39 (`01-what-baton-is.md:84-140`) and R-BTN-203 (`04-tickets-syncs-board.md:223-273`) describe fact arrivals, `std:evidence@1`, the reconcile leg and `reconcile-queued` as built. The validator refuses both fields: `LEG_KEYS` at `course.ts:66-67` has neither. No core code applies a sync `std:arrival@1` or keeps evidence: `questions.ts:197-199` records every non-decision attestation `arrival-unapplied`. `docs/standard-courses.mdx:94-185`, now the standard courses' contract under ruling 2, lists fact legs and reconcile legs for create-pr, review-pr and create-spec that `CREATE_PR_COURSE`, `REVIEW_PR_COURSE` and `CREATE_SPEC_COURSE` (`course-pr.ts:77-152`) do not have. Covered by B-311 (available) and B-120, but the spec and the contract doc should mark it proposed.
2. **R-BTN-83 contradicts R-BTN-39.** R-BTN-83's "Missing from a snapshot: If a board post places a ticket at a non-end station with no queued leg" presumes snapshot placement, which R-BTN-39 says never happens. It describes today's code (`stations.ts:173-184`, `conditions.ts:84-111`).
3. **R-BTN-121's capability-type check.** "Baton accepts the file only if every capability a leg lists … is of a declared type with a matching value" is not built: `course.ts:131-134` says it is "B-10's acceptance". Typed-from-executor capabilities are not built either (B-184).
4. **R-BTN-122's state.** The state bullet, the `leg_attempts` table and the default `backoff_s` 3600 ±10% are stated as built; the code is per ticket with 1 h/4 h (A above). §9.7 repeats it.
5. **contract-input as a failed attempt.** §9's end table says `released:cannot-finish:contract-input` is not a failed attempt and holds at once. `attempts.ts:21` counts every `cannot-finish:*` as failed, and `nonRetryableClass` (`:28-32`) holds only `capability`/`spec`, so contract-input is retried with backoff. The §7 intro only says `baton.contract` is not raised. Covered by B-39 (likely).
6. **"Run under every preset".** R-BTN-131 says standard courses "run under every preset". The five marker courses commit to the default branch, which `no-runner-lands` forbids. Covered by B-149.

**Spec rules the code breaks (not ticketed):**

7. **R-BTN-131, create-spec's merge.** The rule: "A stub whose leg claims a PR verifies it on the forge before it reports a position: … a merged change every PR of the ticket merged and none open". create-spec's `merge` stub (`src/defaults/courses.ts:364`) has no `verify: 'merged'`; create-pr's has it (`:263`). This is the B-259 failure mode the create-pr comment at `:260-262` describes. **NOT covered.** Confirmed.
8. **R-BTN-142 is only half built.** The refused files include "a leg's `renamed_from` naming a station or a station's naming a leg". `renames()` (`course.ts:492-509`) checks each kind only against its own current names; `test/unit/course.test.ts:349-354` tests only same-kind. **NOT covered.** Confirmed.

**Small spec/code mismatches near my area:**

- §4.1/§4.4 give the registry entry `skill?`, but `courses.ts:184` requires it.
- The registry entry's `facts` (`courses.ts:223-231`) is not in §4.4's registry shape.
- `91-decisions.md:140` records a per-leg `agent_command` precedence that R-BTN-131 (built) does not have: built is the home's `agent_command`, else the harness command. It belongs with the proposal (courses §4).

**docs/standard-courses.mdx beyond item 1** (ruling 2 made it the contract, so these matter):

- It still documents `markers.jsonl` (A above).
- It documents `baton request … [--tier T]` (`:201`), but tiers were retired 2026-11-23.
- It documents create-pr's owner round as a posted decision answered with `baton owner resolve` (`:56-63`), on R-BTN-78, which is retired.
- It uses the old CLI names `baton request`, `baton run`, `baton tickets check|done`. These are covered by B-23/B-157 and match the code.

**Unshipped courses.** `epic`, `branch`, `ask`, `deliver`, `announce` and `draft-doc` have no half-built code in `src/` or `cli/`. Nothing cites R-BTN-124, R-BTN-169 or R-BTN-203. The only trace is the `branch` comment in `pr-markers.ts`. The validator refuses `cancel`, `kind: call`, `retry`, `stalled_s` and `requires.tickets|resources` as unknown keys, which is consistent with §5 and §7. The cancellation flag (`cancelling_at`), supersession and the cancel leg are absent from the code, which is also consistent. `spawns.lifetime` is accepted and unread, as R-BTN-168 says.

**`stalled_s`.** It is a constant 72 h (`blocks.ts` `STALLED_AFTER_MS`), as R-BTN-167 says.

**`max_queue`.** It is built as R-BTN-79 describes, except that it uses retired notices instead of the condition. No standard course sets it.

**B-110 status.** B-110 is still `available` although its run-tests gate and owner round are in the code. Ticket status lag; not acted on.

**Outside my area, seen in passing.** `src/core/claims.ts:362` still selects `tier_ceiling, tier_ceilings`, and migration 0065's `ready_tickets` keeps `tier_position`. Tiers were retired 2026-11-23; the migration window in the history covers this.
