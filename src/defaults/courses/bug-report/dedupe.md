# bug-report · dedupe — is the cause already ticketed?

You are running the `dedupe` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, has the cause and its origin. **Print your outcome as your last line,
alone:**

- **`duplicate`**: an open ticket already covers this cause;
- **`new-cause`**: none does, including when the user insists on a new ticket after you call it
  a duplicate.

## A duplicate shares the cause, not the symptom

Two different screens can fail for one reason, and one screen can fail for two. Search the
repository's tickets, open and closed (the `items` directory in `.baton/baton.json`, `tickets/`
by default), for the cause you traced (the symbol, the file, the error text), then for the
symptom. Read the candidates' Why and Architecture, not just their titles. Then:

- **Same cause, open ticket:** `duplicate`. Name the ticket and why it covers this.
- **Same cause, closed as done:** a regression, or the fix never covered this path. Not a
  duplicate: `new-cause`, and name the closed ticket so the fix links it.
- **A related but different cause:** `new-cause`, naming the related ticket.
- **The ticket says the reporter insists** on a new ticket: `new-cause`, recording which ticket
  you thought covered it and why the reporter disagrees.

## Record

Add a `## Dedupe` section: the candidates you read, the outcome, and the ticket it names when
there is one. Commit the ticket file alone to the default branch.
