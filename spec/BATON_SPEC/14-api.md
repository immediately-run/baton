---
title: "14. API"
description: "The routes Baton serves, each with its caller, body and response."
---
## 14. API *(proposal)*

The routes Baton serves, each with its caller, body and response. Under `/v1`, an unmatched
request is `404 not-found`. A row cites the rules that own its behaviour, bounds and
refusals. Routes of designs not built yet are in
[the data model and API proposal](../proposals/data-model-and-api.md).

**Requests.** Bodies are JSON. A signed caller sends an RFC 9421 `Signature` and
`Signature-Input` by its SSH key (R-BTN-13), or its API key as `Authorization: Bearer`
(R-BTN-159); the principal table and who may hold which kind of key are §12's. A runner adds
`X-Runner-Secret` to every call after its first heartbeat (R-BTN-14), and every runner call
updates its `last_seen_at`. A destructive action takes `confirm: true` in its body, else
`confirm-required` (§12.2). The CLI command that calls each route is R-BTN-127's. Any route may
answer `rate-limited` or `quota` (R-BTN-135). Every request carries `Baton-Client` and every
response `Baton-Client-Versions` (R-BTN-197).

**Errors** are `{ok: false, code, message}`, with these codes. A code with no rule is described
here; every other cause is its rule's.

| Code | Status and fields | Rule |
|---|---|---|
| `unauthenticated` | | no valid credential, or a bearer on a route its kind never reaches (§12.1) |
| `client-too-old` | 426; `client`, `min`, `recommended` | R-BTN-197 |
| `forbidden` | | a valid credential without the power (§12) |
| `not-found` | | no such route; a repository not registered or retired (R-BTN-47); an unknown or used sign-in token (R-BTN-155) |
| `invalid-params` | | a body or query that fails validation |
| `invalid-prerequisite` | | R-BTN-126 |
| `confirm-required` | | §12.2 |
| `conflict` | | R-BTN-57, R-BTN-58, R-BTN-138, R-BTN-88, R-BTN-19, R-BTN-188 |
| `rate-limited` | `retry_after_s` | R-BTN-135 |
| `quota` | | R-BTN-135, R-BTN-149, R-BTN-160 |
| `too-large` | | R-BTN-73, R-BTN-149 |
| `session-taken`, `runner-reaped` | | §8 |
| `not-eligible` | `rule`, `rule_code` (`max-claims` for R-BTN-4's limit) | §6.6, R-BTN-4 |
| `blocked` | | R-BTN-75 |
| `backing-off` | `until` | R-BTN-122 |
| `barred-tag` | | R-BTN-60, R-BTN-67 |
| `stale-skills` | | R-BTN-65 |
| `no-eligible-ticket` | `refusals`, for a `prefer` list | R-BTN-100 |
| `not-holder`, `claim-ended` | | §9 |
| `head-moved` | | R-BTN-11 |
| `stale-observation`, `sync-busy` | | R-BTN-62, R-BTN-150 |
| `snapshot-rejected` | | R-BTN-11, §4.4 |
| `frozen` | | R-BTN-88 |
| `sealed` | 503, retryable | R-BTN-88 |
| `unavailable` | 503, retryable | a CI key set the forge could not serve |
| `floor-violated` | | R-BTN-189 |
| `unsatisfiable-approvers` | | R-BTN-188 |

**Callers.**

- *machine*: a machine key with its runner secret. *machine alone*: a machine key with no
  runner secret. *holder*: the claim's runner.
- *reader*: a key granted on the repository, an owner of it, or an administrator.
- *owner*: an owner key of `{repository}`. Which owner actions need an approver on one of the
  policy's `approvers.*` lists, and which a delegated key may call, are R-BTN-188's and
  R-BTN-186's; a row does not repeat them.
- *admin*: a key in the administrator set. R-BTN-188 says which administrator writes a
  repository's policy closes.
- *session*: a dashboard session (R-BTN-155), same-origin JSON (R-BTN-16).
- *sync*: the repository's sync credential — a sync key, a CI identity token, or a machine key
  naming `?repository=` (R-BTN-93, R-BTN-102).
- *instrument*: an instrument key.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| **Runner** | | | | |
| `POST /v1/runner/heartbeat` | machine | §8's heartbeat body, with `hostname`, `session_name` and `last_activity_at?` | §8's heartbeat response, with `runner_id`, `incarnation`, `lease_timeout_s` and `grant: {capabilities[]}` | R-BTN-3, R-BTN-9, R-BTN-14 |
| `POST /v1/runner/claim` | machine | `{request_id}` and at most one of `ticket_id` or `prefer: [{ticket_id, leg?}]`; `rationale?` | §9.1's claim response. `version` is `''` when the source posts none; `course_id` and `course_version` are `null` for a claim with no course | §9.1, R-BTN-4, R-BTN-45, R-BTN-100, R-BTN-143 |
| `POST /v1/runner/claims/{id}/advance` | holder | §9.1's advance body, with `outputs?: [{name, schema, uri?, digest?, value?}]` and `scope_exceeded?: {actions: [{kind, target, ref?}], dropped?}`; and `local_order?: {by, ran_at}` on the advance that finishes a leg run under a local order (R-BTN-202) | §9.1's reply: `{ok, station, next[], flags[], run_id?, inputs: [{name, uri?, digest?, value?, from_leg, from_run, leg_version}]}`; `run_id` when the advance starts a run | §9.1, R-BTN-63, R-BTN-64, R-BTN-82, R-BTN-84, R-BTN-108, R-BTN-202, §12.9 |
| `POST /v1/runner/claims/{id}/end` | holder | §9.4's end body, with `prerequisite?: {kind, ref}`; a blocked end's `reading?` and `commit?` (R-BTN-126); `local_order?` (R-BTN-202) | `{ok: true}` | §9.4, R-BTN-83, R-BTN-86, R-BTN-126, R-BTN-198, R-BTN-202 |
| `POST /v1/runner/claims/{id}/conditions` | holder | `{type, disposition, restarts, default?, severity?, url?}` | `{condition_id}`; `invalid-params` for `baton` or `baton.*` | R-BTN-160 |
| `POST /v1/runner/messages/{id}/ack` | machine | `{reply?: {text}}` | `{ok: true}` | §6 |
| `POST /v1/runner/activities` | machine | `{activities: [{id, claim_id, parent_id?, kind, seq?, label?, source, started_at, ended_at?, outcome?, detail?}]}` | `{ok, refused: [{id, code}]}` | §9 |
| `POST /v1/runner/readings` | machine | `{readings: [{instance, kind: "state" \| "measure", available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}]}` | R-BTN-76, R-BTN-101, R-BTN-151 |
| `GET /v1/runner/recommendations` | machine | `?limit=` (10), `?all=1` (≤ 500) | `{recommendations: [{ticket_id, station, legs, flags[], course, handoff_url?}], truncated?}` | R-BTN-45, R-BTN-61, R-BTN-99 |
| `GET /v1/runner/next` | machine | — | the first recommendation, or `no-eligible-ticket` | R-BTN-45 |
| `GET /v1/runner/tickets/{ticket}/holder` | machine, or machine alone | `?session_name=` with the runner secret, when the caller has them | `{held_by_other, fence_pending}` | R-BTN-7 |
| `GET /v1/runner/branch-holder` | machine, or machine alone | `?repo=<forge path>&branch=`, and `session_name` with the runner secret when the caller has them | `{tickets[], held_by_other, fence_pending}`, granted repositories' tickets only; a key alone counts every active claim as another's | R-BTN-7, R-BTN-141 |
| **Repository reads** | | | | |
| `GET /v1/repositories/{repository}/tickets/{ticket}` | reader | — | `{ticket_id, repository, course_id, title, path, tier, requires[], operator_only, expedite, rank, snapshot_sha, station: {station, path[], next_leg, to_end, handoff_url?} \| null, last_written_by?}` | R-BTN-194 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/blocks` | reader | `?runner=me` | `{blocked, blocks: [{kind, leg?, ref, since, until?}], other: [{kind, detail}]}` | R-BTN-75 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/history` | reader | `?before=<id>&limit=` (≤ 200) | `{rows: [{id, at, kind, claim_id?, leg?, run?, run_id?, domain?, reached?, next_leg?, snapshot_sha?, course_version?, leg_version?, detail, inputs?}], next_before?, resume?}`; `resume` is `{end_reason, ended_at, branches, prs}` over the ended claims, null when no claim ever ended | R-BTN-24, R-BTN-81, R-BTN-84 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/children` | reader | — | `{children: [{ticket_id, station, blocked, closed?}]}` | R-BTN-86 |
| `GET /v1/repositories/{repository}/tickets/{ticket}/legs/{leg}/runs` | owner, admin | — | `{runs: [{run, run_id, domain?, claim, runner, started_at, ended_at?, end?, session_url?, log_dir?, transcripts: [{repo, path, pushed_at}]}]}` | R-BTN-128, R-BTN-144 |
| `GET /v1/repositories/{repository}/blocked` | reader | `?on=<kind>:<ref or *>&transitive=1?`, or `?cursor=` | `{tickets: [{ticket_id, blocks}]}`; with no `on`, blocked tickets grouped by kind and `ref`, 100 a page, `next_cursor` | R-BTN-75, R-BTN-79 |
| `GET /v1/repositories/{repository}/conditions` | reader | `?open=1`, `?person=1`, `?type=<prefix>`, `?ticket=`, `?cursor=` | `{conditions: [{condition_id, ticket?, leg?, type, disposition, restarts, default?, severity, url?, detail?, resolve_url, raised_at, closed_at?, outcome?}], questions?: [{ticket, leg, asks, options: [{id, reached}], queued_at, question_id?, url?, severity?, posted_at?}], next_cursor?}`, 100 a page; `questions`, the queued person legs, only with `person=1` | R-BTN-116, R-BTN-163 |
| `GET /v1/repositories/{repository}/board` | owner, a runner granted there, admin | — | `{repository, ready[], ready_by_tier, holders: [{ticket_id, worker_id, hostname, session_name, lease_ends_at}], granted_capabilities: string[] \| null, server_time}`; `holders` are the repository's live claims | R-BTN-179 |
| `GET /v1/repositories/{repository}/stats` | reader | `?since=` | per station and leg, wait and run times; ends by reason and detail; suspensions; advice overridden; `off-graph` — aggregates and ids only | §5 |
| `GET /v1/repositories/{repository}/policy` | reader | — | `{repository, version, hash, policy, guarantees, floors, check_app_id, at}` | R-BTN-189 |
| `POST /v1/repositories/{repository}/sequences/{kind}/next` | reader, or sync | `{floor?, for?}`, or an empty body; a body that is not JSON is `invalid-params` | `{kind, number}` | R-BTN-199 |
| **Owner** | | | | |
| `POST /v1/owner/{repository}/tickets/{ticket}/resolve` | owner | `{restart, condition_id?}`; `condition_id` required when the ticket has more than one open condition taking a restart | `{ok: true}`; `invalid-params` for a restart the condition does not offer | R-BTN-163 |
| `POST /v1/repositories/{repository}/attestations` | an owner key or a `human_only` key | `{type, subject, value, nonce, lapses_at?}`; the writer is the credential | `{id}` | R-BTN-116, R-BTN-181, R-BTN-185, R-BTN-191 |
| `POST /v1/owner/{repository}/grants` | owner | `{public_key, hostname?, label?, capabilities[], max_tier?, max_claims?, confirm_span?}`, or `{name, api_key: true, capabilities[], max_tier?, max_claims?}` | `{ok, pending: true}`; `{api_key}` once for the second form; `conflict` | R-BTN-4, R-BTN-58, R-BTN-117, R-BTN-146 |
| `POST /v1/owner/{repository}/grants/{fingerprint}/revoke` | owner | `{confirm: true}` | `{ok: true}` | R-BTN-58 |
| `GET /v1/owner/{repository}/grants` | owner | — | `{repository, owners[], grants: [{credential_id, hostname, label, repository_id, capabilities, max_tier, role, domain, checker, set_by, granted_by, granted_at, other_repositories[]}], settings, bars[], server_time}` | R-BTN-146, R-BTN-179 |
| `POST /v1/owner/{repository}/owners` | owner | `{public_key}` to add; `{fingerprint, remove: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-58 |
| `POST /v1/owner/{repository}/bars` | owner | `{course, tag, legs?, applies, starts_at?, ends_at?, release_holders?, reason}` | `{id}` | R-BTN-67 |
| `POST /v1/owner/{repository}/bars/{id}/lift` | owner | — | `{ok: true}` | R-BTN-67, R-BTN-186 |
| `PUT /v1/owner/{repository}/settings` | owner | any owner setting (§13.1); `code_repos` as `[{path}]` | `{ok: true}` | R-BTN-66, R-BTN-140, R-BTN-186 |
| `PUT /v1/owner/{repository}/policy` | owner | `{base_version, policy}` or `{base_version, preset}` | `{version, hash, changed[], guarantees}`; `conflict` when stale, `forbidden`, `floor-violated` | R-BTN-188, R-BTN-189 |
| `GET /v1/owner/{repository}/policy/log` | owner | `?after=<version>` | `{versions: [{version, hash, previous_hash, changed_by, approver, preset?, at, changed[]}]}` | R-BTN-188 |
| `POST /v1/human-keys` | a `human_only` key | `{public_key, signature}`, `signature` the new key's SSHSIG over its own public line; or `{fingerprint, revoke: true, confirm: true}` | `{ok: true}`; `conflict`; `unsatisfiable-approvers` | R-BTN-185, R-BTN-188 |
| **Sync and forges** | | | | |
| `POST /v1/sync/observation` | sync | an empty body, or `{release: <number>}` | §4.3's observation; a release `{ok: true}` | R-BTN-11, R-BTN-62, R-BTN-126, R-BTN-139, R-BTN-140, R-BTN-150 |
| `POST /v1/sync/board` | sync | the board post (§4), with `legs_landed?: {count, tickets}` | `{ok: true}`; `head-moved` | R-BTN-11, R-BTN-147, R-BTN-149, R-BTN-190 |
| `POST /v1/github/webhook` | the GitHub App, by `X-Hub-Signature-256` | a delivery | `204`; repeats and the sync's own events ignored | R-BTN-73 |
| `POST /v1/forges/{repository}/notify` | a GitLab or Gitea notification, verified against `BATON_FORGE_SECRETS` | the notification | not built: `not-found`, or `too-large` over R-BTN-73's cap | R-BTN-95 |
| `POST /v1/probe/readings` | instrument | `{readings: [{instance, kind, available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}]}` | R-BTN-101 |
| **Administrator** | | | | |
| `GET /v1/admin/repositories` | admin | — | `{repositories: [{id, github, forge, web_base, default_branch, weight, head, mode, courses}], seed_owners?: [repository id]}`; a row is `GET /v1/ui/state`'s repository row | R-BTN-58, R-BTN-179 |
| `POST /v1/admin/repositories` | admin | register `{id, github, forge, remote, web_base?, ci_identity?, dispatch?, sync_keys?, default_branch, sync_workflow?, weight?, tiers?, owner_keys[], forge_repo_id, forge_owner_id}`; change `{id, …, github?, forge_repo_id?, forge_owner_id?, sync_keys_add?, sync_keys_remove?, owner_keys_add?, former_paths_remove?, confirm?}` (never `forge`); `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-47, R-BTN-92, R-BTN-93, R-BTN-138, R-BTN-188 |
| `POST /v1/admin/grants` | admin | a grant, or a key's hostname | `{ok, pending: true}` | R-BTN-57, R-BTN-58, R-BTN-146, R-BTN-188 |
| `POST /v1/admin/keys/{fingerprint}/revoke` | admin | `{confirm: true}` | `{ok: true}`; `invalid-params` for an administrator's key | R-BTN-57 |
| `POST /v1/admin/probes` | admin | `{public_key, label}` | `{ok: true}` | R-BTN-101 |
| `POST /v1/admin/resources` | admin | `{name, scope, detail_schema}` | `{ok: true}` | R-BTN-76 |
| `POST /v1/admin/instances` | admin | `{name, serves[], repositories[]}`, re-posted to change | `{ok: true}` | R-BTN-76 |
| `POST /v1/admin/readings` | admin | a reading, as an instrument's; or `{instance, clear: {source?}}` | `{ok: true}` | R-BTN-76, R-BTN-151 |
| `PUT /v1/admin/capacities` | admin | `{capability, capacity: <number> \| null}` | `{ok: true}` | R-BTN-178 |
| `PUT /v1/admin/settings` | admin | `{link_hosts?, session_hosts?, check_app_id?}` | `{ok: true}` | R-BTN-112, R-BTN-113, §12.7 |
| `POST /v1/admin/login-links` | admin | — | `{url}`, the one-time link | R-BTN-155 |
| `POST /v1/admin/freeze`, `…/unfreeze`, `…/seal` | admin | — | `{ok: true}`; seal `conflict` naming active or fence-pending claims | R-BTN-88 |
| `GET /v1/admin/state` | admin | — | what `GET /v1/ui/state` answers, from the same state | R-BTN-57 |
| `GET /v1/admin/export` | admin | `?with_history=1` | `baton.owner-state/v1` | R-BTN-88 |
| `POST /v1/admin/import` | admin | an export | `{ok: true}`; `conflict`, `invalid-params` | R-BTN-88, R-BTN-158 |
| **Dashboard** | | | | |
| `POST /v1/login` | none | `{token}` | `{ok: true}` and the session cookie | R-BTN-155 |
| `GET /v1/ui/state` | session | `If-None-Match` | everything the dashboard draws, with an `ETag` over R-BTN-196's state version, the caller, the route and a coarse clock bucket; a match answers `304` with no body | §11, R-BTN-196 |
| `GET /v1/ui/repositories/{repository}/tickets` | session | `limit` (1–100, default 50), `after` (the last ticket id), `If-None-Match` | `{tickets, cursor}`, one page of the repository's ticket list ordered by ticket id, `cursor: null` at the end; an `ETag` over the caller, the route, the page and R-BTN-196's board version, the principal checked before a `304` | §11, R-BTN-196 |
| `GET /v1/ui/repositories/{repository}/runners` | session | `limit` (1–100, default 50), `after` (the last runner id), `If-None-Match` | `{runners, cursor}`, one page of the runners declaring a course in the repository, ordered by runner id, each with its current claims, activity, latest transcript and latest report; the `ETag` also covers R-BTN-196's activity version and a coarse clock bucket | §11, R-BTN-196 |
| `POST /v1/ui/messages` | session | `{to_runner_id, kind: "release" \| "status_request" \| "wind-down", payload}`; Stop is `{kind: "release", payload: {ticket_id, reason: "requested"}}` | `{id}`; `forbidden` for a `release` whose ticket `to_runner_id` does not hold; any other kind `invalid-params` | §6, R-BTN-119 |
| `POST /v1/ui/overrides/{ticket}` | session | `{expedite}` or `{hold}` | `{ok: true}` | §6 |
| `POST /v1/ui/scope/{id}/resolve` | session | `{}` | `{ok: true}`; `not-found` for none open | §12.9 |
| `POST /v1/ui/claims/{id}/reap` | session | `{confirm: true}` | `{ok: true}` | §9 |
| `POST /v1/ui/claims/{id}/fence-clear` | session | `{confirm: true}` | `{ok: true}`; `conflict` when the claim's fence is not pending | R-BTN-19 |
| `POST /v1/ui/claims/{id}/confirm`, `…/release` | session | `{}` | `{ok: true}` | R-BTN-10 |

**Legacy, removed with its code (R-BTN-193).** The mirror and the cutover (§16, R-BTN-28) add
the routes below, and: the caller *mirror*, a mirror key or the mirror's CI identity; the code
`not-cut-over`, a claim before the repository's cutover; `mode` in the heartbeat response;
`mirror_workflow?` and `cut_over?` in a repository's registration; a null
`lease_ends_at` on a legacy claim's `holders` entry; the mirror's own events among those the
webhook ignores; and lagging mirrors among what a seal's `conflict` names.

| Route | Caller | Body or query | Response |
|---|---|---|---|
| `GET /v1/runner/mode` | machine | `?repository=` | `{mode: "shadow" \| "cut-over", cutover_at?}` |
| `POST /v1/runner/adopt` | machine | `{ticket_id}` | `{pending: true}` until an administrator confirms this runner's request, then `{claim_id, nonce, station, path, next}`; `forbidden` once another runner's request is confirmed |
| `POST /v1/runner/shadow-report` | machine | `{transition: "claim" \| "set", ticket_id, status, nonce, at}` | `{ok}`, or a logged `shadow-conflict` |
| `GET /v1/sync/events` | mirror | `?after=<seq>`, which acknowledges up to the lesser of `after` and the last `seq` a read returned to the mirror | `{events[], next}` |
| `POST /v1/ui/cutover` | session | `{repository, confirm: true}` | `{ok: true}` |
| `POST /v1/ui/adoptions/{claim}/confirm` | session | `{runner_id}` | `{ok: true}` |
