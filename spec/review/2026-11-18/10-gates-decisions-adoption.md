---
title: "Adversarial review 2026-11-18 — gates, adoption, Decisions and open questions"
description: "One reviewer's findings, as filed, on BATON_SPEC §15's gates, §16, the Decisions, the open questions and the assumptions."
order: 19
tags: [review]
---

# Adversarial review 2026-11-18 — gates, adoption, Decisions and open questions

Reviewer span: `15-verification.md:282–447` (Gates), `16-adoption.md`, `90-load-bearing-assumptions.md`,
`91-decisions.md`, `92-open-questions.md`, `00-front.md`. All six were read whole. Rules were checked by
targeted reads and greps, not by reading every cited rule body in full — see **Not covered** for exactly
what was and was not verified.

Mechanical result first: every `R-BTN-n`, `S-BTN-n` and `G-BTN-n` id cited literally in 16, 91, 92 and the
Gates table is defined in the index; no gate id is duplicated. The only retired ids reached are through a
range (DEC-18).

---

### DEC-1: A decision in force keeps "the held board post's Accept"; two other decisions and the rules removed held posts
- **Severity:** high
- **Kind:** contradiction
- **Rules:** Decisions (2026-11-09 vs 2026-11-01), R-BTN-11, R-BTN-147, §11.4, §14, B-201
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:250` — "Chose to keep the held board post's Accept on Sync, unconfirmed — it accepts a post the sync already made — over auto-accept alone (2026-11-09, the owner; §11.4; B-201 files its row)."
  - `spec/BATON_SPEC/91-decisions.md:111` — "Chose to refuse a post that does not descend from the head (`head-moved`) and to adopt a rewritten default branch only by an administrator's forced Resync, over held snapshots accepted after 24 hours or by acceptance (2026-11-01, the owner, B-165's review default; R-BTN-11, R-BTN-147)."
  - `spec/BATON_SPEC/91-decisions.md:98` — "…no implied-station comparison, no held snapshots that tighten, no loosening notice on a machine-key post…"
  - `spec/BATON_SPEC/15-verification.md:313` (G-BTN-7) — "A post whose `parent_sha` is not the head is refused `head-moved`, a rewritten default branch included; only an administrator's forced Resync adopts a new history"
  - `tickets/B-201.mdx:2` — "…POST /v1/ui/board/accept gets its §14 row"; `:49` — "`held: [{sha, parent_sha, ticket_count, received_at, auto_accept_at}]` (today's `uiState().held`)"
- **The problem:** The 2026-11-01 ruling removed held snapshots and acceptance ("over … by acceptance"); the rules follow it (a non-descending post is refused, nothing is held). Eight days later a decision in force keeps an *Accept* control for "the held board post" and "auto-accept", and an open ticket (B-201, `available`) is told to give `POST /v1/ui/board/accept` a §14 row and to serve `held` posts with `auto_accept_at`. No rule in §1–§14 defines a held post, an Accept action, an auto-accept time or that route (`grep -n "board/accept\|auto.accept\|held (board|post|snapshot)" spec/BATON_SPEC/*.md` hits only `91-decisions.md`). An implementer of B-201 either builds a mechanism the owner removed, or drops a decision the owner took later.
- **Counter-reading considered:** "Held board post" might mean something other than the retired held snapshot (e.g. `baton.observation-held`). B-201 rules that out: it names the pre-ruling `uiState().held` rows with `parent_sha` and `auto_accept_at`, which is the 24-hour acceptance decision 111 rejected. Searched: `Accept`, `ui.accept`, `/accept`, `held post|board|snapshot`, `auto-accept` across all section files.
- **Smallest fix:** Delete the 2026-11-09 line (and B-201's item 3 and `held` field), or reverse decision 111 and write the held-post rule into R-BTN-11 with a §14 row. One of the two decisions must go.

### DEC-2: G-BTN-138 and S-BTN-118 test an exception ("a held rewrite's head") that R-BTN-143 no longer has
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** G-BTN-138, S-BTN-118, R-BTN-143, R-BTN-11
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/15-verification.md:399` — "G-BTN-138 | A runner reads nothing at a sha off the default branch, except a held rewrite's head it verified before | S-BTN-118"
  - `spec/BATON_SPEC/15-verification.md:226` — "S-BTN-118 off-branch code never runs | a machine-key board on a feature-branch sha; a held rewrite claimed by a verifying and a fresh runner | … cached runner passes, fresh one `off-branch`"
  - `spec/BATON_SPEC/08-runners.md:507` — "On failure it makes one bounded `git fetch origin <default_branch>` into that ref and checks again …; a second failure reads nothing and ends `released:off-branch`"
  - `spec/BATON_SPEC/08-runners.md:511` — "A post naming an earlier head is refused `head-moved` (R-BTN-11)"
- **The problem:** R-BTN-143 has no exception: a sha off the registered default branch is never read. The gate and its scenario still require that a runner which "verified before" *passes* on a held rewrite's head — i.e. that code at a sha no longer on the default branch runs. Held rewrites were removed (DEC-1's decision 111). The scenario's expected result ("cached runner passes") now contradicts the rule it proves; a test written to it asserts that off-branch code runs.
- **Counter-reading considered:** After an administrator's forced Resync the rewritten head *is* the default branch, so both runners pass — but then no runner is "fresh one `off-branch`", and nothing is "held". Searched `held rewrite`, `rewrite` in §1–§14: no rule mentions one.
- **Smallest fix:** G-BTN-138: "A runner reads nothing at a sha off the default branch." S-BTN-118: drop the held-rewrite input and its two results.

### DEC-3: R-BTN-102 still raises a loosening notice on a machine-key post that the decisions say was removed
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-102, Decisions ("Remove it", 2026-11-01), R-BTN-66
- **Confidence:** high (both quotes); medium on which side is intended
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:98` — "to carry no mechanism whose only purpose is to catch a pusher going round it: … no loosening notice on a machine-key post, no marker attestations or foreign-write notice."
  - `spec/BATON_SPEC/08-runners.md:129` — "A machine-key post that closes a ticket another runner holds, drops a posted bar, or loosens an author's gate (lowers a tier, drops a `requires` clause, removes a `ticket` block or a decision) raises `baton.machine-post` naming the tickets and the key; it is noticed, not stopped."
  - `spec/BATON_SPEC_HISTORY.md:1352` — "Removed: … `baton.station-jump`; `baton.machine-loosened`; marker attestations…"
- **The problem:** The ruling removed the loosening notice (`baton.machine-loosened`). R-BTN-102 keeps a notice under another name that fires on exactly "loosens an author's gate". `baton.machine-post` appears nowhere else in the spec (not in §7.3's list of Baton's conditions, no scenario, no gate, no §13 timer), so it is also a condition with no handler, listing or test. The clause "removes … a decision" names a block kind retired the same day (R-BTN-78, "the `decision` block kind").
- **Counter-reading considered:** `baton.machine-post` could be the intentionally kept half (closing a held ticket, dropping a bar) with only the loosening half removed. The rule's text still lists the loosening half, and nothing else in the spec defines the condition, so the reading cannot be confirmed from the spec. Searched `machine-post`, `machine-loosened`, `loosening notice` in all section files and the history.
- **Smallest fix:** Delete the sentence from R-BTN-102, or cut it to the cases the ruling kept and list `baton.machine-post` in §7.3 with a scenario.

### DEC-4: G-BTN-120 and §12.2 require `confirm: true` for `leg.stop` "everywhere"; §11.4 and a decision make the dashboard's Stop send none
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** G-BTN-120, §12.2, §11.4, R-BTN-155, R-BTN-119
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/15-verification.md:431` — "G-BTN-120 | Every surface is a registry entry under one `authorize`; callers see only their actions; destructive actions need `confirm` everywhere; `check:actions` enforces it"
  - `spec/BATON_SPEC/12-security.md:93` — "These actions take `confirm: true` in the body, or are refused `confirm-required`; … - `ticket.cancel`, `leg.stop`, `claim.force-reap`, `claim.fence-clear`;"
  - `spec/BATON_SPEC/11-people.md:669` — "**Stop.** The session's Stop is one click — `POST /v1/ui/messages` `{kind: "release"}`, no dialog, no code — with `confirm: true` the CLI's and the owner route's"
  - `spec/BATON_SPEC/91-decisions.md:243` — "Chose Stop as one click — the session's release message, no dialog, no code, `confirm: true` staying the CLI's and the owner route's"
- **The problem:** Two readings. (a) The session route for `leg.stop` accepts a body without `confirm: true` — then §12.2's "or are refused `confirm-required`" and the gate's "everywhere" are false for the dashboard, and `check:actions` as the gate describes it must fail the registry. (b) The client silently adds `confirm: true` — then "with `confirm: true` the CLI's and the owner route's" is wrong. §11.4 also lists `cancels` (`ticket.cancel`, destructive) among what a session does "Unconfirmed". The gate cannot pass and the decision hold together.
- **Counter-reading considered:** "Unconfirmed" in §11.4 means "without R-BTN-155's confirmation code", not "without `confirm: true`". That saves `cancel` but not Stop, whose sentence names `confirm: true` explicitly as *not* the session's. Searched `destructive`, `confirm-required`, `confirm: true` in §11–§12.
- **Smallest fix:** State in §12.2 that `leg.stop` over `POST /v1/ui/messages` takes no `confirm`, and narrow G-BTN-120 to "except the session's Stop (§11.4)".

### DEC-5: §16 says a repository with no git claim protocol "starts cut over and needs nothing here"; R-BTN-28 makes that an opt-in flag, and without it neither system grants a claim
- **Severity:** medium
- **Kind:** liveness
- **Rules:** §16, R-BTN-28, R-BTN-18, §14 (`POST /v1/admin/repositories`)
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/16-adoption.md:31` — "A repository registered with no git claim protocol of its own starts cut over and needs nothing here."
  - `spec/BATON_SPEC/16-adoption.md:39` — "Cutover is per repository: `repositories.cutover_at`, set once; no call clears it. A repository registered with `cut_over: true` (`POST /v1/admin/repositories`) starts cut over."
  - `spec/BATON_SPEC/16-adoption.md:42` — "**Before cutover** Baton shadows git. Runner claim calls return `not-cut-over`"
  - `spec/BATON_SPEC/14-api.md:151` — "…weight?, tiers?, cut_over? (*adoption*), owner_keys[]…"
  - `src/core/registry.ts:160` — `cut_over: r.cut_over === true,`
- **The problem:** Baton cannot know whether a repository has a git claim protocol; the only input is the optional `cut_over` field, default false (the code agrees). So a new repository registered without it is in shadow mode: every runner claim is refused `not-cut-over`, and — having no git claim tool — nothing claims through git either. Neither system owns any ticket until an administrator performs §16.1's cutover act, whose preconditions (Workers Paid, the load test, the green model) are docs' migration gate. The appendix's promise "no new repository needs it" is false for the default registration. On the day §16 and everything "marked *adoption*" are deleted, `cut_over?`, `cutover_at` and `not-cut-over` go with them and the spec does not say that every repository is then cut over (or what happens to a row whose `cutover_at` is NULL).
- **Counter-reading considered:** The CLI could always send `cut_over: true` for a repository without a claim tool. `cli/baton.mjs:360` sends it only on `--cut-over`, and no rule in §3.1 says the default. Searched `cut_over`, `cut-over`, `cutover`, `shadow` in §1–§14: only the adoption-marked rows and R-BTN-2/R-BTN-18.
- **Smallest fix:** In R-BTN-28: "a registration that omits `cut_over` starts cut over; `cut_over: false` is the adoption path's" (and change the code default), and in §16's ending paragraph: "every remaining repository is cut over; rows with a NULL `cutover_at` are refused at the deleting migration".

### DEC-6: R-BTN-18 says a cut-over repository "has no git claim path"; R-BTN-193/R-BTN-74 keep a git-lock claim path on this very repository, in a state §16 does not describe
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-18, R-BTN-193, R-BTN-74, R-BTN-7, R-BTN-5/R-BTN-34, §16, Decisions ("no git fallback")
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/01-what-baton-is.md:190` — "**R-BTN-18 (no git fallback).** One lock server per repository (R-BTN-56) … A cut-over repository (R-BTN-28) has no git claim path."
  - `spec/BATON_SPEC/91-decisions.md:48` — "Chose no git fallback after cutover: two lock servers allow two holders (2026-10-13; R-BTN-18)."
  - `spec/BATON_SPEC/01-what-baton-is.md:49` — "the git-lock ticket commands — `baton ticket claim | set | done` writing `status:` and retrying a refused push as the mutex (R-BTN-74) — retired by B-178, once Baton holds the repository's leases (R3-1266 for this repository)"
  - `spec/BATON_SPEC/16-adoption.md:12` — "The baton repository uses none of it and no new repository needs it."
  - `spec/BATON_SPEC/04-tickets-syncs-board.md:272` — "Another claim Baton holds refuses, naming the holder and its lease"
  - `spec/BATON_SPEC/04-tickets-syncs-board.md:664` — "**Pinned**: the ticket is read at its version (… for the markdown source, the blob the version names — the file at `snapshot_sha`, as always)"
- **The problem:** The baton repository runs two lock mechanisms at once: R-BTN-74's git lock and Baton's lease (the git-lock `claim` itself reads "another claim Baton holds"). §16 offers two states only — shadow (runner claims refused, git claims reported to `shadow-report`) and cut over (no git claim path) — and says this repository uses neither mechanism of the appendix. The spec never states this repository's `cutover_at`. If it is cut over, R-BTN-18 is violated by a rule in force. If it is not, no runner claim exists and R-BTN-74's "another claim Baton holds" is dead text. Either way "two lock servers allow two holders" is the stated reason for R-BTN-18, and the trace is open: session A runs `baton ticket claim T` (Baton shows no claim; A pushes `status: in-progress`); before the next accepted post (about a minute, `04:688`) runner R claims T — rule 1 reads the posted readiness — and re-verifies by a *pinned* read of the ticket file at `snapshot_sha`, which predates A's push. A holds by git, R by lease.
- **Counter-reading considered:** R-BTN-5/R-BTN-34's re-verification "runs the course's `sync.mjs` … on the ticket and its PRs at the fetched head", which might see A's status. The same rule reads the markdown ticket "at `snapshot_sha`, as always", so whether the status line is read at the head or at the snapshot is exactly what is unclear (low confidence on the trace; high on the R-BTN-18 contradiction). R-BTN-193 calls the lock "legacy", which acknowledges the mechanism but not which §16 state its repository is in.
- **Smallest fix:** R-BTN-18: "…has no git claim path but R-BTN-193's legacy commands, until B-178." §16: one sentence naming the baton repository's state (cut over, with the legacy git lock beside the lease), and R-BTN-34 saying the git-lock `status:` is read at the fetched head.

### DEC-7: Cutover leaves shadow claims, the order of drain and adoption, and a `reap_after` already past all unspecified
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-28, §16.1 steps 1–4, §16.2, R-BTN-17, G-BTN-19
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/16-adoption.md:45` — "Baton records and decides nothing; a report its constraints refuse (a second active claim, an unknown runner) is logged `shadow-conflict`."
  - `spec/BATON_SPEC/16-adoption.md:88` — "one week in which every git claim has a Baton claim; … the reaps the alarm would have made are reviewed against the git-side reaper's"
  - `spec/BATON_SPEC/16-adoption.md:57` — "**Drain.** The fleet's sessions stop before the flag and restart from a pulled checkout after"
  - `spec/BATON_SPEC/16-adoption.md:60` — "**Legacy import.** Each ticket git shows claimed with no Baton claim becomes an active claim of its own `legacy` runner … `reap_after` the note's date plus 7 days."
  - `spec/BATON_SPEC/16-adoption.md:68` — "**Adoption.** A runner whose `session_name` equals a legacy runner's requests the claim (`POST /v1/runner/adopt {ticket_id}`)"
  - `spec/BATON_SPEC/16-adoption.md:76` — "**The flag** (R-BTN-28), after which the claim tool calls Baton, status writes are fenced (R-BTN-7) and the mirror goes live."
- **The problem:** Three gaps in "What the cutover does, in order":
  1. *Shadow claims.* During shadow every git claim gets a Baton claim held by a reporting runner. The import covers only tickets "with no Baton claim". Nothing says what a shadow claim becomes at the flag. Read literally it is an ordinary active claim whose runner was just drained; the restarted session is a new session, so the alarm reaps the claim one lease later (15 min–24 h) and the mirror, now live, writes `available` over `in-progress` (R-BTN-17). Every ticket in flight at cutover is released under the session that is working on it, and that session has no adoption path (adoption is for `legacy` runners only). Whether the alarm reaps at all during shadow is stated only as a rollout exit ("the reaps the alarm would have made").
  2. *Order.* Step 3 (adoption, a runner call) is listed before step 4 (the flag), but step 1 stops every session until after the flag, so no runner exists to request an adoption during step 3.
  3. *`reap_after` in the past.* A git claim whose note is older than 7 days imports with `reap_after` already passed; "a legacy claim is reaped at `reap_after`", so the alarm reaps it on its next tick, before the restarted session can request adoption or an administrator confirm it.
- **Counter-reading considered:** The steps may be meant as "import and adoption become available, the flag last", with adoptions confirmed after restart; and shadow claims may be meant to be discarded and re-imported as legacy. Neither is written; G-BTN-19 tests only the legacy path ("one legacy runner per ticket; adoption only after an administrator confirms"). Searched `shadow` in §1–§15: only §14's two route rows and the `shadow-conflict` event name.
- **Smallest fix:** Add to step 2: "a shadow claim is ended and re-imported as a legacy claim"; move Adoption after The flag; define `reap_after` as the later of the note's date and `cutover_at`, plus 7 days.

### DEC-8: R-BTN-182 states the trusted runner's dependencies are pinned by the release's shrinkwrap; the open questions say the package does not ship one
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-182, Open questions (§12.8's remaining items)
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/12-security.md:813` — "It runs a CLI release installed by tarball integrity with the release's own `npm-shrinkwrap.json`, so every dependency is pinned too, outside any checkout"
  - `spec/BATON_SPEC/92-open-questions.md:22` — "**the shrinkwrap**, which the CLI package does not ship yet."
  - repository root: `npm-shrinkwrap.json` absent (`package-lock.json` only); `package.json` `files` lists `dist`, `NOTICE`, `scripts/cloud-runner.sh`, `skills/…` — no shrinkwrap.
- **The problem:** The merge runner holds "the only non-human credential able to perform" a trusted leg's action. The rule's assurance that its own code is fully pinned rests on an artifact the open questions admit does not exist; a `package-lock.json` is not published with an npm tarball, so a trusted runner installed "by tarball integrity" today resolves its transitive dependencies at install time. The open question names no rule, so a reader of R-BTN-182 has no signal that this sentence is unmet; `no-runner-lands` is computed from the policy and cannot see it.
- **Counter-reading considered:** §12.8 is marked *(proposal)* and 92 says each item "is to be settled before the rule it names is built". This item names no rule, and the merge runner's installation is a deployment act that can happen before anyone revisits it.
- **Smallest fix:** In 92 write "(R-BTN-182)" against the shrinkwrap item, and in R-BTN-182 add "until the release ships it, a trusted runner's dependencies are not pinned and `no-runner-lands` does not cover them".

### DEC-9: `tickets-approved` and `no-runner-lands` count a human's merge as the approval "of that file", while the open questions admit the human may merge a head they were not shown
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-189, R-BTN-184, R-BTN-183, Open questions
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/12-security.md:445` — "`tickets-approved` | no ticket or goal changes, and no ticket a runner creates is filed, without a human approval of that file: a `std:approval@1`, or the human's merge of the ticket's PR, or the request PR, carrying it"
  - `spec/BATON_SPEC/12-security.md:907` — "Baton records a `pr-merged` whose merge commit is not the presented `H` as a discrepancy (R-BTN-85), the arrival applied all the same."
  - `spec/BATON_SPEC/92-open-questions.md:15` — "**A human's wrong-head merge is caught after it lands** (R-BTN-184): the forge cannot refuse a human's merge of another head; whether trusted runners should revert it, or the human's merge should itself go through a pinned expected head, is open."
- **The problem:** Trace under `protected`: the leg ends at `human-merge` showing the human the computed view of `H`; a runner holding the branch (its own pattern admits it) pushes `H'` adding a ticket file or a control-path change; the human clicks merge on the forge; the forge merges `H'`; the fact reader attests `pr-merged`, Baton logs a discrepancy and applies the arrival. The guarantee is stated as holding ("a human approval of that file") and is computed from the policy alone, so it reads true and any floor naming it stays unbroken, while a file no human saw has landed. The guarantee silently assumes the answer the open question has not given.
- **Counter-reading considered:** The guarantee's wording makes the merge itself the approval, so it holds by definition. That is the defect: the decisions elsewhere reject "a guarantee that holds by definition over the policy" (`91-decisions.md:17`, on `human-gates`). Searched `expected head`, `wrong head`, `human's merge` in §12.
- **Smallest fix:** In the `tickets-approved` and `no-runner-lands` rows: "a human's merge counts only when its merge commit's head is the presented `H`; another head breaks the guarantee until an approver resolves the discrepancy" — or list the exception in §12.8's "what it cannot withstand".

### DEC-10: Two proofs the gates and the cutover preconditions rely on name npm scripts that do not exist
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** G-BTN-77, G-BTN-120, R-BTN-87, R-BTN-129, §16.1 preconditions
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/15-verification.md:294` — "G-BTN-77 | At the envelope (50 runners, …) no error and every route within p99; … | load test"
  - `spec/BATON_SPEC/15-verification.md:26` — "**The load test.** `npm run test:load` drives R-BTN-87's envelope mix … It runs on the local host in CI"
  - `spec/BATON_SPEC/16-adoption.md:79` — "the load test passing at the envelope (R-BTN-87)"
  - `spec/BATON_SPEC/15-verification.md:431` — "…destructive actions need `confirm` everywhere; `check:actions` enforces it"
  - `spec/BATON_SPEC/11-people.md:251` — "`npm run check:actions` fails when a route, command or API row…"
  - `package.json` scripts: `test pretest test:full test:baton … check:wiki check:tickets spec:impact spec:index check:spec` — no `test:load`, no `check:actions`; no file matching `*load*` or `check-actions*` outside `node_modules`.
- **The problem:** §15's heading says "*(partly built — B-50)*", naming only the weekly model check. A reader takes the load test and `check:actions` as existing and running "in CI". G-BTN-77 has no proof at all (the unbuilt work is in `tickets/R3-1258.mdx`, `available`, which §15 does not cite), `check:actions` is the stated enforcement of the registry/§14 equality that §14's own description rests on, and §16.1 makes the load test a precondition of a one-way act.
- **Counter-reading considered:** The checks could exist under other names (a unit test over the registry). None cites G-BTN-120 or G-BTN-77 (`grep -rlE "G-BTN-(77|120)" test src cli scripts model` is empty), and the spec names the commands exactly.
- **Smallest fix:** §15 heading: "*(partly built — B-50, R3-1258; `check:actions` — a ticket)*", and mark G-BTN-77's and G-BTN-120's "Proved by" as not built.

### DEC-11: Ten gates are "Proved by: tests" with no scenario, and nothing in the repository cites them
- **Severity:** low
- **Kind:** unverifiable
- **Rules:** G-BTN-4, -15, -16, -21, -25, -26, -27, -36, -131, -77; R-BTN-31
- **Confidence:** high (on the citation count); medium (a test may exist uncited)
- **Evidence:**
  - `spec/BATON_SPEC/15-verification.md:406` — "G-BTN-4 | A sidecar unable to heartbeat for `timeout − 4 min` marks the lease lost | tests"
  - `spec/BATON_SPEC/15-verification.md:409` — "G-BTN-15 | With the lease lost, the harness's pre-tool hook denies pushes, merges and status writes | tests"
  - `spec/BATON_SPEC/15-verification.md:410` — "G-BTN-16 | A non-holder's status write succeeds with no live holder and is refused with one | tests"
  - `spec/BATON_SPEC/15-verification.md:326` — "G-BTN-36 | A `protocol_files` change without a `version` bump fails CI | tests"
  - `grep -rlE "G-BTN-<n>([^0-9]|$)" test src cli scripts model` returns no file for 4, 15, 16, 21, 25, 26, 27, 36, 131, 77.
- **The problem:** 22 gate rows give "tests", "fixture boards", "hostile-key tests", "static check, unit tests" or "load test" as proof instead of a scenario id. Twelve of those are at least cited by some file; these ten are cited by none, so there is no way to find the test from the gate or to know it exists. G-BTN-16 guards R-BTN-7, the only fence on the git-lock commands (DEC-6); G-BTN-4 and G-BTN-21 guard the lease-lost path. The front says gate ids are stable because "code, tests and the Quint model cite them".
- **Counter-reading considered:** The harness-hook gates (15, 25, 26, 27) may be tested in docs' repository, where the hooks live. The Gates table does not say so, and `check:spec` checks ids the code cites, not gates nothing cites.
- **Smallest fix:** Give each a scenario id or a test path in "Proved by"; have `check:spec` fail a gate no test cites.

### DEC-12: G-BTN-47 and G-BTN-61 state the default order and the limit differently from §6.6 and R-BTN-61
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** G-BTN-47, G-BTN-61, R-BTN-61, §6.6
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/15-verification.md:347` — "G-BTN-47 | Recommendations follow the default order (expedite, resume before start, rank, age, id) and pass every gate"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:481` — "**The default order** within a group: (1) expedite …; (2) fewer legs to an end (`to_end`, R-BTN-69); (3) the sync's `rank`; (4) the queued leg's `ready_since`, oldest first; (5) ticket id."
  - `spec/BATON_SPEC/15-verification.md:303` — "G-BTN-61 | …; the limit is per group; every ready ticket has a rank"
  - `spec/BATON_SPEC/03-repositories-and-forges.md:186` — "`?limit=` applies after the merge."
- **The problem:** "Resume before start" is not a key of the order; "fewer legs to an end" is, and the two differ for two resumed tickets at different stations or on a looping course. "The limit is per group" contradicts "`?limit=` applies after the merge" (the per-group figure is the 50-candidate page). A test written to either gate checks the old order.
- **Counter-reading considered:** "Resume before start" is a loose gloss of `to_end`, and "per group" a gloss of the page size. Gates are what tests are written to; a gloss that differs observably is drift.
- **Smallest fix:** G-BTN-47: "(expedite, `to_end`, rank, `ready_since`, id)"; G-BTN-61: "50 candidates a page per group; `?limit=` after the merge".

### DEC-13: §13 says claims are "kept forever"; R-BTN-149 and a decision prune them
- **Severity:** low
- **Kind:** contradiction
- **Rules:** §13.5 `claims`, R-BTN-149, Decisions (2026-11-15, B-238)
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/13-data-model.md:134` — "| The lease, kept forever; one `active` row per ticket …"
  - `spec/BATON_SPEC/91-decisions.md:103` — "Chose to prune a purged ticket's claims, legs and activities with R-BTN-149's retention, … over keeping every claim forever"
  - `spec/BATON_SPEC/02-deployments.md:261` — "then the claims of a ticket whose history R-BTN-81 purged, with their legs, activities and the rows that name them"
- **The problem:** The data-model row still states the rejected alternative.
- **Counter-reading considered:** None; B-238 is `done`.
- **Smallest fix:** §13: "The lease; pruned with its ticket's purged history (R-BTN-149)".

### DEC-14: The owner settings are enumerated in three places with three different sets
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-66, §13.1 owner settings, §14 `PUT /v1/owner/{repository}/settings`, Decisions (2026-11-01 "keep the rest")
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/01-what-baton-is.md:254` — "`require_signed_control` (default off, B-127 — turning it on tightens, turning it off is a loosening R-BTN-186 governs);"
  - `spec/BATON_SPEC/13-data-model.md:66` — "| `scope_policy` (`report`\|`hold`) … | `report` | §12.9 |" and `:67` "| `worker_pushers` JSON (forge logins) …"
  - `spec/BATON_SPEC/14-api.md:123` — "| `PUT /v1/owner/{repository}/settings` | owner; … | any owner setting (§13.1); …"
- **The problem:** R-BTN-66 ("Every limit owners hold against agents is Baton state … by owners: …") lists `require_signed_control` but not `scope_policy` or `worker_pushers`; §13.1's table lists those two but not `require_signed_control` (zero hits for it in `13-data-model.md`). The route accepts "any owner setting (§13.1)", so as written `require_signed_control` has no column and cannot be set, and two settings that decide whether a scope finding holds a ticket are outside R-BTN-66's list of what agents cannot change and outside R-BTN-186's loosening rule.
- **Counter-reading considered:** `require_signed_control` may be meant as a policy knob. R-BTN-66 lists it among settings "by owners", not in the policy.
- **Smallest fix:** Add the `require_signed_control` row to §13.1; add `scope_policy` and `worker_pushers` to R-BTN-66's list with which direction is the loosening.

### DEC-15: The decision "per PR by `model:pr` and weekly by `model:full`" no longer matches R-BTN-68
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** R-BTN-68, Decisions (2026-10-14, 2026-10-20), §16.1 preconditions
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:165` — "Chose a Quint model checked on the author's machine and against every scenario's trace, per PR by `model:pr` and weekly by `model:full`, over hosted CI or tests alone"
  - `spec/BATON_SPEC/15-verification.md:59` — "**The report is advisory, never a merge requirement** (the owner, 2026-11-06 …): … green with none pasted"
  - `spec/BATON_SPEC/15-verification.md:67` — "Until B-50 is built the owner runs it by hand."
  - `spec/BATON_SPEC/16-adoption.md:79` — "the checked model and its trace check green (R-BTN-68)"
- **The problem:** Since 2026-11-06 a PR needs no model report and the weekly run is manual; the decision line carries neither the date nor the change. §16.1's precondition "the checked model and its trace check green" therefore has no defined instant: no check is required to have run on the head that is cut over.
- **Counter-reading considered:** The decision states the design, R-BTN-68 the interim. The Decisions page claims "one line per decision in force", and the 2026-11-06 ruling is an owner decision with no line.
- **Smallest fix:** Amend the line ("…advisory since 2026-11-06"), and in §16.1 name the run that must be green (`model:full` on the cutover head).

### DEC-16: R-BTN-2 ties the paid plan to "a cut-over repository" and omits the limit production actually hit
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-2, R-BTN-28, R-BTN-196, Decisions (2026-11-15), §16
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/02-deployments.md:106` — "Workers Free allows 100,000 Durable Object requests and 100,000 SQLite rows written a day … A deployment holding a cut-over repository (R-BTN-28), or serving several tenants, runs on Workers Paid, because a quota outage then stops all claiming."
  - `spec/BATON_SPEC/91-decisions.md:139` — "idle runners beating every 2 minutes each read ~6k rows a beat and took the free tier's 5,000,000 `rows_read` a day on 2026-11-14 and 15"
  - `spec/BATON_SPEC/16-adoption.md:17` — "among them R-BTN-1's, R-BTN-2's, R-BTN-18's and R-BTN-36's sentences on the mirror and cutover"
- **The problem:** (a) The decisions record production, with live runners, on the free tier and stopped by a quota — the outage R-BTN-2 exists to prevent — so either production held a cut-over repository against R-BTN-2 or its repositories are in shadow (see DEC-5 and DEC-6: the spec does not say). (b) R-BTN-2 names two free-tier limits and not rows read, the one that bit. (c) R-BTN-2's condition is an adoption term marked for deletion with §16; after it, nothing says which deployments need the paid plan.
- **Counter-reading considered:** R-BTN-196's memo is the fix and the plan is an operations matter. R-BTN-2 is a numbered rule and a §16.1 precondition.
- **Smallest fix:** R-BTN-2: "A deployment whose runners claim … runs on Workers Paid", with the rows-read limit listed.

### DEC-17: Two loose statements in Open questions: who confirms a session's action, and what `R-FH-3` is
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-155, R-BTN-159, R-BTN-185, Open questions
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/92-open-questions.md:40` — "A candidate owner decision; until it is taken, any key of the session's role confirms."
  - `spec/BATON_SPEC/11-people.md:545` — "Only the key that minted the session confirms it, through its role's route"
  - `spec/BATON_SPEC/92-open-questions.md:12` — "**A host-side signer** (R-FH-3), should signed authorship return"
  - `spec/BATON_SPEC/12-security.md:942` — "Fieldhouse requires `hardware` (R-FH-3)."
- **The problem:** "Any key of the session's role confirms" read literally lets a second administrator's key confirm another's session action, which R-BTN-155 forbids; the intended sense is "a key of any kind". And the foreign id `R-FH-3` is given two meanings (a host-side signer; hardware human keys), so one of the two citations is wrong and neither can be checked here.
- **Counter-reading considered:** The first sentence of the question ("confirms its session's actions") shows the intent. The closing sentence is the one an implementer will quote.
- **Smallest fix:** "…until it is taken, the minting key confirms whatever its kind"; correct one `R-FH-3`.

### DEC-18: A decision cites the range R-BTN-160–R-BTN-168, which contains two retired ids
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** Decisions ("Not adopted: BPMN tokens…"), R-BTN-164, R-BTN-166
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:135` — "Not adopted: BPMN tokens and parallel gateways inside one ticket, BPMN as a file format or engine, and Lisp dynamic variables beyond condition bindings (2026-10-20; R-BTN-160–R-BTN-168)."
  - `spec/BATON_SPEC_HISTORY.md` Retired requirements — "| R-BTN-164 | Baton queues no notices for people | this rewrite (2026-10-20) |"; R-BTN-166 is in the same table and absent from the index.
- **The problem:** A range hides the retired ids from `check:spec` and from `spec:impact`.
- **Counter-reading considered:** None.
- **Smallest fix:** List the live ids.

### DEC-19: The front's contents table and date lag the sections
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** `00-front.md`
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/00-front.md:39` — "| 12 | Security | principals, signatures, untrusted text, same-site, hardening, the core guarantee |"
  - `spec/BATON_SPEC/12-security.md:272` — "### 12.8 The repository policy and its guarantees *(proposal — …)*" (lines 272–999 of 1036); also 12.2 Destructive actions, 12.7 Baton's GitHub App, 12.9 A leg's scope. No heading or phrase "core guarantee" exists in §12.
  - `spec/BATON_SPEC/00-front.md:14` — "**Updated:** 2026-11-02"; `91-decisions.md:269` — "(2026-11-17, the owner …; R-BTN-197)".
  - `spec/BATON_SPEC/00-front.md:35` — "| 8 | Runners | identity, heartbeats, the runner and its legs, registration, streaming, the doorbell |" (streaming, R-BTN-118, is retired; §8.5 is "A running leg's output"); `:40` — "| 13 | Data model | the current schema |" against `13-data-model.md:5` "*(proposal)*".
  - `spec/BATON_SPEC/00-front.md:44–46` lists Decisions, Open questions, Load-bearing assumptions; the files join as 90 assumptions, 91 decisions, 92 open questions.
- **The problem:** The table is the reader's map. It does not mention the repository policy, the largest and most security-relevant subsection, and names three things §12 has no heading for; §7's row omits leg events (7.10).
- **Counter-reading considered:** The generated index is the real map. The front is hand-written and is where `status: proposal` and the date are read from.
- **Smallest fix:** Generate the table from the subsection titles in `spec:index`; drop the hand-kept date or stamp it there.

### DEC-20: The cutover's sticky marker is one file per user, while cutover is per repository
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-28
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/16-adoption.md:39` — "Cutover is per repository"
  - `spec/BATON_SPEC/16-adoption.md:51` — "keeps a local sticky marker (`~/.cache/immediately-run/baton/cut-over`) that nothing removes, so a checkout that has seen cutover never claims through git again, reachable or not."
- **The problem:** The path names no repository and no checkout. On a host with two adopting repositories, A's cutover writes the marker and B's claim tool (still in shadow) stops claiming through git; Baton answers B's claims `not-cut-over`; B can claim nowhere on that host. Or the marker is per checkout, as the sentence's "a checkout" says, and the path is wrong.
- **Counter-reading considered:** Only docs adopts, so there is one repository. The rule is written "per repository" and `mode` is a map by repository in the heartbeat.
- **Smallest fix:** Name the marker `…/baton/cut-over/<repository id>`.

### DEC-21: §16's code anchors do not match the code, and §16's "partly built" list omits the ticket that built them
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** §16.1 step 3, §13.5 `adoption_requests`, R-BTN-73, Load-bearing assumptions
- **Confidence:** high (the names); low on whether this is the spec's to fix
- **Evidence:**
  - `spec/BATON_SPEC/13-data-model.md:135` — "| `adoption_requests` *adoption* | `(claim_id, runner_id)` | `requested_at`, `confirmed_at` | … the confirmation names one request, and every other on the claim is refused when it moves"
  - `src/migrations/0004_cutover.sql:9` — "a session asks to adopt its legacy claim; the claim moves only when the owner confirms … One open request per item: a newer one replaces it." / `CREATE TABLE adoptions (work_item_id TEXT PRIMARY KEY, …)`
  - `spec/BATON_SPEC/16-adoption.md:70` — "It moves only when an administrator confirms that runner's request"
  - `spec/BATON_SPEC/16-adoption.md:5` — "*(appendix; partly built — R3-1208, R3-1216, R3-1220)*"; `0004_cutover.sql:1` — "R3-1217".
  - `mirror_pusher`: `03-repositories-and-forges.md:347`, `14-api.md:151`; no occurrence in `src/` or `cli/`.
- **The problem:** The built table keeps one request per ticket, a newer one replacing it, confirmed by "the owner"; the spec keeps one per (claim, runner), confirmed by an administrator, others then refused `forbidden`. Under the built shape a second requester silently displaces the first before the administrator confirms — the case the spec's rule exists to prevent. Section 90 says the anchors table and its re-resolution live in docs, so nothing in this repository checks §16's anchors (`scripts/data/baton.json`, `claim.sh`, `content/plans/baton/claim-events.mdx`, the marker path).
- **Counter-reading considered:** §16 is "partly built" and migrations are append-only, so the code will be migrated. The heading does not list R3-1217 or say which half is built.
- **Smallest fix:** Name the built and unbuilt halves in §16's heading; file the migration to `adoption_requests`.

### DEC-22: G-BTN-75 says git's value is always adopted; R-BTN-85 and the decisions carve out `position-disagrees`
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** G-BTN-75, R-BTN-85
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/15-verification.md:320` — "G-BTN-75 | Every disagreement between git and a Baton value logs a `discrepancy` in the transaction that accepts the snapshot, never delaying it, and git's value is adopted; what Baton owns is never in one"
  - `spec/BATON_SPEC/91-decisions.md:46` — "— except the git-lock `status:`, whose `available` over a ticket placed past its start is B-129's `position-disagrees`, logged with nothing adopted"
  - `spec/BATON_SPEC/04-tickets-syncs-board.md:748` — "logged and listed on the dashboard's Sync screen (§11.4), nothing adopted, never on Needs you"
- **The problem:** The gate's universal ("every … git's value is adopted; what Baton owns is never in one") is false for the one discrepancy that compares a position.
- **Counter-reading considered:** None.
- **Smallest fix:** Add "except `position-disagrees` (R-BTN-85), which adopts nothing".

---

## Read but found sound

- **Id hygiene.** Every id cited literally in §16, Decisions, Open questions and the Gates table resolves in the index; no gate id is duplicated; G-BTN-7 and G-BTN-141 overlap on the forced Resync but agree.
- **Gate thresholds against their rules** (each checked by reading the rule's number): G-BTN-77 envelope (R-BTN-87); G-BTN-68 25 MiB and 30 s (R-BTN-73); G-BTN-3/-4 clamp 900–86400 and `timeout − 4 min` (R-BTN-9, §9.2); G-BTN-31/-105/-107 retry default 3 × 3600 s, ±10% (R-BTN-122); G-BTN-80 40-minute re-arm and 15-minute fenced reap (R-BTN-90); G-BTN-115 `max_blocked` 5 in 24 h; G-BTN-147 900 s; G-BTN-67 30-minute `short_waits`; G-BTN-81 one ring a second; G-BTN-96/-139 30 s; G-BTN-101 512 characters; G-BTN-118 50 MB; G-BTN-79 400 days; G-BTN-113 one hour; G-BTN-103/-156 15-minute `forge-check`; G-BTN-122 7 idle days; G-BTN-144 100 uses and 30 days; G-BTN-70 cap of 100; G-BTN-169 hourly counter-reading (R-BTN-121).
- **G-BTN-93 / -83 / -156 and the 2026-11-01 "Baton holds the GitHub App key" decision.** Two Apps: Baton's dispatch App (Worker secret, §12.7) and the check App (key on the deliverer's host, R-BTN-115). The gates and both halves of the decision agree once that is seen.
- **G-BTN-66 vs G-BTN-127 on `waiting_on: policy`.** A posted label may not be `policy`; Baton reserves it for an unmet required bar (`06:63–67`). No contradiction.
- **G-BTN-149, G-BTN-42, G-BTN-133.** "Needs you" (drawn by the Conditions screen), `locate` and held renames all still exist in the rules.
- **Decisions checked against their rule text and found matching:** one claim per ticket and the `concurrency`/`max_claims` bound (R-BTN-4); lease clamp (R-BTN-9); two resource scopes and the administrator's reading as one more instrument (R-BTN-76); runner-confirmed capability blocks (R-BTN-121/-126); three `next_source` values; executor sources `builtin`/`home`/`home-signed`/`pinned` (R-BTN-107); the mask suffix list (R-BTN-144); 14-day floor notice (R-BTN-197); `timed_out`, no `neutral` (R-BTN-114); GitLab access level 30 (R-BTN-139); presets `cooperative`/`protected`/`protected-hardware`/`plain-git` and `human-gates` only under `hardware` (R-BTN-188/-189); `domains.per_run`; the sign-in and minting-key confirmation (R-BTN-155); the webhook path's 10-minute staleness (R-BTN-73); capacity seats as rule 11 (R-BTN-178); the dropped settings and fields (`required_independence`, `trigger_workflows`, `report_horizon_h`, `extend_to`, `cancel_at`, `baton-reading@1`, `atoms_from`, `uses`) appear in no rule; the one-instance decision (§2.1 has no staging).
- **Open questions.** None of the listed items is answered by a rule; `baton-deploy.yml` still restores the npm cache in both jobs, so that item is still open. Unsettled phrases in §1–§14 ("Until B-154 lands", "returns null until B-186 is built", "until B-73 folds them in") are build-state notes with a ticket each, not undecided questions.
- **The mirror (§16.3, R-BTN-17).** Preconditions-or-skip, the acknowledged cursor clamped to what was returned, and foreign-claim overwrite hang together; I found no way for a replay to overwrite a status.
- **Section 90.** `npm run check:spec` exists (`scripts/check-spec.mjs`); every ticket id I looked up from my span exists in `tickets/` or `tickets/archive/`.

## Not covered

- **Decisions.** Of roughly 170 decision lines, about 60 were checked against the cited rule's text (those named in the findings and in "found sound"). The rest were checked only for id validity and for contradiction with other decision lines, not against the rule body — in particular every line citing R-BTN-180 to R-BTN-192 beyond the points above (the §12.8 policy, attestations, the four nouns, fact reader, leg-state branch), the dashboard V2 lines (2026-11-09) against §11.4 other than Stop and Accept, R-BTN-161/-162/-163 handler and suspension lines, R-BTN-108 to R-BTN-112 schema lines, R-BTN-133/-134 course source lines, R-BTN-47 seed and retirement lines, and R-BTN-198/-195 leg events and `interact`.
- **Gates.** All 147 rows were read. About 45 were compared with rule text. Not verified against their rules: G-BTN-11, -51, -82, -125, -135, -136, -145 (§3); -18, -39, -62, -69, -73, -76, -78 (§4); -32, -58, -63, -64, -74, -91, -92, -98, -100, -102, -137 (§5); -10, -40, -85, -88, -97, -104, -111, -112, -114, -116, -162 to -166 (§6); -106, -146, -148, -150, -152, -153, -154 (§7); -5, -17, -87, -89, -90, -94, -99, -108, -168, -119, -128, -140 (§8); -1, -2, -6, -14, -20, -23, -24, -33, -38, -43, -167, -44 (§9); -143 (§10); -55, -57, -117, -121, -155 (§11); -12, -13 (§12); the adoption gates -8, -9, -19, -22, -35, -41 beyond reading them against §16.
- **Scenario text** was read only where a gate finding needed it (S-BTN-14 and S-BTN-16 were not read against §16.1).
- **Rules with no gate or scenario at all** were not enumerated.
- `npm run check:spec` and `npm run spec:impact` were not run; docs' `BATON_DOCS_DEPLOYMENT` and its anchors table are outside this repository and were not read, so §16's docs paths are unverified.
- `BATON_MCP_OAUTH_SPEC.md` was not read.
