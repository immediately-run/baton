---
title: "Adversarial review 2026-11-18 — §15: the model, the harness and the scenarios"
description: "One reviewer's findings, as filed, on BATON_SPEC §15's prose and scenario table."
order: 18
tags: [review]
---

# Adversarial review 2026-11-18 — §15: the model, the harness and the scenarios

## A. The table's own integrity

### VER-1: Two different scenarios carry the id S-BTN-225; the index lists only one
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-30, R-BTN-31, R-BTN-199, S-BTN-225
- **Confidence:** high
- **Evidence:**
  - `15:95` — "| S-BTN-225 the home in force (B-121) | homes.json holding docs, fieldhouse and baton, …"
  - `15:180` — "| S-BTN-225 retention (B-238) | events of two repositories and the tenant's 91 days old, …"
  - `15:33` — "A scenario is `S-BTN-<n>` with a fixed script and assertions; its test file is named for it."
  - `15:38` — "a new scenario's number comes from `baton ticket next scenario` (R-BTN-199), taken before the branch names it anywhere."
  - `spec/BATON_SPEC.md:493` — "| S-BTN-225 | the home in force (B-121) | …" (the only S-BTN-225 line; 190 index lines for 191 rows).
  - `test/integration/` holds both `S-BTN-225.homes.test.ts` and `S-BTN-225.retention.test.ts`.
- **The problem:** A citation of S-BTN-225 names two unrelated scripts. The index silently drops the retention scenario. The retention row also sits under `§7`, though its rule is §2's R-BTN-149. Nothing detects a duplicate id.
- **Counter-reading considered:** They could be halves of one scenario, as `S-BTN-202.leg-scope` and `.runner-scope` are. That fails: different titles, tickets and subjects, and halves share one row. Grepped `S-BTN-225` across `spec/`.
- **Smallest fix:** Renumber the retention row, move it under §2, rename its test, and make `spec:index` fail on a duplicate id.

### VER-2: About 85 of the 190 scenarios have no test anywhere, and the spec does not say which
- **Severity:** high
- **Kind:** unverifiable
- **Rules:** R-BTN-30, R-BTN-31, R-BTN-68, G-BTN-37, R-BTN-28
- **Confidence:** high on the listing; medium on severity (the heading says "partly built")
- **Evidence:**
  - `15:5` — "## 15. Verification: the model, the harness, scenarios and gates *(partly built — B-50)*"
  - `15:33-35` — "its test file is named for it. The table below is the set, and every scenario passes on the hosts it runs on (G-BTN-37)."
  - `15:440` — "| G-BTN-37 | Every scenario here passes on its hosts (`npm test`) | `npm test` |"
  - `15:68` — "A green model and trace check is a cutover precondition (R-BTN-28)."
  - `ls test/integration` — 99 `S-BTN-*` files covering 88 table ids. No file is named for S-BTN-3, 8, 14, 19, 20, 27, 33, 49–54, 56–59, 61, 62, 68, 69, 71–76, 78, 80–84, 86, 88, 89, 91–103, 108–125, 127–132, 134, 136, 167, 180–187, 191, 193–197, 200, 205, 208, 211–213, 221, 223, 224, 230, 231, 233 (102 ids).
  - A grep for each id in `*.ts`/`*.mjs` under `test cli src scripts model` finds a mention for only about 15 of them, mostly unit tests (S-BTN-167 in `test/unit/webhook-merge-sync.test.ts`, S-BTN-230 in `test/unit/course-pr.test.ts`).
- **The problem:** `npm test` is green with roughly 45% of "the set" absent, so G-BTN-37 is satisfied vacuously. The unnamed ones include every §12 policy scenario (180–187, 191, 193–196, 205), the forged check (123), tenant isolation (111), the outbox (136), leg events (233) and the stop/deadline rows (3, 52, 71). R-BTN-31 says the opposite: "a row lands here in the same change, and the ticket's exit criteria require `npm test` green with it". A reader cannot tell from the spec whether S-BTN-183 is tested, designed or neither.
- **Counter-reading considered:** §12.8 is marked a proposal and the table inherits that. That fails as a defence: there is no built/unbuilt column, rows for built tickets are among the missing (S-BTN-230 B-255, S-BTN-231 B-256, the executor rows 208–213), and proposal rows that are built sit beside unbuilt ones. No row carries an "unbuilt" marker.
- **Smallest fix:** Add a status column (`built` with file, `unit` with file, `unbuilt` with ticket). Restate G-BTN-37 as "every row marked built passes, and none is unmarked". Have `check:spec` compare rows with files in both directions.

### VER-3: Test files named for scenarios the table lacks, and one under the wrong number
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** R-BTN-30, S-BTN-46, S-BTN-60, S-BTN-189, S-BTN-197
- **Confidence:** high
- **Evidence:**
  - `test/integration/S-BTN-46.decision-reaches-owner.test.ts`, `S-BTN-60.worker-couriers.test.ts` — the table has no row 46 or 60.
  - `test/integration/S-BTN-189.repository-policy.test.ts` — `15:93` is "S-BTN-189 the ticket commands"; `15:268` is "S-BTN-197 the repository policy".
  - `spec/BATON_SPEC_HISTORY.md` Retired requirements — "| R-BTN-103 | worker couriers deliver from a pool | R-BTN-164 (2026-10-20) |".
- **The problem:** Three files run under names outside "the set". The history has a table for retired rules and none for retired scenarios, so a dropped row leaves its test with no statement of what it must assert.
- **Counter-reading considered:** This is implementation residue. But R-BTN-30 makes the file name normative. `grep -n 'Retired'` in the history finds only "Retired requirements".
- **Smallest fix:** Add a "Retired scenarios" table, rename the 189 policy file to 197, and re-home or delete the 46/60 files.

### VER-4: Rows do not name the rules they test, so R-BTN-31 cannot be audited
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** R-BTN-30, R-BTN-31, R-BTN-68
- **Confidence:** high
- **Evidence:**
  - `15:42` — "A behaviour change without a scenario is incomplete."
  - Counted: lines 70–281 cite 12 distinct rule ids (R-BTN-5, 24, 62, 66, 70, 73, 106, 129, 162, 163, 186, 191). The Gates table cites 15. The index defines 176 rules. Outside §15 the section files name a scenario six times in total.
- **The problem:** The only link from a row to its rules is the `§n` group header, and that is wrong for several rows. Retention (225) and leg events (233) sit under §7; S-BTN-188 under §12; S-BTN-167 and 218–220 under §6; S-BTN-198/199 under §12; S-BTN-156 under §11; S-BTN-203 under §4. When a rule changes nothing points at the rows restating it, which is how section B's stale rows arose.
- **Counter-reading considered:** `npm run spec:impact` finds citations — only explicit ids; "refused rule 11 `capacity-full`" is invisible to it.
- **Smallest fix:** Give each row a `Rules` cell of ids and have `spec:index` emit the reverse map, listing rules with no row or gate.

## B. Rows that disagree with the rule as it reads today

### VER-5: S-BTN-174/175 test `converse`/`address` as claimed legs with a marker; the rule makes them fact legs — and S-BTN-196 tests the opposite
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-131, R-BTN-69, R-BTN-192, S-BTN-174, S-BTN-175, S-BTN-196
- **Confidence:** high
- **Evidence:**
  - `15:145` (S-BTN-174) — "a run of `converse` that writes its marker and suspends, then a second sync; … an address round begun and suspended" → "`converse` ready, then — its marker committed — waiting on `owner` and not offered again; … `reviewed` with `address` ready"
  - `15:144` (S-BTN-175) — "the board posts it `requested` with `converse` `ready`; the claim offers `converse`"
  - `05:899-904` — "**The owner's conversations are fact legs.** `create-spec`'s `converse` … and `address` … are the owner's own sessions, which no claim runs: `converse` declares `arrives: {fact: pr-opened}`, `address` `arrives: {fact: pr-pushed}`. Queued, each is `waiting` on the `owner` … No marker or frontmatter records that a conversation is under way."
  - `15:271` (S-BTN-196) — "a `create-spec` ticket at `requested`, then the owner's PR appearing" → "attests `pr-merged` and `pr-opened`, and the tickets reach `merged` and `spec-open`"
  - `05:989-990` — "consecutive claims of one runner — a `create-spec` `converse` and the next claim's `create-pr` `implement`" (the rule body still describes a claim of `converse`).
- **The problem:** Under R-BTN-131 today `converse` is never `ready`, never offered, never run by a runner and writes no marker. Rows 174 and 175 assert all four; row 196 asserts the fact-leg behaviour. Both 174 and 175 have test files, so either the tests assert retired behaviour or the rows no longer describe them.
- **Counter-reading considered:** "Ready" could be the sync's readiness for a fact leg. That fails on "Queued, each is `waiting` on the `owner`" and on "the claim offers `converse`". Grepped `converse` across all sections; `BATON_SPEC_HISTORY.md:859` records the change.
- **Smallest fix:** Rewrite 174 and 175 to waiting on `owner` and arriving on `pr-opened`/`pr-pushed`; change 05:989's example.

### VER-6: S-BTN-180 expects the forge to refuse a runner's push to `refs/baton/*`
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-180, R-BTN-188, S-BTN-180, S-BTN-191
- **Confidence:** high
- **Evidence:**
  - `15:258` — "the runner's push to the default branch, a tag, `refs/baton/*` or a ref outside `branch_pattern` is refused by the forge"
  - `12:525-527` — "`refs/baton/*` is open to every writer, since GitHub cannot restrict it"
  - `12:374-375` — "Three values that were knobs are constants: `refs/baton/*` is open to every writer"
  - `15:275` (S-BTN-191) — "`--check` matches with `refs/baton/*` open to every writer"
- **The problem:** S-BTN-180 tests `refs/baton/*` as the knob it used to be. On GitHub the expectation cannot be met ("Rulesets cover branches and tags only", 12:542), and it contradicts S-BTN-191.
- **Counter-reading considered:** The row might run on plain git. It names no forge, and the rule makes openness a constant (`91:125` records the choice).
- **Smallest fix:** Drop `refs/baton/*` from the refused list.

### VER-7: S-BTN-234 drives `baton tickets new` / `baton tickets next`, names the registry says exit 2
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-127, R-BTN-199, S-BTN-234, S-BTN-97
- **Confidence:** high
- **Evidence:**
  - `15:124` — "`baton tickets new` and `baton tickets next` against the real core"
  - `11:370-375` — "The names this table replaces — `baton request`, `baton tickets …`, … — exit 2 with a `renamed:` line … No alias stays."
  - `04:494` — "`baton ticket next <kind> [--for <ticket>]`"
  - `11:322` lists `ticket new`, `claim`, `set`, `done`, `check`, `request` and no `next`; `11:271` — "**Every command a rule of this specification names is in the tree below**".
- **The problem:** As written, the row's CLI half can only observe exit 2. Separately, R-BTN-199's own command `ticket next` is missing from §11's tree, which S-BTN-97 ("every named command present") would fail on. `04:183` has the same plural slip.
- **Counter-reading considered:** The plural is loose prose. Rows are fixed scripts, and two other rows use the singular.
- **Smallest fix:** Use the singular in S-BTN-234 and at 04:183; add `ticket next` to §11's tree.

### VER-8: S-BTN-97 says `baton run` is a renamed command (exit 2); S-BTN-225 and §11 run it
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-127, S-BTN-97, S-BTN-225 (homes)
- **Confidence:** high
- **Evidence:**
  - `15:246` — "a renamed name (`baton run`)" → "exit 2 with its `renamed:` line"
  - `15:95` — "`--home <path>` on `baton run`" → "the runner works the path's checkout as before"
  - `11:297-299` — "`baton run` and `baton runner start` keep their `--home`"
  - `spec/BATON_SPEC_HISTORY.md:1807` — "(`baton run`, one of the twelve, survived in R-BTN-131 and is corrected there)"
  - `cli/baton.mjs:1217` — "if (argv[0] === 'run') &#123;"
- **The problem:** One command must both exit 2 and start a runner. The code does the second.
- **Counter-reading considered:** 11:297 only says the flag parses before the refusal. "Keep their `--home`: a name resolves…" is behaviour of a live command.
- **Smallest fix:** Either keep `baton run` as the one alias and pick another name for S-BTN-97, or say `baton runner start` only at 11:297 and in S-BTN-225.

### VER-9: S-BTN-9 names a `stop` option and an end `released:provider-suspended` no rule defines
- **Severity:** medium
- **Kind:** stale-reference
- **Rules:** R-BTN-67, S-BTN-9
- **Confidence:** high that the terms are undefined; medium that it is more than shorthand
- **Evidence:**
  - `15:127` — "| S-BTN-9 owner bar, stop | the same with `stop` | holders end `released:provider-suspended`, not failed |"
  - `05:488-496` — "**An owner bar** is `{course, tag, legs, applies: 'claim' | 'claim+advance', starts_at, ends_at?, release_holders, reason}` … With `release_holders`, when the bar starts the alarm sends `release` to every holder whose runner carries the tag and whose claim is running or about to run a matching leg."
- **The problem:** A bar has no `stop`. The end is `released:<reason>` for a reason the row never sets, and "holders" drops the rule's tag-and-leg qualifier. No test file exists, so the row is the only definition.
- **Counter-reading considered:** `stop` means `release_holders` and the reason is the fixture's. Then the row is uncheckable as written. `provider-suspended` appears nowhere else in the spec or history.
- **Smallest fix:** "the same with `release_holders` and `reason: provider-suspended` | tagged holders on a matching leg end `released:provider-suspended`".

### VER-10: S-BTN-197 says `protected` on `git` gets `inputs.board` `[sync-key]`; the rule says "those same two values"
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-188, R-BTN-189, S-BTN-197
- **Confidence:** medium
- **Evidence:**
  - `15:268` — "`protected`'s with `inputs.board` `[sync-key]` and no `forge-check` deliverer"
  - `12:417-423` — "**`plain-git`** … `inputs.board` `[sync-key, machine]` … and `outbox.forge-check` with no deliverers … A `git` repository may apply `protected` or `protected-hardware` instead; Baton then writes those same two values with it"
  - `12:450` — "`board-from-trusted` | … `inputs.board` excludes `machine`"
- **The problem:** Read literally, a protected git repository admits `machine` board posts and breaks `board-from-trusted`. The row asserts the other reading.
- **Counter-reading considered:** "Same two values" means the same two knobs, adjusted. The rule gives no adjusted value.
- **Smallest fix:** Write the values out in R-BTN-188.

### VER-11: S-BTN-191 expects `floor-violated` without setting a floor
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-188, R-BTN-189, S-BTN-191
- **Confidence:** medium
- **Evidence:**
  - `15:275` — setup "the `protected` preset on GitHub, `human_identity` set; `paths.control` set to `any`"; expects "the change to `paths.control: any` refused `floor-violated`"
  - `12:409-411` — "an apply neither sets nor clears a floor"
  - `12:460-463` — "Baton refuses any policy change after which a guarantee the list **in force before the change** names would not be met, `floor-violated`"
- **The problem:** With only the preset applied, `floors` is empty and the change is accepted from an approver or `forbidden` from anyone else — never `floor-violated`.
- **Counter-reading considered:** The row continues S-BTN-190's state. Rows are independent scripts.
- **Smallest fix:** Add `floors: [no-runner-lands]` to the setup.

### VER-12: S-BTN-205 contradicts itself
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-180, S-BTN-205
- **Confidence:** medium
- **Evidence:**
  - `15:277` — "a policy change listing W1's key … W1 un-listed … last, W1's key revoked; a ticket homed in `ops` … W1 writing and reviewing under labels" → "under `docs`' policy, which never listed W1"
  - `12:508-511` — "A label counts only in a comparison made under the policy of a repository whose `domains.per_run` listed the run's credential when the run started"
- **The problem:** `docs` did list W1 in this row, and W1 acts after the step called "last, W1's key revoked".
- **Counter-reading considered:** The `ops` clause is a separate fixture. The row gives one and says "last" before it.
- **Smallest fix:** Move the clause before the un-listing and say "did not list W1 when those runs started".

### VER-13: §12 expectations no rule states
- **Severity:** low
- **Kind:** unverifiable
- **Rules:** R-BTN-182, R-BTN-187, R-BTN-186, S-BTN-182, S-BTN-187, S-BTN-185
- **Confidence:** medium
- **Evidence:**
  - `15:260` — "its `reasons` outside the closed list are dropped"; `12:827-828` — "returns `{refuse, reasons}`, `reasons` from a closed list with path ids" (the list is enumerated nowhere).
  - `15:276` — "a truncated delivery fails closed"; R-BTN-187 (`12:985-994`) has no such clause, and S-BTN-220 tests the only truncated-delivery rule as "nothing is raised or held".
  - `12:992-993` — "per-key limits on observation numbers, board posts and concurrent claims" — no number and no row.
  - `15:263` — "the agent key's approval, policy change or hold lift is refused" — the row does not say whose hold; `12:981-983` makes only "loosening what another set" an approver's matter.
- **The problem:** Tests for these encode a guess.
- **Counter-reading considered:** These abbreviate obvious behaviour. For the closed list and the limits there is no text to abbreviate.
- **Smallest fix:** Enumerate the reasons; give the limits numbers or citations; say "another's hold"; name the observable for "fails closed".

### VER-14: S-BTN-118 and G-BTN-138 test R-BTN-143's removed "held rewrite" exception
- **Severity:** high
- **Kind:** stale-reference
- **Rules:** R-BTN-143, R-BTN-11, S-BTN-118, G-BTN-138, S-BTN-121
- **Confidence:** high
- **Evidence:**
  - `15:226` — "a held rewrite claimed by a verifying and a fresh runner | … cached runner passes, fresh one `off-branch`"
  - `15:399` — "| G-BTN-138 | A runner reads nothing at a sha off the default branch, except a held rewrite's head it verified before | S-BTN-118 |"
  - `spec/BATON_SPEC_HISTORY.md:1441` — "R-BTN-143's held-rewrite bullet is gone."
  - `08:507-510` — "On failure it makes one bounded `git fetch origin <default_branch>` into that ref and checks again …; a second failure reads nothing and ends `released:off-branch`"
- **The problem:** No section defines a held rewrite, a verifying runner or a cache that lets off-branch code pass. The gate's "except" clause is a safety exception the rule no longer has; an implementer satisfying it would run code at a sha off the default branch. S-BTN-121 (`15:115`) already tests the current behaviour.
- **Counter-reading considered:** "Cached" means a runner whose ref still holds the old history. `04:454-455` ends that claim `released:off-branch`. `grep 'held rewrite\|rewrite_held'` hits only these two lines.
- **Smallest fix:** Drop the second half of S-BTN-118 and the "except …" clause of G-BTN-138.

### VER-15: S-BTN-120 expects `not-eligible` for rule 7; the gate's code is `not-granted`
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-146, §6.6 rule 7, S-BTN-120
- **Confidence:** high
- **Evidence:**
  - `15:228` — "claim before accept; … | `not-eligible` (rule 7); posts `forbidden`, `span-changed` raised"
  - `06:445` — "| 7 | The key holds a grant for the ticket's repository (R-BTN-58) | claim, advance | `not-granted` |"
  - `06:433-434` — "A refusal is the code shown, else `not-eligible` with `rule` and `rule_code`."
- **The problem:** The row asserts a different wire code from the gates table. S-BTN-64 uses the shown code correctly ("`missing-capability` (rule 4)"). No scenario anywhere asserts `not-granted`.
- **Counter-reading considered:** `not-eligible` as a generic wrapper is refuted by 06:433.
- **Smallest fix:** "`not-granted` (rule 7)".

### VER-16: S-BTN-102 expects the actor `mcp:<name>`; the rule records `mcp:<id>`
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-130, S-BTN-102
- **Confidence:** high
- **Evidence:**
  - `15:249` — "one core function, one output, `mcp:<name>`; one refusal code"
  - `11:460-461` — "The actor is recorded as `mcp:<id>` in history and release messages, shown with its name."
  - `13:26` — "`mcp:<id>` (an MCP key's immutable id, never its reusable name, R-BTN-130)"
- **The problem:** `leg.stop` sets no hold, so the only `mcp:` value is the actor, which is the id. The name is reusable after revocation (S-BTN-101), so `mcp:<name>` is the confusable form the rule removed.
- **Counter-reading considered:** The row means the displayed name. It writes the stored token.
- **Smallest fix:** `mcp:<id>`.

### VER-17: S-BTN-55 expects `forbidden` for a revoked sync key; R-BTN-93 says `unauthenticated`
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-93, S-BTN-55
- **Confidence:** medium
- **Evidence:**
  - `15:98` — "machine (sync off), mirror and revoked keys post; a replay | accepted; `conflict`; `forbidden`; `unauthenticated`"
  - `03:208-211` — "It refuses `unauthenticated` (no credential, bad signature, unknown or revoked key, a token that fails) or `forbidden` (another role, a key that is no sync credential, a machine key whose grant does not sync there)."
- **The problem:** Four setups map to four expectations, putting the revoked key under `forbidden`.
- **Counter-reading considered:** `03:200` "any other key is `forbidden`" could cover it, but 208 names "revoked key" explicitly.
- **Smallest fix:** Move "revoked" beside "a replay".

### VER-18: S-BTN-54's `post-receive` hook runs the sync; R-BTN-94 says the hook only touches a spool file
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-94, R-BTN-105, S-BTN-54
- **Confidence:** medium
- **Evidence:**
  - `15:97` — "`plain` with a `post-receive` running `baton repo sync --defaults-only`"
  - `03:264-266` — "optionally a server `post-receive` hook that only touches a spool file (`baton repo spool <repository>`) … The hook never reads the sync key and never waits for a sync."
- **The problem:** A hook that runs the sync reads the key and waits, both excluded. `repo spool` appears in no row.
- **Counter-reading considered:** "Running" is loose for "triggering".
- **Smallest fix:** "a `post-receive` running `baton repo spool`, the sync account's loop running the sync".

### VER-19: S-BTN-116 expects "only `path` kept"; R-BTN-140 now has the owner post the ids — and §13/§14 still state the old shape
- **Severity:** medium
- **Kind:** restatement-drift
- **Rules:** R-BTN-140, §13.1, §14, S-BTN-116
- **Confidence:** medium
- **Evidence:**
  - `15:104` — "A's owner writes `code_repos` carrying a `repo_id` and `consented_at` for B" → "only `path` kept, no reach until B consents"
  - `03:503-512` — "an entry is `{path, forge?, host?}` … Baton stores `{path, forge, host, repo_id, owner_id, web_base}` … `baton owner settings` reads them from that forge's API … or takes `--forge-ids`, and posts them; Baton never fetches."
  - `13:65` — "`code_repos` JSON `[{path, repo_id, former_paths}]` — owners write `path` only; Baton resolves `repo_id`"
- **The problem:** Under R-BTN-140 the post must carry the ids, so "only `path` kept" is false; only the `consented_at` drop still holds. §13 says Baton resolves ids while §3 says Baton never fetches.
- **Counter-reading considered:** "Only `path` kept" means only the consent is dropped. The row sets up a `repo_id` to see it discarded.
- **Smallest fix:** Row → "the posted `consented_at` dropped, no reach until B consents"; align 13:65 and 14:123.

### VER-20: S-BTN-228 probes a 5 KB profile, a "Workers view" and a dirty-build warning the rules do not have
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-72, §12.3, §11.4, S-BTN-228
- **Confidence:** high for the bound; medium for the rest
- **Evidence:**
  - `15:229` — "one whose `profile` is a string and one of 5 KB | … warning on a branch and a dirty build only; … the Workers view shows it …; the malformed ones refused `invalid-params`"
  - `12:150-152` — "**Opaque blobs** (… a runner's profile and reports …) are JSON stored verbatim …: at most 16 KB per blob"
  - `08:271-275` — "on a branch, the warning `baton: running from branch <name> at <sha> — not a pinned commit` … (a released copy: the commit `dist/build.json` names, unpinned when that build was dirty)"
  - "Workers view" appears in no section file except this row.
- **The problem:** A 5 KB profile is under the 16 KB cap, so the refusal contradicts §12.3. No rule requires the profile to be an object. The page is `/runners`, and no rule states a dirty-build warning.
- **Counter-reading considered:** The profile has a tighter bound stated elsewhere. Sub-reader grepped `profile` in all sections; none.
- **Smallest fix:** State a profile bound and shape, or probe above 16 KB; say "Runners"; state the dirty warning in R-BTN-72.

### VER-21: S-BTN-22 expects "override recorded" where R-BTN-100 says nothing is recorded, against S-BTN-24
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-100, S-BTN-22, S-BTN-24
- **Confidence:** medium
- **Evidence:**
  - `15:154` — "default order, nothing flagged; override recorded (the bound is docs' ranking)"
  - `06:538-539` — "A claim against Baton's advice (a resource block, the expedite bound, `max_queue`) records `advice-overridden`; against the course's ranking, nothing."
  - `15:79` (S-BTN-24) — "claims of a fifth-ranked ticket, of a leg with a fleet `resource` block … first two accepted, the second recording `advice-overridden`"
- **The problem:** None of the three listed advices applies in S-BTN-22, and S-BTN-24 reads as if an out-of-place claim records nothing.
- **Counter-reading considered:** The parenthesis is examples, not a closed list.
- **Smallest fix:** Add "its default order" to R-BTN-100 and align S-BTN-24, or change the row to "nothing recorded".

### VER-22: S-BTN-19 and S-BTN-27 test advice concepts no rule defines
- **Severity:** medium
- **Kind:** stale-reference
- **Rules:** R-BTN-98, R-BTN-40, R-BTN-100, G-BTN-47, S-BTN-19, S-BTN-27
- **Confidence:** high that `frees_at` is undefined; medium on S-BTN-27 (sub-reader)
- **Evidence:**
  - `15:151` — "ranking reads `frees_at`; suspended; first in line at +2 h" (`frees_at` appears nowhere else in the spec)
  - `15:155` — "`launch-candidates` serves the ranking code; a claim on another line accepted, recording the model"
  - `01:306` — "Baton calls and stores no course code."; `01:322` — "Estimates stay on the runner; Baton stores no estimate or forecast."
- **The problem:** S-BTN-19 names a field nothing defines and an ordering the default order lacks, yet G-BTN-47 cites it as proof of the default order. S-BTN-27's "serves the ranking code" reads against R-BTN-98, and Baton records no model. Neither has a test file.
- **Counter-reading considered:** Both describe `rank.mjs` on the runner. Then the observable is course code, not Baton's.
- **Smallest fix:** Rewrite both in R-BTN-76/R-BTN-100 terms, or retire them and re-point G-BTN-47.

### VER-23: Rows assert fields, flags or behaviour found in no rule
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** R-BTN-122, R-BTN-69, R-BTN-93, R-BTN-74, R-BTN-72, R-BTN-113, R-BTN-199; S-BTN-86, 156, 159, 201, 203, 206, 218, 229, 230, 234
- **Confidence:** high for the grep absences I ran (`coefficient`, `in_claim`, `exhausted_on`, `--sync-key`, `BATON_SYNC_TOKEN`, `register_moved`); medium for the rest (sub-readers)
- **Evidence:**
  - `15:188` (S-BTN-86) — "a file with `coefficient`, `in_claim` or `exhausted_on` | … the retired fields refused with the file"; `05:167-174` lists the refused fields and names none of the three.
  - `15:253` (S-BTN-156) — "no `BATON_SYNC_TOKEN`; … an API-key file passed as `--sync-key`"; neither appears in any rule or §11's tree (`11:331`).
  - `15:174` (S-BTN-218) — "a record computed under another register is served `register_moved`"; the behaviour is at `08:538-540`, the field name nowhere.
  - `15:202` (S-BTN-159) — "not one `no recommendation (no worker holds this secret)` line … at `remoteSlug`"; no rule.
  - `15:200` (S-BTN-201) — "the beat's interval unref'd … fallback timers"; no rule states the runner stays alive through a wait.
  - `15:116` (S-BTN-203) — retired-table residue "through the window"; only `91:234` mentions B-142.
  - `15:117` (S-BTN-206) — "a refresh naming a course not in force is refused"; "two tickets of one post never share a key"; neither is in §4.3 step 4 or §4.4.
  - `15:122` (S-BTN-230) — "`tests: ci`"; the result shape at `08:229-230` is "`{suspend: true, reached, next, detail?}`".
  - `15:121` (S-BTN-229) — "the bare `session_url` is dropped and logged"; `08:490-494` drops a failing URL, not a legacy field.
  - `15:124` (S-BTN-234) — "`for` on the ticket's row"; `04:504-505` says only "recorded and never trusted".
- **The problem:** For each, the scenario is the only specification, which inverts R-BTN-31. For S-BTN-86 an implementer cannot tell whether unknown `retry` keys are refused in general.
- **Counter-reading considered:** A blanket "unknown field is refused" rule would cover several. None was found for course files or heartbeats.
- **Smallest fix:** Add one sentence to each home rule, or mark the row a regression test citing its ticket.

### VER-24: Rows whose setup cannot produce the expectation, or that are ambiguous
- **Severity:** low
- **Kind:** underspecified
- **Rules:** S-BTN-18, 28, 43, 50, 65, 69, 108, 109, 112, 124, 131, 157, 172, 189, 225 (homes), 233; R-BTN-39, R-BTN-50, R-BTN-88
- **Confidence:** medium (sub-readers; I checked the R-BTN-50 and R-BTN-88 quotes)
- **Evidence:**
  - S-BTN-18 `15:78` — "during an active claim with an unconfirmed end": rule 3 (`06:441`) lets a ticket have one or the other, not both.
  - S-BTN-18 — "`--ran review` adds one `review` run toward `max_runs`" against `01:175-176` — "the runs `--ran` adds are recorded before `runs_from` and do not count toward it".
  - S-BTN-28 `15:80` — "`src/` passes the boundary test" against `01:232-236` — "may not appear in `src/core/` … `src/defaults/` is exempt". The row also runs S-BTN-17/18/33/36 on `chore`, which has none of their stations.
  - S-BTN-50 `15:113` — "identical exports with only owner state" against `04:762` — "**R-BTN-88 (owner state and course history are exportable…**". G-BTN-78 cites it for an unfreeze the row never performs.
  - S-BTN-157 `15:173` — expects `busy:again` with no setup that leaves the number outstanding at the retry.
  - S-BTN-189 `15:94` — claims on "a bare origin" with no Baton and no `--offline`, which `04:275-278` refuses. "The ticket alone" for `--direct` with `--depends-on` edits the dependency too (`04:252-254`). "`init --force` writing it again" against `04:316-317` (rewritten when it differs, no flag) and `05:78-81`.
  - S-BTN-124 `15:251` — "destructive dashboard acts … `202 {confirm_code}` … Stop at once" against `11:562-563`, which also exempts hold and cancel.
  - S-BTN-233 `15:181` — a read of a version "closed `done`" refused `closed`, though `07:798-799` never hands such a version; "ring nothing" where the release itself rings.
  - Smaller: S-BTN-43 counts a `done` file among "four tickets on `create-pr`". S-BTN-65 "fails both". S-BTN-69's `--max-tier 3` act is undefined. S-BTN-108's "reserved `waiting_on`" refusal is not what `06:64-67` refuses. S-BTN-109's `file:` dependency sits among "each runs" though `08:572` fails a directory one. S-BTN-112 puts "naming both origins" on the wrong clause. S-BTN-131's `reraised` 1 has no stated base. S-BTN-172's missing `baton.json` is neither "unreadable" nor "malformed". S-BTN-225's malformed `homes.json` has no rule.
- **The problem:** Each is a fixed script that either cannot run as written or cannot distinguish two readings of its rule.
- **Counter-reading considered:** Most are compression. R-BTN-30 calls rows fixed scripts.
- **Smallest fix:** Per row, as above.

### VER-25: Duplicated rows
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** S-BTN-13/121, S-BTN-101/124, S-BTN-18/47/195
- **Confidence:** high
- **Evidence:**
  - `15:107` and `15:115` both assert: posts nothing, releases `unfounded`, `baton.head-unfounded`, `head-moved`, `head-reset`, first snapshot.
  - `15:248` and `15:251` both assert an MCP key lifting its own hold and `forbidden` on another's.
  - `arrival-unapplied` for unreported human work appears in `15:78`, `15:111` and `15:270`.
- **The problem:** One fact asserted in three rows drifts three ways.
- **Counter-reading considered:** The overlap is deliberate. G-BTN-141 already cites both 13 and 121.
- **Smallest fix:** Cut S-BTN-13 to ordering; drop "MCP hold edits" from S-BTN-124.

## F. Rules no scenario or gate exercises

### VER-F1: Whole rules with no scenario or gate
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** R-BTN-196, R-BTN-37, R-BTN-136, R-BTN-2, R-BTN-38, R-BTN-1, R-BTN-193
- **Confidence:** medium (term greps by sub-readers)
- **Evidence:** greps of 15 for each id and its key terms (`state_version`, `vendor`/`manifest`, `sink`/`forge-secrets`, `Paid`, `stateless`) found nothing.
- **The problem:** Three behavioural rules have no test hook:
  - **R-BTN-196** — every state write moves `state_version`; liveness writes do not; "nothing eligible" is remembered per runner for at most 10 minutes. A stale remembered answer starves a runner.
  - **R-BTN-37** — vendored modules match the manifest and the suite fails on drift. Needs a gate.
  - **R-BTN-136** — per-tenant secrets; no command reads a secret back; no Baton credential adds an administrator. Security-relevant.
  - **R-BTN-2** — the dashboard shows the day's usage against plan limits (the display half is behavioural).
  - Not needing a scenario: R-BTN-38, R-BTN-1, R-BTN-193 (design statements); R-BTN-23 (an alias of R-BTN-122); R-BTN-97 (operator obligation).
- **Counter-reading considered:** Unit tests may cover them. The spec names none.
- **Smallest fix:** A row for R-BTN-196; gates for R-BTN-37 and R-BTN-136.

### VER-F2: Behavioural clauses of exercised rules with no scenario or gate
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** see list
- **Confidence:** medium (sub-reader greps; the term in backticks is absent from 15 unless noted)
- **Evidence and problem:** Safety- or security-relevant first.
  - **R-BTN-15/156** — OIDC `job_workflow_ref` must be the `sync_workflow`; issuer only from `BATON_FORGE_SECRETS`, never the token's `iss`; GitLab `ref_protected`. S-BTN-125 covers event names only.
  - **R-BTN-13** — `expires`/`alg` refused; `sk-` signatures need the user-presence flag; the 11-minute nonce window.
  - **R-BTN-57** — the `github-app create` manifest flow (loopback, `state`, owner checks).
  - **R-BTN-14 / R-BTN-3** — `session-taken`, `runner-reaped`, and a re-key refused while a claim is active appear in no row or gate.
  - **R-BTN-9** — the lease clamp [900, 86400] and "fence on the lowest value declared since `last_ok`".
  - **R-BTN-135** — `tenant-mismatch` handshake refusal.
  - **R-BTN-102** — `baton.machine-post`.
  - **R-BTN-85** — `bars-mismatch`, `closed-under-claim`, `spawned-unposted` have no setup. G-BTN-75 cites S-BTN-47 and G-BTN-76 cites S-BTN-49, and neither row sets up a discrepancy.
  - **R-BTN-62/150** — `baton.observation-held`, the positive `baton.sync-barred` case.
  - **R-BTN-171** — deliverer lease of 10 minutes, the 1/5/30-minute requeue, a mark from another credential `forbidden`.
  - **R-BTN-160** — quotas (20 open conditions per claim, 200 raises a day).
  - **R-BTN-122** — `"replaces": "retry"`; `backing-off` refusal with `until`; `lease-lost` counted once per runner.
  - **R-BTN-12** — the expedite lane's `expedite-bound`.
  - **R-BTN-63/83** — `cancel-leg` refusal; **R-BTN-71** — a suspension at a non-reached station refused; **R-BTN-82** — `output-unclaimed`.
  - **R-BTN-149** — 201st session `quota`, `baton.write-budget`; Admission's 600 calls a minute.
  - **R-BTN-28** — shadow mode (`not-cut-over`, `shadow-conflict`). **R-BTN-8** — `status-write`.
  - **R-BTN-117** — `--uses`, `baton.token-burst`. **R-BTN-146** — `baton.grant-declined`, `--confirm-span`. **R-BTN-159** — API-key 90-day and 7-day-idle bounds. **R-BTN-155** — 4-hour session, `baton.sign-in-burst`.
  - **R-BTN-94** — `baton.sync-late`, `baton.mirror-late`, `baton.forge-secret-missing`. **R-BTN-138** — `baton.remote-stale`. **R-BTN-139** — `baton.pushers-degraded`. **R-BTN-140** — `baton.code-repo-unconsented`. **R-BTN-76** — `baton.resource-unknown`.
  - **R-BTN-134** — `min_cli`, `Baton-Source:`. **R-BTN-131** — the stub's idle and absolute bounds. **R-BTN-142** — `baton owner bar follow`. **R-BTN-165/168/120** — `skip_withdrawn`, `lifetime: parent`. **R-BTN-169** — the `announce` course. **R-BTN-88** — `--with-history`, `unfreeze`. **R-BTN-81** — the 90-day purge of history. **R-BTN-24/25** — `previous_attempts` cap; a resume naming another branch ignored. **R-BTN-84** — replay refusing a moved `current` version. **R-BTN-145** — `systemd-run` scope and pid-reuse check. **R-BTN-187** — per-key limits (VER-13).
  - **R-BTN-7, R-BTN-26 and the three fence layers** — covered only by gates whose proof is the bare word "tests" (G-BTN-15, 16, 20, 38); `not-holder` appears in no row. Twenty gates have "tests" as their whole proof.
- **Counter-reading considered:** Many are small. The condition names matter: about a dozen `baton.*` conditions an owner is told to act on have no test that they are ever raised.
- **Smallest fix:** One row per condition family ("each `baton.<sub>` in R-BTN-163's table is raised by its trigger and closed by its fix"), and rows for the identity and lease clauses.

## G. The prose: the model and the harness

### VER-G1: R-BTN-68 states liveness properties as checked; nothing runs them
- **Severity:** high
- **Kind:** unverifiable
- **Rules:** R-BTN-68, R-BTN-28, R-BTN-19
- **Confidence:** high
- **Evidence:**
  - `15:43` — "**R-BTN-68 (the core is a checked model).**"
  - `15:50-51` — "Liveness: every end is confirmed or flagged; every fence clears; a ready leg with an eligible idle runner is eventually taken."
  - `15:64` — "`npm run model:full` (simulation, witnesses, 1,000 traces, the proof, the scenario traces)"
  - `model/README.md` "Checked how" — "liveness, `fencesClear` | … **at `b76af9c`, the pre-round-2 formula and model**: no violation in 8,187 distinct states before a 28-minute cap, not exhaustive. The current formulas (rounds 2–3) have not been run"
  - `model/check.mjs:27` — the typecheck loop is the only place a script touches `liveness.qnt`; `model/full.mjs` runs `model`, replay, `model:verify`, traces.
- **The problem:** No command checks any liveness formula. The one historical run covered one property, on an older formula, capped and non-exhaustive. "Every fence clears" is what the stuck-ticket argument leans on, and fencing has since changed (administrator clear, per-claim fences).
- **Counter-reading considered:** The safety invariant `noStuckTicket` covers deadlock. It is a state invariant, not "eventually", and lies outside the depth-4 proof.
- **Smallest fix:** Say "stated in `liveness.qnt`, not checked (ticket)", or add the run to `model:full` with its bound.

### VER-G2: The model asserts one claim per runner, citing R-BTN-4, which now allows up to 32; §13 still lists the index
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-68, R-BTN-4, R-BTN-9, R-BTN-19, S-BTN-229
- **Confidence:** high
- **Evidence:**
  - `15:52-53` — "A change to a requirement the model cites changes the model in the same PR."
  - `model/properties.qnt:81` — "val oneClaimPerWorker = WORKERS.forall(w => workerClaim(w).size() &lt;= 1)"; `model/README.md` — "| `oneClaimPerWorker` | R-BTN-4 |"
  - `09:15-18` — "A runner holds at most the lower of two numbers at once … its **`concurrency`** …: an integer from 1 to 32, default 1"
  - `09:28-31` — "Each claim keeps its own nonce, legs, stop (R-BTN-119), end, reap and fence, … the lease that keeps them all is the runner's (R-BTN-9)."
  - `13:197` — "**Indexes that rules depend on.** `one_active_claim_per_ticket`; `one_active_claim_per_runner`;"
  - `grep 'B-188\|max_claims\|concurrency' model/*.qnt` — no hit.
- **The problem:** The model's safety set contains the negation of a spec rule, and §13 still names a unique index that would refuse S-BTN-229's second claim. Everything R-BTN-68 claims holds only for single-claim runners. The unmodelled interleavings are the risky ones: one lease keeping N claims alive; one claim force-reaped and fence-pending while the runner heartbeats for the others. The model's fence clears when the worker "has been silent … past its timeout", a path that no longer exists for a runner with a second live claim.
- **Counter-reading considered:** `concurrency` defaults to 1. The guarantee is not qualified by the default, and the README's "Not modelled" list does not mention several claims.
- **Smallest fix:** State the bound in R-BTN-68, file the model change, and delete the index from 13:197.

### VER-G3: "Its properties hold for every course" overstates what is checked
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** R-BTN-68, R-BTN-10, R-BTN-35, R-BTN-178, R-BTN-106, R-BTN-171, R-BTN-6, R-BTN-26
- **Confidence:** high
- **Evidence:**
  - `15:44-47` — "… is a Quint model (`model/baton.qnt`), with the sync's output nondeterministic within its contract, so its properties hold for every course."
  - `model/baton.qnt:66-70` — "// ---- the course: roadmap-pr's course.json …" / "pure val LEGS = Set("implement", "review", "fix", "adjudicate", "merge")"
  - `model/README.md` — "Depth 4 on `small` … does not reach: a judged snapshot (a confirmation, a stale release or a regression needs 6–8 steps); … the fleet's rows, at any depth"
  - `model/README.md` Not modelled — "`no_chain_from` (R-BTN-106; … the model still lets a key review what it implemented …), child tickets' spawned rows (R-BTN-86), `not_before` and leg deadlines"; "**More than one repository**"; "**Seats' leg halves** … a capacity only a leg names is never checked here"
  - `model/README.md` Bounds — "R-BTN-6's fence holds while the worker's lag is at most the margin (4 minutes in the spec); above it, a reaped worker can push."
  - `09:79` — "the **wall clock** (never a monotonic clock)"
- **The problem:**
  - The graph is one constant five-leg course; nothing is shown for call, person, fact, cancel or timed legs.
  - Two of the five listed safety properties ("no end confirmed by an earlier observation", "stale only when git takes the ticket back") are outside the bounded proof; their evidence is random simulation.
  - R-BTN-68 has no "not covered" list, while the spec leans on properties the model lacks: the outbox's "effect at most once" (`07:664-665`), seats on a leg, `no_chain_from`, distinct sequence numbers, tenant isolation, floors.
  - The fence's safety rests on a clock-drift bound the spec never states (`grep -i 'drift\|skew'` finds nothing on clocks), while R-BTN-26 mandates the wall clock, which an NTP step can move by more than the 4-minute margin. The `pre-push` holder query (09:93-97) narrows the push case only.
- **Counter-reading considered:** The README is honest about all of this. But the spec is normative and R-BTN-28 gates cutover on "a green model".
- **Smallest fix:** Replace "every course" with the bound checked, add a Not-modelled list by rule id, and add the drift bound to `90-load-bearing-assumptions.md`.

### VER-G4: "Every scenario's event log is checked against the model" is false three ways
- **Severity:** medium
- **Kind:** unverifiable
- **Rules:** R-BTN-68, R-BTN-29
- **Confidence:** high
- **Evidence:**
  - `15:52` — "Every scenario's event log is checked against the model."
  - `model/README.md` — "A step the model has no action for … ends the part of the trace the model can judge … Each such stop is pinned … in `test/integration/trace-scope.json`"
  - `test/integration/trace-scope.json` — 37 pinned stops, e.g. "S-BTN-36.observations › … a claim is made stale only by a reading numbered after it" stops at step 7, "tiers are not modelled"; "S-BTN-12.completion-confirmation" stops at step 7, "docs' interim shape, not modelled".
  - `package.json:29` — `"test": "BATON_SKIP_QUINT=1 vitest run && npm run model:links"`
- **The problem:** About 85 scenarios have no log. A trace is judged only to its first unmodelled step, and the pinned stops cut off the very properties R-BTN-68 lists. The check runs only in commands R-BTN-68 calls advisory, so a core change that breaks the confirmation rule can merge with every required check green.
- **Counter-reading considered:** `trace-scope.json` makes each exclusion a reviewed diff. The spec does not mention it.
- **Smallest fix:** "Each built scenario's local trace is replayed up to its first unmodelled step; the stops are pinned in `trace-scope.json`."

### VER-G5: The harness prose makes three claims the repository contradicts
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-29, R-BTN-87, R-BTN-55, G-BTN-77, S-BTN-31
- **Confidence:** high
- **Evidence:**
  - `15:26-32` — "**The load test.** `npm run test:load` drives R-BTN-87's envelope mix … It runs on the local host in CI"; `02:228` — "`npm run test:load` proves it (§15)."
  - `package.json` has no `test:load`; `grep -rn 'test:load'` finds only the spec and `tickets/R3-1258.mdx`.
  - `15:21` — "`npm test` (alias `npm run test:baton`) on every PR and nightly on `main`"; `.github/workflows/ci.yml:8-11` has `pull_request` and `push: branches: [main]`, no `schedule:`. `test` and `test:baton` are different commands (`package.json:29,32`).
  - `15:22-23` — "Every scenario runs in the Workers runtime project and again on the local host"; `02:102-103` — "Every integration scenario runs against both hosts."; `15:85` (S-BTN-31) — "the full set on Cloudflare; S-BTN-1, -2, -12, -17, -30, -33, -34 also locally".
- **The problem:** The capacity envelope is "proved" in two sections by a command that does not exist. The nightly run does not exist. S-BTN-31 tests the harness as it used to be, and S-BTN-33, one of its seven, has no test on either host (it is in S-BTN-28's list too).
- **Counter-reading considered:** "Partly built — B-50" covers the load test. B-50 is the weekly model check; the load test is written in the present tense with a gate.
- **Smallest fix:** Mark the load test unbuilt in both sections and G-BTN-77; delete "nightly" or add the schedule; rewrite S-BTN-31.

### VER-G6: `model/README.md` and a leftover model file contradict R-BTN-68
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-68
- **Confidence:** high
- **Evidence:**
  - `15:58-63` — "**The report is advisory, never a merge requirement** … green with none pasted, red only for a pasted report that shows a failed check."
  - `model/README.md` — "CI's `model-report` workflow … reads the body, and fails until the report is there"
  - `model/lightQuestion.qnt:1` — "// A light question (R-BTN-173) …"; `spec/BATON_SPEC_HISTORY.md:1365` — "`model/lightQuestion.qnt`) are retired." R-BTN-173 is not in the index.
- **The problem:** The only document that says what is modelled states the opposite merge rule, and the directory ships a 586-line model of a retired requirement.
- **Counter-reading considered:** The README is not spec. It is the only place the coverage is written down.
- **Smallest fix:** Correct the paragraph; delete or mark the file.

## Seen in passing, outside the span (low, unverified beyond the quote)
- `07:114` closes a `suspend` condition when "its handler ticket closes", while `07:225-233` settles it when the person leg is answered; S-BTN-127 follows the second.
- `05:169` and `07:462` refuse `after_s`, while `05:132` requires `expires: {after_s, reached}`.
- `01:251` and `13:68` cite R-BTN-117 for `api_keys`, which R-BTN-159 defines; `14:16-17` cites R-BTN-129 for `confirm-required`, which §12.2 defines.
- `91:148` says MCP reaches "`ticket.hold` (add only)", while R-BTN-186 lets it lift its own.
- `15:177` (S-BTN-167) lacks its closing `|`.
- No file contained text addressed to the reader.

## Read but found sound
- §9 rows S-BTN-1, 2, 3, 4, 12, 17, 23, 204 against `09-claims.md`: lock, reaping, fence deadline, 6 h flag, run ids.
- §10 rows S-BTN-68, 81, 123 against `10-checks.md`: conclusions, 15 min, `check-mismatch`, `head-moved`.
- §7 retry, deadline and outbox numbers: 3600 ±10%, 40 min re-arm, +15 min, 72 h / 1 day, 24 h, 3 snapshots, 120 s, 2 days.
- §8 stop ladder (SIGINT, 10 s, 25 s, 30 s), leg log (50 MB gap), executor rows 208–213, scope rows (sixteen, `scope-invalid`, `unclaimed-write`).
- §6 block rows 44, 45, 72, 82, 91–96, 223, 224 and capacity S-BTN-21 (rule 11 `capacity-full`).
- §12 rows 181, 183, 184, 186, 190, 192, 195, 196 and the label codes of 205.
- S-BTN-225 retention's numbers against R-BTN-149; S-BTN-233's refusal codes and release reasons against R-BTN-198.
- No cited `R-BTN-n` in lines 1–281 is undefined or retired; "rule 1/3/4/11/13" all resolve. No gate cites a scenario without a row.

## Not covered
- **§12 rows not checked against their home rules:** S-BTN-188 (R-BTN-70/62), 193 (R-BTN-190), 194 (R-BTN-131 record courses), 198 (retirement), 199 (pickup/board). I checked them for internal sense only. S-BTN-187 and 182 were checked against R-BTN-187/182 only.
- **Clauses sub-readers marked not verified:** S-BTN-40 ("held syncs", "the schedule covers the loss"); S-BTN-26 ("tokens per repository"); S-BTN-45 and 61 (which input gets which code); S-BTN-93 (a block naming `baton.retries`); S-BTN-218 (`needs_you`, "pre-course-group shape"); S-BTN-227 (`invalid-params` for a lower recommended client); S-BTN-136's last clause; S-BTN-5's resume half.
- **Part (f)** rests on term greps, not on reading test code; a clause listed as unexercised may be covered by a unit test the spec does not name. Rules of §12 were not swept for (f) beyond R-BTN-187.
- **Model and tests:** I did not run the model, the tests or `spec:impact`, and did not read `baton.qnt` beyond greps. Whether the 99 existing test files assert what their rows say was not checked.
- **Gates table** (line 282 on): read only for citations.
