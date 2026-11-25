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
  - The object makes no outbound call. A workflow dispatch is the host shell's, after commit
    (R-BTN-94), and no request awaits it. The outbox (R-BTN-171) and the doorbell (R-BTN-91)
    are not built.
  - A claim's repeated `request_id` returns the first request's committed result (G-BTN-2);
    `claims.request_id` is the only stored request id. Every other write is safe to retry by
    its own key: a repeated end is `ok` (§9.4), owner and administrator writes set a value, a
    repeated board post is `stale-observation` (the sync then takes a new number and reads the
    head again, `GET /v1/sync/head`), and a repeated raise or report finds its row.
- **One alarm, every 60 seconds**, also set early to the earliest instant Baton holds. Every
  start and every request sets it again for the next period when none is set or the one set is
  more than two periods overdue. It fires every due instant a rule stores, with the effect and
  the interval that rule gives: reaps and unacknowledged releases (R-BTN-9, R-BTN-90, §9);
  unconfirmed completions (R-BTN-10); deadlines, expiries, `not_before` and `retry_after`
  (R-BTN-167, R-BTN-116, R-BTN-89, R-BTN-122); owner bars (R-BTN-67); readings (R-BTN-76); an
  idle runner's liveness (R-BTN-75); coalescing windows (R-BTN-94, R-BTN-77); retention
  (R-BTN-13, R-BTN-73, R-BTN-149); capacity crossings (R-BTN-87); and a fence-pending reap's
  seats (R-BTN-178).
- **Code.** Schema migrations are numbered and append-only; the object refuses to serve until
  all are applied. There is no staging instance: a home repository binds to one Baton
  (R-BTN-56).
- **R-BTN-37 (shared modules are vendored by hash).** Baton maintains `baton.mjs`, `vocabulary.mjs`,
  `sessionUsage.mjs`, `batonSync.mjs` and `ticketPr.mjs` as sources under `src/shared/`.
  Consumers use byte-identical copies pinned to a Baton commit and check their hashes, or
  consume the modules from a pinned Baton CLI release that exposes them. Baton builds and
  tests without a consumer checkout. Code with course meaning (`locate`, ranking, activity
  matchers) stays with its course: the sync posts its results, and core compares strings and
  integers only.
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
  | `Store` — synchronous `exec`, `transaction` | Durable Object SQLite | `node:sqlite` |
  | serialization — one request at a time between awaits | the object's input gate | one in-process queue in front of the handler and the alarm, released only at the signature check |
  | `Scheduler` — the alarm | the object's alarm | a timer |
  | `Push` — the doorbell (not built, R-BTN-91) | hibernating WebSockets, by runner id | an HTTP upgrade, one socket per runner |
  | `Dispatch` — a workflow dispatch with the tenant's dispatch credentials (R-BTN-94, §12.7) | the object class's wiring, after commit | the server process, after commit |
  | `Clock` | `batonNow()` (R-BTN-32) | the same |
  | `Origin` | variable `BATON_ORIGIN` | `--origin` (default `http://127.0.0.1:<port>`) |
  | `AdminKeys` (R-BTN-57) | secret `BATON_ADMIN_KEYS` | `--admin-keys <file>` |
  | `AccessIdentities` (R-BTN-155), read on every request like `AdminKeys` | secret `ACCESS_IDENTITIES`, with variables `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and secret `OWNER_EMAILS` | `--access-identities <file>` |
  | `HumanKeys` (R-BTN-185) | secret `BATON_HUMAN_KEYS` | `--human-keys <file>` |
  | `ForgeSecrets` — per-repository webhook secret and dispatch token (R-BTN-94, R-BTN-95) | secret `BATON_FORGE_SECRETS` | `--forge-secrets <file>` |
  | `GitHubApp` (optional, §12.7) | `BATON_GITHUB_APP_ID`, secrets `BATON_GITHUB_WEBHOOK_SECRET` and `BATON_GITHUB_APP_KEY` | `--github-app-id`, `--github-webhook-secret`, `--github-app-key <file>` |
  | `CursorKey` (not built, R-BTN-130) | secret `BATON_CURSOR_KEY` | `--cursor-key <file>` |

  - The Durable Object class is wiring only; `src/core/` imports no `cloudflare:*` module (a
    build check enforces it). Every integration scenario runs against both hosts. Signed
    requests (§11.1) and administration (§11) need no Cloudflare service.
  - The local host's binding (`--host`) and operator-managed TLS follow R-BTN-158.
- **R-BTN-2 (the day's usage against the plan's limits).** The dashboard shows the day's
  Durable Object requests and SQLite rows written against the plan's limits. The limits are the
  one Worker var `BATON_PLAN_LIMITS` — `{"requests": <n>, "rows_written": <n>}` a UTC day,
  defaulting to 100,000 each. Baton refuses nothing at a limit; the platform fails further
  operations until 00:00 UTC, which stops all claiming, so a production deployment runs on a plan
  whose limits it does not reach.

### 2.2 Tenants

- **R-BTN-135 (a tenant is a Baton, named by its origin).**
  - **What it is.** Everything one Baton holds and its administrators. It is Baton's own
    partition, not the platform's tenant.
  - **Its origin.** `https://<host>[:<port>]`, no path; a local host's is
    `http://<loopback host>:<port>` or the `https` origin of its operator's TLS front. No two
    tenants share a host (`@authority` covers host and port, not scheme; a host-only cookie
    reaches every port): two local hosts on one machine use different hostnames.
  - **The origin binds every credential**: a signature's `@authority` (R-BTN-13), a CI token's
    audience (R-BTN-15, R-BTN-56), the host-only dashboard cookie and the origin check on
    state-changing requests (R-BTN-16), and login and webhook URLs. No route, token or header
    carries a tenant id.
  - **Served only at its origin.** The Worker answers `404`, before any object is reached, to a
    request whose URL host (lowercased, default port elided) is not the origin's authority. It
    uses the request URL's host, never `X-Forwarded-Host` or `Forwarded`; `workers_dev` and
    `preview_urls` are `false`; every comparison is against the configured origin, never the
    incoming `Host`. The local shell does the same.
  - **Nothing crosses a tenant.** No read, write, count, uniqueness check, rate limit, setting,
    view, event, notice, export or stream spans two tenants. Names are unique within a tenant
    only; "per Baton" counters are per tenant; Baton never asks whether something exists in
    another tenant.
  - **Core is tenant-blind.** No `src/core/` function takes a tenant id; core reads only the
    shell's ports (R-BTN-55) and the host's `Config` (R-BTN-136).
  - A deployment serving several tenants is a router in front of this and changes no rule here.
    It is not built: [the multi-tenancy proposal](../proposals/multi-tenancy.md).
- **R-BTN-136 (the operator; configuration, secrets and administrators per tenant).**
  - The **operator** is whoever controls the deployment (the platform account; locally, the
    process). It is the root of trust and not a Baton principal: it acts through the platform
    (`wrangler`, the host's files), never Baton's API, and owns no registry action (R-BTN-129).
  - Every value the host holds (R-BTN-55's secrets and variables, the OIDC issuer and key-set
    URL, the seeds in `wrangler.toml`) is one tenant's.
  - **The secret sink.** `baton admin github-app create`, `baton admin keys set --file <path>`
    and `baton admin forge-secrets set --file <path>` write whole values, from a file the
    administrator keeps, through one sink chosen by the CLI's configuration: `wrangler`
    (Cloudflare's default) or `file` (local). No command reads a secret back; no Baton credential
    adds an administrator or rewrites a secret.
  - **Administrators belong to a tenant.** Nothing in a tenant's storage can add an
    administrator to it. An administrator's, a dashboard session's and every `instance`-scoped
    action's powers end at the tenant.
- **R-BTN-137 (a credential is valid in one tenant; a key in two tenants is two keys).**
  - A signature verifies only at its origin; a bearer secret (API key, MCP key, registration
    token, pending sign-in, dashboard session) is stored hashed in one tenant and unknown in
    every other unless R-BTN-88 moved it; nonces, rate limits and revocations are per tenant.
  - Baton never refuses a key because another tenant holds it. The one-role rule (R-BTN-57,
    R-BTN-102) and name uniqueness hold within a tenant, and every trust statement speaks only
    for its tenant.
  - **A runner's origin is its own configuration.** `runner.json` carries `origin`; `--url` and
    `BATON_URL` override it. There is no default origin. `baton repo *` takes `baton_url` from
    `.baton/baton.json` at the commit it syncs (`spool`: the working tree's; `init` writes it), and a sync run by a runner
    whose origin differs is skipped and logged; `--url` overrides. Every other command takes
    `--url`, `BATON_URL`, `runner.json`'s `origin` or the single origin in `keys.json`, and with
    none exits 2.
  - A CLI runner and a sidecar talk only to their origin and refuse a ticket whose home checkout's
    `baton_url` names another; a code repository in `repos:` may belong to another Baton.
    `baton runner register` and `start` record each origin and key fingerprint in
    `~/.config/baton/origins.json`; `start` exits 2, naming both origins, for a key listed
    under another origin.
  - `~/.config/baton/keys.json` maps each origin to its roles; the CLI offers only the called
    origin's.
- **R-BTN-56 (one Baton per repository).** Two Batons serving one repository are two lock
  servers (R-BTN-18). `.baton/baton.json`'s `baton_url` names the repository's one Baton; its
  sync posts only there. Each Baton checks a CI token's audience against its origin (R-BTN-15),
  and the sync requests its token for `baton_url`, the same string: `BATON_ORIGIN` verbatim,
  scheme included, no trailing slash (GitLab's adds `#sync`, R-BTN-15). Moving a repository is its owners' act: they have an
  administrator retire it on one Baton (R-BTN-47) and register it on the other, and change
  `baton_url`. Baton never checks this across tenants.

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
    caps do. `npm run test:load` proves it (§15).
  - Beyond the envelope the answer is another Baton: repositories partition across Batons
    (R-BTN-56).
- **R-BTN-196 (an idle runner's beat reads about nothing).** Every write to a tenant's state
  moves the **state version** in the write's own commit, and a rollback takes the move back.
  A write to an input of eligibility or advice — what a runner declares, a grant, a position,
  a claim, a block, an instance's availability — also moves the **scheduling version**, as
  does any write Baton cannot classify. Activity, event, message and transcript writes do not
  move the scheduling version. Handing out or consuming an observation number does not;
  accepting an observation does when it crosses a claim end's freshness boundary (R-BTN-10).
  Two more versions serve the dashboard's lists (§14): the **activity version** moves with
  activity, event, message, transcript and history writes, the **board version** with every
  other write. Liveness moves no version: a runner's `last_seen_at` and `last_activity_at`,
  and request nonces (R-BTN-13). What liveness decides is the clock's, so a reader that shows
  it adds the clock. A runner's recommendations or claim that find nothing eligible for it are
  remembered, per runner and in memory only, while the scheduling version stands and until the
  earliest instant the clock alone could change the answer — a backoff's `retry_after` (§6,
  rule 10), an owner bar's `starts_at` or `ends_at` (R-BTN-67), an instance's `until`
  (R-BTN-76) — and at most 10 minutes; an idle beat then reads a handful of rows. The answer
  remembered is always the one computing it gives (R-BTN-61, R-BTN-72).
  - **What a heartbeat writes.** A live runner's heartbeat writes its liveness only, unless
    anything it declares (harness, kind, model, lease timeout, isolation,
    concurrency, profile, capabilities, tags, courses) changed, it re-keys, or it carries
    something to record.
- **R-BTN-149 (hard caps per repository).** Safety limits at twice the envelope; none refuses
  lease upkeep.

  | Cap | Limit | Past it |
  |---|---|---|
  | board post | 8 MB, 10,000 tickets | `too-large`; raises `baton.too-large` |
  | child tickets | 4 generations below a root | `parent-invalid` |
  | a schema pattern's expanded automaton (R-BTN-108) | 4,096 states (`{n,m}` multiplies by `m`, nesting multiplies, capability `values` included) | a schema error at the sync |

  - The per-credential session and write caps are not built:
    [the proposal](../proposals/multi-tenancy.md).
  - **Retention.** Runner rows unseen for 30 days lose their capability, tag, course and report
    rows. The alarm deletes `board_snapshots` older than 90 days (never the head's) and
    repository `events` older than 90 days — while a repository has a mirror (§16), only below
    its `mirror_acked_seq` — then the claims of a ticket whose history R-BTN-81 purged, with
    their legs, activities and the rows that name them; a claim still held (R-BTN-39), or named
    by an event, a condition or a scope finding, waits and its ticket is tried again a day
    later. The alarm deletes at most 1,000 rows a tick, oldest first, each prune through an
    index.
- **Admission.** The Worker turns away what the object need not see.
  - A signed route (`/v1/runner/*`, `/v1/repositories/*`, `/v1/probe/*`, `/v1/owner/*`,
    `/v1/admin/*`) with no or a malformed signature, a stale `created` or a foreign `@authority`
    is refused before the object; key and nonce checks run inside it. Every other route is
    checked in the Worker for its own credential first: `/v1/sync/*` a CI identity token or a
    signature (R-BTN-93); `/v1/ui/*` a dashboard session; `POST /v1/login` a one-time link's
    token or a Cloudflare Access assertion (R-BTN-155); the App's forge-notification route GitHub's signature (R-BTN-73). The
    static pages (`/login`, the shell at `/` and every §11.4 screen path, and
    `/conditions/{condition}`, R-BTN-163) need no session. The OAuth and MCP routes are not
    built (R-BTN-130).
  - Rate limits — per IP for unauthenticated requests, per credential for authenticated ones, a
    filter on failed verifications, and lease upkeep's own buckets — are not built:
    [the proposal](../proposals/multi-tenancy.md). Whatever limits a deployment adds, a request
    that verifies is never refused for another's failures, and lease upkeep (heartbeats of an
    existing session, `advance`, `end`, release acknowledgements) is never refused by a cap.
  - **A refused request had no effect.** A retry is re-signed with a fresh `created` and
    `nonce` and keeps its `request_id` where the route takes one. Baton's own clients treat
    `rate-limited` and `quota` as possible on every route: a periodic loop backs off, honouring
    `retry_after_s`, and keeps its lease; a one-shot command waits at most 60 s, then exits
    non-zero naming the code. Neither marks a lease lost at once, but an unanswered heartbeat
    still runs the lease clock (G-BTN-4). `too-large` is reported, never retried. A capped forge
    webhook is a lost trigger, covered by the sync's other triggers (R-BTN-94).
