# spec-to-tickets · check — the set against the spec

You are running the `check` leg of the `spec-to-tickets` course. The ticket's file is
`$BATON_TICKET_FILE`; it carries the `## Drafts` the `decompose` leg wrote. When you finish, the
drafts are a set that covers the spec exactly. Baton's closing marker is written for you after
you return; do not write it.

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

## Check the set, from a fresh read

Read the spec again beside the drafts. Where correcting is yours — a requirement sitting in two
drafts, a dependency the spec's order does not imply, a draft too large for one PR per
repository, a draft no section asks for — fix the drafts, never the spec:

- **Every requirement exactly once.** Each requirement of each section is in exactly one draft:
  none twice, none split across two. A requirement no draft covers is **not yours to add** —
  `decompose` owns drafting, and a set that missed one is returned, not patched.
- **No ticket without a section.** A draft no section of the spec asks for is gone — however
  useful it looks, it is not this spec's work.
- **Dependencies as the spec's order implies.** A draft depends on another only where the spec
  puts one before the other; no cycles.
- **Each draft buildable as one PR per repository.** A draft that exceeds that splits, its parts
  chained by `depends_on`, each part still tied to its section's requirements.

A requirement no draft covers — a section with no ticket draft at all, or one a draft misses —
is a failure of the set, not something to wave through: exit non-zero naming the section and the
requirement, and the leg fails — nothing is written, and a person looks.

Commit the request alone, its `## Drafts` corrected, to the default branch.

Your work lands under the ticket's own `## check` heading — write it if it is not there; the close checks it is.

## Do not

- File a ticket file, edit the spec, or weaken a requirement to make a draft fit.
