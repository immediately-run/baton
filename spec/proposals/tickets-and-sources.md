---
title: "Proposal: ticket source writers, the store's display, and stricter sync ordering"
description: "Unbuilt designs moved out of BATON_SPEC §4: a ticket source's writer exports and the store showing Baton's position (R-BTN-200), observation renewal, voiding and the lapse bar, the founded-head check with its conditions, and the administrator's forced Resync."
---
**Status:** proposal — not built; moves into BATON_SPEC §4 when built (tickets B-77, B-46 for the sync ordering parts; no ticket yet builds the writer exports or R-BTN-200)

Each part below names the rule of [BATON_SPEC §4](../BATON_SPEC/04-tickets-syncs-board.md) it
would extend. The rule ids that stay defined there are written here as `R-BTN-n (proposed)`.

## 1. The ticket source's writer (R-BTN-74, proposed)

The ticket source is a reader and, optionally, a **writer** of one ticket store.


- **The writer** is the exports that change the store, each optional: `file(ticket)` writes
  a new ticket (handler tickets, R-BTN-161; call children, R-BTN-165); `withdraw(ticket,
  reason)` writes a withdrawal (R-BTN-168, R-BTN-171); `show(ticket, value)` sets the status
  the store shows people to a station's `display_status` (R-BTN-69, R-BTN-200); and
  `note(ticket, {entry, reason, station})` adds a note for people, its text the source's own,
  written once per `entry`. `show` and `note` run only in an outbox deliverer (R-BTN-171).
  `show` never closes a ticket: it refuses, marking its entry `refused`, a value its reader
  would post as closed. The sync posts which writer exports the source has (`source.writes`,
  §4.4); Baton queues an outbox entry only for an export the post names, and a runner asked
  to `file` through a source that lacks it fails that write, naming the export.
- **A write is confirmed through the same source's reader** (R-BTN-171): a later snapshot
  posts the ticket withdrawn, filed or showing the value, as its kind says.

The board post's `source` gains `writes?`: the writer's exports among `file`, `withdraw`, `show`,
`note`. The markdown source's writer is `file(ticket)`, which writes `<items>/<local id>.md`, and
`withdraw`, which sets `status: withdrawn` and `withdrawn_reason`; its `source.writes` is
`[file, withdraw]`. It exports no `show` and no `note`, so a markdown ticket's position is shown
by Baton alone. The `changes` source is a reader alone. A source's own `show` or `note` must not
change a ticket's `version`.

## 2. The store shows Baton's position (R-BTN-200, proposed)


- **A ticket source that shows positions shows Baton's.** Where the last accepted
  post's `source.writes` names `show` (R-BTN-74) and a live ticket's current station (R-BTN-39)
  has a `display_status` (R-BTN-69), Baton keeps the ticket's store showing that value through
  `source-show` entries (R-BTN-171). Its record per ticket, `display_refresh` (§13), holds the
  arrival it applies to (the history row that placed the ticket at its station), the observation
  number (R-BTN-62) last handed out when the latest `source-show` was marked delivered, how many
  of that arrival's deliveries no snapshot confirmed, and whether one was confirmed and whether
  one note was queued at that arrival.
  - **On a move.** The transaction that places or moves the ticket at such a station starts the
    record afresh at the new arrival, drops the ticket's `queued` source entries and queues one
    `source-show`.
  - **Which snapshots judge.** An accepted snapshot judges the ticket's posted `display.status`
    only when no `source-show` of the ticket is queued or claimed, the snapshot did not place the
    ticket, and its observation number is greater than the one recorded at the latest delivery,
    so it read the store after the write.
  - **Confirmed.** A judging snapshot that posts the value confirms a delivered `source-show`.
  - **Drift.** A judging snapshot that posts another value drops a delivered `source-show`,
    counting it unconfirmed, and queues one `source-show`. The first drift at an arrival whose
    show was confirmed — a person changed the status in the store — also queues one
    `source-note` with reason `display-drift`, the station and the arrival, so that person reads
    how to steer instead; no other drift at that arrival queues a note.
  - **Given up.** After 3 unconfirmed deliveries at one arrival — a value the reader never posts
    back as written — Baton queues nothing more for that arrival and logs the discrepancy
    `display-unconfirmed` (R-BTN-85). A `source-show` or `source-note` entry marked `refused`, or
    late by its kind's column (R-BTN-171), is dropped and logged as `display-unwritable`. Neither holds the ticket or raises a
    condition; the next move starts afresh.
  - **What it is not.** It keeps a view of Baton's position current: it moves no ticket, holds
    or stales no claim, raises no condition, puts nothing on Needs you and names no writer of
    the status. A status set in the store steers nothing (R-BTN-39); a person steers through
    Baton's own commands — hold, route, adopt, cancel.
  - A station without `display_status`, a closed ticket, or a post whose source exports no `show`
    queues nothing.

With it: the discrepancy subs `display-unconfirmed` and `display-unwritable` (R-BTN-85) — a
ticket store that never shows, or cannot be written to show, the station's `display_status`:
logged and listed on the Sync screen (§11.4), nothing adopted, nothing raised, never on Needs
you — and source entries are not exported (R-BTN-88): R-BTN-200 queues again any a snapshot
still needs.

## 3. Observation renewal, voiding and the bar (R-BTN-62 / R-BTN-150, proposed)

Built today: one number outstanding per repository, void 10 minutes after it was handed out.
Proposed in its place: a post is refused `stale-observation` unless its number was issued to the
posting credential; an outstanding number records its credential; and


- The holder renews it while reading, at most every 2 minutes:
  `POST /v1/sync/observation {renew: <number>}` resets its idle age.
- Another credential's request voids a number idle over 5 minutes; the same credential's
  after 10 minutes. Any other credential's request voids a number 30 minutes after issue,
  renewals included; with no competitor it still posts.
- The repository's sync key or CI identity voids at once a number another credential holds
  (never between the sync key and the CI identity; a CI identity is one credential whatever
  run holds it).
- A post bearing a voided number is `stale-observation`. A number held past 15 minutes
  raises `baton.observation-held`.
- **Release.** A sync run that will not post — nothing to post, a failed trust read
  (R-BTN-139), a failing ticket source (R-BTN-74), an unfounded head (R-BTN-147), any error
  exit — gives its number back with `POST /v1/sync/observation {release: <number>, behind?:
  <sha>, unfounded?: <sha>}`; the number is then voided. `behind` reports a lagging fetch and
  `unfounded` a head Baton's is not an ancestor of (R-BTN-147).
- **The bar.** A number **lapses** when it is voided for idleness or age, never posted or
  released; being voided at once by the sync key or CI identity is not lapsing. A credential
  that lets two numbers lapse within an hour takes none on that repository for an hour
  (`sync-busy` with `retry_after_s`) and raises `baton.sync-barred`. The bar never applies to
  the sync key or CI identity.

## 4. A founded head, a lagging fetch and dropped tickets (R-BTN-147, proposed)


- **The sync proves its head is founded.** After its full fetch, `baton repo sync` checks
  Baton's head against `new = origin/<default branch>` (after one fetch of the head's sha by
  name before declaring it absent). The head is **founded** when it is reachable from `new`, or
  `new` from it; **unfounded** when it is absent or the two have diverged. An unfounded head
  posts nothing: the run releases its number with `unfounded: new`, ends `unfounded` (exit 1,
  B-89) naming both commits, and Baton raises `baton.head-unfounded`, a `notify` condition on
  the repository naming them, closed by the administrator's forced Resync (R-BTN-11) or by an
  accepted post.
- **A lagging fetch posts nothing.** When `new` is a strict ancestor of the head, the sync
  releases its number with `behind: new`. Baton keeps `board_head.behind_since`, the first such
  release since the head last moved (cleared when it moves); 30 minutes behind is a reset of
  the default branch to an earlier commit, not a lagging replica, and raises
  `baton.head-behind`, a `notify` condition naming both commits, closed by a forced Resync
  (R-BTN-11) or by a post that moves the head.
- **Raised on any accepted post**, naming tickets, fields and posting key:
  - `baton.ticket-dropped` — the post drops, without listing it in `closed`, a ticket Baton
    holds state for (a claim, hold, backoff, open condition, fence); an active claim on it
    ends `released:stale-board`, and its owner state is kept in a `closed_tickets` row
    `closed_as: dropped`, as a closing's is (R-BTN-12). A ticket marked `cancelling` is never dropped,
    and its `cancel` leg's claim is never staled (R-BTN-168);

The `baton.renumbered` condition (the built part is the `renumbered` event and the move of hold
and backoff, R-BTN-147) is raised on the same post.

## 5. The administrator's forced Resync (R-BTN-11, proposed)

The observation answer's head is then the named commit, with an unmaterialized board, after a
forced Resync.


- **A rewritten default branch is adopted by an administrator, never by a post.** A post whose
  `parent_sha` is not the head is `head-moved` whoever posted it and whatever its `sha`
  descends from, and so is a post whose `sha` was an earlier head of the repository
  (`board_snapshots` holds every head), since Baton holds no git and cannot test ancestry for a
  commit it never saw; Baton's head stands, and the sync never posts one (R-BTN-147). An
  administrator adopts the new history with a forced **Resync** naming its head: `POST
  /v1/ui/resync {repository, force: true, sha}` (confirmed per R-BTN-155, the `sha` in the
  confirmation) or `baton admin repo resync <repository> --force [<sha>]` (R-BTN-127), which reads
  `origin/<default branch>` when none is given, shows it, and calls `POST
  /v1/admin/repositories/{repository}/resync {force: true, sha, confirm: true}`
  (`admin.repo.resync`, destructive, §12.2) with the administrator's key. In one transaction
  Baton logs an `admin` event `head-reset` naming the old head and the new, replaces the head
  with `sha` and marks the board **unmaterialized** (`board_head.reset_at`; the observation
  counter runs on, so nothing older is accepted), and records a sync want (R-BTN-94). The sync
  then posts as it always does against the head it is handed — a refresh of `sha`, or an advance
  whose `parent_sha` is `sha` — and the first post accepted after the reset is **materialized as a
  first snapshot's** whatever its `parent_sha`: every ticket it lists is written, every live
  ticket it omits is dropped as R-BTN-147 says, and `reset_at` clears. A post whose `parent_sha`
  is not `sha` stays `head-moved`, so only the named history follows. A `board_snapshots` row the
  `sha` already has is replaced. Claims whose `snapshot_sha` the new history does not reach end
  `released:off-branch` at their runner's next check (R-BTN-143). Ordering never depends on a
  clock.

## 6. Riders on §4 for the cancellation proposal (R-BTN-168, proposed)

- Materialization never deletes the row of a ticket marked `cancelling`; such a ticket is never
  dropped, and its `cancel` leg's claim is never staled.
- A claim of the `cancel` leg needs no ticket file: it reads the PR and branch it closes, and is
  re-verified against Baton's record (the claim response's station and queued leg), never
  against git, since its ticket may already be withdrawn or closed there.
- `closed-under-claim` (R-BTN-85) is not logged for a claim of the ticket's `cancel` leg.

## Sync wants, runners that sync and the per-repository notification route (R-BTN-94, R-BTN-105, R-BTN-73, proposed)

What is built is R-BTN-94's dispatch after commit and R-BTN-73's App route. This is the rest of
the design: Baton **records that a run is wanted**, a runner or a loop pulls the want, and a
repository without the App notifies Baton by its own webhook.

- **A want.** Where the specification says Baton dispatches a sync, Baton records a want in the
  transaction that causes it: a claim, an `advance`, an end, a fact arrival, a raise that names a
  handler (R-BTN-161), a person's answer held in Baton, an owner bar set or lifted, an unblocked
  ticket, a forge notification, a forced Resync (R-BTN-11, §5 above), the dashboard's **Resync**,
  `POST /v1/sync/want` (sync credential) or `POST /v1/owner/{repository}/sync-want`. Where the
  repository has a dispatch target, Baton then starts the workflow as R-BTN-94 says.
  - **The sync's want** is `sync_wanted_at` (earliest unanswered want; set when NULL) and
    `sync_wanted_after` (`board_head.last_handed_out` at the latest want; 0 before any number).
    A board post accepted whose observation is **strictly greater** than `sync_wanted_after`
    clears both, so a want raised while a run reads is answered by the next run. Wants are not
    exported (R-BTN-88). Retiring a repository deletes its wants (R-BTN-47).
  - **`GET /v1/sync/wanted`** answers `{wanted, since?, head_sha}` for the credential's role;
    `head_sha` is the newest commit any post named. It writes only its nonce row. A sync whose
    repeated board post is `stale-observation` reads `head_sha` to learn whether its post landed.
  - **Who answers a want**, any of: runners (below); the dispatch; a cron loop
    (`baton repo sync --if-wanted`); a CI schedule; optionally a server `post-receive` hook that
    only touches a spool file (`baton repo spool <repository>`), which the sync account's loop
    turns into `POST /v1/sync/want` and a run. The hook never reads the sync key and never waits
    for a sync.
  - A dispatch that fails is retried once, and the want stands until a post answers it. Without a
    dispatch target the other answers stand.
  - Raises: `baton.sync-late` (a sync want older than 30 minutes); `baton.forge-secret-missing`
    (a configured webhook with no secret, or a dispatch target with no credential).
  - **The mirror's want** (legacy, §16) is implicit: unread events of a kind the mirror writes
    above `mirror_acked_seq`. Baton raises `baton.mirror-late` for a mirror more than 30 minutes
    behind.
- **Runners sync (R-BTN-105).** A runner that pushes the default branch syncs after its push. A
  runner that offers to sync a repository polls `GET /v1/sync/wanted?repository=<id>` and
  `git ls-remote <remote>`, each at most once a minute while live, and runs `baton repo sync`
  when `wanted` is true or the remote head differs from `head_sha`. Observation numbers and
  `sync-busy` (R-BTN-62) keep several runners from posting at once.
- **The per-repository notification route (R-BTN-73 / R-BTN-95).**
  `POST /v1/forges/{repository}/notify` serves a GitLab or Gitea repository, and a GitHub one
  without the App, with the verifier, events and fields §3's adapter table lists. It is verified
  in the Worker before anything is read and answers `204`. A delivery to it records a want for
  `{repository}` only, and only when its project is `{repository}` or one of its `code_repos`.
  Today the route answers `not-found` after the size cap.
