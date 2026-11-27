---
title: "Area report — §6: prerequisites, blocks and advice"
description: "One of eight area reports behind the 2026-11-24 review of the code against the simplified spec, at main 5758cdb: deprecated concepts, unnecessary complexity, missing and stale anchors, each finding at file and line."
tags: [review]
order: 4
---


Read: spec/BATON_SPEC/06-prerequisites-blocks-advice.md (whole), security proposal §4 and §13, history changelog 2026-11-19 → 2026-11-23, Retired requirements, Migrations (tiers, R-BTN-132 window, part-4 fields, bearer keys, notices). Code: src/core/blocks.ts, resources.ts, capacity.ts, dependencies.ts, gates.ts, scope.ts, notices.ts, the prerequisite/block/resource/tier/seat parts of claims.ts and validate.ts, board.ts (posted needs/decisions/blocked_by/operator_only), runnerApi.ts (tier heartbeat), registry.ts/admin.ts (ladder, max_tier), src/runner/sidecar.ts, cli/baton.mjs; grep of src/ and cli/ for tier and resource residue.

`requires.attestations`: **no code**, which is consistent with the spec (§6 header plus the security proposal). `src/core/course.ts:80-84` `REQUIRES_KEYS = {'capabilities'}` refuses every other `requires` key (B-86). Nothing to remove.

No file I read held instructions addressed to the reviewer.

### A. Deprecated concepts retained

- **Tiers, end to end (gate 5, ladder, ceilings, max_tier, tier reads)**. The spec retired them on 2026-11-23 (§6.6 "Gate numbers are stable, so 5 is left unused"; R-BTN-66; history changelog and the Migrations entry *Tier fields from older clients*). The code still has all of it:
  - **Gate 5:**
    - `gates.ts:6` imports `fitsTier`. `:13` `GateRunner.tier_ceiling`. `:27,35` `GateTicket.tier`/`tiers`. `:101` `5: 'above-tier-ceiling'`. `:162-163` refuses by rule 5.
    - `claims.ts:11` imports `fitsTier, TIERS`. `:85-87,100,112` the `RunnerFacts`/`ItemFacts` tier fields.
    - `:484-499` `ladder()` and `ceiling()`, with max_tier capping the ceiling.
    - `:552,575` gate inputs. `:715-716` the reference SQL's rule 5. `:746-787` the projection's `COALESCE(q.tier_position, ?) <= ?`. `:798-806` `ceilingPositions`.
    - `:1074` the failed-rule order lists `above-tier-ceiling`.
  - **Re-tier staleness:** `claims.ts:2635-2656` `staleBoard` releases a claim `re-tiered …`.
  - **The heartbeat still validates tiers. This is the hazard the Migrations entry warns about.**
    - `validate.ts:280-281` refuses a `tier_ceiling` outside `routine|judgement|critical`.
    - `validate.ts:347-357` `checkTierCeilings` refuses a malformed one.
    - `runnerApi.ts:300-312` refuses `tier_ceilings.<repo>` that is not in the repository's ladder (`invalid-params`).
    - The Migrations entry says these fields must be "accepted and ignored, never validated (a refused heartbeat would get a live runner reaped)".
    - The fields are still stored at `runnerApi.ts:332-342, 375-433`.
  - **Ladder:**
    - `registry.ts:19-20,105-107` (DEFAULT_TIERS, registration `tiers`), `:204-218` (`ceilingIn`, `tierPosition`: an unknown name sorts above every ceiling, which caused the 2026-11-23 `above-tier-ceiling` incident).
    - `admin.ts:374-451` (repo set `tiers`, recompute `tier_position`, remap max_tier).
    - `baton.ts:1954-1955, 2013-2026` (stores `tier`/`tier_position`).
  - **max_tier:** `admin.ts:703-764, 1357-1360`; `claims.ts:399-407`; `baton.ts:2263-2273`.
  - **Reads:**
    - `baton.ts:2284-2388` (`readyByTier`, `ready_by_tier`).
    - `reads/tickets.ts:8,33-45` (`?tier=`, refuses an off-ladder value).
    - `reads/runners.ts:69,90,114,231` (`tier_ceilings`); `reads/repositories.ts:21,96`; `reads/tenant.ts:108-117`.
    - `tickets.ts:86,133-247`; `actions.ts:130,346,408`; `ticketView` `claims.ts:465`.
  - **Board post:** `board.ts:28,66,228,237-238,422,501,772,808` still validates a ticket's `tier` (`NAME`); a malformed one refuses the post.
  - **Runner, CLI and sources:**
    - `sidecar.ts:33,243` (`tier_ceiling: this.o.tierCeiling ?? 'critical'`); `runner.ts:46`; `main.ts:38,69,80,102,137,515` (`--tier`).
    - `cli/baton.mjs:20-25,47,120,149,360-378,629,796` (`--tiers`, `--max-tier`, `--tier`).
    - `defaults/tickets-markdown.ts:140`, `defaults/tickets.ts:508,831,1088,1185,1231`, `defaults/request.ts:153-590`; `cutover.ts:29`; `local/testCourse.ts:381,421`.
  - **Dashboard:** `dashboard/screens/credentials/commands.ts:22,36,42,43`, `…/types.ts:53,118`, `runners/types.ts:36`, `tickets/types.ts:17,153`, `lib/types.ts:18`.
  - **Schema:** `ready_tickets.tier_position` and its triggers in migration 0065; migration 0009.
  - **Vendored library:** `vendor/vocabulary.mjs` `fitsTier`/`TIERS`; `vendor/ticketPr.mjs` `tier` control field.
  - **Test:** `test/unit/tiers.test.ts` enshrines the retired behaviour.
  - Covered by **B-322** (its plan lists every one of these groups). Confirmed.

- **The `resource` prerequisite and block (ruling 5)**:
  - **`blocks.ts`:**
    - `:24` `BLOCK_KINDS` includes `resource`.
    - `:37-39, 247-312` `LostAnswer`, `answer_lost`, `lostAnswer`, `settleLost` and the lost-answer branches of `settle`/`evaluate` (`:266-279, 378-384, 391`).
    - `:122-133` `ResourceInfo`/`RunnerAnswer.noInstance`.
    - `:334-354` `desired('resource')` and `expectedBack`.
    - `:403` `forget` deletes `leg_needs`.
    - `:519-570` `posted()` stores the sync's `needs` into `leg_needs` and reports `…:needs:…:unregistered`.
    - `:706-724` `resources()/states()/usable()`; `:775-813` the resource half of `recountRows` (`resource_fleet`); `:825-840` `instancesChanged/instancesRows`.
    - `:850-883` `forRunner`'s resource half; `:921-930` the `no-instance` entries in `blocksOf`; `:988-991` `needsYou.instances_unknown`.
  - **`claims.ts`:** `:864` recommendations skip a leg via `resourceAdvice`; `:986-989` the claim's `advice-overridden` `resource`; `:1053-1058` `resourceAdvice`; `:1548-1549` the advance's override event.
  - **`validate.ts`:** `:1320-1324` `checkBlockedOn` admits `resource:`; `:1191, 1203-1206` `NEEDS_MAX`.
  - **`board.ts`:** `:109, 611, 739` `next[].needs`.
  - **`resources.ts`:** header `:9-10` ("each change is a `resource` event that the blocks recount from"); `addResource`/`addInstance`/`refresh` call `blocks.instancesChanged`.
  - **Reads:** `reads/tenant.ts:150`, `reads/conditions.ts:33` (`instances_unknown`). `mirror.ts:48` filters `resource` events (the mirror itself is B-288).
  - **Schema:** migrations 0016/0043 `leg_needs`, `resource_fleet`, `tickets.answer_lost`.
  - **What the spec says:** R-BTN-76 (§6.3) "The `resource` prerequisite and block. To be removed with its code". The `resource` rows of R-BTN-120's table and R-BTN-75. B-291's description says a blocked end may name a resource. That is wrong: `checkEnd` (`validate.ts:795-800`) admits only `capability`. `checkBlockedOn` is the `?on=` query parser, not the end.
  - Covered by **B-291**. Confirmed.

- **The `decision` block kind, posted decisions and Baton's own `baton:retries`/`baton:stalled` decisions (R-BTN-78, retired 2026-11-01)**. The retirement row says "`hitl.decision`, the `decision` block kind and `ticket_decisions` go with it". §6.2 *Not blocks* now says "Core's `baton.retries`, `baton.contract` and `baton.stalled` (R-BTN-163) write no row". The code still has all of it:
  - **`blocks.ts`:** `:24` `BLOCK_KINDS` has `decision`; `:28-34` `Block.asks/question/options`; `:61-63` `Ctx.decisions` (R-BTN-80 notices); `:71-107` `BATON_DECISIONS`, `decisionOptionActions`, `STALLED_AFTER_MS`, `BATON_WAITS`; `:342-343` `desired('decision')`; `:409-483` raise/answer/postedDecision/answerPosted/raiseStalled/settleStalled; `:521-586` `posted()` stores the sync's decisions; `:995-1026` `view()`.
  - **`gates.ts`:** `:75-77, 129-139` decision rows refuse at a claim and an advance.
  - **`claims.ts`:** `:556-562` the gate's `blocks` query; `:672-673` the reference SQL. `ready_tickets` (0065, line 115) excludes legs on decision rows.
  - **`validate.ts`:** `:1194-1196, 1203-1214` DECISION_* constants citing R-BTN-78/B-110; `:1121-` `checkDecisionAnswer`; `:1320` `checkBlockedOn` admits `decision:`.
  - **Coverage is split:**
    - Baton's own decisions → conditions: covered by **B-56**.
    - The removal of sync-posted decisions (B-110's options and grants) and of the `decision` kind: B-161 points to "B-74's map", and B-74 is `superseded`. B-56 instead keeps posted decisions and adds `hitl.decision`, which B-161 retires.
    - So that removal is **effectively NOT covered** by a live ticket with exit criteria. Confirmed.

- **Notices and couriers (`notices.ts` whole; R-BTN-80/R-BTN-103 retired 2026-10-20)**. Cited files: `notices.ts:1-370`, `blocks.ts:61-63,405,421,431,453,584-585`, `validate.ts:1301-1345` (`COURIERS_MAX`, `checkCouriers`). The Migrations entry "Notices for people to conditions" keeps these until R-BTN-170's phase 4. Covered by **B-67**. Confirmed.

- **R-BTN-132's window: `blocked_by`, `operator_only`, `depends_on`**:
  - `board.ts:68-71, 228-232, 507-512, 772-776, 808-812` still validate and store them.
  - `blocks.ts:323-327` turns `blocked_by` into whole-ticket `ticket` rows.
  - `gates.ts:31-33` keeps `operator_only` "shown, never read".
  - The spec's normative form is posted `depends_at` (R-BTN-120; §4.4 schema). The code has **no** `depends_at` at all (grep finds only one comment, `dependencies.ts:182`).
  - Covered by **B-41** (window phases) and **B-10** (`depends_at`, `requires.tickets`). Confirmed. See Notes 8: the window's stated reading is not what the code does.

- **Interim (bearer / `BATON_KEYS` seed) credential reach in matching**: `gates.ts:16-18` (`grants: null`), `claims.ts:376-400` (`grantsOf` allow-list), `:679-680, 692-695, 709-711` (reference SQL), `blocks.ts:681-697` (`fleet()` allow-list), `resources.ts:233-238` (`mayReport` `repos === null` "reaches all"), `baton.ts:1327-1330`. These are R-BTN-117's bearer-key migration (Migrations, "Stop accepting bearer tokens and `BATON_KEYS` once the migration has run"). Covered by **B-8**. Confirmed.

- **Readings' retired `nonce`/`signature` and the policy's `readings.*.signed`**: `validate.ts:1225-1229, 1240-1244`; `resources.ts:200-201` (`deprecated.note`); `policy.ts:320-322`. These are kept by the "part 4's retired fields" window (30 days with none). No ticket names the window's close. **NOT covered.** Likely.

- **CLI old names in my area**:
  - `cli/baton.mjs:41, 448-458` `baton admin resource set` where the spec says `admin reading set` (R-BTN-127, `11-people.md:255`).
  - `cli/baton.mjs:42-44, 314-320` `baton blocked` where the spec says `baton ticket blocked` (R-BTN-75, `11-people.md:210`). The help text still says "`--on decision:*` is every decision waiting on a person".
  - `dashboard/screens/credentials/commands.ts:45` prints `admin resource set`.
  - `cli/baton.mjs:442-444` rejects `--scope runner|worker|host` "B-68's window".
  - Covered by **B-157** (tree) and **B-68/B-69** (scope message). Confirmed.

### B. Unnecessary complexity

- **Rule 4 implemented five or six times**:
  - `gates.ts:140-160` (TS).
  - `claims.ts:681-713`: the reference SQL repeats the same grant-admits subquery twice, once for the ticket clause and once for the leg's `leg_capabilities_json`.
  - `claims.ts:756-758`: the projection's `caps`.
  - `blocks.ts:743-750` `capsOf` and `:857-861` `forRunner`.
  - `claims.ts:389-395` the wildcard expansion in `grantsOf`.
  - The leg's capability set has three stores: `courses.leg_capabilities_json` (reference SQL, `resources.capacities`), `course_leg_capabilities` (projection), and the graph's `def.requires` (gate and seats).
  - The spec states rule 4 once (§6.6). G-BTN-40 tests only the SQL against `isEligible`.
  - **NOT covered** (B-237 and B-243 are performance tickets). Likely.
- **Production code that only tests use**: `Claims.reference` and `referenceCandidates` (`claims.ts:247-249, 643-743`, ~100 lines), plus the `reference` branches in `cached`, `recommend`, `decide`, `idleHit` and `idleNote`. Only `test/integration/B-237.*` and `S-BTN-243.*` set it. This is a second matching implementation inside core. **NOT covered.** Confirmed (grep).
- **Rule 3's "held" definition re-inlined**: `blocks.ts:112` exports `HELD_CLAIMS_SQL` as "the one definition", yet the same predicate is written out again in:
  - `blocks.ts:894-895`;
  - `claims.ts:555, 669-673` and `seatFacts`/`seatHolders` (`:599-601, 627-629`, a variant without `completed`);
  - `scope.ts:69-72`;
  - `baton.ts:1647`;
  - `gates.ts:113-115` `claimHolds`;
  - `tickets.ts:157`, a variant without fence-pending.
  - **NOT covered.** Confirmed.
- **`Blocks.invalidateRecommend`** (`blocks.ts:167-170`) is a documented no-op ("does nothing yet"), called at `:242` and `:829`. **NOT covered.** Confirmed.
- **`instancesRows`** (`blocks.ts:830-840`) re-writes the resource rows right after `recountRows` and admits it "changes no row today". This goes with B-291. Covered by **B-291**.
- **`Blocks.ticketRepos`** (`:594-601`) and `posted()`'s `basesOf` (`:525-534`) both compute R-BTN-92's link bases with `ticketRepositories`. **NOT covered.** Likely, minor.
- **The `floor` rule sits outside `gatesFor`**: `claims.ts:319-331` `refuseStopped` is called separately from `decideNamed`, `canOffer`, recommendations and launch candidates. The spec says `isEligible` is "the reference for every rule" (§6.6). **NOT covered.** Likely.

### C. Missing anchors

- `gates.ts:95-105` `GATE_CODES`: the refusal codes of §6.6's table. It cites "§7.2, §11" and should cite §6.6 and R-BTN-45. In `gatesFor`:
  - rule 3 (`:134-137`) carries no id; it should cite R-BTN-39 and §6.6 rule 3;
  - rule 8 (`:171-173`) should cite R-BTN-60 and R-BTN-67;
  - rule 9 (`:187-190`) should cite R-BTN-22 and R-BTN-65;
  - rule 10 (`:192`) should cite R-BTN-122;
  - `awaiting-sync` (`:202-205`) cites "§6.7" and should cite R-BTN-10.
- `blocks.ts:667-670` `expireMessages`: an `unblocked` message expires when its runner stops being live. It should cite R-BTN-77.
- `blocks.ts:982-993` `needsYou`: the 24-hour capability block and the `unknown` instance. It cites only §14; it should cite R-BTN-75 (capability rows, `baton.capability-missing`) and R-BTN-76 (`baton.resource-unknown`).
- `blocks.ts:612-645` `unblocked`: at most 20 tickets per message, the coalesced trigger, a runner "with room". It should cite R-BTN-77 on the function itself (the section header has it) and R-BTN-94 for `unblocked_trigger`.
- `blocks.ts:400-407` `forget`: the rows go when a ticket leaves the board. It should cite R-BTN-75 and R-BTN-147.
- `validate.ts:1143-1149` `checkOverride`: the owner's expedite/hold body. It should cite R-BTN-12.
- `claims.ts:625-633` `seatHolders`: holders are named only where the caller's key is granted. It should cite R-BTN-178 and R-BTN-99.
- `claims.ts:1146-1166` `launchCandidates`: it implements R-BTN-99's launch-candidates view (gates no runner decides, default order). It has no doc comment or id.
- `resources.ts:186-247` `post`: the 4 KB `detail` (via `checkReading`), `until` ≤ the reading's end, and lapse at the earlier of the two. It should cite R-BTN-76 at the `until`/`lapses` lines (`:232-237`).
- `scope.ts:1-17` header and `Scope` class: §12.9 a leg's scope. It cites only B-134 and should cite §12.9 and R-BTN-140 (reach), R-BTN-73 (push deliveries) and R-BTN-66 (`scope_policy`, `runner_pushers`). `openScopes` (`:66-74`) should cite §6.6 rule 3 and R-BTN-19.
- `dependencies.ts:85-106, 114-177` `checkCrossRepository` and `checkCrossBoardCycle`: these are §4.4's *Dependencies* refusals, which have no rule id. They cite B-113 only. Add `§4.4` and R-BTN-47's *Relations stay home* at each refusal.

### D. Stale or wrong anchors

- **Retired R-BTN-78** (posted decisions): cited at `blocks.ts:1-2, 61, 71, 102, 409, 416, 457, 473, 485, 572`; `gates.ts:75, 129`; `claims.ts:556`; `validate.ts:1194, 1196`. Problem: the rule is retired. Fix: removed with B-56/B-161. check-spec already warns.
- **Retired R-BTN-80/R-BTN-103** (notices): cited at `notices.ts` throughout; `blocks.ts:61, 404, 417, 579`; `validate.ts:1301-1345`. Removed with B-67. check-spec already warns.
- **R-BTN-75 "as amended by R3-1254" and R-BTN-77 "as amended by R3-1251"**: `blocks.ts:38, 193, 257, 262, 294, 317, 381`. These cite ticket amendments. The current R-BTN-76 owns "a lost answer is not an unblocking" (`06-…md:255-264`), so the lost-answer comments should cite R-BTN-76, then go with B-291.
- **Old section numbers**. Ids are stable; § numbers are not.
  - `gates.ts`:
    - `:1` "§7.2" → §6.6.
    - `:8` "§5" → R-BTN-9 (§8.1).
    - `:69, 111, 204` "§6.7" (head observation, rule 3 completed-unconfirmed) → R-BTN-10.
    - `:90, 121` "§2m" (chain/isolation) → §6.6.
    - `:122` "§7.2" → §6.6.
    - `:51` "`spec/BATON_SPEC.md` §2e" → points into the index and an old section; cite R-BTN-120 in §6.1.
  - `blocks.ts:1` "§2g" → §6.2.
  - `validate.ts`:
    - `:1188` "§2g R-BTN-75–78, §2l R-BTN-101" → §6.2/§6.3; drop 78.
    - `:234` "§6.6 R-BTN-9" → R-BTN-9 is §8.1.
    - `:280` "absent ⇒ every tier (§5)" → retired.
  - `claims.ts`:
    - `:1-2` "§6.1–6.7, §7.2 rules 1–10, … §6.10–6.11" → §9 claims, §6.6 gates.
    - `:28` "§7.2 rule 2" → §6.6.
    - `:122, 643` "§7.2's candidate query" → §6.6.
    - `:2637` "(§2e)".
  - `notices.ts:1` "§2g … §2l".
  - `dependencies.ts:181, 200` "§4.3" (the sync's dependencies read) → §4.4 *The sync resolves qualified dependencies first*.
  - `capacity.ts:220` "§4.8's `baton.capacity`" → §4.8 is Owner state; R-BTN-87, §2.3.
  - "§10.4" free text (`blocks.ts:493`, `notices.ts:286`, many in `validate.ts`) → §10 is now Checks; untrusted text is §12.3.
- **Rule 6 described as live**:
  - `gates.ts:54-55` "rule 4 checks it as rule 6 checks the ticket side".
  - `gates.ts:117-122` lists "tier (5), operator-only (6)… 4–7".
  - `claims.ts:644-646` "rules 3, 4, 5…, 6, 9 and 10".
  - `board.ts:754` "`operator_only` carries rule 6".
  - `graph.ts:82, 85` "rule 6 compares the literal".
  - Problem: rule 6 is retired and unused (§6.6). Fix: say rule 4 compares the `human-operator` literal.
- `blocks.ts:167` "R-BTN-77 via R-BTN-98 … R3-1269's `fleet_version`": the claim is about a cache that does not exist. Remove it with the no-op.
- `resources.ts:9-10` and `blocks.ts:5-9`: the headers state the `resource` block as a live rule. They go with B-291.

### Notes

1. **The spec's §6 "Not built" header is incomplete.** These are stated as built but have no code:
   - R-BTN-89 `not_before` and the `time` wait (no code; R3-1259 is `available`);
   - posted `depends_at` (R-BTN-120; the code takes `depends_on`/`blocked_by`);
   - `waiting_on`'s `course:` prefix and the refusal of the reserved labels (R-BTN-120);
   - `baton.capability-missing` and `baton.resource-unknown` as conditions (the code lists them in Needs you, `blocks.ts:984-993`; B-57).
2. **§6.3's `resource` paragraph describes unbuilt parts as built**: `end`-sourced needs, `found_at`, and a `blocked` end naming a resource with a reading.
   - `checkEnd` admits `capability` only (`validate.ts:795-800`).
   - `leg_needs` has no `source`/`added_at`/`found_at` (migration 0016), although §13 lists them.
   - This contradicts §6's own header ("R-BTN-126: the `ticket` and `resource` blocked ends … not built"). It is moot once B-291 lands.
3. **R-BTN-75 vs code, on `ticket` rows at an advance.** R-BTN-75 says "Every row refuses a claim and an advance into its leg, and a whole-ticket row every leg". `gatesFor` (`gates.ts:132-139`) refuses `ticket` rows at a claim only; at an advance it checks `decision` rows alone. History Resolutions §15 #9 records the earlier "ticket rows refuse a claim but not an advance". The code matches that, not the current rule. NOT covered. Confirmed.
4. **The policy's `readings` entry is parsed but never applied.**
   - R-BTN-76 says "a repository reads only those its policy's `readings` entry admits (R-BTN-188)".
   - `policy.ts:315-333` validates the entry, but nothing reads `policy.readings`. `Resources.stateOf`, the views and the resource rows use every writer's reading.
   - B-291's *Trust* section relies on "the policy's `readings` knob says whose count", which is not true of the code. Confirmed by grep.
5. **Reading bounds the spec states and the code lacks** (R-BTN-76):
   - "≤ 1 hour from a runner credential": `/v1/runner/readings` calls `checkReadings(body, VALID_FOR.state_s)`, which is 24 h (`resources.ts:187`, `baton.ts:1046`).
   - "at most 8 instruments per credential, a ninth replacing that credential's oldest": not implemented.
   - "at most one reading per instance a minute": the code limits per `(instance, source, kind)` (`resources.ts:211-215`), so a state and a measure reading both pass.
   - Confirmed.
6. **R-BTN-126's capability end leaves the fleet count stale.**
   - The spec says Baton "removes it from the runner's declared set and updates `fleet_capabilities`" in that transaction.
   - `claims.ts:1708` deletes the `runner_capabilities` row but runs no `blocks.recount()`; the claims `Ctx` has no recount, so `fleet_capabilities` and the capability rows lag until the next fleet change.
   - Re-declaring the same set later does not restore the row either: the heartbeat rewrites declarations only when its `settings_hash` changes (`runnerApi.ts:436-437`).
   - Likely.
7. **R-BTN-77 vs code, on who is woken.** R-BTN-77 says an `unblocked` message goes to "each live idle runner". The code sends it to any runner "with room" (`blocks.ts:621`, B-188). The spec was not amended with B-188. Likely.
8. **R-BTN-132's window is not what the code does.**
   - The Migrations entry says `operator_only` is read "as `human-operator` in rule 4" and that each old field logs `deprecated-field`.
   - Neither happens: `operator_only` is stored and never gated (`gates.ts:31-33`). The default markdown source posts `operator_only: tags.includes('OP')` without adding `human-operator` to `requires` (`defaults/tickets-markdown.ts:141-142`).
   - So since B-104 retired rule 6, an `OP` ticket is claimable by any runner unless its `requires` names `human-operator`.
   - No `deprecated-field` is logged for `blocked_by` or `operator_only` (`retiredBoardFields`, `board.ts:279-291`, covers only part-4 fields).
   - B-41's phase 1 would fix it; it is `available`. Likely. Security-relevant.
9. **The security proposal still uses the cut `resource` prerequisite**: §4 has `requires.resources` as "the short form of an `instance` requirement", a `resource` block as advice, and `missing … for requires.resources`; §13 says "A `resource` row gates only where its requirement binds `gate`". This contradicts ruling 5 and should go with B-291's spec half.
10. **Posted decisions (B-110: options, grants, `decision_answers`) have no home in the current spec.** R-BTN-78 was retired on 2026-11-01, and B-110 built them on 2026-11-03. §4.4's board-post schema has no `decisions`, `stations` or `next[].needs`, which the code accepts. That gap belongs to B-302 and B-120.
11. **Spec wording, §6.1 vs §6.2.** §6.1's `capability` `why` lists `full`, while §6.11 says seats are no blocks. Consistent, but "the one list" of kinds now includes `resource` (to go) and `retry` (not built), and lacks the code's `decision`. After B-291 and B-56 the list is: station, ticket, capability, retry (unbuilt), time (unbuilt).
12. **Tickets still carry `tier:` in frontmatter** (e.g. `tickets/B-291.mdx:12`, `B-322.mdx:7`). B-322 says the source then ignores the field. Data, not code.
13. **`scope.ts:35-53` `scopePaths`** treats "no `code_repos` list" as reaching every forge-valid name, whatever the policy's `repos.unlisted` says (R-BTN-140 *Reach by name* requires `by-name`). Covered by B-264, which builds `repos.unlisted`. Likely.
