# spec-to-tickets · file — commit the checked tickets as children

You are running the `file` leg of the `spec-to-tickets` course. The ticket's file is
`$BATON_TICKET_FILE`; it carries the checked `## Drafts`. When you finish, every draft is a
ticket file on the board, a child of the request, and the request is closed. Baton's closing
marker is written for you after you return; do not write it.

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

## File them as checked

File the set as `check` left it; do not re-decompose it. If a draft cannot be filed as written
(it names something the spec no longer has), stop with an error naming it, so a person looks.
If the request's `status:` is `withdrawn`, the owner decided against filing: file nothing,
write nothing, and stop.

For each draft, write a ticket file in the tickets directory (the `items` setting in
`.baton/baton.json`, `tickets/` by default):

- **id** the next free id the repository's tickets use (its id tool, if it has one).
- **parent** this ticket's id: every filed ticket is a child of the request.
- **depends_on** the drafts' dependencies, by their filed ids.
- **order** the draft's order, so the board takes them in the spec's order.
- **tags** `[OP]` where the draft marks a person's ticket, so no agent claims it.
- **course** the repository's `default_course` unless the draft names another course the
  checkout's `.baton/baton.json` lists; never this course.
- **The body** the draft's, verbatim.

Then add a `## Filed` section to the request naming each child, set the request's `status:` to `done`,
and commit the children and the request together, with explicit paths, to the default branch.

Your work lands under the ticket's own `## file` heading — write it if it is not there; the close checks it is.

## Do not

- Re-plan the set, edit the spec, or leave a draft unfiled.
