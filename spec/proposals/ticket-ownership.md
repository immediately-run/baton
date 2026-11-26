---
title: "Proposal — who owns a ticket: Baton its course state, the store the work"
description: "A recommendation, not built: one owner per ticket field across every ticket store, git-native or a tracker — Baton owns the ticket's id, its course state and its closure; the store owns what the work is; outside changes are adopted or weighed as evidence, never as an overwrite. Baton starts tickets before their store has them (course.start), a person's own session may claim the leg it starts, and an approval binds to a version."
---
# Proposal — who owns a ticket: Baton its course state, the store the work

**Status:** recommendation, not built and not scheduled. The owner settled its choices from
2026-11-22 to 2026-11-26 ([The owner's decisions](#the-owners-decisions)). It rests on
[human intent and autonomy](../../docs/context/human-intent.mdx), which says what changes when a
person, not an autonomous agent, drives an act. Nothing here changes a rule yet; every rule and
page it would change is in [Amends](#amends).

## The goal

Two things the owner wants together, 2026-11-22:

- **Starting a course without a checkout.** `baton course start bug-report`, a dashboard's
  *Start course*, an agent session over MCP: each creates the ticket at once, with an id Baton
  gives, and queues its first leg — the ticket file "can be created as part of the course".
- **One model for every ticket store.** The owner: "we shouldn't assume that tickets *won't* be
  updated outside baton, but we should consider baton the ultimate owner of baton-specific ticket
  state (ticket position, retry count, who should be notified for interaction requests, etc)",
  applied alike to git-native tickets ([Dibber](https://github.com/immediately-run/dibber)) and to
  Jira, Linear and GitHub Issues. Baton should not need a whole team to adopt it
  ([values](../../docs/context/values.mdx) #13): what happens to a ticket outside Baton is
  recognised and adopted, as outside work already is
  ([R-BTN-203](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-2)).

Who may edit a ticket outside Baton is the store's concern — a tracker's own permissions, or for
git whoever may merge the ticket's file (for immediately.run, Fieldhouse's forge gate) — never
Baton's (values #12).

## The owner's decisions

Not reopened by a review.

1. **Baton owns the ticket's course state; the store owns the work** (2026-11-22). Baton is the
   authority on every Baton-specific fact about a ticket; the store on what the work is. Neither
   assumes it is the only writer.
2. **One owner per field** (2026-11-22). No field has two authorities, so no field needs a
   conflict rule between them ([The two kinds of field](#the-two-kinds-of-field)).
3. **Baton ids always** (2026-11-22, confirmed after the question "why not the tracker's own
   id?"). Every ticket's identity is Baton's id (`B-n`, [R-BTN-199](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-3)'s
   allocator), whatever store holds it. For a Dibber store that is the only id: the one Baton
   allocated is the file's name. A store that mints keys of its own (`PROJ-123`, `ENG-42`,
   `#123`) has its key recorded beside Baton's, never in its place, for two reasons:
   - **The store's key does not exist yet when Baton needs one.** A ticket Baton originates
     must have its id at once — the command prints it, the dashboard opens its session, its
     first branch is named for it — while the store's key exists only once a writer, holding a
     credential Baton does not, has created the issue.
   - **A store's key can change.** Trackers rename keys when an issue moves (another project,
     another team, another repository), and an id is written where nothing renames it: branch
     names, commit messages, PR titles, other tickets' `depends_on`, Baton's history. Trackers
     keep a stable internal id of their own for the same reason.

   **Shown and typed as the store's key.** Wherever a store's key exists, Baton's surfaces show
   it first (`ENG-42 (B-41)`), and every command and read that takes a ticket accepts either, so
   a team that lives in its tracker need not learn Baton's ids. The store also keeps a copy of
   Baton's id on the issue, so an import after a lost Baton finds the same id again; it is the
   one Baton-owned fact a store holds, read back only on import.
4. **Course and tier are the store's** (2026-11-22). They are properties of the work, written by
   whoever files the ticket and changed where the store changes things. `requires` is taken to be
   the same kind, as a gate input like tier; the owner has not ruled on it separately.
5. **The assignee is the store's** (2026-11-22). Who an interaction request reaches is derived
   from it, and Baton may hold an override of its own.
6. **A ticket that disappears from its store raises a condition** (2026-11-25), never a closure:
   a deleted file or issue is more often a mistake than a decision ([The sync](#the-sync-in-each-direction)).
7. **An approval binds to a version** (2026-11-25), and any store whose source reads a ticket at
   a version qualifies, not only Dibber ([Approval](#approval-under-protected)).
8. **A person's own session may hold a real claim** (2026-11-25): a **session claim**, held by
   an interactive delegated key, leased and fenced like a runner's ([Session claims](#session-claims)).
9. **A human-driven credential may create a ticket and claim it at once** (2026-11-25, on the
   principle of 2026-11-26: Baton constrains autonomy, not people). For an autonomous credential
   that pair stays forbidden: it would be remote code execution.

## The two kinds of field

**Baton-owned.** Baton decides the record. A store may display it (R-BTN-200's `show`,
[proposed](tickets-and-sources.md)); a change made to the store's copy is never read back as the
value.

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
| attestations, approvals among them; conditions; an interaction request's recipients, derived from the assignee unless overridden | labels, tags, the store's own key |

## The evidence rule

An outside change to a **store-owned** field is the new value: the next read adopts it, as a
sync does today.

An outside change to a **Baton-owned** fact is evidence, weighed by the ticket's course, never an
overwrite:

- a Linear issue dragged to *Done*, or a `status: done` written into a ticket file, says the work
  may be finished — the course places the ticket by a fact leg or its reconcile leg, as it places
  a PR merged by hand (R-BTN-203);
- a `station:`, a claim or a retry count written into a file is not a fact anyone outside Baton
  can know, and is ignored; so are the Dibber statuses that say a ticket is held (`in-progress`,
  `in-review`), which describe Baton's claim, not the work.

This is R-BTN-39's position rule (no file, marker, PR or snapshot places a ticket) and R-BTN-203's
open world, extended from the position to every Baton-owned fact.

## Where a ticket comes from

- **Baton originates; the store materializes.** A ticket started through Baton
  ([`course.start`](#starting-a-course)) exists in Baton from that moment, with its id, course and
  first leg queued, before any store holds it: it is **unwritten**. Its course, or a writer, puts
  it into the store — for Dibber, its first leg writes the ticket file; for a tracker, a writer
  creates the issue (R-BTN-74's `file`, [proposed](tickets-and-sources.md)). Until the store's
  reader reads it back, Baton holds the store-owned fields it was started with; from that read
  on, the store's copy wins. Ownership of those fields changes hands once.
- **A ticket created in the store is imported.** One the sync finds that Baton has never seen is
  placed at its course's start, as a first post is today (R-BTN-39): a Dibber ticket under the id
  its file already carries, a tracker's issue under a new Baton id that is then written back to
  the issue. Who may create tickets that way is the store's concern; whether Baton admits the
  import is the repository's policy.

## The sync, in each direction

**Store to Baton** is today's sync (R-BTN-74), its reader posting each ticket's store-owned fields
and version, with four rules added:

- **Import**, as above.
- **Closure.** A withdrawal the store shows is adopted; a *done* is evidence
  ([The evidence rule](#the-evidence-rule)).
- **Baton-owned keys are not read**: the legacy `station`, `next_leg` and `claim`, and the held
  statuses.
- **Absence.** An **unwritten** ticket missing from a post stays: the store has not had it yet.
  A ticket the store **had** and a post no longer shows raises the ticket condition
  `baton.ticket-missing`, which holds it — no runner works a ticket whose content has vanished —
  with the restarts `wait` (the store will have it again; the hold lifts when it does) and
  `withdraw`. Today such a ticket loses its row (R-BTN-35); under this proposal it never closes
  for absence alone.

**Baton to the store** happens only through hands that hold the store's credential — Baton holds
none (the architecture's one outbound path) — and only for what must go out:

| What | Written by | Needed for |
|---|---|---|
| an unwritten ticket's first copy, on Dibber | its course's first leg, as part of the leg's work | `course.start` on Dibber: no new machinery |
| an unwritten ticket's issue on a tracker, and Baton's id on the issue | a writer run by a deliverer ([R-BTN-171](../BATON_SPEC/07-conditions.md#sec-7-8), proposed) | `course.start` on a tracker |
| edits to store-owned fields made through Baton | the same writer | nothing yet: edit the file or the issue |
| Baton's state shown in the store (R-BTN-200's `show`) | the same writer | a tracker's display, optionally |

So the first version needs nothing outbound beyond what a leg already does.

## Approval under `protected`

`tickets-approved` (R-BTN-189) already accepts either "a `std:approval@1`, or the human's merge of
the PR carrying it". Under this proposal:

- **An approval binds to a version.** A `std:approval@1` names the ticket and the version of its
  content it approves (R-BTN-74's `version`). An edit in the store gives the ticket a new version,
  which needs approving before a leg that requires approval acts on it. That is the whole
  guarantee, and it holds for any store.
- **The guarantee's condition becomes the source's ability, not its kind.** "The last accepted
  post's ticket source is the markdown source" becomes "the ticket source reads a ticket at a
  version" (`versions: "pinned"`): that, not git, is what makes "the runner works on the content
  that was approved" true. Dibber meets it; a tracker meets it when its source reads past
  revisions.
- **The human's merge of the PR carrying the file** stays as the second form, on Dibber.
- **Who approves is a matter of driver and proof** ([human intent](../../docs/context/human-intent.mdx),
  §2–3). Content a human-driven session wrote and committed is approved by that act at the proof
  the credential carries; the policy may require a stronger one, which the act then needs.
  Content an autonomous leg wrote — a `describe-bug` agent's ticket body — is approved by a
  human-driven act on that version: the person saying "that's right" on Baton's page, or in their
  own session holding an interactive key, at the proof the policy names.

## Starting a course

**`course.start`** is a registry action (R-BTN-129): `POST
/v1/repositories/{repository}/courses/{course}/start`, with `{sentence, fields?, claim?}` — the
sentence its title and description, `fields` any store-owned field it starts with (tier,
`requires`, `depends_on`, `parent`, the assignee), `claim` whether the caller claims the start leg
in the same transaction. Baton allocates the id, creates the ticket **unwritten** at the course's
start with `start_leg` queued, and answers `{ticket, leg, claim?}`. A course opts in as today, with
`starts_from: request`; `baton request` becomes a client of this action and pushes nothing.

**Who may call it, by driver** ([human intent](../../docs/context/human-intent.mdx)):

| Caller | May start | May claim what it started |
|---|---|---|
| human-driven: an owner's key or session, an interactive delegated key, a `human-operator` runner | any course the repository lists | yes, with `claim: true` |
| autonomous: a runner, an autonomous delegated key | only children of the ticket its purpose names (`parent`), which `tickets.created: proposed` makes proposals where the policy says so | never |

**The three ways in:**

- **The CLI.** `baton course start <course> "<sentence>"` prints `filed B-41 — describe-bug queued
  for a runner; you will be asked to join when it starts`. A runner claims the leg and raises
  `interact` (R-BTN-195): the session link goes to Needs you and to whatever delivery runner sends
  it.
- **The dashboard.** The Courses screen draws **Start course** beside each course that starts from
  a request. It calls the action, then watches the ticket until its run reports a session link,
  opens it, and moves to the ticket's page; the session page closes itself when the leg ends where
  it was opened by the dashboard (Fieldhouse's leg page, R-FH-80).
- **A person's own agent session, over MCP.** The tool calls the action with `claim: true`; the
  session holds the start leg's claim at once — no runner is offered it, so nothing races — and
  works it with the person ([Session claims](#session-claims)).

The first users are a reworked `bug-report` (its first leg `describe-bug`) and `new-feature` (its
first leg `specify`): **interactive agent legs**, joinable, with a deadline, which raise `interact`
when a runner holds them and are worked directly when a person's session does.

## Session claims

A **session claim** is a claim held by an interactive delegated key instead of a runner key.

- **Human-driven.** It carries the person's identity, so its acts are theirs
  ([human intent](../../docs/context/human-intent.mdx) §1). It may claim any leg the gates admit,
  like a `human-operator` runner; the common case is the start leg of a ticket it just started.
- **The lock binds it.** It is one claim like any other: one holder per ticket, its lease, its
  fence (R-BTN-6). It never takes a ticket another claim holds.
- **The gates bind it.** Rule 4 matches what the session declares, as for a runner; a course
  that wants a leg only a runner runs says so by requiring a capability sessions do not declare.
  A leg marked `trusted` stays a trusted runner's.
- **Its lease** is renewed by every call it makes on the claim — a person thinks between messages,
  and an agent session runs no background heartbeat — and is longer than a runner's, between 30
  and 60 minutes ([Open decisions](#open-decisions)).
- **Abandoned, it is requeued.** A session closed mid-leg lets its lease lapse; Baton reaps the
  claim as any other, and the leg goes back to the queue, where a runner claims it and raises
  `interact`, the ticket's partial body its hand-off.
- **It ends its claim itself.** A runner's stub checks a leg's work before its close (the ticket's
  schema, the leg's heading); a session ends its claim directly, so those checks move to the next
  reader — the sync's schema check, and the next leg reading the ticket.

## Migration

The existing tickets keep their ids: a Dibber ticket's id is its file's name. What changes is
whom Baton believes, in three steps, each releasable alone:

1. **Baton originates** (`course.start`, unwritten tickets, import as today). Existing tickets
   are untouched.
2. **Closure flips.** An end station closes a ticket; the store's *done* becomes evidence; a
   ticket missing from its store raises `baton.ticket-missing`. Today the two almost always agree.
   The courses that commit to the default branch (`bug-report`, `draft-ticket`, `decision`,
   `build-app`, `spec-to-tickets`) have no reconcile leg yet, so a hand-closed ticket on one of
   them waits as evidence until it gets one.
3. **Baton-owned keys stop being read**, and the git-lock commands that claim by pushing a status
   (`baton tickets claim`, `set`) retire with them (R-BTN-193 already marks them legacy). Moving a
   closed ticket's file to `archive/` stays a store-side tidy-up the closing leg does; Baton never
   depends on it.

## When Baton's state is lost

The 2026-10-28 rule stands: lost Baton state fails closed and is never restored from git. Under
this model that is what happens naturally: the store-owned fields come back from the store; what
Baton owned — positions, runs, approvals, attestations — is gone, and the work is reviewed and
approved again. Store tickets are imported as on first sight, a tracker's under the Baton id the
issue kept.

## What changes from today

1. **Existence** moves from "a ticket exists when a sync posts it" to "Baton or the store may
   originate it", and absence raises a condition (R-BTN-35, R-BTN-1).
2. **Ids** become Baton's for every ticket, a store's own key recorded beside them (R-BTN-199,
   R-BTN-1's table).
3. **Closure** moves from the store's `status: done` to Baton's end station; the store's withdrawal
   is adopted (R-BTN-35, R-BTN-1's table, R-BTN-74's markdown reader; every standard course's end
   leg, whose instructions tell the agent to write `status: done`).
4. **The evidence rule** covers every Baton-owned fact, not only the position.
5. **A course change in the store** is adopted, so a ticket's position may be off the new course's
   graph; R-BTN-83's `course-changed` wait already covers it.
6. **A claim may be held by a person's session**, not only by a runner.
7. **Approval** binds to a version, from any store that reads one.

## Amends

- [values](../../docs/context/values.mdx) #1, [architecture](../../docs/context/architecture.mdx)
  (*The ledger and the cache*, *The server is the only allocator*),
  [vocabulary](../../docs/context/vocabulary.mdx) (*Ticket*, *Ticket source*, *Claim*, *Runner*;
  new: *Session claim*, *Unwritten ticket*), [product](../../docs/context/product.mdx) (*What it is
  not*).
- BATON_SPEC [R-BTN-1](../BATON_SPEC/01-what-baton-is.md#sec-1)'s table,
  [R-BTN-35](../BATON_SPEC/01-what-baton-is.md#sec-1), R-BTN-39's start bullet,
  [R-BTN-74](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-2) (the reader's closure and absence,
  the writer's `file`), R-BTN-88 (what rebuilds from where), R-BTN-199 (ids for every ticket),
  [R-BTN-131](../BATON_SPEC/05-courses.md#sec-5-8) (`baton request` as a client of `course.start`),
  [R-BTN-189](../BATON_SPEC/12-security.md#sec-12-8) (`tickets-approved`: an approval of a version;
  the pinned-source condition), R-BTN-186 (interactive keys, per
  [human intent](../../docs/context/human-intent.mdx)), R-BTN-129 (the action `course.start`),
  §9's claim rules and R-BTN-6 (a claim held by a session), R-BTN-163 and R-BTN-160's table
  (`baton.ticket-missing`).
- Its home when built: one new rule in §1 beside R-BTN-35 for the field table and the evidence
  rule; one in §4 for originating, importing and absence; one in §9 for session claims; and
  `course.start` with R-BTN-131.

## Open decisions

- **The session claim's lease:** a number between 30 and 60 minutes, and whether a session may
  ask for a longer one.
- **`baton.ticket-missing`'s hold:** a hold as above, or only a notice while legs go on reading
  the content they last had.
- **`requires`:** store-owned with course and tier (assumed above), or Baton's.
- **Reconcile legs for the courses that commit to the default branch**, so a hand-closed ticket on
  one of them is placed rather than waiting.
- **The tracker writer and its deliverer** (R-BTN-171), needed for `course.start` on a tracker,
  not on Dibber.
- **`baton request` offline:** whether it keeps today's git path, filing with a scanned id, when
  Baton does not answer.
