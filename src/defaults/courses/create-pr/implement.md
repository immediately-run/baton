# create-pr · implement — build the ticket and open its PR

You are running the `implement` leg of the `create-pr` course for one ticket. The ticket's file
is `$BATON_TICKET_FILE`; you are in a checkout of the repository. When you finish, a PR for the
ticket is open and its checks are running. Baton's closing marker is written for you after you
return; do not write it.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84). A repository's `agent_wrapper` in `.baton/baton.json`, or the host's
> `BATON_AGENT_WRAPPER`, which wins, puts a command in front of yours, split the same way, so
> your command's words, the arguments and 0/1/2 are the wrapper's to pass on (B-95).

## 1. Read before you write

- Read the whole ticket: what to build, the architecture it prescribes, the tests it names, its
  exit criteria. Those sections are the contract. Where the ticket prescribes a decision, take
  it; if you take another, say so under "Deviations" in the PR body.
- **Check it is not already delivered.** Search the code for what the ticket asks for. If it is
  done, open no PR: say so in the ticket and stop with an error, so a person looks. If part of it
  is done, build the remainder and say which part you found.
- Find the code you will touch by name: the helpers, the tests next to it, the repository's own
  checks (lint, typecheck, tests — whatever a contributor runs).

## 2. Write it the way this codebase is written

People who did not watch you write this will maintain it. Aim for code a careful member of this
team would have written, not the fewest steps to a working feature.

- **Name your precedent.** Before writing, find the two or three pieces of existing code most like
  what you are about to build, and follow their structure, naming, error handling and file
  layout. If none fits, say so in the PR body rather than inventing a pattern silently.
- **Reuse before you write.** Search for the helpers, types and constants you are about to create.
  If one exists, import it. If something exists twice already, the change that would add a third
  copy unifies them instead.
- **No coordinator that holds everything.** A new class or module that takes most of the others
  as collaborators (a manager, service or context with many constructor parameters) is absorbing
  responsibilities. Split it so each piece takes only what it uses.
- **Depend on the narrowest thing you use.** Take a function, or a small type for the two
  methods you call, rather than a whole concrete class. Do not add an interface, factory or base
  class with one implementation and no caller or test that needs the seam: speculative
  abstraction is as hard to maintain as tight coupling.
- **No module-level state the codebase does not already use.** Pass dependencies in. Ask what a
  second instance does to the first, and whether teardown undoes what setup did.
- **Write the language idiomatically**, as this codebase writes it, not translated from another
  language's conventions.

Before you open the PR, answer these in the PR body under **Fit**, one line each:

1. Which existing code did you follow?
2. Can each new unit be constructed in a test without building the others?
3. Did you add a helper, type or constant that already existed?
4. Which new abstractions have one implementation, and what needs them?
5. Which new class or function takes more than about four collaborators, and why?

Fix whatever the answers expose before you push.

## 3. Build it on a branch

- Fetch, then branch from the default branch's tip. Name the branch so this course finds it: the
  `branch_pattern` of this course in `.baton/baton.json` (`claude/<ticket id>-<slug>` by default).
  An earlier attempt's branch for this ticket is continued, not replaced.
- Implement what the ticket says, with its tests. A behaviour change without a test that would
  fail without it is not finished.
- Run the repository's checks yourself. Push only once they pass.
- Commit with explicit paths (`git commit -- <paths>`), never `git add -A`: the checkout may hold
  other work.

## 4. Open the PR

Open one PR per repository the ticket touches, its title starting with the ticket's id. The
ticket's `repos:` lists the repositories besides this one; each gets its PR from a branch of the
same name, in its own checkout. This repository may get none. The body, in this order:

- **What** — three lines.
- **Architecture decisions taken**, and **Deviations** from the ticket, if any, each with why.
- **Fit** — the five answers from section 2.
- **Tests added** — `file: test names`.
- **Untested and why.**
- **Exit criteria** — each of the ticket's, with how it was checked (the test, the command, the
  output).

Then add every PR's URL to the ticket's `prs:` list if the ticket keeps one. Baton reads the PRs
of every repository the ticket names, and reads them together, as one change.

## Do not

- Merge, approve or review your own PR; later legs do that.
- Leave the PR without a pushed head: the review reads what is pushed.
