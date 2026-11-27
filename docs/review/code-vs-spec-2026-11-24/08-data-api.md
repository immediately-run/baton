---
title: "Area report — §13 and §14: data model and API"
description: "One of eight area reports behind the 2026-11-24 review of the code against the simplified spec, at main 5758cdb: deprecated concepts, unnecessary complexity, missing and stale anchors, each finding at file and line."
tags: [review]
order: 8
---


Method. I built the live schema by applying every migration in `src/migrations/index.ts`'s
`MIGRATIONS` order (0001…0071, 0075, 0076) to an in-memory SQLite (`node:sqlite`). The result
is 87 tables and 1 view. I diffed it table by table and column by column against the rows of
`spec/BATON_SPEC/13-data-model.md`. Then I listed every route in `src/core/baton.ts` (the
`route`, `runnerRoute`, `adminRoute` and `courierRoute` chains), `src/core/front.ts:184`, and
the read registry (`src/core/actions.ts` plus `src/core/reads/*`), and diffed them against
`14-api.md`. Script and output: `/tmp/claude-0/-home-user/94694bc2-033d-58bd-bb3f-f2ec8b188dc7/scratchpad/s08/`
(`schema.mjs`, `schema.txt`, `diff.mjs`).

**B-297 is now partly stale.** It is the general ticket for this area. What has changed since it
was written:
- `held_snapshots` now has a §13 row.
- `POST /v1/ui/board/accept` and `GET /v1/admin/capacities` now have §14 rows (14-api.md:177, :152).
- `reviewer_agents` is gone (0076).
- The policy read no longer carries `signature`, `kid`, `tenant` or the hashes. Only `valid_until` and `check_app_id` remain (baton.ts:813-828).
- B-285 is `done`, but `couriers`, `runner_couriers`, `notices` and `/v1/courier/*` are still live. B-297 assigns them to B-285, so they now hang on B-67 alone.

B-297 also misses several differences. They are listed under Notes.

### A. Deprecated concepts retained

**Mirror, cutover, shadow, adoption (§16; ruling 4)**
- **Mirror routes, including one §14 does not list.** `baton.ts:672-685` serves `GET /v1/sync/events` (mirror cursor) and `POST /v1/sync/foreign-claim`. The second is in neither §14's legacy table (14-api.md:191-198) nor §16's route text except 16-adoption.md:58.
  - Spec: §13/§14 "Legacy, removed with its code (R-BTN-193)".
  - Covered by B-288 (step 3, "the mirror's own" routes). Confirmed.
- **Cutover and adoption routes.** `baton.ts:941-947` (`GET /v1/runner/mode`), `:1011-1014` (`POST /v1/runner/adopt`), `:1058-1061` (`shadow-report`), `:1092-1102` (`/v1/ui/cutover`, `/v1/ui/adoptions/{ticket}/confirm`).
  - The code's adoption path segment is a ticket (`ticketParam`, and `actions.ts:322` agrees). §14's legacy row says `{claim}`.
  - Covered by B-288. Confirmed.
- **The dispatch gate on cutover.** `baton.ts:276-285` `flushDispatch` sends a sync dispatch only `cutoverAt != null`, which R-BTN-94 does not say. Covered by B-288 (added note). Confirmed.
- **Mirror fields in reads.**
  - `reads/sync.ts:108-141` serves `mode`, `dispatch.mirror_workflow`, `adoptions`, and `repo.cutover` / `adoption.confirm` in `allowed`.
  - `reads/repositories.ts:28,99` and `reads/tenant.ts:123` serve `mode: shadow|cut-over`.
  - `reads/conditions.ts:149-150` serves `adoptions` in Needs-you.
  - `actions.ts:391` summary: "The mirror's view of the repository".
  - Covered by B-288 in spirit only. Its step 3 names server modules but none of `src/core/reads/`, and §14's `GET /v1/repositories` and `…/sync` rows carry `mode`. Likely.
- **Mirror in retention.**
  - `retention.ts:66-72` `mirrorBound()` and `:78`: events are kept below `mirror_acked_seq`.
  - `retention.ts:29` `CLAIM_ROWS` includes `adoptions`. The header comment (lines 4-5) repeats the mirror bound.
  - R-BTN-149 (02-deployments.md:211-212) still states the mirror clause.
  - Covered by B-288 ("the mirror cursor in retention.ts"). The `adoptions` entry in `CLAIM_ROWS` is not named; it falls out with B-288's step-5 migration. Confirmed.
- **Stats count mirror events.** `stats.ts:188` `foreign_writes: events('foreign-claim')` counts a mirror-only event kind. The stats rule (05-courses.md:474-478) and §14's stats row list no foreign writes.
  - NOT covered: B-288 does not name `stats.ts`. Confirmed.
- **Registry and admin mirror plumbing.**
  - `registry.ts:23,36-38,63-66,72,129-154,183-210`: `cut_over`, `cutover_at`, `mirror_workflow`, sync-key role `mirror`, GitLab `mirror` audience.
  - `admin.ts:39` `LINK_FIELDS` includes `mirror_workflow`.
  - `admin.ts:383-384` and `registry.ts:139-141` accept sync-key role `mirror`.
  - Covered by B-288 (steps 3-4). Confirmed.
- **Schema.**
  - `repositories.mirror_workflow`, `.cutover_at`, `.mirror_acked_seq`; table `adoptions(ticket_id, claim_id, runner_id, requested_at)`.
  - §13 calls the table `adoption_requests` with `confirmed_at`. The real table is `adoptions` and has no `confirmed_at`.
  - `runners.kind 'legacy'` and `claims.reap_after`; events CHECK `adopted|cutover|shadow-conflict|foreign-claim`.
  - Covered by B-288 step 5. Confirmed.
- **db.ts comments.** `db.ts:9` ("a cutover") and `db.ts:16` ("a legacy runner's unusable secret hash") describe mirror-era uses. Covered by B-288 implicitly. Trivial.

**Git lock (B-289)**
- **Git-lock columns still written.** `tickets.status`, `.holder` and `.since` are written for every post (`baton.ts:2013-2026`). For a normative post they are constants: `status ''`, `holder null`, `since null` (board.ts:804-821). Only the interim `state.items` shape fills them.
  - `claims.ts:2122-2130` `gitEnded` reads `tickets.status`.
  - §13's `tickets` row names none of them.
  - Covered by B-289 / B-302 (interim shape). Confirmed.
- **`position-disagrees`.** `history.ts:21-23` `DISCREPANCY_SUBS` includes it, written by `baton.ts:1916-1937`. Covered by B-289. Confirmed.
- **`holders` in the board read.** `GET …/board` `holders` (`baton.ts:2283-2300`) is documented in code as "the lock a session claiming through git reads". Covered by B-289 / B-178 (likely kept as a plain read).

**Checks, exit status, forge-check, `check_app_id` (B-290)**
- **Admin and settings.**
  - `admin.ts:36,55-68,1037-1042,1219-1270`: `CHECKS_MAX`, `CONCLUSIONS`, `checks` in `PUT …/settings`, `checkConclusions`, `checkMap`.
  - `instance_settings.check_app_id`, served by `GET`/`PUT /v1/admin/settings` (instanceSettings.ts:87-96).
  - §13.1 still lists `checks` and `check_app_id`, and §14 lists `check_app_id` on the admin settings rows.
  - Covered by B-290 (steps 3-4). Confirmed.
- **`check_app_id` in the policy read.** `baton.ts:822` serves it. R-BTN-189 (12-security.md:447) still names it. B-290 step 1 removes `check_app_id` from §12.7 but names neither `policyRead` nor R-BTN-189's read shape. Partly covered. Confirmed.
- **A cut feature advertised as pending.** `reads/credentials.ts:44` `CREDENTIALS_NOT_BUILT.check_runners: 'B-290'`. `not_built` presents check-runners as something to be built, but they were cut.
  - NOT covered (B-290 does not name reads/credentials.ts). Confirmed.

**Resource prerequisite (B-291)**
- Tables `leg_needs` and `resource_fleet`; `ticket_blocks.kind` CHECK `'resource'`; `admin`/`baton.ts:2165-2171` `applyBlocks` storing `needs`.
  - §13.6/§13.7 still carry rows for both tables. §13's `leg_needs` columns (`source`, `added_at`, `found_at`) do not exist; the code has `(repository_id, ticket_id, leg, resource)`.
  - Covered by B-291. Confirmed.

**Tiers (B-322)**
- **Reads, routes and registration.**
  - `reads/tickets.ts:8,33-45` (`?tier=` with `fitsTier`).
  - `reads/runners.ts:69,90,114,231` (`tier_ceilings`).
  - `reads/repositories.ts:21,96` and `reads/tenant.ts:108-117` (`tiers`).
  - `baton.ts:2263,2273` (grants `max_tier`), `:2298` (`ready_by_tier`), `:1955` and `:2013-2026` (`tier_position`).
  - `admin.ts:378-388,423-442` (re-tier recompute), `:703-760` (grant `max_tier`).
  - `registry.ts:19-20,63,99-102,203-219` (`DEFAULT_TIERS`, `ceilingIn`, `tierPosition`).
  - Schema: `repositories.tiers`, `runners.tier_ceiling`/`tier_ceilings` (CHECK), `runner_grants.max_tier`, `tickets.tier`/`tier_position`, `ready_tickets.tier_position` and view `ready_ticket_source`.
  - The history file's migrations register (BATON_SPEC_HISTORY.md:3936-3954) says gate 5 and the tier reads "go before" the transition. In this code they are all live.
  - Covered by B-322. Confirmed.
- **Tier wording in `actions.ts` summaries.** `actions.ts:130` ("the per-tier order") and `:408` ("its tiers") are not named by B-322. Trivial.

**Signed control (B-263)**
- **The control record on claims.** `baton.ts:969-996` stores `signed_control.control_json` on every claim (`claims.control_json`) and `claimControl` answers it (`baton.ts:1880-1914`). Covered by B-263. Confirmed.
- **The observation's signing fields.** The observation answer (`baton.ts:636`) carries `signing_keys` and `require_signed_control`. Covered by B-263 step 1. Confirmed.
- **`GET /v1/owner/{repository}/signing-keys`.** Served at `baton.ts:1239`; it has no §14 row. B-263 removes `baton owner verify-config`, its only caller, but does not name the route. Likely covered.
- **`unsigned_control` in Needs-you.** `reads/conditions.ts:148` and `stateView` (`baton.ts:2412`). Covered by B-263 step 3. Confirmed.
- **Settings and schema.**
  - `require_signed_control` in `PUT …/settings` (`admin.ts:1037`).
  - Tables `signed_control` and the column `claims.control_json`; events CHECK `unsigned-control`.
  - Covered by B-263 step 7. Confirmed.

**Signed policy and policy pins (B-160, done)**
- **`policy_pins` is dead.** The table has zero readers or writers in `src/`. 0070 keeps it "for a rollback to the preceding server". B-160 has been done since 2026-11-21.
  - B-297 assigns it to B-293. B-293 lists it (line 42) but schedules its removal through "B-160 item 3", and B-160 is closed.
  - Effectively NOT covered: no live ticket drops the table. Confirmed.

**Couriers and notices (retired R-BTN-80/103; B-285 done, B-67 open)**
- **Courier routes, settings and alarm.**
  - `baton.ts:764,1282-1322` (`/v1/courier/notices/claim`, `/v1/courier/notices/{id}`, `GET /v1/courier/decisions`), `:1252` (`POST …/couriers`).
  - `admin.ts:12,146,575-576,599-600,837-909,1087,1125` (`remind_after`, the `pool` credential, courier revocation).
  - `baton.ts:161,170-177,215,471-473` (the notices wiring and alarm); `reads/conditions.ts:130,143-144` (`pool_unclaimed`, `no_owner_channel` listings).
  - Schema: `couriers`, `runner_couriers`, `notices`, `repositories.remind_after_s`, `credentials.kind 'courier'`, events `queue-over`. None of it has a §13 or §14 row.
  - Covered by B-67 only. B-285 closed without step 1. Confirmed.

**Posted decisions and `baton:` decisions (R-BTN-78 retired; B-161, B-56)**
- **The resolve route takes the old body.** `POST /v1/owner/{repository}/tickets/{ticket}/resolve` (`baton.ts:1269-1278`, `claims.ts:2086-2117`, `validate.ts:1121-1140`) takes `{decision: baton:retries|baton:stalled|<posted id>, answer, leg?}`.
  - §14 (14-api.md:132) says `{restart, condition_id?}` with R-BTN-163.
  - §7's own preamble (07-conditions.md:20-22) admits the code spells `baton:retries|baton:stalled retry|park`.
  - The posted-decision branch (B-110), `ticket_decisions`, `decision_answers`, `ticket_blocks.kind 'decision'`, and the history kinds `decision-opened`/`decision-answered` are the retired "posted decisions as a block kind" (91-decisions.md:86).
  - Covered by B-161 (posted decisions) and B-56 (`baton.*` conditions). Confirmed.

**Legacy and compat shims whose window is ticketed**
- **Worker wire names.** `X-Worker-Secret` and `?worker=` dual-read at `baton.ts:901-907,1440-1446` and `reads/repository.ts:33`; `runners.legacy_names_at`. Covered by B-69. Confirmed.
- **Bearer tokens.** `X-Baton-Credential` bearer tokens (`front.ts:240-243`, `baton.ts:886-887`); token credentials in `revokeKey` (`admin.ts:572-574`). Covered by B-8 (R-BTN-117's migration). Confirmed.
- **The interim board post.** `state.items`, `ready` and `confirmations` (`baton.ts:1586-1597,1946-1950`, `rowFor`). Covered by B-302 item 3. Confirmed.
- **`addProbe` still takes `instances`.** `admin.ts:544-561` accepts and ignores `instances` "for the CLI that sends it" and always writes `allowed_instances '[]'`. `Admin.view` (`admin.ts:1341`) then serves `allowed_instances` as the probes' `instances[]` in `GET /v1/admin/resources`, so the list is always empty. R-BTN-101 says a probe reports on any registered instance.
  - The register lists no window for this, and no ticket names it. NOT covered. Confirmed.
- **The hook-failures field.** `stats.ts:44,184-185` `hook_failures: []` is always empty ("hooks retired with R3-1236"). It is a wire field with one value. NOT covered. Confirmed.

### B. Unnecessary complexity

- **A second schema validator.** `src/core/detailSchema.ts` (whole file) is a separate JSON-Schema subset for readings' `detail`: 14 keywords, 4 KB, 5 levels, no `$ref`, `pattern` or `format`. It is used by `resources.ts:14`.
  - R-BTN-108 (05-courses.md, "one envelope, named schemas, one validator"): "Leg outputs and instrument readings are one mechanism … **One validator**, `src/shared/schema.mjs` … imported by the server". R-BTN-76 (06-prerequisites-blocks-advice.md:208,227) says a resource's schema is "R-BTN-108's subset" and is checked with "R-BTN-108's validator".
  - Two validators disagree on what is valid: 32 KB/16 levels against 4 KB/5, and `pattern` is allowed in one and not the other. The header still cites "§2g".
  - NOT covered. Confirmed.
- **A second condition store.** `policy_conditions` (0029) holds repository-scoped `baton.*` conditions such as `baton.unprotected` (`policy.ts:627,966,1006-1021`). It sits beside `conditions`, which since 0075 has `ticket_id NOT NULL`, so it cannot hold a repository's condition.
  - §13.6 specifies one `conditions` table with `ticket_id` "NULL for a repository's" and a unique open core condition on `(repository_id, type, ticket_id, ref)`. R-BTN-163 puts "every open condition" in Needs-you.
  - No read serves `policy_conditions`. `GET …/conditions`, `…/needs-you` and `stateView` never list them.
  - NOT covered: B-297 files it as "built and kept: write the row". Confirmed.
- **`repositoryRead` routes twice.** `baton.ts:1339-1460` re-matches eight regexes after `dispatchRead` has already matched the action.
  - Its `show` branch (`baton.ts:1349,1379-1386`) is dead. `ticket.show` is routed to `reads/tickets.ts:112`, and no legacy action's path matches `…/tickets/{t}` exactly.
  - Its `runs && role === 'runner'` refusal (`:1366`) is unreachable, because `leg.runs` callers are `OWNER_READERS` (`actions.ts:205`) and `authorizeAction` refuses a runner first.
  - `reads/repository.ts:13` says "The eight reads"; there are seven.
  - Simpler: each legacy read gets its own `ReadRoute.run`, keyed by action. NOT covered. Confirmed.
- **A dead retired-repository check.** `PUT …/policy` (`baton.ts:1257-1258`) re-reads `registry.get(repo)` and re-checks `retired_at`, but `adminRoute` already refused a non-live repository at `:1227`. NOT covered. Confirmed.
- **History kinds and discrepancy subs nothing writes.**
  - `history.ts:16-18` `HISTORY_KINDS`: `position-replaced`, `re-routed`, `position-confirmed`, `inputs`, `outputs` are never written in `src/core`. Only `shared/view.mjs` formats them.
  - `history.ts:21-23` `DISCREPANCY_SUBS`: `position-replaced`, `foreign-write`, `route-overridden` are never raised.
  - The comment ties them to B-38/B-39/B-120. These are knobs for unbuilt designs. Covered in effect by B-38/B-120 (available). Likely.
- **Ticket columns constant for normative posts.** `tickets.project`, `node`, `queue`, `tags`, `ord`, `status`, `since`, `holder` are stored on every upsert (`baton.ts:2013-2026`). They are constant (`''`/`null`/`'[]'`) for the normative post (board.ts:803-821) and filled only by the interim shape.
  - `requires_clause` is the tri-state `'listed'|'none'`.
  - §13's `tickets` row has none of them.
  - Partly covered by B-302 / B-289. Confirmed.
- **Two tables for one webhook window.** `webhook_syncs(repository_id, last_dispatch_at)` and `webhook_dispatch(repository_id, last_dispatch_at, trailing_at)` hold one coalescing window. §13.2 has one table, `webhook_syncs`, with `window_until` and `trailing_wanted`. B-297 lists only "webhook_dispatch, write the row". NOT covered as a merge. Likely.

### C. Missing anchors

- `admin.ts:613` `loginLink`: 5-minute single-use link. Should cite R-BTN-155 (§11.4). The constant at `:23` cites R-BTN-57.
- `admin.ts:626` `login`: link or Access exchange, `unauthenticated` refusals, 12-hour session row. Should cite R-BTN-155 and R-BTN-16 (the route comment at baton.ts:701 has them; the function does not).
- `admin.ts:670` `session`: re-checks the key and the Access binding on every request and revokes the session on a mismatch. Should cite R-BTN-155 and R-BTN-57.
- `admin.ts:974` `setBar` and `:1012` `liftBar`: owner bars and their bounds (`BARS_MAX`). Should cite R-BTN-67, and R-BTN-186 for lift (as §14 does).
- `admin.ts:789` `owners`: add and remove owner keys, `conflict`. Should cite R-BTN-58 (§11.2) and R-BTN-188 for the members approver.
- `baton.ts:1166-1220` the admin route chain: each route carries no id beyond the function header. Low priority; the freeze, unfreeze and seal routes carry R-BTN-88.
- `baton.ts:1127-1160` `/v1/ui/resync`: 30-second window, `conflict`. Cites R-BTN-73 but not R-BTN-94, which §14's row cites for the window.
- `baton.ts:1411-1418` (`repositoryRead`'s history branch) and `history.ts:34`: `limit` 1–200, default 50, cite "§11". They should cite R-BTN-81 (§4.7).
- `stats.ts:56` `Stats.of`: implements §5.7's "A course can see how it performs". That bullet has no rule id (see Notes), so there is nothing to cite yet.

### D. Stale or wrong anchors

- **Retired R-BTN-80 and R-BTN-103.**
  - Locations: `baton.ts:161,215,471,1282,1299,1305` and `admin.ts:146,575,591,599,825,1023,1349`.
  - Problem: they cite the retired notices and couriers rules.
  - Fix: goes with B-67's removal. Until then, cite the history's "Notices for people to conditions" migration entry.
- **Retired R-BTN-78.**
  - Locations: `baton.ts:450,1270,2155,2165,2171,2178`.
  - Problem: they cite the retired decisions rule. `baton:stalled` and the resolve now belong to R-BTN-163 and R-BTN-167 (07-conditions.md:163-175), and posted decisions to R-BTN-116/R-BTN-161.
  - Fix: R-BTN-163/R-BTN-167, or remove with B-56/B-161.
- **R-BTN-28 and R-BTN-17 (§16).**
  - Locations: `reads/sync.ts`, `reads/repositories.ts`, `reads/conditions.ts:149`, `baton.ts:943`.
  - Problem: these ids are live today but go with B-288.
  - Fix: no fix now; B-288 removes them.
- **Old § numbers from the pre-split spec.** Each points at a different section now (the history's "Old § → new §" table).
  - **§11 now means §14 (API).**
    - Locations: `baton.ts:688,943,1000,1150,1271,1282,1334,1342,1345`, `admin.ts:37,393`, `registry.ts:51`, `history.ts:34,94`, `stats.ts:1`.
    - Problem: §11 is now People.
    - Fix: §14, or better the rule id.
  - **§10.3 and §10.4.**
    - Locations: `baton.ts:287` (§10.3, now §3.2) and `baton.ts:296`, `admin.ts:86`, `registry.ts:52` (§10.4, now §12.3).
    - Problem: §10 is now Checks.
    - Fix: §3.2 and §12.3.
  - **§10.6.**
    - Location: `admin.ts:3`.
    - Problem: §10.6 was Administration and is gone.
    - Fix: §11.1/§11.2.
  - **The old §2/§3 letters.**
    - Locations: `registry.ts:1` (§2a), `stats.ts:1` (§2d), `history.ts:1` (§2h), `detailSchema.ts:2` (§2g), `baton.ts:1` (§3, §3a), `baton.ts:1810` (§2e).
    - Problem: none of these headings exist any more.
    - Fix: §3.1, §5.7, §4.7, §6.3, §2.1 and §5.3 respectively.
  - **§6.x from old §6 (Claims).**
    - Locations: `baton.ts:950` and `admin.ts:106,111,996`; `admin.ts:107` (§6.10); `registry.ts:193,196,371`, `reads/runners.ts:166,239` (§6.8).
    - Problem: the claim rules moved to §9. The other numbers are coincidental: §6.10 is now "How a leg runs" and §6.8 is now owner overrides.
    - Fix: R-BTN-7 / §9.2, §9.4, §9.7 and §9.9 respectively.
  - **"§7.2 rule 5".**
    - Location: `registry.ts:203`.
    - Problem: matching is §6.6, and gate 5 is retired.
    - Fix: goes with B-322.
  - **§4 for the event log.**
    - Location: `db.ts:7`.
    - Problem: the data model is §13.8.
    - Fix: §13.8.
- **R-BTN-61 cited for `?limit=`.**
  - Location: `baton.ts:1000`.
  - Problem: `?limit=` is R-BTN-99/§6.7's recommendations. R-BTN-61 is merging.
  - Fix: cite R-BTN-99 (§6.7). The code caps at 50, a number no rule states; §14 gives a default of 10 and `all` ≤ 500.
- **R-BTN-66 cited for tiers.**
  - Location: `baton.ts:1954`.
  - Problem: R-BTN-66 now says the opposite: tiers are retired (changelog of 2026-11-23).
  - Fix: goes with B-322.
- **R-BTN-184 cited for the `tickets-approved` guarantee.**
  - Locations: `baton.ts:1582,2073,2081`.
  - Problem: R-BTN-184 is now a stub pointing at a proposal (12-security.md:557-561). The guarantee is defined in R-BTN-189's table (12-security.md:416) and the refusal in §4.4 (04-tickets-syncs-board.md:424-426), which itself still says "(R-BTN-184)".
  - Fix: R-BTN-189 and §4.4, and fix the spec's cross-reference too.

### Notes

**Spec against code: §13 rows for unbuilt designs.** These rows describe designs that are not built but are written as built. This is a ruling-1 violation, and B-297 misses most of it.
- **Tables with no migration** (B-297 has the first three):
  - `ticket_depends`, `leg_outputs`, `leg_attempts`.
  - `ticket_evidence` and `reconcile_displaced` (R-BTN-203). R-BTN-203 is unbuilt; B-311 is `available`.
  - With them go the history kind `reconcile-queued` (§13.5), §14's ticket read `evidence[]` (14-api.md:115), and "each fact arrival and piece of evidence" in the attestations read.
- **Columns with no migration:**
  - `repositories`: `forge_host`, `forge_repo_id`, `forge_owner_id`, `forge_ids_seen`, `protection_json` (the code has a `protection_reports` table), `artifact_buckets`, `api_keys`, `leg_log_root`. §13.1's `code_repos` JSON is a table.
  - R-BTN-138 (03-repositories-and-forges.md:128-166) states forge ids as built. The code has no ids at all: `checkRegistration` (`registry.ts:94-106`) does not accept `forge_repo_id`, yet §14's registration row requires it. Covered by B-45.
  - `credentials`: `expires_at`, `last_used_at`.
  - `runner_grants`: `sync`, `checker`, `domain`, `set_by`, `accepted_at`. The code has `trust_level`, `trust_domain`, `model_family`, `trust_set_by`.
  - `runners.executor_json` (the code has `isolation`); `runner_capabilities.provided`; `board_snapshots.posted_by`; `ticket_stations.runs_from`; `ticket_next_legs.course_json` and `not_before`.
  - `closed_tickets.final_station`, `final_path`, `kept_json`. §13's close convention, which moves overrides into `kept_json`, has no column to hold them.
  - `claims.error_type`, `blocked_kind`, `blocked_ref`, `fence_deadline`; `claim_legs.repository_id`, `ticket_id`, `next_leg`, `domain`.
  - `ticket_blocks.provisional`, `found`, `binds`.
  - `ticket_overrides.route_leg`, `route_station`, `override_kind`. The code has `retry_after` and `runs_json`.
  - `conditions.ref`, `detail`, `restart`, `reason`, `answered_by`, `run`. The code has `run_id`, `restarts_json`, `default_restart`, `closed_how`, `reraised`.
  - `baton_settings` key `tenant_id`: nothing in `src/` writes or reads it. `retention_runners` holds the retention cursor, not R-BTN-149 settings.
- **Columns in the code that §13 omits:**
  - `courses.person_legs_json` and `.facts`.
  - `claims.course_id`, `offered_leg`, `offered_ready_since`, `regressed_since`, `ended_regressed`.
  - `claim_legs.started_observation`, `bars_judged`, `deadline_rearmed_at`.
  - `leg_run_inputs.ticket_version` and `read_digest`.
  - `ticket_questions.options_json` and the seven `pending_*`/`answered_ref` columns.
  - `ticket_stations.person_expires_at`; `owner_bars.holders_released_at`; `messages.withdrawn`.
  - `credentials.allowed_capabilities`, `allowed_instances`, `revoked_by`; `repository_owners.revoked_at`; `runners.secret_seen` and `model_id`.
  - `tickets.display` (§13 says `display_json`) and `requires_clause`, `operator_only`, `depends_on`, `blocked_by`, `brief`.
  - `board_head.handed_out_at` (§13 says `observation_issued_at`).
- **Other schema notes.**
  - `runners.harness` carries `CHECK IN ('opencode','claude-code')` in the live schema, while §13.3 says "a label". This is harness vocabulary in the schema, which the 2026-11-19 review wanted out of normative text.
  - Tables §13 does not name: `code_repos`, `course_refusals`, `dependency_consents`, `deprecated_fields`, `human_keys`, `pending_transcripts`, `policy_conditions`, `policy_floors`, `protection_reports`, `spawned_children`, `webhook_dispatch`. Plus the deprecated tables in A.

**Spec against code: §14 shapes.**
- `GET …/conditions` (14-api.md:121): `?person=1` and `questions?` are not built (`reads/conditions.ts:159-188`, `conditions.ts:265`). The reply has `cursor`, not `next_cursor`. `open=true` is also accepted.
- `GET …/board`: `holders[].worker_id` should be `runner_id` (`claims.ts:2146-2158`). The reply also has `ready_by_tier`.
- `POST /v1/admin/repositories` change form: the code takes `weight`, `tiers`, `sync_keys_add/remove`, `owner_keys_add`, `remote`, `web_base`, `ci_identity`, `sync_workflow` and `mirror_workflow` (`admin.ts:378`). §14 lists `github?`, `forge_repo_id?`, `forge_owner_id?`, `former_paths_remove?` and `confirm?`, none of which the code accepts.
- `POST /v1/admin/keys/{fp}/revoke`: §14 says an administrator's key is `invalid-params`. `revokeKey` never checks `BATON_ADMIN_KEYS`; an administrator fingerprint finds no row and is `not-found` (`admin.ts:603-605`).
- `PUT /v1/admin/settings` also takes `recommended_client` (instanceSettings.ts:87). The §14 row omits it.
- `GET …/legs/{leg}/runs` also answers a session (`actions.ts:205`, `OWNER_READERS`). §14 says owner and admin.
- `PUT …/settings` accepts `remind_after`, `require_signed_control` and `checks` (all retired) and not `artifact_buckets`, `api_keys` or `leg_log_root` (§13.1).
- §14's resolve row: see A, decisions.

**Routes served with no §14 row:**
- Built, and each has a rule body:
  - `GET /v1/sync/head` (§2.1, 02-deployments.md:29).
  - `POST /v1/sync/dependencies` (§4.4, 04-tickets-syncs-board.md:453).
  - `POST /v1/owner/{r}/dependency-consents` (R-BTN-47, 03-repositories-and-forges.md:94-99).
  - `POST /v1/owner/{r}/policy/floors` (B-293's older shape).
  - `GET /v1/ui/session` (`actions.ts:222`, served at `baton.ts:717`). No rule names it.
- Deprecated:
  - `GET /v1/owner/{r}/signing-keys` (B-263).
  - `POST /v1/owner/{r}/couriers` and the three `/v1/courier/*` routes (B-67).
  - `POST /v1/sync/foreign-claim` (B-288).
- No §14 route is missing from the code, except the forge-ids fields above. `POST /v1/forges/{r}/notify` is answered in `front.ts:184`.

**Spec gaps.**
- §13 and §14 are both headed "*(proposal)*" (13-data-model.md:5, 14-api.md:5), yet they describe built tables and routes. The index does not show the mark.
- §5.7's "A course can see how it performs" bullet, which owns the stats read, has no rule id. Code cannot anchor it, and §14 cites "§5".
- Spec and code disagree on the stats fields:
  - §14 lists "advice overridden" and §5.7 does not.
  - Neither lists `hook_failures`, `foreign_writes` or `intake`, which the code serves.
  - The code's default window is 30 days (`stats.ts:47`), a number stated nowhere.

**Stale entry in the history file.** The "Migrations the implementation still carries" register still says `GET /v1/ui/repositories/{repository}/tickets` and `…/runners` "are still served" (BATON_SPEC_HISTORY.md:3982-3984). The 2026-11-20 changelog removed them, and neither route exists in `src/`.

**Instructions inside a ticket.** B-288's plan, step 1 (tickets/B-288.mdx:41-46), tells its implementer to "Read the reference deployment's registry … with an administrator's key the owner supplies". That is a live read with a real credential, which the root CLAUDE.md classes as a stop to quote for the owner. It is ticket text addressed to its implementer, not to this review. I did not act on it.
