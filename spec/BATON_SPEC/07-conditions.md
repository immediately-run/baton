---
title: "7. Conditions"
description: "A leg that cannot go on alone (it needs a person, it hit an error or it has something to report) raises a condition."
---
## 7. Conditions *(partly built)*

A leg that cannot go on alone (it needs a person, it hit an error or it has something to report)
**raises a condition**. Baton records it and lists the open ones under **Needs you**, and raises
conditions of its own the same way. This section also defines **retries** and the **deadline** on
a run.

Not built, and specified in the [conditions proposal](../proposals/conditions.md): bindings and
handler tickets, the suspend wait and its restart, calls, cancellation, the outbox, the standard
handler courses and the `ticket.changed` leg event.

Not built either, each a design its rule below still states:

- `baton.contract` (R-BTN-125, R-BTN-163, R-BTN-122): Baton refuses an answer to it and raises
  none.
- `reraised`, `baton ticket resolve` and the action `ticket.resolve` (R-BTN-163). An owner
  resolves with `baton owner resolve <repository> <ticket> baton:retries|baton:stalled
  retry|park`: Baton's code spells the two conditions with a colon.
- The per-leg `retry` policy, its `exhausted` leg, `backoff_s` and its jitter, and the `retry`
  prerequisite with `baton leg why` (R-BTN-122). The one policy is the owners' `retry` setting,
  `{backoff_ms: [<ms>…], max_failed}`: a list of backoffs and the failed attempt that holds.
- The name `deadline_s` (R-BTN-167, R-BTN-90, R-BTN-195): the course file's key is
  `max_duration`, with the same bounds.

### 7.1 Raising a condition

- **R-BTN-160 (conditions: typed, declared, raised by any leg).**
  - **Type.** A condition is a typed event that a running leg raises. Its type matches
    `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$` and is at most 64 characters long. The dots form a
    hierarchy: `hitl.spec-contradiction` is a `hitl`, so a declaration for `hitl` covers it.
  - **Standard types**:

    | Type | Disposition | Raised by |
    |---|---|---|
    | `hitl` | `suspend` | any leg |
    | `warning` | `notify` | any leg |
    | `interact` | `notify` | a leg (R-BTN-195) |
    | `error` | `interrupt` | any leg; core's classes are `error.transient`, `error.capability`, `error.spec`, `error.contract-output`, `error.contract-input` and `error.needs-person` (R-BTN-195) |
    | `baton` | per sub (R-BTN-163) | core only |

    Any leg may raise a standard type, or a subtype of one, without declaring it. `baton` and
    `baton.*` are core's alone: the validator refuses a course declaring them and Baton refuses a
    leg's raise of them (`invalid-params`). A leg may narrow what it may raise: `"conditions": []`
    allows none and `"conditions": ["warning"]` allows only warnings.
  - **Declaring.** A course declares its own types in the course file (R-BTN-69):
    `"conditions": {<type>: {"disposition": "interrupt" | "suspend" | "notify",
    "restarts": {<id>: <description>}, "default": <id>, "wait_s": <n>, "retryable": <bool>, "description":
    …}}`. Only `disposition` is required. A restart id matches §12.3's decision-id pattern, and
    `wait_s` is 0 to 900. A subtype inherits the disposition of its nearest declared or standard
    ancestor unless it states its own.
  - **Error types are `interrupt` conditions.**
    - `retryable` decides whether the retry policy retries the type, for every leg; no policy
      overrides it (R-BTN-122).
    - A course type's class is `transient` when retryable and `spec` otherwise. A core class is
      its own. `error.needs-person` is `spec`.
    - An exception the script does not type is `error.transient`.
  - **Signature.** A course's signature (R-BTN-111) lists the conditions its legs may raise: its
    own types and, unless a leg narrows them, the standard ones. `baton course test` prints the
    signature.
  - **Raising.** A session in a leg calls `baton leg raise <type> --subject … [--body <file>]
    [--restarts <json>] [--default <id>] [--severity …]` on the local channel (R-BTN-106). The
    runner checks a raise as it checks a move, and answers one that fails on the channel with the
    reason:
    - the type is well formed, standard or declared, and allowed to the leg;
    - the leg's `autonomous` and the `interact` checks pass (R-BTN-195);
    - `restarts` map ids to descriptions, and `default` is one of them;
    - `severity` is valid (R-BTN-125).
  - **Dispositions.**

    | Disposition | What follows the raise |
    |---|---|
    | `interrupt` | The leg ends `released:cannot-finish:<class>` with `error: {type, message}`, `message` free text under §12.3. The retry policy routes the ticket (R-BTN-122). |
    | `suspend` | The raise is recorded and returns; the condition stays open under Needs you (R-BTN-163), and nothing waits on it |
    | `notify` | The raise is recorded and returns at once, and the leg goes on |

  - **Reported before it takes effect.** The runner reports each raise with `POST
    /v1/runner/claims/{id}/conditions` and the body `{type, disposition, restarts, default?,
    severity?, url?}`.
    - The body holds filter fields only (R-BTN-33), never the subject or the body, which stay
      with the runner.
    - Baton takes the disposition from the standard table and the course's declarations, never
      from the report. It refuses a raise from a claim running no leg (`invalid-params`).
    - A `suspend` condition's `url` points to where git holds the question and is kept only under
      R-BTN-92's link rule. An `interact` condition's `url` is Baton's own (R-BTN-195). No other
      condition carries one.
    - Baton answers with a `condition_id`, stores the `conditions` row and records a `condition`
      event in the ticket's history (R-BTN-81).
    - A claim may hold at most 20 open conditions, and a ticket may raise at most 200 a day.
      Past either limit the request is refused with `quota`.
    - A raise costs two writes (§2's write budget).
  - **Closing.** A condition is open until it closes:

    | Condition | Closes when |
    |---|---|
    | `interrupt` | it is raised |
    | leg-raised `notify` | it is raised (outcome `recorded`) |
    | `interact` | its run ends, or the run raises `interact` again (R-BTN-195) |
    | `suspend` | its repository is retired (R-BTN-47) |
    | core `baton.<sub>` | the cause the owning rule names ends |
    | core `baton.retries`, `baton.contract` or `baton.stalled` | per R-BTN-163 |

- **R-BTN-125 (severity).**
  - **Values.** A condition carries `severity`: `critical`, `high` or `normal`. The default is
    `normal`.
  - **Who sets it.**
    - A leg sets it on the raise.
    - A person leg's question may carry `severity` (R-BTN-116), which its Needs-you entry takes.
    - Core conditions are `normal`, except `baton.contract`, which is `high`.
  - **What it does.** Severity is data for the order of the Needs-you list (R-BTN-163). It routes
    nothing and gates nothing.
- **R-BTN-195 (an interaction request asks a person into the leg's session).** A leg that wants
  a person raises `interact`; the person joins the leg's agent session in its harness's own UI,
  and everything they and the agent say passes there, never through Baton.
  - **Autonomous legs.** A leg declared `"autonomous": true` (R-BTN-69) never asks for a person:
    it may raise no `interact` and no `suspend` type, `hitl` and its subtypes included. The
    validator refuses `autonomous` beside a `conditions` list naming any of them, and on a person
    leg. When the leg cannot go on without a person, it raises `error.needs-person` (R-BTN-160),
    its trace in the leg log (R-BTN-128). The executor's brief carries the flag as a hint
    (R-BTN-107).
  - **The raise.** `interact` is refused on the channel with the reason when the leg is
    autonomous, has no `deadline_s` (R-BTN-167), or its run has no session link Baton holds
    (R-BTN-113). Baton sets the condition's `url` to that link, `claim_legs.session_url`, and
    ignores any the runner sends. A run holds one open `interact` at a time: a new raise closes
    the open one (outcome `superseded`).
  - **Delivery.** No handler ticket is filed. The condition is listed under Needs you with its
    link until it closes, and a delivery runner sends it from Baton's list (R-BTN-163).
  - **Baton tracks nothing of the interaction itself.** The raise returns at once and the leg
    goes on. Baton does not learn when the person joins, answers or leaves. The person may close
    the harness's UI at any time; the leg runs on, and may raise `interact` again later in the
    same run. A refresh (R-BTN-123) starts a new session, whose link the next heartbeat reports,
    and ends the person's conversation in the old one.
  - **The leg ends by its result.** A joinable session does not exit when its agent is done:
    the leg ends when the result is posted on its channel (R-BTN-106), and the runner then stops
    the session (R-BTN-107), a person in it or not. At the run's deadline it ends as a failed
    attempt (R-BTN-90).

### 7.2 Handlers

- **R-BTN-161 (bindings choose a handler course; the handler is a ticket).** Not built. No binding
  applies and no handler ticket is filed, so every leg-raised condition is only recorded and
  listed (R-BTN-160, R-BTN-163).
  The design is in the [conditions proposal](../proposals/conditions.md).
- **R-BTN-162 (a suspended leg waits, then resumes with a restart).** Not built. A `suspend` raise
  is recorded and returns (R-BTN-160); nothing waits on it and no claim resumes from it. The
  design is in the [conditions proposal](../proposals/conditions.md).

### 7.3 The debugger and Baton's own conditions

- **R-BTN-163 (the debugger: unhandled conditions, waiting people, and core's own).**
  - **Needs you is the debugger.** **Needs you**, which the dashboard's Conditions screen draws
    (§11.4), lists, until each closes:
    - every open condition, with its type, restarts, default, detail and `url`;
    - every queued person's leg, with its question (R-BTN-116).

    Entries are ordered by severity, then by age. No rule outside §7 has its own Needs-you
    listing: a rule raises a condition `baton.<sub>`.
  - **Core's own conditions** (`baton.*`) are raised by Baton, with no leg, in the transaction
    that finds the cause. They sit on the ticket, repository or runner concerned, or on the tenant
    when none applies.
    - **`baton.retries`, `baton.contract` and `baton.stalled`** have disposition `suspend` on the
      whole ticket and no default, so they never resolve themselves. An owner resolves one with
      `retry` or `park`:

      | Condition | Raised when | `retry` | `park` |
      |---|---|---|---|
      | `baton.retries` | the retry policy holds the ticket (R-BTN-122), or a leg's blocked ends are exhausted (R-BTN-126) | clears the hold and the backoff | closes the condition and keeps the hold; nothing is raised again while it stands |
      | `baton.contract` | a leg's input fails its schema, holding the ticket `non-retryable:contract-input` (R-BTN-82); its producer is re-run in git, then `retry` | as above | as above |
      | `baton.stalled` | a leg has been posted `waiting` for the stalled time (R-BTN-167); it closes by itself when the leg is posted `ready` | closes it and restarts the clock | sets an owner hold `hold_reason: parked` and closes it |

      Any owner act that clears the hold under a `baton.retries` or `baton.contract` condition
      closes the condition, R-BTN-12's unhold included.
    - **Every other core condition** is a `notify` condition `baton.<sub>`, where `<sub>` is the
      reason the rule that raises it names. Every rule that raises one names it; nothing else
      lists them.
      - It carries a `detail` of identifiers and numbers only (§12.3).
      - It closes when its cause ends. One raised within an hour of an earlier one of the same
        `(type, ticket, ref)` closing is the same entry, its `detail` counting the raises
        (`reraised`).
  - **Resolving.** A `baton.*` condition is answered only through Baton's own authenticated
    surfaces: `baton ticket resolve <ticket> <restart>` (R-BTN-127), or an owner's or
    administrator's dashboard session on the condition's resolve page,
    `/repositories/{repository}/conditions/{condition}` (§11.4), the registry action
    `ticket.resolve` (R-BTN-155); never a delegated key (R-BTN-130). `GET
    /conditions/{condition}` is answered by the front with `302` to the resolve page when the core
    finds the id among the session's repositories; otherwise it serves the shell, which shows
    sign-in to the signed-out and `not-found` for no such id and for another repository's alike.
    Nothing in git is read for a `baton.*` condition, and Baton files no ticket for it.
  - **Delivery runners.** How a person learns of an entry is a delivery runner's: any runner, or
    a process with a key granted on the repository, that polls the list and sends each entry it
    has not yet sent by whatever channel it has, outside Baton. An `interact` entry is sent as its
    ticket, leg and `url`, and nothing the leg wrote. Core names no channel and records no
    delivery. The delivery poll for session capabilities (R-BTN-113) is the granted runner's
    `GET …/conditions?open=1&type=interact`, which includes open interaction subtypes. A
    repository with no delivery runner has the dashboard and the CLI.
  - **Reading the list.** `GET /v1/repositories/{repository}/conditions` lists the repository's
    conditions, filtered by `open=1`, a `type` prefix and `ticket`, 100 per page with a cursor.
    Any key granted on the repository, an owner of it or an administrator may read it. The
    registry action is `condition.list`. `baton decision list` (R-BTN-127) prints what waits on a
    person; it marks nothing, and `--watch` asks once a minute.

### 7.4 Retries

- **R-BTN-122 / R-BTN-23 (retries: the default handler of `error`).** The retry policy handles
  every `interrupt` condition.
  - **State.** Attempts are counted **per ticket and leg**, with §9's rules for what counts as a
    failed attempt, in `leg_attempts`: repository, ticket, leg, `attempts`, `retry_after` and
    `last_error_type`. The row resets — `attempts` to 0, `retry_after` cleared — when a run of the
    leg reaches one of its outcomes (an `advance` or end reporting it, or a fact arrival of it)
    and when a hold is lifted.
  - **Policy.** A leg may carry a retry policy:

    ```json
    "retry": {"max_attempts": 3, "backoff_s": 3600, "exhausted": "<leg>"}
    ```

    `max_attempts` is how many failed attempts the leg gets before exhaustion; `backoff_s` how
    long after a failed attempt the leg is offered again; `exhausted`, optional, a leg leaving
    the same station that Baton queues instead of holding the ticket. A leg with no policy takes
    the repository's default policy. Whether a type is retried is its declaration's `retryable`
    (R-BTN-160) and the owners' floor; a leg that must not retry a type raises a non-retryable
    type of its own, or sets `max_attempts` 1. A leg that tries again inside its own run loops in
    its script; Baton counts nothing for it.
  - **Backoff.** After a failed attempt, the leg's `retry_after` is now plus `backoff_s`,
    multiplied by a uniform factor in [0.9, 1.1]. Until then the leg's `retry` prerequisite is
    unmet (R-BTN-120): a claim or `advance` into the leg is refused `backing-off` (§6.6), and
    `baton leg why` shows `attempt: <n> of <max>`. The alarm clears the block at `retry_after`,
    and `unblocked` follows (R-BTN-77). A backoff on one leg does not stop the ticket's other
    legs. A provider at capacity is a blocked prerequisite (R-BTN-126), never a retry.
  - **Exhaustion.** When the failed attempts reach `max_attempts`, or when the type is
    non-retryable:
    - Baton holds the ticket (`hold_reason` `attempts-exhausted` or `non-retryable:<class>`),
      logs the reason and raises `baton.retries` (R-BTN-163).
    - When the policy names `exhausted`, Baton instead queues that leg (`next_source: baton`),
      held until the station changes (R-BTN-83), and raises nothing. A non-retryable type always
      holds.
    - `contract-input` holds at once, is not an attempt and raises `baton.contract`.
    - `lease-lost` counts once per distinct runner.
  - **Owners' bounds.** The owners' `retry` setting, a Baton setting (R-BTN-66), bounds every
    policy: `{max_attempts, backoff_s}`, a ceiling on the first and a floor under the second,
    applied field by field as the stricter of the course's policy and the owners' bound. The
    defaults, which a repository with no setting has:

    | Bound | Default |
    |---|---|
    | default policy | `max_attempts` 3, `backoff_s` 3600 |
    | ceiling `max_attempts` | 10 |
    | floor `backoff_s` | 60 |
    | floor types, never retried | core's `capability`, `spec`, `contract-input` |

    - `baton course test` warns where the bounds cut a course's policy back, and the course's
      view shows the policy in force.
    - The floor binds hard on core's built-in types. A course's own type is retried as its
      declaration says, so `baton course test` warns when a floor type is not declared. An owner
      who needs a hard bound sets `max_attempts` 1.

### 7.5 Deadlines

- **R-BTN-167 (two clocks on a leg: a deadline on its run, and the stalled notice).**
  - **`deadline_s`**, optional on a leg (60 s to 604,800 s): how long one run may take. The clock
    starts at the `advance` that starts the run, by Baton's clock, and the instant is the claim's
    `deadline_at` (R-BTN-90). A leg with no `deadline_s` has no deadline: Baton relies on the
    lease (R-BTN-9) and the owner's Stop (R-BTN-119). A person leg carries none.
  - **The stalled time** is 72 hours, a constant: how long a leg may be posted `waiting`
    (R-BTN-70) before Baton raises `baton.stalled` on the ticket (R-BTN-163). The clock counts
    from the ticket's arrival at the leg's `from` station, only while the sync's readiness attests
    the leg `waiting` — not while Baton itself holds the leg waiting, a `time` wait holds it or a
    claim runs it — and restarts when the ticket's station changes.
  - **A person leg's `expires`** (R-BTN-116) is the one other instant Baton holds per leg; a
    person leg has no stalled time.
  - Baton fires the `stalled` and `expires` instants from the alarm, once each. They are owner
    state (R-BTN-88): an instant restarts only when the ticket's station changes, never when a
    Baton moves. A deadline lives in its claim alone and dies with it.

- **R-BTN-90 (the deadline in a claim).** Baton cannot stop a runner. It takes the claim away and
  tells the runner to stop, and fencing makes a runner that ignores it harmless (R-BTN-19,
  R-BTN-26).
  - **Arming.** The `advance` that starts a leg with `deadline_s` sets the claim's `deadline_at`
    to now plus `deadline_s`. The next `advance` and the claim's end clear it.
  - **Finishing is not the end.** When the script's `run` returns, the runner sends an immediate
    heartbeat out of its cadence with `legs_finished: [{claim_id, seq}]`, the run's claim and its
    `claim_legs.seq`, before validation, `close` and any wait under the claim. The heartbeat
    processes it before it delivers messages:
    - a `leg-timeout` release still pending for that leg is withdrawn (the message set `expired`
      with `withdrawn: 'leg-finished'`, a `leg-timeout` event logged with `{withdrawn: true}`); a
      release already delivered stands;
    - a `deadline_at` still armed is re-armed to now plus 40 minutes, once per leg run
      (R-BTN-149).
  - **At the deadline.**
    - The alarm queues the holder a `release` with reason `leg-timeout` and logs `leg-timeout`.
    - The runner aborts the leg at its next safe point, writes its hand-off and ends
      `released:leg-timeout`, a failed attempt (R-BTN-122).
    - A delivered `leg-timeout` release left unacknowledged for 15 minutes is reaped by the
      alarm with a fence, actor `alarm:leg-timeout` (R-BTN-19), and counts as the `leg-timeout`
      end would.
  - The heartbeat response (§14) and the dashboard's claim row carry `deadline_at`.

### 7.6 Calls

- **R-BTN-165 (a call leg runs a course and waits for it).** Not built: the validator refuses
  `"kind": "call"`. A leg that files children declares `spawns` (R-BTN-111) and reports them
  (R-BTN-86); a ticket that waits for other tickets does so by a `ticket` prerequisite
  (R-BTN-120). The design is in the [conditions proposal](../proposals/conditions.md).

### 7.7 Cancellation

- **R-BTN-168 (supersession, lifetime and the cancel leg).** Not built. A ticket its source posts
  withdrawn closes `withdrawn` (R-BTN-74); Baton supersedes no ticket and queues no `cancel` leg.
  The validator accepts a `spawns` declaration's `"lifetime": "parent" | "station"` and nothing
  reads it. The design is in the [conditions proposal](../proposals/conditions.md).

### 7.8 The outbox

- **R-BTN-171 (the outbox).** Not built: Baton queues no outbox entry and no runner delivers one.
  The repository policy's `outbox` section is checked and stored (R-BTN-188). The design is in
  the [conditions proposal](../proposals/conditions.md).

### 7.9 Standard handler courses

No handler course ships. The design of `ask`, `deliver` and `announce` is in the
[conditions proposal](../proposals/conditions.md).

### 7.10 Leg events

- **R-BTN-198 (leg events: what Baton tells a running leg).** Not built: the runner
  stops a leg as R-BTN-119 says and hands it no event. The design of the
  `ticket.changed` and `release` events is in the
  [conditions proposal](../proposals/conditions.md).
