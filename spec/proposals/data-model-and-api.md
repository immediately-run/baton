---
title: "Proposal: tables and routes of designs not built"
description: "The tables, columns, routes and wire fields that BATON_SPEC §13 and §14 named for designs Baton does not build yet, grouped by design."
---
**Status:** proposal — not built; moves into BATON_SPEC §13 and §14 when built (tickets B-8, B-25, B-38, B-55, B-61, B-64, B-73, B-120, B-136, B-146, B-147, B-206)

Nothing here binds Baton as built. [BATON_SPEC §13](../BATON_SPEC/13-data-model.md) holds the
tables of the schema and [§14](../BATON_SPEC/14-api.md) the routes Baton serves; their
conventions, error shape and caller words apply here. Each part below is one design: when the
design is built, its rows move into §13 and §14 in the same pull request. Rule ids are written
`R-BTN-n (proposed)`.

## The action registry and MCP

Design: [the action registry and MCP](people-and-dashboard.md#1-the-action-registry) (B-25,
B-124); OAuth for MCP clients is [BATON_MCP_OAUTH_SPEC](../BATON_MCP_OAUTH_SPEC.md) (B-73), whose
§12 tables and §13 routes join these.

Every route of §14 becomes a registry entry (R-BTN-129, proposed); the router, the CLI tree and
the MCP tools are generated from the registry, and `npm run check:actions` keeps the registry
and §14's table equal.

- Caller *delegated*: an MCP key, as `owner` within R-BTN-186 (R-BTN-130, proposed). An *owner*
  row admits one wherever the registry marks the action `true` or `own`.
- An actor column also holds `mcp:<id>`, an MCP key's immutable id, never its reusable name.
  `ticket_overrides.hold_reason` also holds `mcp:<name>`.
- `GET /v1/owner/{repository}/grants` also answers
  `mcp_keys: [{name, minted_by, actions, expires_at, last_used_at, client_host?, client_addr?}]`.
- `too-large` also covers R-BTN-130's oversize item.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `mcp_keys` | `id` (random, never reused) | `repository_id`, `name` (unique among live rows of the repository), `key_hash` (unique; NULL for an OAuth grant), `minted_by` (owner fingerprint), `actions` JSON (ids resolved at minting), `expires_at`, `last_used_at`, `revoked_at` | R-BTN-130 (proposed) |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/owner/{repository}/mcp-keys`, `…/mcp-keys/{name}/revoke` | owner | `{name, actions, ttl}`; revoke `{confirm: true}` | the key once; `{ok: true}`; `invalid-params` for an id R-BTN-186 does not admit | R-BTN-130 |
| `GET /v1/actions` | any key, a session (never an MCP key) | — | the caller's registry entries, with `input` schemas — to a session, minus `delegated`, with `ui` | R-BTN-129 |
| `POST /v1/mcp` | an MCP key, as a bearer | JSON-RPC `initialize`, `ping`, `tools/list`, `tools/call`; the tools are the key's ids within R-BTN-186 | streamable HTTP, JSON only; `GET` answers `405` | R-BTN-130, R-BTN-186 |

## Sign-in by code, owners' sessions and confirmed actions

Design: [sign-in, sessions and confirmed actions](people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions)
(B-206).

BATON_SPEC R-BTN-155, R-BTN-185, R-BTN-204 and §13.2 govern where they and this section differ:
sessions of three roles (members too), one per tab under one rotating cookie
(`dashboard_cookies`), repositories read on every request rather than stored, sign-in codes
with no role (the binding key's role is the session's), a session's attestation carrying writer
classes `human` and its role, and the confirmed acts R-BTN-155 names.

- `dashboard_sessions` gains `role` (`administrator`\|`owner`) and `repositories` JSON (an
  owner's: those its key owned at binding).
- Callers: *admin session*, a session whose role is administrator; *owner session*, one whose
  role is owner, on its repositories only.
- A session's actions that R-BTN-155 (proposed) lists as confirmed answer `202 {confirm_code}`
  and run when the session's minting key confirms the code. In §14 these are
  `POST /v1/ui/claims/{id}/reap`, `…/fence-clear`, `…/confirm`, `…/release`, a forced
  `POST /v1/ui/resync`, and `hold: false` and `expedite` on `POST /v1/ui/overrides/{ticket}`.
- `POST /v1/ui/messages` answers an owner's session `forbidden` for a runner holding no claim of
  its repositories. `GET /v1/ui/state` answers an owner's session its repositories only.
- `not-found` also covers an unknown, expired or bound sign-in code.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `login_codes` | `id` (of the pending sign-in `bps_<id>_<secret>`) | `pending_hash`, `code_hash`, `role` (`administrator`\|`owner`, from `POST /v1/login`), `client_addr`, `key_fingerprint` (set when bound by that role's route), `created_at`, `expires_at`, `bound_at`, `used_at` | R-BTN-155 (proposed) |
| `action_confirmations` | `code_hash` | `session_id`, `action`, `params` JSON, `created_at`, `expires_at`, `used_at` | A session's action awaiting confirmation by the session's minting key |

| Route | Caller | Body or query | Response |
|---|---|---|---|
| `POST /v1/login` | none; the pending cookie | `{role: "administrator" \| "owner"}`, then `{poll: true}` | `{code}` and the pending cookie; `{pending: true}` until bound; then the session cookie |
| `POST /v1/admin/login-links`, `POST /v1/owner/login-links` | admin; an owner key of any repository | `{code, confirm?}` | without `confirm`, `{role, client_addr, age_s}`, binding nothing; with `confirm: true`, `{ok: true}`, bound; `not-found` for any code but an unbound row of the caller's role |
| `POST /v1/admin/confirm`, `POST /v1/owner/confirm` | the key that minted the session | `{code, dry_run?}` | performs the action; with `dry_run`, `{action, target}`; `not-found` for another session's code |
| `POST /v1/admin/sessions/revoke` | admin | `{all: true, confirm: true}` | `{ok: true}` |
| `POST /v1/owner/sessions/revoke` | an owner key | `{confirm: true}` | `{ok: true}`; ends every session the key minted |
| `POST /v1/ui/logout` | session | — | `{ok: true}` |

## Conditions, handler tickets and cancellation

Design: BATON_SPEC §7's proposal page (B-55), and the `cancel` leg
([courses, §3](courses.md#3-the-cancel-leg)).

- `conditions` gains `handler` (the handler ticket) and `consumed_at` (an end of the raiser's
  claim consumed the restart, R-BTN-162, proposed); it is also indexed open by `handler`.
- `POST /v1/runner/claims/{id}/conditions` also takes `handler?` and answers `handler_id?`;
  `GET /v1/repositories/{repository}/conditions` rows carry `handler?`.
- `messages.kind` also holds `handled`; the heartbeat response carries
  `handled?: [{condition_id, handler, restart, reason, answered_by?}]`.
- The claim response carries `resume?`, the chosen restart (R-BTN-162, proposed).
- `events.kind` also holds `call-settled` and `superseded`, each also a `ticket_history` row
  ([conditions](conditions.md)).
- Cancellation (R-BTN-168, proposed): `claims.superseded_at`; `ticket_overrides.cancelling_at`
  (set by a cancellation, cleared at the close, never in `kept_json`); a ticket marked
  `cancelling` keeps its board rows until Baton closes it, and is counted in a queue;
  `POST /v1/ui/overrides/{ticket}` also takes `{cancel: true, confirm: true}`.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `condition_bindings` | `(repository_id, ticket_id, prefix)`; `ticket_id` `''` for the repository scope | `course_id`, `replaces`, `snapshot_sha` | Bindings as posted (`bindings` and `tickets[].conditions`) from `.baton/baton.json` and ticket files; Baton reads them only to file handler tickets for its own conditions (R-BTN-161, R-BTN-171). Deleted with its ticket's board rows |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/ui/conditions/{condition}/resolve` | session | `{restart}` | `{ok: true}`, in one step; `invalid-params` for a restart the condition does not offer | R-BTN-163 |

## Timers

Design: timers on a leg (B-61).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `ticket_timers` | `(ticket_id, leg, kind)`; `kind` `stalled`\|`expires` | `repository_id`, `from_at`, `due_at`, `fired_at` | The instants Baton holds per leg; each fires once per `from_at`; renamed with their leg (R-BTN-64, R-BTN-116, R-BTN-167). Deleted with its ticket's board rows; `due_at` is one of the alarm's instants |

## The outbox

Design: the outbox and its deliverers (R-BTN-171, proposed; B-64), and the store's display
([tickets and sources](tickets-and-sources.md), §2).
Runners drain the outbox through the two routes below, never through a claim.

- `runners.delivers` JSON (`["git" | "forge-check" | "source"]`, the last heartbeat's); the
  heartbeat body carries `delivers?`.
- `tickets.display_refresh` JSON `{arrival, delivered_observation?, unconfirmed, confirmed, noted}`
  (R-BTN-200, proposed): Baton's own record, no input of `row_hash`.
- `ticket_history.kind` also holds `outbox`.
- The alarm also reads `outbox.not_before`, and `outbox.queued_at` against R-BTN-171's lateness
  bounds (`baton.outbox-late`).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `outbox` | `(repository_id, id)`; `id` increasing per repository | `ticket_id` (the ticket to withdraw, show or note, or the check ticket), `kind` (`withdraw`\|`forge-check`\|`source-show`\|`source-note`), `fields` JSON (identifiers only, a `forge-check`'s `summary` and a `source-show`'s value; the deliverer renders the effect from them), `state` (`queued`\|`claimed`\|`delivered`\|`confirmed`\|`dropped`), `credential_id` (the deliverer while `claimed`), `attempts`, `not_before` (backoff, lease end, or deletion), `queued_at`, `delivered_ref` (a commit, a `check_id`, or the store's own reference for a source entry), `confirmed_at`, `snapshots_since_delivered` | Every git write, check run and ticket-store write Baton intends, delivered by runners (R-BTN-171, R-BTN-115, R-BTN-200) |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/runner/outbox/claim` | machine, SSH-signed, on a grant whose role the repository policy's `outbox` admits | `{limit?}` (≤ 50) | `{entries: [{repository, id, kind, ticket, fields}]}` of the classes it declared, each leased 10 minutes; a ticket's entries of one class together, in `id` order | R-BTN-171, R-BTN-115 |
| `POST /v1/runner/outbox/{repository}/{id}` | the entry's claimer | `{state: "delivered", ref}` (recorded as its `std:effect@1` attestation, R-BTN-191) or `{state: "failed", reason: "transient" \| "refused"}` | `{ok: true}`; `forbidden` for another runner's entry | R-BTN-171 |

## Checks

Design: BATON_SPEC §10's check courses and check-runners (B-5).

- `credentials.kind` also holds `check-runner`; a check-runner key's `hostname` is unique among
  live ones.
- `tickets` gains `check_sha`, `check_head_repo_id`, `check_head_ref`; `claims` gains
  `check_sha`; the claim response carries `check_sha?` and `check_head_ref?`.
- `head-moved` also answers a check claim whose head changed (R-BTN-153).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `check_runners` | `(credential_id, repository_id)` | `capabilities` JSON (expanded), `added_by`, `added_at`, `revoked_at` | Check-runner keys; the row stands in for a grant (R-BTN-114) |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/owner/{repository}/check-runners`, `…/check-runners/{fingerprint}/revoke` | owner | `{public_key, name, capabilities?}`; revoke `{confirm: true}` | `{ok: true}` | R-BTN-114 |

## The executor's run record and leg logs

Design: [the declaration and the run's record](checks-and-executors.md#26-the-declaration-and-the-runs-record)
(R-BTN-107, proposed) and [leg logs](checks-and-executors.md#10-leg-logs-r-btn-128-proposed).

- `claim_legs` gains `executor_digest`, `environment` and `instance`, each opaque, 1–256
  characters of printable ASCII.
- `POST /v1/runner/claims/{id}/advance` also takes `executor_digest?`, `environment?` and
  `instance?` on the advance that starts a run, and answers `leg_log?: {dir}`.
- `GET /v1/repositories/{repository}/tickets/{ticket}/legs/{leg}/runs` rows carry
  `executor_digest?`, `environment?` and `instance?`.

## Registration tokens

Design: registration tokens beside keys (R-BTN-117, R-BTN-157; B-8). `credentials` gains
`token_id`.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `registration_tokens` | `id` (of `brt_<id>_<secret>`) | `repository_id`, `secret_hash`, `role` (`runner`), `capabilities` JSON, `uses_left`, `grant_ttl_s`, `expires_at`, `created_by`, `created_at`, `revoked_at` | R-BTN-117, R-BTN-157 |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/owner/{repository}/tokens`, `…/tokens/{id}/revoke` | owner | `{role: "runner", capabilities?, ttl_s?, uses?, grant_ttl_s?}`; revoke `{confirm: true}` | `{id, token}`, the token once; revoking revokes every credential it registered | R-BTN-117, R-BTN-157 |
| `POST /v1/register` | `Authorization: Baton-Token <token>` | `{name, public_key}` or `{name, api_key: true}` | `{credential_id, grant}`, and `{api_key}` once for the second form; `forbidden` beyond the token's scope; `unauthenticated` for a spent, expired or revoked token; `conflict` | R-BTN-117 |

## Attestations, roles and fact legs

Design: BATON_SPEC §12.8's unbuilt parts (B-136, B-146, B-147).
`POST /v1/repositories/{repository}/attestations` is served for a person's answer only (§14).

- `ticket_blocks.kind` also holds `attestation`, its `binds` set from the requirement
  (R-BTN-181).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `attestations` | `id` | `repository_id`, `ticket_id`, `type`, `subject_json`, `value_json`, `writer_class`, `writer_key`, `nonce`, `lapses_at`, `at`, `revoked_at`, `superseded_by` | Typed facts legs require, authenticated by the request that posted them (R-BTN-181); never imported |
| `webauthn_credentials` | `(owner_key, credential_id)` | `cose_key`, `aaguid`, `attestation`, `registered_by_signature` | Attested authenticators a `human_only` key registered (R-BTN-185) |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/repositories/{repository}/attestations` | also an owner session (writer `owner`) or a `service` key | as §14 | `{id}` | R-BTN-181 |
| `DELETE /v1/repositories/{repository}/attestations/{id}` | its writer; for a `human` type, a `human_only` key | `{confirm: true}` | `{ok: true}` | R-BTN-181, R-BTN-185 |
| `PUT /v1/owner/{repository}/grants/{fingerprint}/role` | an approver on `approvers.roles` | `{role: "runner" \| "trusted-runner", domain?, checker?}` | `{ok: true}`; `invalid-params` for `trusted-runner` on an API key, or a `checker` mark R-BTN-180 refuses | R-BTN-180, R-BTN-188 |
| `GET /v1/repositories/{repository}/fact-legs` | a trusted runner whose `service:` key the policy names for `std:arrival@1` (the fact reader) | — | `{tickets: [{ticket, station, path_len, leg, fact, waiting_since}]}` | R-BTN-192 |

## The doorbell

Design: the doorbell (R-BTN-91, proposed).

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `GET /v1/runner/push` | machine | `?session_name=`; WebSocket upgrade, authenticated as a heartbeat | `101`, then `{ring: [<kind>]}` frames and `pong`; a heartbeat refusal instead of the upgrade | R-BTN-91 |

## Grant acceptance and the sync flag

Design: R-BTN-146 (proposed). The heartbeat response carries `pending_grants[]`.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/runner/grants/{repository}/accept`, `…/decline` | machine alone | accept: `{confirm_span?}` | `{ok, span}`; an acceptance that raises the span without `confirm_span` is `conflict` listing the repositories that would lose sync | R-BTN-146 |
| `PUT /v1/owner/{repository}/grants/{fingerprint}/flags` | owner | `{sync}` | `{ok: true}` | R-BTN-146, R-BTN-186 |

## Code-repository consents

Design: R-BTN-140's consent (proposed). `POST /v1/admin/repositories` also takes
`code_repo_consents_add?`.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `code_repo_consents` | `(home_id, repo_id)` | `consented_by` (`owner:<fp>` of `repo_id`'s owner, or `admin:<fp>`), `consented_at` | A registered repository's consent to a home's `code_repos` entry; written only by the route below or an administrator, never by the home's settings |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/owner/{repository}/code-repo-consents` | owner | `{repository: <home listing it>, confirm: true}` or `{repository, withdraw: true}` | `{ok: true}` | R-BTN-140 |

## Sync wants, sync keys and Resync

Design: [tickets and sources](tickets-and-sources.md) (the source's writer, §1; renewal and the
lapse bar, §3; the founded head and the lagging fetch, §4; the forced Resync, §5), and R-BTN-94
and R-BTN-105's wants.

- `board_head` gains `observation_holder` and `observation_renewed_at` (§3), `behind_since`
  (§4; the alarm reads it for `baton.head-behind`), `reset_at` (§5: set by a forced Resync until
  the next accepted post) and `source_writes` (§1: the writer exports the last accepted post
  declared).
- `POST /v1/sync/observation` also takes `{renew?}`, and `behind?` and `unfounded?` beside
  `release`.
- `POST /v1/forges/{repository}/notify` (R-BTN-95) verifies a GitLab or Gitea notification
  against `BATON_FORGE_SECRETS`, answers `204` and records a want.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `observation_lapses` | `(repository_id, number)` | `credential_id`, `at` | Observation numbers a credential let lapse (R-BTN-150) |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/sync/want` | sync | — | `{ok: true}` | R-BTN-94 |
| `GET /v1/sync/wanted` | sync, mirror | — | `{wanted, since?, head_sha}` for the credential's role; changes nothing but its nonce | R-BTN-94, R-BTN-105 |
| `POST /v1/owner/{repository}/sync-want` | owner | — | `{ok: true}` | R-BTN-105 |
| `POST /v1/owner/{repository}/sync-keys`, `…/sync-keys/{fingerprint}/revoke` | owner | `{public_key, role: "sync" \| "mirror"}`; revoke `{confirm: true}` | `{ok: true}`; `conflict` | R-BTN-93 |
| `POST /v1/admin/repositories/{repository}/resync` | admin | `{force: true, sha, confirm: true}` | `{ok: true}`; the head reset to `sha` | R-BTN-11 |
| `POST /v1/ui/resync` | session; `force` an admin session | `{repository, force?, sha?}` (`sha` with `force`) | `{ok: true}`; dispatches the sync; with `force`, the head is reset to `sha` | R-BTN-35, R-BTN-11 |

## Admission limits

Design: [admission limits within a tenant](multi-tenancy.md#admission-limits-within-a-tenant)
(R-BTN-149, proposed).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `write_budgets` | `(credential_id, repository_id, day)` | `writes` | Non-upkeep row writes per UTC day (R-BTN-149) |

## The policy's dry run

The built policy route and its preview are specified in [§14](../BATON_SPEC/14-api.md)
and R-BTN-188. See [the proposed additional stop predictions](security.md#1-extending-the-policys-dry-run-r-btn-188-proposed).

## A control path changed outside a course

Design: [the `out-of-course` finding](security.md#12-a-control-path-changed-outside-a-course-129-proposed).

- `scope_findings.kind` also holds `out-of-course`: `ticket_id` NULL, `target` the head commit,
  one row per target, open or closed. `push_deliveries` is what the check reads.
- `events.kind` also holds `out-of-course`.
- `POST /v1/ui/scope/{id}/resolve` also answers `not-found` for an `out-of-course` finding not
  yet listed.

## Other reads and owner routes

Routes §14 named that Baton does not serve. The owner's route and adopt are B-38's and
[the owner's ticket adopt](ticket-adopt.md) (B-120); the others are the owner-key and reader
surfaces of actions the dashboard or the heartbeat serves today.

- `events.kind` also holds `history-adopted`, also a `ticket_history` row
  ([the owner's ticket adopt](ticket-adopt.md)).
- The claim response also carries `previous_attempts_total`, the count of earlier ended claims
  beside the newest ten listed in `previous_attempts`.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `GET /v1/repositories/{repository}/tickets/{ticket}/prerequisites` | a machine key granted there, owner, session | `?leg=` (the queued leg), `?runner=me` | `{leg, ready, prerequisites: [{kind, ref, met, why, since?, until?, url?, found?}]}` | R-BTN-120 |
| `GET /v1/repositories/{repository}/courses` | reader | — | each course file as last accepted, with its capability types and roles | R-BTN-121, R-BTN-157 |
| `POST /v1/owner/{repository}/tickets/{ticket}/route` | owner | `{leg}` or `{clear: true}` | `{ok: true}` | R-BTN-83 |
| `POST /v1/owner/{repository}/tickets/{ticket}/adopt` | owner, as R-BTN-186 and R-BTN-188 require | `{at?, next?, ran?: [<leg>], confirm: true}` | `{ok: true, before, after}`; `nothing-implied`, `off-graph` | R-BTN-39 |
| `POST /v1/owner/{repository}/tickets/{ticket}/release` | owner | `{reason: "requested", confirm: true}` | `{ok: true}` | R-BTN-119 |
| `POST /v1/owner/{repository}/overrides/{ticket}` | owner | `{expedite}`, `{hold}` or `{cancel: true, confirm: true}` | `{ok: true}` | §6, R-BTN-186 |
| `POST /v1/owner/{repository}/bars/follow` | owner | `{course}` | `{ok: true}` | R-BTN-142 |

## Riders on §3: retirement's further steps and code-repository consent (R-BTN-47, R-BTN-140, proposed)

- **Retirement (R-BTN-47).** Each store that is not built adds its step to the transaction that
  retires a repository, with the ticket that builds it. Baton then also:
  - removes the repository from every owner session's reach, ending a session left with none
    (R-BTN-155);
  - revokes every MCP key on it, OAuth grants included, with their tokens, and every pending
    OAuth request and unredeemed code naming it (R-BTN-130);
  - exhausts its registration tokens; the credentials those tokens registered are not revoked
    (R-BTN-117);
  - drops its `queued`, `claimed` and `delivered` outbox entries, logging each; a deliverer's
    later mark of one is ignored (R-BTN-171);
  - deletes its sync wants, its ticket timers and every consent row it gave or was given
    (R-BTN-94, R-BTN-167, R-BTN-140).
- **Consent (R-BTN-140).** A `code_repos` entry whose `{host, repo_id}` is a registered
  repository B of the tenant (a retired one's entry never has reach) needs B's consent, a
  `code_repo_consents` row judged by id at every use and never written by the listing repository
  A's settings: `POST /v1/owner/{B}/code-repo-consents {repository: A, confirm: true}` signed by
  B's owner, or an administrator's `code_repo_consents_add`; `withdraw: true` withdraws it.
  Without consent the entry has no reach and raises `baton.code-repo-unconsented`.
  `POST /v1/sync/observation` then hands the sync only consented entries.
