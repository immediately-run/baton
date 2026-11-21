---
title: "1. What Baton is"
description: "Baton hands out tickets to runners under fenced leases and shows the work's live state."
---
## 1. What Baton is *(proposal)*

Baton hands out **tickets** to **runners** under fenced leases and shows the work's live state.
Git is the ledger for the work's evidence and the ticket source holds the tickets; Baton's board
is a cache of both, rebuilt by each sync. Baton owns what no push may decide: claims and leases,
each ticket's course history and position, attestations, owner settings and grants. A ticket
follows a **course** whose logic is code in its home repository; Baton knows only the course's
contract (§5), runs no repository code (R-BTN-98) and writes no git itself (R-BTN-171). The
**runner** launches its leg processes, stops them and notices when they are stuck; **Baton**
collects information (the sync, readings, claims) and recommends legs. Nothing else supervises a
leg's process. One Baton is one tenant (§2).

**Names.** A **ticket** is the unit Baton hands out, `<repository id>:<local id>` to Baton
(R-BTN-47). A **course** is the process it follows: **stations**, where a ticket rests and a
hand-off is written, joined by **legs**, one step each (§5). A **claim** is a runner's lease
on one ticket, running its legs one at a time; a runner may hold several (§9, R-BTN-4). A
**suspension** ends a claim `suspended:<station>` (R-BTN-71). A **runner** is a process that
claims and runs legs (§8). The **sync** reads git and posts the repository's **board** (§4).
**Blocks** say why a leg cannot start (§6). **Conditions** are raised by legs or Baton and
resumed by a **restart** (§7). "Workflow" means only a CI workflow; "activity" only a record of
§9.

- **R-BTN-1 (one home per fact).** Each fact has one authoritative home; a copy elsewhere is
  derived and says so.

  | The ticket source (R-BTN-74) and git: the home repository, and the repositories and PRs its course reads | Baton |
  |---|---|
  | tickets: bodies, Status notes, ids, statuses, closure, tags | each live ticket's filter fields (R-BTN-33), as a cache; each ticket's course history and position (R-BTN-39) |
  | leg evidence: commits, branches, PRs, checks, reviews, closing markers, hand-off documents, a person's answer in git | claims, leases, activities, history, events; attestations (R-BTN-181) |
  | `.baton/`: courses, ticket source, station functions, ranking code, condition bindings; course data | the course registry and each course's opaque data, as posted |
  | transcripts | pointers to them |
  | | runners, messages, readings; keys, grants, owners, settings, bars (R-BTN-66); overrides; conditions, timers and the outbox (§7) |

- **R-BTN-193 (git is never a lock or a counter).** Baton is the one place concurrent writers are
  serialized: who holds a ticket is Baton's lease (R-BTN-4), and a number that must be unique
  across concurrent branches is one Baton hands out (R-BTN-199). Git records the work; it never
  decides who holds something or which number is next.
  - Nothing new uses git as a lock or a counter. A ticket or amendment proposing one is a change
    to Baton, not in it, and goes to the owner.
  - **Legacy, removed with its code.** What remains of coordinating through git is marked legacy
    where it is specified, is never extended, and leaves with the work that retires each (B-176,
    B-178): the git-lock ticket commands (R-BTN-74); the next-free scans of git; the cutover and
    the mirror, which serve a repository that coordinated its claims through git before Baton
    (§16); and every passage elsewhere that serves only one of these. A collision one still produces is caught by the sync's duplicate-id
    refusal (R-BTN-74, R-BTN-147) or at merge.

- **R-BTN-33 (Baton holds filter fields, never content).** Per live ticket Baton stores what
  matching (§6) and the dashboard's lists read (the `tickets` columns, §13), the position it holds
  (R-BTN-39), and an opaque `display` object of which core reads only `project`, for the ticket's
  row, and `status`, by equality (R-BTN-85). It never stores a body, Status notes, exit
  criteria, a PR list or other prose; the dashboard links each ticket that has a `path` to its
  file on the forge.
  - It may hold **pointers and digests, never content**: evidence pointers, input and output URIs
    and digests (R-BTN-82, R-BTN-83), a leg run's log directory (R-BTN-128), session and
    transcript pointers, and the credential id that answered a condition (R-BTN-163). A leg's
    output never passes through Baton (R-BTN-128); the one inline output value is R-BTN-108's.
  - **Opaque blobs** are the other inline values, capped by §12.3: course fields and course data,
    profiles, reports, `rationale`, a reading's `detail`. Core never reads them, so it cannot stop
    a course from putting prose in one; doing so breaks this rule, and the CLI's default sources
    and standard station functions post none.
- **R-BTN-35 (Baton wins about what it owns; the ticket source and git about the rest).** Baton
  owns each ticket's course history and position (R-BTN-39), claims and leases, attestations
  (R-BTN-181) and owner state (R-BTN-66). Every other ticket fact it holds (existence, filter
  fields, version, closure) is a cache of what the source last posted, which Baton never edits:
  the next accepted snapshot overwrites it (a **Resync** that forces one is
  [proposed](../proposals/tickets-and-sources.md)). Where git states a value
  Baton also holds, Baton adopts it and logs the discrepancy (R-BTN-85). A runner acts on the
  ticket as its source has it (R-BTN-5, R-BTN-34).
  - **Staleness.** A snapshot observed after a claim's latest claim or `advance` (R-BTN-62) that
    shows the held ticket `closed` as `withdrawn`, or re-tiered above the holder's ceiling, ends
    the claim `released:stale-board` with a `release` to the holder. A held ticket dropped without
    `closed` is R-BTN-147's.
  - **Progress is not staleness.** Facts lagging the holder, readiness the latest snapshot has not
    caught up with, a station or leg the course file lacks (R-BTN-64) and a new version of a held
    ticket (R-BTN-198) leave the claim alone.
  - A ticket gone from its source loses its `tickets` row; its claims, events and course history
    stay.
- **R-BTN-39 (where a ticket is: Baton's course history).** Baton is the one authority on a
  ticket's course history (R-BTN-81) and on its position: its station, its path (the legs run,
  each with the station it reached) and its queued leg (R-BTN-83). No ticket file, marker, PR or
  snapshot places a ticket; a note a leg adds to its ticket is evidence for people, never a
  position. A leg's runs and a ticket's arrivals are counted from this record (R-BTN-63).
  - **Where a ticket starts.** A ticket a snapshot posts for the first time stands at its course's
    `start` with `start_leg` queued (R-BTN-83), unless an import holds its course history
    (R-BTN-88), placed in the transaction that accepts the post, before that post's attestations
    are judged.
  - **Who moves a ticket.** Only these, each along an edge of the course file from Baton's current
    station: the holder's arrival, carried by its `advance` or end (R-BTN-63, R-BTN-71,
    R-BTN-83); a fact arrival; and Baton's own settlements and the legs it queues (R-BTN-116,
    R-BTN-122, §7), the reconciliation move (below). The owner's route (R-BTN-83) is not built.
  - **The station function** (R-BTN-74) is handed each live ticket's position as Baton holds it
    and never sets one. A station its facts imply is shown on the ticket's view and never compared
    with Baton's position.
  - **A fact arrival** is an arrival on a leg no claim runs: a person's leg's, from its answer, a
    `std:decision@1` (R-BTN-116); and a fact leg's (`arrives`, R-BTN-69), from the sync's
    `std:arrival@1` (R-BTN-203). Where the policy admits no `sync` writer for that type, the
    arrival comes from the fact reader, proposed (R-BTN-192). Baton applies an arrival
    in the transaction that accepts the attestation when all hold: the policy admits its writer
    for the type (R-BTN-191); the leg leaves Baton's current station, queued or not; `reached` is one of its
    outcomes; no claim is active on the ticket; and Baton holds the ticket for nothing else (§7).
    Its `next` is the attestation's, else the first leg the course file lists leaving `reached`
    with runs left (R-BTN-63). Baton logs a `fact-arrival` history row and keeps the `ref`.
    - An arrival whose `ref` Baton has applied for this ticket is accepted and moves nothing.
    - An arrival that fails only because a claim is active or Baton holds the ticket is kept with
      its `ref` and applied when the hold ends, if it still meets every other condition.
    - Any other arrival is kept as evidence: Baton logs an `arrival-unapplied` history row with
      the attestation and its own position, shown on the ticket's view (§11), and raises nothing.
      The owner's commands that would settle the disagreement, a route and adopt, are not built.
  - **The reconciliation move.** Baton keeps each `std:evidence@1` the policy admits (R-BTN-203)
    as a piece of the ticket's evidence, once per `ref`. While a ticket has evidence not yet
    weighed, no active claim, no hold, and stands at no end station, Baton, in the transaction
    that accepts the evidence or ends the claim or hold, records its position (course, station,
    path, queued leg) and places it at the start of the repository's reconciliation course with
    that course's `start_leg` queued; history row `reconcile-entered`. The ticket's posted
    `course_id` is unchanged; a claim on it carries the evidence and the recorded position (§14). When the reconciliation course reaches an end station the ticket is
    done (R-BTN-70). When it reaches a station named `returned`, which is no end, Baton marks
    the evidence it held weighed and puts the ticket back at the position it recorded, never one
    a post names; history row `reconcile-returned`. Evidence that arrives during a
    reconciliation is weighed in the same one when it is still at its start, else in the next.
    A reconciliation course the registry does not list raises `baton.reconcile-missing` and
    leaves the ticket where it is.
  - **Adopt**, the owner's command that sets a position for legs done outside Baton, is not built
    (B-120): [the ticket-adopt proposal](../proposals/ticket-adopt.md).
- **R-BTN-8 (git first).** For every `completed` end, `suspended:` included, the runner pushes
  the leg's evidence and hand-off first and may pass `ended_at_sha` (a commit sha, or the URL
  of the comment or review that ended the leg), the evidence confirmation looks for
  (R-BTN-10); an end that passes none is confirmed without it.
  A status change under a held claim is an activity (`status-write`), not an end.
- **R-BTN-18 (no git fallback).** One lock server per repository (R-BTN-56): a session that
  cannot reach Baton does not claim, and one whose lease is lost (R-BTN-6) stops.
- **R-BTN-36 (git never records the holder).** Legacy, removed with its code (R-BTN-193). Nothing
  a mirror or export writes to git (§16) names a session, runner id or hostname; a runner appears
  only as a claim id.
- **R-BTN-45 (Baton advises; its gates protect the lock, not the work).** Baton **recommends**,
  the runner **decides**. Recommendations (R-BTN-61) list the legs a runner may take in Baton's
  default order with Baton's own advice (§6) and the course's opaque fields and hand-off. The
  runner claims one, another ticket it may take, or none. Advice never refuses: a claim against
  Baton's advice is accepted and logged `advice-overridden`. Only the gates — §6's matching
  rules — refuse, at claim and `advance`. A gate is the lock's answer to a cooperating worker,
  never enforcement of the work, which Baton neither does, verifies nor confines. A rule every
  runner must obey is a barred tag or a bar (R-BTN-60, R-BTN-67).
- **R-BTN-46 (gates bind cooperating runners).** Baton cannot refuse a push, comment or status
  write, and checks no commit or signature; fencing (§9) catches mistakes, not an uncooperative
  runner. What a repository's policy adds is R-BTN-66's. Every closing marker carries
  `claim=<nonce>`, so a person reading a PR can tell which claim wrote what; Baton reads markers
  only for the outputs they list (R-BTN-82), keeps no record of who else pushed to a ticket's
  branch and raises nothing about it.
- **R-BTN-53 (instruments hold the secrets; Baton stores what they report).** What a course
  needs and cannot learn from git — a provider's remaining quota, a service's health — is
  learned outside Baton by a runner or an instrument key with its own secrets and posted as
  readings (R-BTN-101). Secrets never enter Baton. A reading nobody renews lapses to `unknown`,
  which blocks only a requirement with `missing: block` (R-BTN-76, R-BTN-181).
- **R-BTN-50 (core acts only on its own vocabulary).** `src/core/` may name only:

  | Concept | Core |
  |---|---|
  | repository, ticket, course id and version | registers, keys, matches declaring runners |
  | station, leg, a ticket's station and path, leg state and `waiting_on`, run count; timer, call leg, person leg, cancel leg | validates course files, leases a run of legs, checks edges, recommends, arms, settles, fires |
  | runner, capability, tier, tag; lease, fence, reap, attempt, backoff, hold, expedite, suspension | the safety gates and the default order |
  | grant, owner, administrator, credential | who may do what |
  | block, `depends_at`, resource, instance, a reading's envelope, a leg's `needs` | keeps rows, answers queries, gates or advises (R-BTN-75) |
  | condition (type, disposition, restart, binding, handler), supersession, outbox entry | records, routes, resumes (§7) |
  | a claim's preference list; a capability's capacity and the seats claims hold | takes the first passing, counts seats (R-BTN-100, R-BTN-178) |
  | opaque blobs (R-BTN-33); hand-off, resume record, input and output pointers | stores and returns, validated against a named schema; never reads, except a path in a value that an attestation requirement's `where` tests (R-BTN-181), and a resume record's `branches` and `prs`, which the history read prunes the records to (R-BTN-24) |

  Everything else — PRs, reviews, providers, models, rate limits — is course vocabulary: a
  mechanism that must know what a leg or profile *means* is course code. A **boundary test**
  enforces it: its list of course words may not appear in `src/core/` outside contract-test
  fixtures, beyond an exceptions list that only shrinks; `src/defaults/` is exempt and never
  imported by `src/core/`; the toy course `chore` runs the generic scenarios (S-BTN-28).
- **R-BTN-66 (agents can change anything in git; what they must not change lives in Baton).**
  An agent can change every byte of a registered repository — `.baton/`, the sync, tiers,
  requirements, computed bars and leg states, condition bindings, reviews. Baton does not
  replace or fortify git's security model: whoever can push, or is in `pushers` (R-BTN-139), is a
  legitimate user of this tenant (R-BTN-137). What is computed from git binds only as strongly as
  git, and so does a ticket's identity (R-BTN-12).
  - **What lives in Baton.** Every limit owners hold against agents is Baton state, set only by
    an owner's or administrator's key (R-BTN-57, R-BTN-58) and never read from git: keys, grants
    and capabilities; holds, cancels and expedite (§6); every owner and administrator setting of
    a repository (§13, each defined by the rule that reads it); and the repository policy
    (R-BTN-188), which holds every rule about authority and trust. What a delegated key may
    change of them is R-BTN-186's.
  - **What stays in git**, where agents may improve it: course files, condition bindings,
    `branch_pattern`, `min_runner_version`, station functions, ranking code. They are protected
    paths (R-BTN-184), landed as the policy's `paths.control` says.
  - **What that state is worth depends on the policy.** Under `cooperative` the owner trusts
    whoever can push, and a pusher can re-file a held ticket under a new id, change a ticket's
    `course:` or edit the course file. Baton's limits, positions and counts are then a
    **coordination record**: they keep cooperating workers from colliding, make every count
    deterministic and give the owner one place to steer, and Baton carries no mechanism whose only
    purpose is to catch a pusher who goes round them. Under `protected`, where control paths and
    ticket files land only by a human (R-BTN-184) and the forge admits only the writers the policy
    names (R-BTN-180, R-BTN-183), the same state is a **boundary**.
- **R-BTN-98 (Baton runs no repository code; runners rank).** Baton calls and stores no course
  code. It decides every gate and its default order (§6), merged across groups (R-BTN-61);
  every judgement that needs a leg's or profile's meaning runs on the runner.
  - A course's own ranking — `rank.mjs` in its course directory, run by the runner over Baton's
    recommendations and views — is not built, and no runner runs one:
    [the proposal](../proposals/courses.md).
  - Estimates stay on the runner; Baton stores no estimate or forecast.

