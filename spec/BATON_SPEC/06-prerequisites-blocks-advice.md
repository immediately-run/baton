---
title: "6. Prerequisites, blocks and advice"
description: "A leg starts when its prerequisites hold."
---
## 6. Prerequisites, blocks and advice *(partly built)*

A leg starts when its prerequisites hold. Baton stores each unmet one as a block, answers "why
not" from that index, gates claims on the blocks safety needs, and advises on the rest.

Not built, each a design its rule below still states:

- R-BTN-120: a leg's `requires.tickets` and `requires.resources` (the course validator accepts `requires.capabilities`
  alone, [courses proposal](../proposals/courses.md)), `baton.prerequisite-unmet`,
  `baton.prerequisite-cycle`, the `/prerequisites` route and `baton leg why`.
- R-BTN-75: the `retry` kind and the `found`, `provisional` and `binds` columns of
  `ticket_blocks`. A backoff is a stored `retry_after`, which rule 10 reads.
- R-BTN-126: the `ticket` and `resource` blocked ends, `LegError`, `baton leg release --blocked`,
  `max_blocked` with its `blocked-exhausted` hold, and `baton.blocked-ends`. A `released:blocked`
  end names a `capability` and nothing else.
- §6.6: rule 13, the `trusted` rule and the `wip-bound` flag.
- `requires.attestations` ([security proposal](../proposals/security.md)).

### 6.1 Prerequisites

- **R-BTN-120 / R-BTN-132 (a leg's prerequisites, one way in for each kind).** A leg can start
  when every prerequisite holds. This is the one list of prerequisite and block kinds:

  | Kind | Declared by | Holds when | Block `ref` | `why` when unmet |
  |---|---|---|---|---|
  | station | the leg's `from` (R-BTN-69) | the ticket is at one of them | no block: only legs leaving the ticket's station are offered | `not-at`, with where the ticket is |
  | `ticket` | the leg's `requires.tickets`; the ticket's posted `depends_at` | the selected tickets are where the entry says | `<ticket>@at:<station>,…`, `@reached:…`, `@done`, `@withdrawn` or `@closed` | `not-at`, `not-reached`, `not-done`, `not-closed` (with where the other ticket is), `withdrawn`, `no-parent`, `unknown-ticket` |
  | `capability` | the leg's `requires.capabilities`; the ticket's posted `requires` clause (every leg) | the runner declares each and is granted it (rule 4, R-BTN-174) | the capability | `no-live-runner`; with `runner=me`, `not-declared` or `not-granted`; `full`, with the claims holding the seats where the asker may see them (R-BTN-178) |
  | `resource` | R-BTN-76 | a usable instance is not `unavailable` | the resource; `until` the first instance back | `unavailable`, with `until` |
  | `retry` | the leg's `retry` policy (R-BTN-122) | `retry_after` has passed | the leg; `until` = `retry_after` | `backing-off`, with `until` and `attempt: <n> of <max>` |
  | time | `not_before` (R-BTN-89) | Baton's clock passes it | no block: a stored `waiting` state | `time`, with `not_before`, under `other` |

  ```json
  "deploy": { "from": ["approved"], "to": "deployed",
    "requires": {
      "tickets":      [{ "select": "parent", "reached": ["planned"] }],
      "capabilities": ["deployer", "db:orders:rw"] } }
  ```

  - **Ticket entries.** `select` is `parent` (optional `course`, else the leg's own) or
    `posted` (the ticket's posted `depends_at: [{ticket, at | reached | done, leg?}]`; `leg`
    binds one leg of this ticket, absent every leg); the validator refuses any other `select`.
    Each entry has exactly one of `at: [<station>…]` (a selected ticket is at one now), `reached:
    [<station>…]` (its path contains one), `"done": true` (closed `done` at any end station, kept
    as `closed_tickets.final_station` and `final_path`), `"withdrawn": true` or `"closed": true`
    (closed either way). A withdrawn ticket meets only `withdrawn` and `closed`;
    `"skip_withdrawn": true` drops it from the selection instead. An empty selection holds only
    with `"allow_empty": true`. Entries select tickets of the same repository (R-BTN-86); a
    posted `depends_at` entry may name another repository's ticket by its qualified id (§3.1),
    resolved against that repository's board under §3.1's visibility and consent rule. Baton
    evaluates entries from the stations and paths it stores. `baton course test` checks that each
    named station exists in the selectable course.
  - **The ticket source decides which dependencies are open** and posts only those; Baton keeps
    no second dependency store. The default markdown source translates `depends_on: [<id>]` to
    `{ticket: <id>, done: true, leg: <start_leg>}`, a qualified id as written, resolved by the
    sync's dependencies read (§4.4). `parent` is a link, never a block.
  - **Unmeetable entries fail closed.** A `parent` entry with no parent, a `posted` id Baton
    has not seen, or an entry a withdrawn ticket leaves unmet keeps its block and raises
    `baton.prerequisite-unmet`. When an accepted snapshot's ticket prerequisites form a cycle
    (selected tickets as edges), Baton keeps every block and raises `baton.prerequisite-cycle`
    naming the tickets.
  - **Capabilities** are stored expanded through R-BTN-121's `capability_roles`; no role name is
    stored. `human-operator` is an ordinary capability in `ticket_requires`, which a runner
    declares and a grant admits (R-BTN-121); a source translates its own word for it into the
    clause. The ticket's clause and a leg's `requires.capabilities` join for that leg.
  - **`waiting_on`** names only a wait no kind covers (an author's push, CI's `short_waits`, a
    forge effect), shown under `other`. The snapshot validator refuses `dependencies`,
    `children`, `owner` and `policy`, naming the ticket. Baton stores a posted label prefixed
    `course:` and reserves `time`, `not-before-invalid`, `input-missing`, `input-version`,
    `course-changed`, and `policy` for an unmet required bar (R-BTN-67).
  - **Why a leg cannot start.** `GET
    /v1/repositories/{repository}/tickets/{ticket}/prerequisites[?leg=<leg>][&runner=me]`
    (default the queued leg) and `baton leg why <ticket> [<leg>]` return `{leg, ready,
    prerequisites: [{kind, ref, met, why, since?, until?, url?, found?}]}`, every prerequisite
    met or not, with `why` as the table gives it and what R-BTN-75 lists as `other`. It reads the
    blocks index, never the board. A runner key granted on the repository, its owners and a
    dashboard session may ask; the dashboard's **Ready** (§11) shows it for a ticket no runner is
    eligible for.

### 6.2 Blocks

- **R-BTN-75 (blocks are stored, not recomputed).** A block is one unmet prerequisite, a row of
  `ticket_blocks` (repository, ticket, leg or `''` for the whole ticket, `kind`, `ref`, `since`,
  `until`, `found`, `provisional`, `binds`) written in the transaction that causes it, so asking
  reads one repository-scoped index. The kinds and their `ref` are R-BTN-120's table.
  - **Where a row sits.** On its leg; on the whole ticket for a `depends_at` entry without `leg`
    and for the ticket's `requires` clause.
  - **What a row refuses.** Every row refuses a claim and an advance into its leg, and a
    whole-ticket row every leg (rule 1), with three differences: a `capability` row refuses only
    each runner lacking the capability (rule 4); a `retry` row refuses as `backing-off` (rule
    10); a `resource` row is advice and refuses nothing (R-BTN-76).
  - **When rows are written.** A `ticket` row is rewritten when a referenced ticket's station or
    path, or an entry's selection, changes (index `ticket_dependents`); a `capability` row when
    the fleet count crosses zero (below); a `retry` row by a failed attempt (R-BTN-122); a
    `resource` row as R-BTN-76 says.
  - **Held and blocked.** A ticket is **held** while it has an active claim, a completed claim
    not yet confirmed, or a fence-pending reap (rule 3's claim checks; R-BTN-79 uses the same
    definition). It is **blocked** when not held and it has a whole-ticket row or a row on its
    queued leg (R-BTN-83); rows on other legs do not block, and a ticket with no queued leg is
    not blocked. Baton evaluates this once per transaction, after the last row change and any
    owed `unblocked` (R-BTN-77), into `tickets.blocked_since`.
  - **Provisional rows.** A `ticket` row written by a `blocked` end carries `provisional` = the
    commit that wrote its fact to git. It refuses a claim and an advance into its leg and keeps
    the leg out of recommendations, but does not count toward `blocked_since`. The first accepted
    snapshot whose head contains the commit (the observation response's `provisional`, §4.3)
    replaces it with what it shows; a row not so confirmed within 1 hour, or not shown, is
    dropped and logged `prerequisite-unconfirmed`.
  - **Not blocks.** `other` lists what else keeps a ticket from being offered: a hold (§6.8)
    with its `hold_reason`, a `waiting_on` label, a `time` wait, a queued person leg with its
    question (R-BTN-116), owner bars on every live runner's tags (R-BTN-67), an unconfirmed end
    (R-BTN-10), and `no-instance` (R-BTN-76). Core's `baton.retries`, `baton.contract` and
    `baton.stalled` (R-BTN-163) write no row: a hold or the posted wait already keeps the ticket.
  - **Capability rows follow a count.** `fleet_capabilities` counts, per (repository,
    capability), the live runners that declare and are granted it (R-BTN-174); a `runner:`
    capability needs the declaration only (R-BTN-133). Rows are rewritten only when a count
    crosses zero, for the tickets requiring the capability; a snapshot writing a ticket's
    `ticket_requires` writes its rows in the same transaction. A ticket blocked 24 hours on a
    capability no live runner has raises `baton.capability-missing`. One runner's answer is
    rule 4, computed on the spot.
  - **`found`.** A row a `blocked` end writes is `during-run`; every other row, including one
    present at the claim's start, is `before-start`.
  - Rows and the messages they cause count against the write budget (§2).

- **R-BTN-77 (blocked and unblocked are events; unblocking wakes work).**
  - Setting `blocked_since` logs `blocked`; clearing it other than by a claim starting logs
    `unblocked` `{ticket, cleared: [{kind, ref}]}`, the rows whose removal cleared it, in the
    same transaction. A claim's end is never an unblocking; an end leaving the ticket blocked
    (a backoff it starts, a dependency found while held) logs `blocked`, which wakes no one.
    Every `unblocked` follows a `blocked`.
  - **On `unblocked`** Baton queues, for each live idle runner granted on the repository that the
    ticket would now pass the gates for, one `unblocked` message (§6.9), updated in place while
    pending, at most 20 tickets (oldest dropped), expired by the alarm when the runner stops
    being live; an idle `baton runner start` then attempts a claim (R-BTN-72). Baton
    also dispatches the repository's `unblocked_trigger` (R-BTN-94) when set, with one input
    `tickets`, a JSON array of `{ticket, cleared}`: one dispatch per 30 seconds per repository
    plus a trailing one, at most 100 entries then `{truncated: n}`. Every id and `ref` in it has
    passed §12.3's untrusted-text rules.

- **R-BTN-126 (a prerequisite that fails during a leg blocks that leg's edge).** The ticket stays
  at the station the leg leaves; no station is added.
  - **The end.** The runner pushes the work so far, `handoff` writes the hand-off (R-BTN-44), and
    the claim ends **`released:blocked`** with `prerequisite: {kind, ref}`. In that transaction:
    - `capability` — `ref` a capability the runner declared and says it lost (R-BTN-174). This
      is the runner's own statement, which Baton never checks. Baton removes it from the
      runner's declared set and updates `fleet_capabilities`, so rule 4 refuses this runner at
      once. The runner declares it again once its check passes (R-BTN-121), or, for a name its
      executor `provides`, once the executor states it again (R-BTN-107).
    - `ticket` (`ref` in R-BTN-120's form, same repository) — the leg writes the `depends_at`
      entry to git first and the end carries `commit`; Baton writes a provisional row
      (R-BTN-75).
    - `resource` — as R-BTN-76 says.
  - **Invalid.** A bad kind or `ref`, a capability the `capability` bullet does not admit, or a
    `ticket` end without `commit`: Baton records `released:cannot-finish:transient` (a failed
    attempt) in the same transaction and answers `invalid-prerequisite`. The runner makes the
    same checks first.
  - **Bounded, not failed.** A valid `blocked` end is not a failed attempt, not a run for
    `max_runs` (R-BTN-69), and starts no backoff. Baton counts them per (ticket, leg) from
    `claims.blocked_kind` and `blocked_ref`. Past `max_blocked`, a constant of 5 within 24
    hours, the next one holds the ticket (`hold_reason: blocked-exhausted`) and raises
    `baton.retries` listing each end's prerequisite. A runner with more than 20 blocked ends
    across tickets in 24 hours raises `baton.blocked-ends`.
  - **How a leg says so.** A script throws `LegError(type, message, {prerequisite, instance?,
    commit?})`; a session sends `baton leg release --blocked --kind <kind> --ref <ref>
    [--instance <i>] [--commit <sha>]` on the local channel (R-BTN-106). An error naming a
    prerequisite is a request for a blocked end, never retried in the claim, and the runner never
    waits in the claim for a prerequisite to return.
  - **The runner confirms a leg's `capability` request** after the leg's session stops and
    before `handoff`: the leg names a capability it requires, and that capability's `check` runs
    (R-BTN-121). A failing check confirms the request, and the claim ends blocked on it. A
    passing check, or a name with no check configured, does not: the claim ends
    `released:cannot-finish:transient`, a failed attempt (R-BTN-122), and the leg log records
    the request. A name the runner's executor `provides` has no runner check; only an end the
    executor itself makes blocks on it (R-BTN-107). A `ticket` request needs no check: a
    snapshot confirms it.
  - **Drawn as an edge.** Every course view (**Courses**, a ticket's path, `baton leg why`)
    draws each leg as an edge in one state — `ready`, `running`, `blocked` (each unmet
    prerequisite's kind, `since`, `until`, `found`), `backing-off` or `not-queued` — never as a
    station, in colour and a text label (§11).

- **Asking about blocks** (R-BTN-75).
  - `GET /v1/repositories/{repository}/tickets/{ticket}/blocks[?runner=me]` → `{blocked,
    blocks: [{kind, leg?, ref, since, until?, found}], other}`; `runner=me` makes `capability`
    blocks the asking runner's.
  - `GET /v1/repositories/{repository}/blocked?on=<kind>:<ref>[&transitive=1]`, `kind` one of
    `ticket`, `resource`, `capability` → the tickets blocked on it with their blocks; with no
    `on`, every blocked ticket grouped by kind and `ref`, 100 per page with a cursor.
    `transitive=1` follows `ticket` blocks up to 5 levels.
  - Any key granted on the repository, its owners and administrators may ask; CLI `baton
    ticket blocked <ticket>` and `baton ticket blocked --on <kind>:<ref>`.
  - Each question reads one index (G-BTN-70).

### 6.3 External resources and readings

- **R-BTN-76 / R-BTN-101 / R-BTN-151 (external resources, their instances and readings).** A
  resource is anything outside Baton that a course reads the state of: a provider's capacity, an
  API's rate limit, disk on a shared server. A **reading** is an attestation about one of its
  instances: R-BTN-181 owns its writers and authentication, and this rule adds what is particular
  to resources. A reading's `type` is its resource's schema id and its value is `{available?,
  until?, detail}`. Readings are stored once per tenant; a repository reads only those its
  policy's `readings` entry admits (R-BTN-188). A requirement over an instance's readings is
  proposed in the [security proposal](../proposals/security.md).
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
    numbers, booleans and `enum` strings. Instances and readings are one tenant's (R-BTN-137).
    A repository's **usable** instances of R are the `service` instance and the account
    instances that serve R and list the repository; every runner granted there has the same
    ones. What only one runner can reach is a capability of that runner (R-BTN-121), not a
    resource.
  - **Who reports.** A runner credential (machine key or API key, R-BTN-117), `POST
    /v1/runner/readings`: any account instance listing a repository its key is granted on —
    sharing an account trusts every listed repository's runners. An instrument key (`POST
    /v1/admin/probes`, with a label), `POST /v1/probe/readings`: any registered instance. An
    administrator, `baton admin reading set <instance> …` (R-BTN-127), `POST /v1/admin/readings`:
    any registered instance, as one more instrument, writer class `admin`.
  - **Readings** name their `detail`'s schema (≤ 4 KB, R-BTN-108's validator). A `state`
    reading `{instance, available, until?, valid_for, detail?}` has `valid_for` ≤ 24 hours
    (default 1 hour), ≤ 1 hour from a runner credential, and `until` no later than its end; an
    unavailable reading with `until` lapses at the earlier of the two. A runner posts one on
    meeting a limit (the reset as `until`) and on succeeding after one (R-BTN-121). A `measure`
    reading carries `detail` only, `valid_for` ≤ 31 days, and never affects state. A runner
    session posts at most one reading per instance a minute.
  - **Kept per instrument.** Per instance: the latest reading of each instrument — an
    administrator, a runner session by its `runners` row, or an instrument key — each lapsing on
    its own; at most 8 instruments per credential, a ninth replacing that credential's oldest.
    All readings in force are served, each with its writer (R-BTN-99); core never sums them.
  - **State**: the most recently observed `state` reading in force, else `unknown`. Each change
    is a `resource` event.
  - **Clearing.** `POST /v1/admin/readings {instance, clear: {source?}}` ends readings of both
    kinds from one instrument or all, logged.
  - **The `resource` prerequisite and block.** To be removed with its code.
    - **Needs** — a leg's `requires.resources` (not built), the sync's posted `needs` (joined for the leg)
      and `end`-sourced needs — are stored in `leg_needs`; an invalid or unregistered name is
      logged and blocks nothing.
    - **Blocked** when at least one live runner is granted on the repository, the repository has
      a usable instance of R, and every one is `unavailable`; the row is the same for every
      runner. With no live granted runner, or no usable instance, no row is written and `other`
      lists `no-instance`. `resource_fleet` keeps the count per (repository, resource); rows are
      rewritten only when the answer flips, and a snapshot writing `leg_needs` writes that
      ticket's rows in the same transaction. An instance `unknown` 24 hours while a posted leg
      needs it raises `baton.resource-unknown`.
    - **Advice.** A row is advice: recommendations leave its leg out, and a claim against it is
      accepted.
    - **A lost answer is not an unblocking.** A `resource` row that goes because the repository
      has no live granted runner or no usable instance left clears `blocked_since` silently, and
      so does a transition whose cleared rows include such a lost row on the queued leg; a lost
      row is never named in an `unblocked`'s `cleared`. The ticket keeps the lost rows and
      `blocked_since` in `tickets.answer_lost` until each settles (the need gone, or the fleet
      able to answer). Then, if the ticket is unblocked, unheld and has a queued leg, Baton logs
      the owed `unblocked` with its message and trigger; if it is blocked only on rows it lost,
      Baton rewrites them silently with the original `blocked_since`. Any `blocked` or
      `unblocked` logged meanwhile ends the record; a new block is preceded by the owed
      `unblocked`, logged only.
    - **A `blocked` end** (R-BTN-126) names a registered resource as `ref`, optionally with
      `reading: {instance, available: false, until?, valid_for?, detail?}` for an instance
      serving `ref` that the runner may report on. Baton stores the reading as the runner's,
      adds the need to `leg_needs` with source `end` if the posted needs lack it, stamps its
      `found_at` (its rows are `found: during-run`) and writes the row against the counts. A
      reading failing its envelope, bounds or one-a-minute limit, or naming an instance not
      serving `ref` or not reportable, is dropped and logged `reading-refused`; the end stands.
      An `end`-sourced need, its row and the stamp go when the leg next ends other than
      `blocked` on that resource, or after 7 days; posts never remove it. The runner sends no
      reading of the leg's: it runs the check of every capability its configuration binds to an
      instance serving `ref` (R-BTN-121) and carries the reading of the first that fails, the
      instance the leg names preferred.

### 6.4 People

- **R-BTN-116 (a person's leg: the one way a course waits on a person).** A leg may be `"kind":
  "person"` with `"asks": <label>` (who answers; matches `^[a-z][a-z0-9-]{0,31}$`). No runner is
  offered it or may claim or advance into it (rule `person`), and no claim ever runs it: the ticket
  waits unheld while it is queued, and the leg may also arrive while another leg is queued
  (R-BTN-39), so a person's answer counts while a runner's leg waits. A leg that wants a person
  in its agent session, waiting on no answer, raises `interact` (R-BTN-195).
  - **The question.** A queued person's leg is listed under **Needs you** from the moment it is
    queued (R-BTN-163). While it is queued, the ticket source may post its **question** with the
    ticket (§4.4): `{id, url?, severity?, options?: [{id, reached}]}` — an id for the question
    (§12.3's decision-id rule, not beginning `baton.`), where git holds its text (`url`, under
    R-BTN-92's link rule for a repository with reach, R-BTN-140), its severity (R-BTN-125) and
    its options, each naming the outcome in the leg's `to` it chooses. When no options are
    posted, each outcome is an option under its own name. Baton stores the question in
    `ticket_questions`, logs `question-posted` once per id, and shows it on the leg's Needs-you
    entry; a question posted for a ticket whose queued leg is not a person's is dropped and
    logged `question-dropped`.
  - **The answer** is a `std:decision@1` attestation (R-BTN-191), `{id, leg, option, reached,
    ref?, answered_by?, commit?}`: `leg` a `kind: person` leg leaving Baton's station, `option` one
    of its options, `reached` the outcome that option names, `id` the question's when one is
    posted. It is written by the person — an owner, a member whose `answers` hold the leg's
    `asks` label (R-BTN-204) or a human-only key, through `baton decision answer` (R-BTN-127) or
    the dashboard's Needs-you entry, each where the policy's `attestations` entry for
    `std:decision@1` admits its writer (a session writes as its key's role, never `human`,
    R-BTN-185); never by an administrator or a delegated key (R-BTN-57, R-BTN-186) — or attested by the sync from the answer the ticket shows (the markdown
    source's `answer:` field, R-BTN-74), where the policy's entry admits `sync`. Under
    `protected` the entry admits `human` alone, so an answer in git does not count there
    (R-BTN-191). An answer naming a leg that is not a person's, an `option` the leg does not
    offer, a `reached` other than the option's, or an `id` other than the posted question's is
    refused `invalid-params`; the sync's is dropped and logged `answer-invalid`.
  - **Applied as an arrival.** The accepted answer is the leg's arrival under R-BTN-39's rules
    (writer admitted, the leg leaving Baton's station, the ticket not held, the `ref` new); it
    may carry a value or refinement the station reached requires (R-BTN-109). The applied answer
    is the leg's output `answer` (R-BTN-82), recorded with no claim, which a later leg may declare
    as an input, `required: false` where a route can skip the person leg. Baton logs
    `question-answered` with the option and `answered_by`, and the question is closed.
  - **Expiry.** A person's leg may carry `"expires": {"after_s": <n>, "reached": <outcome>}`
    (60 s–30 d). The instant is set when the person leg becomes the queued leg — at the ticket's
    arrival at the station, a new ticket's placement at `start` included, or at a route that
    queues it (R-BTN-83) — that moment, by Baton's clock, plus `after_s`; a person leg that is
    not the queued leg has no instant, and a route that queues another leg clears it. It restarts
    as R-BTN-167 says. At the instant, if the leg is still queued and unanswered, Baton applies
    the arrival at `reached` itself (`next_source: baton`, R-BTN-83) under R-BTN-39's rules —
    deferred while a claim is active or Baton holds the ticket, applied when the hold ends — and
    logs `question-expired`; an answer attested after the expiry applied is unapplied
    (R-BTN-39).
  - A leg never waits on a delivery, only on an effect: an answer attested in Baton, an answer in
    git the sync reads, or a forge effect (R-BTN-114). How a person learns of the question is a
    delivery runner's (R-BTN-163), never core's.

### 6.5 Waiting for a time

- **R-BTN-89 (a queued leg may wait for a time).** A queued leg may carry `not_before`, an
  instant before which it is not offered.
  - **From git.** After a leg, its closing marker's `not_before=` (from the result's
    `not_before?`, R-BTN-72), posted by `locate` with the ticket as `not_before` (§4.4); the runner
    also reports `not_before?` on a suspending or releasing `end`, so the provisional queued leg
    waits at once. For a ticket at `start` with an empty path, the ticket file's
    `tickets[].not_before` (R-BTN-74) applies when the station posts none. Baton never computes
    one; a schedule is the leg script's.
  - **Validated, failing closed.** RFC 3339 with `Z` or a numeric offset, at most 400 days after
    `now` (R-BTN-32) at acceptance. A failing value is logged `not-before-invalid`; a leg posted
    `ready` is stored `waiting` on `not-before-invalid` and raises `baton.not-before-invalid`
    until git is valid; a leg posted `waiting` on another label keeps it; no snapshot is
    refused. A value at or before `now` is stored NULL.
  - **Stored.** The queued leg is stored `waiting` on `time` exactly when posted `ready` and
    `now < not_before`; a posted `waiting` on another label wins, `not_before` kept beside it.
    At `not_before` the alarm sets the leg `ready` with `ready_since = not_before`. A `time` wait
    raises no condition; the dashboard shows "waiting until …" and lists pending waits on
    **Courses**.
  - **Offered at the instant.** Recommendations leave a `time` wait out and rule 1 refuses its
    claim. Claim, heartbeat and advance responses carry each next leg's `not_before`; the runner
    suspends unless it is within 30 minutes, then waits under the claim. At `not_before` Baton
    queues R-BTN-77's `unblocked` message with `cleared: [{kind: "time", ref: <not_before>}]`
    and rings it, but calls no trigger.
  - **Recurring jobs.** The design of a series, a ticket whose children are a job's runs, is in
    the [conditions proposal](../proposals/conditions.md).

### 6.6 Matching: gates and advice

Baton recommends and the runner decides (R-BTN-45): a gate refuses a claim or advance; advice
never refuses, and acting against it is accepted and recorded `advice-overridden`.

- **The gates.** Rule numbers are stable. Each rule applies where its At column says. A refusal
  is the code shown, else `not-eligible` with `rule` and `rule_code`.

  | Rule | Holds when | At | Refusal |
  |---|---|---|---|
  | 1 | Claim: the queued leg (R-BTN-83, or a route override) is `ready` as posted (R-BTN-70), a snapshot was accepted after the ticket's last end (R-BTN-10), and no row that refuses (R-BTN-75) is on that leg or the whole ticket. Advance: the new leg is an edge from the claim's station within its run limit (R-BTN-63), with no row that refuses on it or the whole ticket | claim, advance | `blocked` with the blocks; else rule 1 (`not-ready`, or R-BTN-63's codes) |
  | 2 | *(advice)* expedite lane: while 2 active claims hold expedited tickets, other expedited tickets lose their expedite place and carry `expedite-bound` | — | — |
  | 3 | No other active, completed-unconfirmed or fence-pending claim on the ticket; no hold (§6.8) | claim; advance: the hold only | `claimed`, `held` |
  | 4 | `capabilitiesOf(ticket.requires ∪ leg.requires.capabilities) ⊆ declared ∩ grant(repository)`, matched by name (R-BTN-174); `runner:` counts once declared (R-BTN-133); no clause is met by all | claim, advance | `missing-capability` |
  | 7 | The key holds a grant for the ticket's repository (R-BTN-58) | claim, advance | `not-granted` |
  | 8 | Tags meet none of the leg's posted barred tags, the owner bars in force for its course or `*` (at an advance those with `applies: claim+advance`) and, at an advance, the holder's `bars`; required bars met by posted bars joined with the holder's `bars` (R-BTN-60, R-BTN-67) | claim, advance | `barred-tag`; rule 8 `policy` |
  | 9 | The runner declares the course at `min_runner_version` or later (R-BTN-22, R-BTN-65) | claim | `stale-skills` |
  | 10 | No `retry` block on the leg | claim, advance | `backing-off` with `until` |
  | 11 | Every capability with a capacity in rule 4's set for the leg has a seat no other claim holds (R-BTN-178) | claim, advance | `capacity-full`, naming the holders where the caller may see them |
  | 13 | No repository of the ticket (home, or a `repos:` entry with reach, R-BTN-140) has a held rename (R-BTN-138) | claim | `rename-held` |
  | `person` | The leg is not a person's (R-BTN-116) | claim, advance | `person` |
  | `floor` | Every guarantee a floor names holds on every repository the ticket reaches: its home and each `repos:` entry with reach (R-BTN-140, R-BTN-189); the protection checker is exempt | claim, advance | `floor-broken` |

  Rules `chain` (R-BTN-106), `isolation` (R-BTN-107), `entry` (R-BTN-109) and `not-queued`
  (R-BTN-72) are gates too; `trusted` is proposed (R-BTN-182). `isEligible`, in the vendored decision
  library (R-BTN-37), is the reference for every rule; the SQL is tested against it (G-BTN-40).

- **Matching** reads only `tickets` and Baton's tables (R-BTN-33). Candidates are one row per
  ticket, per (repository, course) group in the default order, 50 per group per page, merged by
  R-BTN-61. They are read by index from the `ready_tickets` projection (§13.4), each next page
  continuing by keyset in the same order, and matched against the runner's holdings on each
  repository, computed once per request. The projection only filters candidates: every gate
  above still runs on each. Recommendations also leave out a leg with a `resource` row (R-BTN-76), a leg rule 11
  would refuse, and a closed course's new tickets (R-BTN-79). A claim checks its one candidate
  again in the committing transaction.

- **The default order** within a group: (1) expedite — `EXPEDITE` tag or override (R-BTN-12),
  within the lane's bound; (2) fewer legs to an end (`to_end`, R-BTN-69); (3) the sync's `rank`;
  (4) the queued leg's `ready_since`, oldest first; (5) ticket id.

- **Recommendations.** `GET /v1/runner/recommendations[?limit=n]` returns the merged list
  without claiming; `GET /v1/runner/next` is its first entry. Each entry has the ticket, its
  queued leg in `legs` (a list of one), the course's opaque posted fields, the hand-off document
  and Baton's advice flags (`expedite-bound`; `wip-bound` when the leg is over `max_queue`,
  R-BTN-79). The course's own order and advice are the runner's (`rank.mjs`, R-BTN-98).
  `?all=1` returns every gate-passing candidate across all pages, at most 500, then `truncated:
  true`.

### 6.7 What a runner ranks from

- **R-BTN-99 (the views a runner ranks from).** Read-only, signed by a machine key alone (no
  runner secret). Each answers with an `ETag`, so an unchanged poll costs a `304`. The tag
  uses the view versions, the key's grant set and UTC hour, and changes at relevant lapses,
  backoff deadlines and bar starts or ends.
  - **`GET /v1/runner/fleet?repository=<id>`** (key granted there): every active claim (ticket,
    station, leg, the leg's opaque course fields, the latest `advance`'s `course` data,
    `claimed_at`; the runner's hostname, tags, opaque profile and the capabilities its grant here
    admits, R-BTN-174); each claim's reports, and those of claims ended within the last 6 hours;
    runner-level reports naming this repository; the **board summary** (tickets per station; per
    leg ready and waiting counts, queue depth, `max_queue`, intake, R-BTN-79); owner bars in
    force or scheduled; each course's `course_data` (§4). Peers granted on a repository read
    each other's claims, profiles and reports. A heartbeat posts up to 16 reports, each at most
    4 KB of opaque JSON. Baton retains the newest 16 keys per runner and claim or repository,
    keeping repository reports for six hours from receipt and claim reports until six hours after
    the claim ends. A claim report can be posted only by its current holder.
  - **`GET /v1/runner/instances`**: every `service` instance, every account instance listing
    a granted repository, with state, every reading in force (source, `observed_at`,
    `lapses_at`, `kind`, `detail`); and every capability with a capacity (R-BTN-178), with the
    claims holding its seats, fence-pending ones included (leg, `claimed_at`, repository; hostname
    and ticket only where the key is granted).
  - **`GET /v1/runner/launch-candidates`**: per granted repository, the legs passing the gates no
    runner decides (lease, readiness, holds, backoff, blocks, a full capability), in the default
    order with their course fields, for a launcher's `rank` with `runner: null` (R-BTN-98).

- **R-BTN-152 (what a view serves is data).** Profiles, reports, readings' `detail`, course
  fields, resume records and hand-off documents in a view reach a model only as quoted data. A
  runner-level report names a repository the key is granted on, and the fleet view serves only
  those naming its own. The runner checks `rank`'s return: `order` names only the given
  candidates; `advice` and `launch` validate against the course file's `rank_advice` and
  `rank_launch` schema ids (R-BTN-108), dropped when it names none; on any failure, Baton's order.

- **R-BTN-100 (a claim names its preferences).** `POST /v1/runner/claim` takes `request_id`
  and at most one of `ticket_id` and `prefer: [{ticket_id, leg?}]`. Baton tries up to 50 known
  tickets in order, using the same gates as a named claim, and grants the first passing entry
  in the same transaction. If none passes it answers `no-eligible-ticket` with
  `refusals: [{ticket_id, code, rule?}]`. An ungranted ticket gets rule 7 without an existence
  check. With neither selector, Baton claims its first recommendation.

  `rationale` is optional opaque JSON of at most 4 KB. Baton stores it in the claim's
  `advice_json` and ticket history (including exports with history), never ranks on it and
  never includes it in the fleet view. The dashboard shows it as escaped text. A claim against Baton's advice (such as a resource
  block or the expedite bound) records `advice-overridden`; changing the order does not.

### 6.8 Owner overrides: expedite and hold

- **R-BTN-12 (expedite and hold).** A ticket is expedited when its snapshot carries `EXPEDITE`
  or its override says so; the override stays until an owner clears it, whatever later snapshots
  show. The mirror writes the tag, and for a hold a Status note, never a status (legacy, removed
  with its code, R-BTN-193).
  - A **hold** means "do not hand this ticket out" (rule 3), with `hold_reason` `owner`,
    `mcp:<name>`, `parked` (R-BTN-163), `attempts-exhausted`, `non-retryable:<class>`
    (R-BTN-122) or `blocked-exhausted` (R-BTN-126). The dashboard's **Cancel** sets a hold and
    sends the holder a `release` with reason `owner-cancel`.
  - Owners set and clear both with `POST /v1/owner/{repository}/overrides/{ticket}` or `baton
    ticket hold | unhold | expedite | cancel` (R-BTN-127), as does the dashboard; a delegated key
    sets a hold and lifts only its own (R-BTN-186). Lifting a hold resets the leg's attempt
    (R-BTN-122) and blocked-end counts.
  - Each change is logged `override`; each hold also `held` with its `hold_reason`.
  - `ticket_overrides` also holds the queued leg Baton or the owner chose, until the station
    changes: an owner's route, a retry policy's `exhausted` leg, a person leg's expiry
    (R-BTN-83).
  - **Owner state outlives the board.** When a ticket leaves the board, closed or dropped
    (R-BTN-147), its `ticket_overrides` row (a hold with its reason, expedite, a re-route) and
    its `leg_attempts` are kept in its `closed_tickets` row, and restored when a post returns the
    same id: the hold stands, no attempt is refunded, and a backoff not yet over blocks again.
    Baton's traversal record (R-BTN-63) stays with the claims. A ticket re-filed under a new id
    is a new ticket and carries no hold (only a renumbering at the same path does, R-BTN-147).
    The dashboard's course screens (§11.4) list every closed or dropped ticket that keeps a
    hold, with its reason, beside the new ticket.

### 6.9 Messages

- **Kinds.** `release` `{ticket_id, reason}`; `status_request`; `status_report`, a reply
  (`in_reply_to`) `{activity, text}` with the current activity (§9); `unblocked` `{tickets:
  [{ticket_id, cleared}]}` (R-BTN-77); `wind-down` — an owner's ask that a worker drain: the
  runner sets the same flag `SIGTERM` does (its current leg completes, its claim ends at the
  boundary with its hand-off, it exits without claiming again), acknowledges the message, and a
  second wind-down changes nothing.
- **Delivery is a poll.** A heartbeat response returns pending messages and marks them
  `delivered` in the same transaction, and returns again every delivered message not yet
  acknowledged, so a lost response loses none; the runner acts on a message `id` once, then
  acknowledges. A ring (R-BTN-91) only prompts that heartbeat.
- **`release`.** The runner stops the leg at its next safe point — at once for `requested`,
  `floor` and `owner-cancel` (R-BTN-119) — leaves its work in git with the hand-off (R-BTN-44),
  ends the claim `released:<reason>` (§9) and acknowledges. A delivered `release` unacknowledged
  for 2 hours is reaped by the alarm with a fence (R-BTN-19); a `leg-timeout` release is reaped
  as R-BTN-90 says.
- **Expiry.** A reaped runner's `pending` and `delivered` messages become `expired`.

### 6.10 How a leg runs: the course's choice

Which model a leg uses, through which key, and how it reacts to a reading is course code
(R-BTN-98): core resolves no route and carries no advice from `rank` to a leg.

### 6.11 Capacity: exclusive use of a capability

- **R-BTN-178 (a capability with a capacity has that many seats).** A capability that takes one
  client at a time, or a few, is given a capacity; Baton then holds its seats as it holds a
  ticket's lease.
  - **Capacity.** An administrator sets it for the tenant: `baton admin capacity set
    <capability> <n>` (1–64) or `--clear` (R-BTN-127), `PUT /v1/admin/capacities`, logged as an
    `admin` event. The capability is one expanded `<type>:<value>`, never a role, a
    `credential:` or `runner:` capability or the bare `human-operator` (`invalid-params`). A
    capability with no capacity has unlimited seats. A lower capacity never takes back a held
    seat and applies to the next claim or `advance`.
  - **One pool per tenant.** Seats are counted across every repository of the tenant
    (R-BTN-137), so a course in any repository that requires the capability occupies its seats.
    Before signing, `baton admin capacity set` prints every course of the tenant whose legs
    require the capability (`courses.leg_capabilities_json`), with the type's definition in
    each, and asks to confirm.
  - **A claim holds a seat** on each capability with a capacity in the set rule 4 matched for
    the leg it starts (the ticket's `requires` clause and the leg's `requires.capabilities`), at
    the claim and at each `advance`. Baton stores the set in `claim_seats` in that transaction,
    and a later snapshot never changes it. The seats counted are the rows of `claim_seats`.
  - **Taking a seat.** A claim or `advance` that needs a seat on a capability whose every seat
    other claims hold is refused by rule 11. A claim's own seat never counts against it. The
    refusal is never a failed attempt. The
    holders' hostnames and tickets are named only where the caller's key is granted on the
    holder's repository (R-BTN-99). Claims are serialized in the tenant's object, so the first
    to take a free seat holds it.
  - **Releasing.** An `advance` rewrites the claim's `claim_seats` for the leg it starts, and
    the claim's end deletes them. A reap releases its seats at the reap, a fence-pending one
    (R-BTN-19) at `fence-cleared` or the fence deadline.
  - **Seats are no blocks.** A leg rule 11 would refuse is not recommended (§6.6) nor listed in
    `launch-candidates` (R-BTN-99), and `baton leg why` answers `full` for it. Seats write no
    block row and send no `unblocked`: an idle runner finds the leg at its next claim attempt
    (R-BTN-72).
