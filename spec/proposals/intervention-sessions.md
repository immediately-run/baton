---
title: "Proposal — intervention sessions: an agent a person starts on one Needs-you entry"
description: "A recommendation, not built: a person selects a Needs-you entry and starts an intervention — a ticket filed on a course the repository adopts, worked by a sandboxed leg or by an agent over MCP. An agent-driven session holds a key scoped to one subject that reads, may only tighten, and files every other act as a pinned request an approver confirms; a session a person drives acts directly with that person's own credential, every act recorded against the intervention."
---
# Proposal — intervention sessions: an agent a person starts on one Needs-you entry

**Status:** recommendation for future development, not built and not scheduled (the owner,
2026-11-21: "we don't have to build this now"). Written as a hand-off. Nothing here changes a
rule; every rule or proposal it would change is in [Amends](#amends). The owner settled its four
design choices on 2026-11-21, after two adversarial reviews ([The owner's
decisions](#the-owners-decisions)); [Open decisions](#open-decisions) holds only what is still
open. **Amended 2026-11-26** by [human intent and autonomy](../../docs/context/human-intent.mdx):
what an intervention may do now depends on who drives it ([Who drives](#who-drives-two-kinds-of-intervention));
the design below the amendment is the agent-driven kind's. It writes the unit Baton coordinates as
a `repository`, as the spec and the API still do; the [vocabulary](../../docs/context/vocabulary.mdx)
now calls it an **arena**.

**Its home when built:** one new rule, **R-BTN-n (interventions)**, in
[§7.3](../BATON_SPEC/07-conditions.md#sec-7-3) beside R-BTN-163, holding the start, one
intervention per subject, takeover, the key, requests, batches, the tail, the end and the
lifetimes, and `baton.intervention-emergency`. The two new conditions it relies on belong to the
rules that find their causes ([The owner's three examples](#the-owners-three-examples-against-todays-conditions)).

## The goal

The owner, 2026-11-21:

> The overall design of Baton favors explicit flow control (via predefined courses), however
> there can be situations [where] exceptional cases must be handled, some examples:
> - A ticket times out at a station because no leg is available.
> - A ticket runs out of retries for a leg
> - All work is blocked from a runner
>
> In such cases the sort of interventions we have had in this conversation are necessary. So a
> debugging / intervention agent session - sandboxed, but with direct access to baton as repo
> owner (possibly as admin) and github with the ability to merge PRs seems necessary. These
> intervention sessions should be designed to solve a specific issue … not to be a long-running
> assistant like the "mayor".

And: "intervention session should start when [a] 'needs you' ticket condition [is] selected in
dashboard UI … ideally an existing agent should also be able to connect to the baton server and
handle these interventions through MCP."

## The owner's decisions

Settled 2026-11-21; not reopened by a review.

1. **Authority: by who drives** (2026-11-21; amended 2026-11-26). An **agent-driven** session — the
   leg form, or an agent over MCP with an agent-driven key — **diagnoses and requests**: it reads,
   and may tighten or stop. Every loosening (lifting another credential's hold, `retry` on a
   non-retryable hold), every route, adopt, expedite and merge is a **request** the session files,
   which an approver on the list that governs that act
   ([R-BTN-188](../BATON_SPEC/12-security.md#sec-12-8)) confirms on Baton's own page, reached
   from the page or from a delivery runner's channel (ntfy, Slack) — never by a code handed to
   the agent. A **human-driven** session — a person's own agent, over MCP with their interactive
   grant — **acts directly**, within what the person's role admits at the proof the credential
   carries: no request, no confirmation step, every act recorded against the intervention
   ([Who drives](#who-drives-two-kinds-of-intervention)). For the agent-driven kind: What a delegated key may do is
   unchanged: the intervention key's powers are a subset of
   [R-BTN-186](../BATON_SPEC/12-security.md#sec-12-8)'s, and a confirmation is the approver's own
   act under R-BTN-188, so neither rule's powers change, nor Fieldhouse's R-FH-92–94. What does
   change is wording that says a delegated key *is* an MCP key (R-BTN-186's definition, people
   and dashboard §1, the vocabulary): see [Amends](#amends).
2. **Record: a ticket in the arena's ticket source** (2026-11-21; amended 2026-11-26). An
   intervention is a ticket filed through the ticket source, as R-BTN-161's handler tickets are
   ([conditions proposal, §2](conditions.md#2-handlers)), on a course the arena adopts — never a
   course core ships (values #3). An agent-driven intervention is claimed by a runner like any
   ticket; a human-driven one is held by the person's own session, a session claim
   ([ticket ownership](ticket-ownership.md#session-claims)): a claim like any other, held by a
   person's session rather than a runner.
3. **MCP: accept the risk, and warn.** The owner: "Accept the risk. If there is a way to issue a
   warning to the user that a fresh session is strongly advised we should do so but it's
   ultimately up to the user's judgement. MCP connections should be possible as repo owner or
   admin (the latter being reserved for major emergencies only)." Any agent may connect; every
   start warns and records the person's acknowledgement ([The MCP form](#the-mcp-form)); an
   administrator starts one only as an emergency ([Emergencies](#emergencies)). Confirmation of
   every request stays on Baton's page; a human-driven session files none (decision 1).
4. **Batches: yes, per type.** A person may start one intervention over every open entry of one
   type with one cause (every `baton.retries` holding `attempts-exhausted` after the same error,
   say): it diagnoses once and settles each ticket. Every act is still per ticket and confirmed;
   one confirmation may cover a listed batch the person reviews on the page ([Batches](#batches)).

## What it is not

- **Not a coordinator.** No standing agent watches the factory or assigns work (compare Gas
  Town's Mayor, `docs/compared-to-gastown.mdx`). An intervention exists for one entry, or one
  batch, and ends with it. Baton stays a lease server that assigns nothing (values #12): the
  person who starts an intervention chooses who works it.
- **Not automatic.** A person starts each one. Binding conditions to handlers that start by
  themselves is R-BTN-161's (proposed); an intervention could later be started by such a binding
  as a handler course (an [open decision](#open-decisions)).
- **Not a way around the course or the approvers.** An agent-driven session's own powers only
  tighten. What moves a ticket on — a restart, an unhold, a route, an adopt — is the act it
  already is, by the credential that already may take it, at the session's request. A
  human-driven session takes those acts itself, because its credential already may.

## What exists today (2026-11-21)

- **Needs you** is [R-BTN-163](../BATON_SPEC/07-conditions.md#sec-7-3)'s: the open conditions
  and the queued person legs. Built: `condition.list`; `condition.show`
  (`GET …/conditions/{condition}`), whose `allowed` names the caller's actions on it; and
  `repo.needs-you` (`GET …/needs-you`), which adds the queued person legs and the state read's
  Needs-you `listings` (§14; S-BTN-275, S-BTN-276). Besides conditions, Needs you lists a leg's
  scope findings ([§12.9](../BATON_SPEC/12-security.md#sec-12-9)). The dashboard's controls on
  the Conditions screen are proposed (people and dashboard [§4](people-and-dashboard.md#4-the-screens);
  B-207).
- **Core's conditions** and their restarts are R-BTN-163's; resolving one is an owner's or an
  administrator's, never a delegated key's (R-BTN-163, R-BTN-186). `baton.contract` is not built
  (§7). A core `notify` condition closes with its cause; nothing acknowledges it. The one
  acknowledgement Needs you takes is §12.9's `scope-resolved`, an owner's.
- **Delegated keys** are R-BTN-186's (§12.8). The MCP endpoint and key (people and dashboard
  [§2](people-and-dashboard.md#2-mcp); B-25, B-124) and OAuth for MCP clients
  ([BATON_MCP_OAUTH_SPEC](../BATON_MCP_OAUTH_SPEC.md), B-73) are proposed.
- **Owners' sessions and confirmed actions** are proposed (people and dashboard
  [§3](people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions); B-76 for owners'
  sign-in, B-207 for the dialogs). Only administrators' sessions are built (R-BTN-155).
- **Fieldhouse**: joinable leg sessions and the leg page (R-FH-80), the leg archive (R-FH-82),
  and, from stage 2, the forge gate (R-FH-90–94), whose leg gate has no merge for any profile.
- **Session links carry a capability.** B-312 (filed, not built) serves them only to dashboard
  sessions, the reporting runner and an `interact` delivery; every other reader gets
  `session_url: null` with `session_link: true`. This proposal's session-link rule depends on it
  landing.

### The owner's three examples, against today's conditions

- **"A ticket times out at a station because no leg is available."** This is not
  `baton.stalled`: [R-BTN-167](../BATON_SPEC/07-conditions.md#sec-7-5)'s stalled time counts only
  while the sync attests the leg `waiting`. A leg posted `ready` that no runner can take raises at
  most `baton.capability-missing` (R-BTN-75, a capability no live runner declares) or
  `baton.queue-over` (R-BTN-79), and often nothing — a tier ceiling, a barred tag or
  `awaiting-sync` raise no condition. It needs a new ticket condition, **`baton.unclaimable`**,
  owned by R-BTN-75 beside `baton.capability-missing`
  ([§6.2](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-2), with §6.6's gates): a leg
  posted `ready` for a threshold during which at least one live runner granted on the repository
  asked and every one that asked was refused it, its `detail` the rule codes, most frequent
  first. To know that, Baton records, per ready leg, the gate that excluded it from each
  untargeted claim (a claim naming no ticket, R-BTN-100) — a counter per rule code, reset when
  the leg is claimed or leaves `ready`. With **no** asker it does not raise: that is the repository condition below.
- **"A ticket runs out of retries for a leg"** is `baton.retries`'s hold (R-BTN-122, R-BTN-163).
- **"All work is blocked from a runner."** The nearest condition today is `baton.blocked-ends`
  (R-BTN-126): more than 20 `released:blocked` ends across tickets in 24 hours. It does not see a
  runner whose claims are refused, nor one whose legs fail fast: the 2026-11-21 churn ended
  `cannot-finish:transient`, not blocked. It needs a new runner condition,
  **`baton.runner-starved`**, owned by the runner's rules ([§8.3](../BATON_SPEC/08-runners.md#sec-8-3)):
  a live runner whose claims received only refusals for a threshold while its granted
  repositories had legs posted `ready`, its `detail` the rule codes those claims received. The
  2026-11-21 case was `awaiting-sync` — claim rule 1's snapshot clause
  ([§6.6](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-6),
  [R-BTN-10](../BATON_SPEC/09-claims.md#sec-9-6)), which no runner can clear.
- **And a repository with nobody to ask:** legs posted `ready` while no runner granted on the
  repository is live raises nothing today. A repository condition, **`baton.no-runner`** (owned
  with `baton.unclaimable` by R-BTN-75), would.

## The design

### Who drives: two kinds of intervention

Who drives an intervention is decided by the credential its session acts with, never by the
channel ([human intent and autonomy](../../docs/context/human-intent.mdx) §1): MCP serves both
kinds.

| | Agent-driven | Human-driven |
|---|---|---|
| **Its session** | the leg form; or an agent over MCP with an agent-driven key | a person's own agent over MCP, with the person's interactive grant, or the person's own CLI |
| **Its key** | the intervention key below, minted for the intervention, scoped to its subject, dying with it | the person's own credential; Baton mints nothing for the intervention |
| **What it may do** | read and tighten; everything else is a [request](#requests) | whatever the person's role admits at the proof the credential carries, directly |
| **Its acts are recorded** | as `intervention:<id>` | as the person's, each tagged with the intervention's id, so the intervention's page and the subject's history list them together |
| **Confirmation** | each request by an approver of the act, on Baton's page, reached from the page or a delivery channel's link | none: the person is driving |
| **Claims** | the leg form holds its own ticket's claim | the session claim on its own ticket; it never takes a claim another holds |

Everything else is shared: the entry it starts from, one intervention per subject and takeover,
the warning at the start, the intervention ticket as its record, reports and the end. The
read-only tail after an entry closes binds the agent-driven kind's key; a human-driven
intervention's acts stop being tagged to it when it ends, and the person's credential is
otherwise untouched. The
sections below are written for the agent-driven kind; where they constrain the session's powers —
[the intervention key](#the-intervention-key), [requests](#requests), a batch's confirmation —
they do not apply to a human-driven one. A policy may require a stronger proof for some acts (a
`human_only` or hardware key): that is the policy's per action, and an act without it is refused,
not turned into a request. The reach this gives an injected instruction in a human-driven session
is an accepted risk ([human intent](../../docs/context/human-intent.mdx) §5; its narrowing is in
the [hardening proposal](hardening.md)).

### The parts

| Part | What it is | Where it lives |
|---|---|---|
| **The intervention** | Baton's record: entry, subject, starter, claimant, course, key, requests, reports, lifetime | Baton (`interventions`, filter fields only) |
| **The intervention ticket** | the work's record and the claimable unit | the ticket source, on the repository's intervention course |
| **The intervention key** | a delegated key for one subject, `bint_…` | its hash in Baton; the secret in the runner process, or the person's agent configuration |
| **A request** | an act the key may not take, pinned to the state it saw, for an approver | Baton (`intervention_requests`) |
| **A report** | a pointer to what the session wrote | Baton holds the pointer; the text is at the forge or in the leg archive |

### The entry it starts from

Every intervention names its entry as `entry_kind` and `entry_ref`, and the entry's close decides
the [tail](#ending):

| `entry_kind` | `entry_ref` | Closes when | What the intervention may do |
|---|---|---|---|
| `condition` | the condition id | the condition closes (R-BTN-160's table) | the subject's powers and requests |
| `person-leg` | ticket and leg | the leg is answered or expires (R-BTN-116) | diagnose only: the answer stays the person's, and the key never answers it (R-BTN-186) |
| `finding` | the §12.9 finding | an owner resolves it (`scope-resolved`) | diagnose only: no request; the acknowledgement stays the owner's |

A security condition (`baton.oauth-replay`, `baton.sign-in-burst`, `baton.admin-key-conflict`,
`baton.bearer-over-http` and their kind) is a `condition` entry, but
diagnose-only as a finding is. Tenant-level conditions take no intervention: the subject is always
within one repository.

### Starting one

On a Needs-you entry the dashboard draws **Start an intervention**: the registry action
`intervention.start`, whose `ui.view` names `repository/conditions/{condition}`, drawn only where
`condition.show`'s `allowed` names it (built; the control is B-207's). The person chooses:

1. **the subject** the entry names — a ticket, a runner, or the repository (for a repository
   entry such as `baton.no-runner` or `baton.queue-over`) — or the **batch** of every open ticket
   entry of its type and cause ([Batches](#batches));
2. **the agent**: a **sandboxed leg** ([The leg form](#the-leg-form)), naming the runner that will
   claim it or leaving it to any runner whose grant carries the mark `intervener`; or **an
   existing agent over MCP** ([The MCP form](#the-mcp-form)).

There is no powers menu: what the key may do is fixed by the subject's kind (below); everything
else is a request.

- **Who starts, by path.** Starting mints a credential, so it is an `approvers.members` act
  (R-BTN-188), as minting an MCP key is.

  | Path | Starter | `starter_role` | `starter_human_only` |
  |---|---|---|---|
  | `baton owner intervention start`, signed by an owner key | that key | `owner` | false |
  | the same, signed by a `human_only` owner key, or a break-glass `BATON_HUMAN_KEYS` line acting on the owner's routes (§12.1) | that key | `owner` | true |
  | an owner's dashboard session (proposed, B-76): a confirmed action, its code confirmed with the session's minting key | the session's key | `owner` | false |
  | an administrator's dashboard session, under `emergency` only ([Emergencies](#emergencies)) | the session's administrator key | `administrator` | false |

  An administrator key signs no `/v1/owner/*` route (§12.1), so an administrator starts only from
  a session. Where `approvers.members` is human-only (`protected`), no session satisfies it
  (R-BTN-185): only the second row starts one. `emergency` from anyone but an administrator's
  session is `invalid-params`.
- **The warning, on every path.** Before the start is sent, the page shows — and the CLI prints —
  "A fresh agent session is strongly advised: one that holds no owner key and no owner forge
  credential. This agent will read text anyone who can push wrote; an injected instruction acts
  with everything its session holds, not only this key (reach 3)." The page needs the box ticked;
  the CLI needs `I understand` typed (no `--yes`). The record keeps `warning_ack_at`.
- **One per subject.** A start whose subject — or, for a batch, any listed ticket — has an open
  intervention is refused `conflict`, naming it. A **takeover** is explicit: `takeover: <id>` on
  the start, confirmed by the open intervention's starter or by an approver on
  `approvers.members`; the old intervention ends `taken-over` first ([Ending](#ending)). Nothing
  ends one silently.
- **The claimant is checked at start, too.** A start naming as claimant the subject runner, or a
  runner that ran one of the subject's failed attempts in the last 24 hours (by fingerprint and
  host), is refused `invalid-params`, as the gate would refuse its claim.
- **What it writes, in one transaction:** the `interventions` row, with the intervention course
  in force (`course_id`) and the claimant; the entry's link to it (the entry shows "being handled
  by intervention `<id>`, started by `<starter>`"); the outbox entry that files the ticket ([The
  intervention ticket](#the-intervention-ticket)); and an `intervention {id, act: started}` event
  in the subject's history.
- **The subject's history** is the ticket's history for a ticket subject and each listed
  ticket's for a batch, the runner's events (`/runners/{runner}`) for a runner subject, and the
  repository's events for a repository subject.

### The intervention ticket

- **Filed through the outbox.** Baton files no ticket of its own (R-BTN-163) and holds no git
  credential (architecture: one outbound path). The start queues an outbox entry of a new kind,
  `intervention` (below), which a deliverer writes through the source's `file(ticket)` export
  (R-BTN-74), as a handler ticket is written.
- **Its id** is one Baton names, never a scan (R-BTN-199): the subject ticket's local id, `.i`,
  and Baton's count of interventions on it (`B-166.i1`); `i<intervention id>` for a runner or
  batch subject, and whenever the first form would break the ticket-id rule's 64 characters. Ids
  ending `.i<n>` or of the form `i<n>` are reserved as the handler ids are.
- **Its file holds ids only:** `course` (Baton's `course_id`), `intervenes: {id, entry_kind,
  entry_ref, subject, agent}` and `baton_write: <outbox id>`. No condition text, no detail, no
  title from the subject. What the session needs to know about the entry it reads from
  `intervention_context` ([The key](#the-intervention-key)), whose result is labelled data, and
  the course's instructions say so.
- **The course is the repository's.** The owner setting `intervention_courses: {leg?, mcp?}`
  (an R-BTN-66 setting) names the course for each form; Baton reads only the ids, and the
  courses' stations and instructions are course code. Every change to it, in either direction, is
  a loosening (it chooses the code an intervention's key-holding leg runs), so an
  `approvers.policy` act (R-BTN-186). A start with no course for its form is refused
  `invalid-params`. A template may ship in `src/defaults/` beside the standard courses, adopted
  like them.
- **The outbox kind `intervention`** (a row for [R-BTN-171's table](conditions.md#8-the-outbox)):

  | Class | Delivers | Order | Confirmed when | Late |
  |---|---|---|---|---|
  | `git` on the markdown source; `source` on a custom one | the intervention ticket, through `file(ticket)` | a log, per intervention | a snapshot posts the ticket at its reserved id with `course`, `intervenes` and `baton_write` equal to Baton's row | not confirmed 15 minutes after it was queued: `baton.outbox-late` |

  - **Idempotence.** The deliverer reads the reserved path at the fresh head: a file carrying the
    entry's `baton_write` is delivered already; **any other file at that id is a conflict**: the
    deliverer reports it, the entry becomes `dropped` (never `failed`, so it is not queued
    again), the intervention ends `file-conflict`, and `baton.intervention-mismatch` names it.
    Nothing overwrites the file. R-BTN-171's `outbox-refused` hold applies to no ticket here: the
    intervention ticket is not on the board, and the subject is not the entry's ticket; a
    `refused` mark (the deliverer's credential refused) holds nothing and raises
    `baton.outbox-late`.
  - **A mismatch.** While the posted ticket's `course`, `intervenes` or `baton_write` differ from
    Baton's row, or the snapshot's `extra: true` flag says the file carries a body or a field
    beyond those (the markdown source sets it; a custom source must), the ticket's legs are
    refused (rule `intervention`) and `baton.intervention-mismatch` is raised on the subject
    ticket, or on the repository for a runner, batch or repository subject; the intervention
    ends at expiry unless the file is restored. Beyond that check, the leg form's runner and the
    course read only `intervention_context`, never the ticket's body.
  - **Who can deliver it.** On the markdown source, any `git` deliverer; under `protected`,
    `tickets.created: proposed` makes it a proposal that lands only when a human lands it. A custom source needs an
    `outbox.source` deliverer, which `protected` admits none of — and R-BTN-188 already refuses a
    policy with an ejected source and none. So under `protected`, or whenever the deliverer, the
    sync or the runners are the broken part, the leg form waits, and **the MCP form is the path**:
    its key works from the confirmed start, without the ticket.
- **What closes it.** The leg form's course ends it (its leg's last outcome is an end station).
  At the intervention's end, a ticket still open is superseded under R-BTN-168, with "its
  intervention ended" as a new supersession cause: a running claim gets `release` with reason
  `superseded`, the ticket goes `cancelling`, and R-BTN-171's `withdraw` entry withdraws it with
  reason `intervention-ended`. An MCP-form ticket always closes that way.

### The intervention key

A delegated key in R-BTN-186's sense, minted per intervention and dying with it.

- **Principal and scope.** It authorizes as a new principal, `intervention`, with a new scope,
  `subject`: the intervention's subject and what it references (R-BTN-129), and `own` stretched
  to its own intervention's requests and reports. An action admits
  `{principal: "intervention", scope: "subject"}` only where its `delegated` mark (people and
  dashboard §1) is `true` or `own` and the table below lists it. The actions on its own
  intervention (`intervention.context`, `.request`, `.report`) carry a mark of their own,
  `delegated: "intervention"`, which `check:actions` exempts from R-BTN-186's derivation and
  admits for no MCP key. The table below is a machine-readable allowlist in the registry
  (`src/shared/actions.mjs`, `interventionPowers: {ticket, runner, batch, repository}`, each a list
  of action ids); `check:actions` fails an `intervention` caller on any entry whose `delegated`
  mark is `false`, and on any entry that no list of the allowlist names.
- **Its own powers, by subject** — always within `interventions.repository`:

  | Subject | Reads | Tightens (and undoes its own) |
  |---|---|---|
  | ticket | the ticket and what it references: history, blocks, attempts, conditions, claims, leg runs without their session links, attestations | hold it (`ticket.hold`), lift a hold it set (`ticket.unhold`, `own`), stop its running leg (`leg.stop`) |
  | runner | the runner's heartbeats, declared capabilities, reports, messages, claims and leg runs on this repository only | stop a leg it runs on this repository (`leg.stop`) |
  | batch | each listed ticket as the ticket row reads it, and no other ticket | the ticket row's, on each listed ticket only |
  | repository | the repository's reads: board, blocks, conditions, tickets' histories, the runners granted there, bars, the policy as `repo.policy` serves it | nothing: requests only |

  Every key also calls `intervention.context` (the entry, the subject, the powers and the warning,
  as data), `intervention.request` and `intervention.report`. It never reads a session link
  (`session_url: null`, `session_link: true`, once B-312 lands), log bytes (`leg.runs` returns
  pointers), another subject, credentials, grants, keys or owner settings.
- **Everything else is a request** ([Requests](#requests)): a restart, an unhold of another's
  hold, expedite, route (R-BTN-83, proposed), adopt ([ticket adopt](ticket-adopt.md)), a sync want
  (R-BTN-105), a status request (§6.9), a drain (the existing §6.9 `wind-down`, requested only
  where every repository the runner holds claims on is this one), and cancel. R-BTN-186 lets a
  delegated key cancel; the intervention key is deliberately narrower, since a cancel is
  destructive and not undone by the key that made it.
- **Restarts are always requests.** R-BTN-186's "never resolves a condition" stands whole: no
  restart is the key's, not even one that would not loosen.
- **The record of its acts.** Its actor is `intervention:<id>` in history, events and release
  messages, with — in the leg form — the relaying runner and claim beside it; a hold it sets
  records `set_by` `intervention:<id>` and `hold_reason: intervention:<id>` (R-BTN-12), and the
  `own` test is on the id, as for an MCP key's `mcp:<id>`. The row carries the starter's
  fingerprint and role and the agent's kind: `leg` with the executor's harness, or `mcp` with the
  client's self-declared `clientInfo.name`, checked as §12.3's untrusted text (at most 64
  characters, printable, shown escaped).
- **The secret.** `bint_` and 32 random bytes in base32, stored only as its hash and compared in
  constant time (§12.1's bearer secrets), accepted only on `POST /v1/mcp` (an [open
  decision](#open-decisions) asks whether HTTP too). It is shown in **exactly one place**: the
  claim answer (leg form), or the surface that made the start (MCP form: the page, or the CLI),
  once. Crossing `http` revokes it (R-BTN-158). It is never written to git — an agent's
  `.mcp.json` in a checkout is a control path (R-BTN-184) — only to the person's user-scope agent
  configuration or an environment variable; where it reaches a runner, R-BTN-144 masks it, and so
  the leg archive does (R-FH-82 masks as R-BTN-144 does).

### Requests

- **Filing.** `intervention.request {action, targets, params, report?}`: `action` a registry id
  (or `pr.merge`, below), `targets` within the subject, `params` identifiers only (§12.3),
  `report` the pointer the agent cites. Baton checks the action, the targets and the bounds, and
  stores the row `pending` with **the state each target was in**: the condition id and its
  `outcome`; the hold's `set_by` and `hold_reason`; the station and queued leg; for a PR, its head
  SHA and head repository. It answers `{request, state: "pending"}`, never a code.
- **Bounds.** At most 10 pending per intervention and 30 filed per hour; a pending request with
  the same action and targets is `conflict`. A request to act on a target with an open §12.9
  finding, or a hold a security finding set (`scope_policy: hold`), is refused at filing and at
  confirming. A request expires after 1 hour, and at the intervention's end.
- **Who hears of it.** Baton notifies nobody itself: the request is listed on the intervention's
  page and counted on its entry, and `repo.needs-you`'s `listings` gains `intervention_requests`,
  which a delivery runner may send (R-BTN-163's delivery runners).
- **Confirming.** The intervention's page (the screen `repository/interventions/{intervention}`)
  draws each pending request with every param, a statement of its effect that Baton words from
  the action and the pinned state ("lifts the hold `attempts-exhausted` set by Baton on B-8; its
  attempt count resets"), and the agent's pointer as a link labelled **agent-written**.
  **Confirm** is `intervention.request.confirm {request, pins_hash}`, `pins_hash` the hash of the
  pinned states the page drew:
  - it refuses `conflict` when any target's state differs from the pinned one, or `pins_hash` is
    not the stored request's;
  - it then runs `authorize(session, <requested action>, target)`: the confirmer must be a caller
    the requested action admits — an unhold of another's hold an approver on `approvers.policy`
    (R-BTN-186), a restart an owner or an administrator (R-BTN-163), an adopt `approvers.policy`
    (R-BTN-188);
  - it takes what §3's table says that action takes from a session: an unhold or an expedite the
    code, bound to the request's id and `pins_hash`; a restart nothing more. The act is the
    confirmer's, recorded with `requested_by: intervention:<id>`.

  **Deny** closes the request. Both are `delegated: false`, and no `intervention` or delegated
  principal is among their callers; `check:actions` fails an entry that admits one.
- **Under a human-only list** no session confirms (R-BTN-185): the page names the CLI command and
  the request id for a `human_only` key; the command prints the same effect statement and pins.
- **A merge is informational.** `action: "pr.merge"` names no registry action: its `targets` name
  one PR of the subject's own — its head repository the home, its head branch matching the
  repository's branch pattern for the subject ticket — pinned to its head SHA. An owner or
  administrator session **acknowledges** it; the acknowledgement is recorded and links the PR. It
  writes no attestation, and nothing the merge runner reads takes it. The merge is a person's at
  the forge, or, in a Fieldhouse stage-2 home, the merge runner's through the subject's own merge
  leg (R-FH-94) once the subject moves on. The key never merges.

### The leg form

- **Who claims: one gate.** A new gate, rule `intervention` (§6.6), admits a claim of a leg of
  `interventions.ticket_id` only from the runner `interventions.claimant` names, by key
  fingerprint, or — where the claimant is `intervener` — from a runner whose grant admits the
  capability `intervener` (R-BTN-174); every other runner
  is refused, whatever the ticket file says. It always refuses the subject runner, and every
  runner that ran one of the subject ticket's failed attempts in the last 24 hours, matched by key
  fingerprint and by hostname. It refuses all of them while the posted ticket mismatches Baton's
  row (above).
- **The key stays in the runner process.** Baton mints the key only for a granted claim of
  `interventions.ticket_id` whose posted course is `interventions.course_id`, and returns it once
  in the claim answer (`intervention: {id, key}`); a later claim mints a new one and revokes the
  old. The runner holds it in memory as R-BTN-144 holds its own credentials and never puts it in
  the leg's environment, files or sandbox (Fieldhouse's Axiom 6: credentials never cross
  downward). The leg reaches Baton through its channel (`BATON_SOCKET`, R-BTN-106) with in-leg
  verbs of the `leg` noun — `baton leg context`, `baton leg request`, `baton leg report` — and the
  subject reads; the runner relays only the tools the key's `tools/list` names, as `tools/call`
  with the key, and refuses anything else on the channel.
- **What it reads.** Baton, through the key, and the forge, through the gate (R-FH-90) or, in
  stage 1, the runner's own credential. Not the leg archive and not the runner's logs: those are
  host data (R-FH-82); a subject-scoped masked export of them is future work.
- **What it writes.** Only its own ticket: its branch and its PR, as any leg writes its ticket's
  (separate tickets never share a write target). It never writes the subject's branch; on the
  subject it diagnoses and reports. On a stage-2 host its gate profile is the default `write`,
  whose grant branches are the intervention ticket's; its `comment` permission reaches only its
  own grant PRs (R-FH-93), so a comment on the subject's PR is an [open
  decision](#open-decisions). A fix under `.github/` cannot be pushed through the gate at all
  (R-FH-92): the session puts the diff in a report for a person.
- **A joinable session.** The leg is joinable (R-FH-80), so it needs a deadline on its run
  (R-BTN-167, R-BTN-195; the course file's key is `max_duration`), at most the intervention's
  remaining lifetime; a start whose course leg has none is refused, and so is a claim: the row
  pins the course's version at start (`course_version`), and rule `intervention` refuses a claim
  of a ticket whose posted course version differs or whose leg lost its deadline. Its session link is served as
  B-312 serves every link: to dashboard sessions — the starter's among them — and to the reporting
  runner; never to the intervention key.
- **In stage 1**, before the gate, the runner's forge credential is unbounded for the leg as for
  every leg: what it does at the forge is an outside actor's (values #13), which Baton detects
  (R-BTN-203) and does not prevent.

### The MCP form

- **No ticket to wait for.** The key works from the confirmed start; the ticket, filed in
  parallel, is the record, and nothing claims it.
- **Getting the key.** With a bearer-capable client, the surface that made the start shows the
  `bint_` key once, with the command that adds it to the agent's user-scope configuration (never
  a checkout's `.mcp.json`). A **CLI start** has no session, so it offers the bearer key only; an
  agent that needs OAuth is started from a session.
- **Over OAuth** (a session's start only). The start shows, instead of the key, a one-time
  **pairing code**; Baton keeps only its hash (`pairing_hash`). The client runs
  BATON_MCP_OAUTH_SPEC's flow unchanged up to consent: it requests the challenge's scope (OAuth
  §2), and nothing secret travels in the authorize URL, `oauth_requests.requested`, the requests
  answer or the token response. On the consent page, inside the session that started the
  intervention (any other session is `not-found`), the person picks that open MCP-form
  intervention — or enters its pairing code — and the page shows the client and its redirect
  host. The grant's repository and actions are the intervention's, fixed: no repository picker,
  no ticks. Approval consumes the pairing; at most one grant per intervention. The grant's scope,
  as the token response names it, is `intervention:<id>`; its parent row is the `interventions`
  row, not `mcp_keys`, and its access and refresh tokens die when the intervention ends.
- **What the agent sees.** MCP's methods stay people and dashboard §2's (`initialize`, `ping`,
  `tools/list`, `tools/call`): `tools/list` is the key's actions, and the context comes as the
  result of the tool `intervention_context`, not as a prompt or a resource, which §2 does not
  serve.
- **Its forge access is its own.** Baton neither gives nor limits it: what the agent does at the
  forge — pushes, comments, a merge — is an outside actor's, unattributed in Baton and detectable
  only as an outside move (R-BTN-203). The `pr.merge` request is how a session that behaves asks
  for one.

### Emergencies

An administrator's session starts an intervention only with `emergency: {reason}`, `reason` one of
`no-owner-reachable` or `owner-locked-out`.

- It is still an `approvers.members` act: an administrator matches an `owner` entry and no other
  (R-BTN-188), so under a human-only list an administrator starts none.
- It is logged as an `admin` event, and raises `baton.intervention-emergency` (`notify`) on the
  repository, which stays under Needs you until an owner acknowledges it, even after the
  intervention has ended: `intervention.emergency.ack`, keyed by the condition —
  `POST /v1/owner/{repository}/conditions/{condition}/emergency-ack`, `baton owner intervention ack
  <repository> <condition>`, or an owner's session on the condition's page.
- A second emergency start on the repository within 24 hours of the first is held pending
  (`202 {pending}`) until an `approvers.members` approver confirms it with
  `intervention.emergency.confirm` (`POST /v1/owner/{repository}/interventions/{id}/emergency-confirm`,
  or an owner's session); unconfirmed for 30 minutes, it lapses and nothing is minted. Slowing
  repeats is deliberate: an administrator who needs a third emergency within a day needs an
  owner's word anyway.
- Its requests are confirmed as any other's — by a caller the requested action admits.

### Batches

- **Start.** From a ticket entry of type T, **Start on all like this** lists every open ticket
  entry of type T whose cause matches — for `baton.retries` the same `hold_reason` and
  `last_error_type`; for another type its `detail`'s reason — at most 100. Runner and repository
  entries take no batch. The person reviews the list and ticks tickets; none is ticked by default.
  The subject kind is `batch`, with the ticked tickets on the record.
- **Diagnose once, settle each.** The key holds the ticket row's powers on each listed ticket and
  no other. A request may name several listed targets, each with its own pinned state; the page
  draws each target with its pin and effect, unticked; one confirmation applies to the ticked
  ones. A batch confirmation **always** takes the code, even for an action that alone would not
  (a restart), bound to the hash of the ticked set and its pins, and `dry_run` prints every
  target. Each
  target is a separate act in its ticket's history, authorized on its own; a target whose state
  moved is refused alone, `conflict`, and the rest go ahead. A ticket whose entry closed drops
  out.

### Reports

A report is a pointer, never prose (R-BTN-33): `intervention.report {url}`, a forge comment or PR
URL under R-BTN-92's link rule, or a leg archive path under its run. The entry and the
intervention page link them, labelled agent-written. What the session concluded lives where the
pointer leads.

### Ending

- **Ends** when anyone may tighten ends it — any owner of the repository, an owner's or an
  administrator's session, an administrator (`intervention.end`); at its expiry; when the
  intervention ticket closes; on a takeover; on a ticket-file conflict; or when the starter's key
  stops owning the repository (an administrator's: leaves `BATON_ADMIN_KEYS`; a break-glass
  line's: leaves `BATON_HUMAN_KEYS`), `starter-lost`.
- **Extending** is the starter's, a confirmed action (the code), within the maximum.
- **When its entry closes** it keeps a read-only tail of 30 minutes: it reads and records reports,
  but tightens nothing, lifts nothing (not even its own holds) and files no request, then ends
  `entry-closed`. The same cause raised again during the tail opens a fresh entry, never this
  intervention's. A batch's tail starts when its last listed entry closes.
- **At the end, in one transaction:** the key and every OAuth token of it are revoked; pending
  requests expire; the ticket, if open, is superseded and withdrawn (above), which releases its
  claim; a hold the key set stands
  and is listed on the subject as the intervention's, for an owner to keep or lift; an
  `intervention {id, act: ended, end}` event is logged.

### Sketch: data, actions, routes

Concrete enough to build from; the open items are marked.

- **Lifetimes** (their one home): default 2 hours, at most 24 counted from the start; an
  emergency at most 2 hours and never extended. In the leg form the working clock starts at the
  claim, never past the 24 hours; a ticket not filed (its outbox entry confirmed) within 1 hour of
  the start ends the intervention `unfiled`, and one not claimed within 1 hour of its filing ends
  it `unclaimed`. In the MCP form the clock starts at the confirmed start.
- **`interventions`**: `repository`, `id` (an integer per repository, never reused), `ticket_id`,
  `course_id`, `entry_kind`, `entry_ref`, `batch_type`, `subject_kind` (`ticket` | `runner` |
  `batch`), `subject_ref`, `agent` (`leg` | `mcp`), `agent_kind`, `claimant`
  (`key:<fingerprint>` | `intervener`), `starter_fingerprint`, `starter_role` (`owner` |
  `administrator`), `starter_human_only`, `emergency_reason`, `key_hash`, `pairing_hash`,
  `oauth_client_id`, `course_version`, `warning_ack_at`, `started_at`, `expires_at`, `tail_until`, `ended_at`,
  `end` (`ended` | `expired` | `unfiled` | `unclaimed` | `ticket-closed` | `entry-closed` | `taken-over` |
  `file-conflict` | `starter-lost`). Batch tickets: `intervention_subjects (repository,
  intervention, ticket_id)`. Filter fields only.
- **`intervention_requests`**: `intervention`, `n`, `pins_hash`, `action`, `targets_json`
  (identifiers, each with its pinned state), `params_json` (identifiers), `report_n`, `state`
  (`pending` | `confirmed` | `denied` | `expired`), `filed_at`, `decided_by`, `decided_at`.
  **`intervention_reports`**: `intervention`, `n`, `url`, `at`.
- **Actions** (R-BTN-127's nouns):

  | Id | Callers | Route | Effect |
  |---|---|---|---|
  | `intervention.start` | owner (`approvers.members`); session, confirmed; an administrator's session under `emergency` | `POST /v1/owner/{repository}/interventions`; `POST /v1/ui/interventions` | write |
  | `intervention.list`, `intervention.get` | the repository's readers | `GET /v1/repositories/{repository}/interventions[/{id}]` | read |
  | `intervention.context`, `intervention.request`, `intervention.report` | intervention, `own` | MCP tools; an HTTP route is open | read; write; write |
  | `intervention.request.confirm`, `intervention.request.deny` | session, or a key, authorized as the requested action; never `intervention` or delegated | `POST /v1/ui/interventions/{id}/requests/{n}/confirm \| deny`; `baton owner intervention confirm \| deny` | write |
  | `intervention.end` | any owner, session or administrator | `POST /v1/ui/interventions/{id}/end`; `POST /v1/owner/{repository}/interventions/{id}/end` | write |
  | `intervention.extend` | the starter, confirmed | `POST /v1/ui/interventions/{id}/extend`; `baton owner intervention extend` | write |
  | `intervention.emergency.ack` | an owner, or an owner's session | `POST /v1/owner/{repository}/conditions/{condition}/emergency-ack`; `baton owner intervention ack` | write |
  | `intervention.emergency.confirm` | an `approvers.members` approver, or an owner's session | `POST /v1/owner/{repository}/interventions/{id}/emergency-confirm` | write |

## Security

- **Reach 3.** The session reads ticket text, leg output and PR bodies, which anyone who can push
  writes ([security model](../../docs/security-model.mdx), *Authority and data*). Everything it
  reads is data; the ticket it is given holds ids only. The key reaches one subject in one
  repository and only tightens; what an injected instruction can do with it is hold, stop or
  bar, all undoable, and file a bounded number of requests that a person reads, worded by Baton
  and pinned to what the agent saw. What the agent holds besides the key is the MCP form's
  residual risk, which the owner accepted and the warning names.
- **Nothing in a file decides who holds the key.** The claimant, the course and the ticket id are
  Baton's row; a push that edits the ticket stops the leg form, it does not redirect it.
- **No code reaches the agent.** A request answers `pending`; a confirmation happens on the
  approver's page and, where §3 asks for a code, with the approver's own key, bound to that
  request's id and pins.
- **Forge acts outside Baton are not Baton's to bound.** In stage 1 and on the MCP path they are
  an outside actor's (values #13); in stage 2 the gate gives the leg no merge and no write to
  another ticket's branch (R-FH-92–94).

## Evidence: 2026-11-21

Each row is an entry of [`docs/interventions.mdx`](../../docs/interventions.mdx); the rows from
PR #327 (open) are named by their exact titles.

| Entry | What an intervention does |
|---|---|
| [06:36 — bering's legs cannot reach the Fieldhouse gateway; the runners stopped](../../docs/interventions.mdx#2026-11-21-0636--berings-legs-cannot-reach-the-fieldhouse-gateway-the-runners-stopped): the churn | Runner subject: request a `wind-down` of each runner; the cause, the host's firewall rule, is diagnosed and reported with the exact fix for a person |
| the same entry: after the restart, 39 tickets refused `awaiting-sync` | `baton.runner-starved` would name it; the session requests a sync want (R-BTN-105) |
| PR #327, "08:00 — 31 `attempts-exhausted` holds lifted by a console script" | The batch case: one batch over the 31 `baton.retries` with the same cause, diagnose once, request `retry` for each, one confirmation over the reviewed list (decision 4) |
| [07:45 — implement agents stop on CLAUDE.md's credential rule: legs fail with no PR](../../docs/interventions.mdx#2026-11-21-0745--implement-agents-stop-on-claudemds-credential-rule-legs-fail-with-no-pr) | Diagnose and report; the rule is the owner's to change |
| PR #327, "12:45 — this repository's `create-pr` course and sync CLI were pinned before B-257" | A CI workflow: diagnose, put the diff in a report; a person lands it (the gate refuses `.github/`, R-FH-92) |
| PR #327, "13:58 and 18:35 — bering's executor re-pinned twice (fieldhouse #45, #44)" | Host and deployment: diagnose, report |
| PR #327, "16:56–18:35 — runners idle after a drain; the live check's sandboxes left running" | No runner was live, so neither `baton.unclaimable` (it needs an asker) nor `baton.runner-starved` raises; `baton.no-runner` would, and a repository-subject intervention on it reads, diagnoses and requests (a sync want; the runners' restart is the host's). The sandboxes are host state: diagnose, report |

Two gaps the day shows: **31 holds wanted one act** — decision 4's batch; and **the gateway
churn and the credential stops raised no Needs-you entry** — each was a run of failed attempts,
visible only once holds landed. An intervention starts from an entry, so those need entries of
their own before an intervention can reach them. B-247 turns the gateway churn into a block (the
runner stops claiming legs that need the capability), not a Needs-you condition; *no ticket yet*
for a condition.

## Amends

What building this changes, each in its owning place:

- **[Human intent and autonomy](../../docs/context/human-intent.mdx)** (2026-11-26) is the
  ground for the split by driver: R-BTN-186's tighten-only powers bind agent-driven delegated keys,
  the intervention key among them, and not a person's interactive grant.
- **A new R-BTN-n (interventions), §7.3**: the whole of [The design](#the-design), with
  `baton.intervention-emergency` and `baton.intervention-mismatch`.
- **R-BTN-75 (§6.2)**: `baton.unclaimable` and `baton.no-runner`. **§8.3**: `baton.runner-starved`.
- **R-BTN-186 (§12.8)**: its definition "a delegated key (an MCP key, R-BTN-130)" names the
  intervention key too; its powers do not change. **People and dashboard §1**: "a delegated key is
  no principal of its own" gains the `intervention` principal; the `delegated: "intervention"`
  mark and `check:actions`' two checks. **The vocabulary**'s "Delegated key" ("An MCP key: …")
  likewise, and "intervention" lands as a core word (spec-writing, rule 7).
- **R-BTN-129 (§11.3)**: the principal `intervention`, the scope `subject`, and `own` covering an
  intervention's own requests and reports.
- **R-BTN-127**: `baton owner intervention start | end | extend | confirm | deny`, `baton
  intervention list | show`, and the in-leg `baton leg context | request | report`.
- **R-BTN-106**: the runner's relay of an intervention leg's verbs with the key, its allowlist.
- **R-BTN-130 and people and dashboard §2**: the intervention key accepted on `POST /v1/mcp`;
  §2's "an administrator … signs no `/v1/owner/*` route … and mints none" amended so an
  administrator's emergency start, from a session, mints an intervention key.
- **People and dashboard §3**: the table's rows for `intervention.start` and
  `intervention.extend` (the code); `intervention.request.confirm` (what the requested action
  takes, bound to the request's id and `pins_hash`); and a batch confirmation (always the code,
  bound to the ticked set's hash). **§4, and §11.4's screens table (R-BTN-155)**: the screen
  `repository/interventions/{intervention}`, and the Conditions entry's control.
- **BATON_MCP_OAUTH_SPEC §4** (no change to the request: no intervention parameter and no scope
  token), **§5** (the pairing step: in the starting session, pick the open MCP-form intervention
  or enter its pairing code; the grant's repository and actions fixed; "an administrator's
  session is `forbidden`" amended for an emergency, whose grant dies with the intervention rather
  than with an owner key), **§7 and §8** (an intervention grant is not an MCP key; its scope is
  `intervention:<id>`; its tokens end with the intervention), **§12**
  (`oauth_requests.intervention`, the grant's parent row `interventions`).
- **R-BTN-163 (§7.3)**: a Needs-you entry carries its open intervention; "Baton files no ticket
  for it" gains the intervention ticket filed through the outbox; `repo.needs-you`'s `listings`
  gains `intervention_requests`.
- **R-BTN-161** ([conditions §2](conditions.md#2-handlers)): intervention tickets beside handler
  tickets — the reserved ids `.i<n>` and `i<n>`, the `intervenes` block — filed by a deliverer.
- **R-BTN-171** ([conditions §8](conditions.md#8-the-outbox)): the outbox kind `intervention`,
  and `withdraw`'s reason `intervention-ended`. **R-BTN-168** (conditions §7): "its intervention
  ended" as a supersession cause.
- **R-BTN-160's close table (§7.1)**: rows for `baton.intervention-emergency` (closes at an
  owner's acknowledgement), `baton.intervention-mismatch` (when the posted file matches again, or
  the intervention ends), `baton.unclaimable` (when the leg is claimed or leaves `ready`),
  `baton.no-runner` (when a runner granted on the repository is live, or no leg is `ready`) and
  `baton.runner-starved` (at the runner's next granted claim, or when it is no longer live).
- **The snapshot (R-BTN-74)**: the intervention ticket's `extra` flag.
- **R-BTN-12 (§6.8)**: `hold_reason` `intervention:<id>`. **§6.6**: the gate rule `intervention`.
  **R-BTN-174**: the capability `intervener`, which a grant admits. **R-BTN-66**: the setting
  `intervention_courses`.
- **§12.1 and R-BTN-158**: the principal's row; `bint_` among the bearer secrets and the bearers
  that crossing `http` revokes. **R-BTN-144**: the intervention key in the one list of what is
  masked.
- **R-BTN-113**, once B-312 has landed: the `intervention` principal among the readers served no
  session link.
- **§13 and §14**: the tables and routes of the [sketch](#sketch-data-actions-routes).
- **R-BTN-188's `approvers.members` row**: its list of what it governs names intervention keys
  beside MCP keys. No rule of R-BTN-188 changes.
- **Fieldhouse**: none. R-FH-82 masks as R-BTN-144 does; R-FH-92–94 are unchanged.

## Tests

Every behaviour change names its scenario (R-BTN-31). **Changed:** S-BTN-124 and G-BTN-144 (a
delegated key is an MCP key or an intervention key; the intervention key loosens nothing);
S-BTN-186 (the `intervention` principal, and confirm and deny refusing it); S-BTN-131 and
G-BTN-149 (Baton files the intervention ticket through the outbox); S-BTN-275 and S-BTN-276
(`allowed` names `intervention.start`; the entry carries its intervention; the new listing).
**New** `S-BTN-n`, taken when built:

- **Start**: refused without an `approvers.members` approver; a session's start takes the code;
  under a human-only list only a `human_only` key starts; `emergency` refused from anyone but an
  administrator's session; the warning's acknowledgement required on the page and the CLI; a
  second start on a subject `conflict`; a takeover's confirmation; refused with no
  `intervention_courses` entry for its form, and for a leg form whose leg has no deadline.
- **The intervention ticket and its outbox kind**: filed at its reserved id with ids only;
  confirmed by a matching snapshot; a foreign file at the id a conflict that ends the
  intervention; a pushed edit refusing the legs and raising `baton.intervention-mismatch`; late
  raising `baton.outbox-late`; a conflict `dropped`, not re-queued; the `extra` flag a mismatch;
  superseded and withdrawn at the end.
- **The gate rule `intervention`**: admits only the claimant's fingerprint, or an `intervener`
  grant; refuses the subject runner and runners of its failed attempts by fingerprint and host;
  the key minted only for a claim on the recorded course and version; a start naming such a
  claimant refused; the check:actions allowlist failing an unlisted or `false` entry.
- **The key**: reads only its subject in its repository (another `forbidden`, as unknown); no
  session link; tightens and undoes only its own; every other act, every restart and cancel
  included, `forbidden`; refused off `POST /v1/mcp`; the runner relays only the allowlist and
  keeps the key out of the leg's environment.
- **Requests**: filed `pending` with no code and the pinned state; bounded (10 pending, 30 an
  hour, duplicates `conflict`); refused on a target with a security finding or hold; `conflict`
  at confirm on a moved state or a stale `pins_hash`; confirmed only by a caller the requested
  action admits; expired after an hour and at the end; `pr.merge` refused for a PR outside the
  home or the subject's branch pattern, and writing no attestation.
- **Batches**: nothing ticked by default; the code always taken and bound to the ticked set; a moved target refused
  alone; reads limited to listed tickets; no batch from a runner entry.
- **Diagnose-only entries**: a person-leg, finding or security entry's intervention files no
  request. **The repository subject**: repository-wide reads, every act `forbidden` but requests.
- **Lifetimes and ending**: default and the 24-hour maximum from the start; `unfiled` after an
  hour; extend confirmed and bounded; an emergency not
  extended; the leg form's clock from the claim and `unclaimed` after an hour; any owner, session
  or administrator ends one; `starter-lost`; the tail lifts nothing and a reraise opens a fresh
  entry; the end revokes the key and tokens and releases the claim.
- **Emergencies**: `baton.intervention-emergency` raised, kept until an owner acknowledges it by
  the condition on each surface; a second within 24 hours pending until
  `intervention.emergency.confirm`, lapsing after 30 minutes with nothing minted.
- **The MCP form over OAuth**: consent outside the starting session `not-found`; a wrong or used
  pairing code refused; the grant's repository and actions the intervention's, with no picker;
  the token response's scope `intervention:<id>`, and no secret in the request, the requests
  answer or the token response; one grant per intervention; tokens dead with it; a CLI start
  offering only the bearer key.
- **Conditions**: `baton.unclaimable` raised only with an asker, and closed when the leg is
  claimed or no longer `ready`; `baton.no-runner` raised with no live runner and closed when one
  is live; `baton.runner-starved` raised from its claims' refusals and closed at its next granted
  claim.
- **Records**: actor `intervention:<id>`, with the relaying runner and claim, on every act;
  `agent_kind` bounded; reports stored as pointers only; no intervention row holds prose.

## Open decisions

1. The thresholds of `baton.unclaimable`, `baton.runner-starved` and `baton.no-runner`.
2. Whether the key is accepted only on `POST /v1/mcp`, making `intervention.context`, `request`
   and `report` MCP-only registry entries (a further R-BTN-129 amendment), or also on HTTP routes
   the leg form's runner calls.
3. Whether a stage-2 leg may comment on the subject's PR (a permission R-FH-93 lacks).
4. Whether a `wind-down` joins R-BTN-186's tightenings, so a runner-subject key drains directly.
5. Whether R-BTN-161 bindings may later start interventions with no person — for example a
   diagnose-only intervention on every `baton.retries`.
6. A subject-scoped, masked export of the leg archive and the runner's log for the leg form.
7. How a human-driven session's acts are tied to its intervention: a parameter on each call,
   or the person's MCP session bound to the intervention when it starts.

## Where to start when this is picked up

- Read R-BTN-160–163 and R-BTN-167 (§7), R-BTN-75 (§6.2), R-BTN-129/130 (§11.3),
  R-BTN-185/186/188 (§12.8), §12.9, people and dashboard §1–§4, the conditions proposal §2 and §8,
  BATON_MCP_OAUTH_SPEC §4–§8 and §12, B-312, values #3, #12 and #13, and Fieldhouse's R-FH-80,
  R-FH-82 and R-FH-90–94.
- The pieces it needs, roughly in order: B-312; the registry (B-25, B-124); owners' sessions and
  confirmed actions (B-76, B-207); the outbox (R-BTN-171); the MCP endpoint (B-25) and OAuth
  (B-73); then the new parts — the record and key, requests, the outbox kind, the gate rule and
  grant mark, the screen, the new conditions, and a course template.
