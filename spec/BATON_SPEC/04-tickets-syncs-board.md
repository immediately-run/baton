---
title: "4. Tickets, syncs and the board"
description: "A repository describes itself in its .baton/ folder."
---
## 4. Tickets, syncs and the board *(proposal)*

A repository describes itself in its `.baton/` folder. Its **sync** — `baton repo sync`, run by
a CI workflow, a cron loop or a runner (R-BTN-94, R-BTN-105) — reads the tickets and their
courses' evidence from git and posts a **board** to Baton. Baton keeps the board as a cache of
git at the posted commit (R-BTN-35) and orders boards by compare-and-set and observation
numbers. Tickets, readiness and blocks are rebuilt from git; owner state and course history
live solely in Baton, and both are exportable (R-BTN-88).

### 4.1 The `.baton/` folder and the registry

- **R-BTN-51 (the `.baton/` folder).** A registered repository describes itself in one folder
  at its root:

  ```
  .baton/
    baton.json          # baton_url; courses: [{id, version, min_runner_version, skill?, step_kinds,
                        #   branch_pattern, previous_branch_pattern?,
                        #   protocol_files, source?, facts?}]; imports?;
                        #   conditions? (bindings,
                        #   R-BTN-161); for the CLI's defaults (R-BTN-74): items, default_course,
                        #   repos, agent_command, agent_wrapper (B-95); legs: {<course>:
                        #   {<leg>: {agent_command?, executor?}}} (R-BTN-131, R-BTN-107);
                        #   executor_schema (R-BTN-107); check: {depends_line,
                        #   sections_since, sections_from_id, rules} (B-111; R-BTN-74 says what
                        #   each does and what CI judges with them: the ticket check and commands
                        #   alone read them; default off);
                        #   ticket_prefix, legacy_ids, prefixes, project, tags, projects
                        #   (B-112, the ticket commands alone read them)
    tickets.mjs         # optional ticket source; absent, the CLI's markdown source (R-BTN-74)
    courses/<course>/   # an own course; a sourced course's directory holds only overrides (R-BTN-134)
      course.json       # the course file (R-BTN-69)
      sync.mjs          # the station function (R-BTN-74); required
      rank.mjs          # optional ranking code (R-BTN-98)
      legs/<leg>.<ext>      # one per leg; ext mjs, js, cjs, mts, ts or cts (R-BTN-133)
      legs/<leg>.run.<ext>  # optional run override (R-BTN-131)
      legs/<leg>.md         # leg instructions (R-BTN-131)
    package.json        # optional, with its lockfile: the legs' dependencies; never the root's (R-BTN-133)
  ```

  A sourced entry's fields default from its source's `entry.json` (R-BTN-134).
  - `course.json` is the course's whole state machine; `baton.json` names courses and
    settings, and of a leg only the home's settings for how it runs (`legs`: its agent command and
    executor data), never its stations, edges or contract.
  - `branch_pattern` (default `claude/{ticket}-*`; grammar in R-BTN-141) maps a pushed branch
    to the course's tickets for the branch-holder query (§9) and finds an earlier attempt's
    branch (R-BTN-25). Without `{repository}`, a branch may map to tickets of two repositories,
    and the query fails safe (a push is refused while either is held by another).
    `previous_branch_pattern` stays matched by the query and the local branch check until the
    course's author drops it.
  - `protocol_files`: the paths whose change bumps `version` (R-BTN-22).

- **R-BTN-48 (a ticket names its course; Baton does not know what the course does).**
  - Each repository's sync posts a **registry** from `.baton/baton.json`: per course its id,
    `version`, `min_runner_version`, skill, course file and the fields of R-BTN-51 (§4.4).
  - Each ticket names its course (markdown source: `course:`, default `default_course`, itself
    default `create-pr`).
  - Course logic runs outside Baton, in the sync's station function (R-BTN-39). Baton receives
    per ticket, as the sync's attestations (R-BTN-191) and with the ticket, the legs leaving its
    station with their state, what a waiting leg waits on, fact arrivals, barred tags, a queued
    person leg's question, the newest hand-off document and opaque course fields — never the ticket's station or path, which are
    Baton's; it
    validates every name against the course file (R-BTN-69) and never reads a marker, review or
    skill.
  - Runners declare `{course, version}` pairs from their checkouts; Baton recommends and grants
    a ticket only to a runner declaring its course at `min_runner_version` or later (§6). A
    course's `version` is its skills' version (R-BTN-22, R-BTN-65).
  - A new course definition must replay in-flight tickets from the evidence the old one left;
    `baton course test` checks it before merge (R-BTN-64).

### 4.2 What a sync runs

- **R-BTN-74 (the ticket source and the station function, with defaults).** `baton repo sync`
  builds the board post from two pieces of repository code:
  - **The ticket source**, `.baton/tickets.mjs`, default-exporting `tickets(ctx)` → the board's
    `tickets` and `closed` (§4.4), each ticket with optional sync-local `fields` that the sync
    hands to station functions and never posts. It decides what a ticket is — a file, an issue,
    a row — and how tickets rank. It also exports `file(ticket)`, which writes a new ticket (handler tickets,
    R-BTN-161; call children, R-BTN-165), and `withdraw(ticket, reason)`, which writes a
    withdrawal (R-BTN-168, R-BTN-171).
  - **Each ticket's version** (B-183). `tickets(ctx)` gives each live ticket a `version`: an
    opaque string of 1–128 characters of `[A-Za-z0-9._:+/=-]` (§12.3), validated on write, whose
    meaning is the source's own and whose only reader-comparison is **equality** — Baton never
    orders two versions and never reads one as a time (values 4). The **version contract**: a
    ticket's version changes exactly when something a runner reads of it changes — its body, exit
    criteria, filter fields, closure. A source that bumps it for anything else (a comment, a
    watcher) stales claims for nothing; one that misses a change lets a runner work a ticket that
    moved. A digest of what `read` returns, optionally prefixed by the store's own stamp
    (`<updatedAt>:<digest>`), is recommended over a timestamp alone, which collides within its
    resolution.
  - **How the source reads** (B-183). The default export may declare `versions` — `"pinned"`
    (it can read a ticket **at** a version) or `"current"` (only as it is now) — and a
    declaration exports `read(id, {version?, checkout?})` → `{version, ticket}`, run on the
    runner like the source's other exports: a pinned source is read at its version, a current
    one as its store holds the ticket now — the read-now comparison is a current source's whole
    staleness protection, so the CLI refuses at load a source that declares `versions` without
    exporting `read`, rather than run its claims with no re-verification at all. A source that
    declares neither is read as declaring nothing: its tickets keep `path` required
    and no claim is re-verified by version. `tickets(ctx)` reads its store after the observation
    number was handed out and sees every write made before it (§4.3, R-BTN-62); `ctx.versions`
    carries each live ticket's last accepted version as the observation returned it, and a
    source whose store can tell a stale read — a lagging replica — refuses to post a ticket whose
    version it judges older, failing the run as any failing source does (R-BTN-150). The order of
    two versions is the source's judgement, never Baton's.
  - **Each course's station function**, `sync.mjs` in its course directory (own or the
    source's, R-BTN-134), default-exporting `stations(ctx)` → `stations` (per ticket: readiness,
    fact arrivals, implied station, outputs, bars, the queued person leg's question, `not_before`)
    and that course's opaque `course_data`, from git, the fact adapter's PR facts (R-BTN-96) and
    `ctx.positions`, each live ticket's position as the run's observation returned it (§4.3,
    R-BTN-39). What it returns per ticket is readiness, fact arrivals and an optional implied
    station, never a position. The sync posts bars, the question and `not_before` with the ticket,
    the rest as its attestations (R-BTN-191), and `course_data` keyed by course id.
  - `course.json` is always the commit's own (or its source's): the sync posts and `baton
    runner start` loads the same file.
  - **CLI default ticket sources** (`src/defaults/`), used when the repository has no
    `tickets.mjs`: **markdown** (below) and **`changes`**, one check ticket per open change
    (R-BTN-114). `baton repo init --eject tickets` copies the markdown source into `.baton/`; a
    repository leaves a default by adding its own file. Defaults are CLI code run in the sync,
    never core: `src/core/` may not import `src/defaults/`.
  - **The markdown source.** Every `*.md` or `*.mdx` under `items` (default `tickets/`) whose
    frontmatter has an `id` is a ticket. It is **pinned** (B-183): each live ticket's `version`
    is the ticket file's **blob id** at the posted commit (`git rev-parse <sha>:<path>`) — a
    blob id, not the commit's sha, so an unrelated commit changes no ticket's version — its `key`
    is its `path`, and its `read` is the blob itself, exactly what the runner reads today; a
    ticket whose file is not at the commit is posted with no version. Its frontmatter:

    | field | posted as |
    |---|---|
    | `id`, `title`, `tier`, `parent` (R-BTN-86), `not_before` (R-BTN-89) | the same |
    | `status` | `done` → `closed` as done; `withdrawn`, `superseded`, `deferred` → `closed` as withdrawn; any other → live, in `display` |
    | `course` | `course_id` (default `default_course`, else `create-pr`) |
    | `requires` | capability names, expanded |
    | `tags` | `EXPEDITE` → `expedite`; `OP` → `human-operator` in `requires` |
    | `depends_on` | `depends_at: {ticket, done: true, leg: <the course's start_leg>}` per id (R-BTN-120) |
    | `repos` | forge paths, short names resolved through the `repos` setting (`owner/name` stands) |
    | `order` | `rank` (by `order`, then id) |
    | `conditions` | the ticket's bindings (R-BTN-161) |
    | `prs`, `answer` | never posted: the ticket's sync-local `fields`, which station functions read (R-BTN-33); its `course` is `{}` |

    Other fields are ignored. Two files with one `id`, or a `repos` name with no mapping, fail
    the sync: nothing is posted and the run names the file. `file(ticket)` writes
    `<items>/<local id>.md`; `withdraw` sets `status: withdrawn` and `withdrawn_reason`.
  - **`baton ticket check [--repo DIR] [--quiet]`** (B-111, R-BTN-127) reads that source as a sync does — an
    ejected `.baton/tickets.mjs`, else the markdown default — and checks what it would post, without
    posting: the source's own refusal (a duplicate `id`, an unknown `repos` short name, an `order`
    that is not a number), the board post's validation (§4.4, the cycle among it), every
    `depends_on` naming a live or a closed ticket, and no cycle (named once or more, `B-1 → B-2 → B-1`). With
    `check: {depends_line: true}` in `.baton/baton.json` (default off) it also holds each markdown
    ticket's `**Depends on:**` body line — which runs to the next blank line or `**Label:**` line;
    a `**Used by:**` line is never read — to its `depends_on`, both ways; a ticket with no such line
    is not compared. A ticket is dated by the day it was filed: its `## Status` `_filed
    YYYY-MM-DD` line, else the author day (`%as`) of its file's first commit
    (`--diff-filter=A`), else — a file not yet committed — today; never by a later edit. The
    sections check alone dates it by the later of the `_filed` line and that first commit where
    git shows the commit, so a `_filed` line copied from an older ticket cannot carry a new one
    back past the cutover in a full clone. With `check: {sections_since: "<YYYY-MM-DD>"}` (default
    off), a live ticket filed on or after that day whose `### Trust` or `### Invariants` section is
    absent, empty or still the skeleton's `_(…)_` placeholder is a finding. Not judged: a `kind:
    project` page, which builds nothing, and a request ticket (`tags: [request]`, as `ticket
    request` writes it, R-BTN-127), one sentence its course's legs turn into the work's own
    tickets; and a ticket the runner writes for a condition (`handles:`, R-BTN-161) or a call
    (`called_by:`, R-BTN-165), whose body is the leg's own subject and body. A child a filing leg
    writes (`parent:` alone) is the work's own ticket and is judged like any other; the standard
    filing legs write both sections and the `_filed` line. With
    `check: {sections_from_id: "<prefix>-<n>"}` beside it (default off; this repository: `B-176`), a live
    ticket under that prefix numbered `n` or above without a `_filed` line is a finding too, and is
    otherwise judged by it, so the check decides it without history, in CI's depth-1 clone
    included; a ticket below `n`, or under a legacy prefix, without a `_filed` line is dated by its
    first commit, which a shallow clone (`git rev-parse --is-shallow-repository`, whose boundary
    commit shows every older file as added there) does not show: it is listed as undetermined, on
    one line, never a finding. `tickets new` writes the `_filed` line into every filing,
    `--body-file`'s included, as `ticket request` does, and on or after the day refuses, before it
    pushes, a filing whose either section is absent, empty or a placeholder — the skeleton is
    filled by `--trust` and `--invariants` — so no unfilled ticket reaches the default branch to
    fail every open PR's check. It also reports, never as a finding, each live ticket citing a
    rule id that a dated entry of the spec's history (`check.rules: {history, prefix}`, default
    `spec/BATON_SPEC_HISTORY.md` and `R-BTN`; no file, no report) amended — one its bold title
    names (`**YYYY-MM-DD — <ids>: …**`) or its `Rules changed: <ids>` line names, the line
    directly under the one the title closes on (an id only the entry's body mentions, as evidence
    or in a review round, is not one it amended) — dated after the day the ticket answered for
    that rule: the day it was filed, or the day of a later `rules re-read` note in its `## Status`
    naming the rule (the claim's, below, or `_(<date>: rules re-read: <id>, …)_`, which a spec PR
    that rewrote a clause adds for the ids it handled). The comparison is by day: an entry dated
    the same day as that answer is not after it. `npm run check:spec` fails an entry dated after
    2026-11-03 that names no rule id in its title and has no `Rules changed:` line (`Rules
    changed: none.` for one that amends no rule); an entry dated on or before 2026-11-03 counts
    only where its title names ids, so the report covers the amendments from 2026-11-04 on, and of
    the earlier ones only those whose titles name their rules. One line per ticket, then their
    count. In a shallow clone the report is skipped with one line saying so; that is never a
    finding. Exit 1 with one `path: message` line per finding, 0 without; an unreadable root or a
    malformed `baton.json` is an error (exit 2). It reads; it never writes.
  - **What the guards trust.** The `_filed` line, `tags: [request]` and the `rules
    re-read` notes are claims the ticket's author writes in git, which anyone who can push can
    write (`docs/security-model.mdx`, reach 3); the check and the claim read them and verify
    nothing about them beyond their form, and review is what verifies them. A `_filed` line dated
    falsely, a tag written to escape the sections check, or a re-read note naming ids
    its author did not re-read is the author's false statement, which review catches, not the
    machine. The guards prevent the honest mistake — a ticket built as written after a ruling, a
    filing without its sections — and claim no more.
  - **The ticket commands** (B-112, R-BTN-127): `baton ticket new | claim | set | done`, whose behaviour is
    the git-lock commands docs' `claim.sh` and the repositories' `scripts/ticket.mjs` had, kept
    once in the CLI. `claim`, `set` and `done`'s push-retry as the mutex, and `new`'s next free
    id, are legacy, to be retired (R-BTN-193); `new` itself stays. Each is one commit pushed straight to the default branch from a throwaway
    worktree at the freshly fetched head (`--branch`, else the checkout's `origin/HEAD`, else
    `main`), so the caller's branch, HEAD and working tree are never written; a push refused
    because the branch moved is fetched again and retried, up to six tries, and a refusal for any
    other reason is the operator's, reported in git's own words.
    - `new --title T [--description D] [--project ID] [--depends-on A,B] [--tags X,Y] [--tier T]
      [--order N] [--repos a,b] [--course C] [--body-file F] [--trust T] [--invariants I]` takes the next free `<prefix>-<n>`
      on the head it pushes to (across the items folder at any depth, `archive/` included, among
      files whose frontmatter carries an `id`), and writes the conventional body unless
      `--body-file` names one: `**Brief:**` (the description), `**Spec:**`, `**Depends on:**`
      (from `--depends-on`; `none.` when empty), `**Used by:**`, `### What to build`,
      `### Trust` (every new input the ticket adds — a field, a file, a commit trailer, a request —
      who may write it and how it is verified, or "no new input"), `### Invariants` (the rules it
      must not break, by id, and how the design keeps each), each with a placeholder naming no
      repository's ids or paths, `### Tests`, `### Exit criteria`, `**Requires:**` and `## Status` with the filing date.
      A `--body-file` whose `**Depends on:**` line disagrees with the flag is refused. Before the
      push it judges what it writes as `baton ticket check` judges it — the body line against
      `depends_on`, every id a live or closed ticket, the board post's validation of §4.4 (the
      cycle among it) over the files the commit would leave — and a filing that fails is written to
      no branch at all. Each dependency's `**Used by:**` line gains the new id once: the reverse
      mention. A description that ends with a `Requires:` clause (`… Requires: human-operator,
      drivable-browser.`) has the capabilities it names written on the `**Requires:**` line.
    - `claim <id> [-i KEY] [--url URL] [--offline] [--rules-reread <ids>]` moves a ticket available → in-progress, and
      refuses one that is not available or whose `depends_on` are not all done (archived, or
      carrying any of the markdown source's closed statuses). Before it writes it reads the
      ticket from Baton with the key `-i` names (else `BATON_KEY_FILE`) — the pickup side of the
      owner's ruling that Baton owns a ticket's course history (B-120, B-129): the board answers
      the station, the ready leg and the repository's live claims; the history answers the path
      and the ended claims' branches and PRs; the branch-holder query answers a branch the change
      lives on. Baton holds a ticket past its course's start when its current position — the
      board's ready row's station, else the newest history row that reached a station — is not
      the start (the checkout's course file's, else the standard course's, R-BTN-131); such a
      ticket is claimed as a **takeover**. Baton's position overrides only a
      false `available`: a ticket git says `in-progress` or `in-review` (the git lock) or parked
      or closed is refused as before, and so is one whose dependencies are not done. A takeover
      keeps every `prs:` entry and writes back any Baton knows, prints the position — station,
      ready leg, PRs, branch, hand-off — for the session to continue from, and the session works
      that leg on that branch, never checking out a new one. Another claim Baton holds refuses,
      naming the holder and its lease: when it ends, or that it ended (by the board's
      `server_time`) and the claim awaits reaping, or that a legacy claim has none; starting over
      is the owner's `adopt` (R-BTN-39), never a claim flag. An unanswered read — Baton
      unreachable, `forbidden`, no key or a key that cannot be read (judged before any request,
      and named as the key's), or a position on a course whose start neither names — refuses, naming which, rather than fall through to the
      frontmatter, unless `--offline` claims on git's word alone (Baton's position is then
      unknown, not refuted). It also refuses a ticket whose body cites a rule that a history
      entry dated after the ticket answered for it names (the check's stale-rule reading, above,
      at the head the claim lands on), listing each id with the entry's date and title. In a
      shallow clone whose boundary would date the ticket, it first runs `git fetch --unshallow`
      (bounded, quiet), and refuses, naming that fix, when the fetch fails. With `--rules-reread`
      it claims only when the comma-separated ids it names (`--rules-reread R-BTN-33,R-BTN-50`)
      are exactly the stale ones, refusing otherwise with the ids not named and those not amended
      since; the claim's commit adds `_(<date>: rules re-read at claim: <id> (amended <date>),
      …)_` to the ticket's `## Status`. `set <id> in-progress` is a claim and reads the same, and
      no other `set` takes the flag. `set <id> <status> [--pr URL] [--note TEXT] [--rules-reread
      <ids>]` writes any live
      status — `done` is `done`'s — and adds the pull request URL to `prs` once; a release
      (`set <id> available`) keeps every `prs:` entry and refuses a write that would drop a PR
      Baton's record holds while Baton offers the ticket ready past its start. Its commit is the
      hand-off, for the next claimant to read at `git log -1 <items>/<id>.mdx`: after the subject
      `tickets: release <id> → available`, one line each — `PR <url>` for every PR the file
      names; and, when Baton holds the ticket past its start, `Station: <station> (Baton)`,
      `Next: <leg> from <station> (Baton's ready row)` (or that the board offers no leg ready)
      and `Branch: <branch>` for each branch Baton's record names; then `Left: <text>`, the
      `--note` — what is left, in the releasing session's words. A line Baton cannot answer is
      left out, never guessed. `done <id> [--pr URL]` writes `done` and moves the file to
      `<items>/archive/`; the drop-PR refusal never applies to it.
    - The settings are the repository's: `items` (below), `ticket_prefix` (`B`), `legacy_ids` — id
      patterns the repository still accepts but never allocates (`R3-\d+` here) — `project` (the
      default `--project`), `tags` (the default `--tags`, else `roadmap-item`) and `prefixes` (a
      prefix to its pattern source, for a repository that allocates more than `\d+`). There is no
      hard-coded project: `new` without one it can name refuses. `--project` and the default both
      name a `kind: project` page in the items folder's `projects/`, which `new` refuses without.
    - `baton ticket --help` lists the commands, every flag, the tags Baton reads and what each
      does — `EXPEDITE` (: expedited, first in every claim's order) and `OP` (`human-operator` in the
      ticket's `requires`) — and the `Requires:` clause a description may end with.
  - **The "How tickets work" page** (B-112): `baton repo init` writes `HOW-TICKETS-WORK.md` into
    the items folder — the same text in every repository, with the id prefix, the legacy patterns
    and the default project read from that repository's `.baton/baton.json` — covering the
    frontmatter keys and statuses; the ids; the tags Baton reads; the body's header lines
    (`**Depends on:**` naming exactly `depends_on`; reverse mentions on `**Used by:**`; a wait on
    another repository's ticket on `**Waits on:**`, relations staying inside one repository, §4);
    projects (choose or create a related set's project before filing); and the commands. It is
    written again when it differs, and `baton ticket check` reports a page that differs from the
    release's text, so docs, baton and fieldhouse cannot diverge.
  - Standard courses' legs are stubs that run `agent_command` (R-BTN-131); the CLI ships no leg
    scripts and no station functions.
  - The sync workflow pins the CLI's npm version (`npx --yes @immediately-run/baton@<version>
    repo sync`); a CLI release changes no repository until it bumps the pin. Courses are
    versioned by their source commit, separately.
  - **The run's outcome is its line and its exit code** (B-89). `baton repo sync` ends with
    `baton: <outcome> at <sha> — <steps>`: `advanced` and `confirmed` posted, and exit 0; `held`
    refused a force post into holding, so nothing was posted, and exits 0 with the workflow's
    warning saying so; every other outcome posted nothing and exits 1 — `busy` (another run's
    number outstanding, R-BTN-62) and `busy:again` (its one retry found the same) included,
    since a run that posted nothing is never a success.
  - **A `busy` run waits and retries once.** `--busy-retry <s>` (default 60, `0` for none, at
    most 600) is the wait before a `busy` run takes a fresh number and syncs again, once. The
    **retry's** wait comes before its first observation, never between a number and its post;
    a run's own retry of an `unavailable` answer is the existing in-run backoff
    (`syncOnce`'s 30 s), unchanged and inside the run.
  - **The workflow annotates the outcome.** The default workflow runs the sync into `sync.log`
    (its exit preserved through the pipe, the step bounded at ten minutes), then — even on
    failure — reads the last `baton: <outcome> at <sha>` line, matched anywhere in the line and
    requiring the sha: `advanced|confirmed` is a notice, `held` and `busy|busy:again` a warning
    saying the run posted nothing (a busy one names R-BTN-62's ten idle minutes, which a dispatch
    inside them does not shorten), and anything else, or no line at all, an error. A run's failing
    check is never silent.
  - **A flag reaches a workflow with its CLI's pin.** The workflow passes a repository's pinned
    CLI only flags that CLI knows: a new flag (an outcome word, a retry) ships in the CLI, and a
    repository's workflow passes it only after `baton repo init` moves the pin to a CLI release
    that carries it. Until then the annotation alone keeps a run that posted nothing from looking
    posted — the old CLI's `busy` is still exit 0.

### 4.3 The sync run and the head

- **The sync run.** A run checks out with full history (ancestry needs it), then:
  1. `POST /v1/sync/observation` → `{sha, observation, bars, pushers, code_repos, check_app_id,
     provisional, positions, versions, unconfirmed}`: Baton's head (null before the first post; the named
     commit, with an unmaterialized board, after a forced Resync, R-BTN-11), a fresh observation number (R-BTN-62), the owner bars in force or
     scheduled (R-BTN-67), the trust inputs (R-BTN-139, R-BTN-140), the commits provisional block
     rows wait for (R-BTN-126), `positions` — every live ticket's `{station, path_len, path,
     next_leg, running?}` from Baton's course history (R-BTN-39); a ticket absent from it is at its
     course's `start` — `versions`, each live ticket's last accepted version (B-183), Baton's own
     record returned to the posting credential only, as `positions` is, for the source's code to
     judge its store's read against — and `unconfirmed`, every unconfirmed end's `{ticket, claim, evidence?}`
     with the `ended_at_sha` it named (R-BTN-10) — before it reads anything else;
  2. fetches and sets `new` to `origin/<default branch>` (the registered branch), then reads PRs
     and code repositories, so everything posted was read after the number was handed out — the
     ticket source included: `tickets(ctx)` reads its store after the number and sees every write
     made before it. That read-after is the source's obligation (B-183), and confirmation's
     every-input rule (R-BTN-10, R-BTN-62) relies on it as on the sync's own reads;
  3. checks the head is founded (R-BTN-147), then runs every course's `sync.mjs` — always, even
     when `new` equals the head, since evidence lives in PRs, reviews, checks and code
     repositories;
  4. posts the board (§4.4) with its number: `sha: new, parent_sha: head` when the head is an
     ancestor of `new`; a **refresh** (`sha` and `parent_sha` both the head) when `new` equals
     the head — the run's attestations replacing the previous run's, and its tickets too where
     their `version` differs from the row Baton holds (B-183): a refresh may add, close or
     change any ticket whose version moved, since a source's store can move with no commit. A
     refresh carries `read_sha`, the commit its tickets were read at, and materializes them only
     when that is the head it refreshes — a `confirm-only` re-post of the head from a checkout
     behind it (§7.1) is labelled with the head's sha while its body was read at the ancestor,
     and writing that body would roll the ticket cache back to an older reading, so it changes
     no ticket row; a post naming no `read_sha` (an older CLI's) changes none either. The
     re-checks of the new-head path guard a refresh that writes rows the same way: a reading
     overtaken while its rows were hashed is `stale-observation`/`head-moved`, never a rollback
     over the newer post. For the markdown source no version changes without a new commit, so
     its refreshes carry no ticket change; when `new`
     is a strict ancestor of the head (a lagging fetch), nothing — it releases its number with
     `behind: new` (R-BTN-150). Every exit that posts nothing releases its number.

  A post over R-BTN-149's caps is refused `too-large`. Baton materializes each accepted snapshot
  into `tickets`, upserting rows whose `row_hash` changed and deleting rows of tickets
  that left the board, a ticket marked `cancelling` excepted (R-BTN-168); `version` and `key`
  are inputs of `row_hash` (B-183), so a ticket whose version moved rewrites its row on a
  refresh as on a new head; after a forced Resync
  every row is written (R-BTN-11); its stations likewise write only the rows that changed (R-BTN-70), so a
  post costs rows written in proportion to what moved, not to the board's size (R-BTN-2). The
  protocol is the CLI's (`baton repo sync`); the repository supplies only its ticket source and
  station functions.

- **R-BTN-62 / R-BTN-150 (observations are ordered by Baton).**
  - Each `POST /v1/sync/observation` hands out the next number of a per-repository counter;
    the post carries it back. A post is accepted or refused **whole**, and refused
    `stale-observation` unless its number is greater than the last accepted one's and was
    issued to the posting credential.
  - A snapshot confirms an end (R-BTN-10) or makes a claim stale (R-BTN-35) only when its number
    is **strictly greater** than the counter's last handed-out value recorded at that end,
    claim or `advance`.
  - **One reading in flight.** While a number is outstanding (handed out, not yet posted or
    voided) the observation route answers `sync-busy`. An outstanding number records its
    credential.
    - The holder renews it while reading, at most every 2 minutes:
      `POST /v1/sync/observation {renew: <number>}` resets its idle age.
    - Another credential's request voids a number idle over 5 minutes; the same credential's
      after 10 minutes. Any other credential's request voids a number 30 minutes after issue,
      renewals included; with no competitor it still posts.
    - The repository's sync key or CI identity voids at once a number another credential holds
      (never between the sync key and the CI identity; a CI identity is one credential whatever
      run holds it).
    - A post bearing a voided number is `stale-observation`. A number held past 15 minutes
      raises `baton.observation-held`.
    - **Release.** A sync run that will not post — nothing to post, a failed trust read
      (R-BTN-139), a failing ticket source (R-BTN-74), an unfounded head (R-BTN-147), any error
      exit — gives its number back with `POST /v1/sync/observation {release: <number>, behind?:
      <sha>, unfounded?: <sha>}`; the number is then voided. `behind` reports a lagging fetch and
      `unfounded` a head Baton's is not an ancestor of (R-BTN-147).
    - **The bar.** A number **lapses** when it is voided for idleness or age, never posted or
      released; being voided at once by the sync key or CI identity is not lapsing. A credential
      that lets two numbers lapse within an hour takes none on that repository for an hour
      (`sync-busy` with `retry_after_s`) and raises `baton.sync-barred`. The bar never applies to
      the sync key or CI identity.

- **R-BTN-11 (snapshots advance by compare-and-set on ancestry).** Per repository, Baton accepts
  a snapshot only when `parent_sha` equals its head (a refresh: both equal the head) and its
  observation is newer, then moves the head. A first snapshot is accepted with `parent_sha:
  null` only while no head exists. A lost race is `head-moved`; the sync re-reads and retries.
  - **A rewritten default branch is adopted by an administrator, never by a post.** A post whose
    `parent_sha` is not the head is `head-moved` whoever posted it and whatever its `sha`
    descends from, and so is a post whose `sha` was an earlier head of the repository
    (`board_snapshots` holds every head), since Baton holds no git and cannot test ancestry for a
    commit it never saw; Baton's head stands, and the sync never posts one (R-BTN-147). An
    administrator adopts the new history with a forced **Resync** naming its head: `POST
    /v1/ui/resync {repository, force: true, sha}` (confirmed per R-BTN-155, the `sha` in the
    confirmation) or `baton admin repo resync <repository> --force [<sha>]` (R-BTN-127), which reads
    `origin/<default branch>` when none is given, shows it, and calls `POST
    /v1/admin/repositories/{repository}/resync {force: true, sha, confirm: true}`
    (`admin.repo.resync`, destructive, §12.2) with the administrator's key. In one transaction
    Baton logs an `admin` event `head-reset` naming the old head and the new, replaces the head
    with `sha` and marks the board **unmaterialized** (`board_head.reset_at`; the observation
    counter runs on, so nothing older is accepted), and records a sync want (R-BTN-94). The sync
    then posts as it always does against the head it is handed — a refresh of `sha`, or an advance
    whose `parent_sha` is `sha` — and the first post accepted after the reset is **materialized as a
    first snapshot's** whatever its `parent_sha`: every ticket it lists is written, every live
    ticket it omits is dropped as R-BTN-147 says, and `reset_at` clears. A post whose `parent_sha`
    is not `sha` stays `head-moved`, so only the named history follows. A `board_snapshots` row the
    `sha` already has is replaced. Claims whose `snapshot_sha` the new history does not reach end
    `released:off-branch` at their runner's next check (R-BTN-143). Ordering never depends on a
    clock.

- **R-BTN-147 (a board names a head that exists; dropped and renumbered tickets are raised).**
  - **The sync proves its head is founded.** After its full fetch, `baton repo sync` checks
    Baton's head against `new = origin/<default branch>` (after one fetch of the head's sha by
    name before declaring it absent). The head is **founded** when it is reachable from `new`, or
    `new` from it; **unfounded** when it is absent or the two have diverged. An unfounded head
    posts nothing: the run releases its number with `unfounded: new`, ends `unfounded` (exit 1,
    B-89) naming both commits, and Baton raises `baton.head-unfounded`, a `notify` condition on
    the repository naming them, closed by the administrator's forced Resync (R-BTN-11) or by an
    accepted post.
  - **A lagging fetch posts nothing.** When `new` is a strict ancestor of the head, the sync
    releases its number with `behind: new`. Baton keeps `board_head.behind_since`, the first such
    release since the head last moved (cleared when it moves); 30 minutes behind is a reset of
    the default branch to an earlier commit, not a lagging replica, and raises
    `baton.head-behind`, a `notify` condition naming both commits, closed by a forced Resync
    (R-BTN-11) or by a post that moves the head.
  - **Raised on any accepted post**, naming tickets, fields and posting key:
    - `baton.ticket-dropped` — the post drops, without listing it in `closed`, a ticket Baton
      holds state for (a claim, hold, backoff, open condition, fence); an active claim on it
      ends `released:stale-board`, and its owner state is kept in a `closed_tickets` row
      `closed_as: dropped`, as a closing's is (R-BTN-12). A ticket marked `cancelling` is never dropped,
      and its `cancel` leg's claim is never staled (R-BTN-168);
    - `baton.renumbered` — the post adds a ticket at the `key` of a ticket it drops; the new id
      takes the old one's hold and backoff (a `renumbered` event, actor `sync`, B-183). The
      `key` is the source's stable name for the ticket, posted with it and defaulting to its
      `path` (B-183): a tracker that renumbers its issues keeps the key, and Baton reads the
      move; a path was the git source's key all along.

### 4.4 The board post

`POST /v1/sync/board` — the one normative schema:

```
{ sha, parent_sha, observation,                                   -- R-BTN-11, R-BTN-62
  read_sha?,                                                      -- B-183: the commit the tickets were read at, when not
                                                                 -- `sha` itself; a refresh materializes only when it is the head (§4.3)
  source: { kind: 'markdown' | 'custom', versions?, cli },        -- R-BTN-74, B-183
  contains?: [<sha>],                                            -- the provisional commits (R-BTN-126) this post contains
  bindings?: { <type prefix>: <course> | { course, replaces } },   -- the repository's scope, from `.baton/baton.json` (R-BTN-161)
  registry: [{ id, version, min_runner_version, skill?,
               course: <course.json with its schemas>,           -- R-BTN-69, R-BTN-108
               step_kinds, branch_pattern, previous_branch_pattern? }],
  tickets:  [{ id,                                               -- local id
               course_id, version?, key?, path?, title, tier?,    -- version: R-BTN-74 (B-183); key: R-BTN-147; path: optional for a
                                                                -- custom source with versions: "current" alone
               requires[], expedite, repos[], rank?,             -- requires expanded; repos are forge paths
               parent?, not_before?,                             -- R-BTN-86, R-BTN-89
               depends_at?: [{ ticket, at | reached | done, leg? }],   -- R-BTN-120
               conditions?: { <type prefix>: <course> | { course, replaces } },  -- bindings, R-BTN-161
               check?: { sha, head_repo_id, head_ref },          -- check tickets, R-BTN-153
               display: { status?, group?, project? },           -- shown; core reads project and status only (R-BTN-33)
               handoff_url?,                                     -- R-BTN-24
               question?: { id, url?, severity?, options?: [{ id, reached }] },  -- the queued person leg's, R-BTN-116
               brief?: { signed, signer?, commit },              -- B-127: whose words the brief is
               bars: { <leg>: [<tag>] },                         -- R-BTN-60
               course: <opaque> }],
  closed:   [{ id, as: 'done' | 'withdrawn' }],                  -- tickets that left the board
  attestations: [{ type, ticket, ref?, value }],                 -- the sync's attestations, this run's observation (R-BTN-191)
  control?: { keys: [<fingerprint>],                             -- B-127: what the sync verified with
              groups: { agent_command, overrides, rank,          --   each {read, key, unsigned}: the
                                                                 --   commit a runner loads from (null: no
                                                                 --   signed version; key null: the
                                                                 --   pre-adoption baseline, honest only as
                                                                 --   the post's own head where the walk
                                                                 --   finds no change to the group), its signing
                                                                 --   key, the unsigned changes left behind;
                                                                 --   course (a course's legs/*.mjs and
                                                                 --   legs/*.md) may be absent from a sync
                                                                 --   before the group — while the setting
                                                                 --   is on, a claim fails closed on a
                                                                 --   missing group
              unsigned: [{ path, commits, fields? }] },          --   the notice's list (fields: EXPEDITE)
  course_data: { <course>: <opaque> } }
```

- Core reads every generic field and stores each `<opaque>` verbatim. Every station and leg
  named must be in the course file. Each attestation is validated by its type's schema and
  accepted with the post (R-BTN-191): readiness whose `at` is not Baton's station is discarded,
  and an arrival Baton does not apply is recorded unapplied (R-BTN-39). Confirmations are not
  posted; Baton derives them from the run's attestations (R-BTN-10).
- **The source declaration** (B-183): `source` names the ticket source — `markdown`, the CLI's
  default, or `custom`, the repository's own — and, when the source declares it, how it reads
  (`versions`: `pinned` at a version, `current` as it is now); Baton keeps the last accepted
  post's declaration and hands it to the claim answer (§4.5). A post from a `custom` source
  with `versions: "current"` to a repository whose policy's `floors` include `tickets-approved`
  is refused `invalid-params`, naming the guarantee: that guarantee is defined over a ticket
  file's approval (R-BTN-184), and what approval means for a tracker is a later ticket's.
- **Each ticket's `version`** (B-183) is validated on write (§12.3) and stored on its row, an
  input of its `row_hash`; Baton compares versions for equality only. `key` defaults to the
  ticket's `path`; a ticket with neither — no path, no key — is refused, for it names nothing
  stable. `path` is required of every source but a `custom` one with `versions: "current"`,
  whose ticket may live in no tree at all.
- `requires` arrives expanded to capabilities (`none` or no clause is `[]`). `repos` are forge
  paths naming the home or a `code_repos` entry (R-BTN-92, R-BTN-140) — unique across the
  reach, whatever the host — resolved by the sync from short names under the home's owner.
- **B-127's marks and record.** Each ticket's `brief` — `{signed, signer?, commit}`, marked
  whether or not the repository requires signed control — is stored with the ticket and served
  with the claim answer, so a privileged session's first sight of a brief is whose words it is;
  an unsigned one is a claim, not the owner (the standing harness rule). The post's `control`
  record stands for the repository, and a post that moves the head onto unsigned control inputs
  while the repository requires them signed raises one `unsigned-control` event under Needs you
  for the changes no raised event in the 7-day window already named — the paths and the commits
  — so one standing unsigned change does not re-notice on every later head move, and two
  notices that named different sets do not re-notify each other's names; the claim answers
  carry the record read in the claim's own transaction and stored with the claim, whatever the
  setting at the claim (round 2's pairing: a lost-response replay re-serves the same pairing,
  never a newer post's record, even after the owner turned the setting on),
  with the repository's own setting and owner keys, and every runner verifies the named
  commits' signatures — and the walk's own answer — before loading them (R-BTN-133). A group is read atomically:
  the record's `read` is the newest owner-signed commit that changed any of the group's paths
  while leaving every other path of the group at its own last owner-signed change — a signed
  change to one file never carries a sibling's earlier unsigned bytes into force. While a group
  names no signed version, no claim on the repository's tickets is handed out (fail closed,
  no attempt charged: the notice names what an owner signs once). The sync computes both where
  the git objects are, with the owner keys served by the observation (never read from the
  repository it is judging); B-137 moves the verification server-side over the raw commits.
- Every ticket with a ready leg is ranked, a suspended one included.
- A `question` is stored only for a ticket whose queued leg is a person leg (R-BTN-116); any
  other is dropped and logged `question-dropped`.
- A closing is recorded only from a post with a newer observation; a ticket that returns to the
  board clears it and gets its kept owner state back (R-BTN-12).
- A check ticket whose `check.head_repo_id` is not the repository's `forge_repo_id` is dropped
  (R-BTN-153).
- A post whose live tickets' `depends_on` form a cycle is refused `invalid-params`, naming it once
  as its path (`B-1 → B-2 → B-1`); an edge to a closed ticket, or to an id the post does not name,
  is no cycle here — the latter is `baton ticket check`'s finding (B-111). The interim shape's
  `state.items[].dependsOn` is the same graph and is refused the same way (B-111, round 1): no
  ticket source can post a loop, whichever shape it posts.
- Free text and identifiers are validated on write (§12.3).

### 4.5 Reading the ticket

- **R-BTN-5 / R-BTN-34 (the runner reads and re-verifies the ticket from git, by its version).**
  - The claim response names the ticket's `path`, the `snapshot_sha` it was decided on, its
    `version` as the board holds it, and how its source reads (`ticket_source`: `{kind,
    versions}` — B-183; absent when the board declared no source, and `version` `''` when it
    holds none, both re-verified as before).
    Before preparing any tree at the sha, the runner checks it is on the registered default
    branch (R-BTN-143, else `released:off-branch`). If `git cat-file -e <snapshot_sha>` fails or
    the file is absent, it fetches the default branch once, then releases `stale-board` if it is
    still missing — a claim of the `cancel` leg excepted (R-BTN-168), which needs no file and reads
    the PR and branch it closes.
  - The runner reads the ticket from `origin/<default branch>:<path>`, never the working tree,
    and takes body, exit criteria and PRs from that file. A leg of a course that keeps its
    record on the ticket's branch (R-BTN-131) reads the body and its inputs at that branch's
    fetched head instead, once it has checked that the branch maps to the ticket; filter fields and
    closure still come from the default branch. No ticket content travels through Baton.
  - **Re-verification by version** (B-183): before any leg runs, the runner reads the ticket
    through its source at the claim's snapshot — the repository's `.baton/tickets.mjs`, else the
    CLI's markdown default — whose `versions` says how. **Pinned**: the ticket is read at its
    version (`read(id, {version})`; for the markdown source, the blob the version names — the
    file at `snapshot_sha`, as always), and one that cannot be read there releases
    `stale-board`. **Current**: the ticket is read as the store holds it now (`read(id, {})`),
    and a different version — the ticket moved under the claim — releases `stale-board` before
    any leg runs. A source at the snapshot that declares `versions` but exports no `read`
    cannot read at all — the CLI refuses one at load (§4.2) — and its claims release
    `stale-board` too, never run on with no re-verification. It then
    checks the tier fits its ceiling and runs the course's `sync.mjs` (through the
    wrapper, from a verified tree at the claim's commit, R-BTN-133) on the ticket and its PRs at
    the fetched head, whose readiness must show the offered leg leaving the claim's station as
    Baton holds it (the claim response's station, `path_len` and queued leg, R-BTN-39). Closed,
    archived or re-tiered, or the leg not offered there, releases `stale-board`; where the
    ticket is never comes from the source. Readiness is computed as today, from the ticket as
    read. This applies to every claim with a ticket. Two claims are
    re-verified against Baton's record instead (the claim response's station and queued leg),
    never against git: a ticket with no file — a `changes` check ticket (R-BTN-114) — and a claim
    of the `cancel` leg Baton queued (R-BTN-168), whose ticket may already be withdrawn or closed
    in git.
  - **A ticket Baton has not seen cannot be claimed.** A claim naming it is `not-eligible`
    (`unknown-ticket`, §9.1). It is claimable after the first accepted post that names it, which
    the forge's notification (R-BTN-73, R-BTN-95) or a runner's `ls-remote` poll (R-BTN-105) make
    about a minute away.
### 4.6 Children

- **R-BTN-86 (tickets are sequential; child tickets are how work runs in parallel).** A ticket
  has one holder and one position at a time; no two legs of one ticket run at once. Parallel
  work is **child tickets**.
  - **Spawning.** A leg writes child ticket files git first, each naming `parent: <local id>`
    of the same repository; Baton stores the qualified id. A child is an ordinary ticket on any
    course; parent and children may be held at once. Handler tickets (R-BTN-161) and a call's
    children (R-BTN-165) are children. A leg that waits for its children is a call leg
    (R-BTN-165); any other spawning leg does not wait, and its `spawns` declaration (R-BTN-111)
    may give its children `"lifetime": "parent" | "station"` (R-BTN-168).
  - **The `spawned` report.** The end that follows a spawning leg carries `spawned: [<local
    id>]`, with `suspended:<station>` or a `released:` end; `done` with `spawned` is
    `invalid-params`, and `advance` takes none. Baton validates the list before any write: at
    most 50 ids, each by the ticket-id rule (§12.3), none the parent's own. Baton records them as
    the run's children (a call's completion range, R-BTN-165) until the first accepted snapshot
    observed after the end; a reported child that snapshot does not post is dropped with discrepancy
    `spawned-unposted` (R-BTN-85).
  - **Core keeps the relation, not the policy.** `tickets.parent`, and `closed_tickets.parent`
    until purge; `GET /v1/repositories/{repository}/tickets/{ticket}/children` lists open and
    closed children with station and blocked state; a `spawned` history row when a child first
    appears; a tree on the dashboard. A `parent` that is not a local id, names the ticket itself,
    closes a cycle or lies more than 4 generations below a root (R-BTN-149) is stored as none and
    logged `parent-invalid` with the reason; one naming no known ticket is stored and drawn
    orphaned. No snapshot is refused for a parent.
  - Closing or withdrawing a parent supersedes its open children whose lifetime is `parent`
    (R-BTN-168); other children live on.

### 4.7 History and discrepancies

- **R-BTN-81 (the ticket's history: a running record, not a replay log).** Per ticket Baton
  appends one row per thing it saw: a leg started, finished or given up (claim, runner, course
  version, contract version, position, run number, `run_id` (R-BTN-63), `snapshot_sha`, `head_sha`); a position
  confirmed; a fact arrival, and an arrival not applied (R-BTN-39); an adoption; a re-route; a
  block or unblocking; a condition opened or closed; a person leg's question posted, answered or
  expired (R-BTN-116); a call settled; a supersession; an outbox entry queued, delivered or
  confirmed (R-BTN-171); inputs given and outputs reported (an `inputs` row names its
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

- **R-BTN-85 (every disagreement with git is logged).** When an accepted snapshot disagrees
  with something Baton holds, Baton logs, in the same transaction, an event and a history row of
  kind `discrepancy`: `{sub, baton: <value and its source>, git: <the snapshot's value>,
  observation}`, and, where git states a value, adopts it at once (R-BTN-35). The subs:

  | sub | when |
  |---|---|
  | `position-disagrees` | a posted ticket whose `status` is `available` while the same post places it past its course's start (R-BTN-74), core's witness being a non-empty path (B-129); judged on those two alone, since core reads no course field (R-BTN-50), so a release that kept its PRs logs it too; once per station; both values are positions, never a PR list (R-BTN-33): logged and listed among the dashboard's discrepancies, nothing adopted, never on Needs you |
  | `bars-mismatch` | posted bars lack a tag the holder declared (R-BTN-63) |
  | `closed-under-claim` | a ticket closed while a claim is active on it, a claim of its `cancel` leg excepted (R-BTN-168) |
  | `spawned-unposted` | a reported child the first snapshot after the end does not post (R-BTN-86) |
  | `output-invalid` | a posted output pointer failed its schema or digest (R-BTN-109): logged and raised, nothing adopted |

  About what Baton owns there is no disagreement to log: git never writes a position (R-BTN-39),
  and an arrival Baton does not apply is an `arrival-unapplied` row on the ticket, listed under
  no other heading — the git-lock `status:` field is the one exception, the row above (B-129).
  A discrepancy accompanies the events
  those cases log; any condition a case raises is its owning rule's. The dashboard lists
  discrepancies by sub and age.
### 4.8 Owner state

- **R-BTN-88 (owner state and course history are exportable; git holds the work).** Baton
  rebuilds tickets and readiness from git. **Owner state** and **course history** live only in
  SQLite (R-BTN-66, R-BTN-39); the tenant's administrator exports them and imports them into
  another Baton.
  - **Format** `baton.owner-state/v1`: `{format, schema_version (highest applied migration),
    exported_at, origin, events_seq, sections, digest}`; `digest` is SHA-256 over the RFC 8785
    canonical JSON of the rest. `sections` holds every column §13 gives these tables:
    `repositories` (every setting; a retired repository's tombstoned row alone, and no row of it
    in any other section, R-BTN-47), `repository_owners`, `credentials`, `sync_keys`,
    `runner_grants`, `runners` (with `secret_hash` and `incarnation`; import writes
    `last_seen_at` 0), `owner_bars`, `ticket_overrides`, `ticket_stations` and the live
    tickets' position rows of `ticket_history` and their `claim_legs` (course history, so an
    import places every ticket where it was and keeps its run counts), `closed_tickets`,
    `external_resources`,
    `resource_instances`, `instance_serves`, `capability_capacity`, `check_runners`, `mcp_keys` (hashes only), `instance_settings`, unexpired
    `registration_tokens` (hashes only), open `conditions`, `ticket_timers`, git-kind `outbox`
    entries not `confirmed`, every `repository_policies` version (its `floors` a field of the
    document, R-BTN-188, R-BTN-189). An import refuses a live repository whose policy versions do not chain by
    `previous_hash` from version 1, or whose export holds no policy: it never falls back to a
    preset. A retired repository's tombstone needs no policy and is imported retired.
  - **Not exported**: claims and their `claim_seats`, events, `forge-check` entries, readings (an administrator's
    included, R-BTN-76), sync wants; and, unless
    `--with-history`, the history, `leg_outputs` and `leg_run_inputs`, which an import without
    them loses.
  - **Import** (`POST /v1/admin/import`): one transaction, into an **empty** Baton only (no
    repository, owner or credential but the seeded `legacy` row), else `conflict`; digest checked (`invalid-params`); the
    same `schema_version` required. Every row passes the write path's validation and invariants
    (one role per key, unique names, id grammars, tombstones only on retired rows); the first
    failing row refuses the whole import. Signed requests with `created` at or before the
    source's `sealed_at` are refused `unauthenticated`. Ticket-scoped rows wait in
    `pending_owner_state` until the first snapshot that creates their ticket; one the
    repository's first snapshot does not post is dropped and logged. A ticket with pending course
    history (`station`, `history` and `run` rows) is placed from it, not at its course's `start`
    (R-BTN-39). The event sequence continues
    from `events_seq`.
  - **Moving a Baton**:
    1. **freeze** (`baton admin freeze`, `POST /v1/admin/freeze`; `baton_settings.frozen_at`,
       event `frozen`): new claims and owner writes are refused `frozen`;
       `POST /v1/admin/unfreeze` (event `unfrozen`) undoes it before the seal;
    2. **seal** (`baton admin seal`, `POST /v1/admin/seal`) once no claim is active or
       fence-pending (a fence-pending claim may hold a seat, R-BTN-178) and every
       live repository with a mirror (R-BTN-93; a retired one has none, R-BTN-47) has `mirror_acked_seq` at the last event; else
       `conflict` naming the claims and lagging mirrors, whose mirror workflows it dispatches (R-BTN-94). The
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

    The format is the same on Cloudflare and the local host.
  - An export holds no private key but names every key, grant and secret hash; the CLI writes it
    mode `0600`. It is a move, not a backup (backups are the Durable Object's point-in-time
    recovery or the local SQLite file).

