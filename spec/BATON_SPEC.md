---
title: "Baton — ticket leases, runners and the live factory view on a Cloudflare Durable Object"
status: proposal
updated: 2026-10-22
---

# immediately.run Baton — the factory's live state, off git

**Status:** proposal — Baton's specification as it stands. How it got here — dated
amendments, rationale, retired requirement ids and the map from the old section numbers — is
in [`spec/BATON_SPEC_HISTORY.md`](BATON_SPEC_HISTORY.md).

**Updated:** 2026-10-22

> **Companions.** History: `spec/BATON_SPEC_HISTORY.md`. The reference deployment — docs and
> its `roadmap-pr` course, the first repository Baton served — is in docs'
> `BATON_DOCS_DEPLOYMENT` (its cutover rows and code anchors) and `BATON_ROADMAP_PR_COURSE`
> (the course's own logic and gates); where this spec names docs, it is an example, not core.
> Tickets cited as `R3-n` and `B-n` are in [`tickets/`](../tickets/). Requirement ids
> `R-BTN-n`, scenario ids `S-BTN-n` and gate ids `G-BTN-n` are stable: code, tests and the
> Quint model cite them.

## Contents

| § | Title | What it settles |
|---|---|---|
| 1 | What Baton is | git as the home of facts, Baton as the lease and the limits; the core's vocabulary; no repository code |
| 2 | Deployments: tenants, hosts and the service | one Durable Object per tenant, the alarm, the two hosts, tenancy, capacity and admission |
| 3 | Repositories and forges | registration, forges and their ids, sync credentials, wants and notifications |
| 4 | Tickets, syncs and the board | ticket sources, the board post, observations, snapshots, discrepancies, child tickets |
| 5 | Courses | the course file, stations and legs, positions, contracts, sources, the standard courses, the capability ontology |
| 6 | Prerequisites, blocks and advice | blocks, resources and readings, matching rules, expedite and hold, messages, route choices, seats |
| 7 | Conditions | conditions, handlers and restarts, retries, calls, choices, timers, compensation, the outbox |
| 8 | Runners | identity, heartbeats, the runner and its legs, registration, streaming, the doorbell |
| 9 | Claims | the fenced lease, advancing, ending, reaping, confirming, attempts, activities |
| 10 | Checks | check courses and the forge courier |
| 11 | People: administrators, owners and their surfaces | administration, grants, the CLI, MCP, sign-in, the dashboard |
| 12 | Security | principals, signatures, untrusted text, same-site, hardening, the core guarantee |
| 13 | Data model | the current schema |
| 14 | API | every route |
| 15 | Verification: the model, the harness, scenarios and gates | the Quint model, integration and load tests, every scenario and gate |
| 16 | Adoption | cutover, the reference deployment's rollout, the git mirror |
| — | Decisions | each decision still in force, one line |
| — | Open questions | what is not yet settled |
| — | Load-bearing assumptions | where the code anchors live |

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
  | ticket files, bodies, Status notes, ids, statuses; tags such as `EXPEDITE` | each live ticket's filter fields (R-BTN-33) and its position, replayed from git as a cache (R-BTN-39) |
  | leg evidence: commits, branches, PRs, checks, reviews, markers, hand-off documents, a person's answers | claims, leases, activities, history, events |
  | `.baton/`: courses, ticket source, station functions, ranking code, condition bindings; course data | the course registry and each course's opaque data, as posted |
  | transcripts | pointers to them |
  | | runners, messages, readings; keys, grants, owners, settings, bars (R-BTN-66); overrides; conditions, timers and the outbox (§7) |

- **R-BTN-33 (Baton holds filter fields, never content).** Per live ticket Baton stores what
  matching (§6) and the dashboard's lists read: id, title, path, course, tier, `requires`,
  expedite, `depends_at`, `parent`, `repos`, rank, the posted position (R-BTN-70), and an
  opaque `display` object core never reads. It never stores a body, Status notes, exit
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
    so it cannot stop a course from putting prose in one; doing so breaks this rule, and the
    CLI's default sources and standard station functions post no prose in them.
- **R-BTN-35 (the home repository wins).** *Except what Baton owns: course history (B-120) and attestations (R-BTN-181, proposal).* When Baton and git disagree, git is authoritative:
  every ticket fact Baton holds is a cache of the head snapshot, which Baton never edits. A
  runner acts on the ticket as `origin/<default branch>` has it (R-BTN-5, R-BTN-34); the next
  accepted snapshot overwrites the row; **Resync** forces one.
  - **Staleness.** A snapshot observed after a claim's latest claim or `advance` (R-BTN-62)
    that shows the held ticket `closed` as `withdrawn`, or re-tiered above the holder's
    ceiling, ends the claim `released:stale-board` with a `release` to the holder. A held
    ticket dropped without `closed` is R-BTN-147's.
  - **Progress is not staleness.** A station or path lagging the holder, a ticket shown done,
    or a station or leg the course file lacks (R-BTN-64) leaves the claim alone.
  - **Regression.** A path shorter than the previous accepted snapshot's or the claim's
    `start_path` sets `regressed_since`; the heartbeat's `git` carries `regressed: true` and
    the posted path; at 30 minutes Baton raises `baton.regressed`; the runner aborts the leg
    and suspends (R-BTN-72). It clears when a later path extends the expected path again, and
    at the claim's end. Baton acts on nothing else.
  - A ticket gone from git loses its `tickets` row; its claims and events stay. The one fact
    Baton owns outright is the live lease (R-BTN-4).
- **R-BTN-39 (where a ticket is, replayed from git).** Each course's pure station function
  (`locate`, its `sync.mjs`, R-BTN-74), run by the sync, computes each ticket's station, path,
  queued leg, next legs and output pointers (R-BTN-70, R-BTN-82, R-BTN-83) from git alone.
  Baton caches the result; on any conflict Baton is disregarded. Between two snapshots a path
  extends by course-file edges in order or goes backwards; anything else logs `off-graph`.
- **R-BTN-8 (git first).** For every `completed` end, `suspended:` included, the runner pushes
  the leg's evidence and hand-off first and may pass `ended_at_sha` (a commit sha, or the URL
  of the comment or review that ended the leg); confirmation (R-BTN-10) does not depend on it.
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
- **R-BTN-46 (gates bind cooperating runners; overlaps are noticed, then git wins).** Baton
  cannot refuse a push, comment or status write, and checks no commit or signature (under
  `landing: protected`, trusted runners check both: R-BTN-181, R-BTN-183); fencing
  (§9) catches mistakes, not an uncooperative runner. Baton notices overlap instead: every
  `baton:` marker carries `claim=<nonce>`; the sync posts trusted authors' markers (R-BTN-139)
  on live tickets' PRs; Baton keeps refs seen in `markers_seen`. A new marker whose nonce names
  no claim on that ticket active at or after the previous accepted snapshot's observation logs
  `foreign-write` and raises `baton.foreign-write` (a repository's first accepted snapshot only
  seeds `markers_seen`). Baton reverts nothing; the holder re-reads git before pushing again.
- **R-BTN-53 (instruments hold the secrets; Baton stores what they report).** What a course
  needs and cannot learn from git — a provider's remaining quota, a service's health — is
  learned outside Baton by a runner or an instrument key with its own secrets and posted as
  readings (R-BTN-101). Secrets never enter Baton. A reading nobody renews lapses to `unknown`,
  which never blocks (R-BTN-76).
- **R-BTN-50 (core acts only on its own vocabulary).** `src/core/` may name only:

  | Concept | Core |
  |---|---|
  | repository, ticket, course id and version | registers, keys, matches declaring runners |
  | station, leg, a ticket's station and path, leg state and `waiting_on`, run count; choice station, timer, call leg | validates course files, leases a run of legs, checks edges, recommends, arms, settles, fires |
  | runner, capability, tier, tag; lease, fence, reap, attempt, backoff, hold, expedite, suspension | the safety gates and the default order |
  | grant, owner, administrator, credential | who may do what |
  | block, `depends_at`, resource, instance, a reading's envelope, a leg's `needs` | keeps rows, answers queries, gates or advises (R-BTN-75) |
  | condition (type, disposition, restart, binding, handler), supersession, compensation, outbox entry | records, routes, resumes (§7) |
  | a claim's billings, preference list, provisional claim and its settlement | counts, takes the first passing, settles (R-BTN-100, R-BTN-104) |
  | holding, ontology, derived capability; route choice, alternative, need, guard, advice, route; a reading's typed fields | validates and evaluates the program, derives, resolves, delivers, records (R-BTN-174 to R-BTN-177) |
  | opaque blobs (course data, course fields, profile, reports, a reading's `detail`, `rationale`, an output value); hand-off, resume record, input and output pointers | stores and returns, validated against a named schema; never reads, except that a reading's `detail` forms R-BTN-176's typed atoms, uninterpreted |

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
  replace or fortify git's security model: whoever can push, or is in `trusted_identities`
  (R-BTN-139), is a legitimate user of this tenant (R-BTN-137); people without push are not.
  What is computed from git binds only as strongly as git, and so does a ticket's identity: a
  hold or cancel binds a ticket id, and an agent that re-files the work under a new id escapes
  it (R-BTN-12 states the residual risk and how owners see it). Every limit owners hold against
  agents is Baton state, set only by an owner's or administrator's key, never read from git and
  never writable over MCP (R-BTN-130): keys, grants and capabilities (R-BTN-58); holds,
  cancels, expedite (§6); cutover (R-BTN-28); and per repository:
  - by owners: `owner_bars`, `required_bars` (R-BTN-67), `retry` (R-BTN-122),
    `unblocked_trigger` (R-BTN-77), `transcript_repos` (R-BTN-20), `leg_log_root` (default unset,
    R-BTN-128), `artifact_buckets` (R-BTN-82), `api_keys` (default `true`, R-BTN-117), `required_independence` (R-BTN-106),
    `checks` and `check_runners` (R-BTN-114), `outbox_policy` (R-BTN-171), `trusted_identities` (R-BTN-139), `code_repos`
    (with the named repository's consent, R-BTN-140), `machine_sync` (default `true`,
    R-BTN-102) and each grant's `sync` flag (R-BTN-146); `landing`, `authorship`, each grant's
    trust level, trust domain, model family and role, and `protected_paths` (R-BTN-180,
    R-BTN-183, R-BTN-184);
  - by the administrator: `tiers` (at registration, R-BTN-58), `weight` (R-BTN-61),
    `trigger_workflows` (R-BTN-94).

  The rest stays in git, where agents may improve it: course files, condition bindings
  (R-BTN-161), `branch_pattern`, `report_horizon_h`, `min_runner_version`, station functions,
  ranking code. Under `landing: protected` those are protected paths, changed only by a human
  (R-BTN-184).
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

## 2. Deployments: tenants, hosts and the service *(partly built — B-45, B-46)*

A **tenant** is one Baton: one origin, one Durable Object with SQLite, its administrators and
everything they govern. The same code runs on Cloudflare in production and as a local Node
process for development and CI. Nothing crosses a tenant.

### 2.1 The service

- **One Worker, one Durable Object.** The Worker routes every request for the tenant's origin
  to the tenant's object. The object runs one request at a time between awaits; its SQLite
  calls are synchronous and its writes transactional, so every step that does not await is
  atomic without a lock.
  - A request awaits only to verify its signature (WebCrypto), before it reads anything.
    Claim and `advance` are decided in one synchronous transaction after that check.
  - The Worker fetches CI identity key sets and verifies CI tokens, App deliveries and forge
    notifications before forwarding; every key's signature, a sync key's included (R-BTN-93),
    is verified inside the object.
  - Outbound calls (dispatches, R-BTN-94) are sent after commit with `waitUntil`, never
    awaited by a request.
  - A claim's repeated `request_id` returns the first request's committed result (G-BTN-2);
    `claims.request_id` is the only stored request id. Every other write is safe to retry by
    its own key: a repeated end is `ok` (§9.4), owner and administrator writes set a value, a
    repeated board post is `stale-observation` (the sync then reads `GET /v1/sync/wanted`'s
    `head_sha` to learn whether its post landed), and a repeated raise or report finds its row.
- **One alarm, every 60 seconds**, also set early to the earliest instant Baton holds. It fires
  every due instant, each with the effect its owning rule gives:

  | Instant | Rule |
  |---|---|
  | a runner's `last_seen_at` + lease timeout: reap; a delivered `release` unacknowledged for 2 hours (15 minutes for `leg-timeout`): reap with a fence; message expiry | R-BTN-9, R-BTN-90, §9 |
  | an unconfirmed completion's flag time | R-BTN-10 |
  | a timer's `due_at`, a choice leg's `after_s`, a `not_before`, a `cancel_at`, a leg's `retry_after` | R-BTN-167, R-BTN-166, R-BTN-89, R-BTN-90, R-BTN-122 |
  | an owner bar's `starts_at` and `ends_at` | R-BTN-67 |
  | a reading's `lapses_at` | R-BTN-76 |
  | the end of an idle runner's liveness for `fleet_capabilities` | R-BTN-75 |
  | a coalescing window's end: trailing dispatch, unblocked trigger and ring | R-BTN-73, R-BTN-77, R-BTN-91 |
  | an outbox entry's lapsed lease, backoff or age | R-BTN-171 |
  | retention: `request_nonces` after 11 minutes, `webhook_deliveries` after 24 hours, R-BTN-149's 90-day prunes | R-BTN-13, R-BTN-73, R-BTN-149 |
  | a capacity figure crossing 80% | R-BTN-87 |
  | an alarm cycle while any live granted runner's derived set is not current; `route_last` rows after 24 hours; a non-live runner's `runner_derived` rows after 30 days | R-BTN-174, R-BTN-177 |
  | a fence-pending reap's seats at `fence_deadline` | R-BTN-178 |
  | a held snapshot's `auto_accept_at`: accept the repository's newest held row (sets `accepted_at`; never moves the head) | R-BTN-11 |
  | any other instant a rule stores, such as an outbox entry's 24 hours | its rule (R-BTN-171) |

- **Code.** Baton's code lives in `immediately-run/baton`: the Worker, the Durable Object,
  numbered schema migrations (append-only; the object refuses to serve until all are applied),
  the wrangler configuration and the integration harness, deployed by a GitHub Action on
  `main`. immediately.run's own instance is `https://baton.immediately.run` (provisioned by
  R3-1208); `baton-staging` is a separate tenant with its own Worker and hostname
  (`wrangler.toml` `env.staging`).
- **R-BTN-37 (shared modules are vendored by hash).** The Worker imports byte-identical copies
  of the pure modules it shares with docs — `baton.mjs`, `vocabulary.mjs`, `sessionUsage.mjs`
  and `batonSync.mjs` — from `src/shared/`, listed in `src/shared/manifest.json` with the docs
  commit they came from and each file's SHA-256. `npm run vendor` re-copies them from a
  sibling `docs` checkout; the suite checks every copy against the manifest, and against the
  sibling's current files where one exists, and fails on drift. A docs change to one is
  followed by a baton PR that re-vendors it before the server relies on it. Code with course
  meaning (`locate`, ranking, activity matchers) is never vendored: the sync posts its results,
  and core compares strings and integers only. R3-1237 moves core's decision library into
  `src/core/` and ends the vendoring of provider tables.
- **R-BTN-32 (one clock, with a production-inert test seam).** Every component reads time
  through one function — `batonNow()` in the client library, the core through its injected
  clock (`this.now`, set in tests by `setClock`) — never `Date.now()` directly; in production
  it is the wall clock. No environment variable is ever read for time. The only override is a
  `clock-offset` file beside the sidecar's state file, honoured only when that state file was
  written by a sidecar started with `--test-harness`, which refuses to start unless Baton's URL
  is loopback. Such a sidecar declares `test_harness: true` on its heartbeat, and Baton refuses
  that flag from any credential but the test one (`forbidden`).
- **R-BTN-55 (a thin platform shell over portable logic).** Everything Baton decides is plain
  TypeScript that names no platform. Each platform service is one interface with two
  implementations, handed to the object by the host shell for its tenant:

  | Interface | Cloudflare | Local (`baton server start`) |
  |---|---|---|
  | `Store` — synchronous `exec`, `transaction` | Durable Object SQLite (`ctx.storage.sql`, `transactionSync`) | `node:sqlite` `DatabaseSync` |
  | serialization — one request at a time between awaits | the object's input gate | one in-process queue in front of the handler and the alarm, released only at the signature check |
  | `Scheduler` — the alarm | `setAlarm` | a timer |
  | `Push` — the doorbell (R-BTN-91) | WebSocket Hibernation API (`ctx.acceptWebSocket`, `getWebSockets(<runner id>)`, `setWebSocketAutoResponse`) | an HTTP upgrade, one socket per runner |
  | `Clock` | `batonNow()` (R-BTN-32) | the same |
  | `Origin` | variable `BATON_ORIGIN` | `--origin` (default `http://127.0.0.1:<port>`) |
  | `AdminKeys` (R-BTN-57) | secret `BATON_ADMIN_KEYS` | `--admin-keys <file>` |
  | `ForgeSecrets` — per-repository webhook secret and dispatch credential (R-BTN-94, R-BTN-95) | secret `BATON_FORGE_SECRETS` | `--forge-secrets <file>` |
  | `GitHubApp` (optional, one dispatch adapter) | `BATON_GITHUB_APP_ID`, secrets `BATON_GITHUB_APP_KEY`, `BATON_GITHUB_WEBHOOK_SECRET` | `--github-app-id`, `--github-app-key`, `--github-webhook-secret` |
  | `SigningKey` (R-BTN-114) | secret `BATON_SIGNING_KEY` | a key file |
  | `CursorKey` (R-BTN-130) | secret `BATON_CURSOR_KEY` | `--cursor-key <file>` |

  - The App's outbound calls use an installation token: a JWT signed with the App key and
    issued as the App id, exchanged for the repository's installation (looked up with
    `GET /repos/{owner}/{repo}/installation`, cached until a call fails).
  - The Durable Object class is wiring only; `src/core/` imports no `cloudflare:*` module (a
    build check enforces it). Every integration scenario runs against
    both hosts. Signed requests (§11.1) and administration (§11) need no Cloudflare service.
  - The local host binds loopback unless `--bind` says otherwise; TLS is its operator's
    (R-BTN-158).
- **R-BTN-2 (cutover requires Workers Paid).** Workers Free allows 100,000 Durable Object
  requests and 100,000 SQLite rows written a day and fails further operations until 00:00 UTC.
  A deployment holding a cut-over repository (R-BTN-28), or serving several tenants, runs on
  Workers Paid, because a quota outage then stops all claiming. The dashboard shows the day's
  usage against the plan's limits; a deployment serving several tenants shows each tenant its
  own counters only.

### 2.2 Tenants

- **R-BTN-135 (a tenant is a Baton, named by its origin).**
  - **What it is.** Everything one Baton holds — repositories, owners, credentials, grants,
    settings, bars, courses, schemas, capability types, resources, instances, readings, claims,
    conditions, timers, the outbox, events, history — and its administrators. It is Baton's own
    partition, not the platform's tenant (`TENANCY_SPEC`).
  - **Its origin.** `https://<host>[:<port>]`, no path; a local host's is
    `http://<loopback host>:<port>` or the `https` origin of its operator's TLS front. No two
    tenants share a host (`@authority` covers host and port, not scheme; a host-only cookie
    reaches every port): two local hosts on one machine use different hostnames. A deployment
    serving several tenants serves `https` only.
  - **The origin binds every credential**: a signature's `@authority` (R-BTN-13), a CI token's
    audience (R-BTN-15, R-BTN-56), the host-only dashboard cookie and the origin check on
    state-changing and MCP requests (R-BTN-16, R-BTN-130), login and
    webhook URLs, and a `forge-check` entry's signed `origin` (R-BTN-114). No route, token or
    header carries a tenant id.
  - **Served only at its origin.** The Worker answers `404`, before any object is reached, to a
    request whose URL host (lowercased, default port elided) is not the origin's authority. It
    uses the request URL's host, never `X-Forwarded-Host` or `Forwarded`; `workers_dev` and
    `preview_urls` are `false`; every comparison is against the configured origin, never the
    incoming `Host`. The local shell does the same.
  - **Nothing crosses a tenant.** No read, write, count, uniqueness check, rate limit, setting,
    view, event, notice, export or stream spans two tenants. Names are unique within a tenant
    only (repository ids, runner hostnames and names, course, schema and capability-type ids,
    MCP key names); "per Baton" counters are per tenant; Baton never asks whether something
    exists in another tenant. The deployment holds only the per-IP rule, caches of public data
    keyed by the exact URL fetched (a CI key set by its key-set URL, never its issuer's name),
    and each tenant's credential snapshot for the failure buckets, keyed by origin.
  - **Core is tenant-blind.** No `src/core/` function takes a tenant id; core reads only the
    shell's ports (R-BTN-55) and the host's `Config` (R-BTN-136).
  - **Object names.** The tenant's object is `idFromName(<tenant id>)`; every other object it
    uses is `idFromName('<tenant id>/<kind>/<key>')`. A tenant id matches
    `^[a-z][a-z0-9-]{0,31}$`, is never reused, and retiring a tenant deletes its objects'
    storage. Each Cloudflare deployment's first tenant, and every local host, is `baton`.
  - **Handshake.** The shell (shared code in `src/shell/`) strips any client-supplied
    `x-baton-tenant` header and sends the tenant id in it. The object records the id in
    `baton_settings.tenant_id` at its first request and refuses a request whose id differs or
    is absent with `forbidden`, logged for the operator as `tenant-mismatch`, not as a tenant
    event. The alarm does nothing until an id is recorded.
  - **Many tenants is a router.** A deployment serving several tenants maps each host, one to
    one, to a tenant record (id, origin, secrets) the operator holds, and adds per-tenant caps
    (§2.3); it changes no route, token format, signature base, CLI command, configuration file,
    wire field or rule. Tenant hosts then sit under a registrable domain on the Public Suffix
    List that serves nothing else.
  - A rule that reads or writes another tenant's state, or depends on how many tenants a
    deployment serves, is refused in review; sharing across tenants is federation, which
    Baton does not do.
- **R-BTN-136 (the operator; configuration, secrets and administrators per tenant).**
  - The **operator** is whoever controls the deployment (the Cloudflare account's login and
    second factor; locally, the process). It is the root of trust and not a Baton principal: it
    acts through the platform (`wrangler`, the host's files), never Baton's API, and owns no
    registry action (R-BTN-129). It provisions and retires tenants. Moving a tenant: the
    operator provisions the target; the tenant's administrator runs R-BTN-88's freeze, seal,
    export and import.
  - Every value the host holds is one tenant's: `BATON_ADMIN_KEYS`, the GitHub App's id, key
    and webhook secret, `BATON_FORGE_SECRETS`, `BATON_SIGNING_KEY`, `BATON_CURSOR_KEY`, the
    OIDC issuer and key-set URL, `GITHUB_DISPATCH_TOKEN`, and the seeds in `wrangler.toml`. A
    deployment serving several tenants keeps one set per tenant in the operator's record,
    outside tenant storage, so each tenant has its own GitHub App.
  - **The secret sink.** `baton admin github-app create`, `baton admin keys set --file <path>`
    and `baton admin forge-secrets set --file <path>` write whole values, from a file the
    administrator keeps, through one sink chosen by the CLI's configuration: `wrangler`
    (Cloudflare's default) or `file` (local); a multi-tenant deployment adds `operator`, which
    authenticates the tenant's account at the operator, never with a Baton key. No command
    reads a secret back; no Baton credential adds an administrator or rewrites a secret.
  - **Administrators belong to a tenant.** Nothing in a tenant's storage can add an
    administrator to it. An administrator's, a dashboard session's and every
    `instance`-scoped action's powers end at the tenant. Force-reap, cutover, freeze, seal, export and import are the tenant administrator's.
- **R-BTN-137 (a credential is valid in one tenant; a key in two tenants is two keys).**
  - A signature verifies only at its origin; a bearer secret (API key, MCP key, registration
    token, pending sign-in, dashboard session) is stored hashed in one tenant and unknown in
    every other unless R-BTN-88 moved it; nonces, rate limits and revocations are per tenant.
  - Baton never refuses a key because another tenant holds it. The one-role rule (R-BTN-57,
    R-BTN-102) and name uniqueness hold within a tenant, and every trust statement (R-BTN-66,
    R-BTN-101, R-BTN-102, R-BTN-105) speaks only for its tenant.
  - **One machine key per tenant.** A key granted in two tenants lets either tenant's leg
    scripts sign as it in the other; Baton cannot see that, so a machine serving several
    Batons runs one runner session and one machine key per Baton.
  - **A runner's origin is its own configuration.** `runner.json` carries `origin`; `--url` and
    `BATON_URL` override it (a cloud environment sets `BATON_URL` beside `BATON_KEY`). There
    is no default origin. `baton repo *` takes `baton_url` from `.baton/baton.json` at the
    commit it syncs (`mirror`: at the head it mirrors; `spool`: the working tree's; `init`
    writes it), and a sync run by a runner whose origin differs is skipped and logged; `--url`
    overrides. Every other command takes `--url`, `BATON_URL`, `runner.json`'s `origin` or the
    single origin in `keys.json`, and with none exits 2.
  - A CLI runner and a sidecar talk only to their origin and refuse a ticket whose home checkout's
    `baton_url` names another; a code repository in `repos:` may belong to another Baton.
    `baton runner register` and `start` record each origin and key fingerprint in
    `~/.config/baton/origins.json`; `start` exits 2, naming both origins, for a key listed
    under another origin (a convenience, not a boundary).
  - `~/.config/baton/keys.json` maps each origin to its roles (`{admin, owner: {…}, courier,
    runner, sync: {…}, mirror: {…}}`); the CLI offers only the called origin's.
- **R-BTN-56 (one Baton per repository).** Two Batons serving one repository are two lock
  servers (R-BTN-18). `.baton/baton.json`'s `baton_url` names the repository's one Baton; its
  sync posts only there. Each Baton checks the OIDC `aud` against its origin: `aud` is
  `BATON_ORIGIN` verbatim (scheme included, no trailing slash; GitLab's adds `#sync` or
  `#mirror`, R-BTN-15), and the sync and mirror request tokens for `baton_url`, the same string. Moving a repository is its owners' act: retire it on
  one Baton, register it on the other, change `baton_url`. Baton never checks this across
  tenants.

### 2.3 Capacity and admission

- **R-BTN-87 (the capacity envelope: one Baton per team, not sharded).** One Durable Object
  serializes every request of a tenant; readings and fleet counts are per tenant.
  - **The envelope** (targets, not platform limits): 50 live runners, 20 repositories, 5,000
    live tickets, 1,000,000 history rows; 20 requests a second as a 5-minute mean; bursts of
    100 requests in any 5 seconds.
  - **Latency budgets** (p99 at the Worker): heartbeat, ends and reads 300 ms; claim and
    `advance` 500 ms; an observation number 300 ms; a 5,000-ticket board post 5 s, within the
    object's CPU limit.
  - The dashboard shows each figure against the envelope (current counts, rates as 5-minute means).
    The alarm logs `capacity` when a figure crosses 80% upward and again when it falls back,
    and raises `baton.capacity` while it is over. The envelope refuses nothing; R-BTN-149's
    caps at twice it do. `npm run test:load` proves it (§15).
  - Beyond the envelope the answer is another Baton: repositories partition across Batons
    (R-BTN-56).
- **R-BTN-149 (hard caps per repository).** Safety limits at twice the envelope; none refuses
  lease upkeep.

  | Cap | Limit | Past it |
  |---|---|---|
  | board post | 8 MB, 10,000 tickets | `too-large`; raises `baton.too-large` |
  | markers in a board post | 20 per ticket, 20,000 in all | never refused: the sync posts each ticket's newest 20 (by forge creation time), then the newest 20,000, and lists the cut tickets in `markers_truncated` (§4.4) |
  | child tickets | 4 generations below a root | `parent-invalid` |
  | live runner rows per credential | 64 | the 65th first heartbeat `quota` |
  | new sessions per credential per day | 200 | the 201st first heartbeat `quota` |
  | held snapshots per posting credential per repository | 4 | a fifth drops that credential's own oldest (`admin` event, `held-dropped`); never another's |
  | non-upkeep row writes per credential per repository per UTC day | 50,000 | `quota` for that credential until 00:00 UTC |
  | a credential's heartbeat declaration and report writes per UTC day | 50,000 | dropped, the lease kept, until 00:00 UTC (§2.3) |
  | a repository's non-upkeep row writes per day | 150,000 | raises `baton.write-budget` at 80% |
  | a schema pattern's expanded automaton (R-BTN-108) | 4,096 states (`{n,m}` multiplies by `m`, nesting multiplies, capability `values` included) | a schema error at the sync |

  - Neither write budget refuses owner or administrator writes, or the repository's sync key
    or CI identity.
  - Retention: runner rows unseen for 30 days lose their capability, tag, course and report
    rows; the alarm deletes `board_snapshots` older than 90 days (never the head's) and
    repository `events` older than 90 days below every mirror's `mirror_acked_seq`.
- **Admission.** The Worker turns away what the object need not see:
  - A signed route (`/v1/runner/*`, `/v1/repositories/*`, `/v1/probe/*`, `/v1/courier/*`,
    `/v1/owner/*`, `/v1/admin/*`) with no or a malformed signature, a stale `created` or a
    foreign `@authority` is refused before the object; key and nonce checks run inside it.
    Other routes are checked first in the Worker too: `/v1/sync/*` a CI identity token or a
    signature (a sync key's or a machine key's; key checks in the object, R-BTN-93); `/` and `/v1/ui/*` a dashboard session; `POST /v1/login` a
    pending sign-in (R-BTN-155); `POST /v1/github/webhook` `X-Hub-Signature-256` (R-BTN-73);
    `POST /v1/forges/{repository}/notify` its forge's verifier (R-BTN-95). The static pages
    `/login` and `/oauth/authorize` need no session; `/.well-known/oauth-*` and `/v1/oauth/*`
    take no credential and fall under the per-IP rule, and `POST /v1/mcp`'s bearer is checked
    in the object (R-BTN-130, `BATON_MCP_OAUTH_SPEC` §13).
  - A per-IP rule (a Workers rate-limit binding keyed `<host>|<ip>`) applies only to
    unauthenticated requests, never to `POST /v1/github/webhook`.
  - Authenticated calls are limited to 600 a minute per credential, keyed by origin and
    credential, counting only requests the object verified.
  - **Failed verifications** count in two buckets: (origin, credential id, client IP) and
    (origin, client IP). A credential id is an SSH keyid or the `<id>` of a `bak_` or `brt_`
    bearer, a session cookie `bds_<id>_<secret>` or a pending sign-in `bps_<id>_<secret>`; an
    MCP key (`bmcp_`), which has no id part, counts only in (origin, client IP); CI tokens, App deliveries and forge notifications count in none.
    Beyond 60 failures a minute in a bucket, the Worker checks that bucket's requests for the
    rest of the minute against a snapshot of the tenant's whole active credential set, fetched
    at most once a minute and again at most once every 5 s on a request that matches nothing;
    unmatched requests during a re-fetch are forwarded at most one a second per bucket. It
    refuses `unauthenticated` only the failing requests: a request that verifies is never
    refused by a bucket. The check is a filter; the object verifies every forwarded request in
    full (R-BTN-13).
  - **Lease upkeep** — heartbeats of an existing session, `advance`, `end`, release
    acknowledgements; not a first heartbeat, which creates a session — is never refused by a
    per-tenant cap, and nothing it carries is dropped but a declaration over budget (below).
    It has its own buckets: 30 calls a minute per live claim, spent only by its holder; 30 a
    minute plus 10 per live session per credential for sessions holding no claim. An exhausted
    bucket answers `rate-limited` with `retry_after_s`. The sidecar coalesces ring-triggered
    heartbeats to one per 10 s per session, except a ring carrying a `release`.
  - A deployment serving several tenants adds per-tenant caps: requests (`rate-limited` with
    `retry_after_s`), row writes and storage (`quota` until the day turns or space is freed).
  - **A refused request had no effect.** A retry is re-signed with a fresh `created` and
    `nonce` and keeps its `request_id` where the route takes one. Baton's own clients (CLI, runner, sidecar, forge
    courier, sync, mirror, dashboard) treat `rate-limited` and `quota` as possible on every
    route: a periodic loop backs off, honouring `retry_after_s`, and keeps its lease; a one-shot
    command waits at most 60 s, then exits non-zero naming the code. Neither marks a lease lost
    at once, but an unanswered heartbeat still runs the lease clock (G-BTN-4). `too-large` is
    reported, never retried. A capped forge webhook is a lost trigger, covered by the sync's
    schedule (R-BTN-73).
- **Write budget.** Each signed request writes two rows (a `request_nonces` insert and its
  prune 11 minutes later). A heartbeat writes `last_seen_at` only, unless its declared
  capabilities, tags, courses or settings hash changed or it carries reports; those further
  writes count against the credential's daily declaration budget (R-BTN-149). Past it, a
  heartbeat still renews the lease but its declaration changes and reports are dropped (answered
  `declarations: 'quota'`) until 00:00 UTC. A ring adds at most one heartbeat. A condition's raise is two writes and its settlement one. At the
  envelope that is about 330,000 row writes a day.

## 3. Repositories and forges *(proposal)*

A Baton hands out the tickets of the repositories its administrator registers. A repository
lives on a **forge** — GitHub, GitLab, Gitea — or on a plain git server. Core reads no forge:
the forge only selects which adapters a repository may use (credentials, dispatch,
notifications, PR facts) and how Baton builds links. Every adapter is optional; a bare
repository reachable over SSH is enough (R-BTN-105).

### 3.1 The registry

- **R-BTN-47 (registered repositories).** Baton keeps a registry of repositories
  (`repositories`, §13). Each has:
  - an id, `^[a-z][a-z0-9-]{0,39}$`, unique in its tenant (R-BTN-135);
  - its forge, forge path, `remote` and `web_base` (R-BTN-92) and the forge's ids (R-BTN-138);
  - its default branch, its sync credentials (R-BTN-93, R-BTN-15) and, with GitHub Actions,
    the `sync_workflow` allowed to post its board and the optional `mirror_workflow` allowed to
    read its events (§16); with any mirror, the `mirror_pusher` it pushes as (R-BTN-73);
  - its optional dispatch adapter and unblocked trigger (R-BTN-94), its `weight` (R-BTN-61) and
    its owner settings (R-BTN-66).

  Only an administrator registers, changes or retires a repository, with its first owner keys
  (`POST /v1/admin/repositories`, R-BTN-57). A change never alters `forge`; it changes the
  forge path only by R-BTN-138's rules.

  - **The seed (B-91).** `BATON_REPOSITORIES` seeds the registry at start, insert-only, through
    the same validation: each entry is a registration (`POST /v1/admin/repositories`' body,
    §11) less its `owner_keys`, or **with** them — the owner keys the administrator registered
    the repository with (R-BTN-58), written at start as that repository's owners,
    `added_by: admin:seed`, so a rebuilt instance serves the owner CLI with no manual re-add
    (S-BTN-30's owner routes). A seeded repository that already has owners at start keeps them,
    and the seed writes the entry's keys only where that repository has none. An entry that
    names no `owner_keys` still registers its repository — its owners are added by an
    administrator. A malformed entry stops the start before any entry registers. A key the
    seed writes holds no other role, as one the administrator's route takes (R-BTN-57): one
    that does stops the start `conflict`. A key an administrator **revoked** is skipped — never
    written, never a stop: a revocation after the seed was written is an administrator's act, not
    a broken seed, and must not take the instance down; a repository it leaves with no owner is
    named in `seed_owners` (R-BTN-179).
  - **Home.** Every ticket belongs to one registered repository, its **home**. Baton's API,
    events and dashboard name a ticket by its qualified id `<repository id>:<local id>`
    (`docs:R3-1205`); runners, branch names and git use the local id. Two repositories may
    share local ids.
  - **One board per repository**: its own head and compare-and-set (R-BTN-11), observation
    counter (R-BTN-62), sync run and held snapshots. A sync credential posts only its own
    repository's board.
  - **Relations stay home.** A ticket's `parent` and `depends_at` name tickets of the same
    repository.
  - **Repositories a ticket changes** (`repos:`) are filter fields its course reports. They
    need no registration and reach nothing unless the home's owners list them in `code_repos`
    (R-BTN-140).

- **R-BTN-92 (a repository is a forge, a forge path, a remote and a web base).**
  - **`forge`**: `github`, `gitlab`, `gitea` or `git` (none), fixed for the repository's life.
  - **Forge path** (column `github`): segments of `[A-Za-z0-9_.-]{1,100}`, none `.` or `..`,
    none ending in `.git`, joined by `/`; exactly two segments on GitHub, Gitea and `git` (where
    the administrator chooses it), two to four on GitLab. Compared case-insensitively and unique
    among the tenant's live repositories. It is for display and links; the forge's ids identify
    the repository (R-BTN-138). Every repository name a ticket carries — `repos:`, `git:` URIs
    (§12.3), the branch-holder query's `?repo=` (§9), the markdown source's `repos` map (R-BTN-74)
    — is a forge path on the **home's forge host**.
  - **`remote`**: the URL the sync and runners clone (`https://…`, `ssh://…` or
    `git@host:path`). Baton never fetches.
  - **`web_base`** (every forge but `git`): `https://<host>[:<port>]/<forge path>`, `https`
    only, no userinfo, query or fragment.
  - **The link rule.** A URL is the repository's when, parsed as a WHATWG URL and
    percent-decoded, it is `https`, has no userinfo, has `web_base`'s host (case-insensitive)
    and port, and its path begins with `web_base`'s path segments **as whole segments**
    (`…/docs` does not cover `…/docs-evil`), with no `.`, `..` or empty segment, no backslash and
    no encoded `/`. Every link Baton accepts or draws for a repository passes this rule; a `git`
    repository has no `web_base`, so Baton accepts and draws no link for it.
  - **Lookups by path name the forge host.** GitHub OIDC tokens (R-BTN-15) and App deliveries
    (R-BTN-73) look among `github` repositories on `github.com` (the App does not serve GitHub
    Enterprise hosts); a GitLab token or notification among its own host's repositories.
  - The administrator may change `remote` and `web_base` (a move).

- **R-BTN-138 (a forge repository is named by its immutable ids).** A path can be re-created
  by someone else after a rename, transfer or deletion; ids cannot.
  - **Registration records the ids** as decimal strings `^[1-9][0-9]{0,19}$` in
    `forge_repo_id`, `forge_owner_id`, with `forge_host`:

    | forge | `forge_repo_id` | `forge_owner_id` |
    |---|---|---|
    | GitHub | repository `id` | owner `id` |
    | GitLab | project `id` | namespace `id` |
    | Gitea | repository `id` | owner `id` |
    | `git` | — | — |

    A forge repository without ids is refused `invalid-params`. `baton admin repo add` reads them
    from the forge's API (`GITHUB_TOKEN`, `GITLAB_TOKEN` or `GITEA_TOKEN` for a private
    repository); `--forge-ids <repo>,<owner>` supplies them offline. Ids are unique among a
    tenant's live repositories on one forge host (`conflict`). A webhook's numeric id is
    converted only when `Number.isSafeInteger` holds, else the delivery is ignored and logged.
  - **The ids decide.** A token or delivery whose ids match passes whatever path it carries;
    one whose ids differ fails whatever path it carries. Checked on: a GitHub OIDC token's
    `repository_id` and `repository_owner_id`; a GitLab `id_tokens` JWT's `project_id` and
    `namespace_id`; an App delivery's `repository.id`; a notification's GitLab `project.id`,
    Gitea `repository.id` and `repository.owner.id`, or GitHub repository webhook's
    `repository.id`.
  - **A mismatch**: a CI token is refused `unauthenticated`; a delivery or notification is
    ignored (its signature was valid) and never matched by path instead. Mismatches write no row
    per request: `forge_ids_seen.mismatch` keeps the last 5 distinct ids as `{ids, count,
    last_at}`, written at most once a minute, and the repository raises
    `baton.forge-ids-mismatch`.
  - **A verified rename** — a verified token, delivery or notification with matching ids and a
    new path — in one transaction rewrites the path and `web_base`'s path, appends the old path
    to `former_paths` (deduplicated, latest 10), and rewrites `remote` when it was
    `web_base` + `.git`; otherwise the repository raises `baton.remote-stale`.
  - **A held rename.** When a live repository already holds the new path, the old path is kept
    and the token still passes. The repository raises `baton.rename-held`; a claim on a ticket
    whose home or code repository has a held rename is refused `not-eligible` (`rename-held`,
    §6); active claims on those tickets get a `requested` release (§6). The hold clears when an
    administrator changes the path with `confirm: true` (same rewrite as a verified rename) or a
    later verified rename stops colliding.
  - **Former paths reach the fence only** (the branch-holder query, §9), never authentication or
    links: `?repo=P` resolves to live repositories whose current path is `P`, and to one whose
    former path is `P` only while no live repository holds `P`. A `code_repos` entry keeps its own
    `former_paths` (latest 10), updated by id-matched deliveries. Several matches fail safe. An
    administrator removes a former path with `former_paths_remove` and `confirm: true`.
  - **Re-identifying** after a transfer: the change body's `forge_repo_id`, `forge_owner_id`
    and `confirm: true`.
  - **Retiring** moves the path to `former_paths`, sets `github` to the tombstone
    `~retired/<id>` and stops reading `web_base`. The path validator and import (R-BTN-88)
    accept a tombstone only on a retired row.
  - Renames, path changes and identifications are `admin` events with `detail.action`
    `repo-renamed` (actor `sync`), `repo-path-changed` or `repo-identified` (actor the
    administrator).
  - Two tenants may register the same forge repository; Baton does not check across tenants
    (R-BTN-56).

- **R-BTN-61 (merging courses and repositories).** Recommendations order each (repository,
  course) group by the default order (§6), then merge the groups by: (1) expedited first
  (R-BTN-12); (2) the home repository's `weight` (default 100), higher first; (3) the
  candidate's place in its own group; (4) fewer legs to an end; (5) `ready_since`, oldest
  first; (6) ticket id. The matching query reads at most 50 candidates per group after posted
  bars; when owner bars or readiness leave a group short it reads the group's next page, at
  most 4 pages per group per request, later pages' survivors after earlier ones'. `?limit=`
  applies after the merge. A ticket is offered only for its queued leg (R-BTN-83), named in
  `legs`, a list of one.

### 3.2 Who may post a board

- **R-BTN-93 (sync keys and the one verifier).** A repository's sync and mirror authenticate
  with a sync key, a CI identity token (R-BTN-15), or — for the sync only — a machine key
  granted on the repository (R-BTN-102, R-BTN-146).
  - **A sync key** is an SSH key of R-BTN-13's types in one `sync_keys` row: exactly one
    repository and one role, `sync` or `mirror`. Owners add and revoke it
    (`POST /v1/owner/{repository}/sync-keys`, `…/sync-keys/{fingerprint}/revoke`); an
    administrator at registration or by R-BTN-57's revoke. A key already serving a repository,
    or holding another role, is `conflict`; any other key is `forbidden` at `/v1/sync/*`.
    Requests are signed as R-BTN-13 says (namespace `baton-request`, same nonce cache).
    Revocation takes effect at the next request.
  - A sync key is bound to no branch: whoever holds it is the sync. In CI it is a secret only
    default-branch runs can read — a GitHub environment secret restricted to the default branch,
    or a GitLab protected variable where the default branch is the only protected ref
    (R-BTN-156) — never a plain repository secret. On a shared server only the sync account
    reads it. `baton repo init` writes the CI configuration that way.
  - **`verifySync(req) → {repository, role}`** is the only check. It refuses `unauthenticated`
    (no credential, bad signature, unknown or revoked key, a token that fails) or `forbidden`
    (another role, a key that is no sync credential, a machine key whose grant does not sync
    there). Every `/v1/sync/*` route uses only its answer.
  - **A repository has a mirror** when it has a `mirror_workflow`, `ci_identity.mirror` is
    true, or it has a `mirror`-role sync key. Only sync keys and CI tokens act as the mirror.

- **R-BTN-15 / R-BTN-156 (CI identity tokens).** `ci_identity` (§13) is NULL (sync keys only),
  `{kind: 'github-actions'}` or `{kind: 'gitlab-ci', issuer, mirror}`.
  - **GitHub Actions OIDC**, verified in the Worker: issuer
    `https://token.actions.githubusercontent.com`; audience `BATON_ORIGIN`; `repository_id` and
    `repository_owner_id` equal the stored ids; `ref` is the default branch;
    `job_workflow_ref` is `<repository>/<sync_workflow>@refs/heads/<default branch>` for
    `/v1/sync/board` and `/v1/sync/observation`, or the `mirror_workflow`'s for
    `/v1/sync/events`; `workflow_ref` equals `job_workflow_ref` (the sync is the run's
    top-level workflow); `event_name` is `push`, `schedule` or `workflow_dispatch`.
  - **GitLab CI `id_tokens`**: issuer the repository's GitLab instance, verified only against a
    `gitlab_issuer` listed in `BATON_FORGE_SECRETS` (keys at `<issuer>/oauth/discovery/keys`,
    never fetched from a token's own `iss`) and equal to `ci_identity.issuer`; `project_id`
    and `namespace_id` equal the stored ids; `ref_type: branch`, `ref` the default branch;
    `ref_protected: "true"`; `pipeline_source` in `push`, `schedule`, `web`, `api`,
    `trigger`; audience `<BATON_ORIGIN>#sync` or `<BATON_ORIGIN>#mirror`, which chooses the
    role. `repo init` writes a sync job that reads no pipeline variables.
  - **GitLab sync keys.** `repo init --forge gitlab` refuses a sync key unless the default
    branch is the only protected ref, and writes the CI identity instead where `id_tokens`
    exist.
  - A token reads and writes its own repository's board and events only. Whoever can push the
    default branch can post any board for it — a legitimate user (R-BTN-66); the token proves
    only default-branch origin. No push changes Baton's own state.

### 3.3 Triggering a sync

- **R-BTN-94 (Baton records that a run is wanted; a runner pulls it).** Where this
  specification says Baton dispatches a sync, Baton **records a want** in the transaction that
  causes it — a claim (open-world included), an `advance`, an end, an owner bar set or lifted,
  an unblocked ticket, a forge notification, the dashboard's **Resync**, `POST /v1/sync/want`
  (sync credential) or `POST /v1/owner/{repository}/sync-want` — then sends the dispatch
  adapter's push if one is configured.
  - **The sync's want** is `sync_wanted_at` (earliest unanswered want; set when NULL) and
    `sync_wanted_after` (`board_head.last_handed_out` at the latest want; 0 before any number).
    A board post accepted or held whose observation is **strictly greater** than
    `sync_wanted_after` clears both, so a want raised while a run reads is answered by the next
    run. Wants are not exported (R-BTN-88).
  - **The mirror's want** is implicit: unread events of a kind the mirror writes above
    `mirror_acked_seq` (§16). A mirror run ends with one `GET /v1/sync/events` at its final
    cursor, which acknowledges it.
  - **`GET /v1/sync/wanted`** answers `{wanted, since?, head_sha}` for the credential's role;
    `head_sha` is the newest commit any post named, held posts included. It writes only its
    nonce row.
  - **Who answers a want**, any of: a cron loop (`baton repo sync --if-wanted`, `baton repo mirror
    --if-wanted`, each minute); a CI schedule (every 15 minutes as a backstop); runners
    (R-BTN-105); optionally a server `post-receive` hook that only touches a spool file
    (`baton repo spool <repository>`) which the sync account's loop turns into
    `POST /v1/sync/want` and a run. The hook never reads the sync key and never waits for a sync.
  - **Dispatch adapters** (`dispatch`, §13), sent after commit and retried at most once:
    `{kind: 'github-app'}` — `workflow_dispatch` through the GitHub App (§12.7);
    `{kind: 'gitlab-trigger', project_id, ref}`; `{kind: 'gitea', workflow, ref}`, whose token
    belongs to a bot user with write access to that one repository only. Without an adapter
    (every `git` repository) the runners alone answer wants; a failed push only adds latency.
    Notification-caused dispatches are coalesced to one per repository per 30 seconds, plus one
    trailing dispatch when a window that suppressed one closes (the alarm).
  - **The unblocked trigger** (`unblocked_trigger`, owners' setting): NULL or an adapter call of
    `dispatch`'s shape, made when a ticket unblocks (R-BTN-77) with its `tickets` input. It uses
    the repository's own dispatch credential and target; owners choose only the workflow — the
    `sync_workflow` or one the administrator listed in `trigger_workflows`, under
    `.github/workflows/` or `.gitea/workflows/` on the default branch — or, on GitLab, only
    whether to call it. Anything else is `invalid-params`.
  - **Forge credentials live in the deployment**, never in SQLite or an export: the Worker
    secret `BATON_FORGE_SECRETS` (`--forge-secrets <file>` locally), JSON keyed by repository
    id, `{forge, gitlab_issuer?, webhook?, dispatch?}`, beside `BATON_GITHUB_APP_KEY` and
    `BATON_GITHUB_WEBHOOK_SECRET`. Registration refuses a repository whose entry names another
    forge.
  - Raises: `baton.forge-secret-missing` (a configured adapter or webhook has no secret);
    `baton.sync-late` (a sync want older than 30 minutes); `baton.mirror-late` (a mirror more
    than 30 minutes behind).
  - **The GitHub App** (§12.7) is GitHub's dispatch adapter and webhook source.

- **R-BTN-73 / R-BTN-95 (forge notifications are only triggers).** A notification records a
  want; it never computes or carries state.
  - **Routes.** `POST /v1/github/webhook` takes the App's deliveries for every repository it is
    installed on (`X-Hub-Signature-256` under `BATON_GITHUB_WEBHOOK_SECRET`).
    `POST /v1/forges/{repository}/notify` takes a GitLab notification (`X-Gitlab-Token`
    compared with the repository's `webhook` secret), a Gitea one (`X-Gitea-Signature`,
    HMAC-SHA256) or a GitHub repository webhook (`X-Hub-Signature-256` under the repository's
    own secret, for a repository without the App). A `git` repository has no route. Both routes
    are verified in the Worker before anything is read, are outside the per-IP limit (§2), and
    answer `204`. Every comparison is constant-time over equal-length digests.
  - **Events and the only fields read:**

    | forge | events | fields |
    |---|---|---|
    | GitHub | `push`, `pull_request`, `pull_request_review`, `issue_comment`, `workflow_run` | `X-GitHub-Event`, `X-GitHub-Delivery`, `repository.full_name`, `repository.id`, `workflow_run.path`; push: `pusher.name`, `head_commit.author.email`; pull_request: `pull_request.merged`, a boolean or null (B-89) |
    | GitLab | `Push Hook`, `Merge Request Hook`, `Note Hook` | `X-Gitlab-Event`, `X-Gitlab-Event-UUID`, `project.path_with_namespace`, `project.id`; push: `user_username`, head commit `author.email` |
    | Gitea | `push`, `pull_request`, `pull_request_review_*`, `issue_comment` | `X-Gitea-Event`, `X-Gitea-Delivery`, `repository.full_name`, `repository.id`, `repository.owner.id`; push: `pusher.login`, `head_commit.author.email` |

    No pipeline or job event is accepted from GitLab or Gitea.
  - **Dropped:** a delivery id seen in the last 24 hours (`webhook_deliveries`); a
    `workflow_run` whose path is the repository's `sync_workflow` or `mirror_workflow`; a push
    whose pusher (`pusher.name`, `user_username`, `pusher.login`) is the repository's
    `mirror_pusher` — the forge account the mirror pushes as, set by the administrator with the
    mirror — **and** whose head commit's author email is the mirror's (§16), so a mirror write
    never triggers a sync. An author email alone, which any pusher can set, drops nothing.
  - **Which want.** A delivery records a want for the repository it names (by id, R-BTN-138)
    and for each registered repository whose `code_repos` lists it (by id once stored). A
    delivery to `/v1/forges/{repository}/notify` records a want for `{repository}` only, and only
    when its project is `{repository}` or one of its `code_repos`.
  - **A merge dispatches the sync (B-89).** A `pull_request` delivery that is not a merge
    (`pull_request.merged` anything but `true`) records nothing. When it is a merge, and the
    delivery names a registered repository's own home repository, that repository joins the
    want's set and its sync is dispatched — the trigger that fires when the workflow's
    `schedule` does not: 14 runs of a `*/15` cron in 51 hours (2026-10-22T10:22Z to 2026-10-24
    13:34Z), gaps of 2–5 hours, measured on the workflow's own history. The delivery names only
    `repository.full_name`, so the pull request's base branch is not read: a merge into another
    branch of the same repository sends the same sync, which reads the head it is dispatched
    against and posts the board it falls back to. It is dispatched whether or not the
    repository has cut over: §7.1's reason for holding a sync back (the mirror writes git after
    the cutover, and a sync that reads git from GitHub needs no mirror) does not hold for a sync
    that carries no mirror write. Every dispatch the webhook path sends, a merge's and another
    repository's want's alike, is timed in `webhook_syncs`: one row stamped by every repository
    the delivery dispatches, at the instant it decides — a push's sync of the delivery's own
    repository and another repository's want included — and stamped again by the alarm when the
    path sends on the backstop below. It shares R-BTN-73's 30-second window with the want's
    dispatches, and is sent whatever the repository's mode. A dispatch that fails is not
    dropped: its stamp stands, and the backstop sends it again once the stamp is stale, whatever
    the schedule does.
  - **The webhook path's own backstop (B-89).** A registered repository whose `webhook_syncs`
    row is stale — `last_dispatch_at` under the alarm's `now` less 10 minutes, strictly, so a
    stamp is never due again on the tick that wrote it, and a row exactly ten minutes old is not
    yet due — is dispatched a sync at R-BTN-73's alarm: the App's deliveries reached Baton, and
    this path did not send one. The alarm is armed for the earliest live stamp's
    `last_dispatch_at + SYNC_STALE_MS` (the first instant the strict comparison holds), as it is
    for a trailing dispatch and a lapsed reading, so the send lands at ten minutes rather than up
    to a minute later on the ordinary path; a tick that lands late sends once, not on every tick
    after. Sending opens the repository's 30-second window, so
    a delivery arriving meanwhile waits for the trailing dispatch rather than racing it. A
    repository with no row has never had one sent and takes no part in the backstop, which
    keeps it on the repository's own triggers: a row exists only where the App's deliveries led
    the path to a repository, and ten minutes without a send there is what the row being ten
    minutes old means (this repository merges up to a dozen times a day; `docs`, whose tickets
    name this repository, is sent a sync for each of them, while its own pushes are its
    workflow's).
  - **The schedule is the backstop of last resort.** The default workflow's `schedule` stays:
    what it adds over the two above is independence of the App, and it is not assumed to fire.

- **R-BTN-105 (a sync reads the commit it syncs; a plain server needs nothing).**
  - **Every input from the commit.** A sync reads tickets, `.baton/`, each course's
    `course.json` and `sync.mjs`, and the ticket source from the commit it posts — the remote
    default branch's head as just fetched — in a detached worktree of the whole commit (never
    a working tree), with `.baton/package.json`'s dependencies installed by R-BTN-133's rules
    and sourced courses read from their source (R-BTN-134).
  - **Runners sync.** A runner runs its repository's code already, so syncing adds no exposure
    within its tenant, except sourced courses' station functions it does not otherwise run. A
    runner that pushes the default branch syncs after its push. A runner that offers to sync a
    repository polls `GET /v1/sync/wanted?repository=<id>` and `git ls-remote <remote>`, each at
    most once a minute while live, and runs `baton repo sync` when `wanted` is true or the remote
    head differs from `head_sha`. Observation numbers and `sync-busy` (R-BTN-62) keep several
    runners from posting at once.
  - **A plain repository** is a bare repository reachable over SSH (plus, for a standard
    course, the baton repository or a mirror its source maps to). No hook, spool, sync account
    or sync key is required. The server must set `receive.denyNonFastForwards = true`,
    `receive.denyDeletes = true` and `git-shell` (or gitolite) as runner keys' login shell;
    `baton repo init --forge git` prints them.
  - **Two key lists.** The git server's `authorized_keys` and Baton are separate authorities;
    revoking a key needs both.
  - A client-side git hook is never a trigger: it fires before anything is shared.

- **R-BTN-97 (a sync off a CI sandbox).** A machine that is neither a CI sandbox nor a runner
  either runs the sync as an unprivileged user in a container holding no credential but the
  sync key and reaching only Baton's origin and the forge, or runs `baton repo sync
  --defaults-only` (R-BTN-134). This is the operator's obligation; Baton cannot see which runner
  posts, and a sync key's reach bounds the harm to one board.

### 3.4 Reading the forge

- **R-BTN-96 (course facts come from an adapter per forge).** For a course whose `entry.json`
  declares `facts: ["prs"]` (R-BTN-134) the CLI reads PR facts through a **fact adapter**
  chosen by `forge` — GitHub PRs and reviews, GitLab merge requests and approvals, Gitea PRs and
  reviews — mapped to one set of facts: a PR's head branch, state, head checks and verdicts on
  the head. Each fact carries `repository`, fork-ness and `trusted` (R-BTN-139). The verdict line
  `<!-- baton:verdict approve|changes -->` works on every forge.
  - The adapter reads the home repository and every `code_repos` repository a live ticket on a
    PR-reading course names (deduplicated, case-insensitive), under one request budget. An
    unreadable or missing repository fails the sync, naming the tickets; a partial reading is
    never posted. On GitHub it lists PRs over REST and reads live tickets' PRs over GraphQL, at
    most 25 PRs a query per repository (head-commit check runs through check suites, latest run
    per check; commit dates; reviews; issue comments); an overflowing first page or a head read
    at another commit is read over REST in full; an answer with `errors` fails the sync. Built:
    B-29, B-35.
  - **The `branch` course** (a course directory of the baton repository, `facts:
    ["branches"]`; `baton repo init --course branch`) reads the home repository's git alone:
    - stations `filed` → `pushed` → `reviewed` → `merged`, with `fixed` between `reviewed` and
      the next review; legs `implement`, `review` (`max_runs` 4), `fix` (`max_runs` 3),
      `merge`; no `short_waits`;
    - a ticket's branch is a ref matching the current or previous `branch_pattern` with a commit
      not reachable from the default branch; with several, the least advanced decides; none is
      `filed`;
    - a content commit's tree differs from its first parent's; a verdict is an empty commit whose
      trailers (`git interpret-trailers --parse`, last occurrence per key) carry
      `Baton-Verdict: approve|changes`, `Baton-Reviewed: <40-hex>` and `Baton-Claim: <nonce>`
      (the `review` claim's). The station function posts each verdict as a marker (`ref` the
      commit sha, `claim_nonce` from the trailer, null when absent), so a verdict no `review`
      claim wrote is a `foreign-write` (R-BTN-46) — noticed, still counted. Walking first-parent
      history from the head, the newest verdict reviewing the newest content commit decides:
      approve is `reviewed` with `merge` ready, changes `reviewed` with `fix` ready; content
      after it is `fixed`; content and no verdict is `pushed`;
    - `merged`, judged first, holds when the default branch's first-parent history has a commit
      with trailer `Baton-Ticket: <local id>`; the `merge` stub merges with `git merge --no-ff`
      and that trailer and pushes.

- **R-BTN-139 (on a forge, only pushers' writes count).** The fact adapter marks every PR,
  comment, review and approval `trusted` or not, once per sync run. Standard station functions
  read only trusted facts; the adapter exports `trusted` to a course's own `sync.mjs`; whatever
  station function runs, the CLI drops every posted marker and output whose source is untrusted.
  Untrusted markers are never posted (§4.4), so never a `foreign-write`, output or position;
  the sync log counts them per PR.
  - **PRs that count.** A PR found by `branch_pattern` counts only when its head repository is
    its base repository by id — GitHub `pull.head.repo.id == pull.base.repo.id` (a null
    `head.repo` is a fork), GitLab `source_project_id == target_project_id`, Gitea
    `head.repo_id == base.repo_id` — and its base is the home or a `code_repos` entry. A fork's PR
    counts only when a pusher names it in `prs:`; its outsiders' words still do not count.
  - **Words that count only from trusted authors:** verdict lines, adjudication and conclusion
    lines, forge review states and approvals, and every `baton:` marker (comment, review or PR
    body). A text counts only when its author **and every editor** are trusted: GitHub's GraphQL
    `userContentEdits`; on GitLab and Gitea the author is trusted and `updated_by`, where
    present, is the author.
  - **A trusted person**: an immutable forge user id in the owners' `trusted_identities`, or
    someone the forge reports can push to the PR's base — GitHub
    `GET /repos/{owner}/{repo}/collaborators/{username}/permission` is `admin` or `write`
    (`author_association` only pre-filters); GitLab `GET /projects/:id/members/all/:user_id`
    has `access_level` ≥ 30 (approvals filtered the same); Gitea collaborator permission
    `write`, `admin` or `owner`. `baton owner settings` warns when a shared echoing bot (such as
    `github-actions[bot]`) is listed.
  - **Failures.** A permission or editors read that errors aborts the sync run, which posts
    nothing and releases its number (R-BTN-150). Only a token known to lack the scope degrades: permissions to `trusted_identities`
    (fail closed), raising `baton.trust-degraded`; a text whose editors cannot be read does not
    count. Permissions are cached per author per run (GitLab
    and Gitea read the member list once per run) and re-read every sync, so a verdict whose author
    lost push stops counting; the backward move is a regression (R-BTN-35). `repo init --forge
    gitlab` provisions a `read_api` token for the lookup.

- **R-BTN-140 (code repositories are the owners' list).** The owner setting `code_repos` lists
  forge repositories on the home forge host. Owners write each entry's `path` only; Baton
  resolves it at addition to `{path, repo_id}`, keeps `former_paths` itself and matches by id
  thereafter, and a re-written list keeps the ids of the paths it keeps.
  - An entry whose id is a live registered repository of the tenant needs that repository's
    consent, a `code_repo_consents` row judged by id at every use and never written by A's
    settings: `POST /v1/owner/{B}/code-repo-consents {repository: A, confirm: true}` signed by
    B's owner, or an administrator's `code_repo_consents_add` (`POST /v1/admin/repositories`);
    `withdraw: true` withdraws it. Without consent the entry has no reach and raises
    `baton.code-repo-unconsented`.
  - A `repos:` entry gains reach only when it resolves — path first mapped to its current one by
    id, so a re-created former path never gains reach outside the fence — to an id in
    `code_repos`. Only such an entry may be named by a `git:` or `https://` input URI the runner
    fetches (§12.3); be searched for PRs or named in `prs:` (R-BTN-139); map a branch in the
    branch-holder query (R-BTN-141); carry a decision's `url` (R-BTN-78). Any other entry is
    shown and filtered on only, and the ticket raises `baton.repo-not-listed`.
  - `POST /v1/sync/observation` hands the sync the effective `code_repos` (consented entries
    with their ids) and `trusted_identities`.

- **R-BTN-141 (a branch pattern's grammar and reach).**
  - `branch_pattern` and `previous_branch_pattern` (R-BTN-51): a literal prefix of 1–64
    characters of `[A-Za-z0-9._/-]` ending in `/` or `-`; `{ticket}` exactly once, optionally
    beside `{repository}` with a literal separator; then nothing, or one separator from
    `/ - _ .` and an optional trailing `*`. At most 128 characters. `*` matches
    `[A-Za-z0-9._/-]*`; no `?`, `[` or `**`. Default `claude/{ticket}-*`.
  - The sync refuses any other pattern and posts nothing; Baton refuses it in a posted
    registry (`invalid-params`). A pattern matches `refs/heads/*` only.
  - **Longest id wins.** `.` and `-` are both id characters and separators, so `claude/T-12-1-impl`
    matches `T-12` and `T-12-1`. A branch maps to a ticket only when no other ticket of the
    same repository whose id is longer also matches it; the fact adapter, standard station
    functions, the local branch check and the branch-holder query all apply this. A child not yet
    posted cannot win yet: until its first snapshot the query maps its branch to the parent.
  - **The branch-holder query** (§9) maps a branch of git repository G only to tickets whose
    home is G or whose `repos:` entry for G is in the home's `code_repos`, and names only
    tickets of repositories the asking key is granted on; any other match answers
    `held_by_other: true`, with no ids.

## 4. Tickets, syncs and the board *(proposal)*

A repository describes itself in its `.baton/` folder. Its **sync** — `baton repo sync`, run by
a CI workflow, a cron loop or a runner (R-BTN-94, R-BTN-105) — reads the tickets and their
courses' evidence from git and posts a **board** to Baton. Baton keeps the board as a cache of
git at the posted commit (R-BTN-35) and orders boards by compare-and-set and observation
numbers. Tickets, positions and blocks are rebuilt from git; only owner state lives solely in
Baton, and it is exportable (R-BTN-88).

### 4.1 The `.baton/` folder and the registry

- **R-BTN-51 (the `.baton/` folder).** A registered repository describes itself in one folder
  at its root:

  ```
  .baton/
    baton.json          # baton_url; courses: [{id, version, min_runner_version, skill?, step_kinds,
                        #   report_horizon_h, branch_pattern, previous_branch_pattern?,
                        #   protocol_files, source?, facts?, route_choices?}]; imports?;
                        #   conditions? (bindings,
                        #   R-BTN-161); for the CLI's defaults (R-BTN-74): items, default_course,
                        #   repos, agent_command, agent_wrapper (B-95); check: {depends_line}
                        #   (B-111, `baton tickets check` alone reads it; default off)
    tickets.mjs         # optional ticket source; absent, the CLI's markdown source (R-BTN-74)
    ontology.json       # optional capability ontology and route choices; absent, none (R-BTN-174)
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
    settings, never legs.
  - `branch_pattern` (default `claude/{ticket}-*`; grammar in R-BTN-141) maps a pushed branch
    to the course's tickets for the branch-holder query (§9) and finds an earlier attempt's
    branch (R-BTN-25). Without `{repository}`, a branch may map to tickets of two repositories,
    and the query fails safe (a push is refused while either is held by another).
    `previous_branch_pattern` stays matched by the query and the local branch check until the
    course's author drops it.
  - `report_horizon_h` (default 6, at most 168): how long ended claims' reports stay in the
    fleet view (R-BTN-99).
  - `protocol_files`: the paths whose change bumps `version` (R-BTN-22).

- **R-BTN-48 (a ticket names its course; Baton does not know what the course does).**
  - Each repository's sync posts a **registry** from `.baton/baton.json`: per course its id,
    `version`, `min_runner_version`, skill, course file and the fields of R-BTN-51 (§4.4).
  - Each ticket names its course (markdown source: `course:`, default `default_course`, itself
    default `create-pr`).
  - Course logic runs outside Baton, in the sync's station function (R-BTN-39). Baton receives
    per ticket its station, path, the legs leaving the station with their state, what a waiting
    leg waits on, barred tags, the newest hand-off document and opaque course fields; it
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
    R-BTN-161; call children, R-BTN-165; outbox writes, R-BTN-171), and `withdraw(ticket,
    reason)`, which writes a withdrawal (R-BTN-168).
  - **Each course's station function**, `sync.mjs` in its course directory (own or the
    source's, R-BTN-134), default-exporting `stations(ctx)` → `stations`, `markers` and that
    course's opaque `course_data`, from git and the fact adapter's PR facts (R-BTN-96). The sync
    posts `course_data` keyed by course id. The marker courses' tickets carry their own record on
    their opaque `course` fields — the closes their git history holds and the frontmatter's
    machine state (B-100) — read from the ticket, never a second input.
  - `course.json` is always the commit's own (or its source's): the sync posts and `baton
    runner start` loads the same file.
  - **CLI default ticket sources** (`src/defaults/`), used when the repository has no
    `tickets.mjs`: **markdown** (below) and **`changes`**, one check ticket per open change
    (R-BTN-114). `baton repo init --eject tickets` copies the markdown source into `.baton/`; a
    repository leaves a default by adding its own file. Defaults are CLI code run in the sync,
    never core: `src/core/` may not import `src/defaults/`.
  - **The markdown source.** Every `*.md` or `*.mdx` under `items` (default `tickets/`) whose
    frontmatter has an `id` is a ticket:

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
  - **`baton tickets check [--repo DIR] [--quiet]`** (B-111) reads that source as a sync does — an
    ejected `.baton/tickets.mjs`, else the markdown default — and checks what it would post, without
    posting: the source's own refusal (a duplicate `id`, an unknown `repos` short name, an `order`
    that is not a number), the board post's validation (§4.4, the cycle among it), every
    `depends_on` naming a live or a closed ticket, and no cycle (named once or more, `B-1 → B-2 → B-1`). With
    `check: {depends_line: true}` in `.baton/baton.json` (default off) it also holds each markdown
    ticket's `**Depends on:**` body line — which runs to the next blank line or `**Label:**` line;
    a `**Used by:**` line is never read — to its `depends_on`, both ways; a ticket with no such line
    is not compared. Exit 1 with one `path: message` line per finding, 0 without; an unreadable
    root or a malformed `baton.json` is an error (exit 2). It reads; it never writes.
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
  1. `POST /v1/sync/observation` → `{sha, observation, bars, trusted_identities, code_repos,
     tainted_branches, provisional, held, behind_confirmed}`: Baton's head, a fresh observation number (R-BTN-62), the
     owner bars in force or scheduled (R-BTN-67), the trust inputs (R-BTN-139, R-BTN-140), every
     live ticket's tainted branches, the open-world claims' and held rows' `sha`s (R-BTN-104,
     R-BTN-11) and `behind_confirmed` (R-BTN-147) — before it reads anything else;
  2. fetches and sets `new` to `origin/<default branch>` (the registered branch), then reads PRs
     and code repositories, so everything posted was read after the number was handed out;
  3. checks the head is founded (R-BTN-147), then runs every course's `sync.mjs` — always, even
     when `new` equals the head, since evidence lives in PRs, reviews, checks and code
     repositories;
  4. posts the board (§4.4) with its number: `sha: new, parent_sha: head` when the head is an
     ancestor of `new`; a **refresh** (`sha` and `parent_sha` both the head: tickets unchanged,
     stations, paths, next legs and markers replaced) when `new` equals the head; when `new` is
     a strict ancestor of the head (a lagging fetch), nothing — it releases its number with
     `behind: new` (R-BTN-150) — unless the observation response says `behind_confirmed`, when
     it posts `force: true` (a reset of the default branch, R-BTN-147); when the head is
     unfounded, `force: true, head_unfounded: true`.
     Every exit that posts nothing releases its number.

  A post over R-BTN-149's caps is refused `too-large`. Baton materializes each accepted
  snapshot into `tickets`, upserting rows whose `row_hash` changed and deleting rows of tickets
  that left the board; its stations likewise write only the rows that changed (R-BTN-70), so a
  post costs rows written in proportion to what moved, not to the board's size (R-BTN-2). The protocol is the CLI's (`baton repo sync`); the repository supplies only
  its ticket source and station functions.

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
      (R-BTN-139), a failing ticket source (R-BTN-74), any error exit — gives its number back with
      `POST /v1/sync/observation {release: <number>, behind?: <sha>}`; the number is then voided.
      `behind` reports a lagging fetch (R-BTN-147).
    - **The bar.** A number **lapses** when it is voided for idleness or age, never posted or
      released; being voided at once by the sync key or CI identity is not lapsing. A credential that lets two numbers lapse within an hour takes none on
      that repository for an hour (`sync-busy` with `retry_after_s`) and raises
      `baton.sync-barred`. The bar never applies to the sync key or CI identity.
  - **A held history still refreshes stations.** A `force: true` post with a newer observation
    has its positions (station, path, next leg) and markers accepted as a refresh against the
    current head, while its commits are held (R-BTN-11); its gates are taken only where they
    tighten, and it closes nothing (R-BTN-147).

- **R-BTN-11 (snapshots advance by compare-and-set on ancestry).** Per repository, Baton accepts
  a snapshot only when `parent_sha` equals its head (a refresh: both equal the head) and its
  observation is newer, then moves the head. The first snapshot is accepted with `parent_sha:
  null` only while no head exists. A lost race is `head-moved`; the sync re-reads and retries.
  - **A `force: true` post is held**: one `held_snapshots` row per sha (sha, parent, the head
    it was held against, ticket count, first receipt, `auto_accept_at`, observation,
    `posted_by`; never the board). Repeats change nothing. The repository raises
    `baton.held-history`; an administrator accepts it on the dashboard
    (`POST /v1/ui/board/accept {repository, sha}`, confirmed by `baton admin confirm`,
    R-BTN-155), or the alarm accepts it at `auto_accept_at`, 24 hours after first receipt —
    only the repository's newest held row (by observation), and only while it is still held.
    - **Accepting adopts nothing by itself**: it sets `accepted_at` and drops the repository's
      other held rows (`held-dropped`). The next force post of that sha whose observation is
      greater than the last accepted one's is then accepted as a new-head post, with its own
      board; the alarm never moves the head.
    - **A held row is dropped** (`admin` event `held-dropped`) when an accepted post lists its
      sha in `contains` (the observation response's `held` asks): a sha behind the head is
      no rewrite.
    - At most 4 held rows per posting credential per repository (R-BTN-149).
  - While a history is held, claims continue on the old head; runners rely on R-BTN-143's
    verified-sha cache. Ordering never depends on a clock: a clock may accept a held row, but
    only a later-numbered post moves the head.

- **R-BTN-147 (a board names a head that exists; a held post only tightens).**
  - **The sync proves its head is founded.** After its full fetch, `baton repo sync` checks
    Baton's head against `new = origin/<default branch>` (after one fetch of the head's sha by
    name before declaring it absent). The head is **founded** when it is reachable from `new`, or
    `new` from it; **unfounded** when it is absent or the two have diverged, and only then the
    sync posts `force: true, head_unfounded: true`.
  - **A lagging fetch posts nothing.** When `new` is a strict ancestor of the head, the sync
    releases its number with `behind: new`. Baton keeps `board_head.behind_since`, the first such
    release since the head last moved (cleared when it moves). After 30 minutes behind —
    a reset of the default branch, not a lagging replica — the observation response says
    `behind_confirmed: true` and the sync posts `new` as `force: true` (no `head_unfounded`),
    which is held.
  - **A known sha is never adopted at once.** A force post whose `sha` is an accepted snapshot's
    (`board_snapshots`) is held whoever posted the head, until its held row is accepted
    (R-BTN-11).
  - **Baton's answer.** When the current head was posted by a machine key, a `head_unfounded`
    post by a sync key or CI token is accepted at once as a new head (a machine key's is held), logged as an `admin` event `head-replaced` naming
    both credentials, and raises `baton.head-replaced`. A head posted by a sync key or CI token
    is held (R-BTN-11).
  - **A held force post tightens, never loosens.** Besides R-BTN-62's refresh of positions and
    markers it applies to current rows only: from `tickets[]`, a raised tier, added `requires`
    or `depends_at`; from `stations`, tags added to `bars` (none removed), added `decisions`
    (none cleared) and a next leg turned from `ready` to `waiting` (never back); from
    `registry`, a raised `min_runner_version`, an added `stream: false`, and a lengthened
    `no_chain_from` or `requires`. Its `closed` list is ignored, and a ticket it omits is not
    dropped.
  - **Raised on any accepted or held post**, naming tickets, fields and posting key:
    - `baton.ticket-dropped` — the post (an accepted one; a held post drops nothing) drops, without listing it in `closed`, a ticket Baton
      holds state for (a claim, hold, backoff, open decision or condition, fence); an active
      claim on it ends `released:stale-board`, and its owner state is kept in a `closed_tickets`
      row `closed_as: dropped`, as a closing's is (R-BTN-12);
    - `baton.renumbered` — the post adds a ticket at the `path` of a ticket it drops; the new id
      takes the old one's hold, backoff and open-world bar (`admin` event `renumbered`);
    - `baton.station-jump` — on a ticket that has had a claim, the post moves it by an arrival
      no Baton claim ran (no `claim_legs` row of the ticket for it), other than a person's leg
      (R-BTN-116) or a Baton settlement; whoever posted, so a holder that writes a later leg's
      marker under its own nonce is noticed.
  - **Raised on a machine-key post** (beside R-BTN-102's `baton.machine-post`):
    - `baton.machine-loosened` — it loosens a course file (a lower `min_runner_version`; a
      shortened `no_chain_from`, `requires`, `protocol_files` or `entry`; a `stream: false`
      dropped; a timer lengthened or removed) or turns a person's leg into an agent's.

### 4.4 The board post

`POST /v1/sync/board` — the one normative schema:

```
{ sha, parent_sha, force?, head_unfounded?, observation,         -- R-BTN-11, R-BTN-62, R-BTN-147
  source: { kind: 'markdown' | 'custom', cli },                  -- R-BTN-148
  contains?: [<sha>],                                            -- open-world claims' and held rows' shas this post contains (R-BTN-104, R-BTN-11)
  bindings?: { <type prefix>: <course> | { course, replaces } },   -- the repository's scope, from `.baton/baton.json` (R-BTN-161, R-BTN-163)
  registry: [{ id, version, min_runner_version, skill?,
               course: <course.json with its schemas>,           -- R-BTN-69, R-BTN-108
               step_kinds, report_horizon_h?, branch_pattern, previous_branch_pattern?,
               route_choices?: { <leg>: [<route choice id>] } }],        -- R-BTN-177
  tickets:  [{ id,                                               -- local id
               course_id, path, title, tier?,                    -- tier: a name of the repository's `tiers`
               requires[], expedite, repos[], rank?,             -- requires expanded; repos are forge paths
               parent?, not_before?,                             -- R-BTN-86, R-BTN-89
               depends_at?: [{ ticket, at | reached | done, leg? }],   -- R-BTN-120
               conditions?: { <type prefix>: <course> | { course, replaces } },  -- bindings, R-BTN-161
               check?: { sha, head_repo_id, head_ref },          -- check tickets, R-BTN-153
               display: { status?, group?, project? },           -- shown, never read
               course: <opaque> }],
  closed:   [{ id, as: 'done' | 'withdrawn' }],                  -- tickets that left the board
  stations: { <local id>: {
               station, path: [{ leg, reached }], next_leg, next_source,   -- R-BTN-70, R-BTN-83
               not_before?, handoff_url?,
               ignored?: [{ ref, reason }],                      -- closing markers locate ignored
               outputs?: [{ leg, run, name, uri, digest?, leg_version?, ref, claim_nonce, validity }],  -- R-BTN-82, R-BTN-109
               next: [{ leg, state: 'ready' | 'waiting', waiting_on?, needs?: [<resource>], course: <opaque> }],
               decisions?: [{ id, leg?, asks, url?, severity? }],   -- R-BTN-78
               bars: { <leg>: [<tag>] } } },                     -- R-BTN-60
  markers:  [{ ticket, leg, ref, claim_nonce | null }],          -- trusted authors' markers on live tickets' PRs, and `branch` verdicts (R-BTN-46, R-BTN-96, R-BTN-139)
  markers_truncated?: [<local id>],                              -- tickets whose older markers were cut (R-BTN-149)
  course_data: { <course>: <opaque> },
  ontology?: { builtin?, program } | { error } }                 -- the merged ontology, or why the merge failed (R-BTN-174); absent, none
```

- Core reads every generic field and stores each `<opaque>` verbatim. Every station and leg
  named must be in the course file; a path that neither extends the previous one by course-file
  edges nor is shorter logs `off-graph` (R-BTN-39). Confirmations are not posted; Baton derives
  them from stations and paths (R-BTN-10).
- `requires` arrives expanded to capabilities (`none` or no clause is `[]`). `repos` are forge
  paths on the home's forge host (R-BTN-92), resolved by the sync from short names.
- Every ticket with a ready leg is ranked, a suspended one included.
- Markers are never refused: past R-BTN-149's marker caps the sync cuts the oldest and names
  the tickets in `markers_truncated`. A cut marker was posted by an earlier sync or loses only
  its `foreign-write` notice; markers gate nothing.
- A closing is recorded only from a post with a newer observation; a ticket that returns to the
  board clears it and gets its kept owner state back (R-BTN-12).
- A check ticket whose `check.head_repo_id` is not the repository's `forge_repo_id` is dropped
  (R-BTN-153).
- A post whose live tickets' `depends_on` form a cycle is refused `invalid-params`, naming it once
  as its path (`B-1 → B-2 → B-1`); an edge to a closed ticket, or to an id the post does not name,
  is no cycle here — the latter is `baton tickets check`'s finding (B-111). The interim shape's
  `state.items[].dependsOn` is the same graph and is refused the same way (B-111, round 1): no
  ticket source can post a loop, whichever shape it posts.
- Free text and identifiers are validated on write (§12.3).

### 4.5 Reading the ticket, and open-world claims

- **R-BTN-5 / R-BTN-34 (the runner reads and re-verifies the ticket from git).**
  - The claim response names the ticket's `path` and the `snapshot_sha` it was decided on.
    Before preparing any tree at the sha, the runner checks it is on the registered default
    branch (R-BTN-143, else `released:off-branch`). If `git cat-file -e <snapshot_sha>` fails or
    the file is absent, it fetches the default branch once, then releases `stale-board` if it is
    still missing.
  - The runner reads the ticket from `origin/<default branch>:<path>`, never the working tree,
    and takes body, exit criteria and PRs from that file. No ticket content travels through
    Baton.
  - It then checks the tier fits its ceiling and runs the course's `sync.mjs` (through the
    wrapper, from a verified tree at the claim's commit, R-BTN-133) on the ticket and its PRs at
    the fetched head, which must place the ticket at the claim's station with the offered leg
    leaving it. Anything else — closed, archived, re-tiered, a station git does not confirm —
    releases `stale-board`. This applies to every claim with a ticket file. Two kinds have
    none and are re-verified against Baton's record instead (the claim response's station,
    queued leg and `baton_held` flag), never against git: the built-in leg `baton.cancel`
    (R-BTN-168), which acts only on its compensations; and a ticket with no file — a Baton-held one (R-BTN-173) or a `changes` check ticket
    (R-BTN-114).

- **R-BTN-104 / R-BTN-148 (open world: a claim may name a ticket Baton has not seen).** A runner
  that creates or sees a ticket before any sync posts it may claim it at once.
  - **Request**: `ticket_id` (qualified), `course`, `leg`, `sha` (a commit on the remote default
    branch holding the ticket) and `declared: {tier?, requires: [], cli}` — the ticket's values
    at `sha` and the CLI version that read them; without `declared`, `invalid-params`.
  - **Unknown** means no `tickets` and no `closed_tickets` row. A known ticket is never claimed
    this way (refused as stale with Baton's head `sha`). A repository with no accepted snapshot
    takes no open-world claim; neither does a check course (R-BTN-153).
  - **Entry leg only**: `leg` is the course's `start_leg`. An entry leg carrying a required bar
    (R-BTN-67) is refused `not-eligible` (`required-bar`).
  - **Gates at the claim**: the lease (one active claim per ticket and per runner, and a sync
    since the last end on the id); the grant; `min_runner_version`; owner bars on the course and
    leg; the `requires` gate over `declared.requires` with the leg's `requires`; the tier gate
    against the lower of the runner's ceiling and the grant's `max_tier`;
    `no_chain_from` and `required_independence`; `api_keys` (§6, §8). A `kind: person` leg is
    refused. The posted-state gates — readiness, blocks, decisions, posted bars — are the
    runner's to check from the commit before it claims (R-BTN-5's station function), and
    Baton's at settlement.
  - **Provisional** (`claims.provisional`; shown so on the dashboard and fleet view; never
    recommended): the holder may make one `advance`, into `start_leg`, which starts the leg as
    any first `advance` does; a later `advance`, or any end but a release, is refused
    `provisional`. A key holds at most one provisional claim. The claim records a sync want.
  - **Response**: a claim's, with `station` the course's `start`, empty `path`, `snapshot_sha`
    the request's `sha`, `provisional: true`.
  - **Settlement.** The observation response lists the provisional claims' `sha`s; the board
    post answers `contains` with those that are its `sha` or an ancestor of it. The first
    accepted post containing a claim's `sha` settles it:
    - an **author gate** is a gate the claim judged over `declared` — the `requires` and tier
      gates — judged again over the posted ticket;
    - present at `start` (or past it by a path beginning with the claimed leg), every author gate
      passing → an ordinary claim, unless it is still at `start` and a **posted-state gate**
      fails for the claimed leg (not `ready`, a block, an open decision, a posted bar excluding
      the runner's tags) → `released:stale-board`, no failed attempt, the branch tainted when
      the settling post is at the claim's sha (the leg ran past a gate git already set);
    - under another course → `released:course-changed`; closed → as R-BTN-35 ends a claim on a
      closed ticket; absent → `released:unknown-ticket`;
    - at another station by another path → `released:stale-board`;
    - an author gate failing → the first matching row:

      | settling post | end | failed attempt | 24-hour bar on the ticket | branch tainted |
      |---|---|---|---|---|
      | at a later sha than the claim's | `stale-board`; raises `baton.open-world-stale` when the `requires` or tier gate failed | no | no | no |
      | from another machine key | `stale-board`; raises `baton.open-world-stale` | no | no | no |
      | without `source`, or `source.kind` not `markdown` | `stale-board` | no | no | no |
      | `markdown` at the claim's sha, `source.cli` equal to `declared.cli` | `misdeclared`; raises `baton.misdeclared` | yes, with backoff | yes | yes |
      | `markdown` at the claim's sha, another `cli` | `stale-board` | no | yes | yes |

      Any `declared.cli` is accepted at the claim.
  - **Timeout and bars.** A claim not settled within **60 minutes** ends
    `released:unknown-ticket` (actor `alarm`). An id whose claim ended `unknown-ticket` takes no
    open-world claim from any key for 24 hours (`open_world_bars` is per ticket; it is claimable
    as soon as a post contains it). A `sha` off the
    default branch ends `released:off-branch` at once (R-BTN-143).
  - Settlement ends are server-side (actor `server`); the holder learns of them from its next
    heartbeat's `release`. Only `misdeclared` is a failed attempt.
  - **A tainted branch** is recorded in `tainted_branches` and as `tainted: {claim, rule}` in the
    resume record (R-BTN-24), and raises `baton.tainted-branch`. The next claimant never
    continues it (it starts a fresh `-2` branch, R-BTN-25). The claim response and fleet view
    carry the ticket's tainted branches; standard station functions ignore PRs headed by one;
    the runner refuses to check one out and installs a `pre-push` hook refusing to push one.

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
    `spawned-unposted` (R-BTN-85). A Baton-held ticket's children are Baton-held, reported as
    `{local_id, course, input?}`, created by the end and never `spawned-unposted` (R-BTN-173).
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
  version, contract version, position, run number, `snapshot_sha`, `head_sha`); a position
  confirmed or replaced; a station or path no claim reported; a regression; a re-route; a block
  or unblocking; a decision or condition opened or closed; a call settled; a supersession; an
  outbox entry queued, delivered or confirmed (R-BTN-171); inputs given and outputs reported (an
  `inputs` row names its `leg_run_inputs` rows); `spawned`; `discrepancy`.
  - Rows hold names, ids, versions, pointers and digests only (R-BTN-33); `detail_json` at most
    2 KB.
  - Nothing is rebuilt from it; git stays the truth.
  - Kept while the ticket is live and 90 days after it closes: the alarm batch-deletes the
    history, `leg_outputs` and `leg_run_inputs` of tickets closed longer (found through
    `closed_unpurged`) and sets `closed_tickets.purged_at`.
  - Read with `GET /v1/repositories/{repository}/tickets/{ticket}/history?before=&limit=` (at
    most 200 a page) by the principals that may read the ticket's blocks, and on the dashboard's
    ticket view.

- **R-BTN-85 (every disagreement with git is logged before git wins).** When an accepted
  snapshot overrides something Baton holds, Baton logs, in the same transaction and before
  adopting git's value, an event and a history row of kind `discrepancy`: `{sub, baton: <value
  and its source>, git: <the snapshot's value>, observation}`. The subs:

  | sub | when |
  |---|---|
  | `position-replaced` | the posted pair differs from a holder's provisional position (R-BTN-83) |
  | `regressed` | a claim's path went backwards (R-BTN-35) |
  | `off-graph` | a path that does not extend by edges, or a closing marker `locate` ignored (R-BTN-39, R-BTN-83) |
  | `bars-mismatch` | posted bars lack a tag the holder declared (R-BTN-63) |
  | `foreign-write` | a marker whose nonce names no claim on the ticket (R-BTN-46) |
  | `closed-under-claim` | a ticket closed while a claim is active on it |
  | `spawned-unposted` | a reported child the first snapshot after the end does not post (R-BTN-86) |
  | `route-overridden` | a station change clears a Baton-held position override (R-BTN-83) |
  | `choice-lost` | a post shows another leg's arrival from a settled choice station (R-BTN-166) |

  Git wins at once, except `choice-lost`, which is logged and not adopted. A discrepancy
  accompanies the events those cases log; any condition a case raises is its owning rule's. The
  dashboard lists discrepancies by sub and age.

### 4.8 Owner state

- **R-BTN-88 (owner state is exportable; git holds the board).** Baton rebuilds the board from
  git. **Owner state** lives only in SQLite (R-BTN-66); the tenant's administrator exports it
  and imports it into another Baton.
  - **Format** `baton.owner-state/v1`: `{format, schema_version (highest applied migration),
    exported_at, origin, events_seq, sections, digest}`; `digest` is SHA-256 over the RFC 8785
    canonical JSON of the rest. `sections` holds every column §13 gives these tables:
    `repositories` (every setting), `repository_owners`, `credentials`, `sync_keys`,
    `runner_grants`, `runners` (with `secret_hash` and `incarnation`; import writes
    `last_seen_at` 0), `owner_bars`, `ticket_overrides`, `closed_tickets`, `external_resources`,
    `resource_instances`, `instance_serves`, `couriers`, `instance_readings` (administrators' rows in
    force), `check_runners`, `mcp_keys` (hashes only), `instance_settings`, unexpired
    `registration_tokens` (hashes only), open `conditions`, `ticket_timers` and git-kind `outbox` entries
    not `confirmed`.
  - **Not exported**: claims, events, `forge-check` entries, instrument readings, sync wants; and, unless
    `--with-history`, the history, `leg_outputs` and `leg_run_inputs`, which an import without
    them loses.
  - **Import** (`POST /v1/admin/import`): one transaction, into an **empty** Baton only (no
    repository, owner or credential but the seeded `legacy` row), else `conflict`; digest checked (`invalid-params`); the
    same `schema_version` required. Every row passes the write path's validation and invariants
    (one role per key, unique names, id grammars, tombstones only on retired rows); the first
    failing row refuses the whole import. Signed requests with `created` at or before the
    source's `sealed_at` are refused `unauthenticated`. Ticket-scoped rows wait in
    `pending_owner_state` until the first snapshot that creates their ticket; one the
    repository's first snapshot does not post is dropped and logged. The event sequence continues
    from `events_seq`.
  - **Moving a Baton**:
    1. **freeze** (`baton admin freeze`, `POST /v1/admin/freeze`; `baton_settings.frozen_at`,
       event `frozen`): new claims and owner writes are refused `frozen`;
       `POST /v1/admin/unfreeze` (event `unfrozen`) undoes it before the seal;
    2. **seal** (`baton admin seal`, `POST /v1/admin/seal`) once no claim is active and every
       repository with a mirror (R-BTN-93) has `mirror_acked_seq` at the last event; else
       `conflict` naming the claims and lagging mirrors, whose dispatch adapters it pushes. The
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
    (R-BTN-5) and an open-world claim (R-BTN-104) — through the wrapper (R-BTN-133) in a
    read-only, verified worktree of the **whole** commit, as working directory; never in
    `ctx.checkout`.
  - **A source** is `courses[].source` = `<provider>/<namespace>/<repository>/<commit>/<path>`:
    `<commit>` all 40 hex characters, never a branch or tag; `<path>` relative, with no `.` or
    `..` segment, its last segment the course id. `github` (→
    `https://github.com/<namespace>/<repository>.git`, names compared without case) is the only
    provider. The short `id` is the name tickets, rows, rule 9 and branch patterns use. A course
    with no `source` is the repository's own. The CLI configuration's `sources:
    {"github/<ns>/<repo>": "<url>"}` (`--config` of `baton runner start`, `baton repo sync`,
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
  - **The home of a sourced course** holds its entry (`id`, `source`, its `route_choices`
    (R-BTN-177), and only other fields it sets on purpose) and only overrides under `.baton/courses/<course>/`: `legs/<leg>.run.<ext>`
    (R-BTN-131) and `legs/<leg>.md`. Any other course file there beside a `source` fails the
    sync, naming the file.
  - **The entry is merged at read time, never copied:** the source's `entry.json` (any
    `courses[]` field of R-BTN-51 but `id`, `source` and `route_choices`, which are the home's
    alone), then the home's fields over it. A
    runner re-reads `entry.json` at startup and after each fetch of its home's default branch.
    `entry.json` may name `min_cli`, the leg-module version its code needs: the sync and init
    refuse a source above the running CLI's version, naming both; a runner ends the claim
    `released:cannot-finish:capability` in preparation.
  - **`facts`** in the entry names what the CLI reads for the station function: `prs` (R-BTN-96)
    and `branches` (git refs); markers are always read.
  - **Every reader goes through the snapshot:** the sync reads `.baton/baton.json` at the commit
    it posts (R-BTN-105), the runner at the claim's `snapshot_sha` after R-BTN-143's check,
    re-verification and open-world claims at the commit they verify — so Baton, runner and
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
    functions of `trusted_sources` (`baton repo sync --config`, default
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
  | `short_waits` | course | `waiting_on` labels a holder waits on under its claim instead of suspending, compared as strings | R-BTN-72 |
  | `stations`, `legs` | course | maps of id → station, id → leg | R-BTN-69 |
  | `conditions` | course | declared condition types: `{<type>: {disposition, restarts?, default?, wait_s?, retryable?, light?, description?}}` | R-BTN-160, R-BTN-173 |
  | `capability_types`, `capability_roles` | course | the capability types its legs may require, and named lists of capabilities | R-BTN-121 |
  | `rank_advice`, `rank_launch` | course | schema ids (R-BTN-108) that `rank.mjs`'s `advice` and `launch` must meet; absent, they are dropped | R-BTN-152 |
  | `label` | station, leg | display text | — |
  | `renamed_from` | station, leg | the earlier name this one carries over | R-BTN-64, R-BTN-142 |
  | `entry` | station | outputs any leg arriving here must have produced | R-BTN-109 |
  | `choice` | station | `"first"`: every leg leaving it is armed, and the first whose prerequisites hold wins | R-BTN-166 |
  | `from` | leg | the stations it leaves | R-BTN-69 |
  | `to` | leg | its outcome station, or list of them; for `kind: call`, a completion table | R-BTN-83, R-BTN-165 |
  | `kind` | leg | absent: run by a runner; `person`: a person answers in git; `call`: files children of its `spawns` courses and waits for them; `compensation`: undoes another leg, outside the graph | R-BTN-116, R-BTN-165, R-BTN-168 |
  | `asks` | leg | for `kind: person`, a label of who answers; the decision posted on the leg carries it | R-BTN-116 |
  | `max_runs` | leg | how often one ticket may run it | R-BTN-63 |
  | `max_queue` | leg | queue depth that raises a warning, 1–10,000 | R-BTN-79 |
  | `version`, `inputs`, `outputs` | leg | its contract | R-BTN-82 |
  | `replay_safe` | leg | `false` when it has side effects outside git and its forge | R-BTN-82, R-BTN-84 |
  | `requires` | leg | prerequisites: `{tickets?, capabilities?, resources?}` | R-BTN-120 |
  | `retry` | leg | its retry policy | R-BTN-122 |
  | `timers` | leg | deadlines, interrupting or not, and any override of core's default timer | R-BTN-167 |
  | `after_s` | leg | on a leg leaving a choice station, a time prerequisite from the ticket's arrival there, 60 s–30 d | R-BTN-166 |
  | `compensate` | leg | the `kind: compensation` leg that undoes it | R-BTN-168 |
  | `conditions` | leg | narrows the condition types it may raise (`[]`: none) | R-BTN-160 |
  | `answers` | leg | `true`: a delivery leg that reports replies; `false`: it only notifies | R-BTN-173 |
  | `spawns` | leg | the courses of the children it files (for a call leg, the courses it calls), their contract and their `lifetime` | R-BTN-111, R-BTN-165, R-BTN-168 |
  | `no_chain_from` | leg | legs whose credential may not take this one on the same ticket | R-BTN-106 |
  | `stream` | leg | `false`: its output is never written to a leg log | R-BTN-128 |
  | `max_context`, `max_refreshes` | leg | context fraction (0.1–0.95) that triggers a fresh session, and how many | R-BTN-123 |
  | `check_command` | leg | a check course's verdict command: an argv, with `timeout_s` (default 1800, ≤ 7200) | R-BTN-153 |

  - **Validation.** Baton accepts a file only if: `start` names one station; `end` names at
    least one; no leg's `from` names an end; every `from`, `to` and completion-table key names
    a station; every station is reachable from `start` through any outcome, and an end is
    reachable from every station; every cycle contains a leg with `max_runs`; `start_leg` names
    a leg whose `from` includes `start`; every `inputs.from` names a leg and one of its outputs;
    every `kind: compensation` leg has no `from` or `to` and is no leg's `from`, `to`, `next` or
    completion `next`, and every `compensate` names one; every `kind: call` leg has `spawns` and
    a completion table (R-BTN-165); every `requires.tickets` entry selects `parent` or `posted`
    (R-BTN-120); every timer has R-BTN-167's shape; `after_s` sits only on a leg leaving a
    choice station, within a timer's range (R-BTN-166); `renamed_from` passes R-BTN-142; every
    capability is typed (R-BTN-121) and `runner:leg-trees` is listed where R-BTN-133 needs it;
    its schemas pass R-BTN-108. It refuses the fields `error_types`, `max_duration`,
    `max_attempts_s` and `max_ready_s`, whose meanings are conditions and timers (R-BTN-160,
    R-BTN-167); `isolation`, which is the capability `runner:session` (R-BTN-107); a leg's
    `call`, which is its `spawns` (R-BTN-165); `checks`, which is the owners' setting
    (R-BTN-114); and `retry.non_retryable`, which is a type's `retryable` (R-BTN-160). A file
    that fails keeps the previous one in force and raises `baton.course-refused`.
  - **Edges carry no conditions.** Which outcome a leg reached is a git fact the station
    function evaluates (R-BTN-39), never part of the file. Parallel work inside a leg is the
    leg's own business; parallel tickets are children (R-BTN-86).
  - `baton.cancel` (R-BTN-168) is the built-in leg, run by the runner's own code; its dotted
    name cannot collide with a course's. It is queued only as a held position (R-BTN-83), leaves
    whatever station the ticket is at, is `ready` while held (no sync posts it), requires
    `runner:baton-legs` (its `requires`, for rule 4 and R-BTN-126) and reports no position. Rule
    9 binds it, since it runs the course's compensation legs.

### 5.3 Where a ticket is, and how it moves

- **R-BTN-70 (where a ticket is).** For every live ticket the sync posts its **station**; its
  **path** (the legs run so far, in order, each with the station it reached, as git evidences
  them); its **queued leg** with its `next_source` (R-BTN-83); for each leg leaving the station
  the ticket may still run, `ready` or `waiting` (with a `waiting_on` label); and the barred tags
  of each leg it knows them for (`ticket_bars`, per leg name). A ticket at an end station is
  done. Core stores this as a cache each accepted snapshot overwrites (R-BTN-39), writing only
  the station, next-leg and bar rows that changed: a row the snapshot leaves as it is stays
  unwritten, and counts as shown by that snapshot's observation (S-BTN-188). It recommends a
  `ready` leg, and never computes a station. The claim response, every heartbeat and every
  `advance` response show the holder the latest snapshot's station, path and next legs.
- **R-BTN-83 (a leg ends in a position: the station it reached and the leg it queues).**
  - **Outcomes.** A leg's `to` lists its possible outcomes; which one a run reached is a git
    fact the leg writes.
  - **The pair.** Every finishing leg reports a **position** `(reached, next)`: `reached` one
    of its outcomes, `next` a leg whose `from` includes `reached` — null at an end, required
    elsewhere. A suspension or release reports one too: at the outcome reached, or at the
    `from` it gave up with the leg itself as `next` unless the holder names another leg leaving
    it (then `close` writes a closing marker too). Nothing is inferred from a station having one
    leg out. A new ticket's queued leg is `start_leg`, `next_source: course`.
  - **Git first, then reported** (R-BTN-8). The runner validates the pair and the outputs
    (R-BTN-82), then calls the leg script's `close(ctx, result)`, which writes the run's one
    **closing marker** (position and output pointers, in the course's convention), then reports
    with `advance`, `end` or a suspension. An agent leg pushes only its evidence.
  - **Provisional, then confirmed.** Baton stores the reported pair at once as the queued leg
    (`next_source: holder`; a settled call likewise, `call`, R-BTN-165). The station function
    posts the pair from each run's last closing marker by a trusted author (R-BTN-139)
    (`marker`), confirming or replacing Baton's (`position-replaced`, R-BTN-85). A marker whose
    pair is not an edge is ignored, its `ref` posted in the station's `ignored` list. Work git
    shows without a pair gets an inferred position (`inferred`), shown as such on the dashboard.
  - **Held positions.** A position Baton decides is held as an override in `ticket_overrides`
    that wins over the posted pair until the ticket's station changes (cleared by the snapshot
    or advance that moves it), is in the ticket's history and the owner-state export, and is
    written to git by the queued leg's own run. Two are the exception, and clear on their
    write's own event: `cancel`, the built-in leg, when a snapshot posts the ticket withdrawn or
    closed (R-BTN-168); and `outbox`, which queues no leg but waits on a courier (R-BTN-171), when
    a snapshot posts the handler ticket (or, for a withdrawal, posts it withdrawn or closed). The kind is the `next_source`: `route`, the
    owner's `baton owner route <ticket> <leg>` to any leg leaving the station (a station change
    clearing it is the discrepancy `route-overridden`); `retry`, a retry policy's `exhausted` leg
    (R-BTN-122); `choice` (R-BTN-166); `timer` (R-BTN-167); `cancel` (R-BTN-168); `outbox`
    (R-BTN-171).
  - **The queue is the queued leg.** A ticket waits in exactly one queue, its queued leg's
    (R-BTN-79), and matching rule 1 offers that leg alone, `ready` or `waiting` as posted —
    except at a choice station, where every leg is armed (R-BTN-166). A queue, not a
    reservation: whoever claims passes every gate then.
  - **Course changes.** A renamed queued leg resolves through `renamed_from` (R-BTN-64). A
    queued leg that the course in force does not have leaving that station is stored `waiting` on
    `course-changed` (overriding the posted state) when Baton accepts the course file or such a
    snapshot (which it does not refuse), raising `baton.course-changed`, unless the station
    function maps it to a leg that is. A leg added later changes no queued leg.
- **R-BTN-63 (an advance follows an edge, on the holder's word).** A claim **is at** a station
  — the last one it reached — and may be **running** one leg.
  - When claimed, it is at the ticket's posted station (recorded as `start_path`) and runs
    nothing.
  - `advance {reached, leg}` finishes the running leg, if any, at `reached` — one of its
    outcomes, else refused `off-graph` — records the position, then starts `leg` if it leaves
    `reached`, the ticket's runs of it are fewer than its `max_runs`, and every holder gate holds
    (matching rules, §6: grants, holds, barred tags with owner bars that apply at advances,
    required bars, prerequisites). The first `advance` starts the first leg; every leg a claim
    runs has its own `advance`. Baton records each leg a claim starts and finishes
    (`claim_legs`).
  - **Baton's traversal record counts.** A ticket's runs of each leg and arrivals at each station
    are counted from Baton's own record — every leg a claim ran (`claim_legs`) and every arrival a
    snapshot confirmed, under resolved names (R-BTN-64) — never from the posted path alone.
    `max_runs`, attempts (R-BTN-122) and retries read these counts. A snapshot whose path shows
    fewer runs than Baton recorded does not lower them: git still places the ticket (R-BTN-35),
    and the disagreement is logged `path-rewritten` (R-BTN-85). So an agent that rewrites a
    ticket's history in git cannot buy its legs more runs.
  - The holder pushes a leg's evidence before the `advance` that finishes it, and may pass
    `bars`, tags it bars from the new leg, which only add to the posted bars. A later snapshot
    posting that leg's bars without a tag the holder declared is the discrepancy
    `bars-mismatch` (R-BTN-85) and raises `baton.bars-mismatch`; the sync's reading binds from
    then on.
  - Baton does not check a leg's state: which leg comes next is a git fact the holder judges
    and the next sync shows. A loop is a leg taken again; a leg no sync has posted yet is fine.
  - An `advance` is checked against the newest snapshot's course file.
- **R-BTN-71 (a suspension rests at a station).** A claim that stops ends
  `suspended:<station>`: the outcome its running leg reached if that leg finished, else the
  leg's `from` (the claim's current station); any other station is refused. The end carries the
  queued leg `next` (R-BTN-83). A sync observed after the end confirms it when its path
  **extends the expected path** — `start_path` followed by the claim's finished legs with the
  stations they reached — that is, begins with it and continues, if at all, by course-file edges
  in order, each arrival beyond it a person's leg (R-BTN-116) or a Baton settlement (R-BTN-10);
  any other arrival beyond it raises `baton.station-jump` (R-BTN-147) and leaves the suspension
  unconfirmed, so a holder cannot run past its last `advance` unseen. A suspension made while
  the claim is regressed is confirmed by any later snapshot. The next claimant starts where the sync places the ticket. (A leg waiting in its
  claim on a raised condition is a different thing, R-BTN-162.)
- **Off-graph and regression.** Between two accepted snapshots a ticket's new path must extend
  the old by course-file edges in order from the old station, each reaching one of its outcomes
  (several may land between two syncs), or be shorter; anything else is the discrepancy
  `off-graph` (R-BTN-85). A path shorter than the previous accepted snapshot's or the claim's
  `start_path` is a **regression**, flagged and never acted on by Baton: it sets the claim's
  `regressed_since` from the first such snapshot; the heartbeat's `git` carries `regressed: true`
  and the posted path; the runner aborts the leg and suspends (R-BTN-72); `baton.regressed` is
  raised once `regressed_since` is 30 minutes old; `regressed_since` clears when a later path
  extends the expected path again, and at the claim's end. A path no shorter than git's last
  that has not caught up with the holder's advances is lag. Calls, choices, timers and
  cancellations move a ticket only along edges.

### 5.4 Legs are queues

- **R-BTN-79 (legs are queues; a course may bound them, as a warning).** Leg L's **queue**, per
  repository, is the tickets of L's course whose queued leg is L (ready or waiting, blocked or
  not) and that are not held (R-BTN-75). Baton keeps its depth in `leg_queues`, changed in the
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
  - **Git first, confirmed by the sync.** The closing marker lists the outputs; the sync posts
    each with its marker's `ref` and `claim_nonce`. An output is recorded only if its nonce names
    a claim on the ticket (`leg_outputs.claim_id`); any other is the discrepancy `foreign-write`
    and never resolved as an input. Markers by untrusted authors are never outputs (R-BTN-139).
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
    in `schema`. Core reads the envelope only, and a reading's `detail` only to form R-BTN-176's
    typed atoms.
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
  - **A sync-posted arrival** — a path extended by a leg no claim reported, a person's leg among
    them (R-BTN-116) — is checked the same way when the snapshot is accepted.
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
  | `std:decision@1` | `{id, option, answered_by?, commit}`, a person's answer (R-BTN-116) |
  | `std:condition@1` | a handler's input (R-BTN-161) |
  | `std:restart@1` | a `suspend` handler's output, refining `std:decision@1` (R-BTN-161) |
  | `std:api-capacity@1` | `{window_s, remaining_permille, resets_at_min?}`, integers: a quota's window, what remains of it in ‰ (0–1000), and its reset in epoch minutes. The library's one open schema (`additionalProperties` not `false`), because a provider's resource schema refines it by adding fields; a reading's `detail` is bounded by size (R-BTN-76) (R-BTN-176) |

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
    through `textContent`). Courses never ship rendering code.
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
    bars follow <course>`, which rewrites the stored names to the file's, or by changing the
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
    role expands to its list once (roles do not nest). Baton accepts the file only if every
    capability a leg lists, after expansion, is of a declared type with a matching value, or is
    built-in. A role naming `human-operator` or another role holds the file (R-BTN-157); so does a
    role named a vocabulary name — a capability, `human-operator` or `none` — which would redefine
    that name for legs only. A course may not declare a type named `runner` or `human-operator`.
    Whether a type is derived is the repository's ontology's (R-BTN-174), never the course file's.
  - **Built-ins:** `human-operator`, a runner's own statement that a person operates it, which
    Baton cannot verify and grants admit like any capability (R-BTN-58), and the type
    `runner` (R-BTN-133). `credential:<NAME>` names an environment variable a leg receives only
    when it requires it (R-BTN-144).
  - A course's types and roles are served with its course file (`GET
    /v1/repositories/{repository}/courses`) and shown on the **Courses** view, which lists every
    type two courses define differently.
  - **The runner declares what it has** in its configuration (`baton runner start --config`,
    default `~/.config/baton/runner.json`): `{origin, capabilities: [{name, check?: [<argv>…],
    every_s?}]}`. A capability with a `check` is declared only while the command exits 0 (run at
    start, before each claim, and every `every_s` seconds, default 300, while idle). Capabilities
    are self-reported (R-BTN-66).
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
- **R-BTN-64 (in-flight tickets survive a course change).** Where a ticket is, is replayed from
  git (R-BTN-39), so a new course file must place every live ticket from the evidence the old
  one left; `baton course test` replays every live ticket under it before it merges.
  - **Renames.** A renamed station or leg carries `renamed_from`. When Baton accepts the file it
    rewrites every active claim's `station` and `leg` to the new names, and from then on resolves
    every old name it meets — an `advance`'s requested leg, `start_path`, `claim_legs` — to the
    station or leg whose `renamed_from` names it. In the same transaction it rewrites every
    per-leg record keyed by an old name to the new one: `leg_attempts`, `ticket_timers`,
    `ticket_blocks`, `leg_needs`, `ticket_next_legs`, `ticket_bars` and a held position's
    `route_leg` and `route_station` (§13). Runs count toward `max_runs` under the resolved
    name; attempts, backoffs, armed timers, blocks and held positions carry over unchanged.
    Bars do not follow renames (R-BTN-142).
  - **Removals.** A claim whose station or leg the new file lacks, even under a rename,
    keeps its lease; its heartbeat says `station: unknown`; the session finishes or abandons the
    work, writes its hand-off and ends `released:course-changed` — not a failed attempt, needing
    no confirmation — and the next claimant starts where the sync places the ticket. Removing a
    station or leg must raise `min_runner_version`; `baton course test` fails a change that
    does not.
  - A ticket keeps no record of the course version it started under: git's evidence is the
    record.
- **The test kit.** `baton course test <repository root> <course> [--config <file>]
  [--bindings]`, run by a home repository's CI on a PR that changes `.baton/` (how that job is
  configured: R-BTN-133), starts a local Baton, posts the PR's board with the proposed `.baton/`,
  replays every live ticket's legs under it, fails when one moves backwards without its evidence
  changing, and runs the generic scenarios (§15, S-BTN-28) against the course. It needs no
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
    agent that exits 0 with no PR (B-81), and a marker course's close must fail a ticket its leg
    mangled — no heading for the leg, a broken item schema, a machine field of the wrong shape —
    naming the rule (B-100);
  - refuses a retry policy naming an undeclared type and warns where the owners' bounds cut a
    course's policy (R-BTN-122); refuses a timer outside R-BTN-167's shape, naming the leg and
    the field; refuses a `suspend` binding to a course that does not produce `std:restart@1`
    (R-BTN-161);
  - prints the signature (R-BTN-111), the capability types and roles (R-BTN-121) and, for a
    check course, its end stations for the owners' `conclusions` (R-BTN-114); with
    `--bindings`, each raisable condition type's resolution and scope (R-BTN-161).
- **A course can see how it performs.** `GET /v1/repositories/{repository}/stats`, readable by
  any key granted on the repository (R-BTN-58), returns over a window: per station and leg, how
  long tickets waited and legs ran; claims by end and detail; suspensions by station and what
  they waited on; `off-graph` transitions; foreign writes; each course's signature and queue
  depths against bounds. Aggregates and ids only — no profiles, no reports.

### 5.8 The standard courses

- **R-BTN-131 (the standard courses).** Their `agent_command` wrappers and leg instructions read
  `BATON_ADVICE` first when the repository attaches route choices to the leg, and fall back to
  their configured models
  (R-BTN-177). The baton repository ships course directories at
  `src/defaults/courses/<id>/` (R-BTN-134), adapted from docs' skills with docs-specific content
  left out. A repository scaffolds one with `baton repo init --course <id>` and needs no course
  code of its own. "Standard" names where they live, not a privilege: the CLI reads them as any
  source. They assume no particular deployment and are written for `landing: cooperative`; a
  course that relies on a deployment's own architecture and threat model (reviewers on clean,
  separate trust domains, tests in a trusted executor, signed authorship) is that deployment's,
  kept and sourced from its own repository: Fieldhouse's is FLDH-41. Their shared code is copied into each directory by `npm run courses`, checked in, and
  checked current by the baton repository's CI. Their legs require `runner:leg-trees`.

  | Course | Legs (`from` → `to`) | Ends | Reads |
  |---|---|---|---|
  | `create-pr` (the default) | `implement` (`filed` → `pr-open`); `review` (`pr-open`, `fixed` → `reviewed`, `max_runs` 3); `fix` (`reviewed` → `fixed`, `max_runs` 2); `adjudicate` (`reviewed` → `adjudicated`); `merge` (`reviewed`, `adjudicated` → `merged`) | `merged` | PRs |
  | `review-pr` | `review` (`requested`, `changes-requested` → `approved` \| `changes-requested`, `max_runs` 3); `conclude` (`requested`, `changes-requested` → `concluded`) | `approved`, `concluded` | PRs |
  | `bug-report` | `trace`, `origin`, `dedupe` (→ `new-cause` \| `duplicate`), `file` or `fold`, `prevent` (`reported` → … → `closed`) | `closed` | markers |
  | `draft-ticket` | `research`, `draft`, `check` (`requested` → `researched` → `drafted` → `filed`) | `filed` | markers |
  | `decision` | `prepare` (`raised` → `asked`); `carry-out` (`asked` → `decided`) | `decided` | markers |
  | `build-app` | `define`, `design`, `architect`, `plan` (`requested` → `defined` → `designed` → `architected` → `planned`); `file` (`planned` → `building`, a call leg); `verify` (`building` → `shipped` \| `building`, a call leg, `max_runs` 3) | `shipped` | markers |
  | `create-spec` | `converse` (`requested` → `spec-open`, an interactive leg that suspends); `review` (`spec-open` → `reviewed`, `max_runs` 4); `address` (`reviewed` → `spec-open`, an interactive leg that suspends, `max_runs` 3); `adjudicate` (`reviewed` → `adjudicated`); `merge` (`reviewed`, `adjudicated` → `merged`) | `merged` | PRs and the interactive legs' markers |
  | `spec-to-tickets` | `decompose` (`reading` → `drafted`); `check` (`drafted` → `checked`); `file` (`checked` → `filed`) | `filed` | markers |
  | `epic` | R-BTN-124 | `integrated`, `abandoned` | children |
  | `branch` | R-BTN-96 | R-BTN-96 | branches |
  | `ask`, `deliver`, `announce` | condition handlers (R-BTN-169) | R-BTN-169 | — |

  A course whose course file carries `starts_from: request` (a closed set: `request` alone) is entered by `baton request` — `create-spec`, `build-app` and `spec-to-tickets` do; an ordinary course keeps its hand-filed tickets. `baton request "<one sentence>" --course <course>` files ONE request ticket into `<items>/<ID>.mdx` (§2f R-BTN-74's source; the next free id under the repository's own prefix — the commonest among its ticket files — across the folder and `archive/`), the sentence as its `title` and `description`, `course:`, `status: available` and `tags: [request]`, and pushes it as one commit — `<ID>: request — <the sentence> — <course>` — straight to the default branch (§2f; `--branch`, else the checkout's `origin/HEAD`, else `main`), made in a throwaway worktree so the caller's branch, HEAD and working tree are untouched and retried on a moved head, up to six tries. It is a repository command, not an API call: the push triggers the sync (§7.1), the board places the ticket at the course's `start` with its `start_leg` ready, and the next claim starts the course (§6.1). It refuses a course `.baton/baton.json` does not list (R-BTN-74's sync would refuse the ticket) and a course without `starts_from: request`, each as one line.

  - **A wait for a person's answer is a person's leg** (R-BTN-116), shown in git by the
    ticket's `answer:` (a sync-local field of the markdown source, read by the station
    function and never posted, R-BTN-74; never applied unless the owner gave it): one before `decision`'s `carry-out`, one after `create-pr`'s `adjudicate`
    answers `owner`, and one after each of `build-app`'s four drafting legs, approved by
    setting `answer:` to the stage's name.
  - **The PR courses.** A ticket's PRs are those in `prs:` plus same-repository PRs, open or
    merged, whose head matches `branch_pattern` or `previous_branch_pattern` (R-BTN-51,
    R-BTN-141), in the home or a `repos:` repository (R-BTN-140), and no other. Several PRs are
    one change; a leg over several counts once on the path. `create-pr`: no PR is `filed`; a PR
    closed unmerged counts as none; `review` waits on `ci` until every open PR's checks finish;
    a **verdict** is the forge's review state or a trusted (R-BTN-139) comment whose first line
    is `<!-- baton:verdict approve|changes -->`, queuing `merge` or `fix`; a push after it
    reaches `fixed`; all merged is `merged`; when fixes run out and the last round asks for
    changes, `adjudicate` is queued if the file has it, and a trusted `<!-- baton:adjudicated
    merge|owner -->` is its answer. `review-pr` reviews a PR named in `prs:`: each trusted
    verdict is a round; after changes the next waits on `author` until a push; on close or when
    rounds run out `conclude` is queued, and a trusted `<!-- baton:concluded -->` is that leg.
    A commenting leg's answer line may name its PR (`<answer> <PR URL>`; `conclude`'s the URL
    alone); `close` comments there, else on the checkout branch's PR.
  - **The marker courses** open no PR. **The ticket is the record (B-100)**: each leg commits
    its work to the default branch under its own `## <leg>` heading in the ticket's body, and
    `close` writes the machine state — `station`, `next_leg`, the closing claim's `claim` nonce —
    into the ticket's own frontmatter and pushes the ticket alone on the default branch, retried
    whole when the remote moved, at most three times. Before committing, the close validates the
    ticket: its frontmatter against the repository's item schema (`item.schema.json` beside the
    tickets), the machine fields' types, and the leg's own heading — trust nothing the agent
    touched, check everything the machine reads; a violation fails the leg naming the rule, and
    a forged `station:` is simply overwritten (the close is the one writer per ticket). The path
    is the ticket's own git history — every `baton:close <id> <leg>` commit, oldest first —
    skipping non-edges and legs past `max_runs`; the queued leg is the last close's `next` if it
    leaves the station (`marker`), else the first leg listed (`course`). A checkout git cannot
    answer for has no close history, and the frontmatter state a one-time migration wrote stands.
    `.baton/markers.jsonl` — the shared file every runner once appended to, with its union-merge
    attribute — is retired; `baton repo migrate-markers` replays a board's in-flight lines as
    closes (one `baton:close` commit per line, the line's state in the ticket's frontmatter —
    a `create-spec` conversation's lines included, their state being nowhere in the forge) and
    deletes the file, once; B-87 (the retried close's duplicate lines) closed superseded:
    per-ticket state written once per claim cannot re-append.
  - **`spec-to-tickets`** (B-99) takes one merged specification — entered by `baton request`
    (`starts_from: request`), the sentence naming the spec; a `create-spec` conversation's merged
    PR is the usual input — and files its child tickets. `decompose` drafts one ticket per spec
    section or numbered decision into the request under its own heading, each with its tests and
    exit criteria drafted from the spec's own words; `check` holds the set against the spec (every
    requirement covered exactly once, no ticket without a section, dependencies drawn as the
    spec's order implies) and fails rather than covering a gap; `file` commits the children
    `parent:`-ed to the request (R-BTN-86), the request's `status:` to `done`. The owner deciding
    against filing withdraws the request — a ticket status, not a course station: the filed
    children are ordinary tickets on their own courses.
  - **`build-app`**'s drafting legs each write one document under `product/<ticket id>/` —
    `PRODUCT.md` (numbered acceptance criteria), `DESIGN.md` with mock-ups, `ARCHITECTURE.md`,
    `PLAN.md` — with open questions and recommendations. `file` and `verify` are call legs
    (R-BTN-165) with `"spawns": {"course": "*"}`, each child on the course the plan names
    (`create-pr` by default):

    ```json
    "file":   { "from": ["planned"],  "kind": "call", "spawns": {"course": "*"},
                "to": { "building": {"of": "all", "closed": true, "next": "verify"} } },
    "verify": { "from": ["building"], "kind": "call", "spawns": {"course": "*"}, "max_runs": 3,
                "to": { "building": {"of": "all", "closed": true, "next": "verify"},
                        "shipped": null } }
    ```

    `file` files the plan's tickets and settles at `building` once all have closed. `verify`
    checks every criterion and reports `shipped`, or files fix children and settles at
    `building` again once they close. A third verification that still fails files nothing,
    posts a decision for the owner and ends `released:blocked` on it (R-BTN-126).
  - **A wait outside the claim suspends:** a leg whose next leg waits on someone the claim
    cannot wait for returns `suspend: true` with its pair, ending the claim there (R-BTN-72).
  - **A leg that suspends into the owner's hands leaves its record in the ticket.** An
    interactive leg (`create-spec`'s `converse` and `address`) is the owner's own session, which
    Baton neither runs nor waits for inside a claim; the PR facts alone cannot tell it from one
    whose work has not landed, so the leg's `close` — never the agent — writes the leg's machine
    state into the ticket's own frontmatter and pushes the ticket to the default branch
    (B-100). `prClose` writes it through git plumbing, never through the checkout's own branch:
    fetch the default branch, read the ticket at it, validate and write the frontmatter over the
    text it fetched, build the tree on a temporary index at git's own path for it, `commit-tree`
    it onto the fetched head and push `<commit>:refs/heads/<default>` — retried whole when the
    remote moved. So a checkout left on a PR's branch, detached at a claim's snapshot, or itself
    a linked worktree still reaches the branch a sync reads, and `HEAD`, the index and the
    working tree are never touched. The id is the ticket's bare local id, never the claim's
    qualified one; the branch is the claim answer's `default_branch`. The station function reads
    the ticket's closes — its own history — beside the PR facts, and each is a
    signal, never a step: no posted path carries it, so the board sees no path off the graph (§2e).
    `converse` closes at `reached: "requested"`, `next: "review"` as the
    claim ends before the owner's session starts, so one such close for the ticket means the design
    conversation is under way: `converse` then waits on the `owner` and is not offered again while
    the close stands, the path staying empty until the PR lands and the next reading places it at
    `spec-open`; a ticket with no such line is ready for `converse`, its dependency and child waits
    as any start leg's. `address` writes `{ticket, leg: "address", reached: "reviewed"}` as an
    address round's claim ends, and the station function compares the ticket's `address` lines with
    its timeline's `address` steps: one more line than steps means the round's claim ended and its
    work has not landed, so `address` waits on the `owner`; the push that lands the amendment adds
    the step and the leg is ready again at `spec-open`. A PR closed unmerged counts as none (as for
    `create-pr`): a `converse` line with no PR keeps the ticket waiting on the owner — closing a PR
    is no answer the board can read, and a second `converse` would be a second conversation, so the
    owner reopens it or files a fresh request. An `address` PR closed unmerged lands the same
    way — the ticket comes back to `requested` with `converse` waiting on the owner, its marker
    still there — so a closed spec never becomes a `review` with no PR to read. `create-pr`'s `implement` leaves no marker: it is headless and
    opens its PR inside the claim, so it leaves the PR itself, which `verify: "pr"` refuses a claim
    without.
  - The standard courses declare `error.no-answer` (`interrupt`, `retryable: false`, R-BTN-162).
  - **Stubs** run the repository's `agent_command` (R-BTN-74) with `BATON_COURSE`, `BATON_LEG`,
    `BATON_TICKET_FILE` and `BATON_INSTRUCTIONS` (the source's `legs/<leg>.md` or the home's
    override, at the claim's snapshot); a result-dependent leg reads the agent's last line
    (`BATON_ANSWER`) and checks it against the course's values. The read is tolerant of prose and
     strict about the answer (B-85): scanning backwards from the output's last non-blank line, the
     first line that **begins** with one of the course's values as a whole word is the answer, with
     at most one PR URL after it on that line (prose before or after it fails nothing); a value
     word mid-line only is not an answer, and no such line fails the leg, naming the value wanted
     and the last line read. The spawn is shell-free (B-84):
    the command string splits into words as `sh` would — quotes, no substitutions — and runs as
    `execFile(command, args)` with the ticket id, the leg and the checkout appended, stdin never
    an open pipe (a closed fd — nothing to read), stdout and stderr captured pipes. A repository's
    `agent_wrapper` — or a host's `BATON_AGENT_WRAPPER`, which wins — is one more command, split
    the same way, whose words precede the agent's argv (B-95): Baton composes it and builds
    nothing in its place (no capture, upload, retention or redaction), and the instruction
    file's header names the precedence. The instruction file's header carries that contract for
    `agent_command` authors, with the
    completion rule it closes: the command's exit **is** the agent's, so a harness whose client
    can exit before its work (a client of a background service) must run its session in process
    (`opencode run --standalone`, or the equivalent) — else its truncated output fails the leg
    while an orphaned session outlives and out-posts its claim. A leg whose stub claims a PR on
    the forge — `create-pr`'s `implement` — verifies it there before returning its position (B-81):
    an open PR on a branch its course's `branch_pattern` maps to the ticket, in the checkout's
    repository or one the ticket's `repos:` names (B-29), and the checkout's branch, when it feeds
    such a PR, a head the PR contains — the review reads what is pushed. What cannot be verified
    fails the leg naming what was looked for; the stub reports, never retries. The test kit fails
    such a stub that returns its position for an `agent_command` exiting 0 with no PR.
  - **Overrides replace `run`, never `close`.** A home's `legs/<leg>.run.<ext>` exports
    `run(ctx, standard)`; the leg script imports it from the leg tree at the claim's snapshot and
    calls it instead of its own `run`, keeping its own `close`. Its position must be an edge
    (the runner refuses one before `close`). The kit fails an override naming no leg, exporting
    no `run`, or beside a leg script that does not load it from this course's path. An override
    keeps the leg's contract `version`; `snapshot_sha` names the bytes that ran.
  - **A runner serves every course its capabilities serve, one leg at a time.** `baton run`
    declares every course its home checkout declares (`--home`) — each at its version, rule 9 per
    course — and `--course <id>` narrows that to one, a machine serving a subset; a `--course`
    naming a course the home does not declare is refused at startup, and so is a home held by
    another live runner (`baton-runner.lock` in its git directory). The claim answer's
    `course_id` names the ticket's course, which the runner loads from the claim's
    `snapshot_sha`: consecutive claims of one runner — a `create-spec` `converse` and the next
    claim's `create-pr` `implement` — run their own course's graph and scripts with no restart
    and no second clone. Its only parallelism limit is one leg at a time, at least for now (rule
    3, one claim per worker).
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
  - Its stubs call the repository's `agent_command`; the planning prompt is the repository's. A
    repository that wants the plan approved first adds a person's leg (R-BTN-116).

### 5.9 The capability ontology *(proposal — B-104)*

- **R-BTN-174 (the ontology: holdings derive capabilities, per repository).** A runner's
  declared capabilities are its **holdings**. A repository's **ontology** derives further
  capabilities from them. So a leg may require an ability (`capability:code-generation-llm`) or
  a model (`model:claude-opus-5-5`), while runners declare only what they hold (`key:anthropic`,
  `dependency:claude-code`). A holding is a label: a key the runner has is a course type such as
  `key` (`^[a-z0-9-]{1,64}$`), declared while its `check` passes (R-BTN-121), and the ontology
  never changes a leg's environment (R-BTN-144). Baton never stores a credential, learns what a
  name means, calls a provider or checks a holding: every holding, and every derived capability,
  rests on the runner's own statement (values 12).
  - **Derived types.** The ontology names the capability types it derives, in its file's
    `derived` list. A course declares a type's `values` for the legs that require it (R-BTN-121);
    whether the type is derived is the ontology's business alone, so a course sourced from
    another repository (R-BTN-134) never conflicts with it. `credential`, `runner` and the bare
    `human-operator` are never derived. A derived type may still be declared directly, so a
    machine may simply hold `capability:code-generation-llm`.
  - **The file, and the built-in it names.** A repository has an ontology only when its default
    branch's head holds `.baton/ontology.json` (R-BTN-51); with no file there is none, and a
    runner's capabilities are its holdings. The file may name a built-in by version,
    `"builtin": "baton@<n>"`. The CLI ships each version under `src/defaults/ontology/`, and a
    published version never changes. The sync merges the two:
    1. it starts from the named built-in's entries, route choices and `derived` list, or from
       nothing;
    2. it drops those whose ids the file's `retract` lists;
    3. it replaces each one whose id the file reuses, a reused route choice id replacing the whole
       route choice, and a replaced entry keeping its built-in position;
    4. it appends the file's other entries and route choices, in file order, and adds its `derived`
       types.

    Ids are one namespace across entries and route choices. A merge cannot be made when the CLI
    lacks the named version, a reused id changes kind (entry for route choice, or the reverse),
    `retract` names no built-in id, or an id is both retracted and reused. The sync then posts
    `ontology: {error: <reason>}` and the rest of the board as usual.

    The sync posts the result as the board post's `ontology: {builtin?, program}` (§4.4); with
    no file it posts no `ontology` field. The program's digest is the SHA-256 of its RFC 8785
    canonical JSON, which core computes. Every CLI therefore posts the same program for the same
    commit. Core never merges: it validates what is posted and evaluates it.
  - **Acceptance, with the course entries.** A post's ontology **unit** is its program (the
    posted one; none when the field is absent) together with its course entries' `route_choices`
    (R-BTN-177). A unit is accepted or refused whole, at each post. It is accepted when the
    program validates (R-BTN-175), and the course entries that would be in force (a removed course
    gone) attach only route choices the program defines, to legs their course files have.
    Otherwise:
    - the program stays in force, and so does the previous value of the `route_choices` field of
      every entry where it changed. Every other field of the entry, and the course file, are
      accepted with the board as usual;
    - `baton.ontology-refused` is raised, naming the entry, course and rule (or the merge's
      `error`). It closes when a unit is accepted.

    The state in force was consistent before the post, and nothing in it changes unless the
    whole unit is accepted, so it stays consistent. A post whose unit equals the one in force
    changes nothing. An accepted program without a route choice drops its `route_last` rows.
  - **What a runner has for a repository.** Let H be its declared capabilities ∩ its grant there
    (R-BTN-58), together with its declared `runner:` capabilities (R-BTN-133). Let D(H) be every K
    with `derived(K)` in the program's answer set over `holds(K)` for each K in H. The runner's
    capabilities there are H ∪ D(H). Rule 4 reads it through `gatesFor` (`src/core/gates.ts`),
    which B-104 amends to take holdings and derived capabilities apart: the grant is checked
    against holdings only, and requirements against H ∪ D(H). The vendored `isEligible` (R-BTN-37)
    changes the same way, in docs first. `fleet_capabilities` counts it
    (R-BTN-75), and the model (R-BTN-68) receives it as the runner's capabilities. The ontology's
    evaluation sits outside both, and is checked by its own conformance suite (R-BTN-175).
  - **Grants bound holdings, never derivations.** A capability gate matches what a runner can
    do, not what it may do. Authority lives in grants and `runner:`, which are never derived
    (R-BTN-175). So a grant bounds H, and the ontology then says what H amounts to. A program
    that derives an ability a runner lacks only offers that runner legs it cannot finish, as a
    false declaration would (R-BTN-66). A grant that names a derived capability admits a runner
    that declares it directly. The fleet view (R-BTN-99) and the dashboard show each runner's
    derived capabilities beside its tags.
  - **Current, or brought up to date before it is read.** D(H) is stored in `runner_derived`,
    at most 256 capabilities per runner and repository, with its **input digest**: the SHA-256 of
    the program's digest and the sorted H restricted to the program's string constants, the only
    holdings that can take part. A set is current when its input digest matches the runner's H
    and the program in force now. A heartbeat, a grant change, an end that removes a holding
    (R-BTN-126) or a program change only makes sets not current; no write evaluates them.
    - **A read brings the reader's sets up to date first**, in a transaction of its own that
      commits whether or not the request succeeds. A claim, an `advance` and a why-not evaluate
      the one repository they concern. A recommendation evaluates at most two repositories'
      sets that are not current. It leaves out the legs of any repository whose set is still not
      current, rather than offer them from a stale set, and prompts the alarm.
    - **The alarm cycle** brings every live granted runner's sets up to date (below).
    - An evaluation that crosses its bound stores an empty set marked `limited` under its input
      digest, and is not retried until that digest changes.

    A runner's advice is therefore never older than the last write Baton accepted for it: a leg
    is offered from a current set or not offered yet. Rule 4 never reads a set that is not
    current, and no request evaluates more than two sets. An `advance` re-checks rule 4 against the
    current set, so a program change can refuse a holder's next `advance`, as a lost declaration
    can. The alarm brings every live granted runner's sets up to date, writing only rows that
    change, which count against the repository's write budget (R-BTN-149). An **alarm cycle** is
    that run of back-to-back alarm turns: each spends at most 1,000,000 matches, never starts an
    evaluation it could not finish within R-BTN-175's bound, and yields to requests between
    turns. Fleet-wide views — `fleet_capabilities`, `capability` blocks, `unblocked` wake-ups,
    the fleet view and the dashboard — are recounted when the cycle ends. A non-live runner's
    rows go 30 days after it was last live, and a revoked grant's rows go with the grant. A
    change to `runner_derived` bumps the repository's `fleet_version` (R-BTN-99).
  - **Canonical proofs, and why not.** R-BTN-175's evaluator is fully determined, and each
    derived atom's first derivation is the rule instance that first produced it. Its body atoms
    were all produced in earlier rounds, so each atom has exactly one finite proof, a directed
    acyclic graph over atoms: its **canonical proof**. For a capability X of a derived type that a
    leg requires, a `missing-capability` answer (the blocks index, `baton leg why`) gives
    `why: not-derived` with:
    - `needs`, the distinct holdings of X's canonical proof in the maximal evaluation (R-BTN-175),
      sorted;
    - `missing`, those of them the asking runner does not declare, and `ungranted`, those it
      declares that its grant does not admit (both omitted for the fleet);
    - `chain`, the distinct entry ids met in a depth-first walk of the proof from X, visiting
      each atom once and its body atoms in body order.

    The answer is computed on read from the program in force, memoised in the object by digest;
    it is advice and stores nothing. The walk is linear in the proof's size, at most 5,000 atoms.
    Declaring X directly, where the grant admits it, satisfies it too, and the answer says so.
    When the maximal evaluation has no proof of X, the answer is `why: not-derivable`: no holdings
    derive it under this program. It is one canonical route, not a search, and not a guaranteed
    minimum.
- **R-BTN-175 (the ontology language, its validation and its bounds).** **A Baton ontology is a
  safe, stratified ASP-Core-2 program of ground facts, normal rules and integrity constraints
  over string and integer constants, with default negation and the comparison built-ins, and
  with no disjunction, function symbols, arithmetic terms other than a negative integer
  constant, or aggregates. It is the fragment whose programs have exactly one answer set,
  computed bottom-up, stratum by stratum.** Its only other construct is R-BTN-177's generated
  route-choice encoding, with which a program has exactly one optimal answer set. A construct joins
  the language only by a change to this rule that names the ASP-Core-2 construct it adopts.
  - **Serialization.** The file is `{version: 1, builtin?: "baton@<n>", retract?: [<id>…],
    derived?: [<type>…], entries: [<entry>…], route_choices?: [<route choice>…]}` (route
    choices: R-BTN-177). Each entry has an `id` matching `^[a-z][a-z0-9-]{0,63}$`, unique among
    the program's entries and route choices, and takes one of three forms:
    - `{id, fact: [<pred>, <constant>…]}`;
    - `{id, head: [<pred>, <arg>…], body: [<literal>…]}`;
    - `{id, constraint: [<literal>…]}`.

    A literal is `[<pred>, <arg>…]`, `{"not": [<pred>, <arg>…]}` or `{"cmp": [<term>, <op>,
    <term>]}`, with `<op>` one of `= != < <= > >=`. The file and the merged program are each at
    most 64 KB. The `derived` list never names `credential`, `runner` or `human-operator`.
  - **Terms.**
    - A predicate matches `^[a-z][a-z0-9_]{0,31}$`, is not `not`, and has one arity.
    - A variable is `$` followed by `[a-z][a-z0-9_]{0,31}`.
    - A string constant matches `^[A-Za-z0-9:._/@-]{1,128}$`.
    - An integer is 32-bit signed.
  - **Reserved predicates.** These are core's:
    - `holds/1` and R-BTN-176's atoms, which core forms;
    - R-BTN-177's encoding predicates `alt/3`, `alt_needs/3`, `lacks/2`, `available/2`,
      `blocked_alt/2`, `route/2`, `demoted/2` and `excluded/2`, which only the translator writes.

    `derived/1` and `meters/2` are written by the repository, with string arguments. The gate
    stratum may read `holds`, and a route choice's guards may read R-BTN-176's atoms. A reserved
    predicate may never be a repository head, and the encoding's may never appear in a
    repository body or guard.
  - **Validation** refuses a program that breaks any of these:
    - **Safety.** Every variable of a rule, constraint or generated guard rule occurs in a positive
      body literal that is not a comparison.
    - **Types.** Every argument position of every predicate has one type, string or integer. It
      is declared for reserved predicates, and inferred elsewhere by propagating types from facts,
      constants and heads, through variables shared between positions, to a fixpoint. A position
      that receives both types is refused; one that receives none holds no atom and is typed
      string. `< <= > >=` compare two integers, and `=` and `!=`
      compare two values of one type.
    - **Strata.** The predicate dependency graph has no cycle through a negated literal, with the
      generated guard rules (R-BTN-177) included. Positive recursion is allowed.
    - **Constraints** range only over predicates that depend on no core-formed atom. They are
      checked at validation, and a violated one refuses the program.
    - **The gate stratum** is `derived/1` and every predicate it depends on. "Depends on" is
      reflexive and transitive. In it:
      1. no negated literal names a predicate that depends on `holds`;
      2. every variable of a `holds` literal also occurs in a positive literal of a predicate that
         is not core-formed;
      3. nothing depends on R-BTN-176's atoms or on R-BTN-177's encoding;
      4. every `derived` atom is a string `<type>:<value>` whose type is in the program's
         `derived` list. Its value need match no course's `values`: a course whose pattern rejects
         a capability cannot require it, so such an atom is inert for that course.

      By 1 and 2 the gate stratum's result is monotone in H, and every term in it is a constant
      of the program. A rule meant to accept a capability whether it is declared or derived names
      both, `holds(M)` and `derived(M)`, in two rules. Validation therefore evaluates it once, with
      every string constant of the program held: the **maximal evaluation**. Every runner's D(H)
      is a subset of it, and condition 4 and the 256-capability limit are checked on it.
    - **Every predicate is placed.** A repository predicate that depends on `holds` is in the gate
      stratum, so it reaches `derived`, or the program is refused. One that depends on R-BTN-176's
      atoms is in the route-choice stratum (R-BTN-176). Every other predicate is fixed, `meters`
      included unless a rule makes it depend on R-BTN-176's atoms; the gate stratum may read only
      fixed predicates besides its own.
    - **Fixed predicates**, those that depend on no core-formed atom, are evaluated within the
      maximal evaluation and under its bounds, the constraints over them included. Their result
      is stored with the program (`ontologies.fixed_json`, at most 5,000 atoms), and later
      evaluations read it as facts.
  - **The evaluator**, `src/core/ontology.ts`, is pure and fully determined:
    - strata are evaluated in topological order of the dependency graph's strongly connected
      components, ties broken by the smallest entry index;
    - within a stratum, round 0 applies every rule in entry order to the full relations, and
      each later round is semi-naive. A round's new tuples join the relations only when the
      round ends, so every rule instance reads atoms produced in earlier rounds;
    - in a later round, a rule is applied once per positive body literal *i* over the stratum's
      own predicates: literal *i* reads the last round's new tuples, earlier literals the
      tuples from before that round, and later literals every tuple;
    - body literals are taken in the order validation fixed: positive literals as written, then
      each comparison and negated literal as soon as its variables are bound;
    - each relation is scanned in insertion order. A stratum's facts are inserted in merged entry
      order before its round 0, and `holds` tuples in the sorted order of their capability
      strings;
    - in a later round, rules are taken in entry order, and each rule's literals *i* in body
      order.

    The input is H restricted to the program's string constants. By condition 2 no other holding
    can take part, so the result is the same, and no evaluation reads more input than the maximal
    one.

    A **match** is one tuple tried against one literal, or one comparison or negation test.
    Interpreting a program this total and bounded is not running repository code (R-BTN-98): it
    has no I/O and always terminates, like a course file.
  - **Bounds.** Both are counted, never timed, so both hosts stop at the same point.
    - A program has at most 512 entries and alternatives counted together. Each rule, and each
      guard as a rule, has at most 8 body literals and 4 variables.
    - The maximal evaluation, fixed predicates and constraints included, may derive at most 5,000
      atoms in at most 200,000 matches.
    - Any other gate evaluation may make at most 400,000 matches, since a smaller input does not
      always cost fewer matches.
    - A route-choice evaluation (R-BTN-177) may make at most 50,000 matches.

    The load test (G-BTN-77) runs evaluations at these bounds against R-BTN-87's latency budgets.
    An evaluation that crosses its bound yields nothing — H alone for the gate stratum, which
    fails closed, and no advice for a route choice. It raises `baton.ontology-limit` once per
    repository and program digest, and the condition closes when another program is
    accepted.
  - **Narrowing is default negation.** A binding is a fact. A repository narrows a class of
    models by ASP's default-with-exception idiom, which the built-in ships (ASP-Core-2
    notation):

    ```
    model_for(C, M) :- binding(C, M).
    bound(C)        :- binding(C, M).
    model_for(C, M) :- model_class(C), model(M), not bound(C).
    :- binding(C, M1), binding(C, M2), M1 != M2.
    derived(M)      :- offers(K, M), holds(K).
    derived("capability:code-generation-llm") :-
        model_for("coding", M), offers(K, M), holds(K), usable_with(D, M), holds(D).
    ```

    With no binding for `"coding"`, every model the program lists serves the rule.
    `binding("coding", "model:claude-opus-5-5")` narrows it to Opus. `bound` depends on no
    holding, so negating it keeps condition 1.
  - **Conformance.** `src/defaults/ontology-asp.ts` translates a program to ASP-Core-2 text:
    constants as quoted strings, `$m` as `V_m`, and no gringo-only syntax. `npm test` runs every
    fixture under `test/fixtures/ontology/` through `clingo-wasm`, pinned exactly as a
    devDependency. Each run calls `run(text, 0)` with the fixture's holdings as facts and a
    harness-only `#show derived/1.`. It asserts:
    - `Result` is `"SATISFIABLE"` with exactly one model (`Models.More` is `"no"`);
    - that model's `derived/1` atoms equal the evaluator's;
    - once empty strings are dropped, the only warnings are clingo's `info:` notices "atom does
      not occur in any rule head" and "no atoms over signature occur in program".

    A refused fixture must be refused by the validator. A strict-syntax test parses every
    emitted program with a parser written from the ASP-Core-2 grammar for the productions the
    fragment admits, so a production outside the fragment fails it. The suite runs in vitest's
    Node project (`clingo-wasm` needs `worker_threads`), and it reads `Models.Optimal`, which
    `clingo-wasm`'s result type omits, through a cast. A test's lowered bounds reach the core
    only through the test bindings in `vitest.config.ts`, as test keys do. clingo never runs on
    a host (R-BTN-68's posture).

## 6. Prerequisites, blocks and advice *(partly built — B-7, B-10, B-21, B-41, R3-1259, R3-1269)*

A leg starts when its prerequisites hold. Baton stores each unmet one as a block, answers "why
not" from that index, gates claims on the blocks safety needs, and advises on the rest.

### 6.1 Prerequisites

- **R-BTN-120 / R-BTN-132 (a leg's prerequisites, one way in for each kind).** A leg can start
  when every prerequisite holds. Each kind has exactly one way in:

  | Kind | Declared by | Holds when | Unmet, it is |
  |---|---|---|---|
  | station | the leg's `from` (R-BTN-69) | the ticket is at one of them | nothing: only legs leaving the ticket's station are offered |
  | ticket | the leg's `requires.tickets`; the ticket's posted `depends_at` | the selected tickets are where the entry says | a `ticket` block |
  | capability | the leg's `requires.capabilities`; the ticket's posted `requires` clause (every leg) | the runner declares each and is granted it, or derives it (rule 4, R-BTN-174) | a `capability` block |
  | resource | the leg's `requires.resources`; the sync's posted `needs`; a `blocked` end | a usable instance is not `unavailable` (R-BTN-76) | a `resource` block: advice, unless the requirement binds as a gate (R-BTN-181) |
  | decision | a posted decision (R-BTN-78) | the ticket source stops posting it | a `decision` block |
  | retry | the leg's `retry` policy (R-BTN-122) | `retry_after` has passed | a `retry` block |
  | condition | a `suspend` raise past its wait (R-BTN-162) | the handler closes, or an owner resolves it | a `condition` block |
  | attestation | the leg's `requires.attestations` (R-BTN-181, proposal) | an unconsumed, unlapsed attestation of the type, from a writer the requirement names, binds the subject and meets `where` | an `attestation` block: a gate, unless the requirement binds as advice |
  | call | a `kind: call` leg's run (R-BTN-165) | the call settles | a `call` block |
  | time | `not_before` (R-BTN-89); a choice leg's `after_s` (R-BTN-166) | Baton's clock passes it | a stored `waiting` state (`not_before`) or an armed `ticket_timers` row (`after_s`), not a block |

  ```json
  "deploy": { "from": ["approved"], "to": "deployed",
    "requires": {
      "tickets":      [{ "select": "parent", "reached": ["planned"] }],
      "capabilities": ["deployer", "db:orders:rw"],
      "resources":    ["llm:deepseek-v4-flash"] } }
  ```

  - **Ticket entries.** `select` is `parent` (optional `course`, else the leg's own) or
    `posted` (the ticket's posted `depends_at: [{ticket, at | reached | done, leg?}]`; `leg`
    binds one leg of this ticket, absent every leg); the validator refuses any other `select`.
    The children a call leg's run spawned are its completion table's range, never a
    `requires.tickets` entry (R-BTN-165). Each entry has exactly one of `at: [<station>…]` (a
    selected ticket is at one now), `reached: [<station>…]` (its path contains one), `"done":
    true` (closed `done` at any end station, kept as `closed_tickets.final_station` and
    `final_path`), `"withdrawn": true` or `"closed": true` (closed either way). A withdrawn ticket meets only `withdrawn` and
    `closed`; `"skip_withdrawn": true` drops it from the selection instead. An empty selection holds only with `"allow_empty": true`. Entries select
    tickets of the same repository (R-BTN-86); Baton evaluates them from the stations and paths
    it stores. `baton course test` checks that each named station exists in the selectable
    course.
  - **The ticket source decides which dependencies are open** and posts only those; Baton keeps
    no second dependency store. The default markdown source translates `depends_on: [<id>]` to
    `{ticket: <id>, done: true, leg: <start_leg>}`. `parent` is a link, never a block; a leg
    that waits for children it starts is a call leg (R-BTN-165).
  - **Unmeetable entries fail closed.** A `parent` entry with no parent, a `posted` id Baton
    has not seen, or an entry a withdrawn ticket leaves unmet keeps its block and raises
    `baton.prerequisite-unmet`. When an accepted snapshot's ticket prerequisites form a cycle
    (selected tickets as edges), Baton keeps every block and raises `baton.prerequisite-cycle`
    naming the tickets.
  - **Capabilities** are stored expanded through R-BTN-121's `capability_roles`; no role name is
    stored. `human-operator` is an ordinary capability in `ticket_requires`, checked by rule 4,
    which a runner declares and a grant admits (R-BTN-121); a source translates its own words for it
    (docs' `OP` tag) into the clause.
  - **Pairs that join.** The ticket's clause and a leg's `requires.capabilities` join for that
    leg; the posted `needs` and a leg's `requires.resources` join. A station's `entry`
    (R-BTN-109) checks an arrival's outputs, not whether a leg may start.
  - **`waiting_on`** names only a wait no kind covers (an author's push, CI's `short_waits`, a
    forge effect), shown under `other`. The snapshot validator refuses `dependencies`,
    `children`, `owner` and `policy`, naming the ticket. Baton stores a posted label prefixed
    `course:` and reserves `time`, `not-before-invalid`, `input-missing`, `input-version`,
    `course-changed`, and `policy` for an unmet required bar (R-BTN-67).
  - **Why a leg cannot start.** `GET
    /v1/repositories/{repository}/tickets/{ticket}/prerequisites[?leg=<leg>][&runner=me]`
    (default the queued leg) and `baton leg why <ticket> [<leg>]` return `{leg, ready,
    prerequisites: [{kind, ref, met, why, since?, until?, url?, found?}]}`, every prerequisite
    met or not, `end`-sourced resource needs included:

    | Kind | `why` when unmet |
    |---|---|
    | station | `not-at`, with where the ticket is |
    | ticket | `not-at`, `not-reached`, `not-done`, `not-closed` (with where the other ticket is), `withdrawn`, `no-parent`, `unknown-ticket` |
    | capability | `no-live-runner`; with `runner=me`, `not-declared` or `not-granted`; for a derived type, `not-derived` with `needs`, `missing` (with `runner=me`) and `chain` (R-BTN-174) |
    | resource | `unavailable`, with `until`; `busy`, with the holder where the asker may see it (R-BTN-178) |
    | decision | `open`, with `url` and `asks` |
    | retry | `backing-off`, with `until` and `attempt: <n> of <max>` |
    | condition | `open`, with the handler ticket, or the claim's `condition-wait` activity |
    | call | `open`, with the run's children |
    | attestation | `missing`, `other-subject` (one exists for another commit), `writer-not-allowed`, `consumed`, `lapsed`, `revoked`, `failed-where` |
    | `other` | a hold and its `hold_reason`; a `waiting_on` label; `time` with `not_before`; owner bars on every live runner's tags; an unconfirmed end (R-BTN-10) |

    It reads the blocks index and, for `runner=me`, rule 4 for that runner, never the board. A
    runner key granted on the repository, its owners and a dashboard session may ask; the
    dashboard's **Ready** (§11) shows it for a ticket no runner is eligible for.

### 6.2 Blocks

- **R-BTN-75 (blocks are stored, not recomputed).** A block is one unmet prerequisite, a row of
  `ticket_blocks` (repository, ticket, leg or `''` for the whole ticket, `kind`, `ref`, `since`,
  `until`, `found`, `provisional`, `binds`) written in the transaction that causes it, so asking reads one
  repository-scoped index. This is the one list of block kinds:

  | Kind | `ref` | On | Written | Binds |
  |---|---|---|---|---|
  | `ticket` | `<ticket>@at:<station>,…`, `@reached:…`, `@done`, `@withdrawn` or `@closed` | its leg; the whole ticket for a `depends_at` without `leg` | rewritten when a referenced ticket's station or path, or an entry's selection, changes (index `ticket_dependents`) | refuses a claim and an advance (rule 1) |
  | `capability` | the capability | its leg, or the whole ticket for the clause | when the fleet count crosses zero | refuses each runner lacking it (rule 4) |
  | `resource` | the resource; `until` the first instance back | its leg | when the fleet counts flip (R-BTN-76) | advice; refuses a claim and an advance (rule 1) where its requirement binds as a gate (R-BTN-181) |
  | `decision` | the decision id | its leg, or the whole ticket | while posted (R-BTN-78) | refuses a claim and an advance (rule 1) |
  | `retry` | the leg; `until` = `retry_after` | its leg | by a failed attempt (R-BTN-122) | refuses a claim and an advance (rule 10) |
  | `condition` | the `condition_id` | its leg | by a `blocked` end (R-BTN-162) | refuses a claim and an advance (rule 1) |
  | `call` | the run's `claim_legs` seq | its leg | by a `blocked` end (R-BTN-165) | refuses a claim and an advance (rule 1) |
  | `attestation` | the requirement's `type` | its leg | when an attestation it reads is posted, revoked, consumed or lapses, or the leg's requirement changes (R-BTN-181) | refuses a claim and an advance (rule 1) where its requirement binds as a gate; advice otherwise |

  - **Held and blocked.** A ticket is **held** while it has an active claim, a completed claim
    not yet confirmed, or a fence-pending reap (rule 3's claim checks; R-BTN-79 uses the same
    definition). It is **blocked** when not held and it has a whole-ticket row or a row on its
    queued leg (R-BTN-83); rows on other legs do not block, and a ticket with no queued leg is
    not blocked. Baton evaluates this once per transaction, after the last row change and any
    owed `unblocked` (R-BTN-77), into `tickets.blocked_since`.
  - **Provisional rows.** A `ticket`, `decision` or `condition` row written by a `blocked` end
    carries `provisional` = the commit that wrote its fact to git. It refuses a claim and an
    advance into its leg and keeps the leg out of recommendations, but does not count toward
    `blocked_since` (writing or dropping it is no transition) and arms nothing (R-BTN-166). The
    first accepted snapshot whose head contains the commit (R-BTN-104) replaces it with what it
    shows; a row not so confirmed within 1 hour, or not shown, is dropped and logged
    `prerequisite-unconfirmed`.
  - **Not blocks.** `other` lists what else keeps a ticket from being offered: a hold (§6.8), a
    `waiting_on` label, a `time` wait, owner bars on every live runner's tags (R-BTN-67), an
    unconfirmed end (R-BTN-10), `no-instance` (R-BTN-76). Core's `baton.retries`,
    `baton.contract` and `baton.stalled` (R-BTN-163) write no row: a hold or the posted wait
    already keeps the ticket.
  - **Capability rows follow a count.** `fleet_capabilities` counts, per (repository,
    capability), live runners that declare and are granted it, or derive it (R-BTN-174) (a
    `runner:` capability needs the declaration only, R-BTN-133). It changes when a runner
    registers, changes its declarations, stops being live or is reaped, and when a grant is
    made, changed or revoked, for the capabilities it declares; derived capabilities' rows are
    recounted when their sets become current (R-BTN-174). Rows are rewritten only when a count crosses zero, for the tickets
    requiring it (`ticket_requires`, and queued legs whose list names it); a snapshot writing a
    ticket's `ticket_requires` writes its rows in the same transaction. A ticket blocked 24
    hours on a capability no live runner has raises `baton.capability-missing`. One runner's
    answer is rule 4, computed on the spot.
  - Rows and the messages they cause count against the write budget (§2).

- **R-BTN-77 (blocked and unblocked are events; unblocking wakes work).**
  - Setting `blocked_since` logs `blocked`; clearing it other than by a claim starting logs
    `unblocked` `{ticket, cleared: [{kind, ref}]}`, the rows whose removal cleared it, in the
    same transaction. A claim's end is never an unblocking; an end leaving the ticket blocked
    (a backoff it starts, a decision posted while held) logs `blocked`, which wakes no one.
    Every `unblocked` follows a `blocked`.
  - **A lost answer is not an unblocking.** A `resource` row that goes because no live granted
    runner has a usable instance left clears `blocked_since` silently. So does a transition
    whose cleared rows include a lost one on the queued leg, whatever else the same transaction
    cleared (a capability the same recount brings back, a dependency the same post closes);
    only the lost rows are kept, and a lost row is never named in an `unblocked`'s `cleared`.
    A lost row on another next leg never blocked the ticket and silences nothing. The ticket
    keeps the lost rows and `blocked_since` in `tickets.answer_lost` until each settles (need gone, or the
    fleet able to answer). Then, if the ticket is unblocked, unheld and has a queued leg, Baton
    logs the owed `unblocked` with its message and trigger; if it is blocked only on rows it
    lost, Baton rewrites them silently with the original `blocked_since`. Any `blocked` or
    `unblocked` logged meanwhile ends the record; a new block is preceded by the owed
    `unblocked`, logged only.
  - **On `unblocked`** Baton queues, for each live idle runner granted on the repository that the
    ticket would now pass the gates for, one `unblocked` message (§6.9), updated in place while
    pending, at most 20 tickets (oldest dropped), expired by the alarm when the runner stops
    being live; an idle `baton runner start` then asks for recommendations (R-BTN-72). Baton
    also calls the repository's `unblocked_trigger` (R-BTN-94) when set — a workflow under
    `.github/workflows/` dispatched through the sync's App, or the GitLab or Gitea adapter; none
    on plain `git` — with one input `tickets`, a JSON array of `{ticket, cleared}`, one
    dispatch per 30 seconds per repository plus a trailing one, at most 100 entries then
    `{truncated: n}`. Every id and `ref` in it has passed §12.3's untrusted-text rules; a workflow
    reads it with `fromJSON(inputs.tickets)` into an environment variable, never into `run:`.

- **R-BTN-126 (a prerequisite that fails during a leg blocks that leg's edge).** The ticket stays
  at the station the leg leaves; no station is added.
  - **The end.** The runner pushes the work so far, `handoff` writes the hand-off (R-BTN-44), and
    the claim ends **`released:blocked`** with `prerequisite: {kind, ref}`. In that transaction:
    - `resource` — `ref` a registered resource, optionally with `reading: {instance, available:
      false, until?, valid_for?, detail?}` for an instance serving `ref` that the runner may
      report on. Baton stores the reading as the runner's (R-BTN-76), adds `(ticket, leg, ref)`
      to `leg_needs` with source `end` if the posted needs lack it, stamps the need's
      `found_at`, then writes the `resource` row against the counts — so the leg is blocked for
      the fleet only when no live granted runner has a usable instance not `unavailable`, else
      for the reporter alone. A reading failing its envelope, bounds or one-a-minute limit is
      dropped and logged `reading-refused`; the end stands. An `end`-sourced need and its row go
      when the leg next ends other than `blocked` on that resource, or after 7 days, and posts
      never remove it; the `found_at` stamp clears at that same end.
    - `capability` — `ref` a capability the runner declared and says it lost, which the leg
      needed directly or on the way to one it requires (R-BTN-174). This is the runner's own
      statement, never checked against a proof. Baton removes it from the runner's declared set,
      re-evaluates the runner's derived sets in the same transaction (R-BTN-174) and updates
      `fleet_capabilities`, so rule 4 refuses this runner at once. The runner declares it again
      once its check passes (R-BTN-121).
    - `ticket` (`ref` in R-BTN-75's form, same repository) or `decision` (a decision id) — the
      leg writes the `depends_at` entry or decision to git first and the end carries `commit`;
      Baton writes a provisional row.
    - `condition` and `call` — per R-BTN-162 and R-BTN-165.
  - **Invalid.** A bad kind or `ref`, a capability the `capability` bullet does not admit, a reading for an instance
    not serving `ref` or not reportable, or a `ticket` or `decision` end without `commit`: Baton
    records `released:cannot-finish:transient` (a failed attempt) in the same transaction and
    answers `invalid-prerequisite`. The runner makes the same checks first.
  - **Bounded, not failed.** A valid `blocked` end is not a failed attempt, not a run for
    `max_runs` (R-BTN-69), and starts no backoff. Baton counts them per (ticket, leg) from
    `claims.blocked_kind` and `blocked_ref`, `call` ends excepted. Past the owners' `max_blocked`
    (R-BTN-122) within 24 hours, the next one holds the ticket (`hold_reason:
    blocked-exhausted`) and raises `baton.retries` listing each end's prerequisite. A runner
    with more than 4 × `max_blocked` blocked ends across tickets in 24 hours raises
    `baton.blocked-ends`.
  - **How a leg says so.** A script throws `LegError(type, message, {prerequisite, reading?,
    commit?})`; a session sends `baton leg release --blocked --kind <kind> --ref <ref>
    [--instance <i>] [--until <RFC 3339>] [--valid-for <s>] [--detail <json>] [--commit <sha>]`
    on the local channel (R-BTN-106). An error naming a prerequisite is a block, never a retry,
    and the runner never waits in the claim for a prerequisite to return.
  - **`found`.** A row a `blocked` end writes is `during-run`, as is every `resource` row for a
    need carrying `found_at`; every other row, including one present at the claim's start, is
    `before-start`.
  - **Drawn as an edge.** Every course view (**Courses**, a ticket's path, `baton leg why`)
    draws each leg as an edge in one state — `ready`, `running`, `blocked` (each unmet
    prerequisite's kind, `since`, `until`, `found`), `backing-off` or `not-queued` — never as a
    station, in colour and a text label (§11), from the blocks index and `leg_needs`.

- **Asking about blocks** (R-BTN-75).
  - `GET /v1/repositories/{repository}/tickets/{ticket}/blocks[?runner=me]` → `{blocked,
    blocks: [{kind, leg?, ref, since, until?, found}], other}`; `runner=me` makes `capability`
    and `resource` blocks the asking runner's.
  - `GET /v1/repositories/{repository}/blocked?on=<kind>:<ref>[&transitive=1]`, `kind` one of
    `ticket`, `resource`, `capability`, `decision` (`decision:*` for all) → the tickets blocked
    on it with their blocks; with no `on`, every blocked ticket grouped by kind and `ref`, 100
    per page with a cursor. `transitive=1` follows `ticket` blocks up to 5 levels.
  - Any key granted on the repository, its owners and administrators may ask; CLI `baton
    ticket blocked <ticket>` and `baton ticket blocked --on <kind>:<ref>`.
  - **Cost.** `blocks` reads `blocked_since` and the ticket's rows by primary key; `other` adds
    primary-key reads of its overrides, next legs and claims; `runner=me` adds the runner's
    `runner_instances` and their readings; `blocked?on=` reads `blocks_by_ref` and the matched
    tickets' `blocked_since`; the unfiltered form reads `tickets_blocked`, paged; `transitive`
    repeats per level. The harness asserts these plans.

### 6.3 External resources and readings

- **R-BTN-76 / R-BTN-101 / R-BTN-151 (external resources, their instances and readings).** A
  resource is anything outside Baton a leg can be blocked on: a provider's capacity, an API's
  rate limit, disk on a shared server. A **reading** is an attestation about one of its instances
  (R-BTN-181): R-BTN-181's writers, signature, supersession and requirements apply, and this rule
  adds what is particular to resources.
  - **Registered** by an administrator: `baton admin resource add <name> --scope
    runner|host|account|service --schema <file> [--capacity <n>]` (capacity and `host`:
    R-BTN-178), `name` matching `^[a-z][a-z0-9:._/-]{0,79}$`, the
    schema (R-BTN-108's subset) its readings' `detail` must satisfy, and `--atoms-from
    admin|any` (default `admin`: whether runners' readings, besides administrators' and
    instrument keys', may steer route choices, R-BTN-176). The schema may name a `std:` schema, and
    only a `std:` schema, as its `x-baton-base`; registration refuses a refinement R-BTN-108's
    check cannot prove. Re-registering with the same scope and schema may change `atoms_from`,
    logged as an `admin` event. Core compares names and reads the envelope; `detail` means
    what the course says.
  - **Instances.** `service`: one, itself. `account`: one per account, registered by an
    administrator with every resource it serves (`instance_serves`) and the repositories whose
    runners may use it; its resources share one `detail` schema, and one reading of it is the
    state of each; one listing several repositories takes only resources whose schema holds
    numbers, booleans and `enum` strings. `runner`: one implicit instance per runner,
    `<resource>@runner:<id>`. `host`: one implicit instance per runner hostname,
    `<resource>@host:<hostname>` (R-BTN-178). Instances and readings are one tenant's (R-BTN-137) and seen by
    all its repositories.
  - **`uses`.** Each heartbeat declares the account instances the runner can use; an
    unregistered one, or one listing no repository its key is granted on, is dropped into
    `refused_uses` and the heartbeat succeeds. A runner's **usable** instances of R for a
    repository are the `service` instance, its own `runner` instance, the `host` instance of its
    hostname (R-BTN-178), and the instances in its `uses` that serve R and list the
    repository.
  - **Who reports.** A runner credential (machine key or API key, R-BTN-117), `POST
    /v1/runner/readings`: its own `runner` instances, its hostname's `host` instances, and any
    account instance listing a
    repository its key is granted on, `uses` aside — sharing an account trusts every listed
    repository's runners. An instrument key (`POST /v1/admin/probes`, with a label), `POST
    /v1/probe/readings`: any registered instance. An administrator, `baton admin resource set
    <instance> …`, in force at most 7 days.
  - **Readings** name their `detail`'s schema (≤ 4 KB, R-BTN-108's validator). A `state`
    reading `{instance, available, until?, valid_for, detail?}` has `valid_for` ≤ 24 hours
    (default 1 hour) and `until` no later than its end; an unavailable reading with `until`
    lapses at the earlier of the two. A runner posts one on meeting a limit (the reset as
    `until`) and on succeeding after one. A `measure` reading carries `detail` only, `valid_for`
    ≤ 31 days, and never affects state. A runner session posts at most one reading per instance
    a minute.
  - **Kept per instrument** (R-BTN-181's supersession). Per instance: the administrator's reading and the latest of each
    instrument (a runner session, by its `runners` row, or an instrument key), each lapsing on
    its own; at most 8 instruments per credential, a ninth replacing that credential's oldest.
    All readings in force are served (R-BTN-99); core never sums them.
  - **State**: the administrator's reading while in force, else the most recently observed
    `state` reading in force, else `unknown`. An instrument reading posted under an
    administrator's is stored, answered `overridden`, and takes over when that lapses. `unknown`
    blocks only a requirement with `missing: block` (R-BTN-181); otherwise advice fails open. Each change is a `resource` event. An instance `unknown`
    24 hours while a posted leg needs it raises `baton.resource-unknown`.
  - **Clearing.** `POST /v1/admin/readings {instance, clear: {source?}}` ends readings of both
    kinds from one instrument or all, logged.
  - **Needs** — posted `needs`, a leg's `requires.resources`, `end`-sourced needs — are stored in
    `leg_needs`; an invalid or unregistered name is logged and blocks nothing.
  - **Blocked** for a runner when it has a usable instance of R and all are `unavailable`; for
    the fleet when at least one live granted runner has a usable instance and none has one not
    `unavailable`. With no such runner no row is written and `other` lists `no-instance`.
    `resource_fleet` keeps those two counts per (repository, resource), changed by whatever
    changes `fleet_capabilities` and by an instance's state, a runner's `uses`, or a resource or
    instance registered or changing what it serves or lists. Rows are rewritten for exactly the
    tickets whose legs need R, only when the answer flips; a snapshot writing `leg_needs` writes
    that ticket's rows in the same transaction. A runner's own answer is computed on the spot.
    A row binds as its requirement says (R-BTN-181): advice by default, a gate where the course's
    requirement binds `gate`; under `missing: block` an `unknown` instance counts as `unavailable`
    for that requirement.

### 6.4 Decisions and people

A person is reached three ways, each with one job: a **person's leg** when the next leg needs a
typed answer (R-BTN-116); a **posted decision** when a ticket waits on an answer git records in
its own form (R-BTN-78); a raised **`hitl` condition** when a running leg asks (R-BTN-160).

- **R-BTN-78 (posted decisions block, and are not resources).**
  - With each ticket the ticket source posts `decisions: [{id, leg?, asks, url, severity?}]`
    (§4; `severity` per R-BTN-125), stored
    in `ticket_decisions` — for example a docs `## Decision needed` packet, `asks: owner`. A
    decision is open until a snapshot stops posting it; its answer is git's, by its own
    protocol.
  - `id` matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$` and does not begin `baton.`; `asks`
    matches `^[a-z][a-z0-9-]{0,31}$`; `url` lies under the `web_base` of the home repository or
    one of its `repos:` entries with reach (R-BTN-140) by R-BTN-92's link rule. A decision failing any is dropped and logged.
  - Each open decision is a `decision` block on its leg, or on the whole ticket when it names no
    leg or one not among the posted next legs. It never lapses or fails open.
  - Each open decision raises `hitl.decision` (R-BTN-163), closed with it.
  - `blocked?on=decision:*` lists every ticket waiting on a decision, with the tickets its answer
    would unblock; the answer fires `unblocked` (R-BTN-77).

- **R-BTN-116 (a typed answer is a leg a person runs).** *A person leg that stands for a human
  approval is answered through Baton, never git (R-BTN-181, proposal).* A leg may be `"kind": "person"` with
  `"asks": <label>`. No runner is offered it or may claim or advance into it (rule `person`).
  While it is the queued leg, the ticket source posts an open decision on it (R-BTN-78), through
  which the person is listed and reached. That decision's `asks` is the leg's: Baton stores the
  leg's `asks` whatever the post says, and logs `asks-mismatch` when they differ. When git
  shows the answer, the sync posts the path extended by that leg (R-BTN-70) with its output, a `std:decision@1` value or refinement, which
  the station reached may require (R-BTN-109). Whoever can push can write the answer; under `landing:
  protected`, a person leg a trusted leg acts on is answered by an attestation (R-BTN-181) and its
  answer in git does not count. At a
  choice station a person's leg may complete without being queued (R-BTN-166). A leg never waits
  on a delivery, only on an effect: an answer in git, or a forge effect the sync reads back
  (R-BTN-114).

### 6.5 Waiting for a time

- **R-BTN-89 (a queued leg may wait for a time).** A queued leg may carry `not_before`, an
  instant before which it is not offered.
  - **From git.** After a leg, its closing marker's `not_before=` (from the result's
    `not_before?`, R-BTN-72), posted by `locate` as `stations.<id>.not_before` (§4); the runner
    also reports `not_before?` on a suspending or releasing `end`, so the provisional queued leg
    waits at once. For a ticket at `start` with an empty path, the ticket file's
    `tickets[].not_before` (R-BTN-74) applies when the station posts none. Baton never computes
    one; a schedule is the leg script's. `@immediately-run/baton/leg` exports `nextFire(cron,
    tz, after)`, `writeSuccessor` and `NOT_BEFORE_HORIZON_DAYS` (400), the constant
    `src/core/validate.ts` imports.
  - **Validated, failing closed.** RFC 3339 with `Z` or a numeric offset, at most 400 days after
    `now` (R-BTN-32) at acceptance. A failing value is logged `not-before-invalid`; a leg posted
    `ready` is stored `waiting` on `not-before-invalid` and raises `baton.not-before-invalid`
    until git is valid; a leg posted `waiting` on another label keeps it; no snapshot is
    refused. A value at or before `now` is stored NULL. `nextFire` and `writeSuccessor` refuse
    an instant past the horizon, failing the leg `cannot-finish:spec`.
  - **Stored.** The queued leg is stored `waiting` on `time` exactly when posted `ready` and
    `now < not_before`; a posted `waiting` on another label wins, `not_before` kept beside it.
    Re-applied in every transaction writing `ticket_next_legs` and by the alarm, which at
    `not_before` sets the leg `ready` with `ready_since = not_before` and clears `not_before` (a
    later post of that past instant stores NULL and keeps `ready_since`). Index
    `ticket_next_legs_due` (`state = 'waiting' AND waiting_on = 'time'`). A `time` wait raises
    no condition; the dashboard shows "waiting until …" and lists pending waits on **Courses**.
  - **Offered at the instant.** Recommendations leave a `time` wait out and rule 1 refuses its
    claim. Claim, heartbeat and advance responses carry each next leg's `not_before`; the runner
    suspends unless it is within 30 minutes, then waits under the claim. The alarm wakes at the
    earliest pending instant (§2); at `not_before` Baton queues R-BTN-77's `unblocked` message
    with `cleared: [{kind: "time", ref: <not_before>}]` and rings it, but calls no trigger.
  - **Recurring jobs: a series.** A series is a ticket (the CLI's default course `series`:
    stations `active`, `retired`, leg `retire`) whose children are its runs, each an ordinary
    ticket on the job's course naming the series as `parent`, with `run: <n>` (first 1) and
    `not_before`. The run's last leg calls `writeSuccessor(ctx, {schedule})`, which writes
    `<series>-<n+1>` on the default branch in a commit at or before the one closing the run —
    nothing if that file exists naming this series and `run: n+1`; a foreign file at that id or
    an id the ticket-id rule refuses fails the leg `cannot-finish:spec`. The successor's
    `depends_on` names the run, so it waits for it to close `done`; its `not_before` is the next
    fire after the run's own, or after now if that has passed. Runs never overlap; missed fires
    are not replayed. A withdrawn run leaves its successor `baton.prerequisite-unmet` until an
    owner withdraws it or removes the dependency. A series stops when its pending run is
    withdrawn and the series retired, or the pending run held (§6.8).

### 6.6 Matching: gates and advice

Baton recommends and the runner decides (R-BTN-45): a gate refuses a claim or advance; advice
never refuses, and acting against it is accepted and recorded `advice-overridden`.

- **The gates.** Rule numbers are stable (code cites them); 12 is unused. A refusal is
  the code shown, else `not-eligible` with `rule` and `rule_code`.

  | Rule | Holds when | At | Refusal |
  |---|---|---|---|
  | 1 | Claim: the queued leg (R-BTN-83, or a route override) is `ready` as posted (R-BTN-70), a snapshot was accepted after the ticket's last end (R-BTN-10), and no `ticket`, `decision`, `condition` or `call` row, nor a `resource` or `attestation` row binding as a gate (R-BTN-181), is on that leg or the whole ticket. Advance: the new leg is an edge from the claim's station within its run limit (R-BTN-63), with no `ticket`, `decision`, `condition` or `call` row on it, nor a `resource` or `attestation` row binding as a gate, and no whole-ticket `ticket` or `decision` row | claim, advance | `blocked` with the blocks; else rule 1 (`not-ready`, or R-BTN-63's codes) |
  | 2 | *(advice)* expedite lane: while 2 active claims hold expedited tickets, other expedited tickets lose their expedite place and carry `expedite-bound` | — | — |
  | 3 | No other active, completed-unconfirmed (not superseded, R-BTN-168) or fence-pending claim on the ticket; no hold (§6.8) | claim; advance: hold only | `claimed`, `held` |
  | 4 | `capabilitiesOf(ticket.requires ∪ leg.requires.capabilities) ⊆ H ∪ D(H)`, with `H = declared ∩ grant(repository)` and D the repository's ontology (R-BTN-174); `runner:` counts once declared (R-BTN-133); no clause is met by all | claim, advance | `missing-capability` |
  | 5 | Tier at or below the runner's ceiling: the position in the repository's `tiers` of the lower of its declared ceiling and grant `max_tier`; untiered fits only the top | claim, advance | `above-tier-ceiling` |
  | 6 | *(retired: `human-operator` is a runner's own statement, checked by rule 4 like any capability, R-BTN-121)* | — | — |
  | 7 | The key holds a grant for the ticket's repository (R-BTN-58) | claim, advance | `not-granted` |
  | 8 | Tags meet none of the leg's posted barred tags, the owner bars in force for its course or `*` (at an advance those with `applies: claim+advance`) and, at an advance, the holder's `bars`; required bars met by posted bars joined with the holder's `bars` (R-BTN-60, R-BTN-67) | claim, advance | `barred-tag`; rule 8 `policy` |
  | 9 | The runner declares the course at `min_runner_version` or later (R-BTN-22, R-BTN-65); not re-checked at an advance | claim | `stale-skills` |
  | 10 | No `retry` block on the leg | claim, advance | `backing-off` with `until` |
  | 11 | Every instance the claim or advance bills has a free seat for it (R-BTN-178) | claim, advance | `instance-busy`, naming the holder |
  | 13 | No repository of the ticket (home, or a `repos:` entry reaching `code_repos`, R-BTN-140) has a held rename (R-BTN-138) | claim | `rename-held` |
  | `person` | The leg is not a person's (R-BTN-116) | claim, advance | `person` |

  Rules `chain` (R-BTN-106), `entry` (R-BTN-109), `not-queued` (R-BTN-72) and `check-runner`
  (R-BTN-114) are gates too; a leg's `session` mode is
  rule 4's `runner:session` (R-BTN-107).
  `isEligible`, in the vendored decision library (R-BTN-37), is the reference for every rule;
  the SQL is tested against it (G-BTN-40).

- **The pipeline.** Matching reads only `tickets` and Baton's tables (R-BTN-33).
  1. One query returns candidates, one row per ticket, per (repository, course) group in the
     default order, 50 per group per page (R-BTN-61). With `q` the queued leg (route override,
     else `ticket_stations.next_leg`), it requires: `q` `ready` in `ticket_next_legs`; no
     `ticket_bars` row on `q` matching `runner_tags`; no refusing `ticket_blocks` row on `q` or
     `''`; `board_head.observation` above the ticket's last `claims.end_observation`; a
     `runner_courses` version ≥ `courses.min_runner_version`; an unrevoked `runner_grants` row (for a check-runner, its `check_runners` row);
     no holding claim and no hold; every capability of `ticket_requires` and `q` in
     `runner_capabilities` and the grant, or in `runner_derived` (`runner:` in `runner_capabilities` alone); tier
     position ≤ `:ceiling`, a per-repository JSON map computed first. That is rules 1, 3, 4, 5,
     7, 9, 10 and rule 8's posted bars.
  2. `isEligible` applies rule 2 and rule 8's owner bars per leg.
  3. R-BTN-61 merges the groups.
  4. Recommendations only then drop a leg with a fleet `resource` row or one blocked for this
     runner (R-BTN-76), a leg whose resources with capacity have no usable instance with a free
     seat for this runner (rule 11, R-BTN-178), and a closed course's new tickets (R-BTN-79).

  A claim re-runs `isEligible` and the predicates for its one candidate in the committing
  transaction, rule 11 among them; an advance re-runs rule 1's advance form, rule 3's hold,
  rules 4–8, 10, 11 and `person`.

- **The default order** within a group: (1) expedite — `EXPEDITE` tag or override (R-BTN-12),
  within the lane's bound; (2) fewer legs to an end (`to_end`, R-BTN-69); (3) the sync's `rank`;
  (4) the queued leg's `ready_since`, oldest first; (5) ticket id. A built-in leg (R-BTN-171)
  comes before every other leg of its repository, in R-BTN-61's merge too.

- **Recommendations.** `GET /v1/runner/recommendations[?limit=n]` returns the merged list
  without claiming; `GET /v1/runner/next` is its first entry. Each entry has the ticket, its
  queued leg in `legs` (a list of one), the course's opaque posted fields, the hand-off document
  and Baton's advice flags (`expedite-bound`; `wip-bound` when the leg is over `max_queue`,
  R-BTN-79). The course's own order and advice are the runner's (`rank.mjs`, R-BTN-98).
  `?all=1` returns every gate-passing candidate across all pages, at most 500, then `truncated:
  true`.

### 6.7 What a runner ranks from

- **R-BTN-99 (the views a runner ranks from).** Read-only, signed by a machine key alone (no
  runner secret). Each answers with an `ETag` of a per-repository `fleet_version`, a per-Baton
  `instances_version`, the key's grant set and the UTC hour, so an unchanged poll costs a `304`.
  The counters are bumped in the transaction of each write a view shows (claim, `advance`, end;
  a heartbeat changing tags, profile or reports; a change to `runner_derived` (R-BTN-174); an accepted board post; an owner bar; a reading
  — a `measure` at most once a minute per instance; a billing change) and by the alarm at each
  lapse and bar start or end; a grant or instance change bumps both.
  - **`GET /v1/runner/fleet?repository=<id>`** (key granted there): every active claim (ticket,
    station, leg, the leg's opaque course fields, the latest `advance`'s `course` data,
    `claimed_at`, `bills`, `provisional`; the runner's hostname, tags, opaque profile and capabilities derived for this repository, R-BTN-174); each
    claim's reports, and those of claims ended within `report_horizon_h`; runner-level reports
    naming this repository; the **board summary** (tickets per station; per leg ready and
    waiting counts, queue depth, `max_queue`, intake, R-BTN-79); owner bars in force or
    scheduled; each course's `course_data` (§4). Peers granted on a repository read each other's
    claims, profiles and reports.
  - **`GET /v1/runner/instances`**: every `service` instance, every account instance listing
    a granted repository, and the caller's own hostname's `host` instances (R-BTN-178), with state, every reading in force (source, `observed_at`,
    `lapses_at`, `kind`, `detail`) and the active claims billing it (leg, `claimed_at`, `n`,
    repository; hostname and ticket only where the key is granted).
  - **`GET /v1/runner/launch-candidates`**: per granted repository, the legs passing the gates no
    runner decides (lease, readiness, holds, backoff, blocks), in the default order with their
    course fields, for a launcher's `rank` with `runner: null` (R-BTN-98).

- **R-BTN-152 (what a view serves is data).** Profiles, reports, readings' `detail`, course
  fields, resume records and hand-off documents in a view reach a model only as quoted data. A
  runner-level report names a repository the key is granted on, and the fleet view serves only
  those naming its own. The runner checks `rank`'s return: `order` names only the given
  candidates; `advice` and `launch` validate against the course file's `rank_advice` and
  `rank_launch` schema ids (R-BTN-108), dropped when it names none; on any failure, Baton's order.

- **R-BTN-100 (a claim names its preferences and what it bills).** `POST /v1/runner/claim`
  takes `request_id` and at most one of `ticket_id` (recommended or not; unknown with R-BTN-104's
  fields) or `prefer: [{ticket_id, leg?, bills?}]` (at most 50 known tickets: Baton claims, in one
  transaction, the first passing every gate, else answers `no-eligible-ticket` with `refusals:
  [{ticket_id, code, rule?}]`). With neither, Baton claims its first recommendation; with both,
  `invalid-params`. It also takes:
  - `bills: [{instance, n?}]` (and `advance` for the leg it starts; a `prefer` entry for its own
    candidate): instances the leg spends, `n` seats (default 1, at most 16), each a usable
    instance of the runner for the repository (R-BTN-76); any other is dropped and returned in
    `refused`. A claim bills for the leg it is for until its first `advance`, then for its
    running leg. A bill takes seats on its
    instance, and a bill past the instance's capacity is refused by rule 11, `instance-busy`
    (R-BTN-178); below capacity, how many is too many is ranking's call.
  - `rationale`: opaque JSON ≤ 4 KB, kept in the claim's `advice_json` and history row and
    exported with it (R-BTN-88); Baton never reads it, the fleet view omits it, the dashboard
    shows it as escaped text, and §12.3's free-text rules do not apply to it.

  A claim against Baton's advice (a resource block, the expedite bound, `max_queue`) records
  `advice-overridden`, and so does a reported `taken` alternative other than a route choice's advised one
  (R-BTN-177); against the course's ranking, nothing.

### 6.8 Owner overrides: expedite and hold

- **R-BTN-12 (expedite and hold).** A ticket is expedited when its snapshot carries `EXPEDITE`
  or its override says so; the override stays until an owner clears it, whatever later snapshots
  show, and the mirror writes the tag (§16).
  - A **hold** means "do not hand this ticket out" (rule 3), with `hold_reason` `owner`,
    `mcp:<name>`, `parked` (R-BTN-163), `attempts-exhausted`, `non-retryable:<class>`,
    `budget-spent` (R-BTN-122), `blocked-exhausted` (R-BTN-126), or `outbox-unlanded`,
    `outbox-refused` or `outbox-collision` (R-BTN-171). The dashboard's **Cancel**
    sets a hold and sends the holder a `release` with reason `owner-cancel`. A hold is not
    mirrored as a status; the mirror writes a Status note (§16).
  - Owners set and clear both with `POST /v1/owner/{repository}/overrides/{ticket}` or `baton
    owner override`, as does the dashboard; an MCP key may only add a hold (R-BTN-154). Lifting a
    hold resets the leg's attempt and blocked-end counts.
  - Each change is logged `override`; each hold also `held` with its `hold_reason`.
  - `ticket_overrides` also holds the queued-leg overrides that win over the posted pair until
    the station changes: an owner's re-route (R-BTN-83), a choice settlement (R-BTN-166), a
    timer's or retry policy's leg (R-BTN-167), `baton.cancel` (R-BTN-168) and the `outbox` wait
    (R-BTN-171), the last two until their write lands (R-BTN-83).
  - **Owner state outlives the board.** When a ticket leaves the board, closed or dropped
    (R-BTN-147), its `ticket_overrides` row (a hold with its reason, a cancel, expedite, a
    re-route) and its `leg_attempts` are kept in its `closed_tickets` row, and restored when a
    post returns the same id: the hold stands, no attempt is refunded, and a backoff not yet
    over blocks again. Baton's traversal record (R-BTN-63) stays with the claims. So withdrawing
    a ticket in git and reopening it clears nothing. A ticket re-filed under a new id is a new
    ticket and carries no hold (only a renumbering at the same path does, R-BTN-147): a hold
    binds a ticket only as firmly as git keeps its id, and that residual risk is accepted.
    Owners see it: the dashboard's **Courses** view lists every closed or dropped ticket that
    keeps a hold, with its reason, beside the new ticket, and a drop raises
    `baton.ticket-dropped`.

### 6.9 Messages

- **Kinds.** `release` `{ticket_id, reason}`; `status_request`; `status_report`, a reply
  (`in_reply_to`) `{activity, text}` with the current activity (§9); `unblocked` `{tickets:
  [{ticket_id, cleared}]}` (R-BTN-77); `handled` (R-BTN-162); `wind-down` (B-109) — an owner's
  ask that a worker drain: the runner sets the same flag `SIGTERM` does (its current leg
  completes, its claim ends at the boundary with its hand-off, it exits without claiming again),
  acknowledges the message, and a second wind-down changes nothing.
- **Delivery is a poll.** A heartbeat response returns pending messages and marks them
  `delivered` in the same transaction, and returns again every delivered message not yet
  acknowledged, so a lost response loses none; the runner acts on a message `id` once, then
  acknowledges. A ring (R-BTN-91)
  only prompts that heartbeat.
- **`release`.** The runner stops the leg at its next safe point — at once for `requested`,
  `owner-cancel` and `superseded` (R-BTN-119, R-BTN-168) — leaves its work in git with the
  hand-off (R-BTN-44; none for `superseded`), ends the claim `released:<reason>` (§9) and acknowledges. A delivered
  `release` unacknowledged for 2 hours is reaped by the alarm with a fence (R-BTN-19); a
  `leg-timeout` release is reaped as R-BTN-90 says.
- **Expiry.** A reaped runner's `pending` and `delivered` messages become `expired`.

### 6.10 Route choices: advice on how a leg runs *(proposal — B-105)*

- **R-BTN-176 (the atoms a route choice reads).** Core forms the atoms below for the runner and
  the ticket's repository, and for nothing else. They are reserved (R-BTN-175). A route choice's
  guards and the rules they depend on may read them; the gate stratum may not. The
  **route-choice stratum** is the generated guard rules, `meters`, and every repository
  predicate that depends on an atom below. None of it may depend on `holds` or `derived`: a
  route choice reads the runner's capabilities only as `has`, from the stored H ∪ D(H). The
  fixed predicates (R-BTN-175) are read as facts. A route-choice evaluation evaluates exactly
  the route-choice stratum, under its bound.

  | Atom | Holds when |
  |---|---|
  | `has(K)` | K is in the runner's H ∪ D(H) (R-BTN-174) |
  | `wanted(C)` | the repository attaches route choice C to the leg being started |
  | `usable(R, I)` | instance I of resource R is usable by this runner for this repository (R-BTN-76) |
  | `state(I, S)` | I's **route-choice state**, S being `"available"`, `"unavailable"` or `"unknown"` |
  | `blocked(R)` | the runner has a usable instance of R, and every one is `"unavailable"` in its route-choice state |
  | `refines(R, S)` | S is in the `x-baton-base` chain of R's schema |
  | `int(I, P, V)`, `str(I, P, V)`, `flag(I, P)` | field P of I's **field reading** is the integer V, the string V, or `true` |
  | `now(F, V)` | from `this.now` (R-BTN-32): F is `"epoch_min"`, `"utc_minute_of_day"` (0–1439) or `"utc_weekday"` (1 is Monday) |
  | `was_demoted(C, A)` | alternative A was demoted when this runner last resolved C for this repository, within 24 hours (R-BTN-177) |

  - **Permitted sources.** Administrators and instrument keys are permitted. A runner's reading
    for an instance is permitted only when every resource the instance serves is registered
    `atoms_from: any` (R-BTN-76), which records that the tenant trusts its runners' reports to
    steer advice. A runner's reading for its own `runner`-scope instance is always permitted: it
    steers only advice that runner receives.
  - **The route-choice state and the field reading** both follow R-BTN-76's precedence, using
    permitted sources only.
    - The route-choice state is the administrator's `state` reading while it is in force, else
      the most recently observed permitted `state` reading in force, else `"unknown"`.
    - The field reading is the administrator's reading carrying a `detail` while one is in
      force, else the most recently observed permitted reading in force that carries a `detail`,
      of either kind.

    A `state` reading without a `detail` therefore never erases the fields. Core never sums
    readings. A runner's reading steers a route choice, even by availability, only where the
    resource admits it. The fleet's `resource` blocks (R-BTN-76) are unchanged and still hear
    every source.
  - **Fields.** This is the one place core reads inside a `detail`, and it forms atoms without
    interpreting them (R-BTN-50, R-BTN-108). A path is a field's property names joined by `.`,
    each matching `^[a-z][a-z0-9_]{0,31}$`, at most five deep and at most 128 characters. An
    instance whose id falls outside R-BTN-175's constant syntax forms no atoms. What forms an
    atom:
    - an `integer` within 32 bits forms `int`;
    - a string of at most 128 characters in R-BTN-175's constant alphabet forms `str`;
    - `true` forms `flag`.

    Nothing else forms an atom: not `false`, `null`, an array, a non-integer number, a longer
    string, or a field a partial reading omits. A fraction is written in fixed point
    (`remaining_permille`).
  - **Absence fails open.** With no permitted reading in force, I's route-choice state is
    `"unknown"` and it has no field atoms. A guard over its fields is then false, as R-BTN-76's
    `unknown` blocks nothing. A rule that wants to fail closed names `state(I, "unknown")`.
  - **Schemas refine.** A resource's schema may name a `std:` schema as its `x-baton-base`
    (R-BTN-76). `baton admin resource add` checks the refinement with R-BTN-108's check (the CLI
    holds the `std:` library) and refuses one it cannot prove; core stores the named chain and
    forms `refines` from it. Schemas stay immutable. A rule over `refines(R,
    "std:api-capacity@1")` and a base field therefore serves every resource that refines it.
  - **A peak is a rule.** Time-of-day schedules are repository rules over `now`. Core knows no
    provider, schedule or price.
  - **A new provider** needs no change to Baton's code. An administrator registers its resource
    and instances (R-BTN-76), and the repository adds the facts, route choices and guards.
- **R-BTN-177 (route choices: advice on how a leg runs).** A **route choice** is a question a
  leg asks for advice on, such as which model and key to use. It is not a choice station
  (R-BTN-166). A repository attaches route choices to its legs in its course entries:
  `route_choices: {<leg>: [<id>…]}` in `.baton/baton.json`, at most 8 per leg. They are always
  the repository's own, for its own and for sourced courses alike (R-BTN-134), so a standard
  course lists none and runs unchanged where there is no ontology. Each id must name a route
  choice of the program in force (R-BTN-174). The ontology's `route_choices` lists each one's
  alternatives **in order**:

  ```json
  { "id": "reviewer-2", "alternatives": [
      { "id": "opus", "needs": ["model:claude-opus-5-5", "key:claude-subscription"],
        "demote_when": [["near_limit", "key:claude-subscription"]] },
      { "id": "glm",  "needs": ["model:glm-5.3", "key:zai"] } ] }
  ```

  - **Shape.**
    - Alternative ids match `^[a-z][a-z0-9-]{0,63}$` and are unique within their route choice.
    - `needs` lists the capabilities the alternative uses, at most 8, and may be empty. A need is
      checked for shape only: a `<type>:<value>` string in R-BTN-175's constant syntax, never of
      type `credential` or `runner` and never the bare `human-operator`. A provider key is a
      `key:` label. No course file need declare the type, so a standard course's adopter can
      attach route choices freely (R-BTN-134). Core reads needs only as capabilities, and they
      never change the leg's environment.
    - `demote_when` and `exclude_when` are each a list of literals over the repository's own
      predicates and R-BTN-176's atoms, never over the encoding, and under R-BTN-176's
      dependency rule. Each one, as a rule, obeys R-BTN-175's safety, types and limits. Either
      may be absent; an empty list is refused, since an empty body would always hold.
  - **The reference semantics** is the ASP-Core-2 encoding the translator generates.
    - Facts `alt(C, A, P)`, with P the position from 1, and `alt_needs(C, A, K)` for each need.
    - One rule `demoted(C, A) :- <literals>.` per `demote_when`, and one
      `excluded(C, A) :- <literals>.` per `exclude_when`.
    - Core's fixed prelude:

      ```
      lacks(C, A)       :- alt_needs(C, A, K), not has(K).
      blocked_alt(C, A) :- alt_needs(C, A, K), meters(K, R), blocked(R).
      available(C, A)   :- wanted(C), alt(C, A, P), not lacks(C, A),
                           not blocked_alt(C, A), not excluded(C, A).
      1 <= { route(C, A) : available(C, A) } <= 1 :- wanted(C), available(C, X).
      :~ route(C, A), demoted(C, A). [1@2, C, A]
      :~ route(C, A), alt(C, A, P).  [P@1, C, A]
      ```

    `meters(K, R)` is a repository fact naming a resource that capability K spends. Guards never
    read the encoding, so `demoted` and `excluded` are fixed before the route choice is made.
  - **Read plainly.**
    - **Availability is hard.** An alternative survives only if the runner has everything it
      needs, no resource a need meters is blocked for it, and no `exclude_when` holds.
    - **A guard is soft.** A holding `demote_when` moves the alternative behind every undemoted
      one, keeping list order among the demoted.
    - **The optimum is unique.** Positions are distinct, so the objective has exactly one
      optimum whenever any alternative is available.
    - **Core evaluates the equivalent first-match:** filter to the available alternatives, order
      them by (demoted, position), and take the first. The repository writes neither route
      choice rules nor weak constraints itself.
  - **Exclusions filter advice.** An `exclude_when` keeps an alternative out of the advice. It is
    not an invariant: a `taken` naming an excluded alternative is still accepted and recorded
    `advice-overridden`. A constraint on the claimant is a barred tag (R-BTN-60).
  - **When.** A claim runs nothing (R-BTN-63), so a route choice is resolved at each `advance` that
    starts a leg it is attached to, for that leg alone, in one evaluation over all its `wanted`
    route choices.
    The result is a snapshot. It is not refreshed
    while the leg runs, and it is stored with the leg run (`claim_legs.route_choices_json`).
  - **Hysteresis.** Each resolution writes one row per alternative: `route_last(runner,
    repository, choice, alternative, demoted, resolved_at)`. The row is written whether or not
    the alternative was available, and the next evaluation reads it as `was_demoted`. It is
    keyed by runner because what a runner can use differs between runners; an account instance's
    reading may still come from another source. It is an input, never derived, so two thresholds
    are two rules with no cycle: one enters the demotion below 200‰, and the other holds it below
    300‰ while `was_demoted` is true. It is written in the advance's transaction, and not when
    that advance is refused. The alarm deletes rows older than 24 hours.
  - **Delivery.** The advance answer carries `advice: {route_choices: [{choice,
    alternative, ranked: [{alternative, needs: [<capability>…], demoted}…], reason?}],
    resolved_at}`.
    - `ranked` lists every available alternative in the evaluator's order, (demoted, position),
      and `alternative` is its first. A leg that finds its advised alternative unusable takes the
      next one in `ranked` and reports it as `taken`, naming the holding it found dead in its
      `dead` (below).
    - `alternative` is `null`, and `ranked` empty, when nothing resolves, with `reason`
      `none-available` or `limit`.
    - Every value is an id or a capability, checked against its pattern. No reading or
      repository text is ever interpolated.
    - The runner writes the object to `BATON_ADVICE` (R-BTN-144).
    - The dashboard composes any sentence from the identifiers as text (§11.4).
  - **Overrides are recorded, never refused.** The runner creates the file `BATON_TAKEN` names,
    empty, before each leg, and removes it after. The leg may write `[{choice, alternative}]` to
    it. The runner reports it as `taken` on the `advance` or end that finishes the leg, keeping
    at most one entry per route choice the leg listed and dropping the rest, and dropping a file
    that is unparseable or over 4 KB; reporting never fails an `advance` or end. An entry may
    add `dead: [<capability>…]`, holdings the leg found unusable; the CLI runner stops declaring
    them for the rest of its session, and Baton removes them from its declared set in the
    transaction of that `advance` or end, as R-BTN-126's `capability` end does, so the leg the
    `advance` starts is advised without them. Baton compares the route with the finishing leg
    run's `claim_legs.route_choices_json` and stores it in that row's `taken_json`.
    - An alternative other than the advised one records `advice-overridden`, with `{choice,
      advised, taken}` (R-BTN-45).
    - An entry naming a route choice not attached to the leg, or an alternative that route
      choice lacks, is dropped and logged `taken-invalid`. The `advance` or end stands.
    - With no report, `taken_json` is `null`. That is not an override: which alternative ran is
      self-reported (R-BTN-66).
    - An alternative reported for a route choice that resolved `null` is stored, and is not an
      override.
  - **No advice** leaves the leg on its own default: its `agent_command` and its instructions. The
    standard courses read `BATON_ADVICE` first and fall back to those (§5.8).
  - **Conformance.** R-BTN-175's suite also runs each route-choice fixture, given as input facts,
    through `run(text, 0, ["--opt-mode=optN"])` with a harness-only `#show route/2. #show
    available/2. #show demoted/2.`.
    - With an alternative available, it asserts `"OPTIMUM FOUND"`, `Models.Optimal` 1 with
      `Models.More` `"no"`, that the last witness's `route/2` equals the evaluator's first, and
      that its `available/2` and `demoted/2` equal the evaluator's, which fix `ranked`. Under
      `optN` the witnesses before the optimum come first.
    - With none available, it asserts `"SATISFIABLE"`, one model with no `route` atom, and a
      `null` alternative.
    - The warnings are filtered as R-BTN-175 says.
  - Ranking claims by what their work costs now is not part of this rule; a course may feed its
    `rank.mjs` from the same readings (R-BTN-98).

### 6.11 Seats: exclusive use of a resource instance *(proposal — B-106)*

- **R-BTN-178 (a bill is a seat on an instance).** Some things a leg uses take one client at a
  time, or a few: a Chrome MCP session on a VM, an RDP session to a machine, a device. The runner
  knows what its leg will use, so it says so in the claim and in each `advance` that starts a
  leg, as `bills` (R-BTN-100). Baton holds the seats as it holds a ticket's lease: for every
  worker that asks, and binding only on them.
  - **Capacity.** A resource is registered with `--capacity <n>` (1–64; absent, unlimited), the
    seats on each of its instances. An `account` instance may override it (`POST
    /v1/admin/instances`). Re-registering may change a capacity; a lower one never takes back a
    held seat and applies to the next bill. With capacity 1 an instance is exclusive.
  - **The `host` scope.** A resource registered `--scope host` has one implicit instance per
    runner hostname, `<resource>@host:<hostname>`, usable by every runner on that host
    (R-BTN-76). Every runner on a VM bills the same name, and no administrator registers anything
    per machine. The hostname is the runner's own statement (§8). Cloud runners share their
    environment's name as a hostname (R-BTN-3), so a per-container device there is a `runner`
    resource.
  - **What a runner bills.** For the leg a claim is for, and for the leg each `advance` starts,
    the CLI runner bills one usable instance of each resource in the leg's `requires.resources`.
    Only a resource whose capacity is set takes seats; the rest are counted for ranking
    (R-BTN-100). The instance it bills is the `host` or `service` instance, or the first account
    instance in its `uses` with a free seat. It adds any instance its config names for that leg.
    A `prefer` entry carries the bills for its own candidate (`prefer: [{ticket_id, leg?,
    bills?}]`).
  - **Taking seats.** A claim's bills are seats for the leg it is for, held until its first
    `advance`. Each `advance` rewrites the claim's seats for the leg it starts. If a named
    instance would exceed its capacity, counting the seats held by claims other than this one,
    the claim or advance is refused by rule 11 with `instance-busy`. A refusal is never a failed
    attempt, and a `prefer` claim goes on to its next candidate. The holder's hostname and ticket
    are named only where the caller's key is granted on the holder's repository (R-BTN-99).
    Claims are serialized in the tenant's object, so the first to bill a free seat holds it.
  - **Releasing.** An `advance` that does not name an instance releases its seat, and so does
    the claim's end. A reap of a silent runner releases its seats at the reap. A fence-pending
    reap (R-BTN-19) releases them at `fence-cleared` or the fence deadline: until then a reaped
    incarnation that may still be driving the device keeps its seat. A dead runner never
    strands one.
  - **Recommendations see seats.** A leg whose `requires.resources` names a resource with
    capacity is offered to a runner only while one of its usable instances of it has a free seat
    (§6.6, step 4). `baton leg why` answers `busy` for such a resource, naming the holder as above.
    An instance's active seats, and the runner's own `host` instances, are served in `GET
    /v1/runner/instances` (R-BTN-99).
  - Baton cannot know what a runner really uses. A runner that uses an instance without billing
    it, or bills one it never touches, is acting on its own statement. Seats keep cooperating
    workers from colliding; they confine nothing (values 12).

## 7. Conditions *(proposal)*

A leg that cannot go on alone (it needs a person, it hit an error or it has something to report)
**raises a condition**. A **binding** chooses the course that handles it, and the handler is an
ordinary child ticket. A `suspend` condition's leg resumes with the **restart** the handler
chooses. A condition nothing handles reaches the **debugger** (**Needs you**). Baton raises
conditions of its own the same way. The same section defines the edges that start or stop other
work (**calls**, **choice stations**, **timers** and **compensation**) and the **outbox**, through
which runners make the git writes Baton intends.

Limits that hold throughout:

- Core reads no course meaning (R-BTN-50) and runs no repository code (R-BTN-98).
- Baton writes no git, sends no mail and calls no service. Every git write and every check run
  Baton intends goes through the outbox, which couriers deliver (R-BTN-171).
- Baton queues nothing for people. The outbox's only kind outside git is `forge-check`
  (R-BTN-114, R-BTN-115). A person is reached by a person's leg (R-BTN-116), by a posted
  decision (R-BTN-78), or by a `hitl` condition and whatever course is bound to it.
- A ticket stays sequential (R-BTN-86). Everything below that runs in parallel is a child ticket.

### 7.1 Raising a condition

- **R-BTN-160 (conditions: typed, declared, raised by any leg).**
  - **Type.** A condition is a typed event that a running leg raises. Its type matches
    `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$` and is at most 64 characters long. The dots form a
    hierarchy: `hitl.spec-contradiction` is a `hitl`, so a declaration or binding for `hitl`
    covers it.
  - **Standard types**:

    | Type | Disposition | Raised by |
    |---|---|---|
    | `hitl` | `suspend` | any leg; core raises `hitl.decision` (R-BTN-163) |
    | `warning` | `notify` | any leg |
    | `error` | `interrupt` | any leg; core's classes are `error.transient`, `error.capability`, `error.spec`, `error.contract-output`, `error.contract-input` |
    | `baton` | per sub (R-BTN-163) | core only |

    Any leg may raise a standard type, or a subtype of one, without declaring it — except
    `baton`, `baton.*` and `hitl.decision`, which are core's alone: the validator refuses a course
    declaring them and Baton refuses a leg's raise of them (`invalid-params`). A leg may also
    narrow what it may raise: `"conditions": []` allows none and `"conditions": ["warning"]`
    allows only warnings.
  - **Declaring.** A course declares its own types in the course file (R-BTN-69):
    `"conditions": {<type>: {"disposition": "interrupt" | "suspend" | "notify", "restarts":
    {<id>: <description>}, "default": <id>, "wait_s": <n>, "retryable": <bool>, "light": <bool>,
    "description": …}}` (`light`, R-BTN-173). Only `disposition` is required. A restart id matches R-BTN-78's decision-id pattern. A
    declared subtype of a standard type inherits that type's disposition unless it states its
    own.
  - **Error types are `interrupt` conditions.** The course file has no `error_types`; the
    validator refuses it, along with `max_duration`, `max_attempts_s` and `max_ready_s`
    (R-BTN-167).
    - `retryable` decides whether the retry policy retries the type, for every leg; no policy
      overrides it (R-BTN-122).
    - A course type's class is `transient` when retryable and `spec` otherwise.
    - An exception the script does not type is `error.transient`.
    - `LegError(type, message)` raises an `interrupt` type. The exception is a `LegError` naming a
      `prerequisite`, which ends the claim `released:blocked` (R-BTN-126).
    - The standard courses declare `error.no-answer` (`interrupt`, `retryable: false`).
  - **Signature.** A course's signature (R-BTN-111) lists the conditions its legs may raise: its
    own types and, unless a leg narrows them, the standard ones. `baton course test` prints the
    signature.
  - **Raising.**
    - A leg script calls `ctx.raise(type, {subject, body?, restarts?, default?, wait_s?,
      severity?, light?})` from `@immediately-run/baton/leg` (R-BTN-133).
    - A session in a leg calls `baton leg raise <type> --subject … [--body <file>] [--restarts
      <json>] [--default <id>] [--wait <s>] [--severity …] [--light]` on the local channel
      (R-BTN-106).
    - The runner checks a raise as it checks a move:
      - the type is standard or declared, and allowed to the leg;
      - `restarts` are the declared ones or a subset of them (a standard type with none declared
        takes the raise's own);
      - `default` is one of them;
      - `severity` is valid (R-BTN-125).
    - A raise that fails the check is answered on the channel with the reason.
  - **Dispositions.** Condition, handler ticket, restart and binding are defined above and in
    R-BTN-161:

    | Disposition | Bound | Unbound |
    |---|---|---|
    | `interrupt` | The leg ends `released:cannot-finish:<class>` with `error: {type, message}`, `message` free text under §12.3. The retry policy routes the ticket (R-BTN-122). A handler ticket is filed as well, and nothing waits for it. | Same, with no handler ticket |
    | `suspend` | The leg waits for the handler's restart (R-BTN-162) | The debugger is the handler (R-BTN-163) |
    | `notify` | A handler ticket is filed, the raise returns at once and the leg goes on | The raise is only recorded |

  - **Reported before it takes effect.** The runner reports each raise with `POST
    /v1/runner/claims/{id}/conditions` and the body `{type, disposition, handler?, restarts,
    default?, severity?, url?, light?, question?}`.
    - The body holds filter fields only (R-BTN-33), never the subject or the body. `url` is sent
      only for an unbound `suspend` and points to where git holds the question (the leg's
      evidence or its hand-off), under R-BTN-92's link rule. `question` is sent only for a light
      raise: the pointer to the question's text off the branch (R-BTN-173).
    - Baton answers with a `condition_id` and, when `handler` names a course, the handler's id
      `handler_id` (below), and stores the `conditions` row; the runner then writes the handler
      ticket under that id. It records an activity
      of kind `condition` on the leg run and a `condition` event in the ticket's history
      (R-BTN-81).
    - A claim may hold at most 20 open conditions, and a ticket may raise at most 200 a day.
      Past either limit the request is refused with `quota`.
    - A raise costs two writes and a settlement one (§2's write budget).
  - **Closing.** A condition is open until its outcome is settled:

    | Condition | Closes when |
    |---|---|
    | `interrupt` | it is raised, or, if bound, when its handler ticket closes |
    | unbound leg-raised `notify` | it is raised (outcome `recorded`) |
    | bound `notify` | its handler ticket closes |
    | `suspend` | its handler ticket closes `done` or `withdrawn`, or an owner resolves it (R-BTN-163) |
    | core `baton.<sub>` | the cause the owning rule names ends |
    | core `baton.retries`, `baton.contract` or `baton.stalled` | per R-BTN-163 |

- **R-BTN-125 (severity).**
  - **Values.** A condition carries `severity`: `critical`, `high` or `normal`. The default is
    `normal`.
  - **Who sets it.**
    - A leg sets it on the raise.
    - A posted decision may carry `severity` (R-BTN-78), which its `hitl.decision` condition
      takes.
    - Core conditions are `normal`, except `baton.contract`, which is `high`.
  - **What it does.** Severity is data for the handler course and the order of the debugger's
    list (R-BTN-163). It routes nothing and gates nothing.

### 7.2 Handlers

- **R-BTN-161 (bindings choose a handler course; the handler is a ticket file).** *Under `landing: protected`, the handler ticket is proposed, not filed, and not claimable until it lands with a `std:approval@1` (R-BTN-180, proposal).*
  - **Binding.** A binding maps a type prefix to a course id, for example `"conditions":
    {"hitl": "ask", "warning": "announce", "baton": "announce"}`; for an `error` type the value
    may be `{"course": <id>, "replaces": "retry"}` (R-BTN-122). It is written in one of two
    scopes:
    - the repository's scope, in `.baton/baton.json`;
    - a ticket's scope, in its file (`conditions:`, posted by the ticket source as
      `tickets[].conditions`). A ticket's binding applies to that ticket and to every ticket
      below it.
  - **Resolution.**
    - The runner resolves a raise from the verified home tree at the claim's commit (R-BTN-133).
    - It walks scope by scope from the innermost: the raising ticket, its parent and on to the
      root, then the repository.
    - Within a scope the longest matching prefix wins, and the first scope with a match wins.
    - No match leaves the condition **unhandled** (R-BTN-163).
    - The resolved course and its scope are written into the handler ticket and the activity.
      `baton leg why` and `baton course test --bindings` print, for each type a course may
      raise, the course it resolves to and the scope that supplied it.
  - **Who may bind.** Anyone who can push may bind (R-BTN-66). Only default-branch code runs
    (R-BTN-143), so a binding on an unmerged branch binds nothing. No owner setting gates a
    binding.
  - **The handler ticket.**
    - The runner writes the handler ticket git first, through the ticket source's `file(ticket)`
      export (R-BTN-74; the markdown source writes `<items>/<local id>.md`). It pushes the file
      before the raise returns or the leg ends.
    - Its id is the raising ticket's local id, then `.c`, then Baton's count of conditions raised on
      that ticket so far (`R3-1205.c3`), returned as `handler_id` by the raise's report. When that
      would break the ticket-id rule's 64 characters, the id is `c<condition_id>`. Ids ending
      `.c<n>` or of the form `c<n>` are reserved: the markdown source skips a file carrying one
      without a `handles` block, with a sync warning. A handler write never overwrites a foreign
      file at its path: its courier marks the entry `failed` with `collision`, and Baton holds the
      ticket `outbox-collision` (R-BTN-171).
    - Its frontmatter names `course` (the resolved course), `parent` (the raising ticket),
      `handles: {type, disposition, restarts, default?, severity?, wait_s?, condition_id}` and
      `raised_by: {leg, run}`. Its body is the subject and body the leg supplied.
    - It is a child (R-BTN-86), so R-BTN-149's four-generation bound applies. From then on it is
      an ordinary ticket.
    - The outbox writes the handler tickets of conditions Baton raises (R-BTN-171).
  - **A handler course's contract.**
    - Its input (R-BTN-111) is a **`std:condition@1`**: `{type, disposition, restarts, default?,
      severity?, raised_by: {ticket, leg?, run?}, question: <std:git.file@1>, resolve_url?}`:
      `question` is the handler file, or a light question's blob (R-BTN-173); `resolve_url`
      is a core condition's resolve page (R-BTN-163).
    - A course bound to a `suspend` type produces a **`std:restart@1`** at every end station:
      `{restart: <id> | null, reason: "chosen" | "unanswered" | "withdrawn" | "resolved",
      answered_by?, commit?}`. `baton course test` refuses
      the binding otherwise.
    - What a handler of a `notify` or `interrupt` type produces is not read.
    - Both formats are in R-BTN-110's library.
  - **Delivery runners.** Reaching a person is a runner with a capability, not a key role. A handler course declares the
    capability types its delivery legs need (R-BTN-121), such as `channel:push`, or
    `channel:email` with `credential:SMTP_URL`. Core names none of them. A runner that only
    delivers has a key granted, with its tags barred, for delivery courses alone (R-BTN-60,
    R-BTN-66).

- **R-BTN-162 (a suspended leg waits in its claim, then blocks; it resumes with a restart).**
  - **In the claim.**
    - After the handler ticket is pushed, the runner keeps the claim and heartbeats as usual. It
      records an activity `condition-wait` naming the handler, shown on **Running** and by
      `baton leg why`.
    - It waits up to `wait_s`: the raise's value, else the type's declaration, else 120 s for
      `hitl` and 0 for every other type.
    - The wait is bounded by the owners' `max_wait_s` (R-BTN-122) and counts toward the leg's
      `start` timer (R-BTN-167).
  - **Settling within the wait.** The handler ticket closes in a transaction: a snapshot that
    shows it closed, the end of its last claim, or an owner's resolve.
    - In that transaction Baton queues a `handled` message for the raiser's holder and rings it
      (R-BTN-91).
    - The heartbeat answers `handled: [{condition_id, handler, outcome, output?}]`, where
      `output` is a pointer (R-BTN-82).
    - The runner reads the value from git and validates it as a `std:restart@1` whose `restart`
      is one the raise offered, or null. `ctx.raise` returns `{restart, reason}` and the leg goes
      on in the same session.
    - A value that fails validation ends the claim `released:cannot-finish:contract-input`.
    - In a session, `baton leg raise --wait` blocks for the wait and prints the restart or
      `suspend`. A harness that bounds a single tool call calls `baton leg await <handler>
      --timeout <s>` again until the wait is spent.
  - **Past the wait, the leg blocks.**
    - `ctx.raise` returns `{suspended: true}` and the script returns.
    - The runner pushes the work done so far, calls `handoff` (R-BTN-44) and ends the claim
      `released:blocked` with the prerequisite `{kind: "condition", ref: <condition_id>}`
      (R-BTN-120, R-BTN-126).
    - The prerequisite is met when the handler ticket closes `done` or `withdrawn`, or when the
      debugger resolves the condition.
    - Its row is provisional on the commit that wrote the handler. A handler already closed when
      the end arrives writes no row, so the next claim resumes at once.
    - A blocked end is not a failed attempt. It counts toward `max_blocked` (R-BTN-122).
  - **Any other way the wait ends, the leg blocks too.** Any end of a claim waiting on an open
    `suspend` condition other than the one that consumes its restart — a release for any reason
    (`requested`, `owner-cancel`, an owner bar, `leg-timeout`), a `cannot-finish` end — and any
    reap of it, `leg-timeout` included, writes the `condition` block on the leg in that
    transaction, as the blocked end would. It is not provisional: the handler commit was pushed
    before the wait, or there is none (unbound, or light, R-BTN-173). So no claim of the leg runs,
    and asks again, while its question is open; the condition and its handler stay as they
    were.
  - **Resuming.**
    - On `unblocked` (R-BTN-77) any runner eligible for the leg may claim it.
    - The claim response carries `resume: [{condition_id, type, handler, outcome: "done" |
      "withdrawn" | "resolved" | "answered", restart?, answered_by?, output?, handoff}]`, a list
      in raise order (R-BTN-173), `output` and `handoff` as pointers. The runner validates each as above, and the
      script reads `ctx.resume` before anything else.
    - A handler closed `withdrawn` resumes with `{restart: <default>, reason: "withdrawn"}`, or
      with `restart: null` when the raise named no default.
    - A condition that settles after its holder died, or whose consuming claim is reaped before
      its end, is carried to the next claim the same way until an end records it (R-BTN-173).
  - **No answer.**
    - The leg decides what `restart: null` means. Typically it raises `error.no-answer`, and the
      retry policy holds the ticket.
    - A retry runs the leg from its hand-off. If the leg raises again, a fresh handler ticket
      asks the question again.
  - **One at a time.** A leg awaits one `suspend` condition at a time. The `notify` conditions it
    raises in the meantime are not waits.

- **R-BTN-173 (light questions: answered in the claim, or promoted to git).** *Under `landing: protected`, runners push no `refs/baton/*` ref; a promoted question is proposed, not filed, until it lands with a `std:approval@1` (R-BTN-180, proposal).* A light question is
  a bound `suspend` condition whose handler lives in Baton's database until the parent stops
  waiting. Answered while the parent waits, it never touches git until the consuming leg ends;
  otherwise it is promoted to an ask file, and from then on its answer is git's.
  - **Raising.** A raise or a declaration carries `"light": true` (`ctx.raise(type, {…, light:
    true})`, `baton leg raise --light`), and the raise's report carries `light`. An unbound light
    raise is an ordinary unbound `suspend` (R-BTN-163).
  - **The handler is Baton-held.**
    - The runner writes no ticket file and makes no default-branch commit before it waits. The
      question's text lives in git off the branch: before the report, the runner pushes a
      parentless commit whose tree holds `question.md` (the subject and body) to the ref
      `refs/baton/questions/<local id>/<commit sha>`, and the report carries `question`, a
      `std:git.file@1` naming that commit and path. Baton stores the pointer, never the text
      (R-BTN-33), and leaves the ref in place; `std:condition@1`'s `question` is that pointer.
    - Baton files the handler ticket, id as R-BTN-161's, in its database alone, as it holds the
      `changes` source's check tickets (R-BTN-114). Binding, delivery legs (ordinary claims by
      runners with `channel:*` capabilities, R-BTN-161) and the parent's wait (R-BTN-162) are
      unchanged.
    - A Baton-held ticket's children are Baton-held. A leg run on one calls no `file` export;
      its `spawned` end carries `{local_id, course, input?}` per child (`input` pointers only,
      R-BTN-82), and Baton creates each child in that transaction at its course's start station,
      exempt from `spawned-unposted` (R-BTN-86). So the ask's `open` files its `deliver` child.
    - A Baton-held ticket's positions are the holder's word (R-BTN-63), its ends are confirmed at
      the end (nothing in git shows them, R-BTN-10), and a snapshot neither posts nor drops it.
      R-BTN-5's re-verification reads Baton's record for it, not git.
  - **Answering in the claim.** A delivery leg that reads a reply reports it with `POST
    /v1/runner/claims/{id}/answers` `{condition_id, channel, message_id, restart, answered_by}`,
    `answered_by` being an opaque id the channel gives the person (`<channel>:<id>`, ≤ 64
    characters, never a name or address), asserted by the delivery runner and shown as "reported
    by claim N via channel C", never as a verified identity. In that one transaction Baton
    reads the condition and:

    | The condition is | Baton |
    |---|---|
    | open, not promoted | settles it (`outcome: answered`, `restart`, `answered_by`), closes the handler `done`, queues `handled` with the restart inline and rings the holder (R-BTN-91) |
    | promoted, with no answer queued | queues an outbox `answer` entry for the ask file (R-BTN-171) |
    | promoted with an answer queued, settled or closed | records the reply `ignored` (an `answer-ignored` history row) and applies nothing |

    - A report already accepted (same `condition_id`, `channel` and `message_id`) answers `ok`
      and changes nothing. A restart the raise did not offer is `invalid-params`.
    - The parent's `ctx.raise` returns `{restart, reason: "chosen", answered_by}` and the leg goes
      on in the same session. No git write is made then.
  - **Recording and carrying the answer.**
    - Every end of a claim that consumed a light answer is preceded by a push recording it in the
      leg's evidence (its closing marker) or its hand-off, and lists it as `answers:
      [condition_id]`; Baton then marks the condition `recorded`.
    - Every settled `suspend` condition of the leg that is not `recorded` is carried in the next
      claim's `resume` (a list, in raise order), whatever ended the earlier claim: a blocked end,
      a release or a reap. The leg reads `ctx.resume` before it asks anything, so a claim reaped
      after the answer arrived never asks again.
    - A ticket that changes station or closes while a light answer of a leg it leaves is settled
      but not `recorded` (an owner `route`, an `exhausted` leg, a timer's `leg`, a choice, a
      withdrawal) records it in git another way: in that transaction Baton queues an outbox
      `handler` entry writing the closed handler as an ask file at the end station it closed
      at, carrying `answer` and `answered_by`, and marks the condition `recorded` when the entry
      lands.
  - **Promotion.** Any end of the waiting claim, or its reap, that finds its light condition
    still open promotes it in the same transaction:
    - Baton queues an outbox `handler` entry that writes the handler ticket as an ask file at the
      station it has reached (R-BTN-171), and writes a `condition` block on the leg (R-BTN-162's
      rule for every `suspend`), not provisional. A reaped parent is therefore blocked on the
      open question and is never re-run to ask it again.
    - The ask file carries the position Baton recorded: frontmatter `baton_position: {station,
      path}`, the station reached and the Baton-held legs run with the stations they reached.
      The CLI's station-function library, which the standard courses' `sync.mjs` uses (R-BTN-74,
      R-BTN-169), reads it as the closing markers of
      those runs, so the sync posts the ask at that station (`waiting`) and `open` is not run
      again; the delivery child stays Baton-held. The ticket keeps its row, its arrival instants
      (R-BTN-166, R-BTN-167) and its `deliver` child; `baton_held` clears in the transaction that
      sets the entry `confirmed`. The ask's body is the text of its `question` pointer, which the
      courier reads from git.
    - From then on the condition settles only when the ask closes in git (R-BTN-162, R-BTN-169);
      the delivery legs go on, and their replies reach the file through the outbox.
    - An `answer` entry writes the reply's `answer` and `answered_by` with `baton_write: <id>`. The
      courier first reads the file at the fetched head; a file that already carries an answer is
      not written, the entry is marked `skipped`, and Baton records that reply `ignored`.
    - An owner's resolve (R-BTN-163) closes a promoted condition like any other close: its
      `handler` and `answer` entries are dropped as R-BTN-171 says, and an answer a snapshot then
      posts in the ask is recorded `ignored`.
  - **Channels that answer.** A delivery leg that reports answers declares `"answers": true`.
    Its channel must keep each reply readable by condition id until Baton has accepted it
    (history, or redelivery until acknowledged): the leg acknowledges a reply only after Baton
    answered its report, and a re-claimed leg re-reads the replies of its condition. `retract`
    reports every reply not yet reported before it withdraws the question. A channel that cannot
    keep replies declares `"answers": false`, and its leg only notifies.
  - **Failure points.** Each is a step of `model/lightQuestion.qnt`, whose instance `full`
    holds every rule above; dropping any one of them loses or doubles an answer.

    | Failure | What happens |
    |---|---|
    | The parent dies while waiting, before any reply | It is reaped; the reap promotes the question and blocks the leg; nobody asks again |
    | A reply races the end of the wait | One transaction comes first. Settled first: the blocked end writes no row and the next claim resumes with the answer. Promoted first: the reply goes to the ask file |
    | The parent dies after the answer settled, before or after consuming it | The next claim's `resume` carries it |
    | The delivery leg dies after reading a reply, before reporting it | Its claim is reaped; the next claim re-reads the reply from the channel |
    | The delivery leg's report is applied but the response is lost | It reports again: `ok`, no second effect |
    | The person answers on two channels, differently | The first report Baton accepts settles; the other is recorded `ignored` |
    | A reply is reported after promotion | It is queued as an `answer` entry and written to the ask file, unless the file already has an answer |
    | The person answers in the ask file while an `answer` entry is queued | The entry is `skipped`; the channel's reply is recorded `ignored` |
    | The courier dies between push and mark, or its push is refused | The lease lapses and the entry is queued again; the next courier finds `baton_write: <id>` and reports it; a refusal holds the ticket (R-BTN-171) |
    | A reply is sent after `retract` | It is outside Baton; the channel shows the question withdrawn |
    | The ticket leaves the leg (a route, a close) with a settled answer not yet recorded | The closed ask is written through the outbox with its answer |
    | An owner resolves a promoted question while a courier holds its `handler` entry, and that courier's lease lapses after pushing | The entry is dropped and a `withdraw` follows, which writes nothing if the push never happened; a reply then posted in the file is recorded `ignored` |

### 7.3 The debugger and Baton's own conditions

- **R-BTN-163 (the debugger: unhandled conditions, and core's own).**
  - **Needs you is the debugger.** **Needs you** (§11) lists the following until each closes:
    - every open condition with no handler ticket;
    - the floor (below).

    Entries are ordered by severity, then by age, and each shows its type, restarts, default,
    detail and `url`. No rule outside §7 has its own Needs-you listing: a rule raises a
    condition `baton.<sub>`.
  - **An unhandled `suspend` condition** waits in the claim and then blocks as R-BTN-162 says,
    with the debugger in the handler's place; its `condition` row is not provisional, since no
    handler commit exists.
  - **Resolving.** An owner answers a `suspend` condition with `baton owner resolve <ticket>
    <restart>`, or the dashboard's equivalent, which is the registry action `owner.resolve`.
    - The command closes the condition with a restart the condition offers and no other.
    - A leg-raised condition resumes with `{restart, reason: "resolved", answered_by: <the
      owner's credential>}`, handed to the runner inline rather than as a pointer.
  - **Unhandled `notify`** conditions are only recorded. **Unhandled `interrupt`** conditions
    follow the retry policy.
  - **Core's own conditions** (`baton.*`) are raised by Baton, with no leg, in the transaction
    that finds the cause. They sit on the ticket, repository or runner concerned, or on the tenant when none applies
    (`baton.sign-in-burst`, `baton.bearer-over-http`).
    - **`baton.retries`, `baton.contract` and `baton.stalled`** have disposition `suspend` on the
      whole ticket, the standard restarts below and no default, so they never resolve
      themselves:

      | Condition | Raised when | `retry` | `route:<leg>` | `park` |
      |---|---|---|---|---|
      | `baton.retries` | the retry policy holds the ticket: attempts or budget spent, a non-retryable class other than `contract-input`, or `blocked-exhausted` (R-BTN-122) | clears the hold and the backoff | re-routes to a leg leaving the station (R-BTN-83) and clears the hold | closes the condition and keeps the hold; nothing is raised again while it stands |
      | `baton.contract` | a leg's input fails its schema, holding the ticket `non-retryable:contract-input` (R-BTN-82); its producer is re-run in git, then `retry` | as above | as above | as above |
      | `baton.stalled` | core's default timer fires (R-BTN-167); it closes by itself when the leg is posted `ready` | closes it and re-arms the timer | re-routes | sets an owner hold `hold_reason: parked` and closes it |

      Any owner act that clears the hold under a `baton.retries` or `baton.contract` condition
      closes the condition, including §6's clear-hold.
    - **Every other core condition** is a `notify` condition `baton.<sub>`, where `<sub>` is the
      reason the rule that raises it names (for example `output-invalid`, `check-mismatch`,
      `course-changed`, `queue-over`, `ready-late`, `outbox-late`). Every rule that raises one
      names it; nothing else lists them.
      - It carries a `detail` of identifiers and numbers only (§12.3).
      - It closes when its cause ends.
  - **Posted decisions.** A posted decision is git's protocol, and its answer stays in git
    (R-BTN-78). Each open posted decision raises the core condition `hitl.decision` on its
    ticket, which closes when the decision does. No leg waits on it, because the decision block
    already does.
  - **Binding core's conditions.** A repository may bind `baton`, any `baton.<sub>`, or
    `hitl.decision`.
    - Baton resolves the binding from the repository's posted `bindings` (§4.4) and the
      ticket's posted `conditions`, as R-BTN-161 walks scopes, and files the handler ticket
      through the outbox (R-BTN-171). The id is `<ticket local id>.c<n>`, or
      `baton.<sub>.<condition_id>` for a condition on a repository. A condition on a runner or on
      the tenant has no repository whose bindings and outbox apply: it is never bound, and Needs
      you lists it as unhandled.
    - The frontmatter's `raised_by` names no leg. The runner generates the body from the
      condition's fields.
    - Such a handler only delivers. A `baton.*` condition is answered only through Baton's own
      authenticated surfaces — `baton owner resolve`, an owner's or administrator's dashboard
      session, or an MCP key allowed `owner.resolve` (R-BTN-129) — never through git. The
      handler's input carries `resolve_url`, the dashboard's resolve page for the condition
      (`https://<origin>/conditions/<condition_id>`), and its message carries that link, where a
      signed-in owner answers by choosing one of the condition's restarts (R-BTN-155). Nothing the
      handler writes to git (an `answer` in its file, its output) is read for the condition, which
      closes only by its cause or by a resolve. `hitl.decision` closes with its decision, in git
      (above).
    - **Flapping.** A core `notify` condition raised within an hour of an earlier one of the same
      `(type, ticket, ref)` closing files no handler, and neither does any raise past 20 `handler`
      entries queued for the repository in the hour. Such a condition is unhandled (Needs you
      lists it), and its `detail` counts the raises so skipped (`reraised`, `outbox-throttled`).
    - When the condition closes, the handler is superseded (R-BTN-168).
    - A binding of `baton.outbox-late` is ignored, so that a stuck outbox never feeds itself.
  - **The floor, which no binding removes.**
    - **Needs you** and `baton decision list --all` list, until each closes and whatever its
      handler does:
      - every open `hitl` and `hitl.*` condition;
      - every open `baton.retries`, `baton.contract` and `baton.stalled` condition;
      - every open posted decision.
    - **Needs you** also lists any `suspend` condition whose handler ticket has had no leg run
      for 24 hours.
    - A handler course can only add channels above the floor.
  - **Reading the list.**
    - `baton decision list` reads `GET /v1/repositories/{repository}/conditions?open=1&person=1`:
      the open `hitl`, `hitl.*`, `baton.retries`, `baton.contract` and `baton.stalled`
      conditions and posted decisions, with their links. It marks nothing, and `--watch` asks
      once a minute.
    - Without `person=1` the route lists every condition, filtered by `open`, `type` prefix and
      `ticket`, 100 per page with a cursor.
    - Any key granted on the repository, an owner of it or an administrator may read it. The
      registry action is `condition.list`.

### 7.4 Retries

- **R-BTN-122 / R-BTN-23 (retries: the default handler of `error`).** The retry policy handles
  every `interrupt` condition. A binding of an `error` type adds a handler ticket beside the
  retry policy and does not replace it, unless the binding says `"replaces": "retry"`: then the
  handler's restart (`retry`, `route:<leg>` or `park`) decides in the policy's place, every
  restart checked against the owners' bounds below, and the leg ends blocked on the condition as a
  `suspend` would. Only the runner knows the binding, so it reports the raise with `replaces:
  "retry"` and ends the claim `released:blocked` on the condition, never `cannot-finish`.
  *(Specified, not built.)*
  - **State.** Attempts are counted **per ticket and leg**, with §9's rules for what counts as a
    failed attempt, in `leg_attempts`: repository, ticket, leg, `attempts`, `first_attempt_at`,
    `retry_after` and `last_error_type`. A failing `review` spends none of `implement`'s attempts.
    The row resets — `attempts` to 0, `first_attempt_at` and `retry_after` cleared — when a run
    of the leg reaches one of its outcomes (an `advance` or end reporting it, or a posted path
    extended by it) and when a hold is lifted, so each pass of a loop starts with the full
    policy and a fresh `first_attempt` budget.
  - **Policy.** A leg may carry a retry policy:

    ```json
    "retry": {"initial_s": 3600, "coefficient": 4, "max_interval_s": 86400, "max_attempts": 3,
              "in_claim": 0, "exhausted": "<leg>", "exhausted_on": ["<type>"]}
    ```

    A leg with no policy takes the repository's default policy. Whether a type is retried is
    its declaration's `retryable` and the owners' floor (R-BTN-160); a leg that must not retry
    a type raises a non-retryable type of its own, or sets `max_attempts` 1.
  - **Backoff.**
    - After failed attempt *n*, the leg's `retry_after` is now plus `min(initial_s ×
      coefficient^(n−1), max_interval_s)`, multiplied by a uniform factor in [0.9, 1.1].
    - While `now < retry_after`, the leg's prerequisite `retry` is unmet (R-BTN-120): a
      `ticket_blocks` row of kind `retry` on that leg, with `until` set to `retry_after`.
    - A claim or `advance` into the leg is refused **`backing-off`** (with `until`), not
      `blocked`. The leg is left out of recommendations, and `baton leg why` shows it with
      `attempt: <n> of <max>`.
    - The alarm clears the row at `retry_after`, and `unblocked` follows (R-BTN-77). A backoff
      on one leg does not stop the ticket's other legs.
  - **In the claim, first.**
    - `in_claim: n` lets the runner re-run a leg that failed with a retryable type up to *n* more
      times under the same claim before it releases with a failed attempt.
    - It waits the first steps of the same schedule, at most 5 minutes each.
    - An in-claim retry is not a run for `max_runs` (R-BTN-69) and not a failed attempt. Each one
      is an activity.
    - A provider at capacity is a blocked prerequisite (R-BTN-126), never an in-claim retry.
  - **Exhaustion.** When *n* reaches `max_attempts`, when the leg's `first_attempt` timer has
    run out (`budget-spent`, R-BTN-167), or when the type is non-retryable:
    - Baton holds the ticket (`hold_reason` `attempts-exhausted`, `budget-spent` or
      `non-retryable:<class>`), logs the reason and raises `baton.retries` (R-BTN-163).
    - When the policy names `exhausted`, a leg leaving the same station, Baton instead queues
      that leg (`next_source: retry`), held as a route override until the station changes
      (R-BTN-83), and raises nothing.
    - A non-retryable type still holds, unless the policy lists it in `exhausted_on`.
    - `contract-input` holds at once, is not an attempt and raises `baton.contract`.
    - `lease-lost` counts once per distinct runner.
    - Lifting a hold resets the leg's counts, as does the leg reaching an outcome (above).
  - **Owners' bounds.** The course file is in git, so the owners' `retry` setting, a Baton
    setting (R-BTN-66), bounds every policy. Baton applies, field by field, the stricter of the
    course's policy and the owners' bounds:

    | Bound | Default |
    |---|---|
    | default policy | `initial_s` 3600, `coefficient` 4, `max_attempts` 3 |
    | ceiling `max_attempts` | 10 |
    | ceiling `max_interval_s` | 7 days |
    | ceiling `in_claim` | 2 |
    | ceiling on an interrupting `start` or `first_attempt` timer (R-BTN-167) | 7 days |
    | ceiling `max_refreshes` (R-BTN-123) | 3 |
    | `max_blocked` (R-BTN-126), the owners' alone: a course sets none | 5 blocked ends per ticket and leg a day |
    | `max_wait_s` (R-BTN-162) | 900; at most 3,600 |
    | floor `initial_s` | 60 |
    | floor `coefficient` | 1; a course's value below 1 is refused by core and by `baton course test` |
    | floor types, never retried | core's `capability`, `spec`, `contract-input` |

    - `baton course test` warns where the bounds cut a course's policy back, and the course's
      view shows the policy in force.
    - `baton course test` refuses a policy that names an undeclared type.
    - The floor binds hard on core's built-in types. On a course's own types it binds only as git
      does, so `baton course test` warns when a floor type is not declared. An owner who
      needs a hard bound sets `max_attempts` 1 and `in_claim` 0.

### 7.5 Timers and deadlines

- **R-BTN-167 (timers on a leg, interrupting or not).**
  - **Shape.** A leg carries `"timers": [<timer>, …]`, each `{"after_s": <n>, "from": "arrival"
    | "ready" | "start" | "first_attempt", "interrupting": <bool>, "leg"?: <leg>, "raise"?:
    <type>}`. `after_s` runs from 60 s to 2,592,000 s (30 days). The owners' ceiling (R-BTN-122)
    further bounds an interrupting `start` or `first_attempt` timer.
    - An interrupting timer has no `raise`, and its `leg`, if any, leaves the same station and
      is not on a leg leaving a choice station (there, the winning leg's `after_s` says when,
      R-BTN-166).
    - A non-interrupting timer has a `raise`, a `notify` type or `baton.stalled` (below), and no
      `leg`.
    - The course validator (R-BTN-69) and `baton course test` refuse any other timer, naming
      the leg and the field.
  - **When the clock starts.**

    | `from` | Clock starts at |
    |---|---|
    | `arrival` | the ticket's arrival at the leg's `from` station |
    | `ready` | the leg becoming ready and unclaimed (schedule-to-start) |
    | `start` | the leg run's start, the `advance` that started it, by Baton's clock (start-to-close; R-BTN-90) |
    | `first_attempt` | the leg's first attempt since its retry state last reset (schedule-to-close; R-BTN-122) |

    Baton holds each timer's instant in `ticket_timers` (repository, ticket, leg, timer index,
    `from`, `due_at`, `fired_at`) and fires it from the alarm. A timer fires once per `from`
    instant. The rows are owner state (R-BTN-88): an `arrival` timer's instant restarts only
    when the ticket's station changes, never when a Baton moves.
  - **Interrupting timers** (`"interrupting": true`):
    - Baton releases any running claim on the leg with `release` reason `leg-timeout` and reaps
      it as R-BTN-90 does.
    - With `leg` (a leg leaving the same station), Baton queues that leg (`next_source: timer`).
      The leg is held as a route override until the station changes, and its own run writes it
      to git.
    - Without `leg`, the firing is a failed attempt.
    - A `first_attempt` timer without `leg` spends the leg's budget: no further attempt starts,
      and the ticket goes to exhaustion (`budget-spent`, R-BTN-122).
  - **Non-interrupting timers** (`"interrupting": false`): Baton raises `raise` (a `notify` type)
    on the ticket, once per timer per arrival, and the leg goes on. `{from: "ready", raise:
    "baton.ready-late"}` is a leg that is ready but untaken.
  - **Core's default timer.** Every leg carries `{after_s: 259200, from: "arrival",
    interrupting: false, raise: "baton.stalled"}`. It counts only while the sync posts the leg
    `waiting` (R-BTN-78), not while Baton itself holds the leg waiting or a `time` wait holds
    it. A course overrides its `after_s` on a leg by listing there `{"after_s": <n>, "from":
    "arrival", "interrupting": false, "raise": "baton.stalled"}`, which replaces the default on
    that leg; no other timer may raise `baton.stalled`, and none removes it. It is the one
    non-interrupting timer that raises a `suspend` core condition (R-BTN-163).
  - **Choice stations.** An interrupting timer with `leg` queues its leg unconditionally and
    yields to git's next station change (`route-overridden`); a choice leg's `after_s`
    (R-BTN-166) is one prerequisite among the leg's others, and its settlement does not yield
    (`choice-lost`). The validator refuses the timer form on a choice station's legs.

- **R-BTN-90 (deadlines in a claim, and the owner's controls).** Baton cannot stop a runner. It
  takes the claim away and tells the runner to stop, and fencing makes a runner that ignores it
  harmless (R-BTN-19, R-BTN-26).
  - **The `start` deadline.**
    - The instant of a leg's interrupting `start` timer is the claim's `deadline_at`.
    - When the script's `run` returns, the runner sends an immediate heartbeat out of its cadence
      with `leg_finished: <claim_legs.seq>`. That heartbeat comes before validation, `close`,
      and any wait under the claim on a `short_waits` label or a near `time`.
    - The heartbeat re-arms `deadline_at` to now plus 40 minutes, once per leg run (R-BTN-149).
      The next `advance` and the claim's end clear it.
    - The heartbeat processes `leg_finished` before it delivers messages. A `leg-timeout` release
      still pending for that leg is withdrawn: the message is set `expired` with `withdrawn:
      'leg-finished'`, and a `leg-timeout` event is logged with `{withdrawn: true}`. A release
      already delivered stands.
  - **At the deadline.**
    - The alarm queues the holder a `release` with reason `leg-timeout` and logs `leg-timeout`.
    - The runner aborts the leg at its next safe point, writes its hand-off and ends
      `released:leg-timeout`, which is a failed attempt unless the timer names a `leg`, which is
      then queued (R-BTN-167).
    - A delivered `leg-timeout` release left unacknowledged for 15 minutes is reaped by the
      alarm with a fence, actor `alarm:leg-timeout` (R-BTN-19). The ticket is not re-issued
      until the runner's sidecar confirms that it killed the tool processes, or until the
      fence's deadline passes. This reap counts as the `leg-timeout` end would.
  - **The owner's controls.** These are owner acts, not timers, made with
    `POST /v1/owner/{repository}/claims/{id}/deadline` or on the dashboard, and each is logged
    `override`:
    - `{extend_to}` moves the running leg's deadline to an instant later than both now and the
      current deadline, and at most 7 days ahead. It applies to that leg only. It is refused
      `invalid-params` when the claim has no deadline or once its `leg-timeout` release is
      queued.
    - `{cancel_at}` schedules a Cancel (§6: a hold, and a `release` with reason
      `owner-cancel`) at an instant after now and within 7 days. `{cancel_at: null}` withdraws
      it. The schedule belongs to the claim: if the claim ends first, it lapses, is logged
      `override` with `lapsed: true` and is shown on the ticket's row.
    - The heartbeat response (§14) and the dashboard's claim row carry `deadline_at` and
      `cancel_at`.

### 7.6 Calls and choices

- **R-BTN-165 (a call leg runs a course and waits for it).** *Under `landing: protected`, a call leg's children are proposed, not filed, and not claimable until they land with a `std:approval@1` (R-BTN-180, proposal).*
  - **The leg.** A call leg is `"kind": "call"` with a `spawns` declaration (R-BTN-111), whose
    `course` names the course or courses it calls. The leg's `"to"` is a **completion table**
    `{<station>: <completion>, …}`, checked in order. A question to a person is not a call: a
    planned one is a person's leg (R-BTN-116), one from inside a leg a `suspend` raise
    (R-BTN-162).
  - **What the script does.**
    - The script runs as any leg's does and writes the children git first, through the source's
      `file` export. Each child names a course its `spawns` allows and `called_by: {leg, run}`.
    - The script then returns `spawned` (R-BTN-86).
    - The runner then ends the claim `released:blocked` on `{kind: "call", ref: <claim_legs
      seq>}`, carrying `spawned` (R-BTN-86). A call never waits in its claim: Baton learns the
      children only from that end. The block is not a failed attempt and does not count toward
      `max_blocked`.
  - **Completion.** A `<completion>` is `{"of": "all" | "any" | <n>, "at": [<station>…],
    "skip_withdrawn"?: <bool>, "next": <leg>}`.
    - `at` may be replaced by `"done": true` (closed at any end station), `"withdrawn": true`
      (closed withdrawn) or `"closed": true` (closed either way). `at` names stations every
      course the call may spawn has; a call over `"*"` uses the other three.
    - `next` is the leg queued at the entry's station. It is required unless that station is an
      end (R-BTN-83).
    - An entry may be `null`: its station is an outcome the script may report instead of
      `spawned`, and no completion settles there. A call leg's outcomes are its table's
      stations.
    - A completion ranges over the children this run spawned (R-BTN-86), and only a completion
      does: no `requires.tickets` entry selects them (R-BTN-120).
    - Examples: `{"of": 2, "at": ["approved"]}` is "2 of 3 reviewers approve".
      `{"of": "all", "at": ["merged"]}` followed by `{"of": "any", "at": ["failed"]}` is a
      fail-fast join. `{"of": "all", "closed": true}` waits for every child however it ends, as
      `Promise.allSettled` does.
    - A completion over a call whose script filed no child never holds; a script that files none
      returns one of the leg's outcomes instead of `spawned`.
    - The table's last non-null entry is `{"of": "all", "closed": true, …}`, which holds once
      every child has closed, so a call always settles; the validator (R-BTN-69) and `baton
      course test` refuse a table without it.
  - **Settling.**
    - Baton evaluates the table, in table order, in each transaction that changes the station of
      one of the run's children. The first entry that holds settles the call.
    - A `spawned` end that names no children is refused; a completion never holds over none.
    - Baton stores the position (the entry's station and `next`) provisionally, with
      `next_source: call`, and logs `call-settled {station, children}`.
    - The CLI's station-function library exports `settleCall(course, leg, children)`, which
      applies the same table, so the sync's `locate` confirms or replaces Baton's position. Git
      wins (R-BTN-83).
    - The children still open when the call settles are superseded (R-BTN-168).
  - **What the next leg reads.** The settled children's end outputs are the next leg's input
    `called`, resolved as pointers (R-BTN-82). The call's `spawns` declaration (R-BTN-111) is its
    contract. `baton course test` checks what the declaration provides against each called
    course's input, and what each completion station requires against each called course's end
    outputs.
  - **A `suspend` raise is a call from inside a leg.** It has one child, it settles when that
    child closes, and its `raised_by` takes the place of `called_by`. It keeps its own block kind
    `condition`, which counts toward `max_blocked`.

- **R-BTN-166 (a choice station: the first leg ready wins).**
  - **Arming.** A station may say `"choice": "first"`. At such a station Baton **arms every leg
    leaving it**, not only the queued one. It evaluates for each leg:
    - its prerequisites (R-BTN-120);
    - for a person's leg, its answer (R-BTN-116), so a person's leg may complete there without
      being the queued leg;
    - its `after_s` (60 s to 2,592,000 s, a timer's range): a time prerequisite set to the
      ticket's arrival at the station, by Baton's clock, plus `after_s`. Baton holds the instant
      in `ticket_timers` (R-BTN-167) and the alarm marks it met; like an `arrival` timer it
      restarts only when the ticket's station changes, so a Baton move keeps it (R-BTN-88).

    Only confirmed facts arm a leg. A provisional row or position (R-BTN-83, R-BTN-126) does not,
    and a person's answer counts from the snapshot that shows it.
  - **The first wins, by Baton's clock.** The first leg whose prerequisites all hold settles the
    station, stamped `this.now` (R-BTN-32) in the transaction that makes them hold.
    - That leg becomes the queued leg (`next_source: choice`), and the others are disarmed. The
      settlement is logged `choice-settled {leg, at}`.
    - When legs come to hold in the same transaction, the one listed first in the course file
      wins.
    - An answer committed before the deadline but synced after it loses. A course that wants a
      grace period adds it to `after_s`.
  - **The settlement is held in Baton until git shows it.**
    - It is held in `ticket_overrides` as the owner's route override is (R-BTN-83), and wins over
      the posted pair until the ticket's station changes. It appears in the ticket's history and
      in the owner-state export (R-BTN-88).
    - The winning leg's run writes its closing marker, so git holds the position from the next
      station on.
    - A sync that posts another leg's arrival from a settled choice station is the discrepancy
      `choice-lost` (R-BTN-85) and is not adopted.
  - **Losers.** A disarmed leg never ran, so nothing of it is stopped. Children whose spawning
    leg's `spawns` says `"lifetime": "station"` are superseded when the ticket leaves the station
    (R-BTN-168).

### 7.7 Compensation and cancel

- **R-BTN-168 (compensation, supersession and the built-in cancel).**
  - **Compensation legs.** A leg may say `"compensate": <leg>`, naming a leg of `"kind":
    "compensation"` that undoes it: one that retracts a message, closes a PR or deletes a
    branch. A compensation leg has no `from` or `to` and sits outside the graph. The course
    validator refuses it as any leg's `from`, `to` or `next`.
  - **Lifetime.** A spawning leg's `spawns` (R-BTN-111) may give its children `"lifetime":
    "parent"`, ending them when their parent closes or is cancelled, or `"lifetime": "station"`,
    ending them when the parent leaves the station they were filed at. Without `lifetime`,
    children live on (R-BTN-86).
  - **Cancelled.** A ticket is cancelled when its file says withdrawn (R-BTN-74), or when Baton
    **supersedes** it because:
    - a call settled without it (R-BTN-165);
    - a choice station settled against the work it belonged to (R-BTN-166);
    - the condition it handles closed by other means: an owner resolved it, the cause ended, or
      the raising ticket was cancelled;
    - its `lifetime` ended;
    - its source stopped posting a ticket that has no file (the `changes` source, R-BTN-114).
  - **Superseding.** In the transaction that decides it, Baton:
    - sends any running claim on the ticket a `release` with reason **`superseded`**. The runner
      stops as R-BTN-119 does, without a hand-off. The claim ends `released:superseded`, which is not a failed attempt.
    - marks a completed claim on the ticket still unconfirmed `superseded_at`: it is never
      confirmed, concludes nothing (no `baton.check-unattested`), counts no attempt, and no
      longer holds rule 3 or raises `baton.unconfirmed`;
    - logs `superseded {by}`;
    - for a ticket with a file: if any leg on the ticket's path declared a compensation, Baton
      queues the built-in leg **`baton.cancel`** (`next_source: cancel`), held as a route
      override, and queues the `withdraw` outbox entry when it ends; otherwise it queues the
      `withdraw` entry at once, and the ticket waits on it (`next_source: outbox`, R-BTN-171). The
      ticket shows `cancelling` until it closes.
    - for a ticket with no file, queues `baton.cancel` if its path has compensations, else
      closes it `withdrawn` at once.
  - **Withdrawn in git.** A ticket withdrawn in git whose path has compensations stays open,
    shown `cancelling`, while `baton.cancel` runs.
  - **`baton.cancel`** is the runner's own code and requires the capability
    `runner:baton-legs` (R-BTN-133). Under one claim it:
    1. runs, in reverse path order, the compensation leg of each completed leg that named one.
       Each is a leg run needing that leg's capabilities, so a runner without them releases
       `blocked` on the capability (R-BTN-126). Each finished compensation is recorded in
       `claim_legs` as the runner reports it, and a later `baton.cancel` skips those already
       recorded, so a partial cancel resumes rather than repeats;
    2. pushes, and ends; for a ticket with a file Baton then queues its `withdraw` entry
       (R-BTN-171), and for one without, closes it `withdrawn`.
  - **Cascade.** Cancelling a ticket supersedes its open children whose `lifetime` is `parent`.

### 7.8 The outbox

- **R-BTN-171 (every effect Baton intends outside itself goes through one outbox, which couriers deliver).** *Under `landing: protected`, the git kinds are delivered only as R-BTN-180 says (proposal).* Baton
  holds no credential to write git or to post to a forge. The deployment's dispatch credentials
  (R-BTN-94) only start workflows; a forge that cannot scope one below write (a Gitea bot token) is
  a stated exposure of the deployment, held as a Worker secret and never in the database. Each
  effect Baton intends is an **outbox entry**. A **courier**, a key whose host holds the credential
  the effect needs, claims the entry, delivers it and reports it; Baton then confirms it by reading
  the effect back.
  - **Entries.** Each entry is an `outbox` row: `id` (an integer per repository, increasing),
    repository, ticket, `kind`, `fields`, `state` (`queued`; `claimed` while a courier's lease
    holds it; `delivered`, `skipped`, `confirmed` or `dropped`), `queued_at`, `delivered_ref` (the
    commit or the check run) and `confirmed_at`. `fields` holds identifiers only (§12.3), and for
    `forge-check` its `summary` rendered `plain` (R-BTN-112).
  - **Signed.** Baton signs each entry as it queues it: Ed25519 by the tenant's signing key
    (`BATON_SIGNING_KEY`, R-BTN-55's `SigningKey`) over the canonical JSON of `{repository, id,
    kind, ticket, fields}`, with `kid` naming the key. The public `GET /v1/keys/signing` lists the
    current key and every retired one. A courier refuses an entry whose signature does not verify.

    | `kind` | Delivers | Order | Confirmed when | Late |
    |---|---|---|---|---|
    | `handler` | the handler ticket of a bound condition Baton raised: a `baton.*` condition or `hitl.decision` (R-BTN-163); or a promoted light question (R-BTN-173). Written through the source's `file(ticket)` export, as R-BTN-161's frontmatter, with a body the courier generates from `fields` (a promoted light question's body is its `question` text, and its frontmatter carries `baton_position`, R-BTN-173) | a log, per ticket | a snapshot at or after `delivered_ref` shows the file | not confirmed 24 hours after it was queued |
    | `withdraw` | the withdrawal of a superseded ticket (R-BTN-168), through the source's `withdraw(ticket, reason)` export (the markdown source sets `status: withdrawn` and `withdrawn_reason`) | a log, per ticket | a snapshot shows the ticket withdrawn or closed | as `handler` |
    | `answer` | a reply a delivery leg reported after its light question was promoted (R-BTN-173), through the source's `answer` field (R-BTN-169) with `answered_by`; never over an answer already in the file | a log, per ticket | a snapshot shows the answer | as `handler` |
    | `forge-check` | a check run on a change's head (R-BTN-114, R-BTN-115) | the latest, per `(repository, sha, name)` | the sync reads the run back (R-BTN-115) | not delivered 15 minutes after it was queued |

    `handler`, `withdraw` and `answer` are the **git kinds**. A foreign file already at a
    `handler`'s path is not overwritten: the courier marks the entry `failed` with `collision`.
  - **Couriers.** A courier is any key that delivers entries. The two delivery classes are `git`
    (the three git kinds) and `forge-check`.
    - **A dedicated courier** is registered by the repository's owners with `baton owner courier
      add <key> --delivers git|forge-check` (`POST /v1/owner/{repository}/couriers {public_key,
      delivers}`; credential kind `courier`) and revoked with the destructive
      `owner.courier.revoke`. Its key is an SSH key with that one role (§12.1).
    - The credential the effect needs lives only on the deliverer's host, never in Baton: push
      access to the repository for `git`, the check App's private key for `forge-check`
      (R-BTN-115).
  - **The outbox policy.** Who may deliver, and what Baton checks of them, is the repository's
    `outbox_policy`: an owner setting (R-BTN-66) Baton stores, with one entry per delivery class.
    Baton applies it at each claim, so a change binds the next claim and never a lease already
    held.
    - `deliverers` lists the keys that may claim: `courier` (a dedicated courier registered for
      the class), `runner` (a runner key with an accepted grant on the repository), and
      `trusted-runner` (a grant with the trusted-runner role, R-BTN-182). Default `[courier]` for
      both classes.
    - `trust` is `any` or `trusted`. Under `trusted`, the deliverer's key is registered at trust
      level `trusted` in a trust domain no other grant on the repository shares (R-BTN-180).
      Default `any`.
    - `min_release` is the lowest CLI release a deliverer may declare when it claims, which is
      what holds it to the CLI's fixed templates with no repository code and no runner text
      (R-BTN-182). Default none.
    - Baton refuses a claim from a key the policy does not admit, `forbidden` with the unmet
      field.
    - Loosening the policy (a deliverer added, `trust` lowered to `any`, `min_release` lowered or
      removed) is a change that loosens an R-BTN-66 setting (R-BTN-186). Tightening is open to any
      owner credential. Each change is logged `admin` with the policy before and after.
    - A policy that admits `runner` for `forge-check` lets any granted runner withhold a check. It
      still cannot post one Baton did not sign unseen (R-BTN-115).
  - **Claiming and marking.**
    - `POST /v1/courier/entries/claim {limit?, release}` claims up to 50 queued entries, each
      leased for 10 minutes, of the classes the caller is admitted to deliver by the outbox policy
      of each repository it serves.
    - A ticket's git entries are claimed together, in `id` order, and none while an earlier entry
      of that ticket is `claimed` or `delivered`. Entries of different tickets are unordered.
    - Each dedicated courier registered for `forge-check` gets its own copy of a `forge-check`
      entry, claimed and marked on its own. A policy admitting runners or trusted runners adds one
      shared copy, which any of them may claim.
    - `POST /v1/courier/entries/{repository}/{id}` marks one: `delivered` with its `ref`, `skipped`
      (R-BTN-173), or `failed` with `transient`, `refused` or `collision`.
    - A lapsed lease re-queues the entry. A mark arriving after its lease lapsed is accepted. A mark
      from any credential but the claimer is `forbidden`. An entry the claimer leaves unmarked goes
      back to `queued` when its lease lapses.
    - `transient` re-queues the entry after 1, 5 and 30 minutes, then hourly.
    - `refused` (the forge refused the courier's credential, a misconfiguration) holds the entry's
      ticket (`hold_reason: outbox-refused`) and raises `baton.outbox-late` naming the courier, until
      an owner fixes the courier and lifts the hold, which queues the entry again. `collision` holds
      the ticket `outbox-collision` the same way.
  - **Idempotence.** Every delivery carries its entry's id, so delivery is at least once and its
    effect at most once.
    - Git kinds: the handler ticket's frontmatter has `baton_write: <id>`, and a withdrawal writes
      `baton_write: <id>` beside `status: withdrawn`. Before writing, the courier reads the file at
      the freshly fetched default-branch head. A file that already carries the id, or for
      `withdraw` already says withdrawn or is absent, is not written again, and the courier reports
      the head's commit. On a rejected push it fetches, checks and writes again, at most 3 times,
      then marks the entry `failed` with `transient`.
    - `forge-check`: the check run's `external_id` carries the id, and R-BTN-115's `seq` keeps an
      older entry from overwriting a newer one.
  - **What Baton holds until a git entry is confirmed.**
    - **Handler entry.** Baton holds a provisional ticket row for the handler ticket at its
      course's start station, waiting on `outbox` (`next_source: outbox`, shown under `other`) as
      a held position (R-BTN-83), until a snapshot posts the ticket; from then on the posted pair
      rules. A promoted light question keeps its Baton-held row and station instead (R-BTN-173).
    - **Withdraw entry.** The superseded ticket waits on `outbox` likewise, until a snapshot posts
      it withdrawn, which closes it `withdrawn`.
    - The condition counts as handled from the moment its entry is queued.
    - **Delivered, not confirmed.** A `delivered` entry is never claimed again. An entry still not
      `confirmed` after 3 accepted snapshots at or after its commit holds the ticket (`hold_reason:
      outbox-unlanded`) and raises `baton.outbox-late`; lifting the hold queues the entry again.
  - **Dropping.**
    - A `withdraw` entry for a ticket with compensations is queued only when that ticket's
      `baton.cancel` ends, after the compensations (R-BTN-168).
    - A `handler` entry still `queued` when its condition closes, and never claimed, is `dropped`:
      nothing is written, its provisional ticket row is deleted, and no withdrawal follows. Any
      other is `dropped` and followed by a `withdraw` entry: one already delivered; one `claimed`,
      whose row is kept until the courier marks it or its lease lapses; and one queued again after
      a lease that lapsed unmarked, since that courier may have pushed it. Dropping a ticket's
      `handler` entry drops its later `answer` entries, and Baton records their replies `ignored`.
  - **Records.**
    - Queuing, delivering and confirming each log an `outbox {id, kind, state}` event in the
      ticket's history.
    - An entry late by its kind's column above raises `baton.outbox-late` (R-BTN-163) with its
      `kind`; for `forge-check` the change stays pending.
  - **Not in the outbox.** Positions that start in Baton are held as overrides and written by the
    run of the leg they queue: a choice settlement (R-BTN-166), a timer's `leg` (R-BTN-167) and
    an `exhausted` leg (R-BTN-122). Calls settle in git through `settleCall` (R-BTN-165). Messages
    to runners ride the heartbeat (§6.9).

### 7.9 Standard handler courses

- **R-BTN-169 (standard handler courses: `ask`, `deliver` and `announce`).** These are three
  course directories in the baton repository under `src/defaults/courses/` (R-BTN-134). A
  repository binds them, overrides their legs (R-BTN-131) or writes its own.
  - **`ask`**, for `hitl`, takes a `std:condition@1` as input. Its ends are `answered` and
    `unanswered`, each producing a `std:restart@1`.

    ```json
    { "start": "asked", "start_leg": "open", "end": ["answered", "unanswered"],
      "stations": { "asked": {}, "waiting": { "choice": "first" },
                    "answered": {}, "unanswered": {} },
      "legs": {
        "open":   { "from": ["asked"],   "to": "waiting",
                    "spawns": { "course": "deliver", "lifetime": "parent" } },
        "answer": { "from": ["waiting"], "to": "answered",   "kind": "person", "asks": "owner" },
        "expire": { "from": ["waiting"], "to": "unanswered", "after_s": 172800 } } }
    ```

    - `open` files a `deliver` child for the question.
    - A person answers in the ask's own file by naming a restart (`answer: b`, the default
      source's `answer` field, R-BTN-131). The sync posts the answer as the `answer` leg's
      `std:restart@1` with `reason: "chosen"`.
    - `expire` writes `{restart: null, reason: "unanswered"}`.
    - When the ask closes, its `deliver` child is superseded and compensates.
    - The raise's `wait_s` is in the input, so `deliver` can use the fastest channel when a leg
      is waiting in its claim.
  - **`deliver`**:
    - It has stations `queued` and `pushed`, and ends `lapsed` and `emailed`.
    - `push` (`queued` → `pushed`) needs the capability `channel:push`. Its policy is
      `"retry": {"initial_s": 60, "coefficient": 4, "max_attempts": 3, "exhausted": "email"}`,
      and it is compensated by `retract`, which is idempotent.
    - `lapse` (`pushed` → `lapsed`) is queued by `push`'s `close` with `not_before` an hour after
      the push. It retracts the message.
    - `email` (`queued` → `emailed`) needs the capabilities `channel:email` and
      `credential:SMTP_URL`.
    - An email that cannot be sent holds the ticket under the retry policy, and the question
      stays on the floor.
    - The shipped scripts send a generic signed webhook and SMTP mail. A repository overrides
      `push` and `retract` for its own channel.
  - **`announce`**, for `warning`, `error` and `baton`, has one leg, `send`, which needs the
    capability `channel:push`. Its ends are `sent` and `undeliverable`.
  - **Binding them.** `baton repo init --bind-conditions` writes `{"hitl": "ask", "warning":
    "announce", "baton": "announce"}` into `.baton/baton.json`. Without that option a repository
    binds nothing, and every condition reaches the debugger.

## 8. Runners *(partly built — B-8, B-9, B-12, B-42, B-46, B-47, R3-1213, R3-1260)*

A **runner** is any process that can execute a leg; it registers by heartbeat and holds claims
(§9). There are two kinds, on the same API: an **interactive runner**, an agent harness session,
through its sidecar; and a **CLI runner**, `baton runner start`, which runs a ticket's legs as
scripts. Where a rule has a runner call a leg script's `run`, `close` or `handoff`, check a move or
open the local channel, it is the CLI runner. Leg scripts, `rank.mjs` and the dependencies they install run with the
runner's full rights; every isolation below binds a cooperating leg, and only `session` mode
(R-BTN-107) keeps Baton credentials out of a leg's reach.

### 8.1 Runners, heartbeats and the doorbell

- **R-BTN-3 (a runner exists from its first heartbeat).** A runner is created by its first
  authenticated heartbeat and never deleted. It is one interactive session (opencode or Claude Code),
  or one CLI runner, on a host of kind `vm` (Firecracker), `local` (an owner's machine) or `cloud`
  (a Claude Code cloud container). Several sessions on one host are several runners; the
  dashboard groups them by hostname. A CLI runner's leg sessions are its children, not runners.
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
    repository; absent ⇒ that repository's top tier), `lease_timeout_s`, `isolation`
    (R-BTN-107), `uses` (R-BTN-76), `session_url` (R-BTN-113), spooled activities and transcript paths (§9.9), `leg_finished` (R-BTN-90),
    `fenced` (R-BTN-19), `test_harness` (R-BTN-32); on first contact or re-key, `secret_hash`
    and `rekey`.
  - The response carries the runner's active claim — id, ticket, station, leg, nonce,
    `deadline_at`, `cancel_at` and the latest snapshot's `git` view (`station`, `path`,
    `regressed`, `next` legs with state, `waiting_on` and `not_before`; or `closed: done |
    withdrawn`; or `unknown`) — or none; pending messages (§6), marked `delivered` in the same
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
    are `release`, `status_request`, `wind-down` (B-109), `unblocked` and `handled` (R-BTN-162). The runner heartbeats at
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
    runner secret — unless the owners set `machine_sync: false` (default `true`; off under `landing: protected`, R-BTN-180) or the key's
    span forbids it (R-BTN-146). The mirror stays with sync keys and CI tokens;
  - **report readings** (R-BTN-101).

  Every snapshot records its credential (`board_snapshots.posted_by`). A machine-key post that
  closes a ticket another runner holds, drops a posted bar, or loosens an author's gate (lowers
  a tier, drops a `requires` clause, removes a `ticket` block or a decision)
  raises `baton.machine-post` naming the tickets and the key; it is noticed, not stopped. A
  machine key is never an owner, administrator, courier or check-runner key, and none of
  those is a machine key. API-key runners (R-BTN-159) work and report readings but never sync.
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
    (`owner.grants.flags`); returning to span 1 restores R-BTN-102's defaults.
  - `GET /v1/owner/{repository}/grants` lists each key's hostname, span and other repositories
    (pending marked); `baton owner key grant` prints the span and needs `--confirm-span` when the
    key holds a grant elsewhere.
- **R-BTN-117 (registration tokens).** A repository owner mints a token for a session that has
  no key yet: `baton owner token create --repo <id> --role runner [--capabilities …]
  [--max-tier <t>] [--ttl <d>] [--uses <n>]`.
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
  claim's `snapshot_sha`, one leg at a time (B-103; the bullet after this one). It owns the leg
  processes themselves —
  launching them, terminating them when necessary, and realizing they are stuck (§1's division
  of labor; B-108) — and nothing else does. Idle, it asks for recommendations when
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
    the latest snapshot's position; `checkout` (working directory); `snapshot: {sha, tree}` and
    `course: {dir}` (R-BTN-133); the `session` token the previous leg returned; `refresh` and
    `yield` (R-BTN-123); `raise` (R-BTN-160) and `resume` (the chosen restart, R-BTN-162); and an
    `AbortSignal` whose reason is `lease-lost` (stop at once), `release` or `regressed` (stop at
    the next safe point), or `context` (stop at the yield just answered).
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
    `done`; `closed: 'withdrawn'` is a `stale-board` release Baton already made.
  - **Reactions**: a gate's refusal or a `max-runs` refusal suspends at the station reached; an
    `off-graph` refusal or heartbeat `station: unknown` (R-BTN-64) finishes or abandons the leg
    and ends `released:course-changed`; `git.regressed: true` (R-BTN-71) aborts at the next safe
    point and ends `suspended:<station>` at the leg's `from`; a prerequisite lost mid-leg ends
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
    The identity banner `baton run` logs at startup names the declaration this way: the granted
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
    `released:requested` — and exit with the signal's code once the loop ends; a leg child that
    will not take the release has its whole group killed after ten seconds (the lease-loss
    mechanism), so no orphaned leg keeps pushing against a claim the reaper took.
  - **The built-in leg** `baton.cancel` (R-BTN-168) is the runner's own code with no script; it
    requires the capability `runner:baton-legs` (R-BTN-133). The outbox is no leg: couriers
    deliver it (R-BTN-171).
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
  - **Local channel.** The runner listens on a Unix socket in its state directory, mode 0600,
    named to the leg's session by `BATON_SOCKET`; JSON lines, wrapped by the CLI. Verbs act on
    that leg only and exit 2 "not inside a leg" elsewhere:
    `baton leg status` (leg, grant, deadline, `refresh`);
    `baton leg output <name> --uri <uri> [--digest …] | --value <json>`;
    exactly one ending — `baton leg done --reached <station> --next <leg>`,
    `baton leg suspend --reached <station>`, `baton leg release --reason <reason>`, or
    `baton leg release --blocked --kind <kind> --ref <ref> […]` (R-BTN-126);
    `baton leg yield [--context <fraction>]` (R-BTN-123);
    `baton leg raise`, `baton leg await` (R-BTN-160, R-BTN-162);
    `baton leg next` (`attached` mode, R-BTN-107).
    A script may return its result directly instead.
  - **The session never talks to Baton**; the runner makes every Baton call.
  - **The runner checks each move** as it checks a script's result: `reached` an outcome of the
    leg, `next` a leg leaving it, each output valid against its schema, every entry requirement
    of `reached` met (R-BTN-109). A failing move is answered on the channel with the reason and
    may be corrected until the leg's deadline; nothing reaches Baton until it passes. Then
    `close`, `handoff` where it suspends or releases, and `advance` or `end`.
  - **A bounded run.** `baton runner start --legs <leg,…> [--max-legs <n>] [--until <instant>]`
    claims only tickets whose queued leg is named, chains only into named legs, runs at most
    `n` legs per claim (default 8) and starts none after `until`. A move outside the grant
    suspends at `reached`. This is the runner's discipline, not a Baton gate.
  - **`no_chain_from: [<leg>…]`** on a leg (course file): Baton refuses a claim or `advance` into
    it by a **credential** that has run any named leg on this ticket in any claim (`claim_legs`
    → claim → runner → credential), `not-eligible`, rule `chain`; containers sharing one key
    count as one. The runner suspends instead. Owners' `required_independence: {<leg>: [<leg>…]}`
    (R-BTN-66) joins the course file's lists as required bars join posted ones (R-BTN-67).
- **R-BTN-107 (isolation: process, attached, session).** The runner declares `isolation` on its
  heartbeat.
  - **`process`** (default): legs are the runner's child processes, as its OS user.
  - **`attached`**: `baton runner start --attached` runs in the background inside an agent
    session's own container; it hosts the sidecar and the claim and hands each agent leg back to
    that session, which reads it with `baton leg next` (blocks until a leg is ready) and reports
    on the channel. The dashboard shows the runner as `attached`.
  - **`session`**: the runner starts one cloud session per agent leg through a session provider
    (`--sessions <provider>`; for Claude, the remote-session API: create, send, read events,
    interrupt, archive, and `exec(argv, {cwd, timeout_s}) → {status}`, R-BTN-153). The child gets
    only the brief — ticket, leg, input URIs, hand-off document — never the claim id, runner
    secret or a Baton credential, and reports by ending its session with one fenced
    ```` ```baton-leg-result ```` block holding the channel's JSON, which the runner checks as
    R-BTN-106 does. The provider adapter is runner code; core knows only the mode's name.
  - In `process` and `attached` mode a leg can read the runner's state file and use its
    ssh-agent; only `session` mode keeps credentials out of its reach. A leg that must run in
    `session` mode requires the built-in capability `runner:session` (R-BTN-133), which only a
    runner started in `session` mode declares: rule 4 refuses a claim or `advance` into it by
    any other runner and omits it from that runner's recommendations, and with no such runner
    live the leg carries a `capability` block (R-BTN-75). The declaration is the runner's own
    word, like its tags.
- **R-BTN-123 (a leg hands off to a fresh session when its context fills).** A fresh session may
  one day ask the session it replaced about its work; that may prove useful and is not built. A
  leg may declare
  `"max_context": <fraction>` (0.1–0.95) and `"max_refreshes"` (default 3; capped by the owners'
  `retry` ceiling, R-BTN-122).
  - Context use is reported by the session provider's `contextUse(sessionId) → fraction | null`
    in `session` mode, and in `process` mode by `baton leg yield --context <fraction>` or
    `ctx.yield(fraction)`. Nothing reported means never refreshed (logged once per session).
    `attached` legs are never refreshed (logged once per leg).
  - A yield marks a point between steps and is answered `refresh: true | false`. Once the latest
    use passes the fraction, the next yield answers `true` and the runner: (1) stops the session
    — ends the child session, or fires `ctx.signal` with reason `context`, waits for `run` to
    return (result discarded) and stops the process group as R-BTN-119 does after 30 s; (2) calls
    `handoff(ctx)` with `ctx.reason: 'context'`; (3) starts a fresh session on the same leg under
    the same claim, briefed with the hand-off and the inputs — in `process` mode by calling
    `run(ctx)` again with `ctx.refresh: {n, handoff}`; (4) records activity `context-handoff`
    with both sessions' links (R-BTN-113's rule; a failing link is dropped).
  - A refresh is not a run for `max_runs`, not a failed attempt, and never lets the lease lapse.
    Past `max_refreshes` the runner suspends at the leg's `from`.
- **R-BTN-113 (a leg run carries its session's link).** A heartbeat may carry `session_url` for
  the running leg, and `advance` or `end` for the leg it finishes. It must be `https`, at most
  512 characters, without userinfo, with its host in the instance's `session_hosts` (an
  administrator's setting, default `claude.ai`), else it is dropped and logged. Stored on
  `claim_legs.session_url` (latest wins while running) and shown on Running and the Timeline;
  in `session` mode it is the child session's link.

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
  - **No roll-back.** The claim response also names `base_sha`, the head the post that set
    `snapshot_sha` was accepted against (`board_snapshots.parent_sha`; null for a repository's
    first snapshot and for a held post accepted per R-BTN-11). The runner checks that `base_sha`
    is an ancestor of `snapshot_sha` as well, so a post naming an older default-branch commit
    cannot roll runners back to its scripts; a failure is handled as an off-branch sha.
  - While a rewrite is held (R-BTN-11) the claim response carries `rewrite_held: true` and the
    held head; only then does the runner accept that exact sha from its cache of shas it
    verified before. The cache is flushed when the rewrite is accepted.
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
    --no-fund` and needs `package-lock.json` or `npm-shrinkwrap.json`; no `workspaces`; the
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
  - **The wrapper** `legProcess.mjs` runs every call (`run`, `close`, `handoff`, and R-BTN-134's
    `tickets`, `stations`, `rank`) as `node legProcess.mjs <call> <script> <ctx.json> <out.json>`,
    detached in its own process group, cwd `ctx.checkout`, `NODE_OPTIONS`/`NODE_PATH` removed; no
    repository code loads in the runner. `out.json` = `{ok, result | ref | url, error?,
    aborted?}`. `close` and `handoff` are bounded at 2 minutes each, then killed as a failure. A
    resolve hook (`module.registerHooks`) maps `@immediately-run/baton/leg` to the running CLI's
    module and refuses, naming the specifier, any resolution outside the claim's trees, their
    linked digests and R-BTN-134's `imports`. `LegError` is recognized by the brand
    `Symbol.for('baton.LegError')`, never `instanceof`.
  - **`@immediately-run/baton/leg`** exports `LegError`, `writeMarker`, `commentOnPr`,
    `yieldContext`, `nextFire`, `writeSuccessor`, `NOT_BEFORE_HORIZON_DAYS`, `CLI_VERSION`. It
    carries no course meaning.
  - **The `runner` capability type** (built in, beside `human-operator`, R-BTN-121):
    `runner:<feature>`, declared only by a runner from its own code (a runner config naming one
    refuses to start), counted as granted to every runner key. Values are the CLI's:
    `leg-trees` (declared also by sidecars of interactive sessions), `baton-legs` (required
    by the built-in leg `baton.cancel`, and declared by every runner whose CLI implements it) and `session` (declared only by a runner in `session` mode,
    R-BTN-107); kit and sync refuse others, and a course may not declare a type named `runner` or `human-operator`.
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
    leg, `close`, `handoff` or `rank.mjs` inherits them; `rank.mjs` too runs in a child with the
    leg environment.
  - **What a leg's environment holds.** The `BATON_*` names below are the only names: the
    transition's `IR_BATON_*` aliases were removed by the release that closed B-97 (2026-10-22),
    so the runner reads no such spelling and sets the leg markers under these names alone.

    | Variable | Value |
    |---|---|
    | `BATON_PARENT` | the CLI runner's runner id |
    | `BATON_STATE` | path of the read-only state view (no runner secret) |
    | `BATON_SOCKET` | the local channel (R-BTN-106) |
    | `BATON_LEG` | `<claim id>.<leg>.<run>` (R-BTN-145) |
    | `BATON_ACTIVITY` | set by a launcher for a child session it starts under an activity (§9.9) |
    | `BATON_RESUME` | path of a JSON file holding earlier claimants' text — resume records, end details, hand-off documents, claim `rationale` — which reaches a leg only as data, never inside its instructions |
    | `<NAME>` for `credential:<NAME>` | present only when the leg's `requires`, after role expansion (R-BTN-121), names it; every other declared `credential:` variable is removed |
    | `BATON_ADVICE` | path of a JSON file holding the starting `advance`'s `advice` (R-BTN-177), which reaches the leg only as data; new, with no alias |
    | `BATON_TAKEN` | path of a file the leg may write `[{choice, alternative}]` to; the runner reports it as `taken` (R-BTN-177); new, with no alias |
    | git, forge and model-provider credentials, `SSH_AUTH_SOCK` | kept |

    A course may not declare a `credential:` name that is `PATH`, `HOME`, `SSH_AUTH_SOCK`,
    begins `BATON_`, or is a variable the runner keeps; the course file is held (R-BTN-69).
  - **Masking.** Before any byte of a leg's output leaves the runner — to a leg log (R-BTN-128) or
    anywhere else — the runner replaces each exact occurrence of these with `***`:
    1. the runner secret (the claim nonce is public — markers and the mirror's claim note carry
       it — and authenticates nothing);
    2. the runner's Baton credentials (`BATON_KEY`, the contents of the file
       `BATON_KEY_FILE` names, `BATON_TOKEN`, an API key);
    3. the value of every declared `credential:<NAME>` variable, given to the leg or not;
    4. the git and forge tokens the runner holds, and `AWS_SECRET_ACCESS_KEY` and
       `AWS_SESSION_TOKEN` when set;
    5. by pattern, `brt_`, `bak_` or `bmcp_` followed by `[A-Za-z0-9_-]*`;
    6. by pattern, every `-----BEGIN … PRIVATE KEY-----` … `-----END … -----` block, replaced
       whole: after a `BEGIN` line output is held until the `END` line or 16 KB, then the whole
       held run is masked.

    Masking runs on the byte stream before framing, holding back the longest literal's length
    minus one byte. A literal value under 8 bytes is not masked (logged once). An archiver
    running under a runner (`BATON_PARENT` set) masks classes 5 and 6 in transcripts before
    pushing (R-BTN-20).
  - **Replay** (R-BTN-84) builds its environment from an allowlist: `PATH`, `LANG`, `TZ`,
    `TERM`, an isolated `HOME`, the read-only clone credential `runner.json`
    `replay_clone_credential` if configured, and names in `runner.json` `replay_env` or `--env`.
  - This keeps a cooperating agent from printing a credential it never needed; a hostile leg
    can read the runner's key file as the same user (R-BTN-14).
- **R-BTN-145 (every process a leg starts is stopped with it).** Each leg runs with
  `BATON_LEG=<claim id>.<leg>.<run>`. When a leg stops — Stop, a release, a lost lease, the
  runner's exit, a supersession — the runner signals its process group and every visible process
  whose environment carries exactly that value (`/proc/<pid>/environ`), comparing start times so
  a reused pid is never signalled. Where `systemd-run --user --scope` exists each leg runs in its
  own scope, and the runner stops the scope. Every process is gone within 30 s. A process that
  clears its environment and leaves its group and scope survives (a hostile leg, R-BTN-46).
- **R-BTN-119 (stopping a running leg).** Baton kills nothing; it asks the runner.
  - A `release` with reason `requested` (an owner's release message, the dashboard's **Stop
    leg**, `baton leg stop`, MCP `leg.stop`, R-BTN-154), `owner-cancel` (Cancel: hold plus
    release, §6) or `superseded` (R-BTN-168) reaches the runner at the doorbell's ring, else at
    its next heartbeat. For these three the runner stops the leg at once: `SIGINT` to the process
    group and R-BTN-145's tagged processes, `SIGTERM` after 10 s, `SIGKILL` after 25 s; in
    `session` mode it interrupts the child session through the provider.
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
  - **The run's directory.** While a root is set, the claim reply and each `advance` reply that
    starts a run carry `leg_log: {dir}`, where `dir` is
    `<root>/<repository id>/<local ticket id>/<leg>/<run>-<claim id>/`. Baton records it as
    `claim_legs.leg_log_dir` and keeps nothing else about the log: no file names, sizes or
    digests. The runner writes a run only when the reply that started it named a directory.
  - **What.** `process`-mode runs only (an `attached` or `session` run's transcript is its log;
    a `"stream": false` leg writes none). The runner reads stdout and stderr and writes JSON-lines
    frames `{seq, at, stream: "stdout" | "stderr", text}`, `seq` counting from 0 across the run;
    `text` is the masked bytes (R-BTN-144) as UTF-8 (invalid bytes → U+FFFD), ≤ 8 KB per frame,
    cut between code points.
  - **Chunks.** Frames go to `<dir>/<n>.jsonl`, `n` six digits from `000000`. A chunk is written
    1 s after its first frame or at 256 KB, whichever comes first; an idle leg writes nothing.
    Every write is create-only — `If-None-Match: *` on `s3:`, `ifGenerationMatch=0` on `gs:`,
    `O_CREAT | O_EXCL` on `file:` — so no chunk is ever rewritten. When the run ends (completed,
    stopped or released), the runner writes `<dir>/end.json` last: `{claim, leg, run, chunks,
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
  - **Trust.** Under R-BTN-106's advisory isolation a leg runs as the runner's user and can reach
    the same credentials, so it can write into its own directory: a leg log is a diagnostic, not
    evidence.
  - **`baton leg log <ticket> [<leg>] [--run n] [-f] [--transcripts] [--json]`** reads
    `GET /v1/repositories/{r}/tickets/{t}/legs/{leg}/runs` (per run: claim, runner, mode, start,
    end, session link, `log_dir`, transcript pointers), then reads `log_dir` itself with the
    user's own credentials, found as the runner finds its own. It prints chunks in order from
    `000000` and stops at the first missing one. With `-f` on a run without `end.json` it then
    polls for the next chunk, every 1 s backing off to 10 s while none appears, and stops at
    `end.json`, or when the run record has ended and no chunk has appeared for 30 s. A missing
    `seq` prints `[gap]`. An `attached` or `session` run prints its session link and transcript
    pointers, and `--transcripts` also prints the run's agent transcripts from their pointers.
    With nothing to print it prints the run record and why (no `leg_log_root`, `stream: false`,
    nothing written yet); a read failure prints the record and "cannot read `<dir>`: `<reason>`"
    and exits 1. Every path strips terminal escapes and C0/C1 controls except newline and tab.
    The dashboard shows `log_dir` as text, never as a link, and reads no log.

## 9. Claims *(partly built — B-11, B-21, B-38, B-39, B-46, R3-1213)*

A claim is a fenced lease on one ticket. It is the one thing Baton owns outright (R-BTN-39):
everything else about a ticket is replayed from git. A claim is `active` until it ends
`completed`, `released` or `reaped`.

### 9.1 The lock and claiming

- **R-BTN-4 (the lock).** At most one `active` claim per ticket and per runner, enforced by two
  partial unique indexes. A claim holds one ticket through a run of its legs; a runner that
  needs another ticket ends its claim first.
- **Claiming** (unnumbered). `POST /v1/runner/claim` with a client-generated `request_id` and
  an optional `ticket_id`, plus optional `prefer`, `bills` and `rationale` (R-BTN-100) and, for
  a ticket Baton has not seen, the open-world fields (R-BTN-104).
  - Without `ticket_id`, Baton returns the first eligible ticket in its default order (the first
    recommendation, R-BTN-45, R-BTN-61); with one, that ticket if every gate passes, else
    `not-eligible` naming the failed gate. Advice never refuses: a claim against it is accepted
    and logged `advice-overridden`.
  - Every gate is re-checked in the one transaction that commits the claim. A repeated
    `request_id` from the same runner returns the original result, so a lost response never
    yields a second ticket; idempotency is keyed by `(runner_id, request_id)`, so another
    runner's `request_id` never matches.
  - The response carries `claim_id`, `ticket_id`, `station`, `legs` (the queued leg, R-BTN-83),
    `next`, `handoff_url?`, `path`, `snapshot_sha`, `base_sha`, `default_branch`, `rewrite_held`
    (R-BTN-143), `nonce` (6 hex, public: written in markers and the mirror's claim note, R-BTN-17),
    `previous_attempts` (R-BTN-24), `tainted_branches` (R-BTN-148), `leg_log?` (R-BTN-128),
    `check_sha?`/`check_head_ref?` (R-BTN-153), and `resume?` (the conditions' restarts, a list,
    R-BTN-162).
  - The runner then reads the ticket from git and re-verifies it (R-BTN-34, R-BTN-5).
- **One claim runs a run of legs** (unnumbered). A claim runs as many legs as it can; finishing a
  ticket in one session is the norm and the cheapest path. Each leg starts with
  `POST /v1/runner/claims/{id}/advance` naming it (R-BTN-63): Baton checks the edge and the gates
  in one transaction and moves the claim on (event `advanced`, a new `claim_legs` row with its
  run number, `started_at` and `head_sha`) or refuses. The reply carries the leg's resolved
  inputs (R-BTN-82) and Baton's advice flags; the course's own advice is `rank.mjs`'s (R-BTN-98).
- **R-BTN-38 (legs are stateless at their boundaries).** Each leg reads its input from, and
  leaves its output in, the ticket's repositories and their changes. Nothing a leg needs travels
  through a session's context, so any session can run any leg whose input is in place; a
  continuing session's context saves cost and is never a dependency. What git does not carry
  goes in the hand-off document (R-BTN-44).

### 9.2 Holding: the lease and the fence

- **R-BTN-6 (fencing).** The sidecar records `last_ok`, the time of its last accepted
  heartbeat. When `now − last_ok ≥ lease_timeout − 4 min` it marks the lease **lost** in its
  state file. A lost lease, or a heartbeat response that no longer lists the claim, means the
  session no longer holds the ticket. On reconnecting, a sidecar whose lease was lost ends the
  claim `released:lease-lost` itself.
  - A heartbeat refused `session-taken`, `runner-reaped` or `forbidden` marks the lease lost at
    once. `rate-limited` and `quota` do not: the sidecar backs off and retries, but an unaccepted
    heartbeat never renews `last_ok`.
- **R-BTN-26 (every fence check computes the lease itself).** The lease-lost flag is a
  shortcut. Each harness hook, each status-writing tool and the `pre-push` hook computes, from
  the state file and the **wall clock** (never a monotonic clock), `now − last_ok ≥
  lease_timeout − 4 min`, and treats the lease as lost when that holds or when the flag is set.
  When the state file is missing or unreadable while the session works a ticket (its git branch
  matches a course's current or previous `branch_pattern`, R-BTN-51), it asks Baton's holder
  query instead and refuses when Baton cannot be reached. The sidecar also checks on its own
  timer.
- **Three fence layers** (unnumbered), each applying R-BTN-26:
  1. On a lost lease the sidecar terminates every process group the harness started for a tool
     call still running; under a runner, the runner stops the leg (R-BTN-145), and in `session`
     mode interrupts the child session through the provider (R-BTN-119).
  2. A pre-tool hook denies `git push`, the forge's change-create and merge commands and
     status-changing writes, naming the ticket; the prompt-submit hook adds the notice to an idle
     session's next turn. The agent records what exists in notes (not fenced) and stops.
  3. A git `pre-push` hook in every workspace checkout refuses a push to a ticket's branch from a
     session whose lease on that ticket is lost. For every push to a ticket's branch, whatever the
     local lease says, it also asks `GET /v1/runner/branch-holder?repo=<owner/name>&branch=<name>`
     (the machine key, with `session_name` and the runner secret when the state file has them)
     and refuses when another live runner holds a ticket the branch maps to,
     a reaped claim on one is fence-pending, or Baton cannot be reached. Pushes to the default branch are not refused
     here (R-BTN-7 fences status writes).

  The holder queries (this one and R-BTN-7's) answer `held_by_other` relative to the runner the
  request names; asked
  by the key alone, Baton counts every active claim as another's, a claim of a runner of the
  same key included, since every container of a cloud environment shares one key (§8.1).
  Baton maps a branch to tickets through every course's current or previous `branch_pattern`,
  among tickets whose home repository or `code_repos` reach that repository (R-BTN-140), naming
  only tickets of repositories granted to the key and following former paths (R-BTN-141). A
  branch that maps to tickets of two repositories sharing a local id is refused if either is
  held; a course whose ids may collide puts `{repository}` in its pattern.
- **R-BTN-7 (status writes are fenced against holders).** A tool that writes a ticket's status
  to git first asks `GET /v1/runner/tickets/{ticket}/holder` and is refused (`not-holder`, exit
  10) only when another runner's active claim holds the ticket or a reaped claim on it is
  fence-pending. With no active claim the write proceeds.

### 9.3 Suspending and handing off

- **R-BTN-40 (suspend, don't wait on the lease).** The holder decides whether to go on. It
  **suspends** at the station it reached — writes the hand-off, makes sure its last leg left its
  evidence, ends `suspended:<station>` (R-BTN-71) — when a gate refuses, when advice says a line
  the next leg needs is short and it has no better evidence (a call that just succeeded on that
  line, remaining quota its harness shows), when every leg leaving its station is `waiting` on
  something not in the course file's `short_waits`, or when it must stop for its own reasons.
  It may keep the claim for up to **30 minutes** on a leg `waiting` on a `short_waits` entry
  (R-BTN-72). The ticket then waits unheld and is recommended again, to any eligible runner,
  once its lines are forecast to have room. A suspension is a completed end, never a failed
  attempt.
- **R-BTN-44 (the hand-off document).** Every suspension or release — except a lost lease and a
  supersession — leaves a hand-off document, written by the leg script's `handoff(ctx)` for a
  successor with none of this session's context: what is done and where; what the next leg
  must do; decisions made and alternatives rejected, with reasons; what the environment needed
  that git does not hold; open questions. The course prescribes its sections and where it lives;
  for a course with changes, a comment on the ticket's primary change carrying a `baton:handoff`
  marker (station it rests at, leg last run), or, before any change exists, the claim's note and
  the branch's top commit message. The station function never reads its prose. A resuming
  session reads the newest hand-off and the resume record (R-BTN-24) first.

### 9.4 Ending a claim

A claim ends with `POST /v1/runner/claims/{id}/end`: `end_reason`, `reached`, `next` (required
unless `reached` is an end station, R-BTN-83), and as applicable `not_before`, `spawned`
(R-BTN-86), `outputs`, `detail`, `ended_at_sha` (R-BTN-8), `error: {type, message?}`,
`prerequisite` with `reading` or `commit` (R-BTN-126), `answers` (R-BTN-173), `exit_status`
(R-BTN-153) and `session_url`. `detail` is a short course-defined label under the
untrusted-text rule (§12), stored and shown, never read. Baton stores `error.type`
(`claims.error_type`), never the message. Repeating the same end is answered `ok`; a different
end on an ended claim is refused `claim-ended`.

**End reasons.** This is the one list; other sections cite it.

| End | Status | When | Failed attempt |
|---|---|---|---|
| `done` | `completed` | the course's last leg is done: the ticket is at an end station | no |
| `suspended:<station>` | `completed` | the holder stops at the station reached (R-BTN-40, R-BTN-71) | no |
| `released:stale-board` | `released` | re-verification from git fails (R-BTN-5, R-BTN-34); the ticket was withdrawn or dropped from the board (R-BTN-147); an open-world settlement says so (R-BTN-148) | no |
| `released:cannot-finish:transient` | `released` | the environment failed; also an untyped exception, a retryable course `interrupt` type, a failing `close`, an invalid blocked end (R-BTN-126) | yes |
| `released:cannot-finish:contract-output` | `released` | a leg's output failed its schema or its station's entry (R-BTN-82, R-BTN-109) | yes |
| `released:cannot-finish:capability` | `released` | the ticket needs what no eligible runner holds; the ticket is held at once, `non-retryable:capability` | yes |
| `released:cannot-finish:spec` | `released` | the ticket or its course contradicts itself; also a non-retryable course `interrupt` type; held at once, `non-retryable:spec` | yes |
| `released:cannot-finish:contract-input` | `released` | an input failed its schema; held at once, raises `baton.contract` (R-BTN-82) | no |
| `released:lease-lost` | `released` | the holder's lease lapsed (R-BTN-6) | yes, once per distinct runner per ticket and leg |
| `released:blocked` | `released` | a prerequisite failed during the leg, or a raised condition or call outlived its wait (R-BTN-126, R-BTN-162, R-BTN-165) | no; counts toward `max_blocked` (R-BTN-122) except a `call` block |
| `released:leg-timeout` | `released` | an interrupting timer fired on the running leg (R-BTN-167, R-BTN-90) | yes, unless the timer names a `leg`, which is then queued |
| `released:requested` | `released` | an owner's release message, Stop leg (R-BTN-119) | no |
| `released:owner-cancel` | `released` | Cancel: hold plus release (§6) | no |
| `released:superseded` | `released` | Baton superseded the ticket (R-BTN-168) | no |
| `released:<bar reason>` | `released` | an owner bar that releases holders, with that bar's `reason` (R-BTN-67) | no |
| `released:course-changed` | `released` | the leg left the course under the claim (R-BTN-64) | no |
| `released:off-branch` | `released` | the claim's sha is not on the default branch (R-BTN-143) | no |
| `released:misdeclared` | `released` | an open-world claim declared gates its own commit contradicts (R-BTN-148) | yes |
| `released:unknown-ticket` | `released` | an open-world claim was not settled in time (R-BTN-104) | no |
| reaped, actor `alarm` | `reaped` | the runner was silent past its lease timeout (§9.5) | yes |
| reaped, actor `admin:<fingerprint>` | `reaped` | an administrator's force-reap | no |
| reaped, actor `alarm:unacked-release` | `reaped` | a delivered `release` unacknowledged for 2 hours | no |
| reaped, actor `alarm:leg-timeout` | `reaped` | a delivered `leg-timeout` release unacknowledged for 15 minutes | as `leg-timeout` |

- **`cannot-finish` classes** are core's built-in `interrupt` types `error.<class>` (R-BTN-160).
  `transient` and `contract-output` are retried by the leg's policy; `capability` and `spec` are
  non-retryable: Baton holds the ticket at once (`hold_reason: non-retryable:<class>`) and raises
  `baton.retries`, unless the policy routes them (`exhausted_on`, R-BTN-122). A course's own
  `interrupt` type ends with the class `transient` when retryable, else `spec`, and its `type` in
  `error`.
- **A release** pushes the work done so far, then `close`, then `handoff` (R-BTN-72), except as
  R-BTN-119 and R-BTN-44 say. A holder told to release (a `release` message, §6) stops at its next
  safe point — at once for `requested`, `owner-cancel` and `superseded` (R-BTN-119) — ends
  `released:<reason>` and acknowledges.
- Every end records a sync want (R-BTN-94), so confirmation never waits for an unrelated push.

### 9.5 Reaping and the fence

- **Reaping** (unnumbered). The alarm reaps every active claim whose runner has `now −
  last_seen_at ≥ lease_timeout_ms`: the claim becomes `reaped`, the runner gets `reaped_at` (no
  other reap sets it, R-BTN-19), and its pending and delivered messages become `expired`. The alarm also reaps a claim whose
  delivered `release` stays unacknowledged for 2 hours (15 minutes for `leg-timeout`). An
  administrator may force-reap any active claim from the dashboard (`POST
  /v1/ui/claims/{id}/reap`, confirmed per R-BTN-155), shown the runner's last-seen and
  last-activity times. The next claimant concludes from what git holds and the resume record.
- **R-BTN-19 (fence before re-issue).** A claim reaped while its runner was **alive** — a
  force-reap, an unacknowledged-release reap, a `leg-timeout` reap — is `fence_pending` with its
  `fence_incarnation` and `fence_deadline`, the reap instant plus the runner's
  `lease_timeout_ms`. Such a reap sets no `reaped_at`: the runner's next heartbeat is answered
  without the claim, so it can report the fence. The ticket is not claimable until that
  incarnation's sidecar, with its pre-reap secret, heartbeats, is told it no longer holds the
  claim, and reports `fenced: {claim_id, terminated: true}` — the lease marked lost and its
  running tool processes terminated (Baton logs `fence-cleared`) — or until `fence_deadline`
  passes, whatever the runner does meanwhile (a re-key, a new incarnation's heartbeats, a
  sidecar that heartbeats but cannot terminate a process); the alarm then clears it, logging
  `fence-cleared {deadline: true}`. Every check of the old incarnation has computed its lease as
  lost by then (`last_ok + lease_timeout − 4 min`, R-BTN-26). A fence still pending 30 minutes
  after the reap raises `baton.fence-pending` on the ticket, naming the runner and the deadline.
  A re-key never clears a fence (R-BTN-14).
  - A silence reap is not fence-pending — every check of that runner already computes the lease
    as lost — except on a claim running a `session`-mode leg (R-BTN-107), whose child session
    makes no checks: every reap of such a claim is fence-pending, and the runner reports `fenced`
    for it only once the provider confirms the child session interrupted or archived. A child the
    runner cannot reach before `fence_deadline` is not fenced: its later pushes and markers are
    only noticed, as `foreign-write`, once a later snapshot is accepted (R-BTN-46).

### 9.6 Confirming an end

- **R-BTN-10 (confirmation by observation).** A completed end is **unconfirmed** until git is
  seen to carry it. It is confirmed by the first accepted snapshot whose observation began after
  the end (R-BTN-62) and shows what the end claims:
  - `suspended:<station>`: a path that extends the claim's expected path (`start_path` followed
    by the legs it finished) by edges of the course file, its arrivals beyond it only those
    R-BTN-71 allows; any path if the claim ended regressed (R-BTN-71);
  - `done`: the ticket at an end station or recorded closed as done (`closed_tickets`), from a
    snapshot whose observation is greater than the claim's own (its claim or latest `advance`)
    — even one accepted before the end call, since the holder pushes first — or the ticket absent
    from a snapshot observed after the end; a check ticket's `done` only at the end's own
    `reached` and bound `check_sha` (R-BTN-153).

  Baton sets `confirmed_at` and logs `confirmed`; the sync posts nothing extra. Ancestry of the
  home repository's head never confirms a suspension.
- **Claimable again** (unnumbered). A ticket is claimable only after a snapshot observed after
  its last claim ended (`end_observation`), and never while a completion is unconfirmed (one
  marked `superseded_at` excepted, R-BTN-168). A
  completion unconfirmed 6 hours after `ended_at`, or one whose legs a later snapshot shows
  undone, raises `baton.unconfirmed` and is never confirmed automatically; an administrator
  confirms or releases it from the dashboard (R-BTN-155).

### 9.7 Attempts

- **Failed attempts** (unnumbered). A claim end counts as a failed attempt exactly where the end
  table says. The count is kept **per ticket and leg** (`leg_attempts`, R-BTN-122), against the
  leg the claim was running or starting, and is the number of failed claims ended after the
  later of the ticket's newest hold-lift `override` event and the leg's last run reaching one
  of its outcomes: lifting a hold, or the leg completing, resets it (R-BTN-122). In-claim retries, context
  refreshes and suspensions are never attempts. What a failed attempt triggers — backoff,
  holding, `baton.retries`, an `exhausted` leg — is R-BTN-122's.

### 9.8 Resuming and replaying

- **R-BTN-24 (the resume record).** On every claim end, a suspension included, Baton writes the
  claim's `resume_json` from its activities (the runner drains its spool before calling `end`,
  and a close accepted in the 10-minute grace, §9.9, that carries `resume` rewrites it): every
  `resume` object an activity's detail carried
  (the one nested key allowed, §12), the last activity and its outcome, the legs run, the end
  reason and detail, the transcript pointers, and `tainted` (R-BTN-148). Core reads no particular
  activity kind. The claim response for a ticket with earlier ended claims carries
  `previous_attempts`, the newest 10, newest first, each with its resume record, legs run and
  hand-off URL, and `previous_attempts_total`;
  a leg receives them only as data in `BATON_RESUME` (R-BTN-144). (`ctx.resume`, a condition's
  chosen restart, is R-BTN-162's and unrelated.)
- **R-BTN-25 (idempotent side effects).** Every side effect is keyed by the ticket so a later
  attempt finds the earlier one's work: before creating a branch the claimant continues an
  existing remote branch matching the course's `branch_pattern` (current or previous) for this
  ticket, including one the resume record names — a resume record naming any other branch is
  ignored;
  before opening a change it reuses an open one from that branch. A tainted branch is never
  continued (R-BTN-148). The activities that push or open a change record the branch and change
  in their detail's `resume`.
- **R-BTN-84 (any leg run can be replayed).** `baton leg replay <ticket> <leg> [--run <n>]
  [--against <sha>]` re-runs one recorded run on a runner, without a claim and writing nothing to
  Baton.
  - It reads the run from the ticket's history (snapshot sha, contract version) and its inputs
    with digests from `leg_run_inputs`; clones with a read-only credential the course's scripts
    at that sha (which must pass R-BTN-143) and the ticket's code at the run's `head_sha`;
    fetches the inputs and fails on a digest mismatch.
  - It runs `run(ctx)` with `ctx.replay` set, in R-BTN-144's replay environment: no write-capable
    git or forge credential, ssh-agent or credential helper; the model provider's key is kept.
    The runner does not call `close` and records what it would have written.
  - Outputs and would-be writes go to a local replay report; `--against <sha>` compares them with
    a run of the scripts at that sha on the same inputs. A leg with `"replay_safe": false` is
    refused. Replay reproduces code and inputs, not outputs.

### 9.9 Activities and transcripts

- **Activities** (unnumbered). An activity is one thing a runner does under its claim, drawn on
  the dashboard's timeline: `POST /v1/runner/activities` with `{id, claim_id, parent_id?, kind,
  seq?, label?, source, started_at, ended_at?, outcome?, detail?}` (detail and label under §12's
  rules).
  - **Kinds** are the claim's course's `step_kinds` (R-BTN-50), `other`, or one of core's:

    | Kind | Recorded by | When |
    |---|---|---|
    | `condition` | Baton, on `POST /v1/runner/claims/{id}/conditions` | a leg raises a condition (R-BTN-160) |
    | `condition-wait` | the runner | a leg waits in its claim for a handler (R-BTN-162) |
    | `context-handoff` | the runner | a fresh session replaces a full one, with both sessions' links (R-BTN-123) |
    | `in-claim-retry` | the runner | a leg is re-run under the same claim (R-BTN-122) |
    | `leg-log-write-failed` | the runner | a leg log's final write failed (R-BTN-128) |

  - **Sources.** `skill`: a skill marks a phase with `baton-activity start <kind> [--seq N]
    [--label …]` and `baton-activity end <id> --outcome <o>`. `hook`: harness hooks start and end
    an activity for the commands the course's matchers select (pure, tested functions matching
    anywhere in a compound shell line); a course's own tools report for themselves. Other tool
    calls are not activities.
  - **Pairing.** A hook activity is keyed by the harness's tool-call id in `call_id`; the
    post-tool or failure event closes it `succeeded` or `failed`. A denied call opens none; one
    whose post event never comes stays open until the claim ends.
  - **Parenting.** The reporter names `parent_id`; core infers none. A `parent_id` naming another
    runner's or claim's activity is refused.
  - **Before a claim.** An activity started with no claim is stored without `claim_id`, checked
    against the step kinds of the courses the runner declares, and linked to its next claim.
  - **Delivery.** Reporters append to the spool (§8.1); activity ids are per runner, so a retry
    is an upsert and no runner touches another's rows.
  - **Ending.** When a claim ends, its open activities close `abandoned` at `ended_at`. For 10
    minutes after, updates that only close its activities are accepted; later updates, and any
    that would open an activity on it, are refused `claim-ended`, which never marks the current
    lease lost.
  - The **current activity** is the newest open one; the heartbeat and a `status_report` (§6)
    return it. `started_at`/`ended_at` are the runner's clock and order activities within a
    claim; `received_at` is Baton's. No lease logic reads activity times.
- **R-BTN-20 (the archiver reports what it wrote).** A harness's transcript archiver appends each
  `(repo, path, pushed_at)` it pushes to the session's spool; the sidecar reports it on the next
  heartbeat. Baton never derives a path by convention, and keeps every path a session reports;
  the dashboard links the newest.
  - A child session (a reviewer, a runner's leg session) runs with `BATON_PARENT=<runner id>`
    and `BATON_ACTIVITY=<activity id>`: no sidecar, no runner; its archiver appends to the
    parent's spool with `role: subagent` and the activity id. An in-process subagent has no
    transcript of its own.
  - A path reported during a claim links to it; one reported with no claim links to the runner's
    next claim; a path pushed across several claims links to each. The dashboard shows
    `claimed_at` beside the link.
  - **Validation.** `repo` is in the claim's home repository's `transcript_repos` (owners'
    setting, R-BTN-66): a GitHub `owner/name` or `<forge>:<web_base>` (`github`, `gitlab`,
    `gitea`), never a registered repository (`invalid-params`). `path` matches
    `^[A-Za-z0-9._/-]{1,256}$` with no `..` segment. Links are only the base followed by the
    forge's file path (`/blob/HEAD/`, `/-/blob/HEAD/`, `/src/branch/HEAD/`) under R-BTN-92's link
    rule. Baton holds pointers, never content; reading needs the viewer's own access. An archiver
    under a runner masks per R-BTN-144.

## 10. Checks *(proposal)*

A check course runs a repository's merge checks in place of a CI service. Baton schedules the
check, a check-runner runs a command against the change's head, and the forge courier posts the
verdict to the forge, whose branch protection is the gate. A check is as trustworthy as the
registered check-runner keys, their legs' isolation and the check command on the default branch:
the change under test decides its command's exit status, which is what a test is, and cannot
print its way to `success`.

- **R-BTN-114 (check courses: check tickets and check-runners).**
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
    register one with `baton owner check-runner add <key> --name <hostname> [--capabilities …]
    [--max-tier <t>]` (`POST /v1/owner/{repository}/check-runners`, stored in `check_runners`)
    and revoke it with the destructive `owner.check-runner.revoke`.
    - The `check_runners` row stands in for a grant: rule 7 reads it for a check ticket, rule 4
      its `capabilities` and rule 5 its `max_tier`. The hostname binds at `add` and is the name
      the key heartbeats under (R-BTN-3). A check-runner heartbeats, claims, advances and ends
      check tickets and reports activities and transcripts and writes leg logs, as any runner does.
    - Only a check-runner claims or advances in a check ticket, and a check-runner claims nothing
      else. Baton holds this at every claim and every `advance` (`not-eligible`, rule
      `check-runner`), so the key that wrote a change never reports its check.
    - A check ticket is never claimed open-world (R-BTN-104): a claim naming an id that begins
      `check.`, or a course that is a key of the owners' `checks`, is refused the same way.
  - **Isolation.** Check legs require `runner:session` (R-BTN-107): no `process` or `attached`
    runner takes one (rule 4), and they run with every write-capable
    credential and secret withheld, as replay does (R-BTN-84). Checks run only changes from the
    repository's own branches, never a fork's: a leg's logic cannot be both generally useful and
    a sandbox for strangers' code.
  - **Conclusions are the owners'.** The owner setting `checks: {<course>: {name, conclusions:
    {<end station>: "success" | "failure" | "neutral"}}}` (R-BTN-66) maps end stations to
    conclusions, so no edit in git turns `failed` into `success`. A course file carries no
    `checks` (R-BTN-69); `baton course test` prints a check course's end stations for the
    owners to map.

- **R-BTN-153 (a verdict is a command's exit status, from the check-runner's confirmed end).**
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
    2. It runs the command **first**, in a fresh sandbox checked out at `check_sha`, before any
       agent touches that sandbox, through the provider method `exec(argv, {cwd, timeout_s}) →
       {status}` (R-BTN-107). A runner whose provider has no `exec` takes no verdict leg.
  - **Mapping the status.** Status 0 reaches the station mapped to `success`; any other status
    the one mapped to `failure`; a timeout or an `exec` error the one mapped to `neutral`. An
    `advance` or end reaching a success-mapped station carries `exit_status: 0`, which Baton
    requires. In a check course an agent's `baton-leg-result` or channel `done` (R-BTN-106) may
    reach only `failure` or `neutral` stations. A check course's `min_runner_version` is at least
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

- **R-BTN-115 (the forge courier and `forge-check` entries).** Baton sends no mail and calls no
  service. `forge-check` is the outbox's one kind outside git (R-BTN-171), and the forge courier is
  the courier that delivers it.
  - **The forge courier** is a courier registered with `--delivers forge-check` (R-BTN-171).
    - It holds the dedicated **check App**'s private key on its own host; Baton holds no
      credential of the check App. A check App serves one tenant.
    - `courier add` lists the App's installed repositories with the App's key and refuses when
      one is not a repository these owners own, or the installation covers "All repositories".
      The courier repeats the check at each delivery.
  - **The entry.** Its `fields` are `{origin, forge_repo_id, sha, name, conclusion, summary, seq,
    issued_at}`, where `sha` is the claim's `check_sha`, `name` the owners' check name, and
    `summary` rendered `plain` from the end station's outputs (R-BTN-112). Its signature
    (R-BTN-171) keeps earlier check runs verifiable across a key rotation.
  - **Lifecycle** is R-BTN-171's. A delivered `forge-check` entry is deleted after 7 days.
  - **Delivery.** The courier refuses an entry whose `origin` is not its configured origin, or
    whose `forge_repo_id` is null or not the target repository's. It writes `<repository>:<id>` to
    the check run's `external_id`, the signature into its output, and `summary` inside a code fence
    one backtick longer than any backtick run in it, never as Markdown.
    - `seq` increases per `(repository, sha, name)`; the courier posts only the highest it has
      claimed and drops older ones. Before posting it also reads the sha's check runs of that
      name and skips its entry when one carries a higher `seq` (each run's output holds its
      entry's `seq` beside the signature), so neither a second courier nor a worker that
      stalled past its lease posts an older entry over a newer one; a late `success` never
      overwrites a newer `failure`.
    - An entry for a superseded head is still delivered: the forge ties it to its sha.
  - **Read back.** The sync reads the change's check runs and posts them. A run by the courier's
    App on that head that matches its entry confirms it (R-BTN-171). A run by that App with no
    entry Baton issued, or whose conclusion or signature differs from it, or a newest run of a name
    on a head that is not the highest-`seq` entry already marked `delivered` for it, is the
    discrepancy `check-mismatch` (R-BTN-85) and raises `baton.check-mismatch`; for a stale newest
    run Baton also re-queues the highest entry. A courier can withhold; it cannot post a success
    Baton did not issue unseen.
  - **The gate is the forge's.** Branch protection requires the check by name **and** by the
    check App's id — never Baton's own App (§12.7) — so neither a status any token could post
    nor Baton itself satisfies it. Checks are GitHub only, until GitLab or Gitea offers a status
  that only one identity can post.

## 11. People: administrators, owners and their surfaces *(partly built)*

Two kinds of people hold authority in a tenant: its **administrators** and each repository's
**owners**. They act through three surfaces — the CLI, the dashboard and MCP — all generated from
one registry of actions and checked by one `authorize` (R-BTN-129). What every principal may do
is summarized in the principal table (§12.1).

### 11.1 Keys

- **R-BTN-13 (SSH keys and signed requests).**
  - **Keys.** An SSH key is one of `ssh-ed25519`, `ecdsa-sha2-nistp256`,
    `sk-ssh-ed25519@openssh.com` or `sk-ecdsa-sha2-nistp256@openssh.com`. Baton stores only the
    public key; a credential's id is its fingerprint (`SHA256:…`). A credential is valid in one
    tenant (R-BTN-137).
  - **Runners.** A runner credential registers under one name — a machine's hostname, or a
    cloud environment's name shared by its containers — unique in the tenant, one key per name.
    What it may do is in its grants (R-BTN-58). Refused `forbidden`: a heartbeat under another
    name, a course of a repository no grant of its
    key covers.
  - **Revocation.** Revoking a key sets `revoked_at`; every runner it registered stops at its
    next call.
  - **The signature profile.** Every signed call carries an RFC 9421 `Signature-Input` and
    `Signature`, with exactly one signature label.
    - Components, exactly: `@method`, `@authority`, `@path`, `@query` and `content-digest`
      (`sha-256` of the body; a request with no body carries the empty string's digest). Baton
      recomputes `Content-Digest`.
    - Parameters, exactly: `created`, `nonce` (128 random bits), `keyid` (the fingerprint) and
      `tag="baton-request"`. `expires` and `alg` are refused.
    - The value is an SSHSIG (OpenSSH `PROTOCOL.sshsig`) over the signature base, in the
      namespace `baton-request`, hash `sha256` or `sha512`, whose embedded public key is the one
      `keyid` names. The namespace keeps it from passing as any other signature by the same key,
      such as a signed commit.
    - Both hosts verify with WebCrypto (Ed25519, P-256). An `sk-` signature must carry the
      user-presence flag; its counter is not checked.
  - **Refused `unauthenticated`:** `created` more than 5 minutes from Baton's clock; an
    `@authority` other than the tenant origin's (its host, and its port when not the scheme's
    default); a nonce already seen for that key within 11 minutes (`request_nonces`); an unknown
    or revoked key.
  - **Custody.** Signers sign through `ssh-agent` or the key file and never read the private key
    into a log or transcript. A machine keeps its key as well as it can: in a hardware key, a
    Secure Enclave P-256 key, or, for a cloud environment, the secret `BATON_KEY`.

- **R-BTN-159 (an SSH key or an API key, the holder's choice).**
  - **Who chooses.** An administrator, an owner and a runner each holds either an SSH key, whose
    every request is signed (R-BTN-13), or an API key, sent as a bearer. Role, grants and
    revocation never depend on the kind. Sync, mirror, instrument, check-runner and courier
    keys are SSH keys (a sync may use a CI identity instead, R-BTN-93); an API-key runner never
    syncs. A signature leaves nothing reusable in a captured request; an API key works for
    whoever reads it until it is revoked. That is the holder's trade.
  - **The key.** `baton key create FILE` writes `bak_<id>_<secret>` (64 random bits of id, 256
    of secret, hex) to `FILE` (mode 0600) and its **public line** `bak_<id> sha256:<SHA-256 of
    the key> [comment]` to `FILE.pub`. Nothing is sent. The key's fingerprint is `bak_<id>`.
    Baton can mint a runner's API key instead, returned once: through a registration token
    (R-BTN-117), or `baton owner key create --api --name <name>` (`POST
    /v1/owner/{repository}/grants {name, api_key: true, capabilities, max_tier?}`).
  - **Where it is registered.** Wherever an SSH public key goes for that role: a
    `BATON_ADMIN_KEYS` line (`--admin-keys` locally), an owner key (`owner_keys`,
    `owner_keys_add`, an owners add), a grant's `public_key`.
  - **How it is sent.** `Authorization: Bearer <key>` in place of a signature, on `/v1/admin/*`,
    `/v1/owner/*`, `/v1/runner/*`, the repository reads and `GET /v1/actions`;
    a runner adds its secret (R-BTN-14).
    `baton … -i FILE`, `BATON_KEY_FILE` and `BATON_KEY` send it.
    - Baton hashes the key and compares every byte with the hash on the public line its
      fingerprint names. An unknown fingerprint, a wrong secret or a malformed bearer is
      `unauthenticated`.
    - A bearer on `/v1/sync/*`, `/v1/courier/*` or `/v1/probe/*` is never an API key's.
    - No client sends a bearer over non-loopback `http` (R-BTN-158).
  - **Everything else is a key's.** The one-role rule holds across kinds (§12.1). Acts are
    recorded as `admin:bak_<id>` or `owner:bak_<id>`. `baton admin revoke bak_<id>` stops a
    runner's or owner's key at its next call (R-BTN-57); an administrator's key, of either kind,
    stops only when its line leaves `BATON_ADMIN_KEYS`, at once, with its sessions.
  - **Bounds on API-key runners.** An API-key runner credential lives at most 90 days and ends
    after 7 days without an authenticated call (a token-registered one per R-BTN-117, if
    sooner). The repository setting `api_keys: false` (R-BTN-66, default `true`) refuses
    API-key runners and MCP keys on that repository. An administrator's or owner's API key lasts
    until it is revoked or its line removed.

### 11.2 Administrators and owners

- **R-BTN-57 (administrators: whoever controls the deployment).**
  - **The root of trust.** Whoever can deploy a Baton or set its secrets can replace its code, so
    that control is the root of trust (R-BTN-136) and Baton adds no second one. A tenant's
    administrators are the lines of its `BATON_ADMIN_KEYS` secret, each an SSH public key or an
    API key's public line, written through the CLI's secret sink (`baton admin keys set`,
    R-BTN-136); locally, the file `--admin-keys` names. Nothing in Baton's storage can add an
    administrator, and an administrator's powers end at its tenant.
  - **Powers.** An administrator signs `/v1/admin/*` to:
    - register and retire repositories with their first owner keys (R-BTN-47);
    - register instrument keys, external resources and account instances, and post or clear
      readings (R-BTN-76, R-BTN-151);
    - make or change any grant, and change a key's hostname
      (R-BTN-58);
    - revoke any key at once but an administrator's: revoking an owner key removes it from
      every repository it owns, the last owner included (an administrator then adds one with
      `owner_keys_add`), and ends its sessions and MCP keys. An administrator's key is removed
      only from the secret (`baton admin keys set`); `admin.key.revoke` naming one is
      `invalid-params`;
    - set the instance settings `link_hosts` and `session_hosts` (R-BTN-112, R-BTN-113) and a
      repository's `trigger_workflows` (R-BTN-94);
    - freeze, seal, export and import (R-BTN-88);
    - bind a sign-in code to an administrator's session, confirm that session's actions, and
      end every session, owners' included (R-BTN-155);
    - read everything, including any claim's leg runs (R-BTN-128), and what the dashboard
      draws — `GET /v1/admin/state`, the same answer an administrator's session reads from
      `GET /v1/ui/state`, with no session and so no sign-in (B-118).

    Each act is an `admin` event. No administrator action is reachable over MCP (R-BTN-130).
  - **An administrator key is out of every agent's reach.** It is a key of its own, never added
    to an ssh-agent that agent sessions can reach, and preferably touch-required
    (`ed25519-sk`), so no process signs with it unattended. `baton admin` signs with the key file
    (`-i`). Owner keys are kept out of agents' reach the same way, because they grant keys and add
    owners.
  - **One management path.** `baton admin …` and `baton owner …` sign with the user's ssh-agent
    or send the user's API key, and call the same validated functions (`src/core/admin.ts`) on
    both hosts. There is no other path: Durable Objects Data Studio is not used, and a local
    operator who edits the SQLite file bypasses validation at their own risk.
  - **Creating Baton's GitHub App is one command.** `baton admin github-app create --org <org>`
    creates the tenant's own App (§12.7) by GitHub's manifest flow.
    1. It opens GitHub's create-from-manifest page with the manifest filled in: `public: false`,
       the name, the webhook URL `<BATON_ORIGIN>/v1/github/webhook`, R-BTN-73's events and
       §12.7's permissions.
    2. It listens on `127.0.0.1` only, on a random port and path, sends a 128-bit `state`, and
       accepts exactly one callback carrying it.
    3. It exchanges the returned code (`POST /app-manifests/{code}/conversions`) and checks that
       `owner.login` is `--org`, that the permissions and events equal the manifest's, and that
       the webhook URL is the origin's. On any mismatch it writes nothing and prints the App's
       settings URL for deletion.
    4. It writes the App's id, private key and webhook secret through the secret sink, never to
       the terminal or a repository file, and prints the App's installation link. An
       organisation owner installs it; no Baton key can.

- **R-BTN-58 (repository owners).**
  - **Owners act for one repository.** Each registered repository has owner keys
    (`repository_owners`), SSH or API (R-BTN-159). An owner signs `/v1/owner/{repository}/*`
    and acts for that repository only; owning one repository confers nothing on another. An
    owner may:
    - grant a runner key access with the capabilities it may use (a capability, or a whole type
      `<type>:*`, R-BTN-121; never a role name, R-BTN-157) and its
      `max_tier` (`runner_grants`); revoke a grant; set a grant's `sync` flag and see each key's
      span (R-BTN-146);
    - add and remove owners, never the last;
    - register and revoke sync and mirror keys (R-BTN-93), couriers (R-BTN-171) and
      check-runners (R-BTN-114); mint and revoke registration tokens (R-BTN-117) and MCP keys
      (R-BTN-130);
    - set the owner settings and bars of R-BTN-66 and R-BTN-67, follow renamed bars
      (R-BTN-142), and consent to another repository's `code_repos` entry (R-BTN-140);
    - set and clear expedite and hold, and cancel (§6); re-route a ticket (R-BTN-83); extend or
      cancel a claim's deadline (R-BTN-90); resolve a condition by choosing a restart
      (`baton owner resolve`, R-BTN-163); stop a running leg (R-BTN-119); record a sync want
      (R-BTN-105);
    - read the repository's blocks, prerequisites, history, conditions and leg runs
      (R-BTN-75, R-BTN-120, R-BTN-128).
  - **Grants carry the power.** A key's capabilities live in each grant, not on the key, so what
    one repository's owners grant reaches only that repository's tickets (rule 4, R-BTN-45). A
    grant bounds which statements count for a repository; it confers no ability, and
    `human-operator` is admitted like any other capability.
  - **A key's hostname binds once.** It binds at the key's first acceptance (R-BTN-146) and is
    unique in the tenant. A later grant naming another hostname for the key is refused
    (`conflict`); only an administrator changes it.
  - **A runner works only where it is granted.** A ticket is recommended to, or claimed by, a
    runner only when its key holds an active grant on the ticket's repository (rule 7,
    R-BTN-45).
  - Owners act through `baton owner`, their own dashboard sessions (R-BTN-155) and the MCP keys
    they mint.

### 11.3 The registry, the CLI and MCP

- **R-BTN-129 (one registry of actions; every surface is derived from it).**
  - **An action** is one entry in `src/shared/actions.mjs`: `{id, summary, callers, effect,
    input, output, http, ui?, mcp}`.
    - `id` matches `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$` (dots and hyphens, never `_`), in
      R-BTN-127's nouns: `leg.why`, `leg.stop`, `ticket.expedite`, `owner.owners.add`,
      `runner.heartbeat`.
    - `callers` lists every principal that may call it, each with its scope, in the order the
      CLI tries them. Principals: `administrator`, `dashboard` (an administrator's dashboard
      session), `owner-session` (an owner's dashboard session, R-BTN-155), `owner`, `runner`, `check-runner`, `courier` (R-BTN-171),
      `probe` (an instrument key), `sync`, `mirror`, `mcp`, `token` (a registration token),
      `webhook` (the GitHub App's signature), `forge` (a forge verifier) and `public` (no
      credential: `POST /v1/login`, `GET /v1/keys/signing`). Scopes: `instance` (this tenant; no
      action is the operator's, R-BTN-136), `repository` (a repository the key owns or is
      granted on; for `owner-session`, one of the session's repositories its key still owns), `claim-holder` (the key holds the claim's lease) and `own` (its own
      credential or outbox entries).
    - `effect` is `read`, `write` or `destructive` (§12.2).
    - `input` and `output` are schemas in the shared validator's subset (R-BTN-108).
    - `http` is `{method, path, upgrade?: "websocket", match?}`. A WebSocket upgrade
      (`/v1/runner/push`) is an action,
      authorized at the upgrade. `match` tells apart the actions of one route by body field:
      `POST …/overrides/{ticket}` serves `ticket.expedite`, `ticket.hold` (`hold: true`),
      `ticket.unhold` (`hold: false`, owner or a session only) and `ticket.cancel`, and a body
      matching none or several is `invalid-params`.
    - `ui` is the dashboard control (§11.4); `mcp` is whether R-BTN-130 may expose it.
  - **The CLI's commands** are a second table in the same file. Each names the action ids it
    calls (`leg log` calls `leg.runs` and reads the log directory itself), or `local` for one that
    calls none.
  - **One check.** The front resolves the request's credential to a principal and a target, then
    calls `authorize(principal, action, target)` in core. No route, command, dashboard control
    or MCP tool checks permissions itself.
    - Under `/v1`, a request matching no entry is `404 not-found`. The dashboard's static assets
      are not actions.
    - An administrator's session authorizes as `dashboard`: every administrator action, and
      every owner action whose `callers` list `dashboard`, is open to it on every repository. An
      owner's session authorizes as `owner-session`: only the actions whose `callers` list
      `owner-session`, on its repositories, never an administrator's action; a target elsewhere
      is `forbidden`.
  - **Generated surfaces.** The router comes from `http`, the CLI tree and every `--help` from
    the command table, and the MCP tool list from `mcp`; the API table (§14) documents the
    registry. `npm run check:actions` fails when a route, command or API row has no entry, an
    entry has neither a route nor a command, an id breaks the grammar, or an `mcp: true` entry
    falls outside R-BTN-130's allowlist.
  - **What can I do.** `GET /v1/actions` answers the caller's own entries, each with its `input`
    schema. `baton help` with a key and MCP's `tools/list` read it. A caller is never shown an
    action it cannot take.

- **R-BTN-127 (the CLI is a tree of nouns and verbs).**
  - Every command is `baton <noun> <verb> [<arguments>] [<flags>]`; the only top-level verbs
    are `help` and `version`. Each command signs as its actions' `callers`, in order, trying the
    first role it has a key for.
  - **Keys.** The key `-i <file>` names, else the one `~/.config/baton/keys.json` maps to the
    role for the origin called: `{<origin>: {admin, owner: {<repository>: <file>}, courier,
    runner, sync: {<repository>: <file>}, mirror: {<repository>: <file>}}}` (R-BTN-137). No key
    for the role exits 2, naming the role.
  - **The tree.**

    | Command | Calls | Signs as |
    |---|---|---|
    | `leg why <ticket> [<leg>]` | `GET …/tickets/{ticket}/prerequisites` (R-BTN-120) | owner, or runner granted on the repository |
    | `leg log <ticket> [<leg>] [--run <n>] [-f] [--transcripts] [--json]` | `GET …/legs/{leg}/runs`, then the log directory (R-BTN-128) | owner, or administrator |
    | `leg runs <ticket> [<leg>]` | `GET …/legs/{leg}/runs` | owner, or administrator |
    | `leg replay <ticket> <leg> [--run <n>] [--against <sha>]` | R-BTN-84 | R-BTN-84 |
    | `leg stop <ticket>` | `POST /v1/owner/{repository}/tickets/{ticket}/release` `{reason: "requested", confirm: true}` (R-BTN-119) | owner |
    | `leg status`, `output`, `done`, `suspend`, `release`, `next`, `yield`, `raise`, `await` | the local channel (R-BTN-106, R-BTN-160, R-BTN-162) | the runner |
    | `ticket blocked [<ticket>] [--on <kind>:<ref>]` | the blocks routes (R-BTN-75) | owner, or runner granted on the repository |
    | `ticket history <ticket>` | `GET …/tickets/{ticket}/history` (R-BTN-81) | owner, or runner granted on the repository |
    | `board <repository>` | `GET /v1/repositories/{repository}/board` (R-BTN-179) | owner, or runner granted on the repository |
    | `admin repos` | `GET /v1/admin/repositories` (R-BTN-179) | administrator |
    | `owner grants <repository>` | `GET /v1/owner/{repository}/grants` (R-BTN-179, R-BTN-146) | owner |
    | `decision list [--all] [--watch]` | `GET /v1/repositories/{repository}/conditions?open=1&person=1` (R-BTN-163) | owner, runner granted on the repository, or administrator |
    | `course test <root> <course> [--base <ref>] [--board <file>]` | local (R-BTN-69) | — |
    | `repo init`, with R-BTN-134's flags | local: writes files | — |
    | `repo sync [--if-wanted] [--defaults-only]`, `repo mirror [--if-wanted]` | `/v1/sync/*` (R-BTN-93) | CI identity, sync (mirror) key, or machine key (R-BTN-102) |
    | `repo spool <repository>` | local (R-BTN-105) | — |
    | `runner start […]` | `/v1/runner/*` (R-BTN-72) | runner |
    | `runner register --token <t> --name <name> [--key ssh\|api]` | `POST /v1/register` (R-BTN-117) | the token |
    | `runner accept-grant <repository>`, `runner decline-grant <repository>` | R-BTN-146 | runner, key alone |
    | `key create <file>` | local (R-BTN-159) | — |
    | `server start --db <file> --admin-keys <file> […]` | local: starts the local host (R-BTN-56, R-BTN-158) | — |
    | `owner resolve <ticket> <restart>` | `POST /v1/owner/{repository}/tickets/{ticket}/resolve` (R-BTN-163) | owner |
    | `owner …` | R-BTN-58's actions | owner |
    | `admin …` | R-BTN-57's actions, `admin open` and `admin confirm` (R-BTN-155) | administrator |
    | `owner open`, `owner confirm` | an owner's dashboard sign-in and confirmations (R-BTN-155) | owner |

  - **A leg is named by its ticket.** `<ticket>` is a qualified id, or a local id unique among
    the signing key's repositories; one matching several exits 2, listing the qualified
    matches. `<leg>` defaults to the running leg, else the queued leg, else the most recent;
    `--run <n>` defaults to the latest.
  - **Inside a leg.** The channel verbs act on the leg whose socket `BATON_SOCKET` names and
    take no ticket; outside a leg they exit 2, "not inside a leg".
  - **Help.** `baton help [<noun> [<verb>]]`, `baton <noun> --help` and an unknown verb print
    that level's commands; an unknown word suggests the nearest name. Every command that reads a
    route takes `--json` and prints the route's JSON as is; `leg log --json` prints frames as
    JSON lines.

- **R-BTN-130 / R-BTN-154 (Baton serves MCP; its only writes add a hold and stop a leg).**
  *Proposed replacement: R-BTN-186 (B-124), authority by credential, not channel.*
  - **What MCP may reach is a closed list.** `mcp: true` is allowed only on an action whose
    `effect` is `read`, whose `callers` include `owner`, and which is no WebSocket upgrade; and
    on two writes: `ticket.hold` with `{hold: true}` only, and `leg.stop` (destructive).
    `check:actions` fails on any other. So, whatever an owner lists, MCP never reaches an
    administrator's action, a machine protocol (runner, sync, courier, probe), an action that
    adds, grants, mints, registers or revokes any credential or owner, a write of an R-BTN-66
    setting or bar, `ticket.unhold`, `ticket.expedite` or `ticket.cancel`.
  - **A hold set over MCP** is a `held` event with `hold_reason: mcp:<name>`. On a ticket already
    held it changes nothing, so it never replaces another reason.
  - **The MCP key.** An owner mints one with `owner.mcp-key.create`, whose `callers` are exactly
    `[owner]`, so every key has a minting owner key to die with: `baton owner mcp-key create
    <repository> --name <name> [--actions read | <id>,…] [--ttl <days>]` (`POST
    /v1/owner/{repository}/mcp-keys`). `--name` is unique in the repository.
    - It is returned once, `bmcp_` followed by 32 random bytes in base32. Baton keeps one
      `mcp_keys` row: repository, name, hash, the minting owner key's fingerprint, the action
      ids resolved at minting, expiry, last use (written at most once a minute) and revocation.
      An MCP key is not a `credentials` row.
    - `read` means the allowlisted read ids that exist at minting, so a later release never
      widens a key. `leg.stop` is included only when listed by id. An id outside the allowlist
      or the owner's own actions is refused at minting.
    - It lives at most 90 days (default 30) and ends after 7 days without a call, or when its
      minting owner key is removed or revoked. It is refused while the repository has
      `api_keys: false`, and works again when the setting returns, unless expired. Owners revoke
      it with `owner.mcp-key.revoke` (`POST /v1/owner/{repository}/mcp-keys/{name}/revoke`); it
      is listed with the repository's credentials, with its minter.
  - **Authorization.** `authorize` treats an `mcp` principal as its minting owner on its one
    repository, narrowed to its stored ids; an id that has lost `mcp: true` is refused. The
    actor is recorded as `mcp:<name>` in history and release messages. An MCP key is accepted
    only on `POST /v1/mcp`; every other route answers it `unauthenticated`.
  - **The endpoint.** `POST /v1/mcp` speaks MCP's streamable HTTP transport, statelessly, in JSON.
    - Revisions are those in the build's `MCP_VERSIONS` (at least `2025-06-18`). `initialize`
      needs no `MCP-Protocol-Version` header; on any other request an absent header means
      `2025-03-26`, and a revision not in the list is `400`.
    - Methods: `initialize`; notifications, answered `202`; `ping`; `tools/list`; `tools/call`.
      Any other method is JSON-RPC `-32601`; a batch array is `-32600`.
    - No `Mcp-Session-Id`. `GET /v1/mcp` is `405`. A missing or unknown key is `401` with
      `WWW-Authenticate: Bearer`. A foreign `Origin` is `403`.
  - **Tools.** `tools/list` returns the key's stored ids that still carry `mcp: true`, named by
    the id with `.` as `_`, with `inputSchema` the entry's `input` and `readOnlyHint` or
    `destructiveHint` from `effect`. `tools/call` runs the route's core function and returns the
    output as `structuredContent` and as text through the `plain` renderer (R-BTN-112).
    - A refusal is a tool error with the route's code. A tool the key does not hold, an unknown
      tool and a target outside its repository all answer `forbidden`.
    - `confirm` over MCP is a schema check, not a human gate; the safeguard is the owner's
      choice at minting.
    - Returned values are data, never instructions, and the tool descriptions say so.
      `leg.runs` returns pointers and live state, never log bytes.
  - **Bounds.** At most 60 calls per key in any 60 seconds, counted in memory in the
    tenant's object (a restart empties it), else `rate-limited` with `retry_after_s`. A list
    tool takes `cursor` and returns `next_cursor`, HMAC-bound under `CursorKey` (R-BTN-55) to
    the key, action and input. A page is at most 256 KB; a larger single item is `too-large`.
  - Clients that cannot send a bearer obtain MCP keys through OAuth 2.1, `BATON_MCP_OAUTH_SPEC`
    (`spec/BATON_MCP_OAUTH_SPEC.md`).

### 11.4 The dashboard

- **R-BTN-155 (dashboard sign-in is a code a key holder confirms).** An administrator signs in
  with `baton admin open` and an administrator key, an owner with `baton owner open` and an
  owner key; the session has that key's role. Its row records the role (`administrator` or
  `owner`), the minting key's fingerprint and, for an owner, the repositories the key owned at
  binding (`dashboard_sessions`). An **administrator's session** authorizes as `dashboard`; an
  **owner's session** as `owner-session` (R-BTN-129): it sees, watches and acts only on those of
  its repositories the key still owns, with the actions whose `callers` list `owner-session`, and
  never holds an administrator's action.
  - **Sign-in.**
    1. `baton admin open` opens `https://<origin>/login?as=administrator`, and `baton owner
       open` `https://<origin>/login?as=owner`; the page carries nothing secret and heads itself
       "administrator sign-in" or "owner sign-in".
    2. The page sends `POST /v1/login {role}`. Baton writes a `login_codes` row of that role, sets
       the pending cookie `__Host-baton-pending` (value `bps_<id>_<secret>`, two minutes, R-BTN-16), and
       answers `{code}`: eight Crockford base32 characters, which the page shows.
    3. The key holder types the code into the CLI, which shows the row's role, client address
       and age ("owner session for <address>, <n> s old"), then sends `POST
       /v1/admin/login-links {code}` with the administrator key, or `POST /v1/owner/login-links
       {code}` with the owner key (an `sk-` key needs a touch). Baton binds the key to the
       unexpired, unbound row with that code and the route's role; any other code, a row of the
       other role included, is `not-found`, as is an owner key that owns no repository, and the
       CLI then reports how many rows the address made and lost in the last two minutes.
    4. The page polls `POST /v1/login {poll: true}` (`{pending: true}` until bound). The request
       carrying the bound row's pending cookie gets the session cookie `__Host-baton_session`
       (value `bds_<id>_<secret>`), and the row is marked used.

    No command line, URL, history or capture carries anything that becomes a session: a process
    that asks for a code of its own gets nothing unless a key holder types that code, read from
    Baton's own page, and an owner's code never becomes an administrator's session.
  - **Limits.** At most five unbound rows per client address, each living two minutes. A sixth
    drops the oldest row whose pending cookie has never polled, else the oldest polled row; it
    never refuses. The client address is the connection's, or a forwarded one only from the
    `--trusted-proxy` (R-BTN-158). Eviction bursts raise `baton.sign-in-burst`.
  - **Sessions.** A session lives at most 4 hours and dies with its minting key's role, checked
    on every request: an administrator's session ends as soon as its key leaves
    `BATON_ADMIN_KEYS`; an owner's session loses a repository as soon as its key stops owning it
    (`owner.owners.remove`, or an administrator's revocation, R-BTN-57), and ends when none of its
    repositories remains. `POST /v1/ui/logout` (`ui.logout`) ends the caller's own; `baton owner
    sessions revoke` (`POST /v1/owner/sessions/revoke`, `owner.sessions.revoke`, destructive)
    ends every session the owner's key minted; `baton admin sessions revoke --all` (`POST
    /v1/admin/sessions/revoke`, `admin.sessions.revoke`, destructive) ends every session.
  - **Confirmed actions.** A session's request that changes authority answers `202
    {confirm_code}` instead of acting: eight Crockford base32 characters, living two minutes and
    used once, bound to the session, the action and its parameters (`action_confirmations`).
    Only the key that minted the session confirms it, through its role's route: `baton admin
    confirm <code>` (`POST /v1/admin/confirm`) for an administrator's session, `baton owner
    confirm <code>` (`POST /v1/owner/confirm`) for an owner's; any other key's is `not-found`.
    The command fetches and prints the action and its target (`{code, dry_run: true}`), asks,
    then sends `{code}`, which performs it. One list, for both roles; each confirms the entries
    its session may start:
    - cut over (`POST /v1/ui/cutover`, R-BTN-28); force-reap (`POST /v1/ui/claims/{id}/reap`);
      accept a rejected history (`POST /v1/ui/board/accept`) — an administrator's only;
    - lift a hold, set or clear expedite (`POST /v1/ui/overrides/{ticket}` with `hold: false` or
      `expedite`);
    - confirm or release an unconfirmed completion (`POST /v1/ui/claims/{id}/confirm`,
      `…/release`); confirm an adoption (`POST /v1/ui/adoptions/{claim}/confirm`) — an
      administrator's only;
    - approve an MCP grant naming `leg.stop` (`owner.mcp-key.approve`, `BATON_MCP_OAUTH_SPEC`
      §5) — an owner's only.

    Not confirmed, because they stop or slow work and Stop must stay one click: setting a hold,
    cancel, Stop and other `release` messages, a resync, a status request; nor resolving a
    condition, which a signed-in owner or administrator answers in one step (`POST
    /v1/ui/conditions/{condition}/resolve`, R-BTN-163).
  - **What the confirmation protects.** A same-user process can read a browser's cookie jar, so
    a session is the browser profile's; the confirmation keeps a stolen session from an
    authority-changing act only while the minting key needs a touch. An API-key or plain SSH key
    that a same-user process can reach confirms as well, which is why R-BTN-57 keeps
    administrator and owner keys out of agents' reach.

- **The views.** At the origin's `/`, behind a dashboard session, polling `GET /v1/ui/state`
  every 10 seconds; all text through `textContent` (§12.3). An owner's session's state holds
  only its repositories: their tickets, claims, conditions and history, and the runners granted
  on them; Instances and Capacity, which are tenant-wide, are an administrator's.
  - **Runners** — by name: alive or dead, harness, tier ceiling, capabilities (declared, and derived per repository, R-BTN-174), tags, courses,
    lease timeout, last seen, last activity, the claim held, current activity, transcript link,
    `isolation`, credential kind and registering token.
  - **Timeline** — a swimlane per alive runner over 24 hours: claims as bars, activities nested
    under them by kind, failed ones marked; a segment shows its label, detail and transcript;
    leg runs link their `session_url` (R-BTN-113) and show their log directory as text (R-BTN-128).
  - **Running** — each active claim's event timeline and reap deadline; **stalled** when the
    runner is alive but `last_activity_at` is over 2 hours old; a leg waiting on a condition
    shows `condition-wait`; session links and log directories as on the Timeline.
  - **Ready** — the matching order with each ticket's `requires`, tier and eligible alive
    runners, and **ready but nobody can take it** with the failed rule.
  - **Instances** — the instance view (R-BTN-99) and the day's request and row-write counts.
  - **Needs you** — Baton's debugger: the open conditions §7 lists there (R-BTN-163), ordered by
    severity then age, each with its restarts and the tickets it would unblock.
  - **Resolve** — `/conditions/<condition_id>`, the page a core condition's handler links to
    (R-BTN-163): the one condition, its detail and restarts; choosing a restart is
    `owner.resolve` for a signed-in owner of its repository or an administrator. Signed out, the
    page asks for sign-in and returns to itself.
  - **Capacity** — the request rate and live counts against the envelope (R-BTN-87).
  - **Courses** — each course file as stations and legs, every leg drawn as an edge with its
    state (ready, running, blocked by kind and when found, backing off) in colour and a text
    label, never a blocked station (R-BTN-126); per ticket its station and path from git, the
    claim's legs since, what a suspended ticket waits for, its newest hand-off, blocks, queued
    leg and its source (R-BTN-83), parent and children, history with input and output pointers
    (R-BTN-81, R-BTN-82); each leg's queue depth against `max_queue` and the intake state
    (R-BTN-79); `off-graph` transitions; course stats.
  - **Discrepancies** — every place git overrode Baton (R-BTN-85), by kind and age, with Baton's
    value, git's, the observation and a link to the ticket's history.
- **The actions.** Every control calls a registry action through `authorize`, a destructive one
  with `confirm: true` from its dialog (§12.2). Unconfirmed, a session views, holds, cancels,
  stops a leg (`POST /v1/ui/messages` `{kind: "release", payload: {ticket_id, reason:
  "requested"}}`, R-BTN-119), resyncs a repository (`POST /v1/ui/resync`), requests status and
  resolves a condition; every other action it may take needs its code confirmed (R-BTN-155), so
  the dashboard is no standalone console. An owner's session does these only on its
  repositories, and the administrator's controls (cutover, force-reap, accepting a held history,
  completions, adoptions) are not drawn for it. Repositories, owners, grants, instrument keys
  and bars are shown read-only.

## 12. Security *(partly built; §12.8 proposal)*

- **Whose rules these are.** Every principal belongs to one tenant and authenticates only at
  that tenant's origin (R-BTN-137); the operator is not a principal (R-BTN-136).
- **Pushers are legitimate.** Whoever can push a registered repository's default branch is a
  legitimate user of it, and Baton does not fortify git (R-BTN-66). These rules keep people
  **without** push from gaining anything. No push changes Baton's own state: keys, grants,
  bars, holds and settings.
- **Who may push the default branch is the deployment's choice** (§12.8). On one machine with
  trusted runners, runners may land their own work. Where runners are untrusted, the default
  branch accepts only trusted runners and humans, and Baton never requires a runner to write it
  (R-BTN-180, R-BTN-182).
- **Owner gates are human gates only with a human-only credential** (R-BTN-185). An owner's
  agent sessions hold whatever the owner gives them; a gate that must stop them asks for a
  credential no session holds.
- **Sensitive legs act on attestations** (R-BTN-181): typed facts only a trusted writer makes,
  re-checked by a trusted runner at the moment it acts.
- **Cooperative, not a sandbox.** A leg runs as its runner's OS user, and nothing separates the
  sessions of one user (R-BTN-14). Baton runs no repository code (R-BTN-98) and checks no
  per-runner identity in git (R-BTN-46).
- **Content is data.** Text from git, runners and forges reaches a model only as quoted data and
  a screen only as text (§12.3).
- **No existence oracle.** A refusal never tells a caller whether something outside its reach
  exists: an unheld action, an unknown target and a foreign one answer alike.

### 12.1 Principals

Each principal, the routes it uses, how it authenticates and what it may do. A row's powers are
stated once, in the rule it cites.

| Principal | Routes | Credential | May |
|---|---|---|---|
| Runner (machine key) | `/v1/runner/*` | SSH-signed (R-BTN-13) or API key (R-BTN-159), plus the runner secret (R-BTN-14) | heartbeat as its name; claim and act where it holds an active grant (R-BTN-58, R-BTN-146); post readings (R-BTN-101); ask blocks (R-BTN-75); accept or decline its grants, key alone (R-BTN-146); as a signed key, sync a granted repository (R-BTN-102) |
| Trusted runner | `/v1/runner/*` | SSH-signed, on a grant at trust level `trusted`; its forge credential is the only non-human one able to perform its legs' actions | heartbeat as its name; claim, advance and end legs marked `trusted: true`, nothing else (R-BTN-182) |
| Owner's agent | the owner's routes | an owner key not registered `human_only` | an owner's actions, as `owner`; never a `human` attestation or a human gate (R-BTN-185) |
| Check-runner | `/v1/runner/*` | SSH-signed, plus the runner secret | heartbeat as its name; claim, advance and end check tickets; report activities and transcripts, write leg logs; nothing else (R-BTN-114) |
| Board sync, mirror | `/v1/sync/*` | the repository's sync or mirror key, or a CI identity token (R-BTN-93, R-BTN-156) | sync: observation numbers and board posts; mirror: read events; both: sync wants (R-BTN-94) |
| Forge notification | `POST /v1/forges/{repository}/notify` | the forge's verifier under `BATON_FORGE_SECRETS` (R-BTN-95) | record a sync want for its own repository (R-BTN-156) |
| GitHub App webhook | `POST /v1/github/webhook` | `X-Hub-Signature-256` by the App's webhook secret (R-BTN-73) | trigger a sync dispatch; Baton reads only R-BTN-73's fields |
| Courier | `/v1/courier/*` | SSH-signed: a dedicated courier key, or a runner key the repository's outbox policy admits | claim outbox entries of the classes the outbox policy admits it to, and mark them (R-BTN-171, R-BTN-115) |
| Instrument (probe) | `/v1/probe/*` | SSH-signed | post readings of any registered instance (R-BTN-101) |
| Registration token | `POST /v1/register` | `Authorization: Baton-Token <token>` | register one credential within its scope (R-BTN-117, R-BTN-157) |
| Administrator | `/v1/admin/*`; any claim's leg runs | a `BATON_ADMIN_KEYS` line, SSH-signed or API key | R-BTN-57 |
| Administrator's dashboard session | `/`, `/v1/ui/*`, `GET …/prerequisites` (R-BTN-120) | the session cookie (R-BTN-155) | administrator actions, under R-BTN-155's confirmations |
| Owner's dashboard session | `/`, `/v1/ui/*`, `GET …/prerequisites` of its repositories | the session cookie (R-BTN-155) | the actions listing `owner-session`, on the repositories its minting owner key still owns, under R-BTN-155's confirmations; never an administrator's |
| Repository owner | `/v1/owner/{repository}/*`; the repository's reads and leg runs | an owner key, SSH-signed or API key | R-BTN-58 |
| MCP key | `POST /v1/mcp` only | bearer `bmcp_…` | its stored allowlisted actions on one repository, as its minting owner (R-BTN-130) |
| Public | `POST /v1/login`, `GET /v1/keys/signing`, the dashboard's static assets | none | start a sign-in; read the signing keys |

The repository reads (`GET /v1/repositories/{repository}/…`) are open to any key granted on the
repository, its owners and administrators, except where a route's rule narrows them.

- **R-BTN-179 (the state is readable with a key; B-90).** What the dashboard's state answers is
  answered to a signed key too, by the same queries — one request, one JSON answer:
  `GET /v1/admin/repositories` (administrators: the registry as `/v1/ui/state`'s
  `repositories`, plus `seed_owners` — the unretired repositories whose live owner keys are all the
  deploy seed's, or that have no live owner, R-BTN-58/B-91); `GET /v1/owner/{repository}/grants` (its owners: that repository's `owners`,
  `grants` and `settings`, and the bars in force or scheduled, R-BTN-146, each grant also naming
  the `other_repositories` its key holds); and
  `GET /v1/repositories/{repository}/board` (the repository reads' principals: the repository,
  its `ready` tickets and `ready_by_tier`, `granted_capabilities`, and `server_time`). A key outside the route's role is refused as this
  section says — `forbidden`, or `unauthenticated` for a key Baton does not know. The CLI's
  `baton admin repos`, `baton owner grants <repository>` and `baton board <repository>` are those
  requests. The board's `granted_capabilities` names the capabilities the key's grant holds on
  that repository — the same grant the heartbeat's answer names for a runner that declared it —
  and is null for a key no grant binds there, an owner's or an administrator's included.

- **One role per key.** In a tenant every key holds exactly one role: administrator, owner,
  runner, check-runner, courier, instrument, sync or mirror. Registering a key that holds
  another role is refused `conflict`, whatever its kind (SSH or API); the refusal does not name
  the role. A machine key whose every grant is pending and was never accepted holds no role yet,
  so a grant naming any public key reserves nothing; its acceptance is checked as a
  registration. `baton admin keys set` refuses a line whose key holds another role, and a host
  that loads one anyway treats it as no administrator and raises `baton.admin-key-conflict`. Administrator and owner
  keys are never machine keys. The rule holds within a tenant; another tenant may hold the same
  public key (R-BTN-137).
- **Bearer secrets** — API keys (`bak_`), registration tokens (`brt_`), MCP keys (`bmcp_`),
  pending sign-ins (`bps_`) and dashboard sessions (`bds_`) — are stored only as hashes, are
  valid in one tenant, and are compared over their full digests in constant time; so is every
  forge and webhook MAC.

### 12.2 Destructive actions

These actions take `confirm: true` in the body, or are refused `confirm-required`; the CLI asks
or takes `--yes`, and the dashboard's dialogs send it. Over MCP `confirm` is only a schema check
(R-BTN-130).

- `ticket.cancel`, `leg.stop`, `claim.force-reap`;
- `owner.owners.remove`, `owner.grant.revoke`, `owner.courier.revoke`,
  `owner.check-runner.revoke`, `owner.sync-key.revoke`, `owner.token.revoke`,
  `owner.mcp-key.revoke`, `owner.sessions.revoke`;
- `admin.key.revoke`, `admin.repo.retire`, `admin.sessions.revoke`.

Two further changes take `confirm: true`: a repository's path (R-BTN-138) and a `code_repos`
consent (R-BTN-140). A dashboard session's authority-changing actions also need a
confirmation code (R-BTN-155).

### 12.3 Untrusted text

Every value below is validated on write; a value over its cap is refused `invalid-params`.

- **Free text** (`session_name`, an activity's `label`, `end_reason`, message payloads,
  rate-limit details): `session_name` by R-BTN-3's pattern; every other at most 500 characters,
  with no control characters and none of `<`, `>`, `{`, `}`, `` ` ``. The backtick ban keeps a
  mirrored code span from being closed.
- **Activity `detail`** (§9.9): an object of at most 16 keys matching
  `^[a-z][a-z0-9_]{0,31}$`, whose values are numbers, booleans, free-text strings or a
  pull-request URL, plus under the one key `resume` a nested object under the same rules; at
  most 2 KB. A pull-request URL is the `web_base` (R-BTN-92) of the ticket's home, or of a
  `repos:` entry with reach (R-BTN-140), followed by the forge's path: `/pull/<n>` on GitHub,
  `/pulls/<n>` on Gitea, `/-/merge_requests/<n>` on GitLab, none on a plain `git` repository.
- **Identifiers.** A ticket's local id matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and is
  qualified as `<repository id>:<local id>` (R-BTN-47); a decision id or restart id matches
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`, the prefix `baton.` reserved to core; an `asks` label
  matches `^[a-z][a-z0-9-]{0,31}$`; a condition type follows R-BTN-160. This is the ticket-id rule
  the other sections cite.
- **Links.** Every link Baton accepts or draws passes R-BTN-92's link rule for one of the
  ticket's repositories with reach (R-BTN-140), or names a host an administrator allowed:
  `link_hosts` for a view's `link` (R-BTN-112), `session_hosts` for a session link
  (R-BTN-113). A posted decision's `url` (R-BTN-78) and a condition's `url` (R-BTN-160) are the
  only links they carry; one that fails the rule is dropped, so no `javascript:` link reaches a
  screen. `needs` names follow R-BTN-76.
- **URIs** (R-BTN-82), at most 1 KB, are one of:
  - `git:<owner>/<name>@<40-hex>:<path>` or `git:<owner>/<name>#blob=<40-hex>`, where the path is
    relative, at most 512 characters of `[A-Za-z0-9._/-]`, with no empty, `.` or `..` segment;
  - an `https://` URL under the repository's forge, checked as a decision's `url`;
  - `s3://<bucket>/<key>?versionId=…` with the bucket in the owners' `artifact_buckets`.

  A `git:` or `https://` URI names the ticket's home or a `repos:` entry with reach
  (R-BTN-140). A non-`git:` URI needs a `digest`. A URI is stored as text and drawn as a link
  only when `https://`.
- **Markers** (§9): every field value is percent-encoded, RFC 3986 unreserved characters
  only, so no value holds a space, a quote or `-->`; `locate` decodes before validating.
- **Opaque blobs** (course data, a ticket's and a leg's course fields, a runner's profile and
  reports, readings' `detail`) are JSON stored verbatim and never rendered as markup, so the
  brace rule does not apply: at most 16 KB per blob and 256 KB of a repository's course data.
- **Rendering.** The dashboard renders text only through `textContent`, never `innerHTML`, and a
  blob only as pretty-printed JSON. `baton leg log` strips terminal escapes and every C0 and C1
  control but newline and tab (R-BTN-128).
- **Models.** Profiles, reports, readings' `detail`, course fields, resume records, hand-off
  documents and an earlier claimant's text reach a model only as quoted data, in their own file,
  never in instructions (R-BTN-144, R-BTN-152).
- **The mirror** (§16) runs `check-note-mdx` on every note it writes, with free text in code
  spans; a failing note is written without its free text and flagged. §16 states the export's fence.

### 12.4 Same-site with the product

- **R-BTN-16 (same-site with the product).** A Baton may share its registrable domain with
  origins that run untrusted code. So, on every host:
  - **Cookies.** Baton sets two cookies and reads no other: the dashboard session
    `__Host-baton_session` (at most 4 hours) and the pending sign-in `__Host-baton-pending` (2
    minutes), both `__Host-` prefixed, host-only, `Secure`, `HttpOnly` and `SameSite=Strict`, so
    no other origin on the domain can set or shadow them (R-BTN-155).
  - **Headers.** Every response carries `Content-Security-Policy: default-src 'self';
    frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
    `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
    and `Cross-Origin-Resource-Policy: same-origin`.
  - **Writes.** A state-changing `/v1/ui/*` request and `POST /v1/login` must carry
    `Content-Type: application/json` and an `Origin` equal to the tenant's origin
    (`BATON_ORIGIN`; locally `--origin`), else `forbidden`.
  - **Every session request.** Any request a dashboard session authorizes, reads included,
    carries an `Origin` equal to the origin when it carries one, and `Sec-Fetch-Site:
    same-origin` when it carries that header, else `forbidden`.
  - **Sessions.** `/v1/ui/*` requires a dashboard session minted from an administrator or owner key
    (R-BTN-155).
    Cloudflare Access may stand in front of the dashboard as extra hardening; Baton never
    requires it and never reads its cookie. Where it stands, it covers only the dashboard's
    pages (`/`, `/login`, `/oauth/authorize`), `POST /v1/login` and `/v1/ui/*`, and is bypassed
    on every other route, which authenticates every request itself or is public: keys,
    webhooks, forge notifications, couriers, instruments, CI identities and MCP clients call
    them without an Access cookie.

### 12.5 The local host and bearers

- **R-BTN-158 (the local host, and bearers over `http`).**
  - **Binding.** `baton server start` binds `127.0.0.1` unless `--bind <address>` says otherwise.
    TLS is the operator's: a front (a reverse proxy, Tailscale serve) terminates it, and
    `--origin` names the front's origin, against which R-BTN-135's host check holds. A
    non-loopback `http` origin gets no dashboard, because its cookie is `Secure`.
  - **Bearers never cross `http`.** The CLI, the runner and the forge courier refuse to send a
    bearer to a non-loopback `http` origin; that is the control. The server detects:
    - the Cloudflare host refuses a bearer on a plain-`http` URL as `unauthenticated`;
    - an `http` listener refuses every bearer (API keys, MCP keys, registration tokens, the
      dashboard cookie) as `unauthenticated` when the connection's peer is neither loopback nor
      the `--trusted-proxy`, whatever the origin says, and accepts SSH-signed requests from any
      peer;
    - either way, a bearer whose secret fully verifies is revoked at once (ending the session,
      for a cookie), because it crossed the network in clear, and raises
      `baton.bearer-over-http`. One that does not verify is only refused and counted in §2.3's
      failure buckets: an id or fingerprint alone, which is public, revokes nothing.
  - **The trusted proxy.** `--trusted-proxy <address>` names the one front whose forwarded
    client address Baton reads, for the sign-in limits (R-BTN-155).
  - **File modes.** At start the local host exits 2 on a group- or world-writable `--db`, secret
    file or directory, or a group- or world-readable secret file. It creates the database `0600`
    in a `0700` directory.
  - **Import** re-validates every row and refuses requests signed before the source's seal, as
    R-BTN-88 states.

### 12.6 Capability roles and links

- **R-BTN-157 (capability roles never reach a grant; links are bounded).** Registration
  tokens' bounds — role `runner` only, uses, lifetime, re-keys and bursts — are R-BTN-117's.
  - **Roles never reach a grant.** A course file whose `capability_roles` (R-BTN-121) names
    `human-operator`, another role, a capability or `none` is held (R-BTN-69). A grant holds
    capabilities only: the CLI expands a role from the repository's latest accepted snapshot
    (`GET …/courses`), never the working tree. Before signing a `<type>:*` grant the CLI prints
    every course defining the type, and asks for confirmation when their definitions differ.
  - **Links.** A `link_hosts` link (R-BTN-112) is an `https` URL with no userinfo.
    `context-handoff` links and `handoff_url` pass R-BTN-113's or R-BTN-92's rule, or are dropped
    and logged.

### 12.7 Baton's GitHub App

- **The dispatch App** is optional: Baton records that a sync is wanted and a runner pulls it
  (R-BTN-94); the App is GitHub's dispatch adapter and its webhook source (R-BTN-73). Each tenant
  has its own, created by `baton admin github-app create` (R-BTN-57) and installed by an
  organisation owner on each registered repository and its `code_repos`.
  - **Permissions:** Actions: write; read-only Contents (`push`), Pull requests (`pull_request`,
    `pull_request_review`) and Issues (`issue_comment`). No Checks. Baton never reads repository
    content through it.
  - **Key.** Baton mints short-lived installation tokens per repository from the Worker secret
    `BATON_GITHUB_APP_KEY` (`--github-app-key` locally). Without the App or the secret, a
    repository's workflows run on their schedule.
  - **Dispatch only what is named.** Actions: write lets the App dispatch any workflow, so Baton
    dispatches only a repository's `sync_workflow`, `mirror_workflow` and its owners'
    unblocked trigger, whose workflow is limited by R-BTN-94. A repository whose other workflows
    must not be triggered gives them no `workflow_dispatch`.
- **The check App is another App** (R-BTN-115): its key lives only with the forge courier, and
  branch protection names it, never the dispatch App.

### 12.8 The core guarantee *(proposal — B-127, B-130, B-131, B-133, B-136, B-137, B-139, B-140)*

Baton specifies the mechanisms below, each with what it guarantees; a deployment chooses which to
require. Fieldhouse requires all of them (FIELDHOUSE_SPEC's profile rule); a small team running
trusted runners on one machine needs none.

| A repository with | Guarantees |
|---|---|
| `landing: cooperative` (the default) | R-BTN-14's model: Baton keeps cooperating runners from colliding, and nothing more |
| `landing: protected` | **against any runner, compromised or not**: no runner lands on the default branch or a tag, and a control path lands only by the human-only identity (both enforced by the forge); a ticket or goal change lands only with a human approval of that commit (enforced by the trusted merge runner). **Against mistakes only**: a merge needs reviews from trust domains that did not write or run the change. **Not held**: a compromised runner can push a commit onto another ticket's branch that an honest fixer's report carries |
| `landing: protected` and `authorship: signed` | also no single compromised runner or trust domain can land a change, change a protected path, or change a fact a sensitive leg acts on, **provided the deployment enforces** that review legs run no branch code and that a domain which ran a branch's code is reset before it serves another ticket (R-BTN-183) |

**Human gates and `human_key`.** Every clause above that rests on a human approval holds against an
injected owner's agent session only under `human_key: hardware` (R-BTN-185). Under `human_key: any`,
the default, a human-only key an agent session can reach is outside every guarantee; only "a control
path lands only by the human-only identity" survives, since it rests on the separate forge identity.

**Outside every guarantee, stated exactly:**
- a compromised runner that is itself one of the two reviewers, and whose change or findings persuade
  the other reviewer's model, lands it; two reviewers from different model families narrow this, and a
  repository whose default branch is itself deployed sets `protected_paths: ["**"]` so a human
  approves every merge;
- a human-only key an agent session can use (always possible under `human_key: any`);
- a compromised host of trusted runners or of the host-side signer (the deployment's to protect:
  Fieldhouse keeps its host repository writable by the human-only identity only);
- a human who approves a change they misread;
- a compromised Baton server or Cloudflare account (reach 0 of `docs/security-model.mdx`), recovered
  by B-125's runbook;
- a compromised forge.

The worked example is a course that turns a merged spec into tickets: its `decompose` leg writes
ticket files on a branch; two reviews, from trust domains that never ran the branch's code, are
attested by Baton; the owner, shown the computed change, attests approval of those files at that
commit with a human-only key; the merge runner, a trusted runner, re-checks every attestation and
merges that commit.

- **R-BTN-180 (landing modes, trust levels and protection).** `landing` is an R-BTN-66 setting.
  - **Every grant has a trust level and a trust domain.** The trust level is `trusted` or
    `untrusted`; the trust domain is the host or VM its runner runs in. Both are set by the owner
    (a human gate under `protected`, R-BTN-185). Under `cooperative` a grant is `trusted` unless
    marked otherwise, and Baton refuses an `untrusted` grant there. Under `protected` a grant is
    `untrusted` unless marked otherwise, and a repository has one active grant per trust domain.
  - **Switching to `protected` resets them.** Trust levels, trust domains, model families, roles and
    set under `cooperative`, where they are not human gates, are cleared
    when a repository becomes `protected`, and set again through human gates. Lowering `human_key` or
    switching back to `cooperative` is itself a human gate.
  - **A trusted runner** (R-BTN-182) is a role a grant may hold only at trust level `trusted`. It
    is separate from the trust level: a `trusted` grant without the role runs ordinary legs.
  - **Under `protected`**, machine syncs (R-BTN-102) and every grant's `sync` flag are off, and
    untrusted runners create and update only refs matching the course's `branch_pattern`: no
    default branch, no other branch, no tag, no `refs/baton/*`. The default branch, tags and
    `refs/baton/*` accept updates only from trusted runners and the human-only identity.
  - **`baton repo protect --print <forge>`** prints the forge setting that enforces it, and
    **`--check`** reads it back:
    - GitHub: an organisation (a personal account cannot name a person as a bypass actor). Rulesets
      on branches and tags whose only bypass actors are the trusted runners' dedicated App
      (contents and pull-requests write, no Administration) and a team whose only member is the
      human-only identity; never the GitHub Actions App, a role, or Dependabot. `--check` reads the
      rulesets and their `bypass_actors`, environments, their reviewers and deployment policies.
      GitHub returns `bypass_actors` only to a caller with write access to the ruleset, so the
      check runs with a credential that has it, held only by trusted runners; whether a narrower
      App permission suffices is to be verified when B-140 is built. A change between runs is
      detected by comparing each run's reading with the last, not from an audit log, which
      GitHub offers only on Enterprise Cloud;
    - GitLab: protected branches and tags. On GitLab Free, where only roles may push, the trusted
      runner pushes with a deploy key and never holds Maintainer;
    - Gitea and Forgejo: protected branches and tags with a whitelist;
    - plain git: a `pre-receive` hook on a server that knows the pusher's identity (gitolite, or
      `authorized_keys` with `environment=`), with no runner able to write the repository's files;
      the hook keeps a pusher log. Never a client-side hook.
  - **Baton checks the protection it depends on.** The sync and every trusted runner run the check
    each run; a difference from `--print`, or from the previous reading, raises `baton.unprotected`
    and stops trusted runners until the human-only identity resolves it.
  - **Nothing requires an untrusted runner to write the default branch.** Claims, status and course
    history are Baton's (R3-1266, B-120). Under `protected`:
    - no course commits to the default branch; `merge` legs are trusted legs (R-BTN-182);
    - Baton's own git writes (the outbox's git kinds, R-BTN-171) never create or change a ticket
      file. They are delivered by whoever the repository's `git` outbox policy admits. This
      guarantee covers them only while that policy admits `courier` or `trusted-runner` alone,
      with `trust: trusted` and a `min_release` that renders from the CLI's templates. A looser
      policy is a stated exception of the repository, set through a human gate (R-BTN-185);
    - a ticket a runner's action would create (a condition's handler ticket, R-BTN-161; a call
      leg's child, R-BTN-165; a promoted question, R-BTN-173; a supersession's replacement) is
      **proposed, not filed**: a trusted runner writes its file on a branch `baton/proposed/<ticket>`
      from the creating leg's typed output, and Baton holds only its filter fields (R-BTN-33). It is
      not claimable, and no leg reads its body, until its file lands with a `std:approval@1`, as a
      ticket change; one approval may cover several proposed tickets, each named in its `paths`;
    - `baton request` (R-BTN-131) run with an untrusted credential opens a PR, not a push;
    - the mirror (§16) writes nothing to the default branch; its notes are Baton's.
  - **Secrets and privileged jobs.** No repository-level secrets where untrusted runners push. A
    secret limited to the default branch is only as safe as the least-protected path its workflows
    execute, so every such path is protected (R-BTN-184). Privileged jobs restore no Actions cache,
    run with a read-only default `GITHUB_TOKEN`, and install nothing from the repository's lockfile
    or package-manager configuration. Environments that deploy or release require the human-only
    identity as reviewer; the trusted runners' and the sync's environments are limited to the
    default branch, without reviewers. A release is the signed tag and the published package's
    provenance, never the forge's release object, which any `write` role can edit.
  - **The everyday forge identity** the owner's agent sessions use holds no admin, maintain or
    organisation-owner role and no bypass on a `protected` repository (R-BTN-185).
- **R-BTN-181 (attestations: typed statements about work or about a resource).** A typed
  statement Baton stores, which a leg may require: a review, a check run, a human's approval, a
  provider's remaining quota. Attestations differ only in their subject and their writer; whether
  one gates a leg is the requirement's choice, never the attestation's.
  - **Shape:** `{id, type, subject, value, writer, nonce, uses, lapses_at?, signature?, at,
    revoked_at?, used_by?}`. `type` is a schema id from the shared registry (R-BTN-108). `value` is
    validated by the type's schema (at most 4 KB). `uses` is `once` or `until` `lapses_at`.
    `subject` is one of:
    - **work**: the repository and the ticket, and optionally a commit or a ref. For a trusted leg
      it comes from values Baton holds (the claim's ticket, the head the sync read), never from a
      runner's output;
    - **a resource instance** (R-BTN-76). An attestation about an instance is a **reading**.
  - **Writers.** Baton records an attestation's writer from the credential that posted it:
    - `human`: a `human_only` key (R-BTN-185);
    - `owner`: any owner key or owner session, an owner's agent included;
    - `baton`: Baton itself, from events it verified, signed with Baton's attestation key;
    - `instrument`: an instrument key; `runner`: a runner credential; `admin`: an administrator.

    Any of them is also `service:<fingerprint>` for its own key, so a requirement can name one key
    (a trusted runner, the trusted executor, one instrument). Work is attested by `human`, `owner`,
    `service` and `baton` writers on the repository; a resource instance by the writers R-BTN-76's
    *Who reports* names.
  - **Signed.** An attestation about work is always signed; a reading may be signed. The signature
    covers the RFC 8785 canonical JSON of `{type, subject, value, writer, nonce, uses, lapses_at}`
    in SSHSIG namespace `baton-attestation@1`; fields Baton sets are outside it. An attestation
    counts only while its writer's key, and for a `baton` attestation the attested runner key, is
    unrevoked. An unsigned reading never counts toward a trusted leg's requirement (R-BTN-182).
  - **Any surface.** `POST /v1/repositories/{repository}/attestations` (`baton attest`, the
    dashboard, MCP) takes an attestation about work, and R-BTN-76's routes take readings; whether
    one is accepted depends on the credential alone (R-BTN-186). A delegated key is never `human`.
    `DELETE …/attestations/{id}` revokes one, a human gate for `human` ones.
  - **Supersession.** A new attestation supersedes an earlier one only when type, subject, writer
    and **attested key** are the same; the attested key is the writer's key, except for a `baton`
    attestation, whose attested key is the runner key it is about. So two runners' reviews at one
    head coexist, a later `std:ran@1` by one domain never erases another's, and each instrument
    keeps its own latest reading (R-BTN-76).
  - **A prerequisite kind** (R-BTN-120): a leg's `requires.attestations: [{type, subject, writers,
    where?, count?, distinct?, binds?, missing?}]`.
    - `subject` is `work` (the leg's ticket, optionally at its `head`) or `instance: <resource>`
      (the runner's usable instances of it, R-BTN-76).
    - `writers` lists the writer classes and `service:<fingerprint>` keys whose attestations
      count. A standard type below carries its writer as the default; for any other type the
      validator refuses an entry without `writers`.
    - `where` is a list of tests `{path, op, value | leg_input}` over the value, `op` one of `eq`,
      `in`, `glob`, `superset-of`, `gte`, `lte`; `count` (default 1) attestations must hold, with
      `distinct` naming a field they must differ on.
    - `binds` is `gate` (the default) or `advice`. `missing` is `block` (the default for `gate`)
      or `allow` (the default for `advice`): whether no attestation in force, lapsed, revoked or
      `unknown`, blocks.
    - Unmet, it is an `attestation` block, `why` one of `missing`, `other-subject`,
      `writer-not-allowed`, `consumed`, `lapsed`, `revoked`, `failed-where`. A gate's block refuses
      a claim and an advance (rule 1); an advice block is advice, as a `resource` one is (R-BTN-75).
    - `requires.resources` (R-BTN-76) is the short form of an `instance` requirement on
      availability, and takes `binds`, `missing` and `writers` with the defaults `advice`, `allow`
      and every writer R-BTN-76 lets report.
    - The validator refuses a `trusted: true` leg with a requirement that binds as `advice` or
      names a writer other than `human`, `baton` or a `service:<fingerprint>` key.
  - **Whose attestations count is the course's to say.** `writers` is part of the course file.
    Under `protected` a course file is a control path, landed only by a human (R-BTN-184); under
    `cooperative` Baton's gates bind cooperating runners only (R-BTN-46). A trusted runner still
    pins the keys of every writer it acts on, in its own configuration (R-BTN-182).
  - **Standard types:**
    - `std:wrote@1` (writer `baton`): a writing leg's reported commit range `start..head`, its
      trust domain and its runner key. Baton does not see the commits; the trusted runner verifies
      their signatures at merge (R-BTN-183);
    - `std:ran@1` (writer `baton`): a leg ran the branch's code at `head` in its trust domain (every
      writing leg, and any leg its course does not mark `reads_only: true`);
    - `std:review@1` (writer `baton`): a review leg the course marks `approves: true` and
      `reads_only: true` ended `approve` at `head`, with its trust domain and its grant's model
      family;
    - `std:checks@1` (writer `service:<the trusted executor's key>`): the course's check commands,
      from protected course data, passed at `head` in a sandbox holding no credential; the key
      signs outside the sandbox from its exit status only;
    - `std:approval@1` (writer `human`): the owner approved `head` with `value {paths, blobs,
      view}`: the protected paths changed, their blob ids, and the digest of the computed view;
    - `std:branch-deletion@1`, and others: the same shape, for other trusted legs.
  - **Records, not git.** No attestation is read from git or the forge. A person leg (R-BTN-116) a
    trusted leg acts on is answered by an attestation.
  - **Baton's own state** (an exception to R-BTN-35, as course history is, B-120, and for the
    signature to R-BTN-33). Attestations about work are exported with the owner state (R-BTN-88);
    an import drops every one of them, and in-flight work re-attests by re-running its writing and
    review legs. Lost attestations fail closed. Readings are kept and exported as R-BTN-76 and
    R-BTN-88 say.
- **R-BTN-182 (trusted runners).** A runner role, on a grant at trust level `trusted`, that claims
  only legs its course marks `trusted: true` (`merge`, branch deletion, sensitive
  API calls) and holds the only non-human credential able to perform that leg's action. No other
  runner is offered a trusted leg or may claim, advance or end one (rule `trusted`).
  - **It runs no repository code.** It runs a CLI release installed by tarball integrity with the
    release's own `npm-shrinkwrap.json`, so every dependency is pinned too, outside any checkout,
    with no user or project package configuration; and git plumbing.
  - **It pins what it trusts, in its own configuration**, not only Baton's: the `human_only` public
    keys, Baton's attestation key, and the writers of every requirement it acts on.
  - **It re-checks at the moment it acts**: every attestation is fetched, its signature and its
    writer's unrevoked key verified against the pins, its subject compared with the exact object
    acted on, and a `once` attestation consumed by compare-and-swap before the action, restored only
    when the forge provably refused it.
  - **Its credential is human-level for what it may do.** It runs as a workflow on the default
    branch, or as a process in a trust domain of its own, where no other runner and no agent session
    runs; never on the owner's machine under `protected`.
  - **A course's `legs/<leg>.run.mjs` for a trusted leg may only add refusals.** It runs in a
    sandbox with no network, no credential, a private PID namespace and `/proc`, the computed diff as
    its only input, a fixed time, and no checkout, `.git` or home directory (`bubblewrap` or an
    equivalent on Linux; where none is available the override is refused, not run unsandboxed). It
    returns `{refuse, reasons}`, `reasons` from a closed list with path ids. The CLI applies
    R-BTN-183 afterwards, whatever it returns.
- **R-BTN-183 (what the merge runner merges).** At the PR's exact head `H`:
  - **A domain that runs a branch's code is one of its writers.** Every `std:wrote@1` and `std:ran@1`
    domain of `H`'s chain is a writer domain. A reviewer never runs the branch's code: a review leg is
    `reads_only: true`, reads the diff and the files as data, loads its agent configuration from the
    default branch and never from the branch, and runs no hook, install, build or test; tests run
    only in the trusted executor.
  - **Baton records this; the deployment makes it true.** Baton cannot observe what a leg ran:
    `std:ran@1` follows from the course's declarations. Under `authorship: signed` the deployment
    must therefore (a) run review legs in an environment with no command execution and no
    configuration from the branch, and (b) reset a trust domain to a clean state after any leg that
    ran a branch's code, before it serves another ticket, since taint is tracked per ticket while a
    domain persists. Fieldhouse does both (R-FH-3). Baton's part is the runner's harness: a
    `reads_only` leg starts its agent with no `--auto` or permission bypass and no configuration
    from the branch (B-141). The courses that run their reviews that way are the deployment's
    (R-BTN-131).
  - **Continuity.** A writing claim reports its start head at claim, which must be the last
    attested head (or the merge base for the first leg). The CLI refuses to build on any other tip
    and raises `baton.foreign-commit`. At `advance` the leg reports `start..head` from the objects it
    pushed and verifies the remote equals them; its own intermediate pushes inside that range are
    its own. Commits reachable from the default branch (a merge of main into the branch) are not
    part of any range. A rebase replaces the range: the leg that rebases reports the new one.
  - **Signed authorship**, where `authorship: signed`: every commit in a range is signed by the leg's
    key (SSHSIG, namespace `git`); a commit by any other key, or unsigned, never merges. A runner
    under `authorship: signed` signs with an SSH key, never an API key, and a leg in `session`
    isolation signs through its runner (R-BTN-14). Review records a course commits to the branch
    (B-101) are written by the trusted runner, not the reviewer, so a reviewer never becomes a
    writer.
  - **Independent review.** Two `std:review@1` at `H`, from trust domains different from each other's
    and from every writer domain of `H`, from review claims that started at `H`, and from grants
    pinned to two different model families. A grant's model family is set with its trust level (a
    human gate) and a review leg runs only that family.
  - **Checks.** A `std:checks@1` at `H`, or check runs whose workflow file is on the protected default
    branch with the same blob as at merge time. Commit statuses are never read. Checks show that the
    change's own tests pass; they are not a security gate.
  - **Paths.** The changed paths are `git diff-tree -r -z --no-renames --name-only` from the default
    branch's tip to the merge result, plus each `merge-base --all` diff. A symlink or submodule entry
    (modes 120000, 160000) or a `.gitmodules` change anywhere is refused. Paths are matched as `p`
    and `p/`, case-folded and NFC-normalised, against the protected paths.
  - **Protected paths.** A control path never merges here (R-BTN-184). A ticket or goal path merges
    only with a `std:approval@1` at `H` whose `paths` and `blobs` cover every protected path changed,
    and whose blobs equal those paths' blobs in the merge result; the own-progress exception aside.
    Main moving does not void an approval unless it changes an approved path.
  - **How.** Squash or merge at exactly `H`, with the base pinned too (a compare-and-swap push of
    the merge result onto the main tip it was computed from), and a commit message the merge runner
    writes itself, carrying no trailer from the branch. A branch that moved since an attestation was
    made is refused, and the ticket returns to the leg the course names.
  - **Foreign commits.** A commit on a ticket's branch that no claim of that ticket reported is found
    by the trusted runner from git, not from webhooks, which carry no signatures. It resets the
    branch to the last attested head and raises `baton.foreign-commit`, an `owner` resolution, not a
    human gate, so a cheap push cannot cost a hardware-key ceremony.
  - **Source pins** (R-BTN-134) are accepted only at a commit on the source's first-parent history or
    a release tag.
- **R-BTN-184 (protected paths).** An owner setting (a human gate under `protected`) with a floor no
  course or owner removes. Baton computes what it can and fails closed on the rest:
  - computed: `.baton/**`; every path `.baton/baton.json` lists in `imports`; the items glob and goal
    glob the ticket source declares in `baton.json`; `.github/workflows/**`, `.github/actions/**`
    and every local path a workflow `uses`; `.github/CODEOWNERS`; agent configuration for each
    supported harness (Claude Code: `.claude/**`, `**/CLAUDE.md`, `.mcp.json`; opencode:
    `opencode.json`, `.opencode/**`; and `**/AGENTS.md`); package-manager and environment
    configuration (`.npmrc`, `.yarnrc*`, `.envrc`);
  - declared by the owner: authority documents as whole files (the context corpus, `lessons`, the
    spec), and what deploying or releasing workflows execute. A repository whose workflow uses a
    secret in a deploy or release environment is protected `**` until the owner narrows it; `baton`
    is `**`.
  Two classes:
  - **Control paths** (all but tickets and goals): never merged by a trusted runner. The leg ends at
    `human-merge`, showing the human the computed view of `H` (B-133): the chain, the reviews, the
    checks and the diff. A human lands it; a trusted runner recognises the human's merge by reading
    the forge (the merge's actor equal to the human-only identity, or the pusher log), and records a
    merge of any commit other than the presented `H` as a discrepancy. Later, a course may change
    control paths with a `std:approval@1` (a separate decision).
  - **Tickets and goals:** merged by the merge runner with a `std:approval@1` (R-BTN-183).
  - **A leg's own progress** needs no approval: a claim's branch may append to its own ticket file,
    at the exact path Baton's claim names, when the change is bytes appended at the end of a file
    whose base ends in LF, compared as blobs without rename detection, with no mode change, after the
    file's last line `## Status` (LF, outside code fences, present at the merge base). A file without
    one takes no progress. Each entry is one line, `- <UTC time> <leg> <claim nonce>: <text>`, the leg
    and nonce equal to the claim's and the time within its span; the text at most 300 bytes of
    letters, digits, spaces and `.,;:-'()?!`, no URL; at most 20 entries per claim. Readers show these
    lines as the leg's data. Anything else in a ticket file is a ticket change. A done ticket's move
    to the archive, setting `status: done`, is a templated change the merge runner makes.
- **R-BTN-185 (human-only credentials).** Under `protected`, a human gate (`std:approval@1`, a
  production deploy or release, a ruleset bypass, a human's merge, credential management, trust levels,
  trust domains, model families and the trusted-runner role, lowering `human_key`, owner-key removal, every R-BTN-66 setting
  that loosens a limit, revoking a `human` attestation, the message of the
  day) is satisfied only by a credential no agent session holds and no agent can drive.
  - **The human-only key** is an SSH key registered `human_only`, used for nothing else, and kept
    where no agent session can use it: not in an agent session's environment or `ssh-agent`, not on a
    machine an agent drives. The first is registered by the administrator out of band; each later one
    needs a signature by an existing one. On an instance with any `protected` repository,
    administrators are `human_only` keys. How strongly a deployment enforces "no agent can use it" is
    its own policy, `human_key: any | hardware` (an instance setting, default `any`): `hardware`
    accepts only a hardware-backed key requiring PIN and touch (`verify-required`) whose FIDO
    attestation matches an allowlist of authenticators. Switching to `hardware` suspends every
    `human_only` key registered before the switch that does not meet it. Fieldhouse requires
    `hardware` (R-FH-3).
  - **What is signed is shown first.** The CLI prints the canonical fields and the computed view
    before signing. Under `human_key: hardware`, it also requires a short code derived from them,
    typed on the machine the key is plugged into. The dashboard may only prepare an approval that the
    CLI signs; a WebAuthn assertion is a human gate only with an authenticator registered by a
    `human_only` signature and pinned by trusted runners, attested and allowlisted under `hardware`.
  - **Two forge identities.** The human-only identity administers protected repositories and is their
    only human bypass and reviewer; its token is in no agent session, and no agent tool drives the
    browser profile or desktop where it is signed in. The everyday identity the owner's agent
    sessions use has no administrative role (R-BTN-180).
  - **The owner's agent** is a principal (§12.1): an owner key not `human_only`. It acts as `owner`,
    never as `human`.
- **R-BTN-186 (authority by credential, not channel).** An action is available on every surface (the
  CLI, the API, the dashboard, MCP) to the principals its `callers` list (R-BTN-129), and to no other;
  a surface lacks an action only for a mechanical reason the registry names. A delegated key (an MCP
  key) acts as its minting owner for the actions listed at minting. It never holds credential
  management or a change that loosens an R-BTN-66 setting: lifting a hold or a cancel, removing or
  narrowing a bar, `retry`, `trusted_identities`, `code_repos`, `transcript_repos`,
  `artifact_buckets`, `leg_log_root`, `required_independence`, `checks`, `check_runners`, `api_keys`,
  `machine_sync`, `outbox_policy`, a grant's `sync` flag, trust level, trust domain, model family or role, `landing`,
  `authorship` and `protected_paths`. Tightening, such as adding a hold or
  a bar, is open to any owner credential, MCP keys included. This replaces R-BTN-130's closed list
  (B-124).
- **R-BTN-187 (what Baton trusts from a board post).** Under `protected` (with R-BTN-180's sync rule):
  - what a protection depends on (changed paths, signatures, foreign commits, a human's merge) is read
    from git and the forge by trusted runners, never from a board post or a webhook delivery, which
    only triggers a sync (values 6);
  - stations a trusted leg acts on are reached from attestations, never from verdicts, trailers or
    comments read from git (R-BTN-131's verdict reading and the `branch` course's trailers apply only
    under `cooperative`);
  - per-key limits on observation numbers, board posts and concurrent claims, so one key can freeze
    neither the board nor the leases.
- **R-BTN-134 holds in full** (B-139): a sourced course's home holds its entry and its overrides only;
  the sync refuses any other course file beside a `source`; runners load a sourced course's code only
  from the source, at a first-parent or release-tag commit, and decline a leg whose source they cannot
  verify.

## 13. Data model *(proposal)*

One SQLite database per tenant, in the tenant's Durable Object (or the local host's file). The
schema below is the current one, together with `BATON_MCP_OAUTH_SPEC` §12's rows (the OAuth
tables, `mcp_keys`' immutable `id`, `oauth_redirect_uris`, its alarm instants and the `oauth` event
kind), which B-73 folds in here; `src/migrations/` holds the numbered, append-only migrations that
reach it, and the object refuses to serve until every migration is applied (§2).

**Conventions.**

- Times are integer UTC epoch milliseconds (`*_at`, `since`, `until`, `not_before`, `due_at`).
- Columns marked JSON hold JSON text; flags are integers 0/1. Free text is validated on write
  (§12); opaque course blobs are size-capped and never read by core.
- `ticket_id` is always the qualified id `<repository>:<local id>`; `repository_id` is
  `repositories.id`; `credential_id` and `fingerprint` are a key's fingerprint (`SHA256:…` for an
  SSH key, `bak_<id>` for an API key); `runner_id` and `claim_id` are integers.
- An actor column (`set_by`, `added_by`, `granted_by`, `created_by`, `actor`) holds
  `admin:<fp>`, `owner:<fp>`, `runner:<id>`, `mcp:<name>`, `sync`, `alarm` (or `alarm:<reason>`, e.g. `alarm:leg-timeout`) or `server`.
- When a ticket leaves the board (closed or dropped), exactly its board rows are deleted:
  `tickets`, `ticket_requires`, `ticket_depends`, `ticket_stations`, `ticket_next_legs`,
  `ticket_bars`, `ticket_decisions`, `leg_queue_members`, `ticket_blocks`, `leg_needs`,
  `ticket_timers` and its `condition_bindings`. Its `ticket_overrides` row and `leg_attempts`
  move into `closed_tickets.kept_json` and come back if the same id returns (R-BTN-12); a
  `retry` block is rebuilt from `leg_attempts.retry_after`. Every other row naming it is kept:
  claims and their leg runs (the traversal record, R-BTN-63), conditions, the outbox,
  `open_world_bars`, `tainted_branches`; its history, outputs and inputs stay 90 days after it
  closes (R-BTN-81).
- Values marked *adoption* serve only legacy claims at cutover (R-BTN-28, §16).
- Nothing below holds an item body, note, exit criterion or PR list (R-BTN-33).

### 13.1 Repositories, courses and tenant settings

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `repositories` | `id` (`^[a-z][a-z0-9-]{0,39}$`) | `github` (the forge path, case-insensitive; `~retired/<id>` on a retired row), `forge` (`github`\|`gitlab`\|`gitea`\|`git`, fixed), `remote`, `web_base`, `forge_host`, `forge_repo_id`, `forge_owner_id` (decimal strings), `forge_ids_seen` JSON (`{mismatch}`: the last 5 distinct mismatched ids, R-BTN-138), `former_paths` JSON (latest 10), `ci_identity` JSON, `dispatch` JSON, `default_branch`, `sync_workflow`, `mirror_workflow`, `mirror_pusher` (the mirror's forge login, R-BTN-73), `mirror_acked_seq`, `sync_wanted_at`, `sync_wanted_after`, `weight` (100), `tiers` JSON (lowest first), `trigger_workflows` JSON, `cutover_at`, `retired_at`, and the owner settings below | A registered repository (R-BTN-47, R-BTN-92, R-BTN-93, R-BTN-94, R-BTN-138). Unique: `(forge, forge_host, forge_repo_id)` among live rows; a forge path among live rows |
| `courses` | `(repository_id, id)` | `version`, `skill`, `course_json` (the validated course file: stations, legs, contracts, capability types and roles, conditions, timers), `leg_capabilities_json` (each leg id → the capabilities its `requires` names, roles expanded as `graphOf` expands them; `{}` on a row written before migration 0022 until its next accepted post), `step_kinds` JSON, `min_runner_version`, `report_horizon_h` (6), `branch_pattern` (`claude/{ticket}-*`), `previous_branch_pattern` | Each course as the repository's last accepted snapshot posted it (R-BTN-48, R-BTN-69, R-BTN-121, R-BTN-134); the derived leg capabilities are written in the statement that writes the file, the input rule 4's candidate query reads (R-BTN-120) |
| `course_schemas` | `(repository_id, id)`, `id` = `<course>:<name>@<n>` | `course_id`, `digest`, `schema_json`, `snapshot_sha`, `posted_at` | Named schemas; immutable — a different digest for a stored id refuses the course file (R-BTN-108) |
| `course_data` | `repository_id` | `payload` (opaque JSON), `snapshot_sha` | The courses' opaque board data, served in the fleet view (R-BTN-99) |
| `condition_bindings` | `(repository_id, ticket_id, prefix)`; `ticket_id` `''` for the repository scope | `course_id`, `replaces`, `snapshot_sha` | Bindings as posted (`bindings` and `tickets[].conditions`, §4.4) from `.baton/baton.json` and ticket files; Baton reads them only to file handler tickets for its own conditions (R-BTN-161, R-BTN-171) |
| `baton_settings` | `key` | `value`: `tenant_id` (written at the first request, R-BTN-135), `frozen_at`, `sealed_at` (R-BTN-88), `instances_version` (R-BTN-99) | Tenant state |
| `instance_settings` | one row | `link_hosts` JSON, `session_hosts` JSON | Administrator settings (R-BTN-112, R-BTN-113) |
| `ontologies` | `repository_id` | `digest`, `builtin` (`baton@<n>` or NULL), `fixed_json` (the fixed predicates, evaluated at acceptance, R-BTN-175), `program_json` (the validated merged program, ≤ 64 KB), `snapshot_sha`, `accepted_at` | The ontology in force (R-BTN-174, R-BTN-175) |
| `code_repo_consents` | `(home_id, repo_id)` | `consented_by` (`owner:<fp>` of `repo_id`'s owner, or `admin:<fp>`), `consented_at` | A registered repository's consent to a home's `code_repos` entry; written only by `POST /v1/owner/{repo_id}/code-repo-consents` or an administrator, never by the home's settings (R-BTN-140) |

**Owner settings** — columns of `repositories`, written by `PUT /v1/owner/{repository}/settings`
(R-BTN-66); the administrator sets `weight`, `tiers` and `trigger_workflows` at registration.

| Setting | Default | Rule |
|---|---|---|
| `transcript_repos` JSON | `[]` | R-BTN-20 |
| `artifact_buckets` JSON | `[]` | R-BTN-82 |
| `retry` JSON — the repository's default policy, its ceilings and floors | NULL (core defaults) | R-BTN-122 |
| `required_bars` JSON `[{course, leg, except?, tag_prefix}]` | `[]` | R-BTN-67 |
| `unblocked_trigger` JSON (the `dispatch` shape) | NULL | R-BTN-77, R-BTN-94 |
| `machine_sync` | 1 | R-BTN-102 |
| `trusted_identities` JSON (forge user ids) | `[]` | R-BTN-139 |
| `code_repos` JSON `[{path, repo_id, former_paths}]` — owners write `path` only; Baton resolves `repo_id` and keeps `former_paths` | `[]` | R-BTN-140 |
| `api_keys` | 1 | R-BTN-117 |
| `required_independence` JSON `{<leg>: [<leg>…]}` | `{}` | R-BTN-106 |
| `checks` JSON `{<course>: {name, conclusions}}` | `{}` | R-BTN-114 |
| `outbox_policy` JSON `{git, forge-check}`, each `{deliverers, trust, min_release?}` | each `{deliverers: ["courier"], trust: "any"}` | R-BTN-171 |
| `leg_log_root` — `s3://…`, `gs://…`, or on the local host `file:///…` | NULL (off) | R-BTN-128 |

### 13.2 Credentials and sign-in

Administrator keys are the host's `BATON_ADMIN_KEYS` value, never a row (R-BTN-57). One role per
key holds across `credentials`, `repository_owners`, `sync_keys` and the administrator set,
checked in the transaction that adds or first accepts a key; a key whose every grant is pending
and never accepted holds no role (§12.1).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `credentials` | `id` (fingerprint; `legacy` *adoption*) | `kind` (`runner` — a machine key; `probe` — an instrument key; `courier` — a courier (R-BTN-171); `check-runner`; `legacy` *adoption*), `public_key` (an SSH public key or an API key's public line; unique; NULL only for `legacy`), `label`, `hostname` (machine and check-runner keys; unique among live ones), `token_id`, `expires_at`, `last_used_at`, `created_by`, `revoked_at` | Every key but owners', sync keys and administrators' (R-BTN-13, R-BTN-102, R-BTN-117, R-BTN-159) |
| `repository_owners` | `(repository_id, fingerprint)` | `public_key`, `added_by`, `added_at`, `removed_at` | Owner keys (R-BTN-58) |
| `runner_grants` | `(credential_id, repository_id)` | `capabilities` JSON (expanded), `max_tier`, `sync`, `granted_by`, `granted_at`, `accepted_at` (NULL while pending), `revoked_at` | What a machine key may do where (R-BTN-58, R-BTN-146) |
| `sync_keys` | `fingerprint` | `repository_id`, `role` (`sync`\|`mirror`), `public_key` (unique), `added_by`, `added_at`, `revoked_at` | Sync and mirror keys, one repository each (R-BTN-93) |
| `check_runners` | `(credential_id, repository_id)` | `capabilities` JSON (expanded), `max_tier`, `added_by`, `added_at`, `revoked_at` | Check-runner keys; the row stands in for a grant (R-BTN-114) |
| `couriers` | `(credential_id, repository_id)` | `delivers` (`git`\|`forge-check`), `added_by`, `added_at`, `revoked_at` | Couriers delivering outbox entries (R-BTN-171) |
| `registration_tokens` | `id` (of `brt_<id>_<secret>`) | `repository_id`, `secret_hash`, `role` (`runner`), `capabilities` JSON, `max_tier`, `uses_left` (1; ≤ 100), `grant_ttl_s`, `expires_at` (≤ 30 days), `created_by`, `created_at`, `revoked_at` | R-BTN-117, R-BTN-157 |
| `mcp_keys` | `(repository_id, name)` | `key_hash` (unique), `minted_by` (owner fingerprint), `actions` JSON (ids resolved at minting), `expires_at` (≤ 90 days), `last_used_at` (written ≤ once a minute), `revoked_at` | R-BTN-130 |
| `dashboard_sessions` | `id` (of `bds_<id>_<secret>`) | `secret_hash`, `role` (`administrator`\|`owner`), `key_fingerprint`, `repositories` JSON (an owner's: those its key owned at binding), `created_at`, `expires_at` (≤ 4 h), `revoked_at` | Valid while its key holds its role: an administrator's while the key is in the administrator set; an owner's on those `repositories` the key still owns (`repository_owners.removed_at` NULL), and ended when none remains (R-BTN-155) |
| `login_codes` | `id` (of the pending sign-in `bps_<id>_<secret>`) | `pending_hash`, `code_hash`, `role` (`administrator`\|`owner`, from `POST /v1/login`), `client_addr`, `key_fingerprint` (set when bound by that role's route), `created_at`, `expires_at` (+2 min), `bound_at`, `used_at` | R-BTN-155 |
| `action_confirmations` | `code_hash` | `session_id`, `action`, `params` JSON, `created_at`, `expires_at`, `used_at` | A session's action awaiting confirmation by the session's minting key, through `POST /v1/admin/confirm` or `POST /v1/owner/confirm` by its role (R-BTN-155) |
| `request_nonces` | `(key_fingerprint, nonce)` | `seen_at`; pruned after 11 minutes | Replay cache for every signed request (R-BTN-13) |
| `webhook_deliveries` | `delivery_id` | `received_at`; pruned after 24 h | R-BTN-73 |
| `webhook_syncs` | `repository_id` | `last_dispatch_at` — when the webhook path last sent the repository a sync (a delivery's own dispatch or the alarm's backstop); stale at `last_dispatch_at + 10 minutes`, when the alarm sends one | R-BTN-73 (B-89) |
| `write_budgets` | `(credential_id, repository_id, day)` | `writes` | Non-upkeep row writes per UTC day (R-BTN-149) |
| `observation_lapses` | `(repository_id, number)` | `credential_id`, `at` | Observation numbers a credential let lapse (R-BTN-150) |
| `open_world_bars` | `ticket_id` (qualified) | `until`, `credential_id` (whose claim set it) | A ticket barred from open-world claims by every key (R-BTN-148) |
| `tainted_branches` | `(ticket_id, branch)` | `claim_id`, `rule`, `at` | Branches written under a claim that failed an author gate (R-BTN-148) |

### 13.3 Runners

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `runners` | `id`; unique `(hostname, session_name)` among rows not of kind `legacy` | `hostname`, `session_name` (1–128), `credential_id`, `secret_hash`, `incarnation` (bumped by a re-key), `harness` (a label), `kind` (`vm`\|`local`\|`cloud`\|`legacy` *adoption*), `isolation` (`attached`\|`process`\|`session`), `profile_json` (opaque), `tier_ceilings` JSON `{repository: tier}`, `lease_timeout_ms` (15 min – 24 h), `settings_hash`, `first_seen_at`, `last_seen_at`, `last_activity_at`, `reaped_at` | One agent session; created at its first heartbeat, never deleted (R-BTN-3, R-BTN-9, R-BTN-14) |
| `runner_capabilities` | `(runner_id, capability)` | `declared` | Declared capabilities, expanded; a repository counts only those its grant admits |
| `runner_tags` | `(runner_id, tag)` | — | R-BTN-60 |
| `runner_courses` | `(runner_id, repository_id, course_id)` | `version` | What its checkouts can run (R-BTN-48) |
| `runner_instances` | `(runner_id, instance)` | — | Account instances it declares in `uses` (R-BTN-76) |
| `runner_reports` | `(runner_id, claim_id, key)`; `claim_id` 0 for none | `received_at`, `payload` (opaque) | Latest report per key, ≤ 200 per claim, kept `report_horizon_h` after the claim ends (R-BTN-99) |
| `runner_derived` | `(runner_id, repository_id, capability)` | `evaluated_at`; a `(runner_id, repository_id)` row of `runner_derived_inputs` holds `input_digest` and `limited` | Capabilities the repository's ontology derives from the runner's granted holdings, at most 256, current when the input digest matches (R-BTN-174) |
| `fleet_capabilities` | `(repository_id, capability)` | `runners` | Live granted runners declaring or deriving each capability (R-BTN-75) |

### 13.4 The board and tickets

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `board_snapshots` | `(repository_id, sha)` | `parent_sha`, `received_at`, `ticket_count`, `posted_by` | Accepted posts (R-BTN-11, R-BTN-102) |
| `board_head` | `repository_id` | `sha`, `observation`, `last_handed_out`, `observation_holder`, `observation_issued_at`, `observation_renewed_at`, `behind_since` (R-BTN-147), `fleet_version`, `stations_observation` (the latest accepted snapshot to post stations) | The head and the observation counter (R-BTN-62, R-BTN-150, R-BTN-99); a station row's reading (R-BTN-70) |
| `held_snapshots` | `(repository_id, sha)` | `parent_sha`, `head_sha`, `ticket_count`, `observation`, `posted_by` (≤ 4 held per credential), `received_at`, `auto_accept_at` (+24 h), `accepted_at` (set by acceptance; the next force post of the sha is adopted, R-BTN-11) | Rewritten history held for the owner (R-BTN-147) |
| `markers_seen` | `(repository_id, ref)` | `ticket_id`, `observation` | Marker refs already judged (R-BTN-46) |
| `tickets` | `id` | `repository_id` (home), `local_id` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), `course_id`, `course_json` (opaque), `path`, `title`, `display_json`, `tier`, `expedite`, `parent`, `repos` JSON, `rank`, `check_sha`, `check_head_repo_id`, `check_head_ref`, `snapshot_sha`, `row_hash`, `blocked_since`, `answer_lost` JSON, `outbox_id` (set on a provisional handler-ticket row until a snapshot posts the ticket), `baton_held` (a light question's handler until its promotion lands, and that handler's children until they close; no snapshot posts or drops them) | Filter fields of each live ticket; an accepted snapshot rewrites only rows whose `row_hash` changed (R-BTN-33, R-BTN-77, R-BTN-86, R-BTN-153, R-BTN-171, R-BTN-173) |
| `ticket_requires` | `(ticket_id, name)` | — | The ticket's `requires` clause, expanded to capabilities (R-BTN-120) |
| `ticket_depends` | `(ticket_id, leg, ref)`; `leg` `''` for every leg | `on_ticket`, `ref` (`<ticket>@at:<station>,…`, `@reached:…`, `@done` or `@withdrawn`) | Posted `depends_at` entries; index `ticket_dependents` on `on_ticket` (R-BTN-120, R-BTN-132) |
| `ticket_stations` | `ticket_id` | `station`, `path` JSON `[{leg, reached}]`, `path_len`, `to_end`, `next_leg`, `next_source` (`course`\|`marker`\|`inferred`\|`holder`\|`call`\|`choice`\|`timer`\|`retry`\|`cancel`\|`outbox`), `handoff_url`, `snapshot_sha` and `observation` (the snapshot that last changed the row; the latest to show it there is the greater of `observation` and the repository's `stations_observation`) | Where the ticket is, replayed from git, or settled by Baton until git confirms (R-BTN-39, R-BTN-70, R-BTN-83, R-BTN-165, R-BTN-171) |
| `ticket_next_legs` | `(ticket_id, leg)` | `state` (`ready`\|`waiting`), `waiting_on` (a label), `course_json` (opaque), `ready_since`, `waiting_since`, `not_before` | Legs leaving the station (R-BTN-83, R-BTN-89, R-BTN-166) |
| `ticket_bars` | `(ticket_id, leg, tag)` | — | Tags barred from a leg (R-BTN-60) |
| `ticket_decisions` | `(ticket_id, decision_id)` | `leg` (`''` for the ticket), `asks` (a person's leg's own, R-BTN-116), `url` | Posted decisions; each open one raises `hitl.decision` (R-BTN-78, R-BTN-163) |
| `closed_tickets` | `ticket_id` | `closed_as` (`done`\|`withdrawn`\|`dropped` — dropped with owner state to keep, neither done nor withdrawn), `final_station`, `final_path` JSON, `parent`, `observation`, `closed_at`, `purged_at`, `kept_json` (the ticket's `ticket_overrides` row and `leg_attempts`, kept past the purge) | What a snapshot reported closing or dropped; deleted if the ticket returns, after `kept_json` is restored (R-BTN-10, R-BTN-12, R-BTN-81, R-BTN-86) |
| `leg_queues` | `(repository_id, course_id, leg)` | `depth`, `max_queue` (the bound last judged; NULL until judged) | R-BTN-79 |
| `leg_queue_members` | `ticket_id` | `repository_id`, `course_id`, `leg` | The one queue each unheld ticket is counted in (R-BTN-79) |
| `unblocked_dispatch` | `repository_id` | `last_sent_at`, `pending_json` (≤ 100 entries and a `truncated` count), `due_at` | The unblocked trigger's coalescing window (R-BTN-77) |
| `pending_owner_state` | `(repository_id, ticket_id, kind, key)` | `kind` (`override`\|`condition`\|`timer`\|`outbox`), `key` (`''`, the condition id, the timer's `(leg, timer)` or the outbox id), `row_json` | Imported ticket-scoped rows awaiting their ticket's first snapshot (R-BTN-88) |

### 13.5 Claims and leg runs

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `claims` | `id` | `ticket_id`, `runner_id`, `request_id` (unique per `runner_id`), `nonce` (6 hex, public), `snapshot_sha`, `station`, `leg`, `start_path` JSON, `regressed_since`, `claim_observation`, `end_observation`, `claimed_at`, `status` (`active`\|`completed`\|`released`\|`reaped`), `ended_at`, `end_reason`, `end_detail`, `ended_at_sha`, `error_type`, `blocked_kind`, `blocked_ref`, `confirmed_at`, `superseded_at` (R-BTN-168), `fence_pending`, `fence_incarnation`, `fence_deadline` (R-BTN-19), `failed_attempt`, `resume_json`, `deadline_at` (the running leg's interrupting `start` timer, or its re-arm), `cancel_at`, `provisional`, `provisional_json` `{course, leg, sha, declared}` (R-BTN-148), `check_sha`, `advice_json` (the claim's `rationale`, opaque, ≤ 4 KB), `reap_after` *adoption* | The lease, kept forever. `status = 'active'` exactly when `ended_at` is NULL; `confirmed_at` only on `completed` (R-BTN-4, R-BTN-10, R-BTN-90, R-BTN-100, R-BTN-104, R-BTN-126, R-BTN-153) |
| `adoption_requests` | `(claim_id, runner_id)` | `requested_at`, `confirmed_at` | A runner's request to adopt a legacy claim; the confirmation names one request, and every other on the claim is refused when it moves (*adoption*, R-BTN-28) |
| `claim_legs` | `(claim_id, seq)` | `leg`, `from_station`, `to_station`, `next_leg`, `head_sha`, `bars` JSON, `session_url`, `leg_log_dir`, `started_at`, `finished_at`, `abandoned_at`, `evidence`, `route_choices_json` (the leg's resolved route choices), `taken_json` (the alternatives it reported taking) | The legs a claim started, on the holder's word (R-BTN-63, R-BTN-84, R-BTN-113, R-BTN-128, R-BTN-177) |
| `claim_bills` | `(claim_id, instance)` | `n` (seats) | The seats the running leg holds; rewritten at each advance, deleted at the end or reap (R-BTN-100, R-BTN-178) |
| `leg_outputs` | `(ticket_id, leg, run, name)` | `schema`, `uri` (≤ 1 KB), `digest`, `value_json` (≤ 4 KB, bounded schemas only), `course_version`, `leg_version`, `claim_id`, `source` (`holder`\|`sync`), `confirmed`, `recorded_at` | Output envelopes, by pointer or bounded inline value (R-BTN-82, R-BTN-108) |
| `leg_run_inputs` | `(claim_id, seq, name)` | `ticket_id`, `from_leg`, `from_run`, `uri`, `digest`, `value_json`, `leg_version` | What each leg run was given; replay reads it (R-BTN-82, R-BTN-84) |
| `transcripts` | `id`; unique `(runner_id, repo, path, claim_id)` | `runner_id`, `claim_id`, `repo`, `path`, `role` (`session`\|`subagent`), `activity_id`, `first_seen_at`, `last_pushed_at` | Archived transcript pointers (R-BTN-20) |
| `activities` | `(runner_id, id)`; unique `(runner_id, call_id)` | `claim_id` (NULL only before a claim), `parent_id`, `call_id`, `kind`, `seq`, `label`, `source` (`skill`\|`hook` — a harness hook), `started_at` (runner clock), `ended_at`, `outcome` (`succeeded`\|`failed`\|`cancelled`\|`abandoned`; set exactly when ended), `received_at`, `detail_json` | The runner's timeline (§9) |
| `attestations` | `id` | `repository_id`, `ticket_id`, `type`, `subject_json`, `value_json` (≤ 4 KB), `writer_class`, `writer_key`, `nonce`, `uses`, `lapses_at`, `signature`, `at`, `revoked_at`, `used_by_claim`, `superseded_by` | Signed typed facts legs require (R-BTN-181, proposal); never imported |
| `webauthn_credentials` | `(owner_key, credential_id)` | `cose_key`, `aaguid`, `attestation`, `registered_by_signature` | Attested authenticators a `human_only` key registered (R-BTN-185, proposal) |

Under §12.8 (proposal), `repositories` gains `landing`, `authorship` and `protected_paths`; grants gain `trust_level`, `trust_domain`, `model_family` and `role` (`runner` or `trusted-runner`); owner keys gain `human_only` and `fido_attestation`; the instance holds an attestation signing key, exported only as its public half.
| `ticket_history` | `id` | `repository_id`, `ticket_id`, `at`, `kind`, `claim_id`, `runner_id`, `leg`, `reached`, `next_leg`, `run`, `snapshot_sha`, `head_sha`, `course_version`, `leg_version`, `detail_json` (≤ 2 KB) | The ticket's running record, never replayed into state (R-BTN-81) |

`ticket_history.kind`: `leg-started`, `leg-finished`, `leg-abandoned`, `position-confirmed`,
`position-replaced`, `git-moved`, `regressed`, `re-routed`, `blocked`, `unblocked`,
`decision-opened`, `decision-answered`, `condition`, `choice-settled`, `call-settled`,
`superseded`, `outbox`, `answer-ignored`, `inputs`, `outputs`, `spawned`, `discrepancy` (its sub in `detail_json`, R-BTN-85).

### 13.6 Prerequisites, overrides, conditions and timers

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `ticket_blocks` | `(ticket_id, kind, ref, leg)`; `leg` `''` for the whole ticket | `repository_id`, `kind` (`ticket`\|`capability`\|`resource`\|`decision`\|`retry`\|`condition`\|`call`\|`attestation`), `ref`, `since`, `until`, `provisional` (the commit a runner-written row waits for), `found` (`before-start`\|`during-run`), `binds` (`gate`\|`advice`; set for `resource` and `attestation` rows from their requirement, R-BTN-181) | Each unmet prerequisite, maintained, never recomputed on read (R-BTN-75, R-BTN-120, R-BTN-126) |
| `leg_needs` | `(ticket_id, leg, resource)` | `repository_id`, `source` (`posted`\|`end`), `added_at`, `found_at` | Resources a next leg needs; an `end` need is never removed by a post (R-BTN-76, R-BTN-126) |
| `leg_attempts` | `(ticket_id, leg)` | `repository_id`, `attempts`, `first_attempt_at`, `retry_after`, `last_error_type` | Retry state per ticket and leg; reset when the leg reaches an outcome or a hold is lifted (R-BTN-122) |
| `ticket_overrides` | `ticket_id` | `expedite`, `hold`, `hold_reason` (`owner`\|`attempts-exhausted`\|`non-retryable:<class>`\|`budget-spent`\|`blocked-exhausted`\|`parked`\|`outbox-unlanded`\|`outbox-refused`\|`outbox-collision`\|`mcp:<name>`), `route_leg`, `route_station`, `override_kind` (`route`\|`choice`\|`timer`\|`retry`\|`cancel`\|`outbox`), `set_by`, `set_at` | Expedite and hold (§6); a queued-leg override held until the station changes — an owner's re-route (`route`), a choice or timer settlement, retry's `exhausted` leg (`retry`), a queued `baton.cancel` (`cancel`) or `baton.write` (`outbox`), these two until their write lands (R-BTN-12, R-BTN-83, R-BTN-122, R-BTN-166, R-BTN-167, R-BTN-168, R-BTN-171) |
| `owner_bars` | `id` | `repository_id`, `course` (an id or `*`), `tag`, `legs` JSON, `applies` (`claim`\|`claim+advance`), `starts_at`, `ends_at`, `release_holders`, `reason` (`^[a-z][a-z0-9-]{0,39}$`), `set_by`, `lifted_at` | R-BTN-67 |
| `conditions` | `id` | `repository_id`, `ticket_id` (NULL for a repository's), `ref` (what a core condition is about: a runner, an instance, `<course>:<leg>`, a decision id), `claim_id`, `leg`, `run`, `type`, `disposition` (`interrupt`\|`suspend`\|`notify`), `handler` (the handler ticket), `restarts` JSON, `default`, `severity` (`critical`\|`high`\|`normal`), `url`, `detail` JSON (a core condition's identifiers and numbers), `raised_at`, `closed_at`, `outcome`, `restart`, `answered_by` (a channel's opaque id, or an owner's credential), `light`, `question` (a light question's `std:git.file@1` pointer), `promoted_at`, `recorded` (an end of the consuming claim reported the answer written to git) | Raised conditions, filter fields only; indexed open by repository, and by `handler`; an open core condition is unique on `(repository_id, type, ticket_id, ref)` (R-BTN-160, R-BTN-162, R-BTN-163, R-BTN-173) |
| `condition_answers` | `(condition_id, channel, message_id)` | `restart`, `answered_by`, `claim_id` (the delivery leg's), `state` (`applied`\|`queued`\|`skipped`\|`ignored`), `outbox_id`, `at` | Every reply a delivery leg reported for a light question, filter fields only; a repeated report finds its row (R-BTN-173) |
| `ticket_timers` | `(ticket_id, leg, timer)`; `timer` the index in the leg's `timers`, or `after_s` for a choice leg's `after_s` | `repository_id`, `from` (`arrival`\|`ready`\|`start`\|`first_attempt`), `from_at`, `due_at`, `fired_at` | Armed timers and choice legs' time prerequisites; each fires once per `from_at`; renamed with their leg (R-BTN-64, R-BTN-166, R-BTN-167) |

### 13.7 Resources

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `external_resources` | `name` | `scope` (`runner`\|`host`\|`account`\|`service`), `detail_schema` (≤ 4 KB), `atoms_from` (`admin`\|`any`), `capacity` (seats per instance; NULL unlimited) | R-BTN-76, R-BTN-176, R-BTN-178 |
| `resource_instances` | `name` | `repositories` JSON (an `account` instance's), `capacity` (overrides the resource's) | Registered instances; `runner` and `host` instances are implicit (R-BTN-76, R-BTN-178) |
| `instance_serves` | `(instance, resource)` | — | What each instance serves, many to many (R-BTN-76) |
| `instance_readings` | `(instance, source, kind)` | `kind` (`state`\|`measure`), `available` (set exactly for `state`), `until`, `observed_at`, `lapses_at`, `detail`, `posted_by`; `source` `admin`, `runner:<id>` or `probe:<fp>` | Every instrument's latest reading and the administrator's (R-BTN-101, R-BTN-151) |
| `instance_states` | `instance` | `state` (`available`\|`unavailable`\|`unknown`), `until`, `changed_at` | Last evaluated state; a change is one `resource` event and one recount (R-BTN-76) |
| `route_last` | `(runner_id, repository_id, choice, alternative)` | `demoted`, `resolved_at` | Each alternative's demotion at the runner's last resolution of its route choice, read as `was_demoted` (R-BTN-177) |
| `resource_fleet` | `(repository_id, resource)` | `usable_runners`, `open_runners` | Blocked when usable > 0 and open = 0 (R-BTN-76) |

### 13.8 Events, messages and the outbox

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `events` | `seq` (the mirror's cursor) | `at`, `repository_id` (NULL for a tenant event), `kind`, `ticket_id`, `claim_id`, `actor`, `detail_json` | The append-only log the mirror and dashboard read |
| `messages` | `id` | `kind` (`release`\|`status_request`\|`status_report`\|`unblocked`\|`handled`\|`wind-down`), `payload_json`, `from_runner_id`, `from_principal`, `to_runner_id`, `in_reply_to`, `sent_at`, `delivered_at`, `acknowledged_at`, `status` (`pending`\|`delivered`\|`acknowledged`\|`expired`) | Messages to runners (§6, R-BTN-162, B-109) |
| `outbox` | `(repository_id, id)`; `id` increasing per repository | `ticket_id` (the handler ticket, the ticket to withdraw, or the check ticket), `kind` (`handler`\|`withdraw`\|`answer`\|`forge-check`), `condition_id` (a handler's or an answer's), `fields` JSON (identifiers only, and a `forge-check`'s `summary`; the courier renders the effect from them), `kid`, `signature`, `state` (`queued`\|`claimed`\|`delivered`\|`skipped`\|`confirmed`\|`dropped`), `credential_id` (the courier while `claimed`; for `forge-check`, the copy's courier), `attempts`, `not_before` (backoff, lease end, or deletion), `queued_at`, `delivered_ref` (a commit or a `check_id`), `confirmed_at`, `snapshots_since_delivered` | Every effect Baton intends outside itself, delivered by couriers (R-BTN-171, R-BTN-115, R-BTN-173) |

`events.kind`: `claimed`, `advanced`, `completed`, `confirmed`, `released`, `reaped`,
`fence-cleared`, `rekeyed`, `override`, `held`, `attempts-exhausted`, `leg-timeout`,
`snapshot-accepted`, `snapshot-rejected`, `advice-overridden`, `foreign-write`, `off-graph`,
`bars-mismatch`, `regressed`, `blocked`, `unblocked`, `resource`, `discrepancy`, `condition`,
`choice-settled`, `call-settled`, `superseded`, `course-closed`, `course-opened`, `capacity`,
`parent-invalid`, `not-before-invalid`, `asks-mismatch`, `reading-refused`, `invalid-pointer`,
`admin` (its act in `detail.action`), `frozen`, `unfrozen`, `sealed`, `imported`; *adoption:* `adopted`, `cutover`, `shadow-conflict`,
`foreign-claim`.

**Indexes that rules depend on.** `one_active_claim_per_ticket`; `one_active_claim_per_runner`;
`claims_unconfirmed` (completed, unconfirmed); claims by `(ticket_id, leg, ended_at)` for blocked
ends (R-BTN-126); `closed_unpurged`; `tickets_blocked`, `tickets_by_parent`, `tickets_by_rank`;
`requires_by_name`; `blocks_by_ref` `(repository_id, kind, ref)`; `ticket_dependents`;
`ticket_next_legs_due` (`not_before` where waiting on `time`); `needs_by_resource`;
`serves_by_resource`; `runner_instances_by_instance`; `claim_bills_by_instance`;
`readings_lapse`; `timers_due` (`due_at` where not fired); `outbox_due`
`(credential_id, state, not_before)` and `outbox_alarm` `(state, not_before)`; conditions open
by repository and by handler; `outbox_pending` `(repository_id, ticket_id, id)` where not `confirmed` or `dropped`; `history_by_ticket`; `events_by_repository` `(repository_id, seq)`.

**Where the alarm's instants live** (§2 owns what each does): `ticket_timers.due_at`;
`ticket_next_legs.not_before`; `ticket_blocks.until` of `retry` rows; `claims.deadline_at` and
`cancel_at`; `claims.ended_at` + 6 h of an unconfirmed completion (`baton.unconfirmed`); lease
expiry from `runners.last_seen_at` and `lease_timeout_ms`, for every runner but a `legacy` one,
whose claim ends only at `claims.reap_after` (*adoption*); `claims.fence_deadline`, and
`claims.ended_at` + 30 min of a fence still pending (`baton.fence-pending`); `messages.delivered_at` of an
unacknowledged `release` + 2 h (15 min for `leg-timeout`); `owner_bars.starts_at` and `ends_at`;
`instance_readings.lapses_at`; `outbox.not_before`; `unblocked_dispatch.due_at`;
`held_snapshots.auto_accept_at`; `repositories.sync_wanted_at` + 30 min (`baton.sync-late`);
`outbox.queued_at` + 24 h, or + 15 min for an undelivered `forge-check` (`baton.outbox-late`); and `closed_tickets.closed_at` + 90 days.

## 14. API *(proposal)*

Every route below is an action registry entry (R-BTN-129); the router, the CLI tree and the MCP
tools are generated from the registry, and `npm run check:actions` keeps the registry and this
table, with `BATON_MCP_OAUTH_SPEC` §13's rows until B-73 folds them in here, equal. Under `/v1`,
an unmatched request is `404 not-found`.

**Requests.** Bodies are JSON. A signed caller sends an RFC 9421 `Signature` and
`Signature-Input` by its SSH key (R-BTN-13), or its API key as `Authorization: Bearer`
(R-BTN-159); the principal table and who may hold which kind of key are §12's. A runner adds
`X-Runner-Secret` to every call after its first heartbeat (R-BTN-14), and every runner call
updates its `last_seen_at`. A destructive action takes `confirm: true` in its body, else
`confirm-required` (R-BTN-129). A dashboard session's actions that R-BTN-155 lists as confirmed answer
`202 {confirm_code}` and run when the session's minting key confirms the code (`POST
/v1/admin/confirm` or `POST /v1/owner/confirm`). Any route may
answer `rate-limited` or `quota` (R-BTN-135).

**Errors** are `{ok: false, code, message}`, with these codes:

| Code | Meaning |
|---|---|
| `unauthenticated` | no valid credential, or a bearer on a route its kind never reaches |
| `forbidden` | a valid credential without the power (§12) |
| `not-found` | no registry entry; an unknown, expired or bound sign-in code |
| `invalid-params` | a body or query that fails validation |
| `invalid-prerequisite` | a `blocked` end whose prerequisite fails the runner's checks (R-BTN-126) |
| `confirm-required` | a destructive action without `confirm: true` |
| `conflict` | a key already in another role or name (R-BTN-57, R-BTN-58); duplicate forge ids (R-BTN-138); a seal or import refused (R-BTN-88) |
| `rate-limited` | over a rate limit, with `retry_after_s` (R-BTN-135) |
| `quota` | a row-write, storage or per-claim cap (R-BTN-135, R-BTN-149, R-BTN-160) |
| `too-large` | an oversize body or item (R-BTN-130, R-BTN-149) |
| `session-taken`, `runner-reaped` | a heartbeat for a pair held by another secret; a reaped runner (§8) |
| `not-eligible` | a gate refused, with `rule` and `rule_code` (§6.6) |
| `blocked` | a prerequisite unmet (R-BTN-75) |
| `backing-off` | the leg is in retry backoff, with `until` (R-BTN-122) |
| `barred-tag` | a tag barred from the leg (R-BTN-60, R-BTN-67) |
| `stale-skills` | the runner's course version is below `min_runner_version` (R-BTN-65) |
| `no-eligible-ticket` | nothing to claim, with `refusals` for a `prefer` list (R-BTN-100) |
| `provisional` | a provisional claim the key may not take (R-BTN-104) |
| `not-holder`, `claim-ended` | not the claim's holder; a different end of an ended claim (§9) |
| `head-moved` | a board post whose `parent_sha` is not the head (R-BTN-11); a check claim's head changed (R-BTN-153) |
| `stale-observation`, `sync-busy` | an older observation; a number still outstanding (R-BTN-62, R-BTN-150) |
| `snapshot-rejected` | a board post that fails validation or ancestry (R-BTN-11, R-BTN-147) |
| `frozen` | a claim or owner write on a frozen Baton (R-BTN-88) |
| `sealed` | 503, retryable: any request but an administrator's read on a sealed Baton (R-BTN-88) |
| `unavailable` | 503, retryable: a CI key set the forge could not serve |
| `not-cut-over` | a claim before the repository's cutover (*adoption*, R-BTN-28) |

**Callers.** *machine*: a machine key with its runner secret; *machine alone*: a machine key with
no runner secret; *holder*: the claim's runner; *reader*: a key granted on the repository, an
owner of it, or an administrator; *owner*: an owner key of `{repository}`; *admin*: a key in the
administrator set; *session*: an administrator's or owner's dashboard session, same-origin JSON
(R-BTN-16), an owner's only on its repositories (R-BTN-155); *admin session*: an administrator's
dashboard session only; *sync*: the
repository's sync credential — a sync key, a CI identity token, or a machine key naming
`?repository=` (R-BTN-93, R-BTN-102); *mirror*: a mirror key or the mirror's CI identity;
*courier*: a courier key; *instrument*: an instrument key.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| **Runner** | | | | |
| `POST /v1/runner/heartbeat` | machine | `{hostname, session_name, secret_hash?, rekey?, harness, kind, isolation, capabilities[], tags[], profile, tier_ceilings?, lease_timeout_s?, courses: [{repository, course, version}], uses?: [<instance>], session_url?, last_activity_at?, leg_finished?: <seq>, fenced?: {claim_id, terminated: true}, transcripts?[], reports?: [{claim_id?, key?, payload}], test_harness?}` | `{runner_id, incarnation, lease_timeout_s, grant: {capabilities[]}, claim: {id, ticket_id, station, leg?, nonce, claimed_at, deadline_at?, cancel_at?, git: {station, path, path_len, regressed, next[]} \| {closed} \| "unknown"} \| null, messages[], handled?: [{condition_id, handler, outcome, output?}], bars[], stale_courses[], refused_uses?, pending_grants[], mode, server_time}` | R-BTN-3, R-BTN-9, R-BTN-14, R-BTN-60, R-BTN-90, R-BTN-146, R-BTN-162 |
| `POST /v1/runner/claim` | machine | `{request_id}` and at most one of `ticket_id` or `prefer: [{ticket_id, leg?, bills?}]` (≤ 50); `bills?: [{instance, n?}]`, `rationale?` (≤ 4 KB); for an unknown ticket `course`, `leg`, `sha`, `declared` | `{claim_id, ticket_id, course_id, course_version, station, legs, next[], path, nonce, snapshot_sha, base_sha, default_branch, handoff_url?, previous_attempts[] (newest 10), previous_attempts_total, resume?, rewrite_held?, check_sha?, check_head_ref?, tainted_branches[], leg_log?: {dir}, outbox?: [{id, kind, fields}], refused?}`; `course_id` the ticket's course and `course_version` the version the registry holds for it, both `null` for a claim with no course (B-103); refusals as the codes above | R-BTN-4, R-BTN-45, R-BTN-100, R-BTN-104, R-BTN-143, R-BTN-148, R-BTN-153, R-BTN-162, R-BTN-171, R-BTN-173 |
| `POST /v1/runner/claims/{id}/advance` | holder | `{reached?, leg, head_sha?, evidence?, outputs?: [{name, schema, uri?, digest?, value?}], bars?, bills?, taken?, exit_status?, session_url?}` | `{ok, station, next[], flags[], inputs: [{name, uri?, digest?, value?, from_leg, from_run, leg_version}], advice?, leg_log?: {dir}}` | R-BTN-63, R-BTN-64, R-BTN-82, R-BTN-108, R-BTN-153, R-BTN-177 |
| `POST /v1/runner/claims/{id}/end` | holder | `{end_reason, reached, next?, not_before?, spawned?, outputs?, detail?, ended_at_sha?, error?: {type, message?}, prerequisite?: {kind, ref}, reading?, commit?, answers?: [<condition_id>], taken?, exit_status?, session_url?}` | `{ok: true}` | §9, R-BTN-83, R-BTN-86, R-BTN-126, R-BTN-173, R-BTN-177 |
| `POST /v1/runner/claims/{id}/conditions` | holder | `{type, disposition, handler?, restarts, default?, severity?, url?, light?, question?}` | `{condition_id, handler_id?}`; `quota` past 20 open on the claim or 200 a day on the ticket; `invalid-params` for `baton`, `baton.*` or `hitl.decision` | R-BTN-160, R-BTN-173 |
| `POST /v1/runner/claims/{id}/answers` | holder of a delivery leg of the condition's handler | `{condition_id, channel, message_id, restart, answered_by}` | `{state: "applied" \| "queued" \| "ignored"}`, the same for a repeat; `invalid-params` for a restart not offered | R-BTN-173 |
| `POST /v1/runner/messages/{id}/ack` | machine | `{reply?: {text}}` | `{ok: true}` | §6 |
| `POST /v1/runner/activities` | machine | `{activities: [{id, claim_id, parent_id?, kind, seq?, label?, source, started_at, ended_at?, outcome?, detail?}]}` | `{ok, refused: [{id, code}]}` | §9 |
| `POST /v1/runner/readings` | machine | `{readings: [{instance, kind: "state" \| "measure", available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}], overridden: [<instance>]}` | R-BTN-76, R-BTN-101, R-BTN-151 |
| `GET /v1/runner/recommendations` | machine | `?limit=` (10), `?all=1` (≤ 500) | `{recommendations: [{ticket_id, station, legs, flags[], course, handoff_url?}], truncated?}` | R-BTN-45, R-BTN-61, R-BTN-99 |
| `GET /v1/runner/next` | machine | — | the first recommendation, or `no-eligible-ticket` | R-BTN-45 |
| `GET /v1/runner/fleet` | machine alone | `?repository=`; `If-None-Match` | the fleet view, `ETag`; `304` unchanged | R-BTN-99, R-BTN-152 |
| `GET /v1/runner/instances` | machine alone | `If-None-Match` | the instance view, `ETag`; `304` unchanged | R-BTN-99 |
| `GET /v1/runner/launch-candidates` | machine alone | — | per granted repository, the legs that pass every gate no runner decides, in Baton's order | R-BTN-99 |
| `GET /v1/runner/tickets/{ticket}/holder` | machine, or machine alone | `?session_name=` with the runner secret, when the caller has them | `{held_by_other, fence_pending}` | R-BTN-7 |
| `GET /v1/runner/branch-holder` | machine, or machine alone | `?repo=<forge path>&branch=`, and `session_name` with the runner secret when the caller has them; key alone counts every active claim as another's (§9.2) | `{tickets[], held_by_other, fence_pending}`, granted repositories' tickets only | R-BTN-7, R-BTN-141 |
| `GET /v1/runner/push` | machine | `?session_name=`; WebSocket upgrade, authenticated as a heartbeat | `101`, then `{ring: [<kind>]}` frames and `pong`; a heartbeat refusal instead of the upgrade | R-BTN-91 |
| `POST /v1/runner/grants/{repository}/accept`, `…/decline` | machine alone | accept: `{confirm_span?}` | `{ok, span}`; an acceptance that raises the span without `confirm_span` is `conflict` listing the repositories that would lose sync | R-BTN-146 |
| `GET /v1/runner/mode` | machine | `?repository=` | `{mode: "shadow" \| "cut-over", cutover_at?}` | *adoption*, R-BTN-28 |
| `POST /v1/runner/adopt` | machine | `{ticket_id}` | `{pending: true}` (an `adoption_requests` row) until an administrator confirms this runner's request, then `{claim_id, nonce, station, path, next}`; `forbidden` once another runner's request is confirmed | *adoption*, R-BTN-28 |
| `POST /v1/runner/shadow-report` | machine | `{transition: "claim" \| "set", ticket_id, status, nonce, at}` | `{ok}`, or a logged `shadow-conflict` | *adoption*, R-BTN-28 |
| **Repository reads** | | | | |
| `GET /v1/repositories/{repository}/tickets/{ticket}/blocks` | reader | `?runner=me` | `{blocked, blocks: [{kind, leg?, ref, since, until?}], other: [{kind, detail}]}` | R-BTN-75 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/prerequisites` | machine granted there, owner, session | `?leg=` (the queued leg), `?runner=me` | `{leg, ready, prerequisites: [{kind, ref, met, why, since?, until?, url?, found?}]}` | R-BTN-120 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/history` | reader | `?before=<id>&limit=` (≤ 200) | `{rows: [{id, at, kind, claim_id?, leg?, run?, reached?, next_leg?, snapshot_sha?, course_version?, leg_version?, detail, inputs?}], next_before?}` | R-BTN-81, R-BTN-84 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/children` | reader | — | `{children: [{ticket_id, station, blocked, closed?}]}` | R-BTN-86 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/legs/{leg}/runs` | owner, admin | — | `{runs: [{run, claim, runner, mode, started_at, ended_at?, end?, session_url?, log_dir?, transcripts: [{repo, path, pushed_at}]}]}` | R-BTN-128, R-BTN-144 |
| `GET /v1/repositories/{repository}/blocked` | reader | `?on=<kind>:<ref or *>&transitive=1?`, or `?cursor=` | `{tickets: [{ticket_id, blocks}]}`; with no `on`, blocked tickets grouped by kind and `ref`, 100 a page, `next_cursor` | R-BTN-75, R-BTN-79 |
| `GET /v1/repositories/{repository}/conditions` | reader | `?open=1`, `?person=1`, `?type=<prefix>`, `?ticket=`, `?cursor=` | `{conditions: [{condition_id, ticket?, leg?, type, disposition, handler?, restarts, default?, severity, url?, detail?, raised_at, closed_at?, outcome?}], next_cursor?}`, 100 a page | R-BTN-163 |
| `GET /v1/repositories/{repository}/board` | owner, runner granted there, admin | — | `{repository, ready[], ready_by_tier, granted_capabilities: string[] \| null, server_time}` (R-BTN-179) | R-BTN-179 |
| `GET /v1/repositories/{repository}/courses` | reader | — | each course file as last accepted, with its capability types and roles | R-BTN-121, R-BTN-157 |
| `GET /v1/repositories/{repository}/stats` | reader | `?since=` | per station and leg, wait and run times; ends by reason and detail; suspensions; advice overridden; `off-graph`; foreign writes — aggregates and ids only | §5 |
| **Owner** | | | | |
| `POST /v1/owner/{repository}/tickets/{ticket}/resolve` | owner | `{restart, condition_id?}` — `condition_id` required when the ticket has more than one open condition taking a restart | `{ok: true}`; `invalid-params` for a restart the condition does not offer | R-BTN-163 |
| `POST /v1/owner/{repository}/tickets/{ticket}/route` | owner | `{leg}` or `{clear: true}` | `{ok: true}` | R-BTN-83 |
| `POST /v1/owner/{repository}/tickets/{ticket}/release` | owner | `{reason: "requested", confirm: true}` | `{ok: true}` | R-BTN-119 |
| `POST /v1/repositories/{repository}/attestations` | an owner key or session, a `human_only` key, or a `service` key (R-BTN-181) | a signed attestation: `{type, subject, value, writer, nonce, uses, lapses_at?, signature}` | `{id}` | R-BTN-181 (proposal) |
| `DELETE /v1/repositories/{repository}/attestations/{id}` | its writer; for a `human` type, a `human_only` key | `{confirm: true}` | `{ok: true}` | R-BTN-181, R-BTN-185 (proposal) |
| `POST /v1/owner/{repository}/overrides/{ticket}` | owner; an MCP key `{hold: true}` only | `{expedite}`, `{hold}` or `{cancel: true, confirm: true}` | `{ok: true}` | §6, R-BTN-154 |
| `POST /v1/owner/{repository}/claims/{id}/deadline` | owner | `{extend_to}` or `{cancel_at}` (≤ 7 days ahead, or `null`) | `{ok, deadline_at, cancel_at}`; `claim-ended`, `invalid-params` | R-BTN-90 |
| `POST /v1/owner/{repository}/grants` | owner | `{public_key, hostname?, label?, capabilities[], max_tier?, confirm_span?}`, or `{name, api_key: true, capabilities[], max_tier?}` | `{ok, pending: true}`; `{api_key}` once for the second form; `conflict` | R-BTN-58, R-BTN-117, R-BTN-146 |
| `POST /v1/owner/{repository}/grants/{fingerprint}/revoke` | owner | `{confirm: true}` | `{ok: true}` | R-BTN-58 |
| `GET /v1/owner/{repository}/grants` | owner | — | `{repository, owners[], grants: [{credential_id, hostname, label, repository_id, capabilities, max_tier, granted_by, granted_at, other_repositories[]}], settings, bars[], server_time}` — the dashboard's `limits` over one repository (R-BTN-179); the accept-and-decline plan's own rows are R-BTN-146's | R-BTN-146, R-BTN-179 |
| `PUT /v1/owner/{repository}/grants/{fingerprint}/flags` | owner | `{sync}` | `{ok: true}` | R-BTN-146 |
| `POST /v1/owner/{repository}/owners` | owner | `{public_key}` to add; `{fingerprint, remove: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-58 |
| `POST /v1/owner/{repository}/bars` | owner | `{course, tag, legs?, applies, starts_at?, ends_at?, release_holders?, reason}` | `{id}` | R-BTN-67 |
| `POST /v1/owner/{repository}/bars/{id}/lift` | owner | — | `{ok: true}` | R-BTN-67 |
| `POST /v1/owner/{repository}/bars/follow` | owner | `{course}` | `{ok: true}` | R-BTN-142 |
| `PUT /v1/owner/{repository}/settings` | owner | any owner setting (§13.1); `code_repos` as `[{path}]` | `{ok: true}` | R-BTN-66, R-BTN-140 |
| `POST /v1/owner/login-links` | an owner key of any repository | `{code}` | `{ok: true}`; `not-found` for any code but an unbound owner row's | R-BTN-155 |
| `POST /v1/owner/confirm` | the owner key that minted the session | `{code, dry_run?}` | performs the action; with `dry_run`, `{action, target}`; `not-found` for another session's code | R-BTN-155 |
| `POST /v1/owner/sessions/revoke` | an owner key | `{confirm: true}` | `{ok: true}`; ends every session the key minted | R-BTN-155 |
| `POST /v1/owner/{repository}/code-repo-consents` | owner of `{repository}` | `{repository: <home listing it>, confirm: true}` or `{repository, withdraw: true}` | `{ok: true}` | R-BTN-140 |
| `POST /v1/owner/{repository}/sync-keys`, `…/sync-keys/{fingerprint}/revoke` | owner | `{public_key, role: "sync" \| "mirror"}`; revoke `{confirm: true}` | `{ok: true}`; `conflict` | R-BTN-93 |
| `POST /v1/owner/{repository}/sync-want` | owner | — | `{ok: true}` | R-BTN-105 |
| `POST /v1/owner/{repository}/tokens`, `…/tokens/{id}/revoke` | owner | `{role: "runner", capabilities?, max_tier?, ttl_s?, uses?, grant_ttl_s?}`; revoke `{confirm: true}` | `{id, token}`, the token once; revoking revokes every credential it registered | R-BTN-117, R-BTN-157 |
| `POST /v1/owner/{repository}/mcp-keys`, `…/mcp-keys/{name}/revoke` | owner | `{name, actions, ttl}`; revoke `{confirm: true}` | the key once; `{ok: true}` | R-BTN-130 |
| `POST /v1/owner/{repository}/couriers` | owner | `{public_key, delivers: "git" \| "forge-check"}`; `{fingerprint, revoke: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-171 |
| `POST /v1/owner/{repository}/check-runners`, `…/check-runners/{fingerprint}/revoke` | owner | `{public_key, name, capabilities?, max_tier?}`; revoke `{confirm: true}` | `{ok: true}` | R-BTN-114 |
| **Sync and forges** | | | | |
| `POST /v1/sync/observation` | sync | `{renew?}`, or `{release, behind?}` | `{sha, observation, bars, provisional, held, behind_confirmed, trusted_identities, code_repos, tainted_branches}`; a release `{ok: true}` | R-BTN-11, R-BTN-62, R-BTN-104, R-BTN-147, R-BTN-139, R-BTN-140, R-BTN-148, R-BTN-150 |
| `POST /v1/sync/board` | sync | the board post (§4) | `{ok: true}` | R-BTN-11, R-BTN-147, R-BTN-149 |
| `POST /v1/sync/want` | sync | — | `{ok: true}` | R-BTN-94 |
| `GET /v1/sync/wanted` | sync, mirror | — | `{wanted, since?, head_sha}` for the credential's role; changes nothing but its nonce | R-BTN-94, R-BTN-105 |
| `GET /v1/sync/events` | mirror | `?after=<seq>`, which acknowledges up to the lesser of `after` and the last `seq` a read returned to the mirror | `{events[], next}` | §16 |
| `POST /v1/github/webhook` | the GitHub App, by `X-Hub-Signature-256` | a delivery | `204`; repeats and the sync's and mirror's own events ignored | R-BTN-73 |
| `POST /v1/forges/{repository}/notify` | a GitLab or Gitea notification, verified against `BATON_FORGE_SECRETS` | the notification | `204`; records a want | R-BTN-95 |
| **Couriers and instruments** | | | | |
| `POST /v1/courier/entries/claim` | a key the repository's `outbox_policy` admits (R-BTN-171) | `{limit?, release}` (≤ 50) | `{entries: [{repository, id, kind, ticket, fields, kid, signature}]}` of the kinds it delivers, each leased 10 minutes; a ticket's git entries together, in `id` order | R-BTN-171, R-BTN-115, R-BTN-136 |
| `POST /v1/courier/entries/{repository}/{id}` | the entry's claimer | `{state: "delivered", ref}`, `{state: "skipped"}` or `{state: "failed", reason: "transient" \| "refused" \| "collision"}` | `{ok: true}`; `forbidden` for another courier's entry | R-BTN-171 |
| `POST /v1/probe/readings` | instrument | `{readings: [{instance, kind, available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}]}` | R-BTN-101 |
| **Administrator** | | | | |
| `GET /v1/admin/repositories` | admin | — | `{repositories: [<`/v1/ui/state`'s repository row: id, github, forge, web_base, default_branch, weight, head, mode, courses>], seed_owners?: [repository id]}` — `seed_owners` present only when some unretired repository's live owners are all `admin:seed`'s or it has no live owner, naming them (B-91, R-BTN-58) (R-BTN-179) | R-BTN-179 |
| `POST /v1/admin/repositories` | admin | register `{id, github, forge, remote, web_base?, ci_identity?, dispatch?, sync_keys?, default_branch, sync_workflow?, mirror_workflow?, mirror_pusher?, weight?, tiers?, cut_over?, owner_keys[], forge_repo_id, forge_owner_id, trigger_workflows?}`; change `{id, …, github?, forge_repo_id?, forge_owner_id?, sync_keys_add?, sync_keys_remove?, owner_keys_add?, former_paths_remove?, code_repo_consents_add?, confirm?}` (never `forge`); `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-47, R-BTN-92, R-BTN-93, R-BTN-138 |
| `POST /v1/admin/grants` | admin | a grant, or a key's hostname | `{ok, pending: true}` | R-BTN-57, R-BTN-58, R-BTN-146 |
| `POST /v1/admin/keys/{fingerprint}/revoke` | admin | `{confirm: true}` | `{ok: true}`; the key stops at its next call, an owner key on every repository; `invalid-params` for an administrator's key | R-BTN-57 |
| `POST /v1/admin/probes` | admin | `{public_key, label}` | `{ok: true}` | R-BTN-101 |
| `POST /v1/admin/resources` | admin | `{name, scope, detail_schema, atoms_from?, capacity?}` | `{ok: true}` | R-BTN-76, R-BTN-176, R-BTN-178 |
| `POST /v1/admin/instances` | admin | `{name, serves[], repositories[], capacity?}`, re-posted to change | `{ok: true}` | R-BTN-76 |
| `POST /v1/admin/readings` | admin | a reading, in force ≤ 7 days; or `{instance, clear: {source?}}` | `{ok: true}` | R-BTN-76, R-BTN-151 |
| `PUT /v1/admin/settings` | admin | `{link_hosts?, session_hosts?}` | `{ok: true}` | R-BTN-112, R-BTN-113 |
| `POST /v1/admin/login-links` | admin | `{code}` | `{ok: true}`; `not-found` for any code but an unbound administrator row's | R-BTN-155 |
| `POST /v1/admin/confirm` | the administrator key that minted the session | `{code, dry_run?}` | performs the action; with `dry_run`, `{action, target}`; `not-found` for another session's code | R-BTN-155 |
| `POST /v1/admin/sessions/revoke` | admin | `{all: true, confirm: true}` | `{ok: true}` | R-BTN-155 |
| `POST /v1/admin/freeze`, `…/unfreeze`, `…/seal` | admin | — | `{ok: true}`; seal `conflict` naming active claims and lagging mirrors | R-BTN-88 |
| `GET /v1/admin/state` | admin | — | what `GET /v1/ui/state` answers an administrator's session, from the same state | R-BTN-57 |
| `GET /v1/admin/export` | admin | `?with_history=1` | `baton.owner-state/v1` | R-BTN-88 |
| `POST /v1/admin/import` | admin | an export | `{ok: true}`; `conflict`, `invalid-params` | R-BTN-88, R-BTN-158 |
| **Dashboard** | | | | |
| `POST /v1/login` | none; the pending cookie | `{role: "administrator" \| "owner"}`, then `{poll: true}` | `{code}` and the pending cookie; `{pending: true}` until bound; then the session cookie | R-BTN-155 |
| `POST /v1/ui/logout` | session | — | `{ok: true}` | R-BTN-155 |
| `GET /v1/ui/state` | session | — | everything the dashboard draws; for an owner's session, its repositories' only | §11 |
| `POST /v1/ui/messages` | session | `{to_runner_id, kind: "release" \| "status_request" \| "wind-down", payload}`; Stop is `{kind: "release", payload: {ticket_id, reason: "requested"}}`; Wind down is `{kind: "wind-down"}` (B-109) | `{id}`; `forbidden` for a `release` whose ticket `to_runner_id` does not hold, or for an owner's session, a runner holding no claim of its repositories; any other kind `invalid-params` | §6, R-BTN-119 |
| `POST /v1/ui/conditions/{condition}/resolve` | session | `{restart}` | `{ok: true}`, in one step; `invalid-params` for a restart the condition does not offer | R-BTN-163 |
| `POST /v1/ui/overrides/{ticket}` | session | `{expedite}`, `{hold}` or `{cancel: true, confirm: true}` | `{ok: true}`; `hold: false` and `expedite` answer `202 {confirm_code}` | §6, R-BTN-155 |
| `POST /v1/ui/claims/{id}/reap` | admin session | `{confirm: true}` | `202 {confirm_code}` | §9, R-BTN-155 |
| `POST /v1/ui/claims/{id}/confirm`, `…/release` | admin session | `{}` | `202 {confirm_code}` | R-BTN-10, R-BTN-155 |
| `POST /v1/ui/board/accept` | admin session | `{repository, sha}` | `202 {confirm_code}` | R-BTN-147, R-BTN-155 |
| `POST /v1/ui/resync` | session | `{repository}` | `{ok: true}`; dispatches the sync | R-BTN-35 |
| `POST /v1/ui/cutover` | admin session | `{repository, confirm: true}` | `202 {confirm_code}` | *adoption*, R-BTN-28 |
| `POST /v1/ui/adoptions/{claim}/confirm` | admin session | `{runner_id}` (the requesting runner, shown with its hostname and session name) | `202 {confirm_code}` | *adoption*, R-BTN-28 |
| **Other** | | | | |
| `POST /v1/register` | `Authorization: Baton-Token <token>` | `{name, public_key}` or `{name, api_key: true}` | `{credential_id, grant}`, and `{api_key}` once for the second form; `forbidden` beyond the token's scope; `unauthenticated` for a spent, expired or revoked token; `conflict` | R-BTN-117 |
| `GET /v1/keys/signing` | none | — | `{keys: [{kid, alg: "Ed25519", public_key, retired_at?}]}` | R-BTN-114, R-BTN-136 |
| `GET /v1/actions` | any credential | — | the caller's registry entries, with `input` schemas | R-BTN-129 |
| `POST /v1/mcp` | an MCP key, as a bearer | JSON-RPC `initialize`, `ping`, `tools/list`, `tools/call` | streamable HTTP, JSON only; `GET` answers `405` | R-BTN-130 |

**Couriers drain the outbox** (R-BTN-171) through the two `/v1/courier/entries` routes above,
never through a runner's claim.

## 15. Verification: the model, the harness, scenarios and gates *(partly built — B-50)*

- **R-BTN-29 (the harness).** `test/integration/` runs the real Worker and Durable Object locally
  (Cloudflare's Vitest pool for Workers) on a fake clock the test advances: R-BTN-32's injected
  clock, plus a `clock-offset` file the test sidecars honour (G-BTN-38). It drives:
  - a local bare git repository per home, with fixture tickets, so the sync, the mirror and the
    CLI run as plain Node on real history;
  - simulated runners: the real runner, sidecar, harness hooks and activity reporter under a
    scripted fake harness that can be paused, killed and resumed, so fencing, spools and
    process-group kills run for real. Sleep is `SIGSTOP` on harness and sidecar, a clock jump,
    then `SIGCONT`;
  - stub reviewer agents, fake OIDC tokens signed by a test key, and test keys of every
    R-BTN-13 type, trusted only by the test bindings in `vitest.config.ts` and never by a
    deployed Worker, `baton-staging` included;
  - fixture courses: docs' `roadmap-pr` where a scenario needs a course's logic, and the toy
    course `chore` (S-BTN-28).
- **Where it runs.** `npm test` (alias `npm run test:baton`) on every PR and nightly on `main`;
  docs runs the same suite from a sibling checkout when its Baton client files change.
  `baton-staging` (its own Worker, hostname, secrets and tenant, R-BTN-135) runs S-BTN-1, -2
  and -12 against each deploy with real OIDC, signed requests and real time, short timeouts
  standing in for clock jumps.
- **The load test.** `npm run test:load` drives R-BTN-87's envelope mix — runners
  heartbeating, claiming, advancing and ending; syncs posting boards of up to 5,000 tickets for
  20 repositories; dashboard reads; bursts — over 1,000,000 seeded history rows. It runs on the
  local host in CI, and against `baton-staging` before cutover, seeded by a synthetic
  `--with-history` export, with driver-generated keys an administrator registers and one real
  staging repository's sync posting a generated 5,000-ticket board. It fails on any error or any
  route over its latency budget, and reports the figures it reached (G-BTN-77).
- **R-BTN-30 (scenarios are named and required).** A scenario is `S-BTN-<n>` with a fixed script
  and assertions; its test file is named for it. The table below is the set, and every scenario
  passes on the hosts it runs on (G-BTN-37). A gate `G-BTN-<n>` is an invariant the
  implementation must establish, proved by the scenarios or tests its row names.
- **R-BTN-31 (scenarios are part of drafting).** Every ticket that changes Baton's behaviour
  names, under **Tests**, the scenarios it adds or makes pass; a new scenario takes the next
  number and a row here in the same change, and the ticket's exit criteria require `npm test`
  green with it. A behaviour change without a scenario is incomplete.
- **R-BTN-68 (the core is a checked model).**
  - The core's state machine — claims, fencing, stations and legs, observations, ends and their
    confirmation, bars and gates — is a Quint model (`model/baton.qnt`), with the sync's output
    nondeterministic within its contract, so its properties hold for every course.
  - Safety: one live holder per ticket; no end confirmed by an earlier observation;
    observations only increase; a claim goes stale only when git takes the ticket back; every
    gate holds at claim and advance. Liveness: every end is confirmed or flagged; every fence
    clears; a ready leg with an eligible idle runner is eventually taken.
  - Every scenario's event log is checked against the model. A change to a requirement the
    model cites changes the model in the same PR.
  - Hosted CI runs no Quint; CI and the deploy check only the `@impl`/`@model` links
    (`npm run model:links`). A PR that changes what the checks read — the model, the core and
    what it imports, replay and its helpers, the scenarios and their hosts, the trace check, the
    Quint version — carries `npm run model:pr`'s report for its head (typecheck and regression
    runs, 200 model-drawn traces driving the core, every scenario trace checked); the CI job
    `model-report` fails until a passing report naming the head is in the PR body.
  - `npm run model:full` (simulation, witnesses, 1,000 traces, the proof, the scenario traces)
    runs weekly on `main`'s head as the Baton series "Weekly model check" (B-50, R-BTN-89) on
    any runner granted on baton; each run appends its report to its ticket file, and a failure
    is filed as a ticket. Until B-50 is built the owner runs it by hand.
  - A green model and trace check is a cutover precondition (R-BTN-28).

### Scenarios

W*n* are runners. Fixture repositories: `docs` (GitHub), `ops`, `plain` (forge `git`), `lab`
(GitLab), `tea` (Gitea). "Raised" means a `baton.<sub>` condition (R-BTN-163).

| Scenario | Sets up | Expects |
|---|---|---|
| **§1** | | |
| S-BTN-18 git wins | a suspension at `reviewed` whose review never posted; a peer's review with a marker Baton never saw | the suspension stays unconfirmed and flagged at 6 h; the peer's review moves the ticket at the next snapshot |
| S-BTN-24 advice, not gates | claims of a fifth-ranked ticket, of a leg with a fleet `resource` block, of a ticket above tier, of a barred line | first two accepted, the second recording `advice-overridden`; then `not-eligible`, `barred-tag`; a leg whose `requires.resources` entry binds `gate` refused `blocked` under the same fleet block |
| S-BTN-25 two runners on one ticket | W2 pushes to W1's branch and posts markers under its own nonce and with none; W1 then writes a later leg's marker under its own nonce without advancing into it, and suspends | nothing refused; `foreign-write` logged and raised; no commit checked; W1's next `advance` reports the moved branch; `baton.station-jump` raised on the CI sync's post and the suspension left unconfirmed |
| S-BTN-28 a course with no reviews | toy course `chore` (three stations, `do`, `verify`, `redo` with `max_runs: 2`) runs S-BTN-1, -2, -5, -12, -17, -18, -24, -33, -34, -36, -37 | all pass with no Baton change; `src/` passes the boundary test |
| S-BTN-34 progress is not staleness | W1 advances before any sync and waits on CI; W2's ticket is superseded; a third claim's path goes backwards | W1 stays active; W2 ends `stale-board`; the third shows `git.regressed`, stays active, raised after 30 min |
| S-BTN-39 limits agents cannot change | owner bars, a required bar, a retry policy, a `max_tier`; an agent commits files dropping bars and backoff and re-tiers a ticket; a held, attempts-exhausted ticket in backoff withdrawn in git and reopened, then dropped and re-added; a copy filed under a new id | bars and retry stay the owner's; legs missing a required bar wait on `policy`, raised; the git tier applies, shown with its commit; the hold, attempts and backoff restored each time, the drop raising `baton.ticket-dropped`; the copy unheld, and the old id listed closed with its hold |
| S-BTN-57 ranking on the runner | a course ships `rank.mjs`; W1, W2 share an instance; claims with `prefer`; W4's course version lacks `rank.mjs` | default order from Baton, ranking on the runner; `prefer` takes the first passing entry or lists each refusal; `rationale` recorded; W4 `stale-skills`; a `measure` sets no state; no repository code in Baton |
| **§2** | | |
| S-BTN-31 both hosts | the full set on Cloudflare; S-BTN-1, -2, -12, -17, -30, -33, -34 also locally | each passes on its hosts; a sync token for another Baton's audience is refused |
| S-BTN-111 tenants share nothing | two local hosts; one's signed request, API key, MCP key and session presented to the other; a foreign URL host | `unauthenticated` (`@authority`), each refused as a random one; `404`; the second host unchanged |
| S-BTN-112 one origin per runner and key | a ticket naming another origin; one key started for two origins; `runner register` with no origin | refused naming both origins; exit 2; exit 2 sending nothing |
| S-BTN-114 refusals clients handle | every route answers `rate-limited`, `quota`, `too-large`; endless heartbeat refusals; signature and API-key floods; ringing viewers | retry after `retry_after_s` with fresh signatures; one-shots exit non-zero; lease lost at `timeout − 4 min`; floods refused in the Worker while the runner's calls verify; rings cost ≤ one heartbeat per 10 s |
| S-BTN-122 caps, observations, readings | oversize post, fifth-generation child, exponential pattern, 65th session, repeated `leg_finished`, far `extend_to`; a ticket with 25 markers; competing observation numbers; a post under another credential's number; two runs that post nothing; heartbeats flipping declarations past the budget; 9 measuring sessions; bad bills | `too-large`, `parent-invalid`, schema error, `quota`, one re-arm, `invalid-params`; the newest 20 posted, `markers_truncated`; numbers taken over after `sync-busy`; `stale-observation`; released, no bar; leases kept, declarations dropped; 8 measures kept and clearable; bills refused; CI and sync key never void each other |
| **§3** | | |
| S-BTN-26 two repositories, two courses | `ops` (weight 50, course `runbook`) beside `docs`, both with `T-1`; W1 declares one course, W2 both; a CLI runner on one checkout declaring two courses | distinct tickets; W1 never offered `ops`; `docs` first, each in default order, per-group limit; tokens per repository; a shared branch blocks pushes while either is held; `min_runner_version` gates W2; the runner declares both courses, claims a leg of either in consecutive claims, loads each from the claim's `course_id` and snapshot, and `--course` narrows it to one (B-103) |
| S-BTN-42 webhooks | a review delivery, its repeat, a forgery, a 10-delivery burst, Baton's own events, extra fields | one dispatch, then one trailing after 30 s; repeat, forgery and own events dispatch nothing; only R-BTN-73's fields read |
| S-BTN-171 a dependency cycle is refused | a board post whose live tickets depend on each other in a loop; two of them; a self-dependency; a diamond; a post closing the very ticket it depends on | `invalid-params`, naming `B-1 → B-2 → B-1` once, and nothing of the post stored: no head, no ticket; `B-1 → B-1` alike; the diamond and the closed edge accepted |
| S-BTN-172 the ticket check | `baton tickets check` on a clean repository, on one whose tickets loop, on one with no `.baton/baton.json`, and on this repository's own `tickets/` | exit 0 with the count, `✓ no findings`; exit 1 with one `path: message` line (the loop at its first ticket's file) and the count; the CLI's error, exit 2; this repository passes, which CI's `npm run check:tickets` runs |
| S-BTN-54 a Baton without GitHub | `plain` with a `post-receive` running `baton repo sync --defaults-only` on the `branch` course; `Baton-Verdict:` trailers, one without `Baton-Claim`; `--if-wanted` cron | the ticket moves to `merged` on push syncs alone; the unclaimed verdict counts and logs `foreign-write`; `wanted` holds until a later-numbered post; no forge credential or link |
| S-BTN-55 the sync key | a sync key posts; it is registered for a second repository; machine (sync off), mirror and revoked keys post; a replay | accepted; `conflict`; `forbidden`; `unauthenticated` |
| S-BTN-56 other forges, edges of a want | `lab` and `tea` notifications, good and bad; `#mirror` vs `#sync` tokens; a dispatch answering 500; near-miss URLs; `--defaults-only` with a `sync.mjs`; a push by another pusher with the mirror's author email | bad refused in the Worker, good record wants, the spoofed push's included; `#mirror` `forbidden`; one dispatch retry; only `web_base` URLs kept; the ticket fails |
| S-BTN-59 a passive plain server | `plain` with no hooks or sync key; W1 granted on it pushes; a person pushes; a bar lifts; two runners see one head | W1's post accepted with `posted_by`; `ls-remote` posts the person's push within a minute; the want answered; one board (`sync-busy`); mirror route and ungranted repositories refused |
| S-BTN-106 PRs in other repositories | a ticket naming two other repositories in `repos:`; verdict on one PR; merges | reads only the named repositories, one GraphQL query each; one change: a verdict stands for all, `merged` when both are |
| S-BTN-113 forge ids | tokens and deliveries with matching paths and wrong ids; renames to a free, a retired and a live path; registrations without ids; a re-identification | mismatches `unauthenticated` or ignored, raised `forge-ids-mismatch`; renames tracked (`repo-renamed`), onto a live path held (rule 13) until confirmed; tombstones; `invalid-params`; re-identified only with `confirm: true` |
| S-BTN-115 outsiders on a public PR | a fork PR, outsider and read-only verdicts and markers, listed bot and writer verdicts, on GitHub, GitLab and Gitea | only the bot's and writer's verdicts count; no outsider marker posted; permission API refused → only the bot |
| S-BTN-116 cross-repository reach | `repos:` outside `code_repos`, pattern `*`, an input with a wrong digest; A's owner writes `code_repos` carrying a `repo_id` and `consented_at` for B; a re-written list | `*` refused; ticket raised `repo-not-listed`, no fence; listing needs that repository's owner; `contract-input` before the leg runs; only `path` kept, no reach until B consents; kept paths keep their ids and consents |
| S-BTN-125 CI tokens, notifications, import, local host | untrusted-event CI tokens; a cross-repository delivery; GitLab with `release/*` protected; an edited export; a pre-seal replay; non-loopback bind; readable secrets; `http` bearers | tokens refused, schedule and dispatch pass; no want; init refused; import refused naming the row; replay refused; bind as asked; exit 2; bearers refused except through `--trusted-proxy` |
| **§4** | | |
| S-BTN-13 board ordering | two syncs finishing out of order; a force-push | head never moves back; force-push held, accepted at 24 h |
| S-BTN-36 suspension confirmed from a PR | a suspension evidenced only in a code repository; an older observation arriving late; a reap and re-claim | confirmed by the next later snapshot, never by ancestry; `stale-observation`; R-BTN-5's check passes |
| S-BTN-40 slow and stale syncs | a whole ticket under slow, stale-checkout and held syncs, a lost delivery, an archive sync numbered before `/end` | every `advance` accepted; no stale end; the stale checkout posts nothing; the schedule covers the loss; `done` confirmed from the closure |
| S-BTN-43 no course code | five ticket files (a dependency, a `done`, an unknown field, no `id`) on the default source; a PR through review, fix and merge; `--eject tickets`; comment verdicts | four tickets on `create-pr`; the dependent waits; `filed` → `pr-open` → `reviewed` → `fixed` → `reviewed` → `merged`; the ejected copy rules; `src/core/` unchanged |
| S-BTN-47 positions and discrepancies | results with good, missing and off-graph `next`; unmarked human work; legs added and removed; a re-route; spent retries; a leg waiting 72 h; a person's approval overtaking a reported position | provisional until `locate`; bad results suspend, `off-graph`; `inferred`; `course-changed` raised; re-route wins until the station changes; `position-replaced`, `route-overridden`; `baton.retries` and `baton.stalled` resolved by `baton owner resolve … retry` |
| S-BTN-49 child tickets | a leg files C1, C2 with `parent: T` and ends `spawned`; ends with 51 ids, the parent itself, or `done`; looping and foreign parents; children `T-1`, `T-2` push branches and PRs while T is held | bad ends `invalid-params`; children and T held concurrently, T's non-calling leg offered; the children's branches and PRs map to them alone, their pushes allowed; `children` lists both, also closed; bad parents `parent-invalid` |
| S-BTN-50 owner state exported | a Baton with claims, keys, grants, bars, a hold, a re-route, a forge courier, readings, open core conditions and a choice leg's pending `after_s`; freeze, seal, export, import, re-heartbeat; a tampered and a second import | refusals before seal (`frozen`, `conflict` for a lagging mirror); identical exports with only owner state; source `sealed`; import restores state, continues seq, runners resume unkeyed, the `after_s` instant unchanged; `invalid-params`, `conflict` |
| S-BTN-58 an unknown ticket | claims of tickets Baton has not seen: at the entry leg, at a later leg, branch-only, above ceiling; an older sync; two advances | provisional with a want, one per key; `not-eligible`; `off-branch` at once; `stale-board`, not failed; second `advance` `provisional`; settled only by a post containing the commit |
| S-BTN-121 heads, held posts, open-world claims | unfounded head posts; a fetch lagging the head, once and for 31 minutes; a force post of an earlier head's sha; a held force post dropping a bar, a decision and a ticket; two held rows reaching 24 h, then normal posts containing the older; a loosening machine-key post, one dropping `stream: false`; open-world claims breaking gates; one settling at its sha with an open decision; a misdeclared tier; a differing `cli` | heads replaced at once, raised `head-replaced`; the lag posts nothing and releases, then posts a held force post; the earlier sha held; bar, decision and ticket kept; only the newest row accepted, adopted at the next force post, the older dropped; changes raised, `stream` among them; gate breaks refused at the claim; `stale-board`, not failed, branch tainted; `released:misdeclared`, failed, branch tainted; `stale-board` with bar and taint |
| **§5** | | |
| S-BTN-8 owner bar, no new work | a bar `applies: claim` set mid-claim | holder finishes; others `barred-tag` |
| S-BTN-9 owner bar, stop | the same with `stop` | holders end `released:provider-suspended`, not failed |
| S-BTN-11 scheduled bar | a bar for +1 h to +3 h, no sync | refused from +1 h, accepted from +3 h on Baton's clock |
| S-BTN-15 stale skills | a runner below `min_runner_version` | no new claim (`stale-skills`); its held claim finishes |
| S-BTN-33 tags gate | `fix` with `barred_tags: ["family:glm"]`; GLM and Qwen runners | GLM never offered, claim and `advance` `barred-tag`; Qwen gets it |
| S-BTN-37 a course changes under a claim | a rename of a leg with an attempt, a backoff, an armed timer and a held position; a removal raising `min_runner_version`, an unbounded loop, a leg leaving an end | claim, attempts, backoff, timer and held position carry over under the new name; removed station ends `course-changed`; `stale-skills` only after the rise; bad files refused and raised, previous kept |
| S-BTN-38 a course measures itself | a granted and an ungranted key read `/stats` | times, ends and overrides, no profile; `forbidden` |
| S-BTN-48 contracts and replay | a typed input from `review`; bad output; bad input; an unwidened version rise; a digest-less `https` pointer; `baton leg replay`, `--against`, `replay_safe: false` | inputs recorded; `contract-output` failed; `contract-input` held, `baton.contract`; `input-version` wait; pointer refused; replay writes nothing; unsafe refused |
| S-BTN-65 refinement | a refinement dropping a base's `required`; a value missing a base field | `course test` names it; the value fails both, `contract-output` |
| S-BTN-66 entry requirements | arrivals with no entry output, inline, and an invalid pointer | refused (`entry`); validated; logged and raised `output-invalid`, consumer waits `input-missing` |
| S-BTN-73 capability types | declared types and role; failing and passing checks; a `db:*` grant without `credential:*` | undeclared type refused; failing check dropped from the heartbeat; rule 4 refusal |
| S-BTN-76 hostile values rendered | markup and `javascript:` in a view; a link to an unlisted host | `plain` as text, `html` escaped, `ui` `textContent`; link as text |
| S-BTN-79 schemas refused | changed digest, `oneOf`, back-reference, `$ref` cycle, own `std:` id; another repository's same id | refused with the file kept, raised; `std:` refused; the other accepted, keyed to it |
| S-BTN-80 signatures and spawns | a call leg's `spawns` (`provides: [brief]`) of a course whose start requires `brief` and whose ends `done` and `abandoned` produce `result` and nothing; a completion `{of: "all", closed: true}` into a station whose `entry` requires `result` | `course test` prints both signatures and names `abandoned` as not producing `result` |
| S-BTN-89 an epic | `plan` files three children, one withdrawn; `replan` files a replacement; a second epic's `replan` files none | `plan` settles `planned` once all three closed; `replan` settles `built` when its child merges; `integrate` ends `integrated`; the second reaches `abandoned` |
| S-BTN-104 the standard courses | `bug-report` with markers (one no edge, one malformed), `decision` with `answer:`, `draft-ticket` with no forge facts; an audit leg answering with prose before and after its outcome, and with none (B-85) | markers move the ticket, bad ones nothing; `carry-out` ready once answered; the third syncs to `requested`; the prose-wrapped outcome is read, none fails naming the last line |
| S-BTN-105 one leg overridden | `legs/review.run.mjs` on a sourced `create-pr` | the override runs at the snapshot; the standard `close` writes the verdict |
| S-BTN-107 the build-app course | drafts approved one by one by `answer:`; `file`, a call, files two children on different courses; a verification files a fix; a third failing verification | each draft waits for its stage's approval; `file` settles at `building` only once both close, so `verify` never starts while a child is open; the fix call settles back to `building`; `released:blocked` on the posted decision; `shipped` |
| S-BTN-175 the request | a fresh repository on `create-spec`; `baton request "<one sentence>" --course create-spec` run through the CLI's own entry, then a sync of what it pushed, then a runner's claim | one commit on the bare origin's main, on top of the scaffold, the ticket file alone — the sentence its title and description, `course: create-spec`, `available`, `tags: [request]` — with the caller's branch, HEAD and tree untouched; the board posts it `requested` with `converse` `ready`; the claim offers `converse` |
| S-BTN-174 the create-spec course | a request with no PR and no marker; a run of `converse` that writes its marker and suspends, then a second sync; its PR on the branch pattern, checks running and then done; a verdict asking for changes and an address round begun and suspended; its push; a second round; a third round asking for changes; a round still asking for changes with all three address rounds spent; an adjudication reproducing a finding, then one that does not; a fresh approval; the merge | `converse` ready, then — its marker committed — waiting on `owner` and not offered again; `spec-open` with `review` waiting on `ci`, then ready; `reviewed` with `address` ready; back to `spec-open` after the push; `adjudicate` once the address rounds run out; `merge` waiting on `owner` for a reproduced finding, ready for none; `merge` ready on a fresh approval; `merged` |
| S-BTN-110 courses from their sources | the built CLI outside a checkout: `--course create-pr`; a `--source` at a tag with overrides; a copied `course.json`; an off-branch commit; no `sync.mjs`; an outside import | full-commit source, no course file; source read at its commit with home overrides; each fault refused naming it, the commit unfetched |
| S-BTN-117 bars and renames | bars on `implement` and `*` except `review`; files dropping, swapping, double-renaming, re-adding legs | first two held, raised; collision refused; `except` updated and the new leg barred |
| S-BTN-139 closure | the built-in ontology; a runner holding `key:anthropic` and `dependency:claude-code`; one holding the key alone; a three-hop transitive rule | the first derives `model:claude-opus-5-5` and `capability:code-generation-llm`; the second only the model; three hops derived |
| S-BTN-140 a program refused | programs with a cycle through `not`, an unsafe rule, a non-ground fact, `"x" < 3`, a position receiving an integer and a string through a shared variable, a head deriving `credential:X`, `runner:x`, `human-operator`, `model:UPPER` or a type missing from `derived`, a negated `holds`, `derived(K) :- target(K), not safe.` with `safe :- holds("dependency:git").`, a `holds` variable bound only by `holds`, an entry or guard naming `route`, `available` or `alt`, a guard or `meters` rule depending on `holds` or `derived`, a `credential:` need, a need outside the constant syntax, an empty `demote_when`, `derived: ["credential"]`, a leg listing nine route choices, two bindings for `"coding"`, a fixed predicate whose evaluation crosses the bound, each other bound crossed, 257 derived capabilities; a positively recursive program | each refused naming its entry and rule, `baton.ontology-refused` raised; the recursive one accepted |
| S-BTN-141 bindings narrow | no binding, then `binding("coding", "model:claude-opus-5-5")`; one runner with DeepSeek's chain, one with Opus's | at first both satisfy `capability:code-generation-llm`; then only Opus's |
| S-BTN-142 the grant before the closure | W1 declares `key:anthropic` and `dependency:claude-code`, granted `key:*` and `dependency:*`; W2 the same, not granted `key:anthropic` | W1 matches a leg requiring `capability:code-generation-llm`; W2 is refused `missing-capability` |
| S-BTN-143 matching on derived capabilities | a leg requiring the capability; a deriving runner, a non-deriving one, and a direct declarer granted `capability:*`; the deriving runner and the declarer leave, then the deriving runner returns; a repository with no `.baton/ontology.json` | offered to the first and third, not the second; a `capability` block written when both have left, cleared when the deriving runner returns; with no file, nothing derived and no refusal |
| S-BTN-144 why not | a leg requiring `capability:code-generation-llm`; a runner holding only `dependency:claude-code`; the fleet with no deriving runner; under `binding("coding", "model:claude-opus-5-5")`, a runner holding only DeepSeek's chain; a positively recursive chain | `not-derived` with the canonical proof's `needs`, `missing` naming the Anthropic credential, `chain` its entry ids, and the direct declaration offered; the fleet answer without `missing`; the Anthropic credential, never ∅; a finite answer from the stored tree |
| S-BTN-145 the environment is R-BTN-144's | a leg requiring `capability:code-generation-llm`, derived from `key:deepinfra` and `dependency:opencode-v2`, on a runner that also declares `credential:DEPLOY_TOKEN`; the same leg with `route_choices` | the leg's environment is exactly what R-BTN-144 gives a leg whose `requires` names no credential: `DEPLOY_TOKEN` removed, model-provider credentials kept; the advance answer carries no credential data; identical with `route_choices` |
| S-BTN-146 freshness and bounds | W1 heartbeats `key:anthropic` added, then reads recommendations at once; an owner revokes a `key:*` grant on a credential with 64 live runners; a program accepted with 120 live granted runners in two repositories, then W2's recommendations, claim and `baton leg why` before the alarm reaches it; a retraction of a wrongly derived capability; a program whose maximal evaluation crosses 200,000 matches; a lowered runtime bound crossed through the test bindings, on both hosts, then W3 polling recommendations; a runner declaring 500 capabilities the program never names; a leg ending `released:blocked` on a dead holding | W1's recommendations already offer the codegen leg; the revoke evaluates nothing in its transaction, and each runner's next read brings its set up to date; W2's reads re-evaluate its sets first, the others re-evaluated by the alarm cycle, unchanged rows unwritten, fleet counts recounted when it ends and `fleet_version` bumped; the retracted capability admits nobody from the next read on; refused at post; H alone, stored `limited`, one `baton.ontology-limit`, identically, and no re-evaluation at W3's later polls; no extra cost; the holding removed and the sets re-evaluated in the end's transaction, no failed attempt |
| S-BTN-155 merge and acceptance | a file naming `baton@1`, retracting one built-in entry, reusing a built-in route choice id, adding an entry and a `derived` type; one naming `baton@9`, which the CLI lacks; one retracting an id the built-in lacks; a post whose program drops route choice `codegen` that a course entry lists; a post removing that entry's `route_choices` with a program dropping `codegen`; a post adding an entry that lists an undefined route choice; a sourced standard course that declares no `capability_types`, with `route_choices` set in the home's entry whose alternatives need `model:` and `key:` capabilities, and none in its `entry.json`; an entry attaching a route choice to a leg its course lacks; a sourced course declaring `model` with other `values` than the derived atoms'; a post with no `ontology` field while entries list route choices; two changed units posted a minute apart; the same unit posted twice | one merged program, the replaced entry in place, new entries appended, `derived` extended; `ontology: {error}`, the rest of the board accepted and `baton.ontology-refused` raised; the same; the unit refused, program and entry kept; accepted together; the unit refused, that entry kept at its previous version; the unit accepted and the home's route choices served, a source's `route_choices` never read; the unit refused; accepted, the atom inert for that course; the unit refused, the program kept; each judged at its own post; the second post changes nothing |
| **§6** | | |
| S-BTN-10 no reviewer capacity | every seat barred | `review` posted `waiting`; holder ends `suspended:pr-open`; offered again after the lift; `baton.stalled` at 72 h |
| S-BTN-19 suspend for the window | both lines limited until +2 h when `implement` ends | no advice on `advance`; ranking reads `frees_at`; suspended; first in line at +2 h |
| S-BTN-20 own line exhausted mid-leg | a rate limit with no reset during `implement` | `released:blocked` on `resource` with a reading, not failed; override accepted; another line continues |
| S-BTN-21 seats | `chrome-mcp` registered `--scope host --capacity 1`; W1 and W2 on host `vm-12`, W3 on `vm-13`; W1 claims a leg requiring `chrome-mcp`; W2 then claims one, by `ticket_id`, and by `prefer` with a second candidate that needs no Chrome; W3 on its own host; W1 advances from one Chrome leg into another, then into a leg without it; W1 force-reaped while billing, fence pending; `rdp-lab` a `service` resource with capacity 1, billed from two hosts | W1's runner bills `chrome-mcp@host:vm-12` and holds the seat; W2 refused rule 11 `instance-busy`, no failed attempt, its `prefer` claim taking the second candidate; W2's recommendations omit the leg and `baton leg why` answers `busy`; W3 unaffected; W1's own seat never refuses its advance, and the advance without Chrome releases it; the seat held until `fence-cleared` or `fence_deadline`; one `rdp-lab` holder across every host |
| S-BTN-22 review queue bound | eight tickets wait for review | default order, nothing flagged; override recorded (the bound is docs' ranking) |
| S-BTN-27 model advice | three lines, one with spare budget near reset | `launch-candidates` serves the ranking code; a claim on another line accepted, recording the model |
| S-BTN-44 blocks, resources, decisions | `depends_on`, an undeclared capability, a resource on two instances, a posted decision, an `unblocked_trigger`, an idle runner; readings lapse, B closes, the capability comes and goes | rows per kind, fleet-wide only when every instance is down; one index serves `blocked?on=`; claims `blocked`, by-id override accepted; `unblocked` logged, messaged, dispatched once; `baton.capability-missing` after 24 h |
| S-BTN-45 edges of blocks, a queue over its bound | `$ref` resource schema; foreign runner; bounded and schema-failing readings; administrator over probe; an empty fleet overnight; K blocked overnight on a capability and a resource at once; leg- and whole-ticket decisions; `max_queue: 2` with three; 150 unblockings | refused, `forbidden`, `invalid-params`; lapse at `until`; `overridden`; no row, `no-instance`; K's morning heartbeat swaps its rows with no `unblocked` or `blocked`, the same `blocked_since`, no runner woken (one evaluation per transaction); `advance` into a decided leg `blocked`; `baton.queue-over` raised and the course `closed` until back to two; dispatch of 100 plus `{truncated: 50}` |
| S-BTN-51 a series and a timed leg | a series run due at T; idle days; a retried successor write; a foreign successor id; invalid `not_before`; a `ci` wait; a withdrawn run | `waiting` on `time` until the alarm readies it at T with one message; one successor, after its predecessor; `cannot-finish:spec`; `not-before-invalid` raised; `ci` wins; missed fires not replayed; the series retires |
| S-BTN-61 shared instances | one instance listed by `docs` and `ops`; measures from both; a key of neither; two containers on one key | both visible, no foreign ticket or host; none replaces another; `forbidden`, omitted; unlisted bill `refused` |
| S-BTN-67 a person's leg | a queued `kind: person` leg; its decision posted with another `asks`; a runner asks; the owner answers in git; an answer lacking `option` | stored with the leg's `asks`, `asks-mismatch` logged; refused (rule `person`); the path posted with `std:decision@1`; `output-invalid` raised |
| S-BTN-72 tickets at stations | `requires.tickets` on a parent `reached` and a `depends_at` `at`; a missing parent; a holder advancing into the leg while its `ticket` row stands | one `ticket` row until the dependency arrives; `reached` holds past it; the missing parent raises `baton.prerequisite-unmet`; the advance refused `blocked` (rule 1) |
| S-BTN-74 why a leg cannot start | four unmet prerequisites; an asker lacking a capability | `baton leg why` lists each with its `why`, plus `not-declared`, from the blocks index alone |
| S-BTN-82 cycles and closed tickets | a two-ticket cycle; a withdrawn dependency; `reached` on a closed ticket | `prerequisite-cycle` raised; never met; met from `final_path` |
| S-BTN-91 a resource fails mid-leg | an account runs out for 2 h; another serves the leg, later also out; a second reading in a minute | `released:blocked`, reading and `end` need stored, nothing spent; blocked for W1 only until every instance is down; `reading-refused`; need cleared on completion |
| S-BTN-92 a capability fails mid-leg | a check fails mid-leg; another runner holds it; a sole holder loses it | `released:blocked`, dropped from the declared set at once; no row while another holds it; row at zero, cleared on re-declare |
| S-BTN-93 a ticket or decision found mid-leg | `blocked` on a ticket with `commit`; an older snapshot; a decision never posted; a block naming `baton.retries` | provisional row, raising nothing, replaced by the snapshot containing the commit; dropped after an hour; `invalid-prerequisite`, counted |
| S-BTN-94 how a leg reports a block | `LegError` with and without a reading; `baton leg release --blocked`; no `commit`; an unrequired capability; `in_claim` set | `blocked` ends, never retried in the claim; bad ones counted `cannot-finish:transient` |
| S-BTN-95 blocked ends are bounded | `max_blocked` 3 exceeded on one leg; one runner blocked 13 times | ticket held `blocked-exhausted`, `baton.retries`; lifting resets; `baton.blocked-ends` |
| S-BTN-96 edges, not stations | legs in every state | drawn as edges `ready`, `running`, `blocked: … (before-start / during-run)`, `backing-off`, `not-queued`; no unknown station |
| S-BTN-108 one primitive per prerequisite | `depends_on`; a parent whose call leg waits on its children beside another leg; an `OP` tag; a post with a reserved `waiting_on`; a course file with `select: "run"` in `requires.tickets` | start leg waits `ticket@done`; the other leg ready; rule 4; post refused naming the ticket; file refused, previous kept |
| S-BTN-147 a codegen route choice | `codegen`: `opencode-go` (needing `model:deepseek-v4.1-flash` and `key:opencode-go`, demoted by `ocg_peak :- now("utc_minute_of_day", T), T >= 120, T < 600.`), then `deepinfra`; facts `meters("key:opencode-go", "opencode-go")` and `meters("key:deepinfra", "deepinfra")`; each an `account` instance the runner uses, with administrator `state` readings; off-peak and in peak; each instance unavailable; a runner holding only `key:deepinfra`; one holding neither | off-peak `opencode-go`; in peak `deepinfra` with `ranked` `deepinfra`, `opencode-go`; in peak with DeepInfra unavailable, `opencode-go`; off-peak with OpenCode Go unavailable, `deepinfra`; `deepinfra`; `null` with `none-available` |
| S-BTN-148 a reviewer route choice with hysteresis | `reviewer-2`: `opus` (needing `model:claude-opus-5-5` and `key:claude-subscription`) demoted by `near_limit` (entered below 200‰, held below 300‰ while `was_demoted`), then `glm`; `anthropic-capacity` registered `atoms_from: any`; W1 resolving at each step of: `remaining_permille` 500; 150; 250; a `state` reading `available: true` with no `detail`; 320; every reading lapsed; the same with a fail-closed rule over `state(I, "unknown")`; an administrator's `unavailable`. W2, with no usable instance, resolves between each | W1: `opus`; `glm`; `glm`; `glm` (the field reading kept at 250); `opus`; `opus`; `glm`; `glm`. W2's resolutions never change W1's |
| S-BTN-149 who steers | a runner's `measure` and `state` readings (`available: false`) for a resource registered `atoms_from: admin`, then re-registered `any`; an administrator's reading over an instrument's | under `admin`: no field atom, and the route-choice state and `blocked` unmoved while the fleet's `resource` block still hears it; under `any`: atoms and the alternative blocked; the administrator's reading speaks |
| S-BTN-150 atom shapes | a reading with a non-integer number, `null`, an array, `false` and a nested integer; a rule comparing a `str` value with `<` | only the nested integer forms an atom, by its dotted path; the rule refused |
| S-BTN-151 refinement | resource schemas naming `std:api-capacity@1` as `x-baton-base`, one tightening a bound and one widening it, a third naming a non-`std:` base; a refining resource; a rule over `refines` and `remaining_permille` | the widening and the non-`std:` base refused at registration; the rule serves both refining resources |
| S-BTN-152 strata and reserved names | `derived` rules depending on `int`, `now`, `was_demoted` or `route`; a `demote_when` naming `route`; a fact `available("c", "a")`; a repository `meters/3` | each refused, naming the dependency path or the reserved predicate |
| S-BTN-153 delivery and overrides | a claim, then an advance starting a leg with route choices; its leg finds the advised alternative's `key:zai` dead, takes the next in `ranked` and writes `{choice, alternative, dead: ["key:zai"]}`, and the runner's `advance` both finishes it and starts a leg with the same route choice; a second leg writes nothing to `BATON_TAKEN`; a third the advised one; a fourth names an unknown alternative; a fifth writes 10 MB; a leg without route choices reports one; a route choice resolving `none-available`, then an alternative reported for it | the claim answer carries no advice; the advance's `advice` holds identifiers only, with `ranked`, and is in `BATON_ADVICE` and `claim_legs.route_choices_json`; `advice-overridden` with `{choice, advised, taken}`, `key:zai` removed in that advance's transaction and the next leg advised without it; `taken_json` `null`, no override; nothing; `taken-invalid` logged, the `advance` accepted; the file dropped, the advance accepted; dropped and logged; stored, no override; each compared with the finishing leg run's row |
| S-BTN-154 limits and conformance | a route-choice evaluation crossing a test-lowered match bound at an advance; every route-choice fixture through `clingo-wasm`, one with nothing available | `reason: "limit"`, `baton.ontology-limit`, the advance succeeding; one optimum each (`Models.More` `"no"`), `route/2` equal to the evaluator's; `SATISFIABLE` and no `route` for the empty one |
| S-BTN-157 a busy sync is not a success | a run while another's number is outstanding, lapsed past R-BTN-62's ten minutes during its wait; `--busy-retry 0`, and an out-of-range value; a run that fails; the workflow's annotation step against a posted log (plain and stamped), a held log, a busy log, a failed log, a log with no outcome line, and a line that names no sha; the generated workflow against this repository's own | the wait is one of the flag's length, before the retry's first observation, and the retry posts under a fresh number, exit 0; `busy` at once, exit 1, nothing posted; `busy:again`, exit 1; the refusal of the value; exit 1; a notice, a warning that posted nothing, and an error naming the outcome (or naming that no sync ended); the annotation steps equal, and neither workflow passing a flag its pin lacks |
| S-BTN-167 a merge dispatches the sync | a `pull_request` merge of this repository and one of `docs`' own; a `pull_request_closed_without_merging`; `pull_request.merged` absent, one that is null, and one that is no boolean; a push that dispatches this repository's sync and a `docs` delivery that dispatches `docs`'; a second delivery inside R-BTN-73's 30 seconds; at the alarm, a repository's last webhook dispatch 11 minutes old, one 9 minutes old, one exactly 10 minutes old, the second after a tick that landed late, a retired one's, and a repository never sent one; the repository before and after its cutover | the merge's repository dispatched once; nothing for the unmerged delivery; the absent and null ones dispatch nothing and the non-boolean is dropped with no dispatch; each repository's own row stamped by its delivery; the second suppressed into the window's trailing dispatch; the alarm dispatches exactly the 11-minute-old one, once, and a later alarm none — never the exact-10-minute-old one, and the late tick's stamp not again; a repository with no row untouched; the sync sent before the cutover and after it alike.
| **§7** | | |
| S-BTN-5 retried with backoff | two `cannot-finish:transient` ends | `retry_after` 1 h, then 4 h; the third claim gets both resume records and reuses branch and PR |
| S-BTN-6 poisoned ticket | three failed attempts of different kinds; a looped leg failing twice in each of three passes | held `attempts-exhausted`, `baton.retries`; lifting resets; the looped leg never held, its count reset each time it reaches an outcome |
| S-BTN-7 non-retryable failure | `cannot-finish:spec` | held at once, `baton.retries` |
| S-BTN-52 deadline and scheduled cancel | a 1,800-s interrupting `start` timer; runs finishing before, at and after it, with and without delivery; a hung harness; `extend_to`, `cancel_at`; invalid ones | `leg_finished` re-arms to 40 min and withdraws a pending release; `leg-timeout` failed; reaped with a fence at +15 min; extension in `deadline_at`; Cancel holds and releases `owner-cancel`, lapsing with its claim; `invalid-params` |
| S-BTN-83 an exponential schedule | `initial_s` 600, `coefficient` 2, `max_interval_s` 3600, `max_attempts` 5; four failures | 10, 20, 40, 60 min ±10%; a `retry` block meanwhile; `unblocked` at `retry_after` |
| S-BTN-84 declared interrupt conditions | non-retryable and retryable types, a plain `Error`, a type naming a prerequisite | held with `baton.retries`; backoff as `transient`; `error.type` on each end; `released:blocked` |
| S-BTN-85 in-claim retries | `in_claim: 2`, two failures, then success | re-run in the claim; no attempt or run counted; two activities |
| S-BTN-86 owners bound the course | owners' ceiling and floor below a course's policy; oversized `in_claim`, `max_refreshes`; `coefficient` 0.5 | the stricter applies, warned and shown; `coefficient` refused |
| S-BTN-87 timers on attempts and readiness | an interrupting `first_attempt` timer a backoff would pass; a `ready` timer raising `baton.ready-late`; a looped leg whose second pass starts after the first pass's budget | not retried, held `budget-spent`; raised once; the second pass's budget runs from its own first attempt |
| S-BTN-127 answered within the wait | `hitl` bound to `ask`; a raise with restarts, `wait_s` 120, answered in 70 s; an answer outside the restarts | ask file pushed before return; `deliver` filed; `handled` rung; `ctx.raise` returns `{restart: "b", reason: "chosen"}` in the claim; `deliver` superseded, `retract` run; `contract-input` |
| S-BTN-128 answered after the wait, withdrawn | no answer in 120 s, one 3 h later; a withdrawn ask; one answered 1 s after the wait; a waiting holder reaped, released `requested`, or reaped by `leg-timeout` | `released:blocked` on the `condition`, not failed; resumed by another runner with `resume`; default restart `withdrawn`; no block row, resumed at once; each writes the `condition` block, and no claim asks again |
| S-BTN-129 expiry and asking again | an ask waits 2 days; push retries fail; a late answer; a retry | `expire` settles (`choice-settled`), `restart: null`; `choice-lost`; `email` queued; `error.no-answer` holds; the retry files a new ask |
| S-BTN-130 dynamic binding | repository and epic-scope bindings; a narrowed leg; a restart-less handler course; an unmerged binding | innermost scope, longest prefix; raise refused on the channel; `course test` refuses; inert; `baton leg why` names each |
| S-BTN-131 the debugger | no bindings: a `hitl` raise, spent retries, an invalid output; then `baton` bound to `announce`; `baton.retries` bound to `ask` and answered `retry` in its file, then on its resolve page; `baton.queue-over` flapping; a leg raising `baton.retries`; a runner's condition | `hitl` listed by severity and age with its restarts, resumed by `baton owner resolve` (`resolved`); `baton.retries` offers `retry`, `route:<leg>`, `park`; `baton.output-invalid` listed, then filed through the outbox (bindings from the post's `bindings`) and superseded on close; no notice to anyone; the file's answer read for nothing, the hold kept, the message linking `/conditions/<id>`, resolved there by a signed-in owner; one handler, later raises unhandled with `reraised`; `invalid-params`; never bound |
| S-BTN-132 calls and completion | a call over three `review-pr` children (2 of 3 approve; `lifetime: station`); an epic `plan` call with one child withdrawn; a `spawned` end naming none; a table without a closing `{"of": "all", "closed": true}` entry; a `baton.cancel` released after one of two compensations | settles on the second approval, third `superseded` and withdrawn through the outbox; `settleCall` agrees; the epic settles `planned` only once all closed; empty end refused; the table refused; the next `baton.cancel` runs only the second |
| S-BTN-133 a choice station | `answer` listed before `expire`; both in one alarm transaction; a provisional position; a later sync posting `expire`; `after_s` 30 or 2,592,001 | `answer` wins by order; nothing armed provisionally; held as an override, written by the winner's run; `choice-lost`; exported; out-of-range `after_s` refused |
| S-BTN-134 timers | an interrupting arrival timer with `leg`; a non-interrupting `warning.slow`; a leg's `baton.stalled` override at 1 day; a file with `max_duration`, `max_ready_s`, `max_attempts_s`, `error_types`, `isolation`, a leg's `call`, `checks` or `retry.non_retryable`; timers interrupting with `raise`, non-interrupting with `leg` or without `raise`, with `leg` on a choice station's leg, or a second `baton.stalled` | `leg-timeout` and the leg queued; raised once per arrival; `baton.stalled` raised after 1 day, not 3; each refused naming the leg and field, previous kept |
| S-BTN-136 the outbox | bound `baton.output-invalid`; no `git` courier, then one; a write pushed by a courier whose lease lapsed; a forge-refused push; a condition closing while queued, and while claimed; an entry undelivered 24 h; a `tickets.mjs` that never posts the written file; a foreign file at the handler's path; a runner key registered as a courier; an entry whose signature does not verify; a runner key claiming under the default policy, then under `git: {deliverers: [runner]}`; `trust: trusted` with a courier sharing a runner's trust domain; a release below `min_release`; an owner's MCP key loosening the policy | provisional handler ticket waiting on `outbox`; filed with `baton_write: <id>`, `delivered` then `confirmed`, the ticket's own `start_leg` then offered; the next courier writes nothing and reports the head; held `outbox-refused` and `baton.outbox-late` naming the courier; `dropped`, and once claimed a `withdraw` follows; `baton.outbox-late`; the entry never claimed again, held `outbox-unlanded` after 3 snapshots; held `outbox-collision`; `conflict`; refused by the courier; `forbidden`, then claimed; `forbidden`; `forbidden`; refused, and an owner key's tightening accepted |
| S-BTN-138 a light question | `hitl` raised `light` with `ask`/`deliver` bound and two answering channels: a reply within the wait; replies on both channels, different; a delivery leg killed after reading, re-claimed; a report repeated; the parent killed while waiting, then reaped; the parent killed after the answer settled; a reply after the wait; a reply after the person answered in the file; a fire-and-forget channel; a promotion; the ticket re-routed with a settled, unrecorded answer | the question pushed to `refs/baton/questions/…` before the report, Baton storing only the pointer; `open` files its Baton-held `deliver` child, never `spawned-unposted`; the leg goes on in the same session, no git write until its end records the answer; the first reply settles, the second `answer-ignored`; the reply re-read and settled once; `ok`, no second effect; reaped, promoted through the outbox, blocked, never asked again; the next claim resumes with the answer; written to the ask file through an `answer` entry, then resumed; the entry `skipped` and the reply `ignored`; `answers: false` only notifies; the ask file posted at `waiting` from `baton_position` with the question as its body, `open` not re-run; the closed ask written with its answer |
| **§8** | | |
| S-BTN-41 the runner | a `ci` wait, `{suspend: true}`, `max_runs`, a closed PR, returned `bars`, a lost lease, a course change, a non-edge `next`, a release, a wind-down message and the immediate stop (B-109), a leg session claiming, a granted runner with no `--capabilities`, a `--capabilities` a leg's need refuses, a grant of nothing (B-86); a `git` that never returns (B-94) | holds through `ci`; follows only named edges with their `bars`; suspends at `from` with a hand-off; kills the group on loss; new scripts unrestarted; `released:requested`; a wind-down drains through the signal's own flag (the leg completing, the claim ended at its boundary, the message acknowledged, twice a no-op) and the immediate stop releases the leg at its next safe point with its hand-off (B-109); session refused (`BATON_PARENT`); declares the grant and claims, declares the narrower set and says why no leg can be taken, and says a grant of nothing; the close and the runner's own git killed at their bound, the leg failing, the heartbeat still beating; a stop on a signal or an `exit` leaves a line naming the claim, the leg and the last beat |
| S-BTN-159 a quiet start | a runner's first attempt, whose heartbeat registers the worker, then its recommendation; a repository with no `origin` at `remoteSlug` | not one `no recommendation (no worker holds this secret)` line — the refusal is not logged, a registered worker's still is; `null` and no line of git's own |
| S-BTN-53 the doorbell | rings for a cancel and a follow-up; a deploy; a reap; liveness loss; bad upgrades; eviction | one ring then a trailing ring; reconnect with backoff, heartbeat delivery meanwhile; sockets closed; `unauthenticated`, `forbidden`; state recovered |
| S-BTN-62 a session reports to its runner | a non-outcome `reached`, a move missing entry output, a valid move | first two answered on the channel only; the third advanced; no secret in the session's view |
| S-BTN-63 no review by its author's key | `review` names `implement` in `no_chain_from`; same-key re-claim; owners' `required_independence` | refused (`chain`); another key takes it; the owner setting holds without the file |
| S-BTN-64 session-only legs | a leg requiring `runner:session`; three runner modes; no `session` runner live | only `session` offered; others refused `missing-capability` (rule 4); a `capability` block, `baton leg why` `no-live-runner` |
| S-BTN-69 registration and API keys | a token `--ttl 30d --max-tier 2`; SSH and API registrations; `--max-tier 3`; `api_keys: false`; revoke | both granted within tier 2; refused; API runner refused next call; both revoked |
| S-BTN-71 stopping a leg | a process ignoring signals; **Stop leg** | `SIGINT`, `SIGTERM` at 10 s, `SIGKILL` at 25 s, gone within 30 s; `released:requested`; no hold |
| S-BTN-75 a bounded run | `--legs review,fix --max-legs 2 --until <t>` | only named legs; suspends before `merge`; nothing after `<t>` |
| S-BTN-77 host allowlists | `session_url`s on allowed and other hosts, with userinfo, too long; a host added | only allowlisted kept, others logged; then kept |
| S-BTN-78 session mode | a cloud session runs a leg | brief has no claim id or credential; its result block is checked like a move |
| S-BTN-88 a fresh context | `max_context: 0.6`, `max_refreshes: 1` in each mode | `session` and `process` refresh under the claim, uncounted, then suspend; `attached` logs once |
| S-BTN-98 a leg's log | `leg_log_root` on a local `file:` root; output with every kind of credential, a split secret, OSC 52; a failing write; `stream: false`; 60 MB; a short leg; a stopped leg; logs turned off; a `file:` root on the Cloudflare host; a reader without access | `dir` in the claim and `advance` replies and in `claim_legs`; create-only chunks, then `end.json`; every credential `***`, short ones logged; retries then `leg-log-write-failed`, the end not delayed; nothing written where off; `gap` at 50 MB; the Cloudflare root refused `invalid-params`; `leg log` reads the directory, escapes stripped; exit 1 |
| S-BTN-99 watching from the CLI | owner, administrator, foreign owner run `leg log -f` on a running leg; the leg ends; `leg stop` | chunks printed in order, then followed until `end.json`; a missing `seq` `[gap]`; the foreign owner's runs read `forbidden`; release sent |
| S-BTN-109 legs in a checkout | six script extensions, a `file:` dependency, Node 22.17 then 22.18+; lockfile kept and changed; off-branch sha; lease loss and Cancel during install; duplicate scripts; `yarn.lock`; a home import; no `runner:leg-trees` | 22.17 refused; each runs, `close`/`handoff` in the wrapper; one install per digest; `off-branch` before install; install killed; `owner-cancel` within 30 s; kit fails duplicates; `cannot-finish:spec`; import refused; rule 4 |
| S-BTN-118 off-branch code never runs | a machine-key board on a feature-branch sha; a held rewrite claimed by a verifying and a fresh runner | `released:off-branch`, not failed, raised, want recorded; cached runner passes, fresh one `off-branch` |
| S-BTN-119 environment and masking | runner credentials and `credential:` values; legs requiring some; tokens and key blocks printed; a `setsid` child; replay with `replay_env` | each leg sees only its own; all masked; the child gone within 30 s; replay sees only the allowlist |
| S-BTN-120 a key's span | a second grant without flags; claim before accept; boards for both; `sync: true`; revoke; `accept-grant`, `decline-grant`; token keys; re-grant | `not-eligible` (rule 7); posts `forbidden`, `span-changed` raised; flag allows; pending until accepted; decline back to pending; token keys active; re-grant pending |
| **§9** | | |
| S-BTN-1 claim race | two claims of one ticket; a retried claim | one holder; the retry returns the same claim |
| S-BTN-2 silent runner reaped | a killed sidecar | reaped exactly at the timeout; re-issued; `pre-push` refuses its push |
| S-BTN-3 a long declared timeout | 12 h declared; 11 h and 13 h sleeps | not reaped; then reaped, push refused |
| S-BTN-4 hung runner force-reaped | a hung tool call; force-reap; again with a sidecar that re-keys after losing its state file, and with a `session`-mode leg whose runner went silent | unissued until `fence-cleared`; group killed before it pushes; the re-keyed one cleared at `fence_deadline`, `baton.fence-pending` raised at 30 min; the silent one fence-pending until the provider confirms the interrupt or the deadline |
| S-BTN-12 completion confirmation | an end before its sync; a push that never lands | unclaimable until a later snapshot; flagged at 6 h, never re-issued |
| S-BTN-17 one session, whole ticket | five `advance`s with no sync between | `filed` → … → `merged` on the holder's word, `bars` carried, ends `done`; no hand-off or `stale-board`; confirmed by the next sync |
| S-BTN-23 resume from a hand-off | W2 resumes W1's suspension | hand-off URL and resume record; same branch and PR; hand-off a PR comment |
| **§10** | | |
| S-BTN-68 the merge check | a confirmed `passed`; a new head; a same-named status; an unissued success; an edited owners' `checks`; a course file carrying `checks`; key rotation; a push right after a `done`, before the sync; a courier that stalls past its lease and posts an older `seq` | signed `success` only after confirmation; the ticket restarts on each new head, the unconfirmed `done` marked `superseded_at` and the new head claimable; the older `seq` skipped, or raised `check-mismatch` and the newest re-queued; status ignored; `check-mismatch` raised; owners' setting holds; course file refused; old runs verify |
| S-BTN-81 a check nobody sends | a `forge-check` entry undelivered 15 min; a work key claims the check | `baton.outbox-late` with `kind: forge-check`, change pending; refused |
| S-BTN-123 a forged check | posts without confirmed ends; a moved `check.sha`; a work key, a fork, an agent's verdict against the exit status, no `exit_status`, a `process` runner, a moved ref, a widened App; a machine-key post naming an older default-branch sha | no notice, `check-unattested`; restart on the new head; refused, dropped; verdict from `exec`; refused; `missing-capability`; `stale-board`; delivery refused; `released:off-branch` (`base_sha` not its ancestor), the command read from the branch tip |
| **§11** | | |
| S-BTN-30 signed requests | replayed, stale, revoked, non-administrator, cross-host and commit signatures; a machine key's reading for an unlisting instance; every key type | `unauthenticated`; `forbidden`; fresh ones pass with and without a body |
| S-BTN-32 owners and grants | two repositories, one owner each; grants, a cross revoke, last-owner removal, a hostname change, an owner's grant of `human-operator`; an admin key as runner; a sign-in code; a pending grant naming a key later added as owner elsewhere; an owner key revoked by an administrator; `admin.key.revoke` on an administrator line | grants per repository; `forbidden`; refused; `conflict`; the grant made, admitting a runner that declares `human-operator`; refused; the confirmed code opens a session ending with the key; the owner added, the grant's acceptance `conflict` without naming the role; removed from every repository, its sessions and MCP keys dead; `invalid-params` |
| S-BTN-97 the command tree | ambiguous, keyless and in-leg uses; CI without keys; `baton leg`; a typo; `--json` | exit 2 naming ids or role; CI signs by OIDC; channel verbs only in a leg; verbs listed; suggestion; JSON as is |
| S-BTN-100 one registry | every surface and caller; an unregistered route, bad `mcp` flag, bad id; a body mixing `hold` and `cancel` | one entry each; own actions only; `check:actions` fails; `404`; `invalid-params` |
| S-BTN-101 the MCP endpoint | mints within and beyond the allowlist; protocol, batch, origin, rate and paging edges; unconfirmed and out-of-scope calls; `{hold:false}`; a REST use | bad mints refused; protocol errors as specified; `confirm-required`; uniform `forbidden`; `invalid-params`; `rate-limited`; REST `unauthenticated` |
| S-BTN-102 one action, three ways | `leg.stop` by REST, CLI and MCP, allowed and refused | one core function, one output, `mcp:<name>`; one refusal code |
| S-BTN-103 an MCP key's life | `--ttl 120`; a new read action; idle 8 days; minter revoked; `api_keys: false`; revoke | refused; not listed; dead (`401`); `401` while off; `confirm-required`, then dead |
| S-BTN-124 MCP, sign-in, tokens | MCP hold edits; a replayed sign-in code; revoke all; token reuse, long TTL; destructive dashboard acts; polled-row eviction; an API key to `http`; an unverifying bearer naming an administrator's `bak_<id>` over `http`; an owner's session on its repository, on a foreign one and on an administrator route; an owner's code typed into `baton admin open`; the session's code confirmed by another owner key; the owner removed; `owner sessions revoke`; a session message of kind `handled`, and a `release` for a ticket the runner does not hold | only add-hold works; only the confirmed browser signs in; sessions ended; `unauthenticated`, `invalid-params`; `202 {confirm_code}` until the minting key confirms, Stop at once; oldest unbound dropped; key not sent; refused, nothing revoked; acts there, `forbidden`, `forbidden`; `not-found`; `not-found`; the session ended; every session of the key ended; `invalid-params`, `forbidden` |
| S-BTN-126 API keys beside SSH keys | an API-key administrator, owner and runner beside an SSH runner | bearers on their own routes only; runner secret checked; sync and courier `unauthenticated`; one role per key (`conflict`); revocation next call; sign-in by code |
| S-BTN-156 a board posted by a sync key | a checkout with no CI token and no `BATON_SYNC_TOKEN`; an ssh-keygen ed25519 key registered for it, a key of another repository, an unregistered key and one in the mirror role; an API-key file passed as `--sync-key` | with the one flag every call is an SSHSIG in `baton-request`, keyid the key's fingerprint, and the board lands under the key's repository (that of another repository too, never this checkout's); `unauthenticated` and `forbidden`, each posting nothing; the file refused by name, no call made |
| S-BTN-170 the dashboard state read with an administrator's key | an administrator, an owner of `ops`, a runner it granted that heartbeats | the administrator's signed `GET /v1/admin/state`, and its API key's, equal its session's `GET /v1/ui/state` at the same instant; an owner's key `forbidden`; an unknown key and no principal `unauthenticated`; a POST `not-found` |
| S-BTN-166 the state with a key | `baton admin repos`, `baton owner grants` and `baton board` on the seeded two-repository instance; an owner's key on its own repository and a foreign one; an administrator's key on an owner route; a granted worker key's board and heartbeat; an unknown key; a grant revoked; a key granted on two repositories | the registry's repositories, the repository's owners, grants and settings, the board's repository and ready sections, each one JSON answer; `forbidden` on the foreign repository and the administrator's key; the board answers and `granted_capabilities` names the key's grant on that repository, the same grant the heartbeat's answer names; `unauthenticated`; `forbidden` after the revoke; each grant naming the other repository |
| **§12** | | |
| S-BTN-180 protected landing | a `protected` repository; an untrusted runner; the forge protection printed by `baton repo protect` | the runner's push to the default branch, a tag, `refs/baton/*` or a ref outside `branch_pattern` is refused by the forge; an untrusted grant on a `cooperative` repository is refused while a grant without a trust level runs there; a second grant in one trust domain is refused under `protected`; a changed ruleset raises `baton.unprotected` and stops trusted runners |
| S-BTN-181 attestations | types with `human`, `owner`, `service` and `baton` writers; a reading-gated leg (`instance: account-funds`, `where balance_usd gte 50`, `writers: [service:<instrument>]`, `binds: gate`, `missing: block`); a course type without `writers` | an attestation about work from a credential that may not write one is refused; a `trusted` leg requiring an `owner` writer, or binding as `advice`, is refused by the validator; a `once` attestation is consumed once; a revoked or lapsed one blocks the leg with its `why`; the funds leg refused `failed-where` below 50, `missing` with no reading in force, offered once the instrument reports 60, and still refused on a runner's reading of 60; the course refused |
| S-BTN-182 trusted legs | a `merge` leg marked `trusted: true` | an ordinary runner is never offered it and cannot claim, advance or end it; a `merge.run.mjs` can refuse but not approve, and its `reasons` outside the closed list are dropped |
| S-BTN-183 what merges | a ticket written by one domain, reviewed by two others of different model families that ran none of its code | it merges at the attested head; a review from a domain that ran the branch's code does not count; a foreign commit resets the branch and raises `baton.foreign-commit`; under `authorship: signed` an unsigned or foreign-signed commit blocks it; a merge of main into the branch does not; a push after review returns it to review; a rename, symlink or submodule into a protected path is refused |
| S-BTN-184 protected paths | a PR changing `.baton/`, one changing tickets, one appending own progress | the first ends at `human-merge`; the second merges only with a matching `std:approval@1`; the third merges when every entry matches the grammar and the claim, and is a ticket change otherwise |
| S-BTN-185 human gates | an owner's agent key; a `human_only` key | the agent key's approval, writer-policy change or hold lift is refused; the `human_only` key's succeed; a `human_only` key registered without an existing one's signature is refused |
| S-BTN-186 any surface | one owner, one action, the CLI, the API and an MCP key | each succeeds where `callers` allow it; an MCP key may add a hold and never lift one |
| S-BTN-188 a sync writes only what changed | twelve tickets placed with next legs and bars; a refresh and a new head that change nothing; a new head moving one ticket, then a refresh flipping its leg and dropping a bar; a suspension at the station a snapshot already showed, then a refresh posting it unchanged | no station, next-leg or bar row rewritten; that ticket's rows alone rewritten, its unchanged station row kept; the refresh confirms the end without rewriting the row (R-BTN-70, R-BTN-62) |
| S-BTN-187 board posts | a `protected` repository | a machine key's post is refused; a truncated delivery fails closed; a station a trusted leg acts on is not reached from a git verdict |
| **§16** | | |
| S-BTN-14 mirror preconditions | a reap after `in-review`; a replay; a stale clone's git claim | no overwrite; no-op; reverted, holder kept |
| S-BTN-16 cutover | an in-flight git claim at cutover; a clone that saw cutover offline; one session holding two git claims; two runners with one `session_name` on different hosts request one adoption; a silent legacy runner | imported legacy claim, adopted after an administrator confirms; no git claim; two legacy runners; `{pending: true}` to both, the confirmed one adopts, the other `forbidden`; not reaped before `reap_after` |

### Gates

| Gate | Must hold | Proved by |
|---|---|---|
| **§1** | | |
| G-BTN-41 | No mirrored note, subject or export names a session, runner or host | tests |
| G-BTN-49 | Advice never refuses (the override is recorded `advice-overridden`); R-BTN-45's gates always refuse | S-BTN-24 |
| G-BTN-50 | Markers carry their claim's nonce; a foreign one logs `foreign-write`, never reverted (a first snapshot only seeds `markers_seen`); no commit or signature is checked | S-BTN-25 |
| G-BTN-53 | `src/` names no course vocabulary outside a shrinking exceptions list; a toy course runs the generic scenarios | S-BTN-28 |
| G-BTN-59 | `stale-board` only when the ticket is withdrawn, re-tiered above the ceiling, dropped without `closed` or fails an open-world author or posted-state gate; a shorter path sets `regressed_since`, raised after 30 min, never acted on | S-BTN-17, -34 |
| G-BTN-84 | Baton loads, stores and calls no repository code; recommendations are gates plus the default order | S-BTN-57 |
| **§2** | | |
| G-BTN-56 | `src/core/` imports no `cloudflare:*` module; every scenario passes on the hosts it runs on | S-BTN-31 |
| G-BTN-77 | At the envelope (50 runners, 20 repositories, 5,000 tickets, 1,000,000 history rows, 20 req/s, bursts of 100 in 5 s) no error and every route within p99; 80% logs `capacity` and is raised; nothing refused past 100% | load test |
| G-BTN-130 | A request is served only at its origin and authenticated only in its tenant; no data crosses tenants | S-BTN-111 |
| G-BTN-131 | No `src/core/` function takes a tenant id; one helper names objects (`idFromName('baton')`, `'baton/<kind>/<key>'`); inbound `x-baton-tenant` stripped | static check, unit tests |
| G-BTN-132 | A runner serves only its origin and refuses one key for two | S-BTN-112 |
| G-BTN-134 | Clients back off and report `too-large`; lease upkeep has its own bucket and is never refused; failed verifications are bounded per credential and IP without refusing one that verifies | S-BTN-114 |
| G-BTN-142 | Caps refuse oversize items, never upkeep; observation numbers can be taken over; readings and bills are bounded and clearable | S-BTN-122 |
| **§3** | | |
| G-BTN-11 | A sync OIDC token from a branch or another workflow is refused | tests |
| G-BTN-51 | Everything is per repository; a sync credential reaches only its own; runners see only declared courses at `min_runner_version`; a branch maps to every ticket a current or previous `branch_pattern` gives, and a collision refuses the push while either is held | S-BTN-26 |
| G-BTN-61 | Recommendations merge groups by expedite, weight, place, legs to an end, `ready_since`, id; the limit is per group; every ready ticket has a rank | S-BTN-26 |
| G-BTN-68 | Webhooks are verified before reading; only R-BTN-73's fields are read; dispatch only for named repositories, never for Baton's own events, ≤ 1 per 30 s plus a trailing one | S-BTN-42 |
| G-BTN-82 | A sync authenticates by a sync key in that role, a machine key the repository lets sync, or a CI identity token, through one verifier; revocation acts at the next request | S-BTN-55, -56 |
| G-BTN-83 | A want is cleared only by a post numbered above it; `wanted` changes only its nonce; notifications only record wants; Baton's database holds no forge credential (dispatch credentials and webhook secrets are Worker secrets) and Baton draws links only under `web_base` | S-BTN-54, -56 |
| G-BTN-125 | A ticket's PRs across repositories are read under one budget, batched over GraphQL, as one change | S-BTN-106 |
| G-BTN-133 | Stored forge ids decide every token, delivery and notification; renames onto a live path are held; fences follow former paths only while free; retired rows are tombstones | S-BTN-113 |
| G-BTN-135 | No fork PR found by pattern and no verdict, approval or marker from a non-pusher counts, failing closed | S-BTN-115 |
| G-BTN-136 | Reach beyond the home is only `code_repos`; patterns follow the grammar; input digests are verified before a leg runs | S-BTN-116 |
| G-BTN-145 | CI tokens pass only for push, schedule or dispatch runs of the top-level default-branch workflow; a notification wants only its repository; import re-validates and refuses pre-seal signatures; the local host binds loopback and refuses unsafe file modes | S-BTN-125 |
| **§4** | | |
| G-BTN-7 | A post whose `parent_sha` is not the head is refused `head-moved`; a non-descendant (`force`) is held and raises `baton.held-history` | tests |
| G-BTN-18 | An older push's sync never moves the head back | S-BTN-13 |
| G-BTN-39 | `tickets` holds no body or note; only changed rows are rewritten; a runner missing the snapshot commit fetches once, else releases `stale-board` | tests |
| G-BTN-42 | `locate` gives each fixture ticket the leg states its repositories and PRs imply; Baton overrides it only by R-BTN-83's held overrides | S-BTN-17, -18 |
| G-BTN-62 | Posts carry an observation number handed out before reading, accepted whole only above the last; ends and staleness are judged only by a greater number; a strict-ancestor checkout posts nothing | S-BTN-36, -40 |
| G-BTN-69 | With no `.baton/tickets.mjs` or course `sync.mjs`, `baton repo sync` posts the default markdown source's tickets on `create-pr` with stations from PR facts; a duplicate id, an unmapped `repos` name or another course without `sync.mjs` fails the sync; an ejected file replaces the default for its repository alone; the default source is the CLI's, never core's | S-BTN-43 |
| G-BTN-73 | Every result's `(reached, next)` is written to git before reporting and held provisional until `locate`; `next` is never inferred; a removed queued leg waits `course-changed`; route, choice, timer and retry overrides hold until the station changes, cancel and outbox ones until their write lands | S-BTN-47 |
| G-BTN-75 | Every override of a Baton value by git logs a `discrepancy` in the adopting transaction, never delaying it | S-BTN-47 |
| G-BTN-76 | One holder, one position; children are files with a same-repository `parent`, reported `spawned` (≤ 50, never the parent); unposted ones are `spawned-unposted`; an invalid `parent` is dropped and logged; an open child blocks its parent only through a call | S-BTN-49 |
| G-BTN-78 | Freeze is undoable until seal; seal needs no active claim and every mirror acknowledged; a sealed source answers `sealed`; export is identical and exactly R-BTN-88's sections; import is one transaction into an empty Baton of the same schema | S-BTN-50 |
| G-BTN-86 | An unknown ticket is claimable only at its `start_leg`, under every credential gate, one per key, unadvanceable until a post containing its commit settles it; unsettled after 60 min it ends `unknown-ticket` | S-BTN-58, -121 |
| G-BTN-141 | An unfounded machine-key head is replaced at once, never by a known sha; a lagging fetch posts nothing; held posts only tighten and close nothing; acceptance adopts only a later force post; a misdeclared open-world claim is a failed attempt tainting the branch, a posted-state gate failing at its sha a `stale-board` tainting it | S-BTN-121 |
| **§5** | | |
| G-BTN-32 | Below `min_runner_version` a runner gets no new claim but keeps and advances its own | S-BTN-15 |
| G-BTN-36 | A `protocol_files` change without a `version` bump fails CI | tests |
| G-BTN-58 | A runner whose tags meet a leg's `barred_tags` is never offered it and is refused `barred-tag`; core never interprets a tag | S-BTN-33 |
| G-BTN-63 | An `advance` needs an edge from the station, `max_runs` room, every holder gate and the holder's word; old names resolve through `renamed_from`; a course file with unreachable stations or ends, unbounded loops or legs leaving an end is refused and the previous kept | S-BTN-17, -34, -37, -40 |
| G-BTN-64 | A renamed station or leg carries a claim and every per-leg record (attempts, backoff, timers, blocks, needs, held positions) over; a removed one ends `course-changed`, never failed; stats only for granted keys | S-BTN-37, -38 |
| G-BTN-66 | Owner bars join posted barred tags on time; a leg missing a required bar's prefix waits on `policy`; bars, tiers, retry and transcript repositories come only from Baton settings | S-BTN-39 |
| G-BTN-71 | A queue over `max_queue` raises `baton.queue-over` and closes the course to new unexpedited tickets as advice; nothing is held, blocked or refused | S-BTN-45 |
| G-BTN-74 | A leg with missing or unaccepted inputs waits `input-missing`/`input-version`; inputs and outputs are validated (`contract-input` held with `baton.contract`; `contract-output` failed); markers only from validated results; Baton stores URIs and digests only; replay writes nothing | S-BTN-48 |
| G-BTN-91 | A value is valid only against its schema and every base; one validator module serves every part | S-BTN-65 |
| G-BTN-92 | An arrival lacking entry outputs is refused; an invalid posted pointer is never resolved | S-BTN-66 |
| G-BTN-98 | Capabilities are of declared types or built-in; a checked capability is declared only while its check passes; `<type>:*` grants cover the type | S-BTN-73 |
| G-BTN-100 | Renderers escape or text-set every value and link only to `web_base` or `link_hosts` | S-BTN-76 |
| G-BTN-102 | Schemas with a changed digest, outside the subset, cyclic, or under `std:` or another course's prefix are refused; schemas are per repository | S-BTN-79 |
| G-BTN-109 | An `epic` call settles `built` only when every child of its run closed `done`, else `planned` once all closed, so `replan` answers every withdrawal | S-BTN-89 |
| G-BTN-123 | A standard course needs no course code; markers place tickets, bad ones move nothing; instructions are read at the snapshot; a stub reads an answer line with prose around it and still fails one missing or misspelled, naming what it read (B-85) | S-BTN-104 |
| G-BTN-124 | A `<leg>.run.mjs` replaces only that leg's run, never its `close` | S-BTN-105 |
| G-BTN-126 | A `build-app` leg never starts on an unapproved document; `verify` never while a child is open, because `file` and `verify` are call legs | S-BTN-107 |
| G-BTN-129 | The CLI holds no course; a course is read from one directory at one full, default-branch-reachable commit, never fetched by id; the home holds only overrides | S-BTN-110 |
| G-BTN-137 | Bars name legs literally; removing or renaming a barred or exempt leg holds the file; `renamed_from` collisions are refused | S-BTN-117 |
| G-BTN-159 | An ontology's gate stratum is monotone in the granted holdings and derives only capabilities of a declared derived type, never `credential:`, `runner:` or `human-operator`; readings, time and route choices never reach rule 4; rule 4 never reads a derived set computed under another program or other holdings | S-BTN-140, -142, -146, -152 |
| G-BTN-160 | Core's evaluator agrees with clingo on every fixture; evaluation is bounded by counts, alike on both hosts | S-BTN-146, -154 |
| **§6** | | |
| G-BTN-10 | For one course, matching's order equals the course's claim order filtered by the matching rules | fixture boards |
| G-BTN-40 | The matching query and `isEligible` agree on every fixture | fixture boards |
| G-BTN-47 | Recommendations follow the default order (expedite, resume before start, rank, age, id) and pass every gate | S-BTN-19, -22 |
| G-BTN-70 | Blocks are written in the transaction changing their cause and read from one index; every kind refuses as R-BTN-75's table says, a `resource` row only where its requirement binds as a gate; lapsed readings are `unknown`; no fleet row without a live runner; `blocked`/`unblocked` transitions message idle runners and dispatch once, capped at 100 | S-BTN-44, -45 |
| G-BTN-79 | `not_before` comes only from git, validated (≤ 400 days, else `not-before-invalid`); a `time` wait raises nothing; the alarm readies it at the instant; series runs write one successor each, after their predecessor | S-BTN-51 |
| G-BTN-85 | `prefer` takes the first passing entry in one transaction or reports each refusal; with `ticket_id` it is `invalid-params` | S-BTN-57 |
| G-BTN-88 | Each instrument session's latest reading is kept; only `state` readings set state; billings count across repositories; tickets and hosts shown only where granted | S-BTN-61 |
| G-BTN-97 | A leg is offered only when every prerequisite holds; each unmet one is a block row on the leg | S-BTN-72, -74 |
| G-BTN-104 | Cycles keep their blocks and are raised; a withdrawn ticket meets nothing; `reached` reads a closed ticket's final path | S-BTN-82 |
| G-BTN-111 | A `resource` blocked end stores its reading and need and writes the row in one transaction, spending nothing | S-BTN-91 |
| G-BTN-112 | A `capability` blocked end drops the capability at once; a row only when no live runner holds it | S-BTN-92 |
| G-BTN-113 | A `ticket` or `decision` blocked end's row is provisional, raises nothing, and is confirmed only by a snapshot containing its commit, else dropped after an hour | S-BTN-93 |
| G-BTN-114 | An invalid prerequisite is a counted `cannot-finish:transient`; an error naming a valid one is never retried | S-BTN-93, -94 |
| G-BTN-115 | Blocked ends per (ticket, leg) past `max_blocked` in 24 h hold the ticket with `baton.retries`; call blocks are not counted | S-BTN-95 |
| G-BTN-116 | Every view draws legs as edges with state in colour and text, and no station the file lacks | S-BTN-96 |
| G-BTN-127 | Ticket prerequisites reach core only as `requires.tickets` (`parent`, `posted`) or `depends_at`, and a parent waits on its children only through a call; `human-operator` by rule 4; `waiting_on` is never `dependencies`, `children`, `owner` or `policy` | S-BTN-108 |
| G-BTN-162 | A bill past an instance's capacity is never admitted, a claim's own seats never counting against it; a capacity lowered below the seats held takes none back; seats are released at every leg end and claim end, at a silent reap, and after the fence for a fence-pending reap; a seat refusal is never a failed attempt | S-BTN-21 |
| G-BTN-161 | A route choice's advice never refuses, carries identifiers only, and a reported `taken` alternative other than the advised one records `advice-overridden` | S-BTN-153 |
| **§7** | | |
| G-BTN-31 | Only listed ends are failed attempts; the owners' default backs off 1 h, then 4 h; the third failure or a non-retryable condition holds with `baton.retries` | S-BTN-5, -6, -7 |
| G-BTN-80 | An interrupting `start` timer re-arms to 40 min on `leg_finished`; at it `leg-timeout`, a failed attempt, then a fenced reap at +15 min; `extend_to` and `cancel_at` ≤ 7 days ahead, Cancel lapsing with its claim | S-BTN-52 |
| G-BTN-105 | Backoff is a `retry` block until `retry_after`, jittered ±10%, per ticket and leg | S-BTN-83 |
| G-BTN-106 | A non-retryable `interrupt` type holds at once; an untyped error is `error.transient`; in-claim retries count as nothing | S-BTN-84, -85 |
| G-BTN-107 | The policy in force is field by field the stricter of course and owners; the floor binds built-in types; a `first_attempt` timer ends retries; a leg reaching an outcome resets its attempts and budget | S-BTN-6, -86, -87 |
| G-BTN-146 | A raise is checked and reported before effect; its handler (a light one's question, off the branch) is pushed before it returns; no subject or body is stored; legs cannot raise `baton`, `baton.*` or `hitl.decision` | S-BTN-127 |
| G-BTN-147 | A `suspend` waits ≤ `min(wait_s, max_wait_s)`, resumes only on an offered, valid restart (else `contract-input`), and past the wait blocks with no failed attempt; any other end or reap of the wait blocks on the condition too, so no question is asked twice; no answer is lost; withdrawn → default | S-BTN-127, -128 |
| G-BTN-148 | Resolution is innermost scope, then repository, longest prefix; `suspend` binds only to courses ending in `std:restart@1`; unmerged bindings are inert | S-BTN-130 |
| G-BTN-149 | Open `hitl`, `baton.retries`, `baton.contract`, `baton.stalled` and posted decisions stay on Needs you until closed; a core condition's handler never closes it; `resolve` invokes only offered restarts | S-BTN-131 |
| G-BTN-150 | A call settles on the first holding entry, in table order, over its run's children, never over none; `settleCall` agrees | S-BTN-132 |
| G-BTN-151 | A choice settles to the first leg whose confirmed prerequisites hold by Baton's clock, ties by order; it holds until the station changes; later arrivals are `choice-lost`; an `after_s` instant survives a Baton move and restarts only with the station | S-BTN-50, -129, -133 |
| G-BTN-152 | Each timer fires once per `from` instant; interrupting ones release and fence; contradictory timers, a timer `leg` on a choice station and the retired course fields are refused; one override of `baton.stalled` per leg | S-BTN-134 |
| G-BTN-153 | A superseded claim is released `superseded` in the settling transaction; `baton.cancel` compensates in reverse path order before withdrawing | S-BTN-129, -132 |
| G-BTN-154 | Baton queues nothing for a person; the outbox's only kind outside git is `forge-check` | S-BTN-68, -131 |
| G-BTN-156 | Baton holds no credential to write git or post a check, and does both only through signed outbox entries couriers deliver, each carrying its id and applied at most once, git kinds in id order per ticket; only a key the repository's `outbox_policy` admits claims an entry, and loosening the policy is a loosening change (R-BTN-186); a queued entry whose condition closes is dropped, and followed by a `withdraw` when any courier claimed it; an entry late by its kind raises `baton.outbox-late` | S-BTN-136, -81 |
| G-BTN-158 | A light question settles once, in the claim or from git, never both; a reply is applied, queued to the ask file or recorded `ignored`, never dropped; no claim of the leg runs while its question is open; a settled answer is carried in `resume` until an end records it in git; an outbox `answer` never overwrites an answer in the file; `model/lightQuestion.qnt`'s `full` holds its safety and no-lost-answer properties | S-BTN-138 |
| **§8** | | |
| G-BTN-5 | A heartbeat without its session's secret is refused; a key cannot claim another hostname or an ungranted repository's course; an ungranted holding never counts for a claim, though what the ontology derives from granted holdings does (R-BTN-174) | hostile-key tests |
| G-BTN-17 | A retried first heartbeat is idempotent; a re-key revives a reaped, claimless runner | tests |
| G-BTN-67 | The runner knows no course: it loads verified trees at the claim's commit, follows only named edges, holds the claim only on `short_waits` (≤ 30 min), suspends on `max-runs` and regression with a hand-off, aborts on release or lost lease, ends `course-changed`; leg sessions never claim | S-BTN-41 |
| G-BTN-81 | The doorbell carries rings only; a lost socket changes only latency; ≤ 1 ring a second plus a trailing one; it closes on reap, re-key, revocation, liveness loss and seal | S-BTN-53 |
| G-BTN-87 | A granted machine key may sync (not mirror) unless turned off, and report on instances listing a granted repository; each post records its credential; it is never an owner or administrator key | S-BTN-59, -61 |
| G-BTN-89 | A session's move reaches Baton only after the runner checks it; a session never holds a runner secret | S-BTN-62, -78 |
| G-BTN-90 | `no_chain_from`, `required_independence`, `runner:session` and person legs refuse claims and advances; a person's leg's decision carries the leg's `asks` | S-BTN-63, -64, -67 |
| G-BTN-94 | A token-registered credential stays within the token's scope and dies with it; API keys are refused under `api_keys: false` | S-BTN-69 |
| G-BTN-96 | A release stops the leg's process group within 30 s and reports no output of it | S-BTN-71 |
| G-BTN-99 | A bounded run claims only named legs, at most `n` per claim, none after `until` | S-BTN-75 |
| G-BTN-101 | A `session_url` is kept only on an allowlisted `https` host, without userinfo, ≤ 512 characters | S-BTN-77 |
| G-BTN-108 | A full context refreshes under the claim at most `max_refreshes` times, uncounted, then suspends | S-BTN-88 |
| G-BTN-118 | Leg logs are written only while `leg_log_root` is set, to the directory Baton named, create-only, masked before framing, ≤ 50 MB a run, never delaying the end; Baton keeps only the directory and holds no bucket credential; `leg log` strips every escape and exits 1 when it cannot read | S-BTN-98 |
| G-BTN-119 | `leg log` reads runs only for the repository's owners and administrators, and follows a running leg's chunks in `seq` order until `end.json` | S-BTN-99 |
| G-BTN-128 | Leg code loads only from verified, stamped, read-only worktrees and lockfile installs at default-branch commits; `close`/`handoff` run outside the runner's process; Node's own resolution; `runner:leg-trees` gates such legs | S-BTN-109 |
| G-BTN-138 | A runner reads nothing at a sha off the default branch, except a held rewrite's head it verified before | S-BTN-118 |
| G-BTN-139 | Legs get only the `credential:` variables they require and never Baton's; the masked set covers every credential, token and key block; stopped legs' processes are gone in 30 s; replay uses an allowlist | S-BTN-119 |
| G-BTN-140 | A pending grant gives nothing until accepted; declining is logged; a key of span ≥ 2 syncs only where its grant opts in | S-BTN-120 |
| **§9** | | |
| G-BTN-1 | Two concurrent claims for one ticket, or two by one runner: exactly one succeeds | tests |
| G-BTN-2 | A repeated `request_id` from the same runner returns the original claim; another runner's never matches | S-BTN-1 |
| G-BTN-3 | A claim is reaped at its runner's clamped timeout, not 1 s earlier | fake clock; clamp 899 / 86401 / absent |
| G-BTN-4 | A sidecar unable to heartbeat for `timeout − 4 min` marks the lease lost | tests |
| G-BTN-6 | A completion is confirmed only by a later-observed snapshot showing it; unclaimable until then | tests |
| G-BTN-14 | A force-reaped claim of a live runner, and any reaped claim running a `session`-mode leg, is not re-issued until `fence-cleared` or its `fence_deadline`, which nothing the runner does extends | S-BTN-4 |
| G-BTN-15 | With the lease lost, the harness's pre-tool hook denies pushes, merges and status writes | tests |
| G-BTN-16 | A non-holder's status write succeeds with no live holder and is refused with one | tests |
| G-BTN-20 | A lost lease kills the tool call's process group before `fence-cleared`; `pre-push` refuses, even with a crashed sidecar, after sleep, or a hung heartbeat | S-BTN-2, -3, -4 |
| G-BTN-21 | A re-key never clears a fence; a refused heartbeat marks the lease lost | tests |
| G-BTN-23 | Transcript `repo`s outside the allow-list and paths with `..` are refused; links only to the transcript repository | tests |
| G-BTN-24 | Activities upsert; another runner's ids are refused; closes within 10 min of the end accepted; open ones close `abandoned`; `claim-ended` never marks the lease lost | tests |
| G-BTN-25 | A harness hook records an activity without blocking; offline, the spool keeps it | tests |
| G-BTN-26 | A reviewer with `BATON_PARENT` starts no sidecar or runner; its transcript lands on the parent's activity | tests |
| G-BTN-27 | Harness hook matchers recognise pushes, PR creates and merges, and reviewer spawns in compound lines | tests |
| G-BTN-33 | A claim response carries earlier claims' resume records | S-BTN-5, -23 |
| G-BTN-38 | No environment variable changes `batonNow()`; `clock-offset` only from a loopback `--test-harness` sidecar; `pre-push` asks Baton | tests |
| G-BTN-43 | `advance` moves to the next leg whenever the gates pass, in one transaction; a refusal changes nothing | S-BTN-17, -19 |
| G-BTN-44 | A suspension is confirmed by a later path extending it by edges; `done` by an end station or closure under a greater observation, or absence; claimable only after a later snapshot; suspensions, `course-changed`, `unknown-ticket` never fail; every end writes a resume record and every self-release a hand-off | S-BTN-18, -20, -23, -36, -40 |
| **§10** | | |
| G-BTN-93 | A `success` check is queued only after a confirmed end, with the owners' conclusions, signed with a named key; unissued runs are logged; a courier is never a machine key | S-BTN-68 |
| G-BTN-103 | Only check-runner keys claim check tickets, their `check_runners` row standing in for a grant (rules 4, 5, 7); an unsent `forge-check` is raised after 15 min | S-BTN-68, -81 |
| G-BTN-143 | A concluding check comes only from a confirmed check-runner end for its bound sha; no post, work key, fork or agent report yields `success` | S-BTN-123 |
| **§11** | | |
| G-BTN-55 | Every keyed call is an RFC 9421 SSHSIG in namespace `baton-request` by a registered key, covering `@authority` and body digest, within 5 min, nonce unseen — or the holder's API key | S-BTN-30, -126 |
| G-BTN-57 | Keys and grants only in SQLite, administrators only in the admin set; one role per key, a never-accepted pending grant holding none — a machine key's grant may sync (R-BTN-102) and post readings for instances listing a granted repository (R-BTN-101), and it never holds the instrument, sync-key or mirror role; owners act only on their repository and never remove the last owner; a dashboard session needs a sign-in confirmed by a key of its role, and an owner's session acts only on its key's repositories, never as an administrator | S-BTN-32, -124 |
| G-BTN-117 | Commands are `baton <noun> <verb>`, signing as the first role in their actions' `callers` they hold a key for; ambiguous ids name their matches; channel verbs only inside a leg | S-BTN-97 |
| G-BTN-120 | Every surface is a registry entry under one `authorize`; callers see only their actions; destructive actions need `confirm` everywhere; `check:actions` enforces it | S-BTN-100, -102 |
| G-BTN-121 | An MCP key reaches only its allowlisted ids on one repository via `POST /v1/mcp`, never administration, machine protocols, credentials or owner changes; refusals answer alike | S-BTN-101 |
| G-BTN-122 | An MCP key's ids are fixed at minting; it dies with expiry, 7 idle days, its minter or revocation; refused while `api_keys` is `false` | S-BTN-103 |
| G-BTN-144 | MCP never lifts a hold or expedites; sessions go only to the browser a key holder bound, with that key's role, die with that role, and can be ended; an owner's session reaches only its key's repositories and no administrator action; tokens are single-use by default, ≤ 100 uses and 30 days, and register runners only | S-BTN-124 |
| G-BTN-155 | An API key authenticates only as its holder in one role on administrator, owner, runner and read routes; it never syncs or reports as a probe | S-BTN-126 |
| **§12** | | |
| G-BTN-12 | Dashboard writes without a same-origin `Origin`, a JSON body and a session are refused | tests |
| G-BTN-13 | Free text with `{`, `<` or control characters is refused; the dashboard never sets `innerHTML` | tests |
| **§15** | | |
| G-BTN-37 | Every scenario here passes on its hosts (`npm test`) | `npm test` |
| **§16** | | |
| G-BTN-8 | The mirror never overwrites an unexpected status; a replay is a no-op | S-BTN-14 |
| G-BTN-9 | Mirror commits parse identically with docs' readers | tests |
| G-BTN-22 | A foreign git claim never makes the Baton holder release | S-BTN-14 |
| G-BTN-19 | The cutover import makes one legacy runner per ticket; adoption only after an administrator confirms | S-BTN-16 |
| G-BTN-35 | Cutover is one-way; a checkout that saw it never claims through git; CI flags a `cut_over` flip | S-BTN-16 |

## 16. Adoption *(partly built — R3-1208, R3-1216, R3-1220)*

A repository registered with no git claim protocol of its own starts cut over and needs
nothing here. A repository that already coordinated through git — the reference deployment,
docs, with its `claim.sh` — moves to Baton in steps, and may keep a git mirror for readers
that predate Baton. What a cutover changes in docs' own text is in docs'
`BATON_DOCS_DEPLOYMENT` §15.

### 16.1 Cutover

- **R-BTN-28 (cutover is one-way server state).** Cutover is per repository:
  `repositories.cutover_at`, set once; no call clears it. A repository registered with
  `cut_over: true` (`POST /v1/admin/repositories`) starts cut over.
  - **Before cutover** Baton shadows git. Runner claim calls return `not-cut-over`; the
    repository's git claim tool claims through git and reports each transition to
    `POST /v1/runner/shadow-report` (`{transition: claim | set, ticket_id, status, nonce,
    at}`). Baton records and decides nothing; a report its constraints refuse (a second active
    claim, an unknown runner) is logged `shadow-conflict`.
  - **The act.** An administrator sends `POST /v1/ui/cutover {repository, confirm: true}`,
    answered `202 {confirm_code}` and performed by `baton admin confirm` (R-BTN-155).
  - **After it** the git claim tool reads the mode from `GET /v1/runner/mode?repository=`
    (`{mode, cutover_at?}`; the heartbeat carries `mode: {<repository>: shadow | cut-over}`)
    on every run and keeps a local sticky marker (`~/.cache/immediately-run/baton/cut-over`)
    that nothing removes, so a checkout that has seen cutover never claims through git again,
    reachable or not. For docs, `scripts/data/baton.json` carries `"cut_over": true` as a
    hint for a fresh clone, and CI flags any commit that changes it, and any claim commit the
    mirror did not author.
- **What the cutover does**, in order:
  1. **Drain.** The fleet's sessions stop before the flag and restart from a pulled checkout
     after, so none runs a pre-cutover claim tool; one the drain missed is reverted by the
     mirror (§16.3) and stopped by its owner.
  2. **Legacy import.** Each ticket git shows claimed with no Baton claim becomes an active
     claim of its own `legacy` runner (`kind: legacy`, `hostname: legacy`, `session_name` the
     claim note's session or `item-<id>`, credential `legacy`, an unusable secret hash) at the
     posted station, with that path as `start_path` and `reap_after` the note's date plus 7
     days. Legacy runners are exempt from `(hostname, session_name)` uniqueness, so one session
     that held several git claims has a legacy runner per ticket. A legacy claim is reaped at
     `reap_after`, never by silence (lease expiry skips `legacy` runners); R-BTN-7 refuses a
     status write only against a non-legacy holder.
  3. **Adoption.** A runner whose `session_name` equals a legacy runner's requests the claim
     (`POST /v1/runner/adopt {ticket_id}`), which records an `adoption_requests` row and answers
     `{pending: true}` until confirmed. It moves only when an administrator confirms that
     runner's request (`POST /v1/ui/adoptions/{claim}/confirm {runner_id}`, a confirm code; the
     dashboard shows each requester's hostname and session name); other requesters are then
     refused `forbidden`. The adopted claim keeps its
     station and `start_path` and runs no leg; the adopter's first `advance` re-enters the leg
     it was running, under its own lease.
  4. **The flag** (R-BTN-28), after which the claim tool calls Baton, status writes are fenced
     (R-BTN-7) and the mirror goes live.
- **Preconditions.** Workers Paid (R-BTN-2); the repository's owner bars and required bars set
  (R-BTN-67); the checked model and its trace check green (R-BTN-68); the load test passing at
  the envelope (R-BTN-87); every registered forge repository's immutable ids stored
  (R-BTN-138); legs live with their scenarios green (§15).

### 16.2 The reference deployment's rollout

| Step | What runs | Exit | Ticket |
|---|---|---|---|
| 1. Read-only view | board sync and dashboard at `https://baton.immediately.run`; no runners, no claims | for each tier, the Ready view's order equals the course's own claim order on the same snapshot | R3-1208, R3-1209 |
| 2. Shadow | sidecars heartbeat; git claims are reported (§16.1) | one week in which every git claim has a Baton claim; `shadow-conflict` events and the reaps the alarm would have made are reviewed against the git-side reaper's; `locate` is recorded for every live ticket against what sessions did | R3-1216 |
| 3. Cutover | §16.1 | verified | R3-1220, R3-1221 |
| 4. Consumers | docs' git-side stale-claim sweep retires (the alarm reaps); its buffer and in-review sweeps stay, asking Baton's holder query (R-BTN-7) before acting | — | — |

### 16.3 The git mirror

A **mirror** is optional, per repository: a workflow (`mirror_workflow`, or a `mirror`-role
sync key, R-BTN-93) that writes Baton's claim events into git for readers that predate Baton. The
baton repository runs none, and work on Baton writes nothing to the docs repository, whose
tickets concern the other immediately.run projects; docs keeps its mirror for those tickets until
its readers read Baton's API, and then retires it.

- It reads its own repository's events from `GET /v1/sync/events?after=`; each read's `after`
  acknowledges everything up to it, clamped to the last `seq` a read returned to the mirror, so
  an `after` beyond what it was given acknowledges nothing unseen; kept as
  `repositories.mirror_acked_seq`, which a seal
  waits for (R-BTN-88). It is wanted while an event of a kind it writes has a seq above
  `mirror_acked_seq` (R-BTN-94), with a 15-minute schedule as fallback; a run ends with one
  read at its final cursor.
- **One commit per ticket transition**, authored `Baton mirror <baton-mirror@immediately.run>`
  (with `mirror_pusher`, the identity R-BTN-73 recognises to drop the mirror's own pushes) with the event's time as
  author date (`GIT_AUTHOR_DATE`). For docs: subjects `roadmap: claim <id>` and
  `roadmap: <id> → available`, and the note `_claimed <date> — <repos> (claim <nonce>)._`.
  Nothing names the holder (R-BTN-36).
- **R-BTN-17 (preconditions, or skip).** A transition is written only over the status the
  event expects: `claimed` writes `in-progress` only over `available`; `released` and `reaped`
  write `available` only over `in-progress`. Any other status — the runner already moved the
  ticket on, a peer changed it — skips and logs the event; nothing is overwritten. Delivery is
  at least once and idempotent: the cursor advances only after the push lands, a replayed
  event fails its precondition or writes the same bytes, and a rejected push re-fetches and
  re-applies.
- Only claims that start at the course's start leg are mirrored; a claim resuming a suspended
  ticket, its advances and its end write nothing. An `override` setting expedite adds the
  `EXPEDITE` tag, and a `held` event writes a Status note naming its `hold_reason`, removed when
  the hold is lifted (R-BTN-12); neither changes the status.
- **Foreign claims.** A claim commit the mirror did not author, over an active Baton claim, is
  overwritten with the holder's status and note and logged `foreign-claim`; the holder keeps
  its claim (G-BTN-22). With no Baton claim it is imported as a legacy claim during the cutover
  step (§16.1), and reverted and logged `foreign-claim` after it. This is the one place a
  writer for Baton writes git over another writer.
- **Export.** Events, and each ended claim's activities and transcript pointers (runners named
  only by claim id), are appended as JSON in a fenced block to the repository's export file
  (docs: `content/plans/baton/claim-events.mdx`); the fence is a backtick run one longer than
  any in its text, at least three, and the mirror lints the file before pushing (§12.3,
  R-BTN-17).

## Load-bearing assumptions

Every claim this spec rests on about code that exists today is about the reference deployment's
code (docs' `claim.sh`, its factory-state library, its skills and harness hooks). The table is in
docs' `BATON_DOCS_DEPLOYMENT` §16, where `check-spec-anchors` re-resolves it. This repository's
`npm run check:spec` checks that every requirement id the code cites is defined here (or retired
in `BATON_SPEC_HISTORY.md`), and that every ticket the spec cites exists in `tickets/`.

## Decisions

One line per decision in force; the reasoning and the rejected alternatives in full are in
`BATON_SPEC_HISTORY.md` (Decisions in full).

**Scope and truth**

- Chose standard courses that assume no particular deployment and serve the simpler end of Baton's range, with a factory's security and quality-assurance courses kept by that factory, over standard courses that carry every factory's guarantees: Baton scales from a single user's naive setup to a factory whose threat model shapes its architecture, and only the mechanisms are common to both (2026-10-29; R-BTN-131).
- Chose a protected default branch that only a deterministic merge runner and humans update, with merge criteria in Baton, over a git proxy, per-worker forks, or accepting unsigned pushes and verifying signatures: protected branches are what engineers already reason with and every forge has one, and the merge decision belongs in deterministic code (2026-10-28; R-BTN-180, R-BTN-182, R-BTN-183).
- Chose to keep Baton cooperative on one trusted machine and leave enforcement to the deployment, over requiring a merge runner, proxy or sandbox everywhere: Baton must stay usable for a small project run locally (2026-10-28; R-BTN-180).
- Chose that courses and leg logic change outside Baton for now, by a human's push or merge, and that tickets are created through courses and land only with a human approval, over letting the merge runner land either alone (2026-10-28; R-BTN-184).
- Chose human-only credentials for every human gate, over gates that accept the owner's account: an owner's agent sessions hold that account (2026-10-27; R-BTN-185).
- Chose to require of a human-only key only that it is used for nothing else and kept where no agent session can use it, leaving hardware backing, PIN and touch, attestation and the derived code to a deployment's `human_key: hardware` policy, over requiring hardware keys of every Baton user (2026-10-29; R-BTN-185).
- Chose authority by credential, not channel, over MCP's closed list, keeping credential management and the protected settings out of every delegated key (2026-10-27; R-BTN-186).
- Chose to run a sourced course's code from its source, the home referring to Baton's legs rather than copying them (2026-10-28; R-BTN-134, B-139).
- Chose to let a claim's branch append its leg's progress to its own ticket's `## Status` section without a human approval, over routing every ticket-file change through one: the ticket file is the right place for a leg's record, and append-only to one known path is checkable at merge, as one-line plain-text entries (2026-10-28; R-BTN-184).
- Chose attestations, typed facts a trusted writer makes (a human-only key, an owner key, a trusted service, or Baton from events it verified) as a kind of leg prerequisite, over approvals specific to merging or facts read from git, where any pusher can write a verdict or a person leg's answer: merging, branch deletion and sensitive API calls all need trusted state, and a go or no-go is not enough (2026-10-28; R-BTN-181).
- Chose commits signed by each runner's Baton key, checked as one unbroken chain of attested ranges, over a forge identity per runner, as an opt-in policy (`authorship: signed`) that Fieldhouse requires rather than a rule for every Baton user (2026-10-28 and -29; R-BTN-183).
- Chose that a trust domain that runs a branch's code is one of its writers, so reviewers read the change and never run it, and Baton keys sit outside any domain that runs branch code, behind a host-side signer where a deployment sandboxes runners (2026-10-29; R-BTN-183).
- Chose to state each mode's guarantee separately (`cooperative`, `protected`, `protected` with signed authorship) and let the deployment choose, over one guarantee every user must meet (2026-10-29; §12.8).
- Chose independence by trust domain (the runner's host or VM, one grant per domain under `protected`) over independence by key, and a grant's trust level as a property separate from the trusted-runner role (2026-10-28 and -29; R-BTN-180, R-BTN-183).
- Chose two forge identities, a human-only identity that administers protected repositories and an everyday one for the owner's agent sessions with no administrative role, over gates on one account the sessions hold (2026-10-28; R-BTN-180, R-BTN-185).
- Chose to state that a compromised runner whose change persuades both reviewers' models lands it, and to require two reviewers from different model families, over claiming review as a security gate (2026-10-28; R-BTN-183).
- Chose to gate only the loosening of a limit behind a human, leaving holds and bars open to every owner credential, MCP included, over gating both directions: the brake must stay easy (2026-10-28; R-BTN-186).
- Chose trusted runners, holding the only credential able to perform a sensitive leg's action and re-checking its attestations when they act, over gates in Baton alone: a gate stops a claim, not a runner holding a credential (2026-10-28; R-BTN-182).
- Chose that ticket `tier` is not a protected input, on the precondition that no runner above the VM level serves a repository runners below it push; the decision reopens if that precondition fails (2026-10-27; B-127).

- Chose to run checks only on the repository's own branches over a sandbox for forks' code: a leg's logic cannot be both generally useful and safely sandboxed (2026-10-20; R-BTN-114).
- Chose to answer a `baton.*` condition only through Baton's own authenticated surfaces (`baton owner resolve`, an owner's or administrator's dashboard session, an MCP key allowed `owner.resolve`), its bound handler only delivering a link to the condition's resolve page, over an owner-signed commit the agent-changeable sync would have to verify; and Baton's own traversal record over the posted path for every count; so that agents rewriting git can neither clear a hold nor buy runs (2026-10-20, revised the same day; R-BTN-163, R-BTN-63).
- Chose no core default timers per tier: timers are the course's, and `baton.stalled` already flags a leg nobody takes (2026-10-20; R-BTN-167).
- Chose to keep dependencies within one repository (2026-10-20; R-BTN-120).
- Chose to leave reviewer-independence seats and tags as cooperative checks, without Baton recording seats or verifying a session's model, unless misuse is seen (2026-10-20; R-BTN-60, R-BTN-66).
- Chose a Cloudflare Durable Object over SQLite on a home server: cloud sessions cannot reach a home network without exposing it, and one machine is a single point of failure (2026-10-13; §2).
- Chose one codebase with Cloudflare in production and a Node host for development and self-hosting over separate implementations (2026-10-14; R-BTN-55, R-BTN-56).
- Chose to move only the live lease into Baton: git holds every ticket fact and its content, and Baton holds the lease, filter fields, identifiers, pointers and digests (2026-10-13, 2026-10-15; R-BTN-33, R-BTN-35).
- Chose a ticket that is a course of legs and can suspend at a station over one lease for its whole life: legs need provider capacity at different times, and git and the PRs are the truth for leg progress (2026-10-14; R-BTN-39).
- Chose legs stateless at their boundaries (the branch, reviews, threads and a hand-off comment) over a lease per leg with affinity: any session can run any leg (2026-10-14; R-BTN-44).
- Chose a claim that goes stale only when git takes the ticket away, a path that goes backwards being flagged, over "stale when the leg is no longer ready" (2026-10-14; R-BTN-35).
- Chose commit ancestry and Baton's own observation numbers over commit timestamps to order snapshots: commit times are each pusher's clock (2026-10-13; R-BTN-10, R-BTN-62).
- Chose to log every disagreement with git, both values, before git wins, over holding git's version for review (2026-10-15; R-BTN-85).
- Chose a mirror that records a claim's status and time without the holder (2026-10-13; R-BTN-36).
- Chose no git fallback after cutover: two lock servers allow two holders (2026-10-13; R-BTN-18).

**Baton and courses**

- Chose a minimal core that acts only on its own vocabulary over course posted data, with course logic in each home repository, over core interpreting courses: a new course must not need a Baton deploy (2026-10-14; R-BTN-50).
- Chose Baton as an advisor that gates only correctness and the owner's explicit say (the lease, readiness, holds and prerequisites, grants, capabilities and tier, barred tags, course version, person legs, `no_chain_from`) over Baton as gatekeeper of capacity (2026-10-14; R-BTN-45).
- Chose that Baton runs no repository code and runners rank (`rank.mjs`, from the fleet and instance views) over hooks sandboxed in Baton or hosted: a strict sandbox was useless and still an attack surface; runners ranking with different code is accepted, since it is all advice (2026-10-16; R-BTN-98).
- Chose provider usage, forecasts and model advice as course logic, with only measured readings and billing counts shared, over core forecasts or reservations of future capacity: estimates are unverifiable and agents would learn to report low; a seat a running leg holds now is not a forecast (R-BTN-178) (2026-10-14, 2026-10-16; R-BTN-60, R-BTN-100, R-BTN-101).
- Chose cooperative gates backed by detection (each marker carries its claim's nonce; git wins) over signed commits, a required lease check or per-runner forge identities: Baton does not fortify git's security model, and whoever can push is a legitimate user (2026-10-14, reaffirmed 2026-10-18; R-BTN-46, R-BTN-66).
- Chose to keep what agents must not change — owner bars, required bars, tiers, retry bounds, transcript repositories — as Baton settings set by owner and administrator keys, over an owner-only file in git: an agent can write the PR and run the review (2026-10-14; R-BTN-66, R-BTN-67).
- Chose owner and required bars that name a course (or `*`) over per-repository bars (2026-10-14; R-BTN-67).
- Chose one validated `course.json` per course, a closed graph Baton validates but never interprets, with advances checked as edges, over vouches, guards or YAML. Choice stations, timers and completion tables are not guards: they read Baton's own clock and child stations, not git (2026-10-14; R-BTN-69, R-BTN-70).
- Chose a `version` per course, with `min_runner_version` and a test kit, over a fleet-wide skills version (2026-10-14; R-BTN-22, R-BTN-65).
- Chose a runner that runs one script per leg in a worktree at the claim's commit, with the graph as the course logic, over one per-course runner module (2026-10-14, 2026-10-19; R-BTN-72, R-BTN-133).
- Chose one runner per checkout serving every course it declares — its heartbeat carries them all, the claim answer's `course_id` chooses what it loads — with one leg at a time as its only limit, at least for now, over one runner and one clone per course (2026-10-22; B-103, R-BTN-72).
- Chose a leg that names the station it reached and the leg it queues, written to git first, over inferring the next leg (2026-10-15; R-BTN-81, R-BTN-83).
- Chose pointers and digests of leg inputs and outputs, validated by the runner, over Baton storing or validating content (2026-10-15; R-BTN-82, R-BTN-84).
- Chose validation against both a schema and its base, with a conservative static refinement check, over full JSON Schema: refinement would be undecidable (2026-10-17; R-BTN-108).
- Chose entry requirements on stations over requirements on legs (2026-10-17; R-BTN-109).
- Chose a shared `std:` schema library over formats defined in core (2026-10-17; R-BTN-110).
- Chose declarative views Baton renders over course-shipped rendering code (2026-10-17; R-BTN-112).
- Chose capability types declared in each course file, checked by the runner, over a vocabulary in core (2026-10-17; R-BTN-121).
- Chose replaceable per-repository ticket sources, with default sources in the CLI, over a ticket format in core (2026-10-14; R-BTN-74).
- Chose a course pinned to a source commit reachable from its default branch, read from one directory, with `sync.mjs` trusted as a pinned action is, over a CLI registry, moving refs, copies checked byte-equal or a sandboxed `sync.mjs`; the CLI ships no course (2026-10-19; R-BTN-134).
- Chose a read-only worktree per commit, installed with npm from the course directory or `.baton/` and cached by lockfile digest, the runner checking ancestry itself, over bundling, the home working tree or loaders (2026-10-19; R-BTN-133).
- Chose planning as an ordinary course (`epic`) over a coordinator agent in core, and no merge queue, steps inside a leg, federation or agents supervising agents (2026-10-17; R-BTN-124).

**Tickets, time and parallelism**

- Chose child tickets as the only parallelism over several positions in one ticket (BPMN tokens, an OR-join): one holder, the fence and git-first records depend on one position (2026-10-15, 2026-10-20; R-BTN-4, R-BTN-86, R-BTN-165).
- Chose one active claim per runner and per ticket (2026-10-13; R-BTN-4).
- Chose a runner-declared lease timeout, clamped to 15 minutes – 24 hours, over a per-claim duration (2026-10-13; R-BTN-9).
- Chose sidecar heartbeats with fencing over heartbeats from the agent thread (2026-10-13; R-BTN-6, R-BTN-7, R-BTN-19).
- Chose reaping (the alarm for a silent runner, a force-reap for a hung one) over a release message to a dead runner (2026-10-13; R-BTN-19).
- Chose `confirmed_at` over a `settled` claim status (2026-10-13; R-BTN-10).
- Chose expedite as a property of the ticket over a message (2026-10-13; R-BTN-12).
- Chose typed, timed activities over a free-text stage (2026-10-13; R-BTN-24).
- Chose transcript pointers reported by archivers over paths derived by convention (2026-10-13; R-BTN-20).
- Chose an open world for unknown tickets at their entry leg only, settled by a post containing the claim's commit (2026-10-16; R-BTN-104).
- Chose stored, indexed block rows and an `unblocked` event over computing blocks on read or re-deriving dependencies (2026-10-15; R-BTN-75, R-BTN-77).
- Chose posted human decisions as their own block kind, which never lapses and fails closed, over treating them as a resource (2026-10-15; R-BTN-78).
- Chose readings posted by instruments that lapse to `unknown` and fail open over Baton running checks (2026-10-15; R-BTN-76, R-BTN-101).
- Chose runners seeing their peers' claims and shared account readings and billings per Baton over per-repository isolation of capacity data (2026-10-16; R-BTN-99, R-BTN-101).
- Chose first come, first served for an account's room over weighting it by repository (2026-10-16; R-BTN-61).
- Chose to merge repositories by `weight` and courses by place in their own order over comparing scores across courses (2026-10-14; R-BTN-61).
- Chose `max_queue` as a warning that closes a course's intake as advice over a refusing bound, which could deadlock a loop (2026-10-15; R-BTN-79).
- Chose a blocked edge (`released:blocked`, no attempt spent, bounded by `max_blocked`, fleet-wide only when no runner has a usable instance) over a `blocked` station or treating capacity as an error (2026-10-17; R-BTN-126).
- Chose one `requires` per leg, stored as blocks and answered by `baton leg why`, with one primitive per kind of prerequisite (2026-10-17, 2026-10-19; R-BTN-120, R-BTN-132).
- Chose `not_before` written to git, with schedules in leg scripts and recurring jobs as series of child tickets; durations Baton measures on its own clock are timers, never a schedule (2026-10-15, 2026-10-20; R-BTN-89, R-BTN-167).
- Chose a self-loosening post to be raised as a condition over refusing the claim (2026-10-16, reaffirmed 2026-10-18; R-BTN-102, R-BTN-147).
- Chose the course file to travel with every sync over a hash with the body only on change (2026-10-16; R-BTN-69).
- Chose owner state exported and imported, not mirrored to git, where agents could change it (2026-10-15; R-BTN-88).
- Chose one Baton per team at a stated, load-tested envelope over sharding (2026-10-15; R-BTN-87).

**Conditions, calls, choices and timers**

- Chose conditions that the repository binds to handler courses (Common Lisp conditions, BPMN escalations) over delivery policy in core or handler ids in each course: how a person is reached differs per project, and standard courses must not be forked to change it (2026-10-20; R-BTN-160, R-BTN-161, R-BTN-163).
- Chose bindings held in git with no owner setting: a person's answer is already anyone's who can push (2026-10-20; R-BTN-161).
- Chose a short wait in the claim, then a suspension, over always suspending or holding the claim until an answer (2026-10-20; R-BTN-162).
- Chose to resume a withdrawn handler's leg with the default restart (2026-10-20; R-BTN-162).
- Chose Baton's clock, ties to course-file order, to settle a choice over runners' clocks or git order (2026-10-20; R-BTN-166, R-BTN-32).
- Chose question expiry as a choice station's `after_s` over a core expiry field (2026-10-20; R-BTN-166, R-BTN-169).
- Chose retries as the built-in default handler of `error` over a retry course — failures Baton detects have no runner present to run course code (2026-10-20; R-BTN-122).
- Chose per-leg retry policies, typed by the course as `interrupt` conditions and bounded by the owners' default, ceiling and floor, with a backoff as a prerequisite, over per-repository policies (2026-10-17; R-BTN-122).
- Chose interrupting timers enforced by a release and then a fence, a timeout being a failed attempt, over stopping a runner from Baton (2026-10-15, 2026-10-20; R-BTN-90, R-BTN-167).
- Chose an outbox delivered by holders of the credential over giving Baton a git credential — a compromised Baton could otherwise write every registered repository; a dispatch credential a forge cannot scope below write (a Gitea bot token, R-BTN-94) is the stated exception, used only to dispatch (2026-10-20; R-BTN-171).
- Chose one outbox for git writes and check runs, delivered by couriers with a key of their own, over a `baton.write` leg runners claim beside a separate notice queue: both are an effect Baton holds no credential for, claimed under a lease, applied once by its id and confirmed by reading it back, and what differs (order, who may deliver, the late window) is a column of the kind (2026-10-30; R-BTN-171, R-BTN-115).
- Chose readings as attestations about a resource instance, with gate or advice the requirement's choice, over readings that only advise and attestations that only gate: a leg may need a provider's funds as surely as a review (2026-10-30; R-BTN-181, R-BTN-76).
- Chose who may deliver the outbox as a per-repository `outbox_policy` owner setting (deliverer classes, trust, minimum release) over rules fixed by the landing mode: `cooperative` and `protected` are two points in a wider space, and the owner states which point holds (2026-10-30; R-BTN-171, R-BTN-180).
- Chose the writers a requirement accepts in the course file over an owner setting: under `protected` a course file lands only by a human, and under `cooperative` gates bind cooperating runners only, so the owner setting kept nothing out (2026-10-30; R-BTN-181).
- Chose light questions answered from a channel while the parent waits in its claim, and promoted to an ask file through the outbox when it stops waiting, over a ticket file for every question or channel answers that never reach git; checked by a model of every failure point (2026-10-20; R-BTN-173).
- Not adopted: BPMN tokens and parallel gateways inside one ticket, BPMN as a file format or engine, and Lisp dynamic variables beyond condition bindings (2026-10-20; R-BTN-160–R-BTN-168).

**Runners, people and surfaces**

- Chose sessions that report moves to their runner over sessions holding a claim credential (2026-10-17; R-BTN-106).
- Chose `attached` and `session` modes for cloud sessions over giving a child session a scoped claim token (2026-10-17; R-BTN-107).
- Chose a runner that refreshes a filling session under the same claim over losing the lease (2026-10-17; R-BTN-123).
- Chose stopping a leg through the authenticated release path over control from a viewer's stream (2026-10-17; R-BTN-119).
- Chose a noun-verb CLI renamed outright over aliases (2026-10-17; R-BTN-127).
- Chose writing each leg run's output as create-only chunks to an owners' bucket (`s3:`, `gs:`) or local directory, read there with the reader's own credentials and Baton keeping only the directory, over a git transcript repository, Baton-presigned URLs or Baton-minted credentials, vendor-specific append objects, and relaying output through Baton (2026-10-21, owner; R-BTN-128).
- Chose one action registry from which REST, the CLI, the dashboard and a remote MCP endpoint derive, MCP reaching reads, `ticket.hold` (add only) and `leg.stop` through a narrowed, expiring owner grant (2026-10-17, 2026-10-18; R-BTN-129, R-BTN-130, R-BTN-154).
- Chose a leg that waits on an effect git or the forge shows over waiting on "sent" (2026-10-17; R-BTN-116).
- Chose check courses whose verdict is a command's exit status, posted by a forge courier under a dedicated check App and signed by Baton, over a work key reporting its own check (2026-10-17, 2026-10-18; R-BTN-114, R-BTN-153).
- Chose either an SSH key (signatures) or an API key (a bearer) for every administrator, owner and runner, the holder making the trade, over one kind per role (2026-10-19; R-BTN-13, R-BTN-159).
- Chose administrator keys anchored in the deployment's secret and owner and runner keys in SQLite behind a signed API, over keys in git or Cloudflare Access as identity (2026-10-14; R-BTN-57).
- Chose owner dashboard sessions with a role of their own (`owner-session`), scoped to the repositories the minting owner key still owns and dying with that role, sign-in codes bound per role and confirmations by the minting key, over an administrator-only dashboard or a session acting as an administrator (owner decision, 2026-10-20; R-BTN-155, R-BTN-129).
- Chose to keep a ticket's holds, cancel, attempts and backoff when it leaves the board and restore them if its id returns, accepting that a ticket re-filed under a new id carries no hold, which owners see as the old id's closed row with its hold (owner decision, 2026-10-20; R-BTN-12).
- Chose capabilities on each repository's grant over capabilities on the key (2026-10-14; R-BTN-58).
- Chose one machine key that may work, sync and report readings, a key granted on several repositories syncing only where each grant opts in, over one role per machine key (2026-10-16, 2026-10-18; R-BTN-102, R-BTN-146).
- Chose a pulled sync (Baton records a want; any runner pulls it) and a sync key usable on any forge over forge dispatch alone or a stored bearer secret (2026-10-16; R-BTN-93, R-BTN-94).
- Chose forge webhooks that only trigger a sync over stations built from payloads (2026-10-14; R-BTN-73).
- Chose a merge's `pull_request` delivery to dispatch its repository's own sync, and the alarm to dispatch one when the webhook path's last send is 10 minutes stale, over GitHub's `schedule` alone: three hours of a `*/15` cron ran nothing, and 14 runs in 51 hours is not a backstop (2026-10-24; R-BTN-73, B-89).
- Chose a passive plain git server, synced by runners (2026-10-16; R-BTN-105).
- Chose a hibernating WebSocket doorbell over server-sent events or push delivery: the heartbeat stays the one delivery and fence path (2026-10-15; R-BTN-91).
- Chose one tenant per Baton, named by its origin, with a router for many tenants later, over a tenant id on the wire or a shared object (2026-10-18; R-BTN-135–R-BTN-138).
- Chose loopback binding by default for the local host, TLS being the operator's (2026-10-18; R-BTN-158).
- Chose GitLab Developer (30) as the role that can push (2026-10-18; R-BTN-139).
- Chose a Quint model checked on the author's machine and against every scenario's trace, per PR by `model:pr` and weekly by `model:full`, over hosted CI or tests alone (2026-10-14, 2026-10-20; R-BTN-68).
- Chose driven, fake-clock integration scenarios in every behaviour change over unit tests alone (2026-10-13; R-BTN-29–R-BTN-31).
- Chose a per-repository capability ontology in one named fragment of ASP-Core-2 (safe, stratified, default negation, integer comparison), evaluated by a bounded evaluator in core and stored per runner when its inputs change, over capability names alone, provider support in core, fixed compiled shapes, a solver in or beside the Worker, or N3 (2026-10-22; R-BTN-174, R-BTN-175).
- Chose to grow the ontology language only by ASP-Core-2 constructs, so that narrowing is default negation in the ontology and never a preference (2026-10-22; R-BTN-175).
- Chose route choices as ASP-Core-2 weak constraints evaluated as first-match, with availability hard, guards soft, hysteresis from a stored last demotion, and readings steering advice only from administrators and instrument keys unless a resource admits runners (2026-10-22; R-BTN-176, R-BTN-177).
- Chose to let the ontology derive past what a grant names, because a capability gate matches ability, not authority: a false derivation only sabotages the runner it misleads, and authority stays in grants and `runner:`, which are never derived (2026-10-22; R-BTN-174).
- Chose to leave a leg's environment to R-BTN-144 alone, the ontology and route choices passing no credential, over scoping provider keys per leg inside a sandbox the agent can read anyway (2026-10-22; R-BTN-144, R-BTN-174, R-BTN-177).
- Chose seats on resource instances, billed by the runner at the claim or advance that starts a leg and refused past capacity, over counting bills as advice: a seat is a fact the runner states, not a forecast, and an exclusive device is exactly what a lock is for (2026-10-22; R-BTN-178, R-BTN-100).
- Chose derived types declared by the ontology over a `derived` flag in course files, so a sourced course never conflicts with the repository's ontology (2026-10-22; R-BTN-174, R-BTN-121).
- Chose `human-operator` as a runner's own statement, admitted by grants like any capability, over an administrator-only grant: Baton cannot verify a person (2026-10-22; R-BTN-121, R-BTN-58).
- Chose to evaluate a runner's derived capabilities in the transaction of the write that changes them, and a reader's sets at its read after a program change, over a lazily refreshed cache, so advice is never older than the reader's last accepted write (2026-10-22; R-BTN-174).
- Chose route choices attached to legs by the repository's own course entries, never by a course file or a source, so a standard course runs unchanged with or without an ontology (2026-10-22; R-BTN-177, R-BTN-134).
- Chose to judge an ontology unit whole at each post, with no rate window, and to let a derived atom match no course's `values`, since the alarm's bounds already cap the cost of churn and an atom a course cannot require is inert (2026-10-22; R-BTN-174, R-BTN-175).
- Chose to skip an owner key an administrator revoked when the seed names it, over stopping the start: a revocation after the seed was written (a rotation, a leaked key) must not take the whole instance down until `wrangler.toml` changes; the repository it leaves with no owner is named in `seed_owners`. A key that holds another role or is no key still stops the start, as a broken seed (the owner, 2026-10-27; R-BTN-47, B-91 round six).
- Chose the CLI's reads to return the dashboard's own queries behind the signed principal, with no new core query and no browser session, over a second read model: one answer per fact (R-BTN-1, R-BTN-179) (2026-10-24; B-90).
- Chose `clingo-wasm` in `npm test` as the conformance oracle over a pip-installed clingo or another Datalog dialect: none is a standard with preferences or has better TypeScript tooling (2026-10-22; R-BTN-175).

## Open questions

- **§12.8's remaining items (the fifth adversarial review, 2026-10-29).** The amendment merged as a
  proposal with these open; each is to be settled before the rule it names is built:
  - **Foreign-commit resets race honest work** (R-BTN-183): a reset can discard an honest leg's
    unreported pushes, and any runner can trigger one through the shared forge identity until B-131
    gives each claim its own push credential.
  - **The host-side signer's policy** (R-FH-3): "signs only for the claim its runner holds" must be
    defined per kind (requests, commits, attestations); the signer is not built.
  - **A human's wrong-head merge is caught after it lands** (R-BTN-184): the forge cannot refuse a
    human's merge of another head; whether trusted runners should revert it, or the human's merge
    should itself go through a pinned expected head, is open.
  - **Multi-repository tickets** (R-BTN-140) under `protected`: one chain and one approval per
    repository, or one per ticket.
  - **Deleted paths in `std:approval@1`**, which have no blob; **sync imports** reached transitively
    outside `imports`; **release assets**, which a forge `write` role can still replace, unless
    releases are made immutable; **the shrinkwrap**, which the CLI package does not ship yet.
  - **`bypass_actors` read access** (R-BTN-180): whether a narrower permission than write access to
    the ruleset suffices on GitHub, to be verified when B-140 is built.
  - **Approval cost** (Fieldhouse Axiom 4): a human gate per VM grant (trust level, domain, family)
    and per proposed ticket; whether some may be batched or delegated to a policy.
  - **Smaller items**: where a promoted question's text lives under `protected` (R-BTN-173);
    whether `human_only` keys registered under `cooperative` must be re-registered on the switch to
    `protected`; whether `human_key` should be per repository rather than per instance.
  - **`baton-deploy.yml`**, whose production job restores the npm cache the test job saved: tracked
    in B-135 item 3 (the owner, 2026-10-29), so the deploy job restores no cache. (B-110 and the standard
    `review.md` running tests in a review leg are no longer open: the standard courses are written
    for `cooperative` (R-BTN-131, 2026-10-29), and the courses that must not run branch code in a
    review are the deployment's.)

- **Confirmation by keys a same-user process can reach (R-BTN-155, R-BTN-159).** Any
  administrator or owner key, SSH or API, binds a sign-in code and confirms its session's
  actions, so the confirmation keeps a stolen session from an authority-changing act only when
  the key needs a touch. Should binding and confirming refuse API keys and SSH keys without the
  `sk-` user-presence flag? Refusing closes that gap; it locks out holders who chose an API key,
  which R-BTN-159 makes their trade. A candidate owner decision; until it is taken, any key of
  the session's role confirms.
