# Baton's design-time model

Run `npm run model:quick` after changing the model (R-BTN-68). The check uses Quint's
TypeScript evaluator, without a JVM. It typechecks the modules, runs deterministic regressions,
samples the safety conjunction with fixed seeds, and requires each reachability witness to
find its target state. This is sampling, not exhaustive verification or a liveness check.
It does not establish that the implementation conforms to the model.

| File | Role |
| --- | --- |
| `baton.qnt` | State and transitions for claims, fences, course positions, observations, bars, blocks, retry and part of the fleet. |
| `properties.qnt` | Safety properties and their spec references. |
| `instances.qnt` | `sim`: three runners, two tickets and two sync slots, with a shared capacity limit. The simulation samples both all actors and a progress-focused step relation. |
| `regressions.qnt` | Deterministic runs, including cases random sampling rarely reaches. |
| `witnesses.qnt` | Reachability probes on a fixture without the shared capacity limit, so several tickets can progress together. A reported invariant violation is a successful witness. |
| `check.mjs` | Runs the checks above. |

The model deliberately schedules at most one claim per runner; this is a model bound, not a
Baton invariant. R-BTN-4 permits several claims per runner, covered in S-BTN-229. The model
uses a fixed course and bounded time, claims and external moves; it does not cover all courses,
runner execution, or arbitrary production state.

`npm test` separately checks the implementation. `test/model/interleavings.test.ts` exercises
one live holder per ticket, observation ordering, confirmation freshness and evidence, staleness
and regression, run limits, writing-leg bars and claim/advance gates on the real local host.

The defects originally found by this work remain covered:

- Overlapping observations: `overlappingSyncRunsRefusedTest` in `regressions.qnt`.
- An end blocking without an event: `endLeavingTheTicketBlockedLogsBlockedTest` in `regressions.qnt`.
- A reading older than an advance judging regression: S-BTN-36.
- A `done` not confirmed at an end station: S-BTN-40.
