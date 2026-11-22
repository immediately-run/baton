---
title: "5. Courses"
description: "A course is the process a ticket follows: a graph of stations, where a ticket rests, and legs, the work that takes it from one station to the next."
---
## 5. Courses

A course is the process a ticket follows: a graph of **stations**, where a ticket rests, and
**legs**, the work that takes it from one station to the next. Changing a course is a commit,
effective at the next sync, with no Baton deploy. Core knows a course's names and edges and
nothing of what they mean (R-BTN-50).

Designs for this section that are not built are on the proposal page
[courses](../proposals/courses.md).

### 5.1 Course directories and sources

- **R-BTN-134 (a course is what its source names).** The CLI holds the machinery that reads any
  course; a course is files in a repository.
  - **The course directory** is the home's `.baton/courses/<course>/`: `course.json` (R-BTN-69),
    a script and an instruction file `legs/<leg>.md` for each leg (R-BTN-133), and optionally
    its station function `sync.mjs` (R-BTN-74), `rank.mjs` (R-BTN-98), `schemas/<name>@<n>.json`
    (R-BTN-108) and leg overrides (R-BTN-131). A standard course (R-BTN-131) with no `sync.mjs`
    runs the CLI's station function for it; any other course without one fails the sync.
  - **A source** is `courses[].source` = `<provider>/<namespace>/<repository>/<commit>/<course>`:
    `<commit>` is all 40 hex characters, never a branch or tag, and `github` is the only
    provider. The short `id` is the name tickets, rows, rule 9 and branch patterns use. A course
    with no `source` is the repository's own. A fetched source's course directory is
    `.baton/courses/<course>/` in the source repository. A CLI may use its own bundled standard
    course when the repository and commit match exactly. Otherwise the reader fetches the
    source's default branch and verifies that the pin is a commit on its ancestry, including
    when the reader already has the commit. It never fetches by commit id.
  - **A sourced course keeps its graph.** The sync reads the source's files, with the home's
    entry fields taking precedence over defaults in the source's `entry.json`. The home changes
    a sourced course only through its leg instructions and leg overrides (R-BTN-131). Any
    other file in the home's sourced course directory fails the sync, naming the path.
  - **Every reader goes through the snapshot.** The sync reads `.baton/` at the commit it posts
    (R-BTN-105), the runner at the claim's `snapshot_sha` after R-BTN-143's check, and
    re-verification at the commit it verifies (R-BTN-5), so all three use the same bytes.
    Station functions and ticket sources run through the wrapper (R-BTN-133) in a read-only
    worktree of that commit, never in `ctx.checkout`.
  - **`baton repo init`** (R-BTN-127) writes a standard course's `courses[]` entry with the source
    at the CLI's own commit, and the sync workflow, which pins the CLI by version. Re-run with
    a newer CLI it moves the pin and each source together. It writes a home override only when
    requested (`--override` or `--instructions`), never overwriting one. `--prune` compares
    existing files against the current pins, removes identical copies and reports differing
    files without changing the pins. With no `--course` it takes `default_course`, else `create-pr`.
  - **Trust.** Naming a source adopts its code with the rights of where it runs: the station
    function in the sync job's environment, leg scripts on runners (R-BTN-133).

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

  Station and leg ids match `^[a-z][a-z0-9-]{0,39}$`. Each field's meaning, range and default
  are its rule's:

  | Field | On | Meaning | Rule |
  |---|---|---|---|
  | `start` | course | the one start station | R-BTN-69 |
  | `start_leg` | course | the queued leg of a new ticket; its `from` includes `start`; always present | R-BTN-83 |
  | `end` | course | non-empty list of end stations; a ticket at one is done | R-BTN-70 |
  | `short_waits` | course | `waiting_on` labels a holder waits on under its claim instead of suspending | R-BTN-72 |
  | `stations`, `legs` | course | maps of id → station, id → leg | R-BTN-69 |
  | `conditions` | course | declared condition types | R-BTN-160 |
  | `capability_types`, `capability_roles` | course | the capability types its legs may require, and named lists of capabilities | R-BTN-121 |
  | `starts_from` | course | `request`: the course is entered by a request ticket | R-BTN-131 |
  | `test_script` | course | an npm script name a course's own legs read; core stores it unread | — |
  | `label` | station, leg | display text | — |
  | `renamed_from` | station, leg | the earlier name this one carries over | R-BTN-64, R-BTN-142 |
  | `entry` | station | outputs any leg arriving here must have produced | R-BTN-109 |
  | `from` | leg | the stations it leaves | R-BTN-69 |
  | `to` | leg | its outcome station, or a list of them | R-BTN-83 |
  | `kind` | leg | absent: run by a runner; `person`: a person answers | R-BTN-116 |
  | `reconciles` | leg | `{to: {<station>: <next leg> \| null}}`: a reconcile leg, run by a runner, which Baton queues when the ticket has evidence of work done outside Baton (R-BTN-39, R-BTN-203). It declares no `to`: its outcomes are each of its `from` (concluding `unchanged`, with the displaced leg next) and each station of `reconciles.to`, with that entry's next leg (`null` at an end). It needs `max_runs`; at most one reconcile leg leaves a station; it is never `start_leg` and never a `next`. Not on a fact or `kind: person` leg | R-BTN-39, R-BTN-203 |
  | `arrives` | leg | `{fact: <kind>, verdict?, next?}`, a fact leg: no claim runs it; it arrives when the sync attests its fact (R-BTN-203); exactly one outcome; `verdict` (`approve` or `changes`) narrows a `pr-verdict`; `next` is a leg leaving its outcome (none at an end), or on a `pr-verdict` leg `{approve, changes}`, one per verdict. Its arrival is a run of the fact leg itself (R-BTN-63). A fact leg is never `start_leg`, never another leg's `next`, and never chosen as a default next (R-BTN-39). Not on a `kind: person` leg | R-BTN-39, R-BTN-203 |
  | `asks`, `expires` | leg | for `kind: person`: who answers, and when and where the leg arrives unanswered | R-BTN-116 |
  | `max_runs` | leg | how often one ticket may run it without a person | R-BTN-63 |
  | `max_queue` | leg | queue depth that raises a warning | R-BTN-79 |
  | `version`, `inputs`, `outputs` | leg | its contract | R-BTN-82 |
  | `replay_safe` | leg | `false` when it has side effects outside git and its forge | R-BTN-82, R-BTN-84 |
  | `requires` | leg | prerequisites: `{capabilities}` | R-BTN-120 |
  | `deadline_s` | leg | how long one run may take before Baton takes the claim back | R-BTN-167, R-BTN-90 |
  | `conditions` | leg | narrows the condition types it may raise (`[]`: none) | R-BTN-160 |
  | `autonomous` | leg | `true`: the leg never asks for a person | R-BTN-195 |
  | `spawns` | leg | the courses of the children it files, and what it provides them | R-BTN-111 |
  | `no_chain_from` | leg | legs whose credential may not take this one on the same ticket | R-BTN-106 |

  - **Validation.** Baton accepts a file only if:
    - `start` names one station, `end` names at least one, and no leg leaves an end;
    - every `from` and `to` names a station;
    - every station is reachable from `start` through any outcome, and an end is reachable from
      every station;
    - every cycle contains a leg with `max_runs`;
    - `start_leg` names a leg whose `from` includes `start`;
    - every `inputs.from` names a leg and one of its outputs;
    - each field passes its own rule in the table.

    An unknown field is refused. A file that fails keeps the previous one in force, and the
    refusal is shown to the owner with its violations; with no earlier file in force the post
    is refused.
  - **Edges carry no conditions.** Which outcome a leg reached is a git fact the station
    function evaluates (R-BTN-39), never part of the file. Parallel work inside a leg is the
    leg's own business; parallel tickets are children (R-BTN-86).

### 5.3 Where a ticket is, and how it moves

- **R-BTN-70 (where a ticket is, and what it may do next).** Baton holds every ticket's
  **station**, **path** and **queued leg** with its `next_source` (R-BTN-39, R-BTN-83). A ticket
  at an end station is done. For every live ticket the sync attests, from its station function,
  `std:git.readiness@1` (R-BTN-191): for each leg leaving Baton's station that the ticket may
  still run, `ready` or `waiting` (with a `waiting_on` label). With the ticket it posts the
  barred tags of each leg it knows them for (`ticket_bars`, per leg name). Core keeps the
  readiness and bar rows of the newest accepted run, writing only the rows that changed; a row
  the run leaves as it is counts as shown by that run's observation. Readiness is attested `at`
  a position, `{station, path_len}` as `positions` gave it; readiness at any other position is
  discarded until the next run. Core recommends a `ready` leg and never computes readiness. The
  claim response, every heartbeat and every `advance` response show the holder Baton's station,
  path and queued leg, and the latest snapshot's readiness.
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
    in the course's convention, then reports with `advance`, `end` or a suspension.
  - **Recorded at once.** The reported pair is the holder's `std:arrival@1` attestation
    (R-BTN-191), carried by the `advance`, end or suspension and signed by that request's own
    signature (R-BTN-13). Baton records it as the ticket's position in the transaction that
    accepts the request. No snapshot confirms or replaces it (R-BTN-39); evidence in git is for
    people, never read as a position.
  - **`next_source`** says who chose the queued leg: `holder` (its `advance`, end or
    suspension), `baton` (a transition of Baton's own, under the rule that makes it) or `owner`
    (a route, or an adopt, R-BTN-39). The reason is in the position's history row. An owner's
    route, a retry policy's `exhausted` leg (R-BTN-122) and a person leg's expiry (R-BTN-116)
    stay queued until the ticket's station changes, whatever readiness a later snapshot posts.
  - **Route** (not built: [the proposal](../proposals/data-model-and-api.md#other-reads-and-owner-routes)).
    `baton ticket route <ticket> <leg>` (R-BTN-127) queues any leg leaving Baton's
    station for the ticket, `next_source: owner`, restarting its run count (R-BTN-63);
    `{clear: true}` restores the course's choice. Both are logged `re-routed`.
  - **The queue is the queued leg.** A ticket waits in exactly one queue, its queued leg's
    (R-BTN-79), and matching rule 1 offers that leg alone, `ready` or `waiting` as posted. A
    queue is not a reservation: whoever claims passes every gate then. A person leg (R-BTN-116)
    may arrive while another leg is queued; it is never claimed.
  - **Course changes.** A renamed queued leg resolves through `renamed_from` (R-BTN-64). A
    queued leg that the course in force does not have leaving that station is stored `waiting`
    on `course-changed` and raises `baton.course-changed`. A ticket with no claim at a station
    the new file lacks waits `course-changed` the same way, until the owner adopts it
    (R-BTN-39). A leg added later changes no queued leg.
- **R-BTN-63 (an advance follows an edge, on the holder's word).** A claim **is at** a station
  — the last one it reached — and may be **running** one leg.
  - When claimed, it is at the ticket's station as Baton holds it (recorded as `start_path`) and
    runs nothing.
  - `advance {reached, leg}` finishes the running leg, if any, at `reached` — one of its
    outcomes, else refused `off-graph` — records the position, then starts `leg` if it leaves
    `reached`, the ticket's runs of it are fewer than its `max_runs`, and every holder gate
    holds (§6). The first `advance` starts the first leg; every leg a claim runs has its own
    `advance`. Baton records each leg a claim starts and finishes (`claim_legs`).
  - **Every run has a run id.** The `advance` that starts a run, and an adoption that adds one,
    mints its `run_id` through the core's clock (R-BTN-32) and random source (`r_` and a
    26-character ULID). It is opaque and unique in the tenant: readers compare it only for
    equality, and order comes from `started_at` and `seq`. Anything a runner writes outside Baton where another tenant could
    also write is keyed by the tenant's host (R-BTN-135) and the run id.
  - **Baton's traversal record counts.** A ticket's runs of each leg and arrivals at each
    station are counted from Baton's own record, under resolved names (R-BTN-64). `max_runs`,
    attempts and retries (R-BTN-122) read these counts, so rewriting a ticket's history in git
    changes neither its position nor its counts. `max_runs` bounds the runs made without a
    person: a person leg's answer (R-BTN-116), an owner's route or an adopt restarts the count
    of the leg it queues. The traversal record itself is never erased.
  - The holder pushes a leg's evidence before the `advance` that finishes it, and may pass
    `bars`, tags it bars from the new leg, which only add to the posted bars. A later snapshot
    posting that leg's bars without a tag the holder declared is the discrepancy
    `bars-mismatch` (R-BTN-85) and raises `baton.bars-mismatch`; the sync's reading binds from
    then on.
  - Baton does not check a leg's state: which leg comes next is the holder's judgement of
    git's facts. An `advance` is checked against the newest snapshot's course file.
- **R-BTN-71 (a suspension rests at a station).** A claim that stops ends
  `suspended:<station>`: the outcome its running leg reached if that leg finished, else the
  leg's `from`; any other station is refused. The end carries the queued leg `next` (R-BTN-83),
  which Baton records as the ticket's position at once; the end is confirmed as R-BTN-10 says.
  The next claimant starts at Baton's station.
- **Disagreement, not movement.** A ticket moves only along edges. A snapshot whose facts
  disagree with Baton's position moves nothing: its arrival is recorded unapplied (R-BTN-39),
  the owner's adopt and route that would settle it are not built.

### 5.4 Legs are queues

- **R-BTN-79 (legs are queues; a course may bound them, as a warning).** Leg L's **queue**, per
  repository, is the tickets of L's course whose queued leg is L (ready or waiting, blocked or
  not) and that are not held (R-BTN-75). Baton keeps its depth in `leg_queues`, in every
  transaction that changes it.
  - A leg's `max_queue` (1–10,000) is a **warning threshold**: a ticket always enters its
    queue. Depth above it raises `baton.queue-over`, closed when the depth is back within it.
    Core never holds, refuses or reorders for it.
  - **Intake.** A repository's course is `closed` while any of its legs is over `max_queue`
    and `open` otherwise (logged `course-closed`, `course-opened`). While closed,
    recommendations leave out its new tickets (at `start` with an empty path). This is advice
    (R-BTN-45): a claim of a new ticket by id is accepted and recorded `advice-overridden`, and
    an expedited ticket (R-BTN-12) is still recommended.
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
  - **Git first, confirmed by the sync.** The run's evidence lists the outputs; the sync attests
    each as `std:git.output@1` with its `ref` and `claim_nonce` (R-BTN-191). An output is
    recorded only if its nonce names a claim on the ticket; any other is dropped and never
    resolved as an input. The one output no claim records is a person leg's `answer`, the
    applied `std:decision@1` (R-BTN-116). Markers by non-pushers are never outputs (R-BTN-139).
  - **Inputs are resolved by Baton.** At the `advance` that starts a leg, Baton returns each
    input: the latest recorded output of its producer for this ticket, with the producer's
    versions; the inputs given are recorded in the ticket's history (R-BTN-81). A queued leg
    with a required input missing or of an unaccepted producer version is stored `waiting` on
    `input-missing` or `input-version` and raises the `baton.` condition of that name; the
    `advance` refuses one `not-eligible`, with no failed attempt.
  - **The runner checks contents.** The runner fetches each input (a `git:` or `https://` URI
    only from a repository with reach, R-BTN-140), verifies its digest and validates it before
    the leg's script runs, and validates each output after it returns, before reporting. An
    output violation ends the claim `released:cannot-finish:contract-output`, a failed attempt
    under the retry policy (R-BTN-122). An input violation, a digest mismatch included, ends it
    `released:cannot-finish:contract-input`, not a failed attempt: the ticket is held at once
    (`hold_reason: non-retryable:contract-input`) and raises `baton.contract`, whose `detail`
    names the input, the schema, and the producing leg and version.
- **R-BTN-108 (one envelope, named schemas, one validator).** Leg outputs and instrument readings
  are one mechanism.
  - **Core owns the envelope.** A leg output is `{name, schema: "<id>@<version>", uri?,
    digest?, value?}`: `uri` and `digest` (R-BTN-82), or an inline `value` of at most 4 KB
    serialized, never both. A reading keeps R-BTN-76's envelope and names its `detail`'s schema
    in `schema`. Core reads the envelope only; a requirement's `where` test over a reading's
    `detail` is proposed ([security](../proposals/security.md)).
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
    equal or tighter, `pattern` equal. An unproven refinement is reported with its keyword.
  - **The subset.** JSON Schema 2020-12 restricted to `type`, `properties`, `required`,
    `additionalProperties`, `items`, `prefixItems`, `enum`, `const`, `minimum`, `maximum`,
    `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `minItems`, `maxItems`,
    `pattern`, `format` (`date-time`, `uri`), `$ref` to a named schema, `title`, `description`,
    `x-baton-base`, `x-baton-view`; ≤ 32 KB, ≤ 16 levels. Anything else is refused at the sync
    with its course file, as is a `$ref`/`x-baton-base` cycle.
  - **`pattern`** uses the validator's own linear-time engine: literals, `\`-escapes, `.`,
    classes (`[a-z]`, `[^…]`, `\d`, `\w`, `\s`), `^`, `$`, groups, alternation, `?`, `*`, `+`,
    `{n}`, `{n,m}` with m ≤ 1000; no back-reference, look-around, lazy or possessive
    quantifier, flag or Unicode property; ≤ 512 characters; the expanded automaton ≤ 4,096
    states (R-BTN-149). Outside the grammar is a schema error. The same engine reads capability
    `values` (R-BTN-121).
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
  | `std:decision@1` | `{id, leg, option, reached, ref?, answered_by?, commit?}`, a person's answer (R-BTN-116) |
  | `std:arrival@1` | `{leg, reached, next?, ref?}`: a leg's arrival at one of its outcomes (R-BTN-39, R-BTN-191) |
  | `std:evidence@1` | `{ref, kind}`: work a ticket may have had done outside Baton, `kind` `merged-early` or `mention` (R-BTN-203); Baton also keeps a refused arrival as `fact` (R-BTN-39) |
  | `std:git.readiness@1`, `std:git.implied@1`, `std:git.output@1`, `std:git.evidence@1` | the sync's attestations (R-BTN-191) |
  | `std:api-capacity@1` | `{window_s, remaining_permille, resets_at_min?}`, integers: a quota's window, what remains of it in ‰, and its reset in epoch minutes. The library's one open schema, so a resource's schema refines it by adding fields |

  A course extends one by refinement. A published `std:` version never changes; a new field is
  a new version.
- **R-BTN-111 (a course's signature).** A course's **input** is its `start` station's `entry`;
  its **output** is each end station's; its signature also lists the conditions its legs may
  raise (R-BTN-160). `baton course test` prints it, and the repository's stats carry it per
  course.
  - **`spawns`.** A leg that files children declares `"spawns": {"course": <id> | [<id>…] |
    "*", "provides": [<output>…]}`: the course its children run, several, or `"*"` for any
    course the repository lists other than its own. The kit checks that what it provides meets
    each such course's input; a child filed on another course is a script fault. The file also
    accepts `lifetime` (`parent` or `station`), which nothing acts on yet.
- **R-BTN-112 (declarative views; Baton's renderers).** A schema may carry `x-baton-view`:
  `{title?, summary?, fields?: [{label, pointer, as, unit?, max?, tones?}]}`, ≤ 4 KB and ≤ 24
  fields.
  - `title` and `summary` are templates where `{<JSON Pointer>}` is replaced by the value as
    text; nothing else is interpreted. `as` is `text`; `number` (with `unit`); `time` (RFC 3339,
    shown relative and absolute); `gauge` (against `max`); `status` (a string mapped by `tones`
    to `ok`, `warn`, `bad` or `info`); `table` (an array of objects, ≤ 50 rows, columns the
    first row's keys, cells as text); `link` — a link only when it passes R-BTN-92's link rule
    for the ticket's repositories or its host is in the instance's `link_hosts` (R-BTN-157),
    else text.
  - **One renderer per channel** in the shared library: `plain`, `html` (every value escaped,
    inline styles only, no script, image or remote resource) and `ui` (the dashboard, under
    §12.3's rendering rule). Courses never ship rendering code.
  - **Fallback:** the value's own schema's view, else the nearest up its base chain, else a
    generic rendering of keys and values two levels deep, truncated.
  - Core events are rendered by core's templates, each with one slot for the course's view of
    the relevant value.

### 5.6 Gates a course can set: tags, bars and capabilities

- **R-BTN-60 (tags: the one generic gate a course can set).** A runner's heartbeat carries
  `tags`, course-defined strings (`family:<name>`); every posted leg carries `barred_tags`. Core
  refuses a claim or `advance` with `barred-tag` when the runner's tags meet the leg's barred
  tags — those posted, joined by the owner bars in force on that leg (R-BTN-67) — without knowing
  what a tag means.
  - A course bars by what the **claimant** of a leg is, never by what a subagent it spawns
    will be.
  - Tags are self-reported and bind cooperating runners only (R-BTN-66).
  - A tag matches `^[a-z0-9-]+:[A-Za-z0-9._/-]{1,96}$`; at most 32 per runner; free text under
    §12.3.
- **R-BTN-67 (owner bars and required bars).** Two rules over tags, set only by owners
  (R-BTN-66).
  - **An owner bar** is `{course, tag, legs, applies: 'claim' | 'claim+advance', starts_at,
    ends_at?, release_holders, reason}`. `course` is a course id or `*`; named `legs` need a
    named course; empty `legs` is every leg. `reason` is a short id that becomes the release
    reason `released:<reason>` (an open set) and may not be one of the closed end reasons (§9),
    so an owner bar's release is never a failed attempt. While in force its tag joins the
    barred tags of the matching legs of the repository's tickets on that course, at claims only
    or at claims and advances. With `release_holders`, when the bar starts the alarm sends
    `release` to every holder whose runner carries the tag and whose claim is running or about
    to run a matching leg. The heartbeat response, the sync's observation and the fleet view
    (R-BTN-99) carry the bars in force. Setting or lifting one is an `admin` event and
    dispatches a sync.
  - **A required bar** is `{course, leg, except?, tag_prefix}`: `course` an id or `*`; `leg` a
    leg name (only under a named course) or `*`, every leg but those in `except`. When a leg it
    covers leaves a ticket's station, or a claim advances into it, and its bars — posted, joined
    at an advance by the holder's `bars` (R-BTN-63) — hold no tag with the prefix, the leg is
    stored `waiting` on `policy`, the advance is refused (`not-eligible`, `policy`), the board
    still moves, and `baton.required-bar` is raised; so is a posted snapshot lacking the prefix
    for a leg a claim ran on the holder's `bars`.
- **R-BTN-142 (bars and renames).** Bars name legs literally, as stored.
  - **Refused files** (R-BTN-69): two stations, or two legs, with the same `renamed_from`; a
    `renamed_from` naming a name the file still uses; a leg's `renamed_from` naming a station or
    a station's naming a leg; and a file that has no leg an owner's required bar names, under
    that name or as a `renamed_from`, until an owner changes or drops the bar.
- **R-BTN-121 (capability types are declared in the course file).** A capability is
  `<type>:<value>`, compared as a string, or the built-in bare `human-operator`.
  - **The course declares its types and roles:**

    ```json
    "capability_types": {
      "vpn":        {"description": "a tunnel to a named network", "values": "^[a-z0-9-]{1,32}$"},
      "credential": {"description": "a named secret in the runner's env", "values": "^[A-Z0-9_]{1,64}$"} },
    "capability_roles": {"deployer": ["vpn:corp", "credential:DEPLOY_TOKEN"]}
    ```

    A type id matches `^[a-z][a-z0-9-]{0,31}$`; `values` is a pattern in R-BTN-108's engine. A
    type declared `"from": "executor"` stands for what a runner's executor does: a capability of
    it counts for a runner only when its heartbeat's `executor.provides` names it (R-BTN-107),
    never from what the runner or its grant declares. A role expands to its list once; roles do
    not nest. Baton accepts the file only if every capability a leg lists, after expansion, is
    of a declared type with a matching value, or is built-in. A role naming `human-operator` or
    another role holds the file (R-BTN-157); so does a role named a vocabulary name — a
    capability, `human-operator` or `none`. A course may not declare a type named `runner` or
    `human-operator`.
  - **Built-ins:** `human-operator`, a runner's own statement that a person operates it, and
    the type `runner` (R-BTN-133). `credential:<NAME>` names an environment variable a leg
    receives only when it requires it (R-BTN-144).
  - A course's types and roles are served with its course file and shown on the **Courses**
    view, which lists every type two courses define differently.
  - **The runner declares what it has** when it starts. A capability it declares with a lock
    file is one that a single runner on the machine may use at a time: the runner declares it
    only while it holds the file's exclusive lock, and takes the lock before it claims, or
    advances into, a leg requiring the capability (R-BTN-178).
  - **Grants** list capabilities (R-BTN-58) and may name `<type>:*`, never a role: the CLI
    expands roles from the latest accepted snapshot, and before signing `<type>:*` prints every
    course defining the type and asks to confirm when their definitions differ (R-BTN-157).

### 5.7 Changing a course

- **R-BTN-22 / R-BTN-65 (course versions).** Each course entry carries two integers.
  - **`version`** is bumped by any commit that changes how a runner must behave on the course —
    any file in its `protocol_files`.
  - **`min_runner_version`** is raised only when a runner on an older version would misbehave;
    a change to `rank.mjs` raises it only when the course needs every runner to rank alike
    (R-BTN-98).
  - **Rule 9.** The runner reads each course's `version` from its checkout at startup and
    declares it (`courses`, §14). A runner declaring a ticket's course below
    `min_runner_version` gets no new claim on it (`stale-skills`); the dashboard shows it needing
    a restart from a pulled checkout. Rule 9 is checked at a claim, never at an `advance`, so a
    held claim finishes under its protocol. It gates a course's protocol, never runner features,
    which are `runner:` capabilities (R-BTN-133).
- **R-BTN-64 (in-flight tickets survive a course change).** Where a ticket is, is Baton's
  (R-BTN-39), so a new course file must accept every live ticket's station and queued leg, or
  map them by `renamed_from`.
  - **Renames.** A renamed station or leg carries `renamed_from`. When Baton accepts the file it
    rewrites, in one transaction, every active claim's `station` and `leg` and every per-leg
    record keyed by an old name (§13) to the new names, and from then on resolves every old
    name it meets to the station or leg whose `renamed_from` names it. Runs count toward
    `max_runs` under the resolved name; attempts, backoffs, expiry instants, blocks and held
    positions carry over unchanged.
  - **Removals.** A claim whose station or leg the new file lacks, even under a rename, keeps
    its lease; its heartbeat says `station: unknown`; the session finishes or abandons the
    work, writes its hand-off and ends `released:course-changed` — not a failed attempt, needing
    no confirmation — and the ticket waits `course-changed` until the owner adopts it at a
    station the new file has (R-BTN-39). Removing a station or leg must raise
    `min_runner_version`.
  - A ticket keeps no record of the course version it started under: its course history is the
    record (R-BTN-39).
- **The test kit.** `baton course test <repository root> <course>` (R-BTN-127), run by a home
  repository's CI on a PR that changes `.baton/` (R-BTN-133), starts a local Baton, posts the
  PR's board with the proposed `.baton/` and needs no production access. It fails when:
  - the file fails R-BTN-69's validation, or a field's own rule;
  - a live ticket's position no longer stands on the graph and no `renamed_from` maps it, or a
    station or leg is removed without a raised `min_runner_version` (R-BTN-64);
  - a contract cannot be met: a required input's producer does not lie on every route from
    `start` to each of the consumer's `from` stations, its version is not in `accepts`, a schema
    is missing, invalid or does not refine its base, an `entry` cannot be met by every arriving
    leg, or a `spawns` does not meet a named course's input (R-BTN-82, R-BTN-108, R-BTN-109,
    R-BTN-111);
  - an override or a leg script breaks R-BTN-131 or R-BTN-133;
  - a stub's `close` accepts what it should not: a leg that claims a PR must fail an agent that
    exits 0 with no PR;
  - a generic scenario fails against the course (§15, S-BTN-28).

  It warns where the owners' bounds cut a course's retry policy (R-BTN-122), and prints the
  signature (R-BTN-111) and the capability types and roles (R-BTN-121).
- **A course can see how it performs.** `GET /v1/repositories/{repository}/stats`, readable by
  any key granted on the repository (R-BTN-58), returns over a window: per station and leg, how
  long tickets waited and legs ran; claims by end and detail; suspensions by station and what
  they waited on; `off-graph` transitions; each course's signature and queue depths against
  bounds. Aggregates and ids only.

### 5.8 The standard courses

- **R-BTN-131 (the standard courses).** A standard course is one the baton repository ships
  with the CLI, under `src/defaults/`: `create-pr` (the default), `review-pr`, `bug-report`,
  `draft-ticket`, `decision`, `build-app`, `create-spec` and `spec-to-tickets`. A repository
  scaffolds one with `baton repo init --course <id>` and needs no course code of its own.
  "Standard" names where they live, not a privilege: core imports nothing from them
  (R-BTN-50), and the CLI reads them as any course. They assume no particular deployment and
  run under every preset.
  - **Their contract is not here.** What each standard course does — its graph, its legs, the
    facts it reads and the lines it writes — is stated in
    [the standard courses](../../docs/standard-courses.mdx) and the course's own files. The
    bullets below bind the CLI and the runner for every course.
  - **Request courses.** A course whose file carries `starts_from: request` is entered by
    `baton ticket request "<one sentence>" --course <course>` (R-BTN-127); no other course is.
    The command files one ticket (R-BTN-74's source): the id from R-BTN-199's allocator, the
    sentence as `title` and `description`, `status: available` and `tags: [request]`. It pushes
    it as one commit to the default branch, from a throwaway worktree, retrying on a moved
    head. Where the forge refuses the push because the branch is protected, it pushes the same
    commit to `baton-request/<ID>` (R-BTN-190) and opens a PR from it with the caller's forge
    credential; with no credential, on a `git` forge, or on any other refusal it reports git's
    own words and exits non-zero. It refuses a course `.baton/baton.json` does not list.
  - **The agent command.** A leg's stub runs the home's `.baton/baton.json` `agent_command`,
    else the command of the harness `baton runner start --harness` names. The runner passes it
    to every executor in `brief` (R-BTN-107). A repository's `agent_wrapper` — or
    `BATON_AGENT_WRAPPER` in the leg's environment, which wins — is one more command whose
    words precede the agent's; Baton builds nothing in its place.
    - The spawn has no shell: each command string splits into words as `sh` would, with no
      substitutions, and runs with the ticket id, the leg and the checkout appended. Stdin is
      closed; stdout and stderr are captured.
    - The environment carries `BATON_COURSE`, `BATON_LEG`, `BATON_TICKET_FILE` and
      `BATON_INSTRUCTIONS` (the leg's instruction file at the claim's snapshot), and
      `BATON_ANSWER` on a leg whose result depends on the agent's answer.
    - The command's exit is the agent's completion. A stub may also conclude an agent that
      stays silent or outlives the leg's ceiling: it kills the agent and judges the output
      received as it would an exit's. The bounds are the course's.
    - The answer is the last line of the agent's output that begins with one of the course's
      values as a whole word, with at most one PR URL after it. No such line fails the leg.
    - A stub whose leg claims a PR verifies it on the forge before it reports a position. A
      stub reports failure and never retries.
  - **Overrides replace `run`, never `close`.** A home's `legs/<leg>.run.<ext>` exports
    `run(ctx, standard)`; the leg script loads it at the claim's snapshot and calls it instead
    of its own `run`, keeping its own `close`. Its position must be an edge. An override keeps
    the leg's contract `version`; `snapshot_sha` names the bytes that ran.
  - **A runner serves every course its home declares**, each at its version (rule 9 per
    course); `--course <id>` narrows that to one, and a course the home does not declare is
    refused at startup. So is a home held by another live runner. The claim answer's
    `course_id` names the ticket's course, which the runner loads from the claim's
    `snapshot_sha`. A claim runs one leg at a time.
- **R-BTN-190 (leg state).** State one leg hands the next that must never reach the default
  branch, such as review rounds and their answers, goes where the PRs the course reads live.
  Every claim response says where, as `leg_state`, and no policy knob chooses it: `forge` when
  the home is on a forge or the claimed ticket's course reads PR facts, and `branch` otherwise.
  - Under `forge` the rounds are the PR's conversation, on whichever forge holds the PR.
  - The branch namespaces `baton-legs/*`, `baton-request/*` and `baton-ticket/*` are reserved:
    the course validator refuses a `branch_pattern` that matches one, so no reader of
    `branch_pattern` sees such a branch and no work branch's name collides with one.
- **R-BTN-124 (the planning course, `epic`).** Not built: `epic` is on the proposal page
  [courses](../proposals/courses.md).

### 5.9 Capabilities are the runner's statement

- **R-BTN-174 (capabilities are matched by name; what a runner has is its own statement).** Core
  matches the capabilities a ticket and its leg require against what a runner declares, by name
  (R-BTN-121); a grant's `<type>:*` admits every value of the type. A runner's capabilities for
  a repository are its declared ones and its executor's `provides` (R-BTN-107) that its grant
  there admits (R-BTN-58), together with its declared `runner:` capabilities (R-BTN-133). Rule
  4 reads them (§6.6), `fleet_capabilities` counts them (R-BTN-75), and the model (R-BTN-68)
  receives them. Baton checks no declaration: a runner that declares a capability it lacks is
  only offered legs it cannot finish (R-BTN-66).
