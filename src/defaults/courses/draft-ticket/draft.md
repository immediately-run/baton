# draft-ticket · draft — write the ticket

You are running the `draft` leg of the `draft-ticket` course. The ticket's file,
`$BATON_TICKET_FILE`, is a request with a `## Research` section. When you finish, the request
carries a `## Draft` section holding the full ticket (or tickets, when the research planned a
split), ready to be checked and filed.

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
