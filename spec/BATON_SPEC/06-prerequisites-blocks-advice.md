---
title: "6. Prerequisites, blocks and advice"
description: "A leg starts when its prerequisites hold."
---
## 6. Prerequisites, blocks and advice *(partly built — B-7, B-10, B-21, B-41, R3-1259, R3-1269)*

A leg starts when its prerequisites hold. Baton stores each unmet one as a block, answers "why
not" from that index, gates claims on the blocks safety needs, and advises on the rest.

### 6.1 Prerequisites

- **R-BTN-120 / R-BTN-132 (a leg's prerequisites, one way in for each kind).** A leg can start
  when every prerequisite holds. Each kind has exactly one way in:

  | Kind | Declared by | Holds when | Unmet, it is |
  |---|---|---|---|
  | station | the leg's `from` (R-BTN-69) | the ticket is at one of them | nothing: only legs leaving the ticket's station are offered |
  | ticket | the leg's `requires.tickets`; the ticket's posted `depends_at` | the selected tickets are where the entry says | a `ticket` block |
  | capability | the leg's `requires.capabilities`; the ticket's posted `requires` clause (every leg) | the runner declares each and is granted it (rule 4, R-BTN-174) | a `capability` block |
  | resource | the leg's `requires.resources`; the sync's posted `needs`; a `blocked` end | a usable instance is not `unavailable` (R-BTN-76) | a `resource` block: advice, unless the requirement binds as a gate (R-BTN-181) |
  | retry | the leg's `retry` policy (R-BTN-122) | `retry_after` has passed | a `retry` block |
  | condition | a `suspend` raise past its wait (R-BTN-162) | the handler closes, or an owner resolves it | a `condition` block |
  | attestation | the leg's `requires.attestations` (R-BTN-181, proposal) | an unlapsed, unrevoked attestation of the type, from a writer the requirement names, binds the subject and meets `where` | an `attestation` block: a gate, unless the requirement binds as advice |
  | call | a `kind: call` leg's run (R-BTN-165) | the call settles | a `call` block |
  | time | `not_before` (R-BTN-89) | Baton's clock passes it | a stored `waiting` state, not a block |

  ```json
  "deploy": { "from": ["approved"], "to": "deployed",
    "requires": {
      "tickets":      [{ "select": "parent", "reached": ["planned"] }],
      "capabilities": ["deployer", "db:orders:rw"],
      "resources":    ["llm:deepseek-v4-flash"] } }
  ```

  - **Ticket entries.** `select` is `parent` (optional `course`, else the leg's own) or
    `posted` (the ticket's posted `depends_at: [{ticket, at | reached | done, leg?}]`; `leg`
    binds one leg of this ticket, absent every leg); the validator refuses any other `select`.
    The children a call leg's run spawned are its completion table's range, never a
    `requires.tickets` entry (R-BTN-165). Each entry has exactly one of `at: [<station>…]` (a
    selected ticket is at one now), `reached: [<station>…]` (its path contains one), `"done":
    true` (closed `done` at any end station, kept as `closed_tickets.final_station` and
    `final_path`), `"withdrawn": true` or `"closed": true` (closed either way). A withdrawn ticket meets only `withdrawn` and
    `closed`; `"skip_withdrawn": true` drops it from the selection instead. An empty selection holds only with `"allow_empty": true`. Entries select
    tickets of the same repository (R-BTN-86); Baton evaluates them from the stations and paths
    it stores. `baton course test` checks that each named station exists in the selectable
    course.
  - **The ticket source decides which dependencies are open** and posts only those; Baton keeps
    no second dependency store. The default markdown source translates `depends_on: [<id>]` to
    `{ticket: <id>, done: true, leg: <start_leg>}`. `parent` is a link, never a block; a leg
    that waits for children it starts is a call leg (R-BTN-165).
  - **Unmeetable entries fail closed.** A `parent` entry with no parent, a `posted` id Baton
    has not seen, or an entry a withdrawn ticket leaves unmet keeps its block and raises
    `baton.prerequisite-unmet`. When an accepted snapshot's ticket prerequisites form a cycle
    (selected tickets as edges), Baton keeps every block and raises `baton.prerequisite-cycle`
    naming the tickets.
  - **Capabilities** are stored expanded through R-BTN-121's `capability_roles`; no role name is
    stored. `human-operator` is an ordinary capability in `ticket_requires`, checked by rule 4,
    which a runner declares and a grant admits (R-BTN-121); a source translates its own words for it
    (docs' `OP` tag) into the clause.
  - **Pairs that join.** The ticket's clause and a leg's `requires.capabilities` join for that
    leg; the posted `needs` and a leg's `requires.resources` join. A station's `entry`
    (R-BTN-109) checks an arrival's outputs, not whether a leg may start.
  - **`waiting_on`** names only a wait no kind covers (an author's push, CI's `short_waits`, a
    forge effect), shown under `other`. The snapshot validator refuses `dependencies`,
    `children`, `owner` and `policy`, naming the ticket. Baton stores a posted label prefixed
    `course:` and reserves `time`, `not-before-invalid`, `input-missing`, `input-version`,
    `course-changed`, and `policy` for an unmet required bar (R-BTN-67).
  - **Why a leg cannot start.** `GET
    /v1/repositories/{repository}/tickets/{ticket}/prerequisites[?leg=<leg>][&runner=me]`
    (default the queued leg) and `baton leg why <ticket> [<leg>]` return `{leg, ready,
    prerequisites: [{kind, ref, met, why, since?, until?, url?, found?}]}`, every prerequisite
    met or not, `end`-sourced resource needs included:

    | Kind | `why` when unmet |
    |---|---|
    | station | `not-at`, with where the ticket is |
    | ticket | `not-at`, `not-reached`, `not-done`, `not-closed` (with where the other ticket is), `withdrawn`, `no-parent`, `unknown-ticket` |
    | capability | `no-live-runner`; with `runner=me`, `not-declared` or `not-granted` (R-BTN-174); `full`, read from the seats (`claim_seats`), with the claims holding them where the asker may see them (R-BTN-178) |
    | resource | `unavailable`, with `until` |
    | retry | `backing-off`, with `until` and `attempt: <n> of <max>` |
    | condition | `open`, with the handler ticket, or the claim's `condition-wait` activity |
    | call | `open`, with the run's children |
    | attestation | `missing`, `other-subject` (one exists for another commit), `writer-not-allowed`, `lapsed`, `revoked`, `failed-where` |
    | `other` | a hold and its `hold_reason`; a `waiting_on` label; `time` with `not_before`; a queued person leg with its question (R-BTN-116); owner bars on every live runner's tags; an unconfirmed end (R-BTN-10) |

    It reads the blocks index and, for `runner=me`, rule 4 for that runner, and for `full`
    `claim_seats` and `capability_capacity`, never the board. A
    runner key granted on the repository, its owners and a dashboard session may ask; the
    dashboard's **Ready** (§11) shows it for a ticket no runner is eligible for.

### 6.2 Blocks

- **R-BTN-75 (blocks are stored, not recomputed).** A block is one unmet prerequisite, a row of
  `ticket_blocks` (repository, ticket, leg or `''` for the whole ticket, `kind`, `ref`, `since`,
  `until`, `found`, `provisional`, `binds`) written in the transaction that causes it, so asking reads one
  repository-scoped index. This is the one list of block kinds:

  | Kind | `ref` | On | Written | Binds |
  |---|---|---|---|---|
  | `ticket` | `<ticket>@at:<station>,…`, `@reached:…`, `@done`, `@withdrawn` or `@closed` | its leg; the whole ticket for a `depends_at` without `leg` | rewritten when a referenced ticket's station or path, or an entry's selection, changes (index `ticket_dependents`) | refuses a claim and an advance (rule 1) |
  | `capability` | the capability | its leg, or the whole ticket for the clause | when the fleet count crosses zero | refuses each runner lacking it (rule 4) |
  | `resource` | the resource; `until` the first instance back | its leg | when the fleet counts flip (R-BTN-76) | advice; refuses a claim and an advance (rule 1) where its requirement binds as a gate (R-BTN-181) |
  | `retry` | the leg; `until` = `retry_after` | its leg | by a failed attempt (R-BTN-122) | refuses a claim and an advance (rule 10) |
  | `condition` | the `condition_id` | its leg | by a `blocked` end (R-BTN-162) | refuses a claim and an advance (rule 1) |
  | `call` | the run's `claim_legs` row `id` | its leg | by a `blocked` end (R-BTN-165) | refuses a claim and an advance (rule 1) |
  | `attestation` | the requirement's `type` | its leg | when an attestation it reads is posted, revoked or lapses, or the leg's requirement changes (R-BTN-181) | refuses a claim and an advance (rule 1) where its requirement binds as a gate; advice otherwise |

  - **Held and blocked.** A ticket is **held** while it has an active claim, a completed claim
    not yet confirmed, or a fence-pending reap (rule 3's claim checks; R-BTN-79 uses the same
    definition). It is **blocked** when not held and it has a whole-ticket row or a row on its
    queued leg (R-BTN-83); rows on other legs do not block, and a ticket with no queued leg is
    not blocked. Baton evaluates this once per transaction, after the last row change and any
    owed `unblocked` (R-BTN-77), into `tickets.blocked_since`.
  - **Provisional rows.** A `ticket` or `condition` row written by a `blocked` end
    carries `provisional` = the commit that wrote its fact to git. It refuses a claim and an
    advance into its leg and keeps the leg out of recommendations, but does not count toward
    `blocked_since` (writing or dropping it is no transition). The first accepted snapshot whose
    head contains the commit (the observation response's `provisional`, §4.3) replaces it with what it
    shows; a row not so confirmed within 1 hour, or not shown, is dropped and logged
    `prerequisite-unconfirmed`.
  - **Not blocks.** `other` lists what else keeps a ticket from being offered: a hold (§6.8), a
    `waiting_on` label, a `time` wait, a queued person leg (R-BTN-116), owner bars on every live runner's tags (R-BTN-67), an
    unconfirmed end (R-BTN-10), `no-instance` (R-BTN-76). Core's `baton.retries`,
    `baton.contract` and `baton.stalled` (R-BTN-163) write no row: a hold or the posted wait
    already keeps the ticket.
  - **Capability rows follow a count.** `fleet_capabilities` counts, per (repository,
    capability), live runners that declare and are granted it (R-BTN-174) (a
    `runner:` capability needs the declaration only, R-BTN-133). It changes when a runner
    registers, changes its declarations, stops being live or is reaped, and when a grant is
    made, changed or revoked, for the capabilities it declares. Rows are rewritten only when a
    count crosses zero, for the tickets
    requiring it (`ticket_requires`, and queued legs whose list names it); a snapshot writing a
    ticket's `ticket_requires` writes its rows in the same transaction. A ticket blocked 24
    hours on a capability no live runner has raises `baton.capability-missing`. One runner's
    answer is rule 4, computed on the spot.
  - Rows and the messages they cause count against the write budget (§2).

- **R-BTN-77 (blocked and unblocked are events; unblocking wakes work).**
  - Setting `blocked_since` logs `blocked`; clearing it other than by a claim starting logs
    `unblocked` `{ticket, cleared: [{kind, ref}]}`, the rows whose removal cleared it, in the
    same transaction. A claim's end is never an unblocking; an end leaving the ticket blocked
    (a backoff it starts, a dependency found while held) logs `blocked`, which wakes no one.
    Every `unblocked` follows a `blocked`.
  - **A lost answer is not an unblocking.** A `resource` row that goes because the repository has
    no live granted runner or no usable instance of the resource left (R-BTN-76) clears
    `blocked_since` silently. So does a transition
    whose cleared rows include a lost one on the queued leg, whatever else the same transaction
    cleared (a capability the same recount brings back, a dependency the same post closes);
    only the lost rows are kept, and a lost row is never named in an `unblocked`'s `cleared`.
    A lost row on another next leg never blocked the ticket and silences nothing. The ticket
    keeps the lost rows and `blocked_since` in `tickets.answer_lost` until each settles (need gone, or the
    fleet able to answer). Then, if the ticket is unblocked, unheld and has a queued leg, Baton
    logs the owed `unblocked` with its message and trigger; if it is blocked only on rows it
    lost, Baton rewrites them silently with the original `blocked_since`. Any `blocked` or
    `unblocked` logged meanwhile ends the record; a new block is preceded by the owed
    `unblocked`, logged only.
  - **On `unblocked`** Baton queues, for each live idle runner granted on the repository that the
    ticket would now pass the gates for, one `unblocked` message (§6.9), updated in place while
    pending, at most 20 tickets (oldest dropped), expired by the alarm when the runner stops
    being live; an idle `baton runner start` then asks for recommendations (R-BTN-72). Baton
    also dispatches the repository's `unblocked_trigger` (R-BTN-94) when set — a workflow under
    `.github/workflows/` through the App, or a GitLab or Gitea target (R-BTN-94); none
    on plain `git` — with one input `tickets`, a JSON array of `{ticket, cleared}`, one
    dispatch per 30 seconds per repository plus a trailing one, at most 100 entries then
    `{truncated: n}`. Every id and `ref` in it has passed §12.3's untrusted-text rules; a workflow
    reads it with `fromJSON(inputs.tickets)` into an environment variable, never into `run:`.

- **R-BTN-126 (a prerequisite that fails during a leg blocks that leg's edge).** The ticket stays
  at the station the leg leaves; no station is added.
  - **The end.** The runner pushes the work so far, `handoff` writes the hand-off (R-BTN-44), and
    the claim ends **`released:blocked`** with `prerequisite: {kind, ref}`. In that transaction:
    - `resource` — `ref` a registered resource, optionally with `reading: {instance, available:
      false, until?, valid_for?, detail?}` for an instance serving `ref` that the runner may
      report on. Baton stores the reading as the runner's (R-BTN-76), adds `(ticket, leg, ref)`
      to `leg_needs` with source `end` if the posted needs lack it, stamps the need's
      `found_at`, then writes the `resource` row against the counts — so the leg is blocked once
      every one of the repository's usable instances of `ref` is `unavailable`, for every runner
      alike. A reading failing its envelope, bounds or one-a-minute limit is
      dropped and logged `reading-refused`; the end stands. An `end`-sourced need and its row go
      when the leg next ends other than `blocked` on that resource, or after 7 days, and posts
      never remove it; the `found_at` stamp clears at that same end.
    - `capability` — `ref` a capability the runner declared and says it lost (R-BTN-174). This
      is the runner's own statement, never checked. Baton removes it from the runner's declared set
      and updates `fleet_capabilities` in the same transaction, so rule 4 refuses this runner at
      once. The runner declares it again
      once its check passes (R-BTN-121).
    - `ticket` (`ref` in R-BTN-75's form, same repository) — the leg writes the `depends_at`
      entry to git first and the end carries `commit`; Baton writes a provisional row.
    - `condition` and `call` — per R-BTN-162 and R-BTN-165.
  - **Invalid.** A bad kind or `ref`, a capability the `capability` bullet does not admit, a reading for an instance
    not serving `ref` or not reportable, or a `ticket` end without `commit`: Baton
    records `released:cannot-finish:transient` (a failed attempt) in the same transaction and
    answers `invalid-prerequisite`. The runner makes the same checks first.
  - **Bounded, not failed.** A valid `blocked` end is not a failed attempt, not a run for
    `max_runs` (R-BTN-69), and starts no backoff. Baton counts them per (ticket, leg) from
    `claims.blocked_kind` and `blocked_ref`, `call` ends excepted. Past `max_blocked` — 5 within
    24 hours, a constant of this specification, not a setting (R-BTN-122) — the next one holds
    the ticket (`hold_reason: blocked-exhausted`) and raises `baton.retries` listing each end's
    prerequisite. A runner with more than 20 blocked ends across tickets in 24 hours raises
    `baton.blocked-ends`.
  - **How a leg says so.** A script throws `LegError(type, message, {prerequisite, reading?,
    commit?})`; a session sends `baton leg release --blocked --kind <kind> --ref <ref>
    [--instance <i>] [--until <RFC 3339>] [--valid-for <s>] [--detail <json>] [--commit <sha>]`
    on the local channel (R-BTN-106). An error naming a prerequisite is a block, never a retry,
    and the runner never waits in the claim for a prerequisite to return.
  - **`found`.** A row a `blocked` end writes is `during-run`, as is every `resource` row for a
    need carrying `found_at`; every other row, including one present at the claim's start, is
    `before-start`.
  - **Drawn as an edge.** Every course view (**Courses**, a ticket's path, `baton leg why`)
    draws each leg as an edge in one state — `ready`, `running`, `blocked` (each unmet
    prerequisite's kind, `since`, `until`, `found`), `backing-off` or `not-queued` — never as a
    station, in colour and a text label (§11), from the blocks index and `leg_needs`.

- **Asking about blocks** (R-BTN-75).
  - `GET /v1/repositories/{repository}/tickets/{ticket}/blocks[?runner=me]` → `{blocked,
    blocks: [{kind, leg?, ref, since, until?, found}], other}`; `runner=me` makes `capability`
    blocks the asking runner's; a `resource` block is the same for every runner (R-BTN-76).
  - `GET /v1/repositories/{repository}/blocked?on=<kind>:<ref>[&transitive=1]`, `kind` one of
    `ticket`, `resource`, `capability` → the tickets blocked
    on it with their blocks; with no `on`, every blocked ticket grouped by kind and `ref`, 100
    per page with a cursor. `transitive=1` follows `ticket` blocks up to 5 levels.
  - Any key granted on the repository, its owners and administrators may ask; CLI `baton
    ticket blocked <ticket>` and `baton ticket blocked --on <kind>:<ref>`.
  - **Cost.** `blocks` reads `blocked_since` and the ticket's rows by primary key; `other` adds
    primary-key reads of its overrides, next legs and claims; `runner=me` adds the runner's
    grant and declarations; `blocked?on=` reads `blocks_by_ref` and the matched
    tickets' `blocked_since`; the unfiltered form reads `tickets_blocked`, paged; `transitive`
    repeats per level. The harness asserts these plans.

### 6.3 External resources and readings

- **R-BTN-76 / R-BTN-101 / R-BTN-151 (external resources, their instances and readings).** A
  resource is anything outside Baton a leg can be blocked on: a provider's capacity, an API's
  rate limit, disk on a shared server. A **reading** is an attestation about one of its instances
  (R-BTN-181): R-BTN-181's writers, authentication, supersession and requirements apply, and this
  rule adds what is particular to resources. A reading's `type` is its resource's schema id and its
  value is `{available?, until?, detail}`, so a requirement's `where` reads `available` or
  `detail.<path>`. Like every attestation it is authenticated by the request that posts it and
  carries no signature of its own. Readings are stored once per tenant; a repository reads only
  those its policy's `readings` entry admits (R-BTN-188). A full requirement on an instance
  (R-BTN-181) ignores the instance's state: for each usable instance and each admitted writer's
  key, that writer's latest observed reading in force there, of either kind, is one attestation,
  `where` testing its value — an older reading of the same writer never counts; `missing` means
  there is none; and `count` counts the distinct writers' keys whose attestation passes, unless
  `distinct` names another field. `requires.resources`, its
  short form, holds while the instance's state (below), computed from the admitted readings
  alone, is not `unavailable`, `unknown` blocking only under `missing: block`.
  - **Registered** by an administrator: `baton admin resource add <name> --scope
    account|service --schema <file>` (R-BTN-127), `name` matching `^[a-z][a-z0-9:._/-]{0,79}$`,
    the schema (R-BTN-108's subset) its readings' `detail` must satisfy. The schema may name a
    `std:` schema, and only a `std:` schema, as its `x-baton-base`; registration refuses a
    refinement R-BTN-108's check cannot prove. Core compares names and reads the envelope;
    `detail` means what the course says.
  - **Instances.** `service`: one, itself. `account`: one per account, registered by an
    administrator with every resource it serves (`instance_serves`) and the repositories whose
    runners may use it; its resources share one `detail` schema, and one reading of it is the
    state of each; one listing several repositories takes only resources whose schema holds
    numbers, booleans and `enum` strings. Instances and readings are one tenant's (R-BTN-137) and
    seen by all its repositories. A repository's **usable** instances of R are the `service`
    instance and the account instances that serve R and list the repository; every runner
    granted there has the same ones. What a single runner can reach — its own subscription, a
    device on its host — is its own business: it declares a capability for it (R-BTN-121), and a
    leg that finds it spent ends `released:blocked` on that `capability` (R-BTN-126), which the
    runner's check must then fail until the line recovers — otherwise the leg comes straight back
    to it — or the runner suspends on what it reads (R-BTN-40).
  - **Who reports.** A runner credential (machine key or API key, R-BTN-117), `POST
    /v1/runner/readings`: any account instance listing a repository its key is granted on —
    sharing an account trusts every listed repository's runners. An instrument key (`POST
    /v1/admin/probes`, with a label), `POST /v1/probe/readings`: any registered instance. An
    administrator, `baton admin reading set <instance> …` (R-BTN-127), `POST /v1/admin/readings`:
    any registered instance, as one more instrument, writer class `admin` (R-BTN-181).
  - **Readings** name their `detail`'s schema (≤ 4 KB, R-BTN-108's validator). A `state`
    reading `{instance, available, until?, valid_for, detail?}` has `valid_for` ≤ 24 hours
    (default 1 hour) and `until` no later than its end; an unavailable reading with `until`
    lapses at the earlier of the two. A runner posts one on meeting a limit (the reset as
    `until`) and on succeeding after one. A `measure` reading carries `detail` only, `valid_for`
    ≤ 31 days, and never affects state. A runner session posts at most one reading per instance
    a minute.
  - **Kept per instrument** (R-BTN-181's supersession). Per instance: the latest reading of each
    instrument — an administrator, a runner session by its `runners` row, or an instrument key —
    each lapsing on its own; at most 8 instruments per credential, a ninth replacing that
    credential's oldest. All readings in force are served (R-BTN-99); core never sums them.
  - **State**: the most recently observed `state` reading in force, else `unknown`. `unknown`
    blocks only a requirement with `missing: block` (R-BTN-181); otherwise advice fails open.
    Each change is a `resource` event. An instance `unknown` 24 hours while a posted leg needs it
    raises `baton.resource-unknown`.
  - **Clearing.** `POST /v1/admin/readings {instance, clear: {source?}}` ends readings of both
    kinds from one instrument or all, logged.
  - **Needs** — posted `needs`, a leg's `requires.resources`, `end`-sourced needs — are stored in
    `leg_needs`; an invalid or unregistered name is logged and blocks nothing.
  - **Blocked** when at least one live runner is granted on the repository, the repository has a
    usable instance of R, and every one is `unavailable`. With no live granted runner, or no
    usable instance, no row is written and `other` lists `no-instance`. `resource_fleet` keeps,
    per (repository, resource), the usable instances and how many are not `unavailable`, changed
    by an instance's state, by a resource or instance registered or changing what it serves or
    lists, and by the repository's first live granted runner arriving or its last leaving. Rows
    are rewritten for exactly the tickets whose legs need R, only when the answer flips; a
    snapshot writing `leg_needs` writes that ticket's rows in the same transaction. A row binds
    as its requirement says (R-BTN-181): advice by default, a gate where the course's
    requirement binds `gate`; under `missing: block` an `unknown` instance counts as
    `unavailable` for that requirement.
### 6.4 People

A person is reached one way: a **person's leg**, a leg of the course that no runner may run and
that arrives when a person answers it with a `std:decision@1` (R-BTN-116). A question a running
leg asks is a `hitl` condition whose handler course asks it through a person's leg (R-BTN-161,
R-BTN-169); a decision a ticket source records in its own form is the question of a person's leg
its course already has. Baton's own conditions are answered on their resolve page (R-BTN-163).

- **R-BTN-116 (a person's leg: the one way a course waits on a person).** A leg may be `"kind":
  "person"` with `"asks": <label>` (who answers; matches `^[a-z][a-z0-9-]{0,31}$`). No runner is
  offered it or may claim or advance into it (rule `person`), and no claim ever runs it: the ticket
  waits unheld while it is queued, and the leg may also arrive while another leg is queued
  (R-BTN-39), so a person's answer counts while a runner's leg waits.
  - **The question.** A queued person's leg is listed under **Needs you** from the moment it is
    queued (R-BTN-163). While it is queued, the ticket source may post its **question** with the
    ticket (§4.4): `{id, url?, severity?, options?: [{id, reached}]}` — an id for the question (the
    decision-id rule, §12.3: `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`, not beginning `baton.`), where
    git holds its text (`url`, under R-BTN-92's link rule for a repository with reach, R-BTN-140),
    its severity (R-BTN-125) and its options, each naming the outcome in the leg's `to` it
    chooses. A docs `## Decision needed` packet becomes the question of the person leg its course
    places there, its letters the options. **The options when none are posted:** for the person
    leg of a handler ticket (R-BTN-161), the condition's `restarts`, which Baton holds, each
    reaching the leg's first listed outcome; for any other leg, each outcome under its own name.
    Baton stores the question in `ticket_questions`, logs `question-posted` once per id, and shows
    it on the leg's Needs-you entry; a question posted for a ticket whose queued leg is not a
    person's is dropped and logged `question-dropped`.
  - **The answer** is a `std:decision@1` attestation (R-BTN-191), `{id, leg, option, reached,
    ref?, answered_by?, commit?}`: `leg` a `kind: person` leg leaving Baton's station, `option` one
    of its options as the paragraph above defines them, `reached` the outcome that option names,
    `id` the question's when one is posted. It is written by the person — `baton decision answer`
    (R-BTN-127) or the dashboard's Needs-you entry (R-BTN-181), the latter only where the policy's
    `attestations` entry for `std:decision@1` admits `owner`, a session's writer (R-BTN-185);
    never by a delegated key, which answers no person's leg (R-BTN-186, R-BTN-130) — or attested
    by the sync from the answer the ticket shows (the markdown source's `answer:`
    field, R-BTN-74), where the policy's `attestations` entry for `std:decision@1` admits `sync`;
    under `protected` it admits `human` alone, so an answer in git does not count there
    (R-BTN-191). An answer naming a leg that is not a person's, an `option` the leg does not offer,
    a `reached` other than the option's, or an `id` other than the posted question's is refused
    `invalid-params`; the sync's is dropped and logged `answer-invalid`.
  - **Applied as an arrival.** The accepted answer is the leg's arrival under R-BTN-39's rules
    (writer admitted, the leg leaving Baton's station, the ticket not held, the `ref` new); it
    may carry a value or refinement the station reached requires (R-BTN-109). The applied answer
    is the leg's output `answer` (R-BTN-82), recorded with no claim, which a later leg may declare
    as an input, `required: false` where a route can skip the person leg. Baton logs
    `question-answered` with the option and `answered_by`, and the question is closed.
  - **Expiry.** A person's leg may carry `"expires": {"after_s": <n>, "reached": <outcome>}`
    (60 s–30 d). The instant is set when the person leg becomes the queued leg — at the ticket's
    arrival at the station, a new ticket's placement at `start` included, or at a route that queues
    it (R-BTN-83) — that moment, by Baton's clock, plus `after_s`, and held in `ticket_timers`
    (R-BTN-167); a person leg that is not the queued leg has no instant, and a route that queues another
    leg clears it. It restarts only when the ticket's station changes, so a Baton move keeps it (R-BTN-88). At the instant, if the leg is
    still queued and unanswered, Baton applies the arrival at `reached` itself (`next_source:
    baton`, R-BTN-83) under R-BTN-39's rules — deferred while a claim is active or Baton holds the
    ticket, applied when the hold ends — and logs `question-expired`; an answer attested after the
    expiry applied is unapplied (R-BTN-39). A course that wants a grace period adds it to `after_s`.
    A person leg has no `stalled_s`: its `expires` is its clock (R-BTN-167). The standard `ask`
    course expires its question this way (R-BTN-169).
  - A leg never waits on a delivery, only on an effect: an answer attested in Baton, an answer in
    git the sync reads, or a forge effect (R-BTN-114). How a person learns of the question is a
    delivery runner's (R-BTN-163) or a handler course's (R-BTN-161), never core's.
  - **Who can answer.** Whoever can push can write an answer in git, so under `cooperative` the
    answer binds as git does (R-BTN-66); under `protected` only a `human` key's attestation
    counts, and the dashboard prepares what the CLI signs (R-BTN-185).
### 6.5 Waiting for a time

- **R-BTN-89 (a queued leg may wait for a time).** A queued leg may carry `not_before`, an
  instant before which it is not offered.
  - **From git.** After a leg, its closing marker's `not_before=` (from the result's
    `not_before?`, R-BTN-72), posted by `locate` with the ticket as `not_before` (§4.4); the runner
    also reports `not_before?` on a suspending or releasing `end`, so the provisional queued leg
    waits at once. For a ticket at `start` with an empty path, the ticket file's
    `tickets[].not_before` (R-BTN-74) applies when the station posts none. Baton never computes
    one; a schedule is the leg script's. `@immediately-run/baton/leg` exports `nextFire(cron,
    tz, after)`, `writeSuccessor` and `NOT_BEFORE_HORIZON_DAYS` (400), the constant
    `src/core/validate.ts` imports.
  - **Validated, failing closed.** RFC 3339 with `Z` or a numeric offset, at most 400 days after
    `now` (R-BTN-32) at acceptance. A failing value is logged `not-before-invalid`; a leg posted
    `ready` is stored `waiting` on `not-before-invalid` and raises `baton.not-before-invalid`
    until git is valid; a leg posted `waiting` on another label keeps it; no snapshot is
    refused. A value at or before `now` is stored NULL. `nextFire` and `writeSuccessor` refuse
    an instant past the horizon, failing the leg `cannot-finish:spec`.
  - **Stored.** The queued leg is stored `waiting` on `time` exactly when posted `ready` and
    `now < not_before`; a posted `waiting` on another label wins, `not_before` kept beside it.
    Re-applied in every transaction writing `ticket_next_legs` and by the alarm, which at
    `not_before` sets the leg `ready` with `ready_since = not_before` and clears `not_before` (a
    later post of that past instant stores NULL and keeps `ready_since`). Index
    `ticket_next_legs_due` (`state = 'waiting' AND waiting_on = 'time'`). A `time` wait raises
    no condition; the dashboard shows "waiting until …" and lists pending waits on **Courses**.
  - **Offered at the instant.** Recommendations leave a `time` wait out and rule 1 refuses its
    claim. Claim, heartbeat and advance responses carry each next leg's `not_before`; the runner
    suspends unless it is within 30 minutes, then waits under the claim. The alarm wakes at the
    earliest pending instant (§2); at `not_before` Baton queues R-BTN-77's `unblocked` message
    with `cleared: [{kind: "time", ref: <not_before>}]` and rings it, but calls no trigger.
  - **Recurring jobs: a series.** A series is a ticket (the CLI's default course `series`:
    stations `active`, `retired`, leg `retire`) whose children are its runs, each an ordinary
    ticket on the job's course naming the series as `parent`, with `run: <n>` (first 1) and
    `not_before`. The run's last leg calls `writeSuccessor(ctx, {schedule})`, which writes
    `<series>-<n+1>` on the default branch in a commit at or before the one closing the run —
    nothing if that file exists naming this series and `run: n+1`; a foreign file at that id or
    an id the ticket-id rule refuses fails the leg `cannot-finish:spec`. The successor's
    `depends_on` names the run, so it waits for it to close `done`; its `not_before` is the next
    fire after the run's own, or after now if that has passed. Runs never overlap; missed fires
    are not replayed. A withdrawn run leaves its successor `baton.prerequisite-unmet` until an
    owner withdraws it or removes the dependency. A series stops when its pending run is
    withdrawn and the series retired, or the pending run held (§6.8).

### 6.6 Matching: gates and advice

Baton recommends and the runner decides (R-BTN-45): a gate refuses a claim or advance; advice
never refuses, and acting against it is accepted and recorded `advice-overridden`.

- **The gates.** Rule numbers are stable (code cites them); 12 is unused. A refusal is
  the code shown, else `not-eligible` with `rule` and `rule_code`.

  | Rule | Holds when | At | Refusal |
  |---|---|---|---|
  | 1 | Claim: the queued leg (R-BTN-83, or a route override) is `ready` as posted (R-BTN-70; a `cancel` leg Baton queued is `ready`, R-BTN-168), a snapshot was accepted after the ticket's last end (R-BTN-10), and no `ticket`, `condition` or `call` row, nor a `resource` or `attestation` row binding as a gate (R-BTN-181), is on that leg or the whole ticket. Advance: the new leg is an edge from the claim's station within its run limit and not the course's `cancel` leg (R-BTN-63; `cancel-leg`), with no `ticket`, `condition` or `call` row on it, nor a `resource` or `attestation` row binding as a gate, and no whole-ticket `ticket` row | claim, advance | `blocked` with the blocks; else rule 1 (`not-ready`, or R-BTN-63's codes) |
  | 2 | *(advice)* expedite lane: while 2 active claims hold expedited tickets, other expedited tickets lose their expedite place and carry `expedite-bound` | — | — |
  | 3 | No other active, completed-unconfirmed (not superseded, R-BTN-168) or fence-pending claim on the ticket; no hold (§6.8); not `cancelling`, which refuses every leg but the ticket's queued `cancel` leg (R-BTN-168) | claim; advance: hold and cancellation only | `claimed`, `held` |
  | 4 | `capabilitiesOf(ticket.requires ∪ leg.requires.capabilities) ⊆ declared ∩ grant(repository)`, matched by name (R-BTN-174); `runner:` counts once declared (R-BTN-133); no clause is met by all | claim, advance | `missing-capability` |
  | 5 | Tier at or below the runner's ceiling: the position in the repository's `tiers` of the lower of its declared ceiling and grant `max_tier`; untiered fits only the top | claim, advance | `above-tier-ceiling` |
  | 6 | *(retired: `human-operator` is a runner's own statement, checked by rule 4 like any capability, R-BTN-121)* | — | — |
  | 7 | The key holds a grant for the ticket's repository (R-BTN-58) | claim, advance | `not-granted` |
  | 8 | Tags meet none of the leg's posted barred tags, the owner bars in force for its course or `*` (at an advance those with `applies: claim+advance`) and, at an advance, the holder's `bars`; required bars met by posted bars joined with the holder's `bars` (R-BTN-60, R-BTN-67) | claim, advance | `barred-tag`; rule 8 `policy` |
  | 9 | The runner declares the course at `min_runner_version` or later (R-BTN-22, R-BTN-65); not re-checked at an advance | claim | `stale-skills` |
  | 10 | No `retry` block on the leg | claim, advance | `backing-off` with `until` |
  | 11 | Every capability with a capacity in rule 4's set for the leg (the ticket's `requires` and the leg's) has a seat no other claim holds (R-BTN-178) | claim, advance | `capacity-full`, naming the holders where the caller may see them |
  | 13 | No repository of the ticket (home, or a `repos:` entry reaching `code_repos`, R-BTN-140) has a held rename (R-BTN-138) | claim | `rename-held` |
  | `person` | The leg is not a person's (R-BTN-116) | claim, advance | `person` |
  | `floor` | Every guarantee a floor names holds on every repository the ticket reaches: its home and each `repos:` entry reaching `code_repos` (R-BTN-140, R-BTN-189); the protection checker is exempt | claim, advance | `floor-broken` |

  Rules `chain` (R-BTN-106), `entry` (R-BTN-109), `not-queued` (R-BTN-72), `check-runner`
  (R-BTN-114) and `trusted` (R-BTN-182) are gates too; a leg's `session` mode is
  rule 4's `runner:session` (R-BTN-107).
  `isEligible`, in the vendored decision library (R-BTN-37), is the reference for every rule;
  the SQL is tested against it (G-BTN-40).

- **The pipeline.** Matching reads only `tickets` and Baton's tables (R-BTN-33).
  1. One query returns candidates, one row per ticket, per (repository, course) group in the
     default order, 50 per group per page (R-BTN-61). With `q` the queued leg (route override,
     else `ticket_stations.next_leg`), it requires: `q` `ready` in `ticket_next_legs`, or `q` the `cancel` leg of a ticket marked
     `cancelling` (R-BTN-168); no
     `ticket_bars` row on `q` matching `runner_tags`; no refusing `ticket_blocks` row on `q` or
     `''`; `board_head.observation` above the ticket's last `claims.end_observation`; a
     `runner_courses` version ≥ `courses.min_runner_version`; an unrevoked `runner_grants` row (for a check-runner, its `check_runners` row), and for a leg marked `trusted: true` one with `role = 'trusted-runner'`, `checker = 0` and no `forge-check` in `runners.delivers` (rule `trusted`, R-BTN-182);
     no holding claim and no hold; every capability of `ticket_requires` and `q` in
     `runner_capabilities` and the grant (`runner:` in `runner_capabilities` alone); tier
     position ≤ `:ceiling`, a per-repository JSON map computed first. That is rules 1, 3, 4, 5,
     7, 9, 10 and rule 8's posted bars.
  2. `isEligible` applies rule 2 and rule 8's owner bars per leg.
  3. R-BTN-61 merges the groups.
  4. Recommendations only then drop a leg with a `resource` row (R-BTN-76), a leg whose rule-4 set (the ticket's `requires` and the leg's) holds a
     capability whose seats are all held by other claims (rule 11, R-BTN-178), and a closed course's new tickets (R-BTN-79).

  A claim re-runs `isEligible` and the predicates for its one candidate in the committing
  transaction, rule 11 among them; an advance re-runs rule 1's advance form, rule 3's hold,
  rules 4–8, 10, 11 and `person`.

- **The default order** within a group: (1) expedite — `EXPEDITE` tag or override (R-BTN-12),
  within the lane's bound; (2) fewer legs to an end (`to_end`, R-BTN-69); (3) the sync's `rank`;
  (4) the queued leg's `ready_since`, oldest first; (5) ticket id. A `cancel` leg Baton queued
  (R-BTN-168) comes before every other leg of its repository, in R-BTN-61's merge too.

- **Recommendations.** `GET /v1/runner/recommendations[?limit=n]` returns the merged list
  without claiming; `GET /v1/runner/next` is its first entry. Each entry has the ticket, its
  queued leg in `legs` (a list of one), the course's opaque posted fields, the hand-off document
  and Baton's advice flags (`expedite-bound`; `wip-bound` when the leg is over `max_queue`,
  R-BTN-79). The course's own order and advice are the runner's (`rank.mjs`, R-BTN-98).
  `?all=1` returns every gate-passing candidate across all pages, at most 500, then `truncated:
  true`.

### 6.7 What a runner ranks from

- **R-BTN-99 (the views a runner ranks from).** Read-only, signed by a machine key alone (no
  runner secret). Each answers with an `ETag` of a per-repository `fleet_version`, a per-Baton
  `instances_version`, the key's grant set and the UTC hour, so an unchanged poll costs a `304`.
  The counters are bumped in the transaction of each write a view shows (claim, `advance`, end;
  a heartbeat changing tags, profile, capabilities or reports; an accepted board post; an owner bar; a reading
  — a `measure` at most once a minute per instance) and by the alarm at each lapse and bar start
  or end; a grant or instance change bumps both, and a capacity set or cleared, or a seat taken or
  released, bumps `instances_version`.
  - **`GET /v1/runner/fleet?repository=<id>`** (key granted there): every active claim (ticket,
    station, leg, the leg's opaque course fields, the latest `advance`'s `course` data,
    `claimed_at`; the runner's hostname, tags, opaque profile and the capabilities its grant here admits, R-BTN-174); each
    claim's reports, and those of claims ended within the last 6 hours; runner-level reports
    naming this repository; the **board summary** (tickets per station; per leg ready and
    waiting counts, queue depth, `max_queue`, intake, R-BTN-79); owner bars in force or
    scheduled; each course's `course_data` (§4). Peers granted on a repository read each other's
    claims, profiles and reports.
  - **`GET /v1/runner/instances`**: every `service` instance, every account instance listing
    a granted repository, with state, every reading in force (source, `observed_at`,
    `lapses_at`, `kind`, `detail`); and every capability with a capacity (R-BTN-178), with the
    claims holding its seats, fence-pending ones included (leg, `claimed_at`, repository; hostname
    and ticket only where the key is granted).
  - **`GET /v1/runner/launch-candidates`**: per granted repository, the legs passing the gates no
    runner decides (lease, readiness, holds, backoff, blocks, a full capability, R-BTN-178), in
    the default order with their
    course fields, for a launcher's `rank` with `runner: null` (R-BTN-98).

- **R-BTN-152 (what a view serves is data).** Profiles, reports, readings' `detail`, course
  fields, resume records and hand-off documents in a view reach a model only as quoted data. A
  runner-level report names a repository the key is granted on, and the fleet view serves only
  those naming its own. The runner checks `rank`'s return: `order` names only the given
  candidates; `advice` and `launch` validate against the course file's `rank_advice` and
  `rank_launch` schema ids (R-BTN-108), dropped when it names none; on any failure, Baton's order.

- **R-BTN-100 (a claim names its preferences).** `POST /v1/runner/claim`
  takes `request_id` and at most one of `ticket_id` (recommended or not) or `prefer: [{ticket_id, leg?}]` (at most 50 known tickets: Baton claims, in one
  transaction, the first passing every gate, else answers `no-eligible-ticket` with `refusals:
  [{ticket_id, code, rule?}]`). With neither, Baton claims its first recommendation; with both,
  `invalid-params`. It also takes:
  - `rationale`: opaque JSON ≤ 4 KB, kept in the claim's `advice_json` and history row and
    exported with it (R-BTN-88); Baton never reads it, the fleet view omits it, the dashboard
    shows it as escaped text, and §12.3's free-text rules do not apply to it.

  A claim against Baton's advice (a resource block, the expedite bound, `max_queue`) records
  `advice-overridden`; against the course's ranking, nothing.

### 6.8 Owner overrides: expedite and hold

- **R-BTN-12 (expedite and hold).** A ticket is expedited when its snapshot carries `EXPEDITE`
  or its override says so; the override stays until an owner clears it, whatever later snapshots
  show, and the mirror writes the tag (§16). Under `require_signed_control` (B-127, R-BTN-66)
  the tag is a control input: it counts only when the commit that last changed it is
  owner-signed, and the sync posts the tag's last signed state — an `EXPEDITE` a push alone
  added does not expedite, and the notice names it.
  - A **hold** means "do not hand this ticket out" (rule 3), with `hold_reason` `owner`,
    `mcp:<name>`, `parked` (R-BTN-163), `attempts-exhausted`, `non-retryable:<class>`,
    `blocked-exhausted` (R-BTN-122, R-BTN-126), or `outbox-refused` (R-BTN-171). A cancellation
    (R-BTN-168) is a second flag beside the hold, `cancelling`, which refuses every leg but the
    ticket's queued `cancel` leg (rule 3) and which no owner lifts. The dashboard's **Cancel**
    sets a hold and sends the holder a `release` with reason `owner-cancel`. A hold is not
    mirrored as a status; the mirror writes a Status note (§16).
  - Owners set and clear both with `POST /v1/owner/{repository}/overrides/{ticket}` or `baton
    ticket hold | unhold | expedite | cancel` (R-BTN-127), as does the dashboard; a delegated key
    sets a hold and lifts only its own (R-BTN-186, R-BTN-130). Lifting a hold resets the leg's
    attempt and blocked-end counts.
  - Each change is logged `override`; each hold also `held` with its `hold_reason`.
  - `ticket_overrides` also holds the queued leg Baton or the owner chose, until the station
    changes: an owner's route, a retry policy's `exhausted` leg, a person leg's expiry, the
    `cancel` leg (R-BTN-83).
  - **Owner state outlives the board.** When a ticket leaves the board, closed or dropped
    (R-BTN-147), its `ticket_overrides` row (a hold with its reason, expedite, a re-route; never
    the `cancelling` flag) and its `leg_attempts` are kept in its `closed_tickets` row, and restored when a
    post returns the same id: the hold stands, no attempt is refunded, and a backoff not yet
    over blocks again. Baton's traversal record (R-BTN-63) stays with the claims. So withdrawing
    a ticket in git and reopening it clears nothing. A ticket re-filed under a new id is a new
    ticket and carries no hold (only a renumbering at the same path does, R-BTN-147): a hold
    binds a ticket only as firmly as git keeps its id, and that residual risk is accepted.
    Owners see it: the dashboard's **Courses** view lists every closed or dropped ticket that
    keeps a hold, with its reason, beside the new ticket, and a drop raises
    `baton.ticket-dropped`.

### 6.9 Messages

- **Kinds.** `release` `{ticket_id, reason}`; `status_request`; `status_report`, a reply
  (`in_reply_to`) `{activity, text}` with the current activity (§9); `unblocked` `{tickets:
  [{ticket_id, cleared}]}` (R-BTN-77); `handled` (R-BTN-162); `wind-down` (B-109) — an owner's
  ask that a worker drain: the runner sets the same flag `SIGTERM` does (its current leg
  completes, its claim ends at the boundary with its hand-off, it exits without claiming again),
  acknowledges the message, and a second wind-down changes nothing.
- **Delivery is a poll.** A heartbeat response returns pending messages and marks them
  `delivered` in the same transaction, and returns again every delivered message not yet
  acknowledged, so a lost response loses none; the runner acts on a message `id` once, then
  acknowledges. A ring (R-BTN-91)
  only prompts that heartbeat.
- **`release`.** The runner stops the leg at its next safe point — at once for `requested`, `floor`,
  `owner-cancel` and `superseded` (R-BTN-119, R-BTN-168) — leaves its work in git with the
  hand-off (R-BTN-44; none for `superseded`), ends the claim `released:<reason>` (§9) and acknowledges. A delivered
  `release` unacknowledged for 2 hours is reaped by the alarm with a fence (R-BTN-19); a
  `leg-timeout` release is reaped as R-BTN-90 says.
- **Expiry.** A reaped runner's `pending` and `delivered` messages become `expired`.

### 6.10 How a leg runs: the course's choice

Which model a leg uses, through which key, and what it does when an instrument reads that a
provider is near its limit, is course code. The course's `rank.mjs` (R-BTN-98) reads the instance
and fleet views (R-BTN-99) when it orders candidates, and may return per-ticket `advice` that the
course's `rank_advice` schema shapes (R-BTN-152); the leg's instructions and `agent_command`
(R-BTN-131, B-95) choose at run time from the repository's configuration and whatever the leg
itself asks its provider. No Baton channel carries `rank`'s advice to the leg: it stays with the
runner that ranked, and a course that wants its leg to act on the same readings computes from
them again in its own leg code. Core resolves no route, delivers no advice about one and records no route taken: a
time-of-day price, a fallback provider or a subscription's limit is a rule in the course, and a
new provider needs no change to Baton. A leg that finds a provider unusable mid-run may report it
as a `resource` block with a reading (R-BTN-126), or stop declaring the capability (R-BTN-121).
### 6.11 Capacity: exclusive use of a capability *(proposal — B-106)*

- **R-BTN-178 (a capability with a capacity has that many seats).** Some things a leg uses take
  one client at a time, or a few: an RDP session to a machine, a device on a bench, a licence.
  Such a thing is a capability like any other (R-BTN-121): the runners that can reach it declare
  it, and the legs that use it require it. Baton holds its seats as it holds a ticket's lease: for
  every worker that asks, and binding only on them.
  - **Capacity** — a capability's, not the tenant's envelope (R-BTN-87). An administrator sets it
    for the tenant: `baton admin capacity set <capability> <n>` (1–64) or `--clear` (R-BTN-127),
    `PUT /v1/admin/capacities`, logged as an `admin` event. The capability is one expanded
    `<type>:<value>`, never a role, a `credential:` or `runner:` capability or the bare
    `human-operator` (`invalid-params`). A capability with no capacity has unlimited seats. A
    lower capacity never takes back a held seat and applies to the next claim or `advance`. With
    capacity 1 the capability is exclusive.
  - **One name, one thing.** Seats are counted across every repository of the tenant
    (R-BTN-137). Capability names are course vocabulary (R-BTN-121), so setting a capacity is the
    administrator's statement that the name denotes the same thing in every repository; before
    signing, `baton admin capacity set` prints every course of the tenant whose legs require the
    capability (`courses.leg_capabilities_json`), with the type's definition in each, and asks to
    confirm. A course in any
    repository may require the capability and so occupy its seats; that is the accepted cost of
    one pool, and a repository that must not share it uses a name of its own.
  - **A claim holds a seat** on each capability with a capacity in the set rule 4 matched for the
    leg it starts — the ticket's `requires` clause and the leg's `requires.capabilities` together
    (§6.6) — at the claim for the leg it is for, and at each `advance` for the leg it starts.
    Baton stores the set in `claim_seats` in that transaction, and a later snapshot never changes
    it. Nothing is billed or named by the runner: the seat follows from the leg's requirements as
    they stood when the leg started. The seats counted are the rows of `claim_seats`.
  - **Taking a seat.** A claim, or an `advance` starting a leg, that would hold a seat on a
    capability whose every seat other claims hold is refused by rule 11, `capacity-full`. A
    claim's own seat never counts against it. A refusal is never a failed attempt, and a `prefer`
    claim goes on to its next candidate. The holders' hostnames and tickets are named only where
    the caller's key is granted on the holder's repository (R-BTN-99). Claims are serialized in
    the tenant's object, so the first to take a free seat holds it.
  - **Releasing.** An `advance` rewrites the claim's `claim_seats` for the leg it starts, so one
    into a leg that does not require the capability releases its seat; the claim's end deletes
    them. A reap that is not fence-pending (R-BTN-19) releases its seats at the reap.
    A fence-pending reap (R-BTN-19) releases them at `fence-cleared` or the fence deadline: until
    then a reaped incarnation that may still be driving the device keeps its seat. A dead runner
    never strands one.
  - **Recommendations see seats.** A leg whose rule-4 set holds a capability whose seats are all held is not
    offered (§6.6, step 4), nor listed in `launch-candidates` (R-BTN-99). `baton leg why` answers
    `full` for it, naming the holders as above. Seats write no block row and wake no one: a freed
    seat sends no `unblocked`, and an idle runner finds the leg at its next recommendation
    (R-BTN-72). Each capacity and the claims holding its seats are served in `GET
    /v1/runner/instances` (R-BTN-99).
  - **One machine's singleton** — a Chrome MCP session one agent at a time may drive on a VM — is
    the runner's own business, never Baton's: its capability carries a `lock` in the runner's
    configuration (R-BTN-121), so of the runners on that machine only the one holding the lock
    declares it and claims or advances into a leg requiring it, and it keeps the lock until the
    claim ends or leaves the legs requiring it.
    Baton counts nothing per host.
  - Baton cannot know what a runner really uses. A runner that uses a thing without requiring its
    capability, or declares one it never touches, is acting on its own statement. Seats keep
    cooperating workers from colliding; they confine nothing (values 12).
