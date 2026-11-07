---
title: "13. Data model"
description: "One SQLite database per tenant, in the tenant's Durable Object (or the local host's file)."
---
## 13. Data model *(proposal)*

One SQLite database per tenant, in the tenant's Durable Object (or the local host's file). The
schema below is the current one, together with `BATON_MCP_OAUTH_SPEC` §12's rows (the OAuth
tables, `mcp_keys`' OAuth columns, `oauth_redirect_uris`, its alarm instants and the `oauth` event
kind), which B-73 folds in here; `src/migrations/` holds the numbered, append-only migrations that
reach it, each new one the next free number at merge as R-BTN-31 numbers a scenario (legacy until B-176, R-BTN-193), and the object refuses to serve until every migration is applied (§2).

**Conventions.**

- Times are integer UTC epoch milliseconds (`*_at`, `since`, `until`, `not_before`, `due_at`).
- Columns marked JSON hold JSON text; flags are integers 0/1. Free text is validated on write
  (§12); opaque course blobs are size-capped and never read by core.
- `ticket_id` is always the qualified id `<repository>:<local id>`; `repository_id` is
  `repositories.id`; `credential_id` and `fingerprint` are a key's fingerprint (`SHA256:…` for an
  SSH key, `bak_<id>` for an API key); `runner_id` and `claim_id` are integers.
- An actor column (`set_by`, `added_by`, `granted_by`, `created_by`, `actor`) holds
  `admin:<fp>`, `owner:<fp>`, `runner:<id>`, `mcp:<id>` (an MCP key's immutable id, never its reusable name, R-BTN-130), `sync`, `alarm` (or `alarm:<reason>`, e.g. `alarm:leg-timeout`) or `server`.
- When a ticket leaves the board (closed or dropped), exactly its board rows are deleted:
  `tickets`, `ticket_requires`, `ticket_depends`, `ticket_stations`, `ticket_next_legs`,
  `ticket_bars`, `ticket_questions`, `leg_queue_members`, `ticket_blocks`, `leg_needs`,
  `ticket_timers` and its `condition_bindings`. Its `ticket_overrides` row and `leg_attempts`
  move into `closed_tickets.kept_json` and come back if the same id returns (R-BTN-12); a
  `retry` block is rebuilt from `leg_attempts.retry_after`. A ticket marked `cancelling` keeps its
  board rows until Baton closes it (R-BTN-168): the snapshot's `closed` entry is recorded and
  applied then. Every other row naming it is kept:
  claims and their leg runs (the traversal record, R-BTN-63), conditions, the outbox; its
  history, outputs and inputs stay 90 days after it
  closes (R-BTN-81).
- Values marked *adoption* serve only the adoption appendix (§16): legacy claims at cutover and the git mirror, deleted with it.
- Nothing below holds an item body, note, exit criterion or PR list (R-BTN-33).

### 13.1 Repositories, courses and tenant settings

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `repositories` | `id` (`^[a-z][a-z0-9-]{0,39}$`) | `github` (the forge path, case-insensitive; `~retired/<id>` on a retired row), `forge` (`github`\|`gitlab`\|`gitea`\|`git`, fixed), `remote`, `web_base`, `forge_host`, `forge_repo_id`, `forge_owner_id` (decimal strings), `forge_ids_seen` JSON (`{mismatch}`: the last 5 distinct mismatched ids, R-BTN-138), `former_paths` JSON (latest 10), `ci_identity` JSON, `dispatch` JSON, `default_branch`, `sync_workflow`, `mirror_workflow` *adoption*, `mirror_pusher` *adoption* (the mirror's forge login, R-BTN-73), `mirror_acked_seq` *adoption*, `sync_wanted_at`, `sync_wanted_after`, `weight` (100), `tiers` JSON (lowest first), `protection_json` (`{matched, reading_hash, at, runner_id}`, the protection checker's last report, R-BTN-180), `cutover_at` *adoption*, `retired_at`, and the owner settings below | A registered repository (R-BTN-47, R-BTN-92, R-BTN-93, R-BTN-94, R-BTN-138). Unique: `(forge, forge_host, forge_repo_id)` among live rows; a forge path among live rows |
| `courses` | `(repository_id, id)` | `version`, `skill`, `course_json` (the validated course file: stations, legs, contracts, capability types and roles, conditions, deadlines), `leg_capabilities_json` (each leg id → the capabilities its `requires` names, roles expanded as `graphOf` expands them; `{}` on a row written before migration 0022 until its next accepted post), `step_kinds` JSON, `min_runner_version`, `branch_pattern` (`claude/{ticket}-*`), `previous_branch_pattern` | Each course as the repository's last accepted snapshot posted it (R-BTN-48, R-BTN-69, R-BTN-121, R-BTN-134); the derived leg capabilities are written in the statement that writes the file, the input rule 4's candidate query reads (R-BTN-120) |
| `course_schemas` | `(repository_id, id)`, `id` = `<course>:<name>@<n>` | `course_id`, `digest`, `schema_json`, `snapshot_sha`, `posted_at` | Named schemas; immutable — a different digest for a stored id refuses the course file (R-BTN-108) |
| `course_data` | `repository_id` | `payload` (opaque JSON), `snapshot_sha` | The courses' opaque board data, served in the fleet view (R-BTN-99) |
| `condition_bindings` | `(repository_id, ticket_id, prefix)`; `ticket_id` `''` for the repository scope | `course_id`, `replaces`, `snapshot_sha` | Bindings as posted (`bindings` and `tickets[].conditions`, §4.4) from `.baton/baton.json` and ticket files; Baton reads them only to file handler tickets for its own conditions (R-BTN-161, R-BTN-171) |
| `baton_settings` | `key` | `value`: `tenant_id` (written at the first request, R-BTN-135), `frozen_at`, `sealed_at` (R-BTN-88), `instances_version` (R-BTN-99) | Tenant state |
| `instance_settings` | one row | `link_hosts` JSON, `session_hosts` JSON, `check_app_id` (the check App's id, by which the sync tells its runs, R-BTN-115) | Administrator settings (R-BTN-112, R-BTN-113, §12.7) |
| `code_repo_consents` | `(home_id, repo_id)` | `consented_by` (`owner:<fp>` of `repo_id`'s owner, or `admin:<fp>`), `consented_at` | A registered repository's consent to a home's `code_repos` entry; written only by `POST /v1/owner/{repo_id}/code-repo-consents` or an administrator, never by the home's settings (R-BTN-140) |

**Owner settings** — columns of `repositories`, written by `PUT /v1/owner/{repository}/settings`
(R-BTN-66); the administrator sets `weight` and `tiers` at registration.

| Setting | Default | Rule |
|---|---|---|
| `transcript_repos` JSON | `[]` | R-BTN-20 |
| `artifact_buckets` JSON | `[]` | R-BTN-82 |
| `retry` JSON — the repository's default policy, its ceilings and floors | NULL (core defaults) | R-BTN-122 |
| `required_bars` JSON `[{course, leg, except?, tag_prefix}]` | `[]` | R-BTN-67 |
| `unblocked_trigger` JSON (the `dispatch` shape) | NULL | R-BTN-77, R-BTN-94 |
| `pushers` JSON (forge user ids) | `[]` | R-BTN-139 |
| `code_repos` JSON `[{path, repo_id, former_paths}]` — owners write `path` only; Baton resolves `repo_id` and keeps `former_paths` | `[]` | R-BTN-140 |
| `scope_policy` (`report`\|`hold`) — what a scope-exceeded finding does: Needs you alone, or a hold on its ticket | `report` | §12.9 |
| `worker_pushers` JSON (forge logins) — the fleet's VM runners' pushes, cross-checked against open claims | `[]` | §12.9 |
| `api_keys` | 1 | R-BTN-117 |
| `checks` JSON `{<course>: {name, conclusions}}` | `{}` | R-BTN-114 |
| `leg_log_root` — `s3://…`, `gs://…`, or on the local host `file:///…` | NULL (off) | R-BTN-128 |

### 13.2 Credentials and sign-in

Administrator keys are the host's `BATON_ADMIN_KEYS` value, never a row (R-BTN-57). One role per
key holds across `credentials`, `repository_owners`, `sync_keys` and the administrator set,
checked in the transaction that adds or first accepts a key; a key whose every grant is pending
and never accepted holds no role (§12.1).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `credentials` | `id` (fingerprint; `legacy` *adoption*) | `kind` (`runner` — a machine key; `probe` — an instrument key; `check-runner`; `legacy` *adoption*), `public_key` (an SSH public key or an API key's public line; unique; NULL only for `legacy`), `label`, `hostname` (machine and check-runner keys; unique among live ones), `token_id`, `expires_at`, `last_used_at`, `created_by`, `revoked_at` | Every key but owners', sync keys and administrators' (R-BTN-13, R-BTN-102, R-BTN-117, R-BTN-159) |
| `repository_owners` | `(repository_id, fingerprint)` | `public_key`, `added_by`, `added_at`, `removed_at` | Owner keys (R-BTN-58) |
| `runner_grants` | `(credential_id, repository_id)` | `capabilities` JSON (expanded), `max_tier`, `sync`, `role` (`runner`\|`trusted-runner`, R-BTN-180), `checker` (0/1, only with `trusted-runner`), `domain` (a label, NULL when unset), `set_by` (the credential that set the role, mark and domain, R-BTN-188), `granted_by`, `granted_at`, `accepted_at` (NULL while pending), `revoked_at` | What a machine key may do where (R-BTN-58, R-BTN-146, R-BTN-180) |
| `sync_keys` | `fingerprint` | `repository_id`, `role` (`sync`\|`mirror` *adoption*), `public_key` (unique), `added_by`, `added_at`, `revoked_at` | Sync and mirror keys, one repository each (R-BTN-93) |
| `check_runners` | `(credential_id, repository_id)` | `capabilities` JSON (expanded), `max_tier`, `added_by`, `added_at`, `revoked_at` | Check-runner keys; the row stands in for a grant (R-BTN-114) |
| `registration_tokens` | `id` (of `brt_<id>_<secret>`) | `repository_id`, `secret_hash`, `role` (`runner`), `capabilities` JSON, `max_tier`, `uses_left` (1; ≤ 100), `grant_ttl_s`, `expires_at` (≤ 30 days), `created_by`, `created_at`, `revoked_at` | R-BTN-117, R-BTN-157 |
| `mcp_keys` | `id` (random, never reused; the OAuth spec's §12 row, folded in) | `repository_id`, `name` (unique among live rows of the repository), `key_hash` (unique; NULL for an OAuth grant), `minted_by` (owner fingerprint), `actions` JSON (ids resolved at minting), `expires_at` (≤ 90 days), `last_used_at` (written ≤ once a minute), `revoked_at` | R-BTN-130 |
| `dashboard_sessions` | `id` (of `bds_<id>_<secret>`) | `secret_hash`, `role` (`administrator`\|`owner`), `key_fingerprint`, `repositories` JSON (an owner's: those its key owned at binding), `created_at`, `expires_at` (≤ 4 h), `revoked_at` | Valid while its key holds its role: an administrator's while the key is in the administrator set; an owner's on those `repositories` the key still owns (`repository_owners.removed_at` NULL), and ended when none remains (R-BTN-155) |
| `login_codes` | `id` (of the pending sign-in `bps_<id>_<secret>`) | `pending_hash`, `code_hash`, `role` (`administrator`\|`owner`, from `POST /v1/login`), `client_addr`, `key_fingerprint` (set when bound by that role's route), `created_at`, `expires_at` (+2 min), `bound_at`, `used_at` | R-BTN-155 |
| `action_confirmations` | `code_hash` | `session_id`, `action`, `params` JSON, `created_at`, `expires_at`, `used_at` | A session's action awaiting confirmation by the session's minting key, through `POST /v1/admin/confirm` or `POST /v1/owner/confirm` by its role (R-BTN-155) |
| `request_nonces` | `(key_fingerprint, nonce)` | `seen_at`; pruned after 11 minutes | Replay cache for every signed request (R-BTN-13) |
| `webhook_deliveries` | `delivery_id` | `received_at`; pruned after 24 h | R-BTN-73 |
| `webhook_syncs` | `(repository_id, workflow)` | `last_dispatch_at` — when the path last sent the workflow a dispatch (a delivery's own, the alarm's backstop or a want's); stale for the sync workflow at `last_dispatch_at + 10 minutes`, when the alarm sends one; `window_until` — the end of the 30-second coalescing window the last send opened; `trailing_wanted` — whether a dispatch was wanted inside it, sent at `window_until` as the trailing dispatch | R-BTN-73, R-BTN-94 (B-89) |
| `write_budgets` | `(credential_id, repository_id, day)` | `writes` | Non-upkeep row writes per UTC day (R-BTN-149) |
| `observation_lapses` | `(repository_id, number)` | `credential_id`, `at` | Observation numbers a credential let lapse (R-BTN-150) |

### 13.3 Runners

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `runners` | `id`; unique `(hostname, session_name)` among rows not of kind `legacy` (*adoption*) | `hostname`, `session_name` (1–128), `credential_id`, `secret_hash`, `incarnation` (bumped by a re-key), `harness` (a label), `kind` (`vm`\|`local`\|`cloud`\|`legacy` *adoption*), `isolation` (`attached`\|`process`\|`session`), `profile_json` (opaque), `tier_ceilings` JSON `{repository: tier}`, `delivers` JSON (`["git" | "forge-check"]` from the last heartbeat, R-BTN-171), `lease_timeout_ms` (15 min – 24 h), `settings_hash`, `first_seen_at`, `last_seen_at`, `last_activity_at`, `reaped_at` | One agent session; created at its first heartbeat, never deleted (R-BTN-3, R-BTN-9, R-BTN-14) |
| `runner_capabilities` | `(runner_id, capability)` | `declared` | Declared capabilities, expanded; a repository counts only those its grant admits |
| `runner_tags` | `(runner_id, tag)` | — | R-BTN-60 |
| `runner_courses` | `(runner_id, repository_id, course_id)` | `version` | What its checkouts can run (R-BTN-48) |
| `runner_reports` | `(runner_id, claim_id, key)`; `claim_id` 0 for none | `received_at`, `payload` (opaque) | Latest report per key, ≤ 200 per claim, kept 6 hours after the claim ends (R-BTN-99) |
| `fleet_capabilities` | `(repository_id, capability)` | `runners` | Live granted runners declaring each capability (R-BTN-75) |

### 13.4 The board and tickets

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `board_snapshots` | `(repository_id, sha)` | `parent_sha`, `received_at`, `ticket_count`, `posted_by` | Accepted posts (R-BTN-11, R-BTN-102) |
| `board_head` | `repository_id` | `sha`, `observation`, `last_handed_out`, `observation_holder`, `observation_issued_at`, `observation_renewed_at`, `behind_since` (R-BTN-147), `reset_at` (set by a forced Resync until the next accepted post, R-BTN-11), `fleet_version`, `stations_observation` (the latest accepted snapshot to post stations) | The head and the observation counter (R-BTN-62, R-BTN-150, R-BTN-99); a station row's reading (R-BTN-70) |
| `tickets` | `id` | `repository_id` (home), `local_id` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), `course_id`, `course_json` (opaque), `path`, `title`, `display_json`, `tier`, `expedite`, `parent`, `repos` JSON, `rank`, `check_sha`, `check_head_repo_id`, `check_head_ref`, `snapshot_sha`, `row_hash`, `blocked_since`, `answer_lost` JSON | Filter fields of each live ticket; an accepted snapshot rewrites only rows whose `row_hash` changed (R-BTN-33, R-BTN-77, R-BTN-86, R-BTN-153) |
| `ticket_requires` | `(ticket_id, name)` | — | The ticket's `requires` clause, expanded to capabilities (R-BTN-120) |
| `ticket_depends` | `(ticket_id, leg, ref)`; `leg` `''` for every leg | `on_ticket`, `ref` (`<ticket>@at:<station>,…`, `@reached:…`, `@done` or `@withdrawn`) | Posted `depends_at` entries; index `ticket_dependents` on `on_ticket` (R-BTN-120, R-BTN-132) |
| `ticket_stations` | `ticket_id` | `station`, `path` JSON `[{leg, reached, adopted?}]` (`leg` null on an adopted entry), `path_len`, `to_end`, `next_leg`, `next_source` (`holder`\|`baton`\|`owner`, R-BTN-83), `runs_from` (the `ticket_history` id a person's answer, a route or an adopt restarted the queued leg's run count from; the runs and arrivals after it count, R-BTN-63), `handoff_url`, `snapshot_sha` and `observation` (the snapshot that last changed the row; the latest to show it there is the greater of `observation` and the repository's `stations_observation`) | Where the ticket is: Baton's course history, written by arrivals, settlements, routes and adoption; a snapshot only creates a new ticket's row at `start` (R-BTN-39, R-BTN-70, R-BTN-83, R-BTN-165) |
| `ticket_next_legs` | `(ticket_id, leg)` | `state` (`ready`\|`waiting`), `waiting_on` (a label), `course_json` (opaque), `ready_since`, `waiting_since`, `not_before` | Legs leaving the station (R-BTN-83, R-BTN-89) |
| `ticket_bars` | `(ticket_id, leg, tag)` | — | Tags barred from a leg (R-BTN-60) |
| `ticket_questions` | `ticket_id` | `question_id`, `leg` (the queued person leg), `url`, `severity`, `options` JSON `[{id, reached}]`, `posted_at`, `answered_at`, `answered_by`, `option` | The queued person leg's question and its answer or expiry (R-BTN-116, R-BTN-163) |
| `closed_tickets` | `ticket_id` | `closed_as` (`done`\|`withdrawn`\|`dropped` — dropped with owner state to keep, neither done nor withdrawn), `final_station`, `final_path` JSON, `parent`, `observation`, `closed_at`, `purged_at`, `kept_json` (the ticket's `ticket_overrides` row and `leg_attempts`, kept past the purge) | What a snapshot reported closing or dropped; deleted if the ticket returns, after `kept_json` is restored (R-BTN-10, R-BTN-12, R-BTN-81, R-BTN-86) |
| `leg_queues` | `(repository_id, course_id, leg)` | `depth`, `max_queue` (the bound last judged; NULL until judged) | R-BTN-79 |
| `leg_queue_members` | `ticket_id` | `repository_id`, `course_id`, `leg` | The one queue each unheld ticket, and each `cancelling` ticket, is counted in (R-BTN-79) |
| `unblocked_dispatch` | `repository_id` | `last_sent_at`, `pending_json` (≤ 100 entries and a `truncated` count), `due_at` | The unblocked trigger's 30-second coalescing window, dispatched by Baton (R-BTN-94) |
| `pending_owner_state` | `(repository_id, ticket_id, kind, key)` | `kind` (`override`\|`condition`\|`timer`\|`outbox`\|`station`\|`history`\|`run`), `key` (`''`, the condition id, the timer's `(leg, kind)` or the outbox id), `row_json` | Imported ticket-scoped rows awaiting their ticket's first snapshot (R-BTN-88) |
| `scope_findings` | `id`; one open row per `(repository_id, COALESCE(ticket_id,''), kind, target)` | `ticket_id` (the claim's ticket; NULL for `unclaimed-write`), `claim_id`, `kind` (`scope-exceeded`\|`unclaimed-write`), `target` (the repository or host the action touched), `detail_json` (identifiers only), `raised_at`, `updated_at`, `resolved_at`, `resolved_by` | A leg's actions outside its ticket's scope, as its runner reported them, and a worker push no open claim covers, as the forge delivered it; open until an owner resolves it (§12.9) |

### 13.5 Claims and leg runs

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `claims` | `id` | `ticket_id`, `runner_id`, `request_id` (unique per `runner_id`), `nonce` (6 hex, public), `snapshot_sha`, `station`, `leg`, `start_path` JSON, `claim_observation`, `end_observation`, `claimed_at`, `status` (`active`\|`completed`\|`released`\|`reaped`), `ended_at`, `end_reason`, `end_detail`, `ended_at_sha`, `error_type`, `blocked_kind`, `blocked_ref`, `confirmed_at`, `superseded_at` (R-BTN-168), `fence_pending`, `fence_incarnation`, `fence_deadline` (R-BTN-19), `failed_attempt`, `resume_json`, `deadline_at` (the running leg's deadline, or its re-arm, R-BTN-90), `check_sha`, `advice_json` (the claim's `rationale`, opaque, ≤ 4 KB), `reap_after` *adoption* | The lease, kept forever. `status = 'active'` exactly when `ended_at` is NULL; `confirmed_at` only on `completed` (R-BTN-4, R-BTN-10, R-BTN-90, R-BTN-100, R-BTN-126, R-BTN-153) |
| `adoption_requests` *adoption* | `(claim_id, runner_id)` | `requested_at`, `confirmed_at` | A runner's request to adopt a legacy claim; the confirmation names one request, and every other on the claim is refused when it moves (*adoption*, R-BTN-28) |
| `claim_legs` | `id` | `repository_id`, `ticket_id`, `claim_id` (null for a run an adoption added, R-BTN-39; not exported, claims not being), `seq` (per claim; null with the claim), `leg`, `from_station`, `to_station`, `next_leg`, `head_sha`, `bars` JSON, `session_url`, `leg_log_dir`, `started_at`, `finished_at`, `abandoned_at`, `evidence` | The legs a claim started, on the holder's word, and the runs an adoption added: a ticket's run counts (R-BTN-39, R-BTN-63, R-BTN-84, R-BTN-113, R-BTN-128) |
| `leg_outputs` | `(ticket_id, leg, run, name)` | `schema`, `uri` (≤ 1 KB), `digest`, `value_json` (≤ 4 KB, bounded schemas only), `course_version`, `leg_version`, `claim_id`, `source` (`holder`\|`sync`), `confirmed`, `recorded_at` | Output envelopes, by pointer or bounded inline value (R-BTN-82, R-BTN-108) |
| `leg_run_inputs` | `(claim_id, seq, name)` | `ticket_id`, `from_leg`, `from_run`, `uri`, `digest`, `value_json`, `leg_version` | What each leg run was given; replay reads it (R-BTN-82, R-BTN-84) |
| `transcripts` | `id`; unique `(runner_id, repo, path, claim_id)` | `runner_id`, `claim_id`, `repo`, `path`, `role` (`session`\|`subagent`), `activity_id`, `first_seen_at`, `last_pushed_at` | Archived transcript pointers (R-BTN-20) |
| `activities` | `(runner_id, id)`; unique `(runner_id, call_id)` | `claim_id` (NULL only before a claim), `parent_id`, `call_id`, `kind`, `seq`, `label`, `source` (`skill`\|`hook` — a harness hook), `started_at` (runner clock), `ended_at`, `outcome` (`succeeded`\|`failed`\|`cancelled`\|`abandoned`; set exactly when ended), `received_at`, `detail_json` | The runner's timeline (§9) |
| `attestations` | `id` | `repository_id`, `ticket_id`, `type`, `subject_json`, `value_json` (≤ 4 KB), `writer_class`, `writer_key`, `nonce`, `lapses_at`, `at`, `revoked_at`, `superseded_by` | Typed facts legs require, authenticated by the request that posted them (R-BTN-181, proposal); never imported |
| `webauthn_credentials` | `(owner_key, credential_id)` | `cose_key`, `aaguid`, `attestation`, `registered_by_signature` | Attested authenticators a `human_only` key registered (R-BTN-185, proposal) |

Under §12.8 (proposal), `repository_policies` `(repository_id, version)` holds each policy version (`policy_json`, `hash`, `previous_hash`, `changed_by`, `approver`, `preset`, `at`; append-only) (R-BTN-188, R-BTN-189), the `floors` list a field of `policy_json`; grants carry `role`, `domain` and `set_by` (R-BTN-180, §13.2); owner keys gain `human_only` and `fido_attestation`.
| `ticket_history` | `id` | `repository_id`, `ticket_id`, `at`, `kind`, `claim_id`, `runner_id`, `leg`, `reached`, `next_leg`, `run`, `snapshot_sha`, `head_sha`, `course_version`, `leg_version`, `detail_json` (≤ 2 KB) | The ticket's running record and course history (R-BTN-39, R-BTN-81) |

`ticket_history.kind`: `leg-started`, `leg-finished`, `leg-abandoned`, `position-confirmed`,
`fact-arrival`, `arrival-unapplied`, `history-adopted`, `re-routed`, `blocked`, `unblocked`,
`question-posted`, `question-answered`, `question-expired`, `condition`, `call-settled`,
`superseded`, `outbox`, `inputs`, `outputs`, `spawned`, `discrepancy` (its sub in `detail_json`, R-BTN-85).

### 13.6 Prerequisites, overrides, conditions and timers

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `ticket_blocks` | `(ticket_id, kind, ref, leg)`; `leg` `''` for the whole ticket | `repository_id`, `kind` (`ticket`\|`capability`\|`resource`\|`retry`\|`condition`\|`call`\|`attestation`), `ref`, `since`, `until`, `provisional` (the commit a runner-written row waits for), `found` (`before-start`\|`during-run`), `binds` (`gate`\|`advice`; set for `resource` and `attestation` rows from their requirement, R-BTN-181) | Each unmet prerequisite, maintained, never recomputed on read (R-BTN-75, R-BTN-120, R-BTN-126) |
| `leg_needs` | `(ticket_id, leg, resource)` | `repository_id`, `source` (`posted`\|`end`), `added_at`, `found_at` | Resources a next leg needs; an `end` need is never removed by a post (R-BTN-76, R-BTN-126) |
| `leg_attempts` | `(ticket_id, leg)` | `repository_id`, `attempts`, `retry_after`, `last_error_type` | Retry state per ticket and leg; reset when the leg reaches an outcome or a hold is lifted (R-BTN-122) |
| `ticket_overrides` | `ticket_id` | `expedite`, `hold`, `hold_reason` (`owner`\|`attempts-exhausted`\|`non-retryable:<class>`\|`blocked-exhausted`\|`parked`\|`outbox-refused`\|`scope-exceeded`\|`mcp:<name>`), `cancelling_at` (set by a cancellation, cleared at the close, never in `kept_json`, R-BTN-168), `route_leg`, `route_station`, `override_kind` (`owner`\|`baton`), `set_by`, `set_at` | Expedite, hold and cancellation (§6); the queued leg Baton or the owner chose, held until the station changes — an owner's route, retry's `exhausted` leg, a person leg's expiry, the `cancel` leg (R-BTN-12, R-BTN-83, R-BTN-116, R-BTN-122, R-BTN-168) |
| `owner_bars` | `id` | `repository_id`, `course` (an id or `*`), `tag`, `legs` JSON, `applies` (`claim`\|`claim+advance`), `starts_at`, `ends_at`, `release_holders`, `reason` (`^[a-z][a-z0-9-]{0,39}$`), `set_by`, `lifted_at` | R-BTN-67 |
| `conditions` | `id` | `repository_id`, `ticket_id` (NULL for a repository's), `ref` (what a core condition is about: a runner, an instance, `<course>:<leg>`, a question id), `claim_id`, `leg`, `run`, `type`, `disposition` (`interrupt`\|`suspend`\|`notify`), `handler` (the handler ticket), `restarts` JSON, `default`, `severity` (`critical`\|`high`\|`normal`), `url`, `detail` JSON (a core condition's identifiers and numbers), `raised_at`, `closed_at`, `outcome`, `restart`, `reason`, `answered_by` (the answer's, or an owner's credential), `consumed_at` (an end of the raiser's claim consumed the restart, R-BTN-162) | Raised conditions, filter fields only; indexed open by repository, and by `handler`; an open core condition is unique on `(repository_id, type, ticket_id, ref)` (R-BTN-160, R-BTN-162, R-BTN-163) |
| `ticket_timers` | `(ticket_id, leg, kind)`; `kind` `stalled`\|`expires` | `repository_id`, `from_at`, `due_at`, `fired_at` | The instants Baton holds per leg; each fires once per `from_at`; renamed with their leg (R-BTN-64, R-BTN-116, R-BTN-167) |

### 13.7 Resources

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `external_resources` | `name` | `scope` (`account`\|`service`), `detail_schema` (≤ 4 KB) | R-BTN-76 |
| `resource_instances` | `name` | `repositories` JSON (an `account` instance's) | Registered instances (R-BTN-76) |
| `capability_capacity` | `capability` | `capacity` (1–64), `set_by`, `set_at` | The tenant's capacities (R-BTN-178) |
| `claim_seats` | `(claim_id, capability)` | — | The seats a claim holds for the leg it started, written at the claim and each `advance` from rule 4's matched set, deleted at its end, or for a fence-pending reap at `fence-cleared` or `fence_deadline` (R-BTN-178) |
| `instance_serves` | `(instance, resource)` | — | What each instance serves, many to many (R-BTN-76) |
| `instance_readings` | `(instance, source, kind)` | `kind` (`state`\|`measure`), `available` (set exactly for `state`), `until`, `observed_at`, `lapses_at`, `detail`, `posted_by`, `writer` (R-BTN-181's class); `source` `admin`, `runner:<id>` or `probe:<fp>` | Every instrument's latest reading, an administrator's among them (R-BTN-101, R-BTN-151) |
| `instance_states` | `instance` | `state` (`available`\|`unavailable`\|`unknown`), `until`, `changed_at` | Last evaluated state; a change is one `resource` event and one recount (R-BTN-76) |
| `resource_fleet` | `(repository_id, resource)` | `usable_instances`, `open_instances` (not `unavailable`), `live_runner` (0/1: a live runner granted on the repository) | Blocked when `live_runner` = 1, usable > 0 and open = 0 (R-BTN-76) |

### 13.8 Events, messages and the outbox

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `events` | `seq` (the mirror's cursor, *adoption*) | `at`, `repository_id` (NULL for a tenant event), `kind`, `ticket_id`, `claim_id`, `actor`, `detail_json` | The append-only log the dashboard and the mirror (*adoption*) read |
| `messages` | `id` | `kind` (`release`\|`status_request`\|`status_report`\|`unblocked`\|`handled`\|`wind-down`), `payload_json`, `from_runner_id`, `from_principal`, `to_runner_id`, `in_reply_to`, `sent_at`, `delivered_at`, `acknowledged_at`, `status` (`pending`\|`delivered`\|`acknowledged`\|`expired`) | Messages to runners (§6, R-BTN-162, B-109) |
| `outbox` | `(repository_id, id)`; `id` increasing per repository | `ticket_id` (the ticket to withdraw, or the check ticket), `kind` (`withdraw`\|`forge-check`), `fields` JSON (identifiers only, and a `forge-check`'s `summary`; the deliverer renders the effect from them), `state` (`queued`\|`claimed`\|`delivered`\|`confirmed`\|`dropped`), `credential_id` (the deliverer while `claimed`), `attempts`, `not_before` (backoff, lease end, or deletion), `queued_at`, `delivered_ref` (a commit or a `check_id`), `confirmed_at`, `snapshots_since_delivered` | Every git write and check run Baton intends, delivered by runners (R-BTN-171, R-BTN-115) |

`events.kind`: `claimed`, `advanced`, `completed`, `confirmed`, `released`, `reaped`,
`fence-cleared`, `rekeyed`, `override`, `held`, `attempts-exhausted`, `leg-timeout`,
`snapshot-accepted`, `snapshot-rejected`, `advice-overridden`, `arrival-unapplied`,
`history-adopted`, `bars-mismatch`, `blocked`, `unblocked`, `resource`, `discrepancy`, `condition`,
`question-posted`, `question-answered`, `question-expired`, `question-dropped`, `answer-invalid`, `call-settled`,
`superseded`, `course-closed`, `course-opened`, `capacity`,
`parent-invalid`, `not-before-invalid`, `output-unclaimed`, `reading-refused`, `invalid-pointer`,
`scope-exceeded`, `unclaimed-write`,
`admin` (its act in `detail.action`), `frozen`, `unfrozen`, `sealed`, `imported`; *adoption:* `adopted`, `cutover`, `shadow-conflict`,
`foreign-claim`.

**Indexes that rules depend on.** `one_active_claim_per_ticket`; `one_active_claim_per_runner`;
`claims_unconfirmed` (completed, unconfirmed); claims by `(ticket_id, leg, ended_at)` for blocked
ends (R-BTN-126); `closed_unpurged`; `tickets_blocked`, `tickets_by_parent`, `tickets_by_rank`;
`requires_by_name`; `blocks_by_ref` `(repository_id, kind, ref)`; `ticket_dependents`;
`ticket_next_legs_due` (`not_before` where waiting on `time`); `needs_by_resource`;
`serves_by_resource`;
`readings_lapse`; `timers_due` (`due_at` where not fired); `outbox_due`
`(credential_id, state, not_before)` and `outbox_alarm` `(state, not_before)`; conditions open
by repository and by handler; `outbox_pending` `(repository_id, ticket_id, id)` where not `confirmed` or `dropped`; `history_by_ticket`; `events_by_repository` `(repository_id, seq)`.

**Where the alarm's instants live** (§2 owns what each does): `ticket_timers.due_at`;
`ticket_next_legs.not_before`; `ticket_blocks.until` of `retry` rows; `claims.deadline_at`;
`claims.ended_at` + 6 h of an unconfirmed completion (`baton.unconfirmed`); lease
expiry from `runners.last_seen_at` and `lease_timeout_ms`, for every runner but a `legacy` one,
whose claim ends only at `claims.reap_after` (*adoption*); `claims.fence_deadline`, and
`claims.ended_at` + 30 min of a fence still pending (`baton.fence-pending`); `messages.delivered_at` of an
unacknowledged `release` + 2 h (15 min for `leg-timeout`); `owner_bars.starts_at` and `ends_at`;
`instance_readings.lapses_at`; `outbox.not_before`; `unblocked_dispatch.due_at`, `webhook_syncs.window_until` where `trailing_wanted`, and `webhook_syncs.last_dispatch_at` + 10 min (R-BTN-73, R-BTN-94);
`board_head.behind_since` + 30 min (`baton.head-behind`); `repositories.sync_wanted_at` + 30 min (`baton.sync-late`);
`outbox.queued_at` + 24 h, or + 15 min for an undelivered `forge-check` (`baton.outbox-late`); and `closed_tickets.closed_at` + 90 days.

