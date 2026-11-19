---
title: "Proposal: checks, executors and the runner designs not built"
description: "Unbuilt designs moved out of BATON_SPEC §8, §9 and §10: check tickets, check-runners and the forge-check deliverer; the executor's Baton-side declaration, the home source, salvage and the shipped session executors; context refresh; the doorbell; grant acceptance and registration tokens; the launcher; leg trees; leg logs."
---
**Status:** proposal — not built; moves into BATON_SPEC §8, §9 or §10 when built (tickets B-184, B-186, B-12, B-8, B-46, B-47; no ticket yet builds the check-runner, which the owner ruled out on 2026-11-19)

Each part below names the rule of [BATON_SPEC §8](../BATON_SPEC/08-runners.md),
[§9](../BATON_SPEC/09-claims.md) or [§10](../BATON_SPEC/10-checks.md) it would extend. Every rule id
stays defined in its section, where the built part of the rule is stated; here it is written
`R-BTN-n (proposed)`. Where a part repeats a sentence that is built, the section's statement is
the rule.

## 1. Checks (§10)

Built, and stated in §10: the owners' `checks` map (R-BTN-114) and the `exit_status` an arrival at
a mapped station carries (R-BTN-153). The rest of the design follows as it was written. The owner
ruled on 2026-11-19 that the check-runner and the forge-check deliverer are not to be built as
designed and that their built parts are to be removed.

A check course runs a repository's merge checks in place of a CI service. Baton schedules the
check, a check-runner runs a command against the change's head, and a runner that holds the
check App's key posts the verdict to the forge, whose branch protection is the gate. A check is as trustworthy as the
registered check-runner keys, the executors their legs run under and the check command on the default branch:
the change under test decides its command's exit status, which is what a test is, and cannot
print its way to `success`.

- R-BTN-114 (proposed): check courses: check tickets and check-runners.
  - **Check tickets.** The `changes` ticket source, a CLI default beside R-BTN-74's, runs in
    `baton repo sync`, lists the forge's open changes through the sync's forge reads (on GitHub,
    the open pull requests) and posts one ticket per change, id `check.<course>.<number>`, with no
    file. Each carries the core field `check: {sha, head_repo_id, head_ref}`, all filter fields;
    `head_ref` is a `refs/heads/*` name.
    - Baton drops a check ticket whose `head_repo_id` is not the repository's `forge_repo_id`
      (R-BTN-138), so a fork's change is never a check ticket, and drops every check ticket while
      the repository has no stored ids.
    - A post that changes `check.sha` supersedes every claim on the ticket (released `superseded`,
      R-BTN-168), and the ticket restarts at its start station on the new head; a completed
      claim on the old sha still unconfirmed is marked `superseded_at` and no longer holds the
      ticket (R-BTN-168), so a push right after a check ends never wedges the next one. A
      change the source stops posting is superseded (R-BTN-168).
    - A webhook or forge notification only triggers the sync (R-BTN-73, R-BTN-95).
  - **Check-runners.** A check-runner is a key role of its own (§12.1). A repository's owners
    register one with `baton owner check-runner add <repository> <key> --name <hostname>
    [--capabilities …] [--max-tier <t>]` (R-BTN-127; `POST /v1/owner/{repository}/check-runners`, stored in `check_runners`)
    and revoke it with the destructive `owner.check-runner.revoke`.
    - The `check_runners` row stands in for a grant: rule 7 reads it for a check ticket, rule 4
      its `capabilities` and rule 5 its `max_tier`. The hostname binds at `add` and is the name
      the key heartbeats under (R-BTN-3). A check-runner heartbeats, claims, advances and ends
      check tickets and reports activities and transcripts and writes leg logs, as any runner does.
    - Only a check-runner claims or advances in a check ticket, and a check-runner claims nothing
      else. Baton holds this at every claim and every `advance` (`not-eligible`, rule
      `check-runner`), so the key that wrote a change never reports its check.
  - **Withheld credentials.** A check leg's session holds no write-capable credential or
    secret, as replay's environment holds none (R-BTN-84). Every check leg lists
    `checks:withheld-credentials` in `requires`, of a type its course declares `"from":
    "executor"` (R-BTN-121), so only a runner whose executor `provides` it takes one (rule 4;
    R-BTN-107) — never one that declares it from `runner.json` `capabilities` or the grant
    (R-BTN-72), and so never a `builtin` runner — and with no such runner live the leg carries a
    `capability` block (R-BTN-75). Checks run only changes from the
    repository's own branches, never a fork's: a leg's logic cannot be both generally useful and
    a sandbox for strangers' code.
  - **Conclusions are the owners'.** The owner setting `checks: {<course>: {name,
    conclusions: {<end station>: "success" | "failure" | "timed_out"}}}` (R-BTN-66) maps end stations to
    conclusions, so no edit in git turns `failed` into `success`. Every conclusion but `success`
    fails a GitHub required check (checks are GitHub only, R-BTN-115): `neutral`, which a required
    check passes, is not in the set. A course's map names exactly one end station `success`, exactly one
    `failure` and at most one `timed_out`, or `PUT /v1/owner/{repository}/settings` refuses it
    `invalid-params`. A change that maps a station to `success` that was not, or removes or
    renames a course's entry, is a loosening (R-BTN-186), since a conclusion decides what branch
    protection sees; any other change is a tightening. A course file carries no `checks`
    (R-BTN-69); `baton course test` prints a check course's end stations for the owners to map.

- R-BTN-153 (proposed): a verdict is a command's exit status, from the check-runner's confirmed end.
  - **A check claim is bound to its sha.** The claim records `claims.check_sha` and returns it
    with `check_head_ref`; the runner checks out exactly that commit. Every `advance` carries
    `head_sha` equal to it, or is refused `head-moved`.
  - **The command.** A verdict leg is a check course's leg that can reach a station mapped to
    `success`. Its `check_command` in the course file (R-BTN-69) is an argv with `timeout_s`
    (default 1800, at most 7200). The runner reads both from `course.json` at the head of
    `refs/baton/<repository>/default` it fetched for the claim (R-BTN-143), never from an older
    `snapshot_sha`, so a post cannot run a check on a weaker historical command.
    1. The runner checks that `check_sha` is the head of `check.head_ref`, so a `refs/pull/*`
       commit cannot pass as the branch's. When the branch has moved, the claim ends
       `released:stale-board`, not a failed attempt, and Baton records a sync want (R-BTN-94).
    2. It runs the command **first**, in the leg's session checked out at `check_sha`, before
       any agent touches that session, by the executor's `exec(handle, argv, {cwd, timeout_s})`
       (R-BTN-107), reading its `status`.
  - **Mapping the status.** Status 0 reaches the station mapped to `success`; any other status
    the one mapped to `failure`; a timeout or an `exec` error the one mapped to `timed_out`, or
    to `failure` where the map names no `timed_out`. An
    `advance` or end reaching a success-mapped station carries `exit_status: 0`, which Baton
    requires. In a check course an agent's `baton-leg-result` or channel `done` (R-BTN-106) may
    reach only `failure` or `timed_out` stations. A check course's `min_runner_version` is at least
    the runner release that implements this rule.
  - **The conclusion is the confirmed end.** Baton queues a concluding `forge-check` entry
    (R-BTN-115) only for an ordinary claim, held by a check-runner, that ended `done` at a
    `reached` the owners' `conclusions` map, confirmed (R-BTN-10) by a post showing the ticket at
    that same `reached` with `check.sha` equal to `claims.check_sha`, the station's entry
    requirements met and its pointers valid (R-BTN-109).
    - The conclusion is the owners' mapping of the end's own `reached`, never of a posted
      station.
    - Anything else concludes nothing and raises `baton.check-unattested`; the change stays
      pending, so the gate fails closed.
    - A check ticket's first claim queues an entry with conclusion `in_progress`.

- R-BTN-115 (proposed): the forge-check deliverer and `forge-check` entries. Baton sends no mail and
  calls no service but a workflow dispatch (R-BTN-94). `forge-check` is the outbox's one kind written to the forge outside git (R-BTN-171), delivered by a
  runner the policy's `outbox.forge-check` admits (R-BTN-188).
  - **The forge-check deliverer** is a runner that declares `delivers: [forge-check]` (R-BTN-171).
    - It holds the dedicated **check App**'s private key on its own host; Baton holds no
      credential of the check App, so the merge check is a gate Baton itself cannot satisfy. A
      check App serves one tenant. Its runner is not the merge runner — a host that can merge
      must not be able to post the check the merge waits on: a runner that declares `forge-check`
      is offered no trusted leg on any repository its grants cover, and a runner any of whose
      grants has claimed a trusted leg may not declare it (`invalid-params` at the heartbeat); that
      their hosts differ is the
      deployment's (§12.8).
    - At start, and again at each delivery, it lists the App's installed repositories with the
      App's key and refuses to deliver for one that is not a repository its grant covers, or when
      the installation covers "All repositories".
  - **The entry.** Its `fields` are `{origin, forge_repo_id, sha, name, conclusion, summary, seq,
    issued_at}`, where `sha` is the claim's `check_sha`, `name` the owners' check name, and
    `summary` rendered `plain` from the end station's outputs (R-BTN-112).
  - **Lifecycle** is R-BTN-171's. A delivered `forge-check` entry is deleted after 7 days.
  - **Delivery.** The deliverer refuses an entry whose `origin` is not its configured origin, or
    whose `forge_repo_id` is null or not the target repository's. It writes `<repository>:<id>` to
    the check run's `external_id`, the entry's `seq` into its output, and `summary` inside a code
    fence one backtick longer than any backtick run in it, never as Markdown. The conclusion
    posts as GitHub's check-run conclusion of the same name.
    - `seq` increases per `(repository, sha, name)`; the deliverer posts only the highest it has
      claimed and drops older ones. Before posting it also reads the sha's check runs of that
      name and skips its entry when one carries a higher `seq`, so neither a second deliverer nor
      a worker that stalled past its lease posts an older entry over a newer one; a late
      `success` never overwrites a newer `failure`.
    - An entry for a superseded head is still delivered: the forge ties it to its sha.
  - **Read back.** The sync reads the change's check runs and posts them. A run by the check App
    (the instance's `check_app_id`, §12.7, handed to the sync with its observation) on that head that matches its entry confirms it
    (R-BTN-171). A run by that App with no
    entry Baton issued, or whose conclusion differs from it, or a newest run of a name
    on a head that is not the highest-`seq` entry already marked `delivered` for it, is the
    discrepancy `check-mismatch` (R-BTN-85) and raises `baton.check-mismatch`; for a stale newest
    run Baton also re-queues the highest entry. A deliverer can withhold; it cannot post a success
    Baton did not issue unseen.
  - **A `std:checks@1`**, optional. A check-runner (R-BTN-114) whose key the owner names in the
    policy's `attestations` entry for `std:checks@1` (R-BTN-188) may also post the verdict as
    that attestation, as its `service:` key, for a repository whose merge check is not a forge
    check run; the forge's own check runs from the protected default branch suffice without it
    (R-BTN-183).
  - **The gate is the forge's.** Branch protection requires the check by name **and** by the
    check App's id — never Baton's own App (§12.7) — so neither a status any token could post
    nor Baton itself satisfies it. Checks are GitHub only, until GitLab or Gitea offers a status
    that only one identity can post.

## 2. The executor (R-BTN-107, proposed)

Built, and stated in §8.3: the interface (`start`, `exec`, `stop`, `end`, and a `salvage` that
returns null), the `builtin` and `pinned` sources, and every call into repository code going
through `exec`. A runner started with `--executor home` refuses to start. Baton's server records
nothing about an executor: a heartbeat carries no `executor` and an `advance` no
`executor_digest`, `environment` or `instance`. As designed, `brief` also holds the leg's input
URIs, the hand-off document, the leg's instructions and its agent command (R-BTN-131), and how the
session reads its leg events (R-BTN-198); and `end`'s `result` is the session's
`baton-leg-result` block or the agent's last line, which the runner checks as R-BTN-106 checks a
move.

### 2.1 `salvage`

- `salvage(handle) → {sha, ref} | null` captures the session's uncommitted work (B-186; it
  returns null until B-186 is built), run before the executor tears the session's environment
  down, on every end where that environment still exists; an executor whose environment
  outlives the leg, as `builtin`'s does, may leave it to the runner.

### 2.2 The `home` source

- **`home`**: the home's `.baton/executor.mjs` at the claim's `snapshot_sha` (R-BTN-143); for
  a session with no claim (`rank`, `source`, `sync`), at the head of the default branch the
  runner verified, as `rank.mjs` is read (R-BTN-98). It runs at the runner's level, so a host
  chooses it only where the repository and the host are one trust domain.

### 2.3 The shipped `session` and `attached` executors

A runner configured `builtin` or `pinned` never loads a home's `.baton/executor.mjs`, and
logs that it ignored one once per claim. Baton's release ships two executors, loadable as
`pinned` from the release's own copy: **`session`**, which starts one cloud session per agent
leg through a session provider (for Claude, the remote-session API) and reports the session's
end by its `baton-leg-result` block, and **`attached`**, which hands each agent leg back to
the agent session hosting the runner, which reads it with `baton leg next` (blocking until a
leg is ready) and reports on the channel. `baton runner start --sessions <provider>` and
`--attached` select them, pinned at the running release's copy and its digest.

`baton leg next` is the channel verb the `attached` executor's hosting session reads its legs
with. Legs under `attached` are never refreshed (part 3).


### 2.4 Executor data

- **Executor data, opaque to Baton.** A leg's `executor` in its course file (R-BTN-69) and the
  home's `.baton/baton.json` `legs.<course>.<leg>.executor` (R-BTN-51) are each a JSON object
  of at most 4 KB as serialized; the runner passes both to `start` as `{course, home}`, and how
  they combine is the executor's. Baton defines no key in it. The sync refuses a value that is
  not an object or is over the bound, naming the leg, validates both against the JSON schema
  the home's `executor_schema` names, if it names one (R-BTN-108's validator), and posts the
  course file without them, so Baton never holds executor data (R-BTN-33); the runner reads them
  at the claim's snapshot. An executor validates its own keys and treats the data as untrusted
  input: what it may grant is bounded by its host's configuration, never by the data.

### 2.5 A leg the executor cannot honour

- **An executor that cannot honour a leg** ends it one of two ways. Where the leg requires one
  of the executor's `provides` names and that is what failed, `released:blocked` with kind
  `capability` and that name as `ref` (R-BTN-126): no failed attempt, and the runner states the
  name again only once its executor reports it can honour it. Otherwise the leg ends
  `released:cannot-finish:transient`, as any leg that could not start.

### 2.6 The declaration and the run's record

- **The runner declares; Baton records and matches.** The heartbeat's `executor` is `{source,
  digest, api, provides: [<name>…]}`: `source` one of `builtin`, `home`,
  `pinned`; `digest` the SHA-256 of the code loaded (absent for `builtin`); `api` the
  interface version; `provides` the capability names the executor states. `provides` are
  matched like declared capabilities (R-BTN-174) and are, like them, the runner's word: a name
  beginning `runner:` is refused `invalid-params` (those come only from the runner's own code,
  R-BTN-133), no name is derived from `source`, and no policy knob reads `provides` — a course may
  require a name, which only steers matching. Core reads `source` only to tell `builtin`,
  whose legs are the runner's children, from any other executor, when it fences a silence reap (R-BTN-19). A capability of a type
  its course declares `"from": "executor"` counts only from `provides` (R-BTN-121).
- **The run's record.** The `advance` that starts a run carries `executor_digest`,
  `environment` (what the leg ran on, such as an image digest; it may repeat across runs) and
  `instance` (the session's own id, unique to the run), each 1–256 characters of printable
  ASCII without spaces. Baton validates their shape (`invalid-params`), stores them on
  `claim_legs`, shows them on the run list and the runner page (§11.4), and never reads them.

The heartbeat also carries `delivers`, the outbox classes the runner delivers (R-BTN-171).

### 2.7 The fence under an executor other than `builtin` (R-BTN-19, proposed)

A session under an executor other than `builtin` may make no lease checks of its own. So every
reap of a claim running a leg under such an executor is fence-pending, a silence reap included,
and the runner reports `fenced` for it only once the executor's `stop` has returned. An
administrator's clear of such a fence gives up protection until the executor's `stop` returns.
A session the runner cannot reach before `fence_deadline` is not fenced: its later pushes are not
noticed (R-BTN-46), and the next claimant re-reads git before it writes (R-BTN-25).

## 3. Context refresh (R-BTN-123, proposed)

- R-BTN-123 (proposed): a leg hands off to a fresh session when its context fills. A fresh session may
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

## 4. The doorbell (R-BTN-91, proposed)

- R-BTN-91 (proposed): the doorbell: a ring, while the heartbeat stays the truth. A runner may hold a
  WebSocket, `GET /v1/runner/push?session_name=<name>`.
  - The upgrade is authenticated as a heartbeat: signed by the machine key with the query in
    the signature (or its API key), carrying `X-Runner-Secret`; refusals (`unauthenticated`,
    `forbidden`, `session-taken`, `runner-reaped`) replace the upgrade. One socket per runner; a
    new one closes the old.
  - Baton sends `{ring: [<kind>]}` after the transaction that queued something commits; kinds
    are `release`, `status_request`, `wind-down` (B-109), `unblocked` and `handled` (R-BTN-162),
    `facts` to a fact reader (R-BTN-192), `outbox` to a runner that delivers the class
    queued (R-BTN-171), and `ticket` to the holder of a ticket whose version moved (R-BTN-198). The runner heartbeats at
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

## 5. Grant acceptance, span and registration tokens (R-BTN-146, R-BTN-117, proposed)

Built: a grant is active from its creation, and `GET /v1/owner/{repository}/grants` lists a
repository's grants.

- R-BTN-146 (proposed): a grant takes effect when the key's holder accepts it; a key on several
  repositories syncs only where each opts in.
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
- R-BTN-117 (proposed): registration tokens. A repository owner mints a token for a session that has
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

A machine key's sync (R-BTN-102) is then forbidden where its span forbids it. A machine-key post
that closes a ticket another runner holds, drops a posted bar, or loosens an author's gate (lowers
a tier, drops a `requires` clause, removes a `ticket` block or a decision) raises
`baton.machine-post` naming the tickets and the key; it is noticed, not stopped.


## 6. The leg's channel verbs and the bounded run (R-BTN-106, proposed)

Built: `baton leg raise` and `baton leg done`. The full set:

wrapped by the CLI. Verbs act on that leg only and exit 2 "not inside a leg" elsewhere:
`baton leg status` (leg, grant, deadline, `refresh`);
`baton leg output <name> --uri <uri> [--digest …] | --value <json>`;
exactly one ending — `baton leg done --reached <station> --next <leg>`,
`baton leg suspend --reached <station>`, `baton leg release --reason <reason>`, or
`baton leg release --blocked --kind <kind> --ref <ref> […]` (R-BTN-126);
`baton leg yield [--context <fraction>]` (R-BTN-123);
`baton leg raise`, `baton leg await` (R-BTN-160, R-BTN-162);
`baton leg events`, `baton leg ticket` (R-BTN-198);
`baton leg next` (the `attached` executor, R-BTN-107).
A script may return its result directly instead. The channel carries these verbs and nothing
else: a raw `advance` or `end`, or a run's `executor_digest`,
`environment` or `instance` (R-BTN-107) sent on it is refused — the runner reports those
itself.

- **A bounded run.** `baton runner start --legs <leg,…> [--max-legs <n>] [--until <instant>]`
  claims only tickets whose queued leg is named, chains only into named legs, runs at most
  `n` legs per claim (default 8) and starts none after `until`. A move outside the grant
  suspends at `reached`. This is the runner's discipline, not a Baton gate.

## 7. The launcher (R-BTN-201, proposed)

- R-BTN-201 (proposed): a launcher starts sessions; Baton reserves nothing for them. A **launcher** is
  a process outside Baton, run by the deployment, that starts runner sessions when there is work
  for them. It reads `GET /v1/runner/launch-candidates` (R-BTN-99) with a machine key, orders them
  by the course's `rank.mjs` with `runner: null` (R-BTN-98), and starts each session it decides
  on by whatever its host offers — a provider's session trigger, a VM, a process — handing the
  session, as a hint, the ticket and leg it ranked first. Baton records no launch.
  - **The launcher bounds itself.** It keeps its own record of the starts it made whose session
    has not yet claimed, and launches again for a candidate only after that record expires; it
    bounds its concurrent starts by its host's limits, which Baton does not know. It runs
    `rank.mjs` as R-BTN-98 says, through an executor, never in the process that holds its start
    credentials.
  - **The session decides.** The started session's runner reads the hint as a ticket id and a
    leg alone, and never hands it to the agent; it claims with `prefer` naming that ticket
    (R-BTN-100) and, refused, claims what else it is offered, or ends. Nothing is reserved for a
    launch, and a hint is never a grant.
  - **The lease stops it.** A launcher needs no way to stop a session: a session whose lease
    lapses — ended, paused by its host or lost — is fenced (R-BTN-6) and reaped (§9.5).
  - **Credentials stay with the launcher.** The launcher holds what its starts need, Baton none
    (R-BTN-53). Where the agent in a session can read the session's runner key, as in a hosted
    agent session, that key is an API key (R-BTN-159), so the session never syncs or delivers,
    and its grant is `runner`, never `trusted-runner` (R-BTN-182), on the repositories the
    deployment scopes it to.
  - **A session its host may pause.** Its runner declares the lowest lease timeout (R-BTN-9). A
    leg there that needs a person raises `suspend` with `wait_s: 0` (R-BTN-162), so its claim
    ends suspended at once (R-BTN-71), and never `interact`, whose session stays running for the
    person (R-BTN-195).

## 8. Leg trees (R-BTN-133, proposed)

Built, and stated in §8.4: the wrapper, its bounds, and the `runner` capability type. Today a
leg's script is an `.mjs` file. The whole rule as designed:

- R-BTN-133 (proposed): a leg runs in a read-only checkout of its commit. R-BTN-143 runs first; an
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

## 9. Stopping what leaves the process group (R-BTN-145, proposed)

Built: `builtin` kills the process group of every call of a leg. The design also tags and scopes
the leg's processes, with the leg environment's `BATON_LEG=<claim id>.<leg>.<run>`:

within 30 s; the executor's `stop` keeps this (R-BTN-107). Under `builtin` each leg runs with
`BATON_LEG=<claim id>.<leg>.<run>`, and the runner signals the leg's process group and every visible process
whose environment carries exactly that value (`/proc/<pid>/environ`), comparing start times so
a reused pid is never signalled. Where `systemd-run --user --scope` exists each leg runs in its
own scope, and the runner stops the scope. A process that clears its environment and leaves its group and scope survives (a hostile leg, R-BTN-46).

## 10. Leg logs (R-BTN-128, proposed)

Built: the column `claim_legs.leg_log_dir`, and the masking of a leg's output (R-BTN-144).

- R-BTN-128 (proposed): a leg run's output is written to the owners' log location; `baton leg log` reads it there.
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
