---
title: "Adversarial review 2026-11-18 — every finding"
description: "All findings of the 2026-11-18 adversarial review of BATON_SPEC in one table, by severity after the refutation pass, each linked to its reviewer's page."
order: 9
tags: [review]
---

# Adversarial review 2026-11-18 — every finding

Filed: 289 findings — 1 critical, 39 high, 132 medium, 117 low. After the refutation pass: 0 critical, 22 high, 147 medium, 120 low. "Checked" marks the 50 findings the refutation pass examined; every other severity is the filing reviewer's own, unreviewed.

| Id | Severity | As filed | Checked | Kind | Finding | Page |
|---|---|---|---|---|---|---|
| FND-2 | high | high | yes | contradiction | A home with an empty `code_repos` resolves `repos:` "by name" — contradicting "the ids decide" and "reaches nothing unless listed" | [§1–§3](01-foundations.md) |
| TKT-1 | high | high | yes | liveness | Under `tickets.created: proposed`, a call leg's children are dropped as `spawned-unposted` and the call never settles | [§4](02-tickets-syncs-board.md) |
| CRS-1 | high | high | yes | contradiction | `create-pr` is defined three ways — the table, the facts paragraph and the fact-leg paragraph disagree on its legs, a leg's `from` and a station | [§5](03-courses.md) |
| BLK-1 | high | high | yes | contradiction | Under `tickets.created: proposed`, §7 and §12 disagree on who writes a handler ticket or a call's child, and R-BTN-171 has no outbox kind for it | [§6–§7](04-blocks-conditions.md) |
| BLK-2 | high | high | yes | liveness | A call can end in a state no rule settles: children dropped as `spawned-unposted`, children that closed before the end, and no clock on the wait | [§6–§7](04-blocks-conditions.md) |
| BLK-3 | high | high | yes | contradiction | A suspended leg's `condition` row is provisional on one path and not on another for the same facts, and under `proposed` it evaporates after an hour | [§6–§7](04-blocks-conditions.md) |
| RUN-1 | high | high | yes | safety | `advance` is the one non-idempotent runner write, and a retried advance either abandons the claim or records a run and an arrival that never happened | [§8–§10](05-runners-claims-checks.md) |
| PPL-2 | high | high | yes | liveness | an approver list of `key:` entries has no recovery — the key cannot be revoked, and break-glass does not match it | [§11, OAuth](06-people-oauth.md) |
| SEC-1 | high | critical | yes | security | A pusher rolls an owner-signed control input back (or brings a never-landed signed commit into force) by choosing the merge's parent order | [§12](07-security.md) |
| SEC-2 | high | high | yes | security | The brief's `signed` mark is whatever the board post says; nothing but the posting sync verifies it, and under `cooperative` any granted machine key posts the board | [§12](07-security.md) |
| SEC-3 | high | high | yes | contradiction | `require_signed_control` promises agent configuration, goals and `EXPEDITE` count only when owner-signed, but only four runner-loaded groups are ever verified by anything but the sync | [§12](07-security.md) |
| API-1 | high | high | yes | contradiction / liveness | `advance` and a condition raise have no idempotency key, though §2 says every write but the claim is "safe to retry by its own key" | [§13–§14](08-data-model-api.md) |
| API-2 | high | high | yes | contradiction | The outbox has no kind for the ticket proposals R-BTN-180 queues through it, and R-BTN-161 gives that write to someone the `protected` refs exclude | [§13–§14](08-data-model-api.md) |
| VER-2 | high | high | yes | unverifiable | About 85 of the 190 scenarios have no test anywhere, and the spec does not say which | [§15 scenarios, model](09-scenarios-model.md) |
| VER-5 | high | high | yes | contradiction | S-BTN-174/175 test `converse`/`address` as claimed legs with a marker; the rule makes them fact legs — and S-BTN-196 tests the opposite | [§15 scenarios, model](09-scenarios-model.md) |
| VER-6 | high | high | yes | contradiction | S-BTN-180 expects the forge to refuse a runner's push to `refs/baton/*` | [§15 scenarios, model](09-scenarios-model.md) |
| VER-14 | high | high | yes | stale-reference | S-BTN-118 and G-BTN-138 test R-BTN-143's removed "held rewrite" exception | [§15 scenarios, model](09-scenarios-model.md) |
| VER-G1 | high | high | yes | unverifiable | R-BTN-68 states liveness properties as checked; nothing runs them | [§15 scenarios, model](09-scenarios-model.md) |
| VER-G2 | high | high | yes | contradiction | The model asserts one claim per runner, citing R-BTN-4, which now allows up to 32; §13 still lists the index | [§15 scenarios, model](09-scenarios-model.md) |
| LIFE-1 | high | high | yes | contradiction | Under `tickets.created: proposed`, three sections disagree on who writes a child ticket, the outbox has no kind for it, and a call leg's children are dropped so the call never settles | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-2 | high | high | yes | liveness | A `suspend` block's provisional row is dropped after one hour, so under `proposed` the question is asked again and the ticket ends `blocked-exhausted` | [cross-cut: lifecycle](11-lifecycle.md) |
| TIME-1 | high | high | yes | underspecified | `advance` is the one lease-upkeep write with no retry key — a lost response cannot be retried | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| FND-1 | medium | high | yes | security / architecture | A forge delivery rewrites the registry (path, `web_base`, `remote`) and can stop a repository's claiming — "only triggers" does not hold, and nothing orders or freshness-checks deliveries | [§1–§3](01-foundations.md) |
| FND-3 | medium | medium |  | security | The seed can give ownership back to a key the owners removed, and gives back every revoked key after lost state | [§1–§3](01-foundations.md) |
| FND-4 | medium | medium |  | contradiction | `webhook_syncs` — three incompatible statements of which rows exist, so the 10-minute backstop's population is undefined | [§1–§3](01-foundations.md) |
| FND-5 | medium | medium |  | contradiction / underspecified | "Hard caps per repository … at twice the envelope" matches one row of eight; four envelope figures have no cap, and the repository write budget has no behaviour at its limit | [§1–§3](01-foundations.md) |
| FND-6 | medium | medium |  | architecture | Baton holds a Gitea credential with write access to the repository — against "Baton holds no credential that writes git" | [§1–§3](01-foundations.md) |
| FND-7 | medium | medium |  | underspecified / contradiction | CI tokens are "verified in the Worker" against data only the object holds | [§1–§3](01-foundations.md) |
| FND-8 | medium | medium |  | contradiction / underspecified | Does a non-merge `pull_request` delivery record a want? R-BTN-73 says both, and only GitHub can tell | [§1–§3](01-foundations.md) |
| FND-9 | medium | medium |  | liveness | The four-page candidate cap can hide ready work from a runner, and R-BTN-196 then remembers "nothing eligible" | [§1–§3](01-foundations.md) |
| TKT-2 | medium | high | yes | liveness | One refused board post freezes the whole repository, and after 6 hours every completion in the window needs an administrator by hand | [§4](02-tickets-syncs-board.md) |
| TKT-4 | medium | medium |  | liveness | `R-BTN-11` refuses any post whose `sha` was an earlier head — a forced Resync to an ancestor can leave the board refusing forever with no condition raised | [§4](02-tickets-syncs-board.md) |
| TKT-5 | medium | medium |  | stale-reference | R-BTN-86 and R-BTN-165 send children to "R-BTN-131's allocator", which R-BTN-193 names as the legacy git scan | [§4](02-tickets-syncs-board.md) |
| TKT-6 | medium | medium |  | contradiction | What the offline next-free scan reads is stated two ways | [§4](02-tickets-syncs-board.md) |
| TKT-7 | medium | medium |  | underspecified | Is a ticket's `title` §12.3 free text? Either the repository's own tickets are refused, or the title has no cap | [§4](02-tickets-syncs-board.md) |
| TKT-8 | medium | medium |  | underspecified | Which `depends_at` edges count for the cycle refusal is unstated, and it sits beside a rule that accepts cyclic snapshots | [§4](02-tickets-syncs-board.md) |
| TKT-9 | medium | medium |  | contradiction | `deferred` and `superseded` are posted as `withdrawn`, which cancels the ticket and blocks its dependents, while the CLI's own `claim` counts them as done | [§4](02-tickets-syncs-board.md) |
| TKT-10 | medium | medium |  | underspecified | A non-materializing refresh "changes no ticket row" — but bars, the question, `not_before`, dependencies and bindings ride the ticket | [§4](02-tickets-syncs-board.md) |
| TKT-11 | medium | medium | yes | underspecified | Where a ticket stands when it returns to the board is not stated | [§4](02-tickets-syncs-board.md) |
| TKT-12 | medium | medium |  | security | `last_written_by` names whoever pushed the merge, not whoever wrote the ticket's words | [§4](02-tickets-syncs-board.md) |
| TKT-13 | medium | medium |  | underspecified | The export omits the observation counter, though exported rows carry observation numbers; and omits `sequences` | [§4](02-tickets-syncs-board.md) |
| CRS-2 | medium | high | yes | contradiction | Standard-course prose has git facts "queue" legs and "place" tickets; R-BTN-39/83 forbid it and no rule supplies the mechanism R-BTN-83 alludes to ("displace") | [§5](03-courses.md) |
| CRS-3 | medium | medium |  | liveness | A queued leg whose `max_runs` is spent has no rule: either a silent stall or a claim/refuse/suspend loop, and no condition tells the owner | [§5](03-courses.md) |
| CRS-4 | medium | medium |  | underspecified | `max_runs` on a person leg or a fact leg bounds nothing, so "every cycle contains a leg with `max_runs`" is satisfiable by a cycle Baton never bounds | [§5](03-courses.md) |
| CRS-5 | medium | medium |  | contradiction | A refused or held course file still governs the runner: Baton enforces the previous file while the runner loads the snapshot's | [§5](03-courses.md) |
| CRS-6 | medium | medium |  | underspecified | `renamed_from` is single-valued and never retired: a second rename, or dropping the field, orphans every record R-BTN-64 "resolves" instead of rewriting | [§5](03-courses.md) |
| CRS-7 | medium | medium |  | underspecified | R-BTN-69's field table and "accepts a file only if" list are not the course language: fields other rules read are missing, unknown fields are unaddressed, several bounds are absent | [§5](03-courses.md) |
| CRS-8 | medium | medium |  | underspecified | `leg_state` in every claim response depends on `facts`, which the board post and the data model never give Baton | [§5](03-courses.md) |
| CRS-9 | medium | medium |  | contradiction | The record courses' `closed` end is reachable only through the `cancel` leg, which the reachability check is said to ignore | [§5](03-courses.md) |
| CRS-10 | medium | medium |  | underspecified | A station with `entry` cannot be entered by a fact arrival, and R-BTN-109's "checked the same way" names no outcome | [§5](03-courses.md) |
| CRS-11 | medium | medium |  | liveness | One unfetchable or rewritten course source stops the whole repository's board, and nothing bounds it | [§5](03-courses.md) |
| BLK-4 | medium | high | yes | security | A delegated key resets a leg's attempts and clears its backoff by holding and unholding — a loosening R-BTN-186 says it can never make | [§6–§7](04-blocks-conditions.md) |
| BLK-5 | medium | high | yes | contradiction | "Cancel" is two different acts: a liftable hold plus a release (§6.8, §7.5, §9), and an irreversible cancellation that runs the `cancel` leg (R-BTN-186) | [§6–§7](04-blocks-conditions.md) |
| BLK-6 | medium | medium |  | contradiction | `baton.outbox-late` is a `notify` condition with no restarts, yet R-BTN-171 relies on "the condition's `retry`"; without it a delivered-unconfirmed `withdraw` leaves the ticket `cancelling` with no Baton-side exit | [§6–§7](04-blocks-conditions.md) |
| BLK-7 | medium | medium |  | contradiction | A `call` block's `ref` is `claim_legs.id` in §6 and `claim_legs.seq` in §7; `seq` is per claim and collides | [§6–§7](04-blocks-conditions.md) |
| BLK-8 | medium | medium |  | liveness | A retry policy's `exhausted` leg can name itself or a leg that names it back: the ticket is retried forever and nothing is raised | [§6–§7](04-blocks-conditions.md) |
| BLK-9 | medium | medium |  | contradiction | A `suspend` condition "closes" at two different moments — when its restart is formed (R-BTN-162) and when its handler ticket closes (R-BTN-160, §6.1) | [§6–§7](04-blocks-conditions.md) |
| BLK-10 | medium | medium |  | underspecified | Which end "consumes" a restart is ambiguous, and one reading loses a person's answer in a race with the blocked end | [§6–§7](04-blocks-conditions.md) |
| BLK-11 | medium | medium |  | restatement-drift | `"replaces": "retry"` — the runner is to report it in a body that has no such field, "only the runner knows the binding" although Baton stores it, and §13 still says Baton files handler tickets for its own conditions | [§6–§7](04-blocks-conditions.md) |
| BLK-12 | medium | medium |  | underspecified | Outbox marks: `refused` both re-queues and waits for a lift; a late mark is both accepted and `forbidden`; and a Baton-set hold has one slot shared with every other reason | [§6–§7](04-blocks-conditions.md) |
| BLK-13 | medium | medium |  | safety | A `requires.resources` entry bound as a gate with `missing: block` fails open when the repository has no usable instance or the name is unregistered | [§6–§7](04-blocks-conditions.md) |
| RUN-2 | medium | high | yes | security | the owner's `max_claims` ceiling is per runner row, and one key makes 64 rows — "a compromised runner holds no more tickets than an owner allowed" is false by a factor of 64 | [§8–§10](05-runners-claims-checks.md) |
| RUN-3 | medium | medium |  | safety | R-BTN-9's "the fence is never longer than the lease" holds only for a lost response — a reordered heartbeat, or an omitted `lease_timeout_s`, leaves Baton reaping on 900 s while the sidecar fences on 24 h | [§8–§10](05-runners-claims-checks.md) |
| RUN-4 | medium | medium |  | contradiction | two statements of what renews the lease — "the lease stays on the heartbeat" and "every runner call updates `last_seen_at`" — and the second lets a session with a dead sidecar hold its claim forever | [§8–§10](05-runners-claims-checks.md) |
| RUN-5 | medium | medium |  | safety | R-BTN-19's reason the fence deadline is safe is false for the cases it lists, and R-BTN-26's formula is per runner while reaps and fences are per claim | [§8–§10](05-runners-claims-checks.md) |
| RUN-6 | medium | medium |  | liveness | nothing says what a revoked or expired key, or a revoked or declined grant, does to the claims it holds — the ticket stays held for the lease the revoked runner chose, and a force-reap then waits on a report the revoked runner cannot make | [§8–§10](05-runners-claims-checks.md) |
| RUN-7 | medium | medium | yes | contradiction | a check ticket's "restart on a new head" is a move no rule owns — R-BTN-39's closed list has no such mover, and R-BTN-168's supersession, which R-BTN-114 cites, cancels the ticket instead | [§8–§10](05-runners-claims-checks.md) |
| RUN-8 | medium | medium | yes | underspecified | a check concludes only when "a post shows the ticket at that same `reached`" — a thing no post can show (R-BTN-39), from a leg that holds no credential to write evidence | [§8–§10](05-runners-claims-checks.md) |
| RUN-9 | medium | medium | yes | liveness | an end unconfirmed for 6 hours "is never confirmed automatically" — a sync outage longer than that turns every pending completion into a per-ticket administrator task | [§8–§10](05-runners-claims-checks.md) |
| RUN-10 | medium | medium |  | security | `ended_at_sha` may be "the URL of the comment or review" — a runner-supplied URL with no validation rule, handed to the credentialed sync to look up | [§8–§10](05-runners-claims-checks.md) |
| PPL-1 | medium | high | yes | liveness | R-BTN-197 refuses every caller that is not the CLI once `min` rises — MCP clients, OAuth clients, webhooks, forge notifications, the dashboard | [§11, OAuth](06-people-oauth.md) |
| PPL-3 | medium | high | yes | security | an API key's fingerprint is a client-chosen 64-bit id bound to nothing — two public lines may share it, and every authority table is keyed by it | [§11, OAuth](06-people-oauth.md) |
| PPL-4 | medium | high | yes | security | a delegated key resets a ticket's retry counts by holding and unholding it | [§11, OAuth](06-people-oauth.md) |
| PPL-5 | medium | medium |  | contradiction | an administrator's ordinary key changes membership under a human-only list — by revoking keys, and by retiring and re-registering | [§11, OAuth](06-people-oauth.md) |
| PPL-6 | medium | medium |  | security | credentials minted under `[owner]` keep working after `approvers.members` becomes human-only — a registration token still adds runner grants | [§11, OAuth](06-people-oauth.md) |
| PPL-7 | medium | medium |  | contradiction | R-BTN-199 lets a delegated key take sequence numbers — a write R-BTN-129's and R-BTN-186's closed definitions refuse | [§11, OAuth](06-people-oauth.md) |
| PPL-8 | medium | medium |  | contradiction | resolving a condition clears the same hold whose lift is a confirmed action and an `approvers.policy` gate | [§11, OAuth](06-people-oauth.md) |
| PPL-9 | medium | medium |  | security | an approved authorization code is redeemed without re-checking the session, the minter's ownership or the approver list | [§11, OAuth](06-people-oauth.md) |
| PPL-10 | medium | medium |  | contradiction | revoking a leaked MCP key, token, sync key or check-runner is an `approvers.members` action, though the knob lists only minting and R-BTN-186 opens tightening to every owner | [§11, OAuth](06-people-oauth.md) |
| PPL-11 | medium | medium |  | security | the CLI takes an origin from a repository file and then sends a bearer key there | [§11, OAuth](06-people-oauth.md) |
| PPL-12 | medium | medium |  | contradiction | "nothing changes authority from a cookie" is false of the OAuth approval, and the Decision that accepts it predates bars | [§11, OAuth](06-people-oauth.md) |
| PPL-13 | medium | medium |  | liveness | an unauthenticated party can evict a registered client between its registration and the owner's sign-in | [§11, OAuth](06-people-oauth.md) |
| PPL-14 | medium | medium |  | contradiction | R-BTN-159's bearer route list and §2.3's admission rule disagree with the routes API keys and sessions are given | [§11, OAuth](06-people-oauth.md) |
| PPL-15 | medium | medium |  | underspecified | the instance setting `human_key` has no setter, no column and no route | [§11, OAuth](06-people-oauth.md) |
| SEC-4 | medium | high | yes | security | PR-conversation text — a non-pusher's comment included — reaches the fix and adjudicate legs' models with no rule that quotes or filters it, against §12's "Content is data" | [§12](07-security.md) |
| SEC-5 | medium | medium |  | security | Signed-key clients may use a plain-`http` origin, where nothing authenticates Baton's answers — yet every §12.8 guarantee rests on "its own authenticated connection" | [§12](07-security.md) |
| SEC-6 | medium | medium |  | security | An administrator opens every human gate by sealing, editing the unsigned export and importing it — "a human gate, for administrators too" has no rule behind it on that path | [§12](07-security.md) |
| SEC-7 | medium | medium |  | contradiction | Who revokes a `human_only` key — "only with a `human_only` key" (R-BTN-185) or "an administrator revokes any key" (R-BTN-57)? | [§12](07-security.md) |
| SEC-8 | medium | medium |  | contradiction | A WebAuthn assertion is and is not a human gate, and nothing specifies it | [§12](07-security.md) |
| SEC-9 | medium | medium |  | contradiction | `tickets-approved` promises no ticket change without a human approval, while R-BTN-184 lets every claim append 6 KB of free prose to its ticket unapproved | [§12](07-security.md) |
| SEC-10 | medium | medium |  | underspecified | CI identity tokens: the spec names the claims to compare and nothing about verifying the JWT itself | [§12](07-security.md) |
| SEC-13 | medium | medium |  | contradiction | Which keys sign control — every owner key, or only the human-only register's? | [§12](07-security.md) |
| SEC-15 | medium | medium |  | underspecified | `no-runner-lands` broken on a repository with no `floors`: does the merge runner keep merging? | [§12](07-security.md) |
| API-3 | medium | high | yes | contradiction / underspecified | The dashboard is specified twice — one `GET /v1/ui/state`, and per-entity reads "§14 lists `session` on" that §14 does not list | [§13–§14](08-data-model-api.md) |
| API-4 | medium | medium |  | contradiction | §13 lists a unique-per-runner active-claim index that R-BTN-4 forbids, and says claims are "kept forever" while R-BTN-149 prunes them | [§13–§14](08-data-model-api.md) |
| API-5 | medium | medium |  | contradiction / underspecified | Owner-signed control (B-127) and provenance (B-126) are served by routes and stored in rows §13 and §14 do not have | [§13–§14](08-data-model-api.md) |
| API-6 | medium | medium |  | contradiction / underspecified | `PUT /v1/admin/settings` cannot set `recommended_client`, and the human-key instance setting, human-only keys and key suspension have no row at all | [§13–§14](08-data-model-api.md) |
| API-7 | medium | medium |  | security / liveness | Nothing says who may acknowledge a message, and the release backstop fires only on a missing acknowledgement | [§13–§14](08-data-model-api.md) |
| API-8 | medium | medium |  | liveness | A sequence can never be taken when git already holds a number more than 10 000 above the stored one — and a moved or fresh Baton stores zero | [§13–§14](08-data-model-api.md) |
| API-9 | medium | medium |  | contradiction | `rationale` is "kept in the history row and exported", but history rows cap at 2 KB and hold identifiers only, and claims are not exported | [§13–§14](08-data-model-api.md) |
| VER-1 | medium | medium | yes | contradiction | Two different scenarios carry the id S-BTN-225; the index lists only one | [§15 scenarios, model](09-scenarios-model.md) |
| VER-4 | medium | medium |  | unverifiable | Rows do not name the rules they test, so R-BTN-31 cannot be audited | [§15 scenarios, model](09-scenarios-model.md) |
| VER-7 | medium | medium | yes | contradiction | S-BTN-234 drives `baton tickets new` / `baton tickets next`, names the registry says exit 2 | [§15 scenarios, model](09-scenarios-model.md) |
| VER-8 | medium | medium | yes | contradiction | S-BTN-97 says `baton run` is a renamed command (exit 2); S-BTN-225 and §11 run it | [§15 scenarios, model](09-scenarios-model.md) |
| VER-9 | medium | medium |  | stale-reference | S-BTN-9 names a `stop` option and an end `released:provider-suspended` no rule defines | [§15 scenarios, model](09-scenarios-model.md) |
| VER-10 | medium | medium |  | contradiction | S-BTN-197 says `protected` on `git` gets `inputs.board` `[sync-key]`; the rule says "those same two values" | [§15 scenarios, model](09-scenarios-model.md) |
| VER-11 | medium | medium |  | contradiction | S-BTN-191 expects `floor-violated` without setting a floor | [§15 scenarios, model](09-scenarios-model.md) |
| VER-16 | medium | medium |  | contradiction | S-BTN-102 expects the actor `mcp:<name>`; the rule records `mcp:<id>` | [§15 scenarios, model](09-scenarios-model.md) |
| VER-18 | medium | medium |  | contradiction | S-BTN-54's `post-receive` hook runs the sync; R-BTN-94 says the hook only touches a spool file | [§15 scenarios, model](09-scenarios-model.md) |
| VER-19 | medium | medium |  | restatement-drift | S-BTN-116 expects "only `path` kept"; R-BTN-140 now has the owner post the ids — and §13/§14 still state the old shape | [§15 scenarios, model](09-scenarios-model.md) |
| VER-20 | medium | medium |  | contradiction | S-BTN-228 probes a 5 KB profile, a "Workers view" and a dirty-build warning the rules do not have | [§15 scenarios, model](09-scenarios-model.md) |
| VER-21 | medium | medium |  | contradiction | S-BTN-22 expects "override recorded" where R-BTN-100 says nothing is recorded, against S-BTN-24 | [§15 scenarios, model](09-scenarios-model.md) |
| VER-22 | medium | medium |  | stale-reference | S-BTN-19 and S-BTN-27 test advice concepts no rule defines | [§15 scenarios, model](09-scenarios-model.md) |
| VER-23 | medium | medium |  | unverifiable | Rows assert fields, flags or behaviour found in no rule | [§15 scenarios, model](09-scenarios-model.md) |
| VER-F1 | medium | medium |  | unverifiable | Whole rules with no scenario or gate | [§15 scenarios, model](09-scenarios-model.md) |
| VER-F2 | medium | medium |  | unverifiable | Behavioural clauses of exercised rules with no scenario or gate | [§15 scenarios, model](09-scenarios-model.md) |
| VER-G3 | medium | medium |  | unverifiable | "Its properties hold for every course" overstates what is checked | [§15 scenarios, model](09-scenarios-model.md) |
| VER-G4 | medium | medium |  | unverifiable | "Every scenario's event log is checked against the model" is false three ways | [§15 scenarios, model](09-scenarios-model.md) |
| VER-G5 | medium | medium | yes | contradiction | The harness prose makes three claims the repository contradicts | [§15 scenarios, model](09-scenarios-model.md) |
| DEC-1 | medium | high | yes | contradiction | A decision in force keeps "the held board post's Accept"; two other decisions and the rules removed held posts | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-2 | medium | medium |  | unverifiable | G-BTN-138 and S-BTN-118 test an exception ("a held rewrite's head") that R-BTN-143 no longer has | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-3 | medium | medium |  | contradiction | R-BTN-102 still raises a loosening notice on a machine-key post that the decisions say was removed | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-4 | medium | medium |  | contradiction | G-BTN-120 and §12.2 require `confirm: true` for `leg.stop` "everywhere"; §11.4 and a decision make the dashboard's Stop send none | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-5 | medium | medium |  | liveness | §16 says a repository with no git claim protocol "starts cut over and needs nothing here"; R-BTN-28 makes that an opt-in flag, and without it neither system grants a claim | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-6 | medium | medium |  | contradiction | R-BTN-18 says a cut-over repository "has no git claim path"; R-BTN-193/R-BTN-74 keep a git-lock claim path on this very repository, in a state §16 does not describe | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-7 | medium | medium |  | underspecified | Cutover leaves shadow claims, the order of drain and adoption, and a `reap_after` already past all unspecified | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-8 | medium | medium |  | security | R-BTN-182 states the trusted runner's dependencies are pinned by the release's shrinkwrap; the open questions say the package does not ship one | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-9 | medium | medium |  | security | `tickets-approved` and `no-runner-lands` count a human's merge as the approval "of that file", while the open questions admit the human may merge a head they were not shown | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-10 | medium | medium |  | unverifiable | Two proofs the gates and the cutover preconditions rely on name npm scripts that do not exist | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| LIFE-3 | medium | high | yes | underspecified | A ticket that leaves the board and returns loses its position; no rule says where it stands, and a dropped ticket with no "state" keeps nothing at all | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-4 | medium | high | yes | contradiction | No rule closes a ticket that reaches an end station without a claim, and "closes" means two different instants for a `suspend` condition | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-5 | medium | high | yes | contradiction | A check ticket's new head "supersedes" its claims and "restarts at its start station" — R-BTN-168 defines supersession only as cancelling the ticket, and R-BTN-39 allows no such move | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-6 | medium | high | yes | stale-reference | R-BTN-153 confirms a check's verdict "by a post showing the ticket at that same `reached`" — a board post carries no station | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-7 | medium | medium |  | contradiction · **Rules:** R-BTN-75, R-BTN-165, §13.5 · **Confidence:** high | A `call` block's `ref` is the run's `claim_legs.id` in §6.2 and its `seq` in §7.6 | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-8 | medium | medium |  | contradiction · **Rules:** R-BTN-149, R-BTN-12, R-BTN-63, R-BTN-81, §13 · **Confidence:** high | `claims` are "kept forever" in §13.5 and pruned by R-BTN-149; a pruned ticket that returns keeps its hold but loses its run counts | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-9 | medium | medium |  | contradiction · **Rules:** R-BTN-12, R-BTN-168, R-BTN-119, R-BTN-127, §9.4, vocabulary · **Confidence:** high | "Cancel" is two things: the owner's Cancel (a hold plus a release) never cancels in R-BTN-168's sense | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-10 | medium | medium |  | liveness · **Rules:** R-BTN-168, R-BTN-83, rule 3 · **Confidence:** medium | A `cancelling` ticket whose station changes after the `cancel` leg was queued has no queued leg it may run | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-11 | medium | medium |  | liveness · **Rules:** R-BTN-168, R-BTN-171, R-BTN-12 · **Confidence:** medium | Nothing aborts a cancellation: a withdrawal seen once in git is enforced by Baton even after git takes it back | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-12 | medium | medium |  | underspecified · **Rules:** §11.4 Ticket state, R-BTN-168, R-BTN-75, R-BTN-89, R-BTN-126 · **Confidence:** high | The "one word" ticket state has no word for `cancelling`, for a queued leg that is `waiting`, or for a live ticket at an end station | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-13 | medium | medium |  | contradiction · **Rules:** R-BTN-75, R-BTN-79, R-BTN-12, R-BTN-39, rule 3, §11.4 · **Confidence:** high | "Held" means three different things, and R-BTN-79's queue depth depends on which | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-14 | medium | medium |  | liveness · **Rules:** R-BTN-165, R-BTN-39, R-BTN-83, R-BTN-75 · **Confidence:** medium | A call's settlement relies on a guarantee R-BTN-39 does not give: a route or an adopt moves a ticket off the call's station and orphans the call | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-15 | medium | medium |  | underspecified · **Rules:** R-BTN-39 | Adopt gives an active claim "its `release` (`released:requested`) and its fence" — a released, fence-pending claim is a state R-BTN-19 and the claim indexes do not have | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-16 | medium | medium |  | underspecified · **Rules:** R-BTN-35, R-BTN-147, R-BTN-72, R-BTN-198, R-BTN-6, §9.4 · **Confidence:** medium | Who ends a `stale-board` claim — Baton in the snapshot's transaction, or the runner on a `release` message? | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-17 | medium | medium |  | underspecified · **Rules:** R-BTN-58, R-BTN-13 | Revoking a grant or a key says nothing about the active claims it backs | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-18 | medium | medium |  | underspecified · **Rules:** R-BTN-10 | An administrator may "release" an unconfirmed completion — a terminal `completed` claim leaves its state by a transition nothing defines | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-19 | medium | medium |  | contradiction · **Rules:** R-BTN-140, R-BTN-47, R-BTN-92 · **Confidence:** medium | Does a `repos:` entry have reach when the home lists no `code_repos`? R-BTN-140 says yes and no | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-20 | medium | medium |  | contradiction · **Rules:** R-BTN-171, §12.8 · **Confidence:** high | A proposed `withdraw` is "late" by three different clocks | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-21 | medium | medium |  | liveness · **Rules:** R-BTN-5/R-BTN-34, §9.4, R-BTN-122, R-BTN-126 · **Confidence:** low | `released:stale-board` before any leg runs is charged to nothing — a persistent re-verification mismatch is an unbounded claim/release loop | [cross-cut: lifecycle](11-lifecycle.md) |
| TIME-2 | medium | medium |  | security / underspecified | the CI identity token's time claims and replay are never stated | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-3 | medium | medium |  | underspecified | the CI key set: no cache life, no rotation rule, no refetch bound | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-4 | medium | medium |  | safety | the fence trusts the runner's wall clock with no skew bound; a backward step outlives the reap | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-5 | medium | medium |  | contradiction | the envelope's request rate does not fit its own write budget or the alarm's prune cap | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-6 | medium | medium |  | contradiction | "effect at most once" does not hold for `forge-check` by the mechanism stated | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-7 | medium | medium | yes | contradiction / liveness | an end unconfirmed at 6 hours — R-BTN-10 confirms it on the next good snapshot, §9.6 says never | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-8 | medium | medium |  | contradiction | opaque-blob caps disagree — §12.3's 16 KB against 4 KB for `rationale`, and a scenario that refuses a 5 KB profile | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-9 | medium | medium |  | contradiction | one shared credential cannot carry the runner rows R-BTN-149 allows it | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| DEC2-1 | medium | medium |  | contradiction | R-BTN-134 pins a sourced course at any ancestor of the default branch and never a tag; R-BTN-183 and §12.8 say first-parent history or a release tag | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-2 | medium | medium |  | unverifiable / contradiction | The decision retires `ui.state`; §14 still serves `GET /v1/ui/state` as "everything the dashboard draws", and S-BTN-170 tests `admin/state` against it | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-3 | medium | medium |  | contradiction | R-BTN-133 says a sourced course's `course.json` is "pinned byte-equal by the sync"; R-BTN-134 forbids a home copy and the decision rejected byte-equal copies | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-4 | medium | medium |  | restatement-drift | Three places say leg state is the side branch on a `git` repository "by no knob"; R-BTN-190 decides it by the course's `facts` too | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-5 | medium | medium |  | contradiction | The decision keeps a ticket's cancel when it leaves the board; the rules say the cancellation is never kept | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-6 | medium | medium |  | restatement-drift | Line 36's reason — `baton.stalled` "already flags a leg nobody takes" — is not what R-BTN-167 does | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-7 | medium | medium |  | contradiction | "Nothing changes authority from a cookie" — but an owner's session approves an MCP grant, unconfirmed | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-8 | medium | medium |  | contradiction | R-BTN-33 says core never reads a reading's `detail`; R-BTN-50 and R-BTN-76 have it read, and line 102 counts "two" exceptions where there are three | [Decisions, second pass](13-decisions-remaining.md) |
| GATE-1 | medium | medium |  | restatement-drift | G-BTN-44 confirms ends by a posted path and an end station, which R-BTN-10 no longer does | [gates, second pass](14-gates-remaining.md) |
| GATE-2 | medium | medium |  | contradiction | G-BTN-74 says Baton stores "URIs and digests only"; R-BTN-108 and §13 store inline output values | [gates, second pass](14-gates-remaining.md) |
| GATE-3 | medium | medium |  | restatement-drift / contradiction with another gate | G-BTN-69 presumes a course can have no `sync.mjs`; R-BTN-134 makes it required and the CLI holds no course | [gates, second pass](14-gates-remaining.md) |
| GATE-4 | medium | medium |  | unverifiable / contradiction | G-BTN-89 says a session "never holds a runner secret"; under the default `builtin` executor the leg can read it | [gates, second pass](14-gates-remaining.md) |
| GATE-5 | medium | medium |  | contradiction | G-BTN-104 says "a withdrawn ticket meets nothing"; R-BTN-120 lets it meet `withdrawn` and `closed` | [gates, second pass](14-gates-remaining.md) |
| FND-10 | low | low |  | underspecified | `job_workflow_ref`'s `<repository>` is undefined, and under the natural reading a rename locks the CI identity out | [§1–§3](01-foundations.md) |
| FND-11 | low | low |  | unverifiable / underspecified | The write-budget arithmetic and the prune rate do not fit the envelope | [§1–§3](01-foundations.md) |
| FND-12 | low | low |  | stale-reference | `§7.1` is cited for the board sync; §7.1 is now "Raising a condition" | [§1–§3](01-foundations.md) |
| FND-13 | low | low |  | restatement-drift | §13's `code_repos` contradicts R-BTN-140 on shape and on who resolves the ids | [§1–§3](01-foundations.md) |
| FND-14 | low | low |  | contradiction | The vocabulary page defines "Worker" as the agent session; the spec calls that a runner and uses "Worker" for the Cloudflare Worker; "runner" and "tenant" are not on the page | [§1–§3](01-foundations.md) |
| FND-15 | low | low |  | restatement-drift / contradiction | R-BTN-33's list of what Baton stores per ticket omits stored columns, and "never … a PR list" is contradicted by the resume record core reads | [§1–§3](01-foundations.md) |
| FND-16 | low | low |  | contradiction | `?limit=` "applies after the merge" (R-BTN-61) against "the limit is per group" (G-BTN-61) | [§1–§3](01-foundations.md) |
| FND-17 | low | low |  | underspecified | "Never the incoming `Host`" cannot be implemented on the local host, where the `Host` header is the only host there is | [§1–§3](01-foundations.md) |
| FND-18 | low | low |  | stale-reference / underspecified | `rate-limited` and `quota` are cited to R-BTN-135, which defines neither; whether lease upkeep counts in the 600-a-minute limit is unstated | [§1–§3](01-foundations.md) |
| FND-19 | low | low |  | architecture / contradiction | Deliveries produce stored facts besides wants (push records, `last_written_by`, `unclaimed-write`), and it is unclear which GitHub route records them | [§1–§3](01-foundations.md) |
| FND-20 | low | low |  | contradiction / underspecified | Small disagreements with a concrete consequence | [§1–§3](01-foundations.md) |
| TKT-3 | low | high | yes | contradiction | A refresh must carry `read_sha` to change tickets, but the schema says `read_sha` is sent only when it is not `sha` | [§4](02-tickets-syncs-board.md) |
| TKT-14 | low | low |  | restatement-drift | The observation response is listed three ways | [§4](02-tickets-syncs-board.md) |
| TKT-15 | low | low |  | contradiction | "The one normative schema" of the board post is not the one §14 and R-BTN-190 post | [§4](02-tickets-syncs-board.md) |
| TKT-16 | low | low |  | restatement-drift | R-BTN-33's list of what Baton stores per ticket has drifted from §4.4 and §13, and `brief` and the repository's `control` record have no table | [§4](02-tickets-syncs-board.md) |
| TKT-17 | low | low |  | security | Any granted key can push a sequence up 10 000 per call, forever, and mint unbounded `kind` rows; nothing lowers either | [§4](02-tickets-syncs-board.md) |
| CRS-12 | low | low |  | contradiction | `converse` is a leg "no claim runs" and also the example of a runner's claim; `baton ticket request` says "the next claim starts the course" for a course whose start leg nobody claims | [§5](03-courses.md) |
| CRS-13 | low | low |  | stale-reference | Dangling and wrong section references in R-BTN-131's request paragraph, and two typos that change meaning | [§5](03-courses.md) |
| CRS-14 | low | low |  | underspecified | `step_kinds` is a required `courses[]` field, stored and used as an enum, and neither §5 nor the vocabulary page defines it | [§5](03-courses.md) |
| CRS-15 | low | low |  | contradiction | When the runner reads a course's `version` — "at startup" or "after each fetch" — and what rule 9 gates once every claim loads the course at its snapshot | [§5](03-courses.md) |
| CRS-16 | low | low |  | restatement-drift | Restated facts that have drifted inside §5 | [§5](03-courses.md) |
| CRS-17 | low | low |  | unverifiable | R-BTN-131's shipped layout does not match the repository it describes | [§5](03-courses.md) |
| BLK-14 | low | low |  | contradiction | The two per-leg instants are said to restart "only when the ticket's station changes", but a route and the `retry` restart both restart them; §5 measures `expires` from a different event | [§6–§7](04-blocks-conditions.md) |
| BLK-15 | low | low |  | underspecified | The gates table and "the pipeline" list different rule sets for recommendations and for an advance | [§6–§7](04-blocks-conditions.md) |
| BLK-16 | low | low |  | underspecified | A `release` message names a ticket, not a claim; nothing retires it when the claim it was meant for ends first | [§6–§7](04-blocks-conditions.md) |
| BLK-17 | low | low |  | restatement-drift | `hold_reason` is enumerated in §6.8 without `scope-exceeded`, and "owners clear" a hold that §11/§14 give to an `approvers.policy` approver | [§6–§7](04-blocks-conditions.md) |
| BLK-18 | low | low |  | restatement-drift | Small numeric and naming drift inside §7 | [§6–§7](04-blocks-conditions.md) |
| RUN-11 | low | low |  | underspecified | whether a lost lease is a failed attempt depends on who wins a 4-minute race, and a runner chooses its own non-failing end without bound | [§8–§10](05-runners-claims-checks.md) |
| RUN-12 | low | low |  | contradiction | `floor` releases stop "at once" in §9.4 and "at the next safe point" in R-BTN-119; the kill ladder has three sets of numbers | [§8–§10](05-runners-claims-checks.md) |
| RUN-13 | low | low |  | restatement-drift | §8.1's heartbeat field list, the ring's "heartbeats at once", and two refusal codes disagree with §2 and §14 | [§8–§10](05-runners-claims-checks.md) |
| RUN-14 | low | low |  | safety | "a late `success` never overwrites a newer `failure`" rests on a read-then-post with no compare-and-set | [§8–§10](05-runners-claims-checks.md) |
| PPL-16 | low | low |  | underspecified | what `api_keys: false` does to an OAuth grant, and whether a removed redirect URI still works, each have two readings | [§11, OAuth](06-people-oauth.md) |
| PPL-17 | low | low |  | contradiction | administrators "read everything", but two reads and three CLI rows leave them out | [§11, OAuth](06-people-oauth.md) |
| PPL-18 | low | low |  | underspecified | `set_by` is one column for a ticket's whole override row, and the `own` test reads it | [§11, OAuth](06-people-oauth.md) |
| PPL-19 | low | low |  | restatement-drift | the companion's statements about the main spec that have drifted | [§11, OAuth](06-people-oauth.md) |
| PPL-20 | low | low |  | unverifiable | R-BTN-197's 14-day notice is a property of every deployment that no deploy can check | [§11, OAuth](06-people-oauth.md) |
| PPL-21 | low | low |  | underspecified | `MCP-Protocol-Version` absent defaults to a revision the build need not serve | [§11, OAuth](06-people-oauth.md) |
| PPL-22 | low | low |  | unverifiable | rules with no scenario, and a control the threat model claims that no rule states | [§11, OAuth](06-people-oauth.md) |
| PPL-23 | low | low |  | underspecified | `wind-down` and the scope acknowledgement are session actions §11.4's lists never mention, and an owner's wind-down reaches other repositories' work | [§11, OAuth](06-people-oauth.md) |
| SEC-11 | low | low |  | restatement-drift | The principal table and the bearer rule omit the OAuth surface, and three rows cite the wrong rule or omit a credential | [§12](07-security.md) |
| SEC-12 | low | low |  | stale-reference | `§7.1` is cited four times for B-127's marks and control record, which live in §4.4; §7.1 is "Raising a condition" | [§12](07-security.md) |
| SEC-14 | low | low |  | underspecified | Credentials an owner's agent minted before a list became human-only keep working after it | [§12](07-security.md) |
| SEC-16 | low | low |  | restatement-drift | A delegated key's actions have grown past what the OAuth decision weighed; a stolen four-hour session mints a 90-day bar-and-hold credential with no confirmation | [§12](07-security.md) |
| SEC-17 | low | low |  | unverifiable | R-BTN-187's "per-key limits" carry no number, and the security model's reach 8 describes a rule R-BTN-62 no longer states | [§12](07-security.md) |
| SEC-18 | low | low |  | underspecified | Under `human_key: hardware`, nothing says Baton checks the user-verification flag on each signature | [§12](07-security.md) |
| API-10 | low | low |  | restatement-drift | `events.kind` and `ticket_history.kind` miss kinds the rules log | [§13–§14](08-data-model-api.md) |
| API-11 | low | low |  | restatement-drift | Restated lists that have drifted from their one home | [§13–§14](08-data-model-api.md) |
| API-12 | low | low |  | underspecified | `POST /v1/admin/seal` is final and takes no confirmation | [§13–§14](08-data-model-api.md) |
| API-13 | low | low |  | underspecified | No HTTP status for most error codes, and pagination is stated four ways | [§13–§14](08-data-model-api.md) |
| VER-3 | low | low |  | stale-reference | Test files named for scenarios the table lacks, and one under the wrong number | [§15 scenarios, model](09-scenarios-model.md) |
| VER-12 | low | low |  | contradiction | S-BTN-205 contradicts itself | [§15 scenarios, model](09-scenarios-model.md) |
| VER-13 | low | low |  | unverifiable | §12 expectations no rule states | [§15 scenarios, model](09-scenarios-model.md) |
| VER-15 | low | high | yes | contradiction | S-BTN-120 expects `not-eligible` for rule 7; the gate's code is `not-granted` | [§15 scenarios, model](09-scenarios-model.md) |
| VER-17 | low | medium | yes | contradiction | S-BTN-55 expects `forbidden` for a revoked sync key; R-BTN-93 says `unauthenticated` | [§15 scenarios, model](09-scenarios-model.md) |
| VER-24 | low | low |  | underspecified | Rows whose setup cannot produce the expectation, or that are ambiguous | [§15 scenarios, model](09-scenarios-model.md) |
| VER-25 | low | low |  | restatement-drift | Duplicated rows | [§15 scenarios, model](09-scenarios-model.md) |
| VER-G6 | low | low |  | restatement-drift | `model/README.md` and a leftover model file contradict R-BTN-68 | [§15 scenarios, model](09-scenarios-model.md) |
| DEC-11 | low | low |  | unverifiable | Ten gates are "Proved by: tests" with no scenario, and nothing in the repository cites them | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-12 | low | low |  | restatement-drift | G-BTN-47 and G-BTN-61 state the default order and the limit differently from §6.6 and R-BTN-61 | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-13 | low | low |  | contradiction | §13 says claims are "kept forever"; R-BTN-149 and a decision prune them | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-14 | low | low |  | restatement-drift | The owner settings are enumerated in three places with three different sets | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-15 | low | low |  | stale-reference | The decision "per PR by `model:pr` and weekly by `model:full`" no longer matches R-BTN-68 | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-16 | low | low |  | underspecified | R-BTN-2 ties the paid plan to "a cut-over repository" and omits the limit production actually hit | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-17 | low | low |  | contradiction | Two loose statements in Open questions: who confirms a session's action, and what `R-FH-3` is | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-18 | low | low |  | stale-reference | A decision cites the range R-BTN-160–R-BTN-168, which contains two retired ids | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-19 | low | low |  | restatement-drift | The front's contents table and date lag the sections | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-20 | low | low |  | underspecified | The cutover's sticky marker is one file per user, while cutover is per repository | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-21 | low | low |  | stale-reference | §16's code anchors do not match the code, and §16's "partly built" list omits the ticket that built them | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| DEC-22 | low | low |  | restatement-drift | G-BTN-75 says git's value is always adopted; R-BTN-85 and the decisions carve out `position-disagrees` | [gates, §16, Decisions](10-gates-decisions-adoption.md) |
| LIFE-22 | low | low |  | stale-reference · **Confidence:** high | §14's `advance` and `end` bodies carry `taken? (R-BTN-177)`, a retired rule, against §6.10's "records no route taken" | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-23 | low | low |  | restatement-drift · **Confidence:** high | The claim response in §14 lacks `brief`, `last_written_by` and the `control` record that §4.4 says it carries | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-24 | low | low |  | restatement-drift · **Confidence:** high | The heartbeat field is `legs_finished` in §8.1, §14 and R-BTN-90's first mention, and `leg_finished` two sentences later and in two scenarios | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-25 | low | low |  | restatement-drift · **Confidence:** high | Which releases stop "at once": three reasons in R-BTN-119, four in §9.4 and §6.9 | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-26 | low | low |  | restatement-drift · **Confidence:** high | `hold_reason` is listed twice with different members | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-27 | low | low |  | contradiction · **Confidence:** high | A `depends_at` reference has three shapes | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-28 | low | low |  | restatement-drift · **Confidence:** high | `code_repos` is stored in two different shapes | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-29 | low | low |  | restatement-drift · **Confidence:** medium | `events.kind` omits kinds other rules log and §13 itself indexes | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-30 | low | low |  | stale-reference · **Confidence:** high | `check-mismatch` is "the discrepancy … (R-BTN-85)" but R-BTN-85's table of subs does not have it | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-31 | low | low |  | contradiction · **Confidence:** medium | The attempt count's reset is defined twice, and adopt's reset fits neither | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-32 | low | low |  | stale-reference · **Confidence:** high | "a supersession's replacement" is named in §12.8 and defined nowhere | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-33 | low | low |  | underspecified · **Confidence:** medium | A reap is not among the causes that record a sync want, yet a reaped ticket is claimable only after a new snapshot | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-34 | low | low |  | restatement-drift · **Confidence:** medium | Two sync attestation types for one fact | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-35 | low | low |  | stale-reference · **Confidence:** high | `step_kinds` has no defining rule and is not on the vocabulary page that `CLAUDE.md` says includes it | [cross-cut: lifecycle](11-lifecycle.md) |
| LIFE-36 | low | low |  | restatement-drift · **Confidence:** high | The vocabulary page contradicts the spec on four of its own words | [cross-cut: lifecycle](11-lifecycle.md) |
| TIME-10 | low | low |  | contradiction | the webhook backstop's boundary is stated two incompatible ways | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-11 | low | low |  | underspecified | `unauthenticated` from a skewed or revoked runner is not classified by the fence | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-12 | low | low |  | underspecified | a per-tenant storage cap that lease upkeep is exempt from; nothing says what the alarm does at a full store | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-13 | low | low |  | stale-reference / restatement-drift | stale and drifted references around R-BTN-90's re-arm and the end's `detail` | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-14 | low | low |  | liveness | a renewing sync under the repository's only credential holds the observation number without bound | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-15 | low | low |  | underspecified | quantities a rule needs and nobody states | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| TIME-16 | low | low |  | restatement-drift | quantities restated outside their home rule (one grouped finding) | [cross-cut: time, numbers, failure](12-time-numbers-failure.md) |
| DEC2-9 | low | low |  | contradiction between decision lines | Decision 22 limits attestation writers to trusted ones and rejects "facts read from git"; R-BTN-181/191 admit `runner`, `sync`, `instrument` and `admin` | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-10 | low | low |  | restatement-drift | Line 64 rejects "Baton storing or validating content"; R-BTN-108/-109 store and fully validate inline values | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-11 | low | low |  | restatement-drift | Line 53's list of what Baton gates omits seven gates of §6.6 | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-12 | low | low |  | restatement-drift | Line 44's "stale only when git takes the ticket away" does not match the `stale-board` causes | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-13 | low | low |  | restatement-drift | Decision 16 states as fixed what is now one value of `paths.control` and `paths.tickets` | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-14 | low | low |  | restatement-drift | Decision 28's excluded case differs from §12.8's "stated exactly" list, and R-BTN-183 (cited) does not state it | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-15 | low | low |  | contradiction / stale-reference | Needs-you listings outside §7, and screen names the dashboard decision retired | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-16 | low | low |  | restatement-drift | Retirement "ends … runner keys" in the decision; R-BTN-47 revokes grants and leaves the credentials live | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-17 | low | low |  | restatement-drift / stale-reference | R-BTN-131 says every course that writes work "ends at `merged`"; `build-app` ends at `shipped`; the same rule cites a nonexistent "§2f" | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-18 | low | low |  | underspecified | Line 241's "named as text on the ticket page" is in no rule | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-19 | low | low |  | restatement-drift | Lines 186, 269, 158, 149 and 157 — small drifts from the rules they cite | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-20 | low | low |  | stale-reference | Lines 91, 84, 45, 60 and 31 state things their citations do not carry | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-21 | low | low |  | underspecified | Line 114's "owners' default, ceiling and floor" — R-BTN-122's setting shape holds one ceiling and one floor | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-22 | low | low |  | restatement-drift | Line 89 says readings "fail open"; R-BTN-76 lets `unknown` block under `missing: block` | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-23 | low | low |  | contradiction between decision lines / restatement-drift | Lines 39/40 and §2 disagree on what the Node host is for | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-24 | low | low |  | contradiction | R-BTN-167 says the validator refuses `after_s`, the required key of a person leg's `expires` | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-25 | low | low |  | restatement-drift | Line 117 calls "who may deliver" a column of the outbox kind; in R-BTN-171 it is the policy's `outbox` entry | [Decisions, second pass](13-decisions-remaining.md) |
| DEC2-26 | low | low |  | contradiction between decision lines | Line 38 leaves reviewer independence "cooperative … without Baton recording reviewer seats"; Baton now gates `no_chain_from` by credential and compares review domains | [Decisions, second pass](13-decisions-remaining.md) |
| GATE-6 | low | low |  | restatement-drift | G-BTN-166 and S-BTN-193 choose leg state by the forge alone; R-BTN-190 also reads the course's facts | [gates, second pass](14-gates-remaining.md) |
| GATE-7 | low | low |  | contradiction | G-BTN-137 holds a file that removes an exempt leg; R-BTN-142 passes it | [gates, second pass](14-gates-remaining.md) |
| GATE-8 | low | low |  | contradiction | G-BTN-97 says each unmet prerequisite "is a block row on the leg"; three kinds in R-BTN-120's table are not | [gates, second pass](14-gates-remaining.md) |
| GATE-9 | low | low |  | contradiction | G-BTN-8 says the mirror "never overwrites an unexpected status"; §16.3 has it overwrite a foreign claim | [gates, second pass](14-gates-remaining.md) |
| GATE-10 | low | low |  | contradiction between gates | G-BTN-6's "only" omits three confirmations R-BTN-10 and G-BTN-44 allow; its one test asserts the retired model | [gates, second pass](14-gates-remaining.md) |
| GATE-11 | low | low |  | restatement-drift | G-BTN-51 maps a branch to "every ticket" a pattern gives; R-BTN-141 maps it to the longest id only | [gates, second pass](14-gates-remaining.md) |
| GATE-12 | low | low |  | restatement-drift | G-BTN-125 says "one budget"; R-BTN-96 says one budget per host | [gates, second pass](14-gates-remaining.md) |
| GATE-13 | low | low |  | contradiction with its own scenario | G-BTN-145 says the local host "binds loopback" and CI tokens pass only for "push, schedule or dispatch"; R-BTN-158 and R-BTN-15 allow more | [gates, second pass](14-gates-remaining.md) |
| GATE-14 | low | low |  | unverifiable | G-BTN-10, G-BTN-9 and G-BTN-38 have no test behind "Proved by"; G-BTN-10 rests on a term no rule defines | [gates, second pass](14-gates-remaining.md) |
| GATE-15 | low | low |  | stale-reference | G-BTN-117 requires every named command to be `baton <noun> <verb>` in the tree; R-BTN-127 itself still names the retired `baton run` | [gates, second pass](14-gates-remaining.md) |
| GATE-16 | low | low |  | underspecified / unverifiable | G-BTN-43's "a refusal changes nothing" is not stated by R-BTN-63, whose wording reads the other way, and neither cited scenario refuses an advance | [gates, second pass](14-gates-remaining.md) |
