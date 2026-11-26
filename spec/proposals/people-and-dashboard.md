---
title: "Proposal: the action registry, MCP and the dashboard"
description: "The unbuilt parts of BATON_SPEC §11: one registry of actions behind every surface, the MCP endpoint and its delegated keys, sign-in by a confirmed code with owners' sessions and confirmation codes, and the dashboard's screens."
---
**Status:** proposal — not built; moves into BATON_SPEC §11 when built (tickets B-25, B-124, B-192, B-204, B-206, B-207, B-208, B-221; OAuth for MCP clients is B-73, [BATON_MCP_OAUTH_SPEC](../BATON_MCP_OAUTH_SPEC.md))

The rule ids stay defined, as built, in [BATON_SPEC §11](../BATON_SPEC/11-people.md#sec-11) and
are written here as `R-BTN-n (proposed)`. What a delegated key may do is R-BTN-186's
([§12.8](../BATON_SPEC/12-security.md#sec-12-8)); this page cites it. `§n` alone is this page's section;
BATON_SPEC's sections are named with a rule or as `§11.3`, `§12.2`.

## 1. The action registry

- R-BTN-129 (proposed) — one registry of actions; every surface is derived from it. The
  principals, scopes and effects are R-BTN-129's as built
  ([§11.3](../BATON_SPEC/11-people.md#sec-11-3)); this part adds the registry file and what is
  generated from it.
  - **An action** is one entry in `src/shared/actions.mjs`: `{id, summary, callers, effect,
    input, output, http, ui?, delegated}`.
    - `id` matches `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$` (dots and hyphens, never `_`), in
      R-BTN-127's nouns: `leg.why`, `leg.stop`, `ticket.expedite`, `owner.owner.add`,
      `runner.heartbeat`.
    - `callers` lists every principal that may call it (R-BTN-129's list), each with its scope,
      in the order the CLI tries them: an entry is `{principal, scope, roles?}`, `roles` only for
      `session` (`{principal: "session", roles: ["owner"], scope: "repository"}`). A delegated
      key is no principal of its own: it calls as `owner`, narrowed (§2).
    - `effect` is `read`, `write` or `destructive` (§12.2).
    - `input` and `output` are schemas in the shared validator's subset (R-BTN-108).
    - `http` is `{method, path, upgrade?: "websocket", match?}`. A WebSocket upgrade
      (`/v1/runner/push`) is an action,
      authorized at the upgrade. `match` tells apart the actions of one route by body field:
      `POST …/overrides/{ticket}` serves `ticket.expedite`, `ticket.hold` (`hold: true`),
      `ticket.unhold` (`hold: false`: an approver on `approvers.policy`, a session of one, or the
      delegated key that set the hold, R-BTN-186) and `ticket.cancel`, and a body matching none or
      several is `invalid-params`.
    - `ui` is `{view: [<screen id>…], route?}` — the screens of §11.4 that draw the action as a
      control, and, where the dashboard calls it through a `/v1/ui/*` route of its own
      (`/v1/ui/resync`, `/v1/ui/overrides/{ticket}`, `/v1/ui/conditions/{condition}/resolve`,
      and `/v1/ui/messages`, which is `leg.stop`'s for `kind: release` and its own actions' for
      the other kinds, told apart by `match`), that route: an entry may carry both an `http` and
      a `ui` route, and the router serves both. A screen id is `root`, `tenant/<segment>` or
      `repository/<segment>[/{param}]`, exactly §11.4's list, held in one data file
      (`src/core/screens.ts`) the front, the client router and `check:actions` read. `view` is
      set only on an entry whose `callers` include `session`; `check:actions` fails a `view`
      naming no screen or an entry no session can call, and lists, never failing, a screen no
      control names.
    - `delegated` is what a delegated key (§2) may do with the action, as R-BTN-186 rules:
      `true` for a read whose `callers` include `owner` and for a tightening, `own` for the
      undoing of the key's own tightening, `false` for everything else, and for an action absent
      from MCP for a mechanical reason the entry names (the WebSocket upgrade; `GET
      /v1/actions`, whose answer over MCP is `tools/list`). `check:actions` fails an entry whose
      mark differs from the one R-BTN-186 gives.
  - **The CLI's commands** are a second table in the same file. Each names the action ids it
    calls (`leg log` calls `leg.runs` and reads the log directory itself), or `local` for one that
    calls none, with its arguments, its flags, a one-line summary and one example; a noun may
    carry a `notes` paragraph (the `ticket` noun's: the tags Baton reads and the `Requires:`
    clause, R-BTN-74). `baton help` is printed from it (R-BTN-127).
  - **One check.** The front resolves the request's credential to a principal and a target, then
    calls `authorize(principal, action, target)` in core. No route, command, dashboard control
    or MCP tool checks permissions itself.
    - Under `/v1`, a request matching no entry is `404 not-found`. The dashboard's static assets
      are not actions.
    - A dashboard session authorizes as `session` with its minting key's role (§3); a
      delegated key authorizes as `owner` on its one repository, narrowed to its listed ids and
      their `delegated` marks (§2).
  - **Generated surfaces.** The router comes from `http`, the CLI tree and every `help` from the
    command table, and an MCP key's tool list from `delegated` and the key's ids; the API table
    (§14) documents the registry. `npm run check:actions` fails when a route, command or API row
    has no entry, an entry has neither a route nor a command, an id breaks the grammar, a
    `delegated` mark disagrees with R-BTN-186, or a command's example does not parse against its
    arguments.
  - **What can I do.** `GET /v1/actions` answers the caller's own entries, each with its `input`
    schema — to a session, its entries as the registry holds them, minus `delegated`, with `ui`
    (a delegated key is `unauthenticated` there, R-BTN-130). `baton help` with a key, the
    dashboard and MCP's `tools/list` read it. A caller is never shown an
    action it cannot take.

## 2. MCP

- R-BTN-130 (proposed) — Baton serves MCP; a delegated key reaches what R-BTN-186 admits.
  - **Two kinds of MCP credential** (2026-11-26, §5). A person's own agent uses an **interactive
    grant**: an OAuth grant the person approves for themselves, human-driven and short-lived. The
    `bmcp_` key below is **agent-driven**: an owner mints it for a named purpose — an automation
    that runs with no person steering it — never for their own interactive agent, which uses a
    grant instead. An OAuth grant scoped to an intervention (the intervention-sessions proposal) is
    agent-driven too. The rest of this section describes the `bmcp_` key.
  - **The MCP key is a delegated key** (R-BTN-186): an owner of one repository, for the action
    ids listed at its minting, within the registry's `delegated` marks (§1).
  - **Minting.** An approver on the repository's `approvers.members` (R-BTN-188) mints one:
    `baton owner mcp-key create <repository> --name <name> [--actions read | <id>,…] [--ttl
    <days>]` (`POST /v1/owner/{repository}/mcp-keys`). A key has an immutable `id`, never
    reused; `--name` is unique among the repository's live keys, the OAuth spec's grants
    included. A hold or bar the key sets records the actor `mcp:<id>` in its `set_by` (§13)
    beside `hold_reason: mcp:<name>`, and the `own` test below is on the id, so a later key of
    the same name undoes nothing of a revoked one's.
    - It is returned once, `bmcp_` followed by 32 random bytes in base32. Baton keeps one
      `mcp_keys` row: repository, name, hash, the minting approver's fingerprint (an owner key:
      an administrator matches an `owner` entry, R-BTN-188, but signs no `/v1/owner/*` route,
      §12.1, and mints none), the action
      ids resolved at minting, expiry, last use (written at most once a minute) and revocation.
      An MCP key is not a `credentials` row.
    - `read` means every action whose `delegated` mark is `true`, whose `effect` is `read` and
      that exists at minting, so a later release never widens a key. A write is included only
      when listed by id. An id whose mark is `false`, or an action the minter could not take
      itself, is refused at minting (`invalid-params`).
    - It lives at most 90 days (default 30) and ends after 7 days without a call, when the
      credential that minted it is removed or revoked, or when its repository is retired
      (R-BTN-47). It is refused while the repository has
      `api_keys: false` (R-BTN-159), and works again when the setting returns, unless expired.
      It is revoked with `owner.mcp-key.revoke` (`POST /v1/owner/{repository}/mcp-keys/{name}/revoke`),
      and listed with the repository's credentials, with its minter (`GET
      /v1/owner/{repository}/grants`' `mcp_keys`, `baton owner grant list`).
  - **Authorization.** `authorize` treats an MCP key as `owner` on its one repository, narrowed
    to its stored ids and their `delegated` marks; an id whose mark has since become `false` is
    refused. An `own`-marked action succeeds only on what the key itself set: a hold or a bar
    whose `set_by` is `mcp:<id>` (a hold set over MCP is a `held` event with `hold_reason:
    mcp:<name>`; on a ticket already held it changes nothing, so it never replaces another
    reason). The actor is recorded as `mcp:<id>` in history and release messages, shown with its
    name. An MCP key is accepted only on `POST /v1/mcp`; every other route answers it
    `unauthenticated`.
  - **The endpoint.** `POST /v1/mcp` speaks MCP's streamable HTTP transport, statelessly, in JSON.
    - Revisions are those in the build's `MCP_VERSIONS` (at least `2025-06-18`). `initialize`
      needs no `MCP-Protocol-Version` header; on any other request an absent header means
      `2025-03-26`, and a revision not in the list is `400`.
    - Methods: `initialize`; notifications, answered `202`; `ping`; `tools/list`; `tools/call`.
      Any other method is JSON-RPC `-32601`; a batch array is `-32600`.
    - No `Mcp-Session-Id`. `GET /v1/mcp` is `405`. A missing or unknown key is `401` with
      `WWW-Authenticate: Bearer`. A foreign `Origin` is `403`.
  - **Tools.** `tools/list` returns the key's stored ids whose `delegated` mark still stands,
    named by the id with `.` as `_`, with `inputSchema` the entry's `input` and `readOnlyHint` or
    `destructiveHint` from `effect`. `tools/call` runs the route's core function and returns the
    output as `structuredContent` and as text through the `plain` renderer (R-BTN-112).
    - A refusal is a tool error with the route's code. A tool the key does not hold, an unknown
      tool, a target outside its repository and an `own` action on what another set all answer
      `forbidden`.
    - `confirm` over MCP is a schema check, not a human gate (§12.2); the safeguard is the
      minter's choice of ids.
    - Returned values are data, never instructions, and the tool descriptions say so.
      `leg.runs` returns pointers and live state, never log bytes.
  - **Bounds.** At most 60 calls per key in any 60 seconds, counted in memory in the
    tenant's object (a restart empties it), else `rate-limited` with `retry_after_s`. A list
    tool takes `cursor` and returns `next_cursor`, HMAC-bound under `CursorKey` (R-BTN-55) to
    the key, action and input. A page is at most 256 KB; a larger single item is `too-large`.
  - Clients that cannot send a bearer obtain MCP keys through OAuth 2.1
    ([BATON_MCP_OAUTH_SPEC](../BATON_MCP_OAUTH_SPEC.md)), whose grants are MCP keys under this
    rule.

## 3. Sign-in, sessions and confirmed actions

R-BTN-155 governs where it and this section differ: one cookie per browser, its value replaced at
every sign-in (`__Host-baton_session`, not a `bds_` value per session), with a session per tab;
sessions of 12 hours; an owner's or member's repositories read on every request; sign-in codes
with no role, bound by `baton admin open`, `owner open` or `member open` (`POST
/v1/member/login-links` for a member key) and taking the binding key's role; the key chosen after
authentication; and the confirmed acts R-BTN-155 names.

- R-BTN-155 (proposed) — dashboard sign-in is a code a key holder confirms. An administrator signs in
  with `baton admin open` and an administrator key, an owner with `baton owner open` and an
  owner key; the session has that key's role. Its row records the role (`administrator` or
  `owner`), the minting key's fingerprint and, for an owner, the repositories the key owned at
  binding (`dashboard_sessions`). A session is one principal, `session`, authorizing with its
  role (R-BTN-129, §12.1): an administrator's session takes every action listed for it, on every
  repository; an owner's sees, watches and acts only on those of its repositories the key still
  owns, with the actions listed for an owner's session, and never holds an administrator's
  action.
  - **Sign-in.**
    1. `baton admin open` opens `https://<origin>/login?as=administrator`, and `baton owner
       open` `https://<origin>/login?as=owner`; the page carries nothing secret and heads itself
       "administrator sign-in" or "owner sign-in".
    2. The page sends `POST /v1/login {role}`. Baton writes a `login_codes` row of that role, sets
       the pending cookie `__Host-baton_pending` (value `bps_<id>_<secret>`, two minutes, R-BTN-16), and
       answers `{code}`: eight Crockford base32 characters, which the page shows.
    3. The key holder types the code into the CLI, which sends `POST
       /v1/admin/login-links {code}` with the administrator key, or `POST /v1/owner/login-links {code}` with the owner
       key. Baton answers the unexpired, unbound row with that code and the route's role as
       `{role, client_addr, age_s}` and binds nothing. The CLI prints it ("owner session for
       `<address>`, `<n>` s old") and asks `bind? [y/N]`, defaulting to no and taking no `--yes`,
       since the address is the one thing the key holder must read. On yes it sends the same
       route `{code, confirm: true}`, and Baton binds the key to that row; on no it sends
       nothing, and the row expires unbound. An `sk-` key needs a touch for each request. At
       either step any other code, a row of the other role included, is `not-found`, as is an
       owner key that owns no repository, and the CLI then reports how many rows the address
       made and lost in the last two minutes.
    4. The page polls `POST /v1/login {poll: true}` (`{pending: true}` until bound). The request
       carrying the bound row's pending cookie gets the session cookie `__Host-baton_session`
       (value `bds_<id>_<secret>`), and the row is marked used.

    An owner's code never becomes an administrator's session. A `not-found` at either step is
    not a failed verification (the request verified); the per-credential limit (§2.3) bounds a
    key that guesses codes.
  - **Limits.** At most five unbound rows per client address, each living two minutes. A sixth
    drops the oldest row whose pending cookie has never polled, else the oldest polled row; it
    never refuses. The client address is the connection's, or a forwarded one only from the
    `--trusted-proxy` (R-BTN-158). Eviction bursts raise `baton.sign-in-burst`.
  - **Sessions.** A session lives at most 4 hours and dies with its minting key's role, checked
    on every request: an administrator's session ends as soon as its key leaves
    `BATON_ADMIN_KEYS`; an owner's session loses a repository as soon as its key stops owning it
    (`owner.owner.remove`, or an administrator's revocation, R-BTN-57) or the repository is
    retired (R-BTN-47), and ends when none of its repositories remains. `POST /v1/ui/logout` (`ui.logout`) ends the caller's own; `baton owner
    sessions revoke` (`POST /v1/owner/sessions/revoke`, `owner.sessions.revoke`, destructive)
    ends every session the owner's key minted; `baton admin sessions revoke --all` (`POST
    /v1/admin/sessions/revoke`, `admin.sessions.revoke`, destructive) ends every session.
  - **Confirmed actions.** A session's request that changes authority answers
    `202 {confirm_code}` instead of acting: eight Crockford base32 characters, living two minutes and
    used once, bound to the session, the action and its parameters (`action_confirmations`).
    Only the key that minted the session confirms it, through its role's route: `baton admin
    confirm <code>` (`POST /v1/admin/confirm`) for an administrator's session, `baton owner
    confirm <code>` (`POST /v1/owner/confirm`) for an owner's; any other key's is `not-found`.
    The command fetches and prints the action and its target (`{code, dry_run: true}`), asks,
    then sends `{code}`, which performs it.

    The table is the whole list of what a session's action takes. A destructive action (§12.2)
    carries `confirm: true` on every other surface; the table says what a session needs.

    | A session's action | Whose session | Takes |
    |---|---|---|
    | cut over (`POST /v1/ui/cutover`, R-BTN-28); force-reap (`POST /v1/ui/claims/{id}/reap`); clear a fence (`POST /v1/ui/claims/{id}/fence-clear`, R-BTN-19); force a resync onto a rewritten default branch's head (`POST /v1/ui/resync` with `force: true` and `sha`, R-BTN-11); confirm or release an unconfirmed completion (`POST /v1/ui/claims/{id}/confirm`, `…/release`); confirm an adoption (`POST /v1/ui/adoptions/{claim}/confirm`) | an administrator's | the code |
    | lift a hold, set or clear expedite (`POST /v1/ui/overrides/{ticket}` with `hold: false` or `expedite`) | either | the code |
    | any act an `approvers.*` list governs, or that adds, changes or removes an owner, a member, a grant or another credential (R-BTN-155) | an administrator's or an owner's | the code |
    | approve an MCP grant (`owner.mcp-key.approve`, `BATON_MCP_OAUTH_SPEC` §5), whatever it names (R-BTN-186) | an owner's | the code |
    | Stop (`leg.stop`: `POST /v1/ui/messages` `{kind: "release", payload: {ticket_id, reason: "requested"}, confirm: true}`, R-BTN-119) | either | §12.2 confirmation dialog; no code |
    | any other destructive action (§12.2), cancel among them | either | its dialog, which sends `confirm: true` |
    | everything else a session may call: a hold, a resync, a status request, resolving a condition (`POST /v1/ui/conditions/{condition}/resolve`, R-BTN-163), a person leg's answer (R-BTN-116; an owner's or member's session, never an administrator's, R-BTN-181), an OAuth request, its status, a denial, `ui.logout` | either | nothing |

    An owner's or member's session acts only on its repositories, and an administrator's
    controls are not drawn for it. Every screen draws the controls its session's role may call
    (R-BTN-186): the credential, governance and tenant screens included, each also naming the
    CLI command that does the same. A member's session holds no action in this table but its
    answer (R-BTN-204).

## 4. The screens

- **The screens.** The dashboard is a walk down the entity tree the REST API, the CLI and MCP
  already draw (R-BTN-129): sign in, pick a repository, and every screen after that is one
  entity, every value it draws reaching it as a text node or through R-BTN-112's `ui` renderer
  (§12.3). `/` holds the caller's repositories — every registered one for an administrator's
  session, the key's own for an owner's, each with its head, mode, ready count and open
  conditions; nothing else is tenant-scoped for an owner. The screens' paths and who may open
  each are §11.4's table, built.
  - **`/board`** — the repository's live claims: each one's event timeline and reap deadline,
    **stalled** where its runner is alive but `last_activity_at` is over 2 hours old,
    `condition-wait` where the leg waits on a condition, with session links (R-BTN-113) and log
    directories (R-BTN-128).
  - **`/tickets`** — every ticket under its state word (below), Ready in the matching order with
    each ticket's `requires` and eligible alive runners, and **ready but nobody can take
    it** with the failed rule.
  - **`/tickets/{ticket}`** — the ticket as Baton holds it: its station and path, the claim's
    legs since, what a suspended ticket waits for, its newest hand-off, blocks, queued leg and
    its source (R-BTN-83), parent and children, and history with input and output pointers
    (R-BTN-81, R-BTN-82).
  - **`/goals`** — the repository's goals, as the ticket source posts them.
  - **`/courses`** — each course of the repository as stations and legs, every leg drawn as an
    edge with its state (ready, running, blocked by kind and when found, backing off) in colour
    and a text label, never a blocked station (R-BTN-126), with `off-graph` transitions and
    course stats.
  - **`/courses/{course}`** — the one course: the tickets on it, each at its station and on its
    path as Baton holds them, and each leg's queue depth against `max_queue` and the intake
    state (R-BTN-79).
  - **`/conditions`** — the debugger (R-BTN-163): the open conditions and the queued person legs
    §7 lists there, ordered by severity then age, each with its restarts or options, its
    question's link, and the tickets it would unblock; a person leg's entry takes the answer
    where the policy admits an `owner` writer, else names `baton decision answer` (R-BTN-116).
  - **`/conditions/{condition}`** — the Resolve page (R-BTN-163): the one condition, its detail
    and restarts; choosing a restart is `ticket.resolve` for a signed-in owner of its repository
    or an administrator.
  - **`/runners`** — the runners granted on the repository, grouped by hostname (R-BTN-3), each
    card marked with its state: alive or dead, harness, capabilities (declared,
    and granted per repository, R-BTN-174), tags, courses, lease timeout, last seen, last
    activity, the claim held, current activity, transcript link, executor (source, digest and
    `provides`, R-BTN-107), credential kind and registering token.
  - **`/runners/{runner}`** — the one runner: a 24-hour timeline, claims as bars, activities
    nested under them by kind, failed ones marked; a segment shows its label, detail and
    transcript; leg runs link their `session_url` (R-BTN-113) and show their log directory
    (R-BTN-128) and their executor digest, environment and instance (R-BTN-107) as text.
  - **`/grants`, `/owners`, `/tokens`, `/mcp-keys`, `/sync-keys`, `/check-runners`** — the
    repository's credentials, the grants with their keys' spans (R-BTN-146).
  - **`/policy`, `/settings`, `/bars`, `/consents`, `/attestations`** — the repository's
    governance, the policy with its version log and computed guarantees (R-BTN-188, R-BTN-189).
  - **`/sync`** — the repository's sync: every place git disagreed with Baton (R-BTN-85), by
    kind and age, with Baton's value, git's, the observation and a link to the ticket's history.
  - **The tenant screens** — the registry with each repository's head, mode and owners
    (R-BTN-179); the instance view and the day's request and row-write counts (R-BTN-99); the
    registered resources, their instances and readings, and the instrument keys (R-BTN-76,
    R-BTN-101); each capability's seats held with the holding claims (R-BTN-178); the instance
    settings — `link_hosts`, `session_hosts`, `check_app_id` (R-BTN-112, R-BTN-113, §12.7); the
    tenant at one request — the live counts and the request rate against the envelope, and
    storage (R-BTN-87); the dashboard sessions (R-BTN-155).

  The rules, each stated once here:
  - **The rule.** A screen is drawn from one entity's REST reads — the §14 rows whose callers
    admit `session` (B-192) — and its controls are the registry actions whose `ui.view` names it
    (R-BTN-129).
  - **The strip.** Every repository screen carries running now · ready · needs you, linking to
    `/board`, `/tickets` and `/conditions`, and the repository's mode where it is not cut over.
  - **Polling.** Every screen polls its reads each 10 seconds with `If-None-Match`, paused while
    the page is hidden, its freshness shown; while the answers are unchanged the interval doubles,
    to at most 60 seconds, and a changed answer or the page shown again brings it back to 10
    (B-242: every poll costs reads); the one exception is the confirmation-code dialog,
    which polls its screen's reads every 5 seconds for the code's two minutes (R-BTN-155).
  - **Refusals.** On the repository and owner reads, a repository the caller cannot read — or
    none — answers `forbidden` for every principal, and the screen says "This repository is not
    yours or does not exist" with a link to `/`; an entity id not found in a readable repository
    answers `not-found` and the screen says "No such ticket" — condition, runner, course alike:
    one component, one wording.
  - **Target-dependent controls.** An action whose answer depends on the target's policy
    (`ticket.unhold`, a person leg's answer, `attestation.add`) is drawn only where the read
    says the caller may take it — `allowed: [<action id>]`, or `answerable`, or
    `writable_types`, computed by `authorize` with the session as principal — and the app never
    reads the policy to decide.
  - **Ticket state.** One word per ticket, from `unconfirmed`, `running`, `waiting-person`,
    `held`, `blocked`, `backing-off`, `suspended`, `ready`, `closed`, in that precedence, with
    `reasons` listing every other that applies; the Tickets tabs are Ready, Running, Blocked
    (`held`, `blocked`, `waiting-person`, `backing-off`, `suspended` — a held ticket counts
    under Blocked), Unconfirmed, and Closed today (`closed` in the last 24 hours) — the same
    words `docs/context/vocabulary.mdx` defines.
  - **Controls.** Every control calls a registry action through `authorize`; what it takes is
    §3's table.

## 5. People, identities and the roster

The owner's decisions of 2026-11-26, resting on
[human intent and autonomy](../../docs/context/human-intent.mdx). Baton today knows keys, not
people: administrators are keys, owners are keys per arena (written `repository` in the spec), a
dashboard session is one key's, and the identities a person has — an Access email, a forge
account — are not tied to each other. Nothing here is built. It takes from the earlier
*users and groups* proposal (immediately-run/baton#300, closed) the one-time attach code, and leaves
the rest of it: groups, acceptance, approver entries naming people and `answerers` carry authority,
and Baton does not do access control the forge already does (the owner, 2026-11-26).

- **A person is for accountability and notification, never authority.** A person is the tenant's
  record of someone: an id, a display name, the keys that are theirs and the identities linked to
  them. It confers no role. Roles stay on keys, as the spec has them — owner keys (R-BTN-58),
  `human_only` keys (R-BTN-185), runner grants — and the policy's lists name roles, never people
  or groups. Baton keeps no groups: notifying a team is a pull from Needs you, or one push to a
  channel the team already shares ([personal secrets](personal-secrets.md)).
- **A person's credentials, and who drives.**
  - **Signing in with the forge.** On an arena whose config repository is on a forge, a person
    signs in through the forge's own OAuth (GitHub's, say). Baton finds or creates the person and
    links the forge account the forge vouched for, verified in that one step. That sign-in is how a
    person who owns no key gets a Baton credential: a dashboard session, from which they approve
    interactive grants and attach keys. One forge account belongs to at most one person, and an
    account Baton knows as a runner's, the sync's or a deliverer's identity (R-BTN-139's
    `runner_pushers`, the sync's) is refused.
  - **Keys.** A person's SSH keys, attached by their holder: the person, signed in or with an SSH
    key they already hold, mints a one-time **attach code** (eight characters, ten minutes, used
    once, stored as a hash), and the new key attaches itself with a request it signs carrying the
    code, so a key is attached only by whoever holds it. An interactive grant or any other token
    never mints one. An administrator mints a code only for a person's first key, where the person
    has no other way in (plain git), and the person is told on their verified channels. Attaching
    confers nothing: a key attached to a person is an owner of an arena only by that arena's
    `approvers.members` act, as today.
  - **Interactive grants.** A person's MCP credential is an OAuth grant
    ([BATON_MCP_OAUTH_SPEC](../BATON_MCP_OAUTH_SPEC.md), amended) they approve for themselves from
    their dashboard session: an access token of an hour at most, its refresh capped at twelve hours
    (a dashboard session's life) and ended after an hour unused. The consent's ticked actions stay
    the grant's ceiling; within them it acts with the role of the person's key behind the session
    — an owner's acts for an owner, `course.start`, session claims and reads for a person on the
    roster with no key — at the proof a token carries
    ([human intent](../../docs/context/human-intent.mdx) §2). The MCP endpoint stays stateless: a
    session claim or an intervention binds to the grant.
  - **Agent-driven keys.** A `bmcp_` key (§2) carries a purpose and is never human-driven.
  - **A runner is always agent-driven**, `human-operator` included.
- **Linked identities** — forge accounts by their immutable ids, Access emails, tracker accounts,
  contact identifiers — say who a person is elsewhere: for attributing an act, resolving a
  ticket's assignee, and reaching them. A linked forge account never says that a person rather
  than their agent acted: a forge cannot tell. The policy's `human_identity` (R-BTN-188) stays as
  the spec has it. A linked identity is used only once verified as the person's — a forge account
  by signing in with the forge, a channel by a code ([personal secrets](personal-secrets.md)) —
  and an unverified one receives nothing.
- **The roster.** An arena's roster is the people who may start a course there (`course.start`)
  and hold a session claim. It is read from the forge, never kept by Baton:
  - **Its source** is the arena's setting `roster.source` (R-BTN-66): `repo-writers`, the default,
    the forge accounts that can push to the config repository; or `org-members`, the members of the
    forge organisation that owns it.
  - **The sync posts it.** Baton's server holds no forge read credential, so the arena's sync,
    which does, reads the list and posts it as an attestation, `std:roster@1`
    (`{host, source, members: [<forge user id>]}`), from the writer the policy admits for the type.
  - **Fresh, or nothing.** The latest roster counts for 24 hours. Every `course.start`, session
    claim and renewal is checked against it; an older roster raises `baton.roster-stale` on the
    arena and those acts are refused `unavailable` until a newer one arrives. A person dropped from
    the roster can renew no session claim from the next post on.
  - **Only people.** The roster gates human-driven callers; runners are gated by their grants, as
    today. An arena's owners' people may always start and claim.
  - **Plain git**, with no forge to ask: the roster is the arena's owners' people, unless the git
    host posts `std:roster@1` itself with a `service:` key the policy admits.
- **No ceiling on a person's claims.** A person's session claims count against nothing but the
  lock: one holder per ticket. `max_claims` bounds runners' grants.
- **Self-serve.** A person manages their own keys (by attach code), linked identities, channels,
  preferences and sealed secrets. An administrator retires people, and mints a first key's attach
  code where nothing else lets a person in.
- **Migration.** Each owner key becomes a person holding it; a human with several owner keys
  merges them by attach codes, one person per human. Each `ACCESS_IDENTITIES` line becomes an email
  linked to its key's person; administrator keys become administrators' people. No key changes,
  no role moves, and no request a key signs today is refused afterwards.
- **Amends** when built: BATON_MCP_OAUTH_SPEC §5 (a person approves a grant for themselves, from
  a session that signing in with the forge may open), §7 (an interactive grant's role and lifetime,
  within the consent's ticks), §8 (the refresh's cap) and G-BTN-157, and its open question on
  non-owner teammates, which the roster answers; R-BTN-155 (sessions for people signed in with the
  forge); R-BTN-66 (`roster.source`); R-BTN-181 and R-BTN-110 (`std:roster@1`); R-BTN-160's table
  (`baton.roster-stale`); R-BTN-13 and R-BTN-159 (a key attached to a person), R-BTN-58 (unchanged
  in substance: roles stay on keys), R-BTN-129 and §12.1 (the person as the actor recorded beside
  the key; attach codes), R-BTN-130 and §2 (the two kinds of MCP credential), R-BTN-155 (a session
  as its person's), R-BTN-139 (the roster asks the forge as pushers do), R-BTN-194
  (`last_written_by` may name the person whose linked account pushed, never whether a person or
  their agent did), §13 (the people tables), and the vocabulary (*Person*, *Roster*, *Interactive
  grant*).

Open: how a tracker identity is verified, where the tracker offers no sign-in.
