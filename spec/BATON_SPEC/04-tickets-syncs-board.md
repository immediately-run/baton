---
title: "4. Tickets, syncs and the board"
description: "A repository describes itself in its .baton/ folder."
---
## 4. Tickets, syncs and the board

A repository describes itself in its `.baton/` folder. Its **sync** — `baton repo sync`, however
it is triggered (R-BTN-94, R-BTN-105) — reads the tickets from the ticket source and their
courses' evidence from git, and posts a **board** to Baton. Baton keeps the board as a cache of
both at the posted commit (R-BTN-35) and orders boards by compare-and-set and observation
numbers.

### 4.1 The `.baton/` folder and the registry

- **R-BTN-51 (the `.baton/` folder).** `status: built` A registered repository describes itself in one folder
  at its root:

  ```
  .baton/
    baton.json          # baton_url; courses: [{id, version, min_runner_version, skill?, step_kinds,
                        #   branch_pattern, previous_branch_pattern?,
                        #   protocol_files, source?, facts?}];
                        #   and the CLI's settings (R-BTN-74): items, default_course, repos,
                        #   agent_command, agent_wrapper, check, ticket_prefix, legacy_ids,
                        #   prefixes, project, tags, projects
    tickets.mjs         # optional ticket source; absent, the CLI's markdown source (R-BTN-74)
    courses/<course>/   # an own course; a sourced course's course.json is its source's (R-BTN-134)
      course.json       # the course file (R-BTN-69)
      sync.mjs          # the station function (R-BTN-74); an own course's; a standard course has a default (R-BTN-134)
      rank.mjs          # optional ranking code (R-BTN-98)
      legs/<leg>.<ext>      # one per leg; ext mjs, js, cjs, mts, ts or cts (R-BTN-133)
      legs/<leg>.run.<ext>  # optional run override (R-BTN-131)
      legs/<leg>.md         # leg instructions (R-BTN-131)
    package.json        # optional, with its lockfile: the legs' dependencies; never the root's (R-BTN-133)
  ```

  - `course.json` is the course's whole state machine; `baton.json` names courses and
    settings, never a leg's stations, edges or contract. Per-leg settings, `imports`,
    `executor_schema` and condition bindings in `baton.json` are proposed
    ([courses](../proposals/courses.md), [checks and executors](../proposals/checks-and-executors.md),
    [conditions](../proposals/conditions.md)).
  - `branch_pattern` (default `claude/{ticket}-*`; grammar in R-BTN-141) maps a pushed branch
    to the course's tickets for the branch-holder query (§9) and finds an earlier attempt's
    branch (R-BTN-25). Without `{repository}`, a branch may map to tickets of two repositories,
    and the query fails safe (a push is refused while either is held by another).
    `previous_branch_pattern` stays matched by the query and the local branch check until the
    course's author drops it.
  - `protocol_files`: the paths whose change bumps `version` (R-BTN-22).

- **R-BTN-48 (a ticket names its course; Baton does not know what the course does).** `status: built` Each
  repository's sync posts a **registry** from `.baton/baton.json`: per course, the fields of
  R-BTN-51 and its course file (§4.4). Each ticket names its course. Course logic runs outside
  Baton, in the sync's station function (R-BTN-39, R-BTN-74); Baton validates every station and
  leg name it receives against the course file (R-BTN-69) and never reads a marker, review or
  skill. Which runner may take a ticket of a course is §6's, a course's `version` R-BTN-22's,
  and a changed course definition is checked against in-flight tickets by R-BTN-64.

### 4.2 What a sync runs

- **R-BTN-74 (the ticket source and the station function, with defaults).** `status: partly B-112 B-351` `baton repo sync`
  builds the board post from two pieces of repository code. `course.json` is always the
  commit's own (or its source's): the sync posts and `baton runner start` loads the same file.
  - **The ticket source**, `.baton/tickets.mjs`, reads one ticket store — a git folder, an
    issue tracker, a table — and decides what a ticket is and how tickets rank. Its default
    export `tickets(ctx)` returns the board's `tickets` and `closed` (§4.4), each ticket with
    optional sync-local `fields`, which the sync hands to station functions and never posts,
    and `display.status`, the status the store shows people. It runs in the sync and, for
    `read`, on the runner. Exports that write the store are proposed in
    [tickets and sources](../proposals/tickets-and-sources.md).
  - **Each ticket's version.** `tickets(ctx)` gives each live ticket a `version`: an opaque
    string (§12.3) whose meaning is the source's own. Baton compares two versions for equality
    only; it never orders them or reads one as a time. A ticket's version changes exactly when
    something a runner reads of it changes — its body, exit criteria, filter fields, closure —
    and for nothing else: a needless change stales claims (R-BTN-198), a missed one lets a
    runner work a ticket that moved. `read` returns neither the status the store shows nor its
    notes.
  - **How the source reads.** The default export may declare `versions`: `"pinned"` (it can
    read a ticket at a version) or `"current"` (only as it is now). A source that declares it
    exports `read(id, {version?, checkout?})` → `{version, ticket}`, run on the runner; the CLI
    refuses at load one that declares `versions` without `read`. A source that declares neither
    posts every ticket with a `path`, and its claims are not re-verified by version (§4.5).
    - A ticket posted with no `path` has no file in the checkout. When its `read` returns
      `ticket` as a string — markdown, a frontmatter block with the keys of the table below,
      then the body — the runner writes it, mode 0600, into the claim's scratch directory,
      removes it at the claim's end, and hands its path to every leg as `ctx.ticket.file`
      (`BATON_TICKET_FILE` for the CLI's stubs). Any other `ticket` shape, or a ticket with a
      `path`, gives the legs no `file`.
    - `tickets(ctx)` reads its store after the observation number was handed out and sees every
      write made before it (§4.3). `ctx.versions` carries each live ticket's last accepted
      version; a source whose store can tell a stale read refuses to post a ticket whose version
      it judges older, failing the run.
  - **Each course's station function**, `sync.mjs` in its course directory (own or the
    source's, R-BTN-134), default-exports `stations(ctx)` → `stations` (per ticket: readiness,
    fact arrivals, implied station, outputs, bars, the queued person leg's question,
    `not_before`) and that course's opaque `course_data`, from git, the fact adapter's PR facts
    (R-BTN-96) and `ctx.positions` (§4.3). It never returns a position (R-BTN-39). The CLI adds
    R-BTN-203's arrivals and evidence for every ticket itself, whatever the station function. The sync
    posts bars, the question and `not_before` with the ticket, the rest as its attestations
    (R-BTN-191), and `course_data` keyed by course id. **Not built (B-351):** a station
    function returns no readiness; the course's selector (R-BTN-205) chooses the leg, and the
    sync posts facts, outputs, bars, the question and `not_before` only.
  - **CLI default ticket sources** (`src/defaults/`), used when the repository has no
    `tickets.mjs`: **markdown** (below) and **`changes`**, one check ticket per open change
    (R-BTN-114). `baton repo init --eject tickets` copies the markdown source into `.baton/`.
    Defaults are CLI code run in the sync, never core: `src/core/` may not import
    `src/defaults/`.
  - **The markdown source.** Every `*.md` or `*.mdx` under `items` (default `tickets/`) whose
    frontmatter has an `id` and either omits `kind` or sets it to `ticket` is a ticket. It is
    **pinned**: a live ticket's `version` is its
    file's blob id at the posted commit, its `key` is its `path`, and its `read` is that blob;
    a ticket whose file is not at the commit is posted with no version. Its frontmatter:

    | field | posted as |
    |---|---|
    | `id`, `title`, `parent` (R-BTN-86), `not_before` (R-BTN-89) | the same |
    | `status` | `done` → `closed` as done; `withdrawn`, `superseded`, `deferred` → `closed` as withdrawn; any other → live, in `display.status` |
    | `course` | `course_id` (default `default_course`, else `create-pr`) |
    | `requires` | capability names, expanded |
    | `tags` | `EXPEDITE` → `expedite`; `OP` → `human-operator` in `requires` |
    | `depends_on` | `depends_at: {ticket, done: true, leg: <the course's start_leg>}` per id (R-BTN-120); a qualified id (§3.1) is posted as written |
    | `repos` | forge paths, short names resolved through the `repos` setting (`owner/name` stands) |
    | `order` | `rank` (by `order`, then id) |
    | `prs`, `answer` | never posted: the ticket's sync-local `fields` (R-BTN-33); its `course` is `{}` |

    Other fields are ignored. Two files with one `id`, a `repos` name with no mapping, or an
    `order` that is not a number fail the sync: nothing is posted and the run names the file.
  - **`baton ticket check [--repo DIR] [--quiet]`** (R-BTN-127) reads the source as a sync does
    and checks what it would post. It never posts or writes. Exit 1 with one `path: message`
    line per finding, 0 with none, 2 for an unreadable root or a malformed `baton.json`. The
    `check` settings are in `.baton/baton.json`, each off by default. Findings:
    - the source's own refusals and the board post's validation (§4.4);
    - a `depends_on` entry that names no live or closed ticket of this repository (another
      repository's qualified id is the sync's to resolve, §4.4);
    - with `check.depends_line`, a markdown ticket whose `**Depends on:**` body line — it runs
      to the next blank line or `**Label:**` line — differs from its `depends_on`; a ticket
      with no such line is not compared;
    - with `check.sections_since: "<YYYY-MM-DD>"`, a live ticket filed on or after that day
      whose `### Trust` or `### Invariants` section is absent, empty or a `_(…)_` placeholder.
      Not judged: a `kind: project` page, a request ticket (`tags: [request]`), and a ticket
      carrying `handles:` or `called_by:`;
    - with `check.sections_from_id: "<prefix>-<n>"` beside it, a live ticket under that prefix
      numbered `n` or above that has no `_filed` line;
    - a `HOW-TICKETS-WORK.md` that differs from the release's text.

    A ticket's filing day is its `## Status` `_filed YYYY-MM-DD` line, else the author day of
    its file's first commit, else today; the sections check takes the later of the line and
    that commit where git shows the commit. In a shallow clone a ticket only its first commit
    could date is listed as undetermined, on one line, never a finding.

    It also reports, never as a finding, each live ticket citing a rule id that a dated entry
    of the spec's history amended after the day the ticket answered for that rule
    (`check.rules: {history, prefix}`, default `spec/BATON_SPEC_HISTORY.md` and `R-BTN`; no
    file, no report). An entry amends the ids its bold title (`**YYYY-MM-DD — <ids>: …**`) or
    its `Rules changed: <ids>` line names. A ticket answered for a rule on its filing day, or
    on the day of a later `rules re-read` note in its `## Status` that names the rule. Days are
    compared: an entry of the same day is not after. A shallow clone skips the report, saying
    so.

    A `rules re-read` note is `_(YYYY-MM-DD: rules re-read: <ids>)_`, or the Status line
    `dibber set <id> --note "rules re-read: <ids>"` writes, `_YYYY-MM-DD: rules re-read: <ids>._`.
    The `_filed` line, `tags: [request]` and the `rules re-read` notes are claims anyone who
    can push can write; the check verifies their form alone.
  - **`baton ticket check <id> --claimable [-i KEY] [--url URL] [--offline]`** reads what a
    claim must know before Dibber writes it, and writes nothing. It reads the ticket at the
    fetched default head and Baton's position of it (the board's station, ready leg and holders,
    the history's `resume`, the branch-holder query). It is not claimable, exit 1 naming why,
    when: another live claim holds it or its branch; it is not `available` in git, Baton's
    position past its course's start overriding only a false `available`, never `in-progress`,
    `in-review`, a parked or a closed status; a `depends_on` entry is not done (archived, or
    `done` or `superseded`; a qualified one read at the target repository's default branch,
    found through the `repos` setting); or its body cites a rule amended since it answered for
    it (the check's reading), naming each id until a `rules re-read` note names it. Claimable,
    exit 0, it prints the claim to make (`dibber claim <id>`) and, for a ticket Baton holds past
    its start, the takeover: the station, the ready leg, every PR Baton's record holds (each one
    the file lacks with its `dibber set <id> --pr <url>`), and each branch to continue on. A read
    Baton does not answer exits 2, unless `--offline`, which judges git's word alone and says so.
  - **Ticket files are Dibber's to write.** Baton's CLI files no ticket and writes no status:
    `baton ticket new | claim | set | done` are refused, each naming its `dibber` command. A
    ticket is filed with `dibber new`, under the number Dibber's coordinator gives (R-BTN-199),
    and its status written with `dibber claim | set | done`.
    - `baton repo init` writes `.dibber/config.json` beside `.baton/baton.json`: `store` from
      `items`, `prefix` from `ticket_prefix`, and `coordinator.next`,
      `baton tickets next ticket-<prefix> --coordinator` run from the release's package. Over an existing file it adds what is
      missing, never overwrites a value, and says what it changed.
    - A course leg that files or changes a ticket runs the `dibber` its stub pins, handed to its
      agent as `BATON_DIBBER`: the host's `BATON_DIBBER`, else the release version
      `.baton/baton.json`'s `dibber` names, else the release's own; never a command a ticket or a
      branch names. The leg commits and pushes what Dibber wrote by its course's route: a
      `bug-report` filing alone, on `baton-ticket/<id>` — a reserved namespace no `branch_pattern`
      may match (R-BTN-190). A leg's close still writes its marker keys itself (R-BTN-83).
  - A post whose ticket is `available` in git while placed past its course's start is logged
      `position-disagrees` (R-BTN-85).
  - **The "How tickets work" page.** `baton repo init` writes `HOW-TICKETS-WORK.md` into the
    items folder, the same text in every repository but for the id prefix, legacy patterns and
    default project read from its `.baton/baton.json`, and writes it again when it differs.
  - **The run's outcome is its line and its exit code.** `baton repo sync` ends with
    `baton: <outcome> at <sha> — <steps>`. `advanced` and `confirmed` posted, and exit 0.
    `held` — a force post refused into holding — posted nothing and exits 0. Every other
    outcome posted nothing and exits 1, `busy` (another run's number outstanding, R-BTN-62) and
    `busy:again` included.
  - **A `busy` run retries once.** `--busy-retry <s>` (default 60, `0` for none, at most 600)
    is the wait before a `busy` run takes a fresh number and syncs again; a second `busy` is
    `busy:again`. The wait comes before the retry's observation, never between a number and its
    post.
  - **The sync workflow** pins the CLI's version and passes only flags that version knows; a
    CLI release changes no repository until `baton repo init` moves the pin. The default
    workflow annotates each run from its last `baton: <outcome> at <sha>` line: `advanced` or
    `confirmed` a notice; `held`, `busy` or `busy:again` a warning that nothing was posted;
    anything else, or no line, an error.

- **R-BTN-203 (work done outside Baton).** `status: specified B-311` Baton works in an open world: where only part of an
  organization uses it, any of a ticket's legs may be done by people and sessions that never
  claim it, and Baton cannot prevent it — it gates only its own state (R-BTN-35). Its job is to
  detect such moves and place the ticket accordingly; a deployment that needs a course followed
  strictly gates the outside events at the forge or disables them. The sync
  (the CLI, for every ticket whatever its course's station function, never the server) finds that
  work and attests it; Baton applies it by its own rules (R-BTN-39). Only a board posted with a
  sync key or the registered CI identity (R-BTN-93) carries these attestations. On a post with a
  runner's machine key the CLI omits them, and Baton drops any it finds there without refusing the
  board; a repository synced only by machine key detects no outside work.
  - **A leg done by hand is a fact leg.** A course names, as legs of their own, the hand acts it
    accepts: each a leg with `arrives` (R-BTN-69), one outcome, and its own `from`, so the course
    file says exactly where a hand act may move a ticket. The kinds, each read for the ticket's
    PRs as R-BTN-131's courses map them (its `prs:` and its branch pattern):

    | Kind | The fact | `ref` |
    |---|---|---|
    | `pr-opened` | a PR of the ticket's, open, that no claim of the ticket opened (no PR its implement or create legs reported, served as `claim_prs`, §4.3) and no `runner_pushers` login authored | the PR's URL |
    | `pr-verdict` | the latest verdict on a PR's head — of the kind `arrives.verdict` names, if it names one — when it is a hand verdict: by a pusher (R-BTN-139) who is none of the repository's `runner_pushers`, not the PR's author and not a pusher of its head, on no comment or review a claim of the ticket posted (`verdict_refs`, §4.3), and newer than Baton's last change of the ticket's position. A runner's verdict counts as the latest when it is newer. On a ticket with several PRs, every PR's latest verdict, one per head | the review's or comment's URL |
    | `pr-pushed` | a push to the PR after its latest changes verdict, by no `runner_pushers` login and of no commit a claim of the ticket reported (`claim_shas`, §4.3), that changes more than the base merged in; none while the PR has no changes verdict | the head sha |
    | `pr-merged` | in each repository the ticket's PRs map (its `prs:` and `repos:`), at least one PR merged and none open, PRs closed unmerged ignored, none merged by a `merge` leg; a merge in some but not all of them is `merged-early` evidence | the last merge commit |

    While `runner_pushers` is NULL or `[]`, no `pr-opened`, `pr-verdict` or `pr-pushed` is found:
    a runner's act cannot be told from a person's (Baton serves the logins with `positions`,
    §4.3). The sync posts one
    `std:arrival@1` as writer `sync` per fact that a fact leg leaving Baton's station takes, with
    that `ref` and the leg's `next` for it. A `pr-merged` no fact leg leaving the station takes is
    `merged-early` evidence (below); any other fact no fact leg takes is posted as nothing.
  - **Other evidence is weighed by the course's reconcile leg.** The sync also posts an
    `std:evidence@1` (`{ref, kind}`) per piece of evidence that a ticket may have moved outside
    Baton in a way no fact leg takes:
    - `merged-early`: as above;
    - `mention`: the ticket's id as a whole word in the title or body of a pusher's PR merged — in
      the home or a `repos:` repository — between the times Baton accepted the last head and handed
      out this observation, or in the message of a first-parent commit reaching the default branch
      between the last accepted head and the observation's head (§4.3). Not counted: a commit that changes only the ticket
      paths or `.baton/`; a commit a claim of the ticket reported (`claim_shas`) or a PR on a
      branch any course of the ticket maps (its own PRs and their merges); the commit that filed the ticket;
      a commit or PR naming more than three ids. Not posted for a ticket at an end station.

    Only `ref` and `kind` are posted: titles and messages never are (R-BTN-33). Baton keeps each
    piece and hands it to the course's reconcile leg (R-BTN-39). A course models the ways its
    tickets move outside Baton as edges of its own graph: fact legs for the hand acts it
    recognises, a reconcile leg for the rest.
  - **What the sync reads.** The adapter's PR facts (R-BTN-96) and the home's first-parent
    commits in the window above. A first snapshot has no window and reads no `mention`; outside
    work merged before it is found only by `baton repo sync --backfill-mentions <since>`, which
    widens one run's window to that date.
  - **Closure is unchanged.** An archived file or `status: done` closes a ticket as the table
    above says, claimed or not. A hand merge closes one through a fact leg or a reconcile leg the
    course lets reach an end, whatever station it is merged from and whatever the verdict on the
    merged head: Baton records what happened, and preventing it is the forge's job.

### 4.3 The sync run and the head

- **The sync run.** A run checks out with full history (ancestry needs it), then:
  1. `POST /v1/sync/observation` → `{sha, observation, bars, pushers, runner_pushers, verdict_refs, code_repos, repos_unlisted,
     check_app_id, provisional, positions, versions, legs, unconfirmed}`, before it reads
     anything else: Baton's head (null before the first post); a fresh observation number
     (R-BTN-62); the owner bars in force or scheduled (R-BTN-67); the trust inputs (R-BTN-139,
     R-BTN-140), and R-BTN-203's `runner_pushers`, `verdict_refs` (each live ticket's verdict
     URLs its claims posted, from their evidence, R-BTN-8), `claim_prs` and `claim_shas` (the PRs
     and commits its claims reported) among them; `positions` also carry each ticket's
     `changed_at`, when Baton last changed its position; the commits provisional block rows wait for (R-BTN-126); `positions`, every
     live ticket's `{station, path_len, path, next_leg, running?}` from Baton's course history
     (R-BTN-39), a ticket absent from it being at its course's `start`; `versions`, each live
     ticket's last accepted version; `legs`, the runs claims finished with evidence, newest
     first, each `{ticket, leg, claim_nonce, evidence, reached}`, by which a station function
     judges a marker; and `unconfirmed`, every unconfirmed end's `{ticket, claim, evidence?}`
     with the `ended_at_sha` it named (R-BTN-10);
  2. fetches and sets `new` to `origin/<default branch>` (the registered branch), then reads
     the ticket source, PRs and code repositories, so everything posted was read after the
     number was handed out; confirmation's every-input rule (R-BTN-10, R-BTN-62) relies on it;
  3. runs every course's `sync.mjs` — always, even when `new` equals the head, since evidence
     lives in PRs, reviews, checks and code repositories;
  4. posts the board (§4.4) with its number:
     - `sha: new, parent_sha: head` when the head is an ancestor of `new`;
     - a **refresh** (`sha` and `parent_sha` both the head) when `new` equals the head: the
       run's attestations replace the previous run's, and so does any ticket whose `version`
       differs from the row Baton holds — added, closed or changed — since a source's store
       can move with no commit;
     - when `new` is a strict ancestor of the head (a lagging fetch), no board of its own: at
       most a `confirm-only` re-post of the head (§7.1), which changes no ticket row.

     A refresh carries `read_sha`, the commit its tickets were read at, and Baton writes its
     ticket rows only when that is the head; the re-checks of R-BTN-11 and R-BTN-62 guard those
     writes as they guard a new head's. Every exit that posts nothing releases its number
     (R-BTN-62).

  A post over R-BTN-149's caps is refused `too-large`. Baton materializes each accepted snapshot
  into `tickets`, upserting rows whose `row_hash` changed — `version` and `key` are among its
  inputs — and deleting rows of tickets that left the board; stations likewise write only the
  rows that changed (R-BTN-70), so a post costs rows in proportion to what moved (R-BTN-2). The
  protocol is the CLI's; the repository supplies only its ticket source and station functions.

- **R-BTN-62 / R-BTN-150 (observations are ordered by Baton).** `status: built` `status: built`
  - Each `POST /v1/sync/observation` hands out the next number of a per-repository counter;
    the post carries it back. A post is accepted or refused **whole**, and refused
    `stale-observation` unless its number is the outstanding one and greater than the last
    accepted one's. A number is used once, by the post that carries it, accepted or refused.
  - A snapshot confirms an end (R-BTN-10) or makes a claim stale (R-BTN-35) only when its number
    is **strictly greater** than the counter's last handed-out value recorded at that end,
    claim or `advance`.
  - **One reading in flight.** While a number is outstanding (handed out, not yet posted,
    released or void) the observation route answers `sync-busy`. A number is void 10 minutes
    after it was handed out.
  - **Release.** A sync run that will not post gives its number back with
    `POST /v1/sync/observation {release: <number>}`. Only the issuer of the outstanding number
    may release or post it; revoking a sync key voids its number without resetting the counter.
    See R-BTN-187 for quotas and owner alerts.
  - Renewal and the bar on a credential that lets numbers lapse are
    proposed in [tickets and sources](../proposals/tickets-and-sources.md).

An identical validated same-head snapshot may reuse its materialization only while its
server-computed fingerprint and the scheduling version (R-BTN-196) match. The observation number is excluded
from the fingerprint; mutable ticket versions and submitted placements are included. R-BTN-62's
number validation, relevant claim reconciliation and spawned-child settlement still run.
The fingerprint stores no ticket content and is an optimization, never authority to accept a post.

- **R-BTN-11 (snapshots advance by compare-and-set on ancestry).** `status: built` Per repository, Baton accepts
  a snapshot only when `parent_sha` equals its head (a refresh: both equal the head) and its
  observation is newer, then moves the head. A first snapshot is accepted with `parent_sha:
  null` only while no head exists. A lost race is `head-moved`; the sync re-reads and retries.
  A post marked `force` — neither its commit nor the head descends from the other — is refused
  `snapshot-rejected` and held once per sha against the current head. An administrator can
  accept it on the dashboard (`POST /v1/ui/board/accept`); otherwise the alarm accepts it
  when 24 hours have elapsed since its first post against that head. Acceptance admits the
  rewritten line for that repository and previous head; it does not move the head. The next
  otherwise eligible `force` post against that head moves it, even if the posted sha differs
  from the held sha. A held post's stations and
  confirmations are applied as a refresh. Which of two posts is newer never depends on a clock.
  An administrator's adoption of a rewritten default branch
  (a forced Resync) is proposed in [tickets and sources](../proposals/tickets-and-sources.md).

- **R-BTN-147 (a renumbered ticket keeps its hold and backoff).** `status: built` Each ticket is posted with a
  `key`, the source's stable name for it, defaulting to its `path`; two live tickets of one
  post never share a key. A post that adds a ticket at the `key` of a ticket it drops has
  renumbered it: the new id takes the old one's hold and backoff, logged as a `renumbered`
  event (actor `sync`). The founded-head check, the lagging-fetch and dropped-ticket conditions
  are proposed in [tickets and sources](../proposals/tickets-and-sources.md).

- **R-BTN-199 (Baton hands out every identifier that concurrent branches write to git).** `status: built B-176` A
  number that must be unique across concurrent branches is one Baton hands out (R-BTN-193),
  from a per-repository, per-kind sequence.
  - **The route.** `POST /v1/repositories/{repository}/sequences/{kind}/next` → `{kind,
    number}`, for the principals that file tickets: a key granted on the repository, an owner
    of it, an administrator, the repository's sync key, and a delegated key. `kind` is
    `^[a-z][a-z0-9-]{0,31}$`, opaque to core. `for` names the ticket a number is for, recorded
    and never trusted.
  - **The number** is `max(stored, floor) + 1`. The caller's `floor` is the highest number it
    sees in git, on the default branch and every open branch's head, `baton-ticket/*` filing
    branches included, so a lost or fresh Baton never issues a number git holds. A floor more
    than 10 000 above the stored number is refused `invalid-params`. Each take is one
    `sequence` event naming the caller, the kind, the number and the floor; a refused floor is
    one too, with no number (§13.4 `sequences`).
  - **The CLI** names the kinds — `ticket-<prefix>` (one per allocating prefix), `rule`,
    `scenario`, `gate`, `migration` — and `baton ticket next <kind> [--for <ticket>]` prints the
    next of one. With `--coordinator` it prints Baton's number alone, or refuses — no key, no
    repository, an unanswered Baton — and never scans: Dibber's coordinator command (R-BTN-74),
    so only Dibber's own `new --offline` files from a scan. A remote the floor cannot read is an error, never a floor of 0: no number is
    printed or filed.
  - **Git stays the record** (R-BTN-1): the CLI writes the number into git and never reads it
    back from Baton. A number a branch holds only locally is one no floor sees; the duplicate
    check at merge is its backstop — the sync's duplicate-id refusal (R-BTN-74) for tickets,
    R-BTN-31's for the rest.
  - **The next-free scan.** Legacy, removed with its code (R-BTN-193). With no key, no
    configured Baton, an unreachable Baton or `--offline`, the CLI takes the next free number
    git shows it — for a ticket kind, across the items folder at any depth, `archive/` included —
    and says so in its output. Dibber's own scan is its `new --offline`. The duplicate check at merge is
    that path's only guard.

### 4.4 The board post

`POST /v1/sync/board` — the one normative schema:

```
{ sha, parent_sha, observation, force?,                                   -- R-BTN-11, R-BTN-62
  read_sha?,                                                      -- the commit the tickets were read at (§4.3)
  source: { kind: 'markdown' | 'custom', versions?, cli },         -- R-BTN-74
  course_sources?: { <course>: { branch, sha } },                  -- R-BTN-134
  contains?: [<sha>],                                            -- the provisional commits (R-BTN-126) this post contains
  registry: [{ id, version, min_runner_version, skill?,
               course: <course.json with its schemas>,           -- R-BTN-69, R-BTN-108
               step_kinds, branch_pattern, previous_branch_pattern? }],
  tickets:  [{ id,                                               -- local id
               course_id, version?, key?, path?, title,          -- version: R-BTN-74; key: R-BTN-147
               requires[], expedite, repos[], rank?,             -- requires expanded; repos are forge paths
               parent?, not_before?,                             -- R-BTN-86, R-BTN-89
               depends_at?: [{ ticket, at | reached | done, leg? }],   -- R-BTN-120
               check?: { sha, head_repo_id, head_ref },          -- check tickets, R-BTN-153
               display: { status?, group?, project? },           -- shown; core reads project and status only (R-BTN-33)
               handoff_url?,                                     -- R-BTN-24
               question?: { id, url?, severity?, options?: [{ id, reached }] },  -- the queued person leg's, R-BTN-116
               bars: { <leg>: [<tag>] },                         -- R-BTN-60
               course: <opaque> }],
  closed:   [{ id, as: 'done' | 'withdrawn' }],                  -- tickets that left the board
  stations?: { <local ticket id>: {                             -- R-BTN-70
    station, path: [{ leg, reached }], next_leg: <leg> | null,
    next_source: 'course' | 'marker' | 'inferred' | 'holder', handoff_url: <url> | null,
    next: [{ leg, state: 'ready' | 'waiting', waiting_on: <label> | null, needs?: [<resource>] }],
    bars: { <leg>: [<tag>] }, decisions?: [{ id, asks, leg?, url?, question?, options? }] } },
  attestations: [{ type, ticket, ref?, value }],                 -- the sync's attestations, this run's observation (R-BTN-191)
  course_data: { <course>: <opaque> } }
```

- Core reads every generic field and stores each `<opaque>` verbatim. `stations` supplies
  placements and readiness (R-BTN-70); a new-head post does not offer a ticket it does not place.
  For the interim post see §16.4. Every station and leg
  named must be in the course file. Each attestation is validated by its type's schema and
  accepted with the post (R-BTN-191): readiness whose `at` is not Baton's station is discarded,
  and an arrival Baton does not apply is recorded unapplied (R-BTN-39). Confirmations are not
  posted; Baton derives them from the run's attestations (R-BTN-10).
- **The source declaration.** `source` names the ticket source — `markdown`, the CLI's
  default, or `custom`, the repository's own — and its `versions`, when it declares one
  (R-BTN-74). Baton keeps the last accepted declaration and hands it to the claim answer
  (§4.5). A post from a `custom` source with `versions: "current"` to a repository whose
  policy's `floors` include `tickets-approved` is refused `invalid-params`, naming the
  guarantee, which is defined over a ticket file's approval (R-BTN-184).
- **Each ticket's `version`** is validated on write (§12.3) and stored on its row. `key`
  defaults to the ticket's `path`; a ticket with neither is refused. `path` is required of
  every source but a `custom` one with `versions: "current"`.
- `requires` arrives expanded to capabilities (`none` or no clause is `[]`). `repos` are forge
  paths naming the home or an entry with reach (R-BTN-92, R-BTN-140) — unique across the
  reach, whatever the host — resolved by the sync from short names under the home's owner.
- Every ticket with a ready leg is ranked, a suspended one included.
- A `question` is stored only for a ticket whose queued leg is a person leg (R-BTN-116); any
  other is dropped and logged `question-dropped`.
- A closing is recorded only from a post with a newer observation; a ticket that returns to the
  board clears it and gets its kept owner state back (R-BTN-12).
- A check ticket whose `check.head_repo_id` is not the repository's `forge_repo_id` is dropped
  (R-BTN-153).
- **Dependencies.** A `depends_on` entry is a local id or another repository's qualified id
  (§3.1); this repository's own id spelled qualified is read as the local id. `blocked_by`
  and `parent` stay local. Judged in the transaction that accepts the post, before anything is
  written, each refusal `invalid-params` naming the id or the cycle:
  - a qualified entry's repository must be live-registered (R-BTN-47) and its ticket live or
    closed on that repository's board;
  - the target must be at least as visible as the posting repository, or its owners' consent
    recorded (§3.1); the refusal names the consent route;
  - the live tickets' edges must form no cycle, within the board or through the stored boards
    of the repositories they name. A cycle is named once, as its path
    (`a:T-1 → b:T-2 → a:T-1`). An edge to a closed ticket, or to an id no
    board names, is no cycle. A graph over more boards than the walk's bound is refused,
    naming the board that crossed it.
- **The sync resolves qualified dependencies first.** After its number and before it reads the
  forge, the sync sends `POST /v1/sync/dependencies {ids}` with the qualified ids its live
  tickets name. The answer per id is `{ticket, repository, local, done, withdrawn, closed,
  station, url}`: the doneness station functions gate a leg on (R-BTN-120), and `url`, the
  target file's link built from its registration, null for a closed target or a `git`
  repository. The read makes the post's own refusals (an unconsented target is `forbidden`), so
  the sync fails whole before it posts.
- Free text and identifiers are validated on write (§12.3).
- **R-BTN-194 (every ticket carries who last wrote it).** `status: built` Provenance is information, never a
  gate: nothing is refused, held or raised for it. In the transaction that accepts a post
  moving the head, Baton reads its own record of the forge's push deliveries for the range
  (R-BTN-73), never the post's account, and records on each ticket whose file changed
  `last_written_by: {pusher, pusher_id?, commit, at, human}`: the pusher of the newest recorded
  commit that changed the file. `pusher_id` is the delivery's immutable `sender.id`, `pusher`
  its login — never the commit author — and `at` the delivery's arrival.
  - **Unknown, never assumed.** A ticket whose row the post changed with no recorded commit
    accounting for it, or whose newest recorded change is followed by a push past the recording
    bounds, is `pusher-unknown` at the accepted head. A first snapshot has no range and records
    nothing.
  - **`human`** is decided once, in the recording transaction, against the policy then in
    force: `true` only when `pusher_id` is recorded and equals the `human_identity` that policy
    names (R-BTN-188). It says a human landed the file's last change, by a push or by merging a
    pull request that carried it. A reader that would act on an owner's quote in a ticket for
    a privileged action takes the quote as the owner's only where `human` is `true`.
  - `last_written_by` is Baton's own record, no input of `row_hash`, and is served wherever
    the ticket is: the board read (§11), the dashboard's ready rows, recommendations, the claim
    answer, each heartbeat's claims and the ticket read
    (`GET /v1/repositories/{repository}/tickets/{ticket}`, `baton ticket show`).

### 4.5 Reading the ticket

- **R-BTN-5 / R-BTN-34 (the runner reads and re-verifies the ticket from git, by its version).** `status: built B-46` `status: built`
  - The claim response names the ticket's `path`, the `snapshot_sha` it was decided on, its
    `version` as the board holds it, and how its source reads (`ticket_source`: `{kind,
    versions}`; absent when the board declared no source, and `version` is `''` when the board
    holds none).
    R-BTN-143 governs verification of the snapshot's ancestry. If `git cat-file -e <snapshot_sha>` fails or
    the file is absent, it fetches the default branch once, then releases `stale-board` if it is
    still missing.
  - The runner reads the ticket from `origin/<default branch>:<path>`, never the working tree,
    and takes body, exit criteria and PRs from that file. A leg of a course that keeps its
    record on the ticket's branch (R-BTN-131) reads the body and its inputs at that branch's
    fetched head instead, once it has checked that the branch maps to the ticket; filter fields and
    closure still come from the default branch. No ticket content travels through Baton.
  - **Re-verification by version.** Before any leg runs, the runner reads the ticket through
    its source at the claim's snapshot (R-BTN-74). A **pinned** source reads it at its version
    (`read(id, {version})`), and a ticket that cannot be read there releases `stale-board`. A
    **current** source reads it as the store holds it now (`read(id, {})`), and a different
    version releases `stale-board`. A source that declares `versions` and exports no `read`
    releases `stale-board` too. A source that declares neither is not re-verified by version.
  - **Re-verification of readiness.** The runner then runs the course's `sync.mjs` (through the
    wrapper, from a verified tree at the claim's commit, R-BTN-133) on the ticket and its PRs
    at the fetched head. Its readiness must show the offered leg leaving the claim's station as Baton holds it (the claim response's
    station, `path_len` and queued leg, R-BTN-39); the ticket's position never comes from the
    source. A ticket closed or archived, or the leg not offered there, releases
    `stale-board`. A ticket with no file — a `changes` check ticket (R-BTN-114) — is
    re-verified against the claim response's station and queued leg instead.
  - After this check, a version that moves under the claim is read again as R-BTN-198 says.
  - **A ticket Baton has not seen cannot be claimed.** A claim naming it is `not-eligible`
    (`unknown-ticket`, §9.1), until the first accepted post that names it.

### 4.6 Children

- **R-BTN-86 (tickets are sequential; child tickets are how work runs in parallel).** `status: built` A ticket
  has one holder and one position at a time; no two legs of one ticket run at once. Parallel
  work is **child tickets**.
  - **Spawning.** A leg writes child tickets to the ticket source first, each naming
    `parent: <local id>` of the same repository and each taking its id from R-BTN-199; Baton
    stores the qualified id. A child is an ordinary ticket on any
    course; parent and children may be held at once. A spawning leg does not wait for its
    children; its `spawns` declaration is R-BTN-111's.
  - **The `spawned` report.** The end that follows a spawning leg carries `spawned: [<local
    id>]`, with `suspended:<station>` or a `released:` end; `done` with `spawned` is
    `invalid-params`, and `advance` takes none. Baton validates the list before any write: at
    most 50 ids, each by the ticket-id rule (§12.3), none the parent's own. Baton records them as
    the run's children until the first accepted snapshot
    observed after the end; a reported child that snapshot does not post is dropped with discrepancy
    `spawned-unposted` (R-BTN-85).
  - **Core keeps the relation, not the policy.** `tickets.parent`, and `closed_tickets.parent`
    until purge; `GET /v1/repositories/{repository}/tickets/{ticket}/children` lists open and
    closed children with station and blocked state; a `spawned` history row when a child first
    appears; a tree on the dashboard. A `parent` that is not a local id, names the ticket itself,
    closes a cycle or lies more than 4 generations below a root (R-BTN-149) is stored as none and
    logged `parent-invalid` with the reason; one naming no known ticket is stored and drawn
    orphaned. No snapshot is refused for a parent.

### 4.7 History and discrepancies

- **R-BTN-81 (the ticket's history: a running record, not a replay log).** `status: built` Per ticket Baton
  appends one row per thing it saw: a leg started, finished or given up (claim, runner, course
  version, contract version, position, run number, `run_id` (R-BTN-63), `snapshot_sha`, `head_sha`); a position
  confirmed; a fact arrival, and an arrival not applied (R-BTN-39); an adoption; a re-route; a
  block or unblocking; a condition opened or closed; a person leg's question posted, answered or
  expired (R-BTN-116); inputs given and outputs reported (an `inputs` row names its
  `leg_run_inputs` rows); `spawned`; `discrepancy`.
  - Rows hold names, ids, versions, pointers and digests only (R-BTN-33); `detail_json` at most
    2 KB.
  - It is the ticket's course history (R-BTN-39): the position Baton holds is its latest
    position row, and nothing in git rewrites it. The rest of the record is never replayed into
    state.
  - Kept while the ticket is live and 90 days after it closes: the alarm batch-deletes the
    history, `leg_outputs` and `leg_run_inputs` of tickets closed longer (found through
    `closed_unpurged`) and sets `closed_tickets.purged_at`.
  - Read with `GET /v1/repositories/{repository}/tickets/{ticket}/history?before=&limit=` (at
    most 200 a page) by the principals that may read the ticket's blocks, and on the dashboard's
    ticket view.

- **R-BTN-85 (every disagreement with git is logged).** `status: built` When an accepted snapshot disagrees
  with something Baton holds, Baton logs, in the same transaction, an event and a history row of
  kind `discrepancy`: `{sub, baton: <value and its source>, git: <the snapshot's value>,
  observation}`, and, where git states a value, adopts it at once (R-BTN-35). The subs:

  | sub | when |
  |---|---|
  | `position-disagrees` | Legacy, removed with its code (R-BTN-193). A posted ticket whose `status` is `available` while Baton holds a non-empty path for it (R-BTN-74); once per station; both values are positions (R-BTN-33); listed on the dashboard's Sync screen (§11.4), nothing adopted, never on Needs you |
  | `bars-mismatch` | posted bars lack a tag the holder declared (R-BTN-63) |
  | `closed-under-claim` | a ticket closed while a claim is active on it |
  | `spawned-unposted` | a reported child the first snapshot after the end does not post (R-BTN-86) |
  | `output-invalid` | a posted output pointer failed its schema or digest (R-BTN-109): logged and raised, nothing adopted |

  Git never writes a position (R-BTN-39), so an arrival Baton does not apply is an
  `arrival-unapplied` row on the ticket, not a discrepancy. A discrepancy accompanies the events
  those cases log; any condition a case raises is its owning rule's. The dashboard lists
  discrepancies by sub and age.

- A ticket store showing Baton's position is proposed in
  [tickets and sources](../proposals/tickets-and-sources.md).

### 4.8 Owner state

- **R-BTN-88 (owner state and course history are exportable; the ticket source and git hold the work).** `status: built` Baton
  rebuilds tickets and readiness from the ticket source and git. **Owner state** and **course
  history** live only in Baton's store (R-BTN-66, R-BTN-39); the tenant's administrator exports
  them and imports them into another Baton.
  - **Format** `baton.owner-state/v1`: `{format, schema_version (highest applied migration),
    exported_at, origin, events_seq, sections, digest}`; `digest` is SHA-256 over the RFC 8785
    canonical JSON of the rest. **Default sections** (each table's stored columns):
    `repositories`, `repository_owners`, `credentials`, `sync_keys`, `runner_grants`,
    `runners`, `owner_bars`, `ticket_overrides`, `closed_tickets`, `external_resources`,
    `resource_instances`, `instance_serves`, `couriers`, `instance_readings`,
    `repository_policies`, `policy_floors`, `human_keys`, `capability_capacity`,
    `instance_settings`, `ticket_stations`.
    Policy versions and floors are for live repositories (R-BTN-188, R-BTN-189); the human key
    register is tenant-wide (R-BTN-185), and host-configured keys do not travel with it.
    `policy_floors` also holds the backing rows for live legacy floor projections (R-BTN-189); a
    schema storing legacy floor rows always includes the section in the digest, as an empty
    array when there are no such rows.
    Only Baton-owned positions on live repositories are exported; the board rebuilds the rest.
    Import zeros runners' liveness and activity timestamps.
  - **History sections** (only with `--with-history`): `ticket_history`, `leg_outputs`,
    `leg_run_inputs`. An import without them loses them. A populated `leg_run_inputs` section
    cannot be restored into an empty target: its rows require originating claims, which do
    not travel in the export.
  - **Not exported**: claims, their seats and leg rows, events, reading history, sync wants,
    and the board cache apart from the Baton-owned positions above.
  - **Import** (`POST /v1/admin/import`): one transaction, into an **empty** Baton only (no
    repository, owner or credential but the seeded `legacy` row), else `conflict`; digest
    checked (`invalid-params`); the same `schema_version` and all default sections required —
    a missing `policy_floors` section is refused even with a valid digest and policy hash chain.
    Rows pass import validation and invariants (one role per key, unique names, id grammars,
    tombstones only on retired rows); the first failing row refuses the whole import. Every live
    repository needs its original policy versions, validated as documents and by their hashes
    and contiguous `previous_hash` chain starting at version 1. Import writes them unchanged
    and seeds none; a retired repository's tombstone needs none. Import refuses floors whose
    guarantees do not hold on the imported policy and authority facts (R-BTN-189); it does not
    check a live protection report. It validates legacy rows using the stored format, and on a
    schema that uses projection it checks the current projection after restoring its backing
    data (R-BTN-188, R-BTN-189). Imported human keys must not be destination administrator
    keys (R-BTN-57). A digest checks integrity,
    not the authority of the source. Signed requests with `created` at or before the source's
    `sealed_at` are refused `unauthenticated`. Ticket-scoped rows wait in `pending_owner_state`
    until the ticket is posted for an override, or placed for a Baton-owned position. A pending
    row whose ticket is absent from a snapshot that materializes the ticket set is dropped and
    logged. A further move exports rows that are still pending. Before the first accepted
    placement on the current or new head is judged (R-BTN-39), Baton restores the pending
    position and rebuilds its outgoing legs from the course in force. Until then the ticket is
    not offered (§4.4). The event sequence continues from `events_seq`.
  - **Moving a Baton**:
    1. **freeze** (`baton admin freeze`, `POST /v1/admin/freeze`; `baton_settings.frozen_at`,
       event `frozen`): new claims and owner writes are refused `frozen`;
       `POST /v1/admin/unfreeze` (event `unfrozen`) undoes it before the seal;
    2. **seal** (`baton admin seal`, `POST /v1/admin/seal`) once no claim is active or
       fence-pending (R-BTN-178) and every live repository with a mirror (R-BTN-93) has
       `mirror_acked_seq` at the last event; else `conflict` naming the claims and lagging
       mirrors, whose mirror workflows it dispatches (R-BTN-94). The
       seal logs `sealed` (seq `events_seq`) and sets `baton_settings.sealed_at`; from then the
       Baton logs nothing, its alarm idles, and every request but an administrator's read is
       refused `sealed` (503, retryable);
    3. **export** (`GET /v1/admin/export[?with_history=1]`), sealed only, deterministic
       (`exported_at` is `sealed_at`), logging nothing;
    4. **import** into the target;
    5. keep the origin (move DNS), or give each repository the new `baton_url` and repoint every
       sidecar (signatures are bound to the origin, §2);
    6. the sealed source never serves again; an abandoned move is finished by importing into a
       fresh Baton at the source's origin.

    The format is the same on every host.
  - An export holds no private key but names every key, grant and secret hash; the CLI writes it
    mode `0600`. It is a move, not a backup.
