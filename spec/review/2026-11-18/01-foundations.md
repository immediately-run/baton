---
title: "Adversarial review 2026-11-18 — §1–§3: what Baton is, deployments, repositories and forges"
description: "One reviewer's findings, as filed, on BATON_SPEC §0–§3 read against the context pages."
order: 10
tags: [review]
---

# Adversarial review 2026-11-18 — §1–§3: what Baton is, deployments, repositories and forges

Read whole: `spec/BATON_SPEC/00-front.md`, `01-what-baton-is.md`, `02-deployments.md`,
`03-repositories-and-forges.md`; `docs/context/{product,architecture,values,vocabulary,spec-writing}.mdx`.
Cross-checked by grep against §4–§16, Decisions and the generated index. Paths below are relative to
`spec/BATON_SPEC/` unless they start with `docs/`. No text addressed to the reviewer was found in the span.

Counts: 2 high, 7 medium, 11 low.

---

### FND-1: A forge delivery rewrites the registry (path, `web_base`, `remote`) and can stop a repository's claiming — "only triggers" does not hold, and nothing orders or freshness-checks deliveries
- **Severity:** high
- **Kind:** security / architecture
- **Rules:** R-BTN-73 / R-BTN-95, R-BTN-138, R-BTN-92, §6.6 rule 13, values 6
- **Confidence:** medium-high (quotes in hand; the exploit needs a captured or late signed delivery)
- **Evidence:**
  - `docs/context/values.mdx:30-31` — "**Webhooks only trigger syncs.** A webhook tells Baton something changed; the sync reads what. Nothing in a delivery is trusted beyond that."
  - `03-repositories-and-forges.md:306-307` — "**R-BTN-73 / R-BTN-95 (forge notifications are only triggers).** A notification records a want; it never computes or carries state."
  - `03-…:151-154` — "**A verified rename** — a verified token, delivery or notification with matching ids and a new path — in one transaction rewrites the path and `web_base`'s path, appends the old path to `former_paths` (deduplicated, latest 10), and rewrites `remote` when it was `web_base` + `.git`"
  - `03-…:155-158` — "**A held rename.** When a live repository already holds the new path, the old path is kept and the token still passes. The repository raises `baton.rename-held`; a claim on a ticket whose home or code repository has a held rename is refused `not-eligible` (`rename-held`, §6); active claims on those tickets get a `requested` release (§6)."
  - `03-…:344` — "**Dropped:** a delivery id seen in the last 24 hours (`webhook_deliveries`)"; `03-…:315-316` — "(`X-Hub-Signature-256` under `BATON_GITHUB_WEBHOOK_SECRET`)" (an HMAC of the body only; `X-GitHub-Delivery`, `X-Gitea-Delivery`, `X-Gitlab-Event-UUID` are headers outside it; GitLab's `X-Gitlab-Token` is a static secret, `03-…:317-318`).
  - `03-…:105-106` — "**`remote`**: the URL the sync and runners clone"; `03-…:113` — "Every link Baton accepts or draws for a repository passes this rule" (the link rule is keyed on `web_base`).
- **The problem:** A delivery does carry state: its `repository.full_name` / `path_with_namespace` is written into `repositories.github`, `web_base` and (often) `remote`. Nothing compares a delivery with an earlier one — no timestamp, no sequence — and the replay cache is keyed on a header the signature does not cover and forgets after 24 hours.
  1. *No attacker (ordering).* Repository `org/a` (id 7) is renamed to `org/b`. Delivery d1 (path `org/b`) arrives and renames the row. A push delivery d0 generated just before the rename (path `org/a`) arrives after d1 (forges do not order deliveries; GitHub also offers "Redeliver"). d0 has matching ids and "a new path" → Baton renames the row back to `org/a`, rewrites `web_base` and `remote`. If no later delivery arrives, the registry names the old path, which R-BTN-138's own premise says "can be re-created by someone else" (`03-…:120-121`).
  2. *Replay.* Anyone who can read one old signed delivery (the forge's delivery log shows body and signature to repository/App admins; any log on the path) replays it with a fresh delivery-id header, or unchanged after 24 hours. Result as in 1, at a time of their choosing.
  3. *Denial of service.* The team renames `org/docs` → `org/docs-old` and registers a new repository at `org/docs`. Replaying (or a late arrival of) any pre-rename delivery of the first repository is "a verified … delivery with matching ids and a new path" whose path a live repository holds → a **held rename**: rule 13 refuses every claim on its tickets and on every home listing it in `code_repos`, and "active claims on those tickets get a `requested` release". It clears only by "an administrator [changing] the path with `confirm: true`" or "a later verified rename" (`03-…:159-160`); a later genuine delivery carries the *stored* path, which is not a rename, so whether it clears the hold is unstated.
- **Counter-reading considered:** "The path is for display and links; the forge's ids identify the repository" (`03-…:99-100`), so a wrong path harms nothing. It fails because `remote` is the clone URL, `web_base` decides which URLs Baton accepts and draws, and a held rename is a gate (rule 13, `06-…:450`) plus a release of live claims. Searched `rename`, `remote`, `former_paths`, `delivery` across §4–§16 for an ordering or freshness rule on deliveries: none. S-BTN (15-verification.md:92) tests "repeat, forgery" only as same-id repeats.
- **Smallest fix:** A delivery or notification never rewrites the registry: on matching ids and a differing path it records a want and raises a notice, and the rename is applied only from a verified CI token (default-branch origin, `iat`/`exp`) or the administrator's change. Failing that: read and require a monotone forge timestamp for a rename, never let a delivery create a held rename (ignore it and raise), and say when a hold clears. Amend values 6 or R-BTN-73's first sentence so they agree (see also FND-19).

### FND-2: A home with an empty `code_repos` resolves `repos:` "by name" — contradicting "the ids decide" and "reaches nothing unless listed"
- **Severity:** high
- **Kind:** contradiction (security-relevant)
- **Rules:** R-BTN-140, R-BTN-47, R-BTN-92, R-BTN-138
- **Confidence:** high
- **Evidence:**
  - `03-…:515-516` — "A re-written list keeps the ids of the paths it keeps, and a home that lists no `code_repos` keeps today's reading — its `repos:` entries resolve by name on its own forge host (R-BTN-92)."
  - `03-…:527-529` — "A `repos:` entry gains reach only when it resolves — path first mapped to its current one by id, so a re-created former path never gains reach outside the fence — to an id in `code_repos`."
  - `03-…:90-92` — "**Repositories a ticket changes** (`repos:`) … need no registration and reach nothing unless the home's owners list them in `code_repos` (R-BTN-140)."
  - `03-…:100-102` — "Every repository name a ticket carries … is a forge path naming the home or a `code_repos` entry (R-BTN-140)"
- **The problem:** For the default setting (`code_repos` `[]`, 13-data-model.md:65) the rule gives two answers. Reading A (line 516): any `repos:` path a ticket carries resolves by name on the home's host — so a pusher's ticket naming `org/anything`, or a path re-created by a stranger after a rename, gains what line 529-531 lists as reach (input URIs the runner fetches, PR search, `prs:`, branch-holder mapping, a person leg's question `url`), with no id and no owner act. Reading B (lines 90-92, 527): it reaches nothing and raises `baton.repo-not-listed`. The two differ in exactly the property R-BTN-138 exists for ("a re-created path never gains reach", `03-…:141`). "Today's reading" also describes a past state, which spec-writing rule 4 ("Current state only") excludes.
- **Counter-reading considered:** "resolve by name" might mean only display/filter resolution, not reach. It fails: display and filtering need no resolution ("Any other entry is shown and filtered on only", `03-…:531-532`), and the sentence sits in the paragraph on what "gains reach", as an exception to "the ids decide at every read". Searched `today's reading`, `by name`, `repo-not-listed`, `code_repos` in §4–§16: no rule settles it; R-BTN-92 (cited) says the opposite.
- **Smallest fix:** Delete the clause at 515-516, or state it as a dated transition in §16 with its end; R-BTN-140 then says an unlisted entry never has reach.

### FND-3: The seed can give ownership back to a key the owners removed, and gives back every revoked key after lost state
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-47 (the seed, B-91), R-BTN-57, R-BTN-58, architecture "Losing it fails closed"
- **Confidence:** medium
- **Evidence:**
  - `03-…:72-73` — "A seeded repository that already has owners at start keeps them, and the seed writes the entry's keys only where that repository has none."
  - `03-…:77-80` — "A key an administrator **revoked** is skipped — never written, never a stop … a repository it leaves with no owner is named in `seed_owners`"
  - `11-people.md:102-103` — "revoking an owner key removes it from every repository it owns, the last owner included"; 13-data-model.md:88 — "`repository_owners.removed_at` NULL" (a removal is a different record from a key's revocation).
  - `03-…:70-72` — "written at start as that repository's owners, `added_by: admin:seed`, so a rebuilt instance serves the owner CLI with no manual re-add"
  - `docs/context/architecture.mdx:44-46` — "Losing it fails closed: work is reviewed and approved again, never restored from git"
- **The problem:** (a) Seed entry lists K1, K2. Owner K1 removes K2 with `owner.owner.remove` (a departed colleague; a removal, not a revocation). Later the administrator revokes K1 (leaked). The repository now "has none". At the next start the seed "writes the entry's keys only where that repository has none": K1 is skipped as revoked; K2 is not revoked, so it is written as owner. A key the owners deliberately removed owns the repository again, by a restart. (b) After lost state ("a rebuilt instance"), `revoked_at` and `removed_at` are gone, so every key in `BATON_REPOSITORIES` — a leaked one included — is an owner again, with the policy, grants and bars reset: the opposite of failing closed for the one piece of state that names who may loosen.
- **Counter-reading considered:** The administrator edits `wrangler.toml` when revoking; Decisions (91-decisions.md:172) says the skip exists precisely so the instance survives "until `wrangler.toml` changes". That is an obligation nothing states for *removals*, and nothing enforces for revocations; `seed_owners` reports only repositories whose owners are all the seed's or none. Searched `seed`, `removed_at`, `owner.owner.remove`, `BATON_REPOSITORIES` across the spec: the seed's treatment of a removed key is nowhere.
- **Smallest fix:** The seed writes owners only for a repository row it inserts in the same start (never for an existing row with no owner — that is what `seed_owners` reports); and a rule that a revocation or removal of a seeded key is incomplete until the seed drops it, with a notice naming such keys.

### FND-4: `webhook_syncs` — three incompatible statements of which rows exist, so the 10-minute backstop's population is undefined
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-94, R-BTN-73 (B-89), §13 `webhook_syncs`
- **Confidence:** high
- **Evidence:**
  - `03-…:278-283` — "Dispatches of one workflow coalesce into one per repository and workflow per 30 seconds, whatever recorded the want … the window and the pending trailing dispatch are the `webhook_syncs` row of that repository and workflow"
  - `03-…:365-368` — "Every dispatch the webhook path sends … is timed in `webhook_syncs`: one row stamped by every repository the delivery dispatches"
  - `03-…:386-388` — "A repository with no row has never had one sent and takes no part in the backstop … a row exists only where the App's deliveries led the path to a repository"
  - `13-data-model.md:94` — "`last_dispatch_at` — when the path last sent the workflow a dispatch (a delivery's own, the alarm's backstop or a want's); stale for the sync workflow at `last_dispatch_at + 10 minutes`, when the alarm sends one"
  - `03-…:376-379` — "A live registered repository whose `webhook_syncs` row is stale … is sent a dispatch at R-BTN-73's alarm"
- **The problem:** Under R-BTN-94 and §13 a row exists for every (repository, workflow) Baton ever dispatched for any want (a claim, an advance, an owner bar); under line 387 only where an App delivery led there. Since each backstop send restamps the row, a row once written means a `workflow_dispatch` every 10 minutes for the repository's life, wanted or not (144 runs a day). So the two readings differ in whether every repository with a dispatch target — GitLab-trigger and Gitea ones too, which have no "App's deliveries" — is in that loop from its first claim, or only GitHub-App repositories a delivery touched. "one row stamped by every repository" also contradicts the key `(repository_id, workflow)`. And the mirror's row (`03-…:282-283`) exists under R-BTN-94; only §13 limits staleness to "the sync workflow".
- **Counter-reading considered:** The backstop is meant as a replacement schedule (91-decisions.md:159), so a perpetual 10-minute dispatch is intended. Granted — but then "takes no part in the backstop" for rows that R-BTN-94 creates is still undecided, and the loop's cost on non-GitHub targets is unintended by the rule's own rationale ("the App's deliveries reached Baton"). Searched `webhook_syncs`, `last_dispatch_at`, `backstop`: S-BTN (15:177) tests only App deliveries.
- **Smallest fix:** One sentence in R-BTN-73: which sends write `last_dispatch_at` (deliveries and the backstop only, or every send), for which target kinds and workflows the backstop runs, and that the key is (repository, workflow); make §13 cite it.

### FND-5: "Hard caps per repository … at twice the envelope" matches one row of eight; four envelope figures have no cap, and the repository write budget has no behaviour at its limit
- **Severity:** medium
- **Kind:** contradiction / underspecified
- **Rules:** R-BTN-87, R-BTN-149, §2.3 Admission
- **Confidence:** high
- **Evidence:**
  - `02-deployments.md:219-221` — "50 live runners, 20 repositories, 5,000 live tickets, 1,000,000 history rows; 20 requests a second as a 5-minute mean; bursts of 100 requests in any 5 seconds."
  - `02-…:227-228` — "The envelope refuses nothing; R-BTN-149's caps at twice it do."
  - `02-…:242-243` — "**R-BTN-149 (hard caps per repository).** Safety limits at twice the envelope; none refuses lease upkeep."
  - `02-…:249-253` — "live runner rows per credential | 64 …", "new sessions per credential per day | 200 …", "a repository's non-upkeep row writes per day | 150,000 | raises `baton.write-budget` at 80% |"
  - `02-…:256` — "Neither write budget refuses owner or administrator writes, or the repository's sync key or CI identity."
- **The problem:** Only "10,000 tickets" is twice an envelope figure. There is no cap on live runners in a tenant (64 is per credential; a tenant with ten credentials may hold 640), none on repositories, history rows or request rate (600 a minute is per credential). An implementer told "caps at twice it do [refuse]" cannot build the missing four; a reader relying on them is unprotected: the one Durable Object's CPU and storage are exactly what the envelope was sized for. Separately, the repository budget's "Past it" cell names only a raise at 80%, while line 256 says it refuses (some) writes: what is refused at 150,000, with which code, until when, is not stated (the per-credential row says "`quota` … until 00:00 UTC"). And several rows are per credential or per schema, not "per repository".
- **Counter-reading considered:** "Twice the envelope" is loose prose for "generous". Then R-BTN-87's "R-BTN-149's caps at twice it do" is a false statement of what refuses, and G-BTN-77 ("nothing refused past 100%", 15:294) tests only the envelope. Searched `quota`, `write-budget`, `too-large`, "live runners", "20 repositories", `1,000,000` in §4–§16: no other cap.
- **Smallest fix:** Retitle R-BTN-149 "hard caps", drop "at twice the envelope" from both rules or add the tenant-wide rows; give the repository budget its refusal (code, who, until when) in the table.

### FND-6: Baton holds a Gitea credential with write access to the repository — against "Baton holds no credential that writes git"
- **Severity:** medium
- **Kind:** architecture
- **Rules:** R-BTN-94, R-BTN-171, §12.7, architecture "One outbound path for effects"
- **Confidence:** medium-high
- **Evidence:**
  - `docs/context/architecture.mdx:30-32` — "Baton holds no credential that writes git or posts a check: a git write and a check run are outbox entries, delivered by runners that hold the credentials"
  - `03-…:270-272` — "`{kind: 'gitea', workflow, ref}`, whose token belongs to a bot user with write access to that one repository only. Baton holds these credentials as Worker secrets"
  - `03-…:299-300` — "a trigger token and the App's key act, and act only to start the workflows above."
  - `01-what-baton-is.md:11-12` — "runs no repository code (R-BTN-98) and writes no git itself (R-BTN-171)"
- **The problem:** A Gitea bot token "with write access" can push. "Act only to start the workflows" is a promise about use, not about what the credential can do; the architecture's statement is about what Baton *holds* (it is why the check App's key is kept off the secret sink, 12-security.md:262-264). The GitHub App is scoped ("Actions: write; read-only Contents", 12:250); the Gitea target is not, and the context page names only "the App key".
- **Counter-reading considered:** Baton's server is trusted and "recovered, not resisted" (§12.8), so what it holds does not matter. That argument was made for the dispatch App key specifically; the architecture sentence still stands as written and the merge-check design depends on it ("a gate against Baton as much as against any token", 12:270-271). Searched `gitea`, `bot user`, `trigger_token`: no narrower scope stated.
- **Smallest fix:** Either require a Gitea token whose scope cannot write contents (and say which scope), or state the exception in architecture.mdx and R-BTN-171, and refuse a Gitea dispatch target under `protected` floors that assume no Baton-held git writer.

### FND-7: CI tokens are "verified in the Worker" against data only the object holds
- **Severity:** medium
- **Kind:** underspecified / contradiction
- **Rules:** §2.1, R-BTN-15, R-BTN-135, R-BTN-138, R-BTN-47 (retirement step 3)
- **Confidence:** medium
- **Evidence:**
  - `02-…:19-21` — "The Worker fetches CI identity key sets and verifies CI tokens, App deliveries and forge notifications before forwarding"
  - `03-…:217-221` — "**GitHub Actions OIDC**, verified in the Worker: … `repository_id` and `repository_owner_id` equal the stored ids; `ref` is the default branch; `job_workflow_ref` is `<repository>/<sync_workflow>@refs/heads/<default branch>`"
  - `02-…:139-141` — "The deployment holds only the per-IP rule, caches of public data keyed by the exact URL fetched …, and each tenant's credential snapshot for the failure buckets"
  - `03-…:38-39` — "its CI identity and its forge notifications are refused from then on" (in the retirement transaction)
- **The problem:** Stored ids, the default branch, `sync_workflow` and `retired_at` are rows in the object's SQLite; the Worker holds none of them by R-BTN-135. So either the Worker keeps a copy of the registry (unstated, and then stale across a retirement, a re-identification or a held rename — a retired repository's token passes until the copy refreshes), or the claim checks run in the object and "verified in the Worker" means the JWT signature only. The same split is undefined for an App delivery's `repository.id` match and for the "verified rename" a token triggers (R-BTN-138), which is a write. The two readings differ in what a retired or re-identified repository's token can do in the window.
- **Counter-reading considered:** "before forwarding" plainly means signature and `iss`/`aud`/`exp`, the rest in the object. Plausible, but R-BTN-15's list puts every claim under "verified in the Worker", and R-BTN-93 says "`verifySync(req)` … is the only check". Searched `verifySync`, `job_workflow_ref`, `key set`: no statement of the split.
- **Smallest fix:** In §2.1 and R-BTN-15: the Worker checks signature, issuer, audience and expiry against the key set; the object compares every claim with the registry in the request's transaction.

### FND-8: Does a non-merge `pull_request` delivery record a want? R-BTN-73 says both, and only GitHub can tell
- **Severity:** medium
- **Kind:** contradiction / underspecified
- **Rules:** R-BTN-73 / R-BTN-95 (B-89)
- **Confidence:** medium-high
- **Evidence:**
  - `03-…:306-307` — "A notification records a want"; `03-…:350-351` — "**Which want.** A delivery records a want for the repository it names (by id, R-BTN-138) and for each registered repository whose `code_repos` lists it"
  - `03-…:354-355` — "A `pull_request` delivery that is not a merge (`pull_request.merged` anything but `true`) records nothing."
  - `03-…:330-332` — the events table accepts GitHub `pull_request`, GitLab `Merge Request Hook`, Gitea `pull_request`; `pull_request.merged` is among "the only fields read" for GitHub alone.
  - `03-…:359-360` — "The delivery names only `repository.full_name`" against `03-…:146-147` — "never matched by path instead".
- **The problem:** A PR opened, synchronized or closed by a person on GitHub: want or nothing? The two sentences disagree. On GitLab and Gitea no merged-state field may be read, so either every merge-request event records a want (GitHub then behaves differently for the same event) or none can be told apart. Reviews and comments (`pull_request_review`, `issue_comment`) do record wants, so "records nothing" for a PR opening leaves a person's new PR unseen until the backstop, while their comment on it is seen at once. The "names only `full_name`" clause also restates matching in a way R-BTN-138 forbids.
- **Counter-reading considered:** "records nothing" is meant only as "adds nothing beyond the ordinary want". The next sentence ("When it is a merge … that repository joins the want's set and its sync is dispatched") reads as the only case with an effect. Searched `pull_request.merged`, `Merge Request Hook`: S-BTN lists no non-merge PR case.
- **Smallest fix:** State per forge which PR events record a want; drop "names only `repository.full_name`".

### FND-9: The four-page candidate cap can hide ready work from a runner, and R-BTN-196 then remembers "nothing eligible"
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-61, R-BTN-196
- **Confidence:** low-medium (depends on what the candidate query filters, which the spec does not say)
- **Evidence:**
  - `03-…:181-186` — "The matching query reads at most 50 candidates per group after posted bars; when owner bars or readiness leave a group short it reads the group's next page, at most 4 pages per group per request … the answer is the one checking every candidate gives."
  - `02-…:235-241` — "A runner's recommendations or claim that find nothing eligible for it are remembered … while `state_version` stands … The answer remembered is always the one computing it gives (R-BTN-61, R-BTN-72)"
- **The problem:** By the rule's own words "owner bars or readiness" remove candidates *after* the query. A group whose first 200 candidates in default order are unready, or barred for this runner by an owner bar (an envelope-sized board holds 5,000), yields nothing for it although candidate 201 is ready: the runner is told there is no work, the memo keeps that answer while nothing is written, and the tickets ahead may stay unready indefinitely. "The answer is the one checking every candidate gives" is then false, and so is R-BTN-196's guarantee. `?all=1` "across all pages, at most 500" (06-…:491) sits oddly beside "at most 4 pages".
- **Counter-reading considered:** The query may already filter on readiness and per-runner bars, so pages fall short only marginally; G-BTN-40 says "the matching query and `isEligible` agree on every fixture". But then the sentence "when owner bars or readiness leave a group short" describes nothing. Searched `candidate query`, `4 pages`, `next page`: only §13:46 (rule 4's input) and this rule.
- **Smallest fix:** Say what the query filters; either remove the page cap for a request that would otherwise return nothing, or answer `truncated` so the runner (and the memo) know the answer is partial.

### FND-10: `job_workflow_ref`'s `<repository>` is undefined, and under the natural reading a rename locks the CI identity out
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-15, R-BTN-138
- **Confidence:** medium
- **Evidence:**
  - `03-…:220-221` — "`job_workflow_ref` is `<repository>/<sync_workflow>@refs/heads/<default branch>`"
  - `03-…:137` — "A token or delivery whose ids match passes whatever path it carries"
  - `03-…:151` — "**A verified rename** — a verified token … with matching ids and a new path"
- **The problem:** If `<repository>` is the stored forge path, a token minted after a rename carries the new path in `job_workflow_ref`, fails, and so can never be the "verified token" that teaches the rename; a repository with no webhook stays locked out until an administrator acts. If it is the token's own `repository` claim, line 137 holds — but nothing says so, and case-sensitivity of the comparison is unstated (paths compare case-insensitively, `03-…:98`).
- **Counter-reading considered:** Line 137 implies the token's own claim. Likely, but R-BTN-15 is the rule an implementer codes from. Searched `job_workflow_ref`: one occurrence.
- **Smallest fix:** "`job_workflow_ref` is the token's `repository` claim + `/<sync_workflow>@…`".

### FND-11: The write-budget arithmetic and the prune rate do not fit the envelope
- **Severity:** low
- **Kind:** unverifiable / underspecified
- **Rules:** §2.3 Write budget, R-BTN-149 (retention), R-BTN-87, R-BTN-13
- **Confidence:** medium
- **Evidence:**
  - `02-…:315-316` — "Each signed request writes two rows (a `request_nonces` insert and its prune 11 minutes later)."; `02-…:320-321` — "At the envelope that is about 330,000 row writes a day."
  - `02-…:220` — "20 requests a second as a 5-minute mean"
  - `02-…:265-266` — "The alarm deletes at most 1,000 rows a tick, oldest first, each prune through an index"
- **The problem:** 20 signed requests a second is 1,200 nonce rows a minute and 3.4 million nonce writes a day; 330,000 corresponds to about 1.9 requests a second, a figure the envelope does not state (it gives no daily mean). And if the 1,000-rows-a-tick bound covers the nonce prune (the alarm table lists it under "retention" beside "R-BTN-149's 90-day prunes", `02-…:48`), a tick removes at most 1,000 of the 1,200 a minute produced at the envelope: the table grows without bound and, "oldest first", the 90-day prunes never run. If it does not cover it, the nonce prune is an unbounded delete in one tick.
- **Counter-reading considered:** The cap is only for R-BTN-149's own prunes. Then say so; and the 330,000 figure still has no derivation. Searched `1,000 rows`, `330,000`, `request_nonces`.
- **Smallest fix:** State the daily mean the 330,000 assumes (per runner and heartbeat interval), and which deletes the per-tick bound covers.

### FND-12: `§7.1` is cited for the board sync; §7.1 is now "Raising a condition"
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** R-BTN-66, R-BTN-73
- **Confidence:** high
- **Evidence:**
  - `01-…:287` — "only from the commits the board post names (§7.1, R-BTN-133)"; `01-…:292` — "with its provenance (§7.1)"; `03-…:363` — "§7.1's reason for holding a sync back"
  - `07-conditions.md:29` — "### 7.1 Raising a condition"; `spec/BATON_SPEC_HISTORY.md:3428` — "| 7.1 Board sync | §4.3, §4.4 |"
- **The problem:** Three citations in the span (and 04:379, 05:700, 08:546, 11:39 outside it) point at the old numbering. 00-front says "`§n.m` numbers are stable".
- **Counter-reading considered:** None survives; the history's own map gives the new numbers.
- **Smallest fix:** Replace with §4.3 / §4.4 (and R-BTN-194 for provenance).

### FND-13: §13's `code_repos` contradicts R-BTN-140 on shape and on who resolves the ids
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-140, §13
- **Confidence:** high
- **Evidence:**
  - `03-…:503-506` — "an entry is `{path, forge?, host?}` … Baton stores `{path, forge, host, repo_id, owner_id, web_base}`"; `03-…:510-512` — "`baton owner settings` reads them from that forge's API … and posts them; Baton never fetches."
  - `13-data-model.md:65` — "`code_repos` JSON `[{path, repo_id, former_paths}]` — owners write `path` only; Baton resolves `repo_id` and keeps `former_paths`"
- **The problem:** §13 drops `forge`, `host`, `owner_id` and `web_base` (so a cross-host entry cannot be stored) and has Baton resolving ids, which "Baton never fetches" forbids.
- **Counter-reading considered:** The rule outranks the restatement (spec-writing, Reading 2); still an implementer of the schema reads §13.
- **Smallest fix:** §13 cites R-BTN-140 for the shape.

### FND-14: The vocabulary page defines "Worker" as the agent session; the spec calls that a runner and uses "Worker" for the Cloudflare Worker; "runner" and "tenant" are not on the page
- **Severity:** low
- **Kind:** contradiction (vocabulary)
- **Rules:** R-BTN-50, §1 Names, §2.1, spec-writing Writing 7
- **Confidence:** high
- **Evidence:**
  - `docs/context/vocabulary.mdx:9-10` — "These are core's words. A word not on this page … belongs to a course"; `:35-36` — "**Worker.** An agent session on a machine, identified by its key. It declares capabilities, a tier ceiling, tags and the courses it can run."
  - `01-…:23-24` — "A **runner** is a process that claims and runs legs"; `01-…:224` — "| runner, capability, tier, tag; lease, fence, reap …" (core's vocabulary names `runner`, never `worker`)
  - `02-…:13` — "**One Worker, one Durable Object.** The Worker routes every request"; `03-…:309-310` — "a push by a worker pusher of the owners' `worker_pushers` setting"
- **The problem:** One word, two things, in the two documents an implementer is told to read first; and the spec's own actor word ("runner", "trusted runner", "delivery runner" — the vocabulary itself uses them undefined at lines 103, 149, 184) has no entry, nor do "tenant", "board" or "forge". "Gate" likewise names both a matching rule (vocabulary:63) and a verification gate (`G-BTN-n`, 00-front:21-22).
- **Counter-reading considered:** Context differs (capitalised Worker = Cloudflare). §1 uses lower-case "workers who cooperate" (01:108) for runners, so the page's sense is live in the spec too.
- **Smallest fix:** Rename the vocabulary entry to Runner (noting "worker" as the informal word), add Tenant.

### FND-15: R-BTN-33's list of what Baton stores per ticket omits stored columns, and "never … a PR list" is contradicted by the resume record core reads
- **Severity:** low
- **Kind:** restatement-drift / contradiction
- **Rules:** R-BTN-33, R-BTN-50, R-BTN-24, R-BTN-194, §13
- **Confidence:** high
- **Evidence:**
  - `01-…:64-69` — "Per live ticket Baton stores …: id, title, path, course, tier, `requires`, expedite, `depends_at`, `parent`, `repos`, rank, the position Baton holds (R-BTN-39), and an opaque `display` object … It never stores a body, Status notes, exit criteria, a PR list or other prose"
  - `13-data-model.md:116` — "`check_sha`, `check_head_repo_id`, `check_head_ref`, `snapshot_sha`, `row_hash`, `blocked_since`, `answer_lost` JSON, `version` … `key` … `last_written_by` JSON `{pusher, pusher_id?, commit, at}`"
  - `01-…:229` — "never reads, except … a resume record's `branches` and `prs`, which the history read prunes the records to (R-BTN-24)"; `13-data-model.md:39` — "Nothing below holds an item body, note, exit criterion or PR list (R-BTN-33)."
- **The problem:** The rule that bounds what Baton may hold does not list a forge login it stores per ticket (`last_written_by.pusher`), nor `version`, `key`, the check columns; and Baton stores, and core reads, a list of PRs in `claims.resume_json` while two places say no PR list is ever stored.
- **Counter-reading considered:** `prs` are pointers ("pointers and digests, never content", 01:70); the exception is an owner ruling (91-decisions.md:102). Then R-BTN-33 should say "no PR list as a ticket field" and name the pointer.
- **Smallest fix:** R-BTN-33 cites §13's `tickets` row instead of enumerating, and lists the resume record's `branches`/`prs` among the pointers.

### FND-16: `?limit=` "applies after the merge" (R-BTN-61) against "the limit is per group" (G-BTN-61)
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-61, G-BTN-61
- **Confidence:** medium
- **Evidence:**
  - `03-…:186` — "`?limit=` applies after the merge."
  - `15-verification.md:303` — "G-BTN-61 | Recommendations merge groups by expedite, weight, place, legs to an end, `ready_since`, id; the limit is per group; every ready ticket has a rank"
- **The problem:** With three groups and `limit=10` the rule returns 10, the gate's words 30. The gate may mean the per-group *read* bound ("a group stops checking … once `limit` have passed"), but as written it tests the other behaviour.
- **Counter-reading considered:** As above; the gate should then say "each group reads up to `limit`".
- **Smallest fix:** Reword G-BTN-61.

### FND-17: "Never the incoming `Host`" cannot be implemented on the local host, where the `Host` header is the only host there is
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-135 (served only at its origin), R-BTN-158
- **Confidence:** medium
- **Evidence:**
  - `02-…:130-134` — "a request whose URL host … is not the origin's authority. It uses the request URL's host, never `X-Forwarded-Host` or `Forwarded` … every comparison is against the configured origin, never the incoming `Host`. The local shell does the same."
  - `02-…:121-122` — "a local host's is `http://<loopback host>:<port>` or the `https` origin of its operator's TLS front"
- **The problem:** A Node HTTP server has a path and a `Host` header, no URL host. Behind "its operator's TLS front" the header is whatever the proxy sends. Reading A: compare `Host` with the configured origin (what protects a loopback Baton from DNS rebinding on its unsigned routes); reading B: skip the check locally. The text forbids A and requires "the same".
- **Counter-reading considered:** "never the incoming `Host`" may mean "never *derive the origin from* `Host`". Probably; it should say so.
- **Smallest fix:** "The host compared is the request's own authority (on the local host, its `Host` header); the value it is compared with is always the configured origin."

### FND-18: `rate-limited` and `quota` are cited to R-BTN-135, which defines neither; whether lease upkeep counts in the 600-a-minute limit is unstated
- **Severity:** low
- **Kind:** stale-reference / underspecified
- **Rules:** §2.3 Admission, R-BTN-135, §14
- **Confidence:** medium
- **Evidence:**
  - `14-api.md:35-36` — "| `rate-limited` | over a rate limit, with `retry_after_s` (R-BTN-135) |", "| `quota` | a row-write, storage or per-claim cap (R-BTN-135, R-BTN-149, R-BTN-160) |"
  - `02-…:285-286` — "Authenticated calls are limited to 600 a minute per credential"; `02-…:298-302` — "**Lease upkeep** … is never refused by a per-tenant cap … It has its own buckets: 30 calls a minute per live claim"
- **The problem:** The limits live in an unnumbered "Admission" bullet, so §14 cites a rule that only says "adds per-tenant caps (§2.3)". And the 600 limit is per credential, not "a per-tenant cap": a credential with 64 sessions (its cap) each holding claims may legitimately make 64 × 30 upkeep calls a minute; whether those spend the 600 is two readings, one of which refuses lease upkeep.
- **Counter-reading considered:** "its own buckets" implies upkeep is outside the 600. Likely; unstated.
- **Smallest fix:** Give Admission a rule id; say upkeep is counted only in its own buckets.

### FND-19: Deliveries produce stored facts besides wants (push records, `last_written_by`, `unclaimed-write`), and it is unclear which GitHub route records them
- **Severity:** low
- **Kind:** architecture / contradiction
- **Rules:** R-BTN-73, R-BTN-194, §12.9, values 6, architecture "One inbound path for facts"
- **Confidence:** medium
- **Evidence:**
  - `03-…:307-311` — "it never computes or carries state. Besides the want a delivery produces two things: a GitHub push's record for ticket provenance …, and the scope cross-check …: … records an `unclaimed-write` finding from the delivery's own fields"
  - `docs/context/architecture.mdx:23-25` — "**One inbound path for facts.** … all attestations, differing only in writer; the repository's policy decides whose count."
  - `03-…:334` — "A GitHub push delivery to a branch is also **recorded**" against `04-tickets-syncs-board.md:630-631` — "a forge whose pushes Baton holds no record of (today every forge but github.com through the App …)"
- **The problem:** The rule's first sentence and values 6 are contradicted by its second: who pushed a ticket's file, shown "first" at the claim, is a fact taken from a delivery, entering by no attestation and weighed by no policy. It is information, not a gate (R-BTN-194), so the harm is bounded — but with FND-1 it shows "only triggers" is no longer the rule. Also undecided: is a push delivered by a *repository* webhook (`/v1/forges/{repository}/notify`, secret set by a forge repository admin) recorded? §3 says any GitHub push delivery, §4 says only the App's.
- **Counter-reading considered:** Baton's own record of an authenticated delivery is as good as an attestation. Then name it one (a `sync`-like writer class the policy can exclude), or amend values 6.
- **Smallest fix:** Reword R-BTN-73's opening and values 6 to list what a delivery may write; say which route records pushes.

### FND-20: Small disagreements with a concrete consequence
- **Severity:** low
- **Kind:** contradiction / underspecified
- **Rules:** R-BTN-55, R-BTN-135, R-BTN-138, R-BTN-140, R-BTN-93
- **Confidence:** medium
- **Evidence and problem, one each:**
  - `02-…:90` — "`--origin` (default `http://127.0.0.1:<port>`)" against `02-…:122-123` — "No two tenants share a host … two local hosts on one machine use different hostnames": the default makes any two local hosts share a host (and so a host-only cookie); nothing refuses it.
  - `03-…:141-145` — an App delivery is checked on "`repository.id`" only, a token on "`repository_id` and `repository_owner_id`", Gitea on both: after a GitHub transfer (same repository id, new owner) deliveries pass and auto-rename the row to the new owner's path while tokens are refused until "Re-identifying after a transfer" — the delivery path accepts what the rule says needs `confirm: true`.
  - `03-…:519-521` — "the live one with that host and id, else a retired one, whose entry then never has reach": retiring a home permanently removes every other home's reach to that forge repository as a code repository (consents are deleted, `03-…:47-48`) unless it is registered again under a new id; nothing tells the owners.
  - `03-…:199-200` — "any other key is `forbidden` at `/v1/sync/*`" against `03-…:192-193` — "or — for the sync only — a machine key granted on the repository".
  - `03-…:58-59,63-64` — "Every other call naming the repository is `not-found`, as for one never registered" against "its id is never registered again in the tenant (`conflict`)": a registration naming it reveals it existed, and is not in the list of exceptions.
- **Counter-reading considered:** Each is resolvable by a reasonable guess; listed so the guess is made once.
- **Smallest fix:** One clause each in the owning rule.

---

## Read but found sound

- **Alarm lateness and Baton's own outage vs reaping** — the reap and the sidecar's fence run on the same lease value (R-BTN-9: "the lowest of the value in force at `last_ok` and every value it has declared"), reaps commit on their own (§9.5), and the alarm is re-armed by any request when "more than two periods overdue"; I found no state a late or repeated tick leaves stuck.
- **The sync want** (`sync_wanted_at` / `sync_wanted_after`, strictly-greater clear) — a want raised while a run reads is never lost; a released or voided number only costs an extra run.
- **Clock and retention numbers in §2.1's alarm table** — 2 hours / 15 minutes (§9.5, 06:592, 07:483), 11 minutes (11:46, 13:91), 24 hours (13:92-93, 07:617), 30 seconds (13:94, 13:126), lease bounds (08:31, 13:102), 10 minutes (13:94, 13:225), 30 minutes `sync-late` (13:226), weight 100 (13:45), 4 generations (04:712), 4,096 states (05:401), 16 KB / 256 KB (12:152), 4 KB (05:368), envelope figures (15:294) all agree with their other statements.
- **Tenant isolation as specified** — origin-bound signatures (`@authority`), per-tenant nonces, hashed bearers, host-keyed per-IP rule, per-origin failure buckets, the `x-baton-tenant` handshake; the residual (one machine key in two tenants) is stated in R-BTN-137.
- **Forge-id matching against a re-created path** for tokens and for `code_repos` reads (apart from FND-1, FND-2 and the transfer note in FND-20).
- **Retirement** — every credential class, outbox entry, want and consent is accounted for; fence-pending claims have an exit at `fence_deadline`.
- **Sync-key scope** — one repository, one role, bound to no branch with the CI-secret obligation stated; `verifySync` as the single check.
- **Shared branch names across two homes** — 04:51-52 states the fail-safe.
- **Every `R-/S-/G-BTN` id cited in the span exists in the generated index.**

## Not covered

- R-BTN-39's fact-arrival conditions, adopt and the deferred/unapplied cases were read but attacked only lightly (they belong with §5/§9 and the attestation rules of §12.8, which I did not read whole).
- R-BTN-66's owner-signed control inputs and R-BTN-98's `rank.mjs` loading: read, not traced against R-BTN-133/R-BTN-134/§4.4.
- R-BTN-196's list of clock-only instants (whether `not_before`, a reading's lapse or another runner's liveness can change a memoised "nothing eligible" without moving `state_version`) — a suspicion I could not settle without §6 whole.
- R-BTN-96 (GitHub GraphQL budget, check-suite fallback), R-BTN-139's per-forge permission reads and R-BTN-141's pattern grammar: read; no external-API fact was verified.
- `BATON_MCP_OAUTH_SPEC.md`, `docs/security-model.mdx` and `BATON_SPEC_HISTORY.md` (beyond one grep) were not read. `npm run spec:impact` was not run; grep was used instead.
- Platform facts (Workers Free limits, Durable Object alarm retry semantics, GitHub's 25 MiB delivery size) were taken as stated.
