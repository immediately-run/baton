---
title: "Adversarial review 2026-11-18 — §8–§10: runners, claims and checks"
description: "One reviewer's findings, as filed, on BATON_SPEC §8, §9 and §10, read as a lease and fencing protocol."
order: 14
tags: [review]
---

# Adversarial review 2026-11-18 — §8–§10: runners, claims and checks

Read whole: `08-runners.md`, `09-claims.md`, `10-checks.md`; `docs/context/architecture.mdx`, `vocabulary.mdx`.
Followed into their homes: R-BTN-13, R-BTN-159 (§11.1), R-BTN-58 (§11.2), R-BTN-32, R-BTN-135, R-BTN-149 and the
alarm table (§2), R-BTN-35, R-BTN-39, R-BTN-8 (§1), R-BTN-63, R-BTN-83, R-BTN-71 (§5), R-BTN-122, R-BTN-167,
R-BTN-90, R-BTN-168, R-BTN-171 (§7), the board schema and the sync's observation read (§4.3/§4.4), the sync's
attestation table (§12.8), `runners`/`claims`/`claim_legs`/`registration_tokens` (§13), the runner routes and the
error table (§14), the lease/fence/check scenarios and gates (§15). All paths below are under `spec/BATON_SPEC/`.

Protocol as written (the model the attacks ran against): the lease is per **runner**
(`last_seen_at` + `lease_timeout_ms`, 08:28, 09:194-195); the fencing token is the runner secret + `incarnation`
(08:58-66) plus, per claim, `fence_pending`/`fence_incarnation`/`fence_deadline` (09:205-218); the client fence is
`now − last_ok ≥ lease_timeout − 4 min` on the wall clock (09:64-65, 09:77-80). Git is never fenced by Baton; the
only repair is the next claimant's re-read (09:231, 09:237-238).

---

### RUN-1: `advance` is the one non-idempotent runner write, and a retried advance either abandons the claim or records a run and an arrival that never happened
- **Severity:** high
- **Kind:** safety
- **Rules:** R-BTN-63, R-BTN-72 (Reactions), R-BTN-135, §2 (the object), §14 `POST /v1/runner/claims/{id}/advance`
- **Confidence:** high
- **Evidence:**
  - `02-deployments.md:28-30` — "A claim's repeated `request_id` returns the first request's committed result (G-BTN-2); `claims.request_id` is the only stored request id. Every other write is safe to retry by its own key: a repeated end is `ok` (§9.4), owner and administrator writes set a value, a repeated board post is `stale-observation` …, and a repeated raise or report finds its row."
  - `05-courses.md:251-253` — "`advance {reached, leg}` finishes the running leg, if any, at `reached` — one of its outcomes, else refused `off-graph` — records the position, then starts `leg` if it leaves `reached`"
  - `09-claims.md:52-54` — "Baton checks the edge and the gates in one transaction and moves the claim on (event `advanced`, a new `claim_legs` row with its run number, `run_id` (R-BTN-63), `started_at` and `head_sha`) or refuses."
  - `08-runners.md:245-247` — "an `off-graph` refusal or heartbeat `station: unknown` (R-BTN-64) finishes or abandons the leg and ends `released:course-changed`"
  - `05-courses.md:292` — "A loop is a leg taken again"; `05-courses.md:689` — "`prevent` (`ticketed`, `folded`, `prevented` → `prevented`, `max_runs` 3)"
  - `14-api.md:74` — the advance body: `{reached?, leg, run_label?, …}` — no request id, no expected run number.
- **The problem:** the advance commits, its response is lost (30 s timeout, a deploy, a Durable Object restart after commit), and the runner retries the same body, as §2 tells every client it may.
  - *Ordinary edge* (`advance {reached: pr-open, leg: review}` after `implement`): on the retry the claim is already running `review`; `pr-open` is not an outcome of `review`; Baton answers `off-graph`; the runner's stated reaction is to abandon the leg and end `released:course-changed`. A single lost response throws the claim away and burns one of `review`'s `max_runs`. The same happens to the very first advance of every claim.
  - *Self-loop leg* (`prevent`, `from` and `to` both containing `prevented`): the retry `advance {reached: prevented, leg: prevent}` finds `prevent` running, `prevented` **is** one of its outcomes, so Baton finishes run 1 at `prevented` — a signed `std:arrival@1` for work that did not happen (05:217-221 "Baton records it as the ticket's position in the transaction that accepts the request") — and starts run 2. Two lost responses exhaust `max_runs` 3 with one real run. R-BTN-63's promise of "no replay and deterministic counts" (01:108-109) fails on Baton's own retry.
- **Counter-reading considered:** "the retry is re-signed and keeps its `request_id` where the route takes one" (02:307-308) — but the advance route takes none (14:74), and 02:29 says `claims.request_id` "is the only stored request id". The runner could instead read its heartbeat (claim's `leg`) before retrying; no rule tells it to, and R-BTN-72's reaction to `off-graph` is stated without that exception. Searched `idempoten`, `request_id`, "repeated" across all sections: only the claim, the end, the outbox mark, the first heartbeat and attestations are covered.
- **Smallest fix:** give `advance` an idempotency key (the run number it expects to start, or a `request_id` stored on `claim_legs`), answered with the first reply; add it to 02:28-32's list and a scenario "advance response lost, retried" (ordinary edge and self-loop).

### RUN-2: the owner's `max_claims` ceiling is per runner row, and one key makes 64 rows — "a compromised runner holds no more tickets than an owner allowed" is false by a factor of 64
- **Severity:** high
- **Kind:** security
- **Rules:** R-BTN-4, R-BTN-3, R-BTN-149, R-BTN-9
- **Confidence:** high
- **Evidence:**
  - `09-claims.md:15-16` — "A runner holds at most the lower of two numbers at once, counting its active claims across every repository"
  - `09-claims.md:19-23` — "the claiming repository's grant's **`max_claims`**, the owner's ceiling … 1 to 32, default 1 … A compromised runner holds no more tickets than an owner allowed."
  - `08-runners.md:18-19,22` — "A runner is created by its first authenticated heartbeat and never deleted." … "Several sessions on one host are several runners"
  - `02-deployments.md:249` — "live runner rows per credential | 64 | the 65th first heartbeat `quota`"
  - `08-runners.md:31-33` — "`lease_timeout_s` on each heartbeat, clamped to [900, 86400] … the ceiling bounds how long a dead runner blocks a ticket."
- **The problem:** the count R-BTN-4 bounds is keyed by runner (`(hostname, session_name)`), the thing a credential mints at will. Trace: owner grants key K `--max-claims 1`. K's holder (or a `builtin` leg, which "can read the runner's state file and use its ssh-agent", 08:402-403) heartbeats under 64 fresh `session_name`s, each with `lease_timeout_s: 86400`, and claims once per row: 64 tickets held under a grant whose ceiling is 1 (up to 64 × 32 where the owner set 32), each held 24 h after the processes stop. No rule counts active claims per credential or per grant; the owner cannot cap `lease_timeout_s`.
- **Counter-reading considered:** "runner" in the sentence means one runner row, and Baton "does not police the work" (architecture.mdx). But the ceiling is introduced as "the owner's ceiling, set with the grant", a grant is on a key (13:83 `runner_grants (credential_id, repository_id)`), and the sentence is offered as the compromise bound. Searched `max_claims`, `max-claims`, "per credential", "live runner rows": the only per-credential bound is the 64-row cap.
- **Smallest fix:** count R-BTN-4's `max_claims` over the credential's active claims on the repository (rule `max-claims` in the same transaction), or delete the compromise sentence and state the real bound (64 × `max_claims`); let the grant cap `lease_timeout_s`.

### RUN-3: R-BTN-9's "the fence is never longer than the lease" holds only for a lost response — a reordered heartbeat, or an omitted `lease_timeout_s`, leaves Baton reaping on 900 s while the sidecar fences on 24 h
- **Severity:** medium
- **Kind:** safety
- **Rules:** R-BTN-9, R-BTN-6, R-BTN-26, R-BTN-13, R-BTN-19 (a silence reap is not fence-pending)
- **Confidence:** medium
- **Evidence:**
  - `08-runners.md:31-36` — "`lease_timeout_s` on each heartbeat, clamped to [900, 86400], default 900. … The sidecar fences (R-BTN-6, R-BTN-26) on the lowest of the value in force at `last_ok` and every value it has declared since, so a heartbeat that lowers the timeout and loses its response never leaves Baton reaping on a shorter lease than the fence's."
  - `11-people.md:44-46` — "`created` more than 5 minutes from Baton's clock; … a nonce already seen for that key within 11 minutes" (the only ordering check on a signed request; an API-key runner has none)
  - `14-api.md:72` — `lease_timeout_s?` (optional); `09-claims.md:233-234` — "A silence reap is not fence-pending — every check of that runner already computes the lease as lost"
- **The problem:** two traces in which Baton's lease is shorter than the fence, and the reap that follows re-issues the ticket at once (not fence-pending) while the old runner's hooks still say "held":
  1. *Reorder.* Heartbeat H1 declares 900 and times out at 30 s. H2 declares 86400 (the laptop is about to sleep) and is accepted: `last_ok` = H2, "the value in force at `last_ok`" = 86400, "every value it has declared since" = none. H1, still valid for 5 minutes, arrives after H2: Baton sets `lease_timeout_ms` = 900 s. The laptop sleeps an hour; Baton reaps at 15 minutes and a second runner claims; the first wakes, its hooks compute `now − last_ok < 86400 − 240` and allow the push. Heartbeats carry no sequence number.
  2. *Omission.* "on each heartbeat … default 900" with an optional field: a sidecar that declares 86400 once and then omits the field either keeps 86400 (reading A) or falls to the default on the next beat (reading B). Under B the sidecar's rule ("every value it has declared since") never sees 900. The spec does not say which.
- **Counter-reading considered:** the response carries `lease_timeout_s` (14:72), so the sidecar learns the value in force at each `last_ok` — true for trace 2 if the sidecar reads it, which the rule's wording ("the value in force at `last_ok`") permits; it does not help trace 1, where the lowering lands after the last response. Searched for a heartbeat sequence or "monotonic" rule: none (`server_time` is returned but no rule in §8–§9 reads it).
- **Smallest fix:** Baton ignores a heartbeat whose `created` is older than the newest one it accepted for that runner; state that an absent `lease_timeout_s` leaves the stored value unchanged; add the reorder to S-BTN-114 or G-BTN-4.

### RUN-4: two statements of what renews the lease — "the lease stays on the heartbeat" and "every runner call updates `last_seen_at`" — and the second lets a session with a dead sidecar hold its claim forever
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-3 (Alive), the heartbeat (unnumbered), R-BTN-91, R-BTN-6, the pre-push layer (§9.2), §9.5 Reaping
- **Confidence:** medium
- **Evidence:**
  - `08-runners.md:56` — "Every runner call updates `last_seen_at` and the runner's `client_version` (R-BTN-197)."
  - `08-runners.md:82` — "Delivery, acknowledgement, the lease and the fence stay on the heartbeat"
  - `09-claims.md:194-195` — "The alarm reaps every active claim whose runner has `now − last_seen_at ≥ lease_timeout_ms`"
  - `09-claims.md:93-97` — "For every push to a ticket's branch, whatever the local lease says, it also asks `GET /v1/runner/branch-holder?…` (the machine key, with `session_name` and the runner secret when the state file has them) and refuses when … Baton cannot be reached."
  - `09-claims.md:64` — "The sidecar records `last_ok`, the time of its last accepted heartbeat."
- **The problem:** the client's lease runs from the last accepted *heartbeat*; the server's from the last *call of any kind* by the runner, including the holder queries hooks make with the runner secret, activity posts and recommendations. Trace: an interactive session's sidecar dies (it "exits when [the harness pid] is gone" is its only stated exit; a crash is not covered). The harness lives on; its agent loops, each `git push` running the pre-push hook, which computes the lease lost locally and refuses — and "whatever the local lease says" also calls `branch-holder` with `session_name` and the secret, which is a runner call and renews `last_seen_at`. A push attempt at least every 15 minutes keeps the claim `active` indefinitely: nothing heartbeats, nothing ends the claim (only the sidecar does, 09:67-68), the alarm never sees silence, and the ticket is held by a session that its own hooks forbid to write. The direction is safe (server lease ≥ client lease) but the ticket is orphaned until an administrator force-reaps.
- **Counter-reading considered:** "runner call" might mean only `/v1/runner/heartbeat|claim|advance|end`. The holder routes are under `/v1/runner/` with caller "machine" (14:85-86), the same caller class as the heartbeat, and 08:56 says "every". Searched `last_seen_at`: no narrower definition.
- **Smallest fix:** `last_seen_at` (the lease) moves only on an accepted heartbeat, `advance` and `end` (R-BTN-135's "lease upkeep" set, 02:298-299); other calls update a separate `last_call_at`.

### RUN-5: R-BTN-19's reason the fence deadline is safe is false for the cases it lists, and R-BTN-26's formula is per runner while reaps and fences are per claim
- **Severity:** medium
- **Kind:** safety
- **Rules:** R-BTN-19, R-BTN-26, R-BTN-6, R-BTN-4, the sidecar's state file (§8.1)
- **Confidence:** medium
- **Evidence:**
  - `09-claims.md:208-209` — "Such a reap sets no `reaped_at`: the runner's next heartbeat is answered without the claim, so it can report the fence."
  - `09-claims.md:213-216` — "or until `fence_deadline` passes, whatever the runner does meanwhile (a re-key, a new incarnation's heartbeats, a sidecar that heartbeats but cannot terminate a process); the alarm then clears it … Every check of the old incarnation has computed its lease as lost by then (`last_ok + lease_timeout − 4 min`, R-BTN-26)."
  - `09-claims.md:77-80` — "Each harness hook, each status-writing tool and the `pre-push` hook computes, from the state file and the **wall clock** …, `now − last_ok ≥ lease_timeout − 4 min`, and treats the lease as lost when that holds or when the flag is set."
  - `08-runners.md:102-104` — "active claims with their nonces, run ids and executor handles, `last_ok`, lease-lost flag"
  - `09-claims.md:28-31` — "Each claim keeps its own nonce, legs, stop (R-BTN-119), end, reap and fence … the lease that keeps them all is the runner's (R-BTN-9)."
- **The problem:** a claim reaped while its runner is alive leaves the runner alive: its heartbeats are answered, so `last_ok` keeps moving and `last_ok + lease_timeout − 4 min` never arrives. In exactly the listed case — "a sidecar that heartbeats but cannot terminate a process" — the invariant the deadline rests on does not hold: at `fence_deadline` the ticket is re-issued while the old process's checks, computed as R-BTN-26 says, still read "lease held". What actually stops it is the claim's absence from the response (09:66-67) and the server-side holder queries, neither of which R-BTN-26 names: its test is time or one flag, per state file. With several claims per runner (R-BTN-4, up to 32) the gap is concrete: an administrator force-reaps claim A of a runner holding A and B. Either the sidecar sets the single lease-lost flag (and B's hooks refuse every write of a lease that is fine), or it does not (and A's hooks, by R-BTN-26's formula, allow A's writes). R-BTN-26 has no per-claim term; the pre-push layer says "a session whose lease *on that ticket* is lost" (09:92-93) without defining it.
- **Counter-reading considered:** R-BTN-6's "a heartbeat response that no longer lists the claim means the session no longer holds the ticket" supplies the per-claim test, and the sidecar presumably drops the claim from the state file. Then hooks must also read "is this ticket's claim in the state file", which R-BTN-26 — titled "every fence check computes the lease itself" — does not say, and S-BTN-229 ("an administrator force-reaping one of two claims", 15:121) can only test a behaviour the rule does not define. Layer 2 (the pre-tool hook) makes no server query, so it has only R-BTN-26.
- **Smallest fix:** R-BTN-26: "lost for a ticket when the time test holds, the flag is set, **or the state file names no active claim on that ticket**"; make the flag per claim; replace 09:215-216's sentence with the true reason (the claim is gone from the state file and the holder queries answer `held_by_other`/`fence_pending`).

### RUN-6: nothing says what a revoked or expired key, or a revoked or declined grant, does to the claims it holds — the ticket stays held for the lease the revoked runner chose, and a force-reap then waits on a report the revoked runner cannot make
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-13 (Revocation), R-BTN-58, R-BTN-146 (decline), R-BTN-117 (credential expiry), R-BTN-6, R-BTN-19, R-BTN-9
- **Confidence:** high (that it is unstated); medium (severity)
- **Evidence:**
  - `11-people.md:24-25` — "Revoking a key sets `revoked_at`; every runner it registered stops at its next call."
  - `09-claims.md:74-75` — "A heartbeat refused `session-taken`, `runner-reaped` or `forbidden` marks the lease lost at once."
  - `08-runners.md:90-91` — "Baton closes the socket when the runner is reaped, re-keys, stops being alive, or its key is revoked"
  - `08-runners.md:144-145` — "`baton runner decline-grant <repository>` … revokes a pending grant or returns an active one to pending"
  - `08-runners.md:172-174` — "A token-registered credential lasts until the token's `grant_ttl` … or 7 days without an authenticated call, whichever is first; revoking the token revokes every credential it registered."
  - `09-claims.md:205-212` — "A claim reaped while its runner was **alive** … is `fence_pending` … The ticket is not claimable until that incarnation's sidecar, with its pre-reap secret, heartbeats, is told it no longer holds the claim, and reports it in `fenced`"
- **The problem:** revocation is the response to a stolen runner credential, and its effect on live claims is not written. As the rules stand: the revoked runner's calls are refused, so its claims are neither ended nor renewed; they stay `active` until the silence reap at `last_seen_at + lease_timeout_ms` — up to 24 h, a number the (stolen) runner declared itself (RUN-2). An administrator who force-reaps sooner reaps a runner that is still "alive" by 08:28, so the claim is `fence_pending`; the only early exits are a `fenced` report over a heartbeat the revoked key can no longer authenticate, or a second administrator act (the fence clear). A repository owner — who can revoke the grant — can do neither (reap and fence clear are "an administrator's only", 11:552-554). For a revoked *grant* (key still valid) or a declined one, the runner keeps heartbeating and its running leg keeps its claim; only the next `advance` meets rule 7. For a token credential that expires mid-claim (default 7 days) the same holds with no human in the loop.
- **Counter-reading considered:** retirement does specify it (S-BTN-198: "an active claim held by a live runner the token registered … the claim's `fence_deadline` passing with no report", 15:272; "a force-reap (a retirement's included, R-BTN-47)", 09:206), which shows the authors treat it as needing a rule — and there is none for plain revocation. Searched lines containing `revok` with `claim`, `reap` or `lease` in every section: only retirement.
- **Smallest fix:** one bullet in R-BTN-13/R-BTN-58: revoking a key, a grant, a check-runner or a token (and a credential's expiry) reaps the credential's active claims on the affected repositories in the same transaction, `fence_pending` with the deadline, actor the revoker; say whether a decline does.

### RUN-7: a check ticket's "restart on a new head" is a move no rule owns — R-BTN-39's closed list has no such mover, and R-BTN-168's supersession, which R-BTN-114 cites, cancels the ticket instead
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-114, R-BTN-168, R-BTN-39, R-BTN-63, R-BTN-122
- **Confidence:** medium
- **Evidence:**
  - `10-checks.md:23-27` — "A post that changes `check.sha` supersedes every claim on the ticket (released `superseded`, R-BTN-168), and the ticket restarts at its start station on the new head; a completed claim on the old sha still unconfirmed is marked `superseded_at` … A change the source stops posting is superseded (R-BTN-168)."
  - `01-what-baton-is.md:103-104` — "Git never writes them: no ticket file, marker, PR or snapshot places a ticket."; `01:118-119` — "**Who moves a ticket.** Only these, each an edge of the course file from Baton's current station:" (the holder's arrival, Baton's settlements, the owner's route and adopt — no restart)
  - `07-conditions.md:563-569` — "A ticket is cancelled when its file says withdrawn (R-BTN-74) or when Baton **supersedes** it because: … its source stopped posting a ticket that has no file (the `changes` source, R-BTN-114)." (a changed `check.sha` is not a cause)
  - `07-conditions.md:578-582` — "marks the ticket **`cancelling`** … the flag refuses every leg but the ticket's queued `cancel` leg"; `07:592` — "a ticket withdrawn in git already, or one with no file, closes `withdrawn` at once."
- **The problem:** two readings of "supersedes … (R-BTN-168)" on a new head. (a) R-BTN-168's supersession as written: the ticket becomes `cancelling`, has no file, and closes `withdrawn` at once — the pushed head's check ticket is closed, not restarted, and whether the same id posted again by the same snapshot re-opens it is R-BTN-12's returning-id rule, not stated here. (b) R-BTN-114 borrows only the `released:superseded` end and the `superseded_at` mark and then moves the ticket from an end station back to `start` — a snapshot-driven move that is not "an edge of the course file" and not in R-BTN-39's "Only these". Under (b) the counters are unspecified: do the verdict leg's runs toward `max_runs` (R-BTN-63 "restarts the count" only for a person's answer, a route or an adopt), its `leg_attempts`, and an `attempts-exhausted` hold from head A carry to head B? If they carry, three timeouts on A leave B's check held and the change pending until an owner lifts a hold; if they reset, any pusher resets the retry policy by pushing.
- **Counter-reading considered:** "restart" is obviously intended and a returning id may cover it. Then R-BTN-39's list and R-BTN-168's causes each need the entry; neither has it, and S-BTN-68 ("the ticket restarts on each new head") tests a behaviour whose counters no rule defines. Searched `restart` in §1, §5, §10 and `supersed` in §1, §4, §7.
- **Smallest fix:** add "a check ticket's new head (R-BTN-114)" to R-BTN-39's movers with its history row and `runs_from`/attempt reset stated; in R-BTN-114 say the restart is not R-BTN-168's cancellation (only its claim release and `superseded_at`).

### RUN-8: a check concludes only when "a post shows the ticket at that same `reached`" — a thing no post can show (R-BTN-39), from a leg that holds no credential to write evidence
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-153, R-BTN-10, R-BTN-39, R-BTN-83, R-BTN-114 (withheld credentials), R-BTN-8
- **Confidence:** medium
- **Evidence:**
  - `10-checks.md:82-88` — "Baton queues a concluding `forge-check` entry (R-BTN-115) only for an ordinary claim, held by a check-runner, that ended `done` at a `reached` the owners' `conclusions` map, confirmed (R-BTN-10) by a post showing the ticket at that same `reached` with `check.sha` equal to `claims.check_sha`, the station's entry requirements met and its pointers valid (R-BTN-109). The conclusion is the owners' mapping of the end's own `reached`, never of a posted station."
  - `09-claims.md:251-252` — "for `done`, shows the ticket closed as done (`closed_tickets`) or absent, whatever it named; a check ticket's `done` only at the end's own `reached` and bound `check_sha` (R-BTN-153)"
  - `01-what-baton-is.md:103-104` — "no ticket file, marker, PR or snapshot places a ticket"; `05-courses.md:220-221` — "No snapshot confirms or replaces it (R-BTN-39); a closing marker's position is evidence for people, never read as one."
  - `10-checks.md:40-41` — "A check leg's session holds no write-capable credential or secret"; `08-runners.md:249-250` — "The leg's `close` writes the closing marker and the leg leaves its own evidence (R-BTN-8)."; `04-tickets-syncs-board.md:680` — "a ticket with no file — a `changes` check ticket"
- **The problem:** the board schema has no station per ticket (04:531-543); the only stations a post carries are `std:git.readiness@1`'s `at` — Baton's own position handed to the sync and echoed back — and `std:git.implied@1`. A check ticket has no file and its leg cannot write a marker, comment or commit, so nothing in git or the forge implies a station. Three readings: (1) the echo counts — the "post showing the ticket at `reached`" is vacuous and the confirmation is only "a later accepted snapshot whose `check.sha` is unchanged"; (2) `std:git.implied@1` is meant — never present, every check ends `baton.check-unattested` and every change stays pending (10:89-90, "the gate fails closed" forever); (3) the `close` must write evidence — contradicting "no write-capable credential". G-BTN-143 ("A concluding check comes only from a confirmed check-runner end for its bound sha") cannot tell (1) from (2). The phrase "never of a posted station" shows the sentence predates R-BTN-39.
- **Counter-reading considered:** reading (1) is the charitable one and safe (the sha binding is the real check). But then "the station's entry requirements met and its pointers valid", judged "by a post", has no posted subject either, and an implementer following the words literally builds (2). Searched `check` across §1–§7 and §12–§15 for how a check ticket's station reaches a post: only 04:680 (re-verified "against Baton's record … never against git").
- **Smallest fix:** rewrite 10:84-86 and 09:252: "confirmed by the first snapshot observed after the end that still posts the ticket with `check.sha` equal to `claims.check_sha`"; say where a check leg's `close` writes (nowhere) and that such an end names no `ended_at_sha`.

### RUN-9: an end unconfirmed for 6 hours "is never confirmed automatically" — a sync outage longer than that turns every pending completion into a per-ticket administrator task
- **Severity:** medium
- **Kind:** liveness
- **Rules:** §9.6 "Claimable again" (unnumbered), R-BTN-10, R-BTN-155
- **Confidence:** medium
- **Evidence:**
  - `09-claims.md:257-263` — "A ticket is claimable only after a snapshot observed after its last claim ended (`end_observation`), and never while a completion is unconfirmed … A completion unconfirmed 6 hours after `ended_at` (its named evidence attested `found: false` or never attested) raises `baton.unconfirmed` and is never confirmed automatically; an administrator confirms or releases it from the dashboard (R-BTN-155)."
  - `09-claims.md:246,250` — "It is confirmed by the first accepted snapshot whose observation began after the end and that: … for an end that named none, is accepted at all"
  - `11-people.md:556-558` — "confirm or release an unconfirmed completion (`POST /v1/ui/claims/{id}/confirm`, `…/release`); confirm an adoption … — an administrator's only."; `14-api.md:178` — caller "admin session"
- **The problem:** "never attested" is what a stopped sync produces. Trace: the sync workflow is down for 7 hours (a forge outage, an expired sync key, a disabled workflow). Every suspension and `done` recorded in the first hour passes 6 h. Two readings of "is never confirmed automatically": (A) from the flag on, a later snapshot carrying `found: true` (or, for an end naming no evidence, any accepted snapshot) no longer confirms — every such ticket is unclaimable until a tenant administrator (not the repository's owner) confirms each one by hand, two-step confirmed; (B) the flag only notifies and the next qualifying snapshot still confirms — then the sentence is wrong. R-BTN-10's own text ("confirmed by the first accepted snapshot whose observation began after the end") has no 6-hour limit, so the two rules disagree under (A). S-BTN-18 ("flagged unconfirmed at 6 h") does not test a late snapshot.
- **Counter-reading considered:** the clause may mean only "Baton will not confirm without evidence". That is already R-BTN-10; the added "never … automatically; an administrator confirms or releases" reads as a state change at 6 h. For an end that named no `ended_at_sha` the 6-hour state has no evidence question at all, only the absence of a sync.
- **Smallest fix:** "the flag changes nothing about confirmation: the first qualifying snapshot still confirms and closes `baton.unconfirmed`; an administrator *or an owner* may confirm or release meanwhile"; add the late-snapshot case to S-BTN-18.

### RUN-10: `ended_at_sha` may be "the URL of the comment or review" — a runner-supplied URL with no validation rule, handed to the credentialed sync to look up
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-8, R-BTN-10, §9.4, §4.3 (the observation's `unconfirmed` list), R-BTN-113 (the contrast)
- **Confidence:** medium
- **Evidence:**
  - `01-what-baton-is.md:185-187` — "may pass `ended_at_sha` (a commit sha, or the URL of the comment or review that ended the leg), the evidence confirmation looks for (R-BTN-10)"
  - `04-tickets-syncs-board.md:362-363` — "`unconfirmed`, every unconfirmed end's `{ticket, claim, evidence?}` with the `ended_at_sha` it named (R-BTN-10)"
  - `12-security.md:740` — "`std:git.evidence@1` | `{claim, sha? , url?, found}`: whether git or the forge shows the evidence an unconfirmed end named"
  - `08-runners.md:492-494` — (what a validated URL looks like) "It must be `https`, at most 512 characters, without userinfo, with its host in the instance's `session_hosts` …, else it is dropped and logged."
- **The problem:** every other runner-supplied locator in the span has a shape rule (`session_url`, 08:492-494; transcript `repo`/`path`, 09:368-371; `executor_digest`, 08:464). The end's evidence URL has none: no scheme, length, host or forge-base constraint in §9.4, §14:75 or §12. Baton stores it (`claims.ended_at_sha`) and serves it to the sync, which holds the forge read credential and must decide "whether git or the forge shows" it. How it decides is unstated: an implementation that fetches the URL sends a credentialed request wherever a runner pointed it; one that parses it must invent the grammar. It is also shown to people (the Unconfirmed tab) with no link rule cited.
- **Counter-reading considered:** the sync may only string-match the URL against comments it already read. Nothing says so, and nothing bounds the field. Searched `ended_at_sha`, `git.evidence`, "evidence url": the four quotes above are all there is.
- **Smallest fix:** in §9.4: `ended_at_sha` is 40/64 hex, or an `https` URL ≤ 512 chars under the web base of a repository the ticket reaches (R-BTN-92's link rule), else `invalid-params`; in §4.3: the sync resolves it only through its forge API reads, never by fetching it.

### RUN-11: whether a lost lease is a failed attempt depends on who wins a 4-minute race, and a runner chooses its own non-failing end without bound
- **Severity:** low
- **Kind:** underspecified
- **Rules:** §9.4 end table, §9.7, R-BTN-122, R-BTN-6, the heartbeat response (§8.1), R-BTN-40
- **Confidence:** medium
- **Evidence:**
  - `09-claims.md:163` — "`released:lease-lost` | `released` | the holder's lease lapsed (R-BTN-6) | yes, once per distinct runner per ticket and leg"
  - `09-claims.md:174` — "reaped, actor `alarm` | `reaped` | the runner was silent past its lease timeout (§9.5) | yes"
  - `08-runners.md:52-53` — "A claim the runner's state does not hold is ended by the runner `released:lease-lost`, loudly, never left to idle (R-BTN-6)"
  - `09-claims.md:124-125` — "A suspension is a completed end, never a failed attempt."
- **The problem:** (1) the same event — a runner out of contact for its lease — counts once per runner if the sidecar reconnects inside the 4-minute margin and ends the claim itself, and every time if the alarm gets there first; a host with a flapping link never exhausts `max_attempts`, a host that crashes does. (2) The "state does not hold" path is also the *lost claim response after a restart* path: Baton handed out a claim the runner never learned of, and the ticket is charged a failed attempt and a `backoff_s` (default 3600 s) for it. (3) Every non-failing end is the runner's own choice, and a claim that ends `suspended:<station>` before any `advance` records no run (`max_runs` unaffected) and no attempt: a runner that cannot work a ticket (a broken checkout, a script bug before the first advance) re-claims the same first-in-order ticket after every snapshot, with no backoff and no condition raised. Searched `churn`, `flap`, "advice-overridden" for a bound: none.
- **Counter-reading considered:** "once per distinct runner" is deliberate (one bad host must not exhaust a ticket), and the alarm row may intend the same; then the table, "the one list", should say so on both rows.
- **Smallest fix:** make the `alarm` row read as the `lease-lost` row; give the unknown-claim end its own non-failing reason; count consecutive run-less ends per ticket and raise a core condition at a bound.

### RUN-12: `floor` releases stop "at once" in §9.4 and "at the next safe point" in R-BTN-119; the kill ladder has three sets of numbers
- **Severity:** low
- **Kind:** contradiction
- **Rules:** §9.4 (A release), R-BTN-119, R-BTN-189, R-BTN-72 (B-109), R-BTN-145
- **Confidence:** high
- **Evidence:**
  - `09-claims.md:186-188` — "stops at its next safe point — at once for `requested`, `owner-cancel`, `superseded` and `floor` (R-BTN-119, R-BTN-189)"
  - `08-runners.md:696,703-704` — "For these three the runner stops the leg … at once" (`requested`, `owner-cancel`, `superseded`) … "Other release reasons (`leg-timeout`, an owner bar's reason) stop at the next safe point (§9.4)."
  - `12-security.md:473-474` — "sends every running claim on such a ticket a `release` with reason `floor`, which ends it `released:floor`" (no "at once")
  - `08-runners.md:697-699` — "interrupt, terminate after 10 s, kill after 25 s"; `08:291-293` — "A leg that will not take it has its call killed after ten seconds (the lease-loss mechanism) and its session stopped (R-BTN-107), waited on for at most ten more" (also a `released:requested` end); `08:686-687` — "every process it started is gone within 30 s"
- **The problem:** a runner implementing R-BTN-119 treats `floor` as an "other" reason and lets a leg run on, on a repository whose guarantee is broken — the one release whose point is to stop work now. And a `released:requested` stop is 25 s by R-BTN-119 and 10 s + 10 s by B-109's paragraph, for the same reason string.
- **Counter-reading considered:** §9.4 is later text and wins; then R-BTN-119, the rule both cite, is the stale one.
- **Smallest fix:** R-BTN-119: "For these four" with `floor`; have B-109's paragraph cite R-BTN-119's ladder instead of restating numbers.

### RUN-13: §8.1's heartbeat field list, the ring's "heartbeats at once", and two refusal codes disagree with §2 and §14
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** the heartbeat (unnumbered, §8.1), R-BTN-91, R-BTN-135, §14 route row and error table, R-BTN-117
- **Confidence:** high
- **Evidence:**
  - `08-runners.md:43` — "spooled activities and transcript paths (§9.9)" in the heartbeat body; `14-api.md:72` — body has `transcripts?[]`, `reports?`, `last_activity_at?`, `hostname` and no activities (they go to `POST /v1/runner/activities`, 14:78, whose per-item `refused: [{id, code}]` differs from a heartbeat's all-or-nothing validation).
  - `08-runners.md:54-55` — response carries "the current activity; owner bars in force …; `server_time`"; `14-api.md:72` — response has `mode`, `grant`, `incarnation`, `lease_timeout_s` and no current activity.
  - `08-runners.md:80-81,83` — "The runner heartbeats at once. At most one ring per runner per second" … "a ring adds at most one heartbeat"; `02-deployments.md:303-304` — "The sidecar coalesces ring-triggered heartbeats to one per 10 s per session, except a ring carrying a `release`."
  - `08-runners.md:245-246` — "a `max-runs` refusal … an `off-graph` refusal"; `14-api.md:24-52` — the error table lists neither (nor `cancel-leg`), and §6.6's rule list (06:454-456) does not either.
  - `08-runners.md:172` — "the token's `grant_ttl` (default: the token's TTL)"; `08:160-161` and `11-people.md:352` — the create command has `--ttl` and `--uses` only; `14-api.md:134` has `grant_ttl_s?`. Whether it runs from the mint or from each registration is unstated.
- **The problem:** an implementer of the sidecar from §8.1 sends activities on the heartbeat and beats on every ring; one from §14/§2 does neither. Because an invalid heartbeat renews no lease (09:75-76), whether a bad spooled item (a leg session appends to its runner's spool, 08:299-301) fails the whole heartbeat or one item is a lease question, and only the activities route answers it. A runner's stated reactions key on two codes the API's "one list" does not define.
- **Counter-reading considered:** §14 is the normative route table; then §8.1's list is a second home for the same statement, which spec-writing.mdx forbids, and it has drifted.
- **Smallest fix:** §8.1 cites §14's row instead of listing fields; say per field what an invalid item does (dropped and logged, never `invalid-params` for the beat); add `off-graph`, `max-runs`, `cancel-leg` to §14's table; add `--grant-ttl` and its origin.

### RUN-14: "a late `success` never overwrites a newer `failure`" rests on a read-then-post with no compare-and-set
- **Severity:** low
- **Kind:** safety
- **Rules:** R-BTN-115 (Delivery, Read back), R-BTN-171
- **Confidence:** medium
- **Evidence:**
  - `10-checks.md:117-121` — "the deliverer posts only the highest it has claimed and drops older ones. Before posting it also reads the sha's check runs of that name and skips its entry when one carries a higher `seq`, so neither a second deliverer nor a worker that stalled past its lease posts an older entry over a newer one; a late `success` never overwrites a newer `failure`."
  - `10-checks.md:125-130` — "a newest run of a name on a head that is not the highest-`seq` entry already marked `delivered` for it, is the discrepancy `check-mismatch` … for a stale newest run Baton also re-queues the highest entry."
  - `07-conditions.md:657` — "A lapsed lease re-queues the entry. A mark arriving after its lease lapsed is accepted."
- **The problem:** deliverer D1 holds entry seq 4 (`success`) and stalls between its read and its post; its 10-minute lease lapses; the same `(repository, sha, name)` gets seq 5 (`failure` — the change was closed and re-opened, R-BTN-114's "stops posting", and re-ran against a stricter command read from the default branch's head, 10:66-68); D2 reads, posts 5; D1 resumes and posts 4. The forge's newest run of that name on that sha is `success` until the next sync reads it back and re-queues — a window in which branch protection is satisfied. The "never" is a detection, not a prevention.
- **Counter-reading considered:** same-sha re-runs are rare and the read-back repairs it. The sentence still states an invariant the mechanism does not give; S-BTN-68 accepts either outcome ("the older `seq` skipped, or raised `check-mismatch` and the newest re-queued"), which concedes it.
- **Smallest fix:** say "is detected at the next read-back (R-BTN-85)"; or have the deliverer update the existing check run (one run per name per sha, `PATCH`) only when its stored `seq` is lower, and re-read after posting.

---

## Read but found sound

- **Two runners claiming one ticket at once** — one synchronous transaction per request in a single-threaded object plus the partial unique index (09:14-15, 02:14-18); G-BTN-1. No interleaving found.
- **Claim response lost** — `(runner_id, request_id)` replay returns the first result (09:39-42); sound while the runner keeps its `request_id` (the restart case is in RUN-11).
- **End replay / conflicting end** — "Repeating the same end is answered `ok`; a different end on an ended claim is refused `claim-ended`" (09:148-149); a reaped claim cannot be ended over.
- **Heartbeat after a silence reap** — `runner-reaped` until a re-key, which holds no claim and clears no fence (08:28-30, 08:63-66); a re-key is refused while a claim is active. Could not resurrect a claim.
- **Signed-request replay** — `created` ± 5 min and an 11-minute nonce table (11:44-46); a captured request is not replayable. (API-key runners are a bearer by stated choice, R-BTN-159.)
- **Durable Object restart mid-transaction; reaps committing on their own** (09:198-201) — SQLite transaction semantics; a failed reap is retried next tick. No partial state found.
- **Server clock jumping** — forward reaps early (a failed attempt, re-read of git repairs); backward only lengthens leases. Client wall clock stepping *backward* by more than 4 minutes during a partition defeats R-BTN-26 (it forbids a monotonic clock); judged the residual of any wall-clock lease, not reported.
- **A reaped runner that still pushes to git** — the spec does not claim to stop it: three cooperative layers, then "its later pushes are not noticed (R-BTN-46); the next claimant re-reads git before it writes (R-BTN-25)" (09:237-238). Stated honestly, including for non-`builtin` executors.
- **Adversarial `lease_timeout_s`** — clamped on both ends, consistent with §13 (`15 min – 24 h`); the gain from declaring the max is in RUN-2/RUN-6, none found from declaring the min.
- **Doorbell** — authenticated as a heartbeat, rings carry kinds only, every missed ring is recovered by the 2-minute beat; lease upkeep has its own bucket so a ring flood cannot starve it (02:298-304), given the 10 s coalescing.
- **`legs_finished` deadline re-arm** — once per leg run, 40 minutes (07:474); cannot be repeated to hold a claim.
- **Who can post a check verdict** — a concluding entry needs a check-runner's `done` at an owner-mapped station with `exit_status: 0`, bound to `check_sha`; work keys are refused by rule `check-runner`; conclusions live in owner settings; the App's key is off Baton. A compromised check-runner or deliverer can lie, which §10's preface says. A result for an old head is tied to its sha by the forge.
- **Self-confirmation** — under `cooperative` the ending runner's own machine key may post the snapshot that confirms its end (R-BTN-102); the spec says this ("noticed, not stopped") and `protected` moves it to the sync credential.
- **Numbers cross-checked and consistent:** 900/86400 (§8.1, §13), 2 h / 15 min unacknowledged-release reaps (§9.5, §2 alarm table, R-BTN-90), 6 h unconfirmed (§9.6, §13:220, S-BTN-18), 30 min `short_waits` (R-BTN-40, R-BTN-72, G-BTN-67), `concurrency`/`max_claims` 1–32 (§9.1, §13, §14), `timeout_s` 1800/7200 (R-BTN-153, 05:150), nonce 6 hex, `previous_attempts` newest 10.

## Not covered

- §8.3 R-BTN-133's owner-signed-control paragraph (08:520-552) and R-BTN-107's executor interface were read but not attacked in depth (trust-domain questions belong with §12.8); R-BTN-144's masking classes and R-BTN-128's leg-log protocol were read for consistency only.
- R-BTN-146 span/sync-flag transitions and R-BTN-117 token arithmetic: read, only the `grant_ttl` drift checked.
- §9.8 replay (R-BTN-84) and §9.9 activity/transcript linking: read, not attacked.
- Not followed to their homes: R-BTN-47 (retirement), R-BTN-88 (freeze/seal), R-BTN-162 (condition waits), R-BTN-178 (seats), R-BTN-180 (protection reading on the heartbeat), R-BTN-198 (leg events), §6.9 message delivery and acknowledgement.
- §15: only the scenarios and gates naming lease, fence, reap, claims-per-runner and checks were read; I did not verify every rule in the span has a scenario.
- `BATON_SPEC_HISTORY.md` was not consulted for retired ids cited in the span; `npm run spec:impact` was not run (grep used instead).
