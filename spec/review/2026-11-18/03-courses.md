---
title: "Adversarial review 2026-11-18 — §5: courses"
description: "One reviewer's findings, as filed, on BATON_SPEC §5."
order: 12
tags: [review]
---

# Adversarial review 2026-11-18 — §5: courses

Read whole: `05-courses.md` lines 1–1102, `docs/context/architecture.mdx`, `docs/context/vocabulary.mdx`.
Followed into their homes: R-BTN-39, R-BTN-33, R-BTN-35, R-BTN-50, R-BTN-66 (§1); R-BTN-51, R-BTN-48, the board post (§4.1, §4.4);
R-BTN-116, the gates table and pipeline, R-BTN-178 (§6); R-BTN-122, R-BTN-167, R-BTN-90, R-BTN-165, R-BTN-168, the core conditions table (§7);
R-BTN-72's result/reactions paragraphs (§8); R-BTN-181's standard types, R-BTN-192, R-BTN-182's head (§12); the `courses`, `ticket_stations`,
`ticket_next_legs`, `claim_legs`, `leg_outputs` rows (§13); S-BTN-28/37/41/47 and G-BTN-63/64/67/73 (§15).
All paths below are under `spec/BATON_SPEC/` unless they start with `docs/` or `src/`.

Counts: critical 0 · high 2 · medium 9 · low 6.

---

### CRS-1: `create-pr` is defined three ways — the table, the facts paragraph and the fact-leg paragraph disagree on its legs, a leg's `from` and a station
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-131, R-BTN-69 (validation), R-BTN-184, S-BTN-41-adjacent scenario at `15-verification.md:122`
- **Confidence:** high
- **Evidence:**
  - `05-courses.md:687` — "`create-pr` (the default) | `implement` (`filed` → `pr-open` \| `delivered`); the person leg `confirm` …; `review` (`pr-open`, `fixed` → `reviewed`, `max_runs` 3); `fix` (`reviewed` → `fixed`, `max_runs` 2); `adjudicate` (`reviewed` → `adjudicated`); `merge` (`reviewed`, `adjudicated` → `merged`); and the fact legs `reviewed-by-hand` (`pr-open`, `fixed` → `reviewed`, `pr-verdict`) and `merged-by-hand` (`pr-open`, `fixed`, `reviewed`, `adjudicated` → `merged`, `pr-merged`)"
  - `05-courses.md:716` — "Its `run-tests` gate runs no agent: the stub runs the course file's `test_script` on the home PR's head, and the script's own exit is the verdict, green queuing `review` and red `fix`"
  - `05-courses.md:726` — "an untested home head queues `run-tests`"
  - `05-courses.md:731` — "A `fix` run from the gate's red (`pr-open`, `fixed`) must push"
  - `05-courses.md:834` — "`merged-by-hand` (`from: [pr-open, fixed, reviewed, adjudicated, human-merge]`, `to: merged`, `arrives: {fact: pr-merged}`)"
  - `05-courses.md:838` — "a human's landing of a control path at `human-merge` included (R-BTN-184)"
  - `05-courses.md:153` — "every station is reachable from `start` through any outcome"
- **The problem:** (a) `run-tests` is something that is "queued", has a stub, suspends "with `review` next" and returns a position (`15-verification.md:122`: "the run-tests stub returns `{reached: <station>, next: review, suspend: true, tests: ci}`") — a leg — and the legs table has no such leg, no `from`, no `to`, no `max_runs`. (b) The table gives `fix` the single `from` `reviewed`; the prose runs `fix` "from the gate's red (`pr-open`, `fixed`)", stations the table's `fix` does not leave, so that `advance` is `off-graph` under R-BTN-63. (c) `merged-by-hand` leaves four stations in the table and five in the paragraph; the fifth, `human-merge`, is the `to` of no leg anywhere in the spec (the only other mention is `15-verification.md:262`, "the first ends at `human-merge`"), so a `create-pr` file carrying it fails R-BTN-69's own reachability check, and one not carrying it cannot do what line 838 says. (d) `test_script`, "the course file's", is not a field of R-BTN-69 (see CRS-7). An implementer cannot write the `create-pr` `course.json` from this rule.
- **Counter-reading considered:** `run-tests` might be a sub-step inside `review`'s stub rather than a leg. It fails: line 726 "queues `run-tests`", line 728 "it suspends at its station with `review` next", and `src/defaults/courses/create-pr/run-tests.md` (a per-leg instruction file) all treat it as a leg. Searched `human-merge`, `run-tests`, `test_script` across `spec/BATON_SPEC/*.md`; no definition found.
- **Smallest fix:** make the table row the one home: add `run-tests` with its `from`/`to`/`max_runs`, give `fix` its real `from`, and either add the leg that reaches `human-merge` (citing R-BTN-184) or delete it from line 835 and line 838.

### CRS-2: Standard-course prose has git facts "queue" legs and "place" tickets; R-BTN-39/83 forbid it and no rule supplies the mechanism R-BTN-83 alludes to ("displace")
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-83, R-BTN-39, R-BTN-70, R-BTN-131, R-BTN-72 (`not-queued`)
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:222` — "**Three sources queue a leg.** The queued leg's `next_source` says who chose it: `holder` … `baton` … or `owner`"
  - `05-courses.md:227` — "Four of these are **held** in `ticket_overrides` until the ticket's station changes …, so that a later snapshot's readiness for another leg does not displace them"
  - `05-courses.md:220` — "No snapshot confirms or replaces it (R-BTN-39)"
  - `01-what-baton-is.md:132` — "The sync posts these as its attestations (R-BTN-191). It never sets a position."
  - `05-courses.md:829` — "they never place a ticket"
  - `05-courses.md:753` — "while the ticket has no PR and its newest `implement` run reached `delivered`, places it there with `confirm` queued"
  - `05-courses.md:728` — "it suspends at its station with `review` next, and the sync places the ticket from that CI"
  - `05-courses.md:723` — "any concluded other than `success`, `neutral` or `skipped` is red and queues `fix`"
  - `08-runners.md:227` — "a first `advance` into any other leg is refused `not-eligible`, rule `not-queued`"
  - `05-courses.md:237` — "matching rule 1 offers that leg alone"
- **The problem:** Two incompatible readings. (1) A snapshot's readiness can change which leg is queued — then R-BTN-83's "held … so that a later snapshot's readiness … does not displace them" makes sense, but no rule says when or how a snapshot rewrites `ticket_stations.next_leg`, the sync is not among the "three sources", and `next_source` has no value for it (`13-data-model.md:119`: "`holder`\|`baton`\|`owner`"). (2) Nothing but holder/baton/owner queues a leg — then the "held" distinction is vacuous, and every sentence of R-BTN-131 in which a fact "queues" a leg with no holder reporting it and no fact leg declared is false. Trace under reading 2: the `run-tests` stub ends `suspended` "with `review` next"; the sibling repository's CI turns red; line 723 says this "queues `fix`"; but the queued leg is `review` (`next_source: holder`), `fix` is not offered (rule 1 "offers that leg alone") and a claimant advancing into it is refused `not-queued`. Only the owner's route moves it. Same for "a push after it reaches `fixed`" (line 713) when a human pushes: `create-pr` declares no `pr-pushed` fact leg, so nothing arrives.
- **Counter-reading considered:** "queues" in R-BTN-131 is loose wording for "the station function posts that leg `ready`, and the next holder names it". That fails where the holder's `next` is already recorded (the suspension above) and rule `not-queued` binds the next claimant to it. Searched `displace`, `provisional queued`, `not-queued`, `next_leg` in §1, §4, §6, §8, §9, §13; G-BTN-73 (`15-verification.md:319`) repeats the hold but states no displacement rule either.
- **Smallest fix:** in R-BTN-83 say outright that readiness never changes the queued leg (and drop the "displace" clause), or state the rule by which it does and give it a `next_source`; then rewrite each "queues"/"places" in R-BTN-131 to name the holder's `next` or a declared fact leg.

### CRS-3: A queued leg whose `max_runs` is spent has no rule: either a silent stall or a claim/refuse/suspend loop, and no condition tells the owner
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-63, R-BTN-70, R-BTN-83, R-BTN-167, R-BTN-165, R-BTN-124, §6.6 rule 1
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:252` — "then starts `leg` if it leaves `reached`, … the ticket's runs of it are fewer than its `max_runs`"
  - `06-prerequisites-blocks-advice.md:439` — "Claim: the queued leg … is `ready` as posted … Advance: the new leg is an edge from the claim's station within its run limit" (the run limit is tested at the advance, not at the claim)
  - `08-runners.md:245` — "a gate's refusal or a `max-runs` refusal suspends at the station reached"
  - `05-courses.md:207` — "`next` a leg whose `from` includes `reached` — null at an end, required elsewhere"
  - `07-conditions.md:449` — "only while the sync's readiness attests the leg `waiting`"
  - `05-courses.md:1069` — "\"planned\": &#123;\"of\": \"all\", \"closed\": true, \"next\": \"replan\"&#125;" with `05-courses.md:1063` — "`replan` (`planned`, `max_runs` 2)"
- **The problem:** `epic`: `replan` has run twice; a child is withdrawn again; Baton settles the call at `planned` and queues `replan` itself (`next_source: baton`). The leg has no runs left. If the station function posts it `ready`, a runner claims (rule 1 at a claim does not read the run limit), its first `advance` is refused `max-runs`, it "suspends at the station reached" naming a `next` (required), which can only be `replan` — and the ticket is claimable again at the next snapshot, indefinitely. If the station function, following R-BTN-70's "that the ticket may still run", posts no row for it, the ticket is never offered and `baton.stalled` never fires (its clock runs only while the leg is attested `waiting`). Neither branch raises a condition; `baton.retries` is about failed attempts, and a suspension is not one. Any course whose only leg out of a station is bounded reaches the same state (`draft-doc` `write`, `build-app` `report`, `review-pr` if `conclude` is not named).
- **Counter-reading considered:** the owner's route "restarts its run count" (line 235), so the state is leavable. True, which is why this is medium — but nothing notifies the owner, and R-BTN-63 says "`max_runs` bounds the runs made without a person: … a person's intervention is what the bound waits for" without any rule that asks for the person. Searched `max_runs`, `max-runs`, `run limit`, `runs left` in every section: only R-BTN-63, rule 1, `08-runners.md:245`, R-BTN-39's `next` default and G-BTN-67.
- **Smallest fix:** in R-BTN-63: a ticket whose queued leg has no runs left is stored `waiting` on `max-runs` in the transaction that queues it or records the last run, and raises a named `suspend` core condition whose restarts are `route:<leg>` and `retry` (the count restart).

### CRS-4: `max_runs` on a person leg or a fact leg bounds nothing, so "every cycle contains a leg with `max_runs`" is satisfiable by a cycle Baton never bounds
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-69 (validation), R-BTN-63, R-BTN-39, R-BTN-116, R-BTN-131 (`confirm`, `address`)
- **Confidence:** high
- **Evidence:**
  - `05-courses.md:155` — "every cycle contains a leg with `max_runs`"
  - `05-courses.md:133` — "`max_runs` | leg | how often one ticket may run it"
  - `05-courses.md:687` — "the person leg `confirm` (`delivered` → `confirmed` \| `filed`, `asks: owner`, `max_runs` 3)"
  - `05-courses.md:694` — "`address` (`reviewed` → `spec-open`, the owner's conversation, `arrives: {fact: pr-pushed}`, `max_runs` 3)"
  - `01-what-baton-is.md:139` — "Baton applies an arrival, in the transaction that accepts the attestation, when all hold: its writer is one the policy's `attestations` entry for the type admits; the leg leaves Baton's current station …; `reached` is one of its outcomes; no claim is active on the ticket; and Baton holds the ticket for nothing else"
  - `06-prerequisites-blocks-advice.md:333` — "no claim ever runs it"
- **The problem:** The run limit is tested only where an `advance` starts a leg. A person leg and a fact leg are never started; R-BTN-39's list of what must hold for an arrival is closed and has no run-count term. So the fourth `confirm` answer and the fourth `address` push are applied, and the standard courses' `max_runs` 3 on them does nothing — or an implementer adds an unstated check and a human's fourth push is silently `arrival-unapplied`. Either way the validation rule is hollow: a course `x: a → b` (runner leg, no `max_runs`), `y: b → a` (`arrives: {fact: pr-pushed}`, `max_runs: 1`) passes, and since `pr-pushed` is "a push to the ticket's PR after the leg began leaving the ticket's station" (`12-security.md:788`), which `x`'s own runner makes, the loop runs unattended without bound. In `create-pr`, the cycle `implement` → `delivered` → `confirm` → `filed` is "bounded" only by the person leg.
- **Counter-reading considered:** R-BTN-63 counts "every fact arrival Baton applied" toward the counts, so the bound might be enforced at the arrival. No rule says an arrival past the count is refused, deferred or unapplied, and R-BTN-39's `next` default ("the first leg the course file lists leaving `reached` with runs left under `max_runs`") reads counts only for the leg queued after. Searched R-BTN-39, R-BTN-116, R-BTN-192 for a run-count condition.
- **Smallest fix:** state in R-BTN-39 whether an arrival on a leg at its `max_runs` is unapplied (and what is raised); and make the cycle rule require a `max_runs` leg that a claim runs, or accept a person leg explicitly and exclude fact legs.

### CRS-5: A refused or held course file still governs the runner: Baton enforces the previous file while the runner loads the snapshot's
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-69, R-BTN-134, R-BTN-63, R-BTN-142, R-BTN-22/65, R-BTN-64
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:99` — "the runner loads the same file at each claim's snapshot"
  - `05-courses.md:174` — "A file that fails keeps the previous one in force and raises `baton.course-refused`."
  - `05-courses.md:514` — "A file is held — the previous stays in force and `baton.course-held` is raised"
  - `05-courses.md:68` — "the runner at the claim's `snapshot_sha` after R-BTN-143's check, re-verification at the commit it verifies — so Baton, runner and runner use the same bytes"
  - `05-courses.md:294` — "An `advance` is checked against the newest snapshot's course file."
  - `05-courses.md:611` — "Rule 9 is checked at a claim, never at an `advance`, so a held claim finishes under its protocol."
  - `08-runners.md:245` — "an `off-graph` refusal or heartbeat `station: unknown` (R-BTN-64) finishes or abandons the leg and ends `released:course-changed`"
  - `05-courses.md:634` — "ends `released:course-changed` — not a failed attempt, needing no confirmation"
- **The problem:** Baton accepts the snapshot and refuses or holds only its course file, so `snapshot_sha` names a commit whose `course.json` is not the file in force. (1) "Same bytes" is false exactly then: the runner's graph, `requires`, `agent_command`, `deadline_s` and leg scripts are the refused file's; Baton's gates (rule 4's `leg_capabilities_json`, edges, bars) are the previous file's. (2) Trace with R-BTN-142: an owner bar names leg `deploy`; a commit renames it `ship`; Baton holds the file. Every later claim on the course loads `ship`, advances into it, is refused `off-graph` (the file in force has no `ship`), and ends `released:course-changed` — no failed attempt, no backoff, "needing no confirmation" — so the ticket is at once claimable and the fleet cycles on it until an owner acts. (3) Line 294 says "the newest snapshot's course file", lines 174/514/241 say the file "in force"; these differ in the refused/held case and an implementer must pick. (4) Line 611's "finishes under its protocol" is contradicted by line 294 for any mid-claim edge change. (5) "keeps the previous one in force" has no answer for a course's first post being invalid.
- **Counter-reading considered:** the claim response could carry the commit of the file in force and the runner load that. `14-api.md:73` lists `course_version` and `snapshot_sha` only, and line 988 says the runner loads the course "from the claim's `snapshot_sha`". Searched `in force`, `course-refused`, `course-held` in §4, §8, §9, §13, §14: `baton.course-refused` appears only at `05-courses.md:175`.
- **Smallest fix:** refuse claims on a course whose latest posted file is refused or held (a named refusal, the course `waiting` on `course-refused`), and make line 294 read "the course file in force"; say what a first invalid post does.

### CRS-6: `renamed_from` is single-valued and never retired: a second rename, or dropping the field, orphans every record R-BTN-64 "resolves" instead of rewriting
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-64, R-BTN-142, R-BTN-63, R-BTN-82, R-BTN-39
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:623` — "When Baton accepts the file it rewrites every active claim's `station` and `leg` to the new names, and from then on resolves every old name it meets — an `advance`'s requested leg, `start_path`, `claim_legs` — to the station or leg whose `renamed_from` names it."
  - `05-courses.md:626` — "it rewrites every per-leg record keyed by an old name to the new one: `leg_attempts`, `ticket_timers`, `ticket_blocks`, `leg_needs`, `ticket_next_legs`, `ticket_bars`, `ticket_questions` and a held position's `route_leg` and `route_station`"
  - `05-courses.md:629` — "Runs count toward `max_runs` under the resolved name"
  - `01-what-baton-is.md:169` — "A course change that maps the ticket's station and leg by `renamed_from` needs no adopt: Baton rewrites them itself (R-BTN-64)"
  - `05-courses.md:512` — "a `renamed_from` naming a name the file still uses" (refused)
  - `13-data-model.md:137` — "`leg_outputs` | `(ticket_id, leg, run, name)`"
- **The problem:** Not rewritten, by the rule's own list: `claim_legs.leg`, `ticket_stations.station` / `next_leg` / `path` for a ticket with no claim (R-BTN-39 says they are rewritten; R-BTN-64 lists only "every active claim's"), `leg_outputs.leg`, `leg_queues`, `ticket_history`. They resolve only while the file in force carries the `renamed_from`. Trace: file v2 renames leg `review` → `check` (`renamed_from: review`); file v3 renames `check` → `verify` (`renamed_from: check`, the only value it can hold). Rows under `review` now resolve to nothing: the ticket's earlier runs stop counting toward `verify`'s `max_runs` (a pusher resets any run bound with two commits, without the owner's route or adopt that line 279 reserves the restart for), a consumer's `inputs.from: "verify.out"` no longer finds the output recorded under `review` (`input-missing`), and an unclaimed ticket still stored at a twice-renamed station "waits `course-changed`" for an adopt. Dropping `renamed_from` in a clean-up commit does the same; so does v3 re-using the name `review` for a new leg (allowed once v2's `renamed_from` is gone), which inherits the old runs. Nothing says how long `renamed_from` must stay.
- **Counter-reading considered:** "resolves every old name it meets" might mean Baton keeps its own alias table across files. The sentence ties resolution to "the station or leg whose `renamed_from` names it", i.e. the current file. Under `cooperative` a pusher can edit the course anyway (R-BTN-39), so the reset is not an escalation there; under `protected` the file is a control path. The break is the lost history for honest renames. Searched `renamed_from` in all sections: only R-BTN-64, R-BTN-142, R-BTN-39 and G-BTN-63/64/137.
- **Smallest fix:** rewrite every table keyed by a station or leg name in the accepting transaction (add `claim_legs`, `ticket_stations`, `leg_outputs`, `leg_queues`), so `renamed_from` is needed for one accepted file only, and say so.

### CRS-7: R-BTN-69's field table and "accepts a file only if" list are not the course language: fields other rules read are missing, unknown fields are unaddressed, several bounds are absent
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-69, R-BTN-182, R-BTN-181, R-BTN-190, R-BTN-131, R-BTN-165, R-BTN-122
- **Confidence:** high
- **Evidence:**
  - `05-courses.md:98` — "`course.json` in the course directory is the course's whole state machine, in a schema core owns."
  - `05-courses.md:111` — "The fields:" (table, lines 113–150)
  - `12-security.md:808` — "claims only legs its course marks `trusted: true`"
  - `12-security.md:704` — "a review leg the course marks `approves: true` and `reads_only: true`"
  - `05-courses.md:700` — "A course whose course file carries `starts_from: request` (a closed set: `request` alone)"
  - `05-courses.md:716` — "the course file's `test_script`"
  - `05-courses.md:907` — "which `verify: \"pr\"` refuses a claim without"
  - `07-conditions.md:526` — "the validator (R-BTN-69) and `baton course test` refuse a table without it"
  - `12-security.md:685` — "The validator refuses a `trusted: true` leg with a requirement that binds as `advice`"
  - `05-courses.md:1014` — "No `branch_pattern` may match `baton-legs/*` … (… the course validator refuses one that does)"
  - `05-courses.md:129` — "the leg having one outcome"
- **The problem:** (1) `trusted`, `approves`, `reads_only` (leg) and `starts_from`, `test_script`, `verify` (course or leg — not said) are read by other rules and absent from the table; three of them decide who may run a leg and whose review counts. (2) The validation list names fields it refuses but never says what an unknown field does — accepted and ignored, or refused. With "a schema core owns", a typo `trusted: ture` or `max_run: 3` silently drops a gate or a bound under one reading and refuses the file under the other. (3) Not in the "only if" list although required elsewhere or needed: `max_runs` has no type or range (0? negative?); `to` and `from` may be empty lists (a leg with `to: []` can never report an outcome); an `arrives` leg "having one outcome", its `<kind>` in the closed set, and `arrives` beside `kind` are stated in the table but not validated; `max_queue`'s 1–10,000 and `max_context`'s range are not in the list; `retry.exhausted` is "a leg leaving the same station" (R-BTN-122) but a leg with two `from` stations can name one leaving only the first; `start_leg` may be the `cancel` leg (only `next`, `exhausted` and completion `next` are barred from naming it), so every new ticket would run the cancel leg; R-BTN-165's closing catch-all, R-BTN-181's trusted-leg rule and the policy cross-check (`12-security.md:694`) are validator rules stated only in their homes. (4) Line 1014 assigns a `branch_pattern` check to "the course validator", but `branch_pattern` lives in `baton.json`'s `courses[]` (`04-tickets-syncs-board.md:21`), not the course file.
- **Counter-reading considered:** "partly built" and "one home per statement" excuse the table from repeating other rules. But the list is phrased as exhaustive ("Baton accepts a file only if:") and the table as "The fields", and the unknown-field question has no home at all. Searched `unknown field`, `unknown key`, `unrecognised`, `additional` across the spec; `trusted: true`, `approves`, `reads_only`, `starts_from`, `test_script`, `verify:` for a defining rule.
- **Smallest fix:** add the six fields to the table with their rules; add one sentence ("a field this table does not list refuses the file" or the opposite); add `max_runs` ≥ 1 with a ceiling, non-empty `from`/`to`, the `arrives` constraints, `start_leg` ≠ `cancel`, and "see also" citations for the validator rules that live elsewhere.

### CRS-8: `leg_state` in every claim response depends on `facts`, which the board post and the data model never give Baton
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-190, R-BTN-134, R-BTN-48, §4.4, §13
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:995` — "every claim response carries which (`leg_state`) … It is `forge` when the home is on a forge **or** the claimed ticket's course reads PR facts (`facts: [\"prs\"]`, R-BTN-134), and `branch` otherwise."
  - `04-tickets-syncs-board.md:529` — "registry: [&#123; id, version, min_runner_version, skill?, course: &lt;course.json with its schemas>, step_kinds, branch_pattern, previous_branch_pattern? &#125;]"
  - `13-data-model.md:46` — "`courses` | `(repository_id, id)` | `version`, `skill`, `course_json` …, `leg_capabilities_json` …, `step_kinds` JSON, `min_runner_version`, `branch_pattern` (`claude/{ticket}-*`), `previous_branch_pattern`"
  - `05-courses.md:65` — "**`facts`** in the entry names what the CLI reads for the station function: `prs` (R-BTN-96) and `branches` (git refs)"
- **The problem:** `facts` is an entry field the CLI reads; it is neither in the posted registry nor a `courses` column, and it is not part of `course.json`. On a `git` home Baton therefore cannot tell a PR course (answer `forge`) from any other (answer `branch`). An implementer either adds an unlisted field to the post and the table, or answers `branch` for every `git` home — which sends a `git`-home `create-pr` ticket's review rounds to `baton-legs/<ticket>` instead of the code repository's PR conversation, against line 999.
- **Counter-reading considered:** R-BTN-48 says the registry carries "the fields of R-BTN-51 (§4.4)", which could include `facts`. §4.4's own schema and §13's row both omit it, and they are the normative shapes. Searched `leg_state`, `facts` in §4, §13, §14.
- **Smallest fix:** add `facts?` to the registry shape and the `courses` row, citing R-BTN-190.

### CRS-9: The record courses' `closed` end is reachable only through the `cancel` leg, which the reachability check is said to ignore
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-69 (validation), R-BTN-131, R-BTN-168
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:153` — "every station is reachable from `start` through any outcome, and an end is reachable from every station, the `cancel` leg not counted"
  - `05-courses.md:179` — "so `to_end` (R-BTN-61) and the reachability check above ignore it: it is not a way to finish the work"
  - `05-courses.md:803` — "Each record course names one `cancel` leg, `close-pr`, leaving every station from the first writing leg's `to` on and reaching the end `closed`"
  - `05-courses.md:689` — "`merged`; `closed` by `close-pr`"
- **The problem:** If "the `cancel` leg not counted" governs both clauses (the natural reading of "the reachability check above ignore it"), `closed` is a station no counted leg reaches, and `bug-report`, `draft-ticket`, `decision`, `draft-doc`, `spec-to-tickets` and `build-app` are refused by the rule they are the standard examples of. If it governs only the second clause, the files pass — but then the first clause counts an edge the text says the check ignores. The two readings accept different sets of files.
- **Counter-reading considered:** the second reading is probably what is meant; the sentence does not say it, and G-BTN-63 ("a course file with unreachable stations or ends … is refused") gives no exemption. Searched R-BTN-168 for "the cancel leg's end station is exempt from reachability": not found.
- **Smallest fix:** "every station is reachable from `start` (the `cancel` leg's `to` excepted); an end is reachable from every station without the `cancel` leg".

### CRS-10: A station with `entry` cannot be entered by a fact arrival, and R-BTN-109's "checked the same way" names no outcome
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-109, R-BTN-82, R-BTN-39, R-BTN-111, R-BTN-165
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:416` — "**A fact arrival** — an `std:arrival@1` or a person leg's `std:decision@1` (R-BTN-39, R-BTN-116) — is checked the same way when its attestation is accepted."
  - `05-courses.md:409` — "Unmet is refused `not-eligible` (rule `entry`), which the runner treats as `released:cannot-finish:contract-output`."
  - `05-courses.md:342` — "The one output no claim records is a person leg's `answer`"
  - `05-courses.md:435` — "`std:arrival@1` | `{leg, reached, next?, ref?}`"
  - `05-courses.md:443` — "A course's **input** is its `start` station's `entry`; its **output** is each end station's"
  - `07-conditions.md:540` — "The settled children's end outputs are the next leg's input `called`"
- **The problem:** A fact arrival has no claim, so by line 340–342 it records no output, and its envelope has no outputs field. An `entry` on a station a fact leg reaches is therefore never met by that leg. What then: `not-eligible` is a refusal to a runner, and there is none; R-BTN-39's "when all hold" list has no `entry` term, so one reading applies the arrival anyway and the other leaves it `arrival-unapplied` forever (a human's merge that Baton never follows). It also means no standard course ending at `merged` through `merged-by-hand` can have an output, so a call over one (`build-app` over `draft-doc`) has no `called` input to read — which `build-app`'s `file` works around ("declaring no `called` input", line 863) without the rule saying why.
- **Counter-reading considered:** the sync attests `std:git.output@1` for the same run, which could satisfy the entry. Those are "recorded only if its nonce names a claim on the ticket" (line 340). Searched `entry` in R-BTN-39, R-BTN-192, §4.4.
- **Smallest fix:** say in R-BTN-109 that an arrival failing `entry` is recorded `arrival-unapplied` with reason `entry`, and let a fact arrival carry the outputs its station requires (as R-BTN-116 already lets an answer "carry a value").

### CRS-11: One unfetchable or rewritten course source stops the whole repository's board, and nothing bounds it
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-134
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:50` — "An unfetchable source fails the sync (posting nothing) or ends the claim `released:cannot-finish:transient`; a commit off the default branch, or a directory without `course.json` or `sync.mjs`, is a course fault (`spec`)."
  - `05-courses.md:44` — "the commit must be an ancestor of the fetched head — **a commit is never fetched by its id**"
  - `05-courses.md:91` — "Name only sources you would let act as your CI."
- **The problem:** The sync is per repository; one sourced course whose repository is down, renamed, made private, or whose default branch was rewritten so the pinned commit is no longer an ancestor, makes the sync post nothing — for every course and ticket of the home, the home's own courses included. No readiness, no confirmations (rule 1 needs "a snapshot … accepted after the ticket's last end"), so every suspended ticket becomes unclaimable. On the runner side each claim of a ticket on that course ends `cannot-finish:transient`; whether that spends the leg's attempts until the ticket is held is §9's, which I did not verify. The Trust paragraph covers what a source's code may do, not that its availability gates every other course.
- **Counter-reading considered:** the cache clone (line 43) survives an outage. It does for a commit already fetched, but "ancestry and cleanliness re-checked on every reuse" (line 46) against a fetched head fails after a history rewrite, and a fresh CI runner has only the CI cache. Searched for a per-course degradation of the sync (`fails the sync`, `posting nothing`): none in §5; §4.3 not read in full.
- **Smallest fix:** post the board without the unfetchable course's readiness (its tickets `waiting` on `source-unfetchable`, a raised condition) instead of failing the run.

### CRS-12: `converse` is a leg "no claim runs" and also the example of a runner's claim; `baton ticket request` says "the next claim starts the course" for a course whose start leg nobody claims
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-131
- **Confidence:** high
- **Evidence:**
  - `05-courses.md:899` — "`create-spec`'s `converse` (`requested` → `spec-open`) and `address` (`reviewed` → `spec-open`) are the owner's own sessions, which no claim runs"
  - `05-courses.md:989` — "consecutive claims of one runner — a `create-spec` `converse` and the next claim's `create-pr` `implement` — run their own course's graph and scripts"
  - `05-courses.md:700` — "the Baton places the ticket at the course's `start` with its `start_leg` queued (R-BTN-39), and the next claim starts the course (§6.1)"
- **The problem:** line 989 is the pre-fact-leg text. Line 700 lists `create-spec` among the `starts_from: request` courses, whose `start_leg` is the fact leg `converse`; no claim starts it.
- **Counter-reading considered:** none that survives; `arrives` legs are "never claimed" (line 239).
- **Smallest fix:** replace the example in line 989 with two claimable legs; in line 700, "the course's `start_leg` is queued".

### CRS-13: Dangling and wrong section references in R-BTN-131's request paragraph, and two typos that change meaning
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** R-BTN-131, R-BTN-134
- **Confidence:** high
- **Evidence:**
  - `05-courses.md:700` — "(§2f R-BTN-74's source" and "straight to the default branch (§2f;"
  - `05-courses.md:700` — "Otherwise the push triggers the sync (§7.1), the Baton places the ticket … and the next claim starts the course (§6.1)"
  - `07-conditions.md:29` — "### 7.1 Raising a condition"; `06-prerequisites-blocks-advice.md:10` — "### 6.1 Prerequisites"
  - `05-courses.md:69` — "so Baton, runner and runner use the same bytes"
- **The problem:** there is no §2f; §7.1 is about raising conditions, not what triggers a sync (§4.3); §6.1 is prerequisites, not claims (§9 / §6.6). "Baton, runner and runner" presumably means sync, runner and re-verification, and as written omits the sync, the one reader the sentence is about. (Also seen outside the span: `08-runners.md:236` cites "§10.4 free text"; §10 has no 10.4 and free text is §12.3.)
- **Counter-reading considered:** `§2f`, `§7.1`, `§6.1` may be section numbers from before the split into files; `grep -c "§2f"` finds it nowhere else.
- **Smallest fix:** cite R-BTN-74 / §4.2, §4.3 and §9.

### CRS-14: `step_kinds` is a required `courses[]` field, stored and used as an enum, and neither §5 nor the vocabulary page defines it
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-51, R-BTN-50, R-BTN-134, §9 Activities, §13 `courses`
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:21` — "courses: [&#123;id, version, min_runner_version, skill?, step_kinds, branch_pattern, …"
  - `09-claims.md:325` — "**Kinds** are the claim's course's `step_kinds` (R-BTN-50), `other`, or one of core's"
  - `13-data-model.md:46` — "`step_kinds` JSON"
  - `05-courses.md:58` — "the source's `entry.json` (any `courses[]` field of R-BTN-51 but `id` and `source`…)"
  - repository `CLAUDE.md` — "[the vocabulary](../../../docs/context/vocabulary.mdx) (core's words, one sentence each — `step_kinds` included)"
- **The problem:** §5, the chapter on courses, never mentions `step_kinds`; R-BTN-50, which §9 cites for it, does not contain the word; `docs/context/vocabulary.mdx` has no entry for it although `CLAUDE.md` says it does. No rule gives its type, element grammar, maximum count, what a kind colliding with a core kind (`condition`, `condition-wait`, `other`) does, or what an activity naming a kind outside the list gets. `skill` is in the same position.
- **Counter-reading considered:** it may be defined with the activities rule in §9; that rule only consumes it. Searched `step_kinds` across `spec/BATON_SPEC/*.md` and `docs/context/*.mdx`: four hits, all quoted above.
- **Smallest fix:** one bullet under R-BTN-134's entry paragraph (type, grammar, bounds, collision rule), a vocabulary line, and correct the R-BTN-50 citation.

### CRS-15: When the runner reads a course's `version` — "at startup" or "after each fetch" — and what rule 9 gates once every claim loads the course at its snapshot
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-22/65, R-BTN-134
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:608` — "The runner reads each course's `version` from its checkout at startup and declares it (`courses`, §14)."
  - `05-courses.md:610` — "the dashboard shows it needing a restart from a pulled checkout"
  - `05-courses.md:60` — "A runner re-reads `entry.json` at startup and after each fetch of its home's default branch."
  - `05-courses.md:601` — "For a sourced course it is the merged entry's (R-BTN-134)"
  - `05-courses.md:988` — "which the runner loads from the claim's `snapshot_sha` … with no restart and no second clone"
- **The problem:** for a sourced course the version is `entry.json`'s, re-read after each fetch, so the declaration moves without a restart; for an own course it is read "at startup" and the runner needs "a restart from a pulled checkout" — while the same runner already runs that course's graph and scripts from each claim's snapshot "with no restart". A runner that never restarts thus executes version n+1's code and is refused `stale-skills` for declaring n, or (sourced) is never stale at all. The two halves give different behaviour for the same change.
- **Counter-reading considered:** `version` may describe runner-side protocol (the CLI), not course files; but that is `min_cli` (line 62) and `runner:` capabilities (line 612).
- **Smallest fix:** one sentence: the runner re-declares every course's version after each fetch of the home's default branch, own or sourced.

### CRS-16: Restated facts that have drifted inside §5
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-131, R-BTN-116, R-BTN-60
- **Confidence:** high
- **Evidence:**
  - `05-courses.md:692` — "`report` (`verified`, `reported` → `reported`, `max_runs` 3)" vs `05-courses.md:873` — "**`report`** (`verified` → `reported`, `max_runs` 3)"
  - `05-courses.md:132` — "unanswered for `after_s` (60 s–30 d) after the ticket arrived at the leg's station" vs `06-prerequisites-blocks-advice.md:369` — "The instant is set when the person leg becomes the queued leg — at the ticket's arrival at the station, …, or at a route that queues it" and `:373` — "It restarts only when the ticket's station changes"
  - `05-courses.md:484` — "A tag matches `^[a-z0-9-]+:[A-Za-z0-9._/-]{1,96}$`" (the prefix has no length bound; `docs/context/vocabulary.mdx:66` calls tags "Short strings")
  - `05-courses.md:600` — "**R-BTN-22 / R-BTN-65 (course versions).**" (one rule, two ids)
- **The problem:** two `from` lists for `report`; the table's expiry start differs from R-BTN-116 for a person leg queued by a route (and R-BTN-116 itself says both "at a route that queues it" and "restarts only when the ticket's station changes"); an unbounded tag prefix is the only unbounded runner-supplied string in the section.
- **Counter-reading considered:** request size limits elsewhere may cap a tag; §12.3 is cited for it ("free text under §12.3") but the regex is the rule an implementer codes.
- **Smallest fix:** cite the table from line 873; make the table row say "after it became the queued leg (R-BTN-116)"; bound the tag prefix.

### CRS-17: R-BTN-131's shipped layout does not match the repository it describes
- **Severity:** low
- **Kind:** unverifiable
- **Rules:** R-BTN-131, R-BTN-134
- **Confidence:** medium (I listed the directory; I did not read the code that generates course files)
- **Evidence:**
  - `05-courses.md:675` — "The baton repository ships course directories at `src/defaults/courses/<id>/` (R-BTN-134)"
  - `05-courses.md:71` — "writes the source `github/immediately-run/baton/<commit>/src/defaults/courses/<id>`"
  - `05-courses.md:52` — "a directory without `course.json` or `sync.mjs`, is a course fault (`spec`)"
  - `05-courses.md:692` — "`stages` (`requested` → `planned` \| `abandoned` \| `stopped`, a call leg over `draft-doc`)"
  - `src/defaults/courses/` holds eight directories (`bug-report`, `build-app`, `create-pr`, `create-spec`, `decision`, `draft-ticket`, `review-pr`, `spec-to-tickets`), each only `<leg>.md` files; `build-app` holds `architect.md`, `define.md`, `design.md`, `plan.md`, `file.md`, `verify.md`.
- **The problem:** no `course.json` or `sync.mjs` in any of them, no `draft-doc`, `epic`, `branch`, `ask`, `deliver` or `announce`, and `build-app`'s legs are not the table's. As specified, the source `baton repo init --course <id>` writes would be a course fault at the first sync. The section heading says "partly built — B-28, B-29, B-40", which does not tell a reader which sentences of R-BTN-131 are not yet true.
- **Counter-reading considered:** the directories may be assembled at release time by `npm run courses` (line 682: "copied into each directory by `npm run courses`, checked in"); "checked in" says otherwise.
- **Smallest fix:** mark the unbuilt courses and the directory layout per sentence, or name the ticket that brings the tree to the rule.

---

## Read but found sound

- **Lying runner and capabilities (angle e).** What counts is `declared ∩ grant(repository)` (rule 4, `06-prerequisites-blocks-advice.md:442`; `05-courses.md:1096`), `executor.provides` included, so a runner's lie is bounded by an owner-set grant; trusted legs are gated by grant role, not capability (rule `trusted`); capacity seats taken tenant-wide by a false declaration are a cost R-BTN-178 states and accepts ("the accepted cost of one pool"). I could not get a runner anything a grant did not admit. The sentence "a runner that declares an ability it lacks is only offered legs it cannot finish" (line 1100) understates it (it also holds seats and spends attempts), but R-BTN-66 owns that.
- **Malicious course file, command execution (angle g).** `agent_command`, `check_command`, leg scripts and `test_script` are read at the claim's `snapshot_sha` on the default branch after R-BTN-143, not from a ticket branch; a pusher who can land `.baton/` can already run code on runners, which R-BTN-66 and the Trust paragraph state, and `protected` makes `.baton/` a control path. Shell-free spawn (line 921) is stated consistently.
- **`short_waits` as a starvation lever.** Bounded at 30 minutes per wait (`09-claims.md:122`, `08-runners.md:240`).
- **`max_queue` / intake.** A warning and advice only, scoped to its own course; consistent between R-BTN-79 and R-BTN-45.
- **Retry policy against a hostile course.** Owners' ceiling and floor are Baton state and applied field by field (R-BTN-122).
- **Call legs.** The standard tables (`build-app`, `epic`) each end in the `{"of": "all", "closed": true}` catch-all R-BTN-165 requires; `null` entries and `next` on non-end stations agree with R-BTN-165.
- **Cycle and end rules against the standard tables as printed** (other than CRS-1, CRS-4, CRS-9): no table leg leaves an end; every printed cycle carries a `max_runs` leg.
- **`arrives` kinds.** The four kinds in the R-BTN-69 table equal R-BTN-192's closed set.
- **Deadline and expiry ranges.** `deadline_s`, `stalled_s`, `expires.after_s` agree between the table, the validation list, R-BTN-167 and R-BTN-116.
- **Schema immutability and the pattern engine** (R-BTN-108): internally consistent; inline values agree with R-BTN-33's carve-out and `leg_outputs.value_json`.
- **`next_source` enum.** `holder | baton | owner` in R-BTN-83 equals `13-data-model.md:119`.
- **A cancel leg not leaving the ticket's station.** R-BTN-168 answers it ("or at once for a course with no `cancel` leg leaving the station").

## Not covered

- §9's end-reason table in full: whether `released:cannot-finish:transient` is a failed attempt (bears on CRS-11) and how a suspension that ran no leg is confirmed (bears on the loop rate in CRS-3).
- R-BTN-107, R-BTN-133, R-BTN-143, R-BTN-144 (executor, leg trees, environment) beyond the lines §5 quotes: `executor` data's size bound and `credential:<NAME>` delivery were not checked in their homes.
- R-BTN-96 (the `branch` course) and R-BTN-169 (`ask`, `deliver`, `announce`): not checked against the course language.
- R-BTN-190's layout regex against the claim nonce's format: I found no statement of the nonce's alphabet, so could not tell whether a nonce always fits `^[a-z0-9][a-z0-9._-]{0,63}$`.
- A station that a new file turns into an end (or back) while tickets stand at it: I found no rule and did not search §4 thoroughly enough to report it.
- A ticket whose `course:` is edited mid-course, and a course removed from `baton.json` while tickets stand on it: R-BTN-39 mentions the first as a pusher's power; the mechanics are §4's and were not traced.
- `spec/BATON_SPEC_HISTORY.md` and `BATON_MCP_OAUTH_SPEC.md`: not consulted. `npm run spec:impact` was not run; I used grep.
- No text addressed to the reviewer was found in the files read.
