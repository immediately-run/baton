---
title: "Adversarial review 2026-11-18 — cross-cutting: quantities, clocks and failure at boundaries"
description: "One reviewer's findings, as filed, on every quantity, clock and external boundary in BATON_SPEC."
order: 21
tags: [review]
---

# Adversarial review 2026-11-18 — cross-cutting: quantities, clocks and failure at boundaries

Reviewer span: no single section. Method: grep of every numeric quantity with a unit across
`spec/BATON_SPEC/*.md` (and the lifetimes in `BATON_MCP_OAUTH_SPEC.md`), then a full read of §2
(whole), §9 (whole), §8.1, R-BTN-9, R-BTN-13, R-BTN-15/93, R-BTN-62/150, R-BTN-73/94/95, R-BTN-76,
R-BTN-89, R-BTN-90, R-BTN-115, R-BTN-122, R-BTN-126, R-BTN-128, R-BTN-162, R-BTN-167, R-BTN-171,
§12.3 and the §15 rows that carry numbers. Paths below are relative to `spec/BATON_SPEC/`.

Counts: 0 critical, 1 high, 8 medium, 7 low.

---

### TIME-1: `advance` is the one lease-upkeep write with no retry key — a lost response cannot be retried
- **Severity:** high
- **Kind:** underspecified (liveness at the runner's network boundary)
- **Rules:** §2.1, R-BTN-63, §9.1 "One claim runs a run of legs", R-BTN-180, §14 advance row
- **Confidence:** medium-high
- **Evidence:**
  - `02-deployments.md:28-32` — "A claim's repeated `request_id` returns the first request's committed result (G-BTN-2); `claims.request_id` is the only stored request id. Every other write is safe to retry by its own key: a repeated end is `ok` (§9.4), owner and administrator writes set a value, a repeated board post is `stale-observation` […], and a repeated raise or report finds its row."
  - `05-courses.md:251-252` — "`advance {reached, leg}` finishes the running leg, if any, at `reached` — one of its outcomes, else refused `off-graph` — records the position, then starts `leg` if it leaves `reached` […] the ticket's runs of it are fewer than its `max_runs`"
  - `05-courses.md:260-261` — "The `advance` that starts a run, and an adoption that adds one, mints its `run_id`"
  - `14-api.md:74` — the request body `{reached?, leg, run_label? …}` carries no `request_id`; the reply is the only place `run_id`, `inputs` and `leg_log.dir` are handed out.
  - `13-data-model.md:145` — "`run_labels` … so a label is refused a second time atomically"
  - `08-runners.md:38` — "each request with a **30-second** timeout" (the heartbeat's; no timeout is stated for `advance` at all).
- **The problem:** §2.1 enumerates the retry key of every write and omits `advance`. Trace: the runner sends `advance {reached: S1, leg: L2}`; Baton commits (L1 finished at S1, a `claim_legs` row for L2, a minted `run_id`, `deadline_at` armed, one of L2's `max_runs` spent, for a `per_run` credential the `run_label` recorded); the response is lost. The retry, the same body, is now evaluated against the new state: "finishes the running leg" — which is L2 — "at `reached`" = S1, which is L2's `from`, not one of its outcomes → `off-graph`; with a run label → refused "a second time". The runner never learns `run_id`, the resolved `inputs` or the log directory (the heartbeat response carries the claim's leg but none of those, `08-runners.md:47-49`), while the deadline clock runs on a leg it cannot start. Where a leg's outcome is its own `from` station (a review-round loop), the retry is *accepted*: it finishes the just-started run with no work and starts another, silently burning `max_runs`. Neither outcome is stated; an implementer must invent the recovery.
- **Counter-reading considered:** "its own key" could be `(claim, leg, reached)` — a repeated advance into the leg already running returns the first reply. Nothing says so: I searched `repeated .advance`, `advance` with `idempot|retried|lost response|again` across all sections and §15 and found only the claim's `request_id` rule; the `run_labels` rule positively refuses the second attempt. G-BTN-2 covers the claim only.
- **Smallest fix:** in R-BTN-63: "an `advance` whose `leg` is the claim's running leg and whose `reached` is the station that run started from, with the same `run_label`, is answered with the first reply (same `run_id`, inputs, `leg_log`)"; add it to §2.1's list and a scenario with a dropped response.

### TIME-2: the CI identity token's time claims and replay are never stated
- **Severity:** medium
- **Kind:** security / underspecified
- **Rules:** R-BTN-15 / R-BTN-156, R-BTN-93, R-BTN-32, G-BTN-11, G-BTN-145
- **Confidence:** high (that it is unstated); medium (that an implementation would omit it)
- **Evidence:**
  - `03-repositories-and-forges.md:217-223` — the complete list of what is verified for GitHub: "issuer … audience `BATON_ORIGIN`; `repository_id` and `repository_owner_id` …; `ref` is the default branch; `job_workflow_ref` …; `workflow_ref` equals `job_workflow_ref` …; `event_name` is `push`, `schedule` or `workflow_dispatch`."
  - `03-repositories-and-forges.md:209` — "It refuses `unauthenticated` (no credential, bad signature, unknown or revoked key, a token that fails)"
  - `11-people.md:44-46` — by contrast a signed request states its window exactly: "`created` more than 5 minutes from Baton's clock … a nonce already seen for that key within 11 minutes"
  - `15-verification.md:301` — "G-BTN-11 | A sync OIDC token from a branch or another workflow is refused"
- **The problem:** the spec's one bearer credential issued by a third party is the only credential whose lifetime, clock and replay rule are absent. `exp`, `nbf` and `iat` appear nowhere in the spec (grep for `` `exp` ``, `` `iat` ``, `` `nbf` ``, `expir`, `leeway`, `validity` in §3, §11, §12, §15: no hit about CI tokens). Two readings: (a) "a token that fails" includes expiry, with which clock (the Worker verifies it, `02-deployments.md:19`, the core's clock is `this.now`) and what leeway is unstated; (b) only the listed claims are checked — the list reads as exhaustive — and a token captured once (a workflow log, a compromised step) posts boards and reads events for that repository forever. Under either reading a token is replayable within its life: there is no `jti` cache, so a leaked token races the legitimate sync for the observation number. No scenario or gate tests an expired or replayed token.
- **Counter-reading considered:** any JWT library checks `exp`. The spec verifies with WebCrypto on both hosts (`11-people.md:42`) and specifies every other credential's window to the minute; "one clock" (R-BTN-32) makes the choice of clock a rule, not a library default.
- **Smallest fix:** add to R-BTN-15: "`exp` after and `nbf`/`iat` not after Baton's clock, with N seconds' leeway; a token is accepted for at most its own life"; say whether replay inside that life is accepted (it is bounded by the observation number) and add a gate row for an expired token.

### TIME-3: the CI key set: no cache life, no rotation rule, no refetch bound
- **Severity:** medium
- **Kind:** underspecified (failure at the identity-provider boundary)
- **Rules:** §2.1, R-BTN-135, §14 `unavailable`
- **Confidence:** high
- **Evidence:**
  - `02-deployments.md:19` — "The Worker fetches CI identity key sets and verifies CI tokens"
  - `02-deployments.md:139-140` — "The deployment holds only the per-IP rule, caches of public data keyed by the exact URL fetched (a CI key set by its key-set URL, never its issuer's name)"
  - `14-api.md:51` — "`unavailable` | 503, retryable: a CI key set the forge could not serve"
- **The problem:** these three lines are everything the spec says about the JWKS boundary. Unstated: how long a fetched set is served; what happens to a token whose `kid` is not in the cached set (refetch? how often? — an attacker sending tokens with random `kid`s turns each request into an outbound fetch, and CI tokens "count in none" of the failed-verification buckets, `02-deployments.md:290`); whether a cached set is served when the forge is down (`unavailable` suggests not, so a GitHub OIDC outage refuses every sync even with a warm cache) ; how a key the forge has withdrawn stops being honoured. The companion spec does state all of this for its own fetched documents (`BATON_MCP_OAUTH_SPEC.md:127-138`: 5 s timeout, `Cache-Control` clamped to 5 minutes–24 hours, last valid copy for up to 7 days), so the omission is specific to the key set.
- **Counter-reading considered:** "an implementation detail of the shell". The shell is specified to this depth everywhere else (the failed-verification snapshot's "at most once a minute and again at most once every 5 s", `02-deployments.md:293`), and the choice changes observable behaviour (503 vs 401, how long a rotated-out key signs boards).
- **Smallest fix:** one bullet under R-BTN-15: cache life (min/max), refetch on unknown `kid` at most once per N seconds per URL, stale-while-error bound, and which refusal each case gives.

### TIME-4: the fence trusts the runner's wall clock with no skew bound; a backward step outlives the reap
- **Severity:** medium
- **Kind:** safety
- **Rules:** R-BTN-6, R-BTN-26, R-BTN-9, R-BTN-19, §9.2 "Three fence layers", R-BTN-32
- **Confidence:** medium
- **Evidence:**
  - `09-claims.md:78-80` — "computes, from the state file and the **wall clock** (never a monotonic clock), `now − last_ok ≥ lease_timeout − 4 min`"
  - `09-claims.md:194-195` — "The alarm reaps every active claim whose runner has `now − last_seen_at ≥ lease_timeout_ms`"
  - `09-claims.md:233-234` — "A silence reap is not fence-pending — every check of that runner already computes the lease as lost"
  - `09-claims.md:89-90` — "A pre-tool hook denies `git push`, the forge's change-create and merge commands and status-changing writes"
  - `09-claims.md:97-98` — "Pushes to the default branch are not refused here"
  - `08-runners.md:55` — the heartbeat response carries "`server_time`" (no rule says what a runner does with it).
- **The problem:** the two sides of the lease are measured on two clocks — Baton's (`last_seen_at`, the alarm's `now`) and the runner's wall clock (`last_ok`, each hook's `now`) — and the 4-minute margin is the only allowance. It covers the 30-second request timeout; it does not cover a wall-clock step, which the choice of wall clock over monotonic invites. Trace: a VM boots with its clock 10 minutes fast; the sidecar's heartbeat is accepted (`last_ok = T+10`); NTP steps the clock back 10 minutes; the sidecar then dies or hangs (the harness and its hooks live on). Baton reaps at `last_seen_at + lease_timeout` and — a silence reap — re-issues the ticket at once, on the stated premise that "every check of that runner already computes the lease as lost". Each hook computes `now − last_ok` as 10 minutes short, so until `lease_timeout + 6 min` the pre-tool hook allows the forge's merge and change-create commands and pushes to the default branch; only a push to a ticket branch gets the server-side `branch-holder` question. The premise of `09-claims.md:233` and of `fence_deadline` (`09-claims.md:215-216`, "Every check of the old incarnation has computed its lease as lost by then") is false by the size of the step.
- **Counter-reading considered:** `created` within 5 minutes of Baton's clock (R-BTN-13) bounds skew for SSH-signed runners at the moment of each accepted heartbeat — so the step is bounded by 5 minutes there, still more than the 4-minute margin; an API-key runner (R-BTN-159) signs nothing and has no bound at all. Searched `skew`, `monoton`, `server_time`, `clock` across all sections: no rule bounds or detects it. The steady-clock case (no step) is sound: both sides measure a duration.
- **Smallest fix:** have the sidecar store `server_time − local now` at each accepted heartbeat and have R-BTN-26's check treat the lease as lost when `now < last_ok` or when the offset has moved by more than a stated bound; or state the margin as "4 min, which must exceed the request timeout plus the largest clock step the deployment allows" and list it under load-bearing assumptions.

### TIME-5: the envelope's request rate does not fit its own write budget or the alarm's prune cap
- **Severity:** medium
- **Kind:** contradiction (arithmetic)
- **Rules:** R-BTN-87, R-BTN-149, §2.3 "Write budget", R-BTN-13, §2.1 alarm
- **Confidence:** medium
- **Evidence:**
  - `02-deployments.md:219-221` — "50 live runners … 20 requests a second as a 5-minute mean; bursts of 100 requests in any 5 seconds."
  - `02-deployments.md:315-316` — "Each signed request writes two rows (a `request_nonces` insert and its prune 11 minutes later)."
  - `02-deployments.md:320-321` — "At the envelope that is about 330,000 row writes a day."
  - `02-deployments.md:265-266` — "The alarm deletes at most 1,000 rows a tick, oldest first, each prune through an index"
  - `02-deployments.md:48` — the alarm's retention row: "`request_nonces` after 11 minutes, `webhook_deliveries` after 24 hours, R-BTN-149's 90-day prunes"
  - `02-deployments.md:33` — "One alarm, every 60 seconds"
- **The problem:** (1) 20 signed requests a second is 1,200 nonce rows a minute to prune; the alarm deletes at most 1,000 rows a tick and ticks every 60 s. If the cap covers nonces (the alarm table lists them in the same "retention" row as R-BTN-149's prunes, and the cap is stated without exception), `request_nonces` grows by 200 rows a minute for as long as the envelope's own mean holds, and "oldest first" starves every other prune behind it; if it does not, a tick's deletes are unbounded and the "at most 1,000" is false. The spec does not say which. (2) 20 req/s for a day is 1.73 M requests, 3.46 M nonce row writes alone; "about 330,000 row writes a day" corresponds to roughly 2 req/s. Either the 330,000 or the 20 req/s is not "the envelope", and R-BTN-2's quota reasoning and `npm run test:load` ("proves it") inherit whichever is wrong.
- **Counter-reading considered:** many requests are not SSH-signed (dashboard sessions, API keys, CI tokens write no nonce), and 20 req/s is a peak 5-minute mean, not a daily mean. Then the daily figure needs its own stated mix; and the peak still exceeds the prune cap for as long as it lasts, with no statement that the backlog drains. Searched `1,000 rows`, `nonce`, `prune` in §2, §13, §15 (S-BTN-225 tests "at most 1,000 rows a tick" on events only).
- **Smallest fix:** say whether the nonce prune is inside the 1,000-row cap (and if so raise it or prune nonces by range delete outside it), and state the request mix the 330,000 assumes.

### TIME-6: "effect at most once" does not hold for `forge-check` by the mechanism stated
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-171 (Idempotence, Claiming and marking), R-BTN-115 (Delivery)
- **Confidence:** high
- **Evidence:**
  - `07-conditions.md:664-665` — "Every delivery carries its entry's id, so delivery is at least once and its effect at most once."
  - `07-conditions.md:672-673` — "`forge-check`: the check run's `external_id` carries the id, and R-BTN-115's `seq` keeps an older entry from overwriting a newer one."
  - `10-checks.md:118-120` — "Before posting it also reads the sha's check runs of that name and skips its entry when one carries a higher `seq`"
  - `07-conditions.md:656` — "A lapsed lease re-queues the entry. A mark arriving after its lease lapsed is accepted."
- **The problem:** carrying an id makes an effect at-most-once only if someone refuses the second copy. For `withdraw` the deliverer does (it reads the file for `baton_write: <id>` first). For `forge-check` nothing does: a forge does not deduplicate on `external_id`, and the deliverer skips only on a *higher* `seq`, never an equal one. Trace: deliverer A posts the check run and crashes before marking; the 10-minute lease lapses; B claims the same entry, reads the runs, finds `seq` equal, posts a second run. The stated guarantee is at-least-once with a harmless duplicate, not at-most-once. A second, sharper case: A's late `delivered` mark "is accepted" after B has claimed — the entry is then `delivered` under A's `ref` while B still holds a lease and may mark `failed … transient`, which "returns [it] to `queued`" (`07-conditions.md:654`) — a `delivered` entry "is never claimed again" (`07-conditions.md:682`) and yet has just been re-queued. "A mark from any credential but the claimer is `forbidden`" does not separate A from B when they share a credential (`09-claims.md:103`, "several runners may share one credential").
- **Counter-reading considered:** the duplicate is the same conclusion on the same sha, so the gate is unaffected; true, which is why this is medium. But the read-back rule (`10-checks.md:124-128`) matches "a run … that matches its entry" and flags "a newest run … that is not the highest-`seq` entry already marked `delivered`" — with two runs and a re-queued entry the mismatch logic is exercised by a path no scenario covers (S-BTN-81 covers "undelivered 15 min" only).
- **Smallest fix:** `10-checks.md:118`: "skips its entry when one carries a higher **or equal** `seq`, reporting that run as its `ref`"; in R-BTN-171 key the claimer by runner, not credential, and say a mark on an entry already `delivered` is ignored.

### TIME-7: an end unconfirmed at 6 hours — R-BTN-10 confirms it on the next good snapshot, §9.6 says never
- **Severity:** medium
- **Kind:** contradiction / liveness
- **Rules:** R-BTN-10, §9.6 "Claimable again", R-BTN-62/150, R-BTN-73
- **Confidence:** medium
- **Evidence:**
  - `09-claims.md:245-246` — "It is confirmed by the first accepted snapshot whose observation began after the end and that: …" (no time limit)
  - `09-claims.md:259-263` — "A completion unconfirmed 6 hours after `ended_at` (its named evidence attested `found: false` or never attested) raises `baton.unconfirmed` and is never confirmed automatically; an administrator confirms or releases it from the dashboard"
  - `03-repositories-and-forges.md:358-359` — "14 runs of a `*/15` cron in 51 hours …, gaps of 2–5 hours, measured on the workflow's own history."
  - `04-tickets-syncs-board.md:412-416` — "the same credential's after 10 minutes. Any other credential's request voids a number 30 minutes after issue … a CI identity is one credential whatever run holds it"
- **The problem:** two readings of what happens to a snapshot that arrives at 6 h 01 min carrying `found: true`: R-BTN-10 confirms it; "never confirmed automatically" refuses it. They differ observably, and the second makes a sync outage a manual operation per ticket: "never attested" is exactly what every end made during a sync outage looks like, the spec's own measurement shows 5-hour gaps in its backstop, and a repository whose only sync credential is its CI identity cannot have a held observation number voided by anyone else while one hung run keeps renewing (same credential: voided only when *idle* 10 minutes; the 30-minute age rule is "any other credential's"). Every claim that ended in such a window then needs an administrator's click before its ticket is claimable ("never while a completion is unconfirmed"), with dozens of workers.
- **Counter-reading considered:** the 6-hour rule is meant only for evidence attested `found: false`. The parenthesis says "or never attested". S-BTN (`15-verification.md:235`, "a push that never lands | … flagged at 6 h, never re-issued") tests only the push that never lands, not the late snapshot.
- **Smallest fix:** "is flagged at 6 hours; a later snapshot that meets R-BTN-10 still confirms it and closes the condition; one attested `found: false` is never confirmed automatically." Add the late-snapshot case to the scenario.

### TIME-8: opaque-blob caps disagree — §12.3's 16 KB against 4 KB for `rationale`, and a scenario that refuses a 5 KB profile
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** §1 "Opaque blobs", §12.3, R-BTN-100, S-BTN-228
- **Confidence:** high
- **Evidence:**
  - `01-what-baton-is.md:77-79` — "**Opaque blobs** are the other inline values, capped by §12.3 (16 KB each, 256 KB of a repository's course data): a ticket's `course` and `display`, a next leg's `course`, `course_data`, profiles, reports, `rationale`, a reading's `detail`."
  - `12-security.md:150-152` — "**Opaque blobs** (course data, a ticket's and a leg's course fields, a runner's profile and reports, readings' `detail`) … at most 16 KB per blob"
  - `06-prerequisites-blocks-advice.md:534` — "`rationale`: opaque JSON ≤ 4 KB" (also `14-api.md:73`, `13-data-model.md:134`)
  - `15-verification.md:229` — S-BTN-228: "one whose `profile` is a string and one of 5 KB … the malformed ones refused `invalid-params`"
- **The problem:** `rationale` is capped at 16 KB by §1 (citing §12.3) and at 4 KB by its own rule, the API table and the data model. A runner's `profile` is capped at 16 KB by §12.3 and no other rule states a cap (searched `profile` in §6, §8, §13, §14), yet S-BTN-228 requires a 5 KB profile to be refused — the scenario tests a 4 KB cap the spec does not contain. An implementer following §12.3 fails S-BTN-228; one following the scenario contradicts §12.3.
- **Counter-reading considered:** §12.3 is a ceiling and each rule may set a lower cap. Then §1 must not say `rationale` is "capped by §12.3 (16 KB each)", and the profile's lower cap must exist somewhere.
- **Smallest fix:** state the profile's cap in §8.1's heartbeat bullet (4 KB, if that is the intent), drop `rationale` from §1's list or say "at most"; make §12.3 list the per-field exceptions by rule id.

### TIME-9: one shared credential cannot carry the runner rows R-BTN-149 allows it
- **Severity:** medium
- **Kind:** contradiction (arithmetic) — rate limit vs required behaviour
- **Rules:** §2.3 Admission, R-BTN-149, §8.1 Spool, "Credentials"
- **Confidence:** medium
- **Evidence:**
  - `02-deployments.md:285-286` — "Authenticated calls are limited to 600 a minute per credential, keyed by origin and credential"
  - `02-deployments.md:249` — "live runner rows per credential | 64"
  - `08-runners.md:107-108` — "The sidecar posts the spool within 5 s and on every heartbeat"
  - `08-runners.md:112-113` — "a cloud environment's in the environment secret `BATON_KEY`, shared by every container"
  - `02-deployments.md:298-302` — lease upkeep ("heartbeats of an existing session, `advance`, `end`, release acknowledgements") has its own buckets.
- **The problem:** a working agent spools an activity at every matched tool call, and the sidecar must post "within 5 s": up to 12 non-upkeep calls a minute per busy runner. The cap admits 64 live runners on one credential and the cloud deployment shares one key across every container by design: 64 × 12 = 768 calls a minute against a 600-a-minute bucket, before recommendations, readings, holder queries (one per push and per status write, `09-claims.md:93-95,110`) and condition raises. At the envelope's 50 runners on one key the bucket is exactly full from spool posts alone. The lease survives (upkeep is separate) but the "within 5 s" rule, and the fence's holder queries — which "refuse when Baton cannot be reached" — degrade under the spec's own nominal configuration; whether a `rate-limited` holder query counts as "cannot be reached" (push refused) is unstated.
- **Counter-reading considered:** activities ride the heartbeat too ("and on every heartbeat"), so a throttled spool only lags. True for activities; not for the pre-push `branch-holder` query, which has no upkeep bucket and gates every push.
- **Smallest fix:** scale the non-upkeep bucket with live sessions as the upkeep bucket already does ("plus 10 per live session"), or put the holder queries in the upkeep bucket, and say what a `rate-limited` holder query means to the hook.

### TIME-10: the webhook backstop's boundary is stated two incompatible ways
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-73 "The webhook path's own backstop", S-BTN-167
- **Confidence:** high
- **Evidence:**
  - `03-repositories-and-forges.md:377-379` — "`last_dispatch_at` under the alarm's `now` less 10 minutes, strictly, so a stamp is never due again on the tick that wrote it, and a row exactly ten minutes old is not yet due"
  - `03-repositories-and-forges.md:380-383` — "The alarm is armed for the earliest live stamp's `last_dispatch_at + SYNC_STALE_MS` (the first instant the strict comparison holds) … so the send lands at ten minutes rather than up to a minute later"
  - `13-data-model.md:94` — "stale for the sync workflow at `last_dispatch_at + 10 minutes`, when the alarm sends one"
- **The problem:** at `now = last_dispatch_at + SYNC_STALE_MS` the row is "exactly ten minutes old" and "not yet due"; that instant is therefore not "the first instant the strict comparison holds" — the first is one clock unit later. An alarm armed for, and (under the fake clock every scenario uses) firing at, exactly that instant sends nothing; the next send is the ordinary 60-second tick, which is the "up to a minute later" the sentence says it avoids. §13 states the non-strict version. S-BTN-167 tests "one exactly 10 minutes old" as not sent, so the test and the arming rule cannot both pass at the armed instant.
- **Counter-reading considered:** real alarms fire a few ms late, so in production it works. The rule is written to be tested with `setClock`, and it states an equality it then denies.
- **Smallest fix:** arm at `last_dispatch_at + SYNC_STALE_MS + 1` ms, or make the comparison `≤` and keep "never on the tick that wrote it" by the window instead.

### TIME-11: `unauthenticated` from a skewed or revoked runner is not classified by the fence
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-6, R-BTN-13, §11.1 Revocation, §12.8 (progress lines)
- **Confidence:** medium
- **Evidence:**
  - `09-claims.md:74-76` — "A heartbeat refused `session-taken`, `runner-reaped` or `forbidden` marks the lease lost at once. `rate-limited` and `quota` do not"
  - `11-people.md:44` — "**Refused `unauthenticated`:** `created` more than 5 minutes from Baton's clock; … an unknown or revoked key."
  - `11-people.md:24-25` — "Revoking a key sets `revoked_at`; every runner it registered stops at its next call."
  - `12-security.md:918-919` — "`- <UTC time> <leg> <claim nonce>: <text>`, the leg and nonce equal to the claim's and the time within its span"
- **The problem:** `unauthenticated` is in neither list of R-BTN-6. A runner whose clock drifts past 5 minutes, and a runner whose key was revoked, both get it on every call; by omission the sidecar retries until `lease_timeout − 4 min` — up to 23 h 56 min during which a revoked runner's agent keeps working and Baton keeps the ticket (it cannot end the claim either), where "stops at its next call" promises otherwise. Nothing tells a skewed client that its clock is the cause (does a refusal carry `server_time`?). The same two-clock comparison recurs in the progress-line rule: the line's time is the runner's clock written to git, "its span" is Baton's clock, and no tolerance is given, so a skewed runner's legitimate progress becomes "a ticket change" needing approval.
- **Counter-reading considered:** an administrator can force-reap. That is the manual path; the rule text says the runner "stops".
- **Smallest fix:** add `unauthenticated` for a revoked or unknown key to R-BTN-6's lost-at-once list (and say a revocation reaps or fences the key's claims); return `server_time` on a stale-`created` refusal; give the progress line's span a stated tolerance.

### TIME-12: a per-tenant storage cap that lease upkeep is exempt from; nothing says what the alarm does at a full store
- **Severity:** low
- **Kind:** underspecified
- **Rules:** §2.3 Admission, R-BTN-2, R-BTN-149, §9.5
- **Confidence:** medium
- **Evidence:**
  - `02-deployments.md:305-306` — "A deployment serving several tenants adds per-tenant caps: requests …, row writes and storage (`quota` until the day turns or space is freed)."
  - `02-deployments.md:298-300` — "**Lease upkeep** … is never refused by a per-tenant cap, and nothing it carries is dropped but a declaration over budget"
  - `02-deployments.md:106-107` — "Workers Free allows … 100,000 SQLite rows written a day and fails further operations until 00:00 UTC."
  - `09-claims.md:198-200` — "a reap whose end cannot be written is passed over — the tick then fails naming that claim"
- **The problem:** an `end` or `advance` writes history rows, up to 16 outputs of 4 KB, a resume record and events, and is "never refused" by the storage cap, so the cap bounds nothing a runner fleet writes; conversely the platform's hard limit refuses everything, upkeep included, and the spec states the result only for claiming ("stops all claiming"). Unstated: whether the alarm's own writes (reaps, lapses, retention deletes — the only thing that frees space, 1,000 rows a tick) are subject to the per-tenant row-write cap; what a runner sees when its heartbeat fails for storage rather than `quota`; whether "space is freed" can happen at all when the only writer exempt from the cap is the one filling it.
- **Counter-reading considered:** every write is one transaction, so a mid-operation failure leaves no partial state — agreed, and that part is sound; the gap is which operations are admitted at the cap, not atomicity.
- **Smallest fix:** one sentence each: the alarm is exempt from per-tenant write caps; at the platform's hard limit every write fails closed and leases run out by the fence; storage `quota` refuses first heartbeats and board posts but not ends.

### TIME-13: stale and drifted references around R-BTN-90's re-arm and the end's `detail`
- **Severity:** low
- **Kind:** stale-reference / restatement-drift
- **Rules:** R-BTN-90, R-BTN-149, §8.1, §12.3, G-BTN-80
- **Confidence:** high
- **Evidence:**
  - `07-conditions.md:474` — "it re-arms it to now plus 40 minutes, once per leg run (R-BTN-149)"
  - `02-deployments.md:242-266` — R-BTN-149 (hard caps, retention) says nothing about a re-arm or a per-run limit.
  - `07-conditions.md:471` — "`legs_finished: [{claim_id, seq}]`"; `07-conditions.md:475` — "The heartbeat processes `leg_finished`"; `15-verification.md:368` — "re-arms to 40 min on `leg_finished`"; `08-runners.md:42` — "`legs_finished` (R-BTN-90)"
  - `08-runners.md:236` — "end's `detail` (§10.4 free text, at most 200 characters)"; §10 has no subsection 4 and free text is §12.3 (`12-security.md:107`), whose cap for free text is "at most 500 characters" (`12-security.md:112`).
- **The problem:** three dangling pointers on the time-critical path: the "once per leg run" bound cites a rule that does not contain it (so the bound has no home, and nothing says what a second `legs_finished` for the same run does); the wire field has two spellings; "§10.4" does not exist (the same dead reference is in `CLAUDE.md`'s "Text, never markup" rule).
- **Counter-reading considered:** none — each is checkable by grep.
- **Smallest fix:** drop "(R-BTN-149)" and state the once-per-run rule in R-BTN-90 itself; spell the field `legs_finished` everywhere; `§10.4` → `§12.3`.

### TIME-14: a renewing sync under the repository's only credential holds the observation number without bound
- **Severity:** low
- **Kind:** liveness
- **Rules:** R-BTN-62 / R-BTN-150
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:410-413` — "The holder renews it while reading, at most every 2 minutes … Another credential's request voids a number idle over 5 minutes; the same credential's after 10 minutes. Any other credential's request voids a number 30 minutes after issue, renewals included; with no competitor it still posts."
  - `04-tickets-syncs-board.md:416-418` — "a CI identity is one credential whatever run holds it … A number held past 15 minutes raises `baton.observation-held`."
- **The problem:** the age bound (30 minutes) is enforced only by "any other credential's request". Where the CI identity is the only sync credential — the default `repo init` writes — a run that hangs while still renewing (a forge read that retries forever) is never idle, has no competitor of another credential, and every later run of the same identity gets `sync-busy` until the CI job's own timeout. The spec raises a notice at 15 minutes but states no instant at which Baton itself voids the number, and the alarm table (`02-deployments.md:38-51`) has no row for it.
- **Counter-reading considered:** runners sync with machine keys (R-BTN-102) and are "another credential"; true where `inputs.board` admits `machine`, which a protected policy excludes.
- **Smallest fix:** "the alarm voids a number 30 minutes after issue, whoever asks"; add the row to §2.1's table.

### TIME-15: quantities a rule needs and nobody states
- **Severity:** low
- **Kind:** underspecified
- **Rules:** §2.3, R-BTN-26, R-BTN-94, R-BTN-155, R-BTN-63 and others
- **Confidence:** high (each checked by grep; no value and no "the deployment sets it")
- **Evidence:**
  - `02-deployments.md:281` — "A per-IP rule (a Workers rate-limit binding keyed `<host>|<ip>`)" — no rate.
  - `09-claims.md:83-84` — "The sidecar also checks on its own timer." — no period (bounds how long a running tool call outlives a lost lease).
  - `03-repositories-and-forges.md:275-276` — "a dispatch that fails is retried once" — no delay, no timeout on the dispatch call.
  - `11-people.md:533` — "Eviction bursts raise `baton.sign-in-burst`." — no threshold (compare `baton.token-burst`: "more than 10 registrations by one token in 24 h").
  - `03-repositories-and-forges.md:433` — "under one request budget **per host**" — no budget.
  - `08-runners.md:38` — only the heartbeat has a client timeout; claim, `advance`, `end` and the holder queries have none, though the hooks "refuse when Baton cannot be reached" (`09-claims.md:97`).
  - `02-deployments.md:301-302` — the upkeep bucket answers "`rate-limited` with `retry_after_s`" — the back-off a "periodic loop" applies is unstated beyond honouring it.
- **The problem:** each is a number an implementer must pick and a test cannot check.
- **Smallest fix:** state each, or write "the deployment sets it" where that is meant.

### TIME-16: quantities restated outside their home rule (one grouped finding)
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** `docs/context/spec-writing.mdx` (one home per statement, cite by id)
- **Confidence:** high
- **Evidence (home first; every value below agrees today unless marked DRIFT):**

  | Quantity | Home | Restated at |
  |---|---|---|
  | unacknowledged `release` reap: 2 h; `leg-timeout`: 15 min | `09-claims.md:197` (§9.5) / `07-conditions.md:483` (R-BTN-90) | `02-deployments.md:40`, `06-prerequisites-blocks-advice.md:592`, `09-claims.md:176-177`, `13-data-model.md:224` |
  | fence margin `lease_timeout − 4 min` | `09-claims.md:65` (R-BTN-6) | `09-claims.md:80`, `:216`, `:228`; §15 rows 88, 406 |
  | lease clamp 15 min – 24 h, default 900 s | `08-runners.md:31-32` (R-BTN-9) | `13-data-model.md:102`, `91-decisions.md:79` |
  | heartbeat every 2 min | `08-runners.md:38` | `08-runners.md:82`, `91-decisions.md:139` |
  | nonce life 11 min | `11-people.md:46` (R-BTN-13) | `02-deployments.md:48`, `:316`, `13-data-model.md:91` |
  | webhook delivery ids 24 h | `03-repositories-and-forges.md:344` | `02-deployments.md:48`, `13-data-model.md:92-93` |
  | dispatch window 30 s | `03-repositories-and-forges.md:279` (R-BTN-94) | `03:…:284`, `06-…:164`, `13-data-model.md:94`, `:126` |
  | webhook backstop 10 min | `03-…:377` | `13-data-model.md:94`, `:225`, `91-decisions.md:159` — DRIFT in the comparison (TIME-10) |
  | unconfirmed flag 6 h | `09-claims.md:260` | `13-data-model.md:220` |
  | report horizon 6 h | `91-decisions.md:169` names it "a constant" | `06-…:507`, `13-data-model.md:106` — the Decisions line is the only place it is named; no rule defines `report_horizon_h` |
  | fence-pending notice 30 min | `09-claims.md:216` | `13-data-model.md:223` |
  | `baton.sync-late` / head-behind 30 min | `03-…:303`, `04-…:469` | `13-data-model.md:226` |
  | outbox late: 24 h / 15 min | `07-conditions.md:617-618` (R-BTN-171) | `02-deployments.md:51`, `13-data-model.md:227`, `12-security.md:589` |
  | outbox claim ≤ 50, lease 10 min | `07-conditions.md:649-650` | `14-api.md:146` |
  | `max_blocked` 5 in 24 h | none: `07-conditions.md:430-431` cites R-BTN-126, `06-…:199-200` cites R-BTN-122 — each names the other as home | G-BTN-115 |
  | `suspend` wait ≤ 900 s | `07-conditions.md:223` (R-BTN-162) | `07-conditions.md:432` |
  | `deadline_s` 60 s–7 d; `stalled_s` 72 h default, 60 s–30 d; `expires.after_s` 60 s–30 d | `07-conditions.md:442`, `:447`; `06-…:369` | `05-courses.md:132`, `:139`, `:140` |
  | `short_waits` hold 30 min | `09-claims.md:122` (R-BTN-40) | `08-runners.md:240`, `06-…:413` |
  | end `detail` 200 characters | `09-claims.md:147` | `08-runners.md:236` — DRIFT in its citation (TIME-13) |
  | `rationale` ≤ 4 KB, `prefer` ≤ 50 | `06-…:534` (R-BTN-100) | `14-api.md:73`, `13-data-model.md:134` — DRIFT against `01-what-baton-is.md:77-79` (TIME-8) |
  | opaque blobs 16 KB / 256 KB | `12-security.md:152` | `01-what-baton-is.md:77` |
  | session 4 h; pending sign-in 2 min | `11-people.md:534`, `:531` | `12-security.md:175`, `13-data-model.md:88-89`, `11-people.md:651` |
  | MCP key ≤ 90 d, default 30, 7 idle days | `11-people.md:446` (R-BTN-130) | `13-data-model.md:87`, `BATON_MCP_OAUTH_SPEC.md:223`, `:308`, `:535`, `:539` |
  | registration token ≤ 100 uses, ≤ 30 d | `08-runners.md:162` (R-BTN-117) | `13-data-model.md:86` |
  | retention 90 d | `02-deployments.md:258-260` (R-BTN-149) | `04-…:734`, `13-data-model.md:36`, `:227` |
  | stop: interrupt, 10 s, 25 s, gone in 30 s | `08-runners.md:697-699` | `08-runners.md:687`, `:381`, `:480` |
  | unblocked message ≤ 20 tickets; trigger ≤ 100 entries | `06-…:159`, `:164` | `03-…:284`, `13-data-model.md:126` |

- **The problem:** 27 quantities are stated in two to six places each; three have already drifted (marked) and one (`max_blocked`) has no home because its two statements cite each other. The most-restated values (the 2 h / 15 min reap, the 4-minute margin) are the ones a single edit would most likely split.
- **Smallest fix:** keep the value in the home rule; elsewhere write the rule id only (§13's alarm list and §2.1's table can name the column and the rule without the number).

---

## Read but found sound

- **Lease vs. reap arithmetic on steady clocks** — heartbeat 2 min / 30 s timeout, clamp ≥ 15 min, fence at `timeout − 4 min`, reap at `timeout`: the runner fences ≥ 3.5 min before Baton can reap; server-side `last_seen_at` (any call) is never older than the sidecar's `last_ok` (accepted heartbeats only).
- **Lowering/raising `lease_timeout_s` with a lost response** (R-BTN-9's "lowest of the value in force … and every value declared since") — tried both directions and the fence-deadline case; could not get Baton to reap on a shorter lease than the fence's.
- **Nonce window** — `created` ± 5 min against an 11-minute cache keyed by Baton's `seen_at`: no replay window; a late prune only errs safe.
- **Messages** — delivered-in-the-response-transaction, re-sent until acknowledged, acted on once by `id`: at-least-once delivery with a stated dedupe key.
- **Dispatch after commit** — at-most-once call, but the want stands, the stamp is written before the send, and three independent triggers answer a standing want; `baton.sync-late` bounds silence.
- **`withdraw` delivery** — read-before-write on `baton_write: <id>`, 3 push retries, then `transient` backoff (1, 5, 30 min, hourly) with a 24-hour notice: at-least-once with an effective dedupe.
- **Ordering never by timestamp** — snapshots by observation number and ancestry, events by `seq`, outbox by `id`, recommendations with a final ticket-id tie-break; run ids are compared for equality only; activity times are explicitly outside lease logic.
- **Runner-supplied times in decisions** — a reading's `until` is clamped by `valid_for` (≤ 1 h from a runner); `not_before` from git is validated against Baton's clock (≤ 400 days) and fails closed.
- **Alarm loss** — re-armed by any request when unset or two periods overdue; a failing reap is isolated and retried next tick.
- **Lifetimes across the two specs** — session, pending sign-in, MCP key, registration token, API-key runner: all restatements agree.
- **A forge outage during a sync** — a partial reading is never posted, the number is released, the want stands.

## Not covered

- §5 (courses), §12.8–12.9 (policy, scope) and §16 (adoption) were grepped for quantities and clocks only, not read whole; R-BTN-88 (freeze/seal/export) not examined for time or failure behaviour.
- §15 was checked row-by-row only where a row carries a number; I did not verify that every quantity has a scenario.
- `BATON_MCP_OAUTH_SPEC.md` — lifetimes compared with §11 only; its own refresh-rotation timing (60 s siblings, 30 s) not attacked.
- `BATON_SPEC_HISTORY.md` not consulted; retired-id checks left to the section reviewers.
- The doorbell's per-second ring coalescing against the 30-a-minute upkeep bucket, and the R-BTN-196 memo's 10-minute bound against clock-only changes, were looked at briefly and not pursued.
- Whether any course graph permits a leg whose outcome equals its `from` station (the worse branch of TIME-1) was not established.
