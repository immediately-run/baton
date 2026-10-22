# bug-report · trace — from the symptom to its cause

You are running the `trace` leg of the `bug-report` course. The ticket's file, `$BATON_TICKET_FILE`,
holds a reported bug: a symptom, an error message, a screenshot's description. When you finish,
the ticket has a `## Trace` section that says "X happens because Y at `file:line`", or what you
checked when you could not get that far.

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

## Trace

- Fetch, then search the default branch for the exact text the user saw: the error, the label,
  the log line. A local branch may be stale or someone else's.
- Follow it to the decision: the constant, the condition, the missing load. Name the file and
  the line.
- **Treat the reporter's diagnosis as a hypothesis.** Say plainly when your trace disagrees, and
  record the cause you found, not the one you were told.
- Stop when you can say "X happens because Y at `file:line`". If you cannot get there in a
  reasonable number of reads, write what you know, what you checked, and "cause not yet traced".

## Record

Add a `## Trace` section to the ticket file: the symptom in one line, the cause at `file:line`,
and how you got there (the searches, the files). Commit the ticket file alone to the default
branch, naming the ticket's id. Baton's closing marker follows your commit; do not write it.

## Do not

- Edit the code. **Tracing reads code; it never edits it.** This course delivers a ticket for the
  fix, not the fix.
