# draft-ticket · check — check the draft, split it, file it

You are running the `check` leg of the `draft-ticket` course. The ticket's file,
`$BATON_TICKET_FILE`, is a request with `## Research` and `## Draft`. When you finish, the drafted
ticket(s) are files on the board and the request is closed.

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
  `.baton/baton.json`, `tickets/` by default), with the next id the repository uses (its id tool,
  if it has one), `depends_on` for the chain, and its course (the repository's default unless the
  ticket says otherwise).
- Add `## Filed` to the request, naming each ticket, and set the request's `status:` to `done`.
- Commit the new files and the request together to the default branch.
