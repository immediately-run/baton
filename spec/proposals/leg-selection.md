---
title: "Proposal — leg selection: what remains after R-BTN-205"
description: "The selector that chooses a ticket's next leg is specified as R-BTN-205; this page keeps its scenarios, unnumbered until built, and the budget still to be measured."
---
# Proposal — leg selection: what remains after R-BTN-205

**Status:** specified — the design is [R-BTN-205](../BATON_SPEC/05-courses.md#sec-5-3), `specified
B-351`, with its changes to R-BTN-83, R-BTN-70, R-BTN-74, R-BTN-133, R-BTN-174, R-BTN-63 and
R-BTN-127 marked not built in their sections. The owner's constraints and rulings are in
`spec/BATON_SPEC_HISTORY.md` (2026-11-27). This page holds only what is not yet rule text.

## The budget, to be measured

R-BTN-205 bounds a selector call at 10 seconds and 256 MB and treats a want as untaken after 15
minutes. The owner left these open ("not sure"); they are starting values. B-351 measures the
standard courses' selectors on the local host and on a sandboxed executor, then amends R-BTN-205
with the values it measured, with what a runner declares to take selection wants.

## Scenarios (to be numbered when built)

- A branching station: a review leg's inline verdict `changes-requested` selects `fix`; `approved`
  with CI green selects `merge`; no git marker is read.
- A ticket source that is not git: an issue-tracker fact moves the selection, and the sync posts
  nothing for that ticket.
- The rate limit: a reading of 0 remaining selects `wait` until its reset; at the reset the want
  is taken and the leg is queued.
- Host memory: `needs.memory_mb` above every connected runner's but within a registered one's
  shows waiting for capacity; above every registered runner's raises
  `baton.selection-attention`.
- A selector that names a leg not leaving the station, throws or times out raises
  `baton.selection-failed`, and the ticket shows it.
- No runner up: the want's age shows on the board; the first runner to start takes it.
- `baton ticket why --replay` reproduces a stored verdict; a forged verdict posted by a runner
  does not reproduce, and a gate still refuses the merge it would have queued.
