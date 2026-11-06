# create-pr · run-tests — the deterministic gate before every review round

No agent runs this leg — no model, no session, nothing to instruct. Baton's own stub finds the
ticket's PR branch in the home repository (the course's branch pattern), fetches its head, and
runs the repository's test script there (`npm run <test_script>`, the course file's
`test_script`, default `test`) in a scratch worktree, bounded and non-interactive, once: the
script's exit is the gate's whole verdict. Green advances to the review round; red routes to
`fix` — never back to `implement` — and the marker names the failing script and its last lines,
so the log alone says what failed. The home checkout's own branch and working tree are never
touched; its `node_modules` is linked into the worktree when it has one.

What you will see of it:

- **the marker** — an empty commit on the PR branch, on the head it tested:
  `Baton-Tests: green` or `Baton-Tests: red`, `Baton-Tested: <the head>` and `Baton-Claim:
  <the claim>`, the red marker's body holding the script's last lines. It is a record, not the
  authority: the sync counts it only as the evidence Baton recorded for that claim's run, so a
  marker anyone else writes counts for nothing. A later push re-opens the gate, whatever the
  marker said.
- **the budget** — the gate may run 30 times (and `fix` 30 with it) while the review rounds
  stay at 3: the gate is deterministic and cheap, and spending retries there harms nothing the
  way a wasted review round does.
- **a PR it cannot reach** — the gate tests the home repository's one PR branch. A ticket whose
  PRs are in other repositories, or that has several at home, is listed under Needs you
  (`run-tests-unreachable`) instead of looping; the owner answers `skip` through Baton to waive
  the gate for that ticket.
- **no verdict** — npm that cannot start, or a kill the gate's own bound did not send, fails the
  leg without a marker; a timeout or output past the bound is red, named.

A repository that runs its tests differently replaces this leg's run, never its close:
`npx baton repo init --course create-pr --override run-tests`.
