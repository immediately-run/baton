# build-app · file — file the planned tickets

You are running the `file` leg of the `build-app` course. The ticket's file is
`$BATON_TICKET_FILE`; the owner approved `product/<ticket id>/PLAN.md`. When you finish, every
ticket in the plan is a file on the board, a child of this ticket, and this ticket waits for them
all to close. Baton's closing marker is written for you after you return; do not write it.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84).

## File them as written

The owner approved the plan; file it, do not re-plan it. If a ticket cannot be filed as written
(it names something that no longer exists), stop with an error naming it, so a person looks.

For each `## <n>.` section of the plan, write a ticket file in the tickets directory (the `items`
setting in `.baton/baton.json`, `tickets/` by default):

- **id** `<this ticket's id>-<n>`, `n` the plan's number, so ids and the plan agree.
- **title** `<id> — <the plan's title>`.
- **parent** this ticket's id. Each child blocks this ticket until it closes; that is how
  `verify` waits for the build.
- **course** `create-pr`, or the course the plan names for it, written out even when it is the
  repository's `default_course`, and never `build-app`. If `.baton/baton.json` lists no such
  course, stop with an error naming `baton repo init --course <course>`.
- **tags** `[OP]` for a ticket the plan marks a person's, so no agent claims it.
- **depends_on** the ids of the plan's "Depends on".
- **order** the plan's number, so the board takes them in the plan's order.
- **repos** only if the plan names another repository.
- **The body**: the plan's sections for that ticket, verbatim, with a first line linking
  `product/<ticket id>/PLAN.md` and the documents it builds on.

Follow the format the repository's existing tickets use for anything else. Then add a `## Filed`
section to this ticket listing each child, and commit the children and this ticket together,
with explicit paths, to the default branch.
