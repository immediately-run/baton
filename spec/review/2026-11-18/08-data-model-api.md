---
title: "Adversarial review 2026-11-18 — §13–§14: data model and API"
description: "One reviewer's findings, as filed, reconciling BATON_SPEC §13 and §14 with the rules."
order: 17
tags: [review]
---

# Adversarial review 2026-11-18 — §13–§14: data model and API

Paths are relative to `spec/BATON_SPEC/`. Line numbers are those of the files as read on 2026-11-18.
Both sections are headed *(proposal)*; findings below are about where the ledger and the rules
disagree, whichever of the two is ahead.

---

### API-1: `advance` and a condition raise have no idempotency key, though §2 says every write but the claim is "safe to retry by its own key"
- **Severity:** high
- **Kind:** contradiction / liveness
- **Rules:** §2.1 (unnumbered, G-BTN-2), R-BTN-63, R-BTN-160, R-BTN-180, R-BTN-117, §14 rows `advance`, `conditions`, `tokens`, `mcp-keys`, `register`, `bars`
- **Confidence:** high (advance, raise); medium (the minting routes)
- **Evidence:**
  - `02-deployments.md:28-32` — "A claim's repeated `request_id` returns the first request's committed result (G-BTN-2); `claims.request_id` is the only stored request id. Every other write is safe to retry by its own key: a repeated end is `ok` (§9.4), owner and administrator writes set a value, a repeated board post is `stale-observation` […], and a repeated raise or report finds its row."
  - `05-courses.md:251-252` — "`advance {reached, leg}` finishes the running leg, if any, at `reached` — one of its outcomes, else refused `off-graph` — records the position, then starts `leg` […]"
  - `05-courses.md:260-261` — "The `advance` that starts a run, and an adoption that adds one, mints its `run_id`"
  - `12-security.md:505-508` — "Baton refuses an `advance` starting a run without one, a label from a credential not listed, and a label the same credential reported for any earlier run on the tenant (`invalid-params`, rules `label-missing`, `label-unlisted`, `label-reused`), atomically (`run_labels`, §13)."
  - `14-api.md:76` — conditions body "`{type, disposition, handler?, restarts, default?, severity?, url?}`" → "`{condition_id, handler_id?}`"
  - `07-conditions.md:99-100` — "Baton answers with a `condition_id` and, when `handler` names a course, the handler's id `handler_id` (below), and stores the `conditions` row; the runner then writes the handler ticket under that id."
- **The problem:** Trace for `advance`: (1) holder sends `advance {reached: S1, leg: L2}`; Baton commits — run of L1 finished, `claim_legs` row for L2 written, `run_id` minted, seats rewritten, `run_labels` row written. (2) The response is lost (30 s timeout, a deploy). (3) The runner re-signs and retries, as `02:307-308` tells it to. The running leg is now L2 and `S1` is not an outcome of L2, so the retry is `off-graph`; where the course loops (L2 leads back to S1) it instead finishes the just-started run and starts a second one, spending one of `max_runs`; with a run label it is `label-reused`. In every reading the runner never receives `run_id`, `inputs` or `leg_log.dir`, which only the advance reply carries (`14-api.md:74`), and Baton holds a started run no session is running. For a raise: the body carries no client key, so a retry stores a second `conditions` row, returns a second `handler_id` (`<ticket>.c<n+1>`), and counts twice toward the 20-open / 200-a-day quotas — "a repeated raise … finds its row" has nothing to find it by. Minting routes are the same shape: `POST …/tokens` and `POST …/mcp-keys` return a secret "once"; a lost response to `mcp-keys` leaves a live key nobody holds and the name taken (`conflict` on retry); a lost response to `POST /v1/register` with `api_key: true` spends the token's single use and leaves the name bound, and "renewing one's own name is a re-key … must be signed by the name's current credential" (`08-runners.md:169-170`), which the caller never received.
- **Counter-reading considered:** The heartbeat response names each claim's `leg` (`14-api.md:72`), so a runner could notice the run started. But it does not carry `run_id`, the resolved `inputs` or the log directory, and no rule tells the runner to reconcile from it. I searched `idempot`, `lost response`, `repeated advance`, `retry` across all sections: the only stated mechanisms are the claim's `request_id`, the end's "repeating the same end is answered `ok`", activities' per-runner ids and attestations' `nonce`.
- **Smallest fix:** Give `advance` and the raise a client key (`seq` the runner chooses, or a `request_id` stored on `claim_legs` / `conditions`), state that a repeat returns the stored reply, and narrow `02:29-32` to the writes that really are keyed. Say what a lost minting response costs (revoke and re-mint) or key those too.

### API-2: The outbox has no kind for the ticket proposals R-BTN-180 queues through it, and R-BTN-161 gives that write to someone the `protected` refs exclude
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-171, R-BTN-180, R-BTN-161, R-BTN-165, R-BTN-188 (`refs.other`), §13.8 `outbox.kind`
- **Confidence:** high
- **Evidence:**
  - `13-data-model.md:184` — "`kind` (`withdraw`\|`forge-check`)"
  - `07-conditions.md:621` — "`withdraw` is the one **git kind**: Baton files no ticket of its own (R-BTN-163)."
  - `12-security.md:579-586` — "A ticket a runner's action would create (a condition's handler ticket, R-BTN-161; a call leg's child, R-BTN-165; a supersession's replacement; […]) and the outbox's git kind (a withdrawal, R-BTN-171), is **proposed, not filed**: Baton queues an outbox entry for it, and a trusted-runner deliverer writes it on a branch `baton/proposed/<ticket>` from the entry's fields or the creating leg's typed output, through the CLI's own templates (R-BTN-171)"
  - `07-conditions.md:184-186` — "Under the policy's `tickets.created: proposed` (R-BTN-188) the handler ticket is proposed, not filed: the runner writes it on `baton/proposed/<ticket>`"
  - `12-security.md:357` — "`refs.default_branch`, `refs.tags`, `refs.other` (branches outside `branch_pattern`, `baton/proposed/*` among them […]) […] `[trusted-runner, human]` for each" (the `protected` column)
- **The problem:** Under `protected`, R-BTN-161 has the raising runner push `baton/proposed/<ticket>`, a ref class the same preset closes to `runner`. R-BTN-180 instead has Baton queue an outbox entry that a trusted deliverer writes — but R-BTN-171 and §13 give the outbox exactly two kinds, neither of which creates a ticket, and `fields` holds "identifiers only", so the handler ticket's subject and body (which "stay with the runner", `07-conditions.md:141-142`) have no path to the trusted deliverer. An implementer cannot build `tickets.created: proposed` for handler tickets, call children or supersession replacements from these three rules, and `tickets-approved` / `no-runner-lands` both list `tickets.created` is `proposed` as a condition.
- **Counter-reading considered:** "the creating leg's typed output" could mean the deliverer fetches a leg output pointer (`leg_outputs.uri`), so no body crosses Baton. That still needs an outbox kind and a `fields` shape naming the pointer, and R-BTN-171 says in terms that `withdraw` is the only git kind. Searched `proposed` in §4, §5, §7, §13: no third kind anywhere.
- **Smallest fix:** Decide who writes a proposal. If the trusted deliverer: add the kind (`propose`) to R-BTN-171's table and `outbox.kind`, with its fields, order, confirmation and lateness; rewrite `07:184-186` and `07:501-502` to cite it. If the runner: open `baton/proposed/*` to `runner` in the knob and delete the outbox sentence from R-BTN-180.

### API-3: The dashboard is specified twice — one `GET /v1/ui/state`, and per-entity reads "§14 lists `session` on" that §14 does not list
- **Severity:** high
- **Kind:** contradiction / underspecified
- **Rules:** §11.4 "The rule" (B-192), §12.1 principal table, R-BTN-16, R-BTN-129, §12.3 (B-217), §14 Callers
- **Confidence:** high
- **Evidence:**
  - `11-people.md:642-644` — "A screen is drawn from one entity's REST reads — the §14 rows whose callers admit `session` (B-192) — and its controls are the registry actions whose `ui.view` names it"
  - `12-security.md:50` — "`/`, every §11.4 screen path, `/v1/ui/*`, the repository and owner reads §14 lists `session` on"
  - `12-security.md:192-194` — "A session's reads outside `/v1/ui/*` — the entity reads its screens poll (§14's `session` rows) — are authenticated by Baton alone"
  - `14-api.md:56-60` — "*reader*: a key granted on the repository, an owner of it, or an administrator; […] *session*: a dashboard session"
  - `14-api.md:171` — "`GET /v1/ui/state` | session | — | everything the dashboard draws; for an owner's session, its repositories' only"
  - `12-security.md:155-156` — "the schema fetched from `GET …/schemas` (B-217)"
  - `11-people.md:658-661` — "drawn only where the read says the caller may take it — `allowed: [<action id>]`, or `answerable`, or `writable_types`"
- **The problem:** In §14 exactly one repository read names `session` (`…/prerequisites`, line 94); every other is *reader*, *owner* or *admin*, definitions that exclude a session, and no owner read (`GET /v1/owner/{repository}/grants`, `…/policy/log`) admits one. So by §14 the screens `/board`, `/tickets/{ticket}`, `/conditions`, `/grants`, `/policy` cannot be read with a cookie, while §11.4 and §12 say they are. Several screens have no read at all in §14: `/runners` and `/runners/{runner}` (a 24-hour timeline), `/goals`, `/attestations` (there is `POST` and `DELETE`, no `GET`), `/tokens`, `/sync-keys`, `/check-runners`, `/consents`, and the tenant screens `/instances`, `/resources`, `/capacities`, `/settings`, `/sessions`. `GET …/schemas` is cited and is not a row. No §14 response carries `allowed`, `answerable` or `writable_types`. And `GET /v1/ui/state`, the older single read, still stands in §14 and in §13's index note (`13:206-208`), with no `ETag` although "Every screen polls its reads each 10 seconds with `If-None-Match`" (`11:647`). Since `check:actions` "keeps the registry and this table … equal" (`14:7-9`), the table is the registry: which principals may call each read is not a detail an implementer can guess, and the owner-session scoping of each read ("its repositories' only") is security-relevant.
- **Counter-reading considered:** §12.1's sentence "The repository reads […] are open to any key granted on the repository, its owners and administrators" could be read to include an owner's session as "its owners". §14's Callers paragraph defines *owner* as "an owner key of `{repository}`" and *session* separately, and R-BTN-129 makes `session` a principal of its own with `roles`, so it cannot. Searched `B-192`, `ui/state`, `session` rows: no list of the reads a session may call exists anywhere.
- **Smallest fix:** In §14 add `session` (with its roles) to each read the screens poll, add the missing read rows (runners, runner, attestations, tokens, sync keys, check-runners, consents, schemas, the tenant reads) with their response fields including the `allowed` family, and either delete `GET /v1/ui/state` or say which screens still use it.

### API-4: §13 lists a unique-per-runner active-claim index that R-BTN-4 forbids, and says claims are "kept forever" while R-BTN-149 prunes them
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-4, R-BTN-149, R-BTN-12, §13.5, §13.4 `closed_tickets`
- **Confidence:** high
- **Evidence:**
  - `13-data-model.md:197` — "**Indexes that rules depend on.** `one_active_claim_per_ticket`; `one_active_claim_per_runner`;"
  - `13-data-model.md:134` — "The lease, kept forever; one `active` row per ticket (partial unique index on `ticket_id`), and an index on `(runner_id)` among active rows for R-BTN-4's count."
  - `09-claims.md:15-18` — "A runner holds at most the lower of two numbers at once, counting its active claims across every repository: its **`concurrency`** […] an integer from 1 to 32"
  - `02-deployments.md:262-264` — "then the claims of a ticket whose history R-BTN-81 purged, with their legs, activities and the rows that name them"
  - `13-data-model.md:123` — "`claims_due_at` (when R-BTN-149 next prunes its claims; NULL once they are gone)"
  - `06-prerequisites-blocks-advice.md:568-569` — "Baton's traversal record (R-BTN-63) stays with the claims. So withdrawing a ticket in git and reopening it clears nothing."
- **The problem:** (a) An index named `one_active_claim_per_runner`, listed beside the unique `one_active_claim_per_ticket` as one "rules depend on", is the pre-B-188 one-claim-per-runner lock; built as named it refuses a runner's second claim that R-BTN-4 and S-BTN-229 require. The same section's table row describes the non-unique replacement. (b) "kept forever" and "Every other row naming it is kept: claims and their leg runs (the traversal record, R-BTN-63)" (`13:34-35`) contradict the prune. The consequence is observable: a ticket withdrawn, left more than 90 days, and reopened under the same id comes back with its hold and `leg_attempts` (`kept_json`) but with every `claim_legs` row deleted, so `max_runs` starts from zero — R-BTN-12's "clears nothing" is false past the retention window.
- **Counter-reading considered:** The index may merely be named historically and be non-unique. A spec that lists it as rule-depended without saying so invites the wrong build; and nothing reconciles "kept forever" with `claims_due_at`. Searched `kept forever`, `claims_due_at`, `prune`.
- **Smallest fix:** Rename or drop `one_active_claim_per_runner` in the index list; replace "kept forever" with the retention R-BTN-149 gives; in R-BTN-12 say run counts survive a return only inside the window, or keep per-leg run counts in `kept_json`.

### API-5: Owner-signed control (B-127) and provenance (B-126) are served by routes and stored in rows §13 and §14 do not have
- **Severity:** medium
- **Kind:** contradiction / underspecified
- **Rules:** R-BTN-66 (as amended), §4.4 (B-127), R-BTN-194, R-BTN-133, §13.1, §13.4, §13.8, §14 claim / recommendations / observation rows
- **Confidence:** high
- **Evidence:**
  - `01-what-baton-is.md:254-255` — "`require_signed_control` (default off, B-127 — turning it on tightens, turning it off is a loosening R-BTN-186 governs)"
  - `13-data-model.md:57-70` — the owner-settings table: twelve settings, none of them `require_signed_control`
  - `04-tickets-syncs-board.md:585-589` — "Each ticket's `brief` — `{signed, signer?, commit}` […] is stored with the ticket and served with the claim answer […]. The post's `control` record stands for the repository"
  - `04-tickets-syncs-board.md:590-592` — "raises one `unsigned-control` event under Needs you for the changes no raised event in the 7-day window already named"
  - `04-tickets-syncs-board.md:603-604` — "with the owner keys served by the observation (never read from the repository it is judging)"
  - `04-tickets-syncs-board.md:636-638` — "It rides the ticket, beside its `brief`, in the board read (§11), the dashboard's ready rows, the recommendations, the claim answer"
  - `08-runners.md:521` — "the claim answer's `control` names, per group, the commit a runner loads"
  - `13-data-model.md:116` — `tickets` columns end "`last_written_by` JSON […]"; no `brief`
  - `13-data-model.md:186-195` — `events.kind`: no `unsigned-control`; `13:208-209` — "`events_discrepancies` and `events_unsigned_control` (`at` where `kind` is theirs)"
  - `14-api.md:73` — claim response "`{claim_id, ticket_id, course_id, course_version, leg_state, station, legs, next[], path, nonce, snapshot_sha, default_branch, handoff_url?, previous_attempts[] (newest 10), previous_attempts_total, resume?, check_sha?, check_head_ref?, version, ticket_source?, scope[]}`"
  - `14-api.md:138` — observation response "`{sha, observation, bars, pushers, code_repos, check_app_id, positions, versions, legs, unconfirmed}`"
- **The problem:** The setting has no column, so it cannot survive a restart and is not in R-BTN-88's export ("`repositories` (every setting…)" means every §13 column). `brief` has no column on `tickets`. The repository's standing `control` record has no home — only `claims.control_json`, a per-claim copy, exists, so "the record read in the claim's own transaction" has nothing to read. The `unsigned-control` event has an index and no place in the kind list. The claim answer in §14 carries neither `brief`, `last_written_by` nor `control`, the recommendations row carries neither `brief` nor `last_written_by`, and the observation carries no owner keys — yet the fail-closed claim and "every runner verifies the named commits' signatures" depend on each. An implementer of §14 as written ships a claim answer from which a runner cannot verify control inputs, and the repository would then hand out no claim at all once the setting is on.
- **Counter-reading considered:** `brief` and the control record could live inside the opaque `tickets.course_json` or `course_data`. They are core-read (the claim fails closed on a missing group), and core "never reads" opaque blobs (`13:18-19`). Searched `control_json`, `control record`, `brief`, `require_signed_control`, `unsigned-control` across §13 and §14.
- **Smallest fix:** Add `require_signed_control` to the owner-settings table; `brief_json` to `tickets`; a `control_json` (and the 7-day notice memory) to `board_head` or `repositories`; `unsigned-control` to `events.kind`; `brief`, `last_written_by`, `control` to the claim, recommendation and board rows; `owner_keys` and the setting to the observation row.

### API-6: `PUT /v1/admin/settings` cannot set `recommended_client`, and the human-key instance setting, human-only keys and key suspension have no row at all
- **Severity:** medium
- **Kind:** contradiction / underspecified (state with no column)
- **Rules:** R-BTN-197, R-BTN-185, R-BTN-188, R-BTN-149, §13.1 `instance_settings`, §13.2, §14 `PUT /v1/admin/settings`, `POST /v1/human-keys`
- **Confidence:** high (`recommended_client`); medium (the rest sits under §12.8 *proposal*)
- **Evidence:**
  - `14-api.md:160` — "`PUT /v1/admin/settings` | admin | `{link_hosts?, session_hosts?, check_app_id?}`"
  - `11-people.md:365` — "`admin settings set [--link-hosts …] [--session-hosts …] [--check-app-id <id>] [--recommended-client <version>]` | `admin.settings.set`: `PUT /v1/admin/settings`"
  - `13-data-model.md:51` — "`link_hosts` JSON, `session_hosts` JSON, `recommended_client` (NULL for the code's default, R-BTN-197), `check_app_id`"
  - `12-security.md:937-942` — "`human_key: any | hardware` (an instance setting, default `any` […]) […] Switching to `hardware` suspends every `human_only` key registered before the switch that does not meet it."
  - `12-security.md:388-389` — "registering a `human_only` key with the tenant (R-BTN-185) makes it an owner of nothing"
  - `13-data-model.md:144` — "owner keys gain `human_only` and `fido_attestation`"
  - `12-security.md:401-402` — "Baton refuses removing an owner, or revoking or suspending a key"
  - `02-deployments.md:252` — "a credential's heartbeat declaration and report writes per UTC day | 50,000" against `13-data-model.md:95` — "`write_budgets` | `(credential_id, repository_id, day)` | `writes` | Non-upkeep row writes per UTC day"
- **The problem:** (1) The route's body in §14 has no `recommended_client`, so the CLI flag has no wire field. (2) `human_key` is "an instance setting" with no `instance_settings` column and no field on the route, so "an instance switch to `hardware`" has no action. (3) A `human_only` key registered through `POST /v1/human-keys` and owning nothing has no table: `repository_owners` is keyed by repository, `credentials` is "Every key but owners', sync keys and administrators'" with kinds `runner`/`probe`/`check-runner`. The one-role check (`13:74-77`) names four stores and none holds it, so the same key can be registered as a runner. (4) "suspended" is a key state three rules read and no table has a column for. (5) The FIDO authenticator allowlist `hardware` checks against is nowhere. (6) The per-credential declaration budget is per credential, not per repository, and has no counter; `write_budgets` holds one `writes` number for the other budget.
- **Counter-reading considered:** §13 says the proposal's columns are sketched in one sentence (`13:144`), so absence may be deliberate. But `recommended_client` is not proposal text, and `POST /v1/human-keys` is a §14 row whose effect has to be written somewhere. Searched `human_key`, `suspend`, `BATON_HUMAN_KEYS`, `allowlist`.
- **Smallest fix:** Add `recommended_client?` and `human_key?` to the route; add a `human_keys` table (fingerprint, public key, attestation, `suspended_at`, `revoked_at`) and name it in the one-role sentence; add the declaration counter to `write_budgets` or a sibling.

### API-7: Nothing says who may acknowledge a message, and the release backstop fires only on a missing acknowledgement
- **Severity:** medium
- **Kind:** security / liveness (underspecified)
- **Rules:** §6.9, R-BTN-119, R-BTN-90, §9.5, §14 `POST /v1/runner/messages/{id}/ack`
- **Confidence:** medium
- **Evidence:**
  - `14-api.md:77` — "`POST /v1/runner/messages/{id}/ack` | machine | `{reply?: {text}}` | `{ok: true}` | §6"
  - `06-prerequisites-blocks-advice.md:584-587` — "A heartbeat response returns pending messages and marks them `delivered` in the same transaction, and returns again every delivered message not yet acknowledged, so a lost response loses none; the runner acts on a message `id` once, then acknowledges."
  - `06-prerequisites-blocks-advice.md:591-592` — "A delivered `release` unacknowledged for 2 hours is reaped by the alarm with a fence (R-BTN-19)"
  - `13-data-model.md:183` — "`messages` | `id` | […] `to_runner_id`, `in_reply_to`, `sent_at`, `delivered_at`, `acknowledged_at`, `status`"
- **The problem:** The caller is "machine" — any machine key with a runner secret — and neither §6.9 nor the row binds the acknowledging runner to `to_runner_id`. Two traces. (a) Runner B, any granted key in the tenant, posts acks for ascending integer ids. A `release` addressed to runner A becomes `acknowledged`; A's heartbeats return only "pending … and delivered ones not yet acknowledged", so A never sees the owner's Stop, a `floor` release or a `leg-timeout`, and the 2-hour / 15-minute reap never fires because the message is not unacknowledged. (b) Without any second runner: A acknowledges a `release` and does not end its claim (a bug, a crash between the two calls followed by a restart that keeps the state file). The claim is active, the runner heartbeats, the message is acknowledged; no rule ends the claim. The only exits are an administrator's dashboard force-reap or an owner's adopt.
- **Counter-reading considered:** R-BTN-129's scopes (`own`: "its own credential or outbox entries") may cover messages in the registry; the spec does not say so, and `own` is per credential, which several runners share (`09-claims.md:102-103`). For (b), the runner is specified to end before it acknowledges (`06:591`), so a correct runner never does this — but the backstop exists for incorrect ones. Searched `ack`, `acknowledg`, `to_runner_id` in §6, §8, §9, §12.
- **Smallest fix:** State in §6.9 and the row that only the runner the message is addressed to (its `runner_id` and secret) acknowledges it, else `forbidden`/`not-found` alike; key the reap on "the claim the release names is still active 2 h after delivery", not on the acknowledgement.

### API-8: A sequence can never be taken when git already holds a number more than 10 000 above the stored one — and a moved or fresh Baton stores zero
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-199, R-BTN-88, §13.4 `sequences`, §14 `…/sequences/{kind}/next`
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:496-502` — "The number is `max(stored, floor) + 1`: the caller's `floor` is the highest number it sees in git […] so a lost or fresh Baton never issues a number git holds (value 1: lost state fails closed). […] A floor more than 10 000 above the stored number is refused `invalid-params`"
  - `14-api.md:105` — "a floor more than 10 000 above the stored number `invalid-params`, logged as a `sequence` event with the floor and no number"
  - `04-tickets-syncs-board.md:770-781` — the export's `sections` list, which does not name `sequences`
- **The problem:** A repository adopting Baton whose tickets already number above 10 000 (an imported tracker, a kind whose prefix encodes a year) has `stored` = no row and `floor` > 10 000: every take is `invalid-params`, the CLI "prints or files" no number, and no route sets a sequence. The same happens to every kind above 10 000 after R-BTN-88's move, because `sequences` is not exported: the rule's own "lost or fresh Baton" case is the one the bound refuses. The bound also does not bound: each accepted take may raise the number by 10 000, so a granted or delegated key ratchets it without limit in a loop ("gaps are harmless", but then the bound protects nothing while still causing the lock-out).
- **Counter-reading considered:** A first take on a kind with no row may be meant to be exempt; neither the rule nor the row says so, and S-BTN-234 tests "floors below, above and beyond the stored number; a fresh kind" without saying which answer a fresh kind beyond gets. Searched `10 000`, `sequences`, `floor`.
- **Smallest fix:** Exempt a kind with no stored row (or let an owner/administrator set a sequence), and add `sequences` to the export sections.

### API-9: `rationale` is "kept in the history row and exported", but history rows cap at 2 KB and hold identifiers only, and claims are not exported
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-100, R-BTN-81, R-BTN-88, R-BTN-33, §13.5
- **Confidence:** high
- **Evidence:**
  - `06-prerequisites-blocks-advice.md:534-536` — "`rationale`: opaque JSON ≤ 4 KB, kept in the claim's `advice_json` and history row and exported with it (R-BTN-88); Baton never reads it […] and §12.3's free-text rules do not apply to it."
  - `04-tickets-syncs-board.md:729-730` — "Rows hold names, ids, versions, pointers and digests only (R-BTN-33); `detail_json` at most 2 KB."
  - `13-data-model.md:146` — "`detail_json` (≤ 2 KB)"
  - `04-tickets-syncs-board.md:783-785` — "**Not exported**: claims and their `claim_seats`, events, […] and, unless `--with-history`, the history"
- **The problem:** A 3 KB rationale cannot be in a 2 KB `detail_json`; either the claim is refused, the row is truncated (invalid JSON) or the history copy is dropped — three behaviours. A history row carrying unvalidated opaque JSON from a runner contradicts "names, ids, versions, pointers and digests only". And "exported with it" is false for the claim copy always and for the history copy unless `--with-history`. This is the one runner-supplied free blob that reaches the history, the store R-BTN-33 most directly protects, exempt from §12.3's text rules.
- **Counter-reading considered:** The history row may hold only a digest of the rationale. The rule says "kept in". Searched `rationale`, `advice_json`.
- **Smallest fix:** Keep the rationale on the claim only; say the history row carries nothing of it (or its digest); drop "exported".

### API-10: `events.kind` and `ticket_history.kind` miss kinds the rules log
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-147, R-BTN-75, §13.5, §13.8, §13 preamble
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:479-480` — "the new id takes the old one's hold and backoff (a `renumbered` event, actor `sync`, B-183)"
  - `06-prerequisites-blocks-advice.md:119-120` — "a row not so confirmed within 1 hour, or not shown, is dropped and logged `prerequisite-unconfirmed`"
  - `13-data-model.md:8-10` — "together with `BATON_MCP_OAUTH_SPEC` §12's rows (the OAuth tables, `mcp_keys`' OAuth columns, `oauth_redirect_uris`, its alarm instants and the `oauth` event kind), which B-73 folds in here"
  - `13-data-model.md:186-195` — the list, which has none of `renumbered`, `prerequisite-unconfirmed`, `unsigned-control`, `oauth`
- **The problem:** The list reads as closed ("`events.kind`: …"). Four kinds rules log are absent; `mcp_keys` is described as "the OAuth spec's §12 row, folded in" while the OAuth tables, `oauth_redirect_uris` and the kind are not in §13, so the preamble's "folds in here" is half done, and `GET /v1/owner/{repository}/grants` returns `client_host?, client_addr?` per MCP key (`14:116`) that no listed column holds.
- **Counter-reading considered:** `prerequisite-unconfirmed` could be a `discrepancy` sub; R-BTN-85's sub table (`04:746-752`) does not list it either.
- **Smallest fix:** Add the four kinds; either fold the OAuth rows in or say plainly that they still live in the companion spec.

### API-11: Restated lists that have drifted from their one home
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** §4.3, R-BTN-12, R-BTN-75, R-BTN-180, R-BTN-39, R-BTN-63, §14 errors, §14 observation / heartbeat / attestation rows
- **Confidence:** high
- **Evidence and problem, one line each:**
  - Observation response. `04-tickets-syncs-board.md:351-352` — "`{sha, observation, bars, pushers, code_repos, check_app_id, provisional, positions, versions, unconfirmed}`"; `14-api.md:138` — "`{sha, observation, bars, pushers, code_repos, check_app_id, positions, versions, legs, unconfirmed}`". §14 lacks `provisional` (which `06:118` reads); §4.3's shape lacks `legs` (which its own prose describes).
  - Heartbeat. `08-runners.md:43` — the heartbeat carries "spooled activities and transcript paths (§9.9)", and its response "the current activity" (`08:54`); `02-deployments.md:319-320` — "answered `declarations: 'quota'`". `14-api.md:72` has `transcripts?[]` and no activities field, no current activity and no `declarations`.
  - Hold reasons. `06-prerequisites-blocks-advice.md:549-551` lists seven; `13-data-model.md:160` adds `scope-exceeded` (from `12-security.md:1033-1034`). R-BTN-12 calls itself the hold's definition.
  - Dependency refs. `13-data-model.md:118` — "`ref` (`<ticket>@at:<station>,…`, `@reached:…`, `@done` or `@withdrawn`)"; `06:100` adds "or `@closed`"; the post schema (`04:535`) admits only "`at | reached | done`", so `@withdrawn` in `ticket_depends` is unpostable and `@closed` is missing where blocks need it.
  - Error codes. `14-api.md:23` — "**Errors** are `{ok: false, code, message}`, with these codes:" and the table has no `nothing-implied` (`01:173`), `off-graph` (`05:252`), `label-unlisted` / `label-unexpected` (`14:74`). R-BTN-180 (`12:507`) makes the label refusals `invalid-params` with "rules", a field the error shape gives only to `not-eligible`; §14 writes them as codes.
  - Destructive list. `14-api.md:109` gives adopt "`confirm: true`"; `12-security.md:97-104` lists the actions that take it — "Two further changes take `confirm: true`" — and `ticket.adopt` is in neither sentence.
  - Attestation callers. `14-api.md:111` — "an owner key or an owner session (writer `owner`), a `human_only` key, or a `service` key"; `12-security.md:637-638` — "Work is attested by `human`, `owner`, `service`, `baton`, `runner` and `sync` writers". Whether an ordinary runner key may `POST …/attestations` as writer `runner` has two readings; "`service` key" is not a credential kind of §13.2.
  - Attestation export. `12-security.md:718-719` — "Attestations about work are exported with the owner state (R-BTN-88); an import drops every one of them"; R-BTN-88's sections (`04:770-781`) do not list them; `13:141` — "never imported".
  - Unused field. `14-api.md:96` returns `operator_only`; the word appears nowhere else in the spec and `tickets` has no such column (searched all sections).
- **Counter-reading considered:** Each is small alone; together they show §14 and §13 are maintained by hand against rules that moved, which `check:actions` does not catch because it compares the table with the registry, not with the rules.
- **Smallest fix:** Correct each line; let the rule cite §14 for the shape instead of restating it (the spec's own "one home per statement").

### API-12: `POST /v1/admin/seal` is final and takes no confirmation
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-88, §12.2, §14
- **Confidence:** medium
- **Evidence:**
  - `14-api.md:164` — "`POST /v1/admin/freeze`, `…/unfreeze`, `…/seal` | admin | — | `{ok: true}`"
  - `04-tickets-syncs-board.md:813` — "the sealed source never serves again"
  - `12-security.md:101` — "`admin.key.revoke`, `admin.repo.retire`, `admin.repo.resync`, `admin.sessions.revoke`."
- **The problem:** The one administrator action no route undoes (there is `unfreeze`, no unseal) has an empty body and is absent from the destructive list, while a reversible session revoke needs `confirm: true`. An idle tenant passes the seal's precondition, so one mistyped command ends it. `GET /v1/admin/export` is "sealed only" (`04:808`) and §14 gives no code for an unsealed export.
- **Counter-reading considered:** `baton admin seal` may prompt in the CLI. §12.2 defines the protection as the body field, precisely so that every surface has it.
- **Smallest fix:** Add `admin.seal` to §12.2 and `{confirm: true}` to the row; give the unsealed export a code.

### API-13: No HTTP status for most error codes, and pagination is stated four ways
- **Severity:** low
- **Kind:** underspecified
- **Rules:** §14 errors and reads, R-BTN-130, R-BTN-135
- **Confidence:** high
- **Evidence:**
  - `14-api.md:28,50,51` — only `client-too-old` ("426"), `sealed` and `unavailable` ("503, retryable") carry a status; `14:10` gives "`404 not-found`".
  - `02-deployments.md:307-312` — clients "treat `rate-limited` and `quota` as possible on every route […] `too-large` is reported, never retried"
  - `14-api.md:95,99,100,125,142` — `?before=<id>&limit=` / `next_before`; `?cursor=` / `next_cursor`; `?after=<version>`; `?after=<seq>` / `next`
  - `11-people.md:483-485` — MCP list cursors are "HMAC-bound under `CursorKey` (R-BTN-55) to the key, action and input"
- **The problem:** Which codes are retryable is said for three; a client that meets `sync-busy`, `head-moved`, `stale-observation` or `conflict` through a proxy that rewrites bodies has only the status to go on, and none is given. REST cursors are not said to be bound or opaque while MCP's are, though `tools/call` "runs the route's core function". Several list reads have no page at all and no stated bound: `…/children`, `…/legs/{leg}/runs`, `GET /v1/owner/{repository}/grants`, `…/board`'s `ready[]` (up to 5 000 tickets), the observation's `legs` ("newest first", no limit) and `positions`.
- **Counter-reading considered:** The body's `code` is the contract and statuses are an implementation detail. Then 426 and 503 should not be normative either; they are.
- **Smallest fix:** One column in the error table for status and retryability; one sentence fixing the cursor form; a bound or a cursor on each unbounded list.

---

## Read but found sound

- Route inventory, path by path: every route-shaped string in §1–§12 and §16 (`GET|POST|PUT|DELETE /v1/…`) has a §14 row with the same verb and path, apart from `GET …/schemas` (API-3) and the OAuth routes the preamble defers to the companion spec.
- R-BTN-155's confirmed-action list against §14's `202 {confirm_code}` rows: cutover, force-reap, fence-clear, forced resync, unhold / expedite, completion confirm / release, adoption confirm all match, and the unconfirmed ones (hold, cancel, Stop, resolve) match.
- §12.2's destructive list against §14's `confirm: true` bodies: every listed action carries it (the gaps are adopt and seal, API-11, API-12).
- R-BTN-127's command table against §14's Caller column for the owner and administrator routes (`approvers.members` / `.roles` / `.policy` attributions): consistent.
- The claim's idempotency (`(runner_id, request_id)`, `claims.request_id` unique per runner) and the end's ("repeating the same end is answered `ok`"): stated once, consistently.
- The end-reason table (§9.4) against `claims.status` (`active|completed|released|reaped`) and the alarm's reap actors: consistent.
- Block kinds: R-BTN-75's "one list" equals `ticket_blocks.kind`; `binds`, `provisional`, `found` columns all have a writing rule.
- Message kinds and states (§6.9) against `messages`; outbox states against R-BTN-171 (kinds aside, API-2).
- Qualified ticket ids: `tickets.id` as `<repository>:<local id>` with the two grammars excluding `:` from the repository id — two repositories sharing a local id cannot collide in any table keyed by `ticket_id`.
- Repository retirement (R-BTN-47): each child store (keys, grants, tokens, MCP keys, sessions, outbox, consents, wants, timers, instance lists) is named; the tombstone keeps the id taken through an import.
- Runner uniqueness (`(hostname, session_name)`, `credentials.hostname` unique among live keys) against R-BTN-3 / R-BTN-14.
- Migrations: nothing in §1–§12 requires rewriting an applied migration; the `events` rebuild and the adoption columns' later deletion are new migrations.

## Not covered

- §15 (verification) was only grepped, not reconciled: whether each §14 row has a scenario is unchecked.
- `BATON_MCP_OAUTH_SPEC` §12 / §13 rows were not read; API-10 only notes that §13 claims to include them.
- §5 (courses), §7 beyond R-BTN-160 / R-BTN-171, §10 (checks) and §16 (adoption) were read by grep around route, table and column names only; the column-by-column writer/reader check was done for the `tickets`, `claims`, `claim_legs`, `outbox`, `messages`, `conditions`, `sequences`, `attestations`, settings and credential tables, not for the resource tables (§13.7), `ticket_timers`, `leg_queues`, `course_schemas` or the adoption columns.
- Field-by-field request validation (every body field against `src/core/validate`-style caps in §12.3) was sampled, not exhaustive.
- The response shapes of `GET /v1/runner/fleet`, `…/instances`, `…/launch-candidates` and `…/stats` are prose in both places and were not diffed.
