# bug-report · file — the ticket that will fix it

You are running the `file` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, holds a bug whose cause no open ticket covers. When you finish, a new
ticket for the fix exists and the bug ticket names it.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84). Your completion is your exit **or your silence** (B-108): the stub stops waiting at the earliest of your exit, fifteen minutes of quiet on every activity signal it can see — your stdout, the wrapper’s log, the harness’s own store — and five hours of the leg, its ceiling; the stdout you left is judged as any exit’s is. A repository's `agent_wrapper` in `.baton/baton.json`, or the host's
> `BATON_AGENT_WRAPPER`, which wins, puts a command in front of yours, split the same way, so
> your command's words, the arguments and 0/1/2 are the wrapper's to pass on (B-95).

## Write the fix ticket

- Create a new ticket file in the repository's tickets directory (the `items` setting in
  `.baton/baton.json`, `tickets/` by default), with the next id the repository uses. If the
  repository has a tool that allocates ticket ids, use it. Its course is the repository's
  default (`create-pr` unless it says otherwise).
- Write it the way the `draft-ticket` course does: **Why** (the symptom and the cause at
  `file:line`), **What to build**, **Architecture** (the decisions, named), **Trust** (every new
  input it adds, who may write it and how it is verified, or "no new input"), **Invariants** (the
  rules it must not break, by id, and how the design keeps each), **Tests** (the
  regression test that fails today), **Exit criteria**, and what it **requires** beyond a
  checkout.
- Put an **`### Origin`** section directly after Why, copied from the bug ticket's `## Origin`.
- Write Trust and Invariants as `###` sections, and end the file in `## Status` with `_filed <today, YYYY-MM-DD>.`.
- If the dedupe named a related or a closed ticket, link it.
- **A live check is its own ticket.** If proving the fix needs a running host, a driven browser
  or a device, file that check as a second ticket that depends on the first.
- If a decision belongs to the owner, file it as a `decision` ticket rather than guessing.

## Record

Add `## file` to the bug ticket, naming the new ticket(s). Commit the new ticket file(s) and the
bug ticket together to the default branch.

Your work lands under the ticket's own `## file` heading — write it if it is not there; the close checks it is.

## Do not

- Fix the bug here. The fix is the new ticket's work.
