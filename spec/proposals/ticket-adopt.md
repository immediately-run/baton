---
title: "Proposal — the owner's ticket adopt"
description: "An owner's command that sets a ticket's position, so legs done outside Baton enter its course history."
---
# Proposal — the owner's ticket adopt

**Status:** proposal — not built; moves into BATON_SPEC §1 (R-BTN-39) when built (tickets B-120)

R-BTN-39 (proposed). `baton ticket adopt <ticket> [--at <station>] [--next <leg>] [--ran <leg>,…]`
(R-BTN-127; `POST /v1/owner/{repository}/tickets/{ticket}/adopt`) sets the ticket's position. It
is how legs done outside Baton (while Baton was unreachable, in an owner's session, or in a
clean-up) enter its history: a deliberate act of a key holder, never a side effect of a push.

- **Who.** A credential on the repository's `approvers.policy` list (R-BTN-188; under
  `protected`, a `human` key), or an administrator under the same human gate (R-BTN-185); never a
  delegated key (R-BTN-186, R-BTN-130). It overrides history and resets a limit, so it is one of
  the actions `approvers.policy` governs (R-BTN-186). A course change that maps the ticket's
  station and leg by `renamed_from` needs no adopt: Baton rewrites them itself (R-BTN-64); only a
  station or leg the new file lacks waits for one.
- **Where.** The station given, or without `--at` the station the latest snapshot's facts imply
  (the station function's optional implied station, R-BTN-74), refused `nothing-implied` where
  the course implies none. Station and `next` must be the course file's, `next` leaving the
  station; absent, `next` is the station's first listed leg. The adopt restarts `next`'s run
  count (R-BTN-63), so runs already made do not refuse it; the runs `--ran` adds are recorded
  before `runs_from` and do not count toward it.
- **What it writes**, in one transaction: if a claim is active, its `release`
  (`released:requested`) and its fence (R-BTN-19), both before the position; the position
  (`next_source: owner`), its path extended by one entry
  `{leg: null, reached: <station>, adopted: true}`; one run in `claim_legs` (claim null) for each
  leg `--ran` names, so `max_runs` counts the legs done outside, and none otherwise; any
  unconfirmed completion on the ticket marked `superseded_at`, so the ticket is claimable after
  the next snapshot (R-BTN-10); a `history-adopted` row with both positions and the runs added;
  and the ticket's attempt window reset (R-BTN-122).
- An adopt records a sync want (R-BTN-94), and an arrival Baton did not apply is settled by an
  adopt or a route.
