---
title: "Area report — §8: the reference runner"
description: "One of eight area reports behind the 2026-11-24 review of the code against the simplified spec, at main 5758cdb: deprecated concepts, unnecessary complexity, missing and stale anchors, each finding at file and line."
tags: [review]
order: 6
---


Scope read: spec/BATON_SPEC/08-runners.md (whole), spec/proposals/checks-and-executors.md §2–§10, the
relevant rows of §4.5, §5.3, §9.4, §12.9, §2 (R-BTN-137); code: every file in src/runner/,
`src/shared/mask.mjs`, `std.mjs`, `schema.mjs`; `scripts/start-runner.sh`, `cloud-runner.sh`, `baton-run.mjs`, `baton-leg.mjs`.
Tickets checked for coverage: B-46, B-47, B-184, B-263, B-288, B-295, B-299, B-313, B-316, B-322.
No file read contained instructions addressed to the reviewer.

Good news first: no runner logic branches on the executor's `source` (grep of `builtin` outside
executor.ts finds only defaults, a log line and comments). The "Under builtin …; under any other
executor …" weld is gone from the code; it survives only in proposal text. No code in this area
cites a retired R-BTN id.

### A. Deprecated concepts retained

- **Signed control (B-127) is still verified by the runner before loading code.** It lives in
  `src/runner/claimRun.ts:6-7` (imports `verifySignedCommit` and `controlGroupsOf`), `:88` (`PreparedClaim.signedControl`),
  `:520-614` (`verifyControl`: SSHSIG check, group walk, `register_moved`), `:668-700` (a claim
  refused `cannot-finish:spec`/`stale-board`, the course loaded at `signedControl.course`) and
  `:872-877` (`ctx.signed_control`). `src/runner/runner.ts:549-562` also logs the retired brief mark
  ("owner-signed"/"unsigned … a claim, not the owner"). Spec: signed control was retired on
  2026-11-19 ("no commit signature is verified", HISTORY changelog). R-BTN-133 and R-BTN-143 load
  from the claim's `snapshot_sha` only. **Covered by B-263** (item 4; item 3 covers the brief
  mark). Confirmed.
- **The `home-signed` executor source** is still parsed and refused with a B-127 message:
  `src/runner/executor.ts:10,279-293`. R-BTN-107 names only `builtin` and `pinned` as built, and
  the proposal adds `home`. **Covered by B-263** item 4. Confirmed.
- **The local queue's `control_required` gate** — `src/runner/queue.ts:7-8,45,75,120-123`,
  `src/runner/runner.ts:535-538` (`setControlRequired`) and `:583-586` (`runOffline` waits while
  it is `null` or `true`). R-BTN-202 lists the conditions for an offline leg: bound 1, one course,
  the home's head, an `@leg` with one `from`. Signed control is not among them. Because of this
  gate, a freshly installed runner whose queue has never seen a claim answer cannot run any order
  offline, which is stricter than the rule. Partly covered: B-263 item 4 removes signed control
  "and its callers", but its exit grep (`signed.control`) does not match `control_required` or
  `setControlRequired`. Name it in B-263. Confirmed.
- **Tiers:** the `--tier` flag (`src/runner/main.ts:38,69,80,102,137,515`), `tierCeiling`
  (`runner.ts:46`, `sidecar.ts:33`), and the heartbeat still sending `tier_ceiling: 'critical'` on
  every beat (`sidecar.ts:243`). `scripts/start-runner.sh:110` still tells the owner to grant with
  `--max-tier judgement`. Retired on 2026-11-23 (the heartbeat's `tier_ceiling` among the removals).
  **Covered by B-322** item 4. Confirmed.
- **The `worker-reaped` refusal code** — `src/runner/sidecar.ts:318,321`. No server code sends it
  (grep of src/ and cli/ finds it only here). R-BTN-6 lists `session-taken`, `runner-reaped` and
  `forbidden`. This is a leftover of the worker→runner rename window (HISTORY, "Worker is
  runner"). NOT covered. Confirmed.
- **`IR_BATON_*` in the start script's probe** — `scripts/start-runner.sh:241-249` unsets
  `IR_BATON_KEY_FILE/KEY/TOKEN` and its comment calls them "the transition's". B-97 dropped them
  (see the comments at `src/runner/api.ts:60`, `main.ts:377`, `claimRun.ts:1169`). Partly covered:
  B-288 item 4 removes `IR_BATON_*` from `src/runner/`, `src/defaults/` and `cli/`, but
  `scripts/start-runner.sh` is not named there. Confirmed.
- **Route-choice leftovers (`taken`, `BATON_TAKEN`, `BATON_ADVICE`)** — `src/runner/api.ts:184`
  still types `taken?: {choice, alternative, dead}[]` on the `advance` body, which nothing sends.
  `scripts/start-runner.sh:280-282` and `scripts/cloud-runner.sh:162-164` still unset
  `BATON_TAKEN` and `BATON_ADVICE`. R-BTN-177 is retired: "no `advice`, `taken`, `BATON_ADVICE`,
  `BATON_TAKEN` or `route_last`". NOT covered. Confirmed.
- **The docs deployment's interim course declaration:**
  - `src/runner/home.ts:43,65` reads docs' interim `{course}` key in `.baton/baton.json`.
  - `src/runner/main.ts:182-224` reads `skills_version` from `.baton/baton.json` and from docs'
    `scripts/data/baton.json`, and keeps an `inferLegacy` directory scan.
  - `src/runner/main.ts:79` defaults `BATON_REPOSITORY` to `'docs'`.

  docs has cut over (ruling 4). The spec reads `courses: [{id, version}]` (R-BTN-51, R-BTN-22:
  "Each course entry carries two integers"), and `skills_version` appears nowhere in
  spec/BATON_SPEC/. NOT covered (B-288 does not name these). Confirmed.
- **Compatibility shims for "a Baton before B-n".** One server serves every runner and ships from
  this repository, so each shim's reason is gone:
  - `claimRun.ts:416-434` (`claimCourse`) falls back for a "pre-B-103 answer" with no `course_id`.
  - `claimRun.ts:775-781` and `audit.ts:99-106` audit nothing for "a Baton before B-134" that
    sends no `scope`. §12.9 says "The claim answer carries it".
  - `sidecar.ts:396-399` reads `answer.claim` for "a Baton before B-188"; the heartbeat answer
    carries `claims` (§8.1).
  - `sidecar.ts:467-472` (`slotFor`) handles a release with no ticket ("a Baton before B-188").
  - `runner.ts:136-139,171-176,682-687` and `sidecar.ts:500-502` treat state files "written before
    B-188" (`claim` alone) as legacy orphans.
  - **Runs before run ids:** `claimRun.ts:796-798,1144-1145,1173-1174` handle an advance that
    names no `run_id`, falling back to a `leg-<tag>` session key and no
    `BATON_RUN_ID`/`BATON_SESSION_ID`. §5.3: "Every run has a run id", and R-BTN-123 makes a leg's
    session id `<run_id>.r<n>`.
  - `replay.ts:205-207` (`compareRead`) explains a missing version as "a Baton before it recorded
    one".
  - `runner.ts:509-512` keeps `MAX_STALE_BEATS = 2` for "a pre-B-86 state file".

  NOT covered. Confirmed for the code paths; it is likely, not checked, that no deployed server
  still sends the old shapes.
- **The executor's `source`, `digest` and `provides`, with the `provides` validation**
  (`executor.ts:99-104,303-306`, `main.ts:508`), are a half-built piece of proposal §2.6 (the
  heartbeat's `executor` declaration). The proposal states that "a heartbeat carries no
  `executor`". Today the fields feed one log line and the verbose leg line (`claimRun.ts:1251`).
  **Covered by B-184**, which builds §2.6. Confirmed.

### B. Unnecessary complexity

- **Both heartbeat shapes are sent at once** — `src/runner/sidecar.ts:249-255`. At concurrency 1
  the beat carries `session_urls` *and* `session_url`, and `legs_finished` *and* `leg_finished`, to
  keep "the shapes a Baton before B-188 reads". §8.1: "A runner holding one claim may send
  `session_url`, `leg_finished` and one `fenced` object **in place of** the three lists". Send the
  lists only. NOT covered. Confirmed.
- **Three implementations of one ticket-source re-read** (R-BTN-34 / R-BTN-84):
  - `claimRun.ts:440-470`: an in-process `MARKDOWN_SOURCE` path;
  - `claimRun.ts:474-516` (`verifyBySource`): the same `describe`/`read`/compare through the
    executor;
  - `replay.ts:458-498` (`readTicket`): a third copy.

  `wrapperOutcome` is also duplicated (`claimRun.ts:47-55` and `replay.ts:233-241`). One helper
  that takes an executor would serve all three. NOT covered. Confirmed.
- **Dead code:**
  - `BatonApi.recommendations()` (`src/runner/api.ts:152-155`) has no caller in src/ or cli/.
    R-BTN-72: each claim attempt "reads no recommendations".
  - `drainLines` (`log.ts:72-86`, re-exported from `runner.ts:20`) is used only by a test.
  - `SIGNAL_GRACE_MS` is re-exported from `runner.ts:18`.

  NOT covered. Confirmed.
- **Three grace numbers for "a leg that will not stop":**
  - `SIGNAL_GRACE_MS` = 30 s (`claimRun.ts:29`), the wait before a released leg's session is killed;
  - `HARD_STOP_MS` = 10 s + 10 s (`main.ts:322`), the signal path;
  - `builtin` `stop()` kills at once (`executor.ts:204-209`).

  The spec gives 10 s + 10 s (R-BTN-72), interrupt/10/25 s (R-BTN-119) and a 30 s outcome
  (R-BTN-145). **Covered by B-299** row 6 (amend R-BTN-119 to the code), which should also settle
  one constant. Confirmed.
- **`kind` takes one value:** `sidecar.ts:242` hard-codes `kind: 'vm'`. `scripts/cloud-runner.sh:3`
  claims its host is of kind `cloud`, but heartbeats as `vm`. §8.1 calls `kind` "a label no rule
  reads". Either drop the field or let the host set it. NOT covered. Confirmed.
- **start-runner.sh always narrows to a hard-coded capability list** —
  `scripts/start-runner.sh:58,238`. The default `CAPABILITIES` names
  `key:opencode-go,key:deepinfra,key:claude-subscription,key:zai` and is always passed as
  `--capabilities`. That defeats R-BTN-72's "The declaration defaults to the grant", even though
  the header (`:22-24`) says otherwise. Under a flag, a name the grant lacks is refused
  `forbidden` on every beat, and `sidecar.ts:327` keeps the flag's list, so the runner never
  recovers. Default to no `--capabilities`. NOT covered. Confirmed.
- **The stalled-leg watch in start-runner.sh** (`:288-347`) re-implements B-108's liveness line
  from the outside, against opencode-specific paths. "until B-108 lands" is stale now that
  `sidecar.ts:412-420` logs liveness. NOT covered. Likely. (The runner's own reading of harness
  stores in `log.ts:39-63` is **covered by B-313**.)

### C. Missing anchors

- `src/runner/home.ts:19,27` `GIT_TIMEOUT_MS` / `git()`, and `home.ts:129,132` `CLONE_TIMEOUT_MS` / `gitAsync` — implement "Every git call the runner makes is bounded and non-interactive" — should cite R-BTN-72 (§8.3); they cite only B-94.
- `src/runner/main.ts:322` `HARD_STOP_MS` and `main.ts:452-488` `onSignal` — implement the signals: SIGTERM drains; SIGINT, SIGHUP and a second SIGTERM release; the call is killed after ten seconds and its stop waited on for ten more — should cite R-BTN-72 (§8.3); they cite B-94 and B-109.
- `src/runner/sidecar.ts:28` `declarationFrom` and `:349-394` `recordDeclaration` — implement "the declaration defaults to the grant; `--capabilities` narrows, never enables" — should cite R-BTN-72 (§8.3); they cite only B-86.
- `src/runner/sidecar.ts:568-588` `reportEligibility` — implements "logs that once at startup" — should cite R-BTN-72.
- `src/runner/sidecar.ts:410-420` (the liveness line in `applyClaimViews`) — implements "each beat logs the leg's duration and the age of its newest activity signal" — should cite R-BTN-72; it cites B-108.
- `src/runner/sidecar.ts:247` `lease_timeout_s: s.lease_timeout_s ?? 900` — the lease declaration and its default — should cite R-BTN-9 (§8.1).
- `src/runner/sidecar.ts:318-341` (the heartbeat refusals that lose the lease) — the list `session-taken`/`runner-reaped`/`forbidden` — should cite R-BTN-6 (§9.2); it cites §6.3 and R-BTN-14.
- `src/runner/claimRun.ts:1144-1145,1173-1174` (the session key `<run_id>.r0`) — should cite R-BTN-123 (§8.3); it cites R-BTN-107 and R-BTN-144.
- `src/runner/claimRun.ts:1488-1506` `callClose` (retried twice, then `released:cannot-finish:transient`) — should cite R-BTN-72 ("The runner writes nothing to git itself"); it cites R-BTN-83 and §6.13.
- `src/runner/audit.ts:39-146` (`pushesBetween`, `outsideScope`, `readRefState`) and `claimRun.ts:651-667` `auditLeg` — implement the leg-end scope audit: `update by push` only, the whole forge path, at most sixteen actions plus a count — should cite R-BTN-106 (§8.3) and §12.9; they cite only B-134.
- `src/runner/cliPin.ts:62` `cliBehind` and `runner.ts:308` (exit `75`) — implement "Restart requested" — should cite R-BTN-72.
- `src/runner/executor.ts:204-209` `builtin.stop` — the stop that R-BTN-145 bounds — should cite R-BTN-119 and R-BTN-145 (`exec`'s group kill at `:186` cites R-BTN-145; `stop` cites nothing).
- `src/runner/claimRun.ts:1092-1110` `advance()` (how a refusal settles) and `protocol.ts:125-130` `refusalKind` — `off-graph` becomes `course-changed`, `entry` becomes `contract-output` — should cite R-BTN-64 and R-BTN-109 and §9.4's end table; they cite "§6.13".
- `src/runner/protocol.ts:23` `SCRIPT_RELEASE_REASONS` — a subset of "the one list" of end reasons — should cite §9.4; it cites "§6.5".
- `src/runner/main.ts:79` (hostname: `--hostname`, else `BATON_HOSTNAME`, else the host's name) — the sidecar's *Credentials* bullet in §8.1; uncited.

### D. Stale or wrong anchors

- `src/runner/channel.ts:1`, `src/runner/leg.ts:1` — cite "§8.2 R-BTN-106" — R-BTN-106 is in §8.3 — fix to §8.3.
- `src/shared/std.mjs:1` ("§2m.2 R-BTN-110") and `src/shared/schema.mjs:1` ("§2m.2 R-BTN-108") — §2m.2 does not exist; R-BTN-108 and R-BTN-110 are in §5.5 — fix to §5.5.
- **"§6.13", about 30 occurrences:** `claimRun.ts` (`:65,275,282,285,828,834,941,964,999,1033,1085,1491`), `protocol.ts:1,12,33,95,120,132`, `legProcess.mjs:11,14`, `main.ts:1,375`, `home.ts:1`, `scripts/baton-run.mjs:2`, `start-runner.sh:99`, `cloud-runner.sh:55`. The section §6.13 no longer exists (§6 ends at §6.11). These mean the runner (§8.3, R-BTN-72), the end table (§9.4) or the release signals (R-BTN-119). Cite the id.
- **"§6.3" for the heartbeat:** `sidecar.ts:12` (`BEAT_MS`), `api.ts:13` (`CALL_TIMEOUT_MS`), `state.ts:55` (`LEASE_MARGIN_MS`), `sidecar.ts:319`. §6.3 is now *External resources and readings*. Fix to §8.1 (the heartbeat) and R-BTN-6.
- **"§6.4"** (state file, credentials): `state.ts:1,66`, `api.ts:58,83`, `main.ts:261`, `start-runner.sh:103,244`. §6.4 is *People*. Fix to §8.1 (the sidecar's state file and credentials) and R-BTN-13.
- **"§6.5"** (end reasons): `protocol.ts:20,88`, `claimRun.ts:945,972`, `sidecar.ts:457`. Fix to §9.4.
- **"§6.8"/"§6.9"** (spool and activities): `state.ts:82`, `sidecar.ts:294,610,641,656`, `api.ts:156`. Fix to §8.1 (*Spool*) and §9.9.
- **"§11" for the claim answer and error body:** `claimRun.ts:408`, `protocol.ts:124`, `api.ts:1,16`, `sidecar.ts:179`. §11 is *People*. Fix to §9.1 and §14.
- **"§2c"/"§2d"/"§2e"/"§2f"**: `home.ts:43`, `main.ts:188`, `replay.ts:438`, `claimRun.ts:765,855`, `protocol.ts:2`, `harness.ts:2`. These are pre-2026-10-20 numbering. Cite R-BTN-51, R-BTN-63 and R-BTN-74 by id.
- `mask.ts:250`, `replay.ts:618`, `main.ts:271` — say `runner.json`'s default location is "§5.6"'s. §5.6 is *Gates a course can set*, and no section gives a default path for `runner.json`. Drop the citation, or add the path to the spec.
- `claimRun.ts:520-545` (the `verifyControl` docblock) — cites "R-BTN-66 as amended, R-BTN-133's verified tree extended". Neither rule carries signed control any more. The code is removed with B-263.
- `executor.ts:10,292` — names B-127 as a blocker. B-127's signed control is retired, not pending.
- `src/runner/mask.ts:1-3` ("as it leaves the runner for a leg log (R-BTN-128)") and `claimRun.ts:383-387` ("the runner's log, which is what a leg log reads (R-BTN-128)") — leg logs are a proposal (§8.5: "`leg_log_dir` is null on every run … not built"). Say "the runner's log".
- `src/runner/channel.ts:11-12` — "no `executor_digest`, `environment` or `instance` — the runner reports those itself". The runner reports none of them; they are unbuilt proposal §2.6. Drop the claim.
- `src/runner/replay.ts:621-622` — "`replay_clone_credential` is read for completeness". `readRunnerJson` never reads it. R-BTN-144's replay row lists it.
- `scripts/cloud-runner.sh:3-5` — "BATON_SPEC §8.1: a host of kind `cloud` is a Claude Code cloud container" and "process-mode runner". §8.1 now says `kind` is a label no rule reads and names no deployment; "process mode" is the pre-R-BTN-107 isolation vocabulary.
- `protocol.ts:20-22` and `sidecar.ts:455-457` — call `provider-suspended` one of "§6.5's own" reasons. §9.4's table lists no `provider-*` reason. **Covered by B-299** row 10.
- `claimRun.ts:742-743` — "the two file-less cases (check tickets, a `cancel` claim)". Checks are to be removed (B-290), and the `cancel` leg is not built (refused by the validator).
- `start-runner.sh:274` — "the dashboard's Workers view". Rename to Runners.

### Notes

1. **The executor interface in the code is not the spec's `executor_api: 1`.**
   - R-BTN-107: `exec(handle, argv, {cwd, timeout_s, stdin}) → {status, stdout, stderr}`.
   - The code's `exec` returns `Running {result, write, kill}` and takes `env` and `onStderr`
     (`executor.ts:12-16,64-85`). The runner calls `.result` and `.write` (`claimRun.ts:279,1527`).
   - Consequence: a `pinned` bundle written to the spec text loads, passes the `api === 1` check,
     and fails on its first call.

   Either the spec states the streaming shape or the code adapts it. NOT covered (B-184 and B-316
   do not mention it).
2. **The class-6 key-block mask leaks outside the `run` stream.** `wrapperCall`'s verbose drain
   for `close`, `handoff` and the source calls (`claimRun.ts:405-409`) and replay's `onStderr`
   (`replay.ts:573`) call `maskLegOutput` one line at a time. `maskKeys` holds no state between
   calls, so only the `BEGIN` line is masked and the key's body lines leave in clear. R-BTN-144
   class 6 says output "is held until the `END` line or 16 KB". Only the leg's `run` call goes
   through `createLegMasker`. NOT covered (B-316 is scoped to `createLegMasker`). Confirmed.
3. **`BATON_STATE` is the runner's real state file, with the runner secret.** It is set at
   `claimRun.ts:339,1170` and passed as `ctx.state` at `:879,1608`. R-BTN-144: "path of the
   read-only state view (no runner secret)". Covered only by B-47 item 1, whose wording still uses
   `IR_BATON_STATE`. B-299's rows 2–5 do not list it, though it is the same class of exposure as
   row 2.
4. **R-BTN-34's one fetch fetches `main`, whatever the default branch.** `ensureSha(…,
   this.o.fetch)` goes to `fetchMain(home, say)`, whose `branch = 'main'` (`main.ts:289,510`).
   The claim's `default_branch` is ignored. §4.5: "it fetches the default branch once". NOT
   covered.
5. **`BATON_EXECUTOR` takes the place of `runner.json` `executor`** (`main.ts:59,81`,
   `replay.ts:97`). R-BTN-107: "`runner.json` `executor`, or `--executor`". The code never reads
   `runner.json`'s `executor`, and `BATON_EXECUTOR` reaches every leg through the
   `...process.env` spread. NOT covered.
6. **The spec contradicts itself on `launch-candidates`.** R-BTN-201 (§8.3) says "`GET
   /v1/runner/launch-candidates` … not built". §6.7 (R-BTN-99) and §14 specify it, and it is built
   (`src/core/baton.ts:931`, `src/core/runnerViews.ts:14`). R-BTN-201's "not built" line should
   name only the launcher's hint.
7. **Spool rules stated as built are not.**
   - §8.1 *Spool* says the sidecar "posts the spool within 5 s and on every heartbeat, and drains
     it before exit". The code reads the spool only inside `beatOnce`, every 2 minutes
     (`sidecar.ts:221`), and makes no final drain.
   - "a spool left by an ended session is drained by the next sidecar … using the ended session's
     state file" is not built either: `endEarlierSessions` ends claims and never drains.

   NOT covered.
8. **The R-BTN-202 "unreachable" test is too loose.** `api.ts:121` codes any non-JSON error
   answer as `unavailable`, and `batonUnreachable` (`api.ts:31-32`) counts `unavailable` as
   unreachable. So a proxy's HTML 403 or 404 makes the runner run orders offline and park ends.
   R-BTN-202: "a call does not reach it or it answers 5xx".
9. **R-BTN-137 says "There is no default origin"** and that `runner.json` carries `origin`. The
   runner and replay fall back to `DEFAULT_URL`, production (`main.ts:78`, `replay.ts:94`), and
   never read `runner.json`'s `origin`. (This is in §2, which is outside this area.)
10. **Replay goes beyond R-BTN-84 and R-BTN-144.** `--accept-moved` (`replay.ts:358-365`) runs past
    a version mismatch the rule says is refused. `BATON_REPLAY=1` (`replay.ts:191`) is not in the
    replay allowlist. Either amend the rule or drop both.
11. **B-299's line references are stale.** They point at `runner.ts:2587-2605`, `:1112-1123`,
    `:43`, `:2046`. That code moved to `claimRun.ts` (`:1169-1189` env, `:269-281` signal,
    `:29` grace, `:590` signed-control ancestry) when runner.ts was split. Whoever builds B-299
    should re-read them.
12. **B-299 rows confirmed open in this code:**
    - row 1: no R-BTN-143 check in `baton runner start`; `refs/baton/<repo>/default` is used only
      in `replay.ts:304`;
    - row 2: nothing deletes `BATON_KEY`, `BATON_KEY_FILE` or `BATON_TOKEN`; the leg's env is
      `{...process.env, …}` at `claimRun.ts:1169`;
    - row 3: no `credential:` scoping;
    - row 4: `BATON_AGENT_COMMAND`, `BATON_VERBOSE` and `BATON_DEFAULT_BRANCH` are set;
      `BATON_RESUME` and `BATON_ACTIVITY` are not;
    - row 5: only classes 5–7 are masked;
    - row 9: the wire carries `release` and `regressed`.

    The owner's 2026-11-23 ruling says to amend rows 4, 6 and 9 to the code. §8's text still
    states the old rules: seven `BATON_*` names, the interrupt/10 s/25 s ladder, and `lease-lost`
    as an `AbortSignal` reason.
13. **`claimRun.ts:1432` reads the course's `maxDuration`** as the leg's deadline for the
    `interact` check. **Covered by B-295** (`max_duration` against `deadline_s`).
14. **§5.3's "Every run has a run id"** still says "an adoption that adds one". Adoption is
    retired, and B-288 removes it.
15. `log.ts:10` `stampLine` reads the wall clock with `new Date()`. The one-clock rule binds the
    core (`this.now`), so this is borderline in runner code. The runner otherwise uses `batonNow`
    or an injected `now`.
