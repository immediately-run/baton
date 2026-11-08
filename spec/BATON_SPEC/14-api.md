---
title: "14. API"
description: "Every route below is an action registry entry (R-BTN-129); the router, the CLI tree and the MCP tools are generated from the registry, and npm run check:actions keeps the registry and this table, with BATON_MCP_OAUTH_SPEC §13's rows until B-73 folds them in here, equal."
---
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
/v1/admin/confirm` or `POST /v1/owner/confirm`). The CLI command that calls each route is
R-BTN-127's. Any route may answer `rate-limited` or `quota` (R-BTN-135).

**Errors** are `{ok: false, code, message}`, with these codes:

| Code | Meaning |
|---|---|
| `unauthenticated` | no valid credential, or a bearer on a route its kind never reaches |
| `forbidden` | a valid credential without the power (§12) |
| `not-found` | no registry entry; an unknown, expired or bound sign-in code |
| `invalid-params` | a body or query that fails validation |
| `invalid-prerequisite` | a `blocked` end whose prerequisite fails the runner's checks (R-BTN-126) |
| `confirm-required` | a destructive action without `confirm: true` |
| `conflict` | a key already in another role or name (R-BTN-57, R-BTN-58); duplicate forge ids (R-BTN-138); a seal or import refused (R-BTN-88); a fence clear on a claim whose fence is not pending (R-BTN-19) |
| `rate-limited` | over a rate limit, with `retry_after_s` (R-BTN-135) |
| `quota` | a row-write, storage or per-claim cap (R-BTN-135, R-BTN-149, R-BTN-160) |
| `too-large` | an oversize body or item (R-BTN-73, R-BTN-130, R-BTN-149) |
| `session-taken`, `runner-reaped` | a heartbeat for a pair held by another secret; a reaped runner (§8) |
| `not-eligible` | a gate refused, with `rule` and `rule_code` (§6.6) |
| `blocked` | a prerequisite unmet (R-BTN-75) |
| `backing-off` | the leg is in retry backoff, with `until` (R-BTN-122) |
| `barred-tag` | a tag barred from the leg (R-BTN-60, R-BTN-67) |
| `stale-skills` | the runner's course version is below `min_runner_version` (R-BTN-65) |
| `no-eligible-ticket` | nothing to claim, with `refusals` for a `prefer` list (R-BTN-100) |
| `not-holder`, `claim-ended` | not the claim's holder; a different end of an ended claim (§9) |
| `head-moved` | a board post whose `parent_sha` is not the head, a rewritten default branch included (R-BTN-11); a check claim's head changed (R-BTN-153) |
| `stale-observation`, `sync-busy` | an older observation; a number still outstanding (R-BTN-62, R-BTN-150) |
| `snapshot-rejected` | a board post that fails validation (R-BTN-11, §4.4) |
| `frozen` | a claim or owner write on a frozen Baton (R-BTN-88) |
| `sealed` | 503, retryable: any request but an administrator's read on a sealed Baton (R-BTN-88) |
| `unavailable` | 503, retryable: a CI key set the forge could not serve |
| `not-cut-over` | a claim before the repository's cutover (*adoption*, R-BTN-28) |
| `floor-violated` | a policy change after which a guarantee `floors` names would not be met (R-BTN-189) |
| `unsatisfiable-approvers` | a list, removal, revocation or suspension that would leave an `approvers.*` list with no live credential to satisfy it (R-BTN-188) |

**Callers.** *machine*: a machine key with its runner secret; *machine alone*: a machine key with
no runner secret; *holder*: the claim's runner; *reader*: a key granted on the repository, an
owner of it, or an administrator; *owner*: an owner key of `{repository}`; *admin*: a key in the
administrator set; *session*: a dashboard session (the principal `session` with its minting
key's role, R-BTN-129), same-origin JSON (R-BTN-16), an owner's only on its repositories
(R-BTN-155); *admin session*: a session whose role is administrator; *owner session*: one whose
role is owner; *delegated*: an MCP key, as `owner` within R-BTN-186 (R-BTN-130) — an *owner*
row admits one wherever R-BTN-129 marks the action `true` or `own`, and a row says *delegated* or
*never delegated* only where that needs saying; *sync*: the
repository's sync credential — a sync key, a CI identity token, or a machine key naming
`?repository=` (R-BTN-93, R-BTN-102); *mirror* (*adoption*): a mirror key or the mirror's CI identity;
*instrument*: an instrument key.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| **Runner** | | | | |
| `POST /v1/runner/heartbeat` | machine | `{hostname, session_name, secret_hash?, rekey?, harness, kind, isolation, capabilities[], tags[], profile, tier_ceilings?, lease_timeout_s?, courses: [{repository, course, version}], session_url?, last_activity_at?, leg_finished?: <seq>, fenced?: {claim_id, terminated: true}, transcripts?[], reports?: [{claim_id?, key?, payload}], test_harness?, delivers?: ["git" \| "forge-check"], protection?: [{repository, matched, reading_hash, legs?: {count, tickets}}]}` (`protection` from the protection checker only; R-BTN-171, R-BTN-180, R-BTN-190) | `{runner_id, incarnation, lease_timeout_s, grant: {capabilities[]}, claim: {id, ticket_id, station, leg?, nonce, claimed_at, deadline_at?, position: {station, path, next_leg}, git: {next[]} \| {closed} \| "unknown"} \| null, messages[], handled?: [{condition_id, handler, restart, reason, answered_by?}], bars[], stale_courses[], pending_grants[], mode (*adoption*), server_time}` | R-BTN-3, R-BTN-9, R-BTN-14, R-BTN-60, R-BTN-90, R-BTN-146, R-BTN-162 |
| `POST /v1/runner/claim` | machine | `{request_id}` and at most one of `ticket_id` or `prefer: [{ticket_id, leg?}]` (≤ 50); `rationale?` (≤ 4 KB) | `{claim_id, ticket_id, course_id, course_version, leg_state, station, legs, next[], path, nonce, snapshot_sha, default_branch, handoff_url?, previous_attempts[] (newest 10), previous_attempts_total, resume?, check_sha?, check_head_ref?, scope[]}`; `course_id` the ticket's course and `course_version` the version the registry holds for it, both `null` for a claim with no course (B-103); `scope` the ticket's scope (§12.9), its home and `repos:` as forge paths; refusals as the codes above | R-BTN-4, R-BTN-45, R-BTN-100, R-BTN-143, R-BTN-153, R-BTN-162, R-BTN-171 |
| `POST /v1/runner/claims/{id}/advance` | holder | `{reached?, leg, run_label? (R-BTN-180: required when the advance starts a run for a credential `domains.per_run` lists, refused otherwise), head_sha?, evidence?, outputs?: [{name, schema, uri?, digest?, value?}], bars?, exit_status?, session_url?, taken? (R-BTN-177), scope_exceeded?: {actions: [{kind: "push"\|"pr"\|"egress", target, ref?}] (≤ 16), dropped?} (§12.9)}` | `{ok, station, next[], flags[], run_id?, inputs: [{name, uri?, digest?, value?, from_leg, from_run, leg_version}], leg_log?: {dir}}` (`run_id` when the advance starts a run) | R-BTN-63, R-BTN-64, R-BTN-82, R-BTN-108, R-BTN-153 |
| `POST /v1/runner/claims/{id}/end` | holder | `{end_reason, reached, next?, not_before?, spawned?, outputs?, detail?, ended_at_sha?, error?: {type, message?}, prerequisite?: {kind, ref}, reading?, commit?, exit_status?, session_url?, taken? (R-BTN-177), scope_exceeded?: {actions: [{kind: "push"\|"pr"\|"egress", target, ref?}] (≤ 16), dropped?} (§12.9)}` | `{ok: true}` | §9, R-BTN-83, R-BTN-86, R-BTN-126 |
| `POST /v1/runner/claims/{id}/conditions` | holder | `{type, disposition, handler?, restarts, default?, severity?, url?}` | `{condition_id, handler_id?}`; `quota` past 20 open on the claim or 200 a day on the ticket; `invalid-params` for `baton` or `baton.*` | R-BTN-160 |
| `POST /v1/runner/messages/{id}/ack` | machine | `{reply?: {text}}` | `{ok: true}` | §6 |
| `POST /v1/runner/activities` | machine | `{activities: [{id, claim_id, parent_id?, kind, seq?, label?, source, started_at, ended_at?, outcome?, detail?}]}` | `{ok, refused: [{id, code}]}` | §9 |
| `POST /v1/runner/readings` | machine | `{readings: [{instance, kind: "state" \| "measure", available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}]}` | R-BTN-76, R-BTN-101, R-BTN-151 |
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
| `POST /v1/runner/adopt` | machine | `{ticket_id}` (*adoption*) | `{pending: true}` (an `adoption_requests` row) until an administrator confirms this runner's request, then `{claim_id, nonce, station, path, next}`; `forbidden` once another runner's request is confirmed | *adoption*, R-BTN-28 |
| `POST /v1/runner/shadow-report` | machine | `{transition: "claim" \| "set", ticket_id, status, nonce, at}` | `{ok}`, or a logged `shadow-conflict` | *adoption*, R-BTN-28 |
| **Repository reads** | | | | |
| `GET /v1/repositories/{repository}/tickets/{ticket}/blocks` | reader | `?runner=me` | `{blocked, blocks: [{kind, leg?, ref, since, until?}], other: [{kind, detail}]}` | R-BTN-75 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/prerequisites` | machine granted there, owner, session | `?leg=` (the queued leg), `?runner=me` | `{leg, ready, prerequisites: [{kind, ref, met, why, since?, until?, url?, found?}]}` | R-BTN-120 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/history` | reader | `?before=<id>&limit=` (≤ 200) | `{rows: [{id, at, kind, claim_id?, leg?, run?, run_id?, domain?, reached?, next_leg?, snapshot_sha?, course_version?, leg_version?, detail, inputs?}], next_before?, resume?}` — `resume` (B-129) the ended claims' records pruned to `{end_reason, ended_at, branches, prs}` (R-BTN-24): every ended claim's branches and PRs, newest claim first, each once, and the newest's end; null when no claim ever ended | R-BTN-81, R-BTN-84, R-BTN-24 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/children` | reader | — | `{children: [{ticket_id, station, blocked, closed?}]}` | R-BTN-86 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/legs/{leg}/runs` | owner, admin | — | `{runs: [{run, run_id, domain?, claim, runner, mode, started_at, ended_at?, end?, session_url?, log_dir?, transcripts: [{repo, path, pushed_at}]}]}` | R-BTN-128, R-BTN-144 |
| `GET /v1/repositories/{repository}/blocked` | reader | `?on=<kind>:<ref or *>&transitive=1?`, or `?cursor=` | `{tickets: [{ticket_id, blocks}]}`; with no `on`, blocked tickets grouped by kind and `ref`, 100 a page, `next_cursor` | R-BTN-75, R-BTN-79 |
| `GET /v1/repositories/{repository}/conditions` | reader | `?open=1`, `?person=1`, `?type=<prefix>`, `?ticket=`, `?cursor=` | `{conditions: [{condition_id, ticket?, leg?, type, disposition, handler?, restarts, default?, severity, url?, detail?, resolve_url, raised_at, closed_at?, outcome?}], questions?: [{ticket, leg, asks, options: [{id, reached}], queued_at, question_id?, url?, severity?, posted_at?}], next_cursor?}`, 100 a page; `questions` only with `person=1`: the queued person legs (R-BTN-116) | R-BTN-163, R-BTN-116 |
| `GET /v1/repositories/{repository}/board` | owner, runner granted there, admin | — | `{repository, ready[], ready_by_tier, holders[], granted_capabilities: string[] \| null, server_time}` (R-BTN-179); `holders` (B-129) the repository's live claims, each `{ticket_id, worker_id, hostname, session_name, lease_ends_at}` — the lock a session claiming through git reads with the same request; a legacy claim's `lease_ends_at` is null | R-BTN-179 |
| `GET /v1/repositories/{repository}/courses` | reader | — | each course file as last accepted, with its capability types and roles | R-BTN-121, R-BTN-157 |
| `GET /v1/repositories/{repository}/stats` | reader | `?since=` | per station and leg, wait and run times; ends by reason and detail; suspensions; advice overridden; `off-graph` — aggregates and ids only | §5 |
| `GET /v1/repositories/{repository}/fact-legs` | a trusted runner whose `service:` key the policy names for `std:arrival@1` (the fact reader) | — | `{tickets: [{ticket, station, path_len, leg, fact, waiting_since}]}` | R-BTN-192 |
| **Owner** | | | | |
| `POST /v1/owner/{repository}/tickets/{ticket}/resolve` | owner; never delegated (R-BTN-130) | `{restart, condition_id?}` — `condition_id` required when the ticket has more than one open condition taking a restart | `{ok: true}`; `invalid-params` for a restart the condition does not offer | R-BTN-163 |
| `POST /v1/owner/{repository}/tickets/{ticket}/route` | owner; never delegated (R-BTN-186) | `{leg}` or `{clear: true}` | `{ok: true}` | R-BTN-83 |
| `POST /v1/owner/{repository}/tickets/{ticket}/adopt` | an approver on the repository's `approvers.policy`, or an administrator holding a `human_only` key where every `approvers.*` list is human-only; never delegated (R-BTN-186) | `{at?, next?, ran?: [<leg>], confirm: true}` | `{ok: true, before, after}`; `nothing-implied`, `off-graph` | R-BTN-39 |
| `POST /v1/owner/{repository}/tickets/{ticket}/release` | owner; delegated (R-BTN-130) | `{reason: "requested", confirm: true}` | `{ok: true}` | R-BTN-119 |
| `POST /v1/repositories/{repository}/attestations` | an owner key or an owner session (writer `owner`), a `human_only` key, or a `service` key (R-BTN-181); never delegated (R-BTN-130) | `{type, subject, value, nonce, lapses_at?}`; the writer is the credential | `{id}` | R-BTN-181 (proposal) |
| `DELETE /v1/repositories/{repository}/attestations/{id}` | its writer; for a `human` type, a `human_only` key | `{confirm: true}` | `{ok: true}` | R-BTN-181, R-BTN-185 (proposal) |
| `POST /v1/owner/{repository}/overrides/{ticket}` | owner for `expedite`, `hold: true` and `cancel`; a lift (`hold: false`) by an approver on `approvers.policy` (R-BTN-186); delegated for a tightening, and for the lift of a hold it set (R-BTN-130) | `{expedite}`, `{hold}` or `{cancel: true, confirm: true}` | `{ok: true}` | §6, R-BTN-186 |
| `POST /v1/owner/{repository}/grants` | an approver on `approvers.members` (R-BTN-188) | `{public_key, hostname?, label?, capabilities[], max_tier?, confirm_span?}`, or `{name, api_key: true, capabilities[], max_tier?}` | `{ok, pending: true}`; `{api_key}` once for the second form; `conflict` | R-BTN-58, R-BTN-117, R-BTN-146 |
| `POST /v1/owner/{repository}/grants/{fingerprint}/revoke` | an approver on `approvers.members` (R-BTN-188) | `{confirm: true}` | `{ok: true}` | R-BTN-58 |
| `GET /v1/owner/{repository}/grants` | owner | — | `{repository, owners[], grants: [{credential_id, hostname, label, repository_id, capabilities, max_tier, role, domain, checker, set_by, granted_by, granted_at, other_repositories[]}], mcp_keys: [{name, minted_by, actions, expires_at, last_used_at, client_host?, client_addr?}], settings, bars[], server_time}` — the dashboard's `limits` over one repository (R-BTN-179); the accept-and-decline plan's own rows are R-BTN-146's | R-BTN-146, R-BTN-179 |
| `PUT /v1/owner/{repository}/grants/{fingerprint}/flags` | owner; `sync: true` by an approver on `approvers.policy` (R-BTN-186) | `{sync}` | `{ok: true}` | R-BTN-146, R-BTN-186 |
| `PUT /v1/owner/{repository}/grants/{fingerprint}/role` | an approver on `approvers.roles` | `{role: "runner" \| "trusted-runner", domain?, checker?}` | `{ok: true}`; `invalid-params` for `trusted-runner` on an API key, or a `checker` mark R-BTN-180 refuses | R-BTN-180, R-BTN-188 (proposal) |
| `POST /v1/owner/{repository}/owners` | an approver on `approvers.members` (R-BTN-188) | `{public_key}` to add; `{fingerprint, remove: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-58 |
| `POST /v1/owner/{repository}/bars` | owner; delegated (R-BTN-130) | `{course, tag, legs?, applies, starts_at?, ends_at?, release_holders?, reason}` | `{id}` | R-BTN-67 |
| `POST /v1/owner/{repository}/bars/{id}/lift` | an approver on `approvers.policy` (R-BTN-186); delegated for a bar it added (R-BTN-130) | — | `{ok: true}` | R-BTN-67, R-BTN-186 |
| `POST /v1/owner/{repository}/bars/follow` | owner | `{course}` | `{ok: true}` | R-BTN-142 |
| `PUT /v1/owner/{repository}/settings` | owner; a loosening by an approver on `approvers.policy` (R-BTN-186) | any owner setting (§13.1); `code_repos` as `[{path}]` | `{ok: true}` | R-BTN-66, R-BTN-140, R-BTN-186 |
| `PUT /v1/owner/{repository}/policy` | an approver on `approvers.policy` as it stands; never a delegated key | `{base_version, policy, dry_run?}` or `{base_version, preset, dry_run?}` | `{version, hash, changed[], guarantees}`; with `dry_run`, `{changed[], guarantees, stops: {grants[], legs[], tickets[]}}` as R-BTN-188 defines them and nothing written; `conflict` when stale, `forbidden`, `floor-violated` | R-BTN-188, R-BTN-189 (proposal) |
| `GET /v1/owner/{repository}/policy/log` | owner | `?after=<version>` | `{versions: [{version, hash, previous_hash, changed_by, approver, preset?, at, changed[]}]}` | R-BTN-188 (proposal) |
| `POST /v1/human-keys` | a `human_only` key | `{public_key, signature}` — `signature` the new key's SSHSIG over its own public line, proof of possession; `{fingerprint, revoke: true, confirm: true}` | `{ok: true}`; `conflict` for a key holding another role; `unsatisfiable-approvers` naming a list a revocation would leave unsatisfied | R-BTN-185, R-BTN-188 (proposal) |
| `GET /v1/repositories/{repository}/policy` | owner, administrator, a key granted on the repository | — | `{repository, version, hash, policy, guarantees, floors, check_app_id, at}` | R-BTN-189 (proposal) |
| `POST /v1/owner/login-links` | an owner key of any repository | `{code, confirm?}` | without `confirm`, `{role, client_addr, age_s}`, binding nothing; with `confirm: true`, `{ok: true}`, bound; `not-found` for any code but an unbound owner row's | R-BTN-155 |
| `POST /v1/owner/confirm` | the owner key that minted the session | `{code, dry_run?}` | performs the action; with `dry_run`, `{action, target}`; `not-found` for another session's code | R-BTN-155 |
| `POST /v1/owner/sessions/revoke` | an owner key | `{confirm: true}` | `{ok: true}`; ends every session the key minted | R-BTN-155 |
| `POST /v1/owner/{repository}/code-repo-consents` | an approver on `{repository}`'s `approvers.members` | `{repository: <home listing it>, confirm: true}` or `{repository, withdraw: true}` | `{ok: true}` | R-BTN-140 |
| `POST /v1/owner/{repository}/sync-keys`, `…/sync-keys/{fingerprint}/revoke` | an approver on `approvers.members` (R-BTN-188) | `{public_key, role: "sync" \| "mirror" (*adoption*)}`; revoke `{confirm: true}` | `{ok: true}`; `conflict` | R-BTN-93 |
| `POST /v1/owner/{repository}/sync-want` | owner | — | `{ok: true}` | R-BTN-105 |
| `POST /v1/owner/{repository}/tokens`, `…/tokens/{id}/revoke` | an approver on `approvers.members` (R-BTN-188) | `{role: "runner", capabilities?, max_tier?, ttl_s?, uses?, grant_ttl_s?}`; revoke `{confirm: true}` | `{id, token}`, the token once; revoking revokes every credential it registered | R-BTN-117, R-BTN-157 |
| `POST /v1/owner/{repository}/mcp-keys`, `…/mcp-keys/{name}/revoke` | an approver on `approvers.members` (R-BTN-188) | `{name, actions, ttl}`; revoke `{confirm: true}` | the key once; `{ok: true}`; `invalid-params` for an id R-BTN-186 does not admit | R-BTN-130 |
| `POST /v1/owner/{repository}/check-runners`, `…/check-runners/{fingerprint}/revoke` | an approver on `approvers.members` (R-BTN-188) | `{public_key, name, capabilities?, max_tier?}`; revoke `{confirm: true}` | `{ok: true}` | R-BTN-114 |
| **Sync and forges** | | | | |
| `POST /v1/sync/observation` | sync | `{renew?}`, or `{release, behind?, unfounded?}` | `{sha, observation, bars, pushers, code_repos, check_app_id, positions, unconfirmed}`; a release `{ok: true}` | R-BTN-11, R-BTN-62, R-BTN-126, R-BTN-147, R-BTN-139, R-BTN-140, R-BTN-150 |
| `POST /v1/sync/board` | sync | the board post (§4), with `legs_landed?: {count, tickets}` (R-BTN-190) | `{ok: true}`; `head-moved` | R-BTN-11, R-BTN-147, R-BTN-149, R-BTN-190 |
| `POST /v1/sync/want` | sync | — | `{ok: true}` | R-BTN-94 |
| `GET /v1/sync/wanted` | sync, mirror (*adoption*) | — | `{wanted, since?, head_sha}` for the credential's role; changes nothing but its nonce | R-BTN-94, R-BTN-105 |
| `GET /v1/sync/events` | mirror | `?after=<seq>`, which acknowledges up to the lesser of `after` and the last `seq` a read returned to the mirror | `{events[], next}` | *adoption*, §16 |
| `POST /v1/github/webhook` | the GitHub App, by `X-Hub-Signature-256` | a delivery | `204`; repeats and the sync's and mirror's (*adoption*) own events ignored | R-BTN-73 |
| `POST /v1/forges/{repository}/notify` | a GitLab or Gitea notification, verified against `BATON_FORGE_SECRETS` | the notification | `204`; records a want | R-BTN-95 |
| **Deliverers and instruments** | | | | |
| `POST /v1/runner/outbox/claim` | machine, SSH-signed, on a grant whose role the repository policy's `outbox` admits (R-BTN-171, R-BTN-188) | `{limit?}` (≤ 50) | `{entries: [{repository, id, kind, ticket, fields}]}` of the classes it declared, each leased 10 minutes; a ticket's git entries together, in `id` order | R-BTN-171, R-BTN-115 |
| `POST /v1/runner/outbox/{repository}/{id}` | the entry's claimer | `{state: "delivered", ref}` (recorded as its `std:effect@1` attestation, R-BTN-191) or `{state: "failed", reason: "transient" \| "refused"}` | `{ok: true}`; `forbidden` for another runner's entry | R-BTN-171 |
| `POST /v1/probe/readings` | instrument | `{readings: [{instance, kind, available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}]}` | R-BTN-101 |
| **Administrator** | | | | |
| `GET /v1/admin/repositories` | admin | — | `{repositories: [<`/v1/ui/state`'s repository row: id, github, forge, web_base, default_branch, weight, head, mode, courses>], seed_owners?: [repository id]}` — `seed_owners` present only when some unretired repository's live owners are all `admin:seed`'s or it has no live owner, naming them (B-91, R-BTN-58) (R-BTN-179) | R-BTN-179 |
| `POST /v1/admin/repositories` | admin; `owner_keys_add` `forbidden` where the repository's `approvers.members` is human-only (the gate opens on the owner route with a `human_only` key, R-BTN-188) | register `{id, github, forge, remote, web_base?, ci_identity?, dispatch?, sync_keys?, default_branch, sync_workflow?, mirror_workflow? (*adoption*), mirror_pusher? (*adoption*), weight?, tiers?, cut_over? (*adoption*), owner_keys[], forge_repo_id, forge_owner_id}`; change `{id, …, github?, forge_repo_id?, forge_owner_id?, sync_keys_add?, sync_keys_remove?, owner_keys_add?, former_paths_remove?, code_repo_consents_add?, confirm?}` (never `forge`); `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-47, R-BTN-92, R-BTN-93, R-BTN-138 |
| `POST /v1/admin/repositories/{repository}/resync` | admin | `{force: true, sha, confirm: true}` | `{ok: true}`; the head reset to `sha` as the dashboard's forced Resync does (R-BTN-11) | R-BTN-11 |
| `POST /v1/admin/grants` | admin; `forbidden` where the repository's `approvers.members` is human-only (the gate opens on the owner route with a `human_only` key, R-BTN-188) | a grant, or a key's hostname | `{ok, pending: true}` | R-BTN-57, R-BTN-58, R-BTN-146, R-BTN-188 |
| `POST /v1/admin/keys/{fingerprint}/revoke` | admin | `{confirm: true}` | `{ok: true}`; the key stops at its next call, an owner key on every repository; `invalid-params` for an administrator's key | R-BTN-57 |
| `POST /v1/admin/probes` | admin | `{public_key, label}` | `{ok: true}` | R-BTN-101 |
| `POST /v1/admin/resources` | admin | `{name, scope, detail_schema}` | `{ok: true}` | R-BTN-76 |
| `POST /v1/admin/instances` | admin | `{name, serves[], repositories[]}`, re-posted to change | `{ok: true}` | R-BTN-76 |
| `POST /v1/admin/readings` | admin | a reading, as an instrument's; or `{instance, clear: {source?}}` | `{ok: true}` | R-BTN-76, R-BTN-151 |
| `PUT /v1/admin/capacities` | admin | `{capability, capacity: <1–64> \| null}` | `{ok: true}` | R-BTN-178 |
| `PUT /v1/admin/settings` | admin | `{link_hosts?, session_hosts?, check_app_id?}` | `{ok: true}` | R-BTN-112, R-BTN-113, §12.7 |
| `POST /v1/admin/login-links` | admin | `{code, confirm?}` | without `confirm`, `{role, client_addr, age_s}`, binding nothing; with `confirm: true`, `{ok: true}`, bound; `not-found` for any code but an unbound administrator row's | R-BTN-155 |
| `POST /v1/admin/confirm` | the administrator key that minted the session | `{code, dry_run?}` | performs the action; with `dry_run`, `{action, target}`; `not-found` for another session's code | R-BTN-155 |
| `POST /v1/admin/sessions/revoke` | admin | `{all: true, confirm: true}` | `{ok: true}` | R-BTN-155 |
| `POST /v1/admin/freeze`, `…/unfreeze`, `…/seal` | admin | — | `{ok: true}`; seal `conflict` naming active or fence-pending claims and lagging mirrors (*adoption*) | R-BTN-88 |
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
| `POST /v1/ui/scope/{id}/resolve` | session | `{}` | `{ok: true}` — the owner's acknowledgement a scope finding was looked into; `not-found` for none open | §12.9 |
| `POST /v1/ui/claims/{id}/reap` | admin session | `{confirm: true}` | `202 {confirm_code}` | §9, R-BTN-155 |
| `POST /v1/ui/claims/{id}/fence-clear` | admin session | `{confirm: true}` | `202 {confirm_code}`; `conflict` when the claim's fence is not pending | R-BTN-19, R-BTN-155 |
| `POST /v1/ui/claims/{id}/confirm`, `…/release` | admin session | `{}` | `202 {confirm_code}` | R-BTN-10, R-BTN-155 |
| `POST /v1/ui/resync` | session; `force` an admin session | `{repository, force?, sha?}` (`sha` with `force`) | `{ok: true}`; dispatches the sync; with `force`, `202 {confirm_code}`, then the head is reset to `sha` (R-BTN-11) | R-BTN-35, R-BTN-11, R-BTN-155 |
| `POST /v1/ui/cutover` | admin session | `{repository, confirm: true}` | `202 {confirm_code}` | *adoption*, R-BTN-28 |
| `POST /v1/ui/adoptions/{claim}/confirm` | admin session | `{runner_id}` (the requesting runner, shown with its hostname and session name) | `202 {confirm_code}` | *adoption*, R-BTN-28 |
| **Other** | | | | |
| `POST /v1/register` | `Authorization: Baton-Token <token>` | `{name, public_key}` or `{name, api_key: true}` | `{credential_id, grant}`, and `{api_key}` once for the second form; `forbidden` beyond the token's scope; `unauthenticated` for a spent, expired or revoked token; `conflict` | R-BTN-117 |
| `GET /v1/actions` | any key (never an MCP key, R-BTN-130) | — | the caller's registry entries, with `input` schemas; `baton help` reads it | R-BTN-129 |
| `POST /v1/mcp` | an MCP key, as a bearer | JSON-RPC `initialize`, `ping`, `tools/list`, `tools/call`; the tools are the key's ids within R-BTN-186 | streamable HTTP, JSON only; `GET` answers `405` | R-BTN-130, R-BTN-186 |

**Runners drain the outbox** (R-BTN-171) through the two `/v1/runner/outbox` routes above,
never through a claim.

