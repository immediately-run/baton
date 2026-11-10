---
title: "8. Runners"
description: "A runner is any process that can execute a leg; it registers by heartbeat and holds claims (§9)."
---
## 8. Runners *(partly built — B-8, B-9, B-12, B-42, B-46, B-47, R3-1213, R3-1260; the executor, R-BTN-107, proposal — B-184)*

A **runner** is any process that can execute a leg; it registers by heartbeat and holds claims
(§9). There are two kinds, on the same API: an **interactive runner**, an agent harness session,
through its sidecar; and a **CLI runner**, `baton runner start`, which runs a ticket's legs as
scripts. Where a rule has a runner call a leg script's `run`, `close` or `handoff`, check a move or
open a leg's channel, it is the CLI runner, through its executor (R-BTN-107). Under the default
executor, `builtin`, leg scripts, `rank.mjs` and the dependencies they install run with the
runner's full rights and every separation below binds a cooperating leg; whether a leg can reach
the runner's credentials under any other executor is that executor's, never Baton's.

### 8.1 Runners, heartbeats and the doorbell

- **R-BTN-3 (a runner exists from its first heartbeat).** A runner is created by its first
  authenticated heartbeat and never deleted. It is one interactive session (opencode or Claude Code),
  or one CLI runner, on a host whose `kind` — `vm`, `local` (an owner's machine) or `cloud` (a
  Claude Code cloud container) — is a descriptive label the runner reports and no rule reads.
  Several sessions on one host are several runners; the dashboard groups them by hostname. A CLI
  runner's leg sessions, wherever its executor runs them (R-BTN-107), are not runners.
  - **Identity** is `(hostname, session_name)`: `hostname` is the name the key is registered
    under (R-BTN-13; a machine's hostname, or a cloud environment's name shared by all its
    containers); `session_name` is the harness's session id, `^[A-Za-z0-9_.:-]{1,128}$`. A
    repeat heartbeat from the pair is the same runner only with that runner's secret (R-BTN-14).
  - **Alive** = `reaped_at IS NULL AND now − last_seen_at < lease_timeout_ms`. A reaped runner
    (§9.5) is dead: its calls are refused `runner-reaped` until it re-keys (R-BTN-14), which
    starts a new incarnation of the same runner holding no claim.
- **R-BTN-9 (the runner declares its lease timeout).** `lease_timeout_s` on each heartbeat,
  clamped to [900, 86400], default 900. A machine that sleeps (a laptop overnight) declares
  more; the ceiling bounds how long a dead runner blocks a ticket. The sidecar fences (R-BTN-6,
  R-BTN-26) on the lowest of the value in force at `last_ok` and every value it has declared
  since, so a heartbeat that lowers the timeout and loses its response never leaves Baton
  reaping on a shorter lease than the fence's.
- **The heartbeat** (unnumbered). The sidecar (or CLI runner), never the agent, sends
  `POST /v1/runner/heartbeat` every **2 minutes**, each request with a **30-second** timeout.
  - It carries: `harness`, `kind`, declared capabilities (R-BTN-121) and tags (R-BTN-60), the
    course-defined `profile` (opaque), `courses: [{repository, course, version}]` read from the
    runner's checkout at session start (R-BTN-22), `tier_ceilings` (one tier name per
    repository; absent ⇒ that repository's top tier), `lease_timeout_s`, `executor` (a CLI
    runner's, R-BTN-107), `delivers` (the outbox classes it delivers, R-BTN-171), `session_url` (R-BTN-113), spooled activities and transcript paths (§9.9), `leg_finished` (R-BTN-90),
    `fenced` (R-BTN-19), `test_harness` (R-BTN-32), `protection` (the protection checker's reading, R-BTN-180); on first contact or re-key, `secret_hash`
    and `rekey`.
  - The response carries the runner's active claim — id, ticket, station, leg, nonce,
    `deadline_at`, Baton's position (`station`, `path`, `next_leg`) and the latest
    snapshot's `git` view (`next` legs with state, `waiting_on` and `not_before`; or `closed:
    done | withdrawn`; or `unknown`; for a ticket marked `cancelling`, its queued `cancel` leg
    `ready`, R-BTN-168) — or none; pending messages (§6), marked `delivered` in the same
    transaction, and delivered ones not yet acknowledged, re-sent until they are (§6.9); the current activity; owner bars in force (R-BTN-67); stale courses;
    `handled` conditions (R-BTN-162); `pending_grants` (R-BTN-146); `server_time`.
  - Every runner call updates `last_seen_at`. Lease upkeep has its own rate bucket and no
    per-tenant cap (R-BTN-135).
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
  - The secret separates sessions against accidents only. Sessions of one OS user can read each
    other's 0600 files and share an ssh-agent; the boundary between machines is the key.
- **R-BTN-91 (the doorbell: a ring, while the heartbeat stays the truth).** A runner may hold a
  WebSocket, `GET /v1/runner/push?session_name=<name>`.
  - The upgrade is authenticated as a heartbeat: signed by the machine key with the query in
    the signature (or its API key), carrying `X-Runner-Secret`; refusals (`unauthenticated`,
    `forbidden`, `session-taken`, `runner-reaped`) replace the upgrade. One socket per runner; a
    new one closes the old.
  - Baton sends `{ring: [<kind>]}` after the transaction that queued something commits; kinds
    are `release`, `status_request`, `wind-down` (B-109), `unblocked` and `handled` (R-BTN-162),
    `facts` to a fact reader (R-BTN-192), and `outbox` to a runner that delivers the class
    queued (R-BTN-171). The runner heartbeats at
    once. At most one ring per runner per second; kinds suppressed within the second go in one **trailing ring** at its end, set by the alarm.
  - Delivery, acknowledgement, the lease and the fence stay on the heartbeat; its 2-minute
    cadence is unchanged, and a ring adds at most one heartbeat.
  - On Cloudflare the socket uses the Hibernation API (`ctx.acceptWebSocket(ws, [<runner id>])`);
    the last ring's time and the suppressed kinds live in `serializeAttachment`. The runner
    sends `ping` every 30 s, answered `pong` by `setWebSocketAutoResponse` without waking the
    object; a ring is a synchronous `ws.send` on `ctx.getWebSockets(<runner id>)`. Runners
    reconnect after a deploy with full-jitter backoff (random ≤ 1 s, cap doubling to 5 min,
    reset after a minute open). The local host uses the `ws` package behind R-BTN-55's `Push`.
  - Baton closes the socket when the runner is reaped, re-keys, stops being alive, or its key is
    revoked, and when the Baton seals.
- **The sidecar** (unnumbered). An interactive session's harness starts a sidecar that
  heartbeats, holds the session's state and runs the fence (§9.2). A CLI runner hosts the sidecar
  itself.

  | Harness | Start / stop | Deny fenced commands | Touch activity, inject notice |
  |---|---|---|---|
  | Claude Code | `SessionStart` starts `baton-sidecar --harness claude-code --session <id> --pid <harness pid>` detached; `SessionEnd` stops it | `PreToolUse` | `PreToolUse`, `PostToolUse`, `UserPromptSubmit`; the lease-lost notice on `UserPromptSubmit` |
  | opencode | plugin: session-start, session-end | `tool.execute.before` | tool-after, prompt |

  - The sidecar polls the harness pid every 10 s and exits when it is gone.
  - **State file** `~/.cache/immediately-run/baton/<session>.json`, mode 0600: runner id,
    secret, active claim, nonce, `last_ok`, lease-lost flag. Only the sidecar writes it. A lost
    state file means a re-key.
  - **Spool.** Every reporter (activity CLI, harness hooks, archivers, status-writing tools)
    appends one JSON line under 4 KB to the session's spool file and returns at once. The sidecar
    posts the spool within 5 s and on every heartbeat, and drains it before exit; a spool left by
    an ended session is drained by the next sidecar on that host, using the ended session's
    state file.
  - **Credentials** are the machine key (R-BTN-13): a VM's generated at provisioning; an owner
    machine's a P-256 key behind an ssh-agent; a cloud environment's in the environment secret
    `BATON_KEY`, shared by every container, which heartbeat under `BATON_HOSTNAME`. No key, no
    sidecar, no claim.

### 8.2 Keys and grants

- **R-BTN-102 (a machine key is trusted with everything a machine does).** A machine key
  (credential kind `runner`, SSH) may, on each repository where it holds an **active** grant
  (R-BTN-146), with ordinary signed requests:
  - **work** (R-BTN-58);
  - **sync** — `/v1/sync/*` with `?repository=<id>` in the signed query, role `sync` only, no
    runner secret — unless the policy's `inputs.board` excludes `machine` (R-BTN-188) or the key's
    span forbids it (R-BTN-146). The mirror stays with sync keys and CI tokens;
  - **report readings** (R-BTN-101);
  - **deliver** outbox entries of the classes it declares, where the policy's `outbox` admits its
    role (R-BTN-171).

  Every snapshot records its credential (`board_snapshots.posted_by`). A machine-key post that
  closes a ticket another runner holds, drops a posted bar, or loosens an author's gate (lowers
  a tier, drops a `requires` clause, removes a `ticket` block or a decision)
  raises `baton.machine-post` naming the tickets and the key; it is noticed, not stopped. A
  machine key is never an owner, administrator or check-runner key, and none of
  those is a machine key. API-key runners (R-BTN-159) work and report readings but never sync or deliver.
  One machine key per tenant (R-BTN-137).
- **R-BTN-146 (a grant takes effect when the key's holder accepts it; a key on several
  repositories syncs only where each opts in).**
  - Every grant of an SSH key by fingerprint is **pending** and gives nothing until the holder
    runs `baton runner accept-grant <repository>` (key alone, no runner secret; action
    `runner.grant.accept`); when acceptance raises the span it lists the repositories that would
    lose sync and needs `--confirm`. The heartbeat response carries `pending_grants`, and
    `baton runner start` prints the accept command for each. Registering with a repository's
    token (R-BTN-117) is acceptance; a grant to an API-key credential is active at creation.
  - `baton runner decline-grant <repository>` (`runner.grant.decline`) revokes a pending grant
    or returns an active one to pending, and raises `baton.grant-declined` on that repository.
  - A hostname binds at the key's first acceptance; a first grant declined or never accepted
    releases it. `accepted_at` is set at first activation and cleared by a re-grant after a
    revoke; revoking other grants never activates a pending one.
  - **Span** = the number of the tenant's repositories where the key holds an active grant. At
    span 1, R-BTN-102 applies as written. At span ≥ 2 the key syncs a repository only where that
    grant has `sync: true` (owners set it; default `false`), else `forbidden` (event reason
    `span`); work, readings and views follow the active grant alone. Going from span 1 to 2
    keeps the first repository's explicitly set flag, else `false`, and raises
    `baton.span-changed` on every repository of the key until an owner confirms the flags
    (`owner.grant.flags`); returning to span 1 restores R-BTN-102's defaults.
  - `GET /v1/owner/{repository}/grants` lists each key's hostname, span and other repositories
    (pending marked); `baton owner grant add` prints the span and needs `--confirm-span` when the
    key holds a grant elsewhere.
- **R-BTN-117 (registration tokens).** A repository owner mints a token for a session that has
  no key yet: `baton owner token create <repository> --role runner [--capabilities …]
  [--max-tier <t>] [--ttl <d>] [--uses <n>]` (R-BTN-127).
  - `--uses` default 1, at most 100; TTL default 7 days, at most 30 days. Shown once as
    `brt_<id>_<secret>` (256 random bits), stored as its SHA-256 with its scope, valid in the
    minting tenant only (R-BTN-137), revoked with `baton owner token revoke`.
  - `baton runner register --token <t> --name <name> [--key ssh | --key api]` creates a runner
    credential with a grant inside the token's scope, never wider.
    `--key ssh` (default) generates an Ed25519 key in the session and registers its public half;
    `--key api` returns an API key (R-BTN-159). A name bound to another live credential is
    `conflict`; renewing one's own name is a re-key, spends no use, and must be signed by the
    name's current credential. Each registration is an `admin` event; more than 10 registrations
    by one token in 24 h raises `baton.token-burst`.
  - A token-registered credential lasts until the token's `grant_ttl` (default: the token's TTL)
    or 7 days without an authenticated call, whichever is first; revoking the token revokes every
    credential it registered. The dashboard shows each runner's credential kind and token.

### 8.3 The runner

- **R-BTN-72 (the runner).** `baton runner start` is a generic runner loop. It hosts the
  sidecar, heartbeats, asks for recommendations, claims, and runs the ticket's legs one at a
  time, each by **the script for that leg**, then advances, suspends or ends as the script's
  result and the course file allow. It knows no course: it serves every course its home
  checkout declares, loading each claim's course from the claim answer's `course_id` at the
  claim's `snapshot_sha`, one leg at a time (B-103; the bullet after this one). It owns the legs
  themselves —
  starting them through its executor (R-BTN-107), stopping them when necessary, and realizing
  they are stuck (§1's division of labor; B-108) — and nothing else does. A leg's end is the end
  of every process it started, whatever ended the leg: under `builtin` the runner kills the
  wrapper's process group at the wrapper's exit — the lost lease's no-hand-off kill (R-BTN-24)
  and the wrapper's own return alike — so a process a leg started (a held lock, a background
  check an agent spawned) never outlives its leg (S-BTN-200); any other executor keeps the same
  guarantee by its own means. Idle,
  it asks for recommendations when
  a heartbeat carries `unblocked`, else at its own interval (R-BTN-77).
  - **Course directory** (R-BTN-69, R-BTN-134):

    ```
    .baton/courses/<course>/
      course.json            # stations and legs
      sync.mjs               # run by the repository's sync
      rank.mjs               # optional; run on the runner (R-BTN-98)
      legs/<leg>.<ext>       # one script per leg (<ext>: R-BTN-133)
      legs/<leg>.run.<ext>   # optional repository replacement for the leg's run (R-BTN-131)
    ```

  - **A leg script** exports `run(ctx)`; `handoff(ctx)`, which writes the hand-off document
    (R-BTN-44) and returns its URL; and `close(ctx, result)`, which writes the leg's closing
    marker (R-BTN-83) from the validated result and returns its `ref` — by name or on the
    default export. The test kit fails a course whose file names a leg with no script, whose
    `legs/` holds a script for no leg, or whose script lacks one of the three. Marker and forge
    primitives come from `@immediately-run/baton/leg` (R-BTN-133).
  - **`ctx`** carries: the ticket (id, path, home repository); the claim (id, nonce, the station
    the leg leaves); the leg and its run number; resolved and validated `inputs` (R-BTN-82);
    `replay` (R-BTN-84); the newest hand-off document and the resume record (R-BTN-24); advice;
    Baton's position and the latest snapshot's readiness; `checkout` (working directory); `snapshot: {sha, tree}` and
    `course: {dir}` (R-BTN-133); the `session` token the previous leg returned; `refresh` and
    `yield` (R-BTN-123); `raise` (R-BTN-160) and `resume` (the chosen restart, R-BTN-162); and an
    `AbortSignal` whose reason is `lease-lost` (stop at once), `release` (stop at the next safe
    point), or `context` (stop at the yield just answered).
  - **First leg** is the queued leg the claim response names (R-BTN-83), started by the first
    `advance`; a first `advance` into any other leg is refused `not-eligible`, rule `not-queued`.
  - **The result** always carries a position: `{reached, next, not_before?, outputs?, session?,
    bars?}`, `{suspend: true, reached, next}`, `{end: 'done', reached, detail?}` or
    `{release: <reason>, reached, next}`. `reached` is an outcome station of the leg, or its
    `from` when given up; the script names `next` and any `bars` it chose (R-BTN-63). A `reached`
    that is not an outcome of the leg, or a `next` that does not leave it, is a script bug: the
    runner suspends at the leg's `from`. Outputs are validated against their schemas before
    anything is reported (R-BTN-82, R-BTN-108).
  - **After a leg**, when the latest snapshot observed after it shows the next leg `waiting`,
    the runner suspends — unless `waiting_on` is in the course file's `short_waits`: then it
    keeps the claim, re-reads the station each heartbeat for up to 30 minutes, then suspends
    (R-BTN-40). At an end station, or when the heartbeat's `git` says `closed: 'done'`, it ends
    `done`; `closed: 'withdrawn'` is a `stale-board` release Baton already made — except under a
    claim of the ticket's `cancel` leg, whose `git` view shows that leg `ready` and which runs to
    its end (R-BTN-168).
  - **Reactions**: a gate's refusal or a `max-runs` refusal suspends at the station reached; an
    `off-graph` refusal or heartbeat `station: unknown` (R-BTN-64) finishes or abandons the leg
    and ends `released:course-changed`; a prerequisite lost mid-leg ends
    `released:blocked` (R-BTN-126); a release message stops the leg (R-BTN-119).
  - **The runner writes nothing to git itself.** The leg's `close` writes the closing marker and
    the leg leaves its own evidence (R-BTN-8). On a suspension or release the runner calls
    `close`, then `handoff`, so the hand-off can cite the position. A failing `close` is retried
    twice; then the runner reports nothing for the leg and ends
    `released:cannot-finish:transient`. A lost lease aborts the leg and writes no hand-off.
  - **The declaration defaults to the grant (B-86).** `baton runner start`'s `--capabilities`
    narrows, never enables. Without it the runner asks — its first heartbeat declares nothing, a
    registration with no declaration to widen — and each answer carries `grant: {capabilities}`:
    the capabilities the key's grants give it on the repositories its declared courses are in
    (§5.6), expanded as grants are stored, `none` left out, and an empty list where it is granted
    on none of them. The runner declares that list, folding into the role it exactly names
    (`agent-venue` for that role's four), and follows the grant as it moves, without a restart.
    A runner that names the flag declares what it names. A bearer or seed key, which no grant
    binds, is answered its credential's allow-list, as it always declared. A runner whose
    declaration lacks a capability a leg of its course requires says so once, in one line, at
    startup — the missing ones and `missing-capability` (rule 4) — and a runner whose grant allows
    nothing says that instead of idling in silence. A worker registered before the answer carried
    `grant` asks by declaring nothing on its next beat, so the answer fills the declaration in.
    The identity banner `baton runner start` logs at startup names the declaration this way: the granted
    name (`grant`, or `grant:*` read as the grant) where no flag was given, the flag's own list
    where one was, beside the home checkout's HEAD, course, host and session.
  - **A wedged git never holds a claim (B-94).** Every git call the runner and a standard course's
    `close` make is bounded and non-interactive: `GIT_TERMINAL_PROMPT=0`, ssh in `BatchMode=yes`
    with a connect timeout, and a timeout that kills the process; the stubs a standard course
    generates run every git and gh call they make — the snapshot probes, the override and
    instructions reads, the forge verification — through the same bound and environment. A
    stalled remote therefore
    fails the leg within the bound — `close` throws on the killed push, the runner's two retries
    are each bounded too, and then the leg ends `released:cannot-finish:transient` — rather than
    blocking the runner for hours. Nothing on the heartbeat path runs a git without a bound. **A runner's death always leaves a line:** on SIGTERM, SIGINT, SIGHUP (B-109: a closed
    terminal's hangup, found live 2026-10-24),
    an uncaught exception or an unhandled rejection it logs its claim id, the leg in flight and
    the time of its last answered beat before the process goes, so "died tracelessly" cannot
    happen. **The immediate stop is a safe point (B-109):** SIGINT, SIGHUP and a second SIGTERM
    release the leg in flight at its next safe point — its hand-off written, its claim ended
    `released:requested` — and exit with the signal's code once the loop ends; the standard
    courses' stubs take a release by stopping their agent at once. A leg that will not take it has
    its call killed after ten seconds (the lease-loss mechanism) and its session stopped
    (R-BTN-107), waited on for at most ten more, so no orphaned leg — and no executor's sandbox —
    keeps pushing against a claim the reaper took.
  - **A course's `cancel` leg** (R-BTN-168) is an ordinary leg with a script, which Baton alone
    queues. The outbox is no leg: a runner that delivers claims entries, not legs (R-BTN-171).
  - **Leg sessions** a script starts get `BATON_PARENT=<runner id>`, `BATON_SOCKET`
    (R-BTN-106) and `BATON_STATE`, a read-only state view without the runner secret (the claim
    nonce is public, R-BTN-144). They start no sidecar and register no runner; their harness hooks read the view for
    the fence, owner bars and claim, and append activities and transcript paths to the runner's
    spool; their skills never claim, advance or end.
  - **Loading.** The runner loads `course.json` and the scripts from the claim's `snapshot_sha`
    (R-BTN-143, R-BTN-133), so a course change reaches every runner at its next claim without a
    restart. `min_runner_version` (R-BTN-65) covers harness skills; the runner's own features are
    gated by `runner:` capabilities (R-BTN-133).
- **R-BTN-106 (a session reports to its runner; the runner checks every move).**
  - **The leg's channel.** The runner serves one channel per leg and authenticates a call by the
    channel it arrived on; the leg's session finds it by `BATON_SOCKET`. Under `builtin`
    (R-BTN-107) it is a Unix socket in the runner's state directory, mode 0600; an executor
    carries it however it likes — the interface names an address, not a transport. JSON lines,
    wrapped by the CLI. Verbs act on that leg only and exit 2 "not inside a leg" elsewhere:
    `baton leg status` (leg, grant, deadline, `refresh`);
    `baton leg output <name> --uri <uri> [--digest …] | --value <json>`;
    exactly one ending — `baton leg done --reached <station> --next <leg>`,
    `baton leg suspend --reached <station>`, `baton leg release --reason <reason>`, or
    `baton leg release --blocked --kind <kind> --ref <ref> […]` (R-BTN-126);
    `baton leg yield [--context <fraction>]` (R-BTN-123);
    `baton leg raise`, `baton leg await` (R-BTN-160, R-BTN-162);
    `baton leg next` (the `attached` executor, R-BTN-107).
    A script may return its result directly instead. The channel carries these verbs and nothing
    else: a raw `advance` or `end`, a run label (R-BTN-180), or a run's `executor_digest`,
    `environment` or `instance` (R-BTN-107) sent on it is refused — the runner reports those
    itself.
  - **The session never talks to Baton**; the runner makes every Baton call.
  - **The runner checks each move** as it checks a script's result: `reached` an outcome of the
    leg, `next` a leg leaving it, each output valid against its schema, every entry requirement
    of `reached` met (R-BTN-109). A failing move is answered on the channel with the reason and
    may be corrected until the leg's deadline; nothing reaches Baton until it passes. Then
    `close`, `handoff` where it suspends or releases, and `advance` or `end`.
  - **The leg-end scope audit** (B-134, §12.9): at each leg's end the runner reads, from its own
    git of the home checkout, the remote refs the leg's window moved — after the leg's close and
    hand-off have run, so their pushes are in the window — and names a push only where the
    window's reflog says `update by push` (a fetch that moved the ref names nothing); each is
    mapped to the repository its remote points at (the whole forge path) and the pushes outside
    the claim answer's `scope` are reported with the advance or end that finishes the leg —
    evidence the agent supplies none of, judged against the scope by Baton, never by the runner
    (§12.9: a cooperative aid, not a control).
  - **A bounded run.** `baton runner start --legs <leg,…> [--max-legs <n>] [--until <instant>]`
    claims only tickets whose queued leg is named, chains only into named legs, runs at most
    `n` legs per claim (default 8) and starts none after `until`. A move outside the grant
    suspends at `reached`. This is the runner's discipline, not a Baton gate.
  - **`no_chain_from: [<leg>…]`** on a leg (course file): Baton refuses a claim or `advance` into
    it, `not-eligible`, rule `chain`, by a **credential** that has run any named leg on this ticket
    (`claim_legs` → claim → runner → credential; a row with a null claim, an adopted run, is
    skipped; runners sharing one credential count as one) — in the same claim, or in another claim in
    an unlabelled run. A labelled run in another claim does not refuse while the credential is
    listed in this repository's `domains.per_run` and the new run is labelled too (R-BTN-180): a listed credential may review across claims what it wrote under
    another label, and never chains a writing leg into a review within one claim. The runner
    suspends instead.
- **R-BTN-107 (the executor: how a leg runs is the runner host's choice).** A CLI runner starts
  every leg, and runs every call into repository code, through its **executor**: a module with a
  versioned interface whose code the runner's host chooses. Baton is agnostic about isolation: it
  names no sandbox, VM, container or cgroup, defines no key an executor reads, keeps no ranking of
  executors, and no rule reads whether or how a leg was kept apart; that is the deployment's
  (§12.8). The runner keeps everything Baton knows of — heartbeat, claim, lease, fence, its key,
  checking every move (R-BTN-106), the leg log written from what the executor streams (R-BTN-128)
  and masking applied to those streams (R-BTN-144).
  - **The interface**, `executor_api: 1`:
    - `start({brief, executor, inputs, channel}) → handle` starts a leg session. `brief` holds the
      session's kind, the ticket, the leg, its input URIs, the hand-off document, the leg's
      instructions and its agent command (R-BTN-131), and `reads_only` as a hint (R-BTN-183) —
      never the claim id, the runner secret or a Baton credential; `executor` is the leg's
      executor data (below); `channel` is the address of the leg's channel (R-BTN-106). A
      handle may name the session's link, which the runner reports as R-BTN-113 says.
    - `stop(handle, reason)` stops the session by R-BTN-119's ladder, every process the leg
      started gone within R-BTN-145's 30 s: the guarantee is the executor's to keep.
    - `end(handle) → {status, result}` waits for the session's end; `result` is its
      ```` ```baton-leg-result ```` block, holding the channel's JSON, or the agent's last line,
      which the runner checks as R-BTN-106 checks a move.
    - `exec(handle, argv, {cwd, timeout_s, stdin}) → {status, stdout, stderr}` runs a command
      where the session runs.
    - `salvage(handle) → {sha, ref} | null` captures the session's uncommitted work (B-186; it
      returns null until B-186 is built), run before the executor tears the session's environment
      down, on every end where that environment still exists; an executor whose environment
      outlives the leg, as `builtin`'s does, may leave it to the runner.

    A leg session's handle is keyed by its run id (R-BTN-63), a refresh's by its session id
    `<run_id>.r<n>` (R-BTN-123), and any other session's by a session id the runner mints,
    `<kind>-<random>`, recorded only in the runner's log.
  - **The source is the runner host's choice**: `runner.json` `executor`, or `baton runner start
    --executor <source>`, never a repository file. A repository cannot select its own executor on
    a host configured otherwise.
    - **`builtin`** (the default, no configuration): legs are the runner's child processes, as
      its OS user, each call a detached child in its own process group (R-BTN-133), stopped by
      signals (R-BTN-119, R-BTN-145); the channel is a Unix socket (R-BTN-106). A leg can read
      the runner's state file and use its ssh-agent (R-BTN-14, R-BTN-144): `builtin` binds only
      cooperating legs. It ignores executor data.
    - **`home`**: the home's `.baton/executor.mjs` at the claim's `snapshot_sha` (R-BTN-143); for
      a session with no claim (`rank`, `source`, `sync`), at the head of the default branch the
      runner verified, as `rank.mjs` is read (R-BTN-98). It runs at the runner's level, so a host
      chooses it only where the repository and the host are one trust domain.
    - **`home-signed`**: the same file, loaded only at a commit an owner key signed (B-127's walk,
      the file among its control inputs); while B-127 is unbuilt the runner refuses to start with
      it, naming B-127.
    - **`pinned:<path>@sha256:<digest>`**: a bundle on the host, a directory whose entry point is
      its `executor.mjs`. Its digest is the SHA-256 of its canonical listing: for each regular
      file, ordered by its path relative to the bundle (`/`-separated, compared bytewise), the
      line `<path>`, a NUL byte, the file's SHA-256 in lowercase hex and a newline; a symlink or
      any other non-regular entry refuses the bundle. The runner loads it only when the digest
      matches, else refuses to start, and resolves its imports only inside the bundle and to
      Node's built-ins.

    A runner configured `builtin` or `pinned` never loads a home's `.baton/executor.mjs`, and
    logs that it ignored one once per claim. Baton's release ships two executors, loadable as
    `pinned` from the release's own copy: **`session`**, which starts one cloud session per agent
    leg through a session provider (for Claude, the remote-session API) and reports the session's
    end by its `baton-leg-result` block, and **`attached`**, which hands each agent leg back to
    the agent session hosting the runner, which reads it with `baton leg next` (blocking until a
    leg is ready) and reports on the channel. `baton runner start --sessions <provider>` and
    `--attached` select them, pinned at the running release's copy and its digest.
  - **Every call into repository code goes through `exec`**, in a session of the call's kind,
    never in the runner's own process: `leg` (the leg script's `close` and `handoff`, beside the
    `run` its `start` begins, and a course's `legs/<leg>.run.<ext>` override, R-BTN-131);
    `rank` (`rank.mjs`, wherever a runner, sidecar or launcher runs it, R-BTN-98); `source` (the
    ticket source's exports, where a runner calls them, R-BTN-74); `sync` (a course's `sync.mjs`,
    where a runner runs the sync); and `install` (the install roots' installs, R-BTN-133). The
    kind is a word in `brief`; Baton says nothing about how a session of any kind runs. A call
    that takes `ctx` is an `exec` of the wrapper (R-BTN-133), so it needs nothing beyond
    `exec`'s argv, stdin and stdout on any executor.
  - **Executor data, opaque to Baton.** A leg's `executor` in its course file (R-BTN-69) and the
    home's `.baton/baton.json` `legs.<course>.<leg>.executor` (R-BTN-51) are each a JSON object
    of at most 4 KB as serialized; the runner passes both to `start` as `{course, home}`, and how
    they combine is the executor's. Baton defines no key in it. The sync refuses a value that is
    not an object or is over the bound, naming the leg, validates both against the JSON schema
    the home's `executor_schema` names, if it names one (R-BTN-108's validator), and posts the
    course file without them, so Baton never holds executor data (R-BTN-33); the runner reads them
    at the claim's snapshot. An executor validates its own keys and treats the data as untrusted
    input: what it may grant is bounded by its host's configuration, never by the data.
  - **An executor that cannot honour a leg** ends it one of two ways. Where the leg requires one
    of the executor's `provides` names and that is what failed, `released:blocked` with kind
    `capability` and that name as `ref` (R-BTN-126): no failed attempt, and the runner states the
    name again only once its executor reports it can honour it. Otherwise the leg ends
    `released:cannot-finish:transient`, as any leg that could not start.
  - **The runner declares; Baton records and matches.** The heartbeat's `executor` is `{source,
    digest, api, provides: [<name>…]}`: `source` one of `builtin`, `home`, `home-signed`,
    `pinned`; `digest` the SHA-256 of the code loaded (absent for `builtin`); `api` the
    interface version; `provides` the capability names the executor states. `provides` are
    matched like declared capabilities (R-BTN-174) and are, like them, the runner's word: a name
    beginning `runner:` is refused `invalid-params` (those come only from the runner's own code,
    R-BTN-133), no name is derived from `source`, and no policy knob reads `source` or
    `provides` — a course may require a name, which only steers matching. Core reads `source` only
    to tell `builtin`, whose legs are the runner's children, from any other executor when it fences
    a silence reap (R-BTN-19). A capability of a type
    its course declares `"from": "executor"` counts only from `provides` (R-BTN-121).
  - **The run's record.** The `advance` that starts a run carries `executor_digest`,
    `environment` (what the leg ran on, such as an image digest; it may repeat across runs) and
    `instance` (the session's own id, unique to the run), each 1–256 characters of printable
    ASCII without spaces. Baton validates their shape (`invalid-params`), stores them on
    `claim_legs`, shows them on the run list and the Timeline, and never reads them.
- **R-BTN-123 (a leg hands off to a fresh session when its context fills).** A fresh session may
  one day ask the session it replaced about its work; that may prove useful and is not built. A
  leg may declare
  `"max_context": <fraction>` (0.1–0.95) and `"max_refreshes"` (default 3; capped by the owners'
  `retry` ceiling, R-BTN-122).
  - Context use is reported on the leg's channel (R-BTN-106) by `baton leg yield --context
    <fraction>` or `ctx.yield(fraction)`, under every executor (R-BTN-107) — the shipped
    `session` executor reports its cloud session's use there from the provider's reading.
    Nothing reported means never refreshed (logged once per session); legs under the shipped
    `attached` executor are never refreshed (logged once per leg).
  - A yield marks a point between steps and is answered `refresh: true | false`. Once the latest
    use passes the fraction, the next yield answers `true` and the runner: (1) stops the session
    — under `builtin` it fires `ctx.signal` with reason `context`, waits for `run` to return
    (result discarded) and stops the process group as R-BTN-119 does after 30 s; under any other
    executor, `stop(handle, 'context')`; (2) calls `handoff(ctx)` with `ctx.reason: 'context'`;
    (3) starts a fresh session on the same leg under the same claim, briefed with the hand-off and
    the inputs, its session id `<run_id>.r<n>` (`BATON_SESSION_ID`) — under `builtin` by calling
    `run(ctx)` again with `ctx.refresh: {n, handoff}`, under any other executor by `start` keyed by
    that session id; (4) records activity `context-handoff` with both sessions' links and session
    ids — for a session whose brief carries no claim (R-BTN-107), this record is where the session
    id lives (R-BTN-113's rule; a failing link is dropped).
  - A refresh is not a run for `max_runs`, not a failed attempt, and never lets the lease lapse.
    Past `max_refreshes` the runner suspends at the leg's `from`.
- **R-BTN-113 (a leg run carries its session's link).** A heartbeat may carry `session_url` for
  the running leg, and `advance` or `end` for the leg it finishes. It must be `https`, at most
  512 characters, without userinfo, with its host in the instance's `session_hosts` (an
  administrator's setting, default `claude.ai`), else it is dropped and logged. Stored on
  `claim_legs.session_url` (latest wins while running) and shown on Running and the Timeline;
  under an executor whose handle names its session's link (R-BTN-107), it is that link.

### 8.4 Where and how a leg runs

- **R-BTN-143 (a runner runs only code the default branch holds).** Before reading any file at a
  claim's `snapshot_sha` — `course.json`, `.baton/baton.json`, a leg script or override, a leg's
  instructions — the runner checks `git merge-base --is-ancestor <snapshot_sha>
  refs/baton/<repository>/default`, its own ref of the **registered** default branch the claim
  response names, never the checkout's `origin` configuration.
  - On failure it makes one bounded `git fetch origin <default_branch>` into that ref and checks
    again (the same one fetch R-BTN-34 makes for a missing commit); a second failure reads
    nothing and ends `released:off-branch`, which raises `baton.off-branch` with the sha and its
    `posted_by` and records a sync want (R-BTN-94).
  - A post naming an earlier head is refused `head-moved` (R-BTN-11); a never-posted older commit
    is admitted only from a poster the policy's `inputs.board` trusts — under `cooperative` whoever
    can push (R-BTN-66), under `protected` the sync credential, which posts only descendants
    (§4.3) — so the runner checks no second ancestry: Baton's record of the head is trusted
    (§12.8), and the claim response carries no `base_sha`.
  - The rule binds `baton runner start`, launchers and `baton leg replay`'s recorded sha, not
    `--against <sha>`.
- **R-BTN-133 (a leg runs in a read-only checkout of its commit).** R-BTN-143 runs first; an
  off-branch sha is never checked out or installed.
  - **Leg trees** are sparse, detached, non-cone git worktrees: the home repository at
    `snapshot_sha` with only `/.baton/` (`ctx.snapshot.tree`), and, for a sourced course, the
    source repository at its commit with only the course directory (R-BTN-134). The course
    directory (`ctx.course.dir`) is the script's module root.
  - **Layout.** The runner writes `{"private": true}` to `<git dir>/baton/package.json` (and
    refuses to start if it cannot). A tree lives at `<git dir>/baton/trees/<provider>/<namespace>/
    <repository>/<commit>-<first 12 hex of SHA-256(path)>` with stamp `<path>.ready`; the runner
    holding the home checkout lock (R-BTN-131) is its single writer. Trees are reused at the same
    key; the last 3 per repository are kept and the rest removed when a claim ends (restore write
    bits, `git worktree remove --force`, `git worktree prune`). Every runner git command passes
    `-c core.hooksPath=/dev/null -c core.fsmonitor=false`.
  - **Verified on every use**: stamp present; ancestry re-checked against the just-fetched branch
    head; clean — `git status --porcelain --ignored=matching --untracked-files=all` lists only
    the install roots' `node_modules` links. A failing tree is removed and remade; a tree
    without its stamp is never used. A symlink resolving outside the tree (other than those
    links) or a submodule entry ends `released:cannot-finish:spec` naming it.
  - **Install roots** are the course directory and the home tree's `.baton/`; one whose
    `package.json` declares `dependencies` is installed with `npm ci --omit=dev --no-audit
    --no-fund`, run by the executor's `exec` in an `install` session (R-BTN-107), and needs `package-lock.json` or `npm-shrinkwrap.json`; no `workspaces`; the
    repository root is never one. `pnpm-lock.yaml`/`yarn.lock`, dependencies without a lockfile,
    or a `file:` dependency on a directory end `cannot-finish:spec`. Install `EUSAGE` or a package
    missing from the lockfile is `spec`, `ENOSPC` is `capability`, anything else `transient`.
  - **Dependency cache** at `<git dir>/baton/deps/<digest>/`, linked as the root's
    `node_modules`; digest = SHA-256 of, newline-joined in order: the lockfile's SHA-256,
    `package.json`'s SHA-256, `process.versions.modules`, `process.platform`, `process.arch`, the
    npm version. After install its write bits are cleared and a stamp `<digest>.ready` holds the
    SHA-256 of its file list and contents, re-checked before each leg (mismatch: reinstall). A
    digest goes with the last kept tree linking it.
  - **Read-only.** After preparation the runner clears write bits on every file and directory
    (never following links), then writes the stamp. Leg caches go under a scratch directory or
    `$TMPDIR`.
  - **Preparation** (fetches, `git worktree add`, install, the write-bit walk) runs as async
    children in their own process groups under the fence: a lost lease kills them at once, a stop
    follows R-BTN-119 without `close` or `handoff`, and `--prepare-timeout <duration>` (default 15
    min) kills them and ends `released:cannot-finish:transient`.
  - **Languages.** `<ext>` ∈ `mjs js cjs mts ts cts`; Node decides the module format. TypeScript
    runs by Node's type stripping: the runner requires Node ≥ 22.18 and refuses older, naming
    the version; erasable syntax only (no `enum`, value namespaces, parameter properties,
    `import =`/`export =`); relative imports name their extension; type-only imports use
    `import type`; no `tsconfig` `paths`; dependencies ship JavaScript. Two scripts for one leg
    fail the kit and end `cannot-finish:spec`.
  - **The wrapper** `legProcess.mjs`, the CLI's own, which the executor makes available where
    its sessions run, runs every call into a script — `run`, `close`, `handoff`, a ticket source's
    exports (R-BTN-74) and R-BTN-134's `tickets`, `stations`, `rank` — as `node legProcess.mjs
    <call> <script>`, `<call>` naming the export it calls: `run` in the leg session the executor's
    `start` begins, every other call by the executor's `exec` in a session of its kind
    (R-BTN-107). It reads `ctx` as JSON from the first line of stdin (under `run`, each later
    line is an abort reason for `ctx.signal`) and writes `{ok, result | ref | url, error?,
    aborted?}` as JSON on the last line of stdout. Its cwd is `ctx.checkout`, `NODE_OPTIONS` and
    `NODE_PATH` removed; no repository code loads in the runner. Under `builtin` every call is a
    child detached in its own process group. `close` and `handoff` are bounded at 2 minutes
    each, then killed as a failure. A resolve hook (`module.registerHooks`) maps `@immediately-run/baton/leg` to the running CLI's
    module and refuses, naming the specifier, any resolution outside the claim's trees, their
    linked digests and R-BTN-134's `imports`. `LegError` is recognized by the brand
    `Symbol.for('baton.LegError')`, never `instanceof`.
  - **`@immediately-run/baton/leg`** exports `LegError`, `writeMarker`, `commentOnPr`,
    `yieldContext`, `nextFire`, `writeSuccessor`, `NOT_BEFORE_HORIZON_DAYS`, `CLI_VERSION`. It
    carries no course meaning.
  - **The `runner` capability type** (built in, beside `human-operator`, R-BTN-121):
    `runner:<feature>`, declared only by a runner from its own code (a runner config naming one
    refuses to start), counted as granted to every runner key. Values are the CLI's:
    `leg-trees`, declared also by sidecars of interactive sessions; kit and sync refuse others,
    an executor's `provides` never names one (R-BTN-107), and a course may not declare a type named `runner` or `human-operator`.
    A course lists `runner:leg-trees` in `requires` of every leg whose script is not `.mjs`,
    imports the leg module, or whose course directory or `.baton/` declares dependencies, and of
    every leg of a sourced course; kit and sync refuse it otherwise, naming the leg. Baton
    refuses a claim or `advance` by a runner not declaring a required `runner:` capability (rule
    4) and omits such legs from its recommendations.
  - **Test kit** `baton course test <repo root> <course>` loads scripts through the same wrapper
    and hook, installs each install root itself (`--omit=dev`) into its own cache and resolves
    only from there, and fails on duplicate scripts, a missing `runner:leg-trees`, or an
    unresolvable import, naming the specifier. Its CI job runs on `pull_request` with a read-only
    token, no `id-token` and no `BATON_SOURCE_TOKEN`, never on `pull_request_target`.
- **R-BTN-144 (a leg's environment, and the one list of what is masked).**
  - **The runner's own credentials.** At start the runner reads `BATON_KEY`,
    `BATON_KEY_FILE`, `BATON_TOKEN` and any API key once, keeps them in memory or its own
    0600 key file, and deletes them from its environment before loading any repository code. No
    leg, `close`, `handoff` or `rank.mjs` inherits them; `rank.mjs` too runs, by the executor's
    `exec` (R-BTN-107), with the leg environment.
  - **What a leg's environment holds.** The `BATON_*` names below are the only names: the
    transition's `IR_BATON_*` aliases were removed by the release that closed B-97 (2026-10-22),
    so the runner reads no such spelling and sets the leg markers under these names alone.

    | Variable | Value |
    |---|---|
    | `BATON_PARENT` | the CLI runner's runner id |
    | `BATON_STATE` | path of the read-only state view (no runner secret) |
    | `BATON_SOCKET` | the leg's channel (R-BTN-106) |
    | `BATON_LEG` | `<claim id>.<leg>.<run>` (R-BTN-145) |
    | `BATON_RUN_ID` | the run's `run_id` (R-BTN-63) |
    | `BATON_SESSION_ID` | `<run_id>.r<n>`: the run's session, `n` counting R-BTN-123's refreshes from 0 |
    | `BATON_ACTIVITY` | set by a launcher for a child session it starts under an activity (§9.9) |
    | `BATON_RESUME` | path of a JSON file holding earlier claimants' text — resume records, end details, hand-off documents, claim `rationale` — which reaches a leg only as data, never inside its instructions |
    | `<NAME>` for `credential:<NAME>` | present only when the leg's `requires`, after role expansion (R-BTN-121), names it; every other declared `credential:` variable is removed |
    | git, forge and model-provider credentials, `SSH_AUTH_SOCK` | kept, and masked in output (classes 4 and 7 below) |

    A course may not declare a `credential:` name that is `PATH`, `HOME`, `SSH_AUTH_SOCK`,
    begins `BATON_`, or is a variable the runner keeps; the course file is held (R-BTN-69).
  - **Masking.** Before any byte of a leg's output leaves the runner — to a leg log (R-BTN-128) or
    anywhere else — the runner replaces each exact occurrence of these with `***`:
    1. the runner secret (the claim nonce is public — markers and the mirror's claim note carry
       it — and authenticates nothing);
    2. the runner's Baton credentials (`BATON_KEY`, the contents of the file
       `BATON_KEY_FILE` names, `BATON_TOKEN`, an API key);
    3. the value of every declared `credential:<NAME>` variable, given to the leg or not;
    4. the git and forge tokens the runner holds;
    5. by pattern, every bearer prefix Baton issues — `brt_`, `bak_`, `bmcp_`, `bps_` and `bds_`
       (§12.1), and `bmo_`, `bmr_` and `bor_` (`BATON_MCP_OAUTH_SPEC` §12) — followed by
       `[A-Za-z0-9_-]*`;
    6. by pattern, every `-----BEGIN … PRIVATE KEY-----` … `-----END … -----` block, replaced
       whole: after a `BEGIN` line output is held until the `END` line or 16 KB, then the whole
       held run is masked;
    7. by name, the value of every variable of the leg's environment whose name ends `_KEY`,
       `_TOKEN`, `_SECRET`, `_PASSWORD` or `_PAT`, or is `PGPASSWORD`, each compared exactly as
       the environment spells it, and of every variable `runner.json` `mask_env` names — so a kept
       credential the runner cannot otherwise recognise, a model provider's key among them, is
       masked without core or the runner naming any provider. The set is computed once, at leg
       start, from the environment the leg is given. A non-secret that matches (a pattern in
       `GLOB_PAT`) is masked too, which costs a readable log line and nothing else.

    Masking runs on the byte stream before framing, holding back the longest literal's length
    minus one byte. A literal value under 8 bytes is not masked (logged once). An archiver
    running under a runner (`BATON_PARENT` set) masks classes 5, 6 and 7 in transcripts before
    pushing (R-BTN-20), computing class 7 from its own environment.
  - **Replay** (R-BTN-84) builds its environment from an allowlist: `PATH`, `LANG`, `TZ`,
    `TERM`, an isolated `HOME`, the read-only clone credential `runner.json`
    `replay_clone_credential` if configured, and names in `runner.json` `replay_env` or `--env`.
  - This keeps a cooperating agent's output free of every credential the runner can recognise —
    `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` by class 7 — whether the leg needed it or not;
    a credential under any other name is masked only once `mask_env` names it, and an archiver
    masks only what its own environment holds. Under `builtin` (R-BTN-107) a hostile leg can
    read the runner's key file as the same user (R-BTN-14).
- **R-BTN-145 (every process a leg starts is stopped with it).** When a leg stops — Stop, a
  release, a lost lease, the runner's exit, a supersession — every process it started is gone
  within 30 s; the executor's `stop` keeps this (R-BTN-107). Under `builtin` each leg runs with
  `BATON_LEG=<claim id>.<leg>.<run>`, and the runner signals the leg's process group and every visible process
  whose environment carries exactly that value (`/proc/<pid>/environ`), comparing start times so
  a reused pid is never signalled. Where `systemd-run --user --scope` exists each leg runs in its
  own scope, and the runner stops the scope. A process that clears its environment and leaves its group and scope survives (a hostile leg, R-BTN-46).
- **R-BTN-119 (stopping a running leg).** Baton kills nothing; it asks the runner.
  - A `release` with reason `requested` (an owner's release message, the dashboard's **Stop
    leg**, `baton leg stop`, a delegated key's `leg.stop`, R-BTN-130), `owner-cancel` (Cancel: hold plus
    release, §6) or `superseded` (R-BTN-168) reaches the runner at the doorbell's ring, else at
    its next heartbeat. For these three the runner stops the leg at once, by its executor's
    `stop` (R-BTN-107): interrupt, terminate after 10 s, kill after 25 s — under `builtin`,
    `SIGINT` to the process group and R-BTN-145's tagged processes, `SIGTERM` after 10 s, `SIGKILL`
    after 25 s.
  - It then calls `close` and, except for `superseded`, `handoff` (each in the wrapper, bounded at
    2 minutes), and ends `released:<reason>`; no output of the stopped leg is reported. A stop
    during preparation, before any leg ran, calls neither.
  - Other release reasons (`leg-timeout`, an owner bar's reason) stop at the next safe point
    (§9.4).

### 8.5 A running leg's output

- **R-BTN-128 (a leg run's output is written to the owners' log location; `baton leg log` reads it there).**
  - **Opt-in.** Owners' setting `leg_log_root` (R-BTN-66, default unset, which turns logs off):
    `s3://<bucket>[/<prefix>]` or `gs://<bucket>[/<prefix>]`, and on the local host also
    `file://<absolute path>`. The bucket matches `^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`; a prefix or
    path follows R-BTN-20's path rule. A `file:` root on the Cloudflare host, or any other form, is
    refused `invalid-params`.
  - **The run's directory.** While a root is set, each `advance` reply that starts a run carries
    `leg_log: {dir}`, where `dir` is
    `<root>/<tenant host>/<repository id>/<local ticket id>/<leg>/<run_id>/` (R-BTN-63; the prefix
    keeps tenants sharing a bucket from colliding, not from writing each other's logs: who may
    write a bucket is its owners'). `baton leg log` also reads a run written before run ids, under
    `<root>/<repository id>/<local ticket id>/<leg>/<run>-<claim id>/`. Baton records it as
    `claim_legs.leg_log_dir` and keeps nothing else about the log: no file names, sizes or
    digests. The runner writes a run only when the reply that started it named a directory.
  - **What.** Runs whose executor streams the leg's output (R-BTN-107): `builtin` does; the
    shipped `session` and `attached` executors stream none, their session's transcript being its
    log; a `"stream": false` leg writes none. The runner reads the streamed stdout and stderr and writes JSON-lines
    frames `{seq, at, stream: "stdout" | "stderr", text}`, `seq` counting from 0 across the run;
    `text` is the masked bytes (R-BTN-144) as UTF-8 (invalid bytes → U+FFFD), ≤ 8 KB per frame,
    cut between code points.
  - **Chunks.** Frames go to `<dir>/<n>.jsonl`, `n` six digits from `000000`. A chunk is written
    1 s after its first frame or at 256 KB, whichever comes first; an idle leg writes nothing.
    Every write is create-only — `If-None-Match: *` on `s3:`, `ifGenerationMatch=0` on `gs:`,
    `O_CREAT | O_EXCL` on `file:` — so no chunk is ever rewritten. When the run ends (completed,
    stopped or released), the runner writes `<dir>/end.json` last: `{claim, leg, run, run_id, chunks,
    frames, bytes, gaps, truncated, ended_at}`. A runner that dies writes no `end.json`.
  - **Credentials.** The runner writes with the credentials its own environment provides: on
    `s3:` the AWS default chain (environment, profile, web identity, instance role), with
    `AWS_ENDPOINT_URL_S3` for an S3-compatible store such as R2 or MinIO; on `gs:` Application
    Default Credentials; on `file:` the runner's user. Baton holds, mints and signs no bucket
    credential, and none passes through Baton or the runner's state file. Retention, encryption
    and who can read are the bucket's or directory's owners' (a lifecycle rule, an IAM policy).
  - **Failure.** A failed write is retried with backoff, ≤ 5 times over 10 min; up to 8 MB of
    unwritten frames are buffered, beyond which the oldest become one `{gap: <n>}` frame. A final
    failure records activity `leg-log-write-failed` and stops writing that run; it never delays or
    fails the end. At 50 MB per run one `gap` frame is written and writing stops.
  - **Trust.** Under `builtin` (R-BTN-107) a leg runs as the runner's user and can reach the
    same credentials, so it can write into its own directory: a leg log is a diagnostic, not
    evidence.
  - **`baton leg log <ticket> [<leg>] [--run n] [-f] [--transcripts] [--json]`** reads
    `GET /v1/repositories/{r}/tickets/{t}/legs/{leg}/runs` (per run: claim, runner, the
    executor digest, environment and instance, start, end, session link, `log_dir`, transcript pointers), then reads `log_dir` itself with the
    user's own credentials, found as the runner finds its own. It prints chunks in order from
    `000000` and stops at the first missing one. With `-f` on a run without `end.json` it then
    polls for the next chunk, every 1 s backing off to 10 s while none appears, and stops at
    `end.json`, or when the run record has ended and no chunk has appeared for 30 s. A missing
    `seq` prints `[gap]`. A run that streamed nothing prints its session link and transcript
    pointers, and `--transcripts` also prints the run's agent transcripts from their pointers.
    With nothing to print it prints the run record and why (no `leg_log_root`, `stream: false`,
    nothing written yet); a read failure prints the record and "cannot read `<dir>`: `<reason>`"
    and exits 1. Every path strips terminal escapes and C0/C1 controls except newline and tab.
    The dashboard shows `log_dir` as text, never as a link, and reads no log.

