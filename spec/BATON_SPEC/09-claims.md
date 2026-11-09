---
title: "9. Claims"
description: "A claim is a fenced lease on one ticket."
---
## 9. Claims *(partly built — B-11, B-21, B-38, B-39, B-46, R3-1213)*

A claim is a fenced lease on one ticket. Baton owns it outright, as it owns the ticket's course
history and position (R-BTN-39); the ticket's content and closure are git's (R-BTN-35). A claim
is `active` until it ends
`completed`, `released` or `reaped`.

### 9.1 The lock and claiming

- **R-BTN-4 (the lock).** At most one `active` claim per ticket and per runner, enforced by two
  partial unique indexes. A claim holds one ticket through a run of its legs; a runner that
  needs another ticket ends its claim first.
- **Claiming** (unnumbered). `POST /v1/runner/claim` with a client-generated `request_id` and
  an optional `ticket_id`, plus optional `prefer` and `rationale` (R-BTN-100). A ticket
  Baton has not seen is `not-eligible` (`unknown-ticket`) until a post names it (R-BTN-5).
  - Without `ticket_id`, Baton returns the first eligible ticket in its default order (the first
    recommendation, R-BTN-45, R-BTN-61); with one, that ticket if every gate passes, else
    `not-eligible` naming the failed gate. Advice never refuses: a claim against it is accepted
    and logged `advice-overridden`.
  - Every gate is re-checked in the one transaction that commits the claim. A repeated
    `request_id` from the same runner returns the original result, so a lost response never
    yields a second ticket; idempotency is keyed by `(runner_id, request_id)`, so another
    runner's `request_id` never matches.
  - The response carries `claim_id`, `ticket_id`, `station`, `legs` (the queued leg, R-BTN-83),
    `next`, `handoff_url?`, `path`, `snapshot_sha`, `default_branch`
    (R-BTN-143), `nonce` (6 hex, public: written in markers and the mirror's claim note, R-BTN-17),
    `previous_attempts` (R-BTN-24),
    `check_sha?`/`check_head_ref?` (R-BTN-153), and `resume?` (the conditions' restarts, a list,
    R-BTN-162).
  - The runner then reads the ticket from git and re-verifies it (R-BTN-34, R-BTN-5).
- **One claim runs a run of legs** (unnumbered). A claim runs as many legs as it can; finishing a
  ticket in one session is the norm and the cheapest path. Each leg starts with
  `POST /v1/runner/claims/{id}/advance` naming it (R-BTN-63): Baton checks the edge and the gates
  in one transaction and moves the claim on (event `advanced`, a new `claim_legs` row with its
  run number, `run_id` (R-BTN-63), `started_at` and `head_sha`) or refuses. The reply carries the
  run's `run_id`, its `leg_log` directory (R-BTN-128), the leg's resolved inputs (R-BTN-82) and Baton's advice flags; the course's own advice is `rank.mjs`'s (R-BTN-98).
- **R-BTN-38 (legs are stateless at their boundaries).** Each leg reads its input from, and
  leaves its output in, the ticket's repositories and their changes. Nothing a leg needs travels
  through a session's context, so any session can run any leg whose input is in place; a
  continuing session's context saves cost and is never a dependency. What git does not carry
  goes in the hand-off document (R-BTN-44).

### 9.2 Holding: the lease and the fence

- **R-BTN-6 (fencing).** The sidecar records `last_ok`, the time of its last accepted
  heartbeat. When `now − last_ok ≥ lease_timeout − 4 min` it marks the lease **lost** in its
  state file. A lost lease, or a heartbeat response that no longer lists the claim, means the
  session no longer holds the ticket. On reconnecting, a sidecar whose lease was lost ends the
  claim `released:lease-lost` itself.
  - A heartbeat refused `session-taken`, `runner-reaped` or `forbidden` marks the lease lost at
    once. `rate-limited` and `quota` do not: the sidecar backs off and retries, but an unaccepted
    heartbeat never renews `last_ok`.
- **R-BTN-26 (every fence check computes the lease itself).** The lease-lost flag is a
  shortcut. Each harness hook, each status-writing tool and the `pre-push` hook computes, from
  the state file and the **wall clock** (never a monotonic clock), `now − last_ok ≥
  lease_timeout − 4 min`, and treats the lease as lost when that holds or when the flag is set.
  When the state file is missing or unreadable while the session works a ticket (its git branch
  matches a course's current or previous `branch_pattern`, R-BTN-51), it asks Baton's holder
  query instead and refuses when Baton cannot be reached. The sidecar also checks on its own
  timer.
- **Three fence layers** (unnumbered), each applying R-BTN-26:
  1. On a lost lease the sidecar terminates every process group the harness started for a tool
     call still running; under a runner, the runner stops the leg (R-BTN-145), and in `session`
     mode interrupts the child session through the provider (R-BTN-119).
  2. A pre-tool hook denies `git push`, the forge's change-create and merge commands and
     status-changing writes, naming the ticket; the prompt-submit hook adds the notice to an idle
     session's next turn. The agent records what exists in notes (not fenced) and stops.
  3. A git `pre-push` hook in every workspace checkout refuses a push to a ticket's branch from a
     session whose lease on that ticket is lost. For every push to a ticket's branch, whatever the
     local lease says, it also asks `GET /v1/runner/branch-holder?repo=<owner/name>&branch=<name>`
     (the machine key, with `session_name` and the runner secret when the state file has them)
     and refuses when another live runner holds a ticket the branch maps to,
     a reaped claim on one is fence-pending, or Baton cannot be reached. Pushes to the default branch are not refused
     here (R-BTN-7 fences status writes).

  The holder queries (this one and R-BTN-7's) answer `held_by_other` relative to the runner the
  request names; asked
  by the key alone, Baton counts every active claim as another's, a claim of a runner of the
  same key included, since several runners may share one credential (§8.1).
  Baton maps a branch to tickets through every course's current or previous `branch_pattern`,
  among tickets whose home repository or `code_repos` reach that repository (R-BTN-140), naming
  only tickets of repositories granted to the key and following former paths (R-BTN-141). A
  branch that maps to tickets of two repositories sharing a local id is refused if either is
  held; a course whose ids may collide puts `{repository}` in its pattern.
- **R-BTN-7 (status writes are fenced against holders).** A tool that writes a ticket's status
  to git first asks `GET /v1/runner/tickets/{ticket}/holder` and is refused (`not-holder`, exit
  10) only when another runner's active claim holds the ticket or a reaped claim on it is
  fence-pending. With no active claim the write proceeds.

### 9.3 Suspending and handing off

- **R-BTN-40 (suspend, don't wait on the lease).** The holder decides whether to go on. It
  **suspends** at the station it reached — writes the hand-off, makes sure its last leg left its
  evidence, ends `suspended:<station>` (R-BTN-71) — when a gate refuses, when advice says a line
  the next leg needs is short and it has no better evidence (a call that just succeeded on that
  line, remaining quota its harness shows), when every leg leaving its station is `waiting` on
  something not in the course file's `short_waits`, or when it must stop for its own reasons.
  It may keep the claim for up to **30 minutes** on a leg `waiting` on a `short_waits` entry
  (R-BTN-72). The ticket then waits unheld and is recommended again, to any eligible runner,
  once its lines are forecast to have room. A suspension is a completed end, never a failed
  attempt.
- **R-BTN-44 (the hand-off document).** Every suspension or release — except a lost lease and a
  supersession — leaves a hand-off document, written by the leg script's `handoff(ctx)` for a
  successor with none of this session's context: what is done and where; what the next leg
  must do; decisions made and alternatives rejected, with reasons; what the environment needed
  that git does not hold; open questions. The course prescribes its sections and where it lives;
  for a course with changes, a comment on the ticket's primary change carrying a `baton:handoff`
  marker (station it rests at, leg last run), or, before any change exists, the claim's note and
  the branch's top commit message. The station function never reads its prose. A resuming
  session reads the newest hand-off and the resume record (R-BTN-24) first.

### 9.4 Ending a claim

A claim ends with `POST /v1/runner/claims/{id}/end`: `end_reason`, `reached`, `next` (required
unless `reached` is an end station, R-BTN-83), and as applicable `not_before`, `spawned`
(R-BTN-86), `outputs`, `detail`, `ended_at_sha` (R-BTN-8), `error: {type, message?}`,
`prerequisite` with `reading` or `commit` (R-BTN-126), `exit_status`
(R-BTN-153) and `session_url`. `detail` is a short course-defined label under the
untrusted-text rule (§12), stored and shown, never read. Baton stores `error.type`
(`claims.error_type`), never the message. Repeating the same end is answered `ok`; a different
end on an ended claim is refused `claim-ended`.

**End reasons.** This is the one list; other sections cite it.

| End | Status | When | Failed attempt |
|---|---|---|---|
| `done` | `completed` | the course's last leg is done: the ticket is at an end station | no |
| `suspended:<station>` | `completed` | the holder stops at the station reached (R-BTN-40, R-BTN-71) | no |
| `released:stale-board` | `released` | re-verification from git fails (R-BTN-5, R-BTN-34); the ticket was withdrawn or dropped from the board (R-BTN-147) | no |
| `released:cannot-finish:transient` | `released` | the environment failed; also an untyped exception, a retryable course `interrupt` type, a failing `close`, an invalid blocked end (R-BTN-126) | yes |
| `released:cannot-finish:contract-output` | `released` | a leg's output failed its schema or its station's entry (R-BTN-82, R-BTN-109) | yes |
| `released:cannot-finish:capability` | `released` | the ticket needs what no eligible runner holds; the ticket is held at once, `non-retryable:capability` | yes |
| `released:cannot-finish:spec` | `released` | the ticket or its course contradicts itself; also a non-retryable course `interrupt` type; held at once, `non-retryable:spec` | yes |
| `released:cannot-finish:contract-input` | `released` | an input failed its schema; held at once, raises `baton.contract` (R-BTN-82) | no |
| `released:lease-lost` | `released` | the holder's lease lapsed (R-BTN-6) | yes, once per distinct runner per ticket and leg |
| `released:blocked` | `released` | a prerequisite failed during the leg, or a raised condition or call outlived its wait (R-BTN-126, R-BTN-162, R-BTN-165) | no; counts toward `max_blocked` (R-BTN-122) except a `call` block |
| `released:leg-timeout` | `released` | the running leg's deadline passed (R-BTN-167, R-BTN-90) | yes |
| `released:requested` | `released` | an owner's release message, Stop leg (R-BTN-119) | no |
| `released:owner-cancel` | `released` | Cancel: hold plus release (§6) | no |
| `released:superseded` | `released` | Baton superseded the ticket (R-BTN-168) | no |
| `released:floor` | `released` | a guarantee a floor names broke on a repository the ticket reaches, and Baton released the claim (R-BTN-189) | no |
| `released:<bar reason>` | `released` | an owner bar that releases holders, with that bar's `reason` (R-BTN-67) | no |
| `released:course-changed` | `released` | the leg left the course under the claim (R-BTN-64) | no |
| `released:off-branch` | `released` | the claim's sha is not on the default branch (R-BTN-143) | no |
| reaped, actor `alarm` | `reaped` | the runner was silent past its lease timeout (§9.5) | yes |
| reaped, actor `admin:<fingerprint>` | `reaped` | an administrator's force-reap | no |
| reaped, actor `alarm:unacked-release` | `reaped` | a delivered `release` unacknowledged for 2 hours | no |
| reaped, actor `alarm:leg-timeout` | `reaped` | a delivered `leg-timeout` release unacknowledged for 15 minutes | as `leg-timeout` |

- **`cannot-finish` classes** are core's built-in `interrupt` types `error.<class>` (R-BTN-160).
  `transient` and `contract-output` are retried by the leg's policy; `capability` and `spec` are
  non-retryable: Baton holds the ticket at once (`hold_reason: non-retryable:<class>`) and raises
  `baton.retries` (R-BTN-122). A course's own
  `interrupt` type ends with the class `transient` when retryable, else `spec`, and its `type` in
  `error`.
- **A release** pushes the work done so far, then `close`, then `handoff` (R-BTN-72), except as
  R-BTN-119 and R-BTN-44 say. A holder told to release (a `release` message, §6) stops at its next
  safe point — at once for `requested`, `owner-cancel`, `superseded` and `floor` (R-BTN-119,
  R-BTN-189) — ends
  `released:<reason>` and acknowledges.
- Every end records a sync want (R-BTN-94), so confirmation never waits for an unrelated push.

### 9.5 Reaping and the fence

- **Reaping** (unnumbered). The alarm reaps every active claim whose runner has `now −
  last_seen_at ≥ lease_timeout_ms`: the claim becomes `reaped`, the runner gets `reaped_at` (no
  other reap sets it, R-BTN-19), and its pending and delivered messages become `expired`. The alarm also reaps a claim whose
  delivered `release` stays unacknowledged for 2 hours (15 minutes for `leg-timeout`). An
  administrator may force-reap any active claim from the dashboard (`POST
  /v1/ui/claims/{id}/reap`, confirmed per R-BTN-155), shown the runner's last-seen and
  last-activity times, and clear any pending fence (R-BTN-19). The next claimant concludes from what git holds and the resume record.
- **R-BTN-19 (fence before re-issue).** A claim reaped while its runner was **alive** — a
  force-reap (a retirement's included, R-BTN-47), an unacknowledged-release reap, a `leg-timeout` reap — is `fence_pending` with its
  `fence_incarnation` and `fence_deadline`, the reap instant plus the runner's
  `lease_timeout_ms`. Such a reap sets no `reaped_at`: the runner's next heartbeat is answered
  without the claim, so it can report the fence. The ticket is not claimable until that
  incarnation's sidecar, with its pre-reap secret, heartbeats, is told it no longer holds the
  claim, and reports `fenced: {claim_id, terminated: true}` — the lease marked lost and its
  running tool processes terminated (Baton logs `fence-cleared`) — or until an administrator
  clears it (below), or until `fence_deadline` passes, whatever the runner does meanwhile (a re-key, a new incarnation's heartbeats, a
  sidecar that heartbeats but cannot terminate a process); the alarm then clears it, logging
  `fence-cleared {deadline: true}`. Every check of the old incarnation has computed its lease as
  lost by then (`last_ok + lease_timeout − 4 min`, R-BTN-26). A fence still pending 30 minutes
  after the reap raises `baton.fence-pending` on the ticket, naming the runner and the deadline.
  A re-key never clears a fence (R-BTN-14).
  - **An administrator's clear.** An administrator may clear a pending fence at once
    (`claim.fence-clear`, `POST /v1/ui/claims/{id}/fence-clear`, destructive and confirmed per
    R-BTN-155, never delegated): the ticket is claimable and its seats free (R-BTN-178), its
    `baton.fence-pending` condition, if raised, is resolved, and Baton logs `fence-cleared {admin:
    <fingerprint>}`. The control is drawn, for an administrator only, on the claim wherever the
    dashboard shows it and on the `baton.fence-pending` condition in Needs you; it is its own
    action, never a condition restart (`ticket.resolve` clears no fence), and a freeze does not
    refuse it (R-BTN-88), so a seal waiting on the claim can proceed. The dialog shows the runner's last-seen
    time and says what the clear gives up: a process the old incarnation still runs can push
    until its own lease check fails (`last_ok + lease_timeout − 4 min`, R-BTN-26) — on a
    leg under an executor other than `builtin`, which may make no checks of its own, until the
    executor's `stop` returns (R-BTN-107) — and the next
    claimant's re-read of git (R-BTN-25) is then the only protection. Nothing a runner does
    extends a fence, and no other person's act ends one early.
  - A silence reap is not fence-pending — every check of that runner already computes the lease
    as lost — except on a claim running a leg under an executor other than `builtin` (R-BTN-107),
    whose session may make no lease checks of its own: every reap of such a claim is
    fence-pending, and the runner reports `fenced` for it only once the executor's `stop` has
    returned. A session the runner cannot reach before `fence_deadline` is not fenced: its later pushes are not noticed
    (R-BTN-46); the next claimant re-reads git before it writes (R-BTN-25).

### 9.6 Confirming an end

- **R-BTN-10 (confirmation by observation).** A completed end is **unconfirmed** until a
  snapshot observed after it is accepted (R-BTN-62), so the next claim's readiness is computed
  from facts read after the end. The end's position stands from the moment Baton records it
  (R-BTN-39); confirmation checks its evidence, not where it put the ticket. It is confirmed by
  the first accepted snapshot whose observation began after the end and that:
  - for an end that named `ended_at_sha` (R-BTN-8), carries the sync's `std:git.evidence@1`
    for it with `found: true` — the observation's `unconfirmed` list (§4.3) tells the sync
    which ends wait and what each named;
  - for an end that named none, is accepted at all;
  - for `done`, shows the ticket closed as done (`closed_tickets`) or absent, whatever it named;
    a check ticket's `done` only at the end's own `reached` and bound `check_sha` (R-BTN-153); a
    `cancel` leg's `done` (R-BTN-168) as an end that named no evidence is, by acceptance alone,
    since its ticket closes `withdrawn`, not `done`.

  Baton sets `confirmed_at` and logs `confirmed`; the sync posts nothing extra.
- **Claimable again** (unnumbered). A ticket is claimable only after a snapshot observed after
  its last claim ended (`end_observation`), and never while a completion is unconfirmed (one
  marked `superseded_at` excepted, R-BTN-168). A
  completion unconfirmed 6 hours after `ended_at` (its named evidence attested `found: false`
  or never attested) raises
  `baton.unconfirmed` and is never confirmed automatically; an administrator confirms or
  releases it from the dashboard (R-BTN-155).

### 9.7 Attempts

- **Failed attempts** (unnumbered). A claim end counts as a failed attempt exactly where the end
  table says. The count is kept **per ticket and leg** (`leg_attempts`, R-BTN-122), against the
  leg the claim was running or starting, and is the number of failed claims ended after the
  later of the ticket's newest hold-lift `override` event and the leg's last run reaching one
  of its outcomes: lifting a hold, or the leg completing, resets it (R-BTN-122). Context refreshes and
  suspensions are never attempts. What a failed attempt triggers — backoff,
  holding, `baton.retries`, an `exhausted` leg — is R-BTN-122's.

### 9.8 Resuming and replaying

- **R-BTN-24 (the resume record).** On every claim end, a suspension included, Baton writes the
  claim's `resume_json` from its activities (the runner drains its spool before calling `end`,
  and a close accepted in the 10-minute grace, §9.9, that carries `resume` rewrites it): every
  `resume` object an activity's detail carried
  (the one nested key allowed, §12), the last activity and its outcome, the legs run, the end
  reason and detail, and the transcript pointers. Core reads no particular
  activity kind. The claim response for a ticket with earlier ended claims carries
  `previous_attempts`, the newest 10, newest first, each with its resume record, legs run (each
  with its `run_id`, R-BTN-63) and hand-off URL, and `previous_attempts_total`;
  a leg receives them only as data in `BATON_RESUME` (R-BTN-144). The ticket history read
  (R-BTN-81) serves the records pruned, as its route row's `resume` (§14), to its *reader*, so a
  claim through git continues the change (R-BTN-74). (`ctx.resume`, a condition's chosen restart, is R-BTN-162's
  and unrelated.)
- **R-BTN-25 (idempotent side effects).** Every side effect is keyed by the ticket so a later
  attempt finds the earlier one's work: before creating a branch the claimant continues an
  existing remote branch matching the course's `branch_pattern` (current or previous) for this
  ticket, including one the resume record names — a resume record naming any other branch is
  ignored;
  before opening a change it reuses an open one from that branch. The activities that push or
  open a change record the branch and change
  in their detail's `resume`.
- **R-BTN-84 (any leg run can be replayed).** `baton leg replay <ticket> <leg> [--run <n>]
  [--against <sha>]` re-runs one recorded run on a runner, without a claim and writing nothing to
  Baton.
  - It reads the run from the ticket's history (snapshot sha, contract version) and its inputs
    with digests from `leg_run_inputs`; a run's inputs record the ticket's `version` and the
    digest of what the source's `read` returned (B-183), so a replay fetches the ticket as the
    run read it. Against a `current` source whose version has since moved, replay reports the
    mismatch and refuses — it does not silently replay against new content; a `pinned` source's
    version names the bytes themselves. It
    clones with a read-only credential the course's scripts
    at that sha (which must pass R-BTN-143) and the ticket's code at the run's `head_sha`;
    fetches the inputs and fails on a digest mismatch.
  - It runs `run(ctx)` with `ctx.replay` set, in R-BTN-144's replay environment: no write-capable
    git or forge credential, ssh-agent or credential helper; the model provider's key is kept only
    when `replay_env` or `--env` names it.
    The runner does not call `close` and records what it would have written.
  - Outputs and would-be writes go to a local replay report, masked as R-BTN-144 masks a leg's
    output; `--against <sha>` compares them with
    a run of the scripts at that sha on the same inputs. A leg with `"replay_safe": false` is
    refused. Replay reproduces code and inputs, not outputs.

### 9.9 Activities and transcripts

- **Activities** (unnumbered). An activity is one thing a runner does under its claim, drawn on
  the dashboard's timeline: `POST /v1/runner/activities` with `{id, claim_id, parent_id?, kind,
  seq?, label?, source, started_at, ended_at?, outcome?, detail?}` (detail and label under §12's
  rules).
  - **Kinds** are the claim's course's `step_kinds` (R-BTN-50), `other`, or one of core's:

    | Kind | Recorded by | When |
    |---|---|---|
    | `condition` | Baton, on `POST /v1/runner/claims/{id}/conditions` | a leg raises a condition (R-BTN-160) |
    | `condition-wait` | the runner | a leg waits in its claim for a handler (R-BTN-162) |
    | `context-handoff` | the runner | a fresh session replaces a full one, with both sessions' links (R-BTN-123) |
    | `leg-log-write-failed` | the runner | a leg log's final write failed (R-BTN-128) |

  - **Sources.** `skill`: a skill marks a phase with `baton-activity start <kind> [--seq N]
    [--label …]` and `baton-activity end <id> --outcome <o>`. `hook`: harness hooks start and end
    an activity for the commands the course's matchers select (pure, tested functions matching
    anywhere in a compound shell line); a course's own tools report for themselves. Other tool
    calls are not activities.
  - **Pairing.** A hook activity is keyed by the harness's tool-call id in `call_id`; the
    post-tool or failure event closes it `succeeded` or `failed`. A denied call opens none; one
    whose post event never comes stays open until the claim ends.
  - **Parenting.** The reporter names `parent_id`; core infers none. A `parent_id` naming another
    runner's or claim's activity is refused.
  - **Before a claim.** An activity started with no claim is stored without `claim_id`, checked
    against the step kinds of the courses the runner declares, and linked to its next claim.
  - **Delivery.** Reporters append to the spool (§8.1); activity ids are per runner, so a retry
    is an upsert and no runner touches another's rows.
  - **Ending.** When a claim ends, its open activities close `abandoned` at `ended_at`. For 10
    minutes after, updates that only close its activities are accepted; later updates, and any
    that would open an activity on it, are refused `claim-ended`, which never marks the current
    lease lost.
  - The **current activity** is the newest open one; the heartbeat and a `status_report` (§6)
    return it. `started_at`/`ended_at` are the runner's clock and order activities within a
    claim; `received_at` is Baton's. No lease logic reads activity times.
- **R-BTN-20 (the archiver reports what it wrote).** A harness's transcript archiver appends each
  `(repo, path, pushed_at)` it pushes to the session's spool; the sidecar reports it on the next
  heartbeat. Baton never derives a path by convention, and keeps every path a session reports;
  the dashboard links the newest.
  - A child session (a reviewer, a runner's leg session) runs with `BATON_PARENT=<runner id>`
    and `BATON_ACTIVITY=<activity id>`: no sidecar, no runner; its archiver appends to the
    parent's spool with `role: subagent` and the activity id. An in-process subagent has no
    transcript of its own.
  - A path reported during a claim links to it; one reported with no claim links to the runner's
    next claim; a path pushed across several claims links to each. The dashboard shows
    `claimed_at` beside the link.
  - **Validation.** `repo` is in the claim's home repository's `transcript_repos` (owners'
    setting, R-BTN-66): a GitHub `owner/name` or `<forge>:<web_base>` (`github`, `gitlab`,
    `gitea`), never a registered repository (`invalid-params`). `path` matches
    `^[A-Za-z0-9._/-]{1,256}$` with no `..` segment. Links are only the base followed by the
    forge's file path (`/blob/HEAD/`, `/-/blob/HEAD/`, `/src/branch/HEAD/`) under R-BTN-92's link
    rule. Baton holds pointers, never content; reading needs the viewer's own access. An archiver
    under a runner masks per R-BTN-144.

