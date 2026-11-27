---
title: "Area report — §11 and §12: people and security"
description: "One of eight area reports behind the 2026-11-24 review of the code against the simplified spec, at main 5758cdb: deprecated concepts, unnecessary complexity, missing and stale anchors, each finding at file and line."
tags: [review]
order: 7
---

# Report 07: people and security (§11, §12)

Repository `/home/user/baton` at `5758cdb` (= main, 2026-11-24). Read-only. Spec authority: `spec/BATON_SPEC/11-people.md`, `spec/BATON_SPEC/12-security.md`. I read `spec/proposals/security.md`, `spec/proposals/people-and-dashboard.md` and `spec/BATON_MCP_OAUTH_SPEC.md` only to learn what is unbuilt. No MCP or OAuth code exists in `src/` or `cli/`, which agrees with R-BTN-130 and B-73.

Code read: `src/core/{auth,admin,actions,policy,screens,http,text,links}.ts`, `src/defaults/cli.ts`, `src/defaults/signed-control.ts`, `src/shared/commitSign.mjs`, `cli/{baton,decisions,sign,version}.mjs`. I also did a lighter pass over `src/dashboard/`. Where a cross-check needed it, I looked at `src/core/baton.ts`, `front.ts` and `ownerState.ts`.

`node scripts/check-spec.mjs` warns, for this area: `admin.ts` cites R-BTN-80 and R-BTN-103; `http.ts` cites R-BTN-78 and R-BTN-80; `cli/baton.mjs` cites R-BTN-78 and R-BTN-80; `cli/decisions.mjs` cites R-BTN-80. No file in this area cites R-BTN-154, 97, 169 or 200, and none links to `spec/BATON_SPEC.md#…`.

## Area: People (§11) and security (§12): auth, admin, policy, actions, screens, CLI

### A. Deprecated concepts retained

- **The policy document has the pre-amendment shape** — `src/core/policy.ts:93-152` (`REF_WRITERS` with `courier`, `OutboxRoute{trust,min_release}`, `PolicyDocument` with `approvers.trust`, `grants.*`, `refs.baton/legs`, `authorship`, `leg_state`, `inputs.answers`, `merge.reviews.distinct`), `:376-437` (presets with `courier` deliverers and preset `protected-signed`), `:464-467` (nine `GUARANTEE_NAMES`), `policy_floors` rows with `remove_by` (`:528`, `floorsRoute :874`).
  - What the spec says: §12.8's knob table (R-BTN-188) has `approvers.roles`, `outbox.source`, `repos.unlisted`, a `floors` knob, preset `protected-hardware`, six guarantees, and no `courier`.
  - Covered by B-293. Confirmed.
- **Three guarantee and attestation differences that B-293's table does not list:**
  1. **`human-gates` means something weaker in the code.** `policy.ts:504-507`: the code's `human-gates` is `gates` alone, and the hardware condition lives in a separate `human-gates-hardware`. R-BTN-189 defines `human-gates` as human-only lists **and** `human_key` = `hardware`, and says "The `protected` preset holds all but `human-gates`". In the code, `protected` with human-only owners reports `human-gates: held`. A floor that names `human-gates` accepts a policy under `human_key: any`. This is security-relevant. B-293 lists only the extra name; B-294's invariant assumes the spec's meaning. Confirmed.
  2. **`board-from-trusted` reads a retired knob** (`:508`). The code reads `inputs.answers === 'attestation'`. R-BTN-189 reads the `attestations` entries: no `sync` writer for `std:arrival@1` or `std:decision@1`, and only `human` for `std:decision@1`.
  3. **`attestations` writers.** `checkWriters :183-194` has no `sync` writer class. `validatePolicyDocument :299-310` refuses every writer other than `human`, `baton` and `service:` for any `std:` type. The spec's `cooperative` column admits `sync` for `std:git.*`, `std:arrival@1`, `std:evidence@1` and `std:decision@1`, and `runner` for `std:arrival@1` and `std:effect@1` (R-BTN-191, R-BTN-203). So the spec's own preset would be refused `invalid-params`.
  - Partly covered by B-293 (its table has the `inputs.answers` row only). NOT covered for `human-gates`' meaning, the `sync` and `runner` writer classes, or `board-from-trusted`. Confirmed.
- **The trust-clearing path still writes retired columns** — `policy.ts:773-826`. The `one_per_domain` and `trusted_domain` refusals, and trust clearing on `couriers` and `model_family`, are driven by `grants.*` knobs and `couriers`. R-BTN-188's *Making `approvers.roles` human-only* clears "role, mark and domain" on grants only. Covered by B-293, B-147 and B-67. Confirmed.
- **Stale comments about the signed read and runner pins** (B-160 is done; the signature and pins are gone from the code):
  - `policy.ts:972`: section heading "protection reports **and pins**"; no pin code remains.
  - `policy.ts:835`: "as the signed read counts it".
  - `cli/baton.mjs:59`: "policy show — the signed read (R-BTN-189)".
  - §12.8 says "Baton signs no … policy read".
  - NOT covered (B-160 is closed). Confirmed.
- **Signed control, the brief mark and the owner signing keys are still live** — all of `src/defaults/signed-control.ts` and `src/shared/commitSign.mjs`, plus:
  - `src/defaults/cli.ts:452-484` (`control` record, brief marks, EXPEDITE gate) and `:642-683` (`verifyConfigMain`);
  - `src/core/admin.ts:246-260` (`signingKeys`) and `:1074-1078, 1167-1172` (`require_signed_control`);
  - `cli/baton.mjs:50-58, 76-79, 100, 291, 561-566, 1162-1228, 1349-1351` (`owner sign`, `owner verify-config`, `--require-signed-control`, `ticket show` printing "brief owner-signed");
  - `src/dashboard/screens/credentials/commands.ts` (`settingsSet … --require-signed-control`).
  - What the spec says: R-BTN-66 and R-BTN-13 (§11.1: no `git`-namespace signature); "no commit signature is verified" (changelog, 2026-11-19).
  - Covered by B-263 (exit criteria grep for `signed.control|commitSign`). Confirmed.
- **Tiers are still built through the people surfaces:**
  - `admin.ts:374-451` (`tiers` on repo change, `tier_position` recompute, `max_tier` remap), `:703-764` (`max_tier` on grants), `:1360` (`max_tier` in the grants read);
  - `cli/baton.mjs:18-25, 359-376, 629, 796` (`--tiers`, `--max-tier`);
  - `actions.ts:130` ("per-tier order"), `:346` (`?tier=`), `:408` ("its tiers");
  - dashboard: `BoardScreen.tsx:37,75-101` (`ready_by_tier`), `CredentialScreens.tsx:47` ("Max tier"), `TenantScreens.tsx:68`, `GovernanceScreens.tsx:186`, `RunnerCard.tsx:112-125` (`tier_ceilings`), `TicketsScreen.tsx:5`, `commands.ts:22,36,43`.
  - The spec retired tiers on 2026-11-23 (gate 5, the ladder, `max_tier`, `?tier=`, `ready_by_tier`).
  - Covered by B-322. Its item 5 names only `ByTier`, the tickets filter and the runner ceiling, but its exit criterion ("No `tier` … read or written") covers the rest. Confirmed.
- **The check-runner and checks are still built:**
  - `admin.ts:35-68, 1032-1043, 1107-1160, 1215-1268` (`checks` map, `CONCLUSIONS`, `checkMap`);
  - `policyRead` in `baton.ts:821` (`check_app_id`), `cli/baton.mjs:32,493-502` (`--check-app-id`);
  - `outbox['forge-check']` in `policy.ts` (`:136, 280-285, 340`);
  - the `check-runner` principal in `actions.ts:25` and `actions.ts:426`;
  - `screens.ts:37` (`repository/check-runners`), `nav.ts:21,46`, `CheckRunnersScreen`, `TenantScreens.tsx:334`.
  - What the spec says: §10 "to be removed"; ruling 5.
  - Covered by B-290 for the server, the knob, `check_app_id` and the screen row. B-290 does **not** list `actions.ts`' `check-runner` principal or `nav.ts`, nor the spec spots: R-BTN-129's principal list, R-BTN-159's "check-runner … are SSH keys", §12.1's Check-runner row, R-BTN-127's `owner check-runner` and `admin check-app create` rows, R-BTN-57's `check-app create`, §12.7's check App paragraph, and R-BTN-186's `check_runners`. Confirmed.
- **The mirror and the cutover/adoption machinery are still built:**
  - `auth.ts:76-125` (the GitLab `#mirror` audience role);
  - `admin.ts:38, 389-404, 446, 479` (`mirror_workflow`, `role: 'mirror'` sync keys);
  - `cli/baton.mjs:18-23, 359-376` (`--mirror-key`, `--mirror-workflow`, `--cut-over`);
  - `actions.ts:309-322` (`repo.cutover`, `adoption.confirm` session writes), `:391` ("The mirror's view");
  - `http.ts:53,67` (`not-cut-over`);
  - dashboard: `Strip.tsx:24-41` (SHADOW), `SyncScreen.tsx`, `ConditionsScreen.tsx:43` (adoptions), `RunnerCard.tsx:45` ("legacy runner's claim"), `commands.ts:29` (`mirrorKeyAdd`).
  - What the spec says: R-BTN-193 "legacy, removed with its code"; ruling 4.
  - Covered by B-288 (it names `auth.ts`, `admin.ts`, `/v1/ui/cutover` and `not-cut-over`). It does not name the spec's non-"legacy"-marked mirror mentions in R-BTN-129 (`mirror` principal), R-BTN-159 and R-BTN-127 (`--role sync|mirror`, `repo mirror`), nor the dashboard files. Confirmed.
- **Couriers and notices for people (R-BTN-80 and R-BTN-103 are retired):**
  - `admin.ts:6, 146-147, 567-601` (`pool`, courier revocation), `:825-900` (`couriers`), `:1023, 1085-1087` (`remind_after`);
  - `cli/decisions.mjs` whole file (`baton decision list` is "the CLI courier" over `/v1/courier/*`);
  - `cli/baton.mjs:77-78, 101-103, 570-572, 587-602` (`owner courier add|revoke`, `--remind-after`);
  - `http.ts:73` (`closed`);
  - `ConditionsScreen.tsx:41-42`, `GovernanceScreens.tsx:122`;
  - `auth.ts:240` and `admin.ts:1373` ("probe, courier and sync keys").
  - What the spec says: R-BTN-127's `decision list` is `condition.list` (R-BTN-163). R-BTN-159 lists no courier key.
  - Covered by B-67 (phase 4) and B-56 (`decision list` on conditions). Confirmed.
- **Runner bearer tokens and `CREDENTIALS` (the R3-1239 transition)** — `auth.ts:159-182` (`verifyRunner`, `TOKEN_HASHES`), `admin.ts:88-89, 573-574, 587` (`TOKEN_CREDENTIAL` accepted by `revokeKey`).
  - The spec has only SSH or API keys (R-BTN-13, R-BTN-159). The history's *Bearer-key migration* keeps the transition until B-8's migration runs.
  - Covered by B-8. Confirmed.
- **The grant route still expands role names server-side** — `admin.ts:719-722` (`capabilitiesOf(raw)` over the vendored `ROLES`).
  - What the spec says: R-BTN-157: "A grant holds capabilities only: the CLI expands a role from the repository's latest accepted snapshot". R-BTN-58: "never a role name".
  - Covered by B-10 (the `ROLES` window in the history). Confirmed.
- **The pending sign-in cookie constant is unused** — `http.ts:117-118` (`PENDING_COOKIE`, re-exported at `admin.ts:26`; nothing reads or sets it). R-BTN-16: "Baton sets one cookie and reads no other … A second cookie, for a pending sign-in by code, is proposed."
  - NOT covered (B-76 would build it, nothing removes the stub). Confirmed.
- **The dashboard has a client for confirmation codes that the server never sends** — `src/dashboard/app/controls/Controls.tsx:5-17` (`202 {confirm_code}` dialog, `CODE_MS = 120_000`), `lib/api.ts:53-55`, `lib/reads.tsx:7-9, 268` (`fast` polling).
  - No server route answers `202 {confirm_code}`. R-BTN-155: "Not built: … confirmation codes".
  - Waits on B-76. NOT covered as dead code. Likely.
- **CLI commands of retired designs and transitions that R-BTN-127's table does not list:**
  - `repo migrate-markers` (`cli/baton.mjs:116, 1264-1268`; `src/defaults/cli.ts:536-636`, the B-100 one-time fold);
  - `--scope worker|runner|host` "is retired" messages (`cli/baton.mjs:441-444`, B-68's window);
  - `test-course` (`:166, 1129`);
  - `ticket show` (`:97-100`);
  - `queue …` (`:111-114`, R-BTN-202, built, but absent from the table).
  - R-BTN-127: "Every command is in the table below." Renames are covered by B-157. `migrate-markers` and the `--scope` window: NOT covered. Confirmed.

### B. Unnecessary complexity

- **The protection-report pipeline is unreachable**:
  - `policy.ts:982-1003` (`recordProtection` and `isProtectionChecker` require `runner_grants.role = 'protection-checker'`);
  - `:948-970` (`raiseLapsedReports`), `:617-628` (`protectionOk`).
  - No route sets a role (R-BTN-180: "not built … every grant is a `runner`"). `ownerState.ts:267` refuses every role but `runner` and `trusted-runner` on import, so `'protection-checker'` cannot arise by any path. The value is also the wrong shape: the spec has a `checker` mark on a `trusted-runner` grant, not a role. As a result `no-runner-lands` and every guarantee that includes it are permanently broken.
  - Covered in intent by B-147 (the role route) and B-293's last row (columns). The `'protection-checker'` value against `ownerState`'s whitelist is NOT noted anywhere. Confirmed.
- **The CLI keeps a hand-kept copy of the knob list, and it has drifted** — `cli/baton.mjs:972-979` (`POLICY_KNOBS`) has no `'human_identity'`, which `src/core/policy.ts:139-146` `KNOBS` has. So `baton owner policy diff` never reports a `human_identity` change. The CLI's `knobOf` (`:982`) also skips the core's `readings.*.signed` stripping (`policy.ts:357-363`). B-293 says the CLI copy "matches the code", which is not true. NOT covered. Confirmed.
- **`baton owner policy diff` takes a different argument than the spec** — `cli/baton.mjs:1027-1038` diffs against a FILE. R-BTN-127's row is `owner policy diff <repository> [<version>]` (a stored version). NOT covered (B-157 is about renames). Confirmed.
- **`paths.control: trusted-runner` is a knob value nothing uses** — `policy.ts:118, 233`. No preset uses it, and nothing enforces `paths.*` (R-BTN-184 is proposed). It still makes `no-runner-lands` hold (`paths.control !== 'any'`, `:489`). NOT covered (B-165 does not name it). Likely.
- **Dead error code `provider-suspended`** — `http.ts:53, 65`. It is declared and mapped, never thrown anywhere in `src/`, and absent from §14's error table. NOT covered. Confirmed.
- **Action matching helpers used only by tests** — `actions.ts:503-517` (`matchAction`, `bodyMatches`). They are used by `test/unit/actions.test.ts` only; production uses `matchActions`. Its comment claims R-BTN-129 answers "`invalid-params` then"; R-BTN-129 says a request matching no action is `404 not-found`. NOT covered (B-25 would use it). Likely.
- **Owner-session code paths for a design that is not built** — `actions.ts:19-21, 92-98, 535-547` (`SessionRole 'owner'`, `SESSION_REPO` and `SESSION_ANY` roles, `actionsFor`' owner branch), `screens.ts:9-11` (`ScreenRole 'any'` described as "an owner's"), `SignIn.tsx` role rows. Owners' sessions are proposed (R-BTN-155, B-76). This is a deliberate seam, but it is dead today. Covered by B-76 (builds them). Likely.
- **The dashboard's command lines are another hand-kept list** — `src/dashboard/screens/credentials/commands.ts` (old names: `owner grant`, `owner revoke`, `owner owners`, `--max-tier`, `--tiers`, `--add-mirror-key`, `--require-signed-control`). This is one more copy that R-BTN-129's registry is meant to generate. Covered by B-25 and B-157 (and the tier, mirror and signed-control tickets above). Confirmed.

### C. Missing anchors

- `src/core/admin.ts:613` `loginLink`: one-time link, 5 minutes, single use, hashed token. Should cite R-BTN-155 (§11.4) and §12.1 *Bearer secrets*.
- `src/core/admin.ts:626` `login`: link or Access exchange, the "minting key is an administrator's" check, the `{act:'login', via:'access'}` event with the email's SHA-256. Should cite R-BTN-155.
- `src/core/admin.ts:670` `session` / `:657` `accessFingerprints`: a session ends when its key leaves `BATON_ADMIN_KEYS` or its Access line changes. Should cite R-BTN-155.
- `src/core/admin.ts:567-572` `revokeKey`: an administrator revokes any key at once, and an owner key leaves every repository it owns. It cites only R-BTN-188 and B-145. Should cite R-BTN-57 (*Revocation*).
- `src/core/admin.ts:771` `revokeGrant`: should cite R-BTN-58 and R-BTN-188 (`approvers.members`); the section heading alone carries R-BTN-58.
- `src/core/auth.ts:189` `equalBytes` and `:259` `verifyApiKey`'s full-digest compare: constant-time comparison of bearer secrets and MACs. Should cite §12.1 *Bearer secrets* (R-BTN-159 is cited only on `verifyApiKey`).
- `src/core/auth.ts:236` `MAX_SIGNED_BODY`, `src/core/policy.ts:157-159, 240, 264` (`APPROVERS_MAX` 8, `PATHS_MAX` 64, `ENTRIES_MAX` 32, `reviews.count` ≤ 10, `human_identity` ≤ 100), `admin.ts:28-36` (`OWNERS_MAX` 16, `CAPABILITIES_MAX` 64, …): numeric bounds with no rule. Either the spec states them (R-BTN-188 for the policy's, R-BTN-58 for owners and capabilities) or the code says "spec-silent" as `admin.ts:27` already does.
- `cli/baton.mjs:1115-1128` `main`'s B-138 working-tree refusal (an owner or administrator key runs a released CLI only; `--dev` override). This is built behaviour with no rule. The spec has only R-BTN-197's `+dev`, and the 2026-11-18 adversarial review (PPL-22) asked for a bullet under R-BTN-57. Needs a rule id before it can be anchored.
- `cli/baton.mjs:629-649` `confirmAsk`, and the `confirm` fields on `admin repo retire`: these implement §12.2's "the CLI asks or takes `--yes`". They cite "§12.2" only; there is no rule id because §12.2 has none.

### D. Stale or wrong anchors

- `src/core/admin.ts:22`: cites R-BTN-57 for "a one-time link lives 5 minutes; a session 12 hours". The numbers are R-BTN-155's (the 12 hours agrees with the spec now; B-296 asks the owner). Fix: cite R-BTN-155.
- `src/core/http.ts:113-118`: `SESSION_COOKIE` "(R-BTN-57)", and `PENDING_COOKIE` "(R-BTN-155)" for a cookie R-BTN-16 calls proposed. Fix: R-BTN-155 and R-BTN-16; delete the pending cookie.
- `src/core/http.ts:72`: `blocked` cites retired R-BTN-78. §14 cites R-BTN-75. Fix: R-BTN-75.
- `src/core/http.ts:73`: `closed` cites retired R-BTN-80 (notices). Fix: removed with B-67.
- `cli/baton.mjs:79, 614`: `owner resolve` cites retired R-BTN-78. Fix: R-BTN-163 (`ticket resolve`).
- `cli/baton.mjs:77, 102, 570, 919`, `cli/decisions.mjs:1, 8`, `admin.ts:146, 591, 599, 825, 1023`: cite retired R-BTN-80. `admin.ts:575` cites retired R-BTN-103 (`pool`). Fix: removed with B-67.
- `src/shared/commitSign.mjs:1`, `cli/sign.mjs:1` (and `auth.ts:220`): "R-BTN-13 as amended" for owner-signed commit verification. R-BTN-13 now says no `git`-namespace signature. `sign.mjs` is fine for request signing, but "§10.1/§10.6" are wrong. Fix: `sign.mjs` cites R-BTN-13 (§11.1); `commitSign.mjs` goes with B-263.
- `src/defaults/signed-control.ts:2` and `src/defaults/cli.ts:741`: cite "R-BTN-66 as amended" for `require_signed_control`. R-BTN-66 now says the opposite. Removed with B-263.
- `src/core/actions.ts:226`: "R-BTN-155's table says what each takes". R-BTN-155 has no table; the session write routes are §14's. Fix: cite §14.
- `src/core/actions.ts:94` and `src/core/screens.ts:9-11, 20-21`: claim "an owner's [session] on those its key still owns (R-BTN-155)". R-BTN-155 lists owners' sessions as not built. Fix: mark them proposed (people-and-dashboard §3).
- `src/dashboard/app/controls/Controls.tsx:6, 17`, `lib/reads.tsx:9, 268`, `lib/api.ts:55`: cite R-BTN-155 for confirmation codes and their two-minute life. Those now live only in the proposal (§3). Fix: cite the proposal, or remove.
- `src/core/auth.ts:1-3`: "BATON_SPEC §10.1 … the owner, by Cloudflare Access (R-BTN-16)". §10 is now Checks, and owners authenticate by key; Access binds administrator keys (R-BTN-155). Fix: §12.1, R-BTN-155.
- `src/core/auth.ts:159-163`: `verifyRunner` "(§10.1, R-BTN-13)" for bearer tokens. R-BTN-13 is SSH keys. Fix: cite the history's bearer-key migration and B-8.
- `src/core/auth.ts:144-145`: `verifyOwner` "legacy … (R-BTN-16)". The Access-only path with `OWNER_EMAILS` is a current clause of R-BTN-155. Fix: R-BTN-155; drop "legacy".
- Old section numbers that now point at the wrong section (§10 is Checks; lettered sections no longer exist):
  - `admin.ts:3` and `cli/baton.mjs:2` ("§10.6");
  - `admin.ts:86`, `text.ts:1`, `links.ts:1, 33`, `validate.ts:128` ("§10.4" for free text and links; now §12.3);
  - `http.ts:1` ("§10.5, §11"; now R-BTN-16 §12.4 and §14), `http.ts:54-80` ("§11" for error codes; now §14);
  - `http.ts:38` ("§13a"), `auth.ts:469` ("§3a"), `links.ts:1` ("§2k"), `src/defaults/cli.ts:1,9` and `signed-control.ts:10` ("§2f", "§2b");
  - `src/defaults/cli.ts:638` and `:751` ("§7.1" for the sync; §7.1 is *Raising a condition*);
  - `links.ts:42, 96` ("§6.8" for `transcript_repos`; §6.8 is overrides; the rule is R-BTN-20).
  - Fix: cite the R-BTN id instead of the number.
- `src/defaults/cli.ts:638-641`: the doc comment "One sync (§7.1) …" sits above `verifyConfigMain` instead of `syncMain` (misplaced).
- `src/core/admin.ts:6` and `:1373`: list the key roles as "administrator, owner, runner, probe, courier or sync". §12.1's list is administrator, owner, runner, check-runner, instrument, sync and mirror.
- `cli/baton.mjs:63`: `protected-signed` preset. Spec: `protected-hardware` (B-293).

### Notes

- **The spec states as built some things the code does not have:**
  - **API keys minted by Baton.** R-BTN-159: "Baton can mint a runner's API key … `baton owner grant add --api-key --name <name>` (`POST /v1/owner/{repository}/grants {name, api_key: true, capabilities}`)". `Admin.grant` (`admin.ts:710`) accepts no `api_key` or `name`, and no ticket names it. The rule's *Lifetime* clauses (90 days, 7 idle days) and the `api_keys: false` setting are also not built; those two are covered by B-8.
  - **R-BTN-127's command table.** It marks only some rows *proposed*, but the CLI has none of these:
    - `leg why|log|runs|stop`;
    - `ticket hold|unhold|expedite|cancel`;
    - `repo policy|spool|mirror`, `course test`;
    - `runner accept-grant|decline-grant`;
    - `owner grant flags`, `owner bar follow`, `owner settings show`, `owner sync-key …`, `owner sync want`;
    - `admin key hostname`, `admin keys set`, `admin forge-secrets set`, `admin github-app create`, `admin check-app create`, `admin reading set`;
    - `server start` (the local host is `scripts/start-local.mjs`).
    - B-157, B-23 and B-301 cover parts of this. The spec should mark the rest, since its own rule says an unmarked row is built.
  - **§11.4 understates what is built.** It says "What each screen draws, its controls, polling and wording are not built", but `src/dashboard/` has screens, `Controls.tsx` (B-207) and the polling layer (`reads.tsx`, B-221).
  - **§12.1's Check-runner row** states claim, advance and end powers as built, while §10 says the check-runner is not built.
- **Where the spec and the code disagree, with no ticket:**
  - **Refusals name the key's role.** §12.1 says a registration refused for a key holding another role is `conflict` and "the refusal does not name the role" (the no-existence-oracle rule). The code names it: `admin.ts:228, 559, 735, 883` (`"this key is already a ${role} key"`) and `:943` ("an administrator key"). Only `admin keys set` is covered (B-76). Confirmed.
  - **Administrators pass `key:` lists.** R-BTN-188 says an administrator "matches an `owner` entry on every repository and no other". `requireMembersApprover` (`admin.ts:270-279`) lets an administrator pass any list that is not human-only, including `[key:<non-human owner>]`. R-BTN-57's narrower wording ("forbidden where that list is human-only") is what the code follows, so the spec contradicts itself. Likely.
  - **Free text accepts backticks.** §12.3 forbids `` ` `` in free text. `isFreeText` (`text.ts:9`) and `freeText` (`validate.ts:128-133`) refuse only `< > { }`. B-46 item 4 ("backticks") may cover it. Confirmed gap.
  - **Revoking an administrator key answers the wrong code.** R-BTN-57 says `admin key revoke` naming an administrator's key is `invalid-params`. `revokeKey` answers `not-found`. Covered by B-76.
  - **Break-glass, headers, confirmations and session length** are covered: B-294 (`humanEntryOk`, `policy.ts:690-694`; `ApproverFacts` doc `:21-36`), B-300 (`SECURITY_HEADERS` missing three CSP directives and CORP; no `Sec-Fetch-Site` check; no `confirm` on `owner.owner.remove`, `owner.grant.revoke`, `admin.key.revoke` or `leg.stop`, the last in `actions.ts:228`'s input schema too) and B-296 (12 hours now agrees between R-BTN-155 and R-BTN-16).
- **Compatibility shims the spec itself keeps:**
  - The policy read's `valid_until = at` "for CLI 0.1.3 and 0.1.4 compatibility" (R-BTN-189; `baton.ts:824-826`). R-BTN-197's `min`, now `0.0.0` (`http.ts:31`), is the tool to retire it.
  - `check_app_id` in that read (B-290).
- **Duplication inside the spec in this area:**
  - §11.4 says `screens.ts` is "the one table" and then lists every screen path again.
  - R-BTN-127's 60-row table, §12.2's confirmed list and R-BTN-186's delegated list are hand-kept (B-25).
  - The 12-hour session is stated in R-BTN-155 and again in R-BTN-16.
- **Instructions in files.** No file I read contained instructions addressed to me. Tickets' `**Brief:**` lines were read as data.
