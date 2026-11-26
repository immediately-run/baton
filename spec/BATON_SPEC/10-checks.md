---
title: "10. Checks"
description: "The rules of this section leave with their code."
---
## 10. Checks

The rules of this section leave with their code. A **check course** is a course a repository's owners name in their `checks` setting. What is built
is that map and the rule that only a command's exit status reaches the station mapped to
`success`. The rest of the design — check tickets, check-runners, the bound check claim, the
`forge-check` deliverer and its read-back — is not built and is in
[the proposal page](../proposals/checks-and-executors.md).

- **R-BTN-114 (the owners' conclusions map).** `status: retiring B-140` To be removed with its code. The owner
  setting `checks: {<course>: {name?, url?, conclusions: {<end station>: "success" | "failure" |
  "timed_out"}}}` (R-BTN-66, `PUT /v1/owner/{repository}/settings`) maps a course's end stations
  to conclusions, so no edit in git turns a failure into a success.
  - It names at most 200 courses, each one the repository registers. A course's map names only
    end stations of the course, exactly one `success`, exactly one `failure` and at most one
    `timed_out`; `name` and `url` are strings of 1 to 100 characters. Anything else is refused
    `invalid-params`. `neutral` is not a conclusion.
  - A change that maps a station to `success` that was not, or removes a course's entry, is a
    loosening (R-BTN-186); any other change is a tightening. A delegated key changes no `checks`
    map (`forbidden`).
  - A course file carries no `checks` (R-BTN-69).
- **R-BTN-153 (a verdict is a command's exit status).** `status: retiring B-140` To be removed with its code.
  An `advance` or end may carry `exit_status`, an integer from 0 to 255: a check command's exit
  status. No shipped runner sends one. In a course the owners' `checks` map names, Baton refuses `invalid-params`:
  - an arrival at the station mapped `success` that does not carry `exit_status: 0`;
  - `exit_status: 0` on an arrival at a station mapped `failure` or `timed_out`;
  - any `exit_status` on an arrival at the station mapped `timed_out`;
  - a `done` end that rests at a station the map does not name.

  So an agent's result, which carries no `exit_status`, reaches only the `failure` and
  `timed_out` stations. An `advance` arriving at a station the map does not name is not
  constrained.
- **R-BTN-115 (the forge-check deliverer and `forge-check` entries).** `status: retiring B-140` To be removed with its code. Baton queues no `forge-check` entry and no runner delivers one. Built are the
  policy's `outbox.forge-check` knob (R-BTN-188) and the instance setting `check_app_id`
  (§12.7), which nothing reads.
