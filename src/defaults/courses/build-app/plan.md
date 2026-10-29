# build-app · plan — plan the tickets that build it

You are running the `plan` leg of the `build-app` course. The ticket's file is
`$BATON_TICKET_FILE`; the owner approved `PRODUCT.md`, `DESIGN.md` and `ARCHITECTURE.md` in
`product/<ticket id>/`. When you finish, `product/<ticket id>/PLAN.md` holds every ticket that
builds the product, each complete enough for an agent to build without asking, and the ticket
waits for the owner to approve the plan. Nothing is filed yet: the `file` leg files the approved
plan. Baton's closing marker is written for you after you return; do not write it.

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

## 1. Read first

All three approved documents, and the repository: its checks, its layout, its conventions for a
ticket (an existing ticket in the tickets directory, and the courses `.baton/baton.json` lists:
the tickets run on `create-pr` unless one needs another).

## 2. Cut the work

- **One ticket, one PR**: a change a reviewer can read in one sitting. Split anything larger.
- **The walking skeleton first**: `ARCHITECTURE.md`'s skeleton is ticket 1 — deployed, with the
  checks running and one end-to-end test passing. Every later ticket builds on it.
- **Vertical slices after it**: each ticket delivers behaviour a person or a test can see, and
  names the `AC-n` it makes pass. Prefer a slice of the core loop over a layer of the stack.
- **Order by dependency, then by risk**: what the most tickets need comes first; the riskiest
  assumption is tested early.
- **Parallel where it can be**: two tickets that touch different files do not depend on each
  other. Chain only what must be sequential.
- **Deployment and operations are tickets**: the production deployment, its monitoring, anything
  `ARCHITECTURE.md` says must exist before people use it.
- **What needs a person** (an account, a domain, a payment, a secret, a store listing) is its own
  ticket, marked as a person's, with the steps written out; tickets that need it depend on it.

## 3. Write `product/<ticket id>/PLAN.md`

- **Overview** — the order in a short list: number, title, depends on.
- **Coverage** — a table of every `AC-n` and the ticket that makes it pass. Every criterion has
  one; a criterion without one is a missing ticket.
- **The tickets**, each a `## <n>. <title>` section with, in order:
  - **Depends on** — ticket numbers, or none.
  - **Why** — two lines: what it gives the product.
  - **What to build** — numbered, concrete: files, components, routes, data, by name.
  - **Architecture** — the decisions this ticket takes from `ARCHITECTURE.md`, and any it
    prescribes for the code (where logic lives, what it reuses).
  - **Tests** — the tests to add, by name and what each asserts, including the browser test for
    each `AC-n` it delivers.
  - **Exit criteria** — checkboxes, each a command, a test or a grep.
  - **Requires** — anything beyond a checkout and the repository's own tools, or "none".
- **Questions** and **Decisions**, as the earlier documents have them: the cuts the owner might
  want differently (what ships first, what waits for a later version).

## 4. Hand it over

Add a `## Your turn` section to the ticket file: how many tickets, the first three, the
questions; and how to continue — open an interactive agent session in a checkout of this
repository and ask it to follow `## The conversation` in `.baton/courses/build-app/legs/plan.md`
for this ticket, or edit the plan directly and set the ticket's `answer:` to `plan`. Do not set
`answer:` yourself. Commit the plan and the ticket file together, with explicit paths, to the
default branch.

## The conversation

*This part is for the owner's interactive session, not for the headless leg above.* You are
helping the owner settle `product/<ticket id>/PLAN.md`.

- Read the ticket, the four documents and the repository's ticket conventions. Show the owner
  the overview and the coverage table first; then the questions, recommendation first.
- Re-cut on their word: merge, split, reorder, defer. Keep the coverage table true after every
  change, and every ticket complete.
- Read each ticket as the agent who will build it, with nothing but the ticket and the code. If
  one would make that agent ask a question, fix the ticket.
- When the owner is satisfied, ask whether the plan is right. **Only on their yes:** remove the
  ticket's `## Your turn` section, set its `answer:` to `plan`, commit the plan and the ticket
  together to the default branch, and push. That approval starts the `file` leg, which files the
  tickets as written.
- File no tickets and write no code in this session.

Your work lands under the ticket's own `## plan` heading — write it if it is not there; the close checks it is.
