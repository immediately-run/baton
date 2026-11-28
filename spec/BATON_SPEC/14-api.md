---
title: "14. API"
description: "The routes Baton serves, each with its caller, body and response."
---
## 14. API

The routes Baton serves, each with its caller, body and response. Under `/v1`, an unmatched
request is `404 not-found`. A row cites the rules that own its behaviour, bounds and
refusals. Routes of designs not built yet are in
[the data model and API proposal](../proposals/data-model-and-api.md).

A GET/HEAD row also accepts `HEAD` with the same status and headers as `GET`, but no body.

**Requests.** Bodies are JSON. A signed caller sends an RFC 9421 `Signature` and
`Signature-Input` by its SSH key (R-BTN-13), or its API key as `Authorization: Bearer`
(R-BTN-159); the principal table and who may hold which kind of key are §12's. A runner adds
`X-Runner-Secret` to every call after its first heartbeat (R-BTN-14), and every runner call
updates its `last_seen_at`. A destructive action takes `confirm: true` in its body, else
`confirm-required` (§12.2). The CLI command that calls each route is R-BTN-127's. Any route may
answer `rate-limited` or `quota` (R-BTN-135). Every request carries `Baton-Client` and every
response `Baton-Client-Versions` (R-BTN-197).

**Routes a session shares with the keys.** A route whose callers include a key's role also
answers a session of that role (R-BTN-155), on its key's scope — an administrator's on every live
repository — with the entry, query and JSON the key gets (R-BTN-179), R-BTN-186's key-only acts
and the routes R-BTN-179 keeps to a key (`GET /v1/admin/state`) excepted. When a request is a
session's is R-BTN-155's. On these reads a repository the caller cannot read —
unowned, ungranted, unregistered or retired — answers `forbidden` for every principal; an
entity id absent from a readable repository answers `not-found`. Each such `GET` answers a
strong `ETag` over R-BTN-196's state version, the caller, the route and its query — and a
coarse clock bucket where the answer shows what the clock decides — built after the caller is
authorized and before the read runs; a matching `If-None-Match` answers `304` with no body.
A new list read pages by `?cursor=` in and `next_cursor` out (absent on the last page), 100
items a page unless its row says otherwise; the cursor is opaque and bound to the caller, the
route and the other query parameters, and one from another caller, route or filter, or a
tampered one, is `invalid-params`. A new read answers `{<items>: [...], next_cursor?,
counts?}`, timestamps as epoch milliseconds, its filters as query parameters, an unknown one
`invalid-params`. The reads that existed keep their paging: `history`'s `?before=&limit=`,
`blocked`'s and `conditions`' own `?cursor=`.

**Runner history fields.** The repository runner reads and the `runners` section of
`GET /v1/admin/state` give every alive runner in their roster its latest `transcript_url`
and `last_report` when present. Both fields are `null` for runners not alive under R-BTN-3.
The history lookups read a bounded number of rows per live runner, independent of retained
history size. This does not limit the roster or change retention.

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
| `not-eligible` | `rule`, `rule_code` (`max-claims` for R-BTN-4's limit; `not-selected` for an `advance` into a leg neither queued nor the verdict's `run`, R-BTN-63) | §6.6, R-BTN-4, R-BTN-63 |
| `stale-selection`, `not-open`, `duplicate`, `lease-lost` | | a verdict refused (R-BTN-205) |
| `blocked` | | R-BTN-75 |
| `backing-off` | `until` | R-BTN-122 |
| `runner-backing-off` | `until` | R-BTN-122 |
| `barred-tag` | | R-BTN-60, R-BTN-67 |
| `stale-skills` | | R-BTN-65 |
| `no-eligible-ticket` | | §9.1 |
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
- *reader*: a key granted on the repository, an owner of it, a member of it (R-BTN-204), or an
  administrator.
- *owner*: an owner key of `{repository}`. Which owner actions need an approver on one of the
  policy's `approvers.*` lists, and which a delegated key may call, are R-BTN-188's and
  R-BTN-186's; a row does not repeat them.
- *admin*: a key in the administrator set. R-BTN-188 says which administrator writes a
  repository's policy closes.
- *session*: a dashboard session (R-BTN-155) of any role, same-origin JSON (R-BTN-16), unless
  the row narrows it — `session (administrator)`, `session (administrator, owner)`; on a key's
  route a session of each role the row's key callers name is a caller as well (above).
- *sync*: the repository's sync credential — a sync key, a CI identity token, or a machine key
  naming `?repository=` (R-BTN-93, R-BTN-102).
- *instrument*: an instrument key.

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| **Runner** | | | | |
| `POST /v1/runner/heartbeat` | machine | §8's heartbeat body, with `hostname`, `session_name`, `host?: {memory_mb?}` (R-BTN-174), `last_activity_at?` and `reports?: [{claim_id?, repository?, key?, payload}]` (exactly one of `claim_id` and `repository` per entry) | §8's heartbeat response, with `runner_id`, `incarnation`, `lease_timeout_s` and `grant: {capabilities[]}`; `reports_refused?` lists refused report indices | R-BTN-3, R-BTN-9, R-BTN-14 |
| `POST /v1/runner/claim` | machine | `{request_id, ticket_id?, prefer?: [{ticket_id, leg?}], legs?, rationale?}` | §9.1's claim response. `version` is `''` when the source posts none; `course_id` and `course_version` are `null` for a claim with no course | §9.1, R-BTN-4, R-BTN-45, R-BTN-100, R-BTN-106, R-BTN-143 |
| `POST /v1/runner/claims/{id}/advance` | holder | §9.1's advance body, with `course?` (opaque JSON) and `outputs?: [{name, schema, uri?, digest?, value?}]` and `scope_exceeded?: {actions: [{kind, target, ref?}], dropped?}`; and `local_order?: {by, ran_at}` on the advance that finishes a leg run under a local order (R-BTN-202) | §9.1's reply: `{ok, station, ctx?, flags[], run_id?, run?, inputs: [{name, uri?, digest?, value?, from_leg, from_run, leg_version}]}`; `run_id` and `run` (its number, R-BTN-63) when the advance starts a run; `ctx`, `answers` and `ctx_digest` (R-BTN-205) when it finishes one | §9.1, R-BTN-63, R-BTN-205, R-BTN-64, R-BTN-82, R-BTN-84, R-BTN-108, R-BTN-202, §12.9 |
| `POST /v1/runner/claims/{id}/end` | holder | §9.4's end body, with `prerequisite?: {kind: "capability", ref}` (R-BTN-126); `local_order?` (R-BTN-202) | `{ok: true}`, or refused as R-BTN-205's verdict refusals say | §9.4, R-BTN-83, R-BTN-86, R-BTN-126, R-BTN-202, R-BTN-205 |
| `POST /v1/runner/claims/{id}/reselect` | holder | `{}` | a new handout `{ctx, answers, ctx_digest}` for the claim's last arrival, voiding the earlier one | R-BTN-63, R-BTN-205 |
| `POST /v1/runner/selections` | machine | `{request_id}` | a selection want offered to the caller: `{want_id, ticket_id, course_id, course_version, snapshot_sha, ctx, ctx_digest, lease_until}`, or `204` with none | R-BTN-205 |
| `POST /v1/runner/selections/{want}` | machine (the want's lessee) | `{ctx_digest, verdict}` | `{ok, queued?}`, or refused `stale-selection`, `not-open`, `duplicate` or `lease-lost` | R-BTN-205 |
| `POST /v1/runner/claims/{id}/conditions` | holder | `{type, disposition, restarts?, default?, severity?, url?}` | `{condition_id}`; `invalid-params` for `baton` or `baton.*` | R-BTN-160 |
| `POST /v1/runner/messages/{id}/ack` | machine | `{reply?: {text}}` | `{ok: true}` | §6 |
| `POST /v1/runner/activities` | machine | `{activities: [{id, claim_id, parent_id?, kind, seq?, label?, source, started_at, ended_at?, outcome?, detail?}]}` | `{ok, refused: [{id, code}]}` | §9 |
| `POST /v1/runner/readings` | machine | `{readings: [{instance, kind: "state" \| "measure", available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}]}` | R-BTN-76, R-BTN-101, R-BTN-151 |
| `GET /v1/runner/fleet` | machine alone | `?repository=`; `If-None-Match` | `{repository, claims[], reports[], board, bars[], course_data}`, `ETag`; `304` unchanged | R-BTN-99, R-BTN-152 |
| `GET /v1/runner/instances` | machine alone | `If-None-Match` | `{instances[], capabilities: [{capability, capacity, holders[]}]}`, `ETag`; `304` unchanged | R-BTN-99 |
| `GET /v1/runner/launch-candidates` | machine alone | `If-None-Match` | `{repositories: [{repository, candidates[]}]}`, `ETag`; `304` unchanged | R-BTN-99 |
| `GET /v1/runner/recommendations` | machine | `?limit=` (10), `?all=1` (≤ 500) | `{recommendations: [{ticket_id, station, legs, flags[], course, handoff_url?}], truncated?}` | R-BTN-45, R-BTN-61, R-BTN-99 |
| `GET /v1/runner/next` | machine | — | the first recommendation, or `no-eligible-ticket` | R-BTN-45 |
| `GET /v1/runner/tickets/{ticket}/holder` | machine, or machine alone | `?session_name=` with the runner secret, when the caller has them | `{held_by_other, fence_pending}` | R-BTN-7 |
| `GET /v1/runner/branch-holder` | machine, or machine alone | `?repo=<forge path>&branch=`, and `session_name` with the runner secret when the caller has them | `{tickets[], held_by_other, fence_pending}`, granted repositories' tickets only; a key alone counts every active claim as another's | R-BTN-7, R-BTN-141 |
| **Repository reads** | | | | |
| `GET/HEAD /v1/repositories` | admin, owner, member, session | — | `{repositories: [{id, github, forge, web_base, default_branch, weight, courses: [{id, version}], head: {sha, received_at, observation} \| null, mode: "shadow" \| "cut-over", running, ready, needs_you, runners_alive, runners_total, discrepancies_7d, exclusive_goal: null}], session: {role} \| null, link_hosts[], session_hosts[], seed_owners?, server_time}`: the caller's repositories — every live one for an administrator, an owner or member key's own; `needs_you` counts open conditions, `runners_total` the runners of keys granted there; `seed_owners` for an administrator | R-BTN-179, R-BTN-58 |
| `GET/HEAD /v1/actions` | session | — | `{actions: [{id, summary, effect, http: {method, path, match?}, callers: [the caller's], input, ui?: {view: [screen id]}}], session: {role}}`: the actions the session may call; a key is `forbidden` | R-BTN-129 |
| `GET/HEAD /v1/repositories/{repository}/courses` | reader | — | `{courses: [{id, version, file, capability_types, roles, skill, min_runner_version, intake, queues: [{leg, depth, max_queue}], refused: {version, reason, violations[], snapshot_sha, refused_at} \| null}]}`: each course's file as last accepted, and the newer version refused | R-BTN-69, R-BTN-79, R-BTN-121 |
| `GET/HEAD /v1/repositories/{repository}/courses/{course}` | reader | `?since=` (an ISO time, or a span such as `24h` or `7d`; 24 hours unless given, 7 days at most), `?summary=1`, `?cursor=` | `{course: {id, version, file, skill, min_runner_version}, refused, runners: {declaring, alive}, intake, legs: [{leg, from[], to[], queue: {depth, max_queue, over, intake}, state: {ready, running, waiting, backing_off, blocked: [{kind, found: before \| during, count, tickets[]}]}, window: {started, finished, abandoned, wait_p50_s, run_p50_s, fail_rate} \| null, runs[]}], stations: [{station, start, end, resting, claimed, arrived_today}], counts: {tickets}, window: {since, until}, stats, off_graph, tickets: [{ticket_id, title, station, path, claim_legs, waits_for, handoff, blocks, backing_off_until, next_leg, source, parent, children}], next_cursor?}`: the counts are over every ticket of the course, the tickets 100 a page by station in the file's order then the board's; `?summary=1` leaves out the tickets and the runs; a course the registry does not hold is `not-found` | R-BTN-69, R-BTN-79, R-BTN-83, R-BTN-126, R-BTN-128 |
| `GET/HEAD /v1/repositories/{repository}/runners` | reader | — | `{runners: [{runner_id, hostname, session_name, alive, last_seen_at, last_activity_at, reaped_at, harness, kind, isolation, capabilities: [{capability, declared}], granted \| null, tags, courses, lease_timeout_s, credential: {kind, granted, role, domain}, last_report, transcript_url, claim, claims[], busy_elsewhere, reaped_claim}], not_built}`: every runner whose key holds a live grant on the repository, and a seed or bearer key's runner declaring one of its courses, by hostname then session name; `claim` is `{claim_id, ticket_id, station, leg, run_id, claimed_at, lease_ends_at, deadline_at, attempt, max_runs, next_backoff_until, session_url, session_link, log_dir, activity}`; a constant number of statements whatever the rows; the executor's fields are not served until R-BTN-107's declaration is stored | R-BTN-3, R-BTN-146, R-BTN-174, R-BTN-113 |
| `GET/HEAD /v1/repositories/{repository}/runners/{runner}` | reader | `?since=` (as the course read's) | `{runner: <the list's row> + {profile}, attempts: [{run, claim_id, runner_id, run_id, started_at, ended_at, end, detail}], window: {since, until, claims: [{claim_id, ticket_id, leg, started_at, ended_at, end: running \| released \| silent \| reaped \| done \| suspended, end_reason, detail, session_url, session_link, log_dir, runs[], activities: [{id, parent_id, kind, label, source, started_at, ended_at, outcome, detail}]}]}, not_built}`; `{runner}` is the integer runner id; a runner with no grant on the repository is `not-found` | R-BTN-3, R-BTN-146, R-BTN-113 |
| `GET/HEAD /v1/repositories/{repository}/schemas` | reader | `?ids=<schema id>,…` (at most 50) | `{schemas: {<id>: <schema>}}` from the `std:` library and the repository's course schemas, each with its `x-baton-view`; an id not held is absent | R-BTN-108, R-BTN-112 |
| `GET/HEAD /v1/repositories/{repository}/tickets` | reader | `?state=` (a state word, or the tab `blocked` or `closed-today`), `?q=` (a substring of id or title), `?cursor=` | `{tickets: [{ticket_id, title, course, requires[], requires_unmet[], tags[], order, parent, expedite, position: {station, path_len, next_leg} \| null, state, reasons[], detail, eligible_runners?: [{runner_id, hostname, session_name}], failed_rule?}], next_cursor?, counts: {<state>: n, total}, matched, server_time}`: every live ticket under its one state word by §11.4's precedence, ready ones first in the board's order, then by precedence and id, the tickets closed in the last 24 hours last; `detail` is the state's own and includes the running leg's `session_url` and `session_link` on a running row; `counts` ignore the filters; 100 a page | R-BTN-61, R-BTN-83, R-BTN-75, R-BTN-113 |
| `GET/HEAD /v1/repositories/{repository}/tickets/{ticket}` | reader | — | `{ticket_id, repository, course_id, title, path, requires[], operator_only, expedite, rank, snapshot_sha, station: {station, path[], next_leg, to_end, handoff_url?} \| null, verdict?: {kind, leg?, host?, until?, on?, because, course_version, key_id, at} \| null, last_written_by?}`, and with it the ticket's row of the list read (`course`, `tags`, `order`, `requires_unmet`, `position` with `next_source`, `state`, `reasons`, `detail`, `eligible_runners?`, `failed_rule?`), `claim: {claim_id, runner_id, hostname, session_name, leg, run_id, claimed_at, lease_ends_at, deadline_at, attempt, max_runs, next_backoff_until, session_url, session_link, log_dir, alive, stalled} \| null`, `attempts[]`, `overrides: {expedite, hold: {set_by, reason, since} \| null}`, `conditions: [{condition_id, type, severity, leg, restarts[]}]`, `scope: [{id, kind, target, ref, at}]`, `fence: {claim_id, runner_id, hostname, since} \| null`, `parent`, `children[]`, `resume`, `web_url`, `allowed: [<action id>]`, `evidence: [{ref, kind, found_at, weighed_at}]` (R-BTN-39) and `server_time` | R-BTN-194, R-BTN-24, R-BTN-92 |
| `GET/HEAD /v1/repositories/{repository}/tickets/{ticket}/blocks` | reader | `?runner=me` | `{blocked, blocks: [{kind, leg?, ref, since, until?}], other: [{kind, detail}]}` | R-BTN-75 |
| `GET/HEAD /v1/repositories/{repository}/tickets/{ticket}/prerequisites` | reader | `?leg=` (default the queued leg), `?runner=me` | `{leg, ready, prerequisites: [{kind, ref, met, why, since?, until?, station?}], other: [{kind, detail}]}`; `kind` `station` first when a leg is named | R-BTN-120, R-BTN-75 |
| `GET/HEAD /v1/repositories/{repository}/tickets/{ticket}/history` | reader | `?before=<id>&limit=` (≤ 200) | `{rows: [{id, at, kind, claim_id?, leg?, run?, run_id?, reached?, next_leg?, snapshot_sha?, course_version?, leg_version?, detail, inputs?, rationale?}], next_before?, resume?}`; `resume` is `{end_reason, ended_at, branches, prs}` over the ended claims, null when no claim ever ended | R-BTN-24, R-BTN-81, R-BTN-84 |
| `GET/HEAD /v1/repositories/{repository}/tickets/{ticket}/children` | reader | — | `{children: [{ticket_id, station, blocked, closed?}]}` | R-BTN-86 |
| `GET/HEAD /v1/repositories/{repository}/tickets/{ticket}/legs/{leg}/runs` | owner, member, admin | — | `{runs: [{run, run_id, claim, runner, started_at, ended_at?, end?, session_url, session_link, log_dir?, transcripts: [{repo, path, pushed_at}]}]}` | R-BTN-128, R-BTN-144 |
| `GET/HEAD /v1/repositories/{repository}/blocked` | reader | `?on=<kind>:<ref or *>&transitive=1?`, or `?cursor=` | `{tickets: [{ticket_id, blocks}]}`; with no `on`, blocked tickets grouped by kind and `ref`, 100 a page, `next_cursor` | R-BTN-75, R-BTN-79 |
| `GET/HEAD /v1/repositories/{repository}/conditions` | reader | `?open=1`, `?person=1`, `?type=<prefix>`, `?ticket=`, `?cursor=` | `{conditions: [{condition_id, ticket?, leg?, type, disposition, restarts, default?, severity, url?, session_link?, detail?, resolve_url, raised_at, closed_at?, outcome?}], questions?: [{ticket, leg, asks, options: [{id, reached}], queued_at, question_id?, url?, severity?, posted_at?}], next_cursor?}`, 100 a page; `questions`, the queued person legs, only with `person=1` | R-BTN-116, R-BTN-163, R-BTN-113 |
| `GET/HEAD /v1/repositories/{repository}/conditions/{condition}` | reader | — | `{condition_id, repository, ticket_id, leg, run_id, claim_id, type, disposition, severity, url, session_link?, restarts, default, raised_at, outcome, closed_at, closed_how, resolve_url, ticket: {ticket_id, title, course_id, station, next_leg} \| null, unblocks: [ticket id], allowed: [action id], not_built}` (`condition.show`): `unblocks` the tickets with a `ticket` block on the condition's ticket; `allowed` is empty while no resolve is built; `not-found` for another repository's id, as for none | R-BTN-160, R-BTN-163 |
| `GET/HEAD /v1/repositories/{repository}/needs-you` | reader | — | `{repository, conditions: [a condition, with outcome, resolve_url, allowed], questions: [{ticket_id, leg, asks, title, question_id, url, severity, options: [{id, reached, action}], expires_at?, answerable, why, human_only}], listings: {<name>: [...]}, held_posts, elsewhere: [name], not_built, server_time}` (`repo.needs-you`): the repository's open conditions by severity then age, its queued person legs with whether the caller may answer, and the state read's Needs-you listings narrowed to it (`adoptions` for an administrator); `elsewhere` names the instance-wide listings it leaves out | R-BTN-116, R-BTN-163 |
| `GET/HEAD /v1/conditions/{condition}` | session | — | `{condition_id, repository, path}` (`condition.locate`), within the session's repositories; `not-found` otherwise. The front answers `GET /conditions/{id}` with `302` to `path` on it, and the shell otherwise | R-BTN-163, R-BTN-16 |
| `GET/HEAD /v1/repositories/{repository}/attestations` | reader | `?subject=<ticket>`, `?type=`, `?live=1`, `?cursor=` | `{attestations: [{id, type, subject: {ticket}, value, writer: {credential, classes[], touched}, at, lapses_at, revoked_at}], next_cursor?, writable_types: [type], writable_why, types, not_built}` (`attestation.list`), newest first, 100 a page: each applied answer to a person leg and each fact arrival and piece of evidence R-BTN-203 brings, the attestation held; `writable_types` the types the caller may write on `POST …/attestations` | R-BTN-116, R-BTN-181, R-BTN-185 |
| `GET/HEAD /v1/repositories/{repository}/sync` | reader | `?since=<ISO time>` (7 days unless given, 30 at most) | `{repository, head: {sha, parent_sha, received_at, ticket_count, observation, source} \| null, observation: {last, last_handed_out, outstanding: {number, handed_out_at, age_s, void} \| null}, last_post: {at, sha, accepted, code?} \| null, dispatch: {sync_workflow, mirror_workflow, last_sync_dispatch_at, window, last_resync_request_at, last_refusal}, held: [{sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at, accepted_at}], mode: {mode, cutover_at}, adoptions?, discrepancies: {since, by_kind, rows: [{id, ticket_id, claim_id, at, sub, baton, git, observation}], truncated}, allowed: [action id], not_built, server_time}` (`repo.sync`); `adoptions` for an administrator alone | R-BTN-11, R-BTN-28, R-BTN-62, R-BTN-85 |
| `GET/HEAD /v1/repositories/{repository}/board` | owner, member, a runner granted there, admin | — | `{repository, ready[], holders: [{ticket_id, worker_id, hostname, session_name, lease_ends_at, session_url, session_link}], granted_capabilities: string[] \| null, server_time}`; `holders` are the repository's live claims | R-BTN-179 |
| `GET/HEAD /v1/repositories/{repository}/stats` | reader | `?since=` | per station and leg, wait and run times; ends by reason and detail; suspensions; advice overridden; `off-graph` — aggregates and ids only | §5 |
| `GET/HEAD /v1/repositories/{repository}/policy` | reader | — | unsigned policy and guarantees, with CLI compatibility fields | R-BTN-189 |
| `POST /v1/repositories/{repository}/sequences/{kind}/next` | reader, or sync | `{floor?, for?}`, or an empty body; a body that is not JSON is `invalid-params` | `{kind, number}` | R-BTN-199 |
| **Owner** | | | | |
| `POST /v1/owner/{repository}/tickets/{ticket}/resolve` | owner | `{restart, condition_id?}`; `condition_id` required when the ticket has more than one open condition taking a restart | `{ok: true}`; `invalid-params` for a restart the condition does not offer | R-BTN-163 |
| `POST /v1/repositories/{repository}/attestations` | an owner key, a member key or a `human_only` key | `{type, subject, value, nonce, lapses_at?}`; the writer is the credential, a session's its key's role; who may write a person's answer is R-BTN-181's | `{id}` | R-BTN-116, R-BTN-181, R-BTN-185, R-BTN-191, R-BTN-204 |
| `POST /v1/owner/{repository}/grants` | owner | `{public_key, hostname?, label?, capabilities[], max_claims?, deliver_interactions?}`, or `{name, api_key: true, capabilities[], max_claims?}` | `{ok, pending: true}`; `{api_key}` once for the second form; `conflict` | R-BTN-4, R-BTN-58, R-BTN-117, R-BTN-146, R-BTN-163 |
| `POST /v1/owner/{repository}/grants/{fingerprint}/revoke` | owner | `{confirm: true}` | `{ok: true}` | R-BTN-58 |
| `GET/HEAD /v1/owner/{repository}/grants` | owner, session (administrator, owner) | — | `{repository, owners: [{repository_id, fingerprint, kind: ssh \| api, human_only, added_by, added_at}], grants: [{credential_id, hostname, label, repository_id, capabilities, max_claims, deliver_interactions, granted_by, granted_at, other_repositories[]}], settings, bars: [{…, set_by}], sync_keys: [{fingerprint, role, added_by, added_at}], dependency_consents: [{repository, granted_by, granted_at}], members: [{fingerprint, kind: ssh \| api, answers[], added_by, added_at}], not_built: {<kind>: <the rule or ticket that builds it>}, server_time}`; a key is listed by its fingerprint, never its line | R-BTN-93, R-BTN-146, R-BTN-179 |
| `POST /v1/owner/{repository}/members` | owner | `{public_key, answers[]}` to add; `{fingerprint, answers[]}` to change; `{fingerprint, remove: true, confirm: true}` | `{ok: true}`; `conflict` for a key holding another role (§12.1); not built (B-338) | R-BTN-204 |
| `POST /v1/owner/{repository}/owners` | owner | `{public_key}` to add; `{fingerprint, remove: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-58 |
| `POST /v1/owner/{repository}/bars` | owner | `{course, tag, legs?, applies, starts_at?, ends_at?, release_holders?, reason}` | `{id}` | R-BTN-67 |
| `POST /v1/owner/{repository}/bars/{id}/lift` | owner | — | `{ok: true}` | R-BTN-67, R-BTN-186 |
| `PUT /v1/owner/{repository}/settings` | owner | any owner setting (§13.1); `code_repos` as `[{path}]` | `{ok: true}` | R-BTN-66, R-BTN-140, R-BTN-186 |
| `PUT /v1/owner/{repository}/policy` | owner | `{base_version, policy, dry_run?}` or `{base_version, preset, dry_run?}` (`dry_run` is boolean) | `{version, hash, changed[], guarantees}` or, with `dry_run: true`, `{changed[], guarantees, trust_cleared[], stops: {legs[], tickets[]}, not_evaluated[]}`; `conflict` when stale, `forbidden`, `floor-violated` | R-BTN-188, R-BTN-189 |
| `GET/HEAD /v1/owner/{repository}/policy/log` | owner, session (administrator, owner) | `?after=<version>` | `{versions: [{version, hash, previous_hash, changed_by, approver, preset?, at, changed[]}]}` | R-BTN-188 |
| `POST /v1/human-keys` | a `human_only` key | `{public_key, signature}`, `signature` the new key's SSHSIG over its own public line; `{webauthn: {for_key, credential_id, public_key, attestation}}`, registering a security key for a person's key (R-BTN-185; not built, B-340); or `{fingerprint, revoke: true, confirm: true}` | `{ok: true}`; `conflict`; `unsatisfiable-approvers` | R-BTN-185, R-BTN-188 |
| **Sync and forges** | | | | |
| `GET /v1/sync/wanted` | sync or mirror | — | `{wanted, since?, head_sha}` for the caller's repository and role; `head_sha` is null before the first post | R-BTN-94 |
| `POST /v1/sync/want` | sync | — | `{ok: true}` | R-BTN-94 |
| `POST /v1/owner/{repository}/sync-want` | owner key | — | `{ok: true}` | R-BTN-94 |
| `POST /v1/sync/observation` | sync | an empty body, or `{release: <number>}` | §4.3's observation; a release `{released: <number>}` | R-BTN-11, R-BTN-62, R-BTN-126, R-BTN-139, R-BTN-140, R-BTN-150, R-BTN-203 |
| `POST /v1/sync/board` | sync | the board post (§4), with `legs_landed?: {count, tickets}` | `{ok: true}`; `head-moved`; `snapshot-rejected` for a held `force` post | R-BTN-11, R-BTN-147, R-BTN-149, R-BTN-190 |
| `POST /v1/github/webhook` | the GitHub App, by `X-Hub-Signature-256` | a delivery | `204`; repeats and the sync's own events ignored | R-BTN-73 |
| `POST /v1/forges/{repository}/notify` | a GitLab or Gitea notification, verified against `BATON_FORGE_SECRETS` | the notification | not built: `not-found`, or `too-large` over R-BTN-73's cap | R-BTN-95 |
| `POST /v1/probe/readings` | instrument | `{readings: [{instance, kind, available?, until?, valid_for?, detail?}]}` | `{ok, refused: [{instance, code}]}` | R-BTN-101 |
| **Administrator** | | | | |
| `GET/HEAD /v1/admin/repositories` | admin, session (administrator) | `?retired=1` | `{repositories: [{id, github, forge, web_base, default_branch, weight, head, mode, courses, sync_keys: [{fingerprint, role}], ci_identity, retired_at}], seed_owners?: [repository id]}`; a row is `GET /v1/admin/state`'s repository row with the registry's fields beside it; retired rows only with `?retired=1` | R-BTN-47, R-BTN-58, R-BTN-179 |
| `GET/HEAD /v1/admin/capacities` | admin, session (administrator) | `?capability=<c>` | `{capacities: [{capability, capacity, set_by, set_at, held, holders: [{claim_id, ticket_id, runner_id}]}], requiring?: [{repository, course, version, legs[], type}]}`; `requiring` with `?capability=` | R-BTN-178 |
| `GET/HEAD /v1/admin/instances` | admin, session (administrator) | — | `{instances: [{name, repositories[], serves[], state, until, readings: [{source, writer, kind, available, until, observed_at, lapses_at, detail, stale}]}], server_time}`; readings newest first, `stale` once `lapses_at` has passed | R-BTN-76, R-BTN-99, R-BTN-101 |
| `GET/HEAD /v1/admin/resources` | admin, session (administrator) | — | `{resources: [{name, scope, detail_schema, instances[]}], probes: [{fingerprint, label, instances[], added_by}]}` | R-BTN-76, R-BTN-101 |
| `GET/HEAD /v1/admin/settings` | admin, session (administrator) | — | `{link_hosts[], session_hosts[], check_app_id, recommended_client}` | R-BTN-112, R-BTN-113, R-BTN-197, §12.7 |
| `GET/HEAD /v1/admin/tenant` | admin, session (administrator) | — | `{envelope, figures: [{figure, value, envelope, ratio, over}], day: {day, requests, rows_written, limits}, live_claims, frozen_at, sealed_at, needs_you: {keys, capacity[], instances_unknown[], stale_clients[], stale_skills_no_course[]}, not_built, server_time}`; `needs_you` is the instance-wide Needs-you listings, each as the state read lists it; never conditional | R-BTN-2, R-BTN-87, R-BTN-88 |
| `GET/HEAD /v1/admin/sessions` | admin, session (administrator) | — | `{sessions: [{role, key_fingerprint, via, created_at, expires_at, current}], not_built, server_time}`: the live sessions, newest first, the caller's own `current`; `via` is `"access"` or `"link"`; never a session's id or its hash; never conditional | R-BTN-155 |
| `POST /v1/admin/repositories` | admin | register `{id, github, forge, remote, web_base?, ci_identity?, dispatch?, sync_keys?, default_branch, sync_workflow?, weight?, owner_keys[], forge_repo_id, forge_owner_id}`; change `{id, …, github?, forge_repo_id?, forge_owner_id?, sync_keys_add?, sync_keys_remove?, owner_keys_add?, former_paths_remove?, confirm?}` (never `forge`); `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict` | R-BTN-47, R-BTN-92, R-BTN-93, R-BTN-138, R-BTN-188 |
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
| `GET /v1/admin/state` | admin | — | the state in one request for a terminal, built by the functions the entity reads use (`stateView()`): `{server_time, repositories, ready, held, runners, running, timeline, limits, instance, needs_you, blocked, discrepancies, resources, capacity}`; `runners` keeps every runner row; a session's cookie does not open it | R-BTN-57, R-BTN-179, R-BTN-3 |
| `GET /v1/admin/export` | admin | `?with_history=1` | `baton.owner-state/v1` | R-BTN-88 |
| `POST /v1/admin/import` | admin | an export | `{ok: true}`; `conflict`, `invalid-params` | R-BTN-88, R-BTN-158 |
| **Dashboard** | | | | |
| `POST /v1/login` | none, or a verified Cloudflare Access assertion | `{token}` or `{access: true, key?}`, exactly one (else `invalid-params`); `key` a fingerprint from `choose` | `{ok: true, session_id, role}` and a new session cookie value, the browser's live sessions rebound to it; `{choose: [{fingerprint, role, repositories}]}` and no cookie where the assertion's email opens several keys and names none (per-role and per-tab sessions not built: B-76); else `unauthenticated` (with `reason` for Access; see R-BTN-155) or `unavailable`, and no cookie | R-BTN-155 |
| `POST /v1/ui/human-challenge` | session | `{action, params}` | `{challenge, expires_at}`: a WebAuthn challenge for that session, action and parameters, used once, valid two minutes; not built (B-340) | R-BTN-185 |
| `POST /v1/ui/logout` | session | `{}` or `{all: true}` | `{ok: true}`; the tab's own session ends (`ui.logout`), and the cookie is cleared when no session of the browser remains; `all` ends every session bound to the cookie and clears it (not built: B-76) | R-BTN-155 |
| `POST /v1/ui/messages` | session (administrator, owner) | `{to_runner_id, kind: "release" \| "status_request" \| "wind-down", payload}`; Stop is `{kind: "release", payload: {ticket_id, reason: "requested"}, confirm: true}` | `{id}`; `forbidden` for a `release` whose ticket `to_runner_id` does not hold; any other kind `invalid-params` | §6, §12.2, R-BTN-119 |
| `POST /v1/admin/messages` | administrator | `{to_runner_id, kind: "release" \| "status_request" \| "wind-down", payload}`; Stop is `{kind: "release", payload: {ticket_id, reason: "requested"}, confirm: true}` | `{id}`; `forbidden` for a `release` whose ticket `to_runner_id` does not hold; any other kind `invalid-params` | §6, §12.2, R-BTN-119 |
| `POST /v1/owner/{repository}/messages` | owner | `{to_runner_id, kind: "release" \| "status_request" \| "wind-down", payload}`; Stop is `{kind: "release", payload: {ticket_id, reason: "requested"}, confirm: true}` | `{id}`; `forbidden` for a `release` whose ticket `to_runner_id` does not hold; any other kind `invalid-params` Stop names a ticket here; status and wind-down require ownership of every repository the runner is granted on or holds a claim in. | §6, §12.2, R-BTN-119 |
| `POST /v1/ui/overrides/{ticket}` | session (administrator, owner) | `{expedite}` or `{hold}` | `{ok: true}` | §6 |
| `POST /v1/admin/overrides/{ticket}` | administrator | `{expedite}` or `{hold}` | `{ok: true}` | §6 |
| `POST /v1/owner/{repository}/overrides/{ticket}` | owner | `{expedite}` or `{hold}` | `{ok: true}` The ticket must be in this repository. | §6 |
| `POST /v1/ui/board/accept` | session (administrator) | `{repository, sha}` | `{ok: true}` (`repo.accept-post`); `not-found` for no such held history | R-BTN-11 |
| `POST /v1/admin/board/accept` | administrator | `{repository, sha}` | `{ok: true}` (`repo.accept-post`); `not-found` for no such held history | R-BTN-11 |
| `POST /v1/ui/resync` | session (administrator, owner) | `{repository}` | `{ok: true}` (`repo.resync`): the repository's sync workflow is dispatched, as a delivery dispatches it; `conflict` within 30 seconds of the last one or with no sync workflow registered; `invalid-params` for `force` or `sha` | R-BTN-73, R-BTN-94 |
| `POST /v1/admin/resync` | administrator | `{repository}` | `{ok: true}` (`repo.resync`): the repository's sync workflow is dispatched, as a delivery dispatches it; `conflict` within 30 seconds of the last one or with no sync workflow registered; `invalid-params` for `force` or `sha` | R-BTN-73, R-BTN-94 |
| `POST /v1/owner/{repository}/resync` | owner | `{repository}` | `{ok: true}` (`repo.resync`): the repository's sync workflow is dispatched, as a delivery dispatches it; `conflict` within 30 seconds of the last one or with no sync workflow registered; `invalid-params` for `force` or `sha` The body must name this repository. | R-BTN-73, R-BTN-94 |
| `POST /v1/ui/scope/{id}/resolve` | session (administrator, owner) | `{}` | `{ok: true}`; `not-found` for none open | §12.9 |
| `POST /v1/admin/scope/{id}/resolve` | administrator | `{}` | `{ok: true}`; `not-found` for none open | §12.9 |
| `POST /v1/owner/{repository}/scope/{id}/resolve` | owner | `{}` | `{ok: true}`; `not-found` for none open The finding must be in this repository. | §12.9 |
| `POST /v1/ui/claims/{id}/reap` | session (administrator) | `{confirm: true}` | `{ok: true}` | §9 |
| `POST /v1/admin/claims/{id}/reap` | administrator | `{confirm: true}` | `{ok: true}` | §9 |
| `POST /v1/ui/claims/{id}/fence-clear` | session (administrator) | `{confirm: true}` | `{ok: true}`; `conflict` when the claim's fence is not pending | R-BTN-19 |
| `POST /v1/admin/claims/{id}/fence-clear` | administrator | `{confirm: true}` | `{ok: true}`; `conflict` when the claim's fence is not pending | R-BTN-19 |
| `POST /v1/ui/claims/{id}/confirm`, `…/release` | session (an administrator's) | `{confirm: true}` | `{ok: true}`; `not-found` for a claim that is no unconfirmed completion. Each acts at once, as `…/reap` does: the confirmation code of R-BTN-155 is not built (B-76) | R-BTN-10 |
| `POST /v1/admin/claims/{id}/confirm`, `…/release` | administrator | `{confirm: true}` | `{ok: true}`; `not-found` for a claim that is no unconfirmed completion. Each acts at once, as `…/reap` does: the confirmation code of R-BTN-155 is not built (B-76) | R-BTN-10 |

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
| `POST /v1/ui/cutover` | session (administrator) | `{repository, confirm: true}` | `{ok: true}` |
| `POST /v1/admin/cutover` | administrator | same as the session route above | same as the session route above |
| `POST /v1/ui/adoptions/{ticket}/confirm` | session (administrator) | `{confirm: true}` | `{ok: true}` |
| `POST /v1/admin/adoptions/{ticket}/confirm` | administrator | same as the session route above | same as the session route above |
