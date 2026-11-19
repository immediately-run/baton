---
title: "Adversarial review 2026-11-18 — §11 and the MCP OAuth companion"
description: "One reviewer's findings, as filed, on BATON_SPEC §11 and BATON_MCP_OAUTH_SPEC."
order: 15
tags: [review]
---

# Adversarial review 2026-11-18 — §11 and the MCP OAuth companion

Reviewer span: §11 (People) and the MCP OAuth companion, read whole; cited rules followed into §2.2–§2.3, §3.1, §6.8, §7.4, §8.2, §12.1–§12.8, §13.1–§13.2, §14 and §15 as far as needed to compare. Paths are relative to `/Users/neumark/git/baton/`. `OAUTH` below is `spec/BATON_MCP_OAUTH_SPEC.md`. No text addressed to the reader ("ignore the above", "run …") was found in the span.

Counts: critical 0 · high 4 · medium 11 · low 8.

---

### PPL-1: R-BTN-197 refuses every caller that is not the CLI once `min` rises — MCP clients, OAuth clients, webhooks, forge notifications, the dashboard
- **Severity:** high
- **Kind:** liveness
- **Rules:** R-BTN-197, R-BTN-130, R-BTN-73, R-BTN-95, R-BTN-155, R-BTN-172, S-BTN-227, §14
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:390` — "Every client of the API is the CLI — a person's command, a runner, a sync — and each says which version it is"
  - `spec/BATON_SPEC/11-people.md:395` — "A request without the header is compared as `0.0.0`."
  - `spec/BATON_SPEC/11-people.md:406` — "A request from a client below `min` is answered `client-too-old` (§14), naming the client's version, `min` and `recommended`, before its signature is checked and before anything is read or written"
  - `spec/BATON_SPEC/14-api.md:20` — "Every request carries `Baton-Client` and every response `Baton-Client-Versions` (R-BTN-197)."
  - `spec/BATON_SPEC/15-verification.md:120` — "0.1.3 and no header answered `client-too-old` naming 0.1.3 (or 0.0.0), 0.1.4 and 0.1.5, unsigned or signed alike and with nothing written"
  - `spec/BATON_SPEC/11-people.md:463` — "`POST /v1/mcp` speaks MCP's streamable HTTP transport"
  - `spec/BATON_SPEC/02-deployments.md:308` — "Baton's own clients (CLI, runner, sidecar, sync, mirror, dashboard)"
- **The problem:** the premise "every client of the API is the CLI" is false by the spec's own routes. Under `/v1` Baton also serves third-party MCP clients (`POST /v1/mcp`), OAuth clients (`/v1/oauth/token|register|revoke`), GitHub (`POST /v1/github/webhook`), GitLab and Gitea (`POST /v1/forges/{repository}/notify`), and the browser (`POST /v1/login`, `/v1/ui/*`, the entity reads). None of the first four can send `Baton-Client`; nothing says the dashboard bundle does. Trace: a deploy whose code sets `min` to `0.1.4` (S-BTN-227's fixture). Claude calls `POST /v1/mcp` with a valid bearer and no `Baton-Client` → compared as `0.0.0` → below `min` → `426 client-too-old` "before anything is read". GitHub's webhook delivery → the same; every sync trigger from the forge is lost. The browser's `POST /v1/login` → the same; nobody signs in. The first release that raises `min` above `0.0.0` takes all four surfaces down, and S-BTN-227 asserts that outcome for "no `Baton-Client`".
- **Counter-reading considered:** R-BTN-197 might be meant only for CLI-facing routes. But its text scopes the response header to "Every response under `/v1`, a refusal included", §14 says "Every request carries `Baton-Client`", and the missing-header rule has no exception. Searched `Baton-Client`, `0.0.0`, `client-too-old`, `R-BTN-197` across `spec/BATON_SPEC/*.md` and the companion: no route, principal or surface is exempted, and the companion never mentions the header.
- **Smallest fix:** in R-BTN-197, apply the `min` check only to requests that carry `Baton-Client`, or name the registry principals the rule covers (`administrator`, `owner`, `runner`, `check-runner`, `sync`, `mirror`, `probe`, `token`); fix "Every client of the API is the CLI"; add the MCP, webhook and login cases to S-BTN-227.

### PPL-2: an approver list of `key:` entries has no recovery — the key cannot be revoked, and break-glass does not match it
- **Severity:** high
- **Kind:** liveness
- **Rules:** R-BTN-57, R-BTN-188, R-BTN-185, S-BTN-192
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:102` — "revoke any key at once but an administrator's: revoking an owner key removes it from every repository it owns, the last owner included … and ends its sessions and MCP keys, unless it would leave an approver list unsatisfiable (`unsatisfiable-approvers`, R-BTN-188), which only the break-glass key resolves."
  - `spec/BATON_SPEC/12-security.md:404` — "**Break-glass.** A key in the host's `BATON_HUMAN_KEYS` configuration (R-BTN-185) satisfies every `human` entry of every repository on the instance whose `human_key` it meets"
  - `spec/BATON_SPEC/12-security.md:380` — "an administrator (R-BTN-57) matches an `owner` entry on every repository and no other"
  - `spec/BATON_SPEC/12-security.md:407` — "It is the deployment's root of trust, set outside Baton, and the only recovery from a lost key."
  - `spec/BATON_SPEC/15-verification.md:267` — "revoking A while `[key:<A>]` is the only list it satisfies" … "the revocation refused"
- **The problem:** S-BTN-192's own state is a dead end. `approvers.policy: [key:<A>]` (A `human_only`, or `[key:<B>]` with B an ordinary owner key, which the same scenario sets).
  1. A's holder loses the key, or A is compromised.
  2. The administrator runs `baton admin key revoke <A>` → `unsatisfiable-approvers` (R-BTN-57; R-BTN-188 "No gate without a key to open it").
  3. To make the revocation legal the list must change first. A change needs "an approver on the `approvers.policy` list, as the list stands before the change" — only A.
  4. The break-glass key satisfies "every `human` entry"; the list has no `human` entry. The administrator matches "an `owner` entry … and no other".

  So a compromised key named alone in a `key:` list is unrevocable by anyone but itself and keeps full policy authority; a lost one freezes the policy (and membership and grants, if `approvers.members` is the same list). R-BTN-57's "which only the break-glass key resolves" promises a recovery R-BTN-188's definition of break-glass does not give. The only exit left is `admin repo retire` (R-BTN-47: "a retired repository's policy blocks no revocation"), which destroys the repository's Baton state and its id.
- **Counter-reading considered:** "satisfies every `human` entry" could be read loosely as "opens every human gate". It cannot cover `[key:<B>]` with B not `human_only`, and R-BTN-129 restates the narrow reading (`11-people.md:192`: "for a `BATON_HUMAN_KEYS` line, on every repository whose `human_key` it meets, R-BTN-188's break-glass"). Searched `break-glass`, `BATON_HUMAN_KEYS`, `lost key`, `recover` in §2, §3, §11, §12: no other recovery rule.
- **Smallest fix:** in R-BTN-188 *Break-glass*, say the `BATON_HUMAN_KEYS` line is an approver on every `approvers.*` list of every repository whose `human_key` it meets, whatever the list's entries (or refuse a list with no `owner` or `human` entry); state that a break-glass change of the list is what makes the refused revocation possible; add the lost-key case to S-BTN-192.

### PPL-3: an API key's fingerprint is a client-chosen 64-bit id bound to nothing — two public lines may share it, and every authority table is keyed by it
- **Severity:** high
- **Kind:** security
- **Rules:** R-BTN-159, R-BTN-58, R-BTN-155, §12.1 (one role per key), §13.2
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:59` — "`baton key create FILE` writes `bak_<id>_<secret>` (64 random bits of id, 256 of secret, hex) to `FILE` (mode 0600) and its **public line** `bak_<id> sha256:<SHA-256 of the key> [comment]` to `FILE.pub`. Nothing is sent. The key's fingerprint is `bak_<id>`."
  - `spec/BATON_SPEC/11-people.md:72` — "Baton hashes the key and compares every byte with the hash on the public line its fingerprint names."
  - `spec/BATON_SPEC/13-data-model.md:21` — "`credential_id` and `fingerprint` are a key's fingerprint (`SHA256:…` for an SSH key, `bak_<id>` for an API key)"
  - `spec/BATON_SPEC/13-data-model.md:82` — "| `repository_owners` | `(repository_id, fingerprint)` | `public_key`, `added_by`, `added_at`, `removed_at` |"
  - `spec/BATON_SPEC/13-data-model.md:88` — "`key_fingerprint`, `repositories` JSON (an owner's: those its key owned at binding)"
  - `spec/BATON_SPEC/14-api.md:128` — "| `POST /v1/owner/login-links` | an owner key of any repository |"
- **The problem:** an SSH fingerprint is a hash of the public key, so one fingerprint is one key. An API key's "fingerprint" is the id half the client wrote into the line; the public line is registered as given, with no proof of possession and no rule that a `bak_<id>` names at most one public line in the tenant (`repository_owners` is unique only per repository; `credentials.public_key` is unique, the owner table's is not). Trace: Alice's key `bak_A` owns repository `a`. Mallory owns repository `c` and has seen `owner:bak_A` (events, a shared repository's owner list, a dashboard). She writes her own file `bak_A_<her secret>`, derives `bak_A sha256:<h2>`, and runs `baton owner owner add c "bak_A sha256:<h2>"` — the one-role rule does not refuse it, the role is the same. "The public line its fingerprint names" is now two lines. Mallory binds a sign-in with her secret on the repository-less route `POST /v1/owner/login-links`; the session row records `key_fingerprint: bak_A` and "the repositories the key owned at binding" — read by fingerprint, that is `a` and `c`. Her session acts on `a`. Short of that reading she still writes `owner:bak_A` as the actor of her own acts, mints MCP keys with `minted_by` Alice's fingerprint, and, by naming an administrator's `bak_<id>`, holds an owner key that `admin.key.revoke` answers `invalid-params` for (`11-people.md:105`: "`admin.key.revoke` naming one is `invalid-params`").
- **Counter-reading considered:** "64 random bits of id" make an accidental collision negligible, and an implementation would probably look the line up by `(repository, fingerprint)` on a repository route. Neither binds a hand-written line, and the routes with no repository (`/v1/owner/login-links`, `/v1/owner/confirm`, `/v1/owner/sessions/revoke`, `admin.key.revoke`, the minter's-removal rule for MCP keys) have only the fingerprint to go on. Searched `public line`, `bak_<id>`, `same fingerprint`, `proof of possession`: the only proof-of-possession rule is `POST /v1/human-keys`' (SSH only).
- **Smallest fix:** R-BTN-159: the fingerprint is derived from the secret (`bak_` + the first 64 bits of the key's SHA-256, checked against the line at registration), or a `bak_<id>` already named by any live line, administrators' included, is refused `conflict` tenant-wide; add the colliding registration to S-BTN-126.

### PPL-4: a delegated key resets a ticket's retry counts by holding and unholding it
- **Severity:** high
- **Kind:** security
- **Rules:** R-BTN-186, R-BTN-130, R-BTN-129, R-BTN-12, R-BTN-122, G-BTN-121, G-BTN-157
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:558` — "Lifting a hold resets the leg's attempt and blocked-end counts."
  - `spec/BATON_SPEC/07-conditions.md:417` — "Lifting a hold resets the leg's counts, as does the leg reaching an outcome (above)."
  - `spec/BATON_SPEC/11-people.md:224` — "`own` for the undoing of the key's own tightening — `ticket.unhold` of a hold it set (`set_by: mcp:<id>`)"
  - `spec/BATON_SPEC/12-security.md:971` — "It never loosens what another credential set"
  - `spec/BATON_SPEC/91-decisions.md:35` — "so that agents rewriting git can neither clear a hold nor buy runs"
- **The problem:** the two actions R-BTN-186 calls a tightening and its undoing are, composed, a loosening of Baton's retry policy. A ticket's leg has failed N−1 of its N allowed attempts and is not held. An MCP key (or OAuth grant) holding `ticket.hold` and `ticket.unhold` calls `ticket.hold` (the ticket was not held, so the hold is its own, `set_by: mcp:<id>`), then `ticket.unhold` (allowed: its own). The lift "resets the leg's attempt and blocked-end counts". Repeated before each last attempt, the leg never reaches `attempts-exhausted`, the hold `baton.retries` exists to place is never set, and the owner is never asked. Under a human-only `approvers.policy` the same reset is a human gate for every owner key (`ticket.unhold` needs an approver), yet open to the delegated key.
- **Counter-reading considered:** the reset might be meant only for the retry policy's own holds (`attempts-exhausted`, `non-retryable:*`, `blocked-exhausted`). Both statements are unconditional, and S-BTN-6 ("lifting resets") does not distinguish. Searched `resets the leg`, `attempt and blocked-end`, `buy runs`: no rule scopes the reset to a hold reason or to the lifter.
- **Smallest fix:** R-BTN-12 / R-BTN-122: a lift resets the counts only when the hold lifted was the retry policy's (`hold_reason` `attempts-exhausted`, `non-retryable:<class>`, `blocked-exhausted`), never for `mcp:<name>`; add the hold-unhold cycle to S-BTN-101.

### PPL-5: an administrator's ordinary key changes membership under a human-only list — by revoking keys, and by retiring and re-registering
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-57, R-BTN-188, R-BTN-47, R-BTN-189 (`human-gates`), §14
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/12-security.md:393` — "an action whose list is human-only is a **human gate**, for administrators too: an administrator performs it only with a `human_only` key the list admits."
  - `spec/BATON_SPEC/12-security.md:352` — "`approvers.members` — adding or removing owners; granting or revoking runner keys"
  - `spec/BATON_SPEC/11-people.md:102` — "revoke any key at once but an administrator's: revoking an owner key removes it from every repository it owns, the last owner included"
  - `spec/BATON_SPEC/14-api.md:154` — "| `POST /v1/admin/keys/{fingerprint}/revoke` | admin | `{confirm: true}` | `{ok: true}`; the key stops at its next call, an owner key on every repository"
  - `spec/BATON_SPEC/14-api.md:153` — "admin; `forbidden` where the repository's `approvers.members` is human-only" (the grants row only)
  - `spec/BATON_SPEC/03-repositories-and-forges.md:63` — "its id is never registered again in the tenant (`conflict`)"; `:57` — "a retired repository's policy blocks no revocation"
- **The problem:** two rules answer "may an administrator key remove an owner or revoke a runner key of a repository whose `approvers.members` is `[human]`?" differently. R-BTN-188: no, it is a human gate "for administrators too". R-BTN-57 and §14's revoke row: yes, "any key at once", with only the unsatisfiable-list exception. The `forbidden` clause was added to the administrator's grant and `owner_keys_add` rows and not to revocation. Beyond that, the forge path is unique only "among live rows", so an administrator key can `admin repo retire` a `protected-hardware` repository and `admin repo add` the same forge path under a new id with an owner key of its choosing: the new repository starts `cooperative`, `[owner]`, no floors — every human gate and floor of the old one is gone without one `human_only` signature.
- **Counter-reading considered:** the administrator is the deployment's root of trust (R-BTN-57), so nothing is lost. But the spec deliberately withholds grants from the administrator key under a human-only list ("never with an administrator key, which carries no `human_only` mark"), which is pointless if the same key can strip owners and re-register. Revocation as a pure tightening is defensible — then R-BTN-188's "for administrators too" and the knob's "removing owners; … revoking runner keys" must say so. Searched `human-only` in §3, §11, §14 and `retire` in §12: no rule ties retirement or re-registration to the policy.
- **Smallest fix:** state in R-BTN-57 that revocation is a tightening open to the administrator whatever the list (and in R-BTN-188 that the human gate covers additions only), or gate it; and either refuse `admin.repo.retire` while a floor stands unless a `human_only` key the policy admits signs it, or list "an administrator retiring and re-registering the repository" under §12.8's "Outside every guarantee".

### PPL-6: credentials minted under `[owner]` keep working after `approvers.members` becomes human-only — a registration token still adds runner grants
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-117, R-BTN-188, R-BTN-189 (`human-gates`), R-BTN-130, R-BTN-172
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/08-runners.md:162` — "`--uses` default 1, at most 100; TTL default 7 days, at most 30 days."
  - `spec/BATON_SPEC/08-runners.md:165` — "`baton runner register --token <t> --name <name> [--key ssh | --key api]` creates a runner credential with a grant inside the token's scope, never wider."
  - `spec/BATON_SPEC/12-security.md:409` — "**Making `approvers.roles` human-only** clears every role, mark and domain set by a credential the new list does not admit"
  - `spec/BATON_SPEC/12-security.md:447` — "no owner's agent session, and no delegated key, changes membership, roles or the policy"
  - `spec/BATON_SPEC/12-security.md:957` — "so no session, and no OAuth approval by one, satisfies a human-only `approvers.*` list."
- **The problem:** R-BTN-188 cleans up after `approvers.roles` turns human-only and says nothing for `approvers.members`. Trace: under `cooperative`, the owner's agent (an ordinary owner key) runs `baton owner token create r --uses 100 --ttl 30d`. A human then applies `protected-hardware` and sets `floors: [human-gates]`; the guarantee is reported held. For the next 30 days whoever holds the token runs `baton runner register --token …` up to 100 times, each "creates a runner credential with a grant" on the repository — "granting … runner keys" is the first action `approvers.members` governs — with no human signature. The same holds, with less reach, for `bmcp_` keys and OAuth grants minted before the switch (up to 90 days). `human-gates`' promise is broken while its condition is met.
- **Counter-reading considered:** the token was minted lawfully and its grants are role `runner`, no domain, inside its scope; the dry-run could warn. Still the guarantee's promise is about changes after it holds, and the dry-run's `stops` (R-BTN-188) lists grants, legs and tickets, never tokens or delegated keys. Searched `registration token` and `mcp` in `12-security.md` and `human-only` in `08-runners.md`: nothing ends or re-checks them on a list change.
- **Smallest fix:** R-BTN-188: a change that makes `approvers.members` human-only exhausts every live registration token and ends every MCP key and OAuth grant whose minter the new list does not admit (listed in the dry-run's `stops`); or R-BTN-117 re-checks the minter against the list in force at each registration.

### PPL-7: R-BTN-199 lets a delegated key take sequence numbers — a write R-BTN-129's and R-BTN-186's closed definitions refuse
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-199, R-BTN-129, R-BTN-186, R-BTN-130, R-BTN-172 §7, G-BTN-121, G-BTN-157
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/04-tickets-syncs-board.md:489` — "for the principals that file tickets — a key granted on the repository, an owner of it, an administrator, the repository's sync key, and a delegated key"
  - `spec/BATON_SPEC/14-api.md:105` — "reader; the repository's sync key; delegated allowed (R-BTN-199)"
  - `spec/BATON_SPEC/11-people.md:226` — "`false` for everything else: every other write (`ticket.resolve` among them, R-BTN-186)"; `:230` — "This list is the mark's definition, and `check:actions` fails an entry whose mark differs from the one it gives."
  - `spec/BATON_SPEC/12-security.md:979` — "This is the one rule of what a delegated key may do"
  - `OAUTH:311` — "`read` (the reads a delegated key may hold, existing at approval), or any action id R-BTN-186 admits to a delegated key (`ticket.hold`, `ticket.unhold`, `leg.stop`, `ticket.cancel`, `owner.bar.add`, `owner.bar.lift`, a read id)"
- **The problem:** `POST …/sequences/{kind}/next` writes (it advances a counter and logs "one `sequence` event per take"). It is neither a read, a tightening nor the undoing of one, so R-BTN-129's list marks it `false` and `check:actions` must fail the entry R-BTN-199 and §14 require; or it is marked `true` and R-BTN-129, R-BTN-186, the §12.1 MCP row ("reads, tightenings and the undoing of its own"), the companion's scope set and G-BTN-121/157 are all wrong. An implementer cannot satisfy both. If it is a `read`-effect entry instead, an MCP key minted `--actions read` silently gains a state-changing call (a key can burn 10 000 numbers per call through `floor`, 60 calls a minute).
- **Counter-reading considered:** R-BTN-199's own defence — "a number is not authority" — is a reason to admit it, not a statement that the three closed lists admit it. Searched `delegated` in every section: only §4, §13's actor convention and §14's row mention the sequence.
- **Smallest fix:** add `sequence.next` to R-BTN-129's `true` list and R-BTN-186's sentence (and the companion's §7 scope list and the §12.1 row), saying whether `--actions read` includes it; or strike "and a delegated key" from R-BTN-199 and §14.

### PPL-8: resolving a condition clears the same hold whose lift is a confirmed action and an `approvers.policy` gate
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-155, R-BTN-163, R-BTN-186, R-BTN-188, R-BTN-127
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/07-conditions.md:315` — "| `baton.retries` | … | clears the hold and the backoff | re-routes to a leg leaving the station (R-BTN-83) and clears the hold |"
  - `spec/BATON_SPEC/07-conditions.md:319` — "Any owner act that clears the hold under a `baton.retries` or `baton.contract` condition closes the condition, including §6's clear-hold."
  - `spec/BATON_SPEC/11-people.md:554` — "lift a hold, set or clear expedite (`POST /v1/ui/overrides/{ticket}` with `hold: false` or `expedite`)" (in the confirmed list)
  - `spec/BATON_SPEC/11-people.md:563` — "nor resolving a condition, which a signed-in owner or administrator answers in one step"
  - `spec/BATON_SPEC/12-security.md:982` — "loosening what another set is an `approvers.policy` approver's (R-BTN-188): an owner's under `[owner]`, a human's under a human-only list."
  - `spec/BATON_SPEC/11-people.md:321` — "`ticket.resolve`: `POST …/tickets/{ticket}/resolve` (R-BTN-163) | owner"
- **The problem:** one effect, two authorisations. A ticket held `attempts-exhausted` under `baton.retries`: (a) `ticket.unhold` needs an approver on `approvers.policy` — a `human_only` key under `protected` — and, from a session, a confirmation code; (b) `ticket.resolve retry` "clears the hold and the backoff", and `route:<leg>` also re-routes, for any owner key, and from a session "in one step", no code. So under a human-only `approvers.policy` the owner's agent cannot lift the hold but can resolve it away; and the stolen-cookie case R-BTN-155's confirmation exists for ("lift a hold") is open through the Resolve page. `11-people.md:684` — "nothing changes authority from a cookie (R-BTN-155)" — and R-BTN-186's "lifting another's hold" both fail on path (b).
- **Counter-reading considered:** R-BTN-186 names a restart as "ending a block or a hold another set" and keeps it "the owner's" on purpose: resolving is the designed answer to Baton's own hold. That explains (b); it does not explain why (a), the same clear of the same hold, is a human gate and a confirmed action. Searched `clears the hold`, `resolve` in §11 and §12: no rule says the two differ in what they release.
- **Smallest fix:** say in R-BTN-186/R-BTN-155 that a retry-policy hold (`override_kind: baton`) is lifted by any owner by either act, and only an owner-set hold's lift is the `approvers.policy` gate and the confirmed action; or make `ticket.resolve`'s hold-clearing restarts follow `ticket.unhold`'s caller and confirmation.

### PPL-9: an approved authorization code is redeemed without re-checking the session, the minter's ownership or the approver list
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-172 §5, §8, §9; R-BTN-130; R-BTN-155
- **Confidence:** medium
- **Evidence:**
  - `OAUTH:339` — "Its first success creates the grant (§7) and its first tokens in one transaction, rechecking §10's grant cap, `api_keys` and that the repository is not retired (R-BTN-47; else `invalid_grant`)."
  - `OAUTH:371` — "A grant ends by `owner.mcp-key.revoke` by name, the minter's removal or revocation, its repository's retirement (R-BTN-47, which also ends its pending requests and codes)"
  - `OAUTH:375` — "an act that ends a grant also marks every token of it `revoked_at` in the same transaction."
  - `OAUTH:235` — "it mints no grant: the grant is created at the code's first redemption (§7)"
- **The problem:** the recheck list at redemption is closed and omits the three things approval rested on. Between approval and redemption (60 s) no grant row exists, so the "act that ends a grant" — the minter's removal, `admin key revoke`, `owner sessions revoke`, `admin sessions revoke --all`, a policy change making `approvers.members` human-only — finds nothing to end; only retirement is said to end "pending requests and codes". Trace: a stolen owner session approves a `read` grant; the administrator, responding, runs `admin key revoke <owner key>`; the attacker's client redeems the code 20 s later; the grant is created "as its minting owner key", whose removal has already happened. Whether it then dies depends on whether "the minter's removal" is an event or a state checked per call — the spec uses the event wording for ending and says neither for the minter. The window is narrow (the code's 60 s).
- **Counter-reading considered:** "looked up and its grant checked on every call" may include the minter's standing, in which case the grant is created and dead at once. That is one of two readings; and the logged-out or revoked session is covered by neither. Searched `recheck`, `session` in §8–§9: nothing.
- **Smallest fix:** §8: redemption also requires that the approving session is still live, that its key still owns the repository and that the session still satisfies `approvers.members`, else `invalid_grant`; §9: every act that ends a key's sessions or MCP keys also ends that key's approved, unredeemed requests.

### PPL-10: revoking a leaked MCP key, token, sync key or check-runner is an `approvers.members` action, though the knob lists only minting and R-BTN-186 opens tightening to every owner
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-188, R-BTN-186, R-BTN-58, R-BTN-127, R-BTN-130, R-BTN-172 §9, §14
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/12-security.md:352` — "registering check-runners, sync and mirror keys … minting registration tokens and MCP keys"
  - `spec/BATON_SPEC/11-people.md:353` — "`owner.mcp-key.create`, `owner.mcp-key.revoke` (R-BTN-130) | an approver on `approvers.members` |"
  - `spec/BATON_SPEC/14-api.md:135` — "| `POST /v1/owner/{repository}/mcp-keys`, `…/mcp-keys/{name}/revoke` | an approver on `approvers.members` (R-BTN-188) |"
  - `spec/BATON_SPEC/12-security.md:982` — "Tightening, such as adding a hold or a bar, is open to any owner credential, MCP keys included"
  - `spec/BATON_SPEC/11-people.md:155` — "mint and revoke registration tokens (R-BTN-117) and MCP keys (R-BTN-130)" (an owner's powers, unqualified)
- **The problem:** the knob's own enumeration governs minting tokens and MCP keys and registering sync keys and check-runners; the CLI table and §14 put the revocations behind the same list. Under `[human]`, an owner who sees a leaked `bmcp_` key, a registration token pasted into a transcript, or an OAuth grant "listed with `client_addr` and revocable" (`OAUTH:535`) cannot revoke it without the hardware key — the one tightening the spec's own principle says any owner credential may do. The dashboard cannot either ("The credential … screens are read-only"). An implementer following the knob row and one following the CLI table build different `authorize` results.
- **Counter-reading considered:** "granting or revoking runner keys" shows the knob can cover revocation where it means to, so the omission for the other four may be deliberate or a slip; either way the table and the knob disagree. Searched `revoke` in R-BTN-188 and R-BTN-186.
- **Smallest fix:** make the four revocations (`owner.mcp-key.revoke`, `owner.token.revoke`, `owner.sync-key.revoke`, `owner.check-runner.revoke`) callable by `owner` in R-BTN-127's table and §14, or add them to the knob's description and say why a tightening is gated.

### PPL-11: the CLI takes an origin from a repository file and then sends a bearer key there
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-127 (Homes, Keys), R-BTN-159, R-BTN-137, R-BTN-56, R-BTN-158
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:286` — "`add` with `--checkout` reads the origin from the checkout's `.baton/baton.json` `baton_url`, R-BTN-56, and refuses an `--origin` that differs; without one, `--origin` is required"
  - `spec/BATON_SPEC/11-people.md:289` — "The home in force … supplies the repository a command's omitted `<repository>` names and the one a bare ticket id is read in, and the origin a missing `--url`/`BATON_URL` calls."
  - `spec/BATON_SPEC/11-people.md:71` — "`baton … -i FILE`, `BATON_KEY_FILE` and `BATON_KEY` send it."
  - `spec/BATON_SPEC/11-people.md:76` — "No client sends a bearer over non-loopback `http` (R-BTN-158)."
  - `spec/BATON_SPEC/11-people.md:283` — "A home is a convenience, never a boundary: it grants nothing, and every request is still signed and checked as without it."
- **The problem:** `.baton/baton.json` is a file any pusher or agent writes. `baton home add ops --repository ops --checkout ~/src/ops` stores whatever `baton_url` the checkout holds; with `--origin` given, a differing value is refused in favour of the file. From then on a command in that home with no `--url` calls that origin. For an SSH key that costs nothing (the signature is bound to `@authority`). For an API key given by `-i`, `BATON_KEY_FILE` or `BATON_KEY` — which, unlike `keys.json`, are not per-origin — the CLI sends `Authorization: Bearer bak_…` to the attacker's `https` host, and "an API key works for whoever reads it until it is revoked". The only bearer rule is about `http`.
- **Counter-reading considered:** `keys.json` "offers only the called origin's" keys, so a mapped key is safe; the leak needs `-i` or environment keys, which R-BTN-159 names as the ways to send one. `--home <path>` ("read as its checkout") takes the origin from the file with no stored step at all. Searched `baton_url` across the spec: R-BTN-137 covers runners' origins, nothing covers a person's bearer.
- **Smallest fix:** R-BTN-127: a bearer key is sent only to an origin `keys.json` or `origins.json` already pairs with that key's fingerprint, or one given by `--url`/`BATON_URL`; `home add --checkout` prints the origin it read and asks, and an explicit `--origin` wins or the command exits 2.

### PPL-12: "nothing changes authority from a cookie" is false of the OAuth approval, and the Decision that accepts it predates bars
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-155, §11.4, R-BTN-172 §5, OAuth Decisions, R-BTN-129, R-BTN-67
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:683` — "The credential, governance and tenant screens are read-only, each naming the CLI command that changes what it shows: nothing changes authority from a cookie (R-BTN-155)"
  - `spec/BATON_SPEC/11-people.md:566` — "an OAuth request, its status, a denial or an approval naming no destructive action (`BATON_MCP_OAUTH_SPEC` §5)" (in the not-confirmed list)
  - `OAUTH:536` — "The cost is that a stolen session can mint a read and hold grant that outlives it, the exposure R-BTN-155 already accepts for an API-key owner"
  - `OAUTH:313` — "(`ticket.hold`, `ticket.unhold`, `leg.stop`, `ticket.cancel`, `owner.bar.add`, `owner.bar.lift`, a read id)"
  - `spec/BATON_SPEC/11-people.md:542` — "A session's request that changes authority answers `202 {confirm_code}` instead of acting"
- **The problem:** minting an MCP key is an `approvers.members` action, and the session does it from a cookie with one click, no code, unless the grant names `leg.stop` or `ticket.cancel`. The accepted cost was written when the non-destructive set was `read` and `ticket.hold`; since 2026-11-02 it also holds `owner.bar.add`, which is not in §12.2's destructive list. Trace: a same-user process reads the cookie jar (R-BTN-155 grants this), posts `/v1/ui/oauth/requests` and `/approve` itself with a forged `Origin` for a `bdc_` client on a loopback redirect it listens on, ticking `read`, `ticket.hold`, `owner.bar.add`. It now holds a refreshable 90-day grant that survives logout, `owner sessions revoke` and the session's 4 hours, reads the repository, and can bar every tag from every course — a bar whose lift is an `approvers.policy` act. The session itself could do none of the bar part: no session action adds a bar.
- **Counter-reading considered:** the exposure is the owner's decision (2026-10-20) and a cookie thief can already Stop and Cancel for 4 hours. The decision names "a read and hold grant"; nothing re-took it for bars, and the main spec's sentence stays contradicted. Under a human-only `approvers.members` no session approves at all, so the hole is `cooperative`'s. Searched `owner.bar.add` in §12.2 and the companion.
- **Smallest fix:** reword §11.4's sentence to name the one exception; require R-BTN-155's code for an approval naming any write other than `ticket.hold` (or add `owner.bar.add` to §12.2); update the Decision to the current set; end a session's grants with `owner sessions revoke`.

### PPL-13: an unauthenticated party can evict a registered client between its registration and the owner's sign-in
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-172 §3, §5, §10
- **Confidence:** medium
- **Evidence:**
  - `OAUTH:411` — "At most 500 in the tenant. One with no grant within 24 hours is deleted; at the cap a registration drops the oldest client with neither a grant nor an open request, else is `429`."
  - `OAUTH:397` — "register 20 an hour"
  - `OAUTH:208` — "Without a session the page shows nothing about the client, fetches no document and writes no row."
- **The problem:** a request row — the only thing that protects a fresh client from eviction — is written only once an owner's session exists. Trace: hosted Claude falls back to dynamic registration and gets `bdc_X`; the owner's browser lands on the consent page signed out and starts R-BTN-155's sign-in (a CLI round trip, a minute or more). An attacker registers clients from 25 or more addresses (20 an hour each; the limit is per IPv6 `/64`): at the cap each registration "drops the oldest client with neither a grant nor an open request" — `bdc_X` among them. The owner finishes signing in, presses Check again, and step 1 fails "unknown or invalid `client_id`". Sustained, no dynamically registered client can connect; no credential is needed.
- **Counter-reading considered:** Claude prefers Client ID Metadata Documents, so registration is the fallback path, and the cap bounds storage. But the spec keeps it "for clients that lack the newer mechanism" and says Claude "falls back to it", and S-BTN-137(4) tests only the benign eviction. Searched `registered clients`, `drops the oldest` in §10–§11.
- **Smallest fix:** §10: never drop a client younger than 10 minutes (answer `429` instead), or let the signed-out consent page's first call mark the client "seen" without a session.

### PPL-14: R-BTN-159's bearer route list and §2.3's admission rule disagree with the routes API keys and sessions are given
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-159, §2.3 Admission, R-BTN-181, R-BTN-199, R-BTN-16, §14
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:68` — "`Authorization: Bearer <key>` in place of a signature, on `/v1/admin/*`, `/v1/owner/*`, `/v1/runner/*`, the repository reads and `GET /v1/actions`"
  - `spec/BATON_SPEC/02-deployments.md:268` — "A signed route (`/v1/runner/*`, `/v1/repositories/*`, `/v1/probe/*`, `/v1/owner/*`, `/v1/admin/*`) with no or a malformed signature, a stale `created` or a foreign `@authority` is refused before the object"
  - `spec/BATON_SPEC/14-api.md:111` — "| `POST /v1/repositories/{repository}/attestations` | an owner key or an owner session (writer `owner`), a `human_only` key, or a `service` key (R-BTN-181)"
  - `spec/BATON_SPEC/11-people.md:54` — "Role, grants and revocation never depend on the kind."
  - `spec/BATON_SPEC/12-security.md:191` — "A session's reads outside `/v1/ui/*` … are authenticated by Baton alone, the cookie and nothing in front of it"
- **The problem:** (1) §2.3 has the Worker refuse any request on `/v1/owner/*`, `/v1/admin/*`, `/v1/runner/*`, `/v1/repositories/*` "with no … signature" before the object — which refuses every API key R-BTN-159 admits there and every session read B-192 puts on `/v1/repositories/*`. (2) R-BTN-159 admits a bearer on "the repository reads" only, but two writes live under `/v1/repositories/`: `POST …/attestations` (does an API-key owner answer a person's leg with `baton decision answer`?) and `POST …/sequences/{kind}/next` (does an API-key runner get a ticket number?). Reading A: a bearer there is `unauthenticated` ("a bearer on a route its kind never reaches"); reading B: "never depend on the kind". S-BTN-126 ("bearers on their own routes only") decides neither.
- **Counter-reading considered:** "signature" in §2.3 may be shorthand for "credential". It then says nothing an implementer can build the Worker's pre-check from, and the bearer list is still short two routes. Searched `bak_`, `Bearer` in §2 and `attestations` in R-BTN-159.
- **Smallest fix:** R-BTN-159: "on every route its role's signature is accepted on, except `/v1/sync/*`, `/v1/probe/*` and `/v1/runner/outbox/*`"; §2.3: "no signature, API-key bearer or session cookie".

### PPL-15: the instance setting `human_key` has no setter, no column and no route
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-185, R-BTN-57, R-BTN-127, §13.1, §14
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/12-security.md:938` — "`human_key: any | hardware` (an instance setting, default `any`, which a repository's policy may raise for itself, R-BTN-188)"; `:941` — "Switching to `hardware` suspends every `human_only` key registered before the switch that does not meet it."
  - `spec/BATON_SPEC/11-people.md:108` — "set the instance settings `link_hosts`, `session_hosts` and `check_app_id` (R-BTN-112, R-BTN-113, §12.7)"
  - `spec/BATON_SPEC/11-people.md:365` — "`admin settings set [--link-hosts …] [--session-hosts …] [--check-app-id <id>] [--recommended-client <version>]`"
  - `spec/BATON_SPEC/13-data-model.md:51` — "| `instance_settings` | one row | `link_hosts` JSON, `session_hosts` JSON, `recommended_client` …, `check_app_id`"
  - `spec/BATON_SPEC/14-api.md:160` — "| `PUT /v1/admin/settings` | admin | `{link_hosts?, session_hosts?, check_app_id?}` |"
- **The problem:** an action with no stated authorisation. The switch suspends human-only keys tenant-wide and is the floor under every repository's `human_key`, yet no principal, command, route or column carries it. Reading A: it is `admin.settings.set` — then an ordinary administrator key lowers `hardware` to `any` and un-suspends keys, weakening every repository that relies on the instance value. Reading B: it is host configuration beside `BATON_HUMAN_KEYS` — then §2's configuration table should list it. The same rows show two smaller drifts: `--recommended-client` is in the CLI and §13.1 but not in §14's body or Rules cell, and the companion's `oauth_redirect_uris` is in none of the three.
- **Counter-reading considered:** `human-gates` holds only when "the repository's `human_key` is `hardware`", which could mean the effective value; then lowering the instance value silently breaks a floor, which R-BTN-189 refuses only for a policy change, and this is not one. Searched `human_key` in §2, §11, §13, §14: no hit outside §12.
- **Smallest fix:** name the setter in R-BTN-185 (host configuration, or `admin.settings.set` signed by a `human_only` break-glass key), add the column or configuration row, and say that a change which would break a repository's floor is refused.

### PPL-16: what `api_keys: false` does to an OAuth grant, and whether a removed redirect URI still works, each have two readings
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-172 §4, §7, §9; R-BTN-130
- **Confidence:** medium
- **Evidence:**
  - `OAUTH:377` — "While it stands, access tokens are refused (`401` with the challenge) and refreshes and code exchanges are `invalid_grant`, so a client discards its tokens and the owner re-consents once the setting returns; the grant row is not ended, and idles out."
  - `OAUTH:300` — "Everything R-BTN-130 and R-BTN-154 say of an MCP key — a delegated key within R-BTN-186 — holds for it"
  - `spec/BATON_SPEC/11-people.md:448` — "It is refused while the repository has `api_keys: false` (R-BTN-159), and works again when the setting returns, unless expired."
  - `OAUTH:184` — "Any other registered URI is `https`, with no userinfo or fragment, at most 512 characters, and listed exactly in `oauth_redirect_uris`"
  - `OAUTH:135` — "cached by its exact URL, deployment-wide … and a re-fetch that fails or is over §10's budget serves the last valid copy for up to 7 days"
- **The problem:** (1) "the grant row is not ended" and no token is marked: if the setting returns within the access token's hour, or before the client next refreshes, the grant resumes — "re-consent" is a client habit, not a rule; meanwhile the grant keeps its name and its place in the 50-grant cap for up to 7 days, and whether a refused refresh consumes the presented token (so the next presentation is "reuse") is not said. §7's "everything … holds for it" and §9's "unlike a grant" contradict each other on resumption. (2) When an administrator removes a URI from `oauth_redirect_uris`, is the allowlist checked at registration or document validation only, or at every authorization request? A stored `bdc_` client and a cached document (up to 24 hours, 7 days stale) keep the old URI under the first reading.
- **Counter-reading considered:** §4's step 2 "matches one of the client's" plus "Any other registered URI is … listed" can be read as a live check; it can equally be read as the registration-time form check §3 calls "§4's form". Searched `oauth_redirect_uris` and `api_keys` in the companion.
- **Smallest fix:** §9: `api_keys: false` ends every OAuth grant of the repository (or: a refused refresh leaves the token unused); §4 step 2: "and, unless loopback, is in `oauth_redirect_uris` as it stands now".

### PPL-17: administrators "read everything", but two reads and three CLI rows leave them out
- **Severity:** low
- **Kind:** contradiction
- **Rules:** R-BTN-57, R-BTN-127, R-BTN-120, §12.1, §14
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:113` — "read everything, including any claim's leg runs (R-BTN-128)"
  - `spec/BATON_SPEC/14-api.md:94` — "| `GET /v1/repositories/{repository}/tickets/{ticket}/prerequisites` | machine granted there, owner, session |"
  - `spec/BATON_SPEC/11-people.md:310` — "`leg.why`: `GET …/tickets/{ticket}/prerequisites` (R-BTN-120) | owner, or runner granted on the repository" (likewise `:316` `ticket blocked`, `:317` `ticket history`)
  - `spec/BATON_SPEC/14-api.md:58` — "*reader*: a key granted on the repository, an owner of it, or an administrator"
- **The problem:** `ticket.history` and `ticket.blocked` are reader routes in §14 (administrator included) and "owner, or runner granted" in the CLI table; `leg.why` excludes the administrator key in both, while an administrator's session may call it. Since the CLI "signs as its actions' `callers`, in order", `baton ticket history` with only an administrator key exits 2 under the table and succeeds under §14.
- **Counter-reading considered:** the table's "Signs as" may be abbreviated. `check:actions` compares registry, routes and this table, so one of them fails the check.
- **Smallest fix:** add "or administrator" to the three CLI rows and to §14's prerequisites row.

### PPL-18: `set_by` is one column for a ticket's whole override row, and the `own` test reads it
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-130, R-BTN-12, §13.6
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/13-data-model.md:160` — "| `ticket_overrides` | `ticket_id` | `expedite`, `hold`, `hold_reason` (…), `cancelling_at` (…), `route_leg`, `route_station`, `override_kind` (`owner`\|`baton`), `set_by`, `set_at` |"
  - `spec/BATON_SPEC/11-people.md:455` — "An `own`-marked action succeeds only on what the key itself set: a hold whose `set_by` is `mcp:<id>`"
- **The problem:** the row carries expedite, hold, route and the cancel flag under one `set_by`. If any later write to the row rewrites it: an owner's expedite or route on a ticket the key held turns the key's hold into "another's"; and the key's own `ticket.cancel` on a ticket an owner holds — a delegated write to the same row — would stamp `set_by: mcp:<id>`, after which `ticket.unhold` by the key passes the `own` test on the owner's hold. Which writes touch `set_by` is nowhere said.
- **Counter-reading considered:** `set_by` may be meant as "who set the hold" only; the column's position after `route_*` and `override_kind` suggests the row. Searched `set_by` in §6, §11, §12.
- **Smallest fix:** name the column `hold_set_by` (written only by the write that sets `hold` from 0 to 1), or state that in R-BTN-12.

### PPL-19: the companion's statements about the main spec that have drifted
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-172, R-BTN-130, R-BTN-155, §11.4, §13.2, §14, S-BTN-102
- **Confidence:** high
- **Evidence and problem, one line each:**
  - `OAUTH:5` "updated: 2026-10-20" and `OAUTH:16`, while `OAUTH:533` and `:549` record changes "since 2026-11-02"; `OAUTH:546` "Chose a challenge naming all three scopes" (there are now `read` plus six ids).
  - `OAUTH:242` — "the page polls `POST /v1/ui/oauth/status {request}` every 2 seconds" against `spec/BATON_SPEC/11-people.md:650` — "the one exception is the confirmation-code dialog, which polls its screen's reads every 5 seconds for the code's two minutes": a second exception, a different interval, for the same confirmation code.
  - `OAUTH:445` — "a repository the session does not own | `not-found`" against `spec/BATON_SPEC/11-people.md:652` — "a repository the caller cannot read — or none — answers `forbidden` for every principal".
  - `OAUTH:391` — "the owners' listing keeping `revoked_at` until then" and `OAUTH:323` "Owners list grants with their keys: client host, minter, `client_addr` and approval time", against `spec/BATON_SPEC/14-api.md:116`'s `mcp_keys: [{name, minted_by, actions, expires_at, last_used_at, client_host?, client_addr?}]` — no `revoked_at`, no approval time, and no `id`, though `set_by: mcp:<id>` is what a hold shows.
  - `OAUTH:460` adds `ended_at` to `mcp_keys` while `spec/BATON_SPEC/13-data-model.md:87` — "the OAuth spec's §12 row, folded in" — lists `revoked_at` and none of `client_id`, `client_addr`, `approved_session`, `approved_at`, `ended_at`.
  - `OAUTH:258` — "`client_addr` on the grant (§7) and the owners' listing are the defence": whose address (the owner's browser, or the token endpoint's caller, which for hosted Claude is the shared `160.79.104.0/21`) is never said; either way it does not tell an owner whose Claude account holds the grant.
  - `spec/BATON_SPEC/15-verification.md:249` (S-BTN-102) expects "`mcp:<name>`" for a `leg.stop`'s actor, where `spec/BATON_SPEC/11-people.md:460` says "The actor is recorded as `mcp:<id>` in history and release messages, shown with its name".
  - `spec/BATON_SPEC/13-data-model.md:68` and `spec/BATON_SPEC/01-what-baton-is.md:251` cite R-BTN-117 for `api_keys`; R-BTN-117 (`08-runners.md:159–174`) never mentions it — the rule is R-BTN-159's (`11-people.md:83`).
  - R-BTN-172, S-BTN-137 and G-BTN-157 are in no row of `spec/BATON_SPEC.md`, though R-BTN-155 (`11-people.md:559`), R-BTN-16 (`12-security.md:198`), §2.3 (`02-deployments.md:276`) and R-BTN-47 (`03-repositories-and-forges.md:35`) already depend normatively on the companion, whose status is "proposal".
- **Counter-reading considered:** B-73 is to fold the companion in, so some lag is expected; each item is a place where the two documents give an implementer different answers today.
- **Smallest fix:** correct each line; index the three ids with the companion as their file.

### PPL-20: R-BTN-197's 14-day notice is a property of every deployment that no deploy can check
- **Severity:** low
- **Kind:** unverifiable
- **Rules:** R-BTN-197, S-BTN-227
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:411` — "A change that raises `min` to a version lands only once `recommended` has been that version or higher on the deployment for at least 14 days."
  - `spec/BATON_SPEC/11-people.md:399` — "`min` is the oldest client whose requests the deployed code still reads: a constant in Baton's code"
- **The problem:** `min` is a code constant shared by every tenant and local host that deploys the release; `recommended` is each deployment's own setting and deploy date. "The deployment" has no referent at merge time, nothing records since when a `recommended` has stood, and S-BTN-227 tests none of it. Also unstated: what `recommended` reads when a deploy's `min` exceeds an administrator's stored value.
- **Counter-reading considered:** it is a process rule for the one production deployment (architecture: "there is no staging instance"). R-BTN-56/87 allow other Batons and the local host.
- **Smallest fix:** make it observable in the build, or mark it a release-process rule outside the gates.

### PPL-21: `MCP-Protocol-Version` absent defaults to a revision the build need not serve
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-130
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:464` — "Revisions are those in the build's `MCP_VERSIONS` (at least `2025-06-18`). `initialize` needs no `MCP-Protocol-Version` header; on any other request an absent header means `2025-03-26`, and a revision not in the list is `400`."
- **The problem:** if `MCP_VERSIONS` is exactly the guaranteed `["2025-06-18"]`, a request without the header "means `2025-03-26`", which is "not in the list" → `400` for every header-less call; or the default is served although unlisted. The endpoint is stateless, so it cannot fall back to the revision `initialize` negotiated.
- **Counter-reading considered:** the list may always include `2025-03-26`; the rule only guarantees `2025-06-18`.
- **Smallest fix:** "at least `2025-03-26` and `2025-06-18`", or "an absent header is served as the oldest listed revision".

### PPL-22: rules with no scenario, and a control the threat model claims that no rule states
- **Severity:** low
- **Kind:** unverifiable
- **Rules:** R-BTN-57, R-BTN-127, R-BTN-197, §15
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:128` — "`baton admin github-app create --org <org>` creates the tenant's own App (§12.7) by GitHub's manifest flow." Steps 1–4 follow (loopback listener, 128-bit `state`, exactly one callback, the `owner.login`, permissions and webhook checks). The word "manifest" does not occur in `spec/BATON_SPEC/15-verification.md`: no scenario or gate exercises any step.
  - `docs/security-model.mdx:194` — "the CLI refuses an owner or administrator key when it runs from a git working tree (a `.git` at or above it, above npm's `node_modules` boundary …) without `--dev`". The spec's only trace is `spec/BATON_SPEC/11-people.md:394` — "a CLI run from a git working tree (B-138's `--dev`, a runner following a branch) adds `+dev`". No rule in §11 states the refusal, `--dev` is in no row of R-BTN-127's tree, and no scenario tests it.
  - `spec/BATON_SPEC/11-people.md:517` — "the CLI then reports how many rows the address made and lost in the last two minutes": on `not-found` there is no row, so "the address" has no referent, and no route in §14 returns such a count.
- **Smallest fix:** a scenario for the manifest flow's refusals; a bullet under R-BTN-57 stating the working-tree refusal, with its scenario; define the count's address and the field that carries it, or drop the sentence.

### PPL-23: `wind-down` and the scope acknowledgement are session actions §11.4's lists never mention, and an owner's wind-down reaches other repositories' work
- **Severity:** low
- **Kind:** underspecified
- **Rules:** §11.4 (The actions), R-BTN-155, R-BTN-58, §6.9, §14
- **Confidence:** medium
- **Evidence:**
  - `spec/BATON_SPEC/11-people.md:674` — "Unconfirmed, a session views, holds, cancels, stops a leg (…), resyncs a repository (`POST /v1/ui/resync`), requests status, resolves a condition and answers a person's leg from the Conditions screen"
  - `spec/BATON_SPEC/14-api.md:172` — "Wind down is `{kind: "wind-down"}` (B-109) | `{id}`; `forbidden` for a `release` whose ticket `to_runner_id` does not hold, or for an owner's session, a runner holding no claim of its repositories"
  - `spec/BATON_SPEC/06-prerequisites-blocks-advice.md:580` — "`wind-down` (B-109) — an owner's ask that a worker drain: … it exits without claiming again"
  - `spec/BATON_SPEC/11-people.md:148` — "owning one repository confers nothing on another"
- **The problem:** a runner granted on repositories `a` and `b` holds one claim on `a`. An owner of `a` alone, from a session, with no code, sends `wind-down`: the runner process drains and exits, and `b` loses its worker. Neither R-BTN-155's unconfirmed list nor "The actions" names the action (nor `POST /v1/ui/scope/{id}/resolve`), no registry id is given for it, and no CLI row exists, against R-BTN-186's "available on every surface".
- **Counter-reading considered:** Stop already lets that owner end the claim on `a`; wind-down only adds the exit. The exit is the cross-repository part.
- **Smallest fix:** name `runner.wind-down` and `scope.resolve` in §11.4's lists and the CLI tree; say whose runner an owner may wind down.

---

## Read but found sound

- **PKCE, code binding and redirect handling (companion §4, §8).** `S256` only, 43-character challenge, code bound to `client_id`, `redirect_uri`, challenge and resource, errors never redirected before client and redirect validate, exact-match redirects with an administrator's allowlist, loopback port-agnostic per RFC 8252, `iss` returned: no open redirect, downgrade or code-injection path found. Optional `state` is acceptable with mandatory PKCE.
- **Refresh rotation with 60-second siblings.** Walked thief-first, client-first and concurrent orders: every theft is detected at the next use of the other branch.
- **Token audience and passthrough.** Opaque tokens, looked up per call, accepted only on `POST /v1/mcp` at their origin; Baton forwards no token; no ID tokens; no confused-deputy shape.
- **`SameSite=Strict` with a static consent page.** The claim that the page's own `fetch`es are same-site after a cross-site top-level navigation is correct; `__Host-` cookies cannot be planted, so no session fixation through the pending cookie; framing and opener are closed.
- **Sign-in by code.** Role cannot be crossed, the preview shows the address before binding, a fresh session id is issued at the poll; the residual (a relayed code from the same NAT address) is stated.
- **Session lifetime against revocation.** Checked per request against the minting key's role; owner removal, administrator revocation, repository retirement and `BATON_ADMIN_KEYS` removal each end or shrink it.
- **Text, never markup.** Every dashboard and consent-page value is a text node; links pass R-BTN-92 or an administrator's host list, so no `javascript:` URL; the redirect the consent page follows is server-validated; no image or logo is fetched; `client_name` loses bidi and zero-width characters.
- **R-BTN-13's signature profile.** Components, parameters, the SSHSIG namespace split from `git`, the 5-minute window against the 11-minute nonce cache: consistent with §13.2 and §2.3.
- **MCP tool naming.** `.` → `_` is injective because ids never hold `_`.
- **Numbers that agree across §11, §12, §13, §14 and the companion:** session 4 h; pending sign-in and confirmation code 2 min; MCP key 90 / 30 days and 7 idle; API-key runner 90 days and 7 idle; nonce 11 min; 600 authenticated calls a minute; 60 MCP calls a minute; `426` for `client-too-old`; `401`/`403`/`405` on `/v1/mcp`; the destructive set in §12.2, R-BTN-155 and the companion.
- **Last-owner and first-administrator bootstrap.** `BATON_ADMIN_KEYS` and `BATON_HUMAN_KEYS` are host configuration; "never the last" for an owner and "the last owner included" for an administrator are consistent, with `seed_owners` reporting the gap.

## Not covered

- R-BTN-146 (grant acceptance and spans), R-BTN-93/R-BTN-114 (sync keys, check-runners) and R-BTN-180 (roles, domains) were read only where §11 cites them, not attacked.
- R-BTN-112's `ui` renderer (which elements a course-supplied view may produce) is §5's; I checked only that §11.4 routes every non-text value through it or the link rule.
- `worker_pushers` / `mirror_pusher` hold forge logins (`13-data-model.md:67`), which a forge lets a user rename and another take — the reassigned-identity angle — but both are §12.9's and §16's and I did not follow them.
- The companion's SSRF bound for Client ID Metadata Documents on the Cloudflare host rests on "Cloudflare's `fetch` reaches public addresses only"; I could not verify that and did not count it.
- Whether hosted Claude's popup flow survives the consent page's `Cross-Origin-Opener-Policy: same-origin` is the companion's own open question; not evaluated.
- `spec/BATON_SPEC_HISTORY.md` was grepped for the three companion ids only.
- `docs/security-model.mdx` was skimmed by keyword (MCP, session, keys, dashboard), not read line by line.
- Line numbers for quotes inside very long table rows and for a few multi-line quotes were taken from `grep -n` or the Read offsets and may be off by one or two lines; the quoted text itself was copied from the files.
