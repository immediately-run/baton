# bug-report · file — the ticket that will fix it

You are running the `file` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, holds a bug whose cause no open ticket covers. When you finish, a new
ticket for the fix exists and the bug ticket names it.

## Write the fix ticket

- Create a new ticket file in the repository's tickets directory (the `items` setting in
  `.baton/baton.json`, `tickets/` by default), with the next id the repository uses. If the
  repository has a tool that allocates ticket ids, use it. Its course is the repository's
  default (`create-pr` unless it says otherwise).
- Write it the way the `draft-ticket` course does: **Why** (the symptom and the cause at
  `file:line`), **What to build**, **Architecture** (the decisions, named), **Tests** (the
  regression test that fails today), **Exit criteria**, and what it **requires** beyond a
  checkout.
- Put an **`### Origin`** section directly after Why, copied from the bug ticket's `## Origin`.
- If the dedupe named a related or a closed ticket, link it.
- **A live check is its own ticket.** If proving the fix needs a running host, a driven browser
  or a device, file that check as a second ticket that depends on the first.
- If a decision belongs to the owner, file it as a `decision` ticket rather than guessing.

## Record

Add `## Filed` to the bug ticket, naming the new ticket(s). Commit the new ticket file(s) and the
bug ticket together to the default branch.

## Do not

- Fix the bug here. The fix is the new ticket's work.
