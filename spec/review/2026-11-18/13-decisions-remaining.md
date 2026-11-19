---
title: "Adversarial review 2026-11-18 — the Decisions lines the first pass did not reach"
description: "One reviewer's findings, as filed, on the lines of BATON_SPEC's Decisions that the first pass did not compare with the rules they cite."
order: 22
tags: [review]
---

# Adversarial review 2026-11-18 — the Decisions lines the first pass did not reach

Material: `spec/BATON_SPEC/91-decisions.md`. Every decision line the DEC report left unchecked was compared with the body of the rules it cites. I read §12.8 whole (`12-security.md:272–999`), §11.4 whole (`11-people.md:491–685`), and the full bodies of R-BTN-161/-162/-163, -195, -198, -190, -194, -108 to -112, -133, -134, -47, -35, -39 and -174. Three parallel readers covered the remaining lines (30 + 28 + 36 lines); I re-checked their main quotes against the files (DEC2-5, -6, -10, -11, -12, -15, -19, -24 and one aside), not all of them.

Mechanical result: every `R-BTN-n` cited in the file is defined in the index, and none is in the Retired requirements table (ranges R-BTN-29–31 and R-BTN-135–138 included). The only retired ids reached remain the ones DEC-18 reported.

Counts: 0 critical, 0 high, 8 medium, 18 low. Nothing found was addressed to the reviewer as an instruction.

All paths below are under `/Users/neumark/git/baton/`.

---

### DEC2-1: R-BTN-134 pins a sourced course at any ancestor of the default branch and never a tag; R-BTN-183 and §12.8 say first-parent history or a release tag
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-134, R-BTN-183 (Source pins), §12.8 "R-BTN-134 holds in full", Decisions line 71
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:71` — "Chose a course pinned to a source commit reachable from its default branch, read from one directory … over a CLI registry, moving refs, copies checked byte-equal or a sandboxed `sync.mjs`"
  - `spec/BATON_SPEC/05-courses.md:35-36` — "`<commit>` all 40 hex characters, never a branch or tag"
  - `spec/BATON_SPEC/05-courses.md:45-46` — "the commit must be an ancestor of the fetched head — **a commit is never fetched by its id**"; `:53-54` — "a commit off the default branch … is a course fault (`spec`)"
  - `spec/BATON_SPEC/12-security.md:888-889` — "**Source pins** (R-BTN-134) are accepted only at a commit on the source's first-parent history or a release tag."
  - `spec/BATON_SPEC/12-security.md:995-998` — "**R-BTN-134 holds in full** (B-139): … runners load a sourced course's code only from the source, at a first-parent or release-tag commit"
- **The problem:** Two observable differences. (a) A pin at a commit merged in from a side branch (an ancestor, not first-parent) loads under R-BTN-134 and is refused under R-BTN-183/§12.8. (b) A pin at a release tag's commit that is off the default branch is admitted by R-BTN-183/§12.8 and is a course fault under R-BTN-134. §12.8 attributes its version to R-BTN-134, whose body does not say it. `first-parent` appears in `05-courses.md` nowhere (grep: only `03:458,462`, `08:529`, `12:888,997`).
- **Counter-reading considered:** R-BTN-183 may bind only the merge runner (what pin change it merges) and be stricter on purpose. But `12:995-998` is explicitly about what runners load and claims it is R-BTN-134.
- **Smallest fix:** Pick one rule and write it in R-BTN-134; make R-BTN-183 and `12:995` cite it without restating.

### DEC2-2: The decision retires `ui.state`; §14 still serves `GET /v1/ui/state` as "everything the dashboard draws", and S-BTN-170 tests `admin/state` against it
- **Severity:** medium
- **Kind:** unverifiable / contradiction
- **Rules:** Decisions line 246, §14, R-BTN-179, R-BTN-57, S-BTN-170, §11.4 "The rule"
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:246-249` — "Chose to keep `GET /v1/admin/state`'s shape, built by one named core function with each section equal to the matching entity read's first page at the same instant, over retiring it with `ui.state` … (R-BTN-57, R-BTN-179, S-BTN-170; B-216 builds it)"
  - `spec/BATON_SPEC/14-api.md:165` — "`GET /v1/admin/state` | admin | — | what `GET /v1/ui/state` answers an administrator's session, from the same state"
  - `spec/BATON_SPEC/14-api.md:171` — "`GET /v1/ui/state` | session | — | everything the dashboard draws; for an owner's session, its repositories' only"
  - `spec/BATON_SPEC/15-verification.md:254` — "the administrator's signed `GET /v1/admin/state`, and its API key's, equal its session's `GET /v1/ui/state` at the same instant"
  - `spec/BATON_SPEC/11-people.md:642-643` — "A screen is drawn from one entity's REST reads — the §14 rows whose callers admit `session` (B-192)"
  - also `12-security.md:61`, `13-data-model.md:207`, `14-api.md:150` still define things by "`/v1/ui/state`'s" rows.
- **The problem:** The decision defines `admin/state` by the entity reads and treats `ui.state` as retired. §14 defines `admin/state` by `ui/state`, keeps `ui/state` as the dashboard's source (against §11.4's "one entity's REST reads"), and the cited scenario asserts equality with a route the decision retires. A test written to S-BTN-170 needs the retired route; one written to the decision has no scenario.
- **Counter-reading considered:** B-216 is `available`, so the rules may be waiting for it. The decision is listed as in force and cites S-BTN-170 as carrying it; the scenario says the opposite.
- **Smallest fix:** Rewrite `14:165`, `14:171` and S-BTN-170 to the decision ("each section equals the matching entity read's first page"), or mark the `ui/state` row as retiring with B-216.

### DEC2-3: R-BTN-133 says a sourced course's `course.json` is "pinned byte-equal by the sync"; R-BTN-134 forbids a home copy and the decision rejected byte-equal copies
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-133 (Owner-signed control), R-BTN-134, Decisions lines 20 and 71
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/08-runners.md:547-549` — "a sourced course's `course.json` is pinned byte-equal by the sync (B-33) and could never be signed after its scaffold, so the graph travels with the scripts"
  - `spec/BATON_SPEC/05-courses.md:55-58` — "**The home of a sourced course** holds its entry … and only overrides under `.baton/courses/<course>/`: `legs/<leg>.run.<ext>` (R-BTN-131) and `legs/<leg>.md`. Any other course file there beside a `source` fails the sync, naming the file."
  - `spec/BATON_SPEC/05-courses.md:75-76` — "writes the entry, the sync workflow and the tickets README, never a course file"
  - `spec/BATON_SPEC/91-decisions.md:71` — "over a CLI registry, moving refs, copies checked byte-equal"; `:20` — "the home referring to Baton's legs rather than copying them"
- **The problem:** R-BTN-133's signed-control walk reasons from a scaffolded home `course.json` that the sync checks byte-equal to the source. Under R-BTN-134 that file fails the sync. Which commit a sourced course's graph is loaded from under `require_signed_control` therefore rests on a mechanism the spec removed. `B-33` and "byte-equal" in this sense occur nowhere else in the section files.
- **Counter-reading considered:** "Pinned byte-equal" could mean only "the pinned source commit fixes its bytes". "After its scaffold" then has no referent, since init writes no course file.
- **Smallest fix:** In R-BTN-133: "a sourced course's `course.json` is the source's at its pinned commit (R-BTN-134), so it is never in the home's signed group".

### DEC2-4: Three places say leg state is the side branch on a `git` repository "by no knob"; R-BTN-190 decides it by the course's `facts` too
- **Severity:** medium
- **Kind:** restatement-drift
- **Rules:** R-BTN-190, R-BTN-188 (`plain-git`), R-BTN-183 (Continuity), Decisions line 127
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:127` — "Chose the forge's PR conversation for leg state wherever there is a forge, and the side branch where there is none, decided by the repository's `forge` and by no knob"
  - `spec/BATON_SPEC/05-courses.md:997-998` — "It is `forge` when the home is on a forge **or** the claimed ticket's course reads PR facts (`facts: [\"prs\"]`, R-BTN-134), and `branch` otherwise."
  - `spec/BATON_SPEC/05-courses.md:999-1000` — "on any home whose claimed ticket's course reads PR facts — a `git` home's PR course among them"
  - `spec/BATON_SPEC/12-security.md:433-434` — "Its leg state is the side branch, by R-BTN-190, not by a knob."
  - `spec/BATON_SPEC/12-security.md:854-856` — "Review rounds go to the PR conversation or, on a `git` repository, to the ticket's leg-state branch"
- **The problem:** On a `git` home, a ticket whose course lists `facts: ["prs"]` has `leg_state: forge`. The decision, the `plain-git` paragraph and R-BTN-183 all say `branch`. `facts` is a field of the course entry, which a pusher sets under `paths.control: any`, so "decided by no knob" is also no longer exact.
- **Counter-reading considered:** `12:376-377` already says "where leg state lives follows where the PRs the course reads live", so R-BTN-188 knows the new rule; the three sentences above were not updated.
- **Smallest fix:** Line 127: "decided per claim by where the course's PRs live (R-BTN-190)"; `12:433` and `12:855`: "as R-BTN-190 says".

### DEC2-5: The decision keeps a ticket's cancel when it leaves the board; the rules say the cancellation is never kept
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** Decisions line 154, R-BTN-12, R-BTN-168, §13 `ticket_overrides`
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:154` — "Chose to keep a ticket's holds, cancel, attempts and backoff when it leaves the board and restore them if its id returns"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:564-566` — "its `ticket_overrides` row (a hold with its reason, expedite, a re-route; never the `cancelling` flag) and its `leg_attempts` are kept in its `closed_tickets` row"
  - `spec/BATON_SPEC/07-conditions.md:578-580` — "cleared when the ticket closes, never kept past it (so a returning id gets its hold back, not the cancellation, R-BTN-12)"
  - `spec/BATON_SPEC/13-data-model.md:160` — "`cancelling_at` (set by a cancellation, cleared at the close, never in `kept_json`, R-BTN-168)"
- **The problem:** The decision lists four things kept; the rule keeps three of them, excludes the cancellation, and keeps two the decision omits (expedite, a re-route).
- **Counter-reading considered:** In 2026-10-20 "cancel" was a hold plus a release, and that hold is kept. R-BTN-12 now defines a cancellation as a separate flag that is not.
- **Smallest fix:** Line 154: "holds, expedite, a re-route, attempts and backoff (never the cancellation, R-BTN-168)".

### DEC2-6: Line 36's reason — `baton.stalled` "already flags a leg nobody takes" — is not what R-BTN-167 does
- **Severity:** medium
- **Kind:** restatement-drift
- **Rules:** Decisions line 36, R-BTN-167, R-BTN-163, R-BTN-69
- **Confidence:** medium-high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:36` — "Chose no core default timers per tier: timers are the course's, and `baton.stalled` already flags a leg nobody takes (2026-10-20; R-BTN-167)."
  - `spec/BATON_SPEC/07-conditions.md:447-454` — "**`stalled_s`**, on every leg (default 259,200 s, 72 hours; 60 s to 30 days): how long the leg may be posted `waiting` … only while the sync's readiness attests the leg `waiting` … The condition closes by itself when the leg is posted `ready`. A course that wants a longer or shorter watch sets `stalled_s` on the leg; nothing removes the notice."
  - `spec/BATON_SPEC/05-courses.md:168-169` — the validator "refuses the fields `error_types`, `max_duration`, `max_attempts_s` and `max_ready_s`"
- **The problem:** A leg posted `ready` that no runner claims is the literal "leg nobody takes", and it never raises `baton.stalled`. The field that would have covered it (`max_ready_s`) is refused. Also "no core default timers … timers are the course's" sits beside a core 72-hour default on every leg that nothing removes.
- **Counter-reading considered:** A course's sync may post `waiting` when no seat is eligible (S-BTN-10), which covers some cases; "per tier" narrows the first clause. Searched `nobody takes`, `no eligible runner`, `max_ready_s`, `ready_since`, `unclaimed`: no rule raises anything for a ready, unclaimed leg.
- **Smallest fix:** Reword line 36 to what R-BTN-167 does, and say whether a ready, unclaimed leg is deliberately unflagged.

### DEC2-7: "Nothing changes authority from a cookie" — but an owner's session approves an MCP grant, unconfirmed
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** Decisions line 238, §11.4 "The actions", R-BTN-155, R-BTN-188 (`approvers.members`), `BATON_MCP_OAUTH_SPEC` §5
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:238-240` — "Chose the tenant screens read-only, each naming the CLI command that changes it, over the brief's controls: nothing changes authority from a cookie"
  - `spec/BATON_SPEC/11-people.md:683-685` — "The credential, governance and tenant screens are read-only, each naming the CLI command that changes what it shows: nothing changes authority from a cookie (R-BTN-155)"
  - `spec/BATON_SPEC/11-people.md:565-567` — not confirmed: "an OAuth request, its status, a denial or an approval naming no destructive action (`BATON_MCP_OAUTH_SPEC` §5)"
  - `spec/BATON_MCP_OAUTH_SPEC.md:38` — "| 5 | Consent | an owner's dashboard session approves, in the browser that asked |"
  - `spec/BATON_SPEC/12-security.md:352` — `approvers.members` covers "minting registration tokens and MCP keys"
  - `spec/BATON_SPEC/11-people.md:542-543` — "A session's request that changes authority answers `202 {confirm_code}`"
- **The problem:** Minting an MCP key is an `approvers.members` act, and a session cookie alone performs it when the grant names no destructive action. R-BTN-155 itself speaks of session requests "that change authority". The universal given as the reason in §11.4 and line 238 is false, and a reader of `/mcp-keys` ("read-only, naming the CLI command") is not told keys are minted from the consent page.
- **Counter-reading considered:** "Authority" may mean keys, roles and policy set from the listed screens, with the OAuth consent page not a "screen". The sentence is written as a reason about cookies, not about screens.
- **Smallest fix:** "No credential, governance or tenant screen changes authority; the one session act that grants any is the MCP consent (`BATON_MCP_OAUTH_SPEC` §5)".

### DEC2-8: R-BTN-33 says core never reads a reading's `detail`; R-BTN-50 and R-BTN-76 have it read, and line 102 counts "two" exceptions where there are three
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-33, R-BTN-50, R-BTN-76, R-BTN-181, Decisions line 102
- **Confidence:** high on the rule contradiction; medium that line 102 is an exhaustive count
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:102` — "Chose two narrow exceptions to core reading nothing opaque, each written in its rule … `display.status` … beside `display.project` (R-BTN-33), and a resume record's `branches` and `prs` for the history read (R-BTN-50, R-BTN-24)"
  - `spec/BATON_SPEC/01-what-baton-is.md:78-80` — "a ticket's `course` and `display`, a next leg's `course`, `course_data`, profiles, reports, `rationale`, a reading's `detail`. Core never reads them, `display`'s two keys above excepted"
  - `spec/BATON_SPEC/01-what-baton-is.md:229` — "never reads, except a path in a value that an attestation requirement's `where` tests (R-BTN-181), and a resume record's `branches` and `prs`"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:255-256` — "so a requirement's `where` reads `available` or `detail.<path>`"
- **The problem:** An implementer enforcing R-BTN-33 with a boundary test cannot implement `where` over `detail`.
- **Counter-reading considered:** Line 102 may record only the two exceptions ruled 2026-11-03; R-BTN-33:80 still contradicts R-BTN-50:229.
- **Smallest fix:** Add the `where` path to R-BTN-33's exception; fix line 102's count or add a line.

### DEC2-9: Decision 22 limits attestation writers to trusted ones and rejects "facts read from git"; R-BTN-181/191 admit `runner`, `sync`, `instrument` and `admin`
- **Severity:** low
- **Kind:** contradiction between decision lines
- **Rules:** Decisions lines 22 and 176, R-BTN-181, R-BTN-191
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:22` — "Chose attestations, typed facts a trusted writer makes (a human-only key, an owner key, a trusted service, or Baton from events it verified) … over approvals specific to merging or facts read from git, where any pusher can write a verdict or a person leg's answer"
  - `spec/BATON_SPEC/91-decisions.md:176` — "Chose every statement Baton receives about the work, whoever states it, to be an attestation whose writer the policy admits per type … The sync becomes the writer `sync`"
  - `spec/BATON_SPEC/12-security.md:632-634` — "`instrument`: an instrument key; `runner`: a runner credential, a trusted runner's included; `admin`: an administrator; - `sync` (R-BTN-191)."
- **The problem:** Line 22 still reads as in force, with a closed writer list and facts from git rejected. Line 176, three days later, made facts read from git attestations by `sync` and added `runner`; line 22 carries no amendment note.
- **Counter-reading considered:** Line 22 is true of what a trusted leg acts on (`12:689-691`). It does not say so.
- **Smallest fix:** Append to line 22: "amended 2026-10-31: every statement is an attestation; the policy says whose count (R-BTN-191)".

### DEC2-10: Line 64 rejects "Baton storing or validating content"; R-BTN-108/-109 store and fully validate inline values
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 64, R-BTN-82, R-BTN-84, R-BTN-108, R-BTN-109, R-BTN-33
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:64` — "Chose pointers and digests of leg inputs and outputs, validated by the runner, over Baton storing or validating content"
  - `spec/BATON_SPEC/05-courses.md:372-375` — "Baton stores a `value` only when its schema chain sets `additionalProperties: false` on every object and a `maxLength` ≤ 256 on every string"
  - `spec/BATON_SPEC/05-courses.md:409` — "an inline `value` is validated in full."
- **The problem:** For an inline value of up to 4 KB the rules do what the line says was rejected; neither cited rule mentions the inline path.
- **Counter-reading considered:** R-BTN-33 calls it "the one inline value Baton validates", so the rules agree among themselves; only the decision lacks it.
- **Smallest fix:** Add "except a bounded inline value (R-BTN-108, R-BTN-109)" to line 64.

### DEC2-11: Line 53's list of what Baton gates omits seven gates of §6.6
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 53, R-BTN-45, §6.6
- **Confidence:** high on the text; medium that it matters
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:53` — "(the lease, readiness, holds and prerequisites, grants, capabilities and tier, barred tags, course version, person legs, `no_chain_from`) … and exclusive use of a capability is a gate, R-BTN-178"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:454-455` — "Rules `chain` (R-BTN-106), `entry` (R-BTN-109), `not-queued` (R-BTN-72), `check-runner` (R-BTN-114) and `trusted` (R-BTN-182) are gates too"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:452` — "| `floor` | Every guarantee a floor names holds … | claim, advance | `floor-broken` |"; `:450` rule 13 `rename-held`
  - `spec/BATON_SPEC/09-claims.md:25` — "A claim past that bound is refused `not-eligible`, rule `max-claims`"
- **The problem:** Absent from the list: `floor`, `trusted`, `check-runner`, `entry`, `rename-held`, `not-queued`, `max-claims`. `max-claims` is also absent from §6.6's own table and "gates too" sentence, and is the gate nearest to capacity on a line whose point is that Baton does not gate capacity.
- **Counter-reading considered:** The parenthesis may be illustrative; it was amended 2026-11-02 to add one gate, which suggests it is kept as the list.
- **Smallest fix:** Replace the enumeration with "§6.6's gates"; add `max-claims` to §6.6.

### DEC2-12: Line 44's "stale only when git takes the ticket away" does not match the `stale-board` causes
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 44, R-BTN-35, R-BTN-5/R-BTN-34
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:44` — "Chose a claim that goes stale only when git takes the ticket away over \"stale when the leg is no longer ready\""
  - `spec/BATON_SPEC/01-what-baton-is.md:92-93` — "that shows the held ticket `closed` as `withdrawn`, or re-tiered above the holder's ceiling, ends the claim `released:stale-board`"
  - `spec/BATON_SPEC/04-tickets-syncs-board.md:672-676` — "Closed, archived or re-tiered, or the leg not offered there, releases `stale-board`"
- **The problem:** A re-tier, and at re-verification "the leg not offered there" (the rejected alternative, at claim start), also end a claim `stale-board`.
- **Counter-reading considered:** The decision may cover only a held claim under a snapshot, where "Progress is not staleness" still holds; "only" and the shared end reason still make it wrong as written.
- **Smallest fix:** Scope line 44 to a held claim and name the re-tier.

### DEC2-13: Decision 16 states as fixed what is now one value of `paths.control` and `paths.tickets`
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 16, R-BTN-184, R-BTN-183, R-BTN-188
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:16` — "Chose that courses and leg logic change outside Baton for now, by a human's push or merge, and that tickets are created through courses and land only with a human approval, over letting the merge runner land either alone"
  - `spec/BATON_SPEC/12-security.md:909-910` — "Under `trusted-runner`, the merge runner merges them with a `std:approval@1`; under `any`, they merge as any path does."
  - `spec/BATON_SPEC/12-security.md:359-360` — `paths.control` `any` and `paths.tickets` `any` under `cooperative`
- **The problem:** Under `cooperative` both land with no human; under `paths.control: trusted-runner` the merge runner lands a course change. Line 25 carries the note "since 2026-10-30 each is a condition over the policy, not a mode"; line 16 does not. The knob row at `12:359` also never lists the third value `trusted-runner` that R-BTN-183 and R-BTN-184 define.
- **Counter-reading considered:** "Alone" still holds under `trusted-runner` (an approval is needed). It does not hold under `any`.
- **Smallest fix:** Add "under `paths.control: human` and `paths.tickets: approval`" to line 16; list the three values in the knob row.

### DEC2-14: Decision 28's excluded case differs from §12.8's "stated exactly" list, and R-BTN-183 (cited) does not state it
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 28, §12.8 "Outside every guarantee", R-BTN-183
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:28` — "Chose to state that a compromised runner whose change persuades both reviewers' models lands it, over claiming review as a security gate (2026-10-28; R-BTN-183)."
  - `spec/BATON_SPEC/12-security.md:291-292` — "a compromised runner that is itself one of the reviewers `merge.reviews` requires, and whose change or findings persuade the other reviewers' models, lands it"
- **The problem:** The decision's case is a compromised writer persuading two honest reviewers. The list's case is a compromised reviewer persuading the others. The list is headed "stated exactly", so the writer case is not in it, and R-BTN-183's body has neither (grep `persuade`: `12:292` only).
- **Counter-reading considered:** `independent-review` promises only that two reviews exist, so nothing is formally broken; the exclusion list is what a deployment reads to learn what review does not stop.
- **Smallest fix:** Add the writer case to the list at `12:291`, or cite §12.8 on line 28.

### DEC2-15: Needs-you listings outside §7, and screen names the dashboard decision retired
- **Severity:** low
- **Kind:** contradiction / stale-reference
- **Rules:** R-BTN-163, §12.9, R-BTN-131 (`build-app`), R-BTN-162, R-BTN-120, Decisions line 224
- **Confidence:** high for the Needs-you half; medium for the screen names
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:292-293` — "No rule outside §7 has its own Needs-you listing: a rule raises a condition `baton.<sub>`."
  - `spec/BATON_SPEC/12-security.md:1031-1032` — "Each `scope-exceeded` or `unclaimed-write` finding is one open row per shape, listed under Needs you (§14) until an owner resolves it"
  - `spec/BATON_SPEC/05-courses.md:875-877` — "A request that ends `abandoned` or `stopped` is listed under Needs you until the owner withdraws it in git."
  - `spec/BATON_SPEC/91-decisions.md:224` — "Chose Board, Tickets, Conditions and the overview strip over Running, Ready and Needs you as screens"
  - `spec/BATON_SPEC/07-conditions.md:220-221` — "records an activity `condition-wait` naming the handler, shown on **Running**"; `spec/BATON_SPEC/11-people.md:588-590` puts `condition-wait` on `/board`
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:89` — "the dashboard's **Ready** (§11) shows it for a ticket no runner is eligible for"
- **The problem:** Two rules outside §7 list things under Needs you without raising a condition. Neither a scope finding nor a closed `build-app` request is an open condition or a queued person leg, so the Conditions screen as R-BTN-163 defines it cannot draw them. Separately, R-BTN-162 and R-BTN-120 name screens the decision replaced.
- **Counter-reading considered:** "Ready" and "Running" survive as Tickets tabs (`11:665`), which may be what `06:89` means; `condition-wait` is on `/board`, not on a Tickets tab.
- **Smallest fix:** Make the two listings `baton.<sub>` conditions or add them to R-BTN-163's list; rename the two screen references.

### DEC2-16: Retirement "ends … runner keys" in the decision; R-BTN-47 revokes grants and leaves the credentials live
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 184, R-BTN-47
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:184` — "ends everything scoped to the repository — sessions' reach, MCP keys and OAuth grants with their codes, sync, mirror and runner keys and registration tokens"
  - `spec/BATON_SPEC/03-repositories-and-forges.md:35-37` — "revokes its sync and mirror keys and its runner grants, check-runners included, and exhausts its registration tokens — no use remains, but the credentials they registered are not revoked, so a holder they registered can still heartbeat"
- **The problem:** A runner key is tenant-wide and survives; only its grant on the repository ends. "Runner keys" overstates it.
- **Counter-reading considered:** None.
- **Smallest fix:** "runner grants" on line 184.

### DEC2-17: R-BTN-131 says every course that writes work "ends at `merged`"; `build-app` ends at `shipped`; the same rule cites a nonexistent "§2f"
- **Severity:** low
- **Kind:** restatement-drift / stale-reference
- **Rules:** Decisions line 174, R-BTN-131
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:174` — "its legs commit on the ticket's branch, the course ends at `merged` (a runner's `merge` or the owner's `merged-by-hand`)"
  - `spec/BATON_SPEC/05-courses.md:759-761` — "Every standard course that writes a ticket's work is a PR course … and the course ends at `merged`."
  - `spec/BATON_SPEC/05-courses.md:692` — "`merged-by-hand` (`reported` → `shipped`, `pr-merged`) | `shipped`, `abandoned`, `stopped`"
  - `spec/BATON_SPEC/05-courses.md:700` — "(§2f R-BTN-74's source; …" and "straight to the default branch (§2f; `--branch`, …"
- **The problem:** `build-app` writes work (`report`'s PR) and its end is `shipped`. The rule names `confirmed` as the one exception and not this. "§2f" names no section of this spec (§2 has 2.1–2.3).
- **Counter-reading considered:** `build-app` is "a parent ticket, as `epic` is"; its `report` leg still opens a PR that `merged-by-hand` lands.
- **Smallest fix:** Name `shipped` beside `confirmed`; replace "§2f" with the section meant.

### DEC2-18: Line 241's "named as text on the ticket page" is in no rule
- **Severity:** low
- **Kind:** underspecified
- **Rules:** Decisions line 241, §11.4, R-BTN-83, R-BTN-39, R-BTN-163
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:241-242` — "Chose `ticket.route` and `ticket.adopt` to stay the CLI's, named as text on the ticket page, over session actions for them"
  - `spec/BATON_SPEC/11-people.md:595-598` — the `/tickets/{ticket}` description lists station, path, legs, hand-off, blocks, queued leg, parent, children and history, and no command text
  - `spec/BATON_SPEC/11-people.md:683-684` — only "The credential, governance and tenant screens are read-only, each naming the CLI command"
  - `spec/BATON_SPEC/07-conditions.md:315` — a `baton.retries` restart "`route:<leg>`": "re-routes to a leg leaving the station (R-BTN-83)", which a session takes through `ticket.resolve`
- **The problem:** The ticket page's naming of the two commands is the decision's alone. A session does re-route a ticket through a condition's `route:<leg>` restart, so "stay the CLI's" is true of the action id but not of the effect.
- **Counter-reading considered:** A resolve offers only the restarts a condition carries, so it is narrower than `ticket.route`.
- **Smallest fix:** One sentence in §11.4's `/tickets/{ticket}` bullet.

### DEC2-19: Lines 186, 269, 158, 149 and 157 — small drifts from the rules they cite
- **Severity:** low
- **Kind:** restatement-drift
- **Confidence:** medium for 186 and 269; low for the rest
- **Evidence and problem:**
  - **Line 186** — "Chose migration and scenario numbers taken as the next free one at merge … until Baton hands every identifier out (B-176)". `spec/BATON_SPEC/15-verification.md:37-41` — "a new scenario's number comes from `baton ticket next scenario` (R-BTN-199) … A session without Baton takes the next free number at merge … the legacy path (R-BTN-193)". The "until" has happened; the line cites neither R-BTN-199 nor R-BTN-193.
  - **Line 269** — "stated by Baton on every response and set by the deploy". `spec/BATON_SPEC/11-people.md:399-404` — `min`: "the deploy sets it and no setting does"; `recommended`: "an administrator may raise it (`admin settings set --recommended-client <version>`…)". The 14-day notice clock runs on `recommended`, so an administrator's setting can start it.
  - **Line 158** — "forge webhooks that only trigger a sync". `spec/BATON_SPEC/03-repositories-and-forges.md:306-308` — "Besides the want a delivery produces two things: a GitHub push's record for ticket provenance … and the scope cross-check".
  - **Line 149** — "a leg that waits on an effect git or the forge shows". `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:380-381` — "only on an effect: an answer attested in Baton, an answer in git the sync reads, or a forge effect".
  - **Line 157** — rejects "a stored bearer secret" (R-BTN-93, R-BTN-94). Line 116 has Baton hold "the forge trigger tokens". Whether the rejected secret was a forge token or a sync bearer could not be settled from the history (low confidence).
- **Smallest fix:** Amend each line to the rule's wording.

### DEC2-20: Lines 91, 84, 45, 60 and 31 state things their citations do not carry
- **Severity:** low
- **Kind:** stale-reference
- **Confidence:** high for 84, 45 and 60; medium for 91 and 31
- **Evidence and problem:**
  - **Line 91** — "first come, first served for an account's room … (R-BTN-61)". R-BTN-61 (`03-repositories-and-forges.md:177-180`) orders one runner's merged list by `weight` and says nothing of accounts or arrival order. The nearest text is R-BTN-178's seats (`06-…:642-643`: "the first to take a free seat holds it"), uncited.
  - **Line 84** — "typed, timed activities … (R-BTN-24)". `spec/BATON_SPEC/09-claims.md:277` — "**R-BTN-24 (the resume record).**"; activities are at `09-claims.md:321` — "**Activities** (unnumbered)".
  - **Line 45** — "commit ancestry and Baton's own observation numbers … (R-BTN-10, R-BTN-62)". Ancestry is `spec/BATON_SPEC/04-tickets-syncs-board.md:431` — "**R-BTN-11 (snapshots advance by compare-and-set on ancestry).**"; R-BTN-10 is confirmation.
  - **Line 60** — "with `min_runner_version` and a test kit (R-BTN-22, R-BTN-65)". The test kit is an unnumbered bullet at `05-courses.md:641` and R-BTN-64.
  - **Line 31** — "on the precondition that no runner above the VM level serves a repository runners below it push; the decision reopens if that precondition fails (2026-10-27; B-127)". It cites no rule. The only rule text is `01-what-baton-is.md:289-290` — "A ticket's `tier` is not one (the owner, 2026-10-27: a tier routes by quality, not privilege)." — which gives a different reason and no precondition (searched `VM level`, `above the VM`).
- **Smallest fix:** Correct each citation; put line 31's precondition in R-BTN-66 or drop it.

### DEC2-21: Line 114's "owners' default, ceiling and floor" — R-BTN-122's setting shape holds one ceiling and one floor
- **Severity:** low
- **Kind:** underspecified
- **Rules:** Decisions lines 114 and 134, R-BTN-122, §13
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:114` — "bounded by the owners' default, ceiling and floor"
  - `spec/BATON_SPEC/07-conditions.md:418-421` — "the owners' `retry` setting … bounds every policy: `{max_attempts, backoff_s}`, a ceiling on the first and a floor under the second … The defaults, which a repository with no setting has:"
  - `spec/BATON_SPEC/13-data-model.md:61` — "`retry` JSON — the repository's default policy, its ceilings and floors"
- **The problem:** Two readings: the default policy (3 × 3600 s) and the floor types are constants, or they are owner-settable in fields the rule never names. A repository wanting another default behaves differently under each.
- **Counter-reading considered:** "The defaults, which a repository with no setting has" could mean all rows are settable; then the stated shape is wrong.
- **Smallest fix:** State the `retry` setting's full JSON shape in R-BTN-122.

### DEC2-22: Line 89 says readings "fail open"; R-BTN-76 lets `unknown` block under `missing: block`
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 89, R-BTN-76, R-BTN-181
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:89` — "readings posted by instruments that lapse to `unknown` and fail open"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:302-303` — "`unknown` blocks only a requirement with `missing: block` (R-BTN-181); otherwise advice fails open."
- **The problem:** True of the default only. A trusted leg's requirement cannot take `missing: allow` (`12:685-686`), so for those it always fails closed.
- **Counter-reading considered:** Fail-open is still the default.
- **Smallest fix:** Append "unless the requirement says `missing: block`".

### DEC2-23: Lines 39/40 and §2 disagree on what the Node host is for
- **Severity:** low
- **Kind:** contradiction between decision lines / restatement-drift
- **Rules:** Decisions lines 39, 40, 15, 212; §2; R-BTN-55, R-BTN-56
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:39` — "Chose a Cloudflare Durable Object over SQLite on a home server"
  - `spec/BATON_SPEC/91-decisions.md:40` — "a Node host for development and self-hosting … (R-BTN-55, R-BTN-56)"
  - `spec/BATON_SPEC/02-deployments.md:8-9` — "as a local Node process for development and CI"
- **The problem:** "Self-hosting" occurs only on line 40. Lines 15 and 212 assume a real single-machine deployment, line 39 reads as rejecting one, and §2 gives the host's purpose as development and CI. Whether a self-hosted Node Baton is a supported deployment is not stated. R-BTN-56 is "one Baton per repository" and says nothing of hosts.
- **Counter-reading considered:** Line 39 concerns the hosted production instance only; it does not say so.
- **Smallest fix:** Align `02:9` with line 40, scope line 39 to production, drop R-BTN-56 from line 40.

### DEC2-24: R-BTN-167 says the validator refuses `after_s`, the required key of a person leg's `expires`
- **Severity:** low
- **Kind:** contradiction (wording)
- **Rules:** R-BTN-167, R-BTN-116, R-BTN-69; found while checking lines 88 and 97
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:462-463` — "The course validator (R-BTN-69) and `baton course test` refuse `timers`, `after_s` and any value outside the ranges above"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:368` — "A person's leg may carry `\"expires\": {\"after_s\": <n>, \"reached\": <outcome>}`"
- **The problem:** Read literally, the validator refuses the key R-BTN-116 requires. R-BTN-69 shows the intent is a leg-level `after_s`; neither sentence says so.
- **Counter-reading considered:** An implementer would probably guess right from R-BTN-69's "the fields".
- **Smallest fix:** "refuse a leg-level `timers` and `after_s`".

### DEC2-25: Line 117 calls "who may deliver" a column of the outbox kind; in R-BTN-171 it is the policy's `outbox` entry
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** Decisions line 117, R-BTN-171, R-BTN-188
- **Confidence:** low
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:117` — "what differs (order, who may deliver, the late window) is a column of the kind"
  - `spec/BATON_SPEC/07-conditions.md:615` — "| `kind` | Delivers | Order | Confirmed when | Late |"; `:628-629` — "**Who may deliver** is the repository policy's `outbox` section (R-BTN-188)"
- **The problem:** The kind table has no who-may-deliver column; that is per-repository policy.
- **Counter-reading considered:** "Column" may be figurative, since the policy is keyed per kind.
- **Smallest fix:** "who may deliver is the policy's `outbox` entry for the kind".

### DEC2-26: Line 38 leaves reviewer independence "cooperative … without Baton recording reviewer seats"; Baton now gates `no_chain_from` by credential and compares review domains
- **Severity:** low
- **Kind:** contradiction between decision lines (suspicion)
- **Rules:** Decisions lines 38, 53, 28, 187; R-BTN-106, R-BTN-183, R-BTN-60
- **Confidence:** low
- **Evidence:**
  - `spec/BATON_SPEC/91-decisions.md:38` — "Chose to leave reviewer-independence seats and tags as cooperative checks, without Baton recording reviewer seats or verifying a session's model, unless misuse is seen"
  - `spec/BATON_SPEC/08-runners.md:355-356` — "Baton refuses a claim or `advance` into it, `not-eligible`, rule `chain`, by a **credential** that has run any named leg on this ticket"
  - `spec/BATON_SPEC/12-security.md:857-859` — "each from a domain other than every writer domain of `H` … no two from one domain"
- **The problem:** Independence is now a gate (`chain`) and a merge criterion Baton records per run. Line 38 was not amended, and "reviewer seat" occurs in no rule ("seats" now means R-BTN-178's capability seats).
- **Counter-reading considered:** The model half still holds (tags are self-reported, R-BTN-60).
- **Smallest fix:** Amend line 38 to "tags and models stay cooperative; `no_chain_from` and review domains are R-BTN-106's and R-BTN-183's".

Two asides, not numbered. Both quotes were checked.
- `spec/BATON_SPEC/05-courses.md:176-177` (R-BTN-69, cited by line 59) — "Which outcome a leg reached is a git fact the station function evaluates (R-BTN-39), never part of the file" — reads as a sentence from before 2026-10-31, against R-BTN-39's "Git never writes them" (`01:103`).
- `spec/BATON_SPEC/05-courses.md:437` says `std:restart@1` is "formed by Baton from its handler's end (R-BTN-162)"; R-BTN-162 (`07:225-238`) forms it from an answer, an expiry, a withdrawal or an owner's resolve, and "whatever happens to the handler after that settles nothing more".

---

## Read but found sound

Decision lines checked against the full cited rule bodies and consistent (by line number of `91-decisions.md`):

- **§12.8 policy, attestations, roles (read by me, whole section):** 14, 15, 17, 18, 19, 21, 23, 24, 25, 26, 27, 29, 30, 118, 120, 121, 122, 123, 124, 125, 126, 128, 129, 130, 131, 132, 133, 176, 177, 178, 187–194, 195–199. Line 22's second half (bound by subject, authenticated by the request) and line 28's second half (`independent-review`, no model families) are sound.
- **Dashboard V2 lines against §11.4 (read whole):** 217, 221 (§12.3 `12:153-159`), 224 (the strip; see DEC2-15 for leftovers), 227, 229, 231 (R-BTN-3 `08:22`), 233 (no Accept, Schemas, Providers or model anywhere in §11.4), 252 (G-BTN-13), 258 (R-BTN-87 `02:220-225`). Line 254 cites no rule.
- **Handlers and suspension:** 107, 108, 109 (120 s for `hitl`, at most 900 s), 110 (the raise's `default`, reason `withdrawn`), 35.
- **Schemas:** 65, 66, 67, 68 (R-BTN-108 to -112).
- **Course sources and signed control:** 20, 32 (R-BTN-194), 61, 72 (R-BTN-133 install roots and the digest cache). Line 71 matches R-BTN-134 itself; its conflict with R-BTN-183 is DEC2-1.
- **Seed and retirement:** 172 (`03:75-80`); 184 apart from DEC2-16 (tombstone and never re-registered: `03:62-64`).
- **Leg events and `interact`:** 268 (R-BTN-195), 271 (R-BTN-198: `continue` default, `restart`, `release`).
- **Others I read:** 164 second half (`pusher`), 167 (R-BTN-174), 174 apart from DEC2-17, 175 (R-BTN-35, R-BTN-39), 181 (R-BTN-180 `12:596`; `baton-request/*` at `05:1014`).
- **Group A reader (full bodies unless noted in its limits below):** 12, 13, 34, 37, 41, 42, 43, 47, 52, 54, 55, 56, 57, 58, 59, 62, 63, 70, 73.
- **Group B reader:** 77, 80, 81, 82, 83, 85, 86, 87, 88, 90, 92, 93, 94, 96, 97, 99, 100, 101, 112, 113, 115, 116; 102 and 114 and 117 apart from DEC2-8, -21, -25.
- **Group C reader:** 139, 140, 142, 143, 144, 145, 146, 147, 148, 150, 151, 152, 153, 155, 156, 160, 161, 162, 163, 166, 170, 171, 173, 180, 185, 200, 206, 212, 261, 270.

## Not covered

- **Lines not re-checked here because the DEC report already verified or reported them:** 46, 48, 78, 79, 95, 98, 103, 111, 119, 134, 135, 141, 159, 165, 168, 169, 179, 182, 183, 243, 250.
- **Partial reads, by line:**
  - 12, 13, 70 — R-BTN-74 after `04:135` and R-BTN-131 after `05:690` were checked by grep only.
  - 143, 174, 181, 270 — R-BTN-131 was read through `05:960` and by targeted ranges, not whole.
  - 55 — R-BTN-76/-101 beyond its opening.
  - 102 — R-BTN-39 was read whole by me, but not re-read against this line's first two sentences by the group B reader.
  - 146 — R-BTN-127's command tree was grepped, not read row by row.
  - 162 — R-BTN-138 only through its id table.
  - 26 — R-BTN-58's `max_claims` and domain text was not read (the role and domain half is from R-BTN-180).
  - 38 — R-BTN-106 was not read in full (hence DEC2-26's low confidence).
- **Subagent quotes** were spot-checked, not all: verified DEC2-5, -6, -8, -19 (line 269), -21, -22, -23, -24 and the R-BTN-69 aside. The quotes in DEC2-10, -11, -12, -19 (lines 186, 158, 149, 157), -20 and -25 are as the readers reported them.
- `BATON_MCP_OAUTH_SPEC.md` was grepped for the consent flow only (DEC2-7). `BATON_SPEC_HISTORY.md` was grepped for retired ids only. Ticket files were not read, except B-216's `status:` line. No file was modified.
