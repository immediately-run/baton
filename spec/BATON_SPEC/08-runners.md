---
title: "8. Runners"
description: "A runner is any process that can execute a leg; it registers by heartbeat and holds claims (§9)."
---
## 8. Runners *(partly built — B-8, B-9, B-12, B-42, B-46, B-47, B-184, R3-1213, R3-1260)*

A **runner** is any process that can execute a leg; it registers by heartbeat and holds claims
(§9). There are two kinds, on the same API: an **interactive runner**, an agent harness session,
through its sidecar; and a **CLI runner**, `baton runner start`, which runs a ticket's legs as
scripts. Where a rule has a runner call a leg script's `run`, `close` or `handoff`, check a move or
open a leg's channel, it is the CLI runner, through its executor (R-BTN-107). The designs of this
section that are not built are in [the proposal page](../proposals/checks-and-executors.md).

### 8.1 Runners, heartbeats and the doorbell

- **R-BTN-3 (a runner exists from its first heartbeat).** A runner is created by its first
  authenticated heartbeat and never deleted. It is one interactive session or one CLI runner.
  Several sessions on one host are several runners; the dashboard groups them by hostname. A CLI
  runner's leg sessions (R-BTN-107) are not runners.
  - **Identity** is `(hostname, session_name)`: `hostname` is the name the key is registered
    under (R-BTN-13); `session_name` is the harness's session id, `^[A-Za-z0-9_.:-]{1,128}$`. A
    repeat heartbeat from the pair is the same runner only with that runner's secret (R-BTN-14).
  - **Alive** = `reaped_at IS NULL AND now − last_seen_at < lease_timeout_ms`. A reaped runner
    (§9.5) is dead: its calls are refused `runner-reaped` until it re-keys (R-BTN-14), which
    starts a new incarnation of the same runner holding no claim.
- **R-BTN-9 (the runner declares its lease timeout).** `lease_timeout_s` on each heartbeat,
  clamped to [900, 86400], default 900. The sidecar fences (R-BTN-6, R-BTN-26) on the lowest of
  the value in force at `last_ok` and every value it has declared since, so a heartbeat that
  lowers the timeout and loses its response never leaves Baton reaping on a shorter lease than
  the fence's.
- **The heartbeat** (unnumbered). The sidecar (or CLI runner), never the agent, sends
  `POST /v1/runner/heartbeat` every **2 minutes**, each request with a **30-second** timeout.
  This is the one statement of its body and its answer.

  | Body field | Value |
  |---|---|
  | `hostname`, `session_name` | the runner's identity (R-BTN-3) |
  | `secret_hash`, `rekey` | on first contact or a re-key (R-BTN-14) |
  | `harness` | `opencode` or `claude-code` |
  | `kind` | `vm`, `local` or `cloud`: a label no rule reads |
  | `model_id` | optional; a label no rule reads |
  | `capabilities` | the declared capabilities, roles and holdings (R-BTN-121, R-BTN-174) |
  | `tags` | optional (R-BTN-60) |
  | `tier_ceiling`, `tier_ceilings` | a tier name for every repository, and one per repository; absent ⇒ the top tier |
  | `lease_timeout_s` | R-BTN-9 |
  | `concurrency` | R-BTN-4 |
  | `courses` | `[{repository, course, version}]`, read from the runner's checkout at session start (R-BTN-22) |
  | `isolation` | optional: `attached`, `process` (the default) or `session`. A claim or `advance` into a leg whose course file sets `"isolation": "session"` by a runner declaring anything else is refused `not-eligible`, rule `isolation` |
  | `profile` | optional: a JSON object of at most 4096 characters serialized, stored and never read (R-BTN-72) |
  | `last_activity_at` | optional: the time of the runner's newest activity signal |
  | `session_urls` | `[{claim_id, url}]` (R-BTN-113) |
  | `legs_finished` | `[{claim_id, seq}]` (R-BTN-90) |
  | `fenced` | `[{claim_id, terminated: true}]`, one entry per fenced claim (R-BTN-19) |
  | `transcripts` | at most 50 transcript paths (R-BTN-20) |
  | `couriers` | the repositories and `asks` it delivers notices for |
  | `protection` | `[{repository, matched, reading_hash}]`, the protection checker's readings (R-BTN-180) |
  | `test_harness` | R-BTN-32 |

  - A runner holding one claim may send `session_url`, `leg_finished` and one `fenced` object in
    place of the three lists. Spooled activities go in their own call before the beat (§9.9).
  - A refused `transcripts`, `couriers` or `protection` entry, a `tier_ceilings` entry for a
    repository Baton does not serve and a dropped session link (R-BTN-113) are named in the
    answer and never refuse the heartbeat, since a refused heartbeat would get a live runner
    reaped. A malformed `session_urls` or `legs_finished` entry is dropped unnamed. A malformed
    `protection` or `tier_ceilings`, or a tier not on a registered repository's ladder, is
    `invalid-params`, as is a `transcripts`, `couriers` or `protection` list over its bound and
    a malformed `fenced`.
  - **The answer** carries `runner_id`, `incarnation`, `lease_timeout_s` (as clamped),
    `grant: {capabilities}` (R-BTN-72), `claims`, `messages`, `bars` (the owner bars in force,
    R-BTN-67), `stale_courses` (R-BTN-22), `mode` (per repository `shadow` or `cut-over`;
    legacy, removed with its code, R-BTN-193) and `server_time`.
    - `claims` lists the runner's active claims, empty when it holds none — each with its id,
      ticket, station, leg, nonce, `deadline_at`, Baton's position (`station`, `path`,
      `next_leg`), the ticket as the latest accepted snapshot holds it (`version`,
      `snapshot_sha`, `last_written_by`, R-BTN-194), that snapshot's `git` view (`next` legs with
      state, `waiting_on` and `not_before`; or `closed: done | withdrawn`; or `unknown`) and its
      current `activity` (§9.9). A listed claim the runner's state does not hold is ended by the
      runner `released:lease-lost`, never left to idle (R-BTN-6).
    - `messages` are the pending messages (§6), marked `delivered` in the same transaction, and
      the delivered ones not yet acknowledged, re-sent until they are (§6.9).
  - Every runner call updates `last_seen_at` and the runner's `client_version` (R-BTN-197). Lease
    upkeep has its own rate bucket and no per-tenant cap (R-BTN-135).
- **R-BTN-14 (runner secrets).** The sidecar generates a random 256-bit secret and sends its
  SHA-256 on the first heartbeat for a new `(hostname, session_name)`; Baton stores the hash and
  every later runner call presents the secret in `X-Runner-Secret`, signed or API-key alike
  (R-BTN-159).
  - A retried first heartbeat with the same hash is idempotent. The same pair with another
    secret is refused `session-taken`, unless it is a **re-key**: a heartbeat with `rekey: true`
    and a new hash, signed by the runner row's own credential, accepted only when the runner has
    no active claim or has been reaped. A re-key clears `reaped_at`, increments `incarnation` and
    logs `rekeyed`. It never clears a fence of an earlier incarnation (R-BTN-19).
  - A sidecar never re-keys while its state file says it holds a claim; it first marks the
    lease lost (R-BTN-6).
  - The secret separates sessions against accidents only: sessions of one OS user can read each
    other's files. The boundary between machines is the key.
- **R-BTN-91 (the doorbell).** Not built: a runner learns of a queued message at its next
  heartbeat. The design, a WebSocket on which Baton rings a runner to heartbeat at once, is in
  [the proposal page](../proposals/checks-and-executors.md).
- **The sidecar** (unnumbered). An interactive session's harness starts a sidecar at session
  start and stops it at session end; it heartbeats, holds the session's state and runs the fence
  (§9.2), and exits when the harness process is gone. A CLI runner hosts the sidecar itself.
  - **State file** `~/.cache/immediately-run/baton/<session>.json`, mode 0600: runner id,
    secret, active claims with their nonces, run ids and executor handles, `last_ok`, lease-lost
    flag. Only the sidecar writes it. A lost state file means a re-key.
  - **Spool.** Every reporter (the activity CLI, harness hooks, archivers) appends one JSON line
    under 4 KB to the session's spool file and returns at once. The sidecar posts the spool
    within 5 s and on every heartbeat, and drains it before exit; a spool left by an ended
    session is drained by the next sidecar on that host, using the ended session's state file.
  - **Credentials** are the machine key (R-BTN-13). No key, no sidecar, no claim. A CLI runner
    heartbeats under `--hostname`, else `BATON_HOSTNAME`, else its host's name.

### 8.2 Keys and grants

- **R-BTN-102 (a machine key is trusted with everything a machine does).** A machine key
  (credential kind `runner`, SSH) may, on each repository where it holds a grant (R-BTN-146),
  with ordinary signed requests:
  - **work** (R-BTN-58);
  - **sync** — `/v1/sync/*` with `?repository=<id>` in the signed query, role `sync` only, no
    runner secret — unless the policy's `inputs.board` excludes `machine` (R-BTN-188);
  - **report readings** (R-BTN-101).

  Every snapshot records its credential (`board_snapshots.posted_by`). A machine key is never an
  owner or administrator key, and neither is a machine key. API-key runners (R-BTN-159) work
  and report readings but never sync. One machine key per tenant (R-BTN-137).
- **R-BTN-146 (a repository's grants).** A grant is in force from its creation until it is
  revoked. `GET /v1/owner/{repository}/grants` lists the grants in force on the repository. The
  holder's acceptance of a grant, and the per-repository sync opt-in of a key granted on several
  repositories (its span), are not built
  ([proposal](../proposals/checks-and-executors.md)).
- **R-BTN-117 (registration tokens).** Not built. The design, an owner-minted token with which
  a session that has no key registers one, is in
  [the proposal page](../proposals/checks-and-executors.md).

### 8.3 The runner

- **R-BTN-72 (the runner).** `baton runner start` is a generic runner loop. It hosts the
  sidecar, heartbeats, claims up to R-BTN-4's bound, and runs each
  claim's legs one at a time, claims side by side, each leg by **the script for that leg**; then
  it advances, suspends or ends as the script's result, the course file, R-BTN-40 and the end
  table (§9.4) say. It knows no course: it serves every course its home checkout declares. It
  alone starts its legs, through its executor (R-BTN-107), stops them and notices they are stuck;
  while a leg runs, each beat logs the leg's duration and the age of its newest activity signal.
  With room for another claim — fewer held than R-BTN-4's bound, and the host's own judgement
  that it can start one — it attempts an unnamed claim when a heartbeat carries `unblocked`, else
  at its own interval (R-BTN-77). Each attempt is one claim request and reads no
  recommendations, which are for a caller choosing work (§6.6). A claim that waits (R-BTN-40, R-BTN-195) holds only
  its own place, never the runner's other claims.
  - **Course directory** (R-BTN-69, R-BTN-134):

    ```
    .baton/courses/<course>/
      course.json            # stations and legs
      sync.mjs               # run by the repository's sync
      rank.mjs               # optional; run on the runner (R-BTN-98)
      legs/<leg>.mjs         # one script per leg
      legs/<leg>.run.mjs     # optional repository replacement for the leg's run (R-BTN-131)
    ```

  - **A leg script** exports `run(ctx)`; `handoff(ctx)`, which writes the hand-off document
    (R-BTN-44) and returns its URL; and `close(ctx, result)`, which writes the leg's closing
    marker (R-BTN-83) from the validated result and returns its `ref` — by name or on the
    default export. The test kit fails a course whose file names a leg with no script, whose
    `legs/` holds a script for no leg, or whose script lacks one of the three.
  - **`ctx`** carries: the ticket (id, path, home repository, and a pathless ticket's `file`,
    R-BTN-74); the claim (id, nonce, the station the leg leaves); the leg and its run number;
    `replay` (R-BTN-84); the newest hand-off document and the resume record (R-BTN-24); advice;
    Baton's position and the latest snapshot's readiness; `checkout` (working directory); the
    `session` token the previous leg returned; and an `AbortSignal` whose reason is `release`
    (including a course change) or `regressed`. A lost lease stops the session without sending
    an abort reason. Apart from that signal it is JSON: it carries no
    function, and a leg raises a condition on its channel (R-BTN-106).
  - **First leg** is the queued leg the claim response names (R-BTN-83), started by the first
    `advance`; a first `advance` into any other leg is refused `not-eligible`, rule `not-queued`.
  - **The result** always carries a position: `{reached, next, not_before?, outputs?, session?,
    bars?}`, `{suspend: true, reached, next, detail?}`, `{end: 'done', reached, detail?}` or
    `{release: <reason>, reached, next}`. `reached` is an outcome station of the leg, or its
    `from` when given up; the script names `next` and any `bars` it chose (R-BTN-63). A `reached`
    that is not an outcome of the leg, or a `next` that does not leave it, is a script bug: the
    runner suspends at the leg's `from`. Outputs are validated against their schemas before
    anything is reported (R-BTN-82, R-BTN-108). A `detail` on a suspension or a done end is the
    end's `detail` (§9.4), stored on the claim and on the finished run's history row beside its
    evidence (R-BTN-81).
  - **The runner writes nothing to git itself.** The leg's `close` writes the closing marker and
    the leg leaves its own evidence (R-BTN-8). On a suspension or release the runner calls
    `close`, then `handoff`, so the hand-off can cite the position. A failing `close` is retried
    twice; then the runner reports nothing for the leg and ends
    `released:cannot-finish:transient`. A lost lease aborts the leg and writes no hand-off.
  - **The declaration defaults to the grant.** `--capabilities` narrows, never enables. Without
    it the runner declares the heartbeat answer's `grant.capabilities`: the capabilities the
    key's grants give it on the repositories its declared courses are in (§5.6), `none` left
    out, and for a bearer or seed key, which no grant binds, its credential's allow-list. Its
    first heartbeat declares nothing, and it follows the grant as it moves, without a restart.
    A runner whose declaration lacks a capability a leg of its course requires, or whose grant
    allows nothing, logs that once at startup.
  - **The CLI says what it is.** Every heartbeat's `profile` carries `cli: {commit, ref,
    pinned}`, the runner's own statement of its CLI checkout, reported and never gated on. A
    runner started from a branch tip logs a warning.
  - **Bounded git, and signals.** Every git call the runner makes is bounded and
    non-interactive, so a stalled remote fails the leg within the bound and never holds a claim.
    SIGTERM, like the `wind-down` message, drains: the legs in flight complete, their claims end
    at the leg boundary, and the runner exits. SIGINT, SIGHUP and a second SIGTERM release every
    leg in flight at its next safe point — each hand-off written, each claim ended
    `released:requested` — and a leg that does not take it has its call killed after ten
    seconds and its session stopped (R-BTN-107), waited on for at most ten more.
    On any of these, an uncaught exception or an unhandled rejection, the runner logs every
    claim it holds with its leg in flight and the time of its last answered beat.
  - **Leg sessions** a script starts get the leg environment (R-BTN-144). They start no sidecar
    and register no runner; their harness hooks read the state view for the fence, owner bars
    and claim, and append activities and transcript paths to the runner's spool; their skills
    never claim, advance or end.
  - **A checkout per claim, reattached after a restart (R-BTN-4).** Every claim works in a
    checkout of its own — a separate clone with its own git directory, never a worktree sharing
    refs; the runner keeps as many clones as it may hold claims and reuses them across claims.
    It persists, per claim, the claim id, the run id and the executor's handle in its state
    file. Restarted within its lease it resumes with its persisted secret — no re-key — and
    reconnects to each claim's still-running session through the executor's `reattach`; a
    session it cannot reach ends its claim `released:cannot-finish:transient`. Past the lease
    its claims are reaped (§9.5).
  - **Loading.** The runner loads each claim's course, by the claim answer's `course_id`, and
    its scripts from the claim's `snapshot_sha` (R-BTN-143), so a course change reaches every
    runner at its next claim without a restart. `min_runner_version` (R-BTN-65) covers harness
    skills; the runner's own features are gated by `runner:` capabilities (R-BTN-133).
- **R-BTN-106 (a session reports to its runner; the runner checks every move).**
  - **The leg's channel.** The runner serves one channel per leg and authenticates a call by the
    channel it arrived on; the leg's session finds its address in `BATON_SOCKET`. The interface
    names an address, not a transport: the transport is the executor's (R-BTN-107). It carries
    JSON lines, wrapped by the CLI's `baton leg` verbs, which act on that leg only and exit 2
    "not inside a leg" elsewhere. The verbs built are `raise` (`baton leg raise`, R-BTN-160) and `done`,
    the posted ending of a session that does not exit by itself (R-BTN-107), which has no CLI
    command; anything else sent
    on the channel is refused, a raw `advance` or `end` included. The other verbs are
    in [the proposal page](../proposals/checks-and-executors.md). A script may return its result
    directly instead.
  - **The session never talks to Baton**; the runner makes every Baton call.
  - **The runner checks each move** as it checks a script's result: `reached` an outcome of the
    leg, `next` a leg leaving it, each output valid against its schema, every entry requirement
    of `reached` met (R-BTN-109). A failing move is answered on the channel with the reason and
    may be corrected until the leg's deadline; nothing reaches Baton until it passes. Then
    `close`, `handoff` where it suspends or releases, and `advance` or `end`. A blocked release
    on a capability or resource is a request the runner confirms with its own check (R-BTN-126).
  - **The leg-end scope audit** (§12.9): at each leg's end, after its `close` and `handoff` have
    run, the runner reads from its own git of the home checkout the remote refs the leg's window
    moved, and names a push only where the window's reflog says `update by push`. Each is mapped
    to the repository its remote points at (the whole forge path), and the pushes outside the
    claim answer's `scope` are reported with the `advance` or `end` that finishes the leg. Baton
    judges them against the scope, never the runner.
  - **`no_chain_from: [<leg>…]`** on a leg (course file): Baton refuses a claim or `advance` into
    it, `not-eligible`, rule `chain`, by a **credential** that has run any named leg on this
    ticket, in this claim or another (`claim_legs` → claim → runner → credential; a run with no
    claim is skipped; runners sharing one credential count as one). The runner suspends instead.
- **R-BTN-107 (the executor: how a leg runs is the runner host's choice).** A CLI runner starts
  every leg, and runs every call into repository code, through its **executor**: a module with a
  versioned interface whose code the runner's host chooses. Baton is agnostic about isolation: it
  names no sandbox, VM, container or cgroup, defines no key an executor reads, keeps no ranking of
  executors, and no rule reads how a leg was kept apart; that is the deployment's (§12.8). Every
  other rule of this spec is written against the interface. The runner keeps everything Baton
  knows of: the heartbeat, claim, lease and fence, its key, the check of every move (R-BTN-106)
  and the masking of what the executor streams (R-BTN-144). The parts of the executor design not
  built are in [the proposal page](../proposals/checks-and-executors.md).
  - **The interface**, `executor_api: 1`:
    - `start({brief, executor, inputs, channel}) → handle` starts a session. `brief` holds the
      session's kind, the ticket, the leg, the checkout and the paths the session reads, the
      leg environment (R-BTN-144), and, as hints, whether the leg is `autonomous` (R-BTN-195)
      and `reads_only` (R-BTN-183). The claim id and runner secret are not brief fields;
      credential inheritance is governed by R-BTN-144. `channel` is the address of the leg's
      channel (R-BTN-106). A handle may name
      the session's link, which the runner reports as R-BTN-113 says.
    - `exec(handle, argv, {cwd, timeout_s, stdin}) → {status, stdout, stderr}` runs a command
      where the session runs; the call's stdin stays open for further lines until it ends.
    - `stop(handle, reason)` stops the session. The executor chooses how to stop it;
      R-BTN-145 governs the total time, including the runner's handling before this call.
    - `end(handle) → {status, result}` waits for the session's end. A session that does not exit
      when its agent is done, one a person can join, ends at the result posted on its channel,
      after which the runner calls `stop` (R-BTN-195).
    - `salvage(handle)` returns null.
    - `reattach(saved) → handle | null`, optional, reconnects to a session a runner started
      before it restarted (R-BTN-72).

    A leg session's handle is keyed by its session id (R-BTN-123), and any other session's by one
    the runner mints, `<kind>-<random>`, recorded only in the runner's log.
  - **The source is the runner host's choice**: `runner.json` `executor`, or `baton runner start
    --executor <source>`, never a repository file.
    - **`builtin`** (the default, no configuration): every call is a detached child of the
      runner in its own process group, as the runner's OS user, stopped by signals to the group;
      the channel is a Unix socket in the runner's state directory, mode 0600; it offers no
      `reattach`. `builtin` keeps nothing apart. A leg can read the runner's state and key
      files, use its ssh-agent, act for any claim its runner holds and write wherever the
      runner's user can, and a process that leaves its group outlives its leg's stop. So under
      `builtin` every separation this spec gives a leg — the fence, the leg environment and
      masking (R-BTN-144), the stop (R-BTN-145), a claim's own checkout — binds only a
      cooperating leg (R-BTN-46). Whether a leg can reach the runner's credentials under any
      other executor is that executor's, never Baton's.
    - **`pinned:<path>@sha256:<digest>`**: a bundle on the host, a directory whose entry point is
      its `executor.mjs`. Its digest is the SHA-256 of its canonical listing: for each regular
      file, ordered by its path relative to the bundle (`/`-separated, compared bytewise), the
      line `<path>`, a NUL byte, the file's SHA-256 in lowercase hex and a newline; a symlink or
      any other non-regular entry refuses the bundle. The runner loads it only when the digest
      matches, else refuses to start, and resolves its imports only inside the bundle and to
      Node's built-ins.
  - **Every call into repository code goes through `exec`**, in a session of the call's kind,
    never in the runner's own process: `leg` (the leg script's `run`, `close` and `handoff`, and
    a course's `legs/<leg>.run.mjs` override, R-BTN-131); `rank` (`rank.mjs`, R-BTN-98);
    `source` (the ticket source's exports, where a runner calls them, R-BTN-74); `sync` (a
    course's `sync.mjs`, where a runner runs the sync); and `install`. The kind is a word in
    `brief`; Baton says nothing about how a session of any kind runs. A call that takes `ctx` is
    an `exec` of the wrapper (R-BTN-133).
  - A leg whose session cannot start ends `released:cannot-finish:transient`.
- **R-BTN-123 (a run's session id).** A leg run's session id is `<run_id>.r<n>` (R-BTN-63), `n`
  counting the run's context refreshes from 0. Refreshing a leg into a fresh session when its
  context fills is not built ([proposal](../proposals/checks-and-executors.md)), so `n` is 0.
- **R-BTN-113 (a leg run carries its session's link).** A heartbeat may carry `session_urls`,
  one link for each claim's running leg, and `advance` or `end` a `session_url` for the leg it
  finishes. A link must be `https`, at most 512 characters, without userinfo, with its host in
  the instance's `session_hosts` (an administrator's setting, default `claude.ai`, §12.7), else
  it is dropped and logged, never a refused call. It is stored on `claim_legs.session_url` (latest wins while
  running) and shown on Board and the runner page (§11.4). Under an executor whose handle names
  its session's link (R-BTN-107), it is that link, or a page the runner serves that leads a
  person to the session.
- **R-BTN-201 (a launcher starts sessions; Baton reserves nothing for them).** A **launcher** is
  a process outside Baton, run by the deployment, that starts runner sessions when there is work
  for them. Baton records no launch and reserves nothing for one: a started session claims as
  any runner does. A session whose lease lapses is fenced (R-BTN-6) and reaped (§9.5), so a
  launcher needs no way to stop one. The read a launcher would use, `GET
  /v1/runner/launch-candidates`, and a claim's hint naming the ticket a session was started
  for, are not built; the design is in
  [the proposal page](../proposals/checks-and-executors.md).
- **R-BTN-202 (a runner's local queue; local orders while Baton is unreachable).** A runner keeps a
  local work queue for its home checkout, on its host and outside every leg session, so no leg can
  write it. It holds the **orders** the host's user gives with `baton queue add <repository>:<id>[@leg]` (`baton queue list`,
  `baton queue remove`). Baton is **unreachable** when a call does not reach it or it answers 5xx.
  - **While Baton answers, an order is a claim attempt.** The runner claims its oldest order
    by name before an unnamed claim (R-BTN-72), through every gate; a refused claim drops
    the order.
  - **While Baton is unreachable, an order's leg starts without a claim.** The leg is the
    order's `@leg` and the station the leg's only `from`; an order naming no leg, or a leg leaving
    several stations, waits for Baton. Such a leg runs only at one claim (R-BTN-4's
    bound 1), on a runner serving one course, at the home checkout's head. Its `ctx.claim` names
    only the station it leaves. The runner logs that nothing guarantees another runner is not
    running the same leg, and keeps asking Baton. No git write stands in for the lease
    (R-BTN-193). A leg that finishes is closed — its evidence in git (R-BTN-83) — and its result
    kept in the queue; a leg that fails drops the order and reports nothing.
  - **The result is reported through a claim, and gated as usual.** When Baton answers again the
    runner claims the ticket. When the claim's queued leg is the one run offline, from the same
    station, the first `advance` starts it and the runner finishes it from the kept result
    without running it again; the call that finishes it carries `local_order: {by, ran_at}`,
    recorded on its event and deciding nothing, and the course goes on. A claim offered another
    leg runs that leg and reports nothing of the offline one; a refused claim drops the kept
    result. Whatever the offline leg pushed stays in git.

### 8.4 Where and how a leg runs

- **R-BTN-143 (a runner runs only code the default branch holds).** Before reading any file at
  the recorded `snapshot_sha`, `baton leg replay` checks `git merge-base --is-ancestor <snapshot_sha>
  refs/baton/<repository>/default`, its own ref of the **registered** default branch Baton
  names, not a branch selected by the checkout. On failure it makes one bounded fetch
  into that ref and checks again. A second failure refuses replay. `--against <sha>` may select
  another commit to run; the check is on the recorded sha.
  - The runner checks no second ancestry: Baton's record of the head is trusted (§12.8).
  - **Not built ([B-299](../../tickets/B-299.mdx)).** Before reading any file at a claim's
    snapshot, `baton runner start` must make the same check against the registered default
    branch from the home's remote. On a second failure it reads nothing there and ends
    `released:off-branch` (§9.4).
  - **Not built:** the `baton.off-branch` condition ([B-46](../../tickets/B-46.mdx)) and the
    off-branch sync want ([B-57](../../tickets/B-57.mdx), R-BTN-94).
- **R-BTN-133 (repository code runs through the wrapper).** R-BTN-143 governs snapshot reads. No repository
  code loads in the runner's process.
  - **The wrapper** `legProcess.mjs`, the CLI's own, which the executor makes available where
    its sessions run, runs every call into a script — `run`, `close`, `handoff`, a ticket
    source's exports (R-BTN-74) and R-BTN-134's `tickets`, `stations`, `rank` — as `node
    legProcess.mjs <call> <script>`, `<call>` naming the export it calls, by the executor's
    `exec` (R-BTN-107). It reads `ctx` as JSON from the first line of stdin (under `run`, each
    later line is an abort reason for `ctx.signal`) and writes `{ok, result | ref | url, error?,
    aborted?}` as JSON on the last line of stdout. Its cwd is `ctx.checkout`. `close` and
    `handoff` are bounded at 2 minutes each, then killed as a failure.
  - **The `runner` capability type** (built in, beside `human-operator`, R-BTN-121):
    `runner:<feature>`, declared only by a runner from its own code and counted as granted to
    every runner key. A course may not declare a type named `runner` or `human-operator`. Baton
    refuses a claim or `advance` by a runner not declaring a required `runner:` capability (rule
    4) and omits such legs from its recommendations.
  - **Leg trees** — a verified, read-only checkout of the claim's commit that a leg's scripts
    and their installed dependencies load from, gated by `runner:leg-trees` — with scripts in
    TypeScript and the leg module `@immediately-run/baton/leg`, are not built
    ([proposal](../proposals/checks-and-executors.md)).
- **R-BTN-144 (a leg's environment, and the one list of what is masked).**
  - **The runner's own credentials.** The reference runner currently passes its environment to
    legs, including `BATON_KEY`, `BATON_KEY_FILE` and `BATON_TOKEN` if set (the token can be
    an API key). **Not built ([B-299](../../tickets/B-299.mdx)):** remove those variables after
    capturing the authentication configuration and before loading repository code, so leg
    sessions do not inherit them. Removing a key file's path from the environment does not
    prevent a leg from reading that file if its executor permits it.
  - **What a leg's environment holds.** The runner inherits host variables, including git,
    forge and model-provider credentials and `SSH_AUTH_SOCK`, and sets these leg values:

    | Variable | Value |
    |---|---|
    | `BATON_PARENT` | the CLI runner's runner id |
    | `BATON_STATE` | path of the runner's local state file, which contains the runner secret |
    | `BATON_SOCKET` | the address of the leg's channel (R-BTN-106) |
    | `BATON_RUN_ID` | the run's `run_id` (R-BTN-63) |
    | `BATON_SESSION_ID` | the run's session id (R-BTN-123) |
    | `BATON_AGENT_COMMAND` | command from `--harness`, a fallback when snapshot settings name no agent command |
    | `BATON_VERBOSE` | `1` when the runner is verbose |
    | `BATON_DEFAULT_BRANCH` | the claim's default branch, when supplied |

    A leg is expected to treat the state file as read-only, but mode `0600` does not isolate
    it from a leg running as the same user with access to that path. Output masking does not
    limit file access.

    **Not built:** `BATON_ACTIVITY` for child activities (R3-1214, §9.9), `BATON_RESUME` for a
    path to earlier claimants' text, and scoping `credential:<NAME>` variables to the leg's
    `requires` ([B-46](../../tickets/B-46.mdx)). The latter includes refusing course declarations
    of reserved environment names.
  - **Masking.** The runner replaces matches with `***`. Classes 5–7 are built; class 7 can
    cover values from other classes when their environment names match.
    1. the runner secret (the claim nonce is public and authenticates nothing) — not built ([B-299](../../tickets/B-299.mdx));
    2. the runner's Baton credentials (`BATON_KEY`, the contents of the file `BATON_KEY_FILE`
       names, `BATON_TOKEN`, an API key) — dedicated masking not built ([B-299](../../tickets/B-299.mdx));
    3. the value of every declared `credential:<NAME>` variable, given to the leg or not — not built ([B-46](../../tickets/B-46.mdx));
    4. the git and forge tokens the runner holds — dedicated masking not built ([B-131](../../tickets/B-131.mdx));
    5. by pattern, every bearer prefix Baton issues or reserves — `brt_`, `bak_`, `bmcp_`, `bps_` and `bds_`
       (§12.1), and `bmo_`, `bmr_` and `bor_` (`BATON_MCP_OAUTH_SPEC` §12) — followed by
       `[A-Za-z0-9_-]*`;
    6. by pattern, every `-----BEGIN … PRIVATE KEY-----` … `-----END … -----` block, replaced
       whole: after a `BEGIN` line output is held until the `END` line or 16 KB, then the whole
       held run is masked;
    7. by name, the value of every variable of the leg's environment whose name ends `_KEY`,
       `_TOKEN`, `_SECRET`, `_PASSWORD` or `_PAT`, or is `PGPASSWORD`, each compared exactly as
       the environment spells it, and of every variable `runner.json` `mask_env` names. The set
       is computed once, at leg start, from the environment the leg is given.

    Masking runs on the byte stream, holding back the longest literal's length minus one byte.
    A literal value under 8 bytes is not masked (logged once). A credential under a name class 7
    does not match is masked only once `mask_env` names it. An archiver running under a runner
    (`BATON_PARENT` set) masks classes 5, 6 and 7 in transcripts before pushing (R-BTN-20),
    computing class 7 from its own environment.
  - **Replay** (R-BTN-84) builds its environment from an allowlist: `PATH`, `LANG`, `TZ`,
    `TERM`, an isolated `HOME`, the read-only clone credential `runner.json`
    `replay_clone_credential` if configured, and names in `runner.json` `replay_env` or `--env`.
- **R-BTN-145 (every process a leg starts is stopped with it).** Every process the leg started
  must be gone within 30 s of the runner receiving a stop or release or detecting a lost lease,
  or of the runner exiting or the leg call returning. This is an end-to-end bound, including
  any grace period and executor cleanup (R-BTN-107). The `builtin` executor kills the call's
  process group on exit or when asked to stop. **Not built:** enforcement of the end-to-end
  bound for release and for processes outside the call's group (B-184, B-9).
- **R-BTN-119 (stopping a running leg).** Baton kills nothing; it asks the runner.
  - A `release` reaches the runner on a heartbeat. It sends one abort line to the running leg
    call, if attached, and gives the leg a safe point to stop. The reference runner starts its
    30-second grace timer when a poll sees the pending abort, not at receipt of the release.
    If the leg is still running when the timer expires, the runner kills the active call, if
    any, and awaits the executor's `stop` (R-BTN-107). The timer does not bound the preceding
    poll delay or the subsequent cleanup, so it does not enforce R-BTN-145's deadline.
    There is no separate signal ladder for `requested`, `owner-cancel` or `floor`.
  - If Baton has already ended the claim, the lost-claim path stops the leg without a hand-off
    (R-BTN-6). Otherwise the runner settles the release (§9.4).
  - **Not built:** `baton leg stop` ([B-9](../../tickets/B-9.mdx)).

### 8.5 A running leg's output

- **R-BTN-128 (a leg run's output).** A leg's output is masked (R-BTN-144) before it leaves the
  runner, and goes to the runner's own log. `claim_legs.leg_log_dir` is null on every run:
  writing a run's output to an owners' log location, and `baton leg log`, which reads it there,
  are not built ([proposal](../proposals/checks-and-executors.md)).
