---
title: "Adversarial review 2026-11-18 — the refutation pass"
description: "Verdicts of four fresh reviewers asked to refute the first pass's high-severity findings from the spec's own text: none refuted, a third narrowed."
order: 30
tags: [review]
---

# Adversarial review 2026-11-18 — the refutation pass

Four fresh reviewers were given the first pass's critical and high findings (and five medium ones on §15) with one instruction: refute each from the spec's own text, or say honestly that you could not. Their verdicts, as filed. Paths are relative to the repository root or to `spec/BATON_SPEC/`.

## Security, people and forges

Defence pass on 10 findings. Seven survive in full or nearly so (SEC-1, SEC-3, PPL-1, PPL-2, FND-2, DEC-1 confirmed; SEC-2, SEC-4, PPL-3, FND-1 confirmed but narrower). None was refuted. Nothing was run, created or modified; SEC-1's code trace is from reading only.

### SEC-1 — CONFIRMED
- **Severity after review:** high (critical as filed; see the last bullet)
- **Quotes checked:** all accurate.
- **Searched for:** `first.parent`, `rollback`, `head-moved`, `previous head`, `B-137` across `spec/BATON_SPEC/*.md`; R-BTN-66, R-BTN-11, R-BTN-143, R-BTN-133, R-BTN-147, S-BTN-219, open questions and decisions; `docs/security-model.mdx` reach 7 and mitigation C; `src/defaults/signed-control.ts`, `src/runner/runner.ts:1803-1880`, `test/unit/signed-control.test.ts`, `test/integration/S-BTN-219.require-signed-control.test.ts`.
- **Reasoning:**
- **Spec trace holds.** R-BTN-11 (`04-tickets-syncs-board.md:431-434`) asks only that `parent_sha` equal the head; M descends from T, so the post is accepted. R-BTN-143 states outright that there is no second check: "so the runner checks no second ancestry: Baton's record of the head is trusted (§12.8), and the claim response carries no `base_sha`" (`08-runners.md:514-515`). R-BTN-66 defines the walk only as "along the default branch's first parents" (`01-what-baton-is.md:281`), and the pusher of the newest merge chooses that chain. No rule ties the walk to the previously accepted head.
- **Code trace holds.** `groupLog` runs `git log --first-parent --no-renames --diff-merges=first-parent --name-status … head -- <group paths>` (`signed-control.ts:204`). For M with parents (O, T) and control paths equal to O's:
  - Under `--first-parent`, M is compared with O alone. It is TREESAME on the pathspec, so it is pruned; `--diff-merges=first-parent` only chooses which diff a listed merge shows and lists nothing here.
  - The walk continues M → O → O's first parents. S sits between O and T and is reachable only through the second parent, so it is never visited.
  - O is the newest changer and is owner-signed, so `groupInForce` returns `{read: O, key: owner, unsigned: []}`.
  - The runner's `verifyControl` (`runner.ts:1829`) recomputes `controlGroupsOf(claim.snapshot_sha)` with the same walk at the same M and gets O. O verifies, and `merge-base --is-ancestor O M` passes (`runner.ts:1874`).
  - `lastChanges` (`signed-control.ts:303`) lists M with its diff against O, which holds no control path, so no `unsigned-control` notice is raised.
- **The never-landed variant holds the same way.** With M = (X, T), X is an ancestor of M and is the walk's own answer.
- **The tests do not cover it.** The "finding 13" unit test (`signed-control.test.ts:159-190`) builds a merge whose first parent is the main tip. The S-BTN-219 cases at `:447+` are lies in a stored record. Neither is a merge whose own first parent is the old commit.
- **What stops it:** only the `protected` preset, where the forge refuses the push (`refs.default_branch: [trusted-runner, human]`). Under `cooperative` with the setting on, nothing does.
- **Not conceded by the threat model.** `docs/security-model.mdx:362-363` claims "a crafted merge cannot roll a control input back". "The memory-free walk remain B-137's" (`:373-374`) is about the walk's bound, not parent order.
- **Two narrowings.** The payload is limited to a state an owner key once signed (O, or X's tree), never arbitrary pusher bytes. "No notice" holds only when M restores every control path to O's state; a control path that M leaves at T's bytes and that differs from O is M's unsigned change and is noticed, though the rolled-back group is not named.
- **Severity.** Critical fits if an old signed version has a known weakness; high is my reading, because the setting is opt-in and the payload is owner-signed.
- **Corrected statement:** As filed, adding that the payload is confined to previously owner-signed states and that a silent rollback needs all control paths restored to O's.

### SEC-2 — CONFIRMED-NARROWER
- **Severity after review:** high (the underlying risk is known and ticketed; the spec wording is wrong)
- **Quotes checked:** all accurate.
- **Searched for:** `brief` in every section; §4.4 (`04-…:585-605`), R-BTN-194, R-BTN-133, `inputs.board`; security model reach 7, mitigation C, option 10; `tickets/B-137.mdx`.
- **Reasoning:**
- **No rule verifies a brief mark.** Nothing has Baton, a runner or the reading CLI check it; R-BTN-133 verifies the four control groups only.
- **The exposure itself is known.** Reach 7: "what a board post says is what Baton believes" (`security-model.mdx:286`). Mitigation C: "Without those, it is computed by the attacker" (`:364`). B-137 is still `available`; its description says the client-side checks "are computed by the attacker". §4.4 says "B-137 moves the verification server-side" (`04-…:605`).
- **What survives is the spec text.** `01-what-baton-is.md:293-295` says "until then the runners' own verification is what a lying post cannot pass". That is true of the groups and false of brief marks. §4.4 `:585-588` states the mark's meaning unconditionally, and the standing harness rule treats `signed` as the owner's word.
- **Scope.** Under `protected`, `inputs.board` excludes `machine`, which removes the machine-key path only.
- **Corrected statement:** Until B-137, a brief's `signed` mark is the posting credential's claim. The spec's "runners' own verification" sentence does not cover it, and §4.4 and the harness rule should say so.

### SEC-3 — CONFIRMED
- **Severity after review:** high for agent configuration; medium for goals and `EXPEDITE`
- **Quotes checked:** all accurate.
- **Searched for:** `agent configuration`, `.claude/`, `verify-config`, `cannot gate`, goal + `sign` across the spec; R-BTN-12; `docs/runbooks/owner-signed-control.mdx`.
- **Reasoning:**
- **The promise has no mechanism for agent configuration.** R-BTN-66 says the listed inputs "count only at" an owner-signed commit and "An unsigned change keeps the last owner-signed version in force" (`01-…:274-283`). The same rule and R-BTN-133 enumerate only four runner-loaded groups. No rule loads `.claude/**`, `CLAUDE.md` or `.mcp.json` from a named commit.
- **The concession sits outside the spec.** The runbook says "Baton cannot stop a harness loading an unsigned `.claude/settings.json` hook" (`owner-signed-control.mdx:89`), and the code calls these "the paths Baton cannot gate" (`signed-control.ts:161`). `verify-config` appears nowhere in `spec/BATON_SPEC/*.md`, and it covers owner sessions, not runner legs.
- **Goal files have no enforcement rule at all.** `EXPEDITE` is enforced by "the sync posts the tag's last signed state" (R-BTN-12, `06-…:547`), which is the poster's word, as in SEC-2.
- The only spec-side stop is `protected` with `paths.control: human`.

### SEC-4 — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** accurate. One factual slip: in the default `create-pr` course, `adjudicate` is the owner's leg ("No agent runs this leg", `src/defaults/courses/create-pr/adjudicate.md:3`), so no model reads the conversation there. `fix` and `address` remain.
- **Searched for:** `conversation`, `non-pusher`, `quoted data`, `as data`, `comment` in §3, §5, §8, §9, §12; R-BTN-139, R-BTN-190, §12.3 *Models*.
- **Reasoning:**
- **No saving rule.** R-BTN-139 governs which words count for stations and markers, not what a leg's model reads. R-BTN-190's "reaches a model only as quoted data" (`05-courses.md:1030`) sits under the `git` leg-state branch, and the `forge` bullet says "the rules below about the leg-state branch do not apply" (`:1002`).
- **The preamble over-claims.** §12 says "Text from git, runners and forges reaches a model only as quoted data" (`12-security.md:28-29`). §12.3 *Models* lists no forge text, and the security model itself says "the ticket is not quoted data: it is the instruction" (`security-model.mdx:231`).
- **The outsider's comment is unaddressed.** The model's accepted residual concerns pushers; nothing in the spec or the model accepts a non-pusher's comment reaching a fix leg on a public home.
- **Why medium:** this is a spec silence plus an over-broad preamble. The effect is a prompt injection of uncertain yield against a VM-level leg.
- **Corrected statement:** §12's "Content is data" claims more than §12.3 lists. No rule filters or quotes PR-conversation text for `fix` and `address` legs, so a non-pusher's comment can reach their model.

### PPL-1 — CONFIRMED
- **Severity after review:** medium (latent: `min` is `0.0.0` today; the first raise is a full outage of every non-CLI surface, and it fails loudly)
- **Quotes checked:** all accurate.
- **Searched for:** `Baton-Client`, `client-too-old`, `0.0.0` across the spec and `BATON_MCP_OAUTH_SPEC.md`.
- **Reasoning:**
- **No exemption exists.** R-BTN-197: "A request without the header is compared as `0.0.0`" (`11-people.md:395-396`), refused "before its signature is checked and before anything is read or written" (`:407-408`). §14: "Every request carries `Baton-Client`". S-BTN-227 asserts the refusal for "no `Baton-Client`".
- **The premise is false by the spec's own routes.** "Every client of the API is the CLI" ignores `/v1/mcp`, the OAuth routes, `/v1/github/webhook` and `/v1/forges/*/notify`.
- **The code matches the spec, so this is not just wording.** `src/core/front.ts:289-296` applies the check to every `/v1/` path, with `MIN_CLIENT = '0.0.0'` (`src/core/http.ts:29`).

### PPL-2 — CONFIRMED
- **Severity after review:** high
- **Quotes checked:** all accurate, including "a retired repository's policy blocks no revocation" (`03-…:57`).
- **Searched for:** `break-glass`, `BATON_HUMAN_KEYS`, `unsatisfiable-approvers`, `key:` entries, R-BTN-185, R-BTN-188, R-BTN-57, S-BTN-192.
- **Reasoning:**
- **Break-glass does not reach a `key:` entry.** It "satisfies every `human` entry" (`12-security.md:404-405`). An administrator "matches an `owner` entry … and no other" (`:380`).
- **The list cannot be changed without A.** "The list in force decides" needs an approver on the list as it stands.
- **A cannot be revoked.** "No gate without a key to open it" discounts only "a revoked, suspended or unknown key", so a lost or compromised A still counts as satisfying the list, and its revocation is refused. Under R-BTN-185 a `human_only` key is "revoked only with a `human_only` key", and that revocation hits the same refusal.
- **No list is required to hold a recoverable entry.** R-BTN-57's "which only the break-glass key resolves" (`11-people.md:105`) therefore promises a recovery that R-BTN-188 does not define. Retiring the repository is the only exit.

### PPL-3 — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** all accurate.
- **Searched for:** `bak_`, `one role`, `same fingerprint`, `conflict`, `credentials` and `repository_owners` rows in §13.
- **Reasoning:**
- **The gap is real.** No rule makes a `bak_<id>` unique tenant-wide or binds the id to the secret. `repository_owners` is keyed `(repository_id, fingerprint)`. "The public line its fingerprint names" (`11-people.md:72-73`) assumes a function the spec never establishes.
- **The trace is not proven.** The cross-repository takeover depends on how a repository-less route picks the line, which the spec does not say. I did not check the implementation.
- **The administrator-collision variant is probably refused.** "Registering a key that holds another role is refused `conflict`" (`12-security.md:78-79`) applies if key identity is the fingerprint.
- **The attacker is already an owner in the same tenant.**
- **Corrected statement:** The spec states no uniqueness or derivation for an API key's fingerprint. Two owner lines on different repositories may share a `bak_<id>`, and the fingerprint-keyed session, `minted_by` and revocation rules are then ambiguous.

### FND-1 — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** all accurate (`values.mdx:30`; `03-…:150-160`, `:306-307`, `:344`).
- **Searched for:** `rename`, `former_paths`, `delivery`, ordering or timestamp rules in §3, §13.
- **Reasoning:**
- **The contradiction is real.** R-BTN-73 says a notification "never computes or carries state" and "Besides the want a delivery produces two things" (the provenance record and the scope cross-check). R-BTN-138 has "a verified token, delivery or notification with matching ids and a new path" rewrite the path, `web_base` and `remote`, and create a held rename that refuses claims.
- **No rule orders or freshness-checks deliveries.** An out-of-order pre-rename delivery reverts the row with no attacker involved. It self-heals at the next id-matched delivery or CI token carrying the current path.
- **The replay variants need an already-privileged party.** Reading a signed delivery takes a repository or App administrator, or an on-path party inside TLS.
- **Held-rename clearing is unstated.** Whether a later genuine delivery carrying the stored path clears the hold is not said.
- **Corrected statement:** A delivery does carry registry state, against R-BTN-73's first sentence and values 6, with no ordering rule. A late or redelivered pre-rename delivery can revert the path or raise a held rename; deliberate replay needs a party who can already read signed deliveries.

### FND-2 — CONFIRMED
- **Severity after review:** high (a contradiction on the default configuration)
- **Quotes checked:** all accurate.
- **Searched for:** `code_repos`, `repo-not-listed`, `by name`, `today's reading`; S-BTN-116, G-BTN-136; `13-data-model.md:65`.
- **Reasoning:**
- **Two rules disagree.** `03-…:515-516` says "a home that lists no `code_repos` keeps today's reading — its `repos:` entries resolve by name on its own forge host". Against it: "reach nothing unless the home's owners list them in `code_repos`" (`:91-92`), "gains reach only when it resolves … to an id in `code_repos`" (`:527-529`), and G-BTN-136 "Reach beyond the home is only `code_repos`" (`15-verification.md:310`).
- **The rescue reading fails.** "Resolve by name" could mean short-name resolution only, without reach. The code takes the other reading: `src/core/codeRepos.ts:216` and `src/defaults/cli.ts:854,875` give reach by name while the list is empty.
- Under the default `[]`, the id protection of R-BTN-138 is therefore absent, and "today's reading" states no rule.

### DEC-1 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate (`91-decisions.md:250-251`, `:111`, `:98`; G-BTN-7; `tickets/B-201.mdx`).
- **Searched for:** `board/accept`, `auto.accept`, `held post|board|snapshot`, `Accept` in every section; §11.4; R-BTN-11.
- **Reasoning:**
- **No section defines a held post.** No rule has an Accept action or that route. `baton.observation-held` (`04-…:419`) is unrelated. R-BTN-11 refuses a non-descending post "whoever posted it", and only an administrator's forced Resync adopts a new history.
- **The 2026-11-09 decision keeps a control for a mechanism the 2026-11-01 decision removed.** It does not say it reverses that decision.
- **B-201 is still `available`** and specifies `held: [{…, auto_accept_at}]` and `POST /v1/ui/board/accept`.
- **The code still carries the retired mechanism.** `held_snapshots` and `/v1/ui/board/accept` are at `src/core/baton.ts:1072,1526-1532` and `src/core/claims.ts:2120,2501`, so the decision describes existing code that the rules say is gone. One of the two decisions must go.
- **Why medium:** it is a contradiction among decisions. The security-relevant part is that a 24-hour auto-accept adopts rewritten history without an administrator.
## Proposals, calls, holds and returning tickets

Defence pass over 7 groups: I could not refute any of them from the spec's text. Four are confirmed as written, three are confirmed at a lower severity than claimed. No files were written and nothing in the repository was changed. Paths below are relative to `/Users/neumark/git/baton/spec/BATON_SPEC/`.

### API-2 = BLK-1 = LIFE-1 = TKT-1 — CONFIRMED
- **Severity after review:** high
- **Quotes checked:** all accurate (`07-conditions.md:184-187`, `:501-502`, `:526-532`, `:617-621`, `:678-679`; `12-security.md:357`, `:365`, `:578-595`; `13-data-model.md:184`; `04-tickets-syncs-board.md:704-707`).
- **Searched for:** `proposed`, `baton/proposed`, `tickets.created`, `spawned-unposted`, `replacement`, `git kind`, `outbox` across all sections, `91-decisions.md`, `92-open-questions.md`, `BATON_SPEC_HISTORY.md`; S-BTN-107, S-BTN-191, G-BTN-165, G-BTN-76.
- **Reasoning:** No saving rule exists.
- **Who writes the proposal.** `07-conditions.md:185-186` says "the runner writes it on `baton/proposed/<ticket>`". `12-security.md:584-586` says "Baton queues an outbox entry for it, and a trusted-runner deliverer writes it … through the CLI's own templates". `07-conditions.md:620` says "`withdraw` is the one **git kind**: Baton files no ticket of its own", and `13-data-model.md:184` lists only `withdraw|forge-check`. The three cannot all hold.
- **The spec leans to §12's reading, without a mechanism.** `12-security.md:528-530` refuses a policy whose `outbox.git` role `refs.other` excludes under `proposed`; S-BTN-191 expects "the handler written on `baton/proposed/<ticket>` from the CLI template"; `protected` sets `refs.other` to `[trusted-runner, human]`. So API-2's distinct claim holds: R-BTN-161's writer is excluded from the ref.
- **No path for the content.** `fields` holds "identifiers only", and the subject and body "stay with the runner".
- **Not accepted as open.** `92-open-questions.md` lists only "Approval cost … per proposed ticket". The history (`BATON_SPEC_HISTORY.md:612`) says "`tickets.created: proposed` now covers every outbox git kind", so the amendment simply never reached R-BTN-171 or §13.
- **The call trace holds step by step.** The sync reads `origin/<default branch>` (`04:364`). R-BTN-86 drops a child "that snapshot does not post" at the first snapshot after the end, with no exemption for a proposal. Then "a completion never holds over none" (`07:532`), and nothing re-attaches a child that lands later ("Baton learns the children only from that end", `07:505`). S-BTN-107 expects such a call to settle. An owner route off the call leg is the only exit, and no condition is raised; `spawned-unposted` is only a logged discrepancy (`04:757-758`).
- **Lateness of a proposed `withdraw` has three clocks:** `07:617`, `07:678-679` and `12:588-589`.
- **"A supersession's replacement"** appears only at `12-security.md:365` and `:580` and is defined nowhere.
- **Small overstatement in BLK-1:** `07:668-669` does acknowledge "under `tickets.created: proposed` the proposal branch (R-BTN-180)" for `withdraw`, so R-BTN-171 is not wholly unaware of proposals. It still has no kind for creating a ticket.

### BLK-2 — CONFIRMED
- **Severity after review:** high for trace 1, medium for "no clock on an open call", low for traces 2 and 3
- **Quotes checked:** all accurate.
- **Searched for:** every `baton.<sub>` name in the spec (none concerns an open call), `call-settled`, `blocked_since`, `stalled_s`, `max_blocked`, R-BTN-165, R-BTN-86, R-BTN-167, R-BTN-126.
- **Reasoning:**
- **Trace 1** is the call half of group 1 and holds.
- **Trace 2** follows literally from R-BTN-86: a dropped child leaves the range, so `{"of":"all","at":[…]}` can hold over fewer children. Only a discrepancy is logged.
- **Trace 3 is a real gap, but narrow.** R-BTN-165 evaluates "in each transaction that changes the station of one of the run's children" (`07:530-531`) and has no counterpart to R-BTN-162's "A condition already settled when the end arrives writes no row" (`07:254-255`). It needs every child to be posted, claimed, run and closed between the git-first push and the end.
- **No clock:** `stalled_s` excludes "while Baton itself holds the leg waiting" (`07:450-451`), the deadline "dies with" the claim (`07:460-461`), and call ends are exempt from `max_blocked` (`06:199`, `07:506-507`). "So a call always settles" (`07:527`) is therefore unsupported whenever the range empties or a callee never finishes.
- **Mitigation the finding already names:** an owner's route, and the children's own notices where a child exists.
- **Related wording, not in the finding:** the trigger is "changes the station", while completions include `closed`/`withdrawn`, which is not a station change.

### BLK-3 = LIFE-2 — CONFIRMED
- **Severity after review:** high under `tickets.created: proposed` (the `protected` preset); medium otherwise
- **Quotes checked:** all accurate (`06-prerequisites-blocks-advice.md:114-120`, `:193-194`, `:223-224`; `07-conditions.md:254`, `:260-263`, `:294-296`; G-BTN-113 and S-BTN-93 cover only `ticket`).
- **Searched for:** `provisional`, `prerequisite-unconfirmed`, `contains` (`04:352-354`, `:527`), R-BTN-75, R-BTN-126, R-BTN-162, R-BTN-163.
- **Reasoning:** No rule removes the one-hour drop for a `condition` row.
- **(a)** `06:114` and `07:254` make a blocked end's condition row provisional, while `06:223-224` says a snapshot confirms only the `ticket` kind "and Baton holds the others".
- **(b)** The reason given for the non-provisional path ("the handler commit was pushed before the wait", `07:261-262`) is equally true of the blocked end.
- **(c)** Only a `ticket` end without `commit` is invalid (`06:193-194`), and nothing defines what a snapshot "shows" for a condition row.
- **(d) The trace holds.** Under `proposed` the handler commit is on `baton/proposed/<ticket>`, or does not exist yet on §12's reading. No default-branch head contains it before a human approval, so the row "not so confirmed within 1 hour … is dropped" (`06:119-120`). The leg becomes claimable; `resume` carries only settled conditions (`07:266-268`); the leg raises again ("a fresh handler ticket asks the question again", `07:275-276`). The sixth blocked end holds the ticket `blocked-exhausted` (`06:199-201`). This contradicts `07:262-263`: "no claim of the leg runs, and asks again, while its question is open".
- **LIFE-2's extra claim** (a `ticket` end whose `depends_at` is committed only on the ticket's branch) is plausible by the same mechanism but depends on where the leg writes; I could not decide it from the text.

### BLK-5 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate.
- **Searched for:** `ticket.cancel`, `owner-cancel`, `cancel: true`, "Cancel" across all sections and `docs/context/vocabulary.mdx`; R-BTN-168's "Cancelled" list; `91-decisions.md:154`.
- **Reasoning:**
- **Six places say hold plus release:** `06:553-554`, `07:487-488`, `08-runners.md:694-695`, `09-claims.md:167`, `11-people.md:561-563` ("Not confirmed, because they stop or slow work … setting a hold, cancel, Stop"), and `14-api.md:113`.
- **R-BTN-168's closed list** (`07:563-569`) has no owner act in it.
- **Only R-BTN-186 says otherwise:** "a cancel is undone by no one, its `cancel` leg running its course (R-BTN-168)" (`12-security.md:969-970`). No rule reconciles them.
- **The wrinkle is real under the majority reading:** a delegated key's cancel sets a hold with `set_by: mcp:<id>`, which it may lift (`11-people.md:455-457`), so "undone by no one" is false.
- **Why medium, not high:** the dominant reading is clear and one clause is the outlier. The cost is that R-BTN-186's justification for giving `ticket.cancel` to a delegated key is wrong, and one word carries two meanings on a destructive action.
- **Related contradiction, not in the finding:** `12-security.md:92-97` lists `ticket.cancel` as needing `confirm: true`, while `11-people.md:561-563` says cancel is not confirmed.

### LIFE-3 (+ TKT-11) — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** all accurate. LIFE-3's title ("loses its position") asserts one reading as fact; its body correctly presents two.
- **Searched for:** `returns`, `reopen`, `final_station`, `final_path`, `come back`, "first time", R-BTN-39, R-BTN-81, R-BTN-88, R-BTN-147, R-BTN-12, §13 conventions, S-BTN-39.
- **Reasoning:** No rule places a returning id.
- **What is deleted and what is kept:** `13-data-model.md:27-31` deletes `ticket_stations` and restores only `ticket_overrides` and `leg_attempts`. `13:123` deletes the `closed_tickets` row on return. `13:119` says "a snapshot only creates a new ticket's row at `start`".
- **R-BTN-39's only exception to "posts for the first time … stands at `start`" is an import** (`01-what-baton-is.md:113-115`).
- **A third reading the findings under-weigh:** `01:100` says "its claims, events and course history stay", and R-BTN-81 says "the position Baton holds is its latest position row, and nothing in git rewrites it" (`04:731-732`). A reader could restore from the history row, which also covers a dropped ticket with no `closed_tickets` row for 90 days. No rule tells the snapshot transaction to do so, and it conflicts with `13:119`.
- **The one-run-omission trace is permitted:** R-BTN-147 raises `baton.ticket-dropped` only for a ticket Baton "holds state for (a claim, hold, backoff, open condition, fence)" (`04:474-475`), so an unheld ticket resting mid-course drops silently.
- **S-BTN-39** asserts hold, attempts and backoff on return, never position.
- **TKT-11's renumbering point holds:** "takes the old one's hold and backoff" (`04:479-480`) is silent on position.
- **Corrected statement:** The spec does not say where a returning (or renumbered) id stands. Three readings are each supportable — `start`, `closed_tickets.final_station`, or the latest history position row — and they disagree. It is an underspecification, not a proven loss.

### LIFE-4 — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** all accurate.
- **Searched for:** "end station", `status: done`, "closes the ticket", `closed` in §4 and §9, the outbox kinds, R-BTN-70, R-BTN-10, R-BTN-116, R-BTN-160/162/165/169, `05-courses.md:874`, `12-security.md:922`.
- **Reasoning:**
- **(1) No closer for a claimless end.** A ticket leaves the board only when the source posts it `closed` (`04:142`). Standard courses close by a leg or a templated merge (`05:874`, `12:922`). A person's answer in Baton or an expiry reaches an end with no claim (`06:362-367`, `:374-376`), and the outbox has no kind that sets `done`. I found no rule that closes an `ask` handler at `answered`/`unanswered` in git. `07:726` ("When the ask closes — answered, expired, …") uses "closes" for reaching an end.
- **Narrowing:** the spec knowingly lets an end-station ticket stay listed until git closes it (S-BTN-107: "the request listed until withdrawn in git"). The fact-arrival cases usually close through the merged PR's own `status: done`. The real gap is handler tickets (and similar) that nobody is told to close.
- **(2) "Closes" versus "settles".** `07:114` and `06:22` say the handler "closes"; `07:545-546` says "it settles when that child closes". `07:225-231` settles at the answer, and `07:253` says "The prerequisite is met when the condition settles". R-BTN-162 is the specific rule and the table's own lead-in ("open until its outcome is settled", `07:106`) agrees with it, so an implementer has a defensible choice. The three "closes" phrasings are still wrong as written, and with (1) the literal reading never clears the block.
- **Corrected statement:** No rule closes in git a ticket that reaches an end without a claim (notably `ask` handlers), so they stay live. R-BTN-160's table, §6.1 and R-BTN-165 say "handler closes" where R-BTN-162 says "settles". This is a wording contradiction with one sane resolution, not an unbuildable rule.

### BLK-4 = PPL-4 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate (`06:557-559`; `07:380-383`, `:417`; `09-claims.md:267-271`; `11-people.md:222-226`, `:455-458`; `12-security.md:961-975`; `13-data-model.md:159`; `91-decisions.md:35`).
- **Searched for:** `reset`, `refund`, "buy runs", `hold_reason`, `set_by`, R-BTN-12, R-BTN-122, R-BTN-126, R-BTN-130, R-BTN-186; S-BTN-6, S-BTN-95, S-BTN-101, S-BTN-191; G-BTN-121, G-BTN-165.
- **Reasoning:** No rule scopes the reset to a hold reason or to the lifter. Every statement is unconditional: "Lifting a hold resets the leg's attempt and blocked-end counts" (`06:558-559`), "when a hold is lifted" (`07:382`), "the ticket's newest hold-lift `override` event" (`09:270`).
- **Each step is permitted.** A ticket in backoff is not held (a `retry` block, not a hold). The MCP hold is the key's own (`set_by: mcp:<id>`, `11:433-434`). `ticket.unhold` is marked `own` (`11:224-225`). The lift zeroes `attempts`, clears `retry_after` and resets blocked-end counts.
- **It breaks the spec's own principle.** R-BTN-186 says a delegated key "never makes a change that loosens an R-BTN-66 setting — … `retry`" (`12:973-974`). R-BTN-39 reserves adopt to `approvers.policy` because "It overrides history and resets a limit" (`01:168`).
- **It works only before exhaustion:** the key cannot lift an `attempts-exhausted` hold, and its hold "on a ticket already held … changes nothing".
- **Scenarios do not cover it:** S-BTN-101 and S-BTN-191 exercise hold then unhold with no assertion on counts.
- **Why medium, not high:** it needs an owner-minted key carrying both actions and repeated calls, and it yields unbounded retries and a suppressed `baton.retries`, not new authority.
## Claims, checks, the board and courses

Defence pass on nine groups: none refuted outright. Five are confirmed as written, four are real but narrower than claimed. All line references are to `/Users/neumark/git/baton/spec/BATON_SPEC/`.

### API-1 = RUN-1 = TIME-1 — CONFIRMED
- **Severity after review:** high
- **Quotes checked:** all accurate (`02-deployments.md:28-32`, `05-courses.md:251-262`, `09-claims.md:50-54`, `08-runners.md:244-246`, `14-api.md:74`, `05-courses.md:689` for the `prevent` self-loop).
- **Searched for:** `idempot`, `lost response`, `retry/retried`, `repeated`, `request_id`, `again` across all sections; R-BTN-63, R-BTN-39, §9.1, §2.1, the §14 `advance`, `conditions` and heartbeat rows, the `conditions` table in §13.
- **Reasoning:** No saving rule exists.
- `02-deployments.md:29` says "`claims.request_id` is the only stored request id" and lists the other writes' keys; `advance` is not among them.
- The only "Idempotent" clause near arrivals (`01-what-baton-is.md:149`) is keyed by `ref`, which the sync's fact arrivals carry. The holder's `advance` body has no `ref` or request id.
- R-BTN-63 evaluates a repeated body against the new state, so the trace holds: `off-graph` on an ordinary edge, which `08-runners.md:245` turns into `released:course-changed`; on `prevent` the retry is accepted, finishes a run that did no work and starts another.
- The heartbeat response (`14-api.md:72`) carries the claim's `leg` and `position` but no `run_id`, `inputs` or `leg_log`, so the reply cannot be reconstructed.
- API-1's raise claim also holds: the `conditions` body has no client key and the table's key is `id`, so "a repeated raise … finds its row" has nothing to find it by.
- RUN-1's "the very first advance of every claim" is slightly different: that advance carries no `reached`, so the retry's result is undefined rather than clearly `off-graph`.
- API-1's minting-route claims (tokens, `mcp-keys`, `register` with an API key) were only partly checked. `08-runners.md:169-170` supports the register case; the cost there is a revoke and re-mint, so low severity.

### RUN-2 — CONFIRMED
- **Severity after review:** medium (denial of service only; the false sentence is the defect)
- **Quotes checked:** all accurate (`09-claims.md:15-23`, `08-runners.md:18-22` and `31-33`, `02-deployments.md:249`).
- **Searched for:** `max_claims`, `max-claims`, `per credential`, `live runner rows`; R-BTN-4, R-BTN-3, the `runner_grants` row in §13, Decisions line 78, S-BTN-229, G-BTN-1; `docs/security-model.mdx` reach 8.
- **Reasoning:** R-BTN-4 counts "its active claims" per runner, and a runner is `(hostname, session_name)`, created by any first heartbeat. Nothing counts per credential or per grant except the 64 live rows and 200 new sessions a day in `02-deployments.md:249-250`. So one key granted `max_claims` 1 can hold 64 tickets, and "A compromised runner holds no more tickets than an owner allowed" (`09-claims.md:22-23`) is false as written.
- The threat model partly accepts the class: `docs/security-model.mdx:296-297` says a machine key "can also claim every leg its grant allows and hold the leases. B-137 adds per-key limits". That is why I put it at medium, not high. The spec's own sentence still contradicts it.
- The trace holds only where 64 eligible ready tickets exist for the grant.

### LIFE-5 = RUN-7 — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** all accurate (`10-checks.md:23-27`, `07-conditions.md:563-582` and `592`, `01-what-baton-is.md:118-125`, `09-claims.md:168`).
- **Searched for:** `supersed` (every hit), `restarts at`, `new head`, `check.sha`; R-BTN-168, R-BTN-39, R-BTN-63, S-BTN-68, S-BTN-123, G-BTN-153, Decisions.
- **Reasoning:** LIFE-5's "read literally, every push closes its check ticket `withdrawn`" overreaches. R-BTN-114 says the post "supersedes every **claim** on the ticket", and R-BTN-168's four causes for superseding a ticket do not include a changed sha, so the literal reading does not cancel the ticket. S-BTN-68 (`15-verification.md:240`: "the ticket restarts on each new head") fixes the intent.
- What survives: R-BTN-168 defines supersession only for tickets, with `cancelling` as one effect of the same transaction, and `09-claims.md:168` glosses `released:superseded` as "Baton superseded the ticket". The claim-only supersession that R-BTN-114 cites is defined nowhere.
- "Restarts at its start station" is a move absent from R-BTN-39's "Only these" list, and it is not a course edge.
- No rule says what the restart does to the path, the `max_runs` counts (`runs_from` resets only on an answer, route or adopt), `leg_attempts`, or an `attempts-exhausted` hold from the old head.
- **Corrected statement:** A check ticket's restart on a new head is a mover R-BTN-39 does not list, resting on a claim-level supersession R-BTN-168 does not define. Its effect on path, run counts, attempts and holds is unstated. The "closes withdrawn on every push" reading is not forced.

### LIFE-6 = RUN-8 — CONFIRMED-NARROWER
- **Severity after review:** medium (stale wording on a security gate; it fails closed)
- **Quotes checked:** accurate. The headline "a board post carries no station" is not quite true: the post's `std:git.readiness@1` carries `at: {station, path_len}` (`12-security.md:739`), though that is Baton's own position echoed back (`05-courses.md:197-199`).
- **Searched for:** `posted station`, `post stations`, `stations_observation`, `std:git.readiness`, `std:git.implied`, `check-unattested`; R-BTN-153, R-BTN-10, R-BTN-70, R-BTN-191's table, R-BTN-109, the §4.4 schema, `04-tickets-syncs-board.md:672-682`, S-BTN-123, G-BTN-143.
- **Reasoning:** The charitable reading is available: the confirming post is one whose readiness is attested `at` the end's `reached`, with `check.sha` equal to `claims.check_sha`. Nothing in the spec says so, and three things stay open.
- R-BTN-70 attests readiness "for each leg leaving Baton's station". At an end station there are none, so whether any attestation with `at` is posted for such a ticket is unstated.
- "never of a posted station" (`10-checks.md:87-88`), `stations_observation` "the latest accepted snapshot to post stations" (`13-data-model.md:114`), and S-BTN-123's "posts without confirmed ends" are vocabulary from a model where snapshots placed tickets. That contradicts `01-what-baton-is.md:103-104` and `05-courses.md:220`.
- "the station's entry requirements met and its pointers valid", judged from a post, has no posted subject for a ticket with no file.
- RUN-8's reading (3), that `close` must write evidence, is weak: `ended_at_sha` is optional under R-BTN-8, so a check end can name none.
- Reading (B)/(2), every check ending `check-unattested`, is possible from the words but not forced.
- **Corrected statement:** R-BTN-153's confirmation is worded for posted stations, which no longer exist. The only station in a post is Baton's echoed `at`, and the spec does not say that is what is meant or that it is attested at an end station. This is a rewording fix, not a proven permanent-pending bug.

### TKT-2 = TIME-7 = RUN-9 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate (`09-claims.md:242-263`, `04-tickets-syncs-board.md:152-153`, `401` and `613-614`, `11-people.md:556-558`, `14-api.md:178`).
- **Searched for:** `unconfirmed` (every hit), `baton.unconfirmed`, `6 h`, `6 hours`; R-BTN-10, R-BTN-155, S-BTN-12, S-BTN-18, `13-data-model.md:220`, Decisions, open questions.
- **Reasoning:** R-BTN-10 confirms on "the first accepted snapshot whose observation began after the end", with no time limit. The next paragraph says a completion unconfirmed at 6 hours, "never attested" included, "is never confirmed automatically; an administrator confirms or releases it".
- No rule reconciles the two. `baton.unconfirmed` appears only at `09-claims.md:262`, `07-conditions.md:576` and `13-data-model.md:220`, with no closing rule and no late-snapshot case.
- S-BTN-12 ("flagged at 6 h, never re-issued") hints the intent was "the ticket is never offered again automatically", but the text does not say that.
- The route is "admin session" only, so under the strict reading an owner cannot clear it.
- TKT-2's freeze half is accurate: a post is refused whole and no named condition is raised beyond `baton.sync-late`. That half is largely design, and a pusher's denial of service is accepted under `cooperative` (R-BTN-66). The durable defect is the 6-hour sentence.
- TIME-7's point about a hung CI run holding the observation number is TIME-14's and was not re-verified here.

### TKT-3 — CONFIRMED-NARROWER
- **Severity after review:** low to medium (a wrong gloss in "the one normative schema")
- **Quotes checked:** all accurate (`04-tickets-syncs-board.md:377-381` and `524-525`).
- **Searched for:** `read_sha` across `spec/`, `docs/context`, the spec history and the code.
- **Reasoning:** `read_sha` is defined only in those two places, and they disagree as the finding says. But the schema comment refutes its own presence condition in the same line: "a refresh materializes only when it is the head" requires `read_sha` to equal `sha` on a refresh. So "when not `sha` itself" cannot be a presence rule without making the field useless.
- §4.3 is unambiguous, and the implementation follows it: `src/core/baton.ts:1553` has `readAtHead = normative && p.read_sha === p.sha`.
- The finding's gap stands: what a non-refresh post does with `read_sha` is unstated.
- **Corrected statement:** The §4.4 comment "when not `sha` itself" is wrong; a current CLI's refresh always carries `read_sha`, equal to `sha` when read at the head. This is a one-line schema fix, not a rule an implementer must disobey.

### API-3 — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** all accurate (`11-people.md:642-644` and `658-661`, `12-security.md:50`, `155-156` and `192-194`, `14-api.md:56-60`, `94` and `171`).
- **Searched for:** `session` in §14 (every row), `B-192`, `ui/state`, `writable_types`, `answerable`, `/schemas`; `tickets/B-192.mdx`; spec history line 2879.
- **Reasoning:** By the table, the mismatch is real. Only `…/prerequisites` (`14-api.md:94`) admits `session` among the repository reads. No `GET …/schemas` row exists, and no response carries `allowed`, `answerable` or `writable_types`. `GET /v1/ui/state` still stands.
- It is narrower because it is a tracked lag, not two rival designs. §14 is mechanically "equal" to the built registry (`14-api.md:7-9`). §11.4 and §12 tag the new rule with "(B-192)", and `11-people.md:653-654` says "B-192 changes the reads that answer `not-found` today".
- `tickets/B-192.mdx` is `status: available` and its description says "Today the front attaches the session principal only under /v1/ui/*, and the repository reads admit keys but not sessions."
- The spec does not say this in §14 or mark the §11.4 and §12 sentences as not yet built, so a reader of the spec alone sees a contradiction. That is the surviving defect.
- I did not check which tickets cover the missing screen reads (runners, tokens, sync keys, consents, tenant reads).
- **Corrected statement:** §11.4 and §12 state the B-192 target while §14 states the built registry. The spec should mark which is in force and list the session-readable rows, rather than leave the reader to infer it from a ticket id.

### CRS-1 — CONFIRMED
- **Severity after review:** high
- **Quotes checked:** all accurate (`05-courses.md:687`, `716-733` and `833-838`, `15-verification.md:122` and `262`). One more hit supports it: `12-security.md:904-907`, "the leg ends at `human-merge` … `merged-by-hand`, which leaves `human-merge`".
- **Searched for:** `human-merge`, `run-tests`, `test_script` across the spec; R-BTN-69's field table; `src/defaults/courses.ts`.
- **Reasoning:** No definition exists for any of the three.
- `run-tests` has no row, `from`, `to` or `max_runs` in the table, yet the prose "queues" it and the shipped course treats it as a leg (`src/defaults/courses.ts:236-252`: `implement` → `next: 'run-tests'`, `fix` → `next: 'run-tests'`).
- The table's `fix` leaves `reviewed` only, while the prose runs it "from the gate's red (`pr-open`, `fixed`)". That is `off-graph` under R-BTN-63.
- `human-merge` is in `merged-by-hand`'s `from` at lines 834-835 and in §12, absent from the table's `from` list, and the `to` of no leg. `merge`'s only outcome is `merged`, so §12's "the leg ends at `human-merge`" has no edge.
- The default course's graph cannot be written from R-BTN-131.

### CRS-2 — CONFIRMED-NARROWER
- **Severity after review:** medium
- **Quotes checked:** all accurate (`05-courses.md:220`, `222-232`, `236-237`, `723`, `728`, `753` and `828-831`, `01-what-baton-is.md:132`, `08-runners.md:227-228`).
- **Searched for:** `displace`, `not-queued`, `next_leg`, `next_source`; matching rule 1 and the pipeline (`06-prerequisites-blocks-advice.md:438` and `461-463`); G-BTN-73; `13-data-model.md:119`.
- **Reasoning:** The spec does settle which reading is in force.
- `05-courses.md:828-831`: "Under R-BTN-39 they make legs `ready` or `waiting`, and settle a leg that declares `arrives` (R-BTN-192); they never place a ticket … the holder's `advance` or end moves the ticket."
- G-BTN-73 (`15-verification.md:319`): "no snapshot replaces it; `next` is never inferred".
- So reading (2) governs: only holder, Baton and owner queue. Most "queuing `merge` or `fix`" phrases in R-BTN-131 are loose wording for readiness the next holder acts on. That is not a second mechanism.
- Three things survive. First, R-BTN-83's "so that a later snapshot's readiness for another leg does not displace them" presupposes a displacement no rule provides. Second, the verb "places" is used literally at lines 728 and 753, against line 831. Third, the finding's trace is a real gap: after a suspension recorded with `review` next, a sibling CI turning red "queues `fix`" (line 723) has no mover. Rule 1 offers the queued leg alone, a first advance elsewhere is `not-queued`, and `create-pr` declares no fact leg for it. By the table, `fix` does not even leave `pr-open`, which overlaps CRS-1.
- **Corrected statement:** Readiness never changes the queued leg, by lines 828-831 and G-BTN-73. The "displace" clause is stale, "places" is wrong in two sentences, and the CI-red-after-suspension path has no rule that moves the ticket from `review` to `fix`.

No files were written or modified.
## Scenarios, the model and the harness

Defence pass on the VER findings: 10 of the 12 hold as written, 2 are narrower (VER-15, VER-17), none is refuted. I read the spec and repository read-only, ran no tests and wrote no files. Paths are relative to `/Users/neumark/git/baton/`; `15:` means `spec/BATON_SPEC/15-verification.md:`.

### VER-2 — CONFIRMED
- **Severity after review:** high for the false R-BTN-30 / G-BTN-37 claim; the count is slightly worse than stated (87, not about 85).
- **Quotes checked:** all accurate. Small count differences: the table has 191 rows and 190 distinct ids (S-BTN-225 twice). `test/integration` has 99 `S-BTN-*` files, which cover 86 table ids by file name, not 88; 104 ids have no file named for them, not 102 (the reviewer's list omits 9 and 11).
- **Searched for:** every `^| S-BTN-n` id in §15, grepped with a non-digit boundary across `test/` and `model/`, then across all `*.ts`, `*.mjs`, `*.js`, `*.qnt`, `*.json` outside `spec/`, `tickets/`, `docs/`. Grepped `unbuilt|not built|partly built|proposal` across `spec/BATON_SPEC/*.md`.
- **Reasoning:**
- **87 ids are named in no file under `test/` or `model/`:** 3, 14, 19, 20, 27, 33, 49–54, 56–59, 61, 69, 71–75, 78, 81–84, 86, 88, 89, 91–97, 99–103, 108–118, 120–123, 125, 127–130, 132, 134, 136, 180–187, 191, 193–196, 205, 208, 211–213, 221, 224, 233. The repo-wide grep adds only S-BTN-14, in a `vitest.config.ts` comment.
- **17 more have no file named for them but are mentioned in another test file:** 8, 9, 11, 62, 68, 76, 80, 98, 119, 124, 131, 167, 197, 200, 223, 230, 231. That is a name match only; I did not read whether the mention is an assertion. So the reviewer's "built but missing" examples S-BTN-230 and S-BTN-231 are wrong; 208 and 211–213 stand.
- **No row is marked unbuilt.** The only status markers are section headings: `15:5` "*(partly built — B-50)*" (B-50 is the weekly model check), "(proposal)" on §1, 3, 4, 7, 10, 13, 14, and "§12.8 proposal". The one "unbuilt" in the table (`15:214`) is about B-127 inside a scenario's setup.
- **No saving rule.** `15:33-35` says "The table below is the set, and every scenario passes on the hosts it runs on (G-BTN-37)" with no qualifier. The headings disclose a partial build at section level, but §15's own heading names only B-50, so this is not ACCEPTED-BY-SPEC.

### VER-5 — CONFIRMED
- **Severity after review:** high
- **Quotes checked:** all accurate (`05:899-906`, `15:144`, `15:145`, `15:271`, `05:989-990`).
- **Searched for:** `converse`, `marker`, `fact legs` across the spec, history and `91-decisions.md`; `test/integration/S-BTN-174.create-spec.test.ts` and `S-BTN-175.request.test.ts`.
- **Reasoning:**
- No saving rule. `05:899-906`: "are the owner's own sessions, which no claim runs … Queued, each is `waiting` on the `owner` … No marker or frontmatter records that a conversation is under way." The courses table at `05:694` agrees (`arrives: {fact: pr-opened}`).
- Rows 174 and 175 assert `converse` `ready`, offered to a claim, a marker written. Row 196 asserts the fact-leg path.
- The existing tests assert the rows, so they test the retired behaviour: `S-BTN-174…:137` expects `{ leg: 'converse', state: 'ready', waiting_on: null }` and `:145` closes a marker; `S-BTN-175…:187` expects `legs: ['converse']`.
- `05:989` still gives a claim of `converse` as its example.

### VER-6 — CONFIRMED
- **Severity after review:** high as a contradiction; practical weight medium, since no test exists for S-BTN-180.
- **Quotes checked:** all accurate (`15:258`, `12:525-527`, `12:374-375`, `15:275`, `12:542`, `91:125`).
- **Searched for:** `refs/baton` across the spec.
- **Reasoning:**
- `12:374-375` makes it a constant on every forge: "Three values that were knobs are constants: `refs/baton/*` is open to every writer".
- `12:307` lists it among what the spec does not protect: "refs no forge rule restricts: on GitHub, `refs/baton/*`".
- Nothing lets a forge refuse a runner there. The row names no forge, and S-BTN-191 asserts the opposite.

### VER-14 — CONFIRMED
- **Severity after review:** high. The stale exception is a safety exception in a gate (G-BTN-138).
- **Quotes checked:** all accurate (`15:226`, `15:399`, `08:502-515`, history `:1441`).
- **Searched for:** `held rewrite|rewrite_held|held-rewrite|verifying runner|cached runner` across the spec and history.
- **Reasoning:**
- The only hits in the section files are the two cited lines. The history records the removal at `:1415` and `:1441`.
- R-BTN-143 today has one path: one bounded fetch, then "a second failure reads nothing and ends `released:off-branch`" (`08:507-510`), and "the runner checks no second ancestry" (`08:514`). No cache, no exception.
- S-BTN-118 has no test anywhere.

### VER-15 — CONFIRMED-NARROWER
- **Severity after review:** low
- **Quotes checked:** accurate, but the reviewer missed §14's code table and the sibling uses.
- **Searched for:** `not-eligible`, `not-granted`, `rule_code` across the spec; `src/core/claims.ts` `refusal()`, `src/core/gates.ts` `GATE_CODES`.
- **Reasoning:**
- `14-api.md:39` defines the wire code: "`not-eligible` | a gate refused, with `rule` and `rule_code` (§6.6)". Only `blocked`, `backing-off`, `barred-tag` and `stale-skills` have rows of their own; `not-granted`, `missing-capability`, `claimed`, `held`, `capacity-full` and `rename-held` have none.
- The rest of the spec uses the same form as S-BTN-120: `03:157` "refused `not-eligible` (`rename-held`, §6)", `09:25` "`not-eligible`, rule `max-claims`", `09:37` "`not-eligible` naming the failed gate".
- The code agrees: `claims.ts:871` returns `not-eligible` with `rule_code: 'not-granted'` for rule 7.
- So S-BTN-120's "`not-eligible` (rule 7)" matches §14. The defect is `06:434-435`, "A refusal is the code shown, else `not-eligible`", which reads the Refusal column as the top-level code.
- The side that disagrees with §14 is S-BTN-64's "refused `missing-capability` (rule 4)".
- **Corrected statement:** §6.6's sentence at `06:434` contradicts §14's code table, and the rows follow different conventions (S-BTN-120 and S-BTN-58 give the wire code, S-BTN-64 the `rule_code`). Fix the sentence to say which codes are top-level (`capacity-full` is top-level in code but absent from §14); S-BTN-120 needs at most "`not-eligible` (rule 7, `not-granted`)".

### VER-G1 — CONFIRMED
- **Severity after review:** high
- **Quotes checked:** all accurate (`15:43-51`, `15:64`, `model/README.md:276-279` and `:351`, `model/check.mjs:27`).
- **Searched for:** `liveness|temporal|fencesClear` in `model/*.mjs`, `scripts/*.mjs`, `package.json`; `liveness` across the spec; `90-`, `91-`, `92-` files for a caveat.
- **Reasoning:**
- The only script that touches `liveness.qnt` is the typecheck loop at `check.mjs:27`.
- `model/verify.mjs` runs Apalache with `--inv=q::inv` only. `model/full.mjs` runs `model`, replay, `model:verify` and traces. No `temporal` formula is passed to any checker.
- `README:351`: "The current formulas (rounds 2–3) have not been run".
- The spec says nothing of this. `15:50-51` states the liveness properties under the heading "the core is a checked model", and `16-adoption.md:79` makes "the checked model and its trace check green" a cutover precondition.

### VER-G2 — CONFIRMED
- **Severity after review:** high
- **Quotes checked:** all accurate (`model/properties.qnt:78-81` and `:186`, `README:259`, `09:12-31`, `13:197`).
- **Searched for:** `concurrency|max_claims|B-188|oneClaimPerWorker|workerFree` in `model/`; `one_active_claim_per_runner` in `spec/` and `src/`; `91-decisions.md`.
- **Reasoning:**
- `oneClaimPerWorker` is in `safetyA` (`properties.qnt:186`), and the claim action requires `workerFree(w)` (`baton.qnt:498`).
- `91:78` records the decision against it: "per runner up to the lower of its declared `concurrency` and its grant's `max_claims` … over one claim per runner".
- The model README's "Not modelled" list does not mention several claims.
- The §13 half holds too: `13:197` still lists `one_active_claim_per_runner`, while `src/migrations/0057_several_claims.sql:6` drops the index (`DROP INDEX IF EXISTS one_active_claim_per_worker`). `S-BTN-229.several-claims.test.ts` exists.
- R-BTN-68's own sentence, "A change to a requirement the model cites changes the model in the same PR", was not met for R-BTN-4.

### VER-1 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate.
- **Reasoning:** `15:95` and `15:180` both begin `| S-BTN-225` with unrelated subjects (B-121 homes, B-238 retention). `spec/BATON_SPEC.md` has exactly one S-BTN-225 line (`:493`, the homes row). Both `S-BTN-225.homes.test.ts` and `S-BTN-225.retention.test.ts` exist. No rule permits a shared id.

### VER-G5 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate.
- **Reasoning:**
- **Load test:** `package.json` has no `test:load`. The string appears only in the spec, `tickets/R3-1258.mdx` (status `available`, i.e. unbuilt) and review notes. `15:26-32` and `02:228` ("`npm run test:load` proves it") are present tense, and neither marks it unbuilt.
- **Nightly:** no workflow runs the suite on a schedule. `ci.yml` is `pull_request` plus `push: [main]`; the only `cron` is `baton-sync.yml`'s 15-minute sync.
- **Alias:** `test:baton` is `vitest run` with Quint, `test` sets `BATON_SKIP_QUINT=1` and adds `model:links`. They are different commands.
- **S-BTN-31:** `vitest.config.ts`'s `local` project includes `test/integration/**/*.test.ts`, so the prose "every scenario on both hosts" matches the build and the row's seven-scenario list is the stale side. S-BTN-33 has no test.

### VER-7 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate.
- **Reasoning:**
- `11:370-375` lists `baton tickets …` among names that "exit 2 with a `renamed:` line … No alias stays". `15:124` drives `baton tickets new` and `baton tickets next`; `04:183` also says `tickets new`.
- `ticket next` (`04:216`, `04:494`, `13:11`, `15:39`) is missing from §11's tree row at `11:322`, against `11:271` "Every command a rule of this specification names is in the tree below".
- The built CLI still uses the plural (`package.json` `check:tickets`), which is permitted "until no caller uses them", but the scenario text is still wrong against the registry.

### VER-8 — CONFIRMED
- **Severity after review:** medium
- **Quotes checked:** all accurate.
- **Reasoning:**
- `15:246` gives `baton run` as the renamed name that exits 2. History `:1807` says it "survived in R-BTN-131 and is corrected there".
- `11:297-299` keeps it live: "`baton run` and `baton runner start` keep their `--home`: a name resolves to its home's `checkout`". `15:95` runs it, and `cli/baton.mjs:1217` dispatches it.
- No text says `baton run` is a kept alias. `11:375` says "No alias stays".
- S-BTN-97 has no test.

### VER-17 — CONFIRMED-NARROWER
- **Severity after review:** low
- **Quotes checked:** accurate.
- **Reasoning:**
- The rule is unambiguous: `03:208-209` puts a revoked key under `unauthenticated`.
- The built test agrees with the rule: `S-BTN-55.sync-key.test.ts:85-92`, "a revoked key's post and a replay are unauthenticated".
- Only the row's compression is at fault. Matching the four setup clauses to the four expectations puts "revoked" under `forbidden`; read distributively (machine and mirror `forbidden`; revoked and replay `unauthenticated`) it is correct.
- **Corrected statement:** S-BTN-55's wording groups "revoked" with the `forbidden` keys; rule and test both say `unauthenticated`. A wording fix in the row is enough (move "revoked" beside "a replay").
