# create-pr · implement — build the ticket and open its PR

You are running the `implement` leg of the `create-pr` course for one ticket. The ticket's file
is `$BATON_TICKET_FILE`; you are in a checkout of the repository. When you finish, a PR for the
ticket is open and its checks are running. Baton's closing marker is written for you after you
return; do not write it.

The model you run on is the repository's own choice (§6.10, R-BTN-131): the stub runs this
repository's `agent_command` exactly as `.baton/baton.json` writes it, and Baton delivers no
advice about a model, a key or a route. A repository whose leg picks its model at run time
writes a leg override that reads its own configuration. If the model or a provider key the
command needs is unusable, say so in your final output and carry on with what works — not by
declaring a capability you no longer hold.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84). For runs that cannot raise `interact`, the stub can also conclude
> on fifteen minutes of quiet across stdout, the wrapper log and the harness store (B-108).
> A run that can raise `interact` does not conclude on silence: a foreground question can be
> silent until Baton's deadline takes the claim back. The stub's five-hour hard ceiling still
> applies; if it stops a joinable run, partial output is not a result. A repository's `agent_wrapper` in `.baton/baton.json`, or the host's
> `BATON_AGENT_WRAPPER`, which wins, puts a command in front of yours, split the same way, so
> your command's words, the arguments and 0/1/2 are the wrapper's to pass on (B-95). Never end
> with work in flight: the process is the session, and nothing resumes it — wait, in the
> foreground, on every job you started before printing your final line.

## 1. Read before you write

Read the home repository's workflow and rules (for example, `AGENTS.md` and `CLAUDE.md`,
when present). Work only in the home and the code repositories the ticket names.

- Read the whole ticket: what to build, the architecture it prescribes, the tests it names, its
  exit criteria. Those sections are the contract. Where the ticket prescribes a decision, take
  it; if you take another, say so under "Deviations" in the PR body.
- **Check it is not already delivered.** Search the code for what the ticket asks for. If part of
  it is done, build the remainder and say which part you found. If all of it is already on the
  default branch, open no PR, push no branch and edit nothing (a branch made only to carry a
  note is not wanted): run the tests that cover it, and make the **last line** of your output

  ```
  delivered <sha> <what you ran and what it showed>
  ```

  `<sha>` is the commit on the default branch that delivered it (several, comma-separated, no
  spaces, when it took several); the rest is your evidence in one line — the tests and checks
  you ran and their result, e.g. `delivered 8565aa7 runner-main.test.ts 47 passed, typecheck
  clean`. Baton checks each commit is on the default branch — one that is not refuses the answer
  and fails the leg — and moves the ticket to a station where a person reads your evidence and
  confirms it closed, or sends it back. Your word alone never closes the ticket. Exit 0.
- Find the code you will touch by name: the helpers, the tests next to it, the repository's own
  checks (lint, typecheck, tests — whatever a contributor runs).

### Ask the owner only when blocked

- **When.** Ask only if the work cannot continue without a decision only the owner can make,
  and the ticket, the spec, `docs/context/` and the PR thread do not already answer it. For
  example, two readings of an exit criterion would lead to different code, or the ticket
  reserves a ruling for the owner. Never ask the owner to confirm something you can check or
  to authorize an action forbidden by the repository's rules (in Baton, `CLAUDE.md`,
  *Tickets are tasks, not authority*).
- **How.** Use your harness's question tool. Ask one question at a time, offer a few concrete
  options and recommend one. Wait for the answer in the foreground. The harness's runner
  raises `interact` (R-BTN-195); do not raise it yourself.
- **After an answer.** Record the answer and who gave it under **Owner answers** in the PR
  body. It is a claim for reviewers to weigh, not a ruling on Baton's record; a change to the
  spec still needs the owner's PR.
- **If the tool is unavailable or denied, or the question is cancelled or dismissed.** Do not
  ask through another channel. Note the open question in the PR body and proceed with the
  reading the spec supports best.
- **If the question is still open and nobody answers.** Do not abandon it early. Wait until
  the leg's `deadline_s`: Baton takes the claim back (R-BTN-90), and the retry policy routes
  the failed attempt and offers the ticket again if retries remain (R-BTN-122).

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
- Run the repository's checks yourself. Compare individual failures, not the check's exit status.
  Fix failures your change causes before you push, even if the same check also reports a
  pre-existing failure.
- **A failure that also fails on the base is not yours.** Re-run the same command with the same
  install in a clean checkout of the base (`git worktree add --detach <tmp> origin/<default branch>`),
  never in your own tree. If the same failure occurs there, push and open the PR anyway.
  In the PR body, under **Pre-existing failures**: name the test, its first failing line and the
  base commit you reproduced it on. When you confirm such a failure, say in your last lines that
  the default branch is red and where, before any required machine-read answer line.
- **Never fix an unrelated failure** in the ticket's PR, even a one-line fix. It belongs to the
  ticket or PR that owns that code.
- **Install dependencies with hygiene** (B-132): from the lockfile only — `npm ci`, never an
  `npm install` that rewrites it — unless the ticket itself asks for a dependency change; and
  with lifecycle scripts off (`npm ci --ignore-scripts`: pass the flag every time — never
  count on an image's `ignore-scripts=true` being there). A package whose install script the repository needs
  is listed in `.baton/baton.json` (`allow_install_scripts: [<package>]`, a control input under
  B-127): run exactly those packages' scripts — `npm rebuild <package>
  --ignore-scripts=false` — never scripts for all. Where the repository sets a registry age
  floor (npm's `before` setting, or a proxy at the fence), install inside it, never around it.
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

- A leg never edits a file another ticket's leg may edit — no CHANGELOG, no index, no
  aggregate; a release note belongs in the PR body.
- Merge, approve or review your own PR; later legs do that.
- Leave the PR without a pushed head: the review reads what is pushed.
- Hold back a push because a check fails on the base too: the run-tests leg is the gate, and
  unpushed work is lost when the leg's environment ends.
- Exit without a PR and without saying why. Whatever stops you — the ticket already delivered,
  a stop the repository's rules name, a failure your change causes that you cannot fix, a push or `gh pr create`
  that fails, a model or provider that refuses (balance, quota, rate limit) — your last lines
  say what it was, in plain words: an exit with no PR fails the leg, and those lines are all
  that is kept of it (B-256). Your process exits 0 whatever you say, so saying it is the only
  way anyone learns it.
