---
title: "Adversarial review 2026-11-18 — cross-cutting: a ticket's life across sections"
description: "One reviewer's findings, as filed, from following tickets, states and vocabulary across every section of BATON_SPEC."
order: 20
tags: [review]
---

# Adversarial review 2026-11-18 — cross-cutting: a ticket's life across sections

Method: walked the six journeys across `spec/BATON_SPEC/*.md`, reading in full §9, §10, §13, §7, §5.3–5.4, §5.7, §4.3 (R-BTN-62/11/147/199), §4.4–4.8, §6.1–6.2, §6.4–6.9, R-BTN-1/33/35/39/8/45/46/50/66 (§1), R-BTN-47/92/94/138/140/141 (§3), §8.1–8.2, R-BTN-119/145, R-BTN-149 and the alarm table (§2), R-BTN-191 and the `tickets.created: proposed` rules (§12.8), §11.4's rules list, and the runner rows of §14; everything else by grep. Paths are relative to `spec/BATON_SPEC/`. Quotes are verbatim; `…` marks an elision inside a quote.

Counts: 0 critical, 6 high, 15 medium, 15 low.

## High

### LIFE-1: Under `tickets.created: proposed`, three sections disagree on who writes a child ticket, the outbox has no kind for it, and a call leg's children are dropped so the call never settles
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-161, R-BTN-165, R-BTN-171, R-BTN-86, R-BTN-180/§12.8, §13.8, S-BTN-107
- **Confidence:** high
- **Evidence:**
  - `12-security.md:584` — "**proposed, not filed**: Baton queues an outbox entry for it, and a trusted-runner deliverer writes it on a branch `baton/proposed/<ticket>` from the entry's fields or the creating leg's typed output, through the CLI's own templates (R-BTN-171)"
  - `07-conditions.md:184` — "Under the policy's `tickets.created: proposed` (R-BTN-188) the handler ticket is proposed, not filed: the runner writes it on `baton/proposed/<ticket>`, and it is not claimable until it lands with a `std:approval@1`"
  - `07-conditions.md:620` — "`withdraw` is the one **git kind**: Baton files no ticket of its own (R-BTN-163). The two kinds are the two **delivery classes**, `git` and `forge-check`."
  - `13-data-model.md:184` — "`kind` (`withdraw`\|`forge-check`)"
  - `04-tickets-syncs-board.md:705` — "Baton records them as the run's children (a call's completion range, R-BTN-165) until the first accepted snapshot observed after the end; a reported child that snapshot does not post is dropped with discrepancy `spawned-unposted`"
  - `07-conditions.md:532` — "A `spawned` end that names no children is refused; a completion never holds over none."
- **The problem:**
  - (a) §12.8 says Baton queues an outbox entry and a trusted-runner deliverer writes the proposed ticket. R-BTN-161 says the raising runner writes it. R-BTN-171 and §13.8 say the outbox has exactly two kinds and "Baton files no ticket of its own": there is no entry kind, no `fields` shape and no "confirmed when" for a ticket creation.
  - (b) Trace: a `build-app` call leg under `protected` spawns three children. They sit on `baton/proposed/*` awaiting a human `std:approval@1`. The leg ends `released:blocked` on `call` with `spawned`. The first snapshot after the end reads the default branch and posts none of them, so R-BTN-86 drops all three `spawned-unposted`. The completion range is now empty, "a completion never holds over none", and the mandatory last entry `{"of": "all", "closed": true}` never holds either. The parent keeps its `call` block for ever; when the children later land they are ordinary orphans, not the run's children. S-BTN-107 expects "the third's stages and plan tickets each proposed and claimable only once approved" and the call to settle.
- **Counter-reading considered:** "Baton holds only its filter fields" (`12-security.md:587`) could mean Baton keeps the proposed child as the run's child from the outbox entry. But no rule exempts it from R-BTN-86's first-snapshot drop, no table holds such a row (the board is rebuilt from posts, §13.4), and R-BTN-171 denies the entry exists. Searched: `baton/proposed`, `tickets.created`, `spawned-unposted`, `git kind`, `outbox.git`.
- **Smallest fix:** Decide one writer. Either add a third outbox kind (`propose`, with fields, order, confirmation = "a snapshot posts the ticket") to R-BTN-171/§13.8/§14 and strike "the runner writes it" from R-BTN-161/R-BTN-165, or strike the outbox sentence from §12.8. In R-BTN-86 make the drop wait for the proposal's landing or withdrawal under `proposed`, and add the scenario.

### LIFE-2: A `suspend` block's provisional row is dropped after one hour, so under `proposed` the question is asked again and the ticket ends `blocked-exhausted`
- **Severity:** high
- **Kind:** liveness
- **Rules:** R-BTN-75, R-BTN-126, R-BTN-162, §12.8
- **Confidence:** medium
- **Evidence:**
  - `06-prerequisites-blocks-advice.md:117` — "The first accepted snapshot whose head contains the commit (the observation response's `provisional`, §4.3) replaces it with what it shows; a row not so confirmed within 1 hour, or not shown, is dropped and logged `prerequisite-unconfirmed`."
  - `07-conditions.md:254` — "Its row is provisional on the commit that wrote the handler."
  - `12-security.md:587` — "It is not claimable, no leg reads its body, and the entry is not `confirmed`, until its file lands."
  - `06-prerequisites-blocks-advice.md:199` — "Past `max_blocked` — 5 within 24 hours … the next one holds the ticket (`hold_reason: blocked-exhausted`)"
- **The problem:** Trace under `protected`: a leg raises `hitl`, waits 120 s, and ends `released:blocked` on `{kind: condition}`. The handler commit is on `baton/proposed/<id>`, never in the default branch's head until a human approves. After 1 hour the provisional row is dropped, the ticket unblocks, and a runner claims the leg. `resume` carries no settled condition, so the leg runs, meets the same question, raises again (a second handler proposal) and blocks again. Five rounds in five hours hold the ticket `blocked-exhausted` with five open questions for one decision. The same may happen to R-BTN-126's `ticket` end when the leg writes `depends_at` on the ticket's own branch (R-BTN-131's record courses commit only there): the commit is never "contained" until merge.
- **Counter-reading considered:** R-BTN-162's second paragraph ("It is not provisional: the handler commit was pushed before the wait") covers only ends other than the blocked end; the ordinary blocked end is explicitly provisional. A human may approve inside the hour, but nothing makes a person's latency a correctness condition. Searched: `provisional`, `prerequisite-unconfirmed`, `contains`.
- **Smallest fix:** A `condition` row needs no git confirmation, since Baton holds the `conditions` row (R-BTN-126 already says "Baton holds the others"); make it non-provisional always. For `ticket` rows, state which branch the commit must be on, or confirm against the proposal branch.

### LIFE-3: A ticket that leaves the board and returns loses its position; no rule says where it stands, and a dropped ticket with no "state" keeps nothing at all
- **Severity:** high
- **Kind:** underspecified
- **Rules:** R-BTN-39, R-BTN-12, R-BTN-147, R-BTN-63, §13 conventions, §13.4, S-BTN-39
- **Confidence:** high
- **Evidence:**
  - `13-data-model.md:27` — "When a ticket leaves the board (closed or dropped), exactly its board rows are deleted: `tickets`, `ticket_requires`, `ticket_depends`, `ticket_stations`, …"
  - `13-data-model.md:30` — "Its `ticket_overrides` row and `leg_attempts` move into `closed_tickets.kept_json` and come back if the same id returns (R-BTN-12)"
  - `13-data-model.md:123` — "deleted if the ticket returns, after `kept_json` is restored"
  - `01-what-baton-is.md:113` — "A ticket a snapshot posts for the first time stands at its course's `start` with `start_leg` queued"
  - `01-what-baton-is.md:103` — "Git never writes them: no ticket file, marker, PR or snapshot places a ticket."
  - `04-tickets-syncs-board.md:474` — "the post drops, without listing it in `closed`, a ticket Baton holds state for (a claim, hold, backoff, open condition, fence)"
  - `06-prerequisites-blocks-advice.md:568` — "Baton's traversal record (R-BTN-63) stays with the claims. So withdrawing a ticket in git and reopening it clears nothing."
- **The problem:** `ticket_stations` (station, path, queued leg, `runs_from`) is deleted when a ticket leaves the board. `kept_json` restores only the override and attempts, and `closed_tickets.final_station`/`final_path` are deleted on return. Two readings for a returning id:
  - (A) It is "posted for the first time" again and stands at `start` with an empty path. Then a snapshot has placed a ticket (against R-BTN-39), a ticket at `reviewed` with an open PR is re-offered `implement`, and its `max_runs` counts (kept with `claim_legs`) no longer match its empty path.
  - (B) It is restored from `final_station`/`final_path`. No rule says so, and it is impossible for a dropped ticket that had no claim, hold, backoff, condition or fence, since R-BTN-147 writes a `closed_tickets` row only for one Baton "holds state for". Position is not in that list.

  Trace: an unheld ticket resting at `reviewed` is omitted by one sync run (a source bug, a file moved for one commit) and re-posted by the next. Its position is gone with no event but the row deletion. S-BTN-39 tests hold, attempts and backoff on return, never position.
- **Counter-reading considered:** The history rows survive 90 days, so position could be recomputed from "its latest position row" (R-BTN-81). But R-BTN-81 also says "The rest of the record is never replayed into state", and no rule tells the snapshot transaction to do so. Searched: `returns`, `final_station`, `final_path`, `reopen`, `come back`.
- **Smallest fix:** State in R-BTN-39 "Where a ticket starts" that a returning id is placed from its last position row (or `closed_tickets.final_station`/`final_path`), and have R-BTN-147 keep a `closed_tickets` row for every dropped ticket whose path is non-empty. Extend S-BTN-39 with the position.

### LIFE-4: No rule closes a ticket that reaches an end station without a claim, and "closes" means two different instants for a `suspend` condition
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-70, R-BTN-10, R-BTN-116, R-BTN-160, R-BTN-162, R-BTN-165, R-BTN-169, R-BTN-171, R-BTN-120
- **Confidence:** medium
- **Evidence:**
  - `05-courses.md:190` — "A ticket at an end station is done."
  - `07-conditions.md:114` — "| `suspend` | its handler ticket closes `done` or `withdrawn`, or an owner resolves it (R-BTN-163) |"
  - `07-conditions.md:225` — "A `suspend` condition settles once, in one transaction … the handler ticket's person leg is answered (R-BTN-116)"
  - `06-prerequisites-blocks-advice.md:22` — "| condition | a `suspend` raise past its wait (R-BTN-162) | the handler closes, or an owner resolves it | a `condition` block |"
  - `07-conditions.md:545` — "It has one child, it settles when that child closes"
  - `07-conditions.md:620` — "`withdraw` is the one **git kind**: Baton files no ticket of its own"
  - `04-tickets-syncs-board.md:142` — "| `status` | `done` → `closed` as done; `withdrawn`, `superseded`, `deferred` → `closed` as withdrawn; any other → live, in `display` |"
- **The problem:** A ticket leaves the board only when the source posts it `closed`, that is, when git says `status: done`. A claim's last leg can write that. But a ticket can reach an end station with no claim: a person's answer given in Baton (`baton decision answer`, the dashboard), a person leg's expiry, a fact arrival, or a call's settlement at an end. Then nothing writes git: Baton has no outbox kind for `done`, and no leg runs. The standard `ask` handler ends exactly this way (`answer` → `answered`/`unanswered`, both ends). Two consequences:
  - (1) Every answered handler ticket stays a live ticket in git and on the board, counting toward R-BTN-149's 10,000-ticket cap.
  - (2) The `suspend` condition "closes" — per R-BTN-160's table, §6.1's prerequisite table and R-BTN-165 — only when the handler ticket closes, which never happens, while R-BTN-162 says it settles at the answer. An implementer reading R-BTN-160 keeps `closed_at` NULL, the `condition` block in place and the entry on the Needs-you floor ("until each closes and whatever its handler does", `07-conditions.md:351`) after the person has answered. One reading R-BTN-162 clears them at the answer.

  R-BTN-169's "When the ask closes — answered, expired, withdrawn or superseded" uses a third sense (reached an end station).
- **Counter-reading considered:** "closes" may be shorthand for "reaches an end station". Then R-BTN-160's "`done` or `withdrawn`" (which are `closed_as` values, a snapshot's words) is wrong, and the live-ticket leak in (1) still stands. Searched: `at an end station`, `ticket closes`, `closes the ticket`, `status: done`, the outbox kinds.
- **Smallest fix:** One sentence in R-BTN-160: a `suspend` condition closes when it settles (R-BTN-162); fix §6.1's and R-BTN-165's wording to "settles". Separately, say who closes in git a ticket that arrives at an end with no claim (a `close` outbox kind, or the source treating Baton's end station as closure via `positions`), and what the dashboard calls it meanwhile (see LIFE-12).

### LIFE-5: A check ticket's new head "supersedes" its claims and "restarts at its start station" — R-BTN-168 defines supersession only as cancelling the ticket, and R-BTN-39 allows no such move
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-114, R-BTN-168, R-BTN-39, R-BTN-63, §9.4
- **Confidence:** high
- **Evidence:**
  - `10-checks.md:23` — "A post that changes `check.sha` supersedes every claim on the ticket (released `superseded`, R-BTN-168), and the ticket restarts at its start station on the new head"
  - `07-conditions.md:563` — "A ticket is cancelled when its file says withdrawn (R-BTN-74) or when Baton **supersedes** it because:" (four causes follow; a changed `check.sha` is not one)
  - `07-conditions.md:578` — "marks the ticket **`cancelling`** … a flag beside any hold it carries, which no owner lifts and which is cleared when the ticket closes"
  - `01-what-baton-is.md:118` — "**Who moves a ticket.** Only these, each an edge of the course file from Baton's current station:"
  - `09-claims.md:168` — "| `released:superseded` | `released` | Baton superseded the ticket (R-BTN-168) | no |"
- **The problem:** R-BTN-168's "Superseding" is one transaction with four effects, the last of which marks the ticket `cancelling` and leads to its close as `withdrawn` (a check course has no `cancel` leg, so "at once"). Read literally, every push to a PR closes its check ticket `withdrawn`. R-BTN-114 instead wants a claim-level supersession and a jump back to `start`. That move is not an edge and is absent from R-BTN-39's exhaustive list. It also leaves unsaid what happens to the path, to `max_runs` counts and `leg_attempts` of the old head, and to a ticket resting at an end station.
- **Counter-reading considered:** R-BTN-114 is the specific rule and overrides. But it cites R-BTN-168 as its authority for both the release and `superseded_at`, and the end table's one row for `released:superseded` says "Baton superseded the ticket". Searched: `restarts at its start`, `supersede`.
- **Smallest fix:** In R-BTN-168 separate "superseding a claim" (release + `superseded_at`) from "superseding a ticket" (plus `cancelling`). Add "a check ticket's new head" to R-BTN-39's movers with its effect on path, run counts and attempts.

### LIFE-6: R-BTN-153 confirms a check's verdict "by a post showing the ticket at that same `reached`" — a board post carries no station
- **Severity:** high
- **Kind:** stale-reference
- **Rules:** R-BTN-153, R-BTN-10, R-BTN-39, R-BTN-191, §4.4, §13.4
- **Confidence:** medium
- **Evidence:**
  - `10-checks.md:82` — "Baton queues a concluding `forge-check` entry (R-BTN-115) only for an ordinary claim, held by a check-runner, that ended `done` at a `reached` the owners' `conclusions` map, confirmed (R-BTN-10) by a post showing the ticket at that same `reached` with `check.sha` equal to `claims.check_sha`"
  - `10-checks.md:87` — "The conclusion is the owners' mapping of the end's own `reached`, never of a posted station."
  - `10-checks.md:89` — "Anything else concludes nothing and raises `baton.check-unattested`; the change stays pending, so the gate fails closed."
  - `01-what-baton-is.md:103` — "Git never writes them: no ticket file, marker, PR or snapshot places a ticket."
  - `13-data-model.md:114` — "`stations_observation` (the latest accepted snapshot to post stations)"
- **The problem:** §4.4's ticket object and R-BTN-191's attestation table give a post no way to "show the ticket at" a station. Readiness is attested `at` the position Baton itself handed the sync and lists legs leaving it (none at an end); `std:git.implied@1` is optional and "never compared with Baton's position". Two readings:
  - (A) The condition is vacuous (Baton's own `positions` echoed back). Then "confirmed by a post showing … that same `reached`" protects nothing.
  - (B) It requires a posted or implied station equal to `reached`. Then a `changes` check ticket, which has no file and no facts until its own check run exists, never satisfies it; every check ends in `baton.check-unattested` and every PR stays pending.

  §13's `stations_observation` and R-BTN-153 both describe a model in which snapshots posted stations.
- **Counter-reading considered:** R-BTN-10's own bullet ("a check ticket's `done` only at the end's own `reached` and bound `check_sha`") can be read as comparing Baton's stored position and the posted `check.sha`. That is reading A, and then R-BTN-153's "never of a posted station" guards against something that cannot occur. Searched: `posted station`, `post stations`, the §4.4 schema, R-BTN-191's table.
- **Smallest fix:** Rewrite R-BTN-153's confirmation as: an accepted post, observed after the end, that still posts the check ticket with `check.sha = claims.check_sha` while Baton's position is the end's `reached`. Rename or define `stations_observation`.

## Medium

### LIFE-7: A `call` block's `ref` is the run's `claim_legs.id` in §6.2 and its `seq` in §7.6
- **Severity:** medium · **Kind:** contradiction · **Rules:** R-BTN-75, R-BTN-165, §13.5 · **Confidence:** high
- **Evidence:**
  - `06-prerequisites-blocks-advice.md:105` — "| `call` | the run's `claim_legs` row `id` | its leg | by a `blocked` end (R-BTN-165) |"
  - `07-conditions.md:504` — "The runner then ends the claim `released:blocked` on `{kind: \"call\", ref: <claim_legs seq>}`"
  - `13-data-model.md:136` — "`seq` (per claim; null with the claim)"
- **The problem:** `seq` is per claim; `id` is the table's key. The runner knows `seq` (it sends `legs_finished: [{claim_id, seq}]`) and may not know `id`. `ticket_blocks` is keyed `(ticket_id, kind, ref, leg)`: with `seq`, two call runs of one leg in two claims (both `seq` 1) collide on the key; with `id`, the runner cannot form the end.
- **Counter-reading considered:** Baton could translate the wire `seq` to the stored `id`. Nothing says so, and `baton leg why` shows `ref`.
- **Smallest fix:** Use the `run_id` (R-BTN-63: unique, known to both sides) in both places.

### LIFE-8: `claims` are "kept forever" in §13.5 and pruned by R-BTN-149; a pruned ticket that returns keeps its hold but loses its run counts
- **Severity:** medium · **Kind:** contradiction · **Rules:** R-BTN-149, R-BTN-12, R-BTN-63, R-BTN-81, §13 · **Confidence:** high
- **Evidence:**
  - `13-data-model.md:134` — "The lease, kept forever; one `active` row per ticket"
  - `13-data-model.md:34` — "Every other row naming it is kept: claims and their leg runs (the traversal record, R-BTN-63), conditions, the outbox"
  - `02-deployments.md:262` — "then the claims of a ticket whose history R-BTN-81 purged, with their legs, activities and the rows that name them — a claim still held (R-BTN-39), or named by an event, a condition or a scope finding, waits and its ticket is tried again a day later"
  - `13-data-model.md:123` — "`kept_json` (the ticket's `ticket_overrides` row and `leg_attempts`, kept past the purge)"
- **The problem:** Two places say claims and `claim_legs` are never deleted; R-BTN-149 deletes them 90 days after close. After the prune a returning id gets its hold and attempts back but its `max_runs` counts and resume records are gone, so R-BTN-12's "clears nothing" holds for 90 days only. And no rule deletes a `conditions` row (searched `conditions` with `deleted|pruned|purge`: nothing), so any claim "named by … a condition" waits for ever and is retried daily.
- **Counter-reading considered:** "kept forever" may predate R-BTN-149's retention bullet; but §13's conventions repeat it and §13.4 itself carries `claims_due_at`.
- **Smallest fix:** Strike "kept forever"; give conditions a retention; say in R-BTN-12 that the traversal record lasts 90 days after close.

### LIFE-9: "Cancel" is two things: the owner's Cancel (a hold plus a release) never cancels in R-BTN-168's sense
- **Severity:** medium · **Kind:** contradiction · **Rules:** R-BTN-12, R-BTN-168, R-BTN-119, R-BTN-127, §9.4, vocabulary · **Confidence:** high
- **Evidence:**
  - `06-prerequisites-blocks-advice.md:553` — "The dashboard's **Cancel** sets a hold and sends the holder a `release` with reason `owner-cancel`."
  - `09-claims.md:167` — "| `released:owner-cancel` | `released` | Cancel: hold plus release (§6) | no |"
  - `07-conditions.md:563` — "A ticket is cancelled when its file says withdrawn (R-BTN-74) or when Baton **supersedes** it because:"
  - `07-conditions.md:555` — "Baton alone queues it (`next_source: baton`, held until the station changes, R-BTN-83), when a ticket is cancelled"
  - `docs/context/vocabulary.mdx:112` — "**Cancel leg.** The ordinary leg a course names to undo its work outside git when a ticket is cancelled"
- **The problem:** `ticket.cancel` (destructive, §12.2) leaves the ticket live, held with an ordinary liftable hold, its PR open, with no `cancelling` flag, no `cancel` leg and no withdrawal. R-BTN-168's list of what cancels a ticket does not include it. An owner who presses Cancel on a `create-pr` ticket gets none of what the `cancel` leg promises; to cancel they must also withdraw the file in git. R-BTN-66 ("a hold or cancel binds a ticket id") and the delegated key's "tighten (hold, bar, stop, cancel)" use the word without saying which.
- **Counter-reading considered:** §6.8 puts the two sentences side by side, so the difference is intended; the names are not.
- **Smallest fix:** Either make `ticket.cancel` a fifth cause in R-BTN-168 (queueing the `withdraw` entry), or rename the owner's action and its end reason.

### LIFE-10: A `cancelling` ticket whose station changes after the `cancel` leg was queued has no queued leg it may run
- **Severity:** medium · **Kind:** liveness · **Rules:** R-BTN-168, R-BTN-83, rule 3 · **Confidence:** medium
- **Evidence:**
  - `05-courses.md:227` — "Four of these are **held** in `ticket_overrides` until the ticket's station changes (cleared by whatever moves it)"
  - `05-courses.md:208` — "A suspension or release reports one too: at the outcome reached, or at the `from` it gave up with the leg itself as `next`"
  - `07-conditions.md:570` — "**Superseding.** In the transaction that decides it, Baton: sends any running claim on the ticket a `release` with reason **`superseded`**"
  - `07-conditions.md:581` — "the flag refuses every leg but the ticket's queued `cancel` leg"
- **The problem:** Trace: ticket T is at `pr-open` with a claim running `review`. Baton supersedes T: release sent, `cancelling` set, `cancel` leg queued from `pr-open`. The runner's leg had just finished; its `released:superseded` end reports `reached: reviewed`. The station changed, so the held `cancel` route is "cleared by whatever moves it", and the end's `next` (which may not be the cancel leg) is queued. Rule 3 now refuses every leg but "the ticket's queued `cancel` leg", and none is queued. No rule re-queues it and no owner lifts the flag. The same follows a `stale-board` release on a ticket withdrawn in git first.
- **Counter-reading considered:** "For a cancelled ticket whose course names a `cancel` leg leaving its station, Baton queues that leg" could be a standing invariant re-applied at every position write. It is written as an event ("Then the cancel leg").
- **Smallest fix:** State that while `cancelling_at` is set, every position write queues the `cancel` leg leaving the new station (or closes the ticket where none leaves it), and that a superseded claim's end may report no arrival.

### LIFE-11: Nothing aborts a cancellation: a withdrawal seen once in git is enforced by Baton even after git takes it back
- **Severity:** medium · **Kind:** liveness · **Rules:** R-BTN-168, R-BTN-171, R-BTN-12 · **Confidence:** medium
- **Evidence:**
  - `07-conditions.md:578` — "marks the ticket **`cancelling`** … a flag beside any hold it carries, which no owner lifts and which is cleared when the ticket closes"
  - `07-conditions.md:593` — "A ticket a snapshot posts withdrawn whose course names a `cancel` leg leaving its station, and whose path ran a leg that leg undoes … is kept live and `cancelling`"
  - `07-conditions.md:589` — "a ticket with a file still live in git waits for its withdrawal: Baton queues the `withdraw` outbox entry (R-BTN-171)"
- **The problem:** Trace: a pusher writes `status: withdrawn` on a ticket at `pr-open` by mistake; one sync later the owner reverts it. Baton has already marked it `cancelling`. The `cancel` leg (closes the PR, may delete the branch) is `ready` "at once" and runs. At its end the file is "still live in git", so Baton queues a `withdraw` entry and a deliverer withdraws the ticket again. The owner has no action that stops any step: the flag is unliftable and a hold only pauses it. The spec states the residual risk for holds (R-BTN-12) but not this one, which destroys work outside git.
- **Counter-reading considered:** Under `cooperative` a pusher is trusted with everything, and adopt might move the ticket; but adopt is not said to clear `cancelling_at`.
- **Smallest fix:** Let an `approvers.policy` approver clear `cancelling_at` before the cancel leg's run ends, or clear it when a newer snapshot posts the ticket live again and no cancel run has started.

### LIFE-12: The "one word" ticket state has no word for `cancelling`, for a queued leg that is `waiting`, or for a live ticket at an end station
- **Severity:** medium · **Kind:** underspecified · **Rules:** §11.4 Ticket state, R-BTN-168, R-BTN-75, R-BTN-89, R-BTN-126 · **Confidence:** high
- **Evidence:**
  - `11-people.md:663` — "One word per ticket, from `unconfirmed`, `running`, `waiting-person`, `held`, `blocked`, `backing-off`, `suspended`, `ready`, `closed`, in that precedence"
  - `07-conditions.md:580` — "the ticket shows `cancelling` until it closes"
  - `06-prerequisites-blocks-advice.md:121` — "**Not blocks.** `other` lists what else keeps a ticket from being offered: a hold (§6.8), a `waiting_on` label, a `time` wait, …"
  - `06-prerequisites-blocks-advice.md:229` — "draws each leg as an edge in one state — `ready`, `running`, `blocked` …, `backing-off` or `not-queued`"
- **The problem:** A new ticket whose `start_leg` is posted `waiting` on `ci` or `time`, or stored `waiting` on `course-changed`, is none of the nine: it has no `ticket_blocks` row, no claim and no hold, and `suspended` presupposes an ended claim. Nor is a `cancelling` ticket, nor one at an end station the source still posts live (LIFE-4). The Tickets tabs partition by these words, so such tickets appear under no tab.
- **Counter-reading considered:** `blocked` might loosely include `other`. R-BTN-75 defines blocked strictly by rows and names the rest "Not blocks".
- **Smallest fix:** Add `cancelling`, `waiting` and a word for "at an end, not closed" to the enumeration with their precedence and tabs, in §11.4 and the vocabulary page.

### LIFE-13: "Held" means three different things, and R-BTN-79's queue depth depends on which
- **Severity:** medium · **Kind:** contradiction · **Rules:** R-BTN-75, R-BTN-79, R-BTN-12, R-BTN-39, rule 3, §11.4 · **Confidence:** high
- **Evidence:**
  - `06-prerequisites-blocks-advice.md:108` — "A ticket is **held** while it has an active claim, a completed claim not yet confirmed, or a fence-pending reap (rule 3's claim checks; R-BTN-79 uses the same definition)."
  - `06-prerequisites-blocks-advice.md:549` — "A **hold** means \"do not hand this ticket out\" (rule 3), with `hold_reason` `owner`, …"
  - `06-prerequisites-blocks-advice.md:441` — rule 3's refusals: "`claimed`, `held`"
  - `01-what-baton-is.md:143` — "and Baton holds the ticket for nothing else — no call or `suspend` condition it is blocked on"
  - `05-courses.md:184` — "the `cancelling` hold does not refuse it"
  - `11-people.md:666` — "a held ticket counts under Blocked"
- **The problem:** Three senses:
  - (1) R-BTN-75: held = claimed.
  - (2) R-BTN-12, rule 3's `held` code, ticket state `held`: held = the hold override.
  - (3) R-BTN-39/R-BTN-116 "Baton holds the ticket": blocked on a call or condition, or cancelling. §5.2 even calls the `cancelling` flag a hold, which §6.8 says it is not.

  Consequences: R-BTN-79's queue ("not held (R-BTN-75…)") excludes tickets being worked but includes tickets under an owner hold, so parking 30 tickets raises `baton.queue-over` and closes the course's intake; a reader using sense 2 gets the opposite depth. R-BTN-39's "applied when the hold ends" does not say whether an owner hold defers a fact arrival, so a human's merge on a held ticket is applied under one reading and deferred indefinitely under the other.
- **Counter-reading considered:** R-BTN-79 cites R-BTN-75 explicitly, fixing its sense. R-BTN-39's deferral clause cites nothing.
- **Smallest fix:** Rename R-BTN-75's sense ("claimed") and R-BTN-39's ("waiting on Baton"); keep "held" for the override alone; say whether an owner hold defers an arrival.

### LIFE-14: A call's settlement relies on a guarantee R-BTN-39 does not give: a route or an adopt moves a ticket off the call's station and orphans the call
- **Severity:** medium · **Kind:** liveness · **Rules:** R-BTN-165, R-BTN-39, R-BTN-83, R-BTN-75 · **Confidence:** medium
- **Evidence:**
  - `07-conditions.md:533` — "Baton records the position … only while the ticket is still at the call leg's station, which R-BTN-39's hold on a blocked ticket guarantees."
  - `05-courses.md:233` — "queues any leg leaving Baton's station for the ticket, the course's `cancel` leg excepted"
  - `01-what-baton-is.md:161` — "`baton ticket adopt <ticket> [--at <station>] [--next <leg>] [--ran <leg>,…]` … sets the ticket's position."
  - `07-conditions.md:539` — "The children still open when the call settles are superseded (R-BTN-168)."
- **The problem:** R-BTN-39's hold defers only fact arrivals. An owner's route queues another leg leaving the station (the `call` row is on its own leg, so rule 1 lets the routed leg be claimed and the ticket move); an adopt sets any station outright. Afterwards the children's station changes find the ticket elsewhere: nothing is recorded, the call never settles, its open children are never superseded, and the `call` row stays on the leg. If the ticket later loops back and that leg is queued again, the stale row blocks it until the old children close, and then the old table settles and moves the ticket on the old run's outcome.
- **Counter-reading considered:** An owner who routes round a call accepts the consequences. But neither route nor adopt says it settles, cancels or clears an open call or condition block, and "guarantees" is stated as fact.
- **Smallest fix:** Route and adopt, in their transaction, supersede the open call's children and delete its row (and say what they do to an open `condition` block); or refuse while a `call` block is open.

### LIFE-15: Adopt gives an active claim "its `release` (`released:requested`) and its fence" — a released, fence-pending claim is a state R-BTN-19 and the claim indexes do not have
- **Severity:** medium · **Kind:** underspecified · **Rules:** R-BTN-39 (adopt), R-BTN-19, rule 3, §13.8 indexes · **Confidence:** medium
- **Evidence:**
  - `01-what-baton-is.md:177` — "if a claim is active, its `release` (`released:requested`) and its fence (R-BTN-19), both before the position"
  - `09-claims.md:205` — "A claim reaped while its runner was **alive** — a force-reap …, an unacknowledged-release reap, a `leg-timeout` reap — is `fence_pending`"
  - `13-data-model.md:210` — "`claims_holding` (`ticket_id` where active, completed and unconfirmed, or reaped with its fence pending)"
- **The problem:** Two readings:
  - (A) Adopt sends a `release` message and the claim stays `active` until the runner ends it. Then the position is written under an active claim, the runner's later end carries its own arrival from the pre-adopt station, and "its fence" means nothing.
  - (B) Adopt ends the claim at once as `released:requested` with `fence_pending`. Then the claim is `released`, not `reaped`, so `claims_holding` and rule 3's fence-pending lookup do not see it and the ticket is claimable beside a live runner. The end table has no such row.
- **Counter-reading considered:** "its fence (R-BTN-19)" may mean a force-reap; then the end is `reaped`, not `released:requested`.
- **Smallest fix:** Say adopt force-reaps (actor the adopter, fence-pending, not a failed attempt) and add the row to §9.4's table, or widen R-BTN-19 and `claims_holding` to released claims.

### LIFE-16: Who ends a `stale-board` claim — Baton in the snapshot's transaction, or the runner on a `release` message?
- **Severity:** medium · **Kind:** underspecified · **Rules:** R-BTN-35, R-BTN-147, R-BTN-72, R-BTN-198, R-BTN-6, §9.4 · **Confidence:** medium
- **Evidence:**
  - `01-what-baton-is.md:93` — "ends the claim `released:stale-board` with a `release` to the holder"
  - `08-runners.md:241` — "`closed: 'withdrawn'` is a `stale-board` release Baton already made"
  - `09-claims.md:66` — "A lost lease, or a heartbeat response that no longer lists the claim, means the session no longer holds the ticket."
  - `08-runners.md:253` — "A lost lease aborts the leg and writes no hand-off."
  - `09-claims.md:185` — "**A release** pushes the work done so far, then `close`, then `handoff` (R-BTN-72)"
- **The problem:** If Baton ends the claim itself, the next heartbeat's `claims` omits it. By R-BTN-6 that is a lost lease: abort at once, no hand-off, and the sidecar "ends the claim `released:lease-lost` itself" (refused `claim-ended`). By §6.9/R-BTN-198 the same heartbeat hands a `release` with reason `stale-board` (S-BTN-233 lists it), which stops at the next safe point and writes `close` and `handoff`. The two paths differ in whether the work so far is pushed and a hand-off left. The Baton-ended claim also has no fence while its runner is alive and mid-leg (R-BTN-19 fences only reaps).
- **Counter-reading considered:** "ends … with a release" may mean only "sends a release and the runner ends it". R-BTN-72 ("Baton already made") and R-BTN-147 ("an active claim on it ends `released:stale-board`") say Baton did.
- **Smallest fix:** Pick one: Baton sends the release and the claim stays active until acknowledged (with the unacknowledged-release reap as backstop), or Baton ends it and the heartbeat reports it in a list distinct from a lost lease.

### LIFE-17: Revoking a grant or a key says nothing about the active claims it backs
- **Severity:** medium · **Kind:** underspecified · **Rules:** R-BTN-58, R-BTN-13 (Revocation), R-BTN-6, R-BTN-146, R-BTN-114, R-BTN-117, rule 7 · **Confidence:** high
- **Evidence:**
  - `11-people.md:24` — "Revoking a key sets `revoked_at`; every runner it registered stops at its next call."
  - `09-claims.md:74` — "A heartbeat refused `session-taken`, `runner-reaped` or `forbidden` marks the lease lost at once."
  - `11-people.md:150` — "grant a runner key access … revoke a grant" (no consequence stated)
  - `06-prerequisites-blocks-advice.md:445` — "| 7 | The key holds a grant for the ticket's repository (R-BTN-58) | claim, advance | `not-granted` |"
- **The problem:** When a grant is revoked (or declined back to pending, or a check-runner row revoked, or a token revoked with its credentials) while its runner holds a claim, the heartbeat is still accepted and the running leg continues to its end. Only the next `advance` is refused `not-granted`. Whether the `end` is accepted, whether a release is sent, and whether the claim is reaped is unsaid; only repository retirement spells it out (R-BTN-47 step 4). For a revoked key, R-BTN-6 lists only three refusal codes that mark the lease lost at once, and no rule I found says which code a revoked machine key's heartbeat gets. If it is not one of those three, Baton holds the ticket until the silence reap — up to 24 hours — and counts a failed attempt, although "stops at its next call" promises an immediate stop.
- **Counter-reading considered:** An administrator can force-reap by hand. That is a second manual step no rule tells them to take. Searched `revok` near `claim|lease|release|reap`.
- **Smallest fix:** In R-BTN-58 and R-BTN-13: a revocation, in its transaction, force-reaps (fence-pending, not a failed attempt) every active claim the grant or key backs on the repositories it loses; name the refusal code and add it to R-BTN-6's list.

### LIFE-18: An administrator may "release" an unconfirmed completion — a terminal `completed` claim leaves its state by a transition nothing defines
- **Severity:** medium · **Kind:** underspecified · **Rules:** R-BTN-10 ("Claimable again"), R-BTN-155, §9.4, §13.5 · **Confidence:** high
- **Evidence:**
  - `09-claims.md:262` — "an administrator confirms or releases it from the dashboard (R-BTN-155)"
  - `11-people.md:556` — "confirm or release an unconfirmed completion (`POST /v1/ui/claims/{id}/confirm`, `…/release`)"
  - `09-claims.md:151` — "**End reasons.** This is the one list; other sections cite it."
  - `13-data-model.md:134` — "`confirmed_at` only on `completed`"
- **The problem:** The one list has no row for this release: its status, its `end_reason`, whether it is a failed attempt, and what becomes of the position the completed end recorded ("stands from the moment Baton records it"). For an unconfirmed `done` the ticket is at an end station with no leg leaving; "released" makes it claimable for nothing. Searched `claim.confirm`, `claim.release`: no registry id or CLI command found.
- **Counter-reading considered:** "release" may mean "mark `superseded_at`". Then say so; R-BTN-168 owns that word.
- **Smallest fix:** Define both actions in §9.6 (registry ids, effect on `status`, `superseded_at`, position, attempts) and add the release to the end table.

### LIFE-19: Does a `repos:` entry have reach when the home lists no `code_repos`? R-BTN-140 says yes and no
- **Severity:** medium · **Kind:** contradiction · **Rules:** R-BTN-140, R-BTN-47, R-BTN-92 · **Confidence:** medium
- **Evidence:**
  - `03-repositories-and-forges.md:515` — "a home that lists no `code_repos` keeps today's reading — its `repos:` entries resolve by name on its own forge host (R-BTN-92)"
  - `03-repositories-and-forges.md:527` — "A `repos:` entry gains reach only when it resolves … to an id in `code_repos`. … Any other entry is shown and filtered on only, and the ticket raises `baton.repo-not-listed`."
  - `03-repositories-and-forges.md:91` — "They need no registration and reach nothing unless the home's owners list them in `code_repos` (R-BTN-140)."
- **The problem:** For a home with an empty list, the first sentence gives every `repos:` name reach by path — the re-created-path case R-BTN-138 exists to stop. The other two give it none and raise a condition on every such ticket. Rules 13 and `floor` and R-BTN-141's branch-holder mapping all say "a `repos:` entry reaching `code_repos`", the second reading.
- **Counter-reading considered:** "today's reading" is a transitional allowance. It carries no ticket, date or end condition, and R-BTN-193 says legacy paths are "marked legacy where it is specified".
- **Smallest fix:** Delete the "keeps today's reading" sentence, or mark it legacy with its retiring ticket and state that it bypasses the id check.

### LIFE-20: A proposed `withdraw` is "late" by three different clocks
- **Severity:** medium · **Kind:** contradiction · **Rules:** R-BTN-171, §12.8 · **Confidence:** high
- **Evidence:**
  - `07-conditions.md:617` — "| `withdraw` | … | a snapshot shows the ticket withdrawn or closed | not confirmed 24 hours after it was queued |"
  - `07-conditions.md:678` — "An entry still not `confirmed` after 3 accepted snapshots at or after its commit raises `baton.outbox-late`"
  - `12-security.md:588` — "Such an entry is late only when it is not delivered within 24 hours"
- **The problem:** Under `proposed` the delivery is a commit on `baton/proposed/<ticket>` that a human must approve. By R-BTN-171 the entry raises `baton.outbox-late` after 3 snapshots (minutes) and again at 24 hours unconfirmed; by §12.8 it is late "only" if undelivered. "at or after its commit" is also undefined for a commit no snapshot can contain.
- **Smallest fix:** Put the exception in R-BTN-171's table (the rule's home) and cite it from §12.8.

### LIFE-21: `released:stale-board` before any leg runs is charged to nothing — a persistent re-verification mismatch is an unbounded claim/release loop
- **Severity:** medium · **Kind:** liveness · **Rules:** R-BTN-5/R-BTN-34, §9.4, R-BTN-122, R-BTN-126 · **Confidence:** low
- **Evidence:**
  - `04-tickets-syncs-board.md:676` — "Closed, archived or re-tiered, or the leg not offered there, releases `stale-board`"
  - `09-claims.md:157` — "| `released:stale-board` | `released` | re-verification from git fails (R-BTN-5, R-BTN-34); … | no |"
- **The problem:** A stale-board release is not a failed attempt, starts no backoff, counts toward no `max_blocked` and, before the first `advance`, toward no `max_runs`. If the runner's own run of `sync.mjs` keeps disagreeing with the posted readiness (a `current`-source ticket edited continuously; a station function not deterministic between the sync's and the runner's fetch; a `versions` source with no `read`, whose claims "release `stale-board` too"), every runner claims, releases and, one snapshot later, claims again. Nothing raises a condition. The same holds for `released:off-branch` and `released:course-changed`.
- **Counter-reading considered:** The next snapshot usually repairs the cache. The `versions`-without-`read` case never repairs.
- **Smallest fix:** Count consecutive no-leg releases per ticket and leg; past a constant, hold the ticket and raise a condition.

## Low

### LIFE-22: §14's `advance` and `end` bodies carry `taken? (R-BTN-177)`, a retired rule, against §6.10's "records no route taken"
- **Severity:** low · **Kind:** stale-reference · **Confidence:** high
- **Evidence:** `14-api.md:74` and `:75` — "`taken? (R-BTN-177)`"; `06-prerequisites-blocks-advice.md:605` — "Core resolves no route, delivers no advice about one and records no route taken"; `spec/BATON_SPEC_HISTORY.md` — "Retired: R-BTN-175, R-BTN-176, R-BTN-177".
- **Smallest fix:** Delete the field from both rows.

### LIFE-23: The claim response in §14 lacks `brief`, `last_written_by` and the `control` record that §4.4 says it carries
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** high
- **Evidence:** `04-tickets-syncs-board.md:636` — "It rides the ticket, beside its `brief`, in the board read (§11), the dashboard's ready rows, the recommendations, the claim answer"; `04-tickets-syncs-board.md:593` — "the claim answers carry the record read in the claim's own transaction and stored with the claim"; `14-api.md:73` — the response list ends "`version, ticket_source?, scope[]`" with none of the three; `09-claims.md:43` lists a third, shorter set.
- **The problem:** Three lists of one response; the fields that say whose words the brief is and which commits to load control inputs from are in neither normative list.
- **Smallest fix:** Make §14 the one list and have §9.1 cite it.

### LIFE-24: The heartbeat field is `legs_finished` in §8.1, §14 and R-BTN-90's first mention, and `leg_finished` two sentences later and in two scenarios
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** high
- **Evidence:** `07-conditions.md:471` — "`legs_finished: [{claim_id, seq}]`"; `07-conditions.md:475` — "The heartbeat processes `leg_finished` before it delivers messages"; `15-verification.md:89`, `:185`. §14's heartbeat response also omits "the current activity" that `08-runners.md:54` says it carries.
- **Smallest fix:** One spelling; add the field.

### LIFE-25: Which releases stop "at once": three reasons in R-BTN-119, four in §9.4 and §6.9
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** high
- **Evidence:** `08-runners.md:696` — "For these three the runner stops the leg … at once" (`requested`, `owner-cancel`, `superseded`); `09-claims.md:186` — "at once for `requested`, `owner-cancel`, `superseded` and `floor`"; `06-prerequisites-blocks-advice.md:589`.
- **Smallest fix:** Add `floor` to R-BTN-119.

### LIFE-26: `hold_reason` is listed twice with different members
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** high
- **Evidence:** `06-prerequisites-blocks-advice.md:549` — seven values, no `scope-exceeded`; `13-data-model.md:160` — eight, with `scope-exceeded`; `12-security.md:1034` — "`scope-exceeded` finding also holds its ticket".
- **Smallest fix:** R-BTN-12 cites §13.6's list.

### LIFE-27: A `depends_at` reference has three shapes
- **Severity:** low · **Kind:** contradiction · **Confidence:** high
- **Evidence:** `04-tickets-syncs-board.md:537` — "`depends_at?: [{ ticket, at | reached | done, leg? }]`"; `13-data-model.md:118` — "`ref` (`<ticket>@at:<station>,…`, `@reached:…`, `@done` or `@withdrawn`)"; `06-prerequisites-blocks-advice.md:100` — "`@done`, `@withdrawn` or `@closed`".
- **The problem:** The post schema admits neither `withdrawn` nor `closed`; the table storing posted entries admits `@withdrawn` but not `@closed`; the block table both. Whether a source may post `{ticket, closed: true}` is undecidable.
- **Smallest fix:** One grammar in R-BTN-120, cited by §4.4 and §13.4.

### LIFE-28: `code_repos` is stored in two different shapes
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** high
- **Evidence:** `13-data-model.md:65` — "`code_repos` JSON `[{path, repo_id, former_paths}]`"; `03-repositories-and-forges.md:505` — "Baton stores `{path, forge, host, repo_id, owner_id, web_base}`".
- **Smallest fix:** §13 lists the union.

### LIFE-29: `events.kind` omits kinds other rules log and §13 itself indexes
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** medium
- **Evidence:** `13-data-model.md:186`–`195` (the list); `04-tickets-syncs-board.md:480` — "(a `renumbered` event, actor `sync`, B-183)"; `04-tickets-syncs-board.md:590` — "raises one `unsigned-control` event"; `13-data-model.md:209` — "`events_unsigned_control` (`at` where `kind` is theirs)"; `06-prerequisites-blocks-advice.md:119` — "dropped and logged `prerequisite-unconfirmed`"; `13-data-model.md:9` — "the `oauth` event kind". None of the four is in the list.
- **Smallest fix:** Add them or say the list is open.

### LIFE-30: `check-mismatch` is "the discrepancy … (R-BTN-85)" but R-BTN-85's table of subs does not have it
- **Severity:** low · **Kind:** stale-reference · **Confidence:** high
- **Evidence:** `10-checks.md:128` — "is the discrepancy `check-mismatch` (R-BTN-85)"; `04-tickets-syncs-board.md:744` — "The subs:" followed by five rows, none of them `check-mismatch`.
- **Smallest fix:** Add the row.

### LIFE-31: The attempt count's reset is defined twice, and adopt's reset fits neither
- **Severity:** low · **Kind:** contradiction · **Confidence:** medium
- **Evidence:** `09-claims.md:269` — "is the number of failed claims ended after the later of the ticket's newest hold-lift `override` event and the leg's last run reaching one of its outcomes"; `01-what-baton-is.md:183` — "and the ticket's attempt window reset (R-BTN-122)".
- **The problem:** An adopt is neither a hold-lift event nor an outcome, so §9.7's derived count is unchanged by it while R-BTN-39 says it resets. §9.7 derives the count from claims while R-BTN-122 stores it (`leg_attempts.attempts`); R-BTN-149's claim prune (LIFE-8) makes the two diverge. Also `released:lease-lost` counts "once per distinct runner" while a silence reap of the same runner counts every time (`09-claims.md:163`, `:174`).
- **Smallest fix:** One definition, stored; list adopt among the resets.

### LIFE-32: "a supersession's replacement" is named in §12.8 and defined nowhere
- **Severity:** low · **Kind:** stale-reference · **Confidence:** high
- **Evidence:** `12-security.md:365` and `:580` — "a handler ticket, a call leg's child, a supersession's replacement". R-BTN-168 supersedes tickets and creates none.
- **Smallest fix:** Delete, or define it in R-BTN-168.

### LIFE-33: A reap is not among the causes that record a sync want, yet a reaped ticket is claimable only after a new snapshot
- **Severity:** low · **Kind:** underspecified · **Confidence:** medium
- **Evidence:** `03-repositories-and-forges.md:242` — "in the transaction that causes it — a claim, an `advance`, an end, a fact arrival, an adoption, …"; `09-claims.md:257` — "A ticket is claimable only after a snapshot observed after its last claim ended"; `09-claims.md:190` — "Every end records a sync want" (in §9.4, the runner's `end`).
- **The problem:** Nor are a supersession, a call's settlement, a person leg's expiry or an administrator's fence clear listed. On a quiet repository a reaped ticket waits for the backstop.
- **Smallest fix:** Say "every claim end, a reap included".

### LIFE-34: Two sync attestation types for one fact
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** medium
- **Evidence:** `12-security.md:740` — "`std:git.evidence@1` | `{claim, sha? , url?, found}` … | R-BTN-10"; `12-security.md:745` — "`std:git.commit@1` | `{repository, sha}`: evidence an end named, as git shows it | R-BTN-10"; `09-claims.md:247` reads only `std:git.evidence@1`; `05-courses.md:436` lists four `std:git.*` types without `commit`.
- **The problem:** For a multi-repository ticket only `std:git.commit@1` names the repository an `ended_at_sha` lives in, and R-BTN-10 does not read it, so evidence pushed to a code repository has no stated confirmation path.
- **Smallest fix:** Fold `repository` into `std:git.evidence@1` or have R-BTN-10 name both.

### LIFE-35: `step_kinds` has no defining rule and is not on the vocabulary page that `CLAUDE.md` says includes it
- **Severity:** low · **Kind:** stale-reference · **Confidence:** high
- **Evidence:** `09-claims.md:325` — "**Kinds** are the claim's course's `step_kinds` (R-BTN-50)"; R-BTN-50's table (`01-what-baton-is.md:220`–`229`) never mentions them; `docs/context/vocabulary.mdx` contains no `step_kinds` (grep count 0) though `CLAUDE.md` says "core's words, one sentence each — `step_kinds` included".
- **Smallest fix:** Define them in R-BTN-69 or R-BTN-50 and on the page.

### LIFE-36: The vocabulary page contradicts the spec on four of its own words
- **Severity:** low · **Kind:** restatement-drift · **Confidence:** high
- **Evidence:**
  - `docs/context/vocabulary.mdx:35` — "**Worker.** An agent session on a machine, identified by its key." vs `08-runners.md:24` — "**Identity** is `(hostname, session_name)`" and `09-claims.md:102` — "several runners may share one credential".
  - `docs/context/vocabulary.mdx:57` — "It runs one or more legs and ends **done**, **suspended** at a station, or **released**." vs `09-claims.md:9` — "`active` until it ends `completed`, `released` or `reaped`".
  - `docs/context/vocabulary.mdx:85` — "**Hold, expedite.** An operator's overrides" vs `06-prerequisites-blocks-advice.md:556` — "Owners set and clear both".
  - `docs/context/vocabulary.mdx:87` — five block kinds vs seven in R-BTN-75 (`call`, `attestation` missing).
- **Smallest fix:** Amend the page; §11.4 cites it as "the same words".

## Enumerations: the list in each place it appears

| Enum | Place | Members |
|---|---|---|
| Claim status | §9 intro (`09:9`), §13.5 | `active`, `completed`, `released`, `reaped` |
| | vocabulary | done, suspended, released (no reaped) |
| Claim end reasons | §9.4 ("the one list") | 23 rows; none for the admin's release of a completion (LIFE-18), adopt's fence (LIFE-15), R-BTN-114's claim-only supersession (LIFE-5) |
| Releases "at once" | R-BTN-119 | `requested`, `owner-cancel`, `superseded` |
| | §9.4, §6.9 | + `floor` |
| Block kinds | R-BTN-75, §13.6 | `ticket`, `capability`, `resource`, `retry`, `condition`, `call`, `attestation` |
| | §6.1 prerequisite kinds | those seven + `station`, `time` |
| | `blocked?on=` (`06:237`) | `ticket`, `resource`, `capability` only |
| | vocabulary | five |
| `depends_at` ref | §4.4 post | `at`, `reached`, `done` |
| | §13.4 `ticket_depends.ref` | `@at`, `@reached`, `@done`, `@withdrawn` |
| | R-BTN-75 | + `@closed` |
| `call` block ref | R-BTN-75 | `claim_legs` row `id` |
| | R-BTN-165 | `claim_legs` `seq` |
| `hold_reason` | R-BTN-12 | `owner`, `mcp:<name>`, `parked`, `attempts-exhausted`, `non-retryable:<class>`, `blocked-exhausted`, `outbox-refused` |
| | §13.6 | + `scope-exceeded` |
| Ticket state | §11.4, vocabulary | `unconfirmed`, `running`, `waiting-person`, `held`, `blocked`, `backing-off`, `suspended`, `ready`, `closed` |
| | R-BTN-168 | also "shows `cancelling`" |
| Leg state | R-BTN-70, §13.4 | `ready`, `waiting` |
| | R-BTN-126 edge | `ready`, `running`, `blocked`, `backing-off`, `not-queued` |
| | §14 claim response | `leg_state` (undefined) |
| Ticket closure | §4.4 `closed[].as` | `done`, `withdrawn` |
| | §13.4 `closed_as` | + `dropped` |
| | markdown `status` (`04:142`) | `done`; `withdrawn`, `superseded`, `deferred` → withdrawn |
| Outbox kind | R-BTN-171, §13.8 | `withdraw`, `forge-check` |
| | §12.8 | also an unnamed entry for a proposed ticket (LIFE-1) |
| Outbox state | R-BTN-171, §13.8 | `queued`, `claimed`, `delivered`, `confirmed`, `dropped` (consistent; `failed` is a mark) |
| Message kind | §6.9, §13.8 | `release`, `status_request`, `status_report`, `unblocked`, `handled`, `wind-down` (consistent) |
| Ring kind | R-BTN-91 | `release`, `status_request`, `wind-down`, `unblocked`, `handled`, `facts`, `outbox`, `ticket` |
| Leg event type | R-BTN-198 | `ticket.changed`, `release` |
| Disposition | R-BTN-160, §13.6 | `interrupt`, `suspend`, `notify` (consistent) |
| Severity | R-BTN-125, §13.6 | `critical`, `high`, `normal` (consistent) |
| Condition `outcome` | §13.6 column | never enumerated; only `recorded` (`07:111`) and `superseded` (`07:141`) are named |
| Restart `reason` | R-BTN-162 | `chosen`, `unanswered`, `withdrawn`, `resolved` |
| Discrepancy sub | R-BTN-85 | `position-disagrees`, `bars-mismatch`, `closed-under-claim`, `spawned-unposted`, `output-invalid` |
| | R-BTN-115 | + `check-mismatch` |
| `next_source` | R-BTN-83, §13.4 | `holder`, `baton`, `owner` (consistent) |
| `events.kind` | §13.8 | lacks `renumbered`, `unsigned-control`, `prerequisite-unconfirmed`, `oauth` (LIFE-29) |
| Activity outcome | §13.5 | `succeeded`, `failed`, `cancelled`, `abandoned`; §9.9 never says what sets `cancelled` |
| Sync attestation types | R-BTN-191 | seven, incl. `std:git.commit@1` |
| | `05:436` | four `std:git.*`, no `commit` |
| `code_repos` entry | §13.1 | `{path, repo_id, former_paths}` |
| | R-BTN-140 | `{path, forge, host, repo_id, owner_id, web_base}` |

## Vocabulary: one word, several meanings; several words, one thing

| Word | Meanings found |
|---|---|
| held / hold | (1) has a claim, R-BTN-75; (2) the override, R-BTN-12; (3) blocked on Baton or cancelling, R-BTN-39, `05:184` (LIFE-13) |
| cancel | the owner's Cancel (hold + release) vs cancellation (R-BTN-168) vs the `cancel` leg (LIFE-9) |
| closes / closed | a ticket posted `closed` by a snapshot; a ticket reaching an end station (`07:726`); a condition's close; a course's intake `closed` (R-BTN-79); an end station named `closed`; the `"closed": true` selector (LIFE-4) |
| suspended | a claim end (`suspended:<station>`); a ticket state; a `suspend` condition's leg (R-BTN-162's title); a suspended key (§12.8) |
| claim | Baton's lease; the legacy git-lock `baton ticket claim` (a status write with no lease, `04:257`); an outbox entry's `claimed` state; "a claim, not the owner" (an assertion) |
| lease | the claim ("a fenced lease on one ticket", `09:7`); the runner's ("the lease that keeps them all is the runner's", `09:30`); an outbox entry's 10-minute lease |
| attempt | a failed attempt (per ticket and leg) vs `previous_attempts`, which lists every earlier ended claim, suspensions included, vs `outbox.attempts` |
| position | `(reached, next)` (R-BTN-83); station + path + queued leg (R-BTN-39); `{station, path_len}` (R-BTN-70); a tier's position (rule 5) |
| gate | a matching rule; a `G-BTN-n` verification gate; a human gate (R-BTN-185); a requirement that "binds as a gate"; the `run-tests` gate |
| reading | a resource instance's attestation; the protection checker's report (`reading_hash`); "the sync's reading binds" (R-BTN-63); "today's reading" (R-BTN-140) |
| host | the tenant host (R-BTN-63); a runner's machine; the platform ("both hosts", R-BTN-55); a forge host |
| instance | a resource instance; a Baton deployment ("instance settings"); `claim_legs.instance` |
| run | a leg run (`run` number, `seq`, `run_id` — three ids for one thing); a sync run; "a run of legs"; a series ticket's `run: <n>` |
| worker / runner | vocabulary's "worker" = the spec's runner; "worker key" = machine key = credential kind `runner`; the Cloudflare Worker |
| owner | a repository's owner key; "the owner" (the person whose rulings are cited); `asks: owner`; `forge_owner_id`; writer class `owner` |
| snapshot / post / board post / run | used interchangeably for the one thing the sync sends |
| check | a check course/ticket/run/runner; a capability's `check` (R-BTN-121); the protection checker; `baton ticket check` — none on the vocabulary page |

## Journey notes

1. **Whole life.** Written (R-BTN-74) → seen (R-BTN-11/62) → placed at `start` (R-BTN-39) → blocks (R-BTN-75) → claim (rules 1–13) → legs (R-BTN-63) → conditions, retries, deadlines (§7) → PR and check (§10) → end (`done`, R-BTN-10) → closed (snapshot) → 90-day purge (R-BTN-81/149). Breaks: LIFE-4 (end without a claim), LIFE-6 (check confirmation), LIFE-8 (what remains).
2. **Things going wrong.**
   - Runner dies; lease reaped with PR open; ticket edited mid-course; course file changes: the rules agree (R-BTN-25, R-BTN-198, R-BTN-64).
   - Repository retired: R-BTN-47 covers the home; a code repository's retirement only drops reach.
   - Owner intervenes: LIFE-9, -11, -14, -15. Grant revoked: LIFE-17. Ticket dropped or returning: LIFE-3. Stale-board: LIFE-16, -21.
   - Takeover past the start: the legacy git-lock `baton ticket claim` (`04:257`–`:277`) works a leg with no Baton lease and moves no position; only the owner's adopt reconciles it. It is declared legacy (R-BTN-193), so I did not report it.
3. **Child ticket.** Id from Baton's sequence or `<id>.c<n>`; in git first, in Baton at the first post; parent ends first: `lifetime`. Creation half-fails: `spawned-unposted`, and LIFE-1/LIFE-2 under `proposed`.
4. **Several repositories.** `parent`, `depends_at`, `requires.tickets`, the board, grants (rule 7), checks (R-BTN-114), `last_written_by` (R-BTN-194), R-BTN-143 and evidence confirmation all assume the home alone. Rules 13 and `floor`, the fence (R-BTN-141) and the PR courses cover `repos:`. A dependency on another repository's ticket is unsupported and fails closed (`baton.prerequisite-unmet`). Findings: LIFE-19, -28, -34.

## Read but found sound

- The lock (R-BTN-4): one active claim per ticket, `request_id` idempotency, `max-claims` — no double-claim trace found.
- Fence before re-issue (R-BTN-19) for reaps: deadline, administrator's clear, non-`builtin` executors — consistent across §9.5, §13 and R-BTN-178's seats.
- Confirmation by observation (R-BTN-10/62): the strict-greater rule is stated identically in §4.3, §9.6 and §13.
- Messages (§6.9) and the doorbell (R-BTN-91): kinds, delivery, acknowledgement and expiry agree.
- Course renames and removals (R-BTN-64) against every per-leg table in §13.
- Retry policy state (R-BTN-122) against the end table's "failed attempt" column, apart from LIFE-31.
- Repository retirement (R-BTN-47) against claims, outbox, timers, consents and export.
- Handler ticket ids and the 4-generation bound (R-BTN-161/149/86).
- Person leg question, answer and expiry (R-BTN-116) against `ticket_questions` and `ticket_timers`.
- Outbox entry states and the claim/mark protocol (R-BTN-171) against §13.8 and §14, apart from LIFE-1/-20.

## Not covered

- §11 (keys, registry, MCP, sign-in) beyond the ticket-state rule and the confirmed-action list; §12 beyond §12.8's `proposed` rules and R-BTN-191; `BATON_MCP_OAUTH_SPEC.md`.
- §15: scenarios and gates were consulted for a handful of findings only (S-BTN-39, -107, -233, G-BTN-76, -156); I did not check each finding's rule for a covering scenario.
- §16 adoption (legacy claims, the mirror, cutover) and how `mode` interacts with each journey.
- R-BTN-72 (the runner loop) and R-BTN-106/107/133/144 were read only in the passages the journeys touched; R-BTN-131's long course text (`05:700`–`1060`) was not read line by line.
- §6.3 (resources and readings) and §6.11 (capacity and seats) state machines; R-BTN-67 owner bars' release path.
- `91-decisions.md` was not compared against the rules.
- `npm run spec:impact` was not run; searches were by grep.
