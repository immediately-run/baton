# draft-ticket · check — check the draft, split it, file it

You are running the `check` leg of the `draft-ticket` course. The ticket's file,
`$BATON_TICKET_FILE`, is a request with `## Research` and `## Draft`. When you finish, the drafted
ticket(s) are files on the board and the request is closed.

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

## Check, from a fresh read

Read the draft as the agent who will build it, with nothing but the ticket and the code, and
fix what fails:

- Can every section be acted on without asking? An architecture that says "as appropriate", or a
  test that says "add tests", is not done.
- Is every exit criterion a command, a test or a grep?
- Does **Requires** name everything an exit criterion needs?
- Is any live check or any person-only step still inside the build ticket? Split it out into a
  "Verify: …" ticket, or a person's ticket, that depends on the build.
- Is any decision still open? If only the owner can settle it, file a `decision` ticket and make
  the build ticket depend on it.
- Is it still one PR per repository? If not, split it and chain the parts with `depends_on`.

## File

- Write each ticket as a file in the tickets directory (the `items` setting in
  `.baton/baton.json`, `tickets/` by default), with the next id the repository uses — its id
  tool if it has one (`baton tickets next ticket-<prefix>`: an id from Baton's sequence, never
  a scan, R-BTN-131), `depends_on` for the chain, and its course (the repository's default unless the
  ticket says otherwise); each file ends in `## Status` with `_filed <today, YYYY-MM-DD>.` and carries the draft's Trust and
  Invariants as `###` sections.
- Add `## check` to the request, naming each ticket you filed, and set the request's `status:` to `done`.
- Commit the new files and the request together to the default branch.

Your work lands under the ticket's own `## check` heading — write it if it is not there; the close checks it is.
