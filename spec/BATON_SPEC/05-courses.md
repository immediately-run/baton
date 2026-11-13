---
title: "5. Courses"
description: "A course is the process a ticket follows: a graph of stations, where a ticket rests, and legs, the work that takes it from one station to the next."
---
## 5. Courses *(partly built — B-28, B-29, B-40)*

A course is the process a ticket follows: a graph of **stations**, where a ticket rests, and
**legs**, the work that takes it from one station to the next. A course lives in a course
directory in some repository at some commit; changing it is a commit there, effective at the
next sync, with no Baton deploy. Core knows a course's names and edges and nothing of what they
mean (R-BTN-50).

### 5.1 Course directories and sources

- **R-BTN-134 (a course is what its source names).** Every reader — the sync, the runner, the
  test kit, `baton repo init` — reads a course from one course directory at one commit. The CLI
  holds the machinery that reads any course and holds no course.
  - **The course directory** holds `course.json` (R-BTN-69), `sync.mjs` (its station function,
    R-BTN-74; required), `legs/<leg>.<ext>` (R-BTN-133), `legs/<leg>.md` (each leg's
    instructions), optional `rank.mjs` (R-BTN-98), `schemas/<name>@<n>.json` (R-BTN-108),
    `entry.json` (defaults for its `courses[]` entry) and an optional `package.json` with
    lockfile. It is **self-contained**: it imports only its own files, Node built-ins, its own
    declared dependencies and `@immediately-run/baton/leg` (R-BTN-133). A repository's **own**
    course is `.baton/courses/<course>/`, which may also import `.baton/package.json`'s
    dependencies, and whose `sync.mjs` and `rank.mjs` (with the repository's `tickets.mjs`) may
    import the repository paths `.baton/baton.json` lists in `imports: [<path>…]` — allowed by the
    resolve hook for the `tickets`, `stations` and `rank` calls only, a bare specifier there
    resolving as if from `.baton/`.
  - **Station functions and ticket sources** run — in the sync, the runner's re-verification
    (R-BTN-5) — through the wrapper (R-BTN-133), by the executor's `exec` wherever a runner runs
    them (R-BTN-107), in a
    read-only, verified worktree of the **whole** commit, as working directory; never in
    `ctx.checkout`.
  - **A source** is `courses[].source` = `<provider>/<namespace>/<repository>/<commit>/<path>`:
    `<commit>` all 40 hex characters, never a branch or tag; `<path>` relative, with no `.` or
    `..` segment, its last segment the course id. `github` (→
    `https://github.com/<namespace>/<repository>.git`, names compared without case) is the only
    provider. The short `id` is the name tickets, rows, rule 9 and branch patterns use. A course
    with no `source` is the repository's own. The CLI configuration's
    `sources: {"github/<ns>/<repo>": "<url>"}` (`--config` of `baton runner start`, `baton repo sync`,
    `baton course test`) may map a source repository to a mirror, trusted exactly as its
    upstream; every reader of a deployment maps it the same way.
  - **Fetching, the same for every reader:** one cache clone per source repository;
    `git ls-remote --symref <url> HEAD`; `git fetch --filter=blob:none` of the default branch; the
    commit must be an ancestor of the fetched head — **a commit is never fetched by its id**; then
    R-BTN-133's sparse, read-only, verified tree with its install root installed, ancestry and
    cleanliness re-checked on every reuse. A runner's clones live under its home git directory;
    the sync's and the kit's in their own run's cache. A private source in another repository is
    read with the CI secret `BATON_SOURCE_TOKEN`, which `baton repo init` wires in with a CI cache
    keyed by the sources' commits and lockfile digests (never skipping the ancestry check). An
    unfetchable source fails the sync (posting nothing) or ends the claim
    `released:cannot-finish:transient`; a commit off the default branch, or a directory without
    `course.json` or `sync.mjs`, is a course fault (`spec`).
  - **The home of a sourced course** holds its entry (`id`, `source`, and only other fields it
    sets on purpose) and only overrides under `.baton/courses/<course>/`: `legs/<leg>.run.<ext>`
    (R-BTN-131) and `legs/<leg>.md`. Any other course file there beside a `source` fails the
    sync, naming the file.
  - **The entry is merged at read time, never copied:** the source's `entry.json` (any
    `courses[]` field of R-BTN-51 but `id` and `source`, which are the home's alone), then the
    home's fields over it. A
    runner re-reads `entry.json` at startup and after each fetch of its home's default branch.
    `entry.json` may name `min_cli`, the leg-module version its code needs: the sync and init
    refuse a source above the running CLI's version, naming both; a runner ends the claim
    `released:cannot-finish:capability` in preparation.
  - **`facts`** in the entry names what the CLI reads for the station function: `prs` (R-BTN-96)
    and `branches` (git refs); markers are always read.
  - **Every reader goes through the snapshot:** the sync reads `.baton/baton.json` at the commit
    it posts (R-BTN-105), the runner at the claim's `snapshot_sha` after R-BTN-143's check,
    re-verification at the commit it verifies — so Baton, runner and
    runner use the same bytes.
  - **`baton repo init`** `--course <id>` writes the source
    `github/immediately-run/baton/<commit>/src/defaults/courses/<id>` at that repository's
    default-branch head; `--source <provider>/<ns>/<repo>/<ref>/<path>` names any other, `<ref>`
    resolved to a commit and checked reachable first. It reads a source as data only (never a
    symbolic link) and never installs or runs it; writes the entry, the sync workflow and the
    tickets README, never a course file; re-run, moves the source to the head (`--at <commit>`
    pins). `--override <leg>` seeds `legs/<leg>.run.mjs`; `--instructions <leg>` copies the
    source's `legs/<leg>.md`; `--force` rewrites that course's entry only; with no `--course` it
    takes `default_course`, else `create-pr`. Its commit message carries `Baton-Source: <id>
    <old>..<new> <compare URL>` per source moved, and the sync logs the same line. The home's
    files are written only when missing.
  - **The CLI is pinned by its own version** (`npx --yes @immediately-run/baton@<version> repo
    sync`, written by init). A CLI release changes no course; a course commit needs no CLI
    release.
  - **`--defaults-only`** (R-BTN-97) loads only the CLI's markdown ticket source and station
    functions of `course_sources` (`baton repo sync --config`, default
    `~/.config/baton/sync.json`, outside the checkout, no default list; by repository, any
    commit reachable from its default branch); it installs nothing of `.baton/`, refuses a home
    `tickets.mjs`, fails a ticket on any other course, and refuses to start when the CLI or any
    module it loads lies inside the checkout.
  - **Trust.** Naming a source adopts its code with the rights of where it runs: `sync.mjs` and
    install scripts in the sync job's full environment (forge token, `id-token: write`,
    `BATON_SOURCE_TOKEN`, which should be read-only and limited to the sources), leg scripts on
    runners (R-BTN-133). Name only sources you would let act as your CI.

### 5.2 The course file

- **R-BTN-69 (the course file).** `course.json` in the course directory is the course's whole
  state machine, in a schema core owns. The sync posts it with every board (§4); the runner
  loads the same file at each claim's snapshot.

  ```json
  { "start": "filed", "start_leg": "implement", "end": ["merged"], "short_waits": ["ci"],
    "stations": { "filed": {}, "pr-open": {}, "reviewed": {}, "fixed": {}, "merged": {} },
    "legs": { "implement": {"from": ["filed"], "to": "pr-open"},
              "review": {"from": ["pr-open", "fixed"], "to": "reviewed", "max_runs": 3},
              "fix":    {"from": ["reviewed"], "to": "fixed", "max_runs": 2},
              "merge":  {"from": ["reviewed"], "to": "merged"} } }
  ```

  Station and leg ids match `^[a-z][a-z0-9-]{0,39}$`. The fields:

  | Field | On | Meaning | Rule |
  |---|---|---|---|
  | `start` | course | the one start station | R-BTN-69 |
  | `start_leg` | course | the queued leg of a new ticket; its `from` includes `start`; always present | R-BTN-83 |
  | `end` | course | non-empty list of end stations; each is terminal (a ticket there is done) | R-BTN-70 |
  | `cancel` | course | the leg that undoes the course's work when a ticket is cancelled: an ordinary leg whose `from` lists every station a ticket may be cancelled at and whose `to` is one end station; absent, a cancelled ticket closes at once | R-BTN-168 |
  | `short_waits` | course | `waiting_on` labels a holder waits on under its claim instead of suspending, compared as strings | R-BTN-72 |
  | `stations`, `legs` | course | maps of id → station, id → leg | R-BTN-69 |
  | `conditions` | course | declared condition types: `{<type>: {disposition, restarts?, default?, wait_s?, retryable?, description?}}` | R-BTN-160 |
  | `capability_types`, `capability_roles` | course | the capability types its legs may require, and named lists of capabilities | R-BTN-121 |
  | `rank_advice`, `rank_launch` | course | schema ids (R-BTN-108) that `rank.mjs`'s `advice` and `launch` must meet; absent, they are dropped | R-BTN-152 |
  | `label` | station, leg | display text | — |
  | `renamed_from` | station, leg | the earlier name this one carries over | R-BTN-64, R-BTN-142 |
  | `entry` | station | outputs any leg arriving here must have produced | R-BTN-109 |
  | `from` | leg | the stations it leaves | R-BTN-69 |
  | `to` | leg | its outcome station, or list of them; for `kind: call`, a completion table | R-BTN-83, R-BTN-165 |
  | `arrives` | leg | `{fact: <kind>}`: no claim runs it; it arrives when an admitted writer attests its fact (R-BTN-39), the leg having one outcome; while it leaves the ticket's station it is `waiting` on what its course names. `<kind>` is one of the closed set the CLI reads with no course code (R-BTN-192): `pr-merged`, `pr-verdict`, `pr-opened`, `pr-pushed`. Not on a `kind: person` leg, which arrives from its answer (R-BTN-116) | R-BTN-39, R-BTN-192 |
  | `kind` | leg | absent: run by a runner; `person`: a person answers, by a `std:decision@1` (R-BTN-116); `call`: files children of its `spawns` courses and waits for them | R-BTN-116, R-BTN-165 |
  | `asks` | leg | for `kind: person`, a label of who answers | R-BTN-116 |
  | `expires` | leg | for `kind: person`, `{after_s, reached}`: unanswered for `after_s` (60 s–30 d) after the ticket arrived at the leg's station, the leg arrives at `reached`, one of its outcomes | R-BTN-116 |
  | `max_runs` | leg | how often one ticket may run it | R-BTN-63 |
  | `max_queue` | leg | queue depth that raises a warning, 1–10,000 | R-BTN-79 |
  | `version`, `inputs`, `outputs` | leg | its contract | R-BTN-82 |
  | `replay_safe` | leg | `false` when it has side effects outside git and its forge | R-BTN-82, R-BTN-84 |
  | `requires` | leg | prerequisites: `{tickets?, capabilities?, resources?}` | R-BTN-120 |
  | `retry` | leg | its retry policy: `{max_attempts, backoff_s, exhausted?}` | R-BTN-122 |
  | `deadline_s` | leg | how long one run may take before Baton takes the claim back, 60 s–7 d | R-BTN-167, R-BTN-90 |
  | `stalled_s` | leg | how long the leg may be posted `waiting` before `baton.stalled` is raised; default 259,200 (72 h) | R-BTN-167 |
  | `conditions` | leg | narrows the condition types it may raise (`[]`: none) | R-BTN-160 |
  | `spawns` | leg | the courses of the children it files (for a call leg, the courses it calls), their contract and their `lifetime` | R-BTN-111, R-BTN-165, R-BTN-168 |
  | `no_chain_from` | leg | legs whose credential may not take this one on the same ticket (for a credential `domains.per_run` lists, across claims only under another label) | R-BTN-106 |
  | `stream` | leg | `false`: its output is never written to a leg log | R-BTN-128 |
  | `max_context`, `max_refreshes` | leg | context fraction (0.1–0.95) that triggers a fresh session, and how many | R-BTN-123 |
  | `agent_command` | leg | the command its stub runs as the leg's agent, a string of 1–1,024 characters | R-BTN-131 |
  | `executor` | leg | executor data: a JSON object Baton never reads, passed to the runner's executor | R-BTN-107 |
  | `check_command` | leg | a check course's verdict command: an argv, with `timeout_s` (default 1800, ≤ 7200) | R-BTN-153 |

  - **Validation.** Baton accepts a file only if: `start` names one station; `end` names at
    least one; no leg's `from` names an end; every `from`, `to` and completion-table key names
    a station; every station is reachable from `start` through any outcome, and an end is
    reachable from every station, the `cancel` leg not counted; every cycle contains a leg with
    `max_runs`; `start_leg` names a leg whose `from` includes `start`; every `inputs.from` names
    a leg and one of its outputs; `cancel`, if present, names a leg with no `kind`, whose `to` is
    one end station and which no `next`, `exhausted` or completion `next` names (it is queued by
    Baton alone, R-BTN-168); every `kind: call` leg has `spawns` and a completion table
    (R-BTN-165); every `requires.tickets` entry selects `parent` or `posted` (R-BTN-120);
    `expires` sits only on a `kind: person` leg and names one of its outcomes, and `deadline_s`
    and `stalled_s` sit on no `kind: person` leg (R-BTN-167); `deadline_s`, `stalled_s` and
    `expires.after_s` are within their ranges (R-BTN-167, R-BTN-116);
    `renamed_from` passes R-BTN-142; every capability is typed (R-BTN-121) and `runner:leg-trees`
    is listed where R-BTN-133 needs it; its schemas pass R-BTN-108. It refuses the fields
    `error_types`, `max_duration`, `max_attempts_s` and `max_ready_s`, whose meanings are
    conditions, retries and deadlines (R-BTN-160, R-BTN-122, R-BTN-167); `timers`, `after_s` and
    `choice`, which were timers and choice stations (`deadline_s`, `stalled_s` and `expires`
    replace them); `compensate` and `kind: compensation`, which are the course's `cancel` leg
    (R-BTN-168); `isolation`, since how a leg runs is the runner's executor's (R-BTN-107); a leg's
    `call`, which is its `spawns` (R-BTN-165); `checks`, which is the owners' setting
    (R-BTN-114); and `retry.non_retryable`, which is a type's `retryable` (R-BTN-160). A file
    that fails keeps the previous one in force and raises `baton.course-refused`.
  - **Edges carry no conditions.** Which outcome a leg reached is a git fact the station
    function evaluates (R-BTN-39), never part of the file. Parallel work inside a leg is the
    leg's own business; parallel tickets are children (R-BTN-86).
  - **The `cancel` leg leaves every station it names and reaches an end**, so `to_end`
    (R-BTN-61) and the reachability check above ignore it: it is not a way to finish the work.
    It is queued only by Baton, when a ticket is cancelled (R-BTN-168): a holder's `next` or
    `advance` and an owner's route naming it are refused `cancel-leg` (R-BTN-63, R-BTN-83).
    Queued, it is `ready`
    whatever readiness is posted (no sync posts any for it) and the `cancelling` hold does not
    refuse it (§6.6, rules 1 and 3); it runs as any leg does, on a runner holding its
    capabilities, and is re-verified against Baton's record, not git (R-BTN-5).
### 5.3 Where a ticket is, and how it moves

- **R-BTN-70 (where a ticket is, and what it may do next).** Baton holds every ticket's
  **station**, **path** and **queued leg** with its `next_source` (R-BTN-39, R-BTN-83). A ticket
  at an end station is done. For every live ticket the sync attests, from its station function,
  `std:git.readiness@1` (R-BTN-191): for each leg leaving Baton's station that the ticket may
  still run, `ready` or `waiting` (with a `waiting_on` label). With the ticket it posts the barred
  tags of each leg it knows them for (`ticket_bars`, per leg name). Core keeps the readiness and
  bar rows of the newest accepted run, writing only the rows that changed: a row the run leaves
  as it is stays unwritten, and counts as shown by that run's observation (S-BTN-188). Readiness
  is attested `at` a position, `{station, path_len}` as `positions` gave it; readiness at any
  other (Baton moved the ticket after the observation, even round a loop back to the same
  station) is discarded until the next run. Core recommends a `ready`
  leg, and never computes readiness. The claim response, every heartbeat and every `advance`
  response show the holder Baton's station, path and queued leg, and the latest snapshot's
  readiness.
- **R-BTN-83 (a leg ends in a position: the station it reached and the leg it queues).**
  - **Outcomes.** A leg's `to` lists its possible outcomes; which one a run reached is the
    holder's report, its evidence in git.
  - **The pair.** Every finishing leg reports a **position** `(reached, next)`: `reached` one
    of its outcomes, `next` a leg whose `from` includes `reached` — null at an end, required
    elsewhere. A suspension or release reports one too: at the outcome reached, or at the
    `from` it gave up with the leg itself as `next` unless the holder names another leg leaving
    it. Nothing is inferred from a station having one leg out. A new ticket's queued leg is
    `start_leg`.
  - **Evidence first, then reported** (R-BTN-8). The runner validates the pair and the outputs
    (R-BTN-82), then calls the leg script's `close(ctx, result)`, which writes the run's evidence
    in the course's convention (a closing marker carrying output pointers and `not_before`, a
    verdict line, a note on the ticket), then reports with `advance`, `end` or a suspension. An
    agent leg pushes only its evidence.
  - **Recorded at once.** The reported pair is the holder's `std:arrival@1` attestation
    (R-BTN-191), carried by the `advance`, end or suspension and signed by that request's own
    signature (R-BTN-13). Baton records it as the ticket's position in the transaction that
    accepts the request. No snapshot confirms or replaces it (R-BTN-39); a closing marker's
    position is evidence for people, never read as one.
  - **Three sources queue a leg.** The queued leg's `next_source` says who chose it: `holder`
    (the holder's `advance`, end or suspension); `baton` (the course's `start_leg` for a new
    ticket; a call's settlement, R-BTN-165; a fact arrival or a person's answer Baton applied,
    R-BTN-39; a person leg's expiry, R-BTN-116; a retry policy's `exhausted` leg, R-BTN-122; the
    `cancel` leg, R-BTN-168); or `owner` (a route, below, or an adopt, R-BTN-39). The reason is
    in the position's history row (`detail_json`). Four of these are **held** in
    `ticket_overrides` until the ticket's station changes (cleared by whatever moves it), so that a
    later snapshot's readiness for another leg does not displace them: the owner's route, the
    `exhausted` leg, a person leg's expiry and the `cancel` leg; they are in the ticket's history
    and the owner-state export. The `start_leg`, a call's settlement and an applied arrival's
    `next` are recorded in the position alone.
  - **Route.** `baton ticket route <ticket> <leg>` (R-BTN-127; `POST /v1/owner/{repository}/tickets/{ticket}/route`)
    queues any leg leaving Baton's station for the ticket, the course's `cancel` leg excepted
    (`cancel-leg`, R-BTN-168), `next_source: owner`, restarting its run count (R-BTN-63); `{clear: true}` restores the course's choice. Both are logged `re-routed`.
  - **The queue is the queued leg.** A ticket waits in exactly one queue, its queued leg's
    (R-BTN-79), and matching rule 1 offers that leg alone, `ready` or `waiting` as posted. A
    queue, not a reservation: whoever claims passes every gate then. A person leg (R-BTN-116) and
    a fact leg (R-BTN-39) may arrive while another leg is queued; they are never claimed.
  - **Course changes.** A renamed queued leg resolves through `renamed_from` (R-BTN-64). A
    queued leg that the course in force does not have leaving that station is stored `waiting` on
    `course-changed` (overriding the posted state) when Baton accepts the course file or such a
    snapshot (which it does not refuse), raising `baton.course-changed`, unless `renamed_from`
    maps it to a leg that is. A ticket with no claim at a station the new file lacks waits
    `course-changed` the same way, until the owner adopts it (R-BTN-39). A leg added later
    changes no queued leg.
- **R-BTN-63 (an advance follows an edge, on the holder's word).** A claim **is at** a station
  — the last one it reached — and may be **running** one leg.
  - When claimed, it is at the ticket's station as Baton holds it (recorded as `start_path`) and
    runs nothing.
  - `advance {reached, leg}` finishes the running leg, if any, at `reached` — one of its
    outcomes, else refused `off-graph` — records the position, then starts `leg` if it leaves
    `reached`, is not the course's `cancel` leg (refused `cancel-leg`; Baton alone queues it,
    R-BTN-168, and a holder's `next` naming it is refused the same), the ticket's runs of it are
    fewer than its `max_runs`, and every holder gate holds
    (matching rules, §6: grants, holds, barred tags with owner bars that apply at advances,
    required bars, prerequisites). The first `advance` starts the first leg; every leg a claim
    runs has its own `advance`. Baton records each leg a claim starts and finishes
    (`claim_legs`).
  - **Every run has a run id.** The `advance` that starts a run, and an adoption that adds one,
    mints its `run_id`: `r_` and a ULID — 26 characters of Crockford base32 encoding 48 bits of the
    time in milliseconds read through the clock (R-BTN-32) and 80 random bits from the core's
    random source, which tests replace as they replace the clock; a collision with an existing id
    is refused by the column's unique index and a new one minted. Runs recorded before run ids are
    given one when the migration adding the column runs, minted the same way from each run's
    `started_at`. It is opaque — no reader parses, sorts or
    compares it except for equality; order comes from `started_at` and `seq` — and unique across
    the tenant. The `advance` reply returns it; `claim_legs`, the history's leg rows (R-BTN-81),
    `previous_attempts` and the resume record (R-BTN-24) and the run list (R-BTN-128) carry it.
    Anything a runner writes outside Baton to a place another tenant could also write — a forge
    ref, a bucket path — is keyed by the **tenant host** and the run id: the host of the tenant's
    configured origin (R-BTN-135), lowercased, a port joined with `-` (`baton.immediately.run`,
    `localhost-8787`), so it is safe in a git ref name and a path.
  - **Baton's traversal record counts.** A ticket's runs of each leg and arrivals at each station
    are counted from Baton's own record — every leg a claim ran and every run an adoption added
    (`claim_legs`), and every fact arrival Baton applied, under resolved names (R-BTN-64).
    `max_runs`, attempts (R-BTN-122) and retries read these counts. Git never places a ticket
    (R-BTN-39), so an agent that rewrites a ticket's history in git changes neither its position
    nor its counts. `max_runs` bounds the runs made without a person: a person leg's answer
    (R-BTN-116), an owner's route or an adopt (R-BTN-83, R-BTN-39) **restarts the count** of the
    leg it queues, since a person's intervention is what the bound waits for. Baton records the
    restart as `runs_from` on the position (`ticket_stations`, the id of the last `ticket_history` row
    at that moment, R-BTN-81; exported with the course history, R-BTN-88); the queued leg's runs
    and arrivals toward `max_runs` are those recorded after it, so the leg is queued whatever its earlier runs, and the
    traversal record itself is never erased.
  - The holder pushes a leg's evidence before the `advance` that finishes it, and may pass
    `bars`, tags it bars from the new leg, which only add to the posted bars. A later snapshot
    posting that leg's bars without a tag the holder declared is the discrepancy
    `bars-mismatch` (R-BTN-85) and raises `baton.bars-mismatch`; the sync's reading binds from
    then on.
  - Baton does not check a leg's state: which leg comes next is the holder's judgement of git's
    facts, recorded by its `advance`. A loop is a leg taken again; a leg no sync has posted
    readiness for yet is fine.
  - An `advance` is checked against the newest snapshot's course file.
- **R-BTN-71 (a suspension rests at a station).** A claim that stops ends
  `suspended:<station>`: the outcome its running leg reached if that leg finished, else the
  leg's `from` (the claim's current station); any other station is refused. The end carries the
  queued leg `next` (R-BTN-83), which Baton records as the ticket's position at once (R-BTN-39);
  the end is confirmed as R-BTN-10 says. The next claimant starts at Baton's station. (A leg
  waiting in its claim on a raised condition is a different thing, R-BTN-162.)
- **Disagreement, not movement.** Calls, expiries, retries and cancellations move a ticket only
  along edges. A snapshot whose facts disagree with Baton's position moves nothing: its arrival
  is recorded unapplied (R-BTN-39), and the owner settles the disagreement with adopt or a route.

### 5.4 Legs are queues

- **R-BTN-79 (legs are queues; a course may bound them, as a warning).** Leg L's **queue**, per
  repository, is the tickets of L's course whose queued leg is L (ready or waiting, blocked or
  not) and that are not held (R-BTN-75; a ticket marked `cancelling` counts in its queued `cancel`
  leg's queue, R-BTN-168). Baton keeps its depth in `leg_queues`, changed in the
  transactions that accept a snapshot, start, end or advance a claim, confirm an end, clear a
  fence or re-route a ticket.
  - A leg's `max_queue` is a **warning threshold**: a ticket always enters its queue, and the
    depth may pass the bound. Depth above it raises `baton.queue-over` (`{course, leg,
    depth, max_queue, intake}`), closed when the depth is back within it. Core never holds, refuses or
    reorders for it.
  - **Intake.** A repository's course is `closed` while any of its legs is over `max_queue` and
    `open` when all are within (logged `course-closed`, `course-opened`). While closed,
    recommendations leave out its **new** tickets (at `start` with an empty path) after the gate
    query, so its queues drain. This is advice (R-BTN-45): a claim of a new ticket by id is
    accepted and recorded `advice-overridden`, and an expedited ticket (R-BTN-12) is still
    recommended.
  - Every leg's depth, bound and the intake state are in the fleet view (R-BTN-99), the
    dashboard's **Courses** view (§11) and the repository's stats (§5.7).

### 5.5 Contracts, schemas and views

- **R-BTN-82 (leg contracts: declared inputs and outputs, as pointers, checked by the runner).**
  - **A contract** is optional, per leg: `version` (an integer, raised whenever its inputs or
    outputs change meaning); named `outputs`, each with a `schema` (`<id>@<version>`, R-BTN-108);
    named `inputs`, each reading one leg's output (`from: "<leg>.<output>"`) with the producer
    versions it `accepts` (default: the producer's current) and `required` (default true).
  - **Outputs** are envelopes (R-BTN-108). A pointer `uri` is `git:<owner>/<name>@<commit>:<path>`,
    `git:<owner>/<name>#blob=<sha>`, an `https://` URL on the repository's forge, or
    `s3://<bucket>/<key>?versionId=…`; one not content-addressed carries `digest`
    (`sha256:<hex>`). Each URI ≤ 1 KB; ≤ 16 outputs per leg run. Baton checks scheme, shape and
    R-BTN-92's link rule, never fetches, and records each with the course version, leg, contract
    version, claim and source (`holder`, or `sync`).
  - **Git first, confirmed by the sync.** The closing marker lists the outputs; the sync attests
    each as `std:git.output@1` with its marker's `ref` and `claim_nonce` (R-BTN-191). An output is recorded only if its nonce names
    a claim on the ticket (`leg_outputs.claim_id`); any other is dropped, logged `output-unclaimed`,
    and never resolved as an input. The one output no claim records is a person leg's `answer`,
    the applied `std:decision@1` itself (R-BTN-116), recorded with no claim. Markers by non-pushers are never outputs (R-BTN-139).
  - **Inputs are resolved by Baton.** At the `advance` that starts a leg, Baton returns each
    input: the latest recorded output of its producer for this ticket, with the producer's
    versions; the inputs given are recorded in the ticket's history (R-BTN-81). In every
    transaction that writes a ticket's queued leg, next legs, outputs or course file, a queued
    leg with a required input missing or of an unaccepted producer version is stored `waiting`
    on `input-missing` or `input-version` and raises `baton.input-missing` or
    `baton.input-version`; the `advance` refuses one `not-eligible` as a backstop, with no failed
    attempt.
  - **The runner checks contents.** The runner fetches each input (a `git:` or `https://` URI
    only from a repository with reach, R-BTN-140), verifies its digest, schema or not, as replay
    does (R-BTN-84, R-BTN-140), and validates it before the leg's script runs, and validates each output after
    it returns, before reporting or advancing. An output violation ends the claim
    `released:cannot-finish:contract-output`, a failed attempt under the retry policy
    (R-BTN-122). An input violation, a digest mismatch included, ends it
    `released:cannot-finish:contract-input`, not a failed
    attempt: the ticket is held at once (`hold_reason: non-retryable:contract-input`) and
    raises `baton.contract`. Its `detail` names the input, the schema, and the producing leg and
    version. The remedy is git's (re-run the producer, or ship a migration or a wider
    `accepts`), then the restart `retry` or `park`.
  - A leg with side effects outside git and its forge is marked `"replay_safe": false`
    (R-BTN-84).
- **R-BTN-108 (one envelope, named schemas, one validator).** Leg outputs and instrument readings
  are one mechanism.
  - **Core owns the envelope.** A leg output is `{name, schema: "<id>@<version>", uri?,
    digest?, value?}`: `uri` and `digest` (R-BTN-82), or an inline `value` of at most 4 KB
    serialized, never both. A reading keeps R-BTN-76's envelope and names its `detail`'s schema
    in `schema`. Core reads the envelope only, and a reading's `detail` only where a
    requirement's `where` tests a path in it (R-BTN-181).
  - **An inline value is bounded.** Baton stores a `value` only when its schema chain sets
    `additionalProperties: false` on every object and a `maxLength` ≤ 256 on every string;
    anything else goes by pointer. Stored values are course data, in the owner-state export
    (R-BTN-88).
  - **Names.** `std:<name>@<n>` is the standard library's (R-BTN-110); a course's are
    `<course>:<name>@<n>`, at `schemas/<name>@<n>.json` in its course directory, posted with the
    course file at every sync, each with its SHA-256 digest. A version is **immutable**: a
    posted schema whose digest differs from the one Baton holds for the same id and version is
    refused, with its course file. Baton keys schemas by (repository, id, version). A sync posts
    only its own courses' schemas, never a `std:` id. `$ref` and `x-baton-base` resolve among
    the same repository's schemas and `std:`.
  - **Refinement.** A schema may name one base, `"x-baton-base": "<id>@<version>"`. A value is
    valid when valid against its schema **and** every schema up its base chain. `baton course
    test` checks statically that each schema refines its base: the same or narrower `type`;
    every base `required` still required; shared properties refining recursively; a new property
    only where the base's `additionalProperties` allows; `enum` a subset, `const` equal, bounds
    equal or tighter, `pattern` equal. The check is sound and conservative: an unproven
    refinement is reported with its keyword.
  - **The subset.** JSON Schema 2020-12 restricted to `type`, `properties`, `required`,
    `additionalProperties`, `items`, `prefixItems`, `enum`, `const`, `minimum`, `maximum`,
    `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `minItems`, `maxItems`,
    `pattern`, `format` (`date-time`, `uri`), `$ref` to a named schema, `title`, `description`,
    `x-baton-base`, `x-baton-view`; ≤ 32 KB, ≤ 16 levels. Anything else (`anyOf`, `oneOf`,
    `allOf`, `not`, `if`, dynamic references) is refused at the sync with its course file, as is
    a `$ref`/`x-baton-base` cycle.
  - **`pattern`** uses the validator's own linear-time engine (a Thompson automaton, no
    backtracking): literals, `\`-escapes, `.`, classes (`[a-z]`, `[^…]`, `\d`, `\w`, `\s`), `^`,
    `$`, groups, alternation, `?`, `*`, `+`, `{n}`, `{n,m}` with m ≤ 1000; no back-reference,
    look-around, lazy or possessive quantifier, flag or Unicode property; ≤ 512 characters; the
    expanded automaton ≤ 4,096 states (R-BTN-149). Outside the grammar is a schema error. The
    same engine reads capability `values` (R-BTN-121).
  - **One validator**, `src/shared/schema.mjs`, with no dependency, is imported by the server,
    the CLI and runner, the sync and `baton course test`.
- **R-BTN-109 (station entry requirements).** A station may name what any leg arriving at it
  must have produced: `"entry": [{"output": <name>, "schema": "<id>@<version>"}, …]`.
  - **Baton checks presence and identity** at an `advance` or `end` whose `reached` is the
    station: an output of that name whose schema is the required one or refines it (by the
    posted base chains), with the posted digest; an inline `value` is validated in full. Unmet
    is refused `not-eligible` (rule `entry`), which the runner treats as
    `released:cannot-finish:contract-output`.
  - **The sync checks pointers:** it fetches each `uri` output from git or the forge, validates
    it, and posts each verdict with the ticket. An invalid output is the discrepancy
    `output-invalid` (R-BTN-85), is never resolved as an input, and raises
    `baton.output-invalid`. Baton never fetches.
  - **A fact arrival** — an `std:arrival@1` or a person leg's `std:decision@1` (R-BTN-39,
    R-BTN-116) — is checked the same way when its attestation is accepted.
  - A leg whose work is only a side effect arrives at a station with no `entry`, or with one
    `std:effect@1` requirement.
- **R-BTN-110 (standard output formats are a shared library, not core).** Baton ships beside its
  CLI a library of `std:` schemas, each with a view (R-BTN-112); to core a `std:` id is a string
  with a digest.

  | Schema | Fields |
  |---|---|
  | `std:git.commit@1` | `{repository, sha}` |
  | `std:git.file@1` | `{repository, commit, path, blob?}` |
  | `std:forge.change@1` | `{repository, number, url, head_sha, state}` |
  | `std:forge.comment@1` | `{url, change?, author?}` |
  | `std:forge.check@1` | `{repository, sha, name, conclusion, check_id?}` |
  | `std:object@1` | `{uri, digest, media_type, size}` |
  | `std:url@1` | `{url}`, under R-BTN-92's link rule |
  | `std:effect@1` | `{kind, ref?, at}` |
  | `std:decision@1` | `{id, leg, option, reached, ref?, answered_by?, commit?}`, a person's answer (R-BTN-116): `reached` the person leg's outcome the option chooses; `ref` the answer's identity for R-BTN-39's idempotence — required, the commit that wrote it, when the sync attests an answer in git; optional otherwise, defaulting to the attestation's own id |
  | `std:arrival@1` | `{leg, reached, next?, ref?}`: a leg's arrival at one of its outcomes, by the holder (its advance or end; `ref` absent) or as a fact arrival (`ref` required, naming the fact) (R-BTN-39, R-BTN-191) |
  | `std:git.readiness@1`, `std:git.implied@1`, `std:git.output@1`, `std:git.evidence@1` | the sync's attestations, as R-BTN-191 lists them |
  | `std:condition@1` | a handler's input (R-BTN-161) |
  | `std:restart@1` | `{restart, reason, answered_by?}`: what a `suspend` condition resumes with, formed by Baton from its handler's end (R-BTN-162) |
  | `std:api-capacity@1` | `{window_s, remaining_permille, resets_at_min?}`, integers: a quota's window, what remains of it in ‰ (0–1000), and its reset in epoch minutes. The library's one open schema (`additionalProperties` not `false`), because a provider's resource schema refines it by adding fields; a reading's `detail` is bounded by size (R-BTN-76); a course's `rank.mjs` may read it (R-BTN-98) |

  A course extends one by refinement. A published `std:` version never changes; a new field is
  a new version.
- **R-BTN-111 (a course's signature).** A course's **input** is its `start` station's `entry`;
  its **output** is each end station's; its signature also lists the conditions its legs may
  raise (R-BTN-160). `baton course test` prints it, and the repository's stats carry it per
  course.
  - **`spawns`.** A leg that files children declares `"spawns": {"course": <id> | [<id>…] |
    "*", "provides": [<output>…], "lifetime"?: "parent" | "station"}` (`lifetime`: R-BTN-168):
    the course its children run, several, or `"*"` for any course the repository lists other
    than its own. The kit checks that what it provides meets each such course's input; a child
    filed on another course is a script fault. A call leg's `spawns` names the courses it calls
    and is its contract, and the kit also checks each completion station's `entry` against
    each called course's end outputs (R-BTN-165).
- **R-BTN-112 (declarative views; Baton's renderers).** A schema may carry `x-baton-view`:
  `{title?, summary?, fields?: [{label, pointer, as, unit?, max?, tones?}]}`, ≤ 4 KB and ≤ 24
  fields.
  - `title` and `summary` are templates where `{<JSON Pointer>}` is replaced by the value as
    text; nothing else is interpreted. `as` is `text`; `number` (with `unit`); `time` (RFC 3339,
    shown relative and absolute); `gauge` (against `max`); `status` (a string mapped by `tones`
    to `ok`, `warn`, `bad` or `info`); `table` (an array of objects, ≤ 50 rows, columns the
    first row's keys, cells as text); `link` — a link only when it passes R-BTN-92's link rule
    for the ticket's repositories or its host is in the instance's `link_hosts` (an
    administrator's setting, default empty; `https`, no userinfo, R-BTN-157), else text.
  - **One renderer per channel** in the shared library: `plain` (the CLI, a
    `forge-check` summary, a handler course's text), `html` (a handler course's mail: every value
    escaped, inline styles only, no script, image or remote resource) and `ui` (the dashboard,
    as §12.3's rendering rule states). Courses never ship rendering code.
  - **Fallback:** the value's own schema's view, else the nearest up its base chain, else a
    generic rendering of keys and values two levels deep, truncated.
  - Core events are rendered by core's templates, each with one slot for the course's view of
    the relevant value.

### 5.6 Gates a course can set: tags, bars and capabilities

- **R-BTN-60 (tags: the one generic gate a course can set).** A runner's heartbeat carries
  `tags`, course-defined strings (`family:glm`); every posted leg carries `barred_tags`. Core
  refuses a claim or `advance` with `barred-tag` when the runner's tags meet the leg's barred
  tags — those posted, joined by the owner bars in force on that leg (R-BTN-67) — without knowing
  what a tag means.
  - A course bars by what the **claimant** of a leg is, never by what a subagent it spawns
    will be.
  - Tags are self-reported (the sidecar derives them) and bind cooperating runners only
    (R-BTN-66).
  - A tag matches `^[a-z0-9-]+:[A-Za-z0-9._/-]{1,96}$`; at most 32 per runner; free text under
    §12.3.
- **R-BTN-67 (owner bars and required bars).** Two rules in SQLite over tags, set only by
  owners (R-BTN-66).
  - **An owner bar** is `{course, tag, legs, applies: 'claim' | 'claim+advance', starts_at,
    ends_at?, release_holders, reason}`. `course` is a course id or `*`; named `legs` need a
    named course; empty `legs` is every leg. `reason` is a short id that becomes the release
    reason `released:<reason>` (an open set) and may not be one of the closed end reasons (§9),
    so an owner bar's release is never a failed attempt. While in force its tag joins the
    barred tags of the matching legs of the repository's tickets on that course (any, for `*`),
    at claims only or at claims and advances. With `release_holders`, when the bar starts the
    alarm sends `release` to every holder whose runner carries the tag and whose claim is
    running or about to run a matching leg. The heartbeat response carries the bars in force
    for the runner's repositories (`course`, `legs`, `applies`, `starts_at`, `ends_at`,
    `reason`); `POST /v1/sync/observation` hands them to the sync; the fleet view carries them
    (R-BTN-99). Setting or lifting one is an `admin` event and dispatches a sync.
  - **A required bar** is `{course, leg, except?, tag_prefix}`: `course` an id or `*`; `leg` a
    leg name (only under a named course) or `*`, every leg but those in `except`. When a leg it
    covers leaves a ticket's station, or a claim advances into it, and its bars — posted, joined
    at an advance by the holder's `bars` (R-BTN-63) — hold no tag with the prefix, the leg is
    stored `waiting` on `policy`, the advance is refused (`not-eligible`, `policy`), the board
    still moves, and `baton.required-bar` is raised; so is a posted snapshot lacking the prefix
    for a leg a claim ran on the holder's `bars`.
  - Bars cannot catch a bar aimed at the wrong tag, a new leg under a named `leg` (use `*` with
    `except`), or an agent widening an exempt leg's work.
- **R-BTN-142 (bars and renames).** Bars name legs literally, as stored; they do not follow
  `renamed_from`.
  - **Refused files** (R-BTN-69): two stations, or two legs, with the same `renamed_from`; a
    `renamed_from` naming a name the file still uses; a leg's `renamed_from` naming a station or
    a station's naming a leg.
  - **Held files.** A file is held — the previous stays in force and `baton.course-held` is
    raised — when, for any owner bar in force or scheduled or any required bar, it removes or
    renames a leg the bar names, renames a leg named in `except`, or gives a name in `except` to
    a leg that carries `renamed_from` or is new. An owner releases the hold with `baton owner
    bar follow <repository> <course>` (R-BTN-127), which rewrites the stored names to the file's, or by changing the
    bars.
  - An `except` name the file simply drops (no rename) passes; Baton deletes it from the stored
    list and logs an `admin` event.
- **R-BTN-121 (capability types are declared in the course file).** A capability is
  `<type>:<value>`, compared as a string, or the built-in bare `human-operator`.
  - **The course declares its types and roles:**

    ```json
    "capability_types": {
      "vpn":        {"description": "a tunnel to a named network", "values": "^[a-z0-9-]{1,32}$"},
      "credential": {"description": "a named secret in the runner's env", "values": "^[A-Z0-9_]{1,64}$"},
      "key":        {"description": "a provider key the runner holds, a label", "values": "^[a-z0-9-]{1,64}$"},
      "model":      {"description": "a model the runner can reach", "values": "^[a-z0-9.-]{1,64}$"} },
    "capability_roles": {"deployer": ["vpn:corp", "credential:DEPLOY_TOKEN"]}
    ```

    A type id matches `^[a-z][a-z0-9-]{0,31}$`; `values` is a pattern in R-BTN-108's engine; a
    type declared `"from": "executor"` stands for what a runner's executor does, and a capability
    of it counts for a runner only when its heartbeat's `executor.provides` names it (R-BTN-107) —
    never from its declared `capabilities`, whether `runner.json`, `--capabilities` or the grant
    (R-BTN-72) put it there, so a runner cannot claim it by configuration; a
    role expands to its list once (roles do not nest). Baton accepts the file only if every
    capability a leg lists, after expansion, is of a declared type with a matching value, or is
    built-in. A role naming `human-operator` or another role holds the file (R-BTN-157); so does a
    role named a vocabulary name — a capability, `human-operator` or `none` — which would redefine
    that name for legs only. A course may not declare a type named `runner` or `human-operator`.
  - **Built-ins:** `human-operator`, a runner's own statement that a person operates it, which
    Baton cannot verify and grants admit like any capability (R-BTN-58), and the type
    `runner` (R-BTN-133). `credential:<NAME>` names an environment variable a leg receives only
    when it requires it (R-BTN-144).
  - A course's types and roles are served with its course file (`GET
    /v1/repositories/{repository}/courses`) and shown on the **Courses** view, which lists every
    type two courses define differently.
  - **The runner declares what it has** in its configuration (`baton runner start --config`,
    default `~/.config/baton/runner.json`): `{origin, capabilities: [{name, check?: [<argv>…],
    every_s?, lock?: <path>}]}`. A capability with a `check` is declared only while the command exits 0 (run at
    start, before each claim, and every `every_s` seconds, default 300, while idle). Capabilities
    are self-reported (R-BTN-66). A capability may stand for what several things the runner holds
    amount to — `capability:code-generation-llm` for a provider key and an installed harness — and
    the runner declares it when a check that tests them passes; Baton derives nothing (R-BTN-174).
    A capability with a `lock` is a thing one runner on the machine may use at a time: the runner
    declares it only while it holds, or can take, an exclusive lock on that file. It takes the
    lock before it claims, or sends the `advance` into, a leg requiring the capability, and sends
    no such `advance` while it cannot take it (the claim suspends instead, R-BTN-71); a claim answered
    for such a leg while the lock cannot be taken ends `suspended` at once, touching nothing; it releases
    the lock when the claim is refused or answered for a leg not requiring it, and otherwise holds
    it until the claim ends or an `advance` starts a leg that does not require it (R-BTN-178).
  - **Grants** list capabilities (R-BTN-58) and may name `<type>:*`, never a role: the CLI
    expands roles from the latest accepted snapshot, and before signing `<type>:*` prints every
    course defining the type and asks to confirm when their definitions differ (R-BTN-157).

### 5.7 Changing a course

- **R-BTN-22 / R-BTN-65 (course versions).** Each course entry carries two integers.
  - **`version`** is bumped by any commit that changes how a runner must behave on the course —
    any file in its `protocol_files` (`rank.mjs` when listed). For a sourced course it is the
    merged entry's (R-BTN-134), and the check below runs in the source repository on its
    `entry.json`.
  - **`min_runner_version`** is raised only when a runner on an older version would misbehave
    (a changed marker format, a new obligation at a boundary); a change to `rank.mjs` raises it
    only when the course needs every runner to rank alike (R-BTN-98).
  - **Rule 9.** The runner reads each course's `version` from its checkout at startup and
    declares it (`courses`, §14). A runner declaring a ticket's course below
    `min_runner_version` gets no new claim on it (`stale-skills`); the dashboard shows it needing
    a restart from a pulled checkout. Rule 9 is checked at a claim, never at an `advance`, so a
    held claim finishes under its protocol. It gates a course's protocol, never runner features,
    which are `runner:` capabilities (R-BTN-133).
  - **CI check** (post hoc, not a gate): a push to the default branch that changes a
    `protocol_files` file without bumping `version` turns CI red, unless its commit carries
    `Course-Version: unchanged — <why>`; one that raises `version` without raising
    `min_runner_version` turns it red unless it carries `Min-Runner-Version: unchanged — <why
    older runners stay correct>`.
- **R-BTN-64 (in-flight tickets survive a course change).** Where a ticket is, is Baton's
  (R-BTN-39), so a new course file must accept every live ticket's station and queued leg, or
  map them by `renamed_from`; `baton course test` checks every live ticket's position against it
  before it merges.
  - **Renames.** A renamed station or leg carries `renamed_from`. When Baton accepts the file it
    rewrites every active claim's `station` and `leg` to the new names, and from then on resolves
    every old name it meets — an `advance`'s requested leg, `start_path`, `claim_legs` — to the
    station or leg whose `renamed_from` names it. In the same transaction it rewrites every
    per-leg record keyed by an old name to the new one: `leg_attempts`, `ticket_timers`,
    `ticket_blocks`, `leg_needs`, `ticket_next_legs`, `ticket_bars`, `ticket_questions` and a held position's
    `route_leg` and `route_station` (§13). Runs count toward `max_runs` under the resolved
    name; attempts, backoffs, the stalled and expiry instants, blocks and held positions carry over unchanged.
    Bars do not follow renames (R-BTN-142).
  - **Removals.** A claim whose station or leg the new file lacks, even under a rename,
    keeps its lease; its heartbeat says `station: unknown`; the session finishes or abandons the
    work, writes its hand-off and ends `released:course-changed` — not a failed attempt, needing
    no confirmation — and the ticket waits `course-changed` until the owner adopts it at a station
    the new file has (R-BTN-39). Removing a
    station or leg must raise `min_runner_version`; `baton course test` fails a change that
    does not.
  - A ticket keeps no record of the course version it started under: its course history is the
    record (R-BTN-39).
- **The test kit.** `baton course test <repository root> <course> [--config <file>]
  [--bindings]`, run by a home repository's CI on a PR that changes `.baton/` (how that job is
  configured: R-BTN-133), starts a local Baton, posts the PR's board with the proposed `.baton/`,
  checks every live ticket's position against it (R-BTN-64), fails when one no longer stands on
  the graph and no `renamed_from` maps it, and runs the generic scenarios (§15, S-BTN-28) against the course. It needs no
  production access. It also:
  - fails a removed station or leg without a raised `min_runner_version` (R-BTN-64);
  - checks contracts statically: each required input's producer lies on every route from
    `start` to each of the consumer's `from` stations, the producer's version is in `accepts`,
    and each schema exists, is valid and refines its base (R-BTN-82, R-BTN-108);
  - checks every `entry` schema is posted and every arriving leg's contract can meet it
    (R-BTN-109), `spawns` and call contracts (R-BTN-111, R-BTN-165), and that named stations in
    `requires.tickets` and completion tables exist in the selected or called courses
    (R-BTN-120, R-BTN-165);
  - checks overrides (R-BTN-131) and leg scripts and their imports (R-BTN-133);
  - fails a stub whose close accepts what it should not: a PR course's start leg must fail an
    agent that exits 0 with no PR (B-81), and a record course's close (R-BTN-131) must fail a ticket its leg
    mangled — no heading for the leg, a broken item schema, a machine field of the wrong shape —
    naming the rule (B-100);
  - warns where the owners' bounds cut a course's retry policy (R-BTN-122); refuses a
    `deadline_s`, `stalled_s` or `expires` outside its range, naming the leg and the field
    (R-BTN-167, R-BTN-116); refuses a `suspend` binding to a course that does not end by a
    person's leg or its expiry (R-BTN-161);
  - prints the signature (R-BTN-111), the capability types and roles (R-BTN-121) and, for a
    check course, its end stations for the owners' `conclusions` (R-BTN-114); with
    `--bindings`, each raisable condition type's resolution and scope (R-BTN-161).
- **A course can see how it performs.** `GET /v1/repositories/{repository}/stats`, readable by
  any key granted on the repository (R-BTN-58), returns over a window: per station and leg, how
  long tickets waited and legs ran; claims by end and detail; suspensions by station and what
  they waited on; `off-graph` transitions; each course's signature and queue
  depths against bounds. Aggregates and ids only — no profiles, no reports.

### 5.8 The standard courses

- **R-BTN-131 (the standard courses).** The baton repository ships course directories at
  `src/defaults/courses/<id>/` (R-BTN-134), adapted from docs' skills with docs-specific content
  left out. A repository scaffolds one with `baton repo init --course <id>` and needs no course
  code of its own. "Standard" names where they live, not a privilege: the CLI reads them as any
  source. They assume no particular deployment and run under every preset; a
  course that relies on a deployment's own architecture and threat model (reviewers on clean,
  separate domains, tests in a check leg) is that deployment's,
  kept and sourced from its own repository: Fieldhouse's is FLDH-41. Their shared code is copied into each directory by `npm run courses`, checked in, and
  checked current by the baton repository's CI. Their legs require `runner:leg-trees`.

  | Course | Legs (`from` → `to`) | Ends | Reads |
  |---|---|---|---|
  | `create-pr` (the default) | `implement` (`filed` → `pr-open`); `review` (`pr-open`, `fixed` → `reviewed`, `max_runs` 3); `fix` (`reviewed` → `fixed`, `max_runs` 2); `adjudicate` (`reviewed` → `adjudicated`); `merge` (`reviewed`, `adjudicated` → `merged`); and the fact legs `reviewed-by-hand` (`pr-open`, `fixed` → `reviewed`, `pr-verdict`) and `merged-by-hand` (`pr-open`, `fixed`, `reviewed`, `adjudicated` → `merged`, `pr-merged`) | `merged` | PRs |
  | `review-pr` | `review` (`requested`, `changes-requested` → `approved` \| `changes-requested`, `max_runs` 3); `conclude` (`requested`, `changes-requested` → `concluded`) | `approved`, `concluded` | PRs |
  | `bug-report` | `trace` (`reported` → `traced`); `origin` (`traced` → `explained`); `dedupe` (`explained` → `new-cause` \| `duplicate`); `file` (`new-cause` → `ticketed`); `fold` (`duplicate` → `folded`); `prevent` (`ticketed`, `folded`, `prevented` → `prevented`, `max_runs` 3); the fact leg `merged-by-hand` (`prevented` → `merged`, `pr-merged`) | `merged`; `closed` by `close-pr` | PRs |
  | `draft-ticket` | `research`, `draft`, `check` (`requested` → `researched` → `drafted` → `checked`; `check` also leaves `checked`, `max_runs` 3); `merged-by-hand` (`checked` → `merged`, `pr-merged`) | `merged`; `closed` by `close-pr` | PRs |
  | `decision` | `prepare` (`raised` → `asked` \| `carried`, the latter when the question is already settled); the person leg `answer` (`asked` → `answered`, R-BTN-116); `carry-out` (`answered`, `carried` → `carried` \| `asked`, `max_runs` 3); `merged-by-hand` (`carried` → `merged`, `pr-merged`) | `merged`; `closed` by `close-pr` | PRs |
  | `build-app` | `stages` (`requested` → `planned` \| `abandoned` \| `stopped`, a call leg over `draft-doc`); `file` (`planned` → `building`, a call leg); `verify` (`building` → `verified` \| `building` \| `stuck`, a call leg, `max_runs` 3); the person leg `decide` (`stuck` → `building` \| `stopped`, `asks: owner`); `report` (`verified`, `reported` → `reported`, `max_runs` 3); `merged-by-hand` (`reported` → `shipped`, `pr-merged`) | `shipped`, `abandoned`, `stopped`; `closed` by `close-pr` | children, PRs |
  | `draft-doc` | `write` (`requested`, `written` → `written`, `max_runs` 3); `merged-by-hand` (`written` → `merged`, `pr-merged`) | `merged`; `closed` by `close-pr` | PRs |
  | `create-spec` | `converse` (`requested` → `spec-open`, the owner's conversation, `arrives: {fact: pr-opened}`); `review` (`spec-open` → `reviewed`, `max_runs` 4); `address` (`reviewed` → `spec-open`, the owner's conversation, `arrives: {fact: pr-pushed}`, `max_runs` 3); `adjudicate` (`reviewed` → `adjudicated`); `merge` (`reviewed`, `adjudicated` → `merged`) | `merged` | PRs |
  | `spec-to-tickets` | `decompose` (`reading` → `drafted`); `check` (`drafted` → `checked`); `file` (`checked`, `written` → `written`, `max_runs` 3); `merged-by-hand` (`written` → `merged`, `pr-merged`) | `merged`; `closed` by `close-pr` | PRs |
  | `epic` | R-BTN-124 | `integrated`, `abandoned` | children |
  | `branch` | R-BTN-96 | R-BTN-96 | branches |
  | `ask`, `deliver`, `announce` | condition handlers (R-BTN-169): `ask` asks through the person leg `answer` | R-BTN-169 | — |

  A course whose course file carries `starts_from: request` (a closed set: `request` alone) is entered by `baton ticket request` (R-BTN-127) — `create-spec`, `build-app` and `spec-to-tickets` do; an ordinary course keeps its hand-filed tickets. `baton ticket request "<one sentence>" --course <course>` files ONE request ticket into `<items>/<ID>.mdx` (§2f R-BTN-74's source; the id from the repository's `ticket-<prefix>` sequence — the request id IS the request ticket's id, the prefix the commonest among its ticket files — taken as every allocator below does, R-BTN-195), the sentence as its `title` and `description`, `course:`, `status: available` and `tags: [request]`, and a `## Status` with the `_filed` line (R-BTN-74), and pushes it as one commit — `<ID>: request — <the sentence> — <course>` — straight to the default branch (§2f; `--branch`, else the checkout's `origin/HEAD`, else `main`), made in a throwaway worktree so the caller's branch, HEAD and working tree are untouched and retried on a moved head, up to six tries. It is a repository command, not an API call — it asks Baton nothing but the id (R-BTN-195). Where the forge refuses the push because the branch is protected (the CLI's adapter for the forge `--forge` names, else `github` where `origin`'s host is `github.com`, recognises that refusal by the forge's own message: GitHub's `GH006` protected-branch refusal, or a `GH013` ruleset refusal naming a pull-request or update rule and never secret push protection; GitLab's `not allowed to push code to protected branches`; Gitea's `Not allowed to push to protected branch`), it pushes the same commit to `baton-request/<ID>`, or takes the next free id when that branch exists — a branch no `branch_pattern` may match (R-BTN-190), so the request's PR is never one of the new ticket's PRs and no leg continues it (R-BTN-25) — opens a PR from it with the caller's forge credential and prints its URL. With no forge credential it prints the pushed branch and exits non-zero. On a `git` forge, which has no adapter, and for any other refusal — `refs.other` refusing the side branch to a runner under `protected` among them — it reports git's own words (R-BTN-74), opens nothing and exits non-zero. Otherwise the push triggers the sync (§7.1), the Baton places the ticket at the course's `start` with its `start_leg` queued (R-BTN-39), and the next claim starts the course (§6.1). It refuses a course `.baton/baton.json` does not list (R-BTN-74's sync would refuse the ticket) and a course without `starts_from: request`, each as one line.

  - **A wait for a person's answer is a person's leg** (R-BTN-116), answered by a
    `std:decision@1`: `decision`'s `answer` and `build-app`'s `decide`. Where the policy admits `sync` for `std:decision@1`, the ticket's `answer:`
    on the default branch (a sync-local field of the markdown source, read by the station
    function and never posted, R-BTN-74; never applied unless the owner gave it) is attested as
    one. Approving a document is not an answer: it is merging the PR that holds it.
  - **The PR courses.** A ticket's PRs are those in `prs:` plus same-repository PRs, open or
    merged, whose head matches `branch_pattern` or `previous_branch_pattern` (R-BTN-51,
    R-BTN-141), in the home or a `repos:` repository (R-BTN-140), and no other. Several PRs are
    one change; a leg over several counts once on the path. `create-pr`: no PR is `filed`; a PR
    closed unmerged counts as none; `review` waits on `ci` until every open PR's checks finish;
    a **verdict** is the forge's review state or a pusher's (R-BTN-139) comment whose first line
    is `<!-- baton:verdict approve|changes -->`, queuing `merge` or `fix`; a push after it
    reaches `fixed`; all merged is `merged`; when fixes run out and the last round asks for
    changes, `adjudicate` is queued if the file has it, and a pusher's `<!-- baton:adjudicated
    merge|owner -->` is its answer. Its `run-tests` gate runs no agent: the stub runs the course
    file's `test_script` on the PR's head, and the script's own exit is the verdict, green
    queuing `review` and red `fix`; a run that never reached the tests is no verdict and fails
    the leg (`released:cannot-finish:transient`) with no marker — dependencies declared and none
    installed, the shell's 126 or 127, npm's missing script, npm that cannot start, or a run that
    outlives the gate's bound. A `fix` run from the gate's red (`pr-open`, `fixed`) must push:
    when the ticket's PR branch heads are where they were before its agent ran, it fails the leg
    the same way and reports no position, since the gate would test the same tree again; from
    `reviewed`, where a fix may answer the findings without a push, it is unchanged.
    `review-pr` reviews a PR named in `prs:`: each pusher's
    verdict is a round; after changes the next waits on `author` until a push; on close or when
    rounds run out `conclude` is queued, and a pusher's `<!-- baton:concluded -->` is that leg.
    A commenting leg's answer line may name its PR (`<answer> <PR URL>`; `conclude`'s the URL
    alone); `close` comments there, else on the checkout branch's PR.
  - **One ticket, one PR, one merge.** Every standard course that writes a ticket's work is a PR
    course. Its legs commit their records and outputs on the ticket's branch (`branch_pattern`,
    continued by R-BTN-25), the first push opens the ticket's PR, and the course ends at `merged`.
    A runner's `merge` leg (`create-pr`, `create-spec`, under `merge.*`, R-BTN-182) or the fact leg
    `merged-by-hand`, the owner merging it, takes it there. A course that needs several approvals
    is several tickets (`build-app`, below). No leg of a record course (below) writes to the
    default branch, under any policy. A call leg's children are not a record: they are filed as
    R-BTN-165 and `tickets.created` say, directly under `filed` and proposed under `proposed`.
    - **The record.** `bug-report`, `draft-ticket`, `decision`, `spec-to-tickets`, `draft-doc`
      and `build-app`'s `report` (the record courses' legs) write each leg's record under its own `## <leg>` heading in the ticket's body,
      on the branch: a note for people, and the input the next leg reads from the branch's
      fetched head (R-BTN-5). Their outputs go on the same branch:
      - a new ticket file, its id taken as R-BTN-195's allocator hands it out: the next number
        of the repository's `ticket-<prefix>` sequence, asked with the floor the CLI reads — the
        default branch, `archive/` and the heads of the repository's open branches: every branch
        matching a listed course's `branch_pattern`, and every `baton-request/*` and
        `baton-ticket/*` branch (R-BTN-131), with a commit not reachable from the default branch
        (R-BTN-96). Every allocator does the same: `baton ticket request`, `baton ticket new`
        and the source's `file` export. A session without Baton — no key, none configured,
        unreachable, `--offline` — scans instead (the next free id across the same branches) and
        says so; a collision that still happens is caught by the sync's duplicate-id refusal
        (R-BTN-74), and the owner renumbers;
      - a document.

      A leg never edits another ticket's file. `bug-report`'s `fold` records the duplicate as
      `duplicate_of:` (the existing ticket's id) in its own ticket. `duplicate_of:` and
      `document:` are fields the standard item schema carries; a home whose own schema omits them
      adds them with the course. No record leg writes `answer:` on the branch.

      Where the ticket is, is Baton's (R-BTN-39): `close` writes no machine state into the
      ticket, and a `station:` or `next_leg:` field is not read. Before committing, the close
      validates the ticket: its frontmatter against the repository's item schema
      (`item.schema.json` beside the tickets, read from the default branch) and the leg's own
      heading. A violation fails the leg, naming the rule. Their station functions post readiness
      from the ticket's facts on the branch's head (its sections, its children), finding the file
      by its `id` wherever the branch holds it (under `archive/` once archived). `prs:` and the
      ticket's other filter fields are read from the default branch only.
    - **The owner's merge is the approval.** `merged-by-hand` waits on the `owner` and arrives
      when they merge the PR, exactly as `create-pr`'s does (R-BTN-192). Which merge counts, the
      owner's own commits on the PR, and what a hand merge may change are that rule's, for every
      course alike (B-154).
    - **Sending back and rejecting.** The owner may send the last writing leg back with
      `baton ticket route` (R-BTN-83) to its own station, within its `max_runs`, or withdraw the
      ticket in git on the default branch (R-BTN-168). Each record course names one `cancel`
      leg, `close-pr`, leaving every station from the first writing leg's `to` on and reaching
      the end `closed` (R-BTN-168). It runs on an ordinary runner, closes the ticket's own PR
      unmerged and deletes the ticket's own branch, and succeeds when both are already gone. So a
      withdrawn, superseded or cancelled ticket leaves no PR whose merge would land its work. Deleting a ticket's own branch is not R-BTN-182's
      trusted branch deletion, which covers branches a runner does not hold.
    - **Closing in git.** Until B-154 lands, the merge closing a ticket in git and the arrival it
      carries are read in the same run; B-149 waits for it. The leg whose position queues
      `merged-by-hand` sets the ticket's
      `status:` to `done` and moves its file to `archive/` on the branch, so the owner's merge
      closes it in git; a run reporting any other position leaves or restores the file live
      where it was. How Baton sees the arrival of a ticket its own merge closed is
      `merged-by-hand`'s rule (B-154).
    - **`decision`.**
      - `prepare` writes the packet on the branch and asks through Baton. A settled question
        goes straight to `carried`, queuing `merged-by-hand`.
      - The answer reaches `carry-out` as its input (R-BTN-116), `required: false`.
      - `carry-out` records what was decided and files tickets for anything to be done (a
        setting, a reply, another merge); it does none of it itself. Finding the chosen option
        gone, it reports `asked`.
      - Where the policy admits `sync` for `std:decision@1`, a re-ask is answered by a changed
        `answer:`, since an unchanged one is the same `ref` and moves nothing.
    - **Plain git** (`forge: git`). The ticket's branch stands for the PR, and the CLI picks the
      facts adapter by the forge of the repository it reads (R-BTN-96): the home's own is
      `branches` there, and a `code_repos` entry's is its own forge, `prs` elsewhere. What
      counts as `pr-merged` on plain git is B-154's.
  - **The PR courses' facts** below say what each course reads. Under R-BTN-39 they make legs
    `ready` or `waiting`, and settle a leg that declares `arrives` (R-BTN-192); they never place a
    ticket. A verdict a holder's leg writes is its evidence; the holder's `advance` or end moves
    the ticket. What a human does on the forge moves it through the courses' fact legs:
    - `create-pr` adds `reviewed-by-hand` (`from: [pr-open, fixed]`, `to: reviewed`,
      `arrives: {fact: pr-verdict}`) and `merged-by-hand` (`from: [pr-open, fixed, reviewed,
      adjudicated, human-merge]`, `to: merged`, `arrives: {fact: pr-merged}`): a pusher's verdict
      under `cooperative`, or the human-only identity's where the policy admits no `sync` arrival
      (R-BTN-192), that no claim of the ticket wrote; and a merge no `merge` leg made, a human's
      landing of a control path at `human-merge` included (R-BTN-184). A runner's `review` and
      `merge` stay runner legs.
    - `create-spec`'s `converse` declares `arrives: {fact: pr-opened}` and `address`
      `arrives: {fact: pr-pushed}` (below).
  - **`spec-to-tickets`** (B-99) takes one merged specification — entered by `baton ticket request`
    (`starts_from: request`), the sentence naming the spec; a `create-spec` conversation's merged
    PR is the usual input — and files its child tickets. `decompose` drafts one ticket per spec
    section or numbered decision into the request under its own heading, each with its tests and
    exit criteria drafted from the spec's own words; `check` holds the set against the spec (every
    requirement covered exactly once, no ticket without a section, dependencies drawn as the
    spec's order implies) and fails rather than covering a gap; `file` writes the children
    `parent:`-ed to the request (R-BTN-86) on the request's branch, and the owner's merge files
    them all. The owner deciding against filing closes the PR and withdraws the request — a ticket status, not a course station: the filed
    children are ordinary tickets on their own courses.
  - **`build-app`** is a parent ticket, as `epic` is (R-BTN-124). Its only PR is `report`'s, at the end.
    - **`stages`** is a call leg over `draft-doc` (R-BTN-165). Its script files four children,
      each naming its document's path in `document:` (`product/<request id>/PRODUCT.md`, …),
      one per document under the request's `product/<request id>/`: `PRODUCT.md` (numbered acceptance
      criteria), `DESIGN.md` with mock-ups, `ARCHITECTURE.md`, and `PLAN.md` (every ticket and the
      criteria it makes pass). Each child names its document, and each `depends_on` the one
      before it, so it waits until that one is done. Each child is one `draft-doc` ticket: `write`
      drafts the document, with its open questions and recommendations, on the child's PR; the
      owner settles them in the stage's conversation, refining the PR; and their merge is the
      stage's approval.
    - **`file`** reads `PLAN.md` at its claim's `snapshot_sha` (as merged, the owner's
      refinements included), declaring no `called` input, and files its tickets as children of
      the request,
      each on the course the plan names (`create-pr` by default). Under
      `tickets.created: proposed` they are proposed (R-BTN-165, R-BTN-180).
    - **`verify`** checks every criterion against the running build. It reports `verified`, or
      files one fix child per failing criterion, the finding in its body, and settles at
      `building` again once they close. A third verification that still fails files nothing and
      reports `stuck`, where the person leg `decide` (`asks: owner`, R-BTN-116) waits: its
      options are `building`, to verify again once the owner has intervened (the answer starts
      `verify`'s run count again, R-BTN-63), and `stopped`.
    - **`report`** (`verified` → `reported`, `max_runs` 3) is the parent's one record leg: it
      writes `VERIFY.md` beside the documents and closes the request (`status: done`, archived)
      on the request's own branch, and `merged-by-hand` (`reported` → `shipped`) ends it. A
      request that ends `abandoned` or `stopped` is listed under Needs you until the owner
      withdraws it in git.

    ```json
    "stages": { "from": ["requested"], "kind": "call", "spawns": {"course": "draft-doc"},
                "to": { "planned":   {"of": "all", "done": true,      "next": "file"},
                        "abandoned": {"of": "any", "withdrawn": true},
                        "stopped":   {"of": "all", "closed": true} } },
    "file":   { "from": ["planned"],  "kind": "call", "spawns": {"course": "*"},
                "to": { "building": {"of": "all", "closed": true, "next": "verify"} } },
    "verify": { "from": ["building"], "kind": "call", "spawns": {"course": "*"}, "max_runs": 3,
                "to": { "building": {"of": "all", "closed": true, "next": "verify"},
                        "verified": null, "stuck": null } },
    "decide": { "from": ["stuck"], "to": ["building", "stopped"], "kind": "person", "asks": "owner" }
    ```

    A stage the owner withdraws ends the request `abandoned` at once, and the stages still open
    are superseded (R-BTN-165). `stopped` is the table's closing catch-all, an end like
    `abandoned`. To redo a stage after its merge, the owner files a new `draft-doc` ticket for the
    document. Under `tickets.created: proposed`, each stage and each plan ticket is a proposal the
    owner approves before it is claimable, as any call leg's child is (R-BTN-165, R-BTN-180).
  - **A wait outside the claim suspends:** a leg whose next leg waits on someone the claim
    cannot wait for returns `suspend: true` with its pair, ending the claim there (R-BTN-72).
  - **The owner's conversations are fact legs.** `create-spec`'s `converse` (`requested` →
    `spec-open`) and `address` (`reviewed` → `spec-open`) are the owner's own sessions, which no
    claim runs: `converse` declares `arrives: {fact: pr-opened}`, `address` `arrives: {fact:
    pr-pushed}`. Queued, each is `waiting` on the `owner`, and the
    owner starts the session from its instructions. `converse` arrives when the PR the
    conversation opens appears; `address` when the push that lands the amendment does. A PR
    closed unmerged is no arrival, so the leg keeps waiting until the owner reopens it or files a
    fresh request. No marker or frontmatter records that a conversation is under way. `create-pr`'s `implement` leaves no marker: it is headless and
    opens its PR inside the claim, so it leaves the PR itself, which `verify: "pr"` refuses a claim
    without.
  - The standard courses declare `error.no-answer` (`interrupt`, `retryable: false`, R-BTN-162).
  - **The agent command.** A leg's agent command is the first of these present: the home's
    `.baton/baton.json` `legs.<course>.<leg>.agent_command` (R-BTN-51), which lets a home change a
    sourced course's command (R-BTN-134); the leg's `agent_command` in its course file
    (R-BTN-69); the home's top-level `.baton/baton.json` `agent_command`, the default for every
    leg; and the harness command `baton runner start --harness` fills when none of these names one
    (B-83). The `.baton/baton.json` `agent_models` map's replacement of the command's `--model`
    words applies to whichever command was chosen. The runner passes the leg's agent command to every executor in
    `brief` (R-BTN-107), and the stub runs it inside the leg's session under every executor. A
    repository's `agent_wrapper` — or `BATON_AGENT_WRAPPER` in the leg's environment, which wins
    — is one more command whose words precede the agent's argv (B-95), inside the leg, under every
    executor: Baton composes it and builds nothing in its place (no capture, upload, retention or
    redaction), and the instruction file's header names the precedence. The spawn is shell-free
    (B-84): each command string splits into words as `sh` would — quotes, no substitutions — and
    runs as `execFile(command, args)` with the ticket id, the leg and the checkout appended, stdin
    never an open pipe (a closed fd — nothing to read), stdout and stderr captured pipes. The
    instruction file's header carries that contract for `agent_command` authors, with the
    completion rule it closes: the command's exit **is** the agent's, so a harness whose client
    can exit before its work (a client of a background service) must run its session in process
    (`opencode run --standalone`, or the equivalent) — else its truncated output fails the leg
    while an orphaned session outlives and out-posts its claim. An agent's completion is its
    **exit or its silence**, whichever comes first (B-108): the stub's wait for the agent ends at
    the earliest of the agent's exit, the idle bound and the leg's ceiling (the stubs, below).
  - **Stubs** run the leg's agent command with `BATON_COURSE`, `BATON_LEG`,
    `BATON_TICKET_FILE` and `BATON_INSTRUCTIONS` (the source's `legs/<leg>.md` or the home's
    override, at the claim's snapshot); a result-dependent leg reads the agent's last line
    (`BATON_ANSWER`) and checks it against the course's values. The read is tolerant of prose and
    strict about the answer (B-85): scanning backwards from the output's last non-blank line, the
    first line that **begins** with one of the course's values as a whole word is the answer, with
    at most one PR URL after it on that line (prose before or after it fails nothing); a value
    word mid-line only is not an answer, and no such line fails the leg, naming the value wanted
    and the last line read. A leg whose stub claims a PR on
    the forge — `create-pr`'s `implement` — verifies it there before returning its position (B-81):
    an open PR on a branch its course's `branch_pattern` maps to the ticket, in the checkout's
    repository or one the ticket's `repos:` names (B-29), and the checkout's branch, when it feeds
    such a PR, a head the PR contains — the review reads what is pushed. What cannot be verified
    fails the leg naming what was looked for; the stub reports, never retries. The test kit fails
    such a stub that returns its position for an `agent_command` exiting 0 with no PR.
    - **The stub's wait for its agent ends three ways (B-108)** — at the earliest of the agent's
      exit, the **idle bound** (fifteen minutes of silence across every activity signal the stub
      can see) and the **absolute bound** (five hours of the leg, whatever the agent is doing).
      Liveness is a fact read from every signal, never a guess from one: a harness CLI may
      legitimately print nothing on stdout until it exits (the answer protocol reads the last
      line; some clients buffer the whole run), so the signals are the agent's stdout, streamed
      and timestamped; the wrapper's log, when the repository runs one (the example tees to
      `.baton/logs/<ticket>-<leg>.log`, whose mtime is streamed activity even when the stub
      cannot see the pipe); and the harness's own activity record, when the agent's command
      names a harness the stub knows (`opencode`'s session store, `claude-code`'s project
      directory), keyed by the working directory the stub spawned the agent in — the store's
      newest write is the agent's activity, and no session id is needed. Idle is silence on
      **all** of them: a live signal anywhere vetoes the conclusion however long the rest stay
      quiet, and before the absolute bound a working agent is never touched, however long it
      runs. The absolute bound is the one duration-based conclusion — the leg's ceiling, which a
      chatty agent that never converges cannot idle past. Either bound concluding is the same
      act: the stub kills the agent (SIGKILL to the child alone; the stub is the parent), takes
      the received stdout as the agent's output, and proceeds exactly as an exit would — the
      last-line contract, the forge verification, the checks judging the work as it stands and
      refusing what is not. The leg's result records the conclusion with its cause —
      `agent_concluded_idle` with the signals that were quiet, `agent_concluded_absolute` — so
      the close and the review round can see how the leg ended; Baton is told none of it (no
      condition raised, no deadline taken, nothing posted: the server learns the leg ended as it
      learns every leg, by the claim's end — the owner, 2026-10-22). Both bounds are the stub's
      constants, a course's to raise or lower in its copy of the file. While a leg runs, each of
      the runner's beats logs its duration and the age of its newest activity signal
      (R-BTN-72), so an operator watches a wedge form instead of silence.
  - **Overrides replace `run`, never `close`.** A home's `legs/<leg>.run.<ext>` exports
    `run(ctx, standard)`; the leg script imports it from the leg tree at the claim's snapshot and
    calls it instead of its own `run`, keeping its own `close`. Its position must be an edge
    (the runner refuses one before `close`). The kit fails an override naming no leg, exporting
    no `run`, or beside a leg script that does not load it from this course's path. An override
    keeps the leg's contract `version`; `snapshot_sha` names the bytes that ran.
  - **A runner serves every course its capabilities serve, one leg at a time.** `baton runner start`
    declares every course its home checkout declares (`--home`) — each at its version, rule 9 per
    course — and `--course <id>` narrows that to one, a machine serving a subset; a `--course`
    naming a course the home does not declare is refused at startup, and so is a home held by
    another live runner (`baton-runner.lock` in its git directory). The claim answer's
    `course_id` names the ticket's course, which the runner loads from the claim's
    `snapshot_sha`: consecutive claims of one runner — a `create-spec` `converse` and the next
    claim's `create-pr` `implement` — run their own course's graph and scripts with no restart
    and no second clone. Its only parallelism limit is one leg at a time, at least for now (rule
    3, one claim per worker).
- **R-BTN-190 (leg state: in the forge's conversation, or on a side branch where there is no
  forge).** State one leg hands the next that must never reach the default branch — review rounds
  and their answers (B-101) — goes where the PRs the course reads live; every claim response
  carries which (`leg_state`), and no policy knob chooses it (B-165's review default). It is
  `forge` when the home is on a forge **or** the claimed ticket's course reads PR facts
  (`facts: ["prs"]`, R-BTN-134), and `branch` otherwise.
  - **`forge`**, on GitHub, GitLab and Gitea, and on any home whose claimed ticket's course
    reads PR facts — a `git` home's PR course among them: the rounds are the PR's conversation,
    on whichever forge holds the PR, as R-BTN-131's PR courses already read and write it, and
    the rules below about the leg-state branch do not apply.
  - **`branch`**, where `forge` is `git` and the claimed ticket's course reads no PR facts: the
    rounds live on the ticket's **leg-state branch**, as follows. The courses using it are the
    `branch` course (R-BTN-131) and any course whose legs pass rounds to one another.

  On a `git` repository:
  - **A reserved namespace, an orphan history.** A ticket's leg-state branch is
    `baton-legs/<ticket id>`, the ticket's own id byte for byte (a ticket whose id is not a valid
    ref segment, such as one containing `..`, has none, and its rounds are refused). It is an
    **orphan** branch: its first commit has no parent and every commit's tree holds only
    `.baton-legs/`, so it shares no history with the work, no forge opens a PR from it, it holds no
    workflow to run, and merging it by hand needs `--allow-unrelated-histories`. No
    `branch_pattern` may match `baton-legs/*`, `baton-request/*` or `baton-ticket/*` (R-BTN-131,
    R-BTN-74; the course
    validator refuses one that does), so
    no reader of `branch_pattern` — a station function, R-BTN-25's continuation, the PR courses'
    mapping, the branch-holder query — ever sees it, and no work branch's name collides with it.
    `runner`, `trusted-runner` and `human` may push it, a constant no policy changes (R-BTN-180).
  - **Not a work branch.** A push to it is no write in R-BTN-183's sense: it reports no range, is
    exempt from continuity and foreign-commit resets, and does not make a leg a writing leg
    (`std:wrote@1`, `std:ran@1`), so a review leg that writes its round stays independent.
  - **Its layout.** Its tree holds only `.baton-legs/<ticket id>/<leg>/<claim nonce>/…`, the
    ticket id byte-equal to the branch's. Each segment below `.baton-legs/<ticket id>/` matches
    `^[a-z0-9][a-z0-9._-]{0,63}$` and none case-folds to a harness configuration file R-BTN-184's
    floor names (`claude.md`, `agents.md`, `opencode.json`); entries are mode `100644` blobs. A
    claim writes only its own `<leg>/<claim nonce>/` subpath. A reader skips, and reports, any entry
    outside this layout. Whoever can push the ticket's branches can write here, so the content is
    unauthenticated data and its attribution advisory; nothing that gates reads it.
  - **Read as data, never checked out.** What a leg reads there reaches a model only as quoted data
    (§12.3), and nothing a trusted leg acts on comes from it (R-BTN-187). **The runner's part:**
    it reads the branch with `git fetch` of that one ref and `git cat-file`, and never checks it
    out. **The deployment's part** (§12.8): that an agent with a shell does not fetch or check it
    out itself.
  - **Who reads it.** Address and fix legs may. A review leg whose verdict can count toward
    `merge.reviews` (`approves: true`) and an adjudicate leg, which decides a merge, read nothing
    from it, so content planted in one round never reaches another counted reviewer or the merge
    decision. **The runner's part:** such a leg's claim fetches only its work ref. **The
    deployment's part:** that the leg holds no forge or network access to fetch it otherwise.
  - **Verdicts are not leg state.** The `branch` course's verdict commits (R-BTN-131) carry no files
    and stay on the work branch where the policy admits the sync's attestations of them. Where it
    does not (R-BTN-187), verdicts are attestations by their reviewers and the course writes no
    verdict commit, so none moves an attested head.
  - **Deleted when the ticket closes.** The leg that closes the ticket, or its withdrawal, deletes the
    leg-state branch. One left behind is harmless, since nothing merges it.

  Under either value:
  - **The work branch never carries it.** The merge runner (R-BTN-183) refuses a work branch whose
    merge result, or any commit in the ticket's ranges, holds a path segment, at any depth, that
    after NFC normalisation and case folding is `.baton-legs`. No work branch's name may begin
    `baton-legs/`.
  - **Detected if it lands anyway.** Such a segment anywhere in the default branch's tree raises
    `baton.leg-state-landed`, a `notify` condition whose `detail` holds the count of entries and the
    ids of the repository's existing tickets among their subdirectory names, never paths or other
    text. Where the repository has a protection checker (R-BTN-180), only its reading, reported in
    its heartbeat's `protection` as `legs: {count, tickets}`, raises and closes the condition;
    elsewhere the sync's reading, posted with the board as `legs_landed: {count, tickets}`, does,
    and the condition is advisory, since any holder of the sync key can post. The check reads the
    tree, not history. On plain git, `baton repo protect --print` adds a `pre-receive` rule refusing
    default-branch updates that add such a segment.
- **R-BTN-124 (the planning course, `epic`).** `epic` turns a request into child tickets and
  integrates them, with no coordinator in core. Start `filed`; ends `integrated`, `abandoned`.
  - `plan` (`filed`) and `replan` (`planned`, `max_runs` 2) are call legs (R-BTN-165) over
    `create-pr` (`"spawns": {"course": "create-pr"}`). Each script writes its children git
    first, each naming the epic as `parent` (R-BTN-86); `plan`'s output is the plan, a `std:git.file@1`. Both have the completion table,
    in order:

    ```json
    { "built":   {"of": "all", "done": true,   "next": "integrate"},
      "planned": {"of": "all", "closed": true, "next": "replan"} }
    ```

    When every child closes `done` the first entry settles at `built`; when any was withdrawn,
    the call settles at `planned` once all have closed, and `replan` files replacements and
    settles the same way.
  - `replan`'s table also has `"abandoned": null` (R-BTN-165), so it may file no child and
    report `abandoned` as an ordinary outcome, not a call settlement.
  - `integrate` (`built` → `integrated`) is an ordinary agent leg that reads the children's
    results through git.
  - Its stubs call the leg's agent command (R-BTN-131); the planning prompt is the repository's. A
    repository that wants the plan approved first adds a person's leg (R-BTN-116).

### 5.9 Capabilities are the runner's statement

- **R-BTN-174 (capabilities are matched by name; what a runner has is its own statement).** Core
  matches the capabilities a ticket and its leg require against what a runner declares, by name:
  `<type>:<value>` compared as a string, or the bare `human-operator` (R-BTN-121); a grant's
  `<type>:*` admits every value of the type. It holds no
  ontology, evaluates no program and derives nothing. A leg may require an ability
  (`capability:code-generation-llm`) or a model (`model:claude-opus-5-5`), and a runner that has
  it — because a key it holds and a tool it has installed together amount to it — declares it.
  How a runner reaches that conclusion is its own: the CLI runner declares a capability while its
  `check` passes (R-BTN-121), and a check may test anything the runner holds. Baton never stores a
  credential, learns what a name means, calls a provider or checks a declaration: every
  capability rests on the runner's own statement (values 12).
  - **A grant bounds what counts.** A runner's capabilities for a repository are its declared
    ones and its executor's `provides` (R-BTN-107, R-BTN-121) that its grant there admits
    (R-BTN-58), together with its declared `runner:` capabilities (R-BTN-133). Rule 4 reads them (§6.6), `fleet_capabilities` counts them
    (R-BTN-75), and the model (R-BTN-68) receives them as the runner's capabilities. A grant
    bounds what a runner declares, never what a capability means: a runner that declares an
    ability it lacks is only offered legs it cannot finish (R-BTN-66).
  - **Which model and which key a leg uses** is the course's, never core's (§6.10).
