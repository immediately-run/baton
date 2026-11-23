---
title: "Proposal — courses: sources, fields, the standard courses' PR shape, and courses that do not ship"
description: "The parts of BATON_SPEC §5 that are designed and not built: course sources in other repositories, course-file fields the validator does not accept yet, the cancel leg, the standard courses as PR record courses with fact legs, the courses that do not ship, runner capability checks, the leg-state branch, and bars that hold a course file."
---
**Status:** proposal — not built; moves into BATON_SPEC §5 when built (tickets B-40, B-62, B-65, B-149, B-154 among them)

This page holds designs. Nothing here binds Baton as built. What is built is in
[BATON_SPEC §5](../BATON_SPEC/05-courses.md) and, for each shipped course, in
[the standard courses](../../docs/standard-courses.mdx). Rule ids are labels for the text that
would join the rule when built.

## 1. Course sources and course directories

R-BTN-134 (proposed). Today a `source` names only the CLI's own repository, a scaffolded course's
files live in the home's `.baton/courses/<course>/`, and the sync holds its course file to the
source's. R-BTN-131 defines commit and branch refs for those sources. The design below reads a
course from a course directory in any repository; its cross-repository fetching design is not built.

- R-BTN-134 (proposed; a course is what its source names). Every reader — the sync, the runner, the
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

## 2. Course-file fields the validator does not accept

R-BTN-69 (proposed). Each of these is refused as an unknown field today.

| Field | On | Meaning | Rule |
|---|---|---|---|
  | `cancel` | course | the leg that undoes the course's work when a ticket is cancelled: an ordinary leg whose `from` lists every station a ticket may be cancelled at and whose `to` is one end station; absent, a cancelled ticket closes at once | R-BTN-168 |
  | `rank_advice`, `rank_launch` | course | schema ids (R-BTN-108) that `rank.mjs`'s `advice` and `launch` must meet; absent, they are dropped | R-BTN-152 |
  | `display_status` | station | the status a ticket source's writer shows people for a ticket at this station (`show`, R-BTN-74): a string of 1–64 characters naming a status the source's reader posts as live | R-BTN-74, R-BTN-200 |
  | `retry` | leg | its retry policy: `{max_attempts, backoff_s, exhausted?}` | R-BTN-122 |
  | `stalled_s` | leg | how long the leg may be posted `waiting` before `baton.stalled` is raised; default 259,200 (72 h) | R-BTN-167 |
  | `on_ticket_changed` | leg | what a running leg does when its ticket's version moves: `continue` (the default) or `restart` | R-BTN-198 |
  | `stream` | leg | `false`: its output is never written to a leg log | R-BTN-128 |
  | `max_context`, `max_refreshes` | leg | context fraction (0.1–0.95) that triggers a fresh session, and how many | R-BTN-123 |
  | `agent_command` | leg | the command its stub runs as the leg's agent, a string of 1–1,024 characters | R-BTN-131 |
  | `executor` | leg | executor data: a JSON object Baton never reads, passed to the runner's executor | R-BTN-107 |
  | `check_command` | leg | a check course's verdict command: an argv, with `timeout_s` (default 1800, ≤ 7200) | R-BTN-153 |
| `kind: call` | leg | files children of its `spawns` courses and waits for them; its `to` is a completion table | R-BTN-165 |
| `requires.tickets`, `requires.resources` | leg | prerequisites other than capabilities | R-BTN-120 |

The validation these fields would add, with the field names an earlier schema used:

- **Validation.** Baton accepts a file only if: `start` names one station; `end` names at
  least one; no leg's `from` names an end; every `from`, `to` and completion-table key names
  a station; every station is reachable from `start` through any outcome, and an end is
  reachable from every station, the `cancel` leg not counted; every cycle contains a leg with
  `max_runs`; every leg with `on_ticket_changed: "restart"` has `max_runs` (R-BTN-198); `start_leg` names a leg whose `from` includes `start`; every `inputs.from` names
  a leg and one of its outputs; `cancel`, if present, names a leg with no `kind`, whose `to` is
  one end station and which no `next`, `exhausted` or completion `next` names (it is queued by
  Baton alone, R-BTN-168); every `kind: call` leg has `spawns` and a completion table
  (R-BTN-165); every `requires.tickets` entry selects `parent` or `posted` (R-BTN-120);
  `expires` sits only on a `kind: person` leg and names one of its outcomes, and `deadline_s`
  and `stalled_s` sit on no `kind: person` leg (R-BTN-167); `deadline_s`, `stalled_s` and
  `expires.after_s` are within their ranges (R-BTN-167, R-BTN-116);
  `autonomous` sits on no `kind: person`, `call` or `arrives` leg, and never beside a `conditions`
  list naming a type R-BTN-195 bars it;
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

## 3. The `cancel` leg

R-BTN-168 (proposed) owns cancellation ([conditions](conditions.md)). A course's `cancel` names
one leg, with no `kind`, whose `from` lists every station a ticket may be cancelled at and whose
`to` is one end station. Only Baton queues it, when a ticket is cancelled: a holder's `next` or
`advance`, a retry policy's `exhausted`, a completion `next` and an owner's route naming it are
refused `cancel-leg`. Reachability and `to_end` ignore it. A ticket marked `cancelling` counts in
its queue.

- **The `cancel` leg leaves every station it names and reaches an end**, so `to_end`
  (R-BTN-61) and the reachability check above ignore it: it is not a way to finish the work.
  It is queued only by Baton, when a ticket is cancelled (R-BTN-168): a holder's `next` or
  `advance` and an owner's route naming it are refused `cancel-leg` (R-BTN-63, R-BTN-83).
  Queued, it is `ready`
  whatever readiness is posted (no sync posts any for it) and the `cancelling` hold does not
  refuse it (§6.6, rules 1 and 3); it runs as any leg does, on a runner holding its
  capabilities, and is re-verified against Baton's record, not git (R-BTN-5).

## 4. The standard courses as PR record courses

R-BTN-131 (proposed). The shipped courses' contract is
[the standard courses](../../docs/standard-courses.mdx). The design below changes them: every
course that writes a ticket's work is a PR course, human acts on the forge arrive through fact
legs, waits for a person are person legs, and `build-app` calls `draft-doc`. It also adds the
courses `draft-doc`, `epic`, `branch`, `ask`, `deliver` and `announce`.

| Course | Legs (`from` → `to`) | Ends | Reads |
|---|---|---|---|
| `create-pr` (the default) | `implement` (`filed` → `pr-open` \| `delivered`); the person leg `confirm` (`delivered` → `confirmed` \| `filed`, `asks: owner`, `max_runs` 3); `review` (`pr-open`, `fixed` → `reviewed`, `max_runs` 3); `fix` (`reviewed` → `fixed`, `max_runs` 2); `adjudicate` (`reviewed` → `adjudicated`); `merge` (`reviewed`, `adjudicated` → `merged`); and the fact legs of R-BTN-203 (specified there; `docs/standard-courses.mdx`) | `merged`, `confirmed` | PRs |
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

- **A wait for a person's answer is a person's leg** (R-BTN-116), answered by a
  `std:decision@1`: `decision`'s `answer`, `build-app`'s `decide` and `create-pr`'s `confirm`. Where the policy admits `sync` for `std:decision@1`, the ticket's `answer:`
  on the default branch (a sync-local field of the markdown source, read by the station
  function and never posted, R-BTN-74; never applied unless the owner gave it) is attested as
  one. Approving a document is not an answer: it is merging the PR that holds it.
- **One ticket, one PR, one merge.** Every standard course that writes a ticket's work is a PR
  course. Its legs commit their records and outputs on the ticket's branch (`branch_pattern`,
  continued by R-BTN-25), the first push opens the ticket's PR, and the course ends at `merged`.
  A runner's `merge` leg (`create-pr`, `create-spec`, under `merge.*`, R-BTN-182) or the fact leg
  `merged-by-hand`, the owner merging it, takes it there; a `create-pr` ticket with no work left
  to write ends at `confirmed` instead, by a person's word (above). A course that needs several approvals
  is several tickets (`build-app`, below). No leg of a record course (below) writes to the
  default branch, under any policy. A call leg's children are not a record: they are filed as
  R-BTN-165 and `tickets.created` say, directly under `filed` and proposed under `proposed`.
  - **The record.** `bug-report`, `draft-ticket`, `decision`, `spec-to-tickets`, `draft-doc`
    and `build-app`'s `report` (the record courses' legs) write each leg's record under its own `## <leg>` heading in the ticket's body,
    on the branch: a note for people, and the input the next leg reads from the branch's
    fetched head (R-BTN-5). Their outputs go on the same branch:
    - a new ticket file, its id taken as R-BTN-199's allocator hands it out: the next number
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
    when they merge the PR, exactly as `create-pr`'s does (R-BTN-203). Which merge counts, the
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
  - The PR courses' fact legs and reconcile legs are R-BTN-203's, listed in
    `docs/standard-courses.mdx`. A runner's `review` and `merge` stay runner legs.
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

The agent command (proposed): a leg's agent command is the first present of the home's
`.baton/baton.json` `legs.<course>.<leg>.agent_command`, the leg's `agent_command` in its course
file, the home's top-level `agent_command`, and the harness command. The `.baton/baton.json`
`agent_models` map replaces the `--model` words of whichever command was chosen.

## 5. The planning course, `epic`

- R-BTN-124 (proposed; the planning course, `epic`). `epic` turns a request into child tickets and
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

## 6. Bars that hold a course file

R-BTN-142 (proposed).

- **Held files.** A file is held — the previous stays in force and `baton.course-held` is
  raised — when, for any owner bar in force or scheduled or any required bar, it removes or
  renames a leg the bar names, renames a leg named in `except`, or gives a name in `except` to
  a leg that carries `renamed_from` or is new. An owner releases the hold with `baton owner
  bar follow <repository> <course>` (R-BTN-127), which rewrites the stored names to the file's, or by changing the
  bars.
- An `except` name the file simply drops (no rename) passes; Baton deletes it from the stored
  list and logs an `admin` event.

## 7. Runner capability checks

R-BTN-121 (proposed). Today a runner declares capabilities with `--capabilities` and a
machine-exclusive one with `--lock`.

- **The runner declares what it has** in its configuration (`baton runner start --config`,
  default `~/.config/baton/runner.json`): `{origin, capabilities: [{name, check?: [<argv>…],
  every_s?, lock?: <path>, instance?: <instance>}]}`. Capabilities are self-reported
  (R-BTN-66). A capability may stand for what several things the runner holds amount to —
  `capability:code-generation-llm` for a provider key and an installed harness — and the runner
  declares it when a check that tests them passes; Baton derives nothing (R-BTN-174).
  - **A check** is declared only while its command exits 0. It runs at start, before each
    claim, every `every_s` seconds (default 300) while idle, and to confirm a leg's request to
    end blocked on the capability (R-BTN-126). One run per capability is in flight at a time,
    and every request waiting on it shares its result. It runs with the runner's own
    environment, in a directory the runner owns — never a checkout or a leg's working directory
    — reading nothing a leg can write; how far that holds is the executor's isolation
    (R-BTN-107, §12.8). A run past 60 seconds is a failure.
  - **After a failure** the check keeps running every `every_s`, and the capability is
    declared again at the first pass at least `every_s` after the failure.
  - **Its line.** A failing check may print one JSON line `{available: false, until?,
    valid_for?, detail?}` on stdout, read as `{available: false}` when it prints none; without
    `instance` the line is only logged.
  - **`instance`** names a registered account instance listing a repository the runner's key
    is granted on (R-BTN-76), and binds only a check that tests that account's own
    availability, its quota or limit, not merely that it answers. While that check fails, the
    runner reports its line as a `state` reading of the instance within R-BTN-76's bounds for
    a runner credential, its `until` the earlier of the line's and the reading's end, renewed at
    each failing run and at least every half of its `valid_for` while the check keeps failing:
    carried by the end it confirms (R-BTN-126), else posted itself. While it passes and no
    administrator's or instrument key's `available: false` reading of the instance is in force,
    and the latest reading in force is a runner credential's `available: false` (each reading's
    writer as R-BTN-181 records it), the runner posts `{available: true}`, at most once an hour
    for each runner whose reading it counters.
  - **Example.** A leg requires `capability:code-generation-llm`. The runner declares it with
    a check that passes while either provider it holds is usable, and declares `key:zai` with
    `instance: zai-coding-plan` and a check that tests only that account's quota. When both
    providers are spent, the leg's request names the capability it requires and that check
    confirms it; the `key:zai` check, at its next run, posts the account's reading for every
    runner.

## 8. The leg-state branch

R-BTN-190 (proposed). Today the claim response carries `leg_state` and the reserved namespaces
are refused in a `branch_pattern`; the branch's layout, its readers and its detection are below.

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

## 9. Smaller items

- R-BTN-22 / R-BTN-65 (proposed), the CI check on course versions:

  - **CI check** (post hoc, not a gate): a push to the default branch that changes a
    `protocol_files` file without bumping `version` turns CI red, unless its commit carries
    `Course-Version: unchanged — <why>`; one that raises `version` without raising
    `min_runner_version` turns it red unless it carries `Min-Runner-Version: unchanged — <why
    older runners stay correct>`.
- R-BTN-63 (proposed), how a restarted run count is stored:

  leg it queues, since a person's intervention is what the bound waits for. Baton records the
  restart as `runs_from` on the position (`ticket_stations`, the id of the last `ticket_history` row
  at that moment, R-BTN-81; exported with the course history, R-BTN-88); the queued leg's runs
  and arrivals toward `max_runs` are those recorded after it, so the leg is queued whatever its earlier runs, and the
  traversal record itself is never erased.
- R-BTN-110 (proposed), schemas the standard library does not ship: `std:condition@1`, a
  handler's input (R-BTN-161), and `std:restart@1`, `{restart, reason, answered_by?}`, what a
  `suspend` condition resumes with (R-BTN-162).
- The test kit (proposed) would also refuse a `suspend` binding to a course that does not end by
  a person's leg or its expiry (R-BTN-161), print a check course's end stations for the owners'
  `conclusions` (R-BTN-114) and, with `--bindings`, each raisable condition type's resolution and
  scope (R-BTN-161).
- R-BTN-131 (proposed): the standard courses' legs require `runner:leg-trees` (R-BTN-133), and
  their shared code is copied into each course directory by `npm run courses`, checked in and
  checked current by CI.

## A course's own ranking, `rank.mjs` (R-BTN-98, proposed)

No runner runs a course's ranking today. The design:

- A course may ship `rank.mjs` in its course directory. A runner loads it from the remote
  default branch's head through a verified tree (R-BTN-133, R-BTN-134) and runs it through its
  executor in a `rank` session (R-BTN-107), with the leg's environment (R-BTN-144). Its default
  export `rank(view)` makes no Baton request and may make any other.
- `view = {runner: {tags, profile, harness} | null, candidates, fleet, instances, now}`:
  `candidates` this course's entries of `GET /v1/runner/recommendations?all=1` (of
  `launch-candidates` when `runner` is `null`), `fleet` and `instances` R-BTN-99's views. It
  returns `{order: [{ticket_id, leg, score?, reasons?, skip?}], advice?: {<ticket_id>:
  <opaque>}, launch?: <opaque>}`, checked as R-BTN-152 says; on failure, Baton's order.
- The runner orders each group by its course's ranking and keeps R-BTN-61's merge between
  groups; without `rank.mjs`, Baton's order. Ranking is advice; a course needing every runner
  to rank alike lists `rank.mjs` in `protocol_files` (R-BTN-65).
