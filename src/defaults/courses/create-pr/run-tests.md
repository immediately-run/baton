# create-pr · run-tests — the deterministic gate before every review round

No agent runs this leg — no model, no session, nothing to instruct. Baton's own stub executes
the repository's test script (`npm run <test_script>`, the course file's `test_script`, default
`test`) in the checkout, bounded and non-interactive, once: the script's exit is the gate's
whole verdict. Green advances to the review round; red routes to `fix` — never back to
`implement` — and the failing script's last lines are named in the marker the close commits on
the branch (`Baton-Tests: red`), so the log alone says what failed.

What you will see of it:

- **the marker** — the close commits an empty marker on the PR's branch and pushes it:
  `Baton-Tests: green` or `Baton-Tests: red` (with `Baton-Claim:` naming the claim), the red
  marker's body holding the script's last lines. It is the gate's record in git; a later push
  re-opens the gate, whatever the marker said.
- **the budget** — the gate may run 30 times (and `fix` 30 with it) while the review rounds
  stay at 3: the gate is deterministic and cheap, and spending retries there harms nothing the
  way a wasted review round does.

A repository that runs its tests differently replaces this leg's run, never its close:
`npx baton repo init --course create-pr --override run-tests`.
