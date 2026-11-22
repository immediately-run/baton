---
title: "Proposal — who owns a ticket: Baton its course state, the store the work"
description: "A recommendation, not built: one owner per ticket field across every ticket store, git-native or a tracker — Baton owns the ticket's id, its course state and its closure; the store owns what the work is; each side expects outside changes and takes in the other's as evidence, never as an overwrite; Baton may originate a ticket before its store has it."
---
# Proposal — who owns a ticket: Baton its course state, the store the work

**Status:** recommendation, not built and not scheduled. It settles the approach only: how the
sync carries each direction is a later design that starts from this page
([Open decisions](#open-decisions)). The owner settled its choices on 2026-11-22
([The owner's decisions](#the-owners-decisions)). Nothing here changes a rule yet; every rule and
page it would change is in [Amends](#amends).

## The goal

Two things the owner wants together, 2026-11-22:

- **Starting a course without a checkout.** `baton course start bug-report`, a dashboard's
  *Start course*, an agent session over MCP: each creates the ticket at once, with an id Baton
  gives, and queues its first leg — the ticket file "can be created as part of the course".
- **One model for every ticket store.** The owner: "we shouldn't assume that tickets *won't* be
  updated outside baton, but we should consider baton the ultimate owner of baton-specific ticket
  state (ticket position, retry count, who should be notified for interaction requests, etc)",
  applied alike to git-native tickets and to Jira, Linear and GitHub Issues. Baton should not
  need a whole team to adopt it ([values](../../docs/context/values.mdx) #13): what happens to a
  ticket outside Baton is recognised and adopted, as outside work already is
  ([R-BTN-203](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-2)).

Who may edit a ticket outside Baton is the store's concern — a tracker's own permissions, or for
git whoever may merge the ticket's file (for immediately.run, Fieldhouse's forge gate) — never
Baton's (values #12).

## The owner's decisions

Settled 2026-11-22; not reopened by a review.

1. **Baton owns the ticket's course state; the store owns the work.** Baton is the authority on
   every Baton-specific fact about a ticket; the store on what the work is. Neither assumes it is
   the only writer.
2. **One owner per field.** No field has two authorities, so no field needs a conflict rule
   between them ([The two kinds of field](#the-two-kinds-of-field)).
3. **Baton ids always.** Every ticket carries Baton's id (`B-n`, [R-BTN-199](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-3)'s
   allocator), whatever store holds it; a store that mints keys of its own (`PROJ-123`) has its
   key recorded beside Baton's, never in its place.
4. **Course and tier are the store's.** They are properties of the work, written by whoever files
   the ticket and changed where the store changes things. `requires` is taken to be the same
   kind, as a gate input like tier; the owner has not ruled on it separately.
5. **The assignee is the store's.** Who an interaction request reaches is derived from it, and
   Baton may hold an override of its own.

## The two kinds of field

**Baton-owned.** Baton decides the record. A store may display it (R-BTN-200's `show`,
[proposed](tickets-and-sources.md)); a
change made to the store's copy is never read back as the value.

**Store-owned.** The store decides the record; Baton mirrors it, as R-BTN-33's filter fields are
mirrored today. Baton may change one only by writing to the store, and its copy changes when the
store's reader reads the write back — the confirm-by-reading-back rule Baton's effects already
follow (R-BTN-171). The store stays the single authority, so a concurrent edit in the store is
just the newer value.

Traffic goes both ways; authority for a field never does.

| Baton-owned | Store-owned |
|---|---|
| the ticket's id (`B-n`) | the body, title and description |
| its position: station, path, queued leg (R-BTN-39) | relations: `depends_on`, `parent` |
| course history, runs, retries and backoff | course, tier, `requires` |
| claims, leases, holds, expedites | the assignee |
| closure at an end station | withdrawal (adopted: below) |
| attestations; conditions; an interaction request's recipients, derived from the assignee unless overridden | labels, tags, the store's own key |

## The evidence rule

An outside change to a **store-owned** field is the new value: the next read adopts it, as a
sync does today.

An outside change to a **Baton-owned** fact is evidence, weighed by the ticket's course, never an
overwrite:

- a Linear issue dragged to *Done*, or a `status: done` written into a ticket file, says the work
  may be finished — the course places the ticket by a fact leg or its reconcile leg, as it places
  a PR merged by hand (R-BTN-203);
- a `station:` or retry count written into a file is not a fact anyone outside Baton can know,
  and is ignored.

This is R-BTN-39's position rule (no file, marker, PR or snapshot places a ticket) and R-BTN-203's
open world, extended from the position to every Baton-owned fact.

## Where a ticket comes from

- **Baton originates; the store materializes.** A ticket started through Baton — a CLI command,
  the dashboard, MCP, a runner filing a child or a handler — exists in Baton from that moment,
  with its id, course and first leg queued, before any store holds it. Its course, or a writer,
  puts it into the store: for git, its first leg writes the ticket file; for a tracker, a writer
  creates the issue (R-BTN-74's `file`, [proposed](tickets-and-sources.md)).
  Until then the ticket has Baton-owned facts and the store-owned fields it was started with.
- **A ticket created in the store is imported.** One the sync finds that Baton has never seen is
  given a Baton id and placed at its course's start, as a first post is today (R-BTN-39). Who may
  create tickets that way is the store's concern; whether Baton admits the import is the
  repository's policy.

## Closure

A ticket closes in Baton when it reaches an end station of its course, and the store shows it
closed. The store's own *done* — a file's `status: done`, a tracker's *Done* — is evidence for the
course ([The evidence rule](#the-evidence-rule)), so an agent no longer has to write
`status: done` for a ticket to close. A **withdrawal** in the store (a cancelled issue,
`status: withdrawn`) is adopted: the work is no longer wanted, which is the store's to say, and
Baton closes the ticket withdrawn.

## When Baton's state is lost

The 2026-10-28 rule stands unchanged: lost Baton state fails closed and is never restored from
git. Under this model that is also what happens naturally: the store-owned fields come back from
the store; what Baton owned — positions, runs, approvals, attestations — is gone, and the work is
reviewed and approved again. Store tickets are imported as on first sight ([Where a ticket comes
from](#where-a-ticket-comes-from)).

## What changes from today

Much of this is today's model made explicit: Baton already owns the position and course history
(R-BTN-39), and the store already owns the fields Baton mirrors (R-BTN-33). What changes:

1. **Existence** moves from "a ticket exists when a sync posts it" to "Baton or the store may
   originate it" (R-BTN-35, R-BTN-1).
2. **Ids** become Baton's for every ticket, a store's own key recorded beside them (R-BTN-199,
   R-BTN-1's table).
3. **Closure** moves from the store's `status: done` to Baton's end station; the store's withdrawal
   is adopted (R-BTN-35, R-BTN-1's table, R-BTN-74's markdown reader; every standard course's end
   leg, whose instructions tell the agent to write `status: done`).
4. **The evidence rule** covers every Baton-owned fact, not only the position.
5. **A course change in the store** is adopted, so a ticket's position may be off the new course's
   graph; R-BTN-83's `course-changed` wait already covers it, and the sync design decides whether
   to do more.

## Amends

- [values](../../docs/context/values.mdx) #1, [architecture](../../docs/context/architecture.mdx)
  (*The ledger and the cache*), [vocabulary](../../docs/context/vocabulary.mdx) (*Ticket*,
  *Ticket source*), [product](../../docs/context/product.mdx) (*What it is not*).
- BATON_SPEC [R-BTN-1](../BATON_SPEC/01-what-baton-is.md#sec-1)'s table,
  [R-BTN-35](../BATON_SPEC/01-what-baton-is.md#sec-1), R-BTN-39's start bullet,
  [R-BTN-74](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-2) (the reader's closure, the writer's
  `file`), R-BTN-88 (what rebuilds from where), R-BTN-199 (ids for every ticket), and R-BTN-189's
  `tickets-approved` guarantee, which rests on ticket files reviewed in git.
- Its home when built: one new rule in §1 beside R-BTN-35 for the field table and the evidence
  rule, and one in §4 for originating and importing.

## Open decisions

- **The sync in each direction:** how a store-owned edit Baton makes reaches the store and is read
  back; how evidence of an outside change to a Baton-owned fact reaches the course; what the
  markdown source writes and stops reading.
- **`requires`:** store-owned with course and tier (assumed above), or Baton's.
- **`tickets-approved` under `protected`:** with closure and ids Baton's, does an approval of a
  ticket become a Baton attestation, or stay a merge of its file?
- **Migration:** the live tickets of every home already have ids and frontmatter; which fields
  stop being read, and when.
- **The first users:** `course.start` (CLI, dashboard, MCP), and the bug and feature courses whose
  first leg is an interactive agent leg (R-BTN-195) the course starts and its runner joins the
  person to.
