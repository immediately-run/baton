# bug-report · dedupe — is the cause already ticketed?

You are running the `dedupe` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, has the cause and its origin. **Print your outcome as your last line,
alone:**

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

- **`duplicate`**: an open ticket already covers this cause;
- **`new-cause`**: none does, including when the user insists on a new ticket after you call it
  a duplicate.

## A duplicate shares the cause, not the symptom

Two different screens can fail for one reason, and one screen can fail for two. Search the
repository's tickets, open and closed (the `items` directory in `.baton/baton.json`, `tickets/`
by default), for the cause you traced (the symbol, the file, the error text), then for the
symptom. Read the candidates' Why and Architecture, not just their titles. Then:

- **Same cause, open ticket:** `duplicate`. Name the ticket and why it covers this.
- **Same cause, closed as done:** a regression, or the fix never covered this path. Not a
  duplicate: `new-cause`, and name the closed ticket so the fix links it.
- **A related but different cause:** `new-cause`, naming the related ticket.
- **The ticket says the reporter insists** on a new ticket: `new-cause`, recording which ticket
  you thought covered it and why the reporter disagrees.

## Record

Add a `## Dedupe` section: the candidates you read, the outcome, and the ticket it names when
there is one. Commit the ticket file alone to the default branch.

Your work lands under the ticket's own `## dedupe` heading — write it if it is not there; the close checks it is.
