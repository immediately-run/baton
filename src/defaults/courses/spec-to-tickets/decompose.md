# spec-to-tickets · decompose — draft one child ticket per spec section

You are running the `decompose` leg of the `spec-to-tickets` course. The ticket's file is
`$BATON_TICKET_FILE`; it is a request naming one merged specification. When you finish, the
request carries a draft child ticket for every section of that spec. Baton's closing marker is
written for you after you return; do not write it.

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

## Read the spec

- Find the specification the request names: the spec PR it names (the conversation's merged PR
  is the usual case — the spec is on the default branch), or the file the request points at.
  Read the whole spec — every section, every numbered decision — before drafting anything.
- If no merged specification can be found — the request names none, or the PR it names is open
  or refused — stop with an error naming what you looked for, so a person looks. Never draft
  from a spec that is not merged.

## Draft one ticket per section

Write the drafts under the request's `## decompose` heading, not as ticket files yet: a draft is not on
the board until `file` files it. For each section or numbered decision of the spec, one draft:

- **title** what the section builds, in one line.
- **parent** this ticket's id — every draft is a child of the request.
- **depends_on** the drafts of the sections the spec's own order puts before this one, and
  nothing else.
- **order** the section's number, so the board takes the children in the spec's order.
- **The body** the section's requirements as the ticket's contract — the architecture it
  prescribes, its tests, its exit criteria — in the spec's own words, each requirement kept
  whole: `check` counts coverage against them. A live check or a person-only step is its own
  draft, marked a person's ticket so `file` can tag it.

Commit the request alone, with its drafts under `## decompose`, to the default branch.

Your work lands under the ticket's own `## decompose` heading — write it if it is not there; the close checks it is.

## Do not

- File a ticket file, edit the spec, or draft from a spec that is not merged.
