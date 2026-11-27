---
title: "Area report — §9 and §10: claims and checks, and §8's server half"
description: "One of eight area reports behind the 2026-11-24 review of the code against the simplified spec, at main 5758cdb: deprecated concepts, unnecessary complexity, missing and stale anchors, each finding at file and line."
tags: [review]
order: 5
---


Files read whole: `src/core/claims.ts` (2898 lines), `src/core/runnerApi.ts`, `src/core/runnerLiveness.ts`,
`src/core/runnerViews.ts`, `src/core/attempts.ts`; the runner and claim routes in `src/core/baton.ts`
(lines 896-1120, 1430-1450, 1885-1910); the parts of `src/core/validate.ts` and `src/core/gates.ts` that
those files call. Spec: `spec/BATON_SPEC/08-runners.md`, `09-claims.md`, `10-checks.md`, the §6.6, §6.7
and §6.9 parts of `06-…`, §7's intro and §7.4, R-BTN-35, 39, 22, 82, 100, 141, 194, and the §14 runner rows.
The history's changelog from 2026-11-19 on, its Retired requirements table and its *Migrations the
implementation still carries*. Line numbers are at `main` 5758cdb.

### A. Deprecated concepts retained

- **Tiers, everywhere in matching and the heartbeat.** `claims.ts:11, 85-87, 100, 112, 144, 361-371,
  399-407, 432-441, 465, 484-499, 552, 575, 715-719, 746-787, 798-806, 1074, 2513-2515, 2634-2656` (the
  ladder, `ceiling`, `ceilingPositions`, rule 5 in both candidate queries, `above-tier-ceiling` in
  `eligibility`'s order, the re-tier release in `staleBoard`, `tier` in `ticketView`); `runnerApi.ts:300-313,
  332-333, 342, 374-378, 424-434, 900, 958`; `validate.ts:280-281, 323, 347-358`. Retired 2026-11-23: there is
  no gate 5, and the Migrations entry *Tier fields from older clients* says a heartbeat's `tier_ceiling`
  and `tier_ceilings` are "accepted and ignored, never validated (a refused heartbeat would get a live runner
  reaped)". Today the code refuses a heartbeat with `invalid-params` when `tier_ceiling` is not one of
  `TIERS` (`validate.ts:281`) or when a `tier_ceilings` entry is off a registered repository's ladder
  (`runnerApi.ts:312`). **Covered by B-322** (its step 1 names these files). Confirmed.
- **Mirror, cutover, shadow and legacy runners.** `claims.ts:53-55, 290-296` (`cutOver`/`anyCutOver`), `665,
  749, 1154` (`cutover_at IS NOT NULL` in every candidate read and in `launchCandidates`), `968, 1258, 1472-1473`
  (`not-cut-over`), `1302, 1899, 1993, 2013, 2339` (`dispatch('mirror')`), `1902` (`DELETE FROM adoptions`),
  `2135, 2157, 2642-2668, 2701-2707, 2794` (`kind = 'legacy'` branches, `reaped:legacy`, `reap_after`), `2641`
  (`staleBoard` skips a repository not cut over); `runnerLiveness.ts:16-21, 35-40`; `runnerApi.ts:1-4,
  139-141, 518-520` (the heartbeat's `mode`), `804-862` (`mode`, `shadowReport`), `984`; routes at
  `baton.ts:941-948, 1011-1014, 1058-1061, 1092-1101`. §16 and R-BTN-28 call this legacy, removed with its code.
  **Covered by B-288**. Confirmed.
- **Signed control and brief marks.** `claims.ts:120-121, 149, 178-179, 824-826, 849, 900-930`
  (`unsignedControlBlocked`), `973-978` (the `unsigned-control` refusal), `1149, 1159, 1329-1331, 1363-1373`
  (the claim answer's `brief`); `baton.ts:975-996` (the claim route pairs and stores `control_json`) and
  `1889-1910` (`claimControl`). The 2026-11-19 changelog says no commit signature is verified. **Covered by
  B-263** (items 2-3). Confirmed.
- **Checks: the conclusions map and exit-status verdicts.** `claims.ts:1522-1527, 1653-1660, 1693-1697,
  1741-1772` (`checkVerdict`); `validate.ts:1018` (`exit_status` on an advance). §10 keeps R-BTN-114 and
  R-BTN-153 "to be removed with its code", so code and spec agree for now. No check-runner principal, check
  ticket or deliverer exists in these files. The policy read still serves `check_app_id` and `valid_until: at`
  (`baton.ts:822-826`), the shim §12.8 keeps for CLI 0.1.3 and 0.1.4. **Covered by B-290** (the map, verdict,
  knob and `check_app_id`) and B-293 (the policy document's shape). Confirmed.
- **The `resource` prerequisite as advice.** `claims.ts:25, 861-864, 986-989, 1051-1058` (`resourceAdvice`),
  `1547-1549`. **Covered by B-291**, which names all three call sites. Confirmed.
- **Posted decisions and the `decision` block kind.** `claims.ts:565-570` (rule 1 reads `ticket_blocks`
  `kind = 'decision'` and `ticket_decisions`), `1962-1964, 1971` (`blocks.raise(item, 'baton:retries')` as
  "Baton's own decision"), `2022-2042` (`syncRecord`'s `decision_answers`), `2044-2069` (runs granted by an
  answer), `2086-2117` (`resolveDecision`'s `posted` branch). R-BTN-78 is retired: "`hitl.decision`, the
  `decision` block kind and `ticket_decisions` go with it". The replacement is the person leg (R-BTN-116).
  **Covered by B-161 and B-56** (B-297 assigns these tables to them). Confirmed.
- **Detecting regression from git's path.** `claims.ts:31-32, 194, 1884-1890` (`ended_regressed`),
  `2504-2563` (`judge`'s `regressed_since`, `regressed` event, "git's shorter path wins"), `2604-2620`
  (`endShown` confirms a suspension "by a path that extends the claim's expected path"), `2227-2243`
  (`holderView`'s `git.{station,path,path_len,regressed}`), `2882-2884` (Needs you `regressed`),
  `1529-1530` (`max_runs` counted from the snapshot's `start_path`). R-BTN-39 says "No ticket file, marker, PR
  or snapshot places a ticket". R-BTN-10 says confirmation checks evidence (`std:git.evidence@1`), not
  position. The word "regressed" no longer appears anywhere in `spec/BATON_SPEC/`. **Covered by B-120**
  (choice 3, "Regression detection is retired"; choice 4, confirmation by evidence). Confirmed.
- **The interim board post's statuses and confirmations.** `claims.ts:41-42` (`GIT_ENDS` = `done,
  superseded, deferred, deprioritized`), `2119-2128` (`gitEnded`), `2444-2467` (`ownConfirmations`,
  `confirm`), and `staleBoard`'s `GIT_ENDS.has(it.status)` at `2655`; the caller is `baton.ts:1597-1609`. In
  R-BTN-35, only `closed: withdrawn` ends a claim `released:stale-board`. **Covered by B-302** row 3 (the
  interim `state.items` shape "until R3-1233"), together with B-289 for the git `status:`. Confirmed.
- **Comments and reads that serve the git lock.** `claims.ts:2140-2145` (`holdersOf`, "a session claiming
  through git (`baton tickets claim`)") and `2161-2166` (`resumeOf`, for `baton tickets claim`). **Covered by
  B-289**. Likely: the reads themselves stay as §14's board `holders` and R-BTN-24's history `resume`.
- **Couriers on the heartbeat.** `runnerApi.ts:59-61, 440-443, 525` (`couriers` and `refused_couriers`),
  `validate.ts` `checkCouriers`, wired at `baton.ts:216` to `notices.declare`. R-BTN-103 and R-BTN-80 are
  retired, and R-BTN-164 says Baton queues no notices. §8.1's heartbeat table still lists `couriers`, with
  no rule id. **Covered by B-67** (B-297 names it). **B-285 is `status: done`** with the title "Remove …
  notices and couriers", yet `src/core/notices.ts`, `admin.couriers` and the heartbeat field remain. Its
  step 1 was evidently not done. Confirmed.
- **The "worker" wire names.** `baton.ts:903-908, 1437-1445` (`X-Worker-Secret`, `?worker=`),
  `runnerApi.ts:233-252, 426, 432` (`legacyName`, `legacy_names_at`), and `502-504` (the `worker_id` alias in
  the answer). **Covered by B-69** (B-68 is in review). Confirmed.
- **One claim per runner on the heartbeat.** `runnerApi.ts:272-276, 471-476, 493-495, 508-512` (the answer's
  `claim` and the bare `session_url` / `leg_finished` / `fenced`), and `966-967` (the runners view's
  `claim`). This is documented as a Migrations entry (B-188) whose stop condition is "until no registered
  runner runs a CLI before B-188". **NOT covered by a ticket.** §8.1 also states the bare forms as a
  current rule (see Notes). Confirmed.
- **Retired fields `uses` and `bills`.** `runnerApi.ts:293-298`, `claims.ts:1254`, `validate.ts:551, 560`. This
  is the documented window *Part 4's retired fields*, whose stop is data-dependent. **NOT covered by a
  ticket.** Its `deprecated.note` writes a row outside the heartbeat's transaction (Notes 13). Confirmed.
- **`provider-suspended` and `provider-exhausted`.** `validate.ts:494, 532-533`, `runnerApi.ts:674`
  (`sendMessage`'s release reasons), `http.ts:53, 65`, `attempts.ts:16-17`. R-BTN-119's owner release reasons
  are `requested`, `owner-cancel` and `floor`. §9.4's end table lists neither name. The history says the
  `provider-exhausted` mapping was "dropped as transition machinery". **Covered by B-299** row 10 for the end
  reasons. The release-message reason `provider-suspended` is only partly covered. Confirmed.
- **A fixed activity vocabulary from the old roadmap-pr course in core.** `validate.ts:86-87, 423-441, 470`
  hard-code 15 kinds (`orient`, `review-round`, `reviewer`, `status-write` and the rest), each with its own
  detail keys. `checkActivity` requires `claim_id` for every kind but `orient`. `runnerApi.ts:765-769` parents
  a `reviewer` to the newest open `review-round`. `runnerApi.ts:784-788` derives a `reviewer-substituted`
  event. `attempts.ts:56-92` (`resumeRecord`) reads `push.branch`, `detail.pr` and `review-round` counts. §9.9
  says kinds are "the claim's course's `step_kinds` (R-BTN-50), `other`, or one of core's", that an activity
  with no claim is "checked against the step kinds of the courses the runner declares", and "Parenting. The
  reporter names `parent_id`; core infers none". R-BTN-24 says "Core reads no particular activity kind" and
  collects "every `resume` object an activity's detail carried". No `DETAIL_SCHEMAS` entry admits a `resume`
  key, so R-BTN-24 and R-BTN-25's mechanism cannot be used. Nothing rewrites the record in the 10-minute grace
  either (`upsertActivity` never calls `writeResume`). **NOT covered** (no ticket names `ACTIVITY_KINDS`,
  `step_kinds` enforcement or the `resume` key). Confirmed.
- **`operator_only` (retired rule 6) is still read and served.** `claims.ts:114, 432-441, 465, 552`,
  `gates.ts:28`, `board.ts:754-774`. `gatesFor` never reads it (it says "Rule 6 is retired"). §14's ticket read
  still names `operator_only`, so this is a dead input that the spec still serves. **NOT covered** (B-297 at
  most). Likely.
- **A runner that declares no course is stale on every course.** `runnerApi.ts:864-877` ("a sidecar from
  before R-BTN-22's change"), `claims.ts:1031-1041` (`stale-skills` for such a runner), and `2870-2881`. R-BTN-22
  says nothing of this. It is compatibility for pre-R-BTN-22 sidecars. **NOT covered**. Likely.

### B. Unnecessary complexity

- **A second candidate engine kept as a test seam.** `claims.ts:247-249` (`reference = false`), `653-738`
  (`referenceCandidates`, 85 lines of SQL restating rules 1, 3, 4, 5, 7, 8, 10, `person` and the cutover
  filter), and the `this.reference` branches at `745, 828, 1035, 1189, 1200`. Production never sets it. Every
  rule change has to be made twice, and the copy already carries retired rule 5 and the cutover gate. R-BTN-196
  needs only "The answer remembered is always the one computing it gives", which `gatesFor`'s re-check of
  every candidate already ensures (§6.6: "every gate above still runs on each"). **NOT covered**. B-237 added
  it, and B-237 is still `available` although its machinery is in. Likely.
- **Rule 4 (declared ∩ grant, `<type>:*`, `runner:`) is implemented five times.** `grantsOf`
  (`claims.ts:385-397`), the reference SQL twice (`681-695`, `698-714`), `candidates` (`751-758`), `gatesFor`
  (`gates.ts:150-160`) and `fleetView` (`claims.ts:1124-1127`). The rule is one line in §6.6 and R-BTN-174.
  **NOT covered**. Confirmed.
- **Two passes of the floor check.** `recommend` skips `canOffer` when called from `decide` (`claims.ts:865`).
  `decide` then runs `recs.find(canOffer) ?? recs[0]` followed by `refuseStopped(first)` (`1024-1027`). One
  filter is enough. **NOT covered**. Likely.
- **Null-`run_id` branches after the backfill.** `claims.ts:1395-1397, 1446, 1459, 1570, 1872` and
  `runsOf`'s types. Migration 0038 backfilled every run, and `advance` always mints one. R-BTN-63 says "Every
  run has a run id". These are dead branches ("runs from before run ids"). **NOT covered**. Likely.
- **Retries per ticket, not per leg.** `claims.ts:1917-1935` (counts claims ended since the last hold-lift
  `override`) and `1951-1981`; `attempts.ts:36-44` (`{backoff_ms, max_failed}`). §9.7 and R-BTN-122 say per
  ticket and leg in `leg_attempts`, reset also when a run of the leg reaches an outcome. §7's intro lists the
  per-leg policy as not built (Notes 2). **Covered by B-11** (and B-56 for `baton.retries`). Confirmed.

### C. Missing anchors

- `claims.ts:204` `branchMatches` implements the `*` matching of `branch_pattern`. It should cite R-BTN-141
  (§3) and R-BTN-51. It also matches any characters where R-BTN-141 allows `[A-Za-z0-9._/-]*`.
- `claims.ts:2196` `branchHolder` implements fence layer 3's query. It should cite R-BTN-26 (§9.2), R-BTN-140
  and R-BTN-141 (it cites "§6.3"). It also lacks two rules R-BTN-141 states: "names only tickets of repositories
  the asking key is granted on; any other match answers `held_by_other: true`, with no ids" (no credential is
  passed, `baton.ts:957-958`), and "Longest id wins". **Covered by B-46** ("branch-holder scoping").
- `claims.ts:1001` `decide` (the `prefer` loop, `refusals`, rule 7 before the existence check) should cite
  R-BTN-100. `claims.ts:1275-1296` (`rationale` stored in `advice_json` and history) should also cite R-BTN-100.
- `claims.ts:944` `refusal` maps gate rules to codes. It should cite §6.6's gate table (R-BTN-45); it cites §11.
- `claims.ts:1951` `applyRetryPolicy`, `1917-1935` `lastLift`/`endedSince`/`failedAttempts`, and
  `attempts.ts:19, 27, 36` `countsAsFailed`/`nonRetryableClass`/`afterFailure` should cite R-BTN-122 (§7.4) and
  §9.4's end table and §9.7. They cite §6.10, R-BTN-23 and R-BTN-78.
- `claims.ts:1992` `hold`, `2009` `setOverride` and `2074` `liftHold` should cite R-BTN-12 (§6.8). They cite
  "§8" and "§8, §11".
- `claims.ts:2269` `forceReap` and `2329` `resolve` call `checkConfirm` without citing R-BTN-155. `resolve`
  should cite R-BTN-10 and §9.6 ("an administrator confirms or releases it"), not "§6.7".
- `claims.ts:2711-2724` (the alarm's unacknowledged-release reap) should cite §6.9 (*`release`*) and R-BTN-19.
  It cites "§9".
- `runnerApi.ts:351` (the heartbeat's `hostname` bound to the credential's name) should cite R-BTN-3 and R-BTN-13.
- `runnerApi.ts:357-361` refuses with `forbidden` a heartbeat that declares a course of an ungranted
  repository. It cites "§10.1", and no current rule states this refusal. A refused heartbeat costs a runner its
  lease (§8.1's own reason for not refusing), so this needs a rule or should go.
- `runnerApi.ts:571` `recordReports` (16 reports per beat, the newest 16 keys kept, a claim report only from
  its holder, the 6-hour horizon) should cite R-BTN-99.
- `runnerApi.ts:624` `recordTranscripts` should cite R-BTN-20 (§9.9). It cites §6.8 and R-BTN-66.
- `runnerApi.ts:666` `deliver`, `677` `sendMessage` and `687` `ack` should cite §6.9 (Messages), and
  `sendMessage`'s reasons should cite R-BTN-119.
- `runnerApi.ts:708, 743` `activities`/`upsertActivity` and `runnerApi.ts:29` `CLOSE_GRACE_MS` should cite §9.9.
  They cite "§6.9".
- `claims.ts:1259-1263` (claim idempotency) has no id to cite (§9.1 is unnumbered) and keys differently from the
  spec (Notes 7).

### D. Stale or wrong anchors

- `claims.ts:565, 1962, 2073, 2081` cite **R-BTN-78**, which is retired. Use R-BTN-116 and R-BTN-122, or remove
  the comments with the code (B-161).
- `runnerApi.ts:59, 440` cite **R-BTN-103**, which is retired. Remove them with the courier code (B-67).
- `claims.ts:1694, 1749` cite **R-BTN-115** for "`done` ends alone queue a conclusion". R-BTN-115 now reads
  "Baton queues no `forge-check` entry", so the comment claims a rule the spec no longer states. Drop the
  clause.
- `claims.ts:1733` cites **R-BTN-168** (supersession, the cancel leg, unbuilt) for "rule 3's unconfirmed hold
  stands". Cite R-BTN-10 and §6.6 rule 3.
- `claims.ts:1491` says "rule `floor` and **the pins** bind an advance". Policy pins are retired (B-160;
  migration `0070_retire_policy_pins.sql`). Drop "and the pins".
- `runnerApi.ts:62-63` says "the protection reports **and pins** a heartbeat carries … and **the hashes** the
  answer carries". `baton.ts:139` says "the heartbeat's reports and pins". Pins and the three policy hashes
  are retired (B-160). Fix both.
- `claims.ts:2557` says "R-BTN-81, R-BTN-85: git's shorter path wins". This contradicts R-BTN-39, under which no
  snapshot places a ticket. It goes with B-120.
- The headers use old section numbers. `claims.ts:1-3` cites "§6.1–6.7, §7.2 rules 1–10, §11 …, §6.10–6.11" and
  "confirmation by ancestry" (R-BTN-10 is confirmation by observation; claims are §9, gates §6.6, routes §14).
  `runnerApi.ts:1-7` cites "§5, §6.8, §6.9, §9, §10.1–10.2, §11". `attempts.ts:1, 10, 26, 33` cite "§6.10" (now
  §7.4 and §9.7).
- Other old section numbers in comments: `claims.ts:30` "§7.2 rule 2" (now §6.6 rule 2), `36` "§6.7"
  (`UNCONFIRMED_FLAG_MS` belongs to §9.6), `37` "§14 Running" (V1's Running screen is retired), `1912` "§6.10, §8",
  `2187` and `baton.ts:950` "§6.3" (the branch-holder query is §9.2, R-BTN-26), `runnerApi.ts:356` "§10.1"
  (no such rule), and `runnerApi.ts:326, 107, 592` "§3" (the write budget and the one transaction are §2.3,
  R-BTN-196).
- `attempts.ts:5, 7, 33` cite R-BTN-23 alone. R-BTN-23 is not retired (it is merged into R-BTN-122, whose
  heading carries both), but R-BTN-122 is the id that owns the rule.
- §14's board read (not code) still names `holders[].worker_id`, while `holdersOf` (`claims.ts:2146-2158`) serves
  `runner_id`. The spec is stale (B-297).

### Notes

1. **The spec contradicts itself on `GET /v1/runner/launch-candidates`.** R-BTN-201 (§8.3) says the read "is
   not built". R-BTN-99 (§6.7) and §14 state it as built, and the code serves it (`claims.ts:1146-1167`,
   `baton.ts:931-940`).
2. **Retries.** §7's intro lists the per-leg `retry` policy as not built and "The one policy is the owners'
   `retry` setting, `{backoff_ms, max_failed}`". §9.7 and R-BTN-122's *State* still state the per-ticket-and-leg
   count in `leg_attempts` as built, and no such table exists. §9.7 should carry the same "not built" line as
   §7 (B-11).
3. **Wire shapes stated "once" disagree.**
   - §8.1 calls its table "the one statement of its body", but it omits `reports`, which R-BTN-99 and §14
     carry.
   - §14's heartbeat row restates `hostname`, `session_name` and `last_activity_at`.
   - §9.1 states the claim request "here once" as `request_id` and `ticket_id?`. `prefer` and `rationale` live
     only in R-BTN-100 and §14.
   - §9.1's advance reply carries "resolved inputs … and Baton's advice flags", and §14 adds `flags[]` and
     `inputs[]`. The code returns `{ok, station, next, run_id, seq, session_url_dropped?}`
     (`claims.ts:1630`): no `inputs`, no `flags`, and a `seq` (R-BTN-90's) that neither table names. Inputs
     resolved at the advance are B-39's.
4. **The claims on §8.1's heartbeat answer are not what the code serves.** The spec lists Baton's position
   (`station`, `path`, `next_leg`), `version`, `snapshot_sha`, `last_written_by`, and `next` legs with
   `not_before`. The code serves `{id, ticket_id, nonce, claimed_at}` plus `holderView`'s `{station, leg?,
   deadline_at?, git:{station, path, path_len, regressed, next}}` (`runnerApi.ts:267-270, 510`;
   `claims.ts:2227-2243`). The missing fields are B-260's, B-263's and B-120's to build. The spec states them as
   built.
5. **Stale entries in §9.1's claim response.** It lists `brief?` "(R-BTN-194)", but R-BTN-194 no longer
   mentions a brief: the mark went with signed control on 2026-11-19. It also lists `evidence` and `displaced`
   for a reconcile leg (R-BTN-39, 2026-11-21), and nothing in `src/core/` builds reconcile legs.
6. **`unknown-ticket` is never sent.** §9.1 refuses a ticket Baton has not seen as `not-eligible`
   (`unknown-ticket`). The code answers `not-eligible`, rule 1, `rule_code: not-ready` ("has no leg to claim",
   `claims.ts:980`), and `invalid-params` for an unknown `prefer` entry (`1005`). No code emits
   `unknown-ticket`. NOT covered.
7. **The idempotency key.** The spec keys it "by `(runner_id, request_id)`". The schema has
   `request_id … UNIQUE` (0001), and the code refuses another runner's reuse as `invalid-params`
   (`claims.ts:1259-1262`). NOT covered.
8. **Who sets `reaped_at`.** §9.5 says the silence reap gives the runner `reaped_at` and "no other reap sets
   it". `forceReap` and `retireReaps` of a dead runner, and the alarm's fence lapse, also set it
   (`claims.ts:2278, 2320, 2733`). This is defensible, but the spec says otherwise.
9. **Event spellings differ from the spec.** The deadline clear is spec `fence-cleared {deadline: true}`, code
   `{by: 'timeout'}`. The admin clear is spec `{admin: <fingerprint>}`, code `{by: 'admin', admin}`. The
   force-reap actor is spec `admin:<fingerprint>`, code `owner:<fp>` with end reason `reaped:owner`
   (`claims.ts:2277`). The fence lapse itself is keyed on the runner's silence, not on
   `fence_deadline = reap + lease_timeout`. A runner that keeps beating without reporting `fenced` therefore
   extends its fence indefinitely, against "Nothing a runner does extends a fence". No `fence_deadline` column
   exists and `baton.fence-pending` is never raised. **Covered by B-299** row 8 and B-79. B-299 cites
   `claims.ts:2580-2590`, which is now `2726-2736`.
10. **Other spec and code mismatches in §9.4, §6.6 and §8.1.**
    - §9.4 says `released:cannot-finish:contract-input` is not a failed attempt and is held at once.
      `countsAsFailed` counts every `cannot-finish:*` (`attempts.ts:21`) and backs off (B-39).
    - The 15-minute `alarm:leg-timeout` reap is absent: every delivered release waits 2 hours (`RELEASE_ACK_MS`)
      (B-60).
    - `released:off-branch` and `released:floor` are missing from `RELEASE_END_REASONS`. They pass `checkEnd`
      only as an owner-bar reason, and `end()` then refuses them unless an owner bar has that reason
      (`claims.ts:1639`) (B-299 row 10).
    - §6.6's rule 10 refusal carries `until`; the code's does not (`claims.ts:951`).
    - The `wip-bound` advice flag is unbuilt, and rule 13 `rename-held` is B-301's.
    - §8.1 attributes the heartbeat's `mode` to R-BTN-193; its rule is R-BTN-28.
11. **Spec body carrying a transition.** §8.1 states the bare `session_url`, `leg_finished` and single `fenced`
    as a current rule ("A runner holding one claim may send …"). The history files the same thing as a
    Migrations window that ends.
12. **Wire shape is correct.** The run id format matches R-BTN-63: `r_` plus 26 Crockford characters, from the
    core clock and random (`db.ts:44-61`).
13. **One heartbeat write outside the transaction.** The heartbeat's other writes are in one
    `store.transaction` (`runnerApi.ts:339`), with the hashing done before it, as R-BTN-196 and `CLAUDE.md` ask.
    The exception is `deprecated.note` for `uses` (`runnerApi.ts:296-298`), which inserts a row and an event
    before `checkHeartbeat` and outside the transaction. A refused heartbeat then leaves that row behind.
14. **Ticket status discrepancies.** B-285 is `done`, but notices and couriers remain. B-237 is `available`, but
    its idle memo and lazy gating are in `claims.ts`.
15. **Prompt-injection check.** No file I read addresses instructions to a reviewer. Plan steps in B-288
    ("Check the instance first …") and the owner-quote briefs in B-322 and B-263 are directions to whoever
    implements those tickets. I read them as data and acted on none.
