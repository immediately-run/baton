---
title: "13. Data model"
description: "One SQLite database per tenant, in the tenant's Durable Object (or the local host's file)."
---
## 13. Data model *(proposal)*

One SQLite database per tenant, in the tenant's Durable Object (or the local host's file).
The numbered, append-only migrations in `src/migrations/` reach the schema, each new one's
number from R-BTN-199's sequence, and the object refuses to serve until every migration is
applied (§2). A cell here says what a table or column is and cites the rule that owns its
behaviour, bounds and defaults. The tables of designs not built yet are in
[the data model and API proposal](../proposals/data-model-and-api.md).

**Conventions.**

- Times are integer UTC epoch milliseconds (`*_at`, `since`, `until`, `not_before`, `due_at`).
- Columns marked JSON hold JSON text; flags are integers 0/1. Free text is validated on write
  (§12); opaque course blobs are size-capped and never read by core.
- `ticket_id` is always the qualified id `<repository>:<local id>`; `repository_id` is
  `repositories.id`; `credential_id` and `fingerprint` are a key's fingerprint (`SHA256:…` for an
  SSH key, `bak_<id>` for an API key); `runner_id` and `claim_id` are integers.
- An actor column (`set_by`, `added_by`, `granted_by`, `created_by`, `actor`) holds
  `admin:<fp>`, `owner:<fp>`, `runner:<id>`, `runner:<fp>` (a runner key with no runner session
  behind the call), `sync`, `alarm` (or `alarm:<reason>`, e.g. `alarm:leg-timeout`) or `server`.
- When a ticket leaves the board (closed or dropped), exactly its board rows are deleted:
  `tickets`, `ticket_requires`, `ticket_depends`, `ticket_stations`, `ticket_next_legs`,
  `ticket_bars`, `ticket_questions`, `leg_queue_members`, `ticket_blocks` and `leg_needs`, and
  the rows derived from them. Its
  `ticket_overrides` row and `leg_attempts` move into `closed_tickets.kept_json` (R-BTN-12).
  Every other row naming it is kept (R-BTN-63, R-BTN-81).
- Nothing below holds an item body, note, exit criterion or PR list (R-BTN-33).
- A uniqueness a rule depends on is in its table's Key cell. Read-path indexes are the
  migrations'. A rebuild of `events` recreates every index on it.

### 13.1 Repositories, courses and tenant settings

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `repositories` | `id`. Unique among live rows: `(forge, forge_host, forge_repo_id)`, and the forge path | `github` (the forge path, case-insensitive; `~retired/<id>` on a retired row), `forge`, `remote`, `web_base`, `forge_host`, `forge_repo_id`, `forge_owner_id` (decimal strings), `forge_ids_seen` JSON (`{mismatch}`), `former_paths` JSON, `ci_identity` JSON, `dispatch` JSON, `default_branch`, `sync_workflow`, `sync_wanted_at`, `sync_wanted_after`, `weight`, `tiers` JSON (lowest first), `protection_json` (`{matched, reading_hash, at, runner_id}`), `retired_at`, and the owner settings below | A registered repository (R-BTN-47, R-BTN-92, R-BTN-93, R-BTN-94, R-BTN-138); the protection checker's last report (R-BTN-180) |
| `courses` | `(repository_id, id)` | `version`, `skill`, `course_json` (the validated course file), `leg_capabilities_json` (each leg id → the capabilities its `requires` names, roles expanded; written in the statement that writes the file), `step_kinds` JSON, `min_runner_version`, `branch_pattern`, `previous_branch_pattern` | Each course as the last accepted snapshot posted it (R-BTN-48, R-BTN-69, R-BTN-121, R-BTN-134); `course_legs` and `course_leg_capabilities` are derived from it |
| `course_legs` | `(repository_id, course_id, leg)` | `person` (0/1) | Each course's legs, derived from `courses` in the statement that writes it; what matching reads (§6.6, R-BTN-116) |
| `course_leg_capabilities` | `(repository_id, course_id, leg, capability)` | — | Each leg's required capabilities, derived the same way (§6.6 rule 4, R-BTN-120) |
| `course_schemas` | `(repository_id, id)`, `id` = `<course>:<name>@<n>` | `course_id`, `digest`, `schema_json`, `snapshot_sha`, `posted_at` | Named schemas, immutable (R-BTN-108) |
| `baton_settings` | `key` | `value`. Keys: `tenant_id` (R-BTN-135), `frozen_at`, `sealed_at` (R-BTN-88), `retention_runners` (R-BTN-149) | Tenant state |
| `instance_settings` | one row | `link_hosts` JSON, `session_hosts` JSON, `recommended_client` (NULL for the code's default), `check_app_id` | Administrator settings (R-BTN-112, R-BTN-113, R-BTN-115, R-BTN-197, §12.7) |

**Owner settings** — columns of `repositories`, written by `PUT /v1/owner/{repository}/settings`
(R-BTN-66); the administrator sets `weight` and `tiers` at registration.

| Setting | Default | Rule |
|---|---|---|
| `transcript_repos` JSON | `[]` | R-BTN-20 |
| `artifact_buckets` JSON | `[]` | R-BTN-82 |
| `retry` JSON | NULL (core defaults) | R-BTN-122 |
| `required_bars` JSON `[{course, leg, except?, tag_prefix}]` | `[]` | R-BTN-67 |
| `unblocked_trigger` JSON (the `dispatch` shape) | NULL | R-BTN-77, R-BTN-94 |
| `pushers` JSON (forge user ids) | `[]` | R-BTN-139 |
| `code_repos` JSON `[{path, repo_id, former_paths}]` | `[]` | R-BTN-140 |
| `scope_policy` (`report`\|`hold`) | `report` | §12.9 |
| `runner_pushers` JSON (forge logins) | NULL; NULL and `[]` both mean no pushers | §12.9 |
| `api_keys` | 1 | R-BTN-117 |
| `checks` JSON `{<course>: {name, conclusions}}` | `{}` | R-BTN-114 |
| `leg_log_root` | NULL (off) | R-BTN-128 |

### 13.2 Credentials and sign-in

Administrator keys are the host's `BATON_ADMIN_KEYS` value, never a row (R-BTN-57). One role per
key holds across `credentials`, `repository_owners`, `sync_keys` and the administrator set,
checked in the transaction that adds or first accepts a key (§12.1).

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `credentials` | `id` (fingerprint) | `kind` (`runner` — a machine key; `probe` — an instrument key), `public_key` (an SSH public key or an API key's public line; unique), `label`, `hostname` (machine keys; unique among live ones), `expires_at`, `last_used_at`, `created_by`, `revoked_at` | Every key but owners', sync keys and administrators' (R-BTN-13, R-BTN-102, R-BTN-117, R-BTN-159) |
| `repository_owners` | `(repository_id, fingerprint)` | `public_key`, `human_only`, `fido_attestation`, `added_by`, `added_at`, `removed_at` | Owner keys (R-BTN-58, R-BTN-185) |
| `runner_grants` | `(credential_id, repository_id)` | `capabilities` JSON (expanded), `max_tier`, `sync`, `role`, `checker` (0/1), `domain` (a label; NULL when unset), `max_claims`, `set_by` (the credential that set the role, mark and domain), `granted_by`, `granted_at`, `accepted_at` (NULL while pending), `revoked_at` | What a machine key may do where (R-BTN-4, R-BTN-58, R-BTN-146, R-BTN-180, R-BTN-188) |
| `grant_capabilities` | `(credential_id, repository_id, capability_pattern)` | — | A grant's capabilities as rows, derived from `runner_grants.capabilities` in the statement that writes it (§6.6 rule 4) |
| `sync_keys` | `fingerprint` | `repository_id`, `role`, `public_key` (unique), `added_by`, `added_at`, `revoked_at` | Sync keys, one repository each (R-BTN-93) |
| `repository_policies` | `(repository_id, version)` | `policy_json` (its `floors` list a field), `hash`, `previous_hash`, `changed_by`, `approver`, `preset`, `at` | Each policy version, append-only (R-BTN-188, R-BTN-189) |
| `dashboard_sessions` | `id_hash` (SHA-256 of the cookie value) | `admin_key`, `access_email_hash` (SHA-256 of the Access email; NULL for a link's session), `created_at`, `expires_at`, `revoked_at` | A dashboard session (R-BTN-155) |
| `login_links` | `token_hash` (SHA-256 of the link's token) | `admin_key`, `expires_at`, `used_at` | A one-time sign-in link (R-BTN-155) |
| `request_nonces` | `(key_fingerprint, nonce)` | `seen_at` | Replay cache for every signed request (R-BTN-13) |
| `webhook_deliveries` | `delivery_id` | `received_at` | Deliveries seen (R-BTN-73) |
| `push_deliveries` | `delivery_id` | `repository` (forge path, lowercase), `ref` (`refs/heads/<branch>`), `before_sha`, `after_sha`, `sender_id` (NULL when none came), `sender_login`, `commits_json` `[{sha, paths}]`, `truncated` | A push delivery's record (R-BTN-73), read by R-BTN-194's provenance |
| `webhook_syncs` | `(repository_id, workflow)` | `last_dispatch_at`, `window_until`, `trailing_wanted` | When the webhook path last dispatched the workflow, and its coalescing window (R-BTN-73, R-BTN-94) |

### 13.3 Runners

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `runners` | `id`; unique `(hostname, session_name)` | `hostname`, `session_name`, `credential_id`, `secret_hash`, `incarnation` (bumped by a re-key), `harness` (a label), `kind`, `executor_json` (the last heartbeat's `executor`; NULL for a sidecar), `profile_json` (opaque), `tier_ceilings` JSON `{repository: tier}`, `lease_timeout_ms`, `concurrency`, `settings_hash`, `client_version`, `legacy_names_at` (the last accepted use of a retired wire spelling; NULL if none), `first_seen_at`, `last_seen_at`, `last_activity_at`, `reaped_at` | One agent session; created at its first heartbeat, never deleted (R-BTN-3, R-BTN-4, R-BTN-9, R-BTN-14, R-BTN-107, R-BTN-197) |
| `runner_capabilities` | `(runner_id, capability)` | `declared`, `provided` | Declared capabilities, expanded, and the executor's (R-BTN-107, R-BTN-121) |
| `runner_tags` | `(runner_id, tag)` | — | R-BTN-60 |
| `runner_courses` | `(runner_id, repository_id, course_id)` | `version` | What its checkouts can run (R-BTN-48) |
| `fleet_capabilities` | `(repository_id, capability)` | `runners` | Live granted runners declaring each capability (R-BTN-75) |

### 13.4 The board and tickets

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `board_snapshots` | `(repository_id, sha)` | `parent_sha`, `received_at`, `ticket_count`, `posted_by` | Accepted posts (R-BTN-11, R-BTN-102) |
| `board_head` | `repository_id` | `sha`, `observation`, `last_handed_out`, `observation_issued_at`, `stations_observation` (the latest accepted snapshot to post stations), `source_kind`, `source_versions` (the last accepted post's ticket-source declaration) | The head and the observation counter (R-BTN-11, R-BTN-62, R-BTN-70, R-BTN-74, R-BTN-150) |
| `held_snapshots` | (`repository_id`, `sha`) | `parent_sha`, `head_sha`, `ticket_count`, `received_at`, `auto_accept_at`, `observation`, `accepted_at` | A `force` post held for the owner (R-BTN-11) |
| `sync_fingerprints` | `repository_id` | `digest`, `scheduling_v` | The last accepted snapshot's fingerprint and the scheduling version it was materialized at (§4.3, R-BTN-196); derived, and moves no version |
| `sequences` | `(repository_id, kind)` | `last_number` | The identifier sequences; `kind` is opaque to core (R-BTN-199) |
| `tickets` | `id` | `repository_id` (home), `local_id`, `course_id`, `course_json` (opaque), `path`, `title`, `display_json`, `tier`, `expedite`, `parent`, `repos` JSON, `rank`, `snapshot_sha`, `row_hash`, `blocked_since`, `answer_lost` JSON, `version` (`''` when the source posts none), `key` (default the `path`), `last_written_by` JSON `{pusher, pusher_id?, commit, at, human}` | Filter fields of each live ticket; an accepted snapshot rewrites only rows whose `row_hash` changed. `version` and `key` are inputs of `row_hash`; `last_written_by` is Baton's own record and is not (R-BTN-33, R-BTN-77, R-BTN-86, R-BTN-194) |
| `ticket_requires` | `(ticket_id, name)` | — | The ticket's `requires` clause, expanded (R-BTN-120) |
| `ticket_depends` | `(ticket_id, leg, ref)`; `leg` `''` for every leg | `on_ticket`, `ref` | Posted `depends_at` entries (R-BTN-120, R-BTN-132) |
| `ticket_repositories` | `(ticket_id, repository_key)` | `repository_key` (lowercase) | The repositories a ticket names, derived from `tickets.repos` in the statement that writes it |
| `ticket_stations` | `ticket_id` | `station`, `path` JSON `[{leg, reached, adopted?}]`, `path_len`, `to_end`, `next_leg`, `next_source`, `runs_from` (the `ticket_history` id the queued leg's run count restarts from), `handoff_url`, `snapshot_sha`, `observation` (the snapshot that last changed the row) | Where the ticket is: Baton's course history (R-BTN-39, R-BTN-63, R-BTN-70, R-BTN-83, R-BTN-165) |
| `ticket_next_legs` | `(ticket_id, leg)` | `state` (`ready`\|`waiting`), `waiting_on` (a label), `course_json` (opaque), `ready_since`, `waiting_since`, `not_before` | Legs leaving the station (R-BTN-83, R-BTN-89) |
| `ready_tickets` | `ticket_id` | `repository_id`, `course_id`, `leg` (the queued leg), `expedite`, `to_end`, `rank`, `ready_since`, `tier_position`, `retry_after`, `last_end_observation` | The candidate projection matching reads (§6.6): one row per ticket whose queued leg is `ready`, with no hold, no claim rule 3 counts and no ticket or decision block on it. The view `ready_ticket_source` defines membership; triggers refresh a ticket's row in the transaction that changes a source row, and a rebuild reads the same view. Backoff and observation freshness are compared at read time |
| `ticket_bars` | `(ticket_id, leg, tag)` | — | Tags barred from a leg (R-BTN-60) |
| `ticket_questions` | `ticket_id` | `question_id`, `leg`, `url`, `severity`, `options` JSON `[{id, reached}]`, `posted_at`, `answered_at`, `answered_by`, `option` | The queued person leg's question and its answer or expiry (R-BTN-116, R-BTN-163) |
| `closed_tickets` | `ticket_id` | `closed_as` (`done`\|`withdrawn`\|`dropped`), `final_station`, `final_path` JSON, `parent`, `observation`, `closed_at`, `purged_at`, `claims_due_at` (NULL once its claims are pruned), `kept_json` (kept past the purge) | What a snapshot reported closed or dropped; deleted if the ticket returns, after `kept_json` is restored (R-BTN-10, R-BTN-12, R-BTN-81, R-BTN-86, R-BTN-149) |
| `leg_queues` | `(repository_id, course_id, leg)` | `depth`, `max_queue` (NULL until judged) | R-BTN-79 |
| `leg_queue_members` | `ticket_id` | `repository_id`, `course_id`, `leg` | The one queue a ticket is counted in (R-BTN-79) |
| `unblocked_dispatch` | `repository_id` | `last_sent_at`, `pending_json`, `due_at` | The unblocked trigger's coalescing window (R-BTN-94) |
| `pending_owner_state` | `(repository_id, ticket_id, kind, key)` | `kind` (`override`\|`condition`\|`timer`\|`outbox`\|`station`\|`history`\|`run`), `key` (`''`, or the row's own id within its kind), `row_json` | Imported ticket-scoped rows awaiting their ticket's first snapshot (R-BTN-88) |
| `scope_findings` | `id`; one open row per `(repository_id, COALESCE(ticket_id,''), kind, target)` | `ticket_id` (NULL for `unclaimed-write`), `claim_id`, `kind` (`scope-exceeded`\|`unclaimed-write`), `target`, `detail_json` (identifiers only), `raised_at`, `updated_at`, `resolved_at`, `resolved_by` (the owner's credential, or `baton`) | Scope findings (§12.9) |

### 13.5 Claims and leg runs

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `claims` | `id`; one `active` row per ticket; `request_id` unique per `runner_id` | `ticket_id`, `runner_id`, `request_id`, `nonce` (public), `snapshot_sha`, `station`, `leg`, `start_path` JSON, `claim_observation`, `end_observation`, `claimed_at`, `status` (`active`\|`completed`\|`released`\|`reaped`), `ended_at`, `end_reason`, `end_detail`, `ended_at_sha`, `error_type`, `blocked_kind`, `blocked_ref`, `confirmed_at`, `fence_pending`, `fence_incarnation`, `fence_deadline`, `failed_attempt`, `resume_json`, `deadline_at`, `advice_json` (Baton's advice at the claim, opaque) | The lease. `status = 'active'` exactly when `ended_at` is NULL; `confirmed_at` only on `completed` (R-BTN-4, R-BTN-10, R-BTN-19, R-BTN-90, R-BTN-100, R-BTN-126) |
| `claim_legs` | `id`; `run_id` unique | `repository_id`, `ticket_id`, `claim_id` (NULL for a run an adoption added; not exported), `seq` (per claim; NULL with the claim), `run_id`, `domain` (the grant's domain at the run's start), `leg`, `from_station`, `to_station`, `next_leg`, `head_sha`, `bars` JSON, `session_url`, `leg_log_dir`, `started_at`, `finished_at`, `abandoned_at`, `evidence` | The legs a claim started, on the holder's word, and the runs an adoption added: a ticket's run counts (R-BTN-39, R-BTN-63, R-BTN-84, R-BTN-113, R-BTN-128) |
| `leg_outputs` | `(ticket_id, leg, run, name)` | `schema`, `uri`, `digest`, `value_json`, `course_version`, `leg_version`, `claim_id`, `source` (`holder`\|`sync`), `confirmed`, `recorded_at` | Output envelopes, by pointer or bounded inline value (R-BTN-82, R-BTN-108) |
| `leg_run_inputs` | `(claim_id, seq, name)` | `ticket_id`, `from_leg`, `from_run`, `uri`, `digest`, `value_json`, `leg_version` | What each leg run was given; replay reads it (R-BTN-82, R-BTN-84) |
| `transcripts` | `id`; unique `(runner_id, repo, path, claim_id)` | `runner_id`, `claim_id`, `repo`, `path`, `role` (`session`\|`subagent`), `activity_id`, `first_seen_at`, `last_pushed_at` | Archived transcript pointers (R-BTN-20) |
| `activities` | `(runner_id, id)`; unique `(runner_id, call_id)` | `claim_id` (NULL only before a claim), `parent_id`, `call_id`, `kind`, `seq`, `label`, `source` (`skill`\|`hook`), `started_at` (runner clock), `ended_at`, `outcome` (set exactly when ended), `received_at`, `detail_json` | The runner's timeline (§9) |
| `ticket_history` | `id` | `repository_id`, `ticket_id`, `at`, `kind`, `claim_id`, `runner_id`, `leg`, `reached`, `next_leg`, `run`, `run_id`, `snapshot_sha`, `head_sha`, `course_version`, `leg_version`, `detail_json` | The ticket's running record and course history (R-BTN-39, R-BTN-81) |

`ticket_history.kind` is one of `leg-started`, `leg-finished`, `leg-abandoned`,
`position-confirmed`, `fact-arrival`, `reconcile-queued`, `re-routed`, `inputs`, `outputs`, `spawned`,
or one of the event kinds §13.8 marks as history rows.

### 13.6 Prerequisites, overrides, conditions and timers

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `ticket_blocks` | `(ticket_id, kind, ref, leg)`; `leg` `''` for the whole ticket | `repository_id`, `kind`, `ref`, `since`, `until`, `provisional` (the commit a runner-written row waits for), `found` (`before-start`\|`during-run`), `binds` (`gate`\|`advice`) | Each unmet prerequisite, maintained, never recomputed on read (R-BTN-75, R-BTN-120, R-BTN-126) |
| `leg_needs` | `(ticket_id, leg, resource)` | `repository_id`, `source` (`posted`\|`end`), `added_at`, `found_at` | Resources a next leg needs (R-BTN-76, R-BTN-126) |
| `leg_attempts` | `(ticket_id, leg)` | `repository_id`, `attempts`, `retry_after`, `last_error_type` | Retry state per ticket and leg (R-BTN-122) |
| `ticket_overrides` | `ticket_id` | `expedite`, `hold`, `hold_reason`, `route_leg`, `route_station`, `override_kind` (`owner`\|`baton`), `set_by`, `set_at` | Expedite and hold (§6), and the queued leg Baton or the owner chose, held until the station changes (R-BTN-12, R-BTN-83, R-BTN-116, R-BTN-122) |
| `ticket_evidence` | `(ticket_id, ref)` | `kind` (`merged-early`, `mention`, `fact`), `leg` (for `fact`), `found_at`, `claim_id` (the reconcile leg's claim that carried it), `weighed_at` (NULL until that leg's finishing position) | Evidence of work done outside Baton (R-BTN-203, R-BTN-39) |
| `reconcile_displaced` | `ticket_id` | `leg`, `queued_at` | The leg a queued reconcile leg displaced; cleared by its finishing position (R-BTN-39) |
| `owner_bars` | `id` | `repository_id`, `course` (an id or `*`), `tag`, `legs` JSON, `applies` (`claim`\|`claim+advance`), `starts_at`, `ends_at`, `release_holders`, `reason`, `set_by`, `lifted_at` | R-BTN-67 |
| `conditions` | `id`; an open core condition is unique on `(repository_id, type, ticket_id, ref)` | `repository_id`, `ticket_id` (NULL for a repository's), `ref` (what a core condition is about), `claim_id`, `leg`, `run`, `type`, `disposition`, `restarts` JSON, `default`, `severity`, `url`, `detail` JSON (a core condition's identifiers and numbers), `raised_at`, `closed_at`, `outcome`, `restart`, `reason`, `answered_by` | Raised conditions, filter fields only (R-BTN-160, R-BTN-163, R-BTN-195) |

Timers are not built: `ticket_timers` is in
[the proposal](../proposals/data-model-and-api.md#timers).

### 13.7 Resources

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `external_resources` | `name` | `scope` (`account`\|`service`), `detail_schema` | R-BTN-76 |
| `resource_instances` | `name` | `repositories` JSON (an `account` instance's) | Registered instances (R-BTN-76) |
| `capability_capacity` | `capability` | `capacity`, `set_by`, `set_at` | The tenant's capacities (R-BTN-178) |
| `claim_seats` | `(claim_id, capability)` | — | The seats a claim holds for the leg it started (R-BTN-178) |
| `instance_serves` | `(instance, resource)` | — | What each instance serves, many to many (R-BTN-76) |
| `instance_readings` | `(instance, source, kind)`; `source` is `admin`, `runner:<id>` or `probe:<fp>` | `kind` (`state`\|`measure`), `available` (set exactly for `state`), `until`, `observed_at`, `lapses_at`, `detail`, `posted_by`, `writer` | Every instrument's latest reading, an administrator's among them (R-BTN-101, R-BTN-151, R-BTN-181) |
| `instance_states` | `instance` | `state` (`available`\|`unavailable`\|`unknown`), `until`, `changed_at` | Last evaluated state (R-BTN-76) |
| `resource_fleet` | `(repository_id, resource)` | `usable_instances`, `open_instances` (not `unavailable`), `live_runner` (0/1) | The counts R-BTN-76's block reads |

### 13.8 Events, messages and the outbox

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `events` | `seq` | `at`, `repository_id` (NULL for a tenant event), `kind`, `ticket_id`, `claim_id`, `actor`, `detail_json` | The append-only log the dashboard reads |
| `messages` | `id` | `kind` (`release`\|`status_request`\|`status_report`\|`unblocked`\|`wind-down`), `payload_json`, `from_runner_id`, `from_principal`, `to_runner_id`, `in_reply_to`, `sent_at`, `delivered_at`, `acknowledged_at`, `status` (`pending`\|`delivered`\|`acknowledged`\|`expired`) | Messages to runners (§6) |
| `state_version` | one row | `v` (the state version), `scheduling_v`, `board_v`, `activity_v` | R-BTN-196's versions |

`events.kind`: `claimed`, `advanced`, `completed`, `confirmed`, `released`, `reaped`,
`fence-cleared`, `rekeyed`, `override`, `held`, `attempts-exhausted`, `leg-timeout`,
`snapshot-accepted`, `snapshot-rejected`, `advice-overridden`, `bars-mismatch`, `resource`,
`question-dropped`, `answer-invalid`, `course-closed`, `course-opened`, `capacity`,
`parent-invalid`, `not-before-invalid`, `output-unclaimed`, `reading-refused`, `invalid-pointer`,
`scope-exceeded`, `unclaimed-write`, `scope-invalid`, `scope-resolved`,
`admin` (its act in `detail.action`), `frozen`, `unfrozen`, `sealed`, `imported`, `sequence`
(R-BTN-199); and these, each also a `ticket_history` row: `arrival-unapplied`, `blocked`,
`unblocked`, `question-posted`, `question-answered`, `question-expired`, `condition`,
`discrepancy` (its sub in `detail_json`, R-BTN-85).

The outbox is not built: its table is in
[the proposal](../proposals/data-model-and-api.md#the-outbox).

**The alarm's instants** are §2's clock table and the rules it cites; each is read from the
column above that holds it.

**Legacy, removed with its code (R-BTN-193).** The mirror and the cutover (§16) add: to
`repositories`, `mirror_workflow`, `mirror_acked_seq` and `cutover_at`; the
`credentials` row and kind `legacy` (its `public_key` NULL); the `sync_keys.role` `mirror`; the
`runners.kind` `legacy`, whose rows are outside the `(hostname, session_name)` uniqueness;
`claims.reap_after`, the only instant a legacy runner's claim ends at; the table
`adoption_requests`, key `(claim_id, runner_id)`, columns `requested_at`, `confirmed_at` (R-BTN-28);
`events.seq` as the mirror's cursor; and the event kinds `adopted`, `cutover`, `shadow-conflict`
and `foreign-claim`.
