---
title: "Proposal — scenarios and gates for designs that are not built"
description: "The scenarios and gates of BATON_SPEC §15 whose subject is a design that is not built and that have no test: each returns to §15's tables, under its id, with the change that builds it."
---
**Status:** proposal — not built; moves into BATON_SPEC §15 when built (each group names its tickets)

A scenario here has no test file and its subject is not in `src/`. The ids are taken: a row
returns to [BATON_SPEC §15](../BATON_SPEC/15-verification.md) under the same id, shortened to
what it establishes and the rules it tests, in the change that makes its test pass (R-BTN-31).
The rows are as they were written for the design, script and expectation in full. A gate is
here when only scenarios on this page prove it.

## Multi-tenant deployment and admission limits

The design: [multi-tenancy](multi-tenancy.md). Tickets: B-45.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-111 tenants share nothing | two local hosts; one's signed request, API key, MCP key and session presented to the other; a foreign URL host | `unauthenticated` (`@authority`), each refused as a random one; `404`; the second host unchanged |
| S-BTN-112 one origin per runner and key | a ticket naming another origin; one key started for two origins; `runner register` with no origin | refused naming both origins; exit 2; exit 2 sending nothing |
| S-BTN-113 forge ids | tokens and deliveries with matching paths and wrong ids; renames to a free, a retired and a live path; registrations without ids; a re-identification | mismatches `unauthenticated` or ignored, raised `forge-ids-mismatch`; renames tracked (`repo-renamed`), onto a live path held (rule 13) until confirmed; tombstones; `invalid-params`; re-identified only with `confirm: true` |
| S-BTN-114 refusals clients handle | every route answers `rate-limited`, `quota`, `too-large`; endless heartbeat refusals; signature and API-key floods; ringing viewers | retry after `retry_after_s` with fresh signatures; one-shots exit non-zero; lease lost at `timeout − 4 min`; floods refused in the Worker while the runner's calls verify; rings cost ≤ one heartbeat per 10 s |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-130 | A request is served only at its origin and authenticated only in its tenant; no data crosses tenants | S-BTN-111 |
| G-BTN-131 | No `src/core/` function takes a tenant id; one helper names objects (`idFromName('baton')`, `'baton/<kind>/<key>'`); inbound `x-baton-tenant` stripped | static check, unit tests |
| G-BTN-132 | A runner serves only its origin and refuses one key for two | S-BTN-112 |
| G-BTN-133 | Stored forge ids decide every token, delivery and notification; renames onto a live path are held; fences follow former paths only while free; retired rows are tombstones | S-BTN-113 |
| G-BTN-134 | Clients back off and report `too-large`; lease upkeep has its own bucket and is never refused; failed verifications are bounded per credential and IP without refusing one that verifies | S-BTN-114 |

## Sync ordering: founded heads, lagging fetches and the forced Resync

The design: [tickets-and-sources](tickets-and-sources.md). Tickets: B-77, B-46.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-121 heads and resets | an unfounded head: a rewritten default branch, once and after a fetch lagging the head for 31 minutes; a post whose `parent_sha` is not the head; an administrator's forced Resync naming the new head, then the sync's post against it omitting a ticket with a hold; a forced Resync while a claim whose `snapshot_sha` the new history lacks runs, and one whose `snapshot_sha` it keeps | the sync posts nothing, releases `unfounded` and exits 1, `baton.head-unfounded` raised, and `baton.head-behind` at 30 minutes behind; `head-moved`; `head-reset` logged, the next post materialized as a first snapshot, the omitted ticket dropped with `baton.ticket-dropped` and its hold kept; the first claim ends `released:off-branch` at its runner's next check, the second runs on |

## A ticket source that shows positions

The design: [tickets-and-sources](tickets-and-sources.md). Tickets: none yet.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-237 a ticket source that shows positions | a custom fixture source exporting `file`, `withdraw`, `show` and `note` (`source.writes` naming all four) on a course whose stations carry `display_status` but one; a new ticket and its advance; the snapshot the advance's sync want starts, observed before the show's delivery, and the next one; a status set in the store by a person after the show was confirmed, then changed again over the next three snapshots; a value the fixture's reader always posts in another case; a `show` the store refuses; no source deliverer for 15 minutes; a cancel while a show is queued; a policy whose `outbox.source` names a deliverer other than `runner`; a source exporting only `note`; the markdown source; `protected` with an ejected source | placing and advancing each queue one `source-show`, the station without `display_status` none; the early snapshot judges nothing, the next confirms; the person's change queues one `source-show` and one `source-note` (`display-drift`, the station, the arrival), each later change one `source-show` and no note, never a second queued or claimed; the case-mismatched value stops after 3 unconfirmed deliveries and logs `display-unconfirmed`; the refused and the late entry are dropped and log `display-unwritable`; the cancel's `withdraw` drops the queued show; in every case no position moves, no claim is held or staled, nothing is raised or on Needs you, and the ticket's version is unchanged; the policy is refused `invalid-params`; the note-only source and the markdown source queue no show; `tickets-approved` does not hold with the ejected source |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-170 | A status a ticket source shows, or fails to show, never moves a ticket, holds or stales a claim, raises a condition or reaches Needs you; a ticket has at most one `source-show` queued or claimed; only a snapshot that read the store after the latest delivery judges it; one arrival gets at most one note and at most 3 unconfirmed deliveries; a trusted runner delivers no source entry | S-BTN-237 |

## Courses that do not ship: `branch` and `epic`

The design: [courses](courses.md). Tickets: R3-1265, B-13.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-54 a Baton without GitHub | `plain` with a `post-receive` running `baton repo sync --defaults-only` on the `branch` course; `Baton-Verdict:` trailers, one without `Baton-Claim`; `--if-wanted` cron | the ticket moves to `merged` on push syncs alone; the unclaimed verdict counts; `wanted` holds until a later-numbered post; no forge credential or link |
| S-BTN-89 an epic | `plan` files three children, one withdrawn; `replan` files a replacement; a second epic's `replan` files none | `plan` settles `planned` once all three closed; `replan` settles `built` when its child merges; `integrate` ends `integrated`; the second reaches `abandoned` |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-109 | An `epic` call settles `built` only when every child of its run closed `done`, else `planned` once all closed, so `replan` answers every withdrawal | S-BTN-89 |

## The standard courses as PR record courses, and the leg-state branch

The design: [courses](courses.md). Tickets: B-148, B-149.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-193 leg state | a GitHub repository and a `git` repository; on the `git` repository, ticket B-1 on `claude/B-1-x` and ticket B-1-x on `claude/B-1-x-y`: a review leg writing round 1 to `baton-legs/B-1` at `.baton-legs/B-1/review/<nonce>/round.md`; an address leg, an `approves: true` review and an adjudicate leg; entries `CLAUDE.md`, a symlink and `../x` on the leg-state branch; a leg-state branch whose first commit has a parent; a course whose `branch_pattern` matches `baton-legs/*`; a work-branch commit adding `docs/.Baton-Legs/notes.md`; under `attestations` entries admitting no `sync` writer for verdicts (R-BTN-191), the `branch` course's review; the ticket closing; the leg-state branch merged into the default branch by hand, and a sync posting an empty reading | on GitHub the rounds are PR comments and no leg-state branch exists, the claim response saying `leg_state: forge`; on the `git` repository `branch`, by the forge alone; the round push reports no range, raises no foreign commit and leaves the reviewer independent and `H` unmoved; B-1-x's station function and the PR mapping never see `baton-legs/B-1`; the address leg reads round 1 through `git cat-file` as quoted data, the branch never checked out; the review and the adjudication read nothing from it; the three entries skipped and reported; the non-orphan push refused by the reading leg; the course refused; the work branch refused at merge; no verdict commit on the work branch; the leg-state branch deleted; `baton.leg-state-landed` with the count and `B-1`, closed by the sync's reading, advisory |
| S-BTN-194 one ticket, one PR, one merge | under `cooperative` and under `protected` (plain git's reading being B-154's), each of `bug-report`, `draft-ticket`, `decision`, `spec-to-tickets` and `draft-doc` run from its start leg to its end; the last writing leg routed back after it archived the ticket, then reporting a station other than the one queuing `merged-by-hand`; a PR closed and its ticket withdrawn on the default branch; a record ticket superseded with its PR open; `prepare` finding the question settled; `carry-out` finding the chosen option gone; two tickets' branches taking the same new id; a `fold` | no leg of a record course writes to the default branch under any policy; each ticket's legs on one branch and one PR, the next leg reading the record at the branch's head, the archived file found by its `id`; `merged-by-hand` waiting on `owner` and arriving at the owner's merge as `create-pr`'s does; the ticket done at `merged` and closed in git by its own merge (`status: done`, archived); the routed run's ticket left live on the branch; the withdrawn and the superseded tickets' PRs closed by `close-pr`, nothing landed; `prepare` reaching `carried` with `merged-by-hand` queued; `carry-out` reaching `asked`; the second merge conflicting; the fold recording `duplicate_of:` in its own ticket alone |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-166 | Leg state is the PR conversation on a forge and, on a `git` repository, an orphan `baton-legs/<ticket>` branch no `branch_pattern` matches, never a work branch, never merged, never checked out by the runner, read only as data, and never read by a counted review or an adjudication; no policy knob chooses it; on either, a work branch carrying a segment that folds to `.baton-legs` is refused at merge, and detection on the default branch is the sync's, advisory | S-BTN-193 |

## Leg prerequisites on tickets, and the bound on blocked ends

Tickets: B-10, B-41, B-21.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-72 tickets at stations | `requires.tickets` on a parent `reached` and a `depends_at` `at`; a missing parent; a holder advancing into the leg while its `ticket` row stands | one `ticket` row until the dependency arrives; `reached` holds past it; the missing parent raises `baton.prerequisite-unmet`; the advance refused `blocked` (rule 1) |
| S-BTN-74 why a leg cannot start | four unmet prerequisites; an asker lacking a capability | `baton leg why` lists each with its `why`, plus `not-declared`, from the blocks index alone |
| S-BTN-82 cycles and closed tickets | a two-ticket cycle; a withdrawn dependency; `reached` on a closed ticket | `prerequisite-cycle` raised; never met; met from `final_path` |
| S-BTN-108 one primitive per prerequisite | `depends_on`; a parent whose call leg waits on its children beside another leg; an `OP` tag; a post with a reserved `waiting_on`; a course file with `select: "run"` in `requires.tickets` | start leg waits `ticket@done`; the other leg ready; rule 4; post refused naming the ticket; file refused, previous kept |
| S-BTN-95 blocked ends are bounded | six blocked ends on one leg in a day; one runner blocked 21 times | ticket held `blocked-exhausted`, `baton.retries`; lifting resets; `baton.blocked-ends` |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-97 | A leg is offered only when every prerequisite holds; each unmet one is a block row on the leg | S-BTN-72, -74 |
| G-BTN-104 | Cycles keep their blocks and are raised; a withdrawn ticket meets nothing; `reached` reads a closed ticket's final path | S-BTN-82 |
| G-BTN-127 | Ticket prerequisites reach core only as `requires.tickets` (`parent`, `posted`) or `depends_at`, and a parent waits on its children only through a call; `human-operator` by rule 4; `waiting_on` is never `dependencies`, `children`, `owner` or `policy` | S-BTN-108 |
| G-BTN-115 | Blocked ends per (ticket, leg) past `max_blocked` (5) in 24 h hold the ticket with `baton.retries`; call blocks are not counted | S-BTN-95 |

## Conditions: handlers and the suspend wait

The design: [conditions](conditions.md). Tickets: B-55, B-58, B-59, B-66.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-127 answered within the wait | `hitl` bound to `ask`; a raise with restarts, `wait_s` 600; a runner runs `open` within the wait; an answer from the dashboard before the source posts the question and one after; an answer naming no restart | ask file pushed before return, the raise recording a sync want; once `open` reaches `waiting`, the `answer` leg is on Needs you with the restarts as its options, its question once the source posts it; the first answer settles the condition, `handled` rung, `ctx.raise` returns `{restart: "b", reason: "chosen"}` in the claim; the second is `arrival-unapplied`; `deliver` superseded, its `retract` run; `invalid-params` |
| S-BTN-128 answered after the wait, withdrawn | no answer in 120 s, one 3 h later; a withdrawn ask; one answered 1 s after the wait; a waiting holder reaped, released `requested`, or reaped by `leg-timeout` | `released:blocked` on the `condition`, not failed; resumed by another runner with `resume`; default restart `withdrawn`; no block row, resumed at once; each writes the `condition` block, and no claim asks again |
| S-BTN-129 expiry and asking again | an ask waits 2 days; push retries fail; a late answer; a retry | `answer` expires to `unanswered` (`question-expired`), the raiser resumes `restart: null`; the late answer `arrival-unapplied`; `email` queued; `error.no-answer` holds; the retry files a new ask |
| S-BTN-130 dynamic binding | repository and epic-scope bindings; a narrowed leg; a restart-less handler course; an unmerged binding | innermost scope, longest prefix; raise refused on the channel; `course test` refuses; inert; `baton leg why` names each |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-146 | A raise is checked and reported before effect; its handler is pushed before it returns; no subject or body is stored; legs cannot raise `baton` or `baton.*` | S-BTN-127 |
| G-BTN-147 | A `suspend` waits ≤ `min(wait_s, 900 s)`, resumes only with a restart Baton formed from its handler's end, and past the wait blocks with no failed attempt; any other end or reap of the wait blocks on the condition too, so no question is asked twice; no answer is lost; withdrawn → default | S-BTN-127, -128 |

## Retries per leg

The design: [conditions](conditions.md). Tickets: B-11.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-83 the backoff | `backoff_s` 600, `max_attempts` 5; four failures; then the owners' floor `backoff_s` 900 | 10 min ±10% after each failure; a `retry` block meanwhile; `unblocked` at `retry_after`; 15 min under the floor |
| S-BTN-84 declared interrupt conditions | non-retryable and retryable types, a plain `Error`, a type naming a prerequisite | held with `baton.retries`; backoff as `transient`; `error.type` on each end; `released:blocked` |
| S-BTN-86 owners bound the course | an owners' `max_attempts` ceiling below a course's and a `backoff_s` floor above it; a file with `coefficient`, `in_claim` or `exhausted_on` | the stricter applies, warned and shown; the retired fields refused with the file |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-105 | Backoff is a `retry` block until `retry_after`, `backoff_s` jittered ±10%, per ticket and leg | S-BTN-83 |
| G-BTN-106 | A non-retryable `interrupt` type holds at once; an untyped error is `error.transient` | S-BTN-84 |

## Timers

The design: [conditions](conditions.md). Tickets: B-61.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-134 deadlines and the stalled notice | a leg's `stalled_s` at 1 day; a `deadline_s` of 30 s and of 8 days; a file with `max_duration`, `max_ready_s`, `max_attempts_s`, `error_types`, `timers`, `after_s`, `choice`, `compensate`, `isolation`, a leg's `call`, `checks` or `retry.non_retryable` | `baton.stalled` raised after 1 day, not 3, and closed when the leg is posted `ready`; each refused naming the leg and field, previous kept |

## Calls, supersession and the cancel leg

The design: [conditions](conditions.md). Tickets: B-62, B-65.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-132 calls and completion | a call over three `review-pr` children (2 of 3 approve; `lifetime: station`); an epic `plan` call with one child withdrawn; a `spawned` end naming none; a table without a closing `{"of": "all", "closed": true}` entry; a superseded `draft-doc` ticket whose `close-pr` is released mid-run and claimed again | settles on the second approval, the third `superseded` and, `review-pr` naming no `cancel` leg, withdrawn through the outbox at once; `settleCall` agrees; the epic settles `planned` only once all closed; empty end refused; the table refused; the `draft-doc` ticket marked `cancelling` while `close-pr` runs, the second run succeeding on work already done, then withdrawn |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-150 | A call settles on the first holding entry, in table order, over its run's children, never over none; `settleCall` agrees | S-BTN-132 |
| G-BTN-153 | A superseded claim is released `superseded` in the settling transaction; a cancelled ticket is marked `cancelling`, runs its course's `cancel` leg if one leaves its station, and only then is withdrawn | S-BTN-129, -132 |

## The outbox

The design: [conditions](conditions.md). Tickets: B-64.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-136 the outbox | a superseded ticket's `withdraw` entry; no runner declaring `git`, then one; a write pushed by a deliverer whose lease lapsed; a forge-refused push; a ticket withdrawn in git before any deliverer claimed its entry; an entry undelivered 24 h; a `tickets.mjs` that never posts the withdrawal, then the condition's `retry`; a grant with no accepted grant on the repository; a runner declaring `git` alone and one declaring `source`, on a repository with an ejected ticket source; an owner's MCP key changing the policy | the ticket marked `cancelling` until the withdrawal lands; written with `baton_write: <id>`, `delivered` then `confirmed`, the ticket closed `withdrawn`; the next deliverer writes nothing and reports the head; held `outbox-refused` and `baton.outbox-late` naming the deliverer; `dropped`; `baton.outbox-late`; `baton.outbox-late` after 3 snapshots, the ticket still `cancelling`, the entry queued again by `retry`; `forbidden`; the entry offered to the `source` deliverer alone; refused, and an approver on `approvers.policy` accepted |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-156 | Baton holds no credential to write git, post a check or write a ticket store, and does each only through outbox entries runners deliver, each carrying its id and applied at most once, a ticket's entries of one class in id order; a runner with an accepted grant that declares a class claims its entries, a source entry only where the policy's `outbox.source` admits `runner`, which only an approver on `approvers.policy` changes (R-BTN-188); a `withdraw` entry is queued only after the ticket's `cancel` leg ends, and dropped when its source withdrew the ticket first; a `withdraw` or `forge-check` entry late by its kind raises `baton.outbox-late` | S-BTN-136, -81 |

## Leg events

The design: [conditions](conditions.md). Tickets: B-260.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-233 leg events (B-260) | running legs on the markdown source under `on_ticket_changed` `continue` and `restart`, and another pusher's edit to the held ticket's file, accepted by a snapshot; under `continue`, reads of the handed version, of a version that changes `repos`, of one closed `done`, of one never handed and with nothing handed, of a forged version naming another blob, on a `current` fixture source whose store moved past the handed version, and on a source with no `read`; a script registering `ctx.on` and iterating `ctx.events`, and a session polling `baton leg events`; a post observed before the claim but accepted after it; a change logged just before an `advance` and heartbeated just after; a version closed `done` mid-leg and before a leg; a `snapshot_sha` off the default branch; two edits between two heartbeats, and an edit and its revert; the leg's own push to its ticket file, an outside edit followed by the leg's own push before one sync, and a forge merge of the leg's own branch; an edit while no leg runs (between legs, and during preparation), once to the body, once to `repos`, and once with the source unable to answer; a release with reason `ticket-changed` after a handed change, after only the leg's own push, and an end naming a version no row carries; a course file with `restart` on a leg without `max_runs`; a `restart` while the leg waits on an open `hitl` condition; a context refresh after an event; two claims on one runner; a leg waiting in `baton leg await`; a claim of the `cancel` leg and a `changes` ticket whose versions change; Stop leg, Cancel, supersession, a floor, a `leg-timeout`, and a snapshot that withdraws the held ticket; a `release` and a new version in one heartbeat; a run whose `handoff` reads the queue, and one ending with events unread | the holder is rung `ticket`; the heartbeat's claim carries the new `version`, `snapshot_sha` and `last_written_by`; `ticket-changed` is logged with both versions; the leg receives `ticket.changed` once, with no ticket text, every listener gets every event, while the iterator and the session's poll share one cursor; the early-observed post is logged and handed like any other; the event after the `advance` goes to the new leg, whose `restart` end is accepted against its `ticket_version`; the `done` version hands nothing and the claim ends `done`; the off-branch sha is refused `off-branch` mid-leg and ends the claim `released:off-branch` before a leg; the handed read returns `last_written_by` first, then the body; the others are refused `bounds-changed`, `closed`, `unknown-version` (twice), `moved` (twice) and `unreadable`, and the leg goes on; under `restart` the leg is stopped at once with its hand-off, the claim ends `released:ticket-changed`, not a failed attempt, the run counted toward `max_runs`, and the next claim reads the new version; two edits are one event to the newest version, an edit and its revert none; the leg's own push raises no event, the mixed range and the merge one each; the next leg starts on the verified newest version; the `repos` edit releases `stale-board` and the unanswered source `cannot-finish:transient` before it; the release after a handed change is accepted; the one after the leg's own push is refused on the channel; the unmatched end is refused `invalid-params`; the course file is refused naming the leg; the waiting leg is blocked on its condition as R-BTN-162 says; the fresh session is handed the event again; each claim's event reaches its own leg; the awaiting leg reads the event after the await; the `cancel` leg and the `changes` ticket are handed nothing; the releases are handed as `release` with reasons `requested`, `owner-cancel`, `superseded`, `floor`, `leg-timeout` and `stale-board` before stops whose timing is unchanged, and the withdrawal logs no `ticket-changed` and ring nothing; the combined heartbeat hands only `release`; the `handoff` reads the event; the unread events are dropped |

## Checks

Tickets: B-5, B-46.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-81 a check nobody sends | a `forge-check` entry undelivered 15 min; a work key claims the check | `baton.outbox-late` with `kind: forge-check`, change pending; refused |
| S-BTN-123 a forged check | posts without confirmed ends; a moved `check.sha`; a work key, a fork, an agent's verdict against the exit status, no `exit_status`, a runner whose executor does not provide `checks:withheld-credentials`, a moved ref, a widened App; a post naming an earlier head | no `forge-check` entry, `check-unattested`; restart on the new head; refused, dropped; verdict from `exec`; refused; `missing-capability`; `stale-board`; delivery refused; the post refused `head-moved`, the command read from the branch tip |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-143 | A concluding check comes only from a confirmed check-runner end for its bound sha; no post, work key, fork or agent report yields `success` | S-BTN-123 |

## The action registry and MCP

The design: [people-and-dashboard](people-and-dashboard.md). Tickets: B-25.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-100 one registry | every surface and caller; an unregistered route, a `delegated` mark R-BTN-129's list does not give (`true` on `owner.grant.add`, `own` on `ticket.hold`), a bad id, an example that does not parse; a body mixing `hold` and `cancel` | one entry each; own actions only; `check:actions` fails each; `404`; `invalid-params` |
| S-BTN-101 the MCP endpoint | mints within and beyond what R-BTN-186 admits (an attestation, a route, `ticket.resolve`, `owner.grant.add`); a name in live use, and one a revoked key bore; protocol, batch, origin, rate and paging edges; unconfirmed and out-of-scope calls; `{hold:false}` on its own and on another's hold, and on a hold the revoked key of the same name set; a REST use | bad mints refused `invalid-params`; `conflict`, then minted; protocol errors as specified; `confirm-required`; uniform `forbidden`; its own lifted, another's `forbidden`, the dead key's `forbidden`; `rate-limited`; REST `unauthenticated` |
| S-BTN-102 one action, three ways | `leg.stop` by REST, CLI and MCP, allowed and refused | one core function, one output, `mcp:<name>`; one refusal code |
| S-BTN-103 an MCP key's life | `--ttl 120`; a new read action; idle 8 days; minter revoked; `api_keys: false`; revoke | refused; not listed; dead (`401`); `401` while off; `confirm-required`, then dead |
| S-BTN-221 the screen draws only its caller's actions | an owner's session, an administrator's and a delegated key each calling `GET /v1/actions`; with a fixture answer, the ticket page read for both sessions | the owner's answer names `ticket.hold` and never `claim.force-reap`, the administrator's both, each entry carrying `ui` and no `delegated`; the delegated key `unauthenticated`; the ticket page draws hold, cancel and stop for the owner and not force-reap, and force-reap for the administrator — its DOM half runs in B-193's `ui` project |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-120 | Every surface is a registry entry under one `authorize`; callers see only their actions; destructive actions need `confirm` everywhere; `check:actions` enforces it | S-BTN-100, -102 |
| G-BTN-121 | An MCP key reaches only its listed ids on one repository via `POST /v1/mcp`, each one R-BTN-186 admits to a delegated key, never administration, machine protocols, credentials, owner changes, attestations, routes or adopts; refusals answer alike | S-BTN-101 |
| G-BTN-122 | An MCP key's ids are fixed at minting; it dies with expiry, 7 idle days, its minter or revocation; refused while `api_keys` is `false` | S-BTN-103 |

## The repository policy's enforcement

The design: [security](security.md). Tickets: B-120, B-137, B-140, B-146, B-147, B-264.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-180 checking the forge's protection | a GitHub repository whose default-branch ruleset lets a runner's identity bypass it; then one admitting only the merge credential's identity and the human identity | `baton repo protect --check`, run by a person, names the bypass, then matches; Baton stores neither result, and no claim, guarantee or policy change reads one |
| S-BTN-181 attestations | types with `human`, `owner`, `service` and `baton` writers; a reading-gated leg (`instance: account-funds`, `where detail.balance_usd gte 50`, `binds: gate`, `missing: block`) with the policy's `readings: {account-funds: {writers: [service:<instrument>]}}`; a course type with no policy entry; a policy admitting `owner` for a type a trusted leg requires; a course adding a trusted leg that requires a type the policy admits `runner` for; a trusted leg with `missing: allow`; the funds instrument's `measure` of 60 while the instance's state is `unknown`; under `count: 2`, one instrument's `state` and `measure` readings of 60, then a second admitted instrument's 70; one writer's `measure` of 60 from ten days before and its newer `state` reading of 30 | an attestation about work from a credential that may not write one is refused; an approval bound to one head does not satisfy a merge at another (`other-subject`), and the merge at its own head changes the subject so the same approval lands nothing twice; a revoked or lapsed one blocks the leg with its `why`; the funds leg refused `failed-where` below 50, `missing` with no reading in force, offered once the instrument reports 60, still refused on a runner's reading of 60, and a reading posted for repository B's runners never moves it; the course type's leg blocked `writer-not-allowed`; the policy change refused; the course refused at its snapshot, the previous version in force; the course refused; the measure of 60 offers the leg, the state ignored; `count: 2` unmet by one writer's two readings, met once the second writer reports; the writer whose latest reading is 30 leaves the leg `failed-where` |
| S-BTN-182 trusted legs | a `merge` leg marked `trusted: true` requiring `merge:main`; a grant admitting `merge:*`, one a registration token made naming `merge:main`, an API key's grant naming it, and an SSH key's grant naming `merge:main`; a second course whose trusted leg requires `runner:merge`, one whose trusted leg requires none, and one whose trusted leg requires `credential:MERGE_TOKEN` | only the last grant is offered it, and none of the others can claim, advance or end it (rule `trusted`); the three other courses are held; a `merge.run.mjs` can refuse but not approve, and its `reasons` outside the closed list are dropped |
| S-BTN-183 what merges | under `merge.reviews {count: 2}` and `merge.trusted`, a ticket reviewed by two `reads_only` review runs at its head, by the same runner key that wrote it; two reviews carrying one run id; a review run at that head reaped mid-run; a third review run at that head that requests changes; a review from a leg not marked `reads_only` | it merges at the attested head, one key writing and reviewing being enough; the review repeated under one run id counts once; the reaped run voids nothing; after the rejection nothing merges at that head; the leg not marked `reads_only` writes no `std:review@1`; a foreign commit resets the branch and raises `baton.foreign-commit`; an unsigned commit in a reported range merges, no signature being required; a merge of main into the branch does not reset it; a push after review returns it to review; a rename, symlink or submodule into a protected path is refused |
| S-BTN-184 protected paths | under `paths.control: human` and `paths.tickets: approval`, a PR changing `.baton/`, one changing tickets, one appending own progress | the first ends at `human-merge`; the second merges only with a matching `std:approval@1`; the third merges when every entry matches the grammar and the claim, and is a ticket change otherwise |
| S-BTN-187 board posts | `attestations` entries admitting no `sync` writer for the stations and person legs a trusted leg acts on | a truncated delivery fails closed; a station a trusted leg acts on is not reached from the sync's attestation of a git verdict; a person leg's answer in git does not count and the human's attestation does |
| S-BTN-191 the protected path in practice | the `protected` preset on GitHub, `human_identity` set, `control-paths-human` floored; `paths.control` set to `any`; a handler raised; its proposal; an approval naming two proposals; an MCP key raising `merge.reviews.count` to 99; an MCP key holding a ticket, lifting its own hold, then lifting an owner's hold | the change to `paths.control: any` refused `floor-violated`; the handler written on `baton/proposed/<ticket>` from the CLI template and merged by a proposal merge with one `std:approval@1`, no reviews; the two-proposal approval covers neither; the MCP key refused; the MCP key's hold set and lifted, the owner's hold `forbidden` |
| S-BTN-195 one inbound path | a sync run attesting readiness, an arrival and an output for one ticket; a second run attesting only readiness; a run whose post is refused; under `cooperative`, an `answer:` in the ticket; a runner delivering a `withdraw` entry; an `advance` reaching `reviewed`, and the sync attesting the same arrival by a leg without `arrives: {fact: …}`; a want on a repository with a GitHub dispatch target, then on one with none; a dispatch the forge answers 500 | the ticket's readiness, arrival and output are all the first run's until the second replaces readiness alone, never a mix within one judgement; the refused run's attestations are refused with it; the sync's `std:decision@1` settles the person leg; the deliverer's `std:effect@1` marks the entry `delivered`, and the next run's attestation of the withdrawal confirms it; the advance's `std:arrival@1` by the holder moves the ticket and the sync's for that leg is recorded `arrival-unapplied`; the want is dispatched once by the host shell after commit, with an installation token minted from the App's key, and cleared by the post it causes; with no target nothing is dispatched and the runners answer the want; the failed dispatch retried once, the want standing; the same merged PR attested by two runs moves the ticket once and the second is silent; readiness attested at `reviewed` before a `fix → review` round returned the ticket to `reviewed` is discarded |
| S-BTN-196 the fact reader | under `protected`, a `create-pr` ticket at `reviewed` with `merge` queued, then a human merging its PR; a `create-spec` ticket at `requested`, then the owner's PR appearing; the same merge read twice; the reader's key not yet named, then named; a forge notification for the repository | with no key named, `baton.fact-reader-missing` is raised and nothing moves; once named, `fact-legs` lists both tickets, the reader is rung `facts`, attests `pr-merged` and `pr-opened`, and the tickets reach `merged` and `spec-open`; the second read is silent; no repository code runs on the reader's host |
| S-BTN-239 a control path changed outside a course | under `paths.control: human` with a fact reader named: a push delivery to the default branch that modifies `.baton/baton.json`, `Docs/claude.md` and `packages/x/.claude/settings.json`, nothing accounting for it, then redelivered; the same change as the human's merge of a ticket's PR, the fact reader's `pr-merged` arrival naming the delivery's head two minutes after the delivery, twenty minutes after, and before it; that merge with a commit pushed on top in the same delivery; an arrival written by `sync`, one written by a fact reader only another repository's policy names, and one for a ticket whose scope does not cover the repository; an arrival for a ticket homed elsewhere whose scope does; a merge runner's merge of a 31-commit PR, and of a branch that adds and reverts `.claude/x`, its claim ending with the merge result as `ended_at_sha` before and after the delivery comes in; the same end reported by a runner whose grant on the pushed repository is `runner`; a delivery while an unrelated trusted claim is open; a delivery changing only a ticket file, one changing only a path `imports` names, and one changing only a path `paths.protected: ["**"]` covers; a delivery of 20 control paths; a push to another branch; an owner resolving at minute 5 and at minute 20; the first delivery under `paths.control: any` | the first opens one `out-of-course` finding at once, logged, all three paths named, absent from Needs you until 15 minutes old and then reading `Emergency interactive session: …` with the pusher, the paths and the commit; the redelivery opens nothing; the prompt arrival closes its finding unlisted, the late one closes a listed finding, the early one opens none, each close `resolved_by` `baton` and logged `scope-resolved`; the commit on top, the `sync` arrival, the other repository's fact reader and the uncovered ticket account for nothing, and the covering ticket's arrival accounts; the merge runner's deliveries are accounted by `ended_at_sha` in either order, the truncated one reading `unrecorded paths` while open; the `runner` grant's end and the open trusted claim account for nothing; the ticket file, the computed path, the `**` path and the other branch open none; twenty paths store sixteen and the count 4; the early resolve is `not-found`, the late one closes it; `any` opens none; nothing is held, refused or reverted |
| S-BTN-240 unlisted repositories are the policy's | a home with no `code_repos` and a ticket naming `repos: [docs]`, written as the short name and as `owner/docs`, under `repos.unlisted: by-name` and then `none`; the same entry naming a registered repository whose own policy says `none`, and one under another owner; a home listing one entry and a ticket naming another, under `by-name`; the observation; a ticket homed elsewhere whose `repos:` entry has reach to the repository; each change with `dry_run`; `protected` applied to a stored policy without the knob | under `by-name` the list-less home's entry has reach in either spelling and no consent is asked; the `none` repository and the other owner's are not reached; under `none` it has none and the ticket raises `baton.repo-not-listed`; the listing home's unlisted entry has none under either value; the observation carries `repos_unlisted`; the dry runs name the tickets losing reach in `stops.unreached`; a stored policy without the knob reads `by-name` and every guarantee it held still holds, and the apply writes `none` |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-165 | `control-paths-human` requires control paths only a human lands, and `tickets-approved` proposed tickets written through the CLI's templates; a proposal lands only by a proposal merge with one approval; a delegated key changes no policy and loosens only what it tightened | S-BTN-191 |

## Ranking views, launch candidates and launchers

Tickets: R3-1269, R3-1235.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-19 suspend for the window | both lines limited until +2 h when `implement` ends | ranking reads `frees_at`; suspended; first in line at +2 h |
| S-BTN-27 model advice | three lines, one with spare budget near reset | `launch-candidates` serves the ranking code; a claim on another line accepted, recording the model |
| S-BTN-238 a launcher | a launcher with a machine key reading `launch-candidates` and starting two sessions hinted at one ticket; a session hinted at a ticket another runner then claims; a launched session paused past its lease; a person leg reached in a launched session; an owner reading the ticket's history | the first session's `prefer` claim is accepted and the second's lists that ticket's refusal and takes the next it is offered, or the session ends; the hinted one claims elsewhere or ends; the paused session's claim is fenced and reaped and its ticket offered again; the leg ends suspended, or raises `interact` with the session link, never waits under its claim; no launch, hint or reservation appears in Baton's state or the history |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-171 | Baton reserves nothing for a launch and records none; a launcher's hint is never a grant, and a launched session's claim is judged as any other | S-BTN-238 |

## Runners: the doorbell, a fresh context, grant acceptance

Tickets: R3-1260, B-12, B-46.

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-53 the doorbell | rings for a cancel and a follow-up; a deploy; a reap; liveness loss; bad upgrades; eviction | one ring then a trailing ring; reconnect with backoff, heartbeat delivery meanwhile; sockets closed; `unauthenticated`, `forbidden`; state recovered |
| S-BTN-88 a fresh context | `max_context: 0.6`, `max_refreshes: 1` under `builtin` and the shipped `session` and `attached` executors | `builtin` and `session` refresh under the claim, uncounted, the new session `<run_id>.r1`, then suspend; `attached` logs once |
| S-BTN-120 a grant's acceptance | a second grant; claim before accept; revoke; `accept-grant`, `decline-grant`; token keys; re-grant | `not-eligible` (rule 7); pending until accepted; decline back to pending; token keys active; re-grant pending |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-81 | The doorbell carries rings only; a lost socket changes only latency; ≤ 1 ring a second plus a trailing one; it closes on reap, re-key, revocation, liveness loss and seal | S-BTN-53 |
| G-BTN-108 | A full context refreshes under the claim at most `max_refreshes` times, uncounted, then suspends | S-BTN-88 |
| G-BTN-140 | A pending grant gives nothing until accepted; declining is logged | S-BTN-120 |

## Unbuilt parts of rows that stay in §15

These rows stay in §15, cut to what is built. Their original text follows, for the parts a
proposal page now holds: the forced Resync and the founded head (S-BTN-13, G-BTN-141), the
owner's adopt (S-BTN-18), the policy's dry run (S-BTN-197), binding
resolution (G-BTN-148), unlisted repositories (G-BTN-136) and the `out-of-course` finding
(G-BTN-172).

| Scenario | Sets up | Expects |
|---|---|---|
| S-BTN-13 board ordering | two syncs finishing out of order; a force-push of the default branch, read by the CLI sync and posted by hand; an administrator's forced Resync naming the new head, then a post of an unrelated `sha` and the CLI sync's refresh of the new head | head never moves back; the CLI sync posts nothing, releases `unfounded` and `baton.head-unfounded` is raised, and the hand-made post is `head-moved`; after the reset (`head-reset`), the unrelated post is `head-moved` and the refresh is accepted and materialized as a first snapshot |
| S-BTN-18 Baton owns the position | a suspension at `reviewed` whose named evidence never posted; a push rewriting a held ticket's frontmatter and closes to an earlier station; a human's merge on a leg declaring `arrives: {fact: …}`, and on one that does not; `adopt` with no `--at` on a course that implies a station, by a key on `approvers.policy`, by an owner key not on it under `protected`, by a granted runner's key, with `--ran review`, and during an active claim with an unconfirmed end | the suspension's position stands and it is flagged unconfirmed at 6 h; the push moves nothing, its counts unchanged, the implied station shown on the ticket's view and nothing raised; the first merge moves the ticket with a `fact-arrival` row, the second is recorded `arrival-unapplied` and raises nothing; the approver's adopt moves it with `history-adopted`, both positions and the path's `adopted` entry, the other owner key's and the runner's are `forbidden`, `--ran review` adds one `review` run toward `max_runs`, and the active claim is released and fenced first and its unconfirmed end superseded |
| S-BTN-197 the repository policy | a new repository; a new `git` repository, and `protected` applied to one with `human_identity` the hook's pusher identity; `protected` applied with `human_identity` null; the `protected` preset applied, `human_identity` set, by an owner key holding no `human_only` key, then by one with a `human_only` key; `protected-hardware` on a repository whose `human_key` is `any`; then `merge.reviews.count` raised and lowered by an owner key, by an MCP key, and by a `human_only` key under `approvers.policy: [human]`; two owners setting it from one `base_version`; from `cooperative`, an MCP key and then an owner key setting `approvers.members: [human]`; `apply protected --dry-run` on a repository with a runner delivering `source` and a queued `merge` leg; a re-apply of `protected` after the fact reader's `service:` key is named; an export and an import | the `cooperative` values; the `plain-git` values, and `protected`'s; `invalid-params` naming `human_identity`; the first apply refused, the second stored without the preset's name, every guarantee but `human-gates` held; `protected-hardware` refused until a `human_only` key meeting `hardware` owns the repository, then `human-gates` held; the owner key's changes `forbidden` both ways, the MCP key's refused (a delegated key changes no policy), the human key's accepted and logged with `changed`; the second `conflict`; the MCP key refused, the owner key's accepted; the dry run names the deliverer and the leg it would stop and writes nothing; the re-apply keeps the named key and raises no `baton.fact-reader-missing`; the import keeps every version and refuses a broken chain |

| Gate | Must hold | Proved by |
|---|---|---|
| G-BTN-141 | A rewritten default branch is adopted only by an administrator's forced Resync, never by a post, whoever posted it; a lagging fetch posts nothing; an unfounded head raises `baton.head-unfounded`; a reset drops the tickets the new head lacks with their owner state kept | S-BTN-13, -121 |
| G-BTN-148 | Resolution is innermost scope, then repository, longest prefix; `suspend` binds only to courses that end by a person's leg or its expiry; unmerged bindings and bindings of `baton.*` are inert | S-BTN-130, -131 |
| G-BTN-136 | Reach beyond the home is `code_repos`, and by name only for a home that lists none under `repos.unlisted: by-name`; patterns follow the grammar; input digests are verified before a leg runs | S-BTN-116, -238 |
| G-BTN-172 | Baton, the sync and the runners verify no commit signature, and no board post or claim answer carries a signature record or a brief mark; who landed a ticket's last change is the forge's pusher record alone, its `human` decided once against the policy then in force; while a policy protects control paths, a default-branch push that changes a path the floor names outright, or is recorded truncated, and whose head neither a trusted leg's reported end nor a named fact reader's `pr-merged` arrival names, is an `out-of-course` finding, one per head, listed after 15 minutes, that refuses and holds nothing | S-BTN-220, -237 |
