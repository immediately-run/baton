---
title: "Proposal — leg selection: one selector per course"
description: "A course's own selector chooses each ticket's next leg from Baton's record, run by a runner through its executor, with a stored verdict that says why, what it waits for, or that a person must act."
---
# Proposal — leg selection: one selector per course

**Status:** proposal — not built; moves into BATON_SPEC §5 and §6 when built (ticket: B-351; after
B-120)

The owner, 2026-11-26, on how Baton chooses a ticket's next leg: "I feel this is a key mechanic
which is too challenging to grasp right now." This page proposes one mechanism in place of the
several that share the choice today. The rules it would change are written `R-BTN-n (proposed)`;
each stays defined in its section until this is built.

## 1. What decides today

Five things set a ticket's queued leg, and two more filter it:

| Sets the queued leg | Where |
|---|---|
| the finishing leg's `next` (R-BTN-83) | the leg script; the runner's `decide()` (`src/runner/protocol.ts`) checks it against the graph |
| the sync's board post, folding git markers (`next_source` `marker`, `course`, `inferred`) | the station functions (`src/defaults/ticket-state.ts`, `src/defaults/course-pr.ts`); `src/core/stations.ts` writes it. R-BTN-83 says no snapshot sets a position; B-120 removes this |
| Baton's own transitions: a person leg's answer or expiry, an exhausted retry | `src/core/questions.ts`, R-BTN-116, R-BTN-122 |
| the owner's route or adopt (R-BTN-39) | core |
| the course's `start_leg` | core |

| Filters it | Where |
|---|---|
| readiness: each leg out of the station `ready` or `waiting` (R-BTN-70) | the station function, in the sync |
| gates and blocks: refuse a claim or an advance (§7.2, §6) | `gatesFor` (`src/core/gates.ts`), `src/core/blocks.ts`; `recommend` in `src/core/claims.ts` orders what passes, as advice |

## 2. The owner's constraints

From the owner, 2026-11-26:

1. "the logic for selecting the next leg of a ticket based on its current station should be
   entirely customizable."
2. "The leg may depend on many different prerequisites being met, some of which can be
   conveniently expressed as baton metrics readings. For example, we should not start a leg
   requiring a sandbox with more memory than what the host can allocate. we should not start a
   leg that requires access to the GitHub API if we have been rate limited temporarily."
3. "Like all custom logic, it should be straightforward how to sandbox this when Baton is being
   used in a more secure setup like the one Fieldhouse implements."
4. "it should be possible for a user to see why a particular leg was chosen in the dashboard or
   using the CLI."
5. "where no [leg] can commence, it should be clear when the next action of the ticket may be
   determined, or that the ticket needs human attention because the next leg cannot be
   calculated."
6. "the station function should not assume that Git is the communication channel between legs.
   This may often be the case, but this is definitely not guaranteed."

And two facts of the current design this keeps: core runs no repository code, and every call into
repository code goes through a runner's executor (R-BTN-107, R-BTN-133).

## 3. The selector

R-BTN-83 (proposed). **Each course has a selector**, `select.mjs` in its course directory, beside
`course.json`; a standard course has a default. Its one export, `select(ctx)`, is pure: it reads
`ctx` and returns a verdict, with no network, no file writes and no clock but `ctx.now`. It runs
through the wrapper (R-BTN-133) like every other call into repository code, in a read-only
worktree of the course's snapshot.

### 3.1 What it reads: Baton's record, never git directly

`ctx` is built by core from what Baton has recorded. Git is one source of facts among others, never
the channel between legs:

| `ctx` field | What | Recorded from |
|---|---|---|
| `position` | the station, the path, the runs of each leg | arrivals (R-BTN-83) |
| `outputs` | each earlier leg run's outputs: inline `value`s, and pointers Baton never fetches (R-BTN-82, R-BTN-108) | the holder's `advance` or end |
| `facts` | what fact sources attested about the ticket: the git sync is one (its PR, CI, reviews); an issue-tracker source or another system's poster are others | `std:*` attestations (R-BTN-191, R-BTN-203) |
| `readings` | the readings the course subscribes to (`course.json` `selector.readings`), each in force | R-BTN-76 |
| `dependencies` | the stations of the tickets it depends on | the board |
| `fleet` | per runner class: the capabilities and `needs` dimensions live runners declare | heartbeats (R-BTN-174) |
| `now` | Baton's clock | R-BTN-32 |

A leg whose judgement decides the branch says so in an inline output — a review leg returns
`{verdict: "changes-requested"}` — and the selector reads `ctx.outputs.review.verdict`. Anything
that decides a branch is an inline value, small and schema-bound; the selector cannot look inside
a pointer, since fetching would end its purity.

### 3.2 What it returns: one of three verdicts

```js
{ run: "merge",
  needs: { memory_mb: 4096, capabilities: ["github-api"] },
  because: [{ check: "approved", ok: true, value: "2 reviews at 3f2a1c" },
            { check: "ci-green", ok: true }] }

{ wait: { until: "2026-11-26T15:02:00Z", on: ["reading:github-api/rate"] },
  because: [{ check: "github-rate", ok: false, value: "0 of 5000, resets 15:02" }] }

{ attention: "review requested changes and fix has run 3 of 3 times",
  because: [...] }
```

- **`run`** names a leg leaving the current station. `needs` says what a runner must have to take
  it (§4).
- **`wait`** says when to ask again: at `until`, or when one of `on` changes (an output, a fact
  type, a reading, a dependency). At least one of the two is required: a wait that names neither
  is refused as an `attention`.
- **`attention`** says that no leg can be chosen without a person, and why.
- **`because`** lists the checks the selector made, each `{check, ok, value?}`: `check` an
  identifier, `value` at most 128 characters. Core stores it bounded like an inline value
  (R-BTN-108) and the dashboard shows it as text (§10.4).

### 3.3 What core does with it

Core checks the verdict, then records it with the input's digest, the selector's course version and
the key of the runner that ran it.

- A `run` whose leg does not leave the station, a malformed verdict, a crash or a timeout is
  recorded as a failed selection and raises a condition (R-BTN-163, proposed
  `baton.selection-failed`). The ticket shows it as needing attention.
- An `attention` raises a proposed `baton.selection-attention` naming the reason.
- A `run` queues the leg (`next_source: selector`). The gates still decide every claim and advance
  (§7.2). A verdict is never a gate.
- A `wait` is a stored wait with its `until` and triggers. Core asks again when one fires.

## 4. Prerequisites: the ticket's, and the host's

The owner's two examples fall on either side of one line:

- **About the ticket and the world** — a rate limit, a dependency, a review's verdict — the
  selector decides, from `readings`, `facts`, `outputs` and `dependencies`. A GitHub rate limit is
  a reading, and the verdict is `wait until <reset>`.
- **About the host that would run it** — memory, a sandbox class — the selector states as
  `needs`, and core matches them against each runner when it offers the leg, as it matches
  capabilities now (R-BTN-174). The runner declares its `needs` dimensions in its
  heartbeat.

The split keeps the selector free of any one host, so it runs once per change and not once per
polling runner. It also lets core tell **wait** (no runner that could take it is free) from
**attention** (no registered runner declares enough: `fleet` shows the largest), and say which.

Readings stay advice to core (the owner's 2026-11-19 ruling, R-BTN-76). Here they reach a leg
through the selector's verdict, not through a requirement core evaluates; the deferred instance
form of `requires.attestations` (B-146) is not needed for it.

## 5. Who runs it: a runner, through its executor

Core runs no repository code. A selection is a small job a runner takes:

- **After an arrival.** The runner that has just finished the leg runs the selector for that
  ticket on the same executor and sends the verdict with its `advance` or end. Core builds `ctx`
  from the record the arrival would make and hands it back on the claim's last heartbeat, so
  the runner selects over Baton's input, not its own.
- **Otherwise** — a fact, a reading, a dependency or an `until` fired — core records a
  **selection want** for the ticket, carrying the built `ctx`. Any live runner with a grant for the
  repository and the course in its declared `courses` takes it, runs the selector and posts the
  verdict in a signed request. A want no runner takes within a set time (§9, question 3) shows
  as "awaiting selection: no runner can take it", with its age.

Sandboxing is the runner host's executor, as for a leg (R-BTN-107): Fieldhouse's E2B executor
sandboxes a selection as it does a leg, and since a selector needs no network, no writable
checkout and seconds of time, it can take the executor's strictest profile.

## 6. Seeing why

- `baton ticket why <id>` prints the stored verdict: its kind, its `because` lines, its `until` and
  triggers or its `needs`, the selector's course version, and which runner key ran it.
  `--replay` re-runs the selector, locally, on the recorded `ctx` and says whether it gives the
  same verdict. A pure selector over a recorded input always should; a difference is a finding.
- The ticket's dashboard view shows the same, and the board shows each ticket's verdict kind:
  queued, waiting (until when, on what), awaiting selection, or needs attention.

## 7. Trust

- **A verdict is a claim, like the holder's `next` today.** A compromised runner can post a false
  one, and a holder can return any output. Whatever protects something is a gate in `gatesFor`,
  never a choice of route: merging is guarded by its trusted-leg gates and review attestations
  (R-BTN-181, R-BTN-182), not by which leg the selector chose.
- **Under `protected`**, `select.mjs` is a protected path (R-BTN-184), and the policy may require
  selection by a runner class it trusts, as it keeps trusted legs to trusted runners.
- **Replay** makes a false verdict detectable after the fact: its input is Baton's record and the
  selector is pure.

## 8. What it replaces

| Today | With the selector |
|---|---|
| the holder's `next`, checked by `decide()` | gone: a finishing leg reports the station it reached and its outputs. A suspension or release re-queues its own leg |
| the station function's readiness (R-BTN-70) | gone: the verdict's `run`, `wait` or `attention` |
| the sync's posted positions | gone with B-120; the sync posts facts |
| `baton.missing-next` | `baton.selection-failed` and `baton.selection-attention` |
| `resource` advice rows | the selector's `wait` on a reading |

The owner's route stays, as an explicit pin over the selector (`next_source: owner`), as do Baton's
own transitions (R-BTN-116, R-BTN-122).

## 9. Open questions

1. **Course order.** Should a course with no `select.mjs` fall back to a built-in default — the
   first leg out of the station, in course order, whose declared `needs` the fleet meets — or
   should every course be required to ship one? The standard courses would ship theirs either
   way.
2. **The `because` text and R-BTN-33.** Baton stores no item text. `because` values are
   course-written: bounded to 128 characters and shown as text, or kept to identifiers and
   numbers only?
3. **The selector's own budget.** Time and memory limits per call, what a runner declares to take
   selection wants, and how long an untaken want waits before the board says no runner can take it.

## 10. Scenarios (to be numbered when built)

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
