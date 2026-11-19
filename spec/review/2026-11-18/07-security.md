---
title: "Adversarial review 2026-11-18 — §12: security"
description: "One reviewer's findings, as filed, on BATON_SPEC §12 read as each attacker of the security model."
order: 16
tags: [review]
---

# Adversarial review 2026-11-18 — §12: security

Reviewer pass: §12 read whole (lines 1–1036); `docs/security-model.mdx` and `docs/context/architecture.mdx` read whole. Home rules followed: R-BTN-13, -14, -15/-156, -16, -32, -55, -56, -57, -58, -62, -66, -73/-95, -88, -93, -94, -102, -117, -129, -130, -133, -135, -136, -137, -139, -144, -146, -152, -155, -159, -190, -194, and `BATON_MCP_OAUTH_SPEC.md` §1–§12 and Decisions.

Paths are relative to `spec/BATON_SPEC/` unless they start with `docs/` or `spec/`.

### SEC-1: A pusher rolls an owner-signed control input back (or brings a never-landed signed commit into force) by choosing the merge's parent order
- **Severity:** critical
- **Kind:** security
- **Rules:** R-BTN-66 (owner-signed control inputs), R-BTN-133, R-BTN-13, S-BTN-219; security model mitigation C
- **Confidence:** medium (spec text in hand, no saving rule found; the walk's exact algorithm lives in code the brief excludes)
- **Evidence:**
  - `01-what-baton-is.md:280-283` — "\"The commit that last changed it\" is read along the default branch's first parents, so a merge whose result differs from its first parent on a control path is that merge's change, never a rollback to an older signed version."
  - `08-runners.md:527-530` — "the runner recomputes the group walk at the claim's snapshot (round 2) and refuses a `read` that disagrees, so an old on-branch signed commit — the rollback the first-parent rule exists to prevent — never loads on a record's word."
  - `08-runners.md:525-527` — "verifies each named commit's `git`-namespace SSHSIG (R-BTN-13) against the owner keys the answer carries — Baton's own, never the post's choice — that the commit is an ancestor of the claim's snapshot, and that it is the commit the walk itself names"
  - `04-tickets-syncs-board.md:437-438` (R-BTN-11) — "Baton accepts a snapshot only when `parent_sha` equals its head … and its observation is newer, then moves the head."
  - `docs/security-model.mdx:362-363` — "history is read along first parents so a crafted merge cannot roll a control input back to an older signed version (B-127, reproduced in the review)"
- **The problem:** a merge's parent order is the committer's choice, so the pusher of the newest merge chooses the default branch's first-parent chain.
  - Setup, with `require_signed_control` on: the tip is `T`; `O` is an older owner-signed commit on `T`'s first-parent line that set `agent_command` (or a leg script, or `rank.mjs`) to `v_old`; a later owner-signed `S` set it to `v_new`.
  - A pusher (a compromised runner under `cooperative`) creates merge `M` with parents `(O, T)`, `O` first, and a tree equal to `T`'s except that the group's paths are as at `O`.
  - `M` descends from `T`, so the push is a fast-forward; the sync's post has `parent_sha == T` and Baton accepts it (R-BTN-11).
  - The walk from `M` goes `M → O → …`. `M` does not differ from its first parent `O` on the control path, so it is not `M`'s change; the newest change on that line is `O`, owner-signed.
  - The sync's record names `O`; every runner recomputes the walk and gets `O` too; `O` verifies and is an ancestor. `v_old` is in force, no `unsigned-control` notice is raised, and `S` is skipped.
  - With `X` in place of `O` — an owner-signed commit on a branch that never landed — `M = (X, T)` puts a never-accepted version in force. The signature covers the commit object, not that it was ever the default branch's history.
- **Counter-reading considered:** "the default branch's first parents" might mean a walk that must pass through Baton's previous head. Nothing says so. I searched `first.parent`, `rollback`, `memory-free`, `previous head` across `spec/BATON_SPEC/*.md`; the only statements are those quoted. The model says "the memory-free walk remain B-137's" (`docs/security-model.mdx:373-374`), so today's walk keeps no memory of earlier heads. S-BTN-219 (`15-verification.md:175`) tests "an old owner-signed commit on the snapshot's own line (round 2)" and "a signed commit off the branch" only as lies in a stored record, never as a crafted merge whose own first parent is the old commit. Under `protected` the forge refuses the push, but signed control is the mitigation for repositories where runners push the default branch (`baton` itself, public, no push ruleset: `docs/security-model.mdx:334-336`).
- **Smallest fix:** in R-BTN-66 and R-BTN-133, define the walk relative to the previously accepted head: a head whose first-parent chain does not contain the head it replaces is itself an unsigned change to every group whose paths differ between the two. Baton stores every head, so the claim answer can carry it. Add the swapped-parent merge and the never-landed signed commit to S-BTN-219.

### SEC-2: The brief's `signed` mark is whatever the board post says; nothing but the posting sync verifies it, and under `cooperative` any granted machine key posts the board
- **Severity:** high
- **Kind:** security
- **Rules:** R-BTN-66, §4.4 (B-127's marks), R-BTN-194, R-BTN-102, R-BTN-188 `inputs.board`, R-BTN-93/-15; security model reach 3, reach 7, option 10
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:585-588` — "Each ticket's `brief` — `{signed, signer?, commit}`, marked whether or not the repository requires signed control — is stored with the ticket and served with the claim answer, so a privileged session's first sight of a brief is whose words it is; an unsigned one is a claim, not the owner (the standing harness rule)."
  - `04-tickets-syncs-board.md:603-605` — "The sync computes both where the git objects are, with the owner keys served by the observation (never read from the repository it is judging); B-137 moves the verification server-side over the raw commits."
  - `01-what-baton-is.md:293-295` — "The sync computes the marks and the record where the git objects are; B-137 moves the verification over the raw commits server-side — until then the runners' own verification is what a lying post cannot pass."
  - `12-security.md:367` — "`inputs.board` — who may post the board, from `sync-key`, `ci-identity`, `machine` | all three | `[sync-key, ci-identity]`"
  - `03-repositories-and-forges.md:234-235` — "Whoever can push the default branch can post any board for it — a legitimate user (R-BTN-66); the token proves only default-branch origin."
  - `docs/security-model.mdx:445` — "Owner statements are verifiable: a `**Brief:** the owner` line counts only in a commit signed by an owner key … a forged brief is visibly a claim, not the owner"
- **The problem:** the runners' own verification (R-BTN-133) covers the four control groups a runner loads. No rule has a runner, Baton or the reading session verify a brief's mark.
  - A compromised runner holds its machine key. On a new repository (`cooperative`, `inputs.board` admits `machine`) it takes an observation number and posts a board in which its injected ticket carries `brief: {signed: true, signer: <an owner key's public fingerprint>, commit: <any sha>}`.
  - Baton stores it and serves it with the claim answer; `baton ticket show` "prints them first" (`04-…:638-639`).
  - The owner's privileged session, told by the standing rule that only an unmarked or `unsigned` quote is a claim, reads the forged `**Brief:** the owner …` as the owner's.
  - The same works through the CI identity for anyone who can push the sync's code.
  - This is reach 3's privileged-reader case, rated critical by the model, with the one mitigation aimed at it inverted: the mark now vouches for the forgery.
- **Counter-reading considered:** the security model admits the precondition ("provided the signature is verified by Baton and by each runner rather than by the sync that posts it … Without those, it is computed by the attacker", `docs/security-model.mdx:360-364`) and lists server-side verification as B-137's. But the spec states the mark's meaning unconditionally and names runner verification as what "a lying post cannot pass", which is true of control groups and false of briefs. `baton.machine-post` (`08-runners.md:129-132`) notices closed tickets, dropped bars and loosened gates, not brief marks. Searched `brief` across all sections: no verification of the mark outside the sync; S-BTN-218 tests only its shape.
- **Smallest fix:** until B-137, say in §4.4 and R-BTN-66 that a brief mark is the posting credential's claim and serve it with the snapshot's `posted_by` class. Alternatively have the reading CLI verify the named commit's SSHSIG against the owner keys Baton serves, as R-BTN-133 does for groups, before printing "signed". Add the lying mark to S-BTN-218.

### SEC-3: `require_signed_control` promises agent configuration, goals and `EXPEDITE` count only when owner-signed, but only four runner-loaded groups are ever verified by anything but the sync
- **Severity:** high
- **Kind:** contradiction
- **Rules:** R-BTN-66, R-BTN-133, §4.4 `control` record, R-BTN-12; security model reach 1, mitigation C
- **Confidence:** high for agent configuration; medium for goals and `EXPEDITE`, which the model partly concedes
- **Evidence:**
  - `01-what-baton-is.md:274-277` — "its **control inputs** — `.baton/**`, goal files, the `EXPEDITE` tag and agent configuration (`.claude/**`, every `CLAUDE.md` and `AGENTS.md`, MCP and plugin manifests) — count only at a commit carrying a valid SSHSIG"
  - `01-what-baton-is.md:283` — "An unsigned change keeps the last owner-signed version in force"
  - `04-tickets-syncs-board.md:548-549` — "`control?: { keys: [<fingerprint>], groups: { agent_command, overrides, rank,` … `course`"
  - `08-runners.md:521-524` — "the claim answer's `control` names, per group, the commit a runner loads `agent_command` (with `agent_wrapper`, both in `.baton/baton.json`), the overrides (`legs/<leg>.run.mjs`), `rank.mjs` (R-BTN-98) and the course's leg scripts with their instruction files"
  - `08-runners.md:518` — "R-BTN-133 (a leg runs in a read-only checkout of its commit)."
  - `docs/security-model.mdx:178-183` — "Claude Code loads and executes what a repository carries: `.claude/settings.json` hooks … the plugins it enables … `.claude/skills/`, `.claude/memory/` and every `CLAUDE.md`."
- **The problem:** there is no group, and no runner step, for agent configuration.
  - A leg's harness starts in a checkout of the snapshot commit and loads `.claude/settings.json`, hooks, `.mcp.json` and `CLAUDE.md` from it.
  - Trace, setting on: a pusher pushes an unsigned `.claude/settings.json` with a session-start hook; the honest sync lists the path under `unsigned`; the next leg's checkout is the snapshot, and the harness runs the hook.
  - Nothing "keeps the last owner-signed version in force" for those paths, because nothing loads them from a named commit.
  - For goal files and `EXPEDITE` the "last signed state" is what the sync posts (`06-prerequisites-blocks-advice.md:545-548`), so a pusher who can post the board (SEC-2) posts the unsigned state as signed.
  - The rest of `.baton/**` (`sync.mjs`, `tickets.mjs`, an owned `course.json`, `baton.json`'s other fields) is likewise ungated.
- **Counter-reading considered:** "count" might mean only "the sync marks them", with enforcement left to B-137. But `:283` says the signed version stays in force, R-BTN-133 claims a lying post "changes what a runner refuses, not what it runs", and the model's C says it "Closes: the configuration half of 1", whose text names agent configuration as rated critical. Searched `agent configuration`, `.claude/`, `CLAUDE.md` in every section but §12: only R-BTN-66's list and R-BTN-190's leg-state layout mention them.
- **Smallest fix:** add an `agent_config` group to the control record and have the runner materialise those paths from the group's signed commit before starting the harness, refusing the claim when it cannot. Or cut agent configuration, goals and `EXPEDITE` from what R-BTN-66 says the setting enforces, and say they are noticed only, by a sync a pusher controls.

### SEC-4: PR-conversation text — a non-pusher's comment included — reaches the fix and adjudicate legs' models with no rule that quotes or filters it, against §12's "Content is data"
- **Severity:** high
- **Kind:** security
- **Rules:** §12 (preamble), §12.3 *Models*, R-BTN-139, R-BTN-190, R-BTN-131; security model reach 3
- **Confidence:** medium (the spec is silent; a course's own instruction files may say more, but §12 states the property as a rule)
- **Evidence:**
  - `12-security.md:10-11` — "These rules keep people **without** push from gaining anything."
  - `12-security.md:28-29` — "**Content is data.** Text from git, runners and forges reaches a model only as quoted data and a screen only as text (§12.3)."
  - `12-security.md:164-166` — "**Models.** Profiles, reports, readings' `detail`, course fields, resume records, hand-off documents and an earlier claimant's text reach a model only as quoted data, in their own file, never in instructions (R-BTN-144, R-BTN-152)."
  - `05-courses.md:999-1002` — "**`forge`**, on GitHub, GitLab and Gitea … the rounds are the PR's conversation, on whichever forge holds the PR, as R-BTN-131's PR courses already read and write it, and the rules below about the leg-state branch do not apply."
  - `05-courses.md:1030-1031` — "**Read as data, never checked out.** What a leg reads there reaches a model only as quoted data (§12.3)" (said of the `git` leg-state branch only)
  - `03-repositories-and-forges.md:478-480` — "**Words that count only from pushers:** verdict lines, adjudication and conclusion lines, forge review states and approvals, and every `baton:` marker"
  - `docs/security-model.mdx:230-232` — "BATON_SPEC §12.3 keeps forge and runner text as quoted data, but the ticket is not quoted data: it is the instruction."
- **The problem:** §12's preamble claims more than §12.3 delivers.
  - §12.3's list names seven runner-supplied kinds. It names no forge text and no git text (ticket body, leg instructions, `## Status` progress lines — see SEC-9).
  - R-BTN-139 decides which forge words count for a station, not which a leg's model reads.
  - On a forge, the review rounds a `fix` or `adjudicate` leg works from are the PR conversation, and R-BTN-190's quoting rule is limited to the `git` side branch.
  - Trace (a forge user without push, on a public home such as `baton`): comment on an open agent PR with a fake "reviewer finding" telling the leg to add a deploy key to a workflow and push to `main`. It carries no marker, so R-BTN-139 neither counts nor hides it. The `fix` leg reads the conversation and receives it beside the real findings, with the runner's forge credential in its environment (`08-runners.md:647`).
- **Counter-reading considered:** the course's `legs/fix.md` may tell the agent to read only pushers' reviews, and the model accepts "a pushed ticket can instruct the runner" as residual risk. That residual is about pushers; a non-pusher's text is accepted nowhere, and the preamble's sentence is a flat rule with no scenario or gate. Searched `non-pusher`, `outsider`, `quoted data`, `as data`, `injection`: only the hits quoted.
- **Smallest fix:** in R-BTN-190's `forge` bullet (or R-BTN-131), require that the runner hand a leg the PR conversation through the fact adapter's `pusher` filter, in a data file as `BATON_RESUME` is. Narrow §12's preamble to what §12.3 lists, and state that the ticket body and leg instructions are instructions.

### SEC-5: Signed-key clients may use a plain-`http` origin, where nothing authenticates Baton's answers — yet every §12.8 guarantee rests on "its own authenticated connection"
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-158, R-BTN-13, R-BTN-14, R-BTN-189 (*The read*), R-BTN-182, R-BTN-133
- **Confidence:** high
- **Evidence:**
  - `12-security.md:211-217` — "**Bearers never cross `http`.** The CLI and the runner refuse to send a bearer to a non-loopback `http` origin; that is the control. … an `http` listener refuses every bearer … and accepts SSH-signed requests from any peer"
  - `12-security.md:284-286` — "Baton signs no outbox entry and no policy read, publishes no signing key, a trusted runner pins nothing and acts on Baton's record as Baton gives it"
  - `12-security.md:479-481` — "A trusted runner reads it over its own authenticated connection and acts on it as Baton's: Baton's server is trusted (§12.8), so the read is signed by nothing and pinned by nobody"
  - `11-people.md:28-29` — "Components, exactly: `@method`, `@authority`, `@path`, `@query` and `content-digest`"
  - `08-runners.md:59-61` — "every later runner call presents the secret in `X-Runner-Secret`, signed or API-key alike"
- **The problem:** an RFC 9421 request signature authenticates the client to Baton and nothing in the other direction.
  - R-BTN-158 lets a signed runner, trusted runner or owner CLI use a non-loopback `http` local host.
  - A network attacker there cannot forge requests but can answer them: a claim answer naming any `snapshot_sha` on the branch, the `control` record and the owner keys the runner verifies it against (`08-runners.md:525-526`), a policy read saying `cooperative`, and attestations a merge runner re-checks "against Baton's record".
  - The runner secret also crosses in clear: it is neither a listed bearer nor a signature component.
  - So "authenticated connection" holds only under TLS, and no rule requires TLS of a signed client.
- **Counter-reading considered:** "TLS is the operator's" (`:208`), and a deployment relying on guarantees would use `https`. But the spec names the client-side refusal as "the control" for bearers and omits signed clients; R-BTN-182/-189 state trust in the connection as a property, not a deployment precondition; and it is absent from §12.8's "Outside every guarantee, stated exactly" list. Searched `http` in §12 and R-BTN-13/-137: no refusal for signed clients.
- **Smallest fix:** R-BTN-158: the CLI, runner, sidecar and sync refuse any non-loopback `http` origin, signed or not. List "a runner that reaches Baton without TLS" in §12.8's exclusions. Say the runner secret is a bearer for R-BTN-158.

### SEC-6: An administrator opens every human gate by sealing, editing the unsigned export and importing it — "a human gate, for administrators too" has no rule behind it on that path
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-188 (*Approvers*), R-BTN-189 (floors), R-BTN-88, R-BTN-57, R-BTN-185
- **Confidence:** medium (needs an empty target Baton, which the operator provisions)
- **Evidence:**
  - `12-security.md:392-395` — "an action whose list is human-only is a **human gate**, for administrators too: an administrator performs it only with a `human_only` key the list admits."
  - `12-security.md:460-462` — "Baton refuses any policy change after which a guarantee the list **in force before the change** names would not be met, `floor-violated` naming the guarantee, whoever asks"
  - `04-tickets-syncs-board.md:767-768` — "`digest` is SHA-256 over the RFC 8785 canonical JSON of the rest."
  - `04-tickets-syncs-board.md:779-781` — "An import refuses a live repository whose policy versions do not chain by `previous_hash` from version 1, or whose export holds no policy"
  - `04-tickets-syncs-board.md:786-789` — "**Import** (`POST /v1/admin/import`): one transaction, into an **empty** Baton only … digest checked (`invalid-params`) … Every row passes the write path's validation and invariants (one role per key, unique names, id grammars, tombstones only on retired rows)"
- **The problem:** the export is integrity-checked by a bare hash and the policy log is an unsigned hash chain, so whoever edits the file can recompute both.
  - An administrator key (an API key or plain SSH key is allowed, `11-people.md:92-93`; it "carries no `human_only` mark") freezes, seals and exports a tenant whose repository holds `protected-hardware` with floors.
  - It edits `repository_policies` to one chained version 1 that is `cooperative` with no floors — or keeps the policy and edits `repository_owners`, `runner_grants` role, domain and `accepted_at`, or the `human_only` marks in `credentials`.
  - It recomputes `digest` and imports into the fresh Baton of step 6 ("an abandoned move is finished by importing into a fresh Baton at the source's origin").
  - The listed import invariants check none of: which credential and approver class made each policy version, that role and domain rows were set by an admitted approver, or that the import equals what was sealed.
- **Counter-reading considered:** the operator is the root of trust and provisions the target, and a compromised server is out of scope. But the administrator is a Baton principal distinct from the operator (R-BTN-136), and in the multi-tenant case "the operator provisions the target; the tenant's administrator runs R-BTN-88's freeze, seal, export and import" (`02-deployments.md:165-167`). §12.8's exclusion list names the server and the Cloudflare account, not the administrator key. Searched `import` in §12 (`:227-228`, `:718-720`) and `human` in R-BTN-88: nothing.
- **Smallest fix:** R-BTN-88: an import carrying any repository whose policy has a human-only `approvers.*` list or a non-empty `floors` requires a `human_only` signature over the export's digest (the break-glass key suffices). Or add "an administrator's import" to §12.8's exclusions if the owner accepts it.

### SEC-7: Who revokes a `human_only` key — "only with a `human_only` key" (R-BTN-185) or "an administrator revokes any key" (R-BTN-57)?
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-185, R-BTN-57, §12.2, R-BTN-188 (`approvers.members`), R-BTN-189 `human-gates`
- **Confidence:** high
- **Evidence:**
  - `12-security.md:934-935` — "any is revoked only with a `human_only` key."
  - `11-people.md:102-105` — "revoke any key at once but an administrator's: revoking an owner key removes it from every repository it owns, the last owner included … unless it would leave an approver list unsatisfiable (`unsatisfiable-approvers`, R-BTN-188)"
  - `12-security.md:352` — "`approvers.members` — adding or removing owners; granting or revoking runner keys"
  - `11-people.md:100` — "make or change any grant … an `approvers.members` action (R-BTN-188), `forbidden` where that list is human-only"
- **The problem:** a `human_only` mark is "carried by an owner key" (`12-security.md:77-78`).
  - By R-BTN-57, `admin.key.revoke` on such a key is allowed whenever another key still satisfies the lists; by R-BTN-185 it is not.
  - The revoke also "removes it from every repository it owns" — removing an owner, an `approvers.members` action that R-BTN-57's previous bullet makes `forbidden` to an administrator under a human-only list. The revoke bullet has no such clause.
  - Under the R-BTN-57 reading, a non-human administrator key removes human owners down to the last one and revokes any trusted runner's or the checker's key.
  - Under the R-BTN-185 reading, a leaked human-only key that is the tenant's only one can be revoked by nobody but itself or break-glass.
- **Counter-reading considered:** `human-key.revoke` and `admin.key.revoke` are different actions (§12.2 lists both), so R-BTN-185 could bind only the former. Then "any is revoked only with" is false as written and the administrator has a route round a human gate. Searched `human-key.revoke`, `admin.key.revoke`, `revok` in §11 and §12: nothing reconciles them.
- **Smallest fix:** in R-BTN-57's revoke bullet, make `admin.key.revoke` `forbidden` when it names a `human_only` key or an owner key of a repository whose `approvers.members` is human-only. Or state the opposite in R-BTN-185 as the administrator's emergency revoke, and narrow `human-gates`' promise.

### SEC-8: A WebAuthn assertion is and is not a human gate, and nothing specifies it
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-185, §12.1 (Human-only key row), §13 `webauthn_credentials`
- **Confidence:** high
- **Evidence:**
  - `12-security.md:947-949` — "The dashboard may only prepare an approval that the CLI signs; a WebAuthn assertion is a human gate only with an authenticator registered by a `human_only` signature, attested and allowlisted under `hardware`."
  - `12-security.md:955-957` — "A dashboard session minted by a `human_only` key is an owner's session (`owner`, R-BTN-181), never `human`: a human gate is opened by the key's own signature alone, so no session, and no OAuth approval by one, satisfies a human-only `approvers.*` list."
  - `12-security.md:52` — "never through a session, which is `owner` (R-BTN-185)"
  - `13-data-model.md:142` — "`webauthn_credentials` | `(owner_key, credential_id)` | `cose_key`, `aaguid`, `attestation`, `registered_by_signature` | Attested authenticators a `human_only` key registered (R-BTN-185, proposal)"
- **The problem:** a WebAuthn assertion is made in a browser, over a dashboard session. One sentence makes it a human gate; two say no session ever is, and that "the key's own signature alone" opens one.
  - If the first holds, an implementer has no route, no challenge format, no statement of what the assertion signs, no `rpId` or origin rule, no user-verification requirement, and no writer class (`human` is defined as "a `human_only` key", `:629`).
  - A WebAuthn gate whose challenge is not the approval's canonical fields is replayable across approvals by the page that asked for it.
- **Counter-reading considered:** the sentence may be a forward reservation. But the data model already carries the table, and the principal table and `authorize` have no principal for it, so a builder must ignore a specified table or invent the protocol. Searched `webauthn`, `assertion`, `authenticator`: these lines only.
- **Smallest fix:** delete the WebAuthn clause and the `webauthn_credentials` row until designed (the "Remove until designed" precedent, `:853`). Or specify it: route, challenge = SHA-256 of the canonical fields the CLI would print, UV required, `rpId` the tenant host, writer `human`.

### SEC-9: `tickets-approved` promises no ticket change without a human approval, while R-BTN-184 lets every claim append 6 KB of free prose to its ticket unapproved
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-189 (`tickets-approved`), R-BTN-184 (*A leg's own progress*), R-BTN-183, §12.3; security model core guarantee 2
- **Confidence:** high for the contradiction; medium for the injection
- **Evidence:**
  - `12-security.md:445` — "`tickets-approved` | no ticket or goal changes, and no ticket a runner creates is filed, without a human approval of that file"
  - `12-security.md:914-921` — "**A leg's own progress** needs no approval: a claim's branch may append to its own ticket file … Each entry is one line, `- <UTC time> <leg> <claim nonce>: <text>` … the text at most 300 bytes of letters, digits, spaces and `.,;:-'()?!`, no URL; at most 20 entries per claim. Readers show these lines as the leg's data."
  - `docs/security-model.mdx:70-72` — "The brief and frontmatter stay human-approved, since a brief reads as the owner's instruction."
- **The problem:**
  - (a) The guarantee's promise, which a deployment reads by name, has no exception; R-BTN-183 has one ("the own-progress exception aside", `:876`). A consumer of `tickets-approved` is told something false.
  - (b) The content rule keeps out markup and URLs, not meaning. Twenty lines of 300 letters is ample for a fake "owner decision" telling the next leg to change a workflow and push it.
  - No rule says which reader treats `## Status` lines as quoted data. "Readers show these lines as the leg's data" names no reader and no mechanism, and §12.3's *Models* list omits them.
  - A ticket re-claimed n times takes 20n lines; there is no per-ticket cap.
  - So under `protected` a compromised runner still writes instructions into an approved ticket, landed by the merge runner with no human.
- **Counter-reading considered:** the decision (`91-decisions.md:21`) chose this knowingly as "checkable at merge, as one-line plain-text entries". Checkable form is not inert content, and the decision does not amend the guarantee's wording. Searched `## Status`, `own progress`, `own-progress`: R-BTN-184, R-BTN-183, S-BTN-184 and ticket-tooling rules in §4.
- **Smallest fix:** add "a claim's own progress lines aside (R-BTN-184)" to `tickets-approved`'s promise. Cap entries per ticket. State the reader rule where it binds: the runner hands a leg its ticket with `## Status` entries moved to `BATON_RESUME`, and `baton ticket show` prints them under a "runner-written" heading.

### SEC-10: CI identity tokens: the spec names the claims to compare and nothing about verifying the JWT itself
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-15 / R-BTN-156, R-BTN-93, R-BTN-135, R-BTN-136, §2.1; G-BTN-11, G-BTN-145
- **Confidence:** high
- **Evidence:**
  - `03-repositories-and-forges.md:217-223` — "**GitHub Actions OIDC**, verified in the Worker: issuer `https://token.actions.githubusercontent.com`; audience `BATON_ORIGIN`; `repository_id` and `repository_owner_id` equal the stored ids; `ref` is the default branch; `job_workflow_ref` is … `event_name` is `push`, `schedule` or `workflow_dispatch`."
  - `03-repositories-and-forges.md:224-226` — "verified only against a `gitlab_issuer` listed in `BATON_FORGE_SECRETS` (keys at `<issuer>/oauth/discovery/keys`, never fetched from a token's own `iss`)"
  - `02-deployments.md:19-20` — "The Worker fetches CI identity key sets and verifies CI tokens"
  - `02-deployments.md:139-140` — "caches of public data keyed by the exact URL fetched (a CI key set by its key-set URL, never its issuer's name)"
  - `14-api.md:51` — "`unavailable` | 503, retryable: a CI key set the forge could not serve"
- **The problem:** an implementer must choose, and reasonable choices differ in whether the route is forgeable or freezable.
  1. The accepted `alg`: nothing says "RS256 only; `none` and HMAC refused". Contrast R-BTN-13, which says "`expires` and `alg` are refused".
  2. `exp`, `nbf`, `iat` and tolerated skew are not mentioned (searched `` `exp` ``, `nbf`, `skew`, `expir` near every token rule). R-BTN-13 gives the signed-request window to the minute.
  3. The GitHub key-set URL is not given (GitLab's is), nor that it is never taken from the token.
  4. Cache lifetime and behaviour on an unknown `kid`: refetching on every unknown `kid` lets any outsider make the Worker fetch the forge's JWKS per request (CI tokens "count in none" of the failure buckets, `02-deployments.md:290`); never refetching turns a key rotation into a sync outage.
  5. Whether one token may be presented more than once within its life (`jti`).

  None has a scenario: G-BTN-11 and G-BTN-145 cover branch, workflow and event claims only.
- **Counter-reading considered:** "verified" implies a standard JOSE verification. But the spec spells out every parameter of R-BTN-13's signature and leaves the comparable facts absent here. The test seam ("fake OIDC tokens signed by a test key … trusted only by the test bindings in `vitest.config.ts` and never by the deployed Worker", `15-verification.md:16-18`) has no gate. R-BTN-136 lists "the OIDC issuer and key-set URL" as host values (`02-deployments.md:169-170`), so the GitHub issuer is configurable where R-BTN-15 calls it fixed.
- **Smallest fix:** one bullet in R-BTN-15: the algorithm taken from the key, never the header, `RS256` (and what GitLab signs) only; `exp` required, `nbf`/`iat` not in the future, skew 60 s by `this.now`; key sets fetched only from fixed URLs, cached N minutes, an unknown `kid` refetching at most once a minute per URL. Say whether the GitHub issuer and key-set URL are constants or host configuration, and add a gate that no production binding names the test key set.

### SEC-11: The principal table and the bearer rule omit the OAuth surface, and three rows cite the wrong rule or omit a credential
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** §12.1, R-BTN-172 (`BATON_MCP_OAUTH_SPEC`), R-BTN-73/-95, R-BTN-156, R-BTN-14, R-BTN-158
- **Confidence:** high
- **Evidence:**
  - `12-security.md:54` — "Public | `POST /v1/login`, the dashboard shell's three assets — its page, its one script, its one stylesheet | none | start a sign-in"
  - `02-deployments.md:278-279` — "`/.well-known/oauth-*` and `/v1/oauth/*` take no credential and fall under the per-IP rule"
  - `12-security.md:86-87` — "**Bearer secrets** — API keys (`bak_`), registration tokens (`brt_`), MCP keys (`bmcp_`), pending sign-ins (`bps_`) and dashboard sessions (`bds_`)"
  - `spec/BATON_MCP_OAUTH_SPEC.md:455-456` — "Hashes only (`BATON_SPEC` §12.1's bearer rule), which adds `bmo_`, `bmr_` and `bor_`."
  - `12-security.md:45` — "record a sync want for its own repository (R-BTN-156)"
  - `12-security.md:41` — "Trusted runner | … | SSH-signed, on a grant with the `trusted-runner` role (R-BTN-180)" (no runner secret; the runner and check-runner rows say "plus the runner secret")
  - `12-security.md:214-215` — "refuses every bearer (API keys, MCP keys, registration tokens, the dashboard cookie)"
- **The problem:** "A row's powers are stated once, in the rule it cites" (`:35-36`), but §12.1 read as the list of who reaches Baton misses five unauthenticated routes (`register`, `token`, `revoke`, two discovery documents), a principal (an OAuth access token on `POST /v1/mcp`) and three bearer kinds. R-BTN-156 is the CI-identity rule; a notification's want is R-BTN-73/-95's. R-BTN-158's bearer list omits `bps_` and `bmo_`/`bmr_`. Whether a trusted runner presents `X-Runner-Secret` has two readings.
- **Counter-reading considered:** the OAuth spec is a companion and "adds" its rows. But the table presents itself as complete, and R-BTN-144's masking list (`08-runners.md:659-660`) carries the three prefixes, so §12.1 is what drifted.
- **Smallest fix:** add the OAuth rows and prefixes to §12.1, or one line pointing at `BATON_MCP_OAUTH_SPEC` §12–§13 as part of the table. Cite R-BTN-95 in the notification row. Say "plus the runner secret" for the trusted runner, or say why not.

### SEC-12: `§7.1` is cited four times for B-127's marks and control record, which live in §4.4; §7.1 is "Raising a condition"
- **Severity:** low
- **Kind:** stale-reference
- **Rules:** R-BTN-13, R-BTN-66, R-BTN-133
- **Confidence:** high
- **Evidence:**
  - `11-people.md:39` — "The sync verifies them to mark what counts (§7.1)"
  - `01-what-baton-is.md:287` — "only from the commits the board post names (§7.1, R-BTN-133)"; `:292` — "with its provenance (§7.1)"
  - `08-runners.md:546` — "A group's read is atomic (§7.1)"
  - `07-conditions.md:29` — "### 7.1 Raising a condition"; `04-tickets-syncs-board.md:585` — "**B-127's marks and record.**" (under `### 4.4 The board post`)
- **The problem:** a reader following R-BTN-13's signature rule to "what counts" lands in conditions. Two other §7.1 citations (`03-repositories-and-forges.md:363`, `04-tickets-syncs-board.md:379`) also do not match §7.1's subject and want checking by that span's reviewer.
- **Counter-reading considered:** none; the heading is unambiguous. Probably the docs-era numbering.
- **Smallest fix:** replace with `§4.4` in the four places.

### SEC-13: Which keys sign control — every owner key, or only the human-only register's?
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-66, R-BTN-133, R-BTN-13, R-BTN-185, §4.4; security model mitigation C
- **Confidence:** medium
- **Evidence:**
  - `01-what-baton-is.md:277-280` — "by an owner key of the repository that no agent session holds: the human-only register's (R-BTN-185), which is what an owner-signed commit accepts and nothing else — an API-key owner cannot sign, and a key an agent session holds would let an injected session sign."
  - `08-runners.md:525-526` — "against the owner keys the answer carries — Baton's own"
  - `04-tickets-syncs-board.md:604` — "with the owner keys served by the observation"
  - `15-verification.md:175` — "a non-owner key's signature, an owner's later signature … an owner key registered between a post and a claim"
  - `12-security.md:929` — "**The human-only key** is an SSH key registered `human_only`, used for nothing else"
  - `12-security.md:388-389` — "registering a `human_only` key with the tenant (R-BTN-185) makes it an owner of nothing."
- **The problem:** R-BTN-66 restricts the verifying set to `human_only` owner keys; R-BTN-133, §4.4 and S-BTN-219 speak of "owner keys" and test only owner versus non-owner.
  - Wider reading: an owner's agent session holding a plain SSH owner key signs a control change and it counts — the injected-session case R-BTN-66 excludes, and what the model calls the difference between a human gate and none (`docs/security-model.mdx:38-40`).
  - Narrower reading: a repository with no `human_only` owner key that turns the setting on has an empty verifying set and no claim is ever handed out; and R-BTN-185's "used for nothing else" is false, since the key signs commits in the `git` namespace.
  - Whether a break-glass `BATON_HUMAN_KEYS` line, owner of nothing, signs control is unstated.
- **Counter-reading considered:** "owner keys" in R-BTN-133 may be shorthand for R-BTN-66's set. No scenario separates a plain owner key's signature from a `human_only` one's, so the tests pass under either reading.
- **Smallest fix:** name the set once in R-BTN-66, cite it from R-BTN-133 and §4.4, refuse turning the setting on while the set is empty, and add the plain-owner-key signature to S-BTN-219.

### SEC-14: Credentials an owner's agent minted before a list became human-only keep working after it
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-188 (*Making `approvers.roles` human-only*), R-BTN-117, R-BTN-146, R-BTN-130, R-BTN-189 `human-gates`
- **Confidence:** medium
- **Evidence:**
  - `12-security.md:409-411` — "**Making `approvers.roles` human-only** clears every role, mark and domain set by a credential the new list does not admit"
  - `12-security.md:352` — "`approvers.members` — adding or removing owners; granting or revoking runner keys; … minting registration tokens and MCP keys"
  - `12-security.md:447` — "`human-gates` | no owner's agent session, and no delegated key, changes membership, roles or the policy"
  - `08-runners.md:162-166` — "`--uses` default 1, at most 100; TTL default 7 days, at most 30 days. … creates a runner credential with a grant inside the token's scope"
- **The problem:** roles get a clearing rule; membership does not.
  - While `approvers.members` is still `[owner]`, an injected owner session mints a 100-use, 30-day registration token, and leaves pending grants and owners it added.
  - The human then applies `protected-hardware`. For 30 days the token creates runner credentials with grants on the repository — membership changing with no human — and the agent-added owners stay owners.
  - Two readings: such tokens, pending grants and owners are voided at the switch, as roles are; or they stand. `human-gates` reads as the first; nothing implements it.
  - The gain is bounded (an ordinary `runner` grant with no domain, which the guarantees already assume hostile), hence low.
- **Counter-reading considered:** the `dry_run` answer lists "what the new values would stop" (`:331-339`) and names no tokens, which suggests they stand by design. Then `human-gates`' promise needs "for acts started after the switch".
- **Smallest fix:** extend the clearing bullet to `approvers.members`: unexpired registration tokens and never-accepted grants minted by a credential the new list does not admit are revoked in the same transaction, and the dry run lists them.

### SEC-15: `no-runner-lands` broken on a repository with no `floors`: does the merge runner keep merging?
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-189, R-BTN-180 (*Only the protection checker's report counts*), R-BTN-182
- **Confidence:** medium
- **Evidence:**
  - `12-security.md:466-470` — "Floors bind policy changes and are judged on the policy alone: the protection report is not a policy condition, so a lapsed or failed report never refuses a change. It breaks `no-runner-lands` all the same: Baton raises `baton.unprotected` and stops the repository (below), and every trusted runner stops acting on it, except the protection checker"
  - `12-security.md:471-472` — "**A broken floor stops the repository, in Baton.** While a guarantee `floors` names is broken, Baton offers and accepts no claim or advance"
  - `12-security.md:370` — "`floors` … | no value: an applied preset never writes it"
  - `12-security.md:454-456` — "The `protected` preset holds all but `human-gates`, and `no-runner-lands`, with every guarantee that includes it, only once the protection checker has reported a match"
- **The problem:** the stop is defined for "a guarantee `floors` names". A team that applies `protected` and sets no floor has `merge` as a trusted leg and no rule that the trusted runner stops when the checker never reported, reported a mismatch, or went silent for 24 hours.
  - Reading A: the sentence at `:468-470` is general — any `baton.unprotected` stops trusted runners.
  - Reading B: it is a sub-bullet of *Floors* and applies only where a floor names the guarantee. Without one, the merge runner merges on a repository whose ruleset was just deleted, with only a `notify` condition.
  - R-BTN-182's "re-checks at the moment it acts" lists attestations, not the protection report.
- **Counter-reading considered:** "A consumer reads the `floors` list and the computed `guarantees`" (`:464-465`) suggests guarantees without a floor are informational by design. Then `protected` alone promises nothing about landing, against the preset's stated purpose (`:16-18`).
- **Smallest fix:** state in R-BTN-182 that a trusted runner acts on a repository only while the policy read shows `no-runner-lands: held` whenever `merge.trusted` is true, floors or not. Keep the claim/advance stop for floors.

### SEC-16: A delegated key's actions have grown past what the OAuth decision weighed; a stolen four-hour session mints a 90-day bar-and-hold credential with no confirmation
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-155 (*Confirmed actions*), R-BTN-186, R-BTN-172 §5/§7, R-BTN-188 `approvers.members`
- **Confidence:** high
- **Evidence:**
  - `spec/BATON_MCP_OAUTH_SPEC.md:532-538` — "Chose approval of `read` and `ticket.hold` without R-BTN-155's confirmation code … The cost is that a stolen session can mint a read and hold grant that outlives it, the exposure R-BTN-155 already accepts for an API-key owner"
  - `spec/BATON_MCP_OAUTH_SPEC.md:312-313` — "(`ticket.hold`, `ticket.unhold`, `leg.stop`, `ticket.cancel`, `owner.bar.add`, `owner.bar.lift`, a read id)"
  - `11-people.md:570-571` — "the confirmation keeps a stolen session from an authority-changing act only while the minting key needs a touch"
  - `91-decisions.md:239` — "nothing changes authority from a cookie"
- **The problem:** the decision's stated cost is "a read and hold grant". Since B-166 the unconfirmed set also holds `owner.bar.add`, and a bar stops a leg or tag for the whole repository.
  - A process that reads the owner's cookie jar registers its own `bdc_` client, approves itself, and holds for up to 90 days a credential that reads the repository, holds every ticket and bars every leg. Refresh tokens rotate without the session.
  - This is an `approvers.members` action with no key involved.
  - "The exposure R-BTN-155 already accepts for an API-key owner" is not this case: the session's key may be touch-required, which is exactly when the confirmation is said to protect.
- **Counter-reading considered:** accepted by the owner for `read` and `ticket.hold`, bounded, listed and revocable. The finding is that the acceptance was recorded for a narrower set than the rule now admits.
- **Smallest fix:** confirm any approval naming `owner.bar.add`, or amend the decision to name the wider set.

### SEC-17: R-BTN-187's "per-key limits" carry no number, and the security model's reach 8 describes a rule R-BTN-62 no longer states
- **Severity:** low
- **Kind:** unverifiable
- **Rules:** R-BTN-187, R-BTN-62, R-BTN-149; security model reach 8
- **Confidence:** high
- **Evidence:**
  - `12-security.md:993-994` — "per-key limits on observation numbers, board posts and concurrent claims, so one key can freeze neither the board nor the leases."
  - `04-tickets-syncs-board.md:412-414` — "Another credential's request voids a number idle over 5 minutes; the same credential's after 10 minutes. Any other credential's request voids a number 30 minutes after issue, renewals included"
  - `04-tickets-syncs-board.md:425-428` — "A credential that lets two numbers lapse within an hour takes none on that repository for an hour"
  - `docs/security-model.mdx:295-297` — "an outstanding number blocks other syncs until it lapses after ten idle minutes (R-BTN-62), so one key can freeze a board."
- **The problem:** R-BTN-187's third bullet is a MUST with no observable: no limit, no refusal code, no scenario.
  - It applies only where `inputs.board` excludes `machine` — where a machine key cannot take an observation number at all, so the observation half is vacuous.
  - Under `cooperative` a machine key still holds the board against other machine keys indefinitely without lapsing: take a number, renew for up to 30 minutes, `release` it (voided, not lapsed, so the two-lapse bar never triggers), take the next. Only a sync key or CI identity "voids at once".
  - The model's "ten idle minutes" matches neither figure.
- **Counter-reading considered:** R-BTN-62 and R-BTN-4's `max_claims` may be the "per-key limits" meant. Then R-BTN-187 should cite them instead of promising new ones under a condition that makes them moot.
- **Smallest fix:** replace the bullet with citations (R-BTN-62's bar, R-BTN-4's `max_claims`, §2.3's 600 a minute), count a release after more than N minutes of holding toward the bar, and correct reach 8.

### SEC-18: Under `human_key: hardware`, nothing says Baton checks the user-verification flag on each signature
- **Severity:** low
- **Kind:** underspecified
- **Rules:** R-BTN-185, R-BTN-13
- **Confidence:** medium
- **Evidence:**
  - `12-security.md:939-941` — "`hardware` accepts only a hardware-backed key requiring PIN and touch (`verify-required`) whose FIDO attestation matches an allowlist of authenticators."
  - `11-people.md:42-43` — "An `sk-` signature must carry the user-presence flag; its counter is not checked."
- **The problem:** OpenSSH's `verify-required` is enforced by the verifier checking the UV bit of each signature's flags; the authenticator will sign with presence only if the client asks. R-BTN-13 checks presence only, and R-BTN-185 states a property of the key, not a check.
  - Reading A: Baton refuses a `human_only` signature without UV under `hardware`.
  - Reading B: it checks the registration attestation once. A process with the key handle then needs one unexplained touch, not the PIN — and the "short code … typed on the machine the key is plugged into" (`:946-947`) is CLI behaviour the server cannot see.
- **Counter-reading considered:** a touch is still a human act, and the machine is specified to be driven by no agent. But the PIN is what `hardware` adds over `any` with an `sk-` key; without a per-signature check it adds nothing server-side.
- **Smallest fix:** R-BTN-185: under `hardware`, a `human_only` signature whose flags lack user verification is `unauthenticated`.

## Earlier review (`docs/review/security-review-2026-11-02.mdx`) — checked after this pass

- **Its should-fix findings, against today's text:**
  - S1 (masking list): fixed. `08-runners.md:659-671` masks every Baton bearer prefix, the OAuth ones included, and provider keys by name (class 7).
  - S2 (`checks` conclusions): fixed in form. `10-checks.md:49-52` restricts conclusions to `success | failure | timed_out` and notes that `neutral` passes a GitHub required check. I did not re-verify the loosening rule's wording there; it is outside my span.
  - S3 (no fence-clear): fixed. `12-security.md:97` lists `claim.fence-clear`, and `09-claims.md:212-222` gives the administrator's act.
- **Overlap with this file:** none of SEC-1 to SEC-17 appears in that review. SEC-18 is adjacent to its S8 (`sk-` counters, not taken) but concerns the UV flag. Its S7 (the sign-in address preview) is now specified (`11-people.md:511-516`); I found that flow sound.

## Read but found sound

- **Signed requests (R-BTN-13):** fixed component and parameter sets, `alg`/`expires` refused, SSHSIG namespaces separating request and commit signatures; the 11-minute nonce cache covers the ±5-minute `created` window; `@authority` binds the tenant. No replay or cross-tenant reuse found over TLS (see SEC-5).
- **Same-site (R-BTN-16):** a sibling origin's request does carry the `SameSite=Strict` cookie, but writes need JSON plus an exact `Origin`, reads are refused on a foreign `Origin` or `Sec-Fetch-Site`, there is no CORS, and CORP, `nosniff` and `frame-ancestors` cover the rest; `__Host-` stops shadowing. The OAuth consent page keeps these rules.
- **Dashboard sign-in (R-BTN-155):** nothing in a URL or command line becomes a session; binding needs the key and shows the client address first; an owner's code cannot become an administrator's session.
- **Tenancy (R-BTN-135/-137), a second tenant:** origin-bound credentials, host-checked routing before any object, per-tenant secrets and Apps, caches keyed by exact URL. Registering another tenant's forge repository yields nothing: Baton holds no forge write credential and CI tokens are audience-bound.
- **Forge notifications (R-BTN-73/-95):** only a want, a provenance record that must chain `before`/`after`, and a scope finding; constant-time MACs, body cap before digest. A replayed delivery does nothing new.
- **Delegated keys (R-BTN-186/-130), a stolen MCP token:** one rule, derived marks, `own` tested on an immutable id, no attestation, no resolve, no loosening.
- **Owner's agent under human-only lists:** every loosening, adopt, role, member and policy change routes to `approvers.*`; `ticket.route` and condition restarts cannot make the merge runner act, since it re-checks attestations at the exact head.
- **Attestations (R-BTN-181/-183):** bound by subject and head, writer from the credential, two-way check of trusted legs' writers against the policy; one approval cannot land two merges. *How runs compare* resists self-independence by re-listing or re-domaining.
- **Independent review:** laundering a foreign commit into another domain's range gains the attacker nothing unless it is itself a granted reviewer, which §12.8's first exclusion already states.
- **Policy change mechanics (R-BTN-188/-189):** the list in force decides, unsatisfiable lists are refused, floors are judged before the change, roles are cleared on tightening.
- **Rendering (§12.3):** text nodes only, one link rule for client and server, CSP `default-src 'self'`.

## Not covered

- §12.3's individual grammars (identifier regexes, URI forms, marker encoding) were read but not tested against their home rules (R-BTN-82, -92, -112, -113).
- R-BTN-171 (the outbox), R-BTN-114/-115 (check-runners, the check App), R-BTN-116 (person legs) and R-BTN-39 (adopt) were followed only as far as §12's sentences about them. The `baton/proposed/*` delivery path and the check App's read-back were not attacked.
- §12.9 (a leg's scope) was read; its `worker_pushers` cross-check was not traced into R-BTN-73's delivery fields.
- R-BTN-184's computed floor of protected paths was not tested for bypasses (case-folding, workflow `uses` resolution, files it does not list such as `.husky/` or `package.json` scripts).
- `spec/BATON_SPEC_HISTORY.md` was not searched for retired ids cited in §12.
