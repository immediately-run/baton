## 10. Checks *(proposal)*

A check course runs a repository's merge checks in place of a CI service. Baton schedules the
check, a check-runner runs a command against the change's head, and a runner that holds the
check App's key posts the verdict to the forge, whose branch protection is the gate. A check is as trustworthy as the
registered check-runner keys, their legs' isolation and the check command on the default branch:
the change under test decides its command's exit status, which is what a test is, and cannot
print its way to `success`.

- **R-BTN-114 (check courses: check tickets and check-runners).**
  - **Check tickets.** The `changes` ticket source, a CLI default beside R-BTN-74's, runs in
    `baton repo sync`, lists the forge's open changes through the sync's forge reads (on GitHub,
    the open pull requests) and posts one ticket per change, id `check.<course>.<number>`, with no
    file. Each carries the core field `check: {sha, head_repo_id, head_ref}`, all filter fields;
    `head_ref` is a `refs/heads/*` name.
    - Baton drops a check ticket whose `head_repo_id` is not the repository's `forge_repo_id`
      (R-BTN-138), so a fork's change is never a check ticket, and drops every check ticket while
      the repository has no stored ids.
    - A post that changes `check.sha` supersedes every claim on the ticket (released `superseded`,
      R-BTN-168), and the ticket restarts at its start station on the new head; a completed
      claim on the old sha still unconfirmed is marked `superseded_at` and no longer holds the
      ticket (R-BTN-168), so a push right after a check ends never wedges the next one. A
      change the source stops posting is superseded (R-BTN-168).
    - A webhook or forge notification only triggers the sync (R-BTN-73, R-BTN-95).
  - **Check-runners.** A check-runner is a key role of its own (§12.1). A repository's owners
    register one with `baton owner check-runner add <repository> <key> --name <hostname>
    [--capabilities …] [--max-tier <t>]` (R-BTN-127; `POST /v1/owner/{repository}/check-runners`, stored in `check_runners`)
    and revoke it with the destructive `owner.check-runner.revoke`.
    - The `check_runners` row stands in for a grant: rule 7 reads it for a check ticket, rule 4
      its `capabilities` and rule 5 its `max_tier`. The hostname binds at `add` and is the name
      the key heartbeats under (R-BTN-3). A check-runner heartbeats, claims, advances and ends
      check tickets and reports activities and transcripts and writes leg logs, as any runner does.
    - Only a check-runner claims or advances in a check ticket, and a check-runner claims nothing
      else. Baton holds this at every claim and every `advance` (`not-eligible`, rule
      `check-runner`), so the key that wrote a change never reports its check.
  - **Isolation.** Check legs require `runner:session` (R-BTN-107): no `process` or `attached`
    runner takes one (rule 4), and they run with every write-capable
    credential and secret withheld, as replay does (R-BTN-84). Checks run only changes from the
    repository's own branches, never a fork's: a leg's logic cannot be both generally useful and
    a sandbox for strangers' code.
  - **Conclusions are the owners'.** The owner setting `checks: {<course>: {name, conclusions:
    {<end station>: "success" | "failure" | "timed_out"}}}` (R-BTN-66) maps end stations to
    conclusions, so no edit in git turns `failed` into `success`. Every conclusion but `success`
    fails a GitHub required check (checks are GitHub only, R-BTN-115): `neutral`, which a required
    check passes, is not in the set. A course's map names exactly one end station `success`, exactly one
    `failure` and at most one `timed_out`, or `PUT /v1/owner/{repository}/settings` refuses it
    `invalid-params`. A change that maps a station to `success` that was not, or removes or
    renames a course's entry, is a loosening (R-BTN-186), since a conclusion decides what branch
    protection sees; any other change is a tightening. A course file carries no `checks`
    (R-BTN-69); `baton course test` prints a check course's end stations for the owners to map.

- **R-BTN-153 (a verdict is a command's exit status, from the check-runner's confirmed end).**
  - **A check claim is bound to its sha.** The claim records `claims.check_sha` and returns it
    with `check_head_ref`; the runner checks out exactly that commit. Every `advance` carries
    `head_sha` equal to it, or is refused `head-moved`.
  - **The command.** A verdict leg is a check course's leg that can reach a station mapped to
    `success`. Its `check_command` in the course file (R-BTN-69) is an argv with `timeout_s`
    (default 1800, at most 7200). The runner reads both from `course.json` at the head of
    `refs/baton/<repository>/default` it fetched for the claim (R-BTN-143), never from an older
    `snapshot_sha`, so a post cannot run a check on a weaker historical command.
    1. The runner checks that `check_sha` is the head of `check.head_ref`, so a `refs/pull/*`
       commit cannot pass as the branch's. When the branch has moved, the claim ends
       `released:stale-board`, not a failed attempt, and Baton records a sync want (R-BTN-94).
    2. It runs the command **first**, in a fresh sandbox checked out at `check_sha`, before any
       agent touches that sandbox, through the provider method `exec(argv, {cwd, timeout_s}) →
       {status}` (R-BTN-107). A runner whose provider has no `exec` takes no verdict leg.
  - **Mapping the status.** Status 0 reaches the station mapped to `success`; any other status
    the one mapped to `failure`; a timeout or an `exec` error the one mapped to `timed_out`, or
    to `failure` where the map names no `timed_out`. An
    `advance` or end reaching a success-mapped station carries `exit_status: 0`, which Baton
    requires. In a check course an agent's `baton-leg-result` or channel `done` (R-BTN-106) may
    reach only `failure` or `timed_out` stations. A check course's `min_runner_version` is at least
    the runner release that implements this rule.
  - **The conclusion is the confirmed end.** Baton queues a concluding `forge-check` entry
    (R-BTN-115) only for an ordinary claim, held by a check-runner, that ended `done` at a
    `reached` the owners' `conclusions` map, confirmed (R-BTN-10) by a post showing the ticket at
    that same `reached` with `check.sha` equal to `claims.check_sha`, the station's entry
    requirements met and its pointers valid (R-BTN-109).
    - The conclusion is the owners' mapping of the end's own `reached`, never of a posted
      station.
    - Anything else concludes nothing and raises `baton.check-unattested`; the change stays
      pending, so the gate fails closed.
    - A check ticket's first claim queues an entry with conclusion `in_progress`.

- **R-BTN-115 (the forge-check deliverer and `forge-check` entries).** Baton sends no mail and
  calls no service but a workflow dispatch (R-BTN-94). `forge-check` is the outbox's one kind outside git (R-BTN-171), delivered by a
  runner the policy's `outbox.forge-check` admits (R-BTN-188).
  - **The forge-check deliverer** is a runner that declares `delivers: [forge-check]` (R-BTN-171).
    - It holds the dedicated **check App**'s private key on its own host; Baton holds no
      credential of the check App, so the merge check is a gate Baton itself cannot satisfy. A
      check App serves one tenant. Its runner is not the merge runner — a host that can merge
      must not be able to post the check the merge waits on: a runner that declares `forge-check`
      is offered no trusted leg on any repository its grants cover, and a runner any of whose
      grants has claimed a trusted leg may not declare it (`invalid-params` at the heartbeat); that
      their hosts differ is the
      deployment's (§12.8).
    - At start, and again at each delivery, it lists the App's installed repositories with the
      App's key and refuses to deliver for one that is not a repository its grant covers, or when
      the installation covers "All repositories".
  - **The entry.** Its `fields` are `{origin, forge_repo_id, sha, name, conclusion, summary, seq,
    issued_at}`, where `sha` is the claim's `check_sha`, `name` the owners' check name, and
    `summary` rendered `plain` from the end station's outputs (R-BTN-112).
  - **Lifecycle** is R-BTN-171's. A delivered `forge-check` entry is deleted after 7 days.
  - **Delivery.** The deliverer refuses an entry whose `origin` is not its configured origin, or
    whose `forge_repo_id` is null or not the target repository's. It writes `<repository>:<id>` to
    the check run's `external_id`, the entry's `seq` into its output, and `summary` inside a code
    fence one backtick longer than any backtick run in it, never as Markdown. The conclusion
    posts as GitHub's check-run conclusion of the same name.
    - `seq` increases per `(repository, sha, name)`; the deliverer posts only the highest it has
      claimed and drops older ones. Before posting it also reads the sha's check runs of that
      name and skips its entry when one carries a higher `seq`, so neither a second deliverer nor
      a worker that stalled past its lease posts an older entry over a newer one; a late
      `success` never overwrites a newer `failure`.
    - An entry for a superseded head is still delivered: the forge ties it to its sha.
  - **Read back.** The sync reads the change's check runs and posts them. A run by the check App
    (the instance's `check_app_id`, §12.7, handed to the sync with its observation) on that head that matches its entry confirms it
    (R-BTN-171). A run by that App with no
    entry Baton issued, or whose conclusion differs from it, or a newest run of a name
    on a head that is not the highest-`seq` entry already marked `delivered` for it, is the
    discrepancy `check-mismatch` (R-BTN-85) and raises `baton.check-mismatch`; for a stale newest
    run Baton also re-queues the highest entry. A deliverer can withhold; it cannot post a success
    Baton did not issue unseen.
  - **A `std:checks@1`**, optional. A check-runner (R-BTN-114) whose key the owner names in the
    policy's `attestations` entry for `std:checks@1` (R-BTN-188) may also post the verdict as
    that attestation, as its `service:` key, for a repository whose merge check is not a forge
    check run; the forge's own check runs from the protected default branch suffice without it
    ("Forge checks suffice", the owner, 2026-11-01; R-BTN-183).
  - **The gate is the forge's.** Branch protection requires the check by name **and** by the
    check App's id — never Baton's own App (§12.7) — so neither a status any token could post
    nor Baton itself satisfies it. Checks are GitHub only, until GitLab or Gitea offers a status
    that only one identity can post.
