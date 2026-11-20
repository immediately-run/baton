---
title: "16. Adoption"
description: "Legacy, removed with its code (R-BTN-193)."
---
## 16. Adoption *(appendix; legacy)*

Legacy, removed with its code (R-BTN-193). This section states what the built cutover and
mirror code still does for a repository that coordinated its claims through git before Baton.
A repository registered with `cut_over: true` needs none of it. The section, and every passage
elsewhere that serves only it, is deleted when the code is removed.

### 16.1 Cutover

- **R-BTN-28 (cutover is one-way server state).** Legacy, removed with its code (R-BTN-193).
  Cutover is per repository: `repositories.cutover_at`, set once; no call clears it. A
  repository registered with `cut_over: true` (`POST /v1/admin/repositories`) starts cut over.
  - **Before cutover** Baton shadows git. Runner claim calls return `not-cut-over`; a git claim
    tool reports each transition to `POST /v1/runner/shadow-report` (`{transition: claim | set,
    ticket_id, status, nonce, at}`). Baton records and decides nothing; a report its
    constraints refuse is logged `shadow-conflict`.
  - **The act.** An administrator sends `POST /v1/ui/cutover {repository, confirm: true}`,
    confirmed per R-BTN-155. `GET /v1/runner/mode?repository=` answers `{mode, cutover_at?}`,
    and the heartbeat carries `mode: {<repository>: shadow | cut-over}`.
  - **Legacy import**, in the cutover's transaction. Each ticket git shows claimed with no
    Baton claim becomes an active claim of its own `legacy` runner (`kind: legacy`, `hostname:
    legacy`, `session_name` the claim note's session or `item-<id>`, credential `legacy`, an
    unusable secret hash) at the posted station, with that path as `start_path`. Legacy runners
    are exempt from `(hostname, session_name)` uniqueness. A legacy claim is reaped at
    `reap_after`, the claim note's date plus 7 days, never by lease expiry.
  - **Adoption.** A runner whose `session_name` equals a legacy runner's requests the claim
    with `POST /v1/runner/adopt {ticket_id}`, answered `{pending: true}` until an administrator
    confirms that runner's request (`POST /v1/ui/adoptions/{claim}/confirm {runner_id}`, a
    confirm code); other requesters are then refused `forbidden`. The adopted claim keeps its
    station and `start_path` and runs no leg; the adopter's first `advance` re-enters the leg
    under its own lease.

### 16.2 The reference deployment's rollout

The rollout is complete; its plan is in `spec/BATON_SPEC_HISTORY.md`.

### 16.3 The git mirror

A **mirror** is optional, per repository: a workflow (`mirror_workflow`, or a `mirror`-role
sync key, R-BTN-93), kept outside Baton, that writes Baton's claim events into git.

- It reads its own repository's events from `GET /v1/sync/events?after=`. Each read's `after`
  acknowledges everything up to it, never past the last event; the acknowledgement is
  `repositories.mirror_acked_seq`, which a seal waits for (R-BTN-88). The mirror is wanted
  while an event of a kind it writes has a seq above it (R-BTN-94). An ended claim's events
  carry its activities and transcript pointers; nothing in the feed names a holder (R-BTN-36).
- **R-BTN-17 (preconditions, or skip).** Legacy, removed with its code (R-BTN-193). The mirror
  writes one commit per ticket transition, only over the status the event expects: `claimed`
  writes `in-progress` only over `available`; `released` and `reaped` write `available` only
  over `in-progress`. Any other status skips and logs the event; nothing is overwritten.
  Delivery is at least once and idempotent: the cursor advances only after the push lands.
  Only claims that start at the course's start leg are mirrored.
- **Foreign claims.** The mirror reports a claim commit it did not author to
  `POST /v1/sync/foreign-claim`. Over an active Baton claim it is logged `foreign-claim`, the
  holder keeps its claim, and the mirror writes the holder's status back. With no
  Baton claim it is imported as a legacy claim (§16.1).
