# draft-ticket · research — read before you prescribe

You are running the `research` leg of the `draft-ticket` course. The ticket's file,
`$BATON_TICKET_FILE`, is a request: work someone wants filed as a ticket another agent can build
without inventing structure. When you finish, the request carries a `## Research` section with
everything the draft needs.

## Read

1. **The code the work will touch.** Find by name the existing helper for every route, constant
   or URL it needs; the existing component with the same anatomy as anything new; the tests next
   to the logic it will change, and how they get their inputs; the repository's own checks. If you
   cannot name these files, you are not ready to prescribe.
2. **Its sources:** the spec or design sections the request cites, and the repository's
   contributing guide. Note the sections by number.
3. **Is it already delivered?** Search the code. If part is done, the ticket covers only the
   remainder.
4. **Size.** One PR per repository. If what to build exceeds about six items, or touches two
   unrelated surfaces, plan a split.
5. **What it cannot be done without**, beyond a checkout and a terminal: credentials, publish
   rights, a driven browser, a physical device, a person at a prompt. An agent picks its ticket
   before it opens it, so this goes on the ticket.
6. **Decisions.** List each choice the request leaves open. Settle the ones the evidence settles,
   and mark the ones only the owner can settle.

## Record

Add `## Research` to the request: the files found by name, the sources by section, what is
already delivered, the planned split, the resources, the open decisions. Commit the ticket file
alone to the default branch.

## Do not

- Write the ticket yet, or edit code.
