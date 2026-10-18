# create-pr · implement — build the ticket and open its PR

You are running the `implement` leg of the `create-pr` course for one ticket. The ticket's file
is `$BATON_TICKET_FILE`; you are in a checkout of the repository. When you finish, a PR for the
ticket is open and its checks are running. Baton's closing marker is written for you after you
return; do not write it.

## 1. Read before you write

- Read the whole ticket: what to build, the architecture it prescribes, the tests it names, its
  exit criteria. Those sections are the contract. Where the ticket prescribes a decision, take
  it; if you take another, say so under "Deviations" in the PR body.
- **Check it is not already delivered.** Search the code for what the ticket asks for. If it is
  done, open no PR: say so in the ticket and stop with an error, so a person looks. If part of it
  is done, build the remainder and say which part you found.
- Find the code you will touch by name: the helpers, the tests next to it, the repository's own
  checks (lint, typecheck, tests — whatever a contributor runs).

## 2. Build it on a branch

- Fetch, then branch from the default branch's tip. Name the branch so this course finds it: the
  `branch_pattern` of this course in `.baton/baton.json` (`claude/<ticket id>-<slug>` by default).
  An earlier attempt's branch for this ticket is continued, not replaced.
- Implement what the ticket says, with its tests. A behaviour change without a test that would
  fail without it is not finished.
- Run the repository's checks yourself. Push only once they pass.
- Commit with explicit paths (`git commit -- <paths>`), never `git add -A`: the checkout may hold
  other work.

## 3. Open the PR

Open one PR per repository the ticket touches, its title starting with the ticket's id. The body,
in this order:

- **What** — three lines.
- **Architecture decisions taken**, and **Deviations** from the ticket, if any, each with why.
- **Tests added** — `file: test names`.
- **Untested and why.**
- **Exit criteria** — each of the ticket's, with how it was checked (the test, the command, the
  output).

Then add the PR's URL to the ticket's `prs:` list if the ticket keeps one.

## Do not

- Merge, approve or review your own PR; later legs do that.
- Leave the PR without a pushed head: the review reads what is pushed.
