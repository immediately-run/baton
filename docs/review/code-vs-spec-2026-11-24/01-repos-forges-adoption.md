---
title: "Area report — §1–§3 and §16: repositories, forges, adoption"
description: "One of eight area reports behind the 2026-11-24 review of the code against the simplified spec, at main 5758cdb: deprecated concepts, unnecessary complexity, missing and stale anchors, each finding at file and line."
tags: [review]
order: 1
---


Read: spec/BATON_SPEC/01, 02, 03, 16; spec/proposals/multi-tenancy.md and branch-course.md (to know what is unbuilt); the History changelog from 2026-11-19 on, *Retired requirements*, *Old § → new §* and *Migrations the implementation still carries*; tickets B-288, B-301, B-45, B-46, B-263, B-264, B-275, B-300, B-322 and others where cited. Code: every file in the brief, and every hit of mirror, cutover, shadow, legacy, adopt, IR_BATON_ and mirror_pusher in src/ and cli/.
The rule text in spec/BATON_SPEC/ was the authority for every finding. Confidence is shown on each: **confirmed** means it was checked in both the code and the rule text; **likely** means one inference was not executed.

---

### A. Deprecated concepts retained

- **The mirror and adoption machinery is fully live** — `src/core/mirror.ts:1-132`, `src/core/cutover.ts:1-178`; wiring in `src/core/baton.ts:22-23,74-75,145,207-209,671-685` (`GET /v1/sync/events`, `POST /v1/sync/foreign-claim`), `:1011-1013` (`/v1/runner/adopt`), `:1058-1060` (`/v1/runner/shadow-report`), `:1092-1100` (`/v1/ui/cutover`, `/v1/ui/adoptions/{t}/confirm`), `:2396` (`adoptions` in `stateView`); `src/core/runnerApi.ts:518-520` (the heartbeat's `mode` map), `:804-857` (`mode()`, `shadowReport()`). Ruling 4 says §16 can go, and §16 itself says "Legacy, removed with its code (R-BTN-193)". The code is complete, routed and tested. **Covered by B-288**; confirmed.

- **Mirror and cutover leftovers in files B-288 does not list** — B-288's plan names `baton.ts`, `ports.ts`, `runnerApi.ts`, `claims.ts`, `blocks.ts`, `capacity.ts`, `ownerState.ts`, `retention.ts`, `auth.ts`, `admin.ts`, `policy.ts`, `registry.ts`, `src/runner/`, `defaults/cli.ts`, `ticket-state.ts` and `cli/baton.mjs`. It does not list these:
  - `src/core/actions.ts:25` (the `'mirror'` principal), `:314-315` (the `repo.cutover` action) and `:391` (`repo.sync` is summarised as "The mirror's view…, mode, pending adoptions").
  - `src/core/reads/sync.ts:46-52,109,131,138` (`repo.cutover` in `allowed`, `adoptions`, `mirror_workflow`, `mode`).
  - `src/core/reads/repositories.ts:28,99` (`mode: 'shadow' | 'cut-over'`).
  - `src/core/reads/conditions.ts:150` and `src/core/reads/credentials.ts:32-33` (`role: 'sync' | 'mirror'`).
  - `src/core/http.ts:53,66` (`not-cut-over`) and `src/core/validate.ts:513` (`checkShadowReport`).
  - `src/core/webhook.ts:29-31,217,347-356` (`MIRROR_EMAIL`, `ACTIONS_BOT`, `mirror_workflow` in `ownWork`). R-BTN-73 keeps this as "legacy (§16)".
  - `src/local/testCourse.ts:416`: the test kit calls `core.cutover.cutover(...)` on every run.
  - `src/dashboard/screens/credentials/commands.ts:29` (`--add-mirror-key`) and `types.ts:120` (`mode`).
  - `wrangler.toml:34`, the next item.

  **Partly covered by B-288** (the mechanism is named; these files are not). Confirmed.

- **The `BATON_REPOSITORIES` seed still registers docs in shadow, with a mirror** — `wrangler.toml:34`. The docs entry carries `"mirror_workflow":".github/workflows/baton-mirror.yml"` and no `"cut_over":true`. The comment at `:30-33` says the seed exists "so a rebuilt instance serves…". Because the seed is insert-only it is harmless on the live instance, but a rebuilt one would re-create docs in shadow, with a mirror. That contradicts ruling 4 ("docs has cut over") and §16.2 ("The rollout is complete"). **NOT covered** (B-288 checks the live registry, not the seed); confirmed.

- **The live sync dispatcher sits inside `mirror.ts`** — `src/core/mirror.ts:134-154` (`dispatchWorkflow`) is imported by `src/cloudflare/baton.ts:21,43` and `src/local/host.ts:64,120` as `Dispatch.send` for every sync and unblocked dispatch. B-288 step 3 says "Remove `mirror.ts`" and does not say this must move first. **NOT covered (a gap in B-288's plan)**; confirmed.

- **Dispatch uses a personal access token, not the GitHub App** — `src/cloudflare/baton.ts:43` and `src/local/host.ts:120` pass `GITHUB_DISPATCH_TOKEN`. `src/core/ports.ts:230-232` describes it as "a fine-grained token, Actions: write on docs only", and `src/local/main.ts:10,62` accepts it.
  - The spec has no such variable. R-BTN-55's `GitHubApp` row (`BATON_GITHUB_APP_ID`, `BATON_GITHUB_APP_KEY`), §3's adapter table ("`{kind: 'github-app'}`: `workflow_dispatch` with an installation token minted from the App's key (§12.7)") and §12.7 ("mints short-lived installation tokens per repository … in the host shell's `Dispatch`") describe a different design.
  - Neither App variable occurs in `src/` or `cli/`.
  - `mirror.ts:140` says "R3-1247 moves this to the GitHub App's installation tokens", but R3-1247 is archived `done` and did not do it.

  **NOT covered** (B-131 is about per-claim runner tokens, not Baton's dispatch); confirmed.

- **Bearer-token and seed-key configuration** — `src/core/ports.ts:222-229` (`TOKEN_HASHES`, `CREDENTIALS`, `BATON_KEYS`), `src/local/main.ts:56-58`, `src/core/runnerApi.ts:96-109`, `src/core/auth.ts:164-172`, `src/core/baton.ts:254,785`. These are not in R-BTN-55's table. History's *Bearer-key migration (R-BTN-117)* entry says to stop accepting them once that migration has run. **Covered by B-8** (it builds the migration); confirmed.

- **`--signing-key` is accepted and ignored** — `src/local/main.ts:77` ("Retired; accept old launch commands"). No spec or migration entry keeps it. **NOT covered**; confirmed.

- **Tiers in the registry, retired 2026-11-23** — `src/core/registry.ts:10,18-20` (`TIER_NAME`, `DEFAULT_TIERS`), `:39,66,105-107,158` (`tiers` validated and refused with `invalid-params`), `:203-218` (`ceilingIn`, `tierPosition`), `:249-254` (stored). Also `src/core/admin.ts:372-386` (a change's `tiers`, validated) and `src/core/cutover.ts:183-184` (inserts `tier_ceiling 'critical'`).
  - The migration entry says a registration's or change's `tiers` "are then accepted and ignored, never validated … each logging one `deprecated-field` event".
  - The code still validates them and refuses on a bad value. The heartbeat does the same with `tier_ceilings`, refusing `invalid-params` at `src/core/runnerApi.ts:305-312`, which the entry warns against ("a refused heartbeat would get a live runner reaped").

  **Covered by B-322**; confirmed. Ordering note: `cutover.ts:183` writes `tier_ceiling`, so a migration that drops that column before B-288 lands breaks the legacy import.

- **The brief mark (signed control, retired 2026-11-19)** — `src/core/provenance.ts:6-9,124-132` (`briefMark`), served from `baton.ts:2336` and `claims.ts:444`. R-BTN-194 now serves `last_written_by` alone. **Covered by B-263**; confirmed.

- **`IR_BATON_*` and `mirror_pusher` are already gone** — only comments remain (`src/runner/api.ts:60`, `claimRun.ts:1169`, `main.ts:377`), and `mirror_pusher` has no occurrence. B-288 step 4 ("Remove … the `IR_BATON_*` variables") is therefore stale. "Runs before run ids" survives only as migration 0038's backfill (`src/migrations/index.ts:84-91`), which is append-only and correctly kept. Nothing to remove; confirmed.

- **A deployment's transcript repositories hard-coded in core** — `src/core/registry.ts:193-201` (`DEFAULT_TRANSCRIPT_REPOS = ['immediately-run/claude-sessions', 'immediately-run-worker/session-transcripts']`), used by `runnerApi.ts:258-263,299,642` and `claims.ts:1306` whenever a repository names none.
  - §13 says the `transcript_repos` default is `[]`.
  - R-BTN-20/§9.9 validates `repo` against the home's `transcript_repos` with no fallback.
  - The front page says a named deployment is "an example, not" normative.

  **NOT covered**; confirmed.

- **Short-name `repos:` read in core, "docs' interim post"** — `src/core/webhook.ts:358-374` (`targets`), `src/core/claims.ts:2208-2212` (`branchHolder`), `src/core/codeRepos.ts:213-241` and `src/core/scope.ts:33`. Core resolves bare names under the home's owner. R-BTN-92 says every repository name a ticket carries "is a forge path naming the home or an entry with reach", and §4.4 says `repos` arrive "resolved by the sync from short names". `board.ts:398-399` (`checkInterim`) still admits the interim post; that belongs to §4's reviewer. **NOT covered** for the core-side reading; likely (whether the interim post is still sent was not checked live).

- **Two half-built sync-want columns** — `repositories.sync_wanted_at` and `sync_wanted_after` (`src/migrations/0012_forges.sql:11-12`) are never read or written. Their only writers are the retirement's clears (`src/core/admin.ts:476-477`, `src/migrations/0050_retirement.sql:16`). `admin.ts:466` claims retirement deletes "its sync wants". R-BTN-94 lists the stored want as **Not built** (the tickets-and-sources proposal). **Covered by R3-1263** (which would build or use them); confirmed.

### B. Unnecessary complexity

- **The cutover filter on dispatch** — `src/core/baton.ts:273-285` (`flushDispatch`, `own(wf) || cutoverAt(...) != null`), with the `own` flag threaded through `src/core/ports.ts:186-188` and `baton.ts:360-367`. Without §16 the rule is "after the commit that wants one, through `Dispatch`" for every repository that has a target. **Covered by B-288** (step 3, added 2026-11-20) and B-301 row 3; confirmed.

- **Two coalescing tables for one rule** — R-BTN-94: "The window is the `webhook_syncs` row of that repository and workflow"; R-BTN-73's backstop "stamps the repository's `webhook_syncs` row (`last_dispatch_at`)". The code keeps two tables, both keyed by repository:
  - `webhook_dispatch` (`last_dispatch_at`, `trailing_at`) is the window.
  - `webhook_syncs` (`last_dispatch_at`) is the backstop stamp.

  See `src/core/webhook.ts:286-308,326-335,377-389`. `receive` and `dueSync` write the same instant into both. Either the rule describes one row and the code needs only one, or the rule must name both. **Partly covered by B-301 row 2** (it covers the window's scope, not the second table); confirmed.

- **Retirement clean-up done twice** — `admin.ts:487-488` deletes a retired repository's `webhook_dispatch` and `webhook_syncs` rows in the retiring transaction. Yet `webhook.ts:36-38,45-46` (the `STALE_QUERY` and `EARLIEST_STAMP` joins) and `:379-381` (`dueTrailing` nulling `trailing_at` for retired repositories) still filter retired repositories. This defends against rows from repositories retired before B-173, which migration 0050 did not delete. One migration `DELETE` would let three filters go. **NOT covered**; likely (no rows checked on the live instance).

- **"One predicate" stated, not used** — `src/core/registry.ts:363-369` says `live()` is "the one predicate every rule that counts registered repositories reads". In fact about 44 raw `retired_at IS NULL` filters sit across 15 files (`scope.ts`, `retention.ts`, `claims.ts`, `blocks.ts`, `capacity.ts`, `resources.ts`, `dependencies.ts`, `reads/tenant.ts`, …). This is the "retirement aftermath" riders in code form. R-BTN-47 now says it once: "Afterwards every rule reads live repositories only". A `live_repositories` view or the helper would make that one place. **NOT covered**; confirmed (count by grep).

- **Duplicated branch matcher and default pattern** — `src/core/claims.ts:197-226` (`DEFAULT_BRANCH_PATTERN`, `branchMatches`) and `src/defaults/course-pr.ts:54,551-575` hold two copies of the same wildcard matcher and the same default. R-BTN-141 says "the fact adapter, standard station functions, the local branch check and the branch-holder query all apply" one longest-id rule. **Covered by B-46** item 142 ("One matcher, used by the fact adapter…"); confirmed.

- **Registration parsing duplicated between register and change** — `admin.ts:381-385` re-implements `tiers`, `weight` and `sync_keys` checks that `registry.ts:105-112,142-144` already makes, with different regexes (`COURSE_ID` against `TIER_NAME` for tiers). Most of this goes with tiers and the mirror role. **Covered by B-322 and B-288 together**; confirmed.

- **An orphan comment** — `src/local/host.ts:73` ("R3-1236's local `workerd` runner; until it lands, tests inject a fake.") sits above `alarm`, describing a field that does not exist. **NOT covered** (trivial); confirmed.

### C. Missing anchors

- `src/cloudflare/worker.ts:10` (`idFromName('baton')`) and `src/core/ports.ts:273-289` (`Ports`): one tenant, one object, and core reads only the shell's ports. Should cite **R-BTN-135** (§2.2) and R-BTN-55. No code anywhere cites R-BTN-135.
- `src/local/main.ts:84-98`: the origin's form (scheme and host, no path, a loopback default). This is R-BTN-135's *Its origin*; it cites only R-BTN-56. Should cite **R-BTN-135**.
- `src/core/ports.ts:164-168` (`AdminKeys`) and `src/core/registry.ts` / `admin.ts`, where nothing in storage adds an administrator. Should cite **R-BTN-136** (*Administrators belong to a tenant*). No code cites R-BTN-136.
- `src/core/courses.ts:21,82,152-158` (`BRANCH_PATTERN`, `PATTERN_STARS_MAX`, `pattern()`): the branch-pattern grammar. Should cite **R-BTN-141** (§3.4). It also deviates from that rule; see Notes.
- `src/core/claims.ts:204` (`branchMatches`) and `:2196-2222` (`branchHolder`): the pattern's matching and the branch-holder query's reach. They cite R-BTN-51, R-BTN-47 and R-BTN-138, but the rule they implement is **R-BTN-141**. No code cites R-BTN-141.
- `src/core/webhook.ts:24` (`DISPATCH_WINDOW_MS = 30_000`): R-BTN-94's 30-second coalescing window. No anchor; should cite **R-BTN-94** *Coalescing*.
- `src/core/webhook.ts:25` (`DELIVERY_TTL_MS`) and `:243-245`: the 24-hour duplicate-delivery drop and the push record's lifetime. Should cite **R-BTN-73** *Dropped* and *The push record*.
- `src/core/webhook.ts:26-28` (`SYNC_STALE_MS`) and `:326-345` (`dueSync`, `nextDue`): the 10-minute backstop. They cite B-89 and R-BTN-62; should cite **R-BTN-73** *The backstop*.
- `src/core/baton.ts:273-285` (`flushDispatch`): recorded in the transaction and sent after commit, awaited by neither. Should cite **R-BTN-94**.
- `src/core/registry.ts:111-112` (`weight` default 100, 0–10,000): R-BTN-61's merge weight. Should cite **R-BTN-61** (the bound is spec-silent).
- `src/core/baton.ts:387-400` (alarm arming: "missing or more than two periods overdue"): §2.1 *One alarm, every 60 seconds* (no rule id), cited as "§3". Re-point it to §2.1.

### D. Stale or wrong anchors

- `src/core/mirror.ts:1-3,35,64,92` cite §12 for the mirror and §10.3 for dispatch. Old §12 is now §16.3 and old §10.3 is now §3.2/§3.3. `:77` cites "§13 step 3", which is now §16.1. `:140`'s "R3-1247 moves this" is false; that ticket is done. Fix: §16.3 and §3.3 (moot once B-288 deletes the file).
- `src/core/cutover.ts:155,171,187,251,272` cite "§13 step 3" or "§13"; the cutover is §16.1, and old §13 was the rollout. `:187` cites "§4" (old data model, now §13). `:307` cites "§6.10", which is now §9.7.
- `src/core/webhook.ts:1` cites "§7.1 R-BTN-73, §10.1"; R-BTN-73 is in §3.3 and old §7.1 is now §4.3/§4.4. `:29` cites "§12" for the mirror (now §16.3). `:34,341,384` cite "§7.1" (now §3.3). `:297` cites "§3's write budget"; write budgets are only proposed (the multi-tenancy proposal) and §3 has none.
- `src/core/registry.ts:1` cites "§2a R-BTN-47" (now §3.1). `:52` cites "§11" and "§10.4" (now §14 and §12.3). `:193,196,371` cite "§6.8" for transcripts (now §9.9). `:203-207` cite "§7.2 rule 5, R-BTN-66 … R-BTN-58's `max_tier`" for ceilings, which were retired 2026-11-23 (gate 5 is unused). Remove with B-322.
- `src/core/ports.ts`:
  - The section numbers are stale. `:124,207` cite §3a (now §2.1). `:142,154,267` cite §3 (now §2.1). `:180,200,230` cite §10.3 (now §3.3). `:252,257,263` cite §13a (now §15).
  - The `BATON_FORGE_SECRETS` comment at `:233-235` has two mistakes. It gives the entry shape as `{forge, gitlab_issuer?, webhook?, dispatch?}`, where R-BTN-94 says `trigger_token?`. It also says "what the Runner knows", which should be "the Worker".
  - `:239-241` documents "A key in it satisfies every `human` entry of every repository" as intended. That is the defect B-294 tickets: R-BTN-185's break-glass key should not stand in for `human_key`. Covered by B-294.
- `src/cloudflare/worker.ts:1`, `src/cloudflare/baton.ts:15-18,47`, `src/local/host.ts:59,78,132`, `src/local/main.ts:1`, `src/local/queue.ts:1`, `src/local/server.ts:1` and `src/local/store.ts:1` cite §3 and §3a; both are now §2.1. In `src/local/testCourse.ts:1` and the four `§6.13` mentions, §2d is now §5.7 and §6.13 is now §8.3.
- `wrangler.toml`:
  - `:1` cites "BATON_SPEC §3"; it is now §2.1.
  - `:26-28` says "until R3-1240's admin route"; that route exists (`POST /v1/admin/repositories`).
  - `:35-40` says "Cloudflare Access is hardening in front of the dashboard that Baton never reads … B-46 removes the read that remains in the code". That contradicts R-BTN-155, under which, since 2026-11-21, sign-in is built on `ACCESS_IDENTITIES`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
- `src/core/baton.ts:274-276` (`flushDispatch` doc: "claim.sh does"), `:287` ("§10.3"), `:290-291` ("the want it answers stands until a post answers it": no stored want is built, per R-BTN-94's Not built) and `:364` ("§7.1 R-BTN-73"). Fix: §3.3, and drop the want clause.
- `src/core/board.ts:444-446` calls `TICKETS_MAX = 10_000` "spec-silent, recorded on R3-1232" and refuses with `invalid-params`. R-BTN-149 now owns the number: "board post | 8 MB, 10,000 tickets | `too-large`; raises `baton.too-large`". Cite R-BTN-149 and see Notes for the behaviour.
- `src/defaults/forge.ts:3-4` cites "§12.8 R-BTN-180 … R-BTN-180's request bullet". R-BTN-180 has no request bullet; the request command's forge fallback is R-BTN-131 (§5.8, "Where the forge refuses the push because the branch is protected…"). Fix: cite R-BTN-131 only.
- `src/core/mirror.ts:40,98` cites R-BTN-47 for "a mirror reads its own repository's events only"; that statement is R-BTN-15's ("A token reads and writes its own repository's board and events only"). Moot after B-288.
- `src/core/instanceSettings.ts:2,46-71,91-96,114-121` cite "§12.7 R-BTN-115" for `check_app_id`. That stays a valid anchor until B-290 removes the knob (**covered by B-290**).
- `src/core/actions.ts:391` and `src/core/reads/sync.ts:1` call `repo.sync` "the mirror's view". It is the sync screen's read, so the wording is stale (B-288).

### Notes

1. **Behaviour the spec states as built that the code does not do, with no ticket:**
   - **R-BTN-73 *Which sync*.** The rule reads: "A delivery triggers the sync of the repository it names (by id, R-BTN-138) and of each registered repository whose `code_repos` lists it." `webhook.ts:362-374` instead matches by path, and triggers each repository whose *tickets'* `repos:` name the delivery's repository (`ticket_repositories`, short names included), not `code_repos`. The by-id half is B-301 row 5 / B-45. The `code_repos` half is **NOT covered**.
   - **R-BTN-149's board-post cap.**
     - The rule says 8 MB / 10,000 tickets, `too-large`, and raises `baton.too-large`.
     - The code refuses more than 10,000 tickets with `invalid-params`, and raises nothing (`board.ts:465`); `baton.too-large` occurs nowhere in `src/`.
     - A sync-key-signed post is capped at 1 MiB (`auth.ts:240`, `MAX_SIGNED_BODY`) with `invalid-params`.
     - A CI-token post has no byte cap at all (`baton.ts:2425`, `readJson`).

     **NOT covered.**
   - **The local host's body cap.** `src/local/server.ts:161,180` refuses any body over 8 MiB with `invalid-params` before the front sees it. R-BTN-73 requires deliveries up to 26,214,400 bytes and `too-large` beyond on either route ("The local shell does the same", R-BTN-135). **NOT covered.**
   - **R-BTN-55's local column.** `--human-keys <file>`, `--forge-secrets <file>`, `--github-app-id` and `--github-app-key <file>` do not exist in `src/local/main.ts:67-80`.
     - `localConfig` (`:41-64`) also drops `BATON_HUMAN_KEYS` and `BATON_PLAN_LIMITS` from `--config`, so a local host can hold no human keys, which leaves R-BTN-185's break-glass unavailable locally.
     - `ports.ts:247-249`'s "`--plan-limits` locally" is false.
     - The command `baton server start` (R-BTN-55, §11.3's CLI table) does not exist; the host starts with `npm run start:local`.
     - B-300 covers only the `--bind`/`--host` name and R3-1263 only `--forge-secrets`. The rest is **NOT covered.**
   - **R-BTN-141's grammar and reach.**
     - The rule asks for a literal prefix ending `/` or `-`, `{ticket}` exactly once, an optional single trailing `*` matching `[A-Za-z0-9._/-]*`, and at most 128 characters.
     - `courses.ts:21,82,152` accepts any of `[A-Za-z0-9._/{}*-]` up to 200 characters with up to 4 `*`, and `branchMatches` lets `*` match anything.
     - `branchHolder` does not apply "longest id wins", does not restrict to repositories the key is granted on, and checks no reach.

     The builder is **B-46**, but §3.4 states the rule as built with no "not built" marker, and B-301 (which exists to mark §3's unbuilt rules) omits R-BTN-141.
2. **Also stated as built but ticketed elsewhere.** The spec states each of the following as built without a marker, though tickets cover them. Each should join B-301's "Not built" list:
   - R-BTN-135 *Served only at its origin*: the Worker 404s no foreign host (`front.ts:345`), and `wrangler.toml` lacks `workers_dev = false` and `preview_urls = false`. Covered by B-45 item 1.
   - R-BTN-136's secret sink: `baton admin github-app create`, `keys set` and `forge-secrets set` do not exist in `cli/baton.mjs`. Covered by B-45 item 6.
   - R-BTN-15's GitHub `event_name` and `workflow_ref` checks, and GitLab's `ref_protected` and `pipeline_source` checks: absent from `auth.ts:60-75,103-126` and `registry.ts:386-412`. Covered by B-46.
   - R-BTN-94's "Registration refuses a repository whose entry names another forge": not built. Covered by R3-1263.
3. **R-BTN-94's refusal log never fires** (`dispatchWorkflow` swallows errors, so `sendDispatch`'s `dispatch-refused` branch at `baton.ts:309-316` is dead in production). Covered by B-275.
4. **Section status labels disagree with their contents.** §1 and §3 are headed *(proposal)*, yet most of their rules are built and roughly 600 code comments cite them as current. §2 is *(partly built)* but marks only some rules (R-BTN-135's "Served only at its origin" and R-BTN-136's sink carry no marker). The front's convention puts unbuilt text under `spec/proposals/` and in "not built" lines, so these headers mislead.
5. **Coupling between tickets.**
   - B-288 must move `dispatchWorkflow` out of `mirror.ts` before deleting the file.
   - It must also change `testCourse.ts:416`, the dashboard credential screens and `wrangler.toml`'s seed.
   - Its step 4 (`IR_BATON_*`) is already done.
   - B-322's column drop of `runners.tier_ceiling` breaks `cutover.ts:183` unless B-288 lands first or in the same migration.
   - B-262 ("§16.2 step 1's exit") still points at §16.2's rollout plan, which ruling 4 and §16.2 ("The rollout is complete") close. That ticket looks obsolete.
6. **History file.** *Migrations the implementation still carries* still says "Cutover itself — shadow reports, the legacy-claim import and adoption — stays in the specification (§16.1)" (`spec/BATON_SPEC_HISTORY.md`, the docs-deployment entry). Ruling 4 supersedes this.
7. **Provenance's `human` field.** baton's own `CLAUDE.md` makes `last_written_by.human: true` the test of an owner's brief. `src/core/provenance.ts:21-26,86-111` never computes `human` (R-BTN-194 requires `{pusher, pusher_id?, commit, at, human}`), so today every ticket's `**Brief:** the owner …` line is a claim. Covered by B-264 (B-263 step 2 depends on it).
8. **Text addressed to the reader.** No file read for this review contained instructions addressed to me. Tickets B-288, B-301 and B-262 carry the usual `**Brief:**` lines; they were read as data.
