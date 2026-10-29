# draft-ticket · draft — write the ticket

You are running the `draft` leg of the `draft-ticket` course. The ticket's file,
`$BATON_TICKET_FILE`, is a request with a `## Research` section. When you finish, the request
carries a `## Draft` section holding the full ticket (or tickets, when the research planned a
split), ready to be checked and filed.

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

## The ticket, every section, in this order

- **Title:** what it delivers, in a line.
- **Spec / depends on:** the sections it implements, by number; the tickets it depends on.
- **Requires:** what it cannot be done without beyond a checkout (from the research), and for
  each, which exit criterion needs it. "None" when nothing.
- **Why:** the problem, in a paragraph a newcomer understands.
- **What to build:** at most about six items.
- **Architecture:** the decisions, named, each with the alternative it rules out: which module
  owns the logic, which existing helper it reuses (by name), what it must not do. An implementer
  who follows it should not have to invent structure.
- **Tests:** the tests by file and by what each proves, including the one that fails today.
  Scenario tests when the repository keeps them.
- **Exit criteria:** each one checkable by a command, a test or a grep, never "works well".
- **Hand-off:** what the implementer should know that fits nowhere else.

A live check (a running host, a driven browser, a device) is never an exit criterion of a build
ticket. It is its own "Verify: …" ticket that depends on the build. Work only a person can do is
its own ticket too.

## Record

Write the draft(s) under `## Draft` in the request, not as ticket files yet: a draft is not on
the board until the check files it. Commit the ticket file alone to the default branch.

Your work lands under the ticket's own `## draft` heading — write it if it is not there; the close checks it is.
