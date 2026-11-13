---
title: "2. Deployments: tenants, hosts and the service"
description: "A tenant is one Baton: one origin, one Durable Object with SQLite, its administrators and everything they govern."
---
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
  - Baton's one outbound call that acts is a workflow dispatch (R-BTN-94): the object records
    the dispatch it wants in its transaction and the host shell performs it through `Dispatch`
    (R-BTN-55) after the commit, whether a request or the alarm caused it, on both hosts; the
    object holds no dispatch credential and makes no call itself. Git writes and check runs are
    outbox entries runners deliver (R-BTN-171). Dispatches and the doorbell's rings (R-BTN-91) are
    sent after commit, never awaited by a request.
  - A claim's repeated `request_id` returns the first request's committed result (G-BTN-2);
    `claims.request_id` is the only stored request id. Every other write is safe to retry by
    its own key: a repeated end is `ok` (§9.4), owner and administrator writes set a value, a
    repeated board post is `stale-observation` (the sync then reads `GET /v1/sync/wanted`'s
    `head_sha` to learn whether its post landed), and a repeated raise or report finds its row.
- **One alarm, every 60 seconds**, also set early to the earliest instant Baton holds. Every
  start and every request sets it again for the next period when none is set or the one set is
  more than two periods overdue (B-229). It fires every due instant, each with the effect its
  owning rule gives:

  | Instant | Rule |
  |---|---|
  | a runner's `last_seen_at` + lease timeout: reap; a delivered `release` unacknowledged for 2 hours (15 minutes for `leg-timeout`): reap with a fence; message expiry | R-BTN-9, R-BTN-90, §9 |
  | an unconfirmed completion's flag time | R-BTN-10 |
  | a deadline, a `stalled_s` or `expires` instant, a `not_before`, a leg's `retry_after` | R-BTN-167, R-BTN-116, R-BTN-89, R-BTN-90, R-BTN-122 |
  | an owner bar's `starts_at` and `ends_at` | R-BTN-67 |
  | a reading's `lapses_at` | R-BTN-76 |
  | the end of an idle runner's liveness for `fleet_capabilities` | R-BTN-75 |
  | a coalescing window's end: trailing dispatch, unblocked trigger and ring | R-BTN-73, R-BTN-77, R-BTN-91 |
  | an outbox entry's lapsed lease, backoff or age | R-BTN-171 |
  | retention: `request_nonces` after 11 minutes, `webhook_deliveries` after 24 hours, R-BTN-149's 90-day prunes | R-BTN-13, R-BTN-73, R-BTN-149 |
  | a capacity figure crossing 80% | R-BTN-87 |
  | a fence-pending reap's seats at `fence_deadline` | R-BTN-178 |
  | any other instant a rule stores, such as an outbox entry's 24 hours | its rule (R-BTN-171) |

- **Code.** Baton's code lives in `immediately-run/baton`: the Worker, the Durable Object,
  numbered schema migrations (append-only; the object refuses to serve until all are applied),
  the wrangler configuration and the integration harness, deployed by a GitHub Action on
  `main`. immediately.run's own instance is `https://baton.immediately.run` (provisioned by
  R3-1208), and it is the only deployed instance: a home repository binds to one Baton
  (R-BTN-56), every registered repository binds to production, and a staging instance would hold
  nothing and test nothing (B-224; the owner, 2026-11-09).
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
  | `Dispatch` — a workflow dispatch with the tenant's dispatch credentials (R-BTN-94, §12.7) | the Durable Object class's wiring, from `ctx.waitUntil` after the object's transaction commits, for a request and for the alarm alike (the Worker only routes) | the server process, after commit |
  | `Clock` | `batonNow()` (R-BTN-32) | the same |
  | `Origin` | variable `BATON_ORIGIN` | `--origin` (default `http://127.0.0.1:<port>`) |
  | `AdminKeys` (R-BTN-57) | secret `BATON_ADMIN_KEYS` | `--admin-keys <file>` |
  | `HumanKeys` (R-BTN-185) | secret `BATON_HUMAN_KEYS` | `--human-keys <file>` |
  | `ForgeSecrets` — per-repository webhook secret and dispatch token (R-BTN-94, R-BTN-95) | secret `BATON_FORGE_SECRETS` | `--forge-secrets <file>` |
  | `GitHubApp` (optional, the webhook source and GitHub's dispatch target, §12.7) | `BATON_GITHUB_APP_ID`, secrets `BATON_GITHUB_WEBHOOK_SECRET` and `BATON_GITHUB_APP_KEY` | `--github-app-id`, `--github-webhook-secret`, `--github-app-key <file>` |
  | `CursorKey` (R-BTN-130) | secret `BATON_CURSOR_KEY` | `--cursor-key <file>` |

  - The App's outbound calls are the host shell's, through `Dispatch` (R-BTN-94, §12.7): an
    installation token, a JWT signed with the App key and issued as the App id, exchanged for the
    repository's installation (looked up with `GET /repos/{owner}/{repo}/installation`, cached
    until a call fails), then the `workflow_dispatch`. The object makes none.
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
  - Every value the host holds is one tenant's: `BATON_ADMIN_KEYS`, the GitHub App's id and
    webhook secret and key, `BATON_FORGE_SECRETS`, `BATON_HUMAN_KEYS`, `BATON_CURSOR_KEY`, the OIDC
    issuer and key-set URL, and the seeds in `wrangler.toml`. A
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
  - `~/.config/baton/keys.json` maps each origin to its roles (`{admin, owner: {…},
    runner, sync: {…}, mirror: {…}}`); the CLI offers only the called origin's.
- **R-BTN-56 (one Baton per repository).** Two Batons serving one repository are two lock
  servers (R-BTN-18). `.baton/baton.json`'s `baton_url` names the repository's one Baton; its
  sync posts only there. Each Baton checks the OIDC `aud` against its origin: `aud` is
  `BATON_ORIGIN` verbatim (scheme included, no trailing slash; GitLab's adds `#sync` or
  `#mirror`, R-BTN-15), and the sync and mirror request tokens for `baton_url`, the same string. Moving a repository is its owners' act: they have an
  administrator retire it on one Baton (R-BTN-47) and register it on the other, and change
  `baton_url`. Baton never checks this across
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
  | child tickets | 4 generations below a root | `parent-invalid` |
  | live runner rows per credential | 64 | the 65th first heartbeat `quota` |
  | new sessions per credential per day | 200 | the 201st first heartbeat `quota` |
  | non-upkeep row writes per credential per repository per UTC day | 50,000 | `quota` for that credential until 00:00 UTC |
  | a credential's heartbeat declaration and report writes per UTC day | 50,000 | dropped, the lease kept, until 00:00 UTC (§2.3) |
  | a repository's non-upkeep row writes per day | 150,000 | raises `baton.write-budget` at 80% |
  | a schema pattern's expanded automaton (R-BTN-108) | 4,096 states (`{n,m}` multiplies by `m`, nesting multiplies, capability `values` included) | a schema error at the sync |

  - Neither write budget refuses owner or administrator writes, or the repository's sync key
    or CI identity.
  - Retention: runner rows unseen for 30 days lose their capability, tag, course and report
    rows; the alarm deletes `board_snapshots` older than 90 days (never the head's) and
    repository `events` older than 90 days below every live repository's mirror's
    `mirror_acked_seq` (a retired repository's events below none).
- **Admission.** The Worker turns away what the object need not see:
  - A signed route (`/v1/runner/*`, `/v1/repositories/*`, `/v1/probe/*`,
    `/v1/owner/*`, `/v1/admin/*`) with no or a malformed signature, a stale `created` or a
    foreign `@authority` is refused before the object; key and nonce checks run inside it.
    Other routes are checked first in the Worker too: `/v1/sync/*` a CI identity token or a
    signature (a sync key's or a machine key's; key checks in the object, R-BTN-93); `/v1/ui/*` a
    dashboard session; `POST /v1/login` a
    pending sign-in (R-BTN-155); `POST /v1/github/webhook` `X-Hub-Signature-256` (R-BTN-73);
    `POST /v1/forges/{repository}/notify` its forge's verifier (R-BTN-95). The static pages —
    `/login`, `/oauth/authorize` and the shell at `/`, every §11.4 screen path and the
    redirect's own address `/conditions/{condition}` (R-BTN-163), which serves the shell to
    the signed-out — need no session; `/.well-known/oauth-*` and `/v1/oauth/*`
    take no credential and fall under the per-IP rule, and `POST /v1/mcp`'s bearer is checked
    in the object (R-BTN-130, `BATON_MCP_OAUTH_SPEC` §13).
  - A per-IP rule (a Workers rate-limit binding keyed `<host>|<ip>`) applies only to
    unauthenticated requests, never to the two forge-notification routes, `POST
    /v1/github/webhook` and `POST /v1/forges/{repository}/notify`, whose bodies R-BTN-73 caps
    instead.
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
    `nonce` and keeps its `request_id` where the route takes one. Baton's own clients (CLI, runner, sidecar, sync,
    mirror, dashboard) treat `rate-limited` and `quota` as possible on every
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

