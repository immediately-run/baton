# bug-report · origin — which artifact seeded the cause

You are running the `origin` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, has a `## Trace` naming the cause at `file:line`. The cause says where the
bug lives. The origin says which artifact seeded it — a spec, a ticket, or the implementation —
so the repository can count which stage produces its defects. When you finish, the ticket has an
`## Origin` section.

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

## Find the introducing change

- **When a line causes the bug**, find the oldest commit that introduced the behaviour, not the
  last one to touch the line: `git log -S'<symbol>' -- <file>`, or `git blame -L` on the cause
  line, followed back.
- **When the bug is an omission** (nothing reloads, nothing validates: a writer with no reader),
  the origin is the commit that added the counterpart.
- Commit to PR: the merge subject (`Merge pull request #N`) or a squash's `(#N)`. A commit on the
  default branch with neither was pushed with no PR; record the commit itself.
- PR to ticket: the ticket id in the branch, the PR's title or body, or a ticket's `prs:` list.

## Classify: the first "no" decides

1. Did the spec, as the ticket read it, require the correct behaviour? If it was silent the
   origin is `spec-silent`; if it required the wrong behaviour, `spec-wrong`.
2. Was there a ticket behind the change? If not (no PR, or a PR no ticket names), `no-ticket`.
   The spec question is asked first and wins.
3. Did the ticket prescribe the behaviour? If it was silent, `ticket-silent`; if wrong,
   `ticket-wrong`.
4. Did the change deviate from the ticket? Then `impl`, and only then: the code being where the
   fix lands does not make the origin `impl`.
5. A difference between environments the ticket could not see is `env`.

Then name the **defences that should have caught it**, from evidence, never guessed. Did a review
see it and wave it off? Did a review run and miss it? Was a test the ticket asked for absent?
Could a mechanical check have caught it? Did no live check exercise the path?

## Record

Add `## Origin` after `## Trace`: `Introduced:` (commit, PR, ticket, writing "no PR" or "no
ticket" where there is none), `Spec as read:`, `Origin:`, `Missed by:` with evidence. If you run
out of reads, write `Origin: unknown` with what you checked; the section is never omitted.
Commit the ticket file alone to the default branch.

Your work lands under the ticket's own `## origin` heading — write it if it is not there; the close checks it is.

## Do not

- Edit the introducing ticket, the PR or the spec. A wrong spec becomes a line in the fix
  ticket.
