---
title: "16. Adoption"
description: "This section is an appendix with an end."
---
## 16. Adoption *(appendix; partly built — R3-1208, R3-1216, R3-1220)*

**This section is an appendix with an end.** Everything in it serves one migration: a
repository that coordinated its claims through git before Baton — the reference deployment's
docs — moving onto Baton, and readers of that repository's git claims while they still read
git. The shadow mode, the cutover, legacy runners, `reap_after` and adoption requests (§16.1),
and the git mirror with its `mirror` key, workflow and pusher (§16.3, R-BTN-93) are its
whole content. The baton repository uses none of it and no new repository needs it. It ends when
docs retires its mirror: on that day one spec change, which the history records, deletes this
section and every passage elsewhere that serves only it. The inventory is not a list kept here
but a search: everything marked *adoption* (§13, §14, §15), and every passage the impact list
`npm run spec:impact -- R-BTN-28 R-BTN-17 --term mirror --term cutover --term cut-over --term
legacy --term shadow --term adoption` returns — among them R-BTN-1's, R-BTN-2's, R-BTN-18's and
R-BTN-36's sentences on the mirror and cutover, R-BTN-15's `#mirror` audience, R-BTN-73's drop
rule, R-BTN-88's seal, R-BTN-93's `mirror` role, R-BTN-94's mirror wants and
`baton.mirror-late`, R-BTN-149's prune below `mirror_acked_seq`, the mirror's claim note
(R-BTN-4, R-BTN-144) and Status notes (R-BTN-12, §12.3), §11.4's cutover and adoption controls,
the `mirror` principal (§12.1, R-BTN-129) and R-BTN-68's cutover precondition, each read and
deleted or rewritten. On that day the `mirror` value of the `refs.*` knobs (R-BTN-180,
R-BTN-188) stays legal in the stored policy versions and admits no credential, since no `mirror`
key or identity remains (R-BTN-93); `baton repo protect --print` omits it, a new version naming
it is refused `invalid-params` naming the knob, and the `cooperative` column becomes the other
three writers — so no stored version changes meaning and no approver is bypassed; R-BTN-188's
mark carries this past the deletion
(the owner, 2026-11-01, B-165's review default).

A repository registered with no git claim protocol of its own starts cut over and needs
nothing here. A repository that already coordinated through git — the reference deployment,
docs, with its `claim.sh` — moves to Baton in steps, and may keep a git mirror for readers
that predate Baton. What a cutover changes in docs' own text is in docs'
`BATON_DOCS_DEPLOYMENT` §15.

### 16.1 Cutover

- **R-BTN-28 (cutover is one-way server state).** Cutover is per repository:
  `repositories.cutover_at`, set once; no call clears it. A repository registered with
  `cut_over: true` (`POST /v1/admin/repositories`) starts cut over.
  - **Before cutover** Baton shadows git. Runner claim calls return `not-cut-over`; the
    repository's git claim tool claims through git and reports each transition to
    `POST /v1/runner/shadow-report` (`{transition: claim | set, ticket_id, status, nonce,
    at}`). Baton records and decides nothing; a report its constraints refuse (a second active
    claim, an unknown runner) is logged `shadow-conflict`.
  - **The act.** An administrator sends `POST /v1/ui/cutover {repository, confirm: true}`,
    answered `202 {confirm_code}` and performed by `baton admin confirm` (R-BTN-155).
  - **After it** the git claim tool reads the mode from `GET /v1/runner/mode?repository=`
    (`{mode, cutover_at?}`; the heartbeat carries `mode: {<repository>: shadow | cut-over}`)
    on every run and keeps a local sticky marker (`~/.cache/immediately-run/baton/cut-over`)
    that nothing removes, so a checkout that has seen cutover never claims through git again,
    reachable or not. For docs, `scripts/data/baton.json` carries `"cut_over": true` as a
    hint for a fresh clone, and CI flags any commit that changes it, and any claim commit the
    mirror did not author.
- **What the cutover does**, in order:
  1. **Drain.** The fleet's sessions stop before the flag and restart from a pulled checkout
     after, so none runs a pre-cutover claim tool; one the drain missed is reverted by the
     mirror (§16.3) and stopped by its owner.
  2. **Legacy import.** Each ticket git shows claimed with no Baton claim becomes an active
     claim of its own `legacy` runner (`kind: legacy`, `hostname: legacy`, `session_name` the
     claim note's session or `item-<id>`, credential `legacy`, an unusable secret hash) at the
     posted station, with that path as `start_path` and `reap_after` the note's date plus 7
     days. Legacy runners are exempt from `(hostname, session_name)` uniqueness, so one session
     that held several git claims has a legacy runner per ticket. A legacy claim is reaped at
     `reap_after`, never by silence (lease expiry skips `legacy` runners); R-BTN-7 refuses a
     status write only against a non-legacy holder.
  3. **Adoption.** A runner whose `session_name` equals a legacy runner's requests the claim
     (`POST /v1/runner/adopt {ticket_id}`), which records an `adoption_requests` row and answers
     `{pending: true}` until confirmed. It moves only when an administrator confirms that
     runner's request (`POST /v1/ui/adoptions/{claim}/confirm {runner_id}`, a confirm code; the
     dashboard shows each requester's hostname and session name); other requesters are then
     refused `forbidden`. The adopted claim keeps its
     station and `start_path` and runs no leg; the adopter's first `advance` re-enters the leg
     it was running, under its own lease.
  4. **The flag** (R-BTN-28), after which the claim tool calls Baton, status writes are fenced
     (R-BTN-7) and the mirror goes live.
- **Preconditions.** Workers Paid (R-BTN-2); the repository's owner bars and required bars set
  (R-BTN-67); the checked model and its trace check green (R-BTN-68); the load test passing at
  the envelope (R-BTN-87); every registered forge repository's immutable ids stored
  (R-BTN-138); legs live with their scenarios green (§15).

### 16.2 The reference deployment's rollout

| Step | What runs | Exit | Ticket |
|---|---|---|---|
| 1. Read-only view | board sync and dashboard at `https://baton.immediately.run`; no runners, no claims | for each tier, the Ready view's order equals the course's own claim order on the same snapshot | R3-1208, R3-1209 |
| 2. Shadow | sidecars heartbeat; git claims are reported (§16.1) | one week in which every git claim has a Baton claim; `shadow-conflict` events and the reaps the alarm would have made are reviewed against the git-side reaper's; `locate` is recorded for every live ticket against what sessions did | R3-1216 |
| 3. Cutover | §16.1 | verified | R3-1220, R3-1221 |
| 4. Consumers | docs' git-side stale-claim sweep retires (the alarm reaps); its buffer and in-review sweeps stay, asking Baton's holder query (R-BTN-7) before acting | — | — |

### 16.3 The git mirror

A **mirror** is optional, per repository: a workflow (`mirror_workflow`, or a `mirror`-role
sync key, R-BTN-93) that writes Baton's claim events into git for readers that predate Baton. The
baton repository runs none, and work on Baton writes nothing to the docs repository, whose
tickets concern the other immediately.run projects; docs keeps its mirror for those tickets until
its readers read Baton's API, and then retires it.

- It reads its own repository's events from `GET /v1/sync/events?after=`; each read's `after`
  acknowledges everything up to it, clamped to the last `seq` a read returned to the mirror, so
  an `after` beyond what it was given acknowledges nothing unseen; kept as
  `repositories.mirror_acked_seq`, which a seal
  waits for (R-BTN-88). It is wanted while an event of a kind it writes has a seq above
  `mirror_acked_seq` (R-BTN-94), with a 15-minute schedule as fallback; a run ends with one
  read at its final cursor.
- **One commit per ticket transition**, authored `Baton mirror <baton-mirror@immediately.run>`
  (with `mirror_pusher`, the identity R-BTN-73 recognises to drop the mirror's own pushes) with the event's time as
  author date (`GIT_AUTHOR_DATE`). For docs: subjects `roadmap: claim <id>` and
  `roadmap: <id> → available`, and the note `_claimed <date> — <repos> (claim <nonce>)._`.
  Nothing names the holder (R-BTN-36).
- **R-BTN-17 (preconditions, or skip).** A transition is written only over the status the
  event expects: `claimed` writes `in-progress` only over `available`; `released` and `reaped`
  write `available` only over `in-progress`. Any other status — the runner already moved the
  ticket on, a peer changed it — skips and logs the event; nothing is overwritten. Delivery is
  at least once and idempotent: the cursor advances only after the push lands, a replayed
  event fails its precondition or writes the same bytes, and a rejected push re-fetches and
  re-applies.
- Only claims that start at the course's start leg are mirrored; a claim resuming a suspended
  ticket, its advances and its end write nothing. An `override` setting expedite adds the
  `EXPEDITE` tag, and a `held` event writes a Status note naming its `hold_reason`, removed when
  the hold is lifted (R-BTN-12); neither changes the status.
- **Foreign claims.** A claim commit the mirror did not author, over an active Baton claim, is
  overwritten with the holder's status and note and logged `foreign-claim`; the holder keeps
  its claim (G-BTN-22). With no Baton claim it is imported as a legacy claim during the cutover
  step (§16.1), and reverted and logged `foreign-claim` after it. This is the one place a
  writer for Baton writes git over another writer.
- **Export.** Events, and each ended claim's activities and transcript pointers (runners named
  only by claim id), are appended as JSON in a fenced block to the repository's export file
  (docs: `content/plans/baton/claim-events.mdx`); the fence is a backtick run one longer than
  any in its text, at least three, and the mirror lints the file before pushing (§12.3,
  R-BTN-17).

