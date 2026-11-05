---
title: "7. Conditions"
description: "A leg that cannot go on alone (it needs a person, it hit an error or it has something to report) raises a condition."
---
## 7. Conditions *(proposal)*

A leg that cannot go on alone (it needs a person, it hit an error or it has something to report)
**raises a condition**. A **binding** chooses the course that handles it, and the handler is an
ordinary child ticket. A `suspend` condition's leg resumes with the **restart** the handler
chooses. A condition nothing handles reaches the **debugger** (**Needs you**). Baton raises
conditions of its own the same way. The same section defines the edges that start or stop other
work (**calls**, **retries**, **deadlines** and **cancellation**) and the **outbox**, through
which runners make the git writes Baton intends.

Limits that hold throughout:

- Core reads no course meaning (R-BTN-50) and runs no repository code (R-BTN-98).
- Baton writes no git, sends no mail and calls no service but a forge's workflow dispatch
  (R-BTN-94). Every git write and every check run Baton intends goes through the outbox, which
  runners deliver (R-BTN-171).
- Baton queues nothing for people. A person is reached one way, by a person's leg (R-BTN-116): a
  `hitl` condition's handler course asks through one (R-BTN-169), and Baton's own conditions are
  answered on their resolve page, which a delivery runner reads from Baton's own list
  (R-BTN-163). No ticket file, outbox entry or deliverer stands between Baton and a person.
- A ticket stays sequential (R-BTN-86). Everything below that runs in parallel is a child ticket.

### 7.1 Raising a condition

- **R-BTN-160 (conditions: typed, declared, raised by any leg).**
  - **Type.** A condition is a typed event that a running leg raises. Its type matches
    `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$` and is at most 64 characters long. The dots form a
    hierarchy: `hitl.spec-contradiction` is a `hitl`, so a declaration or binding for `hitl`
    covers it.
  - **Standard types**:

    | Type | Disposition | Raised by |
    |---|---|---|
    | `hitl` | `suspend` | any leg |
    | `warning` | `notify` | any leg |
    | `error` | `interrupt` | any leg; core's classes are `error.transient`, `error.capability`, `error.spec`, `error.contract-output`, `error.contract-input` |
    | `baton` | per sub (R-BTN-163) | core only |

    Any leg may raise a standard type, or a subtype of one, without declaring it — except
    `baton` and `baton.*`, which are core's alone: the validator refuses a course declaring them
    and Baton refuses a leg's raise of them (`invalid-params`). A leg may also narrow what it may
    raise: `"conditions": []` allows none and `"conditions": ["warning"]` allows only warnings.
  - **Declaring.** A course declares its own types in the course file (R-BTN-69):
    `"conditions": {<type>: {"disposition": "interrupt" | "suspend" | "notify",
    "restarts": {<id>: <description>}, "default": <id>, "wait_s": <n>, "retryable": <bool>, "description":
    …}}`. Only `disposition` is required. A restart id matches §12.3's decision-id pattern. A
    declared subtype of a standard type inherits that type's disposition unless it states its
    own.
  - **Error types are `interrupt` conditions.** The course file has no `error_types`; the
    validator refuses it, along with `max_duration`, `max_attempts_s` and `max_ready_s`
    (R-BTN-69).
    - `retryable` decides whether the retry policy retries the type, for every leg; no policy
      overrides it (R-BTN-122).
    - A course type's class is `transient` when retryable and `spec` otherwise.
    - An exception the script does not type is `error.transient`.
    - `LegError(type, message)` raises an `interrupt` type. The exception is a `LegError` naming a
      `prerequisite`, which ends the claim `released:blocked` (R-BTN-126).
    - The standard courses declare `error.no-answer` (`interrupt`, `retryable: false`).
  - **Signature.** A course's signature (R-BTN-111) lists the conditions its legs may raise: its
    own types and, unless a leg narrows them, the standard ones. `baton course test` prints the
    signature.
  - **Raising.**
    - A leg script calls `ctx.raise(type, {subject, body?, restarts?, default?, wait_s?,
      severity?})` from `@immediately-run/baton/leg` (R-BTN-133).
    - A session in a leg calls `baton leg raise <type> --subject … [--body <file>] [--restarts
      <json>] [--default <id>] [--wait <s>] [--severity …]` on the local channel (R-BTN-106).
    - The runner checks a raise as it checks a move:
      - the type is standard or declared, and allowed to the leg;
      - `restarts` are the declared ones or a subset of them (a standard type with none declared
        takes the raise's own);
      - `default` is one of them;
      - `severity` is valid (R-BTN-125).
    - A raise that fails the check is answered on the channel with the reason.
  - **Dispositions.** Condition, handler ticket, restart and binding are defined above and in
    R-BTN-161:

    | Disposition | Bound | Unbound |
    |---|---|---|
    | `interrupt` | The leg ends `released:cannot-finish:<class>` with `error: {type, message}`, `message` free text under §12.3. The retry policy routes the ticket (R-BTN-122). A handler ticket is filed as well, and nothing waits for it. | Same, with no handler ticket |
    | `suspend` | The leg waits for the handler's restart (R-BTN-162) | The debugger is the handler (R-BTN-163) |
    | `notify` | A handler ticket is filed, the raise returns at once and the leg goes on | The raise is only recorded |

  - **Reported before it takes effect.** The runner reports each raise with `POST
    /v1/runner/claims/{id}/conditions` and the body `{type, disposition, handler?, restarts,
    default?, severity?, url?}`.
    - The body holds filter fields only (R-BTN-33), never the subject or the body. `url` is sent
      only for an unbound `suspend` and points to where git holds the question (the leg's
      evidence or its hand-off), under R-BTN-92's link rule.
    - Baton answers with a `condition_id` and, when `handler` names a course, the handler's id
      `handler_id` (below), and stores the `conditions` row; the runner then writes the handler
      ticket under that id. It records an activity of kind `condition` on the leg run and a
      `condition` event in the ticket's history (R-BTN-81).
    - A claim may hold at most 20 open conditions, and a ticket may raise at most 200 a day.
      Past either limit the request is refused with `quota`.
    - A raise costs two writes and a settlement one (§2's write budget).
  - **Closing.** A condition is open until its outcome is settled:

    | Condition | Closes when |
    |---|---|
    | `interrupt` | it is raised, or, if bound, when its handler ticket closes |
    | unbound leg-raised `notify` | it is raised (outcome `recorded`) |
    | bound `notify` | its handler ticket closes |
    | `suspend` | its handler ticket closes `done` or `withdrawn`, or an owner resolves it (R-BTN-163) |
    | core `baton.<sub>` | the cause the owning rule names ends |
    | core `baton.retries`, `baton.contract` or `baton.stalled` | per R-BTN-163 |

- **R-BTN-125 (severity).**
  - **Values.** A condition carries `severity`: `critical`, `high` or `normal`. The default is
    `normal`.
  - **Who sets it.**
    - A leg sets it on the raise.
    - A person leg's question may carry `severity` (R-BTN-116), which its Needs-you entry takes.
    - Core conditions are `normal`, except `baton.contract`, which is `high`.
  - **What it does.** Severity is data for the handler course and the order of the debugger's
    list (R-BTN-163). It routes nothing and gates nothing.
### 7.2 Handlers

- **R-BTN-161 (bindings choose a handler course; the handler is a ticket file).**
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
    binding. A binding of `baton` or `baton.*` is ignored: Baton's own conditions are delivered
    from Baton's list, never through a ticket (R-BTN-163).
  - **The handler ticket.**
    - The runner writes the handler ticket git first, through the ticket source's `file(ticket)`
      export (R-BTN-74; the markdown source writes `<items>/<local id>.md`). It pushes the file
      before the raise returns or the leg ends. Under the policy's `tickets.created: proposed`
      (R-BTN-188) the handler ticket is proposed, not filed: the runner writes it on
      `baton/proposed/<ticket>`, and it is not claimable until it lands with a `std:approval@1`
      (R-BTN-180).
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

- **R-BTN-162 (a suspended leg waits in its claim, then blocks; it resumes with a restart).**
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
### 7.3 The debugger and Baton's own conditions

- **R-BTN-163 (the debugger: unhandled conditions, waiting people, and core's own).**
  - **Needs you is the debugger.** **Needs you** (§11) lists the following until each closes:
    - every open condition with no handler ticket;
    - every queued person's leg, with its question (R-BTN-116);
    - the floor (below).

    Entries are ordered by severity, then by age. A condition's entry shows its type, restarts,
    default, detail and `url`, and links its resolve page; a person leg's entry shows the leg,
    `asks`, the options and the question's `url` where one is posted, links the ticket's view, and
    takes the answer, unconfirmed (§11.4), where the policy admits an `owner` writer for
    `std:decision@1`, else names `baton decision answer` (R-BTN-116). No rule outside §7 has its own Needs-you listing: a rule raises a
    condition `baton.<sub>`.
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
  - **Unhandled `notify`** conditions are only recorded. **Unhandled `interrupt`** conditions
    follow the retry policy.
  - **Core's own conditions** (`baton.*`) are raised by Baton, with no leg, in the transaction
    that finds the cause. They sit on the ticket, repository or runner concerned, or on the tenant when none applies
    (`baton.sign-in-burst`, `baton.bearer-over-http`).
    - **`baton.retries`, `baton.contract` and `baton.stalled`** have disposition `suspend` on the
      whole ticket, the standard restarts below and no default, so they never resolve
      themselves:

      | Condition | Raised when | `retry` | `route:<leg>` | `park` |
      |---|---|---|---|---|
      | `baton.retries` | the retry policy holds the ticket: attempts spent, a non-retryable class other than `contract-input`, or `blocked-exhausted` (R-BTN-122) | clears the hold and the backoff | re-routes to a leg leaving the station (R-BTN-83) and clears the hold | closes the condition and keeps the hold; nothing is raised again while it stands |
      | `baton.contract` | a leg's input fails its schema, holding the ticket `non-retryable:contract-input` (R-BTN-82); its producer is re-run in git, then `retry` | as above | as above | as above |
      | `baton.stalled` | a leg has been posted `waiting` for its `stalled_s` (R-BTN-167); it closes by itself when the leg is posted `ready` | closes it and restarts the clock | re-routes | sets an owner hold `hold_reason: parked` and closes it |

      Any owner act that clears the hold under a `baton.retries` or `baton.contract` condition
      closes the condition, including §6's clear-hold.
    - **Every other core condition** is a `notify` condition `baton.<sub>`, where `<sub>` is the
      reason the rule that raises it names (for example `output-invalid`, `check-mismatch`,
      `course-changed`, `queue-over`, `head-unfounded`, `outbox-late`). Every rule that raises one
      names it; nothing else lists them.
      - It carries a `detail` of identifiers and numbers only (§12.3).
      - It closes when its cause ends. One raised within an hour of an earlier one of the same
        `(type, ticket, ref)` closing is the same entry, its `detail` counting the raises
        (`reraised`).
  - **Baton's own conditions need no ticket.** A `baton.*` condition is answered only through
    Baton's own authenticated surfaces — `baton ticket resolve`, an owner's or administrator's
    dashboard session; never a delegated key (R-BTN-130) — on its resolve page,
    `https://<origin>/conditions/<condition_id>` (§11.4), where a signed-in owner chooses one of
    its restarts (R-BTN-155). Nothing in git is read for it, and Baton files no handler ticket,
    queues no outbox entry and withdraws nothing for it (the owner, 2026-11-01). How the owner
    learns of it is a **delivery runner's**: any runner, or a process with a key granted on the
    repository, that polls `GET /v1/repositories/{repository}/conditions?open=1` — with `person=1` for
    what waits on a person (the list `baton decision list --watch` reads, below) and with
    `type=baton` for Baton's notices, the `notify` conditions above — and sends each entry it has
    not yet sent: for a `suspend` condition its type, severity, detail and resolve link; for a
    person leg its ticket, `asks`, options and question link; for a `notify` condition its type,
    severity and detail — by whatever channel it has, a webhook or mail, outside Baton. Core names no channel and records no delivery; a runner that delivers twice
    does no harm, since the page answers once. A repository with no such runner has the dashboard
    and the CLI.
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
    - Without `person=1` the route lists every condition, filtered by `open`, `type` prefix and
      `ticket`, 100 per page with a cursor.
    - Any key granted on the repository, an owner of it or an administrator may read it. The
      registry action is `condition.list`.
### 7.4 Retries

- **R-BTN-122 / R-BTN-23 (retries: the default handler of `error`).** The retry policy handles
  every `interrupt` condition. A binding of an `error` type adds a handler ticket beside the
  retry policy and does not replace it, unless the binding says `"replaces": "retry"`: then the binding
  is a `suspend` binding for R-BTN-161 and R-BTN-162 — the handler asks through a person leg whose
  options are `retry`, `route:<leg>` and `park`, Baton forms the restart as R-BTN-162 says, and
  the restart decides in the policy's place, checked against the owners' bounds below — and the
  leg ends blocked on the condition as a `suspend` would. Only the runner knows the binding, so it reports the raise with `replaces:
  "retry"` and ends the claim `released:blocked` on the condition, never `cannot-finish`.
  - **State.** Attempts are counted **per ticket and leg**, with §9's rules for what counts as a
    failed attempt, in `leg_attempts`: repository, ticket, leg, `attempts`, `retry_after` and
    `last_error_type`. A failing `review` spends none of `implement`'s attempts. The row resets —
    `attempts` to 0, `retry_after` cleared — when a run of the leg reaches one of its outcomes
    (an `advance` or end reporting it, or a fact arrival of it) and when a hold is lifted, so
    each pass of a loop starts with the full policy.
  - **Policy.** A leg may carry a retry policy:

    ```json
    "retry": {"max_attempts": 3, "backoff_s": 3600, "exhausted": "<leg>"}
    ```

    `max_attempts` is how many failed attempts the leg gets before exhaustion; `backoff_s` how
    long after a failed attempt the leg is offered again; `exhausted`, optional, a leg leaving
    the same station that Baton queues instead of holding the ticket. A leg with no policy takes
    the repository's default policy. Whether a type is retried is its declaration's `retryable`
    and the owners' floor (R-BTN-160); a leg that must not retry a type raises a non-retryable
    type of its own, or sets `max_attempts` 1. A leg that wants to try again inside its own run
    loops in its script; Baton counts nothing for it.
  - **Backoff.**
    - After a failed attempt, the leg's `retry_after` is now plus `backoff_s`, multiplied by a
      uniform factor in [0.9, 1.1].
    - While `now < retry_after`, the leg's prerequisite `retry` is unmet (R-BTN-120): a
      `ticket_blocks` row of kind `retry` on that leg, with `until` set to `retry_after`.
    - A claim or `advance` into the leg is refused **`backing-off`** (with `until`), not
      `blocked`. The leg is left out of recommendations, and `baton leg why` shows it with
      `attempt: <n> of <max>`.
    - The alarm clears the row at `retry_after`, and `unblocked` follows (R-BTN-77). A backoff
      on one leg does not stop the ticket's other legs.
    - A provider at capacity is a blocked prerequisite (R-BTN-126), never a retry.
  - **Exhaustion.** When the failed attempts reach `max_attempts`, or when the type is
    non-retryable:
    - Baton holds the ticket (`hold_reason` `attempts-exhausted` or `non-retryable:<class>`),
      logs the reason and raises `baton.retries` (R-BTN-163).
    - When the policy names `exhausted`, a leg leaving the same station, Baton instead queues
      that leg (`next_source: baton`), held until the station changes (R-BTN-83), and raises
      nothing. A non-retryable type always holds.
    - `contract-input` holds at once, is not an attempt and raises `baton.contract`.
    - `lease-lost` counts once per distinct runner.
    - Lifting a hold resets the leg's counts, as does the leg reaching an outcome (above).
  - **Owners' bounds.** The course file is in git, so the owners' `retry` setting, a Baton
    setting (R-BTN-66), bounds every policy: `{max_attempts, backoff_s}`, a ceiling on the first
    and a floor under the second, applied field by field as the stricter of the course's policy
    and the owners' bound. The defaults, which a repository with no setting has:

    | Bound | Default |
    |---|---|
    | default policy | `max_attempts` 3, `backoff_s` 3600 |
    | ceiling `max_attempts` | 10 |
    | floor `backoff_s` | 60 |
    | floor types, never retried | core's `capability`, `spec`, `contract-input` |

    Two limits are constants of this specification, not settings: `max_blocked`, the blocked ends
    a leg may make per ticket and leg in 24 hours, is **5** (R-BTN-126), and a `suspend` wait in a
    claim lasts at most **900 s** (R-BTN-162).
    - `baton course test` warns where the bounds cut a course's policy back, and the course's
      view shows the policy in force.
    - The floor binds hard on core's built-in types. On a course's own types it binds only as git
      does, so `baton course test` warns when a floor type is not declared. An owner who
      needs a hard bound sets `max_attempts` 1.

### 7.5 Deadlines

- **R-BTN-167 (two clocks on a leg: a deadline on its run, and the stalled notice).**
  - **`deadline_s`**, optional on a leg (60 s to 604,800 s, 7 days): how long one run may take.
    The clock starts at the `advance` that starts the run, by Baton's clock (R-BTN-90), and the
    instant is the claim's `deadline_at`. At it Baton takes the claim back as R-BTN-90 says, and
    the end is a failed attempt (`leg-timeout`, R-BTN-122). A leg with no `deadline_s` has no
    deadline: Baton relies on the lease (R-BTN-9) and the owner's Stop (R-BTN-119).
  - **`stalled_s`**, on every leg (default 259,200 s, 72 hours; 60 s to 30 days): how long the leg
    may be posted `waiting` (R-BTN-70) before Baton raises `baton.stalled` on the ticket, a
    `suspend` core condition (R-BTN-163). The clock counts from the ticket's arrival at the leg's
    `from` station, only while the sync's readiness attests the leg `waiting` — not while Baton
    itself holds the leg waiting, a `time` wait holds it or a claim runs it — and restarts when
    the ticket's station changes. The condition closes by itself when the leg is posted `ready`.
    A course that wants a longer or shorter watch sets `stalled_s` on the leg; nothing removes
    the notice.
  - **A person leg's `expires`** (R-BTN-116) is the one other instant Baton holds per leg; a
    person leg has no `stalled_s`.
  - Baton holds the `stalled` and `expires` instants in `ticket_timers` (repository, ticket, leg,
    `kind`, `from_at`, `due_at`, `fired_at`) and fires them from the alarm, once per `from_at`. The
    rows are owner state (R-BTN-88): an instant restarts only when the ticket's station changes,
    never when a Baton moves. A deadline lives in its claim alone (`claims.deadline_at`, R-BTN-90)
    and dies with it.
  - The course validator (R-BTN-69) and `baton course test` refuse `timers`, `after_s` and any
    value outside the ranges above, naming the leg and the field.

- **R-BTN-90 (the deadline in a claim).** Baton cannot stop a runner. It takes the claim away and
  tells the runner to stop, and fencing makes a runner that ignores it harmless (R-BTN-19,
  R-BTN-26).
  - **Arming.** The `advance` that starts a leg with `deadline_s` sets the claim's `deadline_at`
    to now plus `deadline_s`. The next `advance` and the claim's end clear it.
  - **Finishing is not the end.** When the script's `run` returns, the runner sends an immediate
    heartbeat out of its cadence with `leg_finished: <claim_legs.seq>`. That heartbeat comes before
    validation, `close`, and any wait under the claim on a `short_waits` label or a near `time`.
    When the claim has a `deadline_at`, it re-arms it to now plus 40 minutes, once per leg run (R-BTN-149), so a slow push
    or review of the result is never cut off. The heartbeat processes `leg_finished` before it
    delivers messages: a `leg-timeout` release still pending for that leg is withdrawn (the
    message set `expired` with `withdrawn: 'leg-finished'`, a `leg-timeout` event logged with
    `{withdrawn: true}`); a release already delivered stands.
  - **At the deadline.**
    - The alarm queues the holder a `release` with reason `leg-timeout` and logs `leg-timeout`.
    - The runner aborts the leg at its next safe point, writes its hand-off and ends
      `released:leg-timeout`, a failed attempt (R-BTN-122).
    - A delivered `leg-timeout` release left unacknowledged for 15 minutes is reaped by the
      alarm with a fence, actor `alarm:leg-timeout` (R-BTN-19). The ticket is not re-issued
      until the runner's sidecar confirms that it killed the tool processes, the fence's
      deadline passes, or an administrator clears the fence (R-BTN-19). This reap counts as the `leg-timeout` end would.
  - **The owner's controls** on a running claim are Stop (`release` with reason `requested`,
    R-BTN-119) and Cancel (a hold and a `release` with reason `owner-cancel`, §6.8), each at once.
    The heartbeat response (§14) and the dashboard's claim row carry `deadline_at`.
### 7.6 Calls

- **R-BTN-165 (a call leg runs a course and waits for it).**
  - **The leg.** A call leg is `"kind": "call"` with a `spawns` declaration (R-BTN-111), whose
    `course` names the course or courses it calls. The leg's `"to"` is a **completion table**
    `{<station>: <completion>, …}`, checked in order. A question to a person is not a call: a
    planned one is a person's leg (R-BTN-116), one from inside a leg a `suspend` raise
    (R-BTN-162).
  - **What the script does.**
    - The script runs as any leg's does and writes the children git first, through the source's
      `file` export. Each child names a course its `spawns` allows and `called_by: {leg, run}`.
      Under the policy's `tickets.created: proposed` (R-BTN-188) the children are proposed, not
      filed, and not claimable until they land with a `std:approval@1` (R-BTN-180).
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

### 7.7 Cancellation

- **R-BTN-168 (supersession, lifetime and the cancel leg).**
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
    - a ticket with a file still live in git waits for its withdrawal: Baton queues the
      `withdraw` outbox entry (R-BTN-171) and the ticket closes `withdrawn` when a snapshot posts
      it withdrawn or closed;
    - a ticket withdrawn in git already, or one with no file, closes `withdrawn` at once.
  - **Withdrawn in git first.** A ticket a snapshot posts withdrawn whose course names a `cancel`
    leg leaving its station, and whose path ran a leg that leg undoes (any leg whose `to` the
    cancel leg leaves), is kept live and `cancelling`: its board rows stay (§13), the `closed`
    entry is kept and applied when the cancel leg's run ends, and no snapshot stales the leg's
    claim (R-BTN-35). One whose path ran none closes at once.
  - **Cascade.** Cancelling a ticket supersedes its open children whose `lifetime` is `parent`.
### 7.8 The outbox

- **R-BTN-171 (every git write and check run Baton intends goes through one outbox, which runners deliver).**
  Baton holds no credential that writes git or posts a check run; starting a workflow is its own
  call (R-BTN-94). Each git write or check run Baton intends is an **outbox entry**. A
  **deliverer** — a runner (R-BTN-3) whose host holds the credential the effect needs, on a grant
  whose role the repository policy's `outbox` admits (R-BTN-188) — claims the entry under a lease,
  delivers it and reports it with a `std:effect@1` attestation (R-BTN-191); Baton then confirms it
  by reading the effect back.
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

    `withdraw` is the one **git kind**: Baton files no ticket of its own (R-BTN-163). The two
    kinds are the two **delivery classes**, `git` and `forge-check`.
  - **Deliverers are runners.** No key role exists for delivery (the owner, 2026-11-01, "Couriers
    into runners"): a runner that holds the credential declares the classes it delivers in its
    heartbeat (`delivers: [git | forge-check]`, nothing by default; kept in `runners.delivers`,
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
      (R-BTN-115).
    - **Woken, not polling.** A deliverer's doorbell socket (R-BTN-91) is rung `outbox` when an
      entry of a class it delivers is queued on a repository it serves; it then claims at once.
    - Admitting `runner` for `forge-check` lets any granted runner withhold a check. It still
      cannot post one Baton did not issue unseen (R-BTN-115).
    - **A trusted-runner deliverer runs no repository code.** It never loads the source's
      `withdraw` export: it writes from the CLI's own markdown-source templates. On a
      repository whose ticket source is ejected (`.baton/tickets.mjs`), Baton offers a git entry
      to no `trusted-runner` grant, since it would write from a template the source does not use:
      the entry waits for a `runner` deliverer, and a policy admitting none there is refused
      (R-BTN-188).
  - **Claiming and marking.**
    - `POST /v1/runner/outbox/claim {limit?}` claims up to 50 queued entries, each leased for 10
      minutes, of the classes the caller declared and the `outbox` policy of each repository its
      grant covers admits it to.
    - A ticket's git entries are claimed together, in `id` order, and none while an earlier entry
      of that ticket is `claimed` or `delivered`. Entries of different tickets are unordered.
    - `POST /v1/runner/outbox/{repository}/{id}` marks one: `delivered` with its `ref`, or
      `failed` with `transient` or `refused`. `failed` is a mark, not a state: the entry returns to
      `queued`, after a backoff for `transient` and with its ticket held for `refused`.
    - A lapsed lease re-queues the entry. A mark arriving after its lease lapsed is accepted. A mark
      from any credential but the claimer is `forbidden`. An entry the claimer leaves unmarked goes
      back to `queued` when its lease lapses.
    - `transient` re-queues the entry after 1, 5 and 30 minutes, then hourly.
    - `refused` (the forge refused the deliverer's credential, a misconfiguration) holds the entry's
      ticket (`hold_reason: outbox-refused`) and raises `baton.outbox-late` naming the deliverer,
      until the deliverer is fixed and the hold lifted by an approver on `approvers.policy`
      (R-BTN-186, R-BTN-188), which queues the entry again.
  - **Idempotence.** Every delivery carries its entry's id, so delivery is at least once and its
    effect at most once.
    - `withdraw`: the withdrawal writes `baton_write: <id>` beside `status: withdrawn`. Before
      writing, the deliverer reads the file at
      the freshly fetched head it writes to: the default branch, or under `tickets.created:
      proposed` the proposal branch (R-BTN-180). A file that already carries the id, or for
      `withdraw` already says withdrawn or is absent, is not written again, and the deliverer reports
      the head's commit. On a rejected push it fetches, checks and writes again, at most 3 times,
      then marks the entry `failed` with `transient`.
    - `forge-check`: the check run's `external_id` carries the id, and R-BTN-115's `seq` keeps an
      older entry from overwriting a newer one.
  - **What Baton holds until a git entry is confirmed.**
    - **Withdraw entry.** The cancelled ticket stays `cancelling` (R-BTN-168) until a snapshot
      posts it withdrawn or closed, which closes it `withdrawn`.
    - **Delivered, not confirmed.** A `delivered` entry is never claimed again. An entry still not
      `confirmed` after 3 accepted snapshots at or after its commit raises `baton.outbox-late`; a
      `withdraw` entry's ticket, already `cancelling` (R-BTN-168), stays so, and the condition's
      `retry` queues the entry again.
  - **Dropping.** A `withdraw` entry for a ticket whose course names a `cancel` leg is queued in
    the transaction that records that leg's end (R-BTN-168). A `withdraw` entry whose ticket a snapshot shows
    withdrawn or closed before any deliverer claimed it is `dropped`. Retiring a repository drops
    every `queued`, `claimed` or `delivered` entry of it, and a later mark is ignored (R-BTN-47).
  - **Records.**
    - Queuing, delivering and confirming each log an `outbox {id, kind, state}` event in the
      ticket's history.
    - An entry late by its kind's column above raises `baton.outbox-late` (R-BTN-163) with its
      `kind`; for `forge-check` the change stays pending.
  - **Not in the outbox.** Positions that start in Baton are Baton's (R-BTN-39), held until the
    station changes: a call's settlement (R-BTN-165), a person leg's expiry (R-BTN-116), an
    `exhausted` leg (R-BTN-122) and the `cancel` leg (R-BTN-168). Messages to runners ride the
    heartbeat (§6.9). A workflow dispatch is Baton's own call, made with the credential Baton
    holds for it (R-BTN-94, §12.7).
### 7.9 Standard handler courses

- **R-BTN-169 (standard handler courses: `ask`, `deliver` and `announce`).** These are three
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
