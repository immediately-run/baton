---
title: "Adversarial review of BATON_SPEC, 2026-11-18"
description: "A whole-spec adversarial review by twelve independent reviewers and a refutation pass: 289 findings, 22 high after refutation, no core lease or tenancy break, and four places where the spec promises more than its mechanism gives."
order: 1
tags: [review]
---

# Adversarial review of BATON_SPEC, 2026-11-18

Commissioned by the owner: a thorough adversarial review of the specification under `spec/`.
The text reviewed is `main` at `51efb860`: `spec/BATON_SPEC/` (twenty section files, about
1 MB) and `spec/BATON_MCP_OAUTH_SPEC.md`, read against `docs/context/` and
`docs/security-model.mdx`. Nothing in the spec was changed; this folder is the record.

## Verdict

**The core holds; the edges added since late October do not yet agree with it.** Nobody broke
the lease on a steady clock, the claim's uniqueness, the ordering of two syncs, tenant
isolation or signed-request replay — each was attacked directly and is listed as sound on the
reviewers' pages. What the review did find falls into five patterns:

1. **A guarantee worded more strongly than its mechanism.** Owner-signed control can be
   rolled back by a merge's parent order (SEC-1); `require_signed_control` promises agent
   configuration it never gates (SEC-3); a brief's `signed` mark is the poster's word (SEC-2);
   `max_claims` bounds a runner row, not a key (RUN-2); the outbox's "effect at most once" is
   at least once for `forge-check` (TIME-6, RUN-14).
2. **An amendment that did not reach every citation** — the spec's own writing rule 6.
   `tickets.created: proposed` is the largest: three sections disagree on who writes a
   proposed ticket, the outbox has no kind for it, and a call whose children are proposed
   never settles (found independently by four reviewers). Fact legs, several claims per
   runner, held posts, the held-rewrite exception and retired `R-BTN-177` all left stale
   rules, scenarios or gates behind.
3. **States with no exit, or whose only exit is an administrator by hand.** A lost `advance`
   response; a `key:`-only approver list; an end unconfirmed at six hours; a queued leg with
   no runs left; an open call.
4. **The target and the build stated in one voice.** §11.4 describes dashboard reads §14 does
   not list; 87 of 190 scenarios have no test and no row says so; the liveness properties
   R-BTN-68 calls checked are never run; `npm run test:load` does not exist.
5. **Restated facts.** Twenty-seven quantities are stated in two to six places each (three
   have drifted); the observation response, the heartbeat body, the owner settings and
   R-BTN-33's stored-field list each exist in two or three unequal copies.

None of this says the design is wrong. Almost every fix is a rule rewritten in its home and
its copies replaced by a citation; a handful need a decision from the owner (marked below).

## How it was done

- **First pass.** Twelve fresh reviewers, each with one span and one brief — break the spec;
  quote every statement verbatim with its line; search the whole spec for a saving rule before
  reporting; try once to refute yourself. Ten read sections whole; two read across sections
  (a ticket's life end to end; every quantity, clock and external boundary).
- **Second pass.** The Decisions and the gates were only partly compared with their rules in
  the first pass, so two more reviewers finished them: every remaining Decisions line and all
  85 remaining gate rows.
- **Refutation pass.** Four further reviewers were given the critical and high findings (and
  five medium ones on §15) as the defence: refute each from the spec's own text or say you
  could not. Verdicts are on [the refutation page](2026-11-18/20-refutation-pass.md).
- **Mechanical checks,** run by the coordinating session: every id cited in the section files
  resolved against the definitions and the Retired requirements table; every `§n.m` against
  the headings; every evidence quote in the first-pass findings matched against the cited file
  and line.

### What the numbers mean

| | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| As filed | 1 | 39 | 132 | 117 | 289 |
| After the refutation pass | 0 | 22 | 147 | 120 | 289 |

- The refutation pass examined 50 findings (28 distinct issues, several found more than once).
  **It refuted none.** It narrowed 19 of the 50, and those are the severities that moved.
- **The other 239 findings carry their filing reviewer's severity and have not been
  second-checked.** Expect some to be wrong: each reviewer read only part of the spec.
- The quote check matched 622 of 681 evidence quotes at the cited line and 20 more elsewhere
  in the cited file. The remaining 39 were not hand-checked; most sit on evidence lines that
  cite two files, where the checker read only the first. The quotes of the two second-pass
  pages were not machine-checked.
- Findings are counted as filed, so one issue found by three reviewers counts three times.
  The distinct issues at high severity number about fifteen; they are the list below.
- Findings rest on the spec's text. Where a reviewer also read the implementation it says so;
  nothing was run, and no finding was reproduced as an exploit or a failing test.

## The high findings

Each is confirmed by the refutation pass unless marked. Ids link to nothing by themselves:
find them on the page named, or in [the table of every finding](2026-11-18/00-all-findings.md).

### Security

| Finding | What breaks | Smallest fix |
|---|---|---|
| **SEC-1** — owner-signed control rolled back by parent order ([§12](2026-11-18/07-security.md)) | With `require_signed_control` on, a pusher pushes a merge whose *first* parent is an old owner-signed commit and whose tree restores the control paths to it. The push fast-forwards, R-BTN-11 accepts the post, the first-parent walk names the old signed commit, the runner's recomputed walk agrees, and no notice is raised. A signed commit that never landed works the same way. The refutation pass read the implementation's walk (`git log --first-parent`, `src/defaults/signed-control.ts:204`) and found the same result; it was not run. Filed critical, held at high: the payload is confined to states an owner key once signed, the setting is opt-in, and `protected` refuses the push. | Define the walk relative to the previously accepted head: a head whose first-parent chain does not contain the head it replaces is an unsigned change to every group that differs. Add the swapped-parent merge to S-BTN-219. |
| **SEC-3** — signed control promises what nothing enforces ([§12](2026-11-18/07-security.md)) | R-BTN-66 says agent configuration (`.claude/**`, `CLAUDE.md`, MCP manifests), goal files and `EXPEDITE` "count only" when owner-signed. Only four runner-loaded groups are ever verified. An unsigned `.claude/settings.json` hook runs in the next leg's checkout. The runbook concedes this; the spec does not. | **Owner decision.** Add an agent-configuration group the runner materialises from its signed commit, or cut those paths from what R-BTN-66 says the setting enforces. |
| **SEC-2** — a brief's `signed` mark is the poster's claim ([§12](2026-11-18/07-security.md)) | No rule has Baton, a runner or the reading CLI verify a brief mark; under `cooperative` any granted machine key posts the board. The exposure is known (B-137), but §1 says the runners' own verification "is what a lying post cannot pass", which is true of control groups and false of briefs — and the standing harness rule treats `signed` as the owner's word. | Until B-137, say in §4.4 and R-BTN-66 that the mark is the posting credential's claim, or have the reading CLI verify the named commit against the owner keys Baton serves. |
| **PPL-2** — a `key:`-only approver list has no recovery ([§11](2026-11-18/06-people-oauth.md)) | Break-glass satisfies only `human` entries; an administrator matches only `owner`; revoking the listed key is refused `unsatisfiable-approvers`. A lost or compromised key on such a list can be neither replaced nor revoked. S-BTN-192 builds this state. | Refuse a list with no recoverable entry, or let break-glass satisfy `key:` entries. |
| **FND-2** — an empty `code_repos` reaches by name ([§1–§3](2026-11-18/01-foundations.md)) | R-BTN-140 keeps "today's reading" (`repos:` resolves by name) for a home that lists none, against "reach nothing unless listed", "gains reach only when it resolves to an id" and G-BTN-136. The code takes the by-name reading, so the default configuration lacks the id protection. | **Owner decision.** Either state the by-name fallback as a rule with its risk, or make an empty list reach nothing. |

### Liveness and protocol

| Finding | What breaks | Smallest fix |
|---|---|---|
| **API-2 = BLK-1 = LIFE-1 = TKT-1** — proposed tickets ([§6–§7](2026-11-18/04-blocks-conditions.md), [§4](2026-11-18/02-tickets-syncs-board.md), [§13–§14](2026-11-18/08-data-model-api.md), [lifecycle](2026-11-18/11-lifecycle.md)) | Under `tickets.created: proposed` (the `protected` preset): R-BTN-161 has the raising runner write the proposal branch, §12.8 has Baton queue an outbox entry a trusted runner delivers, and R-BTN-171 and §13 say `withdraw` is the only git kind. A call leg's proposed children are not on the default branch at the first snapshot, so R-BTN-86 drops them `spawned-unposted`; the completion range is empty; "a completion never holds over none"; the call never settles and no condition is raised. | Give the outbox a ticket-proposal kind and one writer; in R-BTN-86 keep a reported child until its proposal is confirmed or refused. Add a call under `proposed` to the scenarios. |
| **BLK-3 = LIFE-2** — a suspended leg's question evaporates ([§6–§7](2026-11-18/04-blocks-conditions.md)) | A blocked end's `condition` row is provisional (R-BTN-75, R-BTN-162) and dropped after an hour unless a snapshot confirms it; under `proposed` no default-branch head contains the handler commit in time. The leg is claimed again, asks again, and the sixth blocked end holds the ticket `blocked-exhausted` — against R-BTN-126's "held by Baton". | Make a `condition` row non-provisional on both paths, or confirm it by the proposal's outbox entry. |
| **BLK-2** — a call with no clock ([§6–§7](2026-11-18/04-blocks-conditions.md)) | `stalled_s` excludes a leg Baton holds waiting, the deadline dies with the claim, call ends are exempt from `max_blocked`. "So a call always settles" has no support when the range empties or a callee never finishes. | A core condition on a call open past a stated time or with an empty range. |
| **API-1 = RUN-1 = TIME-1** — `advance` cannot be retried ([§8–§10](2026-11-18/05-runners-claims-checks.md), [time](2026-11-18/12-time-numbers-failure.md)) | §2.1 lists every write's retry key and omits `advance`. A lost response leaves a started run whose `run_id`, inputs and log directory the runner never learns; the retry is `off-graph` (the runner then abandons the claim) or, on a self-loop leg such as `prevent`, is accepted and records a run and an arrival that never happened. A condition raise has the same gap. | An idempotency key on `advance` (and on a raise) answered with the first reply; add both to §2.1 and a lost-response scenario. |
| **CRS-1** — `create-pr` cannot be written from its rule ([§5](2026-11-18/03-courses.md)) | The default course is defined three ways: `run-tests` is queued, suspended and stubbed but is no leg in the table; `fix` leaves `reviewed` in the table and `pr-open`/`fixed` in the prose; `human-merge` is in one `from` list and in §12, and is the `to` of no leg. | Make the table row the one home. |

### Verification

| Finding | What breaks | Smallest fix |
|---|---|---|
| **VER-2** ([§15](2026-11-18/09-scenarios-model.md)) | 87 of 190 scenario ids are named in no file under `test/` or `model/` (recounted by the refutation pass, which lists them); no row is marked unbuilt; §15 says "every scenario passes on the hosts it runs on (G-BTN-37)". | A built/unbuilt column, or a list G-BTN-37 excludes. |
| **VER-G1** | R-BTN-68 lists liveness properties under "the core is a checked model"; no command passes a temporal formula to a checker, and the model's README says they "have not been run". §16 makes the checked model a cutover precondition. | Say which properties are checked; run the rest or mark them. |
| **VER-G2** | The model asserts one claim per runner (`oneClaimPerWorker`, citing R-BTN-4), which allows up to 32; §13 still lists the index migration 0057 dropped. R-BTN-68's own rule — a requirement change changes the model in the same PR — was not met. | Update the model and §13. |
| **VER-5, VER-6, VER-14** | Scenarios that test rules as they used to read: S-BTN-174/175 claim `create-spec`'s fact legs (and the built tests assert it); S-BTN-180 expects a forge to refuse `refs/baton/*`, which is open to every writer; S-BTN-118 and G-BTN-138 test R-BTN-143's removed held-rewrite exception. | Rewrite the rows (and the two tests). |

## Confirmed, narrower than filed

Real, examined by the refutation pass, and held at medium (or lower where marked).

- **RUN-2** — `max_claims` counts per runner row and one key makes 64 rows, so "a compromised
  runner holds no more tickets than an owner allowed" is false. A denial of service the threat
  model partly concedes (B-137); the sentence is the defect.
- **TKT-2 = TIME-7 = RUN-9** — a post is refused whole, so one bad ticket file freezes a
  repository's board; an end unconfirmed at six hours "is never confirmed automatically",
  against R-BTN-10's unbounded confirmation. A sync outage over six hours becomes an
  administrator's click per ticket.
- **BLK-4 = PPL-4** — a delegated key resets a leg's attempts and clears its backoff by holding
  and unholding, a loosening R-BTN-186 says it never makes.
- **BLK-5** — owner "Cancel" is a liftable hold plus a release in six places and an
  irreversible cancellation in R-BTN-186.
- **LIFE-3, TKT-11** — where a ticket stands when its id returns to the board (or is
  renumbered) is unstated; three readings are supportable and disagree.
- **LIFE-4** — nothing closes in git a ticket that reaches an end station without a claim
  (an `ask` handler, notably); "handler closes" and "condition settles" name different instants.
- **LIFE-5 = RUN-7** — a check ticket's restart on a new head is a mover R-BTN-39 does not
  list, resting on a claim-level supersession R-BTN-168 does not define.
- **LIFE-6 = RUN-8** — R-BTN-153 confirms a check by "a post showing the ticket at that same
  `reached`", wording from before R-BTN-39; it fails closed.
- **API-3** — §11.4 and §12 state the B-192 target, §14 the built registry; the spec marks
  neither.
- **CRS-2** — readiness never changes the queued leg (R-BTN-131's own closing paragraph and
  G-BTN-73 settle it), but R-BTN-83's "displace" clause is stale, "places" is wrong twice, and
  a sibling CI turning red after a suspension has no rule that moves `review` to `fix`.
- **PPL-1** — R-BTN-197 compares a request without `Baton-Client` as `0.0.0` on every `/v1/`
  path; the first time `min` rises, MCP, OAuth, webhooks and the dashboard are all refused.
  Latent while `min` is `0.0.0`; the code matches the rule.
- **PPL-3** — an API key's fingerprint has no stated uniqueness or derivation.
- **FND-1** — a forge delivery rewrites registry state (against "only triggers") with no
  ordering rule; a late pre-rename delivery can revert a path or raise a held rename.
- **SEC-4** — no rule quotes or filters PR-conversation text for `fix` and `address` legs;
  §12's "Content is data" claims more than §12.3 lists.
- **DEC-1** — a decision in force keeps "the held board post's Accept"; the rules removed held
  posts, the code still carries them, and B-201 is told to build the route.
- **TKT-3** (low) — the `read_sha` comment in §4.4 is wrong; §4.3 and the code agree.
- **VER-15, VER-17** (low) — row wording; the real defect behind VER-15 is §6.6's sentence on
  which refusal codes are top-level.

## Mechanical findings

Checked by script against the section files; each is a one-line fix.

| Where | Defect |
|---|---|
| `15-verification.md:95`, `:180` | `S-BTN-225` is defined twice, for two unrelated scenarios (homes, retention). The index lists one. Both test files exist. |
| `14-api.md:74`, `:75` | The `advance` and `end` rows carry `taken? (R-BTN-177)`; R-BTN-177 is retired and its retirement says there is no `taken`. |
| `08-runners.md:236` | Cites "§10.4 free text"; §10 has no subsection and free text is §12.3. `CLAUDE.md:58` and `README.md:61` cite the same dead section. |
| `01-what-baton-is.md:287`, `:292`; `03-repositories-and-forges.md:363`; `05-courses.md:700`; `04-tickets-syncs-board.md:379` | "§7.1" cited for the board sync (now §4.3/§4.4); `05-courses.md:700` also cites "§2f" and "§6.1" for things those sections do not hold. |

`npm run check:spec` passes; it warns of fourteen citations of retired ids in `test/`,
`model/` and `cli/` (R-BTN-52, -78, -80, -103, -104, -173).

## Coverage and limits

- **Read whole, line by line:** every section file, `BATON_MCP_OAUTH_SPEC.md`, and the context
  pages. `docs/security-model.mdx` was read whole by the §12 reviewer and skimmed by the §11
  reviewer.
- **Every Decisions line and every gate row** was compared with its rule across the two
  passes, with the partial reads each page lists under "Not covered".
- **Scenarios:** every row was read; five §12 rows (S-BTN-188, 193, 194, 198, 199) were not
  compared with their home rules. Whether the 99 existing test files assert what their rows
  say was not checked.
- **Not attacked in depth,** by the reviewers' own account: R-BTN-88 (freeze, seal, export,
  import), R-BTN-107 (the executor interface), R-BTN-133's signature walk beyond SEC-1,
  R-BTN-144's masking, R-BTN-128's leg log, §9.8 replay, and the refresh-rotation timing of
  the OAuth companion.
- **`spec/BATON_SPEC_HISTORY.md`** was used for retired ids and dated rulings only. This is
  not the periodic consistency review of the `spec-review` skill: owner rulings held by live
  tickets but absent from the spec were not swept.
- Each page ends with **Read but found sound** — what its reviewer attacked and could not
  break — and **Not covered**. Read those before relying on a section being clean.

## The pages

| Page | Span | Findings |
|---|---|---|
| [Every finding](2026-11-18/00-all-findings.md) | one table, by severity after refutation | 289 |
| [§1–§3](2026-11-18/01-foundations.md) | what Baton is, deployments, repositories and forges | 20 |
| [§4](2026-11-18/02-tickets-syncs-board.md) | tickets, syncs and the board | 17 |
| [§5](2026-11-18/03-courses.md) | courses | 17 |
| [§6–§7](2026-11-18/04-blocks-conditions.md) | prerequisites, blocks, advice, conditions | 18 |
| [§8–§10](2026-11-18/05-runners-claims-checks.md) | runners, claims, checks | 14 |
| [§11 and MCP OAuth](2026-11-18/06-people-oauth.md) | people and their surfaces | 23 |
| [§12](2026-11-18/07-security.md) | security, one attacker at a time | 18 |
| [§13–§14](2026-11-18/08-data-model-api.md) | data model and API, reconciled with the rules | 13 |
| [§15 scenarios](2026-11-18/09-scenarios-model.md) | the model, the harness, the scenario table | 33 |
| [Gates, §16, Decisions](2026-11-18/10-gates-decisions-adoption.md) | first pass | 22 |
| [Lifecycle](2026-11-18/11-lifecycle.md) | a ticket's life across sections; states and vocabulary | 36 |
| [Time, numbers, failure](2026-11-18/12-time-numbers-failure.md) | every quantity, clock and boundary | 16 |
| [Decisions, second pass](2026-11-18/13-decisions-remaining.md) | the lines the first pass did not reach | 26 |
| [Gates, second pass](2026-11-18/14-gates-remaining.md) | the 85 rows the first pass did not reach | 16 |
| [Refutation pass](2026-11-18/20-refutation-pass.md) | verdicts on the high findings | 38 verdicts |

The reviewers' pages are their reports as filed, unedited apart from escaping for the wiki.
Where a page and this summary disagree on a severity, the refutation page says why.
