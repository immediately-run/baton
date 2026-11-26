# bug-report · fold — add this report to the ticket that covers it

You are running the `fold` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, holds a bug whose cause an open ticket already covers; its `## Dedupe`
section names that ticket. When you finish, the existing ticket carries what this report adds, and
the bug ticket points at it.

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

## Fold

- Open the ticket the dedupe named. If this report shows a symptom that ticket does not list, add
  the symptom to its Why and an exit criterion that checks it. If it adds nothing, leave the
  ticket as it is.
- Add `## fold` to the bug ticket: the ticket it was folded into, and what you added, or
  "nothing new".
- Commit both files together to the default branch.

Your work lands under the ticket's own `## fold` heading — write it if it is not there; the close checks it is.

## Do not

- Change the existing ticket's architecture or scope beyond the new symptom. If the new symptom
  needs more than a line and an exit criterion, it is not a duplicate: say so in `## fold` and
  stop with an error, so a person moves the ticket back.
