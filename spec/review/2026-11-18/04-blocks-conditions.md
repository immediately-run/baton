---
title: "Adversarial review 2026-11-18 — §6–§7: prerequisites, blocks, advice and conditions"
description: "One reviewer's findings, as filed, on BATON_SPEC §6 and §7."
order: 13
tags: [review]
---

# Adversarial review 2026-11-18 — §6–§7: prerequisites, blocks, advice and conditions

Span read whole: `spec/BATON_SPEC/06-prerequisites-blocks-advice.md` (664 lines) and `spec/BATON_SPEC/07-conditions.md` (857 lines), after `docs/context/architecture.mdx` and `docs/context/vocabulary.mdx`. Cited rules were followed into §2 (clocks, caps), §4 (R-BTN-86, the observation and post shapes), §5 (course fields, validator, R-BTN-63), §8, §9 (ends, R-BTN-19), §11 (R-BTN-130, registry), §12 (R-BTN-180/181/186/188), §13 and §14 by grep and targeted reads, not whole. No text addressed to the reviewer was found in the span.

Counts: 0 critical, 5 high, 8 medium, 5 low.

---

### BLK-1: Under `tickets.created: proposed`, §7 and §12 disagree on who writes a handler ticket or a call's child, and R-BTN-171 has no outbox kind for it
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-161, R-BTN-165, R-BTN-171, R-BTN-180 (§12.8), R-BTN-188, §13 `outbox`
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:184-187` — "Under the policy's `tickets.created: proposed` (R-BTN-188) the handler ticket is proposed, not filed: the runner writes it on `baton/proposed/<ticket>`, and it is not claimable until it lands with a `std:approval@1` (R-BTN-180)."
  - `spec/BATON_SPEC/07-conditions.md:180-184` — "The runner writes the handler ticket git first … It pushes the file before the raise returns or the leg ends."
  - `spec/BATON_SPEC/12-security.md:578-587` — "A ticket a runner's action would create (a condition's handler ticket, R-BTN-161; a call leg's child, R-BTN-165; a supersession's replacement; …), and the outbox's git kind (a withdrawal, R-BTN-171), is **proposed, not filed**: Baton queues an outbox entry for it, and a trusted-runner deliverer writes it on a branch `baton/proposed/<ticket>` from the entry's fields or the creating leg's typed output, through the CLI's own templates (R-BTN-171), marks the entry `delivered` with that commit"
  - `spec/BATON_SPEC/07-conditions.md:620-621` — "`withdraw` is the one **git kind**: Baton files no ticket of its own (R-BTN-163). The two kinds are the two **delivery classes**, `git` and `forge-check`."
  - `spec/BATON_SPEC/13-data-model.md:184` — "`kind` (`withdraw`\|`forge-check`)"
  - `spec/BATON_SPEC/12-security.md:588-589` — "Such an entry is late only when it is not delivered within 24 hours" against `07-conditions.md:617` — "not confirmed 24 hours after it was queued" and `07-conditions.md:678-679` — "An entry still not `confirmed` after 3 accepted snapshots at or after its commit raises `baton.outbox-late`".
- **The problem:** Three statements cannot all hold. §7 says the raising (untrusted) runner writes the proposal branch itself, before the raise returns. §12.8 says Baton queues an outbox entry and a trusted-runner deliverer writes it from templates. R-BTN-171 and §13 say the outbox has exactly two kinds and that Baton files no ticket. An implementer of the outbox has no kind, fields, order, confirmation rule or lateness column for "create a proposed ticket"; an implementer of the runner does not know whether `ctx.raise` pushes a branch. The security consequence is real: `no-runner-lands` and the proposal merge (`12-security.md:590-592`, "every commit on it since the merge base is a deliverer's template write") depend on the §12 reading, so under §7's reading the merge runner refuses every handler proposal an ordinary runner wrote. "A supersession's replacement" (`12-security.md:365`, `:580`) is defined nowhere in §7. The lateness rules also disagree for a proposed `withdraw`: it sits unconfirmed on a proposal branch until a human approves, so R-BTN-171's "3 accepted snapshots" raises `baton.outbox-late` on every one, while §12 says it is late only when undelivered.
- **Counter-reading considered:** §12.8 could be read as overriding §7 for `proposed` only, with the "entry" being a new kind left to the reader. It fails because R-BTN-171 says in so many words that `withdraw` is the one git kind and §13's enum agrees. Searched `outbox` across §12–§14 and `replacement` across §0–§9; found no third kind, no fields for one and no definition of the replacement.
- **Smallest fix:** Pick one. Either add the kind (`propose`, with fields, order, confirmation "its file lands", lateness) to R-BTN-171's table and §13, and rewrite `07:184-187` and `07:499-502` to say the runner reports and Baton queues; or delete the outbox sentence from §12.8. State one lateness rule for an entry awaiting a proposal merge.

### BLK-2: A call can end in a state no rule settles: children dropped as `spawned-unposted`, children that closed before the end, and no clock on the wait
- **Severity:** high
- **Kind:** liveness
- **Rules:** R-BTN-165, R-BTN-86, R-BTN-167, R-BTN-180
- **Confidence:** high for the proposed-mode trace; medium for the early-close race
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:526-528` — "The table's last non-null entry is `{"of": "all", "closed": true, …}`, which holds once every child has closed, so a call always settles"
  - `spec/BATON_SPEC/07-conditions.md:530-532` — "Baton evaluates the table, in table order, in each transaction that changes the station of one of the run's children. … A `spawned` end that names no children is refused; a completion never holds over none."
  - `spec/BATON_SPEC/07-conditions.md:505-506` — "A call never waits in its claim: Baton learns the children only from that end."
  - `spec/BATON_SPEC/04-tickets-syncs-board.md:704-707` — "Baton records them as the run's children (a call's completion range, R-BTN-165) until the first accepted snapshot observed after the end; a reported child that snapshot does not post is dropped with discrepancy `spawned-unposted` (R-BTN-85)."
  - `spec/BATON_SPEC/07-conditions.md:501-502` — "Under the policy's `tickets.created: proposed` (R-BTN-188) the children are proposed, not filed, and not claimable until they land with a `std:approval@1`"
  - `spec/BATON_SPEC/07-conditions.md:449-451` — "only while the sync's readiness attests the leg `waiting` — not while Baton itself holds the leg waiting"
  - `spec/BATON_SPEC/07-conditions.md:460-461` — "A deadline lives in its claim alone (`claims.deadline_at`, R-BTN-90) and dies with it."
- **The problem:** Three traces, each leaving a `call` row (rule 1 refuses every claim) that nothing removes.
  1. *Proposed children.* Policy `tickets.created: proposed`. A call leg files three children as proposals and ends `released:blocked` on `call`. The first accepted snapshot after the end reads the default branch, where no child file is. R-BTN-86 drops all three, `spawned-unposted`. The range is now empty, "a completion never holds over none", and no transaction will ever change "the station of one of the run's children". When the proposals land an hour later they are ordinary tickets with a `called_by`, but Baton "learns the children only from that end". The parent is blocked for good.
  2. *Any unposted child* (an id the sync refuses, a file the source skips) is dropped the same way. If all are, same result; if some are, the call silently settles over fewer children than the script filed, e.g. `{"of": "all", "at": ["merged"]}` holds with one of three.
  3. *A child that closes before the end is recorded.* The script pushes the children git first, then returns, then the runner runs `close`, `handoff` and the end. A sync and a fast child (the standard `announce`, one leg) can close inside that window. The table is evaluated only in a transaction that changes a child's station; none follows. R-BTN-162 states the equivalent case for conditions ("A condition already settled when the end arrives writes no row", `07:254-255`); R-BTN-165 has no such sentence.

  No clock notices any of this: `stalled_s` excludes waits Baton itself holds, the deadline died with the claim, call ends are exempt from `max_blocked`, and no `baton.*` condition is named for an open call. A callee that simply never finishes (its only capable runner gone) is equally silent on the parent.
- **Counter-reading considered:** The children's own notices (`baton.capability-missing`, `baton.stalled`, the 24-hour floor) eventually surface a stuck child, and the owner can `route` the parent. That covers a slow callee only where the child exists on the board; it does not cover an empty range, and R-BTN-165's own claim is that "a call always settles". Searched `spawned-unposted`, `call-settled`, `baton.call` and `proposed` across the spec; found no rule that re-attaches a late-landing child, evaluates the table at the end's transaction, or raises on an open call.
- **Smallest fix:** In R-BTN-165: evaluate the table in the transaction that records the `spawned` end as well; keep a proposed child in the range until its proposal lands or is rejected (exempt it from R-BTN-86's first-snapshot drop); settle (or raise `baton.call-empty`) when the range becomes empty; name a notice for a call open longer than a bound. Add the scenario.

### BLK-3: A suspended leg's `condition` row is provisional on one path and not on another for the same facts, and under `proposed` it evaporates after an hour
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-75, R-BTN-126, R-BTN-162, R-BTN-163, G-BTN-113
- **Confidence:** high (the contradiction); medium (the one-hour trace, which depends on BLK-1's resolution)
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:114-120` — "A `ticket` or `condition` row written by a `blocked` end carries `provisional` = the commit that wrote its fact to git. … The first accepted snapshot whose head contains the commit … replaces it with what it shows; a row not so confirmed within 1 hour, or not shown, is dropped and logged `prerequisite-unconfirmed`."
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:223-224` — "`ticket`, `condition` and `call` need no check: a snapshot confirms the first (provisional rows, R-BTN-75), and Baton holds the others."
  - `spec/BATON_SPEC/07-conditions.md:254` — "Its row is provisional on the commit that wrote the handler."
  - `spec/BATON_SPEC/07-conditions.md:260-263` — "writes the `condition` block on the leg in that transaction, as the blocked end would. It is not provisional: the handler commit was pushed before the wait, or there is none (unbound). So no claim of the leg runs, and asks again, while its question is open"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:193-194` — "**Invalid.** A bad kind or `ref`, a capability the `capability` bullet does not admit, or a `ticket` end without `commit`"
  - `spec/BATON_SPEC/15-verification.md:356` — "G-BTN-113 | A `ticket` blocked end's row is provisional … else dropped after an hour"
- **The problem:**
  - (a) R-BTN-126 says Baton "holds" a condition row (only `ticket` rows are snapshot-confirmed); R-BTN-75 and R-BTN-162 say a blocked end's condition row is provisional.
  - (b) R-BTN-162 gives the reason a release-written row is *not* provisional — "the handler commit was pushed before the wait" — which is equally true of the blocked end that follows the same wait. The two paths treat one fact two ways.
  - (c) Nothing says what a snapshot "shows" for a condition row, nor is a `condition` end without `commit` invalid, so the commit a provisional condition row waits for may be absent.
  - (d) Trace under `tickets.created: proposed`: the leg raises `hitl`, waits 120 s, ends `released:blocked`. The row is provisional on a commit that lives on `baton/proposed/<ticket>` (or, on §12's reading, does not exist yet). No snapshot's head contains it. After one hour the row is dropped. The leg is claimable, runs, asks the same question again, files a second proposal, and repeats until the sixth blocked end holds the ticket `blocked-exhausted` — the outcome R-BTN-162 says cannot happen ("no claim of the leg runs, and asks again, while its question is open"). A human approving proposals more slowly than hourly is the normal case under `protected`. The same happens under `filed` whenever no sync is accepted for an hour. Only the `ticket` case is tested.
- **Counter-reading considered:** The condition is Baton's own row (`conditions`), so an implementer could ignore "provisional" for it and follow R-BTN-126. That is the sane design, but it contradicts two explicit sentences, one of them in the condition's home rule. Searched `provisional` in every section; §4.3 and §13 describe only the mechanism, G-BTN-113/S-BTN-93 only the ticket kind.
- **Smallest fix:** Delete "or `condition`" from `06:114` and the sentence at `07:254`; say in R-BTN-162 that a `condition` row is never provisional because the `conditions` row is Baton's. Add a scenario for a blocked end on a condition with no sync for an hour.

### BLK-4: A delegated key resets a leg's attempts and clears its backoff by holding and unholding — a loosening R-BTN-186 says it can never make
- **Severity:** high
- **Kind:** security
- **Rules:** R-BTN-12, R-BTN-122, R-BTN-186, R-BTN-130, R-BTN-66 (`retry`)
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:557-559` — "a delegated key sets a hold and lifts only its own (R-BTN-186, R-BTN-130). Lifting a hold resets the leg's attempt and blocked-end counts."
  - `spec/BATON_SPEC/07-conditions.md:380-383` — "The row resets — `attempts` to 0, `retry_after` cleared — when a run of the leg reaches one of its outcomes … and when a hold is lifted"
  - `spec/BATON_SPEC/12-security.md:972-975` — "It never loosens what another credential set, … and never makes a change that loosens an R-BTN-66 setting — lifting another's hold, removing or narrowing another's bar, `retry`, …"
  - `spec/BATON_SPEC/07-conditions.md:418-420` — "the owners' `retry` setting, a Baton setting (R-BTN-66), bounds every policy: `{max_attempts, backoff_s}`, a ceiling on the first and a floor under the second"
  - `spec/BATON_SPEC/11-people.md:456-458` — "a hold set over MCP is a `held` event with `hold_reason: mcp:<name>`; on a ticket already held it changes nothing"
- **The trace:** A ticket's `implement` has failed twice; `leg_attempts` is `attempts: 2`, `retry_after` 55 minutes away, a `retry` row refuses every claim (rule 10). An MCP key minted with `ticket.hold` and `ticket.unhold` (both `delegated`, `11-people.md:224-225`) calls hold — the ticket is unheld, so the hold is its own — then unhold. By `07:380-383` the row is now `attempts: 0`, `retry_after` cleared; the `retry` block is gone and the leg is offered at once with a full policy. Repeating it before each third failure means the ticket never reaches `attempts-exhausted`, never raises `baton.retries`, and never observes the owners' `backoff_s` floor: the owners' `retry` bound is void for whoever holds the key. The same pair resets "blocked-end counts", voiding `max_blocked`, "a constant of this specification". The key is the credential the spec gives to an owner's tool — the least trusted owner-side principal — and R-BTN-186 lists `retry` by name among what it never loosens.
- **Counter-reading considered:** "Lifting a hold" in R-BTN-122 might mean only Baton's own exhaustion holds. The text says "a hold" three times (§6.8, R-BTN-122 twice) and §13 says "reset when … a hold is lifted" (`13-data-model.md:159`); nothing narrows it. Searched `reset` across the spec and R-BTN-186/R-BTN-130 for an exception; S-BTN-191 tests "an MCP key holding a ticket, lifting its own hold" with no assertion on counts.
- **Smallest fix:** In R-BTN-122: the counts reset when a hold *Baton set for exhaustion* (`attempts-exhausted`, `non-retryable:*`, `blocked-exhausted`) is lifted, or by `baton.retries`' `retry`/`route` restarts — never by lifting an `owner`, `mcp:*`, `parked`, `outbox-refused` or `scope-exceeded` hold. Say how "blocked-end counts", which are counted from `claims` rows, are reset at all (no column holds the watermark).

### BLK-5: "Cancel" is two different acts: a liftable hold plus a release (§6.8, §7.5, §9), and an irreversible cancellation that runs the `cancel` leg (R-BTN-186)
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-12, R-BTN-90, R-BTN-168, R-BTN-186, R-BTN-130, `ticket.cancel`
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:553-554` — "The dashboard's **Cancel** sets a hold and sends the holder a `release` with reason `owner-cancel`."
  - `spec/BATON_SPEC/07-conditions.md:487-488` — "Cancel (a hold and a `release` with reason `owner-cancel`, §6.8)"
  - `spec/BATON_SPEC/09-claims.md:167` — "`released:owner-cancel` | `released` | Cancel: hold plus release (§6)"
  - `spec/BATON_SPEC/12-security.md:969-970` — "a cancel is undone by no one, its `cancel` leg running its course (R-BTN-168)"
  - `spec/BATON_SPEC/07-conditions.md:563-569` — "**Cancelled.** A ticket is cancelled when its file says withdrawn (R-BTN-74) or when Baton **supersedes** it because: a call settled without it …; the condition it handles closed by other means …; its `lifetime` ended; its source stopped posting a ticket that has no file"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:551-553` — "A cancellation (R-BTN-168) is a second flag beside the hold, `cancelling`, … which no owner lifts."
- **The problem:** `ticket.cancel` (`POST …/overrides/{ticket}` `{cancel: true, confirm: true}`) is one of two things.
  - (A) Hold + `owner-cancel` release: the ticket stays where it is, an approver lifts the hold and work resumes, no `cancel` leg runs.
  - (B) R-BTN-168's cancellation: `cancelling`, the `cancel` leg, a `withdraw` outbox entry, the file withdrawn in git, undone by no one.

  R-BTN-168's closed list of what cancels a ticket has no owner act in it, so on its own text (A) holds; R-BTN-186 justifies letting a delegated key call it on reading (B). The observable difference is whether an MCP key's `ticket.cancel` withdraws a ticket in git irreversibly. Under (A) there is also a privilege wrinkle: the hold a delegated key's cancel sets is "a hold it set", which it may lift, while an owner's is lifted only by an `approvers.policy` approver. Under (B), §6.8's "sets a hold" is wrong and an owner has no stated way to hold-and-stop in one act.
- **Counter-reading considered:** The dashboard's "Cancel" (capitalised, a control) and R-BTN-168's "cancelled" could be deliberately different words. Then R-BTN-186's sentence is simply false, and the vocabulary page's "Cancel leg … when a ticket is cancelled" misleads. Searched `owner-cancel`, `ticket.cancel`, `cancel: true` and "Cancel (" in every section: §8, §9, §14 all say hold plus release; only R-BTN-186 says the cancel leg.
- **Smallest fix:** Decide. If (A): fix `12-security.md:969-970` ("a cancel is a hold and a stop; its hold is the key's own") and rename the control or the R-BTN-168 state so one word has one meaning. If (B): add "an owner's `ticket.cancel`" to R-BTN-168's list and rewrite §6.8, R-BTN-90 and §9.4's row.

### BLK-6: `baton.outbox-late` is a `notify` condition with no restarts, yet R-BTN-171 relies on "the condition's `retry`"; without it a delivered-unconfirmed `withdraw` leaves the ticket `cancelling` with no Baton-side exit
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-163, R-BTN-171, R-BTN-168, S-BTN-136
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:321-323` — "**Every other core condition** is a `notify` condition `baton.<sub>`, where `<sub>` is the reason the rule that raises it names (for example `output-invalid`, `check-mismatch`, `course-changed`, `queue-over`, `head-unfounded`, `outbox-late`)."
  - `spec/BATON_SPEC/07-conditions.md:309-311` — "**`baton.retries`, `baton.contract` and `baton.stalled`** have disposition `suspend` on the whole ticket, the standard restarts below"
  - `spec/BATON_SPEC/07-conditions.md:678-681` — "A `delivered` entry is never claimed again. An entry still not `confirmed` after 3 accepted snapshots at or after its commit raises `baton.outbox-late`; a `withdraw` entry's ticket, already `cancelling` (R-BTN-168), stays so, and the condition's `retry` queues the entry again."
  - `spec/BATON_SPEC/07-conditions.md:297` — "An owner answers a `suspend` condition with `baton ticket resolve <ticket> <restart>`"
  - `spec/BATON_SPEC/07-conditions.md:578-579` — "a flag beside any hold it carries, which no owner lifts"
- **The problem:** A `notify` condition has no restarts and no resolve action; `ticket.resolve` answers `suspend` conditions only. So "the condition's `retry`" names a control that does not exist, and "never claimed again" contradicts "queues the entry again". Trace: a deliverer (default policy admits any `runner` grant, `12-security.md:366`) marks a `withdraw` entry `delivered` with some `ref` and writes nothing (a bug, a crash between mark and push, or a compromised runner). The entry is `delivered`, never offered again; the ticket is `cancelling`, which no owner lifts, and it refuses every leg. Three snapshots later `baton.outbox-late` is raised, and nothing in Baton can re-queue the entry. The only exit is a person hand-editing the ticket file to `withdrawn` in git — which the spec does not say.
- **Counter-reading considered:** `baton.outbox-late` might be a fourth `suspend` core condition whose table row was forgotten; S-BTN-136 (`15-verification.md:196`) expects "the entry queued again by `retry`". Then `07:321-323` listing it as a `notify` example is wrong and its restarts, default and floor listing (`07:353-355`, `:361`) are missing. Either way two statements conflict.
- **Smallest fix:** Add `baton.outbox-late` (for the delivered-unconfirmed and `refused` cases) to the `suspend` table at `07:313-317` with `retry` = re-queue, and to the floor list; or drop "the condition's `retry`" and give `outbox` its own owner action. Reword "never claimed again" to "not claimed again until re-queued".

### BLK-7: A `call` block's `ref` is `claim_legs.id` in §6 and `claim_legs.seq` in §7; `seq` is per claim and collides
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-75, R-BTN-165, §13 `claim_legs`, `ticket_blocks`
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:105` — "| `call` | the run's `claim_legs` row `id` | its leg | by a `blocked` end (R-BTN-165) |"
  - `spec/BATON_SPEC/07-conditions.md:504-505` — "The runner then ends the claim `released:blocked` on `{kind: "call", ref: <claim_legs seq>}`"
  - `spec/BATON_SPEC/13-data-model.md:136` — "`claim_legs` | `id` | … `seq` (per claim; null with the claim)"
  - `spec/BATON_SPEC/13-data-model.md:157` — "`ticket_blocks` | `(ticket_id, kind, ref, leg)`"
- **The problem:** `seq` restarts at each claim, so the first leg of every claim is `seq` 1. A call leg with `max_runs` 3 (the shipped `verify`, `05-courses.md:886`) run by three successive claims writes `ref` "1" each time. The block's primary key, `blocks_by_ref` and R-BTN-126's per-`blocked_ref` count cannot tell the runs apart, and `baton leg why`'s "`open`, with the run's children" cannot find the run from `(ticket, leg, 1)` without the claim. The runner knows `seq` (it sends it in `legs_finished`) and may not know `id`; the server knows both.
- **Counter-reading considered:** The runner sends `seq` and Baton translates to `id` when writing the row. Plausible, but unstated, and R-BTN-126's "A bad kind or `ref`" check needs to know which is valid. Searched `claim_legs` in §13/§14 and `run_id`: the unique opaque `run_id` (R-BTN-63) is the obvious key and neither rule uses it.
- **Smallest fix:** Make both rules say `ref` is the run's `run_id`.

### BLK-8: A retry policy's `exhausted` leg can name itself or a leg that names it back: the ticket is retried forever and nothing is raised
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-122, R-BTN-69 (validator), R-BTN-83
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:391-392` — "`exhausted`, optional, a leg leaving the same station that Baton queues instead of holding the ticket."
  - `spec/BATON_SPEC/07-conditions.md:412-414` — "When the policy names `exhausted`, a leg leaving the same station, Baton instead queues that leg (`next_source: baton`), held until the station changes (R-BTN-83), and raises nothing."
  - `spec/BATON_SPEC/07-conditions.md:380-383` — "The row resets … when a run of the leg reaches one of its outcomes … and when a hold is lifted"
  - `spec/BATON_SPEC/05-courses.md:155-159` — "every cycle contains a leg with `max_runs`; … `cancel`, if present, names a leg … which no `next`, `exhausted` or completion `next` names"
- **The trace:** Legs `push` and `email` both leave `queued`; `push.retry.exhausted = "email"`, `email.retry.exhausted = "push"` (or `push.retry.exhausted = "push"`). Neither moves the ticket on failure, so there is no graph cycle and the validator requires no `max_runs`. `push` fails three times, Baton queues `email`; `email` fails three times, Baton queues `push`, whose `attempts` is still 3 (no outcome, no hold lifted). Its next failure is at once "reach `max_attempts`", so Baton queues `email` again. The ticket alternates forever at one attempt per `backoff_s` (floor 60 s), is never held, and by the rule's own words "raises nothing". The bound a retry policy exists to give is gone, in a file any pusher edits.
- **Counter-reading considered:** `max_runs`, if set, would stop it ("the ticket's runs of it are fewer than its `max_runs`", `05:254-255`), and the owners' `max_attempts` ceiling applies per leg. Neither is required here, and the ceiling bounds attempts per exhaustion, not exhaustions. Searched `exhausted` in §1, §5, §13, §15: the validator constrains only what the `cancel` leg may be named by.
- **Smallest fix:** Validator: `exhausted` names a different leg leaving the same station whose own policy names no `exhausted` (or: the chain of `exhausted` legs from a station is acyclic). R-BTN-122: a leg queued as `exhausted` that itself exhausts always holds.

### BLK-9: A `suspend` condition "closes" at two different moments — when its restart is formed (R-BTN-162) and when its handler ticket closes (R-BTN-160, §6.1)
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-120, R-BTN-160, R-BTN-162, §13 `conditions`
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:106` and `:114` — "A condition is open until its outcome is settled" / "| `suspend` | its handler ticket closes `done` or `withdrawn`, or an owner resolves it (R-BTN-163) |"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:22` — "| condition | a `suspend` raise past its wait (R-BTN-162) | the handler closes, or an owner resolves it | a `condition` block |"
  - `spec/BATON_SPEC/07-conditions.md:225-229` — "A `suspend` condition settles once, in one transaction, … whatever happens to the handler after that settles nothing more: the handler ticket's person leg is answered (R-BTN-116)"
  - `spec/BATON_SPEC/07-conditions.md:253` — "The prerequisite is met when the condition settles (above)."
- **The problem:** The person leg's answer and the handler ticket's close are different transactions. The answer is an arrival at a station; the ticket closes when it is at an end station *and* (for a file ticket) a snapshot posts it closed, and a repository's own handler course may have legs after the person leg (R-BTN-161 only requires that every path *pass* one). So: is the `condition` block removed, `unblocked` sent and the claim's "20 open conditions" count decremented at the answer or at the handler's close? §6.1 and R-BTN-160 say the close; R-BTN-162 says the answer. `conditions` has one `closed_at` and no `settled_at`. On the "close" reading a leg waiting in its claim (120 s for `hitl`) can never be settled in the wait by an answer alone, since `handled` is queued "in the settling transaction".
- **Counter-reading considered:** For the standard `ask`, the answer reaches the end station `answered`, so the two nearly coincide. They still differ by a snapshot, and R-BTN-161 explicitly allows other handler courses. Searched `settle`, `closed_at`, `consumed_at`.
- **Smallest fix:** In R-BTN-160's table and §6.1's row: "`suspend` | when its restart is formed (R-BTN-162)". Say separately what the handler ticket's later close does (nothing).

### BLK-10: Which end "consumes" a restart is ambiguous, and one reading loses a person's answer in a race with the blocked end
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-162, §13 `conditions.consumed_at`
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:266-269` — "The claim response carries `resume: [...]`, every settled `suspend` condition of the leg that no end of a claim has consumed, in raise order … An end of the leg's claim marks them consumed."
  - `spec/BATON_SPEC/07-conditions.md:254-255` — "A condition already settled when the end arrives writes no row, so the next claim resumes at once."
  - `spec/BATON_SPEC/07-conditions.md:257-258` — "Any end of a claim waiting on an open `suspend` condition other than the one that consumes its restart"
  - `spec/BATON_SPEC/13-data-model.md:162` — "`consumed_at` (an end of the raiser's claim consumed the restart, R-BTN-162)"
- **The problem:** The wait expires at T; the person answers at T−1 s; the `handled` message is queued but the runner has already decided to end blocked and its end arrives at T+1 s. By `:254-255` no row is written and "the next claim resumes at once" — which requires that this blocked end did *not* consume the restart. By `:269` "An end of the leg's claim marks them consumed", and this is an end of the leg's claim with a settled, unconsumed condition of the leg.
  - Reading 1 (every end consumes all settled conditions of the leg): the answer is consumed by a leg that never saw it; the next claim gets no `resume` and asks again.
  - Reading 2 (an end consumes only what its claim was handed in `resume` or acknowledged as `handled`): correct, but then Baton must record per condition whether it was handed, which no column does.

  The same question arises for a release (`owner-cancel`) that lands just after an in-wait answer.
- **Counter-reading considered:** "them" grammatically refers to the list the claim response carried, i.e. reading 2 for resumed claims; but the in-claim `handled` path has no claim-response list at all, so the sentence does not cover it. Searched `consumed` across the spec: only these two places.
- **Smallest fix:** "An end consumes a settled condition only if its claim was given it — in the claim's `resume`, or in a `handled` message the runner acknowledged." Add the race to the scenario for R-BTN-162.

### BLK-11: `"replaces": "retry"` — the runner is to report it in a body that has no such field, "only the runner knows the binding" although Baton stores it, and §13 still says Baton files handler tickets for its own conditions
- **Severity:** medium
- **Kind:** restatement-drift
- **Rules:** R-BTN-122, R-BTN-160, R-BTN-161, R-BTN-163, §13 `condition_bindings`, §14
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:376-377` — "Only the runner knows the binding, so it reports the raise with `replaces: "retry"` and ends the claim `released:blocked` on the condition, never `cannot-finish`."
  - `spec/BATON_SPEC/07-conditions.md:92-94` — "`POST /v1/runner/claims/{id}/conditions` and the body `{type, disposition, handler?, restarts, default?, severity?, url?}`" (same at `14-api.md:76`)
  - `spec/BATON_SPEC/13-data-model.md:49` — "`condition_bindings` | … `course_id`, `replaces`, `snapshot_sha` | Bindings as posted (`bindings` and `tickets[].conditions`, §4.4) … Baton reads them only to file handler tickets for its own conditions (R-BTN-161, R-BTN-171)"
  - `spec/BATON_SPEC/07-conditions.md:176-178` — "and so is a binding of `baton` or `baton.*`: Baton's own conditions are delivered from Baton's list, never through a ticket (R-BTN-163)" and `:338-339` — "Baton files no handler ticket, queues no outbox entry and withdraws nothing for it"
- **The problem:**
  - (a) The report has nowhere to carry `replaces`; the schema would refuse it.
  - (b) Baton holds every binding with its `replaces` flag as posted, so the stated reason is false, and Baton could check the runner's claim against it but no rule says so. Unchecked, a runner turns any failed attempt into a `released:blocked` end by asserting `replaces: "retry"`: no attempt is spent and no backoff starts. Only `max_blocked` (5 in 24 h, against a default `max_attempts` of 3 with an hour's backoff each) bounds it.
  - (c) §13 gives `condition_bindings` a purpose §7.3 forbids, so the table has no reader.
  - (d) With `replaces`, the restart `park`/`route:<leg>`/`retry` "decides in the policy's place", but who applies it is not said: R-BTN-162 hands restarts to the leg ("The leg decides what `restart: null` means"), while `park` and `route` are Baton acts on a ticket with no hold.
- **Counter-reading considered:** `disposition: "suspend"` in the report could stand for `replaces`. Then Baton cannot tell an `error` raised as suspend-by-binding from a declared `suspend` type and cannot apply "checked against the owners' bounds below". Searched `replaces` in §13–§15: only the binding shape and the table above.
- **Smallest fix:** Add `replaces?: "retry"` to the report body (R-BTN-160, §14) and have Baton refuse it unless `condition_bindings` shows such a binding in scope; state that Baton applies the restart of a `replaces` condition exactly as it applies `baton.retries`'; correct §13's description of `condition_bindings`.

### BLK-12: Outbox marks: `refused` both re-queues and waits for a lift; a late mark is both accepted and `forbidden`; and a Baton-set hold has one slot shared with every other reason
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-171, R-BTN-12, §13 `outbox`, `ticket_overrides`
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:654-655` — "`failed` is a mark, not a state: the entry returns to `queued`, after a backoff for `transient` and with its ticket held for `refused`."
  - `spec/BATON_SPEC/07-conditions.md:660-663` — "`refused` … holds the entry's ticket (`hold_reason: outbox-refused`) and raises `baton.outbox-late` naming the deliverer, until the deliverer is fixed and the hold lifted by an approver on `approvers.policy` (R-BTN-186, R-BTN-188), which queues the entry again."
  - `spec/BATON_SPEC/07-conditions.md:656-658` — "A lapsed lease re-queues the entry. A mark arriving after its lease lapsed is accepted. A mark from any credential but the claimer is `forbidden`."
  - `spec/BATON_SPEC/13-data-model.md:184` — "`credential_id` (the deliverer while `claimed`)"
  - `spec/BATON_SPEC/13-data-model.md:160` — "`ticket_overrides` | `ticket_id` | `expedite`, `hold`, `hold_reason` (…)" (one row, one reason)
- **The problem:**
  1. After `refused` the entry is `queued` (so another deliverer may claim it at once — a ticket hold does not stop outbox claims) or it is parked until the lift "queues the entry again". Two behaviours.
  2. Deliverer A's lease lapses, B claims, A's `delivered` mark arrives: "accepted" (A did claim it; the effect is in git) or `forbidden` (the stored claimer is B)? If refused, B writes nothing (idempotence) and reports the head, fine; if accepted, B's later mark hits a `delivered` entry — unstated.
  3. `ticket_overrides` holds one `hold_reason`. A `withdraw` entry's ticket is already `cancelling` and may already be held (`owner`, `attempts-exhausted` from a failed `cancel` leg). Does `outbox-refused` overwrite that reason? If so the approver's lift, which "queues the entry again", also removes an owner's deliberate hold; if not, there is no `outbox-refused` hold to lift and the entry never re-queues. R-BTN-130 answers this for MCP holds only ("on a ticket already held it changes nothing").
  4. Under the default policy any granted runner that declares `delivers: [git]` can mark `refused` and so place a hold only an `approvers.policy` approver lifts — a hold lever for a compromised runner on every ticket with an outbox entry, beyond the "withhold a check" the rule concedes at `:639-640`.
- **Counter-reading considered:** For (1), "returns to `queued`" may be the generic description of `failed` and `:660-663` the specific rule. For (2), "the claimer" may mean any credential that held a lease on the entry. Neither is written. Searched `outbox` in §11–§14 and S-BTN-136.
- **Smallest fix:** Give `refused` its own parked sub-state (`not_before` = until lifted); define a late mark from a former claimer once another holds the lease (`ok`, ignored); state hold precedence for Baton-set reasons in R-BTN-12 (one rule for every setter, as R-BTN-130 has for MCP).

### BLK-13: A `requires.resources` entry bound as a gate with `missing: block` fails open when the repository has no usable instance or the name is unregistered
- **Severity:** medium
- **Kind:** safety
- **Rules:** R-BTN-76, R-BTN-181, rule 1
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:310-312` — "**Blocked** when at least one live runner is granted on the repository, the repository has a usable instance of R, and every one is `unavailable`. With no live granted runner, or no usable instance, no row is written and `other` lists `no-instance`."
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:308-309` — "an invalid or unregistered name is logged and blocks nothing"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:317-320` — "A row binds as its requirement says (R-BTN-181): advice by default, a gate where the course's requirement binds `gate`; under `missing: block` an `unknown` instance counts as `unavailable` for that requirement."
  - `spec/BATON_SPEC/12-security.md:676-678` — "`missing` is `block` (the default for `gate`) or `allow` (the default for `advice`): whether no attestation in force, lapsed, revoked or, for `requires.resources`, `unknown` (R-BTN-76), blocks."
- **The problem:** A course gates `deploy` on `requires.resources` naming `budget:prod` with `binds: gate`, so `missing: block` by default: no reading, no deploy. An administrator edits the account instance's repository list and drops this repository (or the resource name has a typo, or was never registered). Now there is "no usable instance": no row is written, rule 1 finds nothing, and the gate is open. That is the opposite of what `missing: block` promises, and of how the long form behaves (for a full `instance` requirement "`missing` means there is none", `06:262-263`, which blocks). The short and long forms of one requirement give opposite answers for the same world.
- **Counter-reading considered:** `no-instance` is listed under `other`, so `leg why` shows it; and only an administrator or a pusher can cause it. But `other` gates nothing, and a gate that a typo opens is exactly what "Unmeetable entries fail closed" (`06:51`) exists to prevent for tickets. Searched `no-instance`, `missing`, `unregistered`: no rule makes a gate-bound resource need block on zero instances.
- **Smallest fix:** In R-BTN-76 "Blocked": a requirement that binds `gate` with `missing: block` writes its row when the repository has no usable instance or the name is unregistered (`why: no-instance`); only the advice form stays rowless.

### BLK-14: The two per-leg instants are said to restart "only when the ticket's station changes", but a route and the `retry` restart both restart them; §5 measures `expires` from a different event
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-116, R-BTN-167, R-BTN-163, §5 leg-field table
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:369-373` — "The instant is set when the person leg becomes the queued leg — at the ticket's arrival at the station, …, or at a route that queues it (R-BTN-83) … a route that queues another leg clears it. It restarts only when the ticket's station changes"
  - `spec/BATON_SPEC/05-courses.md:132` — "unanswered for `after_s` (60 s–30 d) after the ticket arrived at the leg's station"
  - `spec/BATON_SPEC/07-conditions.md:458-460` — "fires them from the alarm, once per `from_at`. The rows are owner state (R-BTN-88): an instant restarts only when the ticket's station changes"
  - `spec/BATON_SPEC/07-conditions.md:317` — "| `baton.stalled` | … | closes it and restarts the clock | re-routes | …"
  - `spec/BATON_SPEC/07-conditions.md:449-452` — "The clock counts from the ticket's arrival at the leg's `from` station, only while the sync's readiness attests the leg `waiting` … The condition closes by itself when the leg is posted `ready`."
- **The problem:**
  - (a) Route away from a person leg and back: the instant is cleared, then "set when the person leg becomes the queued leg … at a route that queues it" — a restart with no station change. An owner can extend an expiry indefinitely this way, and §5 says the clock runs from arrival regardless.
  - (b) `baton.stalled`'s `retry` "restarts the clock" at an unchanged station.
  - (c) `stalled_s`: is `due_at` = arrival + `stalled_s` (wall time, fired only if then `waiting`) or does it accumulate only while posted `waiting`? "counts from … arrival, only while … `waiting`" supports both; `ticket_timers` has `from_at` and `due_at` and no accumulator.
  - (d) "once per `from_at`" plus "closes by itself when the leg is posted `ready`": a leg that goes `waiting` → notice → `ready` for a minute → `waiting` for a month at the same station is never noticed again, although the stated purpose is "how long the leg may be posted `waiting`".
- **Counter-reading considered:** "Restarts only when the station changes" may be meant only against Baton *moves* (import/export, R-BTN-88), as the following clause says. Then it is an over-broad sentence, stated twice, that an implementer will code as an invariant. Searched `from_at`, `ticket_timers`, `restarts the clock`.
- **Smallest fix:** State once, in R-BTN-167, the events that set `from_at` (station change; the leg becoming queued by a route; the `retry` restart; for `stalled`, each `ready`→`waiting` flip), and have R-BTN-116 and §5's row cite it.

### BLK-15: The gates table and "the pipeline" list different rule sets for recommendations and for an advance
- **Severity:** low
- **Kind:** underspecified
- **Rules:** §6.6 (rules 3, 13, `floor`, `person`, `trusted`, `chain`, `entry`), R-BTN-100, R-BTN-189
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:452` — "| `floor` | Every guarantee a floor names holds … | claim, advance | `floor-broken` |" and `:441` — "| 3 | … | claim; advance: hold and cancellation only |"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:477-479` — "an advance re-runs rule 1's advance form, rule 3's hold, rules 4–8, 10, 11 and `person`."
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:470-472` — "That is rules 1, 3, 4, 5, 7, 9, 10 and rule 8's posted bars. 2. `isEligible` applies rule 2 and rule 8's owner bars per leg."
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:531-532` — "With neither, Baton claims its first recommendation"
- **The problem:** At an advance the table applies `floor` and rule 3's cancellation; the pipeline's list omits both (and `trusted`, `chain`, `entry`, which the text above calls gates). An implementer following the pipeline lets a claim advance on a ticket marked `cancelling` or on a repository whose floor broke after the claim. For recommendations, neither step 1 nor step 2 applies rule 13, `floor` or `person`, so `/v1/runner/next` can return a leg the claim transaction always refuses. A claim "with neither" then "claims its first recommendation" and is refused each time (head-of-line blocking) unless the implementer guesses that step 2 means every remaining rule.
- **Counter-reading considered:** "`isEligible` … is the reference for every rule" (`:457`) suggests step 2 really applies all of them, and the pipeline lists are illustrative. Then the lists should not read as exhaustive ("That is rules …"). Searched `floor-broken`, `rename-held`: R-BTN-189's own text sends a `release` to running claims, which covers a running leg but not the advance.
- **Smallest fix:** Replace the enumerations at `:470-472` and `:477-479` with "every rule whose **At** column names the event", and make the table the one list.

### BLK-16: A `release` message names a ticket, not a claim; nothing retires it when the claim it was meant for ends first
- **Severity:** low
- **Kind:** underspecified
- **Rules:** §6.9, R-BTN-119, §13 `messages`
- **Confidence:** low
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:578` — "`release` `{ticket_id, reason}`"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:591-593` — "A delivered `release` unacknowledged for 2 hours is reaped by the alarm with a fence (R-BTN-19)"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:594` — "**Expiry.** A reaped runner's `pending` and `delivered` messages become `expired`."
  - `spec/BATON_SPEC/07-conditions.md:475-478` — "a `leg-timeout` release still pending for that leg is withdrawn" (the only withdrawal stated)
- **The problem:** An owner's Stop is queued for runner R on ticket T. Before R's next heartbeat, R's claim ends on its own and R (which may hold several claims, R-BTN-4) claims T again, or the release is `delivered` in the very heartbeat that follows a fresh claim of T. The message is still `pending`, addressed to R, naming T: R stops the new claim. And if R ended the first claim without acknowledging, the 2-hour rule "reaps" — which claim? Only the `leg-timeout` kind has a withdrawal rule.
- **Counter-reading considered:** The ring makes the window a second or two, and a runner would acknowledge a release for a ticket it no longer holds. Both are likely in practice; neither is written, and `messages` has no `claim_id` (`13-data-model.md:183`). Searched `withdrawn:` and `expired` for other message retirements.
- **Smallest fix:** Carry `claim_id` in `release`; expire a pending or delivered `release` in the transaction that ends its claim.

### BLK-17: `hold_reason` is enumerated in §6.8 without `scope-exceeded`, and "owners clear" a hold that §11/§14 give to an `approvers.policy` approver
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-12, R-BTN-186, §12.9, §13
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:549-551` — "with `hold_reason` `owner`, `mcp:<name>`, `parked` (R-BTN-163), `attempts-exhausted`, `non-retryable:<class>`, `blocked-exhausted` (R-BTN-122, R-BTN-126), or `outbox-refused` (R-BTN-171)"
  - `spec/BATON_SPEC/13-data-model.md:160` — "`hold_reason` (`owner`\|`attempts-exhausted`\|`non-retryable:<class>`\|`blocked-exhausted`\|`parked`\|`outbox-refused`\|`scope-exceeded`\|`mcp:<name>`)"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:556-557` — "Owners set and clear both with `POST /v1/owner/{repository}/overrides/{ticket}`"
  - `spec/BATON_SPEC/14-api.md:113` — "owner for `expedite`, `hold: true` and `cancel`; a lift (`hold: false`) by an approver on `approvers.policy` (R-BTN-186)"
- **The problem:** The home rule for holds omits a reason §12.9 sets, and says any owner clears a hold where the registry requires a policy approver (a human, under a human-only list). `09-claims.md:164` also cites R-BTN-122 for `max_blocked`, whose home is R-BTN-126.
- **Counter-reading considered:** Under the default `[owner]` list an owner is the approver, so "owners clear" is true by default. It is false under `protected`.
- **Smallest fix:** R-BTN-12 lists the reasons once, `scope-exceeded` included, and says "lifted by an approver on `approvers.policy` (R-BTN-186)".

### BLK-18: Small numeric and naming drift inside §7
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-122, R-BTN-90, R-BTN-160
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:398-399` — "the leg's `retry_after` is now plus `backoff_s`, multiplied by a uniform factor in [0.9, 1.1]" against `:427` — "| floor `backoff_s` | 60 |" ("a floor under the second", `:419-420`)
  - `spec/BATON_SPEC/07-conditions.md:471` — "`legs_finished: [{claim_id, seq}]`" against `:475` — "The heartbeat processes `leg_finished` before it delivers messages" (also `15-verification.md:185`, `:368`; `14-api.md:72` has `legs_finished`)
  - `spec/BATON_SPEC/07-conditions.md:222-223` — "It waits up to `wait_s`: the raise's value, else the type's declaration, else 120 s for `hitl` and 0 for every other type; never more than 900 s."
  - `spec/BATON_SPEC/07-conditions.md:103-104` — "A claim may hold at most 20 open conditions, and a ticket may raise at most 200 a day. Past either limit the request is refused with `quota`."
- **The problem:**
  - (a) With the jitter the effective backoff can be 54 s, under the owners' hard floor of 60; say whether the floor applies before or after the factor. The factor is also the one random draw in a retry path; the rule does not say it comes from the core's replaceable random source (R-BTN-63 does for run ids).
  - (b) One field, two names.
  - (c) A `wait_s` above 900 — clamped or refused? The course validator's ranges (`05:161-163`) do not include `wait_s`.
  - (d) A `quota` refusal of an `interrupt` raise: the leg has already failed. Whether the claim still ends `cannot-finish:<class>` with its `error` is not said. Nor is whether the 20-open count includes bound `notify` conditions whose `announce` handler never runs (they stay open "until its handler ticket closes", `:113`), so that a chatty leg's 21st raise — its `hitl` — is refused.
- **Counter-reading considered:** Each is a reasonable guess for an implementer; together they are four guesses in two rules.
- **Smallest fix:** One clause each: "the floor applies to the product"; rename to `legs_finished`; "`wait_s` is clamped to [0, 900]"; "the open-condition quota counts `suspend` conditions only, and never refuses an `interrupt`".

---

## Read but found sound

- **Seats (R-BTN-178): counting, serialization, dead holders.** One tenant object serializes claims (`02-deployments.md:14`), `claim_seats` is the count, an advance rewrites the set atomically, and a fence-pending reap keeps its seat only to `fence_deadline` (reap + lease timeout, at most 24 h; alarm row in §2). Hold-and-wait between two claims each needing the other's seat at an advance cannot deadlock: a refused advance does not wait in the claim and the runner suspends, releasing its seats. Lowering a capacity under held seats is consistent with the scenario row.
- **§2 clocks table against §6/§7.** 2 h / 15 min release reaps, `retry_after`, `not_before`, `stalled_s`, `expires`, reading lapses, outbox lease/backoff/age and the fence-seat instant all appear and agree.
- **Course-field ranges.** `deadline_s` 60 s–7 d, `stalled_s` default 259,200, `expires.after_s` 60 s–30 d, `max_blocked` 5 / 24 h (sixth end holds; S-BTN-95, G-BTN-115), 20 open / 200 a day (`14-api.md:76`), outbox claim ≤ 50 and 10-minute lease (`14-api.md:146`), capacity 1–64 (§13, §14) agree across §5, §7, §13, §14, §15.
- **Message delivery (§6.9).** At-least-once by redelivery until acknowledged, act-once by `id`; kinds match §8's rings and §13's enum; `handled` lost with a dead holder is recovered by `resume`.
- **Deadline at expiry mid-heartbeat (R-BTN-90).** The order "process `legs_finished`, then deliver messages" resolves the race deterministically; "a release already delivered stands" is a stated choice.
- **Resource deadlock / reaped holder.** Resources are not held by claims (readings and counts only), so there is no resource lease to orphan; an `end`-sourced need is bounded by 7 days.
- **Expedite and hold.** The lane is bounded at 2 active claims; an MCP hold never replaces another reason; a hold survives withdraw-and-reopen (`closed_tickets.kept_json`). No starvation of ordinary tickets beyond the stated lane was found.
- **Blocked-end loops on `resource`/`capability`.** Bounded by `max_blocked` and `baton.blocked-ends`; a leg's own `reading` is never forwarded.
- **Handler recursion.** A handler that itself raises is a child, bounded by R-BTN-149's four generations and the 200-a-day quota per ticket.
- **Cancellation against a completed-unconfirmed claim.** `superseded_at` gives one stated answer (never confirmed, holds nothing); the residual "work merged, ticket withdrawn" outcome is the declared semantics of supersession.

## Not covered

- R-BTN-77's "lost answer" bookkeeping (`tickets.answer_lost`) was read but not traced exhaustively against every interleaving of recounts; I found no break and do not claim it sound.
- R-BTN-198 (leg events, §7.10) and R-BTN-195 (`interact`) were read line by line but attacked only lightly; their cross-references into R-BTN-5, R-BTN-35, R-BTN-106, R-BTN-113 were not followed.
- R-BTN-76's reading supersession ("kept per instrument", the 8-instrument cap, the hourly counter-reading in the scenario at `15-verification.md:171`) was checked for numbers only, not against R-BTN-181's full text.
- R-BTN-89's series (`writeSuccessor`) and R-BTN-169's `deliver` course internals were read but not attacked.
- `spec/BATON_SPEC_HISTORY.md` and `BATON_MCP_OAUTH_SPEC.md` were not consulted; §91 Decisions was grepped for a few terms only, so a Decisions line that has drifted from §6–§7 may be missed.
- `npm run spec:impact` was not run; cross-references were checked by grep and targeted reads.
