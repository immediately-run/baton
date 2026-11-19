---
title: "Adversarial review 2026-11-18 — the gate rows the first pass did not reach"
description: "One reviewer's findings, as filed, on the 85 G-BTN rows of BATON_SPEC §15 that the first pass read but did not compare with their rules."
order: 23
tags: [review]
---

# Adversarial review 2026-11-18 — the gate rows the first pass did not reach

All 85 assigned rows were compared with their rules' text as it reads today. 16 findings: 0 critical, 0 high, 5 medium, 11 low. No gate in the span cites a retired or undefined rule or scenario id (every `S-BTN-n` in every "Proved by" cell resolves to a row). No file was modified or written.

Paths are relative to `/Users/neumark/git/baton/`. Gate rows are in `spec/BATON_SPEC/15-verification.md`.

---

### GATE-1: G-BTN-44 confirms ends by a posted path and an end station, which R-BTN-10 no longer does
- **Severity:** medium
- **Kind:** restatement-drift (a gate testing a rule as it used to read)
- **Rules:** G-BTN-44, R-BTN-10, R-BTN-71, R-BTN-39
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/15-verification.md:422` — "A suspension is confirmed by a later path extending it by edges; `done` by an end station or closure under a greater observation, or absence, a `cancel` leg's by acceptance alone"
  - `spec/BATON_SPEC/09-claims.md:245-250` — "It is confirmed by the first accepted snapshot whose observation began after the end and that: for an end that named `ended_at_sha` (R-BTN-8), carries the sync's `std:git.evidence@1` for it with `found: true` … for an end that named none, is accepted at all"
  - `spec/BATON_SPEC/09-claims.md:251` — "for `done`, shows the ticket closed as done (`closed_tickets`) or absent, whatever it named"
  - `spec/BATON_SPEC/04-tickets-syncs-board.md:62-66` — Baton receives "never the ticket's station or path, which are Baton's"
  - `spec/BATON_SPEC_HISTORY.md:5014` — "confirmed when the posted path extends the expected path by edges (R-BTN-71, R-BTN-10; G-BTN-44, -63)"
- **The problem:** The gate states the retired M8 mechanism. No snapshot posts a path today, so "a later path extending it by edges" has no observable. "`done` by an end station" has none either; R-BTN-10 confirms `done` only by closure or absence. An implementer proving G-BTN-44 would rebuild posted-path comparison.
- **Counter-reading considered:** "path" could mean Baton's own path. That path is recorded at the end itself (R-BTN-83, "Recorded at once"), so nothing later extends it to confirm anything. Searched `extend` and `by edges` across the sections; the only match is the history line.
- **Smallest fix:** Rewrite the first two clauses to: "a suspension naming evidence is confirmed by a later snapshot's `std:git.evidence@1 found: true`, one naming none by any later snapshot; `done` by closure or absence".

### GATE-2: G-BTN-74 says Baton stores "URIs and digests only"; R-BTN-108 and §13 store inline output values
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** G-BTN-74, R-BTN-108, R-BTN-82, §13 `leg_outputs`
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:332` — "markers only from validated results; Baton stores URIs and digests only; replay writes nothing"
  - `05-courses.md:367-368` — "A leg output is `{name, schema: "<id>@<version>", uri?, digest?, value?}`: `uri` and `digest` (R-BTN-82), or an inline `value` of at most 4 KB serialized"
  - `05-courses.md:372-375` — "Baton stores a `value` only when its schema chain sets `additionalProperties: false` … Stored values are course data, in the owner-state export (R-BTN-88)."
  - `13-data-model.md:137` — "`value_json` (≤ 4 KB, bounded schemas only)"
- **The problem:** The gate's invariant is false for every inline output, including a person leg's `answer`. A test of the gate as written would fail the implementation the rules require.
- **Counter-reading considered:** The gate may speak only of pointer outputs. It says "only" with no such qualifier, and S-BTN-48 exercises no inline value.
- **Smallest fix:** "Baton stores URIs, digests and bounded inline values (R-BTN-108) only, and never fetches".

### GATE-3: G-BTN-69 presumes a course can have no `sync.mjs`; R-BTN-134 makes it required and the CLI holds no course
- **Severity:** medium
- **Kind:** restatement-drift / contradiction with another gate
- **Rules:** G-BTN-69, G-BTN-129, R-BTN-134, R-BTN-74, S-BTN-43, S-BTN-110
- **Confidence:** medium
- **Evidence:**
  - `15-verification.md:318` — "With no `.baton/tickets.mjs` or course `sync.mjs`, `baton repo sync` posts the default markdown source's tickets on `create-pr` with readiness and fact arrivals from PR facts; … another course without `sync.mjs` fails the sync"
  - `05-courses.md:16-18` — "The CLI holds the machinery that reads any course and holds no course. The course directory holds `course.json` (R-BTN-69), `sync.mjs` (its station function, R-BTN-74; required)"
  - `05-courses.md:52-53` — "a directory without `course.json` or `sync.mjs`, is a course fault (`spec`)"
  - `15-verification.md:342` — G-BTN-129: "The CLI holds no course"
- **The problem:** The gate describes the time when the CLI shipped `create-pr`'s station function. Today `create-pr` is a sourced course whose `sync.mjs` is in its source. "No course `sync.mjs`" is a fault for every course, not a default path. "Another course" implies `create-pr` is exempt, which R-BTN-134 denies. Two readings follow: (a) a repository with no `.baton/` still syncs on a built-in `create-pr`; (b) every course needs a `source` or its own directory.
- **Counter-reading considered:** "No course `sync.mjs`" could mean "none in the home", the source supplying it. Then "another course without `sync.mjs` fails" is just R-BTN-134's general fault and the `create-pr` special case is empty. Searched `sync.mjs`, `default_course`, `standard station function` and `defaults-only`. R-BTN-74 still says `default_course` is "itself default `create-pr`" (`04-tickets-syncs-board.md:60-61`), but nothing says where that course's files come from when the home names no source.
- **Smallest fix:** Restate as "with no `.baton/tickets.mjs`, the sync posts the markdown source's tickets on the entry's course, read from its source (R-BTN-134); a course whose directory lacks `sync.mjs` fails the sync". Say in R-BTN-74 what `create-pr` resolves to with no `courses[]` entry.

### GATE-4: G-BTN-89 says a session "never holds a runner secret"; under the default `builtin` executor the leg can read it
- **Severity:** medium
- **Kind:** unverifiable / contradiction
- **Rules:** G-BTN-89, R-BTN-107, R-BTN-14, R-BTN-144, S-BTN-62
- **Confidence:** medium
- **Evidence:**
  - `15-verification.md:387` — "A session's move reaches Baton only after the runner checks it; a session never holds a runner secret"
  - `08-runners.md:402-404` — "A leg can read the runner's state file and use its ssh-agent (R-BTN-14, R-BTN-144): `builtin` binds only cooperating legs."
  - `08-runners.md:101-102` — "State file `~/.cache/immediately-run/baton/<session>.json`, mode 0600: runner id, secret, active claims with their nonces"
  - `08-runners.md:69-70` — "Sessions of one OS user can read each other's 0600 files and share an ssh-agent"
- **The problem:** A `builtin` leg can read the state file, take the secret and (with the shared ssh-agent) call Baton directly. Both halves of the gate then fail. As an invariant it holds only for executors that isolate, which Baton "is agnostic about". S-BTN-62's "no secret in the session's view" checks the `BATON_STATE` view, not the reachable file.
- **Counter-reading considered:** "Holds" could mean "is handed by the runner"; R-BTN-144 gives a "read-only state view (no runner secret)". That is a weaker, checkable statement, but it is not what the gate says, and §12 reads gates as invariants.
- **Smallest fix:** "the runner hands a session no runner secret, claim id or Baton credential (brief, environment, state view); under `builtin` this binds cooperating legs only (R-BTN-107)".

### GATE-5: G-BTN-104 says "a withdrawn ticket meets nothing"; R-BTN-120 lets it meet `withdrawn` and `closed`
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** G-BTN-104, R-BTN-120, R-BTN-75, S-BTN-82
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:353` — "Cycles keep their blocks and are raised; a withdrawn ticket meets nothing; `reached` reads a closed ticket's final path"
  - `06-prerequisites-blocks-advice.md:42-43` — "A withdrawn ticket meets only `withdrawn` and `closed`; `"skip_withdrawn": true` drops it from the selection instead."
  - `06-prerequisites-blocks-advice.md:100` — block `ref` forms "`@done`, `@withdrawn` or `@closed`"
  - `15-verification.md:163` — S-BTN-82: "a withdrawn dependency … never met"
- **The problem:** An entry `{"closed": true}` or `{"withdrawn": true}` on a withdrawn ticket holds by the rule and is "never met" by the gate and scenario. The fail-fast and `allSettled` patterns R-BTN-165 documents depend on the rule's reading.
- **Counter-reading considered:** The gate may mean `at`/`reached`/`done` entries only. It does not say so, and S-BTN-82 names no entry kind.
- **Smallest fix:** "a withdrawn ticket meets only `withdrawn` and `closed` entries"; add both to S-BTN-82.

### GATE-6: G-BTN-166 and S-BTN-193 choose leg state by the forge alone; R-BTN-190 also reads the course's facts
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** G-BTN-166, S-BTN-193, R-BTN-190
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:365` — "Leg state is the PR conversation on a forge and, on a `git` repository, an orphan `baton-legs/<ticket>` branch"
  - `15-verification.md:268` — S-BTN-193: "on the `git` repository `branch`, by the forge alone"
  - `05-courses.md:996-998` — "It is `forge` when the home is on a forge **or** the claimed ticket's course reads PR facts (`facts: ["prs"]`, R-BTN-134), and `branch` otherwise."
  - `05-courses.md:999-1000` — "a `git` home's PR course among them"
- **The problem:** A `git` home running `create-pr` over forge `code_repos` gets `leg_state: forge` by the rule and `branch` by the gate and scenario.
- **Counter-reading considered:** None survives; the scenario's words "by the forge alone" state the opposite of the rule's "or".
- **Smallest fix:** Gate: "…and `branch` only where the home is `git` and the course reads no PR facts". Add that case to S-BTN-193.

### GATE-7: G-BTN-137 holds a file that removes an exempt leg; R-BTN-142 passes it
- **Severity:** low
- **Kind:** contradiction
- **Rules:** G-BTN-137, R-BTN-142
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:343` — "removing or renaming a barred or exempt leg holds the file"
  - `05-courses.md:514-516` — held when it "removes or renames a leg the bar names, renames a leg named in `except`, or gives a name in `except` to a leg that carries `renamed_from` or is new"
  - `05-courses.md:520-521` — "An `except` name the file simply drops (no rename) passes; Baton deletes it from the stored list and logs an `admin` event."
- **The problem:** Removing an exempt leg is held by the gate and accepted by the rule. S-BTN-117 ("`except` updated") follows the rule.
- **Counter-reading considered:** None; the four combinations in the gate include the one the rule explicitly passes.
- **Smallest fix:** "removing or renaming a barred leg, or renaming an exempt one, holds the file; a dropped exempt name is deleted".

### GATE-8: G-BTN-97 says each unmet prerequisite "is a block row on the leg"; three kinds in R-BTN-120's table are not
- **Severity:** low
- **Kind:** contradiction
- **Rules:** G-BTN-97, R-BTN-120, R-BTN-75, R-BTN-178
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:352` — "A leg is offered only when every prerequisite holds; each unmet one is a block row on the leg"
  - `06-prerequisites-blocks-advice.md:17` — station: "nothing: only legs leaving the ticket's station are offered"
  - `06-prerequisites-blocks-advice.md:25` — time: "a stored `waiting` state, not a block"
  - `06-prerequisites-blocks-advice.md:130-135` — capability "Rows are rewritten only when a count crosses zero … One runner's answer is rule 4, computed on the spot."
  - `06-prerequisites-blocks-advice.md:101` — capability row "its leg, or the whole ticket for the clause"
- **The problem:** A runner lacking a capability others hold has an unmet prerequisite and no row. A `time` wait has none by definition. A `resource` row is advice, so the first clause ("offered only when every prerequisite holds") is also wrong for a claim by `ticket_id`.
- **Counter-reading considered:** S-BTN-74 covers "four unmet prerequisites … plus `not-declared`", acknowledging the capability case. The gate's universal form does not.
- **Smallest fix:** "each unmet ticket, retry, condition, call, attestation or fleet-wide capability or resource prerequisite is a row of the blocks index (R-BTN-75); a `time` wait and one runner's missing capability are not".

### GATE-9: G-BTN-8 says the mirror "never overwrites an unexpected status"; §16.3 has it overwrite a foreign claim
- **Severity:** low
- **Kind:** contradiction
- **Rules:** G-BTN-8, G-BTN-22, R-BTN-17, §16.3, S-BTN-14
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:442` — "*adoption:* The mirror never overwrites an unexpected status; a replay is a no-op"
  - `16-adoption.md:120-124` — "A claim commit the mirror did not author, over an active Baton claim, is overwritten with the holder's status and note and logged `foreign-claim` … This is the one place a writer for Baton writes git over another writer."
  - `15-verification.md:279` — S-BTN-14 expects "no overwrite; no-op; reverted, holder kept"
- **The problem:** G-BTN-8 (never) and G-BTN-22 with the foreign-claims paragraph (overwritten, reverted) are both proved by S-BTN-14, which expects both outcomes for different inputs. The gate does not scope itself.
- **Counter-reading considered:** G-BTN-8 is about event-driven transitions under R-BTN-17. The gate does not say so, and §16.3 itself calls the foreign-claim case an exception.
- **Smallest fix:** "A mirrored transition is written only over the status its event expects (R-BTN-17); the one overwrite is a foreign claim over a Baton holder (G-BTN-22)".

### GATE-10: G-BTN-6's "only" omits three confirmations R-BTN-10 and G-BTN-44 allow; its one test asserts the retired model
- **Severity:** low
- **Kind:** contradiction between gates
- **Rules:** G-BTN-6, G-BTN-44, R-BTN-10, R-BTN-168
- **Confidence:** medium
- **Evidence:**
  - `15-verification.md:407` — "A completion is confirmed only by a later-observed snapshot showing it; unclaimable until then"
  - `09-claims.md:253-254` — "a `cancel` leg's `done` (R-BTN-168) as an end that named no evidence is, by acceptance alone"
  - `09-claims.md:258-263` — "never while a completion is unconfirmed (one marked `superseded_at` excepted, R-BTN-168) … an administrator confirms or releases it from the dashboard"
  - `test/unit/claims.test.ts:410` — "G-BTN-6: a completion is confirmed only by ancestry and status; until then the item is not claimable"
  - `15-verification.md:108` — S-BTN-36: "confirmed by the next later snapshot, never by ancestry"
- **The problem:** A cancel leg's `done`, a superseded completion and an administrator's confirm each break "only … showing it" or "unclaimable until then". The gate's proof is "tests", and the one test citing it describes confirmation "by ancestry", which S-BTN-36 forbids.
- **Counter-reading considered:** G-BTN-6 is the short form and G-BTN-44 the full one. Two gates stating one fact differently is the drift `spec-writing.mdx` forbids.
- **Smallest fix:** Fold G-BTN-6 into G-BTN-44 (after GATE-1's rewrite) or add the three exceptions; retitle the test.

### GATE-11: G-BTN-51 maps a branch to "every ticket" a pattern gives; R-BTN-141 maps it to the longest id only
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** G-BTN-51, R-BTN-141, R-BTN-26 (§9), S-BTN-49
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:302` — "a branch maps to every ticket a current or previous `branch_pattern` gives, and a collision refuses the push while either is held"
  - `03-repositories-and-forges.md:545-547` — "A branch maps to a ticket only when no other ticket of the same repository whose id is longer also matches it; the fact adapter, standard station functions, the local branch check and the branch-holder query all apply this."
  - `15-verification.md:112` — S-BTN-49: "the children's branches and PRs map to them alone, their pushes allowed"
- **The problem:** By the gate, `claude/T-12-1-impl` maps to `T-12` and `T-12-1`, and a push by the child's holder is refused while the parent is held. The rule and S-BTN-49 say it is allowed.
- **Counter-reading considered:** "Every ticket" is meant across repositories (the collision clause). Within one repository the rule narrows it and the gate does not.
- **Smallest fix:** Insert "after longest-id-wins within a repository (R-BTN-141)".

### GATE-12: G-BTN-125 says "one budget"; R-BTN-96 says one budget per host
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** G-BTN-125, R-BTN-96, R-BTN-140
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:307` — "A ticket's PRs across repositories are read under one budget, batched over GraphQL, as one change"
  - `03-repositories-and-forges.md:432-434` — "The adapter reads the home repository and every `code_repos` repository … under one request budget **per host**."
  - `03-repositories-and-forges.md:428` — "GitLab merge requests and approvals, Gitea PRs and reviews"
- **The problem:** With `code_repos` on two hosts the gate's single budget is not the rule's. "Batched over GraphQL" is GitHub's adapter only (`03-…:436`); the gate reads as universal. S-BTN-106 covers neither two hosts nor a non-GitHub repository.
- **Counter-reading considered:** The gate predates multi-host `code_repos` and is right on one GitHub host. The rule's bold "per host" is the amendment the gate missed.
- **Smallest fix:** "under one budget per host, on GitHub batched over GraphQL".

### GATE-13: G-BTN-145 says the local host "binds loopback" and CI tokens pass only for "push, schedule or dispatch"; R-BTN-158 and R-BTN-15 allow more
- **Severity:** low
- **Kind:** contradiction with its own scenario
- **Rules:** G-BTN-145, R-BTN-158, R-BTN-15/R-BTN-156, S-BTN-125
- **Confidence:** high (binding); medium (events)
- **Evidence:**
  - `15-verification.md:311` — "CI tokens pass only for push, schedule or dispatch runs of the top-level default-branch workflow; … the local host binds loopback and refuses unsafe file modes"
  - `12-security.md:207` — "`baton server start` binds `127.0.0.1` unless `--bind <address>` says otherwise."
  - `15-verification.md:105` — S-BTN-125: "non-loopback bind; … bind as asked"
  - `03-repositories-and-forges.md:228-229` — GitLab "`pipeline_source` in `push`, `schedule`, `web`, `api`, `trigger`"
- **The problem:** The gate's proving scenario expects a non-loopback bind to succeed. A GitLab `web` or `api` pipeline's token passes by the rule and fails the gate's list, and GitLab has no "top-level workflow" claim.
- **Counter-reading considered:** "Binds loopback" means the default, and "dispatch" loosely covers GitLab's `web`/`api`/`trigger`. A gate's threshold should not need that reading.
- **Smallest fix:** "binds loopback unless `--bind` names another address"; "CI tokens pass only for R-BTN-15's listed events on the default branch".

### GATE-14: G-BTN-10, G-BTN-9 and G-BTN-38 have no test behind "Proved by"; G-BTN-10 rests on a term no rule defines
- **Severity:** low
- **Kind:** unverifiable
- **Rules:** G-BTN-10, G-BTN-9, G-BTN-38, §6.6, R-BTN-98, R-BTN-31
- **Confidence:** high on citations; medium on G-BTN-10's meaning
- **Evidence:**
  - `15-verification.md:345` — "G-BTN-10 | For one course, matching's order equals the course's claim order filtered by the matching rules | fixture boards"
  - `06-prerequisites-blocks-advice.md:481-483` — "The default order within a group: (1) expedite … (2) fewer legs to an end (`to_end`, R-BTN-69); (3) the sync's `rank`; (4) the queued leg's `ready_since` … (5) ticket id."
  - `06-prerequisites-blocks-advice.md:490` — "The course's own order and advice are the runner's (`rank.mjs`, R-BTN-98)."
  - `15-verification.md:443` — "G-BTN-9 | *adoption:* Mirror commits parse identically with docs' readers | tests"
  - `test/unit/spec-files.test.ts:28` and `:99` — the only files citing G-BTN-9 and G-BTN-10, as fixture strings ("`| G-BTN-9 | a gate |`", "`| G-BTN-10 | another gate |`")
  - `src/shared/baton.mjs:17` — the only citation of G-BTN-38, a source comment; no test cites it
- **The problem:**
  - "The course's claim order" appears elsewhere only in §16.2 step 1 (`16-adoption.md:87`), where it means docs' legacy claim tool. G-BTN-10 is not marked *adoption*. Under §6.6 Baton's order puts `to_end` before `rank`, so it equals a course's order only if that order sorts the same way.
  - DEC-11 counted G-BTN-9 and G-BTN-10 among gates "at least cited by some file". Those citations are index-generator fixtures, not proofs.
  - G-BTN-9 needs docs' readers, which are not in this repository.
- **Counter-reading considered:** `rank` could encode the course's claim order. Then the gate is true only for courses without `to_end` differences, which it does not say.
- **Smallest fix:** Mark G-BTN-10 *adoption* and define its term by §16.2, or restate it as "matching's order is the default order of §6.6 filtered by the gates" (which duplicates G-BTN-47 and could be deleted). Name a test path for G-BTN-9 and G-BTN-38. Add these three to DEC-11's list.

### GATE-15: G-BTN-117 requires every named command to be `baton <noun> <verb>` in the tree; R-BTN-127 itself still names the retired `baton run`
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** G-BTN-117, R-BTN-127, S-BTN-97
- **Confidence:** high
- **Evidence:**
  - `15-verification.md:430` — "Commands are `baton <noun> <verb>` …; every command the specification names is in R-BTN-127's tree"
  - `11-people.md:262-263` — "the only top-level verbs are `help` and `version`"
  - `11-people.md:297-298` — "`baton run` and `baton runner start` keep their `--home`: a name resolves to its home's `checkout`"
  - `15-verification.md:246` — S-BTN-97: "a renamed name (`baton run`) … exit 2 with its `renamed:` line"
  - `spec/BATON_SPEC_HISTORY.md:1807` — "(`baton run`, one of the twelve, survived in R-BTN-131 and is corrected there)"
- **The problem:** The rule the gate tests names a command that the same rule, the scenario and the history say exits 2. S-BTN-97's check "the tree against every command this specification names" fails on the rule's own text. The history shows the same stale name was already corrected once, in R-BTN-131.
- **Counter-reading considered:** `baton run` could be kept as an alias. `11-people.md:375` says "No alias stays."
- **Smallest fix:** Delete "`baton run` and" at `11-people.md:297`.

### GATE-16: G-BTN-43's "a refusal changes nothing" is not stated by R-BTN-63, whose wording reads the other way, and neither cited scenario refuses an advance
- **Severity:** low
- **Kind:** underspecified / unverifiable
- **Rules:** G-BTN-43, R-BTN-63, R-BTN-71, S-BTN-17, S-BTN-19
- **Confidence:** low
- **Evidence:**
  - `15-verification.md:420` — "`advance` moves to the next leg whenever the gates pass, in one transaction; a refusal changes nothing | S-BTN-17, -19"
  - `05-courses.md:251-257` — "`advance {reached, leg}` finishes the running leg, if any, at `reached` — one of its outcomes, else refused `off-graph` — records the position, then starts `leg` if it leaves `reached`, … and every holder gate holds"
  - `15-verification.md:151` — S-BTN-19: "both lines limited until +2 h when `implement` ends | ranking reads `frees_at`; suspended; first in line at +2 h"
- **The problem:** Two readings of an `advance` whose `reached` is valid but whose new leg fails a gate: (a) nothing is written and the old leg is still running (the gate); (b) the finish and position are recorded and only the start is refused (the rule's sentence order). They differ in `claim_legs`, run counts and what a following `suspended:<station>` may name. S-BTN-17 has five accepted advances; S-BTN-19 has none refused.
- **Counter-reading considered:** `09-claims.md:52-54` says Baton "checks the edge and the gates in one transaction and moves the claim on … or refuses", which favours (a). R-BTN-71 lets the suspension name "the outcome its running leg reached if that leg finished", which works under (a) only if the suspension itself finishes the leg. Searched "refusal changes nothing" and "refused `advance`"; nothing else states it.
- **Smallest fix:** Add to R-BTN-63: "a refused `advance` writes nothing; the running leg is still running". Cite S-BTN-33 or S-BTN-72, which do refuse an advance.

---

## Read but found sound

Compared with the rule body and consistent, apart from simplifications that lose nothing testable:

- **§3:** G-BTN-11 (R-BTN-15: `ref`, `job_workflow_ref`, `workflow_ref`), G-BTN-82 (R-BTN-93 `verifySync`), G-BTN-135 (R-BTN-139), G-BTN-136 (R-BTN-140, -141, -82).
- **§4:** G-BTN-18 (R-BTN-11), G-BTN-39 (R-BTN-33, `04-…:654`), G-BTN-62 (R-BTN-62/150, R-BTN-147), G-BTN-73 (R-BTN-83, clause for clause), G-BTN-76 (R-BTN-86), G-BTN-78 (R-BTN-88).
- **§5:** G-BTN-32 (R-BTN-22 rule 9), G-BTN-58 (R-BTN-60), G-BTN-63 (R-BTN-63, R-BTN-69 validation), G-BTN-64 (R-BTN-64), G-BTN-91 and G-BTN-102 (R-BTN-108), G-BTN-92 (R-BTN-109), G-BTN-98 (R-BTN-121, R-BTN-174), G-BTN-100 (R-BTN-112).
- **§6:** G-BTN-40 (§6.6), G-BTN-85 (R-BTN-100), G-BTN-88 (R-BTN-76), G-BTN-111, -112, -114 (R-BTN-126, R-BTN-75), G-BTN-116 (R-BTN-126 "Drawn as an edge"), G-BTN-162 (R-BTN-178, S-BTN-21), G-BTN-163 (R-BTN-188), G-BTN-164 and G-BTN-165 (R-BTN-189, R-BTN-186).
- **§7:** G-BTN-106 and G-BTN-146 (R-BTN-160, R-BTN-161), G-BTN-148 (R-BTN-161), G-BTN-150 (R-BTN-165), G-BTN-152 (R-BTN-167, R-BTN-90 text at `07-…:468-486`), G-BTN-153 (R-BTN-168), G-BTN-154 (R-BTN-171, R-BTN-94).
- **§8:** G-BTN-5 and G-BTN-17 (R-BTN-3, -14, -13, -174), G-BTN-87 (R-BTN-102), G-BTN-90 (R-BTN-106 `no_chain_from`, S-BTN-64, -67), G-BTN-94 (R-BTN-117, R-BTN-159), G-BTN-99 (R-BTN-106 bounded run), G-BTN-108 (R-BTN-123), G-BTN-168 (R-BTN-107; "executor data" is the defined term, so the stored run strings do not contradict it), G-BTN-119 (R-BTN-128, §14 route row), G-BTN-128 (R-BTN-133, read by grep only), G-BTN-140 (R-BTN-146).
- **§9:** G-BTN-1 (R-BTN-4), G-BTN-2 (Claiming), G-BTN-14 (R-BTN-19, S-BTN-4), G-BTN-20 (R-BTN-6, -26, three fence layers), G-BTN-23 (R-BTN-20), G-BTN-24 (§9.9), G-BTN-33 (R-BTN-24), G-BTN-167 (`09-…:33-34`).
- **§10:** G-BTN-143 (R-BTN-114, R-BTN-153).
- **§11:** G-BTN-55 (R-BTN-13, R-BTN-159), G-BTN-57 (R-BTN-57, -58, -102), G-BTN-121 (R-BTN-130, R-BTN-186), G-BTN-155 (R-BTN-159).
- **§12:** G-BTN-12 (R-BTN-16 "Writes"), G-BTN-13 (§12.3; the gate lists a subset of the banned characters).
- **§16:** G-BTN-19, -22, -35 (R-BTN-28, §16.1, §16.3), G-BTN-41 (§16.3; its test covers the "server half" only).
- **Ids:** every `R-BTN-n` a row in the span names is defined; every `S-BTN-n` in any "Proved by" cell of the table is defined.
- **Test citations:** every "tests"-proved gate in the span is cited by at least one real test file, except those in GATE-14.

## Not covered

- No assigned gate id was skipped. Depth varied:
  - R-BTN-127's command tree (17 KB) and R-BTN-155 (17 KB) were not read whole, so G-BTN-117's "help at every level" and G-BTN-57's sign-in clause were checked against the rule heads and scenarios only.
  - R-BTN-133 and R-BTN-121 were read by grep, not line by line (G-BTN-128, G-BTN-98).
  - R-BTN-73/-95 were not opened; G-BTN-145's notification clause rests on S-BTN-125.
  - R-BTN-47 was not read, though G-BTN-51 touches the registry.
- For scenario-proved gates I checked that the scenario exists and read its row. I did not check that each clause of each gate is exercised by it; GATE-16 is the one case I noticed.
- The Quint model was not searched for gate ids beyond the "tests"-proved rows.
- `npm run spec:impact` and `npm run check:spec` were not run.
