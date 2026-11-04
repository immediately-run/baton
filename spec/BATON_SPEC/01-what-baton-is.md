## 1. What Baton is *(proposal)*

Baton hands out **tickets** to **runners** under fenced leases and shows the work's live state.
Git keeps every durable record; Baton keeps only what git cannot hold without becoming a lock
server — who holds which ticket now, which runners are alive and what they may do — and the
limits agents must not change. A ticket follows a **course** whose logic is code in its home
repository; Baton knows only the course's contract (§5), runs no repository code (R-BTN-98)
and writes no git itself (R-BTN-171). The division of labor is fixed (the owner, 2026-10-22):
the **runner** is responsible for the leg processes — launching them, terminating them when
necessary, and realizing they are stuck; **Baton** is responsible for collecting information
(the ticket sync, instruments' metrics, claims) and recommending pending ticket legs for
runners to work on. Nothing else supervises a leg's process. One Baton is one tenant (§2).

**Names.** A **ticket** is the unit Baton hands out, `<repository id>:<local id>` to Baton
(R-BTN-47). A **course** is the process it follows: **stations**, where a ticket rests and a
hand-off is written, joined by **legs**, one step each (§5). A **claim** is a runner's lease
on one ticket, running its legs one at a time (§9); a **suspension** ends a claim
`suspended:<station>` (R-BTN-71), unlike a condition's `suspend` disposition, which waits
inside the claim (R-BTN-162). A **runner** is a process that claims and runs legs: an agent
harness session through its sidecar, or a CLI runner (§8). The **sync** reads git and posts the repository's **board** (§4).
**Blocks** say why a leg cannot start (§6). **Conditions** are raised by legs or Baton and
handled by bound courses, resuming by a **restart** (§7). "Workflow" means only a CI workflow;
"activity" only a record of §9.

- **R-BTN-1 (one home per fact).** Each fact has one authoritative home; a copy elsewhere is
  derived and says so. A claim status a mirror writes to git (§16) says a claim exists; Baton
  says who holds it.

  | Git: the home repository, and the repositories and PRs its course reads | Baton |
  |---|---|
  | ticket files, bodies, Status notes, ids, statuses, closure; tags such as `EXPEDITE` | each live ticket's filter fields (R-BTN-33), as a cache; each ticket's course history and position (R-BTN-39), which git never writes |
  | leg evidence: commits, branches, PRs, checks, reviews, closing markers, hand-off documents, a person's answer in git | claims, leases, activities, history, events; attestations (R-BTN-181) |
  | `.baton/`: courses, ticket source, station functions, ranking code, condition bindings; course data | the course registry and each course's opaque data, as posted |
  | transcripts | pointers to them |
  | | runners, messages, readings; keys, grants, owners, settings, bars (R-BTN-66); overrides; conditions, timers and the outbox (§7) |

- **R-BTN-193 (git is never a lock or a counter).** Baton is the one place concurrent writers are
  serialized: who holds a ticket is Baton's lease (R-BTN-4), and a number that must be unique
  across concurrent branches is one Baton hands out (B-176). Git records the work; it never decides
  who holds something or which number is next. Writing a status to git and counting on a refused
  push to stop a second writer, or choosing the next number by scanning branches, is not how Baton
  is meant to be used (the owner, 2026-11-03).
  - **Legacy, phased out as soon as possible.** Until the work that retires each lands, these stay,
    each marked legacy where it is specified and never extended or copied into a new mechanism:
    - the git-lock ticket commands — `baton ticket claim | set | done` writing `status:` and
      retrying a refused push as the mutex (R-BTN-74) — retired by B-178, once Baton holds the
      repository's leases (R3-1266 for this repository);
    - every next-free scan of git — a ticket or child id by R-BTN-131's allocator (R-BTN-74's
      `new` among them), a rule, scenario or gate id by R-BTN-31, a migration number by §13 —
      retired by B-176, after which a scan only seeds Baton's sequence or serves a session without
      Baton;
    - the same pattern in other repositories' own tools (docs' `scripts/claim.sh`, fieldhouse's
      `scripts/ticket.mjs`), retired when each adopts Baton's.
  - **Nothing new uses git as a lock or a counter.** A ticket or amendment proposing one is a
    change to Baton, not in it, and goes to the owner.
  - A collision a legacy path still produces is caught where it is today — the sync's
    duplicate-id refusal (R-BTN-74, R-BTN-147), the duplicate number at merge — as a backstop,
    never the design.

- **R-BTN-33 (Baton holds filter fields, never content).** Per live ticket Baton stores what
  matching (§6) and the dashboard's lists read: id, title, path, course, tier, `requires`,
  expedite, `depends_at`, `parent`, `repos`, rank, the position Baton holds (R-BTN-39), and an
  opaque `display` object core never reads, except its `project` for the ticket's row and its
  `status` for R-BTN-85's `position-disagrees`. It never stores a body, Status notes, exit
  criteria, a PR list or other prose; the dashboard links each ticket to its file on the forge.
  - It may hold **pointers and digests, never content**: a leg's evidence pointer and position,
    input and output URIs and digests (R-BTN-82, R-BTN-83), a leg run's log directory (R-BTN-128),
    `session_url`, transcript pointers, `closed_tickets`' final station and path, and the
    credential id that answered a condition (R-BTN-163).
  - The one inline value Baton validates is a leg output of at most 4 KB whose schema bounds
    every string and closes every object (R-BTN-108). A leg's output never passes through
    Baton (R-BTN-128).
  - **Opaque blobs** are the other inline values, capped by §12.3 (16 KB each, 256 KB of a
    repository's course data): a ticket's `course` and `display`, a next leg's `course`,
    `course_data`, profiles, reports, `rationale`, a reading's `detail`. Core never reads them,
    `display`'s two keys above excepted, so it cannot stop a course from putting prose in one; doing so breaks this rule, and the
    CLI's default sources and standard station functions post no prose in them.
- **R-BTN-35 (the home repository wins, except about what Baton owns).** Baton owns each
  ticket's course history and position (R-BTN-39), claims and leases, attestations (R-BTN-181)
  and owner state (R-BTN-66). When Baton and git disagree about those, Baton wins: an arrival it
  does not apply is recorded `arrival-unapplied` on the ticket (R-BTN-39), and git's other facts
  are adopted and logged (R-BTN-85). About anything else, git is authoritative: every other ticket fact
  Baton holds (its existence, filter fields, closure) is a cache of the head snapshot, which
  Baton never edits. A runner acts on the ticket as `origin/<default branch>` has it, or as its branch does for a
  course that keeps its record there (R-BTN-5, R-BTN-34); the next accepted snapshot overwrites the cached rows; **Resync** forces one.
  - **Staleness.** A snapshot observed after a claim's latest claim or `advance` (R-BTN-62)
    that shows the held ticket `closed` as `withdrawn`, or re-tiered above the holder's
    ceiling, ends the claim `released:stale-board` with a `release` to the holder — except a
    claim running the ticket's `cancel` leg, which a withdrawal never stales (R-BTN-168). A held
    ticket dropped without `closed` is R-BTN-147's.
  - **Progress is not staleness.** Facts lagging the holder, readiness the latest snapshot has
    not caught up with, or a station or leg the course file lacks (R-BTN-64) leave the claim
    alone.
  - A ticket gone from git loses its `tickets` row; its claims, events and course history stay.
- **R-BTN-39 (where a ticket is: Baton's course history).** Baton is the one authority on a
  ticket's course history (R-BTN-81) and on its position: its station, its path (the legs run,
  each with the station it reached) and its queued leg (R-BTN-83). Git never writes them: no
  ticket file, marker, PR or snapshot places a ticket. Git need not hold the history at all; a
  leg may add a note to its ticket, which is evidence for people, never a position.
  - **What one authority buys, and what it is not.** One writer of positions means no replay and
    deterministic counts: a leg's runs and a ticket's arrivals are Baton's own record (R-BTN-63),
    and two writers never place one ticket. Under `cooperative` that record coordinates workers
    who cooperate; it is no boundary against a pusher, who can change a ticket's `course:`, re-file
    it under a new id or edit the course file (R-BTN-66), and Baton carries nothing whose only
    purpose is to catch one. Under `protected`, where a human lands every control path and ticket
    file (R-BTN-184), the same record is a boundary.
  - **Where a ticket starts.** A ticket a snapshot posts for the first time stands at its
    course's `start` with `start_leg` queued (`next_source: baton`) — unless an import holds its
    course history, which places it (R-BTN-88) — placed in the transaction that accepts the post,
    before that post's attestations are judged. Its station function, finding no row in
    `positions`, computes readiness at `start` (R-BTN-74).
  - **Who moves a ticket.** Only these, each an edge of the course file from Baton's current
    station:
    - an accepted `std:arrival@1` (R-BTN-191): the holder's, carried by its `advance` or end
      (R-BTN-63, R-BTN-71, R-BTN-83), or a fact arrival (below);
    - Baton's own settlements: a call's (R-BTN-165) and a person leg's expiry (R-BTN-116); the
      legs Baton queues — a retry policy's `exhausted` leg (R-BTN-122), the `cancel` leg
      (R-BTN-168) — move it by their runs' arrivals;
    - the owner's **route** (R-BTN-83) and **adopt** (below).
  - **The station function** (`locate`, its course's `sync.mjs`, R-BTN-74), run by the sync, is
    handed each live ticket's position as Baton holds it, read in the run's observation
    (§4.3). From git and the forge it computes, per ticket: whether each leg leaving that station
    is `ready` or `waiting` (with `waiting_on`), its fact arrivals, its bars and output pointers
    (R-BTN-70, R-BTN-82), the question of a queued person leg (R-BTN-116), and optionally the
    station its facts **imply**, shown on the ticket's view and used as adopt's default, never
    compared with Baton's position. The sync posts these as its attestations (R-BTN-191). It never
    sets a position.
  - **A fact arrival** is an arrival on a leg no claim runs: a leg whose course-file entry
    declares `arrives: {fact: <kind>}` (R-BTN-69, R-BTN-192), such as a forge outcome a human makes or a
    conversation the owner holds (R-BTN-131 names the standard courses' such legs). The sync
    attests it as `std:arrival@1` with the `ref` of the fact (R-BTN-191), or another writer the
    policy admits does. A person's leg arrives the same way from its answer, a `std:decision@1`
    (R-BTN-116). Baton applies an arrival, in the transaction that accepts the attestation, when
    all hold: its writer is one the policy's `attestations` entry for the type admits; the leg
    leaves Baton's current station — a fact leg or a person's leg need not be the queued one, so a
    human's merge arrives while a runner's `merge` is queued; `reached` is one of its outcomes; no
    claim is active on the ticket; and Baton holds the ticket for nothing else — no call or
    `suspend` condition it is blocked on (R-BTN-126, R-BTN-162, R-BTN-165), no cancellation under
    way (R-BTN-168). Its `next` is the attestation's, else the first leg the course file lists
    leaving `reached` with runs left under `max_runs` — for a person's answer, counting from the
    restart the answer makes (R-BTN-63), so the first leg listed. Baton logs a `fact-arrival`
    history row and keeps the `ref`.
    - **Idempotent.** An arrival whose `ref` Baton has applied for this ticket is accepted
      silently and moves nothing, so the sync attesting the same merged PR or `answer:` on every
      run changes nothing, and a ticket that loops back to the station is not moved again by an
      old answer.
    - **Deferred, not refused, while held.** An arrival that fails only because a claim is
      active or Baton holds the ticket waits, kept with its `ref`, and is applied when the hold
      ends if it still meets every other condition then; it raises nothing meanwhile.
    - **Otherwise unapplied.** Any other arrival is kept as evidence and applied to nothing:
      Baton logs an `arrival-unapplied` history row with the attestation and its own position,
      shown on the ticket's view (§11), and raises nothing. A course whose facts place a ticket
      elsewhere than Baton does is a disagreement the owner settles with adopt or a route, not a
      fault Baton reports.
  - **Adopt.** `baton ticket adopt <ticket> [--at <station>] [--next <leg>] [--ran <leg>,…]`
    (R-BTN-127; `POST /v1/owner/{repository}/tickets/{ticket}/adopt`) sets the ticket's
    position. It is how legs done outside Baton (while Baton was unreachable, in an owner's
    session, or in a clean-up) enter its history: a deliberate act of a key holder, never a side
    effect of a push.
    - **Who.** A credential on the repository's `approvers.policy` list (R-BTN-188; under
      `protected`, a `human` key), or an administrator under the same human gate (R-BTN-185);
      never a delegated key (R-BTN-186, R-BTN-130). It overrides history and resets a limit, so
      it is one of the actions `approvers.policy` governs (R-BTN-186). A course change that maps
      the ticket's station and leg by `renamed_from` needs no adopt: Baton rewrites them itself
      (R-BTN-64); only a station or leg the new file lacks waits for one.
    - **Where.** The station given, or without `--at` the station the latest snapshot's facts
      imply, refused `nothing-implied` where the course implies none. Station and `next` must be
      the course file's, `next` leaving the station; absent, `next` is the station's first listed
      leg. The adopt restarts `next`'s run count (R-BTN-63), so runs already made do not refuse it;
      the runs `--ran` adds are recorded before `runs_from` and do not count toward it.
    - **What it writes**, in one transaction: if a claim is active, its `release`
      (`released:requested`) and its fence (R-BTN-19), both before the position; the position
      (`next_source: owner`), its path extended by one entry `{leg: null, reached: <station>,
      adopted: true}`; one run in `claim_legs` (claim null) for each leg `--ran` names, so
      `max_runs` counts the legs done outside, and none otherwise; any unconfirmed completion on
      the ticket marked `superseded_at`, so the ticket is claimable after the next snapshot
      (R-BTN-10); a `history-adopted` row with both positions and the runs added; and the ticket's
      attempt window reset (R-BTN-122).
- **R-BTN-8 (git first).** For every `completed` end, `suspended:` included, the runner pushes
  the leg's evidence and hand-off first and may pass `ended_at_sha` (a commit sha, or the URL
  of the comment or review that ended the leg), the evidence confirmation looks for
  (R-BTN-10); an end that passes none is confirmed without it.
  A status change under a held claim is an activity (`status-write`), not an end.
- **R-BTN-18 (no git fallback).** One lock server per repository (R-BTN-56): a session that
  cannot reach Baton does not claim, and one whose lease is lost (R-BTN-6) stops. A cut-over
  repository (R-BTN-28) has no git claim path.
- **R-BTN-36 (git never records the holder).** Git says that a ticket is claimed and when;
  Baton says by whom. Nothing a mirror or export writes (§16) names a session, runner id or
  hostname; a runner appears only as a claim id.
- **R-BTN-45 (Baton advises; its gates protect the lock, not the work).** Baton **recommends**, the runner
  **decides**. Recommendations (R-BTN-61) list the legs a runner may take in Baton's default
  order (§6) with Baton's own advice — the expedite lane's bound, `wip-bound` from `max_queue`
  (R-BTN-79), resource blocks (R-BTN-76) — plus the course's opaque fields and hand-off. The
  runner claims one, another ticket it may take, or none. Advice never refuses: a claim against
  Baton's advice is accepted and logged `advice-overridden`. Only the gates — §6's matching
  rules — refuse, at claim and `advance`. A gate is the lock's answer to a cooperating worker,
  never enforcement of the work, which Baton neither does, verifies nor confines (values 12). A rule every runner must obey is a barred tag or a
  bar (R-BTN-60, R-BTN-67).
- **R-BTN-46 (gates bind cooperating runners).** Baton cannot refuse a push, comment or status
  write, and checks no commit or signature (where the repository's policy asks it, trusted
  runners check the chain of attested ranges: R-BTN-183, R-BTN-188); fencing (§9) catches mistakes, not an
  uncooperative runner. Every closing marker still carries `claim=<nonce>`, so a person reading
  a PR can tell which claim wrote what, and Baton reads markers only for the outputs they list
  (R-BTN-82); it keeps no record of who else pushed to a ticket's branch and raises nothing about
  it. Under `cooperative` the owner has chosen to trust whoever can push (R-BTN-66); under
  `protected` the forge admits only the writers the policy's refs name (R-BTN-180).
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
  | opaque blobs (course data, course fields, profile, reports, a reading's `detail`, `rationale`, an output value); hand-off, resume record, input and output pointers | stores and returns, validated against a named schema; never reads, except a path in a value that an attestation requirement's `where` tests (R-BTN-181), and a resume record's `branches` and `prs`, which the history read prunes the records to (R-BTN-24) |

  Everything else — PRs, reviews, providers, models, rate limits — is course vocabulary: a
  mechanism that must know what a leg or profile *means* is course code. A **boundary test**
  enforces it: `review`, `pull`, `merge`, `in-review`, `round`, `author`, `matrix`,
  `finding`, `marker`, `provider`, `model`, `account`, `window`, `usage` and `price` may not
  appear in `src/core/` outside contract-test fixtures, beyond an exceptions list that only
  shrinks; `src/defaults/` is exempt and never imported by `src/core/`; the toy course `chore`
  runs the generic scenarios (S-BTN-28).
- **R-BTN-66 (agents can change anything in git; what they must not change lives in Baton).**
  An agent can change every byte of a registered repository — `.baton/`, the sync, tiers,
  requirements, computed bars and leg states, condition bindings, reviews. Baton does not
  replace or fortify git's security model: whoever can push, or is in `pushers`
  (R-BTN-139), is a legitimate user of this tenant (R-BTN-137); people without push are not.
  What is computed from git binds only as strongly as git, and so does a ticket's identity: a
  hold or cancel binds a ticket id, and an agent that re-files the work under a new id escapes
  it (R-BTN-12 states the residual risk and how owners see it). Every limit owners hold against
  agents is Baton state, set only by an owner's or administrator's key, never read from git and
  never changed over MCP where R-BTN-186 and R-BTN-188 say so: keys, grants and capabilities (R-BTN-58); holds,
  cancels, expedite (§6); cutover (R-BTN-28); and per repository:
  - by owners: `owner_bars`, `required_bars` (R-BTN-67), `retry` (R-BTN-122),
    `unblocked_trigger` (R-BTN-77), `transcript_repos` (R-BTN-20), `leg_log_root` (default unset,
    R-BTN-128), `artifact_buckets` (R-BTN-82), `api_keys` (default `true`, R-BTN-117),
    `checks` and `check_runners` (R-BTN-114), `pushers` (R-BTN-139), `code_repos`
    (with the named repository's consent, R-BTN-140) and each grant's `sync` flag (R-BTN-146);
    each grant's role and domain (R-BTN-180), set by the policy's `approvers.roles` alone; and
    the repository policy (R-BTN-188), which holds every rule about
    authority and trust;
  - by the administrator: `tiers` (at registration, R-BTN-58), `weight` (R-BTN-61) and each
    capability's capacity (R-BTN-178).

  Two more values sit beside these lists. The human-only identity, `human_identity`, is a knob of
  the policy (R-BTN-188), since only a trust rule reads it; the check App's id, `check_app_id`, is
  an instance setting (§12.7), one App for the tenant. `pushers` stays an owner setting although
  it says whose words count (R-BTN-139): it lists forge authors, so adding one is a loosening that
  `approvers.policy` governs (R-BTN-186).

  The rest stays in git, where agents may improve it: course files, condition bindings
  (R-BTN-161), `branch_pattern`, `min_runner_version`, station functions,
  ranking code. They are protected paths (R-BTN-184), landed only as the policy's
  `paths.control` says.

  **What Baton's state protects.** Under `cooperative`, whoever can push can also re-file a held
  ticket under a new id (R-BTN-12), change a ticket's `course:`, rename a leg a bar names
  (R-BTN-142) or edit the course file, so the limits above, and the positions and counts Baton
  owns (R-BTN-39), are a **coordination record**: they keep cooperating workers from colliding,
  make every count deterministic and give the owner one place to steer, and nothing in them is
  defended against a pusher who wants round them. Baton carries no mechanism whose only purpose is
  to catch such a pusher. Under `protected`, where control paths and ticket files land only by a
  human (R-BTN-184) and the forge admits only the writers the policy names (R-BTN-180), the same
  state is a boundary.
- **R-BTN-98 (Baton runs no repository code; runners rank).** Baton calls and stores no course
  code. It decides every gate and its default order (§6), merged across groups (R-BTN-61);
  every judgement that needs a leg's or profile's meaning runs on the runner.
  - A course may ship `rank.mjs` in its course directory. CLI runners, sidecars and launchers
    load it from the remote default branch's head through a verified tree (R-BTN-133,
    R-BTN-134) and run it in a child process with the leg's environment (R-BTN-144). Its
    default export `rank(view)` makes no Baton request and may make any other.
  - `view = {runner: {tags, profile, harness} | null, candidates, fleet, instances, now}`:
    `candidates` this course's entries of `GET /v1/runner/recommendations?all=1` (of
    `launch-candidates` when `runner` is `null`), `fleet` and `instances` R-BTN-99's views. It
    returns `{order: [{ticket_id, leg, score?, reasons?, skip?}], advice?: {<ticket_id>:
    <opaque>}, launch?: <opaque>}`, checked as R-BTN-152 says; on failure, Baton's order.
  - The runner orders each group by its course's ranking and keeps R-BTN-61's merge between
    groups; without `rank.mjs`, Baton's order. Ranking is advice; a course needing every runner
    to rank alike lists `rank.mjs` in `protocol_files` (R-BTN-65).
  - Estimates stay on the runner; Baton stores no estimate or forecast. The sidecar writes one
    record per leg run (ticket, leg, run, claim nonce, estimate, measured tokens and spend per
    model, wall time, peak disk) beside the transcript.

