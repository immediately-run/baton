---
title: "Adversarial review 2026-11-18 — §4: tickets, syncs and the board"
description: "One reviewer's findings, as filed, on BATON_SPEC §4."
order: 11
tags: [review]
---

# Adversarial review 2026-11-18 — §4: tickets, syncs and the board

Reviewer span: §4 whole (820 lines), with the cited homes in §1 (R-BTN-1/33/35/39/193), §2.3
(R-BTN-149), §6 (R-BTN-120, R-BTN-12), §7 (R-BTN-165, R-BTN-168), §9.6 (R-BTN-10), §12.3, §12.8
(`tickets.created`), §13.4 and §14 read far enough to compare. Paths are relative to
`spec/BATON_SPEC/`.

Counts: 0 critical, 3 high, 9 medium, 5 low.

---

### TKT-1: Under `tickets.created: proposed`, a call leg's children are dropped as `spawned-unposted` and the call never settles
- **Severity:** high
- **Kind:** liveness
- **Rules:** R-BTN-86, R-BTN-85, R-BTN-165, R-BTN-188 (`tickets.created`), §12.8
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:704-707` — "Baton records them as the run's children (a call's completion range, R-BTN-165) until the first accepted snapshot observed after the end; a reported child that snapshot does not post is dropped with discrepancy `spawned-unposted` (R-BTN-85)."
  - `07-conditions.md:501-502` — "Under the policy's `tickets.created: proposed` (R-BTN-188) the children are proposed, not filed, and not claimable until they land with a `std:approval@1` (R-BTN-180)."
  - `12-security.md:584-588` — "Baton queues an outbox entry for it, and a trusted-runner deliverer writes it on a branch `baton/proposed/<ticket>` … It is not claimable, no leg reads its body, and the entry is not `confirmed`, until its file lands. Such an entry is late only when it is not delivered within 24 hours"
  - `07-conditions.md:532` — "A `spawned` end that names no children is refused; a completion never holds over none."
  - `07-conditions.md:526-528` — "The table's last non-null entry is `{"of": "all", "closed": true, …}`, which holds once every child has closed, so a call always settles"
- **The problem:** Trace under the `protected` preset (`tickets.created: proposed`): (1) a call leg ends `released:blocked` carrying `spawned: [C1, C2]`; (2) the children exist only as outbox entries, then on `baton/proposed/C1`, `…/C2`, awaiting a human `std:approval@1` (allowed up to 24 h before even being "late"); (3) the next sync, about a minute later, reads `origin/<default branch>` (§4.3 step 2) and posts neither child; (4) by R-BTN-86 that is "the first accepted snapshot observed after the end", so both are "dropped" from the run's children with `spawned-unposted`; (5) the completion range is now empty, "a completion never holds over none", so no table entry ever holds; (6) the parent stays blocked on `{kind: "call"}`, and R-BTN-39's hold on a blocked ticket (`01-what-baton-is.md:143-144`) keeps every fact arrival off it. When the human finally approves and the children land, nothing re-attaches them. The same happens under `filed` whenever the child is not on the default branch at the first post — a custom `versions: "current"` source reading a lagging replica, or a filing that fell back to a PR.
- **Counter-reading considered:** "Baton holds only its filter fields" (`12-security.md:587`) might mean a proposed ticket already has a Baton row, so "that snapshot does not post" is moot. But R-BTN-86's test is literally whether the *snapshot posts* the child, and the sync reads only the default branch. Searched `spawned-unposted`, `spawned`, `proposed` across all sections: the only statements are the two in §4 and G-BTN-76 ("unposted ones are `spawned-unposted`"); no exception for a proposed child, no scenario (S-BTN-49, S-BTN-132) runs a call under `proposed`.
- **Smallest fix:** In R-BTN-86, keep a reported child that has an undelivered/unconfirmed outbox entry (or an open proposal) as the run's child until its entry is confirmed or refused; drop it `spawned-unposted` only at the first snapshot after that. Add a scenario: a call under `tickets.created: proposed`, approval arriving after two syncs.

### TKT-2: One refused board post freezes the whole repository, and after 6 hours every completion in the window needs an administrator by hand
- **Severity:** high
- **Kind:** liveness
- **Rules:** R-BTN-62, R-BTN-74, §4.4, R-BTN-10, "Claimable again" (§9.6)
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:401` — "A post is accepted or refused **whole**"
  - `04-tickets-syncs-board.md:152-153` — "Two files with one `id`, or a `repos` name with no mapping, fail the sync: nothing is posted and the run names the file."
  - `04-tickets-syncs-board.md:613-614` — "A post whose live tickets' `depends_on` form a cycle is refused `invalid-params`"
  - `09-claims.md:257-263` — "A ticket is claimable only after a snapshot observed after its last claim ended (`end_observation`), and never while a completion is unconfirmed … A completion unconfirmed 6 hours after `ended_at` (its named evidence attested `found: false` or never attested) raises `baton.unconfirmed` and is never confirmed automatically; an administrator confirms or releases it from the dashboard"
- **The problem:** A single ticket file — a duplicate `id`, an unknown `repos` short name, a two-ticket dependency cycle, an out-of-grammar id, an over-cap value — makes every sync fail or every post be refused, for every ticket of the repository. While that lasts: no new ticket becomes claimable, no closure is seen, no ended claim's ticket becomes claimable again, and no completion is confirmed. A file pushed on a Friday evening and fixed on Monday leaves every completion that ended more than 6 hours before the fix "never confirmed automatically" — "never attested" is exactly the state a frozen board produces — so each needs an administrator's dashboard action, and its ticket is unclaimable until then. The damage outlives the fix. Any pusher (reach 3, a compromised runner included) can cause it with one line of frontmatter; `baton ticket check` protects only PRs that run it, and `--direct` and plain pushes do not. The only condition I found for the frozen state itself is `baton.sync-late` ("a sync want older than 30 minutes", `03-repositories-and-forges.md:303`); nothing names the offending ticket to an owner outside the CI log.
- **Counter-reading considered:** Under `cooperative` the spec accepts that a pusher can do anything in git (R-BTN-66), so a denial of service by a pusher is in the accepted risk. That covers the freeze, not the irreversible conversion of a transient outage into per-claim manual work: an honest mistake produces the same result, and under `protected` the same refusal paths exist for a custom source. Searched for a rule that confirms a late completion once a post finally carries `found: true` after the 6 hours: "never confirmed automatically" says the opposite.
- **Smallest fix:** Either (a) quarantine the offending ticket instead of refusing the post (post the rest, raise a condition naming the file — R-BTN-86 already does this for `parent`: "No snapshot is refused for a parent"), or (b) start the 6-hour clock only while posts are being accepted (measure from the first accepted post observed after the end), and raise a named condition when a post is refused `invalid-params`.

### TKT-3: A refresh must carry `read_sha` to change tickets, but the schema says `read_sha` is sent only when it is not `sha`
- **Severity:** high
- **Kind:** contradiction
- **Rules:** §4.3 step 4, §4.4 schema (B-183)
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:377-381` — "A refresh carries `read_sha`, the commit its tickets were read at, and materializes them only when that is the head it refreshes … a post naming no `read_sha` (an older CLI's) changes none either."
  - `04-tickets-syncs-board.md:524-525` — "`read_sha?`, -- B-183: the commit the tickets were read at, when not `sha` itself; a refresh materializes only when it is the head (§4.3)"
- **The problem:** The schema ("the one normative schema", line 520) says `read_sha` is present only when the tickets were read at a commit other than `sha`. An ordinary refresh reads at the head, so `read_sha` would equal `sha` and by the schema is omitted. §4.3 says a post with no `read_sha` changes no ticket row. Read together, the only refresh that carries `read_sha` is the one that must not materialize, and the one that should materialize omits it and so does not: a custom source's ticket whose version moved without a commit is never written by a refresh, which is the whole purpose of B-183's refresh. An implementer must pick one sentence to disobey.
- **Counter-reading considered:** "when not `sha` itself" may be meant as a gloss on what the field means rather than when it is sent. The text does not say that, and the `?` plus "when" reads as a presence condition; the older-CLI clause makes absence load-bearing, so presence cannot be optional for a current CLI. Searched `read_sha` across the spec: only these two places.
- **Smallest fix:** In the schema: "`read_sha` — the commit the tickets were read at; every refresh from a CLI that knows B-183 carries it, equal to `sha` when read at the head". Say what a non-refresh post does with it.

### TKT-4: `R-BTN-11` refuses any post whose `sha` was an earlier head — a forced Resync to an ancestor can leave the board refusing forever with no condition raised
- **Severity:** medium
- **Kind:** liveness
- **Rules:** R-BTN-11, R-BTN-147, R-BTN-149 (retention)
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:435-439` — "A post whose `parent_sha` is not the head is `head-moved` whoever posted it and whatever its `sha` descends from, and so is a post whose `sha` was an earlier head of the repository (`board_snapshots` holds every head), since Baton holds no git and cannot test ancestry for a commit it never saw"
  - `04-tickets-syncs-board.md:468-472` — "30 minutes behind is a reset of the default branch to an earlier commit … raises `baton.head-behind` … closed by a forced Resync (R-BTN-11) or by a post that moves the head."
  - `04-tickets-syncs-board.md:461-462` — "The head is **founded** when it is reachable from `new`, or `new` from it"
  - `02-deployments.md:259` — "the alarm deletes `board_snapshots` older than 90 days (never the head's)"
- **The problem:** Trace: default branch is at Y (Baton's head Y; X an ancestor that was a head last week). (1) The branch is reset to X; after 30 minutes `baton.head-behind` asks for a forced Resync. (2) The administrator resyncs to X; head = X, unmaterialized. (3) Someone restores the branch to Y (the reset was a mistake). (4) The sync: head X is an ancestor of `new` = Y, so the head is founded, and it posts `sha: Y, parent_sha: X`. (5) Y "was an earlier head of the repository" — refused `head-moved`. (6) "the sync re-reads and retries" (line 434) and gets the same answer on every run. No condition fires: the head is founded (no `baton.head-unfounded`), not behind (no `baton.head-behind`). Only a second forced Resync naming Y recovers it, and nothing tells the administrator so. Also time-dependent: the same post is accepted once the 90-day prune has removed Y's row, so "`board_snapshots` holds every head" is false after 90 days and the rule's result depends on retention.
- **Counter-reading considered:** "A `board_snapshots` row the `sha` already has is replaced" (line 453) covers the Resync's own `sha` (X), so the refresh of X is presumably allowed; it does not cover Y. The stated reason ("cannot test ancestry for a commit it never saw") does not apply here: `parent_sha` equals the head, which is all R-BTN-11's compare-and-set needs. Searched `earlier head`, `head-moved` for an exemption after a reset: none.
- **Smallest fix:** Apply the earlier-head refusal only when `parent_sha` is not the head (where it adds nothing) or drop it; or raise a `baton.head-unfounded`-style condition on an earlier-head refusal naming the forced Resync that clears it. Correct "holds every head" to "every head of the last 90 days".

### TKT-5: R-BTN-86 and R-BTN-165 send children to "R-BTN-131's allocator", which R-BTN-193 names as the legacy git scan
- **Severity:** medium
- **Kind:** stale-reference
- **Rules:** R-BTN-86, R-BTN-165, R-BTN-131, R-BTN-193, R-BTN-199
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:694-695` — "each naming `parent: <local id>` of the same repository and each taking its id as R-BTN-131's allocator says"
  - `07-conditions.md:500` — "each child's id taken as R-BTN-131's allocator says"
  - `01-what-baton-is.md:52-53` — "every next-free scan of git — a ticket or child id by R-BTN-131's allocator (R-BTN-74's `new` among them) … retired by B-176"
  - `05-courses.md:772` — "a new ticket file, its id taken as R-BTN-199's allocator hands it out"
- **The problem:** The architecture page says "The server is the only allocator. Of leases and of numbers alike". R-BTN-193 uses the phrase "R-BTN-131's allocator" as the name of the legacy scan to be retired, and R-BTN-131 itself now defers to R-BTN-199. The two rules that govern child tickets — the ids most likely to be taken concurrently, by parallel legs — still cite the legacy name and never mention the sequence. An implementer following R-BTN-86 literally implements a git scan for child ids, the one thing R-BTN-193 says "Nothing new uses".
- **Counter-reading considered:** R-BTN-131 line 777 says "Every allocator does the same: `baton ticket request`, `baton ticket new` and the source's `file` export", so following the citation does reach the sequence. It does, through a rule whose name R-BTN-193 gives to the legacy path; the reader of §4.6 gets no hint the id is Baton's.
- **Smallest fix:** In R-BTN-86 and R-BTN-165 cite R-BTN-199 ("its id from the repository's `ticket-<prefix>` sequence"); in R-BTN-193 rename the legacy item ("the next-free scan R-BTN-131 once specified").

### TKT-6: What the offline next-free scan reads is stated two ways
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-74 (`ticket new`), R-BTN-131, R-BTN-199
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:225-228` — "with no key, no configured Baton, an unreachable Baton or `--offline`, the next free `<prefix>-<n>` on the head it files on (across the items folder at any depth, `archive/` included, among files whose frontmatter carries an `id`)"
  - `05-courses.md:778-779` — "A session without Baton — no key, none configured, unreachable, `--offline` — scans instead (the next free id across the same branches) and says so" (the "same branches" being, lines 774-776, "the default branch, `archive/` and the heads of the repository's open branches … every `baton-request/*` and `baton-ticket/*` branch")
- **The problem:** §4.2 scans one head; §5 scans the default branch plus every open branch. They give different numbers whenever a filing PR is open — the default since B-176 (`04…:243`: "`new` files through a PR by default"). Under §4.2's reading two offline sessions, or one offline and one open `baton-ticket/B-200` PR, both take B-200; the second push to `baton-ticket/B-200` is refused only by git's non-fast-forward, i.e. git is the lock again.
- **Counter-reading considered:** "the head it files on" could be loose wording for the same scan. It lists exactly what is scanned ("the items folder at any depth, `archive/` included"), with no branch.
- **Smallest fix:** One home (R-BTN-199's "What git still is") for what the fallback scan reads; §4.2 and R-BTN-131 cite it.

### TKT-7: Is a ticket's `title` §12.3 free text? Either the repository's own tickets are refused, or the title has no cap
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** §4.4, §12.3, R-BTN-33
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:618` — "Free text and identifiers are validated on write (§12.3)."
  - `12-security.md:110-113` — "**Free text** (`session_name`, an activity's `label`, `end_reason`, message payloads, rate-limit details): `session_name` by R-BTN-3's pattern; every other at most 500 characters, with no control characters and none of `<`, `>`, `{`, `}`, `` ` ``."
  - `12-security.md:108` — "a value over its cap is refused `invalid-params`."
- **The problem:** Two readings. (A) `title` is free text: then a title with a backtick, `<` or `{` refuses the *whole* post (TKT-2). This repository's own live tickets have such titles — `tickets/B-148.mdx:2` is "B-148 — Leg state on an orphan `baton-legs/<ticket>` branch where there is no forge: …" (18 ticket files here match) — so the spec's own board could not be posted. (B) `title` is not in §12.3's list: then nothing bounds it but the 8 MB post cap, and it is a prose channel of unbounded size per ticket that Baton stores and serves in every claim answer and board read, against R-BTN-33's intent. `display` (`group`, `project`, `status`) has the same gap except as an "opaque blob" capped at 16 KB.
- **Counter-reading considered:** The sync might sanitize or truncate before posting. Searched `title` with `character|truncat|at most|cap` across §§0–16: no rule. §12.3's parenthetical list reads as closed, which favours (B), but §4.4 says "Free text … validated on write" of the board post, which has no other free text than `title`, favouring (A).
- **Smallest fix:** Add `title` to §12.3 with its own rule (a cap; which characters; and whether an offending title is refused, truncated by the sync, or stored as-is because the dashboard renders `textContent`).

### TKT-8: Which `depends_at` edges count for the cycle refusal is unstated, and it sits beside a rule that accepts cyclic snapshots
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** §4.4 (B-111), R-BTN-120
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:613-615` — "A post whose live tickets' `depends_on` form a cycle is refused `invalid-params`, naming it once as its path (`B-1 → B-2 → B-1`); an edge to a closed ticket, or to an id the post does not name, is no cycle here"
  - `04-tickets-syncs-board.md:537` — "`depends_at?: [{ ticket, at | reached | done, leg? }]`"
  - `06-prerequisites-blocks-advice.md:52-54` — "When an accepted snapshot's ticket prerequisites form a cycle (selected tickets as edges), Baton keeps every block and raises `baton.prerequisite-cycle` naming the tickets."
- **The problem:** The board has no `depends_on` field; it has `depends_at`, whose entries are leg-scoped and of three kinds. Reading 1: every `depends_at` entry is an edge. Then a legitimate interleaving — A's `review` leg waits for B `at: built`, B's `publish` leg waits for A `done` — is a ticket-level cycle and refuses the whole post, although nothing deadlocks. Reading 2: only `done: true` edges (the markdown translation) count. Then a custom source can post an `at`/`reached` loop that does deadlock, and "no ticket source can post a loop, whichever shape it posts" (line 617) is false. §6 meanwhile describes an *accepted* snapshot whose prerequisites form a cycle; if §4.4 refused all of them, the `depends_at` half of §6's rule could never fire, so the two rules need to say which cycles each owns.
- **Counter-reading considered:** §6's cycle can also arise from course-file `select: parent` entries, which §4.4 does not see, so the two rules can coexist. True, but neither says so, and the edge set of §4.4's check is still open. Searched `prerequisite-cycle`, `cycle` in §§4, 6, 12.
- **Smallest fix:** State the edge set in §4.4 in board terms (only `done: true` entries, or every entry with `leg` ignored), and in R-BTN-120 say `baton.prerequisite-cycle` is for cycles the post validator does not refuse.

### TKT-9: `deferred` and `superseded` are posted as `withdrawn`, which cancels the ticket and blocks its dependents, while the CLI's own `claim` counts them as done
- **Severity:** medium
- **Kind:** contradiction
- **Rules:** R-BTN-74 (markdown source; `ticket claim`), R-BTN-120, R-BTN-168
- **Confidence:** high (the contradiction); medium (that the cancellation consequence is unintended)
- **Evidence:**
  - `04-tickets-syncs-board.md:142` — "`status` | `done` → `closed` as done; `withdrawn`, `superseded`, `deferred` → `closed` as withdrawn; any other → live, in `display`"
  - `04-tickets-syncs-board.md:257-259` — "refuses one that is not available or whose `depends_on` are not all done (archived, or carrying any of the markdown source's closed statuses)"
  - `06-prerequisites-blocks-advice.md:42` — "A withdrawn ticket meets only `withdrawn` and `closed`"
  - `06-prerequisites-blocks-advice.md:50-52` — "an entry a withdrawn ticket leaves unmet keeps its block and raises `baton.prerequisite-unmet`."
  - `07-conditions.md:563` — "A ticket is cancelled when its file says withdrawn (R-BTN-74)"
- **The problem:** (a) For a ticket depending on one that is `deferred`, `superseded` or `withdrawn`, `baton ticket claim` treats the dependency as done and claims, while Baton's board holds the same ticket blocked on `@done` and raises `baton.prerequisite-unmet`: git's lock and Baton's gate give opposite answers about one dependency, both specified in R-BTN-74's own text. (b) Because a `deferred` file "says withdrawn" to the board, R-BTN-168 cancels the ticket: its `cancel` leg "closes a PR, deletes a branch" (`07-conditions.md:553`), and `lifetime: parent` children are superseded. Deferring a ticket and later setting it back to `available` returns the id with its hold (R-BTN-12) but with its PR closed and branch deleted. "Any other → live" also means a typo (`Done`, `withdrawen`, `closed`, `cancelled`) is a live, claimable ticket; the status enum is nowhere stated in §4.
- **Counter-reading considered:** `claim` is the legacy git lock (R-BTN-193) and "Baton's position overrides only a false `available`" (line 267), so the divergence is tolerated until B-178. But the claim text states the dependency test itself, and it is the pickup path this repository uses today. Searched `deferred`, `superseded` in §§4, 6, 7: no rule separates deferral from withdrawal.
- **Smallest fix:** Make the `claim` dependency test the board's (closed as `done`); decide whether `deferred` is a live, held state or a withdrawal, and say in R-BTN-168 which statuses cancel. List the status enum once.

### TKT-10: A non-materializing refresh "changes no ticket row" — but bars, the question, `not_before`, dependencies and bindings ride the ticket
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** §4.3 step 4, R-BTN-74, R-BTN-70, §4.4
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:123-124` — "The sync posts bars, the question and `not_before` with the ticket, the rest as its attestations (R-BTN-191)"
  - `04-tickets-syncs-board.md:379-381` — "writing that body would roll the ticket cache back to an older reading, so it changes no ticket row; a post naming no `read_sha` (an older CLI's) changes none either."
  - `04-tickets-syncs-board.md:384-385` — "For the markdown source no version changes without a new commit, so its refreshes carry no ticket change"
  - `05-courses.md:194-195` — "Core keeps the readiness and bar rows of the newest accepted run"
- **The problem:** `bars`, `question`, `not_before`, `handoff_url`, `depends_at` and `conditions` are fields of the ticket object, stored in other tables (`ticket_bars`, `ticket_questions`, `ticket_next_legs.not_before`, `ticket_depends`, `condition_bindings`). Several are computed by the station function from PR state and change with no commit (a person leg's question posted on a PR; a bar read from a review). Reading 1: "no ticket row" means only the `tickets` table, so a refresh updates them — then a `confirm-only` refresh read at an ancestor rolls *those* back, the rollback the rule exists to prevent. Reading 2: nothing carried by the ticket is written — then, for the markdown source ("its refreshes carry no ticket change"), a question, bar or `not_before` that changes between commits is never stored until an unrelated commit moves the head, contradicting R-BTN-70's "bar rows of the newest accepted run". Also undefined: what a refresh read at an ancestor does to the readiness rows of tickets that exist only at the head (it posts no attestation for them, and "the run's attestations replacing the previous run's", line 374).
- **Counter-reading considered:** `row_hash` may cover only `tickets` columns and the side tables are "attestation-like". §4.2 says explicitly they are posted "with the ticket", not as attestations. Searched `confirm-only` (one hit, line 378, citing "§7.1", which does not define it) and `read_sha`.
- **Smallest fix:** Say per field group what a refresh writes: the `tickets` row by `version`, the station-function fields by the run's observation; and that a refresh whose `read_sha` is not the head writes neither and keeps the previous run's attestations. Define `confirm-only` where it is cited from.

### TKT-11: Where a ticket stands when it returns to the board is not stated
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-39, R-BTN-12, §4.4, §13.4 `closed_tickets`
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:609-610` — "a ticket that returns to the board clears it and gets its kept owner state back (R-BTN-12)."
  - `01-what-baton-is.md:113-114` — "A ticket a snapshot posts for the first time stands at its course's `start` with `start_leg` queued"
  - `13-data-model.md:123` — "`kept_json` (the ticket's `ticket_overrides` row and `leg_attempts`, kept past the purge)" … "deleted if the ticket returns, after `kept_json` is restored"
  - `06-prerequisites-blocks-advice.md:568-569` — "So withdrawing a ticket in git and reopening it clears nothing."
- **The problem:** A returning ticket is not posted "for the first time", and what is restored is only the overrides and attempts. Reading 1: it returns at `closed_tickets.final_station` with `final_path` — then a ticket closed at an end station (a `done` reopened, or one whose `cancel` leg ran) returns at a station no leg leaves and is never ready; only an owner's adopt moves it. Reading 2: it returns at `start` with an empty path — then withdraw-and-reopen resets the ticket's path and its per-leg run counts (`max_runs` counts runs after `runs_from`), which makes "clears nothing" false for the position, and a pusher's two commits re-run a merged ticket from `filed`. The same question applies to a `dropped` ticket that returns and to `baton.renumbered`: "the new id takes the old one's hold and backoff" (line 480) — its position, open conditions and fence are not mentioned, and whether the old id's `closed_tickets … dropped` row keeps a second copy of the hold (restored if the old id later returns) is not said.
- **Counter-reading considered:** `ticket_stations` might simply survive the close, making reading 1 implicit ("nothing in git rewrites it", `04…:732`). §13 says `closed_tickets` carries `final_station`/`final_path`, which suggests the live row is gone. Searched `returns`, `reopen`, `returning id`.
- **Smallest fix:** One sentence in R-BTN-39's "Where a ticket starts" for a returning id (and for a renumbered one), and S-BTN-39 asserting the position after withdraw-and-reopen.

### TKT-12: `last_written_by` names whoever pushed the merge, not whoever wrote the ticket's words
- **Severity:** medium
- **Kind:** security
- **Rules:** R-BTN-194
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:624-627` — "records on each ticket `last_written_by: {pusher, pusher_id?, commit, at}`: the pusher of the newest recorded commit that changed the ticket's file — `pusher_id` the delivery's immutable `sender.id`, `pusher` its login, never the commit author, which anyone sets"
  - `04-tickets-syncs-board.md:639-640` — "so a privileged session sees whose words steer the ticket before it reads them."
  - `13-data-model.md:93` — "`push_deliveries` … `ref` (`refs/heads/<branch>`), `before_sha`, `after_sha`, `sender_id` … pruned after 24 h"
- **The problem:** The record is read from push deliveries chaining the *default branch's* head. When a ticket change lands through a PR — the default for `ticket new` since B-176, and the only way under `protected` — the delivery to the default branch has the merger as `sender`: a maintainer who clicked merge, or the trusted merge runner's bot. So a compromised runner that edits a ticket's body on its branch, and has the PR merged by the merge runner, is shown to the next privileged session as written by the trusted merge runner (or by the human who merged). The field then asserts the opposite of what the rule is for: it launders a worker's words into a trusted name. Under `protected` every ticket reads the same pusher. Separately, a sync that posts more than 24 h after the push (a weekend's frozen board, TKT-2) finds the deliveries pruned and marks every changed ticket `pusher-unknown`.
- **Counter-reading considered:** The rule is "information, never a gate", and a merge is a review, so "who landed it" is a defensible meaning. But the stated purpose is "whose words", the rule rejects the commit author for being forgeable and offers nothing in its place, and a session told "written by the merge runner" has less reason for care than one told nothing. Searched R-BTN-194 and R-BTN-73 for the PR head branch's deliveries being read: only the head-to-head chain is.
- **Smallest fix:** Record both: the lander (default-branch delivery) and the pusher of the commit on the branch the change came from (the PR head's deliveries, which Baton also receives), or rename the field `landed_by` and stop claiming it shows whose words they are.

### TKT-13: The export omits the observation counter, though exported rows carry observation numbers; and omits `sequences`
- **Severity:** medium
- **Kind:** underspecified
- **Rules:** R-BTN-88, R-BTN-62, R-BTN-199, §13.4
- **Confidence:** low
- **Evidence:**
  - `04-tickets-syncs-board.md:766-779` — the format header "`{format, schema_version (highest applied migration), exported_at, origin, events_seq, sections, digest}`" and the section list, which names `ticket_stations` and `closed_tickets` but neither `board_head` nor `sequences`; `782-785` "**Not exported**" names neither.
  - `13-data-model.md:119` — "`snapshot_sha` and `observation` (the snapshot that last changed the row; the latest to show it there is the greater of `observation` and the repository's `stations_observation`)"
  - `04-tickets-syncs-board.md:609` — "A closing is recorded only from a post with a newer observation"
  - `04-tickets-syncs-board.md:498-499` — "so a lost or fresh Baton never issues a number git holds"
- **The problem:** After an import the per-repository observation counter starts again (nothing carries `last_handed_out`), while imported `ticket_stations.observation` and `closed_tickets.observation` hold the source's large numbers. Any rule that compares a post's observation with a row's ("a newer observation"; "the greater of `observation` and … `stations_observation`"; readiness "counts as shown by that run's observation") then compares 1, 2, 3 … with, say, 50 000: a closing is not recorded and station rows look newer than every post until the counter catches up. `events_seq` is carried for exactly this reason; the observation counter is not. `sequences` is likewise in neither list: the floor covers numbers git holds, but the route's `floor` is optional (`14-api.md:105` "an empty body carries neither"), so a caller without one gets `1` from the fresh Baton.
- **Counter-reading considered:** The import may zero the observation columns as it zeroes `runners.last_seen_at` ("import writes `last_seen_at` 0"); the text says that for one column only. I did not find the import's handling of `observation` anywhere (searched `last_handed_out`, `observation` in R-BTN-88).
- **Smallest fix:** Export each live repository's `board_head.last_handed_out` (or say import rewrites every `observation` column to 0) and `sequences`; list both under the section they belong to.

### TKT-14: The observation response is listed three ways
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** §4.3 step 1, §14 `POST /v1/sync/observation`, §4.4 (B-127)
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:351-352` — "`POST /v1/sync/observation` → `{sha, observation, bars, pushers, code_repos, check_app_id, provisional, positions, versions, unconfirmed}`" (the prose that follows, line 359, also describes "`legs`, the runs claims finished with evidence")
  - `14-api.md:138` — "`{sha, observation, bars, pushers, code_repos, check_app_id, positions, versions, legs, unconfirmed}`"
  - `04-tickets-syncs-board.md:604` — "with the owner keys served by the observation (never read from the repository it is judging)"
- **The problem:** §4.3's braces have `provisional` and no `legs`; §14 has `legs` and no `provisional`; the owner keys the sync verifies signed control with are "served by the observation" and appear in neither list. `provisional` is load-bearing (`06-prerequisites-blocks-advice.md:118` cites "the observation response's `provisional`, §4.3").
- **Counter-reading considered:** None that reconciles the two lists; they are restatements of one fact.
- **Smallest fix:** One list (§14), with `provisional`, `legs` and the owner-key field; §4.3 names fields and cites it.

### TKT-15: "The one normative schema" of the board post is not the one §14 and R-BTN-190 post
- **Severity:** low
- **Kind:** contradiction
- **Rules:** §4.4, §14 `POST /v1/sync/board`, R-BTN-190
- **Confidence:** high
- **Evidence:**
  - `04-tickets-syncs-board.md:520` — "`POST /v1/sync/board` — the one normative schema:" (no `legs_landed` in it)
  - `14-api.md:139` — "the board post (§4), with `legs_landed?: {count, tickets}` (R-BTN-190) | `{ok: true}`; `head-moved`"
  - `05-courses.md:1057` — "the sync's reading, posted with the board as `legs_landed: {count, tickets}`"
- **The problem:** A validator built from §4.4 refuses or drops `legs_landed`; one built from §14 accepts it. §14's reply column lists only `head-moved`, while §4 gives the same route `stale-observation` (line 402), `too-large` (389) and `invalid-params` (575, 613). The cap row says "10,000 tickets" (`02-deployments.md:247`) without saying whether `closed` entries count; for the markdown source `closed` lists every archived file on every post and only grows.
- **Counter-reading considered:** §14's errors column may list only route-specific codes; `stale-observation` is as route-specific as `head-moved`.
- **Smallest fix:** Add `legs_landed?` to §4.4's schema; complete §14's refusals; say what the 10,000 counts.

### TKT-16: R-BTN-33's list of what Baton stores per ticket has drifted from §4.4 and §13, and `brief` and the repository's `control` record have no table
- **Severity:** low
- **Kind:** restatement-drift
- **Rules:** R-BTN-33, §4.4 (B-127), R-BTN-194, §13.4
- **Confidence:** high
- **Evidence:**
  - `01-what-baton-is.md:64-67` — "Per live ticket Baton stores what matching (§6) and the dashboard's lists read: id, title, path, course, tier, `requires`, expedite, `depends_at`, `parent`, `repos`, rank, the position Baton holds (R-BTN-39), and an opaque `display` object"
  - `04-tickets-syncs-board.md:585-586` — "Each ticket's `brief` — `{signed, signer?, commit}` … is stored with the ticket and served with the claim answer"
  - `04-tickets-syncs-board.md:588-589` — "The post's `control` record stands for the repository"
  - `13-data-model.md:116` — the `tickets` columns: no `brief`; `13-data-model.md:134` — `control_json` exists only on `claims`.
- **The problem:** Stored per ticket but absent from R-BTN-33's list: `version`, `key`, `check`, `not_before`, `bars`, `question` (with a `url` and option ids), `conditions`, `handoff_url`, `brief`, `last_written_by` (a forge login and user id). None is a body, so the rule's intent holds, but the list reads as exhaustive and is the one CLAUDE.md enforces ("Filter fields only"). `brief` is "stored with the ticket" with no column in `tickets` (is it an input of `row_hash`?), and the repository-level `control` record, which claims copy "in the claim's own transaction", has no table at all.
- **Counter-reading considered:** R-BTN-33 may list examples. It says "stores what matching and the dashboard's lists read:" followed by a closed list and one exception clause.
- **Smallest fix:** R-BTN-33 cites §13.4's tables instead of listing fields; add `brief_json` to `tickets` and a home for the control record.

### TKT-17: Any granted key can push a sequence up 10 000 per call, forever, and mint unbounded `kind` rows; nothing lowers either
- **Severity:** low
- **Kind:** security
- **Rules:** R-BTN-199, R-BTN-149
- **Confidence:** medium
- **Evidence:**
  - `04-tickets-syncs-board.md:495-496` — "The number is `max(stored, floor) + 1`"
  - `04-tickets-syncs-board.md:501-504` — "A floor more than 10 000 above the stored number is refused `invalid-params` … gaps are harmless, and a bigger floor only burns numbers."
  - `04-tickets-syncs-board.md:491-492` — "`kind` is `^[a-z][a-z0-9-]{0,31}$`, opaque to core, which knows no kind's meaning"
- **The problem:** The 10 000 bound is per call, relative to the stored number, so a compromised runner's loop of `{floor: stored + 10000}` moves `ticket-b` by 10 000 each request; at R-BTN-149's 50,000 writes a day that is 5×10⁸ a day, and the next honest ticket is `B-500000001`. The sequence only rises and no owner or administrator action resets it, so the vandalism is permanent for ticket, rule, scenario and migration numbers alike. Any string is a kind, so the same key creates a new `sequences` row per call with no retention rule. "A number is not authority" is true; a permanently unusable numbering is still damage one grant can do to a shared resource.
- **Counter-reading considered:** The spec accepts gaps explicitly, and a compromised runner can do worse in git under `cooperative`. Under `protected` it cannot write the default branch, yet it can still do this; and unlike a git change it cannot be reverted. Searched `sequences`, `sequence` event, `last_number` for a reset or a rate bound: none.
- **Smallest fix:** Bound the floor against what an accepted board has shown (highest posted id of that prefix + 10 000) rather than against the stored number, or give administrators a `sequence.set`; restrict `kind` to a registered list per repository.

---

## Read but found sound

- **Ordering of two syncs, a stale sync after a newer one** (R-BTN-62/150, R-BTN-11): one number in flight, voided numbers refused, compare-and-set on `parent_sha`; I found no interleaving that lets an older reading overwrite a newer one on the new-head path.
- **A sync racing a claim, advance or end**: the strictly-greater-than-last-handed-out rule (lines 404-406) plus read-after-number (step 2) holds; a post in flight at the claim neither confirms nor stales it.
- **A rewritten or force-pushed default branch**: unfounded head posts nothing and raises `baton.head-unfounded`; only the named history follows a forced Resync (apart from TKT-4).
- **A lagging fetch**: releases with `behind`, 30-minute alarm; no rollback.
- **Two repositories with one ticket id; a `depends_on` or `parent` naming another repository's ticket**: ids are qualified `<repository id>:<local id>` (§12.3), a `parent` "that is not a local id" is stored as none, `depends_at` selects same-repository tickets and an unseen id fails closed (`baton.prerequisite-unmet`).
- **Parent cycles and depth**: stored as none with `parent-invalid`, no post refused (the model TKT-2 asks the other validations to follow).
- **Ticket numbering by the sequence** (R-BTN-199): no double issue from Baton; a leaked number is a gap; a lost Baton is covered by the floor when the caller sends one. The reserved `baton-ticket/<id>` branch makes a same-number collision fail at the push.
- **Renumbering/re-filing to escape a hold**: explicitly an accepted residual risk (R-BTN-12, Decisions line 154), consistent across §4, §6 and §91.
- **`position-disagrees`**: both values are positions, nothing adopted; consistent with R-BTN-33 and R-BTN-39.
- **Lapse bar and voiding rules**: consistent with the workflow annotation's "ten idle minutes" and `--busy-retry`.
- **Sequence route principals**: §4.3 and §14 agree once §14's "reader" is expanded.

## Not covered

- §4.2's `baton ticket check` date/sections/stale-rule logic (lines 155-211) and the `claim --rules-reread` flow (279-287): read, not attacked beyond consistency with R-BTN-193.
- §4.4's B-127 `control` record and group-atomic signed read (585-605): read; only its storage (TKT-16) and the owner-key field (TKT-14) checked. The signature walk itself was not attacked.
- R-BTN-88's freeze/seal/import sequence beyond the two omissions in TKT-13; the full §13 column-by-column comparison of every exported table.
- R-BTN-81's history row kinds against §13/§14's `history` shape.
- §4.5 re-verification (R-BTN-5/34) against R-BTN-198 and R-BTN-143 in their homes: read in §4 only.
- Scenario coverage in §15 was sampled (S-BTN-39, 43, 49, 132, 199; G-BTN-69, 76), not audited rule by rule; I did not run `npm run spec:impact`.
- Server-side handling of a duplicate `id` or duplicate `key` within one post's `tickets`, or an id in both `tickets` and `closed`: I found only the markdown source's own refusal (line 152), no core validation; noted here, not written up as a finding.
- TKT-1, TKT-4, TKT-11 and TKT-13 rest on not finding a saving rule after targeted greps; I did not read §5, §7 or §12 whole.
