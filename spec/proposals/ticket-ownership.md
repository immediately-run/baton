---
title: "Proposal — who owns a ticket: Baton its course state, the store the work"
description: "A recommendation, not built: one owner per ticket field across every ticket store, git-native or a tracker — Baton owns the ticket's id, its course state and its closure; the store owns what the work is; outside changes are adopted or weighed as evidence, never as an overwrite. Baton starts tickets before their store has them (course.start), a person's own session may claim the leg it starts, and an approval binds to the bytes approved."
---
# Proposal — who owns a ticket: Baton its course state, the store the work

**Status:** recommendation, not built and not scheduled. An **arena** is the unit Baton
coordinates — one ticket source, its configuration and everything Baton owns about its tickets
([vocabulary](../../docs/context/vocabulary.mdx)); the spec and the API still write it
`repository`, as the route below does. The owner settled its choices from
2026-11-22 to 2026-11-26 ([The owner's decisions](#the-owners-decisions)). It rests on
[human intent and autonomy](../../docs/context/human-intent.mdx), which says what changes when a
person, not an agent, drives an act. Nothing here changes a rule yet; every rule and
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
   id?"). Every ticket's identity is Baton's id — the arena's prefix and a number from its
   sequence (`B-41`, [R-BTN-199](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-3)) — whatever store
   holds it. For a Dibber store that is the only id: the one Baton
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
   one Baton-owned fact a store holds, read back only when importing into a Baton that has lost
   its state, only for an issue no other issue's copy names, confirmed by an owner before it
   counts, and with the sequence then advanced past it. Anywhere else a copied id is ignored, and
   a copy that changes raises `baton.id-copy-changed`, so nobody takes over `B-41` by writing it
   onto another issue. A name that reads as both a Baton id and a store key is refused as
   ambiguous: the arena's prefix is reserved, and a tracker key in it is never accepted as a name.
4. **Course and tier are the store's** (2026-11-22). They are properties of the work, written by
   whoever files the ticket and changed where the store changes things. So is `requires`, a gate
   input like tier (the owner, 2026-11-26).
5. **The assignee is the store's** (2026-11-22). Who an interaction request reaches is derived
   from it, and Baton may hold an override of its own.
6. **A ticket that disappears from its store raises a condition** (2026-11-25), never a closure:
   a deleted file or issue is more often a mistake than a decision ([The sync](#the-sync-in-each-direction)).
7. **An approval binds to a version** (2026-11-25), and any store whose source reads a ticket at
   a version qualifies, not only Dibber ([Approval](#approval-under-protected)).
8. **A person's own session may hold a real claim** (2026-11-25; its two forms 2026-11-26): a
   **session claim**, over MCP or from the person's CLI with `baton session claim`, leased like a
   runner's and fenced where the CLI holds it ([Session claims](#session-claims)).
9. **A human-driven credential may create a ticket and claim it at once** (2026-11-25, on the
   principle of 2026-11-26: Baton constrains agent-driven work, not people). For an agent-driven
   credential that pair stays forbidden: it would be remote code execution. So a ticket an
   agent-driven credential starts is never claimed in the same call, and where the policy's
   `tickets.created` is `proposed`, no leg of it is offered until a human approves its text,
   whatever guarantees the policy names ([Approval](#approval-under-protected)). Under `filed` it
   runs as a child a runner files in git today does. Who drives is the
   key's, never the channel's, and a runner is always agent-driven
   ([human intent](../../docs/context/human-intent.mdx)).
10. **Baton holds an unwritten ticket's start text** (2026-11-26) — its title and description, at
    most 1,024 Unicode code points — until the store has the ticket: a stated exception to R-BTN-33, which
    ends with the store's first read. Baton never holds more of a ticket than that.
11. **The roster decides which people may start and hold session claims** (2026-11-26): read from
    the forge — the accounts that can push to the config repository, or the members of its forge
    organisation, as the arena chooses — and posted by the sync; Baton keeps no list of them. A
    person signs in with the forge to get a credential
    ([people](people-and-dashboard.md#5-people-identities-and-the-roster)).

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
  ([`course.start`](#starting-a-course)) exists in Baton from that moment, with its id, course,
  start text and first leg queued, before any store holds it: it is **unwritten** (decision 10).
  - **Its row survives posts that do not name it.** The `tickets` row carries `unwritten: true`,
    and a board post that leaves it out neither drops nor closes it (R-BTN-35's "the next accepted
    snapshot overwrites it" does not reach an unwritten row).
  - **Its legs are handed the start text.** While it is unwritten, every claim answer for it
    carries `start: {title, description}`; the leg's stub writes it as the ticket's text, and
    `BATON_TICKET_FILE` names that copy, as for a ticket posted with no `path` (R-BTN-74). A claim of an unwritten ticket is
    not refused `unknown-ticket` (§9.1), and the runner does not release it `stale-board` for a
    missing file (R-BTN-5/34): there is no file yet.
  - **The store makes it written.** For Dibber, the first leg writes the ticket file as part of its
    work; for a tracker, a writer creates the issue (R-BTN-74's `file`,
    [proposed](tickets-and-sources.md)). The first post that shows it clears `unwritten`, drops the
    start text, and from then on the store's copy of every store-owned field wins.
  - **A ticket never written is seen.** One unwritten with no claim active on it for a day raises
    `baton.ticket-unwritten` on itself, closed when the store shows it or it is withdrawn.
  - **Withdrawing it is Baton's while it is unwritten.** The store has no copy, so Baton owns the
    whole ticket until it does: its starter or an owner withdraws it (`ticket.withdraw`, refused
    once the store has it, when withdrawal is the store's again).
  - **Its provenance is never a human's word.** An unwritten ticket's `last_written_by`
    (R-BTN-194) carries no `human`; Baton records beside it who started it and who drove the start
    (`started_by: {person | runner, driver}`), so a start never makes a `**Brief:**` line read as
    the owner's.
  - **The first leg writing its file creates no ticket.** The file is the started ticket's own
    content, approved by hash where the policy wants approval; `tickets.created` (R-BTN-188) speaks
    of tickets a runner's action creates, and this one a `course.start` created.
  - **What Baton keeps** (§13): the `tickets` row's `unwritten` flag; the start text, until the
    store has the ticket; and each caller's `request_id`s, for 24 hours, with the hash of the body
    each filed.
- **A ticket created in the store is imported.** One the sync finds that Baton has never seen is
  placed at its course's start, as a first post is today (R-BTN-39), under the id its Dibber file
  carries. A tracker's issue gets a new Baton id, written back to the issue once the tracker's
  writer exists; until then tracker sources wait (decision 3, [Open decisions](#open-decisions)).
  Who may create tickets in the store is the store's concern; whether Baton admits the import is
  the arena's policy.

## The sync, in each direction

**Store to Baton** is today's sync (R-BTN-74), its reader posting each ticket's store-owned fields
and version, with four rules added:

- **Import**, as above.
- **Closure.** A withdrawal the store shows is adopted; a *done* is evidence
  ([The evidence rule](#the-evidence-rule)).
- **Baton-owned keys are not read**: the legacy `station`, `next_leg` and `claim`, and the held
  statuses.
- **Absence.** An **unwritten** ticket missing from a post stays. A ticket Baton has already
  closed may leave the store as it likes (a Dibber file is closed in place, by its `status`, and
  never moves — [R-DIB-2](https://github.com/immediately-run/dibber/blob/main/SPEC.md) — but another
  store may drop a closed ticket). Any
  other ticket the store **had** and a post no longer shows raises the ticket condition
  `baton.ticket-missing`, which holds it — no runner works a ticket whose content has vanished, not
  even from the content it last read (the owner, 2026-11-26) — and a claim on it is released `stale-board`, as today (§9.4). Its one restart is `wait`: the
  hold lifts when the store shows the ticket again, and a ticket that reappears needs approval
  again where the policy wants approval. Withdrawing it is the store's act, not Baton's (decision
  2). R-BTN-10's confirmation of `done` by the ticket being absent becomes confirmation by its end
  station; R-BTN-120's `depends_on` reads Baton's end station, not the store's `done`.

**Baton to the store** happens only through hands that hold the store's credential — Baton holds
none (the architecture's one outbound path) — and only for what must go out:

| What | Written by | Needed for |
|---|---|---|
| an unwritten ticket's first copy, on Dibber | its course's first leg, as part of the leg's work | `course.start` on Dibber: no new machinery |
| an unwritten ticket's issue on a tracker, and Baton's id on the issue | a writer run by a deliverer ([R-BTN-171](../BATON_SPEC/07-conditions.md#sec-7-8), proposed) | `course.start` and import on a tracker |
| edits to store-owned fields made through Baton | the same writer | nothing yet: edit the file or the issue |
| Baton's state shown in the store (R-BTN-200's `show`) | the same writer | a tracker's display, optionally |

So the first version, on Dibber, needs nothing outbound beyond what a leg already does; tracker
sources come with their writer.

## Approval under `protected`

`tickets-approved` (R-BTN-189) already accepts either "a `std:approval@1`, or the human's merge of
the PR carrying it". Under this proposal:

- **An approval binds to the bytes approved.** A `std:approval@1` is written by the approving
  person (writer `human`, or `person` where the policy admits it) and names what they were shown:
  for a written ticket, the version the sync posted — on Dibber its file's blob id, which is a hash
  of its bytes — and for an unwritten ticket, the SHA-256 of its canonical `{title, description}`.
  Baton holds both without holding a written ticket's content (R-BTN-33). Before a leg that
  requires approval acts, the holder checks it: a runner's stub reads the ticket at that version;
  for a session claim, Baton compares the approval with the version the latest post shows, or with
  the hash of the start text it serves. An edit in the store is new content, which needs approving again. That is the whole
  guarantee, and it holds for any store. (The security proposal's `{paths, blobs}` value gains this
  ticket form.)
- **The guarantee's condition becomes the source's ability, not its kind.** "The last accepted
  post's ticket source is the markdown source" becomes "the ticket source reads a ticket at a
  version" (`versions: "pinned"`): that, not git, is what lets the runner read the bytes that were
  approved. Dibber meets it; a tracker meets it when its source reads past revisions.
- **An unwritten ticket is approved by its start text's hash.** Under `tickets-approved` no leg of
  it is offered, and no session claim of one is granted, until a writer the policy admits for
  `std:approval@1` — `human` alone, under that guarantee — approves the hash; `claim: true` on such
  a start is refused `invalid-params`, so the CLI approves and then claims.
- **A ticket an agent-driven credential starts waits for a human wherever tickets are
  proposals.** Where `tickets.created` is `proposed`, whatever guarantees the policy names, none of
  its legs is offered until a human-driven act approves its start text's hash: it does not exist
  for runners before a person has read it, as a proposed ticket in git does not land before a
  person merges it.
- **The human's merge of the PR carrying the file** stays as the second form, on Dibber.
- **Who approves is a matter of driver and proof** ([human intent](../../docs/context/human-intent.mdx)
  §2–3). Every approval is a recorded `std:approval@1` checked against the policy's writers.
  Content a human-driven session wrote is approved by that person's act at the proof the
  credential carries; where the policy admits only `human`, it takes their `human_only` key. Content
  an agent-driven leg wrote — a `describe-bug` agent's ticket body — is approved by a human-driven
  act on its hash: the person saying "that's right" on Baton's page, or in their own session with
  their interactive grant, at the proof the policy names.

## Starting a course

**`course.start`** is a registry action (R-BTN-129): `POST
/v1/repositories/{repository}/courses/{course}/start` with `{request_id, title, description?,
fields?, claim?}`.

- **The body.** `request_id`, the caller's own id for the request, so a retry files one ticket:
  the same id with the same body answers the ticket it filed, with another body `conflict`.
  `title` and `description`, at most 1,024 Unicode code points together (decision 10). `fields`,
  the store-owned fields it starts with: `depends_on` and `parent`; tier, `requires` and the
  assignee only from a human-driven caller. `claim: true` claims the start leg in the same
  transaction, where the leg admits session claims. An agent-driven caller also names `claim_id`,
  the claim it holds; its `parent` must be that claim's ticket.
- **What it does.** Baton allocates the id from the arena's sequence — never below the highest id
  any accepted post of the arena has shown, so a fresh or recovered Baton never reissues one
  (R-BTN-199) — creates the ticket **unwritten** at the course's start with `start_leg` queued, and
  answers `{ticket, leg, claim?}`.
- **Refusals.** `not-found` for a course the arena does not list; `invalid-params` for a
  top-level start on a course without `starts_from: request` (a child, with `parent`, may start on
  any course the arena lists), for text over the limit, or for `claim: true` where approval comes
  first; `forbidden` for a person neither on the roster nor an owner, or an agent-driven caller
  outside its claim; `unavailable` while the roster is stale; `conflict` as above.
- **The CLI.** `baton course start <course> "<title>"`; `baton ticket request` (R-BTN-131) becomes
  its client and pushes nothing. With Baton unreachable it fails loudly, naming Baton and the
  error, and exits non-zero: it never falls back to filing in git under a scanned id, the legacy
  mechanics R-BTN-193 retires (the owner, 2026-11-26).

**Who may call it, by driver** ([human intent](../../docs/context/human-intent.mdx)):

| Caller | May start | May claim what it started |
|---|---|---|
| human-driven: a person on the arena's roster or an owner — signed in to the dashboard, with their own key from the CLI, or with their interactive grant over MCP | any course the arena lists | yes, with `claim: true`, where the start leg admits session claims |
| agent-driven: a runner, an agent-driven key | only children of the ticket its claim holds (`parent`), never setting tier, `requires` or the assignee; proposals where `tickets.created: proposed` | not in the same call; afterwards as any child is claimed today |

**The three ways in:**

- **The CLI.** `baton course start bug-report "Terminated runners show by default"` prints `filed
  B-41 — describe-bug queued for a runner; you will be asked to join when it starts`. A runner
  claims the leg and raises `interact` (R-BTN-195): the session link goes to Needs you and to the
  person's notifier.
- **The dashboard.** The Courses screen draws **Start course** beside each course that starts from
  a request. It calls the action, then watches the ticket until its run reports a session link,
  opens it, and moves to the ticket's page; the session page closes itself when the leg ends where
  it was opened by the dashboard (Fieldhouse's leg page, R-FH-80).
- **A person's own agent session.** Claude Code over MCP calls the action with `claim: true`, or a
  person with a checkout runs `baton course start --claim` from their CLI, which starts the ticket
  and then holds its start leg as `baton session claim` does; either way the session holds the
  start leg's claim at once — no runner is offered it, so nothing races — and works it with the
  person ([Session claims](#session-claims)).

The first users are a reworked `bug-report` (its first leg `describe-bug`) and `new-feature`, a new
course (its first leg `specify`): **interactive agent legs**, joinable, with a deadline, which raise
`interact` when a runner holds them and are worked directly when a person's session does.

## Session claims

A **session claim** is a claim held by a person's own session instead of a runner. It is
human-driven: its acts are the person's ([human intent](../../docs/context/human-intent.mdx) §1).

- **A leg admits it, or not.** A leg takes session claims only where its course file says
  `sessions: allow`; no existing leg does. A leg marked `trusted` never does.
- **The gates, for a person.** Rule 1 (blocks) and rule 3 (one holder) bind it as any claim.
  Rule 4 matches no capabilities: a leg that admits sessions requires none of a runner's. Rule 5's
  tier ceiling and rule 7's grant do not apply: the roster stands in for the grant. Rule 9
  (`stale-skills`) does not apply. The `chain` gate counts the person as one credential, so a person
  never claims the review of work their own session wrote. (§6.6 and R-BTN-106 are amended for
  this.)
- **Two forms, one claim.**
  - **From the person's CLI**, `baton session claim <ticket>`: signed with the person's own key, it
    holds the lease with a small process that calls `claim.renew`, and installs the `pre-push`
    fence in the person's checkout for the person's own interactive session to work in. The
    fence's holder query (R-BTN-26's `branch-holder`) asked with a person's key answers *yours*
    for that person's own session claims and *another's* for every other claim, so the person's
    pushes pass and a lapsed claim's are refused. It is no runner: it runs no queued legs, and
    nothing it runs reaches the person's keys.
  - **Over MCP, with an interactive grant**, for an agent such as Claude Code. Its moves are the
    claim actions a runner uses — `claim`, `advance`, `end`, `handoff` — called as MCP tools with
    the grant, and Baton applies the same checks it applies to a runner's: the edge, the run
    limit, the gates, and the outputs and entry requirements it holds (R-BTN-108, R-BTN-109). The
    holder's report of where its leg reached is an `std:arrival@1` written as `person`. The lease
    is renewed by every call on the claim and by `claim.renew {claim_id}`; every reply
    carries the claim's state and its pending messages (a release, a stop), as a heartbeat's reply
    does. Its length is within R-BTN-9's bounds, 15 minutes by default (the owner, 2026-11-26).
- **A lapsed claim cannot collide unnoticed.** Either form's lapsed claim is reaped as any other,
  and its leg requeued the same way. An MCP session runs no `pre-push` fence, so for it the design
  makes a late push visible instead of impossible:
  - when its lease lapses Baton reaps the claim and requeues the leg **onto a fresh branch**: the
    next claim's answer names it (`claude/B-41-2`), and Baton records which branch belongs to which
    claim (§4.2's branch pattern already admits a suffix);
  - a push to any other branch of the ticket, the old session's included, is outside work the sync
    finds (R-BTN-203), weighed by the course, never merged silently;
  - the new holder checks before it closes that the remote head of its branch is its own last push;
  - a reaped session claim is not a failed attempt: a person closing a window is not a failure
    (R-BTN-122).

  The old session still holds the person's forge credential and can push to the new branch; a
  hook that fences it is in the [hardening proposal](hardening.md).
- **Abandoned, it is requeued.** A runner claims the leg and raises `interact`, the ticket's
  partial text its hand-off — content an agent-driven leg then treats as unapproved.
- **The checks a stub makes move to the next reader.** A runner's stub checks the ticket's schema
  and the leg's heading before its close; a session claim through MCP has no stub, so those fall
  to the sync's schema check and the next leg, and the leg-end scope check (§12.9) runs on the
  session's pushes from the sync's facts. That is a change to the architecture's *verification at
  the boundary*, for session claims only, named in [Amends](#amends).

## Migration

The existing tickets keep their ids: a Dibber ticket's id is the `id` its file carries, and is
named after. Tracker sources are not built, so no tracker ticket needs re-identifying. What
changes is whom Baton believes, in three steps, each releasable alone:

1. **Baton originates** (`course.start`, unwritten tickets, session claims, import as today).
   Existing tickets are untouched.
2. **Closure flips.** An end station closes a ticket; the store's *done* becomes evidence; a
   ticket missing from its store raises `baton.ticket-missing`. Today the two almost always agree.
   The courses that commit to the default branch (`bug-report`, `draft-ticket`, `decision`,
   `build-app`, `spec-to-tickets`) have no reconcile leg yet; each gains one ([R-BTN-203](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-2)), so a
   hand-closed ticket on one of them is placed like one on a PR course rather than waiting (the
   owner, 2026-11-26). Closure flips only once they have it.
3. **Baton-owned keys stop being read**, and the git-lock commands that claim by pushing a status
   (`baton tickets claim`, `set`) retire with them (R-BTN-193 already marks them legacy). How the
   store shows a ticket closed stays the store's: a Dibber ticket's `status`, set in place (Dibber's
   R-DIB-2), which the closing leg writes and Baton reads only as evidence.

## When Baton's state is lost

The 2026-10-28 rule stands: lost Baton state fails closed and is never restored from git. Under
this model that is what happens naturally: the store-owned fields come back from the store; what
Baton owned — positions, runs, approvals, attestations — is gone, and the work is reviewed and
approved again. Store tickets are imported as on first sight, a tracker's under the Baton id the
issue kept (decision 3).

## What changes from today

1. **Existence** moves from "a ticket exists when a sync posts it" to "Baton or the store may
   originate it", and absence raises a condition (R-BTN-35, R-BTN-1).
2. **Ids** become Baton's for every ticket, a store's own key recorded beside them (R-BTN-199,
   R-BTN-1's table).
3. **Closure** moves from the store's `status: done` to Baton's end station; the store's withdrawal
   is adopted (R-BTN-35, R-BTN-1's table, R-BTN-74's markdown reader, R-BTN-10, R-BTN-120; every
   standard course's end leg, whose instructions tell the agent to write `status: done`).
4. **The evidence rule** covers every Baton-owned fact, not only the position.
5. **A course change in the store** is adopted, so a ticket's position may be off the new course's
   graph; R-BTN-83's `course-changed` wait already covers it.
6. **A claim may be held by a person's session**, not only by a runner.
7. **Approval** binds to the bytes approved, from any store that reads a version.
8. **Baton holds a ticket's start text** until its store has it, and nothing more of any ticket.

## Amends

- [values](../../docs/context/values.mdx) #1, [architecture](../../docs/context/architecture.mdx)
  (*The ledger and the cache*, *The server is the only allocator*, and *Verification at the
  boundary*, for session claims), [vocabulary](../../docs/context/vocabulary.mdx) (*Ticket*,
  *Ticket source*, *Claim*, *Runner*; *Session claim* and *Unwritten ticket* are added),
  [product](../../docs/context/product.mdx) (*What it is not*).
- BATON_SPEC:
  - §1: [R-BTN-1](../BATON_SPEC/01-what-baton-is.md#sec-1)'s table,
    [R-BTN-33](../BATON_SPEC/01-what-baton-is.md#sec-1) (the start text's exception),
    [R-BTN-35](../BATON_SPEC/01-what-baton-is.md#sec-1) (existence, closure, absence, unwritten
    rows), R-BTN-39's start bullet;
  - §4: [R-BTN-74](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-2) (the reader's closure and
    absence, the writer's `file`), R-BTN-5/34 (an unwritten ticket's text), R-BTN-88 (what rebuilds
    from where), R-BTN-199 (ids for every ticket, the server's floor), R-BTN-120 (`depends_on`
    reads Baton's end), §4.4's post (`unwritten` rows);
  - §5: [R-BTN-131](../BATON_SPEC/05-courses.md#sec-5-8) (`baton ticket request` as a client of
    `course.start`), R-BTN-69 (`sessions: allow`), R-BTN-108 and R-BTN-109 (outputs and entry
    requirements checked for a session claim);
  - §4.2's `branch_pattern` and R-BTN-190 (a branch recorded per claim; pushes to another branch as
    outside work), R-BTN-194 (an unwritten ticket's provenance, `started_by`);
  - §6.6 (rules 4, 5, 7 and 9, and `chain`, for a session claim) and R-BTN-106 (moves made over
    MCP);
  - §9: §9.1 (`unknown-ticket` and unwritten tickets), R-BTN-4, R-BTN-9, R-BTN-19, R-BTN-26, §9.5
    and §9.7 (session claims: the lease, reaping onto a fresh branch, not a failed attempt),
    R-BTN-10 (confirmation by end station), R-BTN-122;
  - §12: [R-BTN-189](../BATON_SPEC/12-security.md#sec-12-8) (`tickets-approved`: an approval of a
    hash; the pinned-source condition), R-BTN-186 and R-BTN-188 (per
    [human intent](../../docs/context/human-intent.mdx));
  - §7 and §11: R-BTN-129 and R-BTN-130 (`course.start`, `claim.renew`, the interactive grant),
    R-BTN-163 and R-BTN-160's table (`baton.ticket-missing`, `baton.ticket-unwritten`);
  - §9 and §12: R-BTN-26's `branch-holder` asked with a person's key; R-BTN-181's writer `person`;
  - §13: the `unwritten` flag, the start text, `started_by`, `request_id` records, a claim's branch;
  - §14: the claim answer's `start` and approval hash, `course.start`'s route, `claim.renew`,
    `ticket.withdraw` for an unwritten ticket.
- The [security proposal](security.md): `std:approval@1`'s value gains a ticket's content hash.
- [BATON_MCP_OAUTH_SPEC](../BATON_MCP_OAUTH_SPEC.md): session claims and `course.start` over an
  interactive grant (as [people](people-and-dashboard.md#5-people-identities-and-the-roster)
  amends it).
- Its home when built: one new rule in §1 beside R-BTN-35 for the field table and the evidence
  rule; one in §4 for originating, importing and absence; one in §9 for session claims; and
  `course.start` with R-BTN-131.

## Not built yet

- **The tracker writer and its deliverer** ([R-BTN-171](../BATON_SPEC/07-conditions.md#sec-7-8),
  specified, not built). This is a dependency, not a decision: `course.start` and import on a
  tracker need it, Dibber does not. Until it is built, `course.start` on an arena whose source is
  a tracker is refused, loudly, as the CLI is when Baton is unreachable.

No open decisions are left from this proposal's review.
