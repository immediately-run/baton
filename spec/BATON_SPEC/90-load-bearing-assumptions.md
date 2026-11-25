---
title: "Load-bearing assumptions"
description: "This repository's npm run check:spec checks that every requirement id the code cites is defined here (or retired in BATON_SPEC_HISTORY.md), and that every ticket the spec cites exists in tickets/."
---
## Load-bearing assumptions

This repository's `npm run check:spec` checks that every requirement id the code cites is defined
here (or retired in `BATON_SPEC_HISTORY.md`), and that every ticket the spec cites exists in
`tickets/`.

Every rule heading carries one status token per id, in heading order (for example,
`status: built` or `status: specified B-13`). Use `built` for implemented rules, `partly` for
rules with work left, `specified` for designs not implemented, and `retiring` for rules being
removed. Include the implementation ticket ids, separated by spaces, when known; older work
does not always have a ticket. The [generated rule ledger](../BATON_SPEC.md#rules) shows these
tokens alongside source citations and the tests of scenarios that name the rule. The check
requires a source citation for each `built` rule and refuses a `specified` rule whose listed
tickets are all archived. It verifies scenario coverage and the shrink-only pending list
under R-BTN-30.
