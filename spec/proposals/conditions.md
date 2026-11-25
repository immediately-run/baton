---
title: "Proposal — conditions: handlers, the suspend wait, calls, cancellation, the outbox and leg events"
description: "The parts of BATON_SPEC §7 that are designed and not built: bindings and handler tickets, the suspend wait and its restart, an owner's resolve of a leg's condition, calls, supersession and the cancel leg, the outbox, the standard handler courses and leg events; with the parts of §6 that depend on them."
---
**Status:** proposal — not built; moves into BATON_SPEC §7 when built (tickets B-55, B-57, B-58, B-59, B-61, B-62, B-65, B-260 among them)

This page holds designs. Nothing here binds Baton as built. What is built is in
[BATON_SPEC §7](../BATON_SPEC/07-conditions.md) and
[§6](../BATON_SPEC/06-prerequisites-blocks-advice.md). Rule ids are labels for the text that would
join the rule when built. A handler ticket, a call's children and every other ticket a runner
writes are written through the ticket source (§12.8).

## 1. Raising: what joins R-BTN-160

- A leg script raises with `ctx.raise(type, {subject, body?, restarts?, default?, wait_s?,
  severity?})` from `@immediately-run/baton/leg` (R-BTN-133); a session's `baton leg raise` takes
  `--wait <s>`.
- `LegError(type, message)` raises an `interrupt` type. A `LegError` naming a `prerequisite` ends
  the claim `released:blocked` (R-BTN-126).
- The standard courses declare `error.no-answer` (`interrupt`, `retryable: false`).
- The raise's report carries `handler?`, and Baton answers a bound raise with the handler's id,
  `handler_id`; the runner then writes the handler ticket under that id. The report's `url` is
  sent only for an unbound `suspend`.
- The runner checks that a raise's `restarts` are the declared ones or a subset of them (a standard
  type with none declared takes the raise's own).
- A settlement costs one write (§2's write budget).
- Dispositions, bound and unbound:

  | Disposition | Bound | Unbound |
  |---|---|---|
  | `interrupt` | The leg ends `released:cannot-finish:<class>`. The retry policy routes the ticket (R-BTN-122). A handler ticket is filed as well, and nothing waits for it. | Same, with no handler ticket |
  | `suspend` | The leg waits for the handler's restart (R-BTN-162) | The debugger is the handler (R-BTN-163) |
  | `notify` | A handler ticket is filed, the raise returns at once and the leg goes on | The raise is only recorded |

- Closing: a bound `interrupt` or `notify` closes when its handler ticket closes; a `suspend`
  closes when its handler ticket closes `done` or `withdrawn`, or an owner resolves it
  (R-BTN-163).
- An autonomous leg's `error` is routed by its retry policy, never by a `"replaces": "retry"`
  binding (R-BTN-195).

## 2. Handlers

- R-BTN-161 (proposed): bindings choose a handler course; the handler is a ticket.
  - **Binding.** A binding maps a type prefix to a course id, for example
    `"conditions": {"hitl": "ask", "warning": "announce"}`; for an `error` type the value may be `{"course":
    <id>, "replaces": "retry"}` (R-BTN-122). It is written in one of two scopes:
    - the repository's scope, in `.baton/baton.json`;
    - a ticket's scope, in its file (`conditions:`, posted by the ticket source as
      `tickets[].conditions`). A ticket's binding applies to that ticket and to every ticket
      below it.
  - **Resolution.**
    - The runner resolves a raise from the verified home tree at the claim's commit (R-BTN-133).
    - It walks scope by scope from the innermost: the raising ticket, its parent and on to the
      root, then the repository.
    - Within a scope the longest matching prefix wins, and the first scope with a match wins.
    - No match leaves the condition **unhandled** (R-BTN-163).
    - The resolved course and its scope are written into the handler ticket and the activity.
      `baton leg why` and `baton course test --bindings` print, for each type a course may
      raise, the course it resolves to and the scope that supplied it.
  - **Who may bind.** Anyone who can push may bind (R-BTN-66). Only default-branch code runs
    (R-BTN-143), so a binding on an unmerged branch binds nothing. No owner setting gates a
    binding. A binding of `interact` is ignored, as `interact` is delivered from Baton's list
    (R-BTN-195), and so is a binding of `baton` or `baton.*`: Baton's own conditions are delivered
    from Baton's list, never through a ticket (R-BTN-163).
  - **The handler ticket.**
    - The runner writes the handler ticket to the ticket source first, through its `file(ticket)`
      export (R-BTN-74; the markdown source writes and pushes `<items>/<local id>.md`), its id one
      Baton itself names — the raising ticket's id and its own count of conditions raised, never a
      scan (R-BTN-131). It is written before the raise returns or the leg ends; on a source with
      no `file`, the raise fails, naming the export. Where the ticket lands and when it is claimable is
      the source's (§12.8).
    - Its id is the raising ticket's local id, then `.c`, then Baton's count of conditions raised on
      that ticket so far (`R3-1205.c3`), returned as `handler_id` by the raise's report. When that
      would break the ticket-id rule's 64 characters, the id is `c<condition_id>`. Ids ending
      `.c<n>` or of the form `c<n>` are reserved: the markdown source skips a file carrying one
      without a `handles` block, with a sync warning.
    - Its frontmatter names `course` (the resolved course), `parent` (the raising ticket),
      `handles: {type, disposition, restarts, default?, severity?, wait_s?, condition_id}` and
      `raised_by: {leg, run}`. Its body is the subject and body the leg supplied.
    - It is a child (R-BTN-86), so R-BTN-149's four-generation bound applies. From then on it is
      an ordinary ticket.
  - **A handler course's contract.**
    - Its input (R-BTN-111) is a **`std:condition@1`**: `{type, disposition, restarts, default?,
      severity?, raised_by: {ticket, leg?, run?}, question: <std:git.file@1>}`, `question` the
      handler file.
    - A course bound to a `suspend` type, or to an `interrupt` type with `"replaces": "retry"`
      (R-BTN-122), **asks through a person's leg** (R-BTN-116): every path of its graph from
      `start` to an end passes a person leg, or that leg's expiry reaching an end station (the
      `ask` shape), the course's `cancel` leg not counted (R-BTN-69); `baton course test` refuses the binding otherwise. The
      person leg's options are the condition's `restarts` (R-BTN-116), and the restart the raiser
      resumes with is the applied answer's `option` (R-BTN-162). The standard `ask` course is the
      model (R-BTN-169).
    - What a handler of a `notify` type, or of an `interrupt` type not bound with `"replaces":
      "retry"` (R-BTN-122), produces is not read.
  - **Delivery runners.** Reaching a person is a runner with a capability, not a key role. A
    handler course declares the capability types its delivery legs need (R-BTN-121), such as
    `channel:push`, or `channel:email` with `credential:SMTP_URL`. Core names none of them. A
    runner that only delivers has a key granted, with its tags barred, for delivery courses alone
    (R-BTN-60, R-BTN-66).

- R-BTN-162 (proposed): a suspended leg waits in its claim, then blocks; it resumes with a restart.
  - **In the claim.**
    - After the handler ticket is pushed, the runner keeps the claim and heartbeats as usual. It
      records an activity `condition-wait` naming the handler, shown on **Running** and by
      `baton leg why`.
    - It waits up to `wait_s`: the raise's value, else the type's declaration, else 120 s for
      `hitl` and 0 for every other type; never more than 900 s.
    - The wait counts toward the leg's deadline (R-BTN-167).
  - **The restart.** A `suspend` condition settles once, in one transaction, with a
    **`std:restart@1`** `{restart, reason, answered_by?}` Baton forms; whatever happens to the
    handler after that settles nothing more:
    - the handler ticket's person leg is answered (R-BTN-116): `restart` the answer's `option`,
      which must be one of the condition's `restarts` — Baton holds them, and refuses any other
      `option` `invalid-params` (the sync's answer is dropped `answer-invalid`) — `reason:
      "chosen"`, `answered_by` the answer's;
    - the handler ticket's person leg expires (R-BTN-116), its expiry reaching an end (R-BTN-161):
      `restart: null`, `reason: "unanswered"`;
    - a snapshot posts the handler withdrawn or closed, or Baton supersedes it (R-BTN-168), before
      an answer: the raise's `default` (null when it named none), `reason: "withdrawn"`, in the
      transaction that accepts the post or decides the supersession, before any `cancel` leg runs;
    - an owner resolves the condition (R-BTN-163): the chosen restart, `reason: "resolved"`,
      `answered_by` the owner's credential.
  - **Settling within the wait.** The in-claim path needs a runner to run the handler's first leg
    (`ask`'s `open`) within `wait_s`, so that its person leg is queued; a repository that wants it
    runs a runner with the handler courses' capabilities. In the settling transaction Baton queues
    a `handled` message for the raiser's holder and rings it (R-BTN-91). The heartbeat answers `handled: [{condition_id,
    handler, restart, reason, answered_by?}]`, inline; `ctx.raise` returns `{restart, reason,
    answered_by?}` and the leg goes on in the same session. In a session, `baton leg raise
    --wait` blocks for the wait and prints the restart or `suspend`. A harness that bounds a
    single tool call calls `baton leg await <handler> --timeout <s>` again until the wait is
    spent.
  - **Past the wait, the leg blocks.**
    - `ctx.raise` returns `{suspended: true}` and the script returns.
    - The runner pushes the work done so far, calls `handoff` (R-BTN-44) and ends the claim
      `released:blocked` with the prerequisite `{kind: "condition", ref: <condition_id>}`
      (R-BTN-120, R-BTN-126).
    - The prerequisite is met when the condition settles (above).
    - Its row is provisional on the commit that wrote the handler. A condition already settled
      when the end arrives writes no row, so the next claim resumes at once.
    - A blocked end is not a failed attempt. It counts toward `max_blocked` (R-BTN-126).
  - **Any other way the wait ends, the leg blocks too.** Any end of a claim waiting on an open
    `suspend` condition other than the one that consumes its restart — a release for any reason
    (`requested`, `owner-cancel`, an owner bar, `leg-timeout`), a `cannot-finish` end — and any
    reap of it, `leg-timeout` included, writes the `condition` block on the leg in that
    transaction, as the blocked end would. It is not provisional: the handler commit was pushed
    before the wait, or there is none (unbound). So no claim of the leg runs, and asks again,
    while its question is open; the condition and its handler stay as they were.
  - **Resuming.**
    - On `unblocked` (R-BTN-77) any runner eligible for the leg may claim it.
    - The claim response carries `resume: [{condition_id, type, handler?, restart, reason,
      answered_by?, handoff?}]`, every settled `suspend` condition of the leg that no end of a
      claim has consumed, in raise order, `handoff` as a pointer. The script reads `ctx.resume`
      before anything else. An end of the leg's claim marks them consumed.
    - A condition that settles after its holder died, or whose consuming claim is reaped before
      its end, is carried to the next claim the same way until an end consumes it.
  - **No answer.**
    - The leg decides what `restart: null` means. Typically it raises `error.no-answer`, and the
      retry policy holds the ticket.
    - A retry runs the leg from its hand-off. If the leg raises again, a fresh handler ticket
      asks the question again.
  - **One at a time.** A leg awaits one `suspend` condition at a time. The `notify` conditions it
    raises in the meantime are not waits.

## 3. The debugger: what joins R-BTN-163

- A person leg's Needs-you entry takes the answer, unconfirmed (§11.4), where the policy admits an
  `owner` writer for `std:decision@1`, else names `baton decision answer` (R-BTN-116).

  - **An unhandled `suspend` condition** waits in the claim and then blocks as R-BTN-162 says,
    with the debugger in the handler's place; its `condition` row is not provisional, since no
    handler commit exists.
  - **Resolving.** An owner answers a `suspend` condition with `baton ticket resolve <ticket>
    <restart>` (R-BTN-127), or the dashboard's equivalent, which is the registry action
    `ticket.resolve`; never a delegated key (R-BTN-130).
    - The command closes the condition with a restart the condition offers and no other.
    - A leg-raised condition resumes with `{restart, reason: "resolved", answered_by: <the
      owner's credential>}` (R-BTN-162). A resolve supersedes the condition's handler ticket, if
      any (R-BTN-168).
  - A `baton.retries` or `baton.contract` condition also offers the restart `route:<leg>`, which
    re-routes to a leg leaving the station (R-BTN-83) and clears the hold; `baton.stalled` offers
    it too.
  - A delivery runner polls the list with `person=1` for what waits on a person, with
    `type=baton` for Baton's notices and with `type=interact` for interaction requests, and sends
    each entry it has not yet sent: for a `suspend` condition its type, severity, detail and
    resolve link; for a person leg its ticket, `asks`, options and question link; for a `notify`
    condition its type, severity and detail; for an `interact` condition its ticket, leg and
    `url`. The `resolve_url` of `GET …/conditions` is the resolve page's path.
  - **The floor, which no binding removes.**
    - **Needs you** and `baton decision list --all` list, until each closes and whatever its
      handler does:
      - every open `hitl` and `hitl.*` condition;
      - every open `baton.retries`, `baton.contract` and `baton.stalled` condition;
      - every queued person's leg with its question (R-BTN-116).
    - **Needs you** also lists any `suspend` condition whose handler ticket has had no leg run
      for 24 hours.
    - A handler course can only add channels above the floor.
  - **Reading the list.**
    - `baton decision list` reads `GET /v1/repositories/{repository}/conditions?open=1&person=1`:
      the open `hitl`, `hitl.*`, `baton.retries`, `baton.contract` and `baton.stalled`
      conditions and the queued person legs, with their links and resolve pages. It marks
      nothing, and `--watch` asks once a minute.

## 4. Retries: what joins R-BTN-122

A binding of an `error` type adds a handler ticket beside the retry policy and does not replace
it, unless the binding says `"replaces": "retry"`: then the binding is a `suspend` binding for
R-BTN-161 and R-BTN-162 — the handler asks through a person leg whose options are `retry`,
`route:<leg>` and `park`, Baton forms the restart as R-BTN-162 says, and the restart decides in the
policy's place, checked against the owners' bounds — and the leg ends blocked on the condition as
a `suspend` would. Only the runner knows the binding, so it reports the raise with `replaces:
"retry"` and ends the claim `released:blocked` on the condition, never `cannot-finish`. A
`suspend` wait in a claim lasts at most 900 s (R-BTN-162), a constant.

## 5. Timers: what joins R-BTN-167

`stalled_s`, a leg field (60 s to 30 days), would let a course set how long the leg may be posted
`waiting` before `baton.stalled`; built, the time is a constant (R-BTN-167). Baton would hold the
`stalled` and `expires` instants in one table, `ticket_timers` (repository, ticket, leg, `kind`,
`from_at`, `due_at`, `fired_at`), fired from the alarm once per `from_at`.

## 6. Calls

- R-BTN-165 (proposed): a call leg runs a course and waits for it.
  - **The leg.** A call leg is `"kind": "call"` with a `spawns` declaration (R-BTN-111), whose
    `course` names the course or courses it calls. The leg's `"to"` is a **completion table**
    `{<station>: <completion>, …}`, checked in order. A question to a person is not a call: a
    planned one is a person's leg (R-BTN-116), one from inside a leg a `suspend` raise
    (R-BTN-162).
  - **What the script does.**
    - The script runs as any leg's does and writes the children to the ticket source first,
      through its `file` export, each child's id taken as R-BTN-131's allocator says. Each child names a course its `spawns` allows and `called_by: {leg, run}`. Where they land and when
      they are claimable is the source's (§12.8).
    - The script then returns `spawned` (R-BTN-86).
    - The runner then ends the claim `released:blocked` on `{kind: "call", ref: <claim_legs
      seq>}`, carrying `spawned` (R-BTN-86). A call never waits in its claim: Baton learns the
      children only from that end. The block is not a failed attempt and does not count toward
      `max_blocked` (R-BTN-126).
  - **Completion.** A `<completion>` is `{"of": "all" | "any" | <n>, "at": [<station>…],
    "skip_withdrawn"?: <bool>, "next": <leg>}`.
    - `at` may be replaced by `"done": true` (closed at any end station), `"withdrawn": true`
      (closed withdrawn) or `"closed": true` (closed either way). `at` names stations every
      course the call may spawn has; a call over `"*"` uses the other three.
    - `next` is the leg queued at the entry's station. It is required unless that station is an
      end (R-BTN-83).
    - An entry may be `null`: its station is an outcome the script may report instead of
      `spawned`, and no completion settles there. A call leg's outcomes are its table's
      stations.
    - A completion ranges over the children this run spawned (R-BTN-86), and only a completion
      does: no `requires.tickets` entry selects them (R-BTN-120).
    - Examples: `{"of": 2, "at": ["approved"]}` is "2 of 3 reviewers approve".
      `{"of": "all", "at": ["merged"]}` followed by `{"of": "any", "at": ["failed"]}` is a
      fail-fast join. `{"of": "all", "closed": true}` waits for every child however it ends, as
      `Promise.allSettled` does.
    - A completion over a call whose script filed no child never holds; a script that files none
      returns one of the leg's outcomes instead of `spawned`.
    - The table's last non-null entry is `{"of": "all", "closed": true, …}`, which holds once
      every child has closed, so a call always settles; the validator (R-BTN-69) and `baton
      course test` refuse a table without it.
  - **Settling.**
    - Baton evaluates the table, in table order, in each transaction that changes the station of
      one of the run's children. The first entry that holds settles the call.
    - A `spawned` end that names no children is refused; a completion never holds over none.
    - Baton records the position (the entry's station and `next`), with `next_source: baton`,
      and logs `call-settled {station, children}` — only while the ticket is still at the call
      leg's station, which R-BTN-39's hold on a blocked ticket guarantees.
    - The position stands (R-BTN-39). The CLI's station-function library exports
      `settleCall(course, leg, children)`, which applies the same table, for a course's implied
      station.
    - The children still open when the call settles are superseded (R-BTN-168).
  - **What the next leg reads.** The settled children's end outputs are the next leg's input
    `called`, resolved as pointers (R-BTN-82). The call's `spawns` declaration (R-BTN-111) is its
    contract. `baton course test` checks what the declaration provides against each called
    course's input, and what each completion station requires against each called course's end
    outputs.
  - **A `suspend` raise is a call from inside a leg.** It has one child, it settles when that
    child closes, and its `raised_by` takes the place of `called_by`. It keeps its own block kind
    `condition`, which counts toward `max_blocked` (R-BTN-126).

## 7. Cancellation

- R-BTN-168 (proposed): supersession, lifetime and the cancel leg.
  - **The cancel leg.** A course may name `"cancel": <leg>` (R-BTN-69): an ordinary leg that
    undoes the course's work outside git — closes a PR, deletes a branch, retracts a message —
    leaving every station a ticket may be cancelled at and reaching one end station. Baton alone
    queues it (`next_source: baton`, held until the station changes, R-BTN-83), when a ticket is
    cancelled; a runner holding its capabilities runs it like any leg, and it may be run again
    after a release, so it is written to succeed when its work is already done. A course with no
    `cancel` leg has nothing to undo: a cancelled ticket closes at once.
  - **Lifetime.** A spawning leg's `spawns` (R-BTN-111) may give its children `"lifetime":
    "parent"`, ending them when their parent closes or is cancelled, or `"lifetime": "station"`,
    ending them when the parent leaves the station they were filed at. Without `lifetime`,
    children live on (R-BTN-86).
  - **Cancelled.** A ticket is cancelled when its file says withdrawn (R-BTN-74) or when Baton
    **supersedes** it because:
    - a call settled without it (R-BTN-165);
    - the condition it handles closed by other means: an owner resolved it, the cause ended, or
      the raising ticket was cancelled;
    - its `lifetime` ended;
    - its source stopped posting a ticket that has no file (the `changes` source, R-BTN-114).
  - **Superseding.** In the transaction that decides it, Baton:
    - sends any running claim on the ticket a `release` with reason **`superseded`**. The runner
      stops as R-BTN-119 does, without a hand-off. The claim ends `released:superseded`, which is
      not a failed attempt.
    - marks a completed claim on the ticket still unconfirmed `superseded_at`: it is never
      confirmed, concludes nothing (no `baton.check-unattested`), counts no attempt, and no
      longer holds rule 3 or raises `baton.unconfirmed`;
    - logs `superseded {by}`;
    - marks the ticket **`cancelling`** (`ticket_overrides.cancelling_at`, §6.8), a flag beside any
      hold it carries, which no owner lifts and which is cleared when the ticket closes, never kept
      past it (so a returning id gets its hold back, not the cancellation, R-BTN-12): the ticket
      shows `cancelling` until it closes, and the flag refuses every leg but the ticket's queued
      `cancel` leg (§6.6, rule 3); an unlanded `withdraw` entry raises `baton.outbox-late` without
      changing it (R-BTN-171).
  - **Then the cancel leg, then the close.** For a cancelled ticket whose course names a `cancel`
    leg leaving its station, Baton queues that leg, `ready` at once (R-BTN-69), and a runner
    holding its capabilities claims it like any leg. In the transaction that records the run's
    `done` end at the leg's end station (confirmed by acceptance alone, R-BTN-10), or at once for a
    course with no `cancel` leg leaving the station, Baton closes the ticket:
    - a ticket still live in its source waits for its withdrawal: where the post's
      `source.writes` names `withdraw`, Baton queues the `withdraw` outbox entry (R-BTN-171);
      where it does not, the ticket waits for its store's own closure, shown on its view. It
      closes `withdrawn` when a snapshot posts it withdrawn or closed;
    - a ticket withdrawn in its source already, or one its source no longer posts, closes
      `withdrawn` at once.
  - **Withdrawn in the source first.** A ticket a snapshot posts withdrawn whose course names a `cancel`
    leg leaving its station, and whose path ran a leg that leg undoes (any leg whose `to` the
    cancel leg leaves), is kept live and `cancelling`: its board rows stay (§13), the `closed`
    entry is kept and applied when the cancel leg's run ends, and no snapshot stales the leg's
    claim (R-BTN-35). One whose path ran none closes at once.
  - **Cascade.** Cancelling a ticket supersedes its open children whose `lifetime` is `parent`.

## 8. The outbox

- R-BTN-171 (proposed): every git write, check run and ticket-store write Baton intends goes through one outbox, which runners deliver.
  Baton holds no credential that writes git, posts a check run or writes a ticket store; starting
  a workflow is its own call (R-BTN-94). Each git write, check run or ticket-store write Baton
  intends is an **outbox entry**. A
  **deliverer** — a runner (R-BTN-3) whose host holds the credential the effect needs, on a grant
  whose role the repository policy's `outbox` admits (R-BTN-188) — claims the entry under a lease,
  delivers it and reports it with a `std:effect@1` attestation (R-BTN-191); Baton then confirms it
  by reading the effect back, in a snapshot, wherever the ticket source's reader posts it.
  - **Entries.** Each entry is an `outbox` row: `id` (an integer per repository, increasing),
    repository, ticket, `kind`, `fields`, `state` (`queued`; `claimed` while a deliverer's lease
    holds it; `delivered`, `confirmed` or `dropped`), `queued_at`, `delivered_ref` (the
    commit or the check run) and `confirmed_at`. `fields` holds identifiers only (§12.3), and for
    `forge-check` its `summary` rendered `plain` (R-BTN-112). An entry is Baton's record, handed
    out over its authenticated routes and signed by nothing (§12.8).

    | `kind` | Delivers | Order | Confirmed when | Late |
    |---|---|---|---|---|
    | `withdraw` | the withdrawal of a cancelled ticket (R-BTN-168), through the source's `withdraw(ticket, reason)` export (the markdown source sets `status: withdrawn` and `withdrawn_reason`) | a log, per ticket | a snapshot shows the ticket withdrawn or closed | not confirmed 24 hours after it was queued |
    | `forge-check` | a check run on a change's head (R-BTN-114, R-BTN-115) | the latest, per `(repository, sha, name)` | the sync reads the run back (R-BTN-115) | not delivered 15 minutes after it was queued |
    | `withdraw` on a custom source | as above, through the source's own `withdraw` export, to its store (git for an ejected markdown source) | a log, per ticket | as above | as above |
    | `source-show` | a station's `display_status` to a ticket store (R-BTN-200), through the source's `show(ticket, value)` | the latest, per ticket | as R-BTN-200 says | not delivered 15 minutes after it was queued |
    | `source-note` | a note for people on the ticket (R-BTN-200), through the source's `note(ticket, {entry, reason, station})` | a log, per ticket | at its delivery: no snapshot carries a note | not delivered 24 hours after it was queued |

    `withdraw` on the markdown source is the one **git kind**: Baton files no ticket of its own
    (R-BTN-163). The **source kinds** — `withdraw` on a custom source (`source.kind: custom`,
    §4.4) and the two `source-` kinds — are written through the source's own code to whatever
    store it reads. The kinds make three **delivery classes**: `git`, `forge-check` and `source`.
    Queuing a `withdraw` drops the ticket's `queued` `source-show` and `source-note` entries.
  - **Deliverers are runners.** No key role exists for delivery: a runner that holds the credential declares the classes it delivers in its
    heartbeat (`delivers: [git | forge-check | source]`, nothing by default; kept in `runners.delivers`,
    §13), and Baton offers it the entries of those classes on the repositories its grant covers.
    A deliverer is a signed machine key: an API-key runner never delivers, as it never syncs
    (R-BTN-159).
    - **Who may deliver** is the repository policy's `outbox` section (R-BTN-188), one entry per
      class, `{deliverers}` naming the grant roles admitted: `runner` (any accepted grant) or
      `trusted-runner` (R-BTN-182; never a grant marked `checker`, R-BTN-180). Baton applies it at
      each claim, so a change binds the next
      claim and never a lease already held, and refuses a claim from a grant the policy does not
      admit, `forbidden` with the unmet knob.
    - The credential the effect needs lives only on the deliverer's host, never in Baton: push
      access to the repository for `git`, the check App's private key for `forge-check`
      (R-BTN-115), and for `source` the credential the source's store needs — push access for an
      ejected markdown source, a tracker's write token for a tracker.
    - Admitting `runner` for `source` lets a runner holding that credential withhold a show or a
      note, or mark a note delivered unwritten. A show it fakes is caught as unconfirmed
      (R-BTN-200).
    - **Woken, not polling.** A deliverer's doorbell socket (R-BTN-91) is rung `outbox` when an
      entry of a class it delivers is queued on a repository it serves; it then claims at once.
    - Admitting `runner` for `forge-check` lets any granted runner withhold a check. It still
      cannot post one Baton did not issue unseen (R-BTN-115).
    - **A trusted-runner deliverer runs no repository code.** It never loads the source's code:
      it writes from the CLI's own markdown-source templates, so it delivers no source entry,
      which only the source's own code can write. Every outbox write of a custom source
      (`.baton/tickets.mjs`, an ejected markdown source included) is a source entry, waiting for
      a `runner` deliverer; a policy admitting none there is refused (R-BTN-188).
  - **Claiming and marking.**
    - `POST /v1/runner/outbox/claim {limit?}` claims up to 50 queued entries, each leased for 10
      minutes, of the classes the caller declared and the `outbox` policy of each repository its
      grant covers admits it to.
    - A ticket's entries of one class are claimed together, in `id` order, and none while an
      earlier entry of that ticket and class is `claimed` or `delivered`. Entries of different
      tickets or classes are unordered.
    - `POST /v1/runner/outbox/{repository}/{id}` marks one: `delivered` with its `ref`, or
      `failed` with `transient` or `refused`. `failed` is a mark, not a state: the entry returns to
      `queued`, after a backoff for `transient` and, for a git or forge-check entry, with its
      ticket held for `refused`, as for a source `withdraw`; a `source-show` or `source-note` marked
      `refused` is R-BTN-200's.
    - A lapsed lease re-queues the entry. A mark arriving after its lease lapsed is accepted. A mark
      from any credential but the claimer is `forbidden`. An entry the claimer leaves unmarked goes
      back to `queued` when its lease lapses.
    - `transient` re-queues the entry after 1, 5 and 30 minutes, then hourly.
    - `refused` on a `withdraw` or `forge-check` entry (the forge or store refused the deliverer's credential, a misconfiguration) holds the entry's
      ticket (`hold_reason: outbox-refused`) and raises `baton.outbox-late` naming the deliverer,
      until the deliverer is fixed and the hold lifted by an approver on `approvers.policy`
      (R-BTN-186, R-BTN-188), which queues the entry again.
  - **Idempotence.** Every delivery carries its entry's id, so delivery is at least once and its
    effect at most once.
    - `withdraw`: the withdrawal writes `baton_write: <id>` beside `status: withdrawn`. Before
      writing, the deliverer reads the file at
      the freshly fetched head it writes to: the branch the source writes to (§12.8). A file that already carries the id, or for
      `withdraw` already says withdrawn or is absent, is not written again, and the deliverer reports
      the head's commit. On a rejected push it fetches, checks and writes again, at most 3 times,
      then marks the entry `failed` with `transient`.
    - `forge-check`: the check run's `external_id` carries the id, and R-BTN-115's `seq` keeps an
      older entry from overwriting a newer one.
    - `source-show` sets a value, so a repeat writes the same status again; `source-note` hands
      `note` its entry id, which `note` writes once (R-BTN-74).
  - **What Baton holds until a git entry is confirmed.**
    - **Withdraw entry.** The cancelled ticket stays `cancelling` (R-BTN-168) until a snapshot
      posts it withdrawn or closed, which closes it `withdrawn`.
    - **Delivered, not confirmed.** A `delivered` entry is never claimed again. A `withdraw` entry still not
      `confirmed` after 3 accepted snapshots at or after its delivery raises `baton.outbox-late`; a
      `withdraw` entry's ticket, already `cancelling` (R-BTN-168), stays so, and the condition's
      `retry` queues the entry again.
  - **Dropping.** A `withdraw` entry for a ticket whose course names a `cancel` leg is queued in
    the transaction that records that leg's end (R-BTN-168). A `withdraw` entry whose ticket a snapshot shows
    withdrawn or closed before any deliverer claimed it is `dropped`, and so is a source entry
    whose ticket closed before its delivery. Retiring a repository drops
    every `queued`, `claimed` or `delivered` entry of it, and a later mark is ignored (R-BTN-47).
  - **Records.**
    - Queuing, delivering and confirming each log an `outbox {id, kind, state}` event in the
      ticket's history.
    - An entry late by its kind's column above raises `baton.outbox-late` (R-BTN-163) with its
      `kind`, a late `source-show` or `source-note` being R-BTN-200's; for `forge-check` the change stays pending.
  - **Not in the outbox.** Positions that start in Baton are Baton's (R-BTN-39), held until the
    station changes: a call's settlement (R-BTN-165), a person leg's expiry (R-BTN-116), an
    `exhausted` leg (R-BTN-122) and the `cancel` leg (R-BTN-168). Messages to runners ride the
    heartbeat (§6.9). A workflow dispatch is Baton's own call, made with the credential Baton
    holds for it (R-BTN-94, §12.7).

## 9. Standard handler courses

- R-BTN-169 (proposed): standard handler courses: `ask`, `deliver` and `announce`. These are three
  course directories in the baton repository under `src/defaults/courses/` (R-BTN-134). A
  repository binds them, overrides their legs (R-BTN-131) or writes its own.
  - **`ask`**, for `hitl`, takes a `std:condition@1` as input and asks through one person's leg
    (R-BTN-116, R-BTN-161).

    ```json
    { "start": "asked", "start_leg": "open", "end": ["answered", "unanswered"],
      "stations": { "asked": {}, "waiting": {}, "answered": {}, "unanswered": {} },
      "legs": {
        "open":   { "from": ["asked"],   "to": "waiting",
                    "spawns": { "course": "deliver", "lifetime": "parent" } },
        "answer": { "from": ["waiting"], "to": ["answered", "unanswered"],
                    "kind": "person", "asks": "owner",
                    "expires": { "after_s": 172800, "reached": "unanswered" } } } }
    ```

    - `open` files a `deliver` child for the question. The `answer` leg's options are the
      condition's `restarts` from the moment the handler is posted (R-BTN-116); the markdown
      source posts its question from the handler file's `handles.restarts`, each option reaching
      `answered`.
    - A person answers with a `std:decision@1` naming a restart as its `option` — from the
      dashboard's Needs-you entry or `baton decision answer` (R-BTN-116) — or, where the policy admits `sync`
      for `std:decision@1`, in the ask's own file (`answer: b`, the markdown source's `answer`
      field, R-BTN-74), which the sync attests. The raiser resumes with that restart, `reason:
      "chosen"` (R-BTN-162).
    - Unanswered for two days, `answer` expires to `unanswered`, and the raiser resumes with
      `restart: null`, `reason: "unanswered"`.
    - When the ask closes — answered, expired, withdrawn or superseded — its `deliver` child is
      superseded and runs its `cancel` leg, `retract`; the ask itself has nothing to undo and
      names no `cancel` leg.
    - The raise's `wait_s` is in the input, so `deliver` can use the fastest channel when a leg
      is waiting in its claim.
  - **`deliver`**:
    - It has stations `queued` and `pushed`, and ends `lapsed` and `emailed`; its `cancel` leg
      is `retract`, idempotent, which retracts the message.
    - `push` (`queued` → `pushed`) needs the capability `channel:push`. Its policy is
      `"retry": {"max_attempts": 3, "backoff_s": 60, "exhausted": "email"}`.
    - `lapse` (`pushed` → `lapsed`) is queued by `push`'s `close` with `not_before` an hour after
      the push. It retracts the message.
    - `email` (`queued` → `emailed`) needs the capabilities `channel:email` and
      `credential:SMTP_URL`.
    - An email that cannot be sent holds the ticket under the retry policy, and the question
      stays on the floor.
    - The shipped scripts send a generic signed webhook and SMTP mail. A repository overrides
      `push` and `retract` for its own channel.
  - **`announce`**, for `warning` and `error`, has one leg, `send`, which needs the
    capability `channel:push`. Its ends are `sent` and `undeliverable`. It never handles
    `baton.*`, which no ticket carries (R-BTN-163).
  - **Binding them.** `baton repo init --bind-conditions` writes `{"hitl": "ask", "warning":
    "announce"}` into `.baton/baton.json`. Without that option a repository binds nothing, and
    every leg-raised condition reaches the debugger.

## 10. Leg events

- R-BTN-198 (proposed): leg events: what Baton tells a running leg.
  - **A leg event** is a typed event the runner hands to a running leg, from what Baton tells the
    runner. Its type follows R-BTN-160's grammar. It runs the other way from a condition, and the
    leg is its only handler: no binding, handler ticket, `conditions` row, Needs-you entry or
    quota applies (R-BTN-160 to R-BTN-163). The types are core's, `ticket.changed` and
    `release`. Leg event types and condition types are separate namespaces: nothing raises a leg
    event, and no condition is handed to a leg.
  - **Delivery.** The runner keeps one queue per leg run, readable until the run's `close` and
    `handoff` have returned; events still unread then are dropped. A leg running as a script
    under `builtin` (R-BTN-107) has each event handed to every listener it registered with
    `ctx.on(<type or prefix>, listener)` (R-BTN-72), and reads the queue by the async iterator
    `ctx.events`; any leg reads it by `baton leg events [--wait <s>]` on its channel (R-BTN-106,
    JSON lines, `--wait` at most 900). The two readers share one cursor, each event once. An
    event carries identifiers and the release reason only, never ticket text (R-BTN-33). When
    one heartbeat brings a claim both a `release` and a new version, only `release` is handed. A
    context refresh (R-BTN-123) hands the fresh session the run's newest `ticket.changed` again,
    when the run has one.
  - **Sessions poll.** The executor interface (R-BTN-107) pushes nothing into a session: a
    session learns of its events only by `baton leg events`, which its brief tells it to call. A
    leg script that runs an agent may pass its events on to it as text naming the event's type,
    its versions and the verbs below, never ticket text.
  - **`ticket.changed {from_version, to_version, snapshot_sha}`: the ticket moved under the
    claim.**
    - **Which claims.** Every claim with a ticket, except the two R-BTN-5 re-verifies against
      Baton's record (a `changes` check ticket and a claim of the `cancel` leg): for those Baton
      logs and rings nothing below, the runner hands no `ticket.changed`, and their legs'
      `on_ticket_changed` is ignored.
    - **Baton's half.** In the transaction that accepts a snapshot (R-BTN-62), whatever its
      observation, for each ticket an active claim holds whose posted `version` (§4.2) differs
      from the one Baton held, and which the snapshot leaves held (R-BTN-35), Baton logs
      `ticket-changed {from_version, to_version}` with the claim (R-BTN-81), and rings the holder
      `ticket` after the commit (R-BTN-91). A snapshot that ends the claim is told as that claim's
      `release`, and logs and rings nothing here. The heartbeat carries each claim's ticket as
      the latest accepted snapshot holds it (§8.1). Versions are compared for equality only.
    - **The runner's half.** Per claim the runner keeps the version **last seen** and the version
      **last verified**, each with its snapshot's sha. Both start as the claim's version once
      R-BTN-5 passes. While a leg runs, a heartbeat `version` that differs from the last seen is
      handed as `ticket.changed`, its `from_version` the last seen, and becomes the last seen.
      Several changes between two heartbeats are one event, to the newest version, and none when
      the newest is the last seen. A change is the leg's own, and becomes the last seen without
      being handed, only on the markdown source and only when every commit that changed the
      ticket's file between the last seen version's sha and `snapshot_sha` is one this claim's
      legs pushed, as the leg-end scope audit reads pushes (R-BTN-106). Like that audit, the test
      is cooperative. Every other change, on every source and under every executor whose pushes
      the runner cannot read, is handed, a forge merge of the leg's own branch included; a course
      whose legs change their own ticket keeps `continue`. A heartbeat whose `git` view says
      `closed: 'done'` hands nothing: the claim ends `done` after its leg, as R-BTN-72 says.
    - **Verifying a version.** The runner verifies a version as R-BTN-5's re-verification by
      version reads it, at that version and `snapshot_sha`: the sha checked on the default branch
      first (R-BTN-143), the source's code loaded from the claim's commit (R-BTN-133), the ticket
      read where R-BTN-5 reads it (the branch's head for a course that keeps its record there),
      and, on the markdown source, the version required to be the blob at the ticket's path at
      `snapshot_sha`. It refuses, with these reasons:
      - `off-branch`: `snapshot_sha` is not on the default branch (R-BTN-143);
      - `closed`: the version is closed or archived;
      - `bounds-changed`: its `repos`, `course` or `requires` differ from the claim's, since they
        bound the claim's scope, course and runner (§12.9, R-BTN-121);
      - `moved`: a current source holds a newer version, or a markdown version is not the blob at
        `snapshot_sha`;
      - `unreadable`: the source exports no `read` (§4.2), or it or the executor could not
        answer, which is never taken as a moved ticket.

      Readiness is not checked: the leg's own progress moves it, and the holder judges it
      (R-BTN-63). The runner keeps each result for the claim.
    - **Before a leg starts.** R-BTN-5's check comes first, at the claim's version. After it,
      when the latest heartbeat's `version` differs from the last verified (a change while no leg
      ran, or during preparation after R-BTN-5's read), the runner verifies that version before
      the leg starts. A version that passes becomes the last seen and the last verified, and the
      leg reads it. `off-branch` ends the claim `released:off-branch`; a version closed `done`
      ends it `done` (R-BTN-72); the other `closed` cases, `bounds-changed` and `moved` release
      `stale-board`; `unreadable` ends it `released:cannot-finish:transient` (R-BTN-122). The
      `advance` that starts a leg names the version the leg starts on (`ticket_version`, §14).
    - **What the leg does** is its course's choice, the leg field `on_ticket_changed`
      (R-BTN-69):
      - **`continue`** (the default): the leg goes on. It may read a version handed to it by
        `ctx.readTicket({version?})` or `baton leg ticket [--version <v>]` (default the newest
        handed, refused `unknown-version` when none was, or when this claim never handed the
        version named). The runner verifies the version, then returns its
        `last_written_by` (R-BTN-194), printed first as at the claim, and the ticket as
        R-BTN-5's read returns it, a pathless ticket's `file` included (R-BTN-74). A refusal is
        answered on the channel with its reason, and the leg goes on with the text it has. The
        claim's scope and `ctx.ticket` stay as they were. The verbs read only the claim's own
        ticket. A leg handed a `ticket.changed` in this run may end itself with the release
        reason `ticket-changed`, on the channel or in its result; the runner refuses that reason
        from a run it handed none.
      - **`restart`**: when `to_version` differs from the version the leg started on, the runner
        stops the leg at once, as R-BTN-119 stops a `requested` release (`close` and `handoff`
        included), and ends the claim `released:ticket-changed`. The validator refuses `restart` on a leg with
        no `max_runs` (R-BTN-69). A leg waiting on an open `suspend` condition ends as R-BTN-162
        says of any release, blocked on that condition.
    - **The end.** A `released:ticket-changed` end names the `to_version` the runner handed in
      its `ticket_version` (§9.4). Baton accepts it only when a `ticket-changed` row of the claim
      carries that version and it differs from the `ticket_version` the running leg's `advance`
      named; it refuses the end otherwise `invalid-params`. A claim ending for a `release` Baton
      sent with the reason `ticket-changed` (an owner bar set before that reason was closed,
      R-BTN-67) ends as that release, and this check does not apply. It is not a failed attempt.
      The run counts toward the leg's `max_runs` as every run does (R-BTN-63). The next claim
      reads the ticket under R-BTN-5.
  - **`release {reason}`: why the leg is stopped.** When a `release` message reaches the runner
    (§6.9), whatever its reason, R-BTN-35's staleness and R-BTN-90's deadline included, the
    runner hands `release` with that reason to the claim's running leg, then acts on the message
    as §6.9 and R-BTN-119 say, without waiting for the leg to read the event. The event changes
    neither the stop's timing nor its escalation, and the leg cannot defer or refuse the stop by
    it. A stop the runner makes with no message (`restart`, R-BTN-5's re-verification, a lease
    lost, R-BTN-143, R-BTN-64) hands no `release`. The leg's `ctx.signal` aborts by R-BTN-72.

## 11. What joins §6

- **Prerequisite and block kinds (R-BTN-120, R-BTN-75).**

  | Kind | Declared by | Holds when | `ref` | Written | `why` when unmet |
  |---|---|---|---|---|---|
  | `condition` | a `suspend` raise past its wait (R-BTN-162) | the handler closes, or an owner resolves it | the `condition_id` | by a `blocked` end | `open`, with the handler ticket, or the claim's `condition-wait` activity |
  | `call` | a `kind: call` leg's run (R-BTN-165) | the call settles | the run's `claim_legs` row `id` | by a `blocked` end | `open`, with the run's children |

  Both refuse a claim and an advance (rule 1). A `condition` row a `blocked` end writes is
  provisional on the commit that wrote the handler (R-BTN-75). A `blocked` end on either needs no
  runner check: Baton holds the fact (R-BTN-126). `call` ends do not count toward `max_blocked`.
  The children a call leg's run spawned are its completion table's range, never a
  `requires.tickets` entry.
- **A person leg of a handler ticket (R-BTN-116).** When no options are posted, its options are
  the condition's `restarts`, which Baton holds, each reaching the leg's first listed outcome. The
  standard `ask` course expires its question by the leg's `expires`.
- **Gates (§6.6).** A `cancel` leg Baton queued is `ready` (rule 1). An advance into the course's
  `cancel` leg is refused `cancel-leg` (rule 1). A superseded completed-unconfirmed claim does not
  hold the ticket, and a ticket marked `cancelling` refuses every leg but its queued `cancel` leg
  (rule 3). The matching query admits the `cancel` leg of a ticket marked `cancelling`. A `cancel`
  leg Baton queued comes before every other leg of its repository, in R-BTN-61's merge too.
- **Holds (R-BTN-12).** `outbox-refused` is a `hold_reason` (R-BTN-171). A cancellation is a
  second flag beside the hold, `cancelling`, which no owner lifts; it is never kept with the
  owner state of a ticket that leaves the board. `ticket_overrides` holds the `cancel` leg Baton
  queued until the station changes.
- **Messages (§6.9).** `handled` (R-BTN-162) is a message kind. A `release` with reason
  `superseded` stops the leg at once and leaves no hand-off (R-BTN-168). A leg is told why it is
  stopped before the runner stops it (R-BTN-198).

## 12. Recurring jobs: what joins R-BTN-89

`@immediately-run/baton/leg` exports `nextFire(cron, tz, after)`, `writeSuccessor` and
`NOT_BEFORE_HORIZON_DAYS` (400), the constant `src/core/validate.ts` imports. `nextFire` and
`writeSuccessor` refuse an instant past the horizon, failing the leg `cannot-finish:spec`.

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
