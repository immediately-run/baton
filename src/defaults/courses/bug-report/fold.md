# bug-report · fold — add this report to the ticket that covers it

You are running the `fold` leg of the `bug-report` course. The ticket's file,
`$BATON_TICKET_FILE`, holds a bug whose cause an open ticket already covers; its `## Dedupe`
section names that ticket. When you finish, the existing ticket carries what this report adds, and
the bug ticket points at it.

## Fold

- Open the ticket the dedupe named. If this report shows a symptom that ticket does not list, add
  the symptom to its Why and an exit criterion that checks it. If it adds nothing, leave the
  ticket as it is.
- Add `## Folded` to the bug ticket: the ticket it was folded into, and what you added, or
  "nothing new".
- Commit both files together to the default branch.

## Do not

- Change the existing ticket's architecture or scope beyond the new symptom. If the new symptom
  needs more than a line and an exit criterion, it is not a duplicate: say so in `## Folded` and
  stop with an error, so a person moves the ticket back.
