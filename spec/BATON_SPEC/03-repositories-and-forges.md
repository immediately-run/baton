---
title: "3. Repositories and forges"
description: "A Baton hands out the tickets of the repositories its administrator registers."
---
## 3. Repositories and forges *(proposal)*

A Baton hands out the tickets of the repositories its administrator registers. A repository
lives on a **forge** — GitHub, GitLab, Gitea — or on a plain git server. Core reads no forge:
the forge only selects which adapters a repository may use (credentials, dispatch,
notifications, PR facts) and how Baton builds links. Every adapter is optional; a bare
repository reachable over SSH is enough (R-BTN-105).

### 3.1 The registry

- **R-BTN-47 (registered repositories).** Baton keeps a registry of repositories
  (`repositories`, §13). Each has:
  - an id, `^[a-z][a-z0-9-]{0,39}$`, unique in its tenant (R-BTN-135);
  - its forge, forge path, `remote` and `web_base` (R-BTN-92) and the forge's ids (R-BTN-138);
  - its default branch, its sync credentials (R-BTN-93, R-BTN-15) and, with GitHub Actions,
    the `sync_workflow` allowed to post its board and the optional `mirror_workflow` allowed to
    read its events (§16); with any mirror, the `mirror_pusher` it pushes as (R-BTN-73);
  - its optional dispatch target and unblocked trigger (R-BTN-94), its `weight` (R-BTN-61) and
    its owner settings (R-BTN-66).

  Only an administrator registers, changes or retires a repository, with its first owner keys
  (`POST /v1/admin/repositories`, R-BTN-57). A change never alters `forge`; it changes the
  forge path only by R-BTN-138's rules.

  - **Retirement** (`admin.repo.retire`, destructive, §12.2) is final. In the transaction that
    sets `retired_at`, Baton:
    1. removes the repository from every owner session's reach, ending a session left with none
       (R-BTN-155); an administrator's dashboard still shows its fence-pending claims, so the
       clear below can be reached;
    2. revokes every MCP key on it, OAuth grants included, with their tokens, and every pending
       OAuth request and unredeemed code naming it (`BATON_MCP_OAUTH_SPEC` §5, §7, §9; R-BTN-130);
    3. revokes its sync and mirror keys and its runner grants, check-runners included, and
       exhausts its registration tokens — no use remains, but the credentials they registered are
       not revoked, so a holder they registered can still heartbeat; its CI identity and its forge
       notifications are refused from then on (R-BTN-93, R-BTN-117, R-BTN-15, R-BTN-73);
    4. reaps each active claim on its tickets as an administrator's force-reap does, so a claim
       whose runner is alive is fence-pending (R-BTN-19), actor `admin:<fingerprint>`; a heartbeat
       declaring a retired repository's course drops that course rather than being refused
       (R-BTN-3), so the old holder can still report `fenced`;
    5. drops its `queued`, `claimed` and `delivered` outbox entries, logging each; a deliverer's
       later mark of one is ignored, and no cancel leg is owed for its tickets (R-BTN-171,
       R-BTN-168);
    6. deletes its sync wants, `webhook_syncs` rows, ticket timers and unblocked trigger, every
       `code_repo_consents` row it gave or was given, and its id from every account instance's
       `repositories` list (R-BTN-94, R-BTN-140, R-BTN-76).

    From then on a retired repository is outside every rule that reads registered repositories:
    Baton records no want and sends no dispatch for it, the backstop skips it, it has no mirror,
    and it counts toward no prune, limit or approver list (R-BTN-94, R-BTN-93, R-BTN-88). Its
    fence-pending claims are the one thing still live: the alarm clears each at its
    `fence_deadline` and raises `baton.fence-pending` for it, the holder queries answer for it
    (R-BTN-7), and the seal waits for it as for any fence (R-BTN-88). Its owner rows confer nothing: a key whose only repositories are retired owns none
    (R-BTN-155), and a retired repository's policy blocks no revocation (R-BTN-57). Its rows stay,
    read-only, for administrators' reads. Every other call naming the repository is `not-found`,
    as for one never registered, except an administrator's fence clear of one of its claims
    (R-BTN-19) and the holder queries, `GET /v1/runner/tickets/{ticket}/holder` and
    `GET /v1/runner/branch-holder`, which keep answering for its former path while a fence is
    pending (R-BTN-7, R-BTN-138). An export carries it as its tombstoned registry row alone (`~retired/<id>`,
    R-BTN-138; R-BTN-88), so an import keeps the id taken; its id is never registered again in
    the tenant (`conflict`), so nothing scoped to it comes back. A seed entry naming a retired id
    is skipped and logged, never a stop, as a revoked owner key is.

  - **The seed (B-91).** `BATON_REPOSITORIES` seeds the registry at start, insert-only, through
    the same validation: each entry is a registration (`POST /v1/admin/repositories`' body,
    §11) less its `owner_keys`, or **with** them — the owner keys the administrator registered
    the repository with (R-BTN-58), written at start as that repository's owners,
    `added_by: admin:seed`, so a rebuilt instance serves the owner CLI with no manual re-add
    (S-BTN-30's owner routes). A seeded repository that already has owners at start keeps them,
    and the seed writes the entry's keys only where that repository has none. An entry that
    names no `owner_keys` still registers its repository — its owners are added by an
    administrator. A malformed entry stops the start before any entry registers. A key the
    seed writes holds no other role, as one the administrator's route takes (R-BTN-57): one
    that does stops the start `conflict`. A key an administrator **revoked** is skipped — never
    written, never a stop: a revocation after the seed was written is an administrator's act, not
    a broken seed, and must not take the instance down; a repository it leaves with no owner is
    named in `seed_owners` (R-BTN-179).
  - **Home.** Every ticket belongs to one registered repository, its **home**. Baton's API,
    events and dashboard name a ticket by its qualified id `<repository id>:<local id>`
    (`docs:R3-1205`); runners, branch names and git use the local id. Two repositories may
    share local ids.
  - **One board per repository**: its own head and compare-and-set (R-BTN-11), observation
    counter (R-BTN-62) and sync run. A sync credential posts only its own
    repository's board.
  - **Relations stay home.** A ticket's `parent` and `depends_at` name tickets of the same
    repository.
  - **Repositories a ticket changes** (`repos:`) are filter fields its course reports. They
    need no registration and reach nothing unless the home's owners list them in `code_repos`
    (R-BTN-140).

- **R-BTN-92 (a repository is a forge, a forge path, a remote and a web base).**
  - **`forge`**: `github`, `gitlab`, `gitea` or `git` (none), fixed for the repository's life.
  - **Forge path** (column `github`): segments of `[A-Za-z0-9_.-]{1,100}`, none `.` or `..`,
    none ending in `.git`, joined by `/`; exactly two segments on GitHub, Gitea and `git` (where
    the administrator chooses it), two to four on GitLab. Compared case-insensitively and unique
    among the tenant's live repositories. It is for display and links; the forge's ids identify
    the repository (R-BTN-138). Every repository name a ticket carries — `repos:`, `git:` URIs
    (§12.3), the branch-holder query's `?repo=` (§9), the markdown source's `repos` map (R-BTN-74)
    — is a forge path on the **home's forge host**.
  - **`remote`**: the URL the sync and runners clone (`https://…`, `ssh://…` or
    `git@host:path`). Baton never fetches.
  - **`web_base`** (every forge but `git`): `https://<host>[:<port>]/<forge path>`, `https`
    only, no userinfo, query or fragment.
  - **The link rule.** A URL is the repository's when, parsed as a WHATWG URL and
    percent-decoded, it is `https`, has no userinfo, has `web_base`'s host (case-insensitive)
    and port, and its path begins with `web_base`'s path segments **as whole segments**
    (`…/docs` does not cover `…/docs-evil`), with no `.`, `..` or empty segment, no backslash and
    no encoded `/`. Every link Baton accepts or draws for a repository passes this rule; a `git`
    repository has no `web_base`, so Baton accepts and draws no link for it.
  - **Lookups by path name the forge host.** GitHub OIDC tokens (R-BTN-15) and App deliveries
    (R-BTN-73) look among `github` repositories on `github.com` (the App does not serve GitHub
    Enterprise hosts); a GitLab token or notification among its own host's repositories.
  - The administrator may change `remote` and `web_base` (a move).

- **R-BTN-138 (a forge repository is named by its immutable ids).** A path can be re-created
  by someone else after a rename, transfer or deletion; ids cannot.
  - **Registration records the ids** as decimal strings `^[1-9][0-9]{0,19}$` in
    `forge_repo_id`, `forge_owner_id`, with `forge_host`:

    | forge | `forge_repo_id` | `forge_owner_id` |
    |---|---|---|
    | GitHub | repository `id` | owner `id` |
    | GitLab | project `id` | namespace `id` |
    | Gitea | repository `id` | owner `id` |
    | `git` | — | — |

    A forge repository without ids is refused `invalid-params`. `baton admin repo add` reads them
    from the forge's API (`GITHUB_TOKEN`, `GITLAB_TOKEN` or `GITEA_TOKEN` for a private
    repository); `--forge-ids <repo>,<owner>` supplies them offline. Ids are unique among a
    tenant's live repositories on one forge host (`conflict`). A webhook's numeric id is
    converted only when `Number.isSafeInteger` holds, else the delivery is ignored and logged.
  - **The ids decide.** A token or delivery whose ids match passes whatever path it carries;
    one whose ids differ fails whatever path it carries. Checked on: a GitHub OIDC token's
    `repository_id` and `repository_owner_id`; a GitLab `id_tokens` JWT's `project_id` and
    `namespace_id`; an App delivery's `repository.id`; a notification's GitLab `project.id`,
    Gitea `repository.id` and `repository.owner.id`, or GitHub repository webhook's
    `repository.id`.
  - **A mismatch**: a CI token is refused `unauthenticated`; a delivery or notification is
    ignored (its signature was valid) and never matched by path instead. Mismatches write no row
    per request: `forge_ids_seen.mismatch` keeps the last 5 distinct ids as `{ids, count,
    last_at}`, written at most once a minute, and the repository raises
    `baton.forge-ids-mismatch`.
  - **A verified rename** — a verified token, delivery or notification with matching ids and a
    new path — in one transaction rewrites the path and `web_base`'s path, appends the old path
    to `former_paths` (deduplicated, latest 10), and rewrites `remote` when it was
    `web_base` + `.git`; otherwise the repository raises `baton.remote-stale`.
  - **A held rename.** When a live repository already holds the new path, the old path is kept
    and the token still passes. The repository raises `baton.rename-held`; a claim on a ticket
    whose home or code repository has a held rename is refused `not-eligible` (`rename-held`,
    §6); active claims on those tickets get a `requested` release (§6). The hold clears when an
    administrator changes the path with `confirm: true` (same rewrite as a verified rename) or a
    later verified rename stops colliding.
  - **Former paths reach the fence only** (the branch-holder query, §9), never authentication or
    links: `?repo=P` resolves to live repositories whose current path is `P`, and to one whose
    former path is `P` only while no live repository holds `P`. A `code_repos` entry keeps its own
    `former_paths` (latest 10), updated by id-matched deliveries. Several matches fail safe. An
    administrator removes a former path with `former_paths_remove` and `confirm: true`.
  - **Re-identifying** after a transfer: the change body's `forge_repo_id`, `forge_owner_id`
    and `confirm: true`.
  - **Retiring** moves the path to `former_paths`, sets `github` to the tombstone
    `~retired/<id>` and stops reading `web_base`. The path validator and import (R-BTN-88)
    accept a tombstone only on a retired row.
  - Renames, path changes and identifications are `admin` events with `detail.action`
    `repo-renamed` (actor `sync`), `repo-path-changed` or `repo-identified` (actor the
    administrator).
  - Two tenants may register the same forge repository; Baton does not check across tenants
    (R-BTN-56).

- **R-BTN-61 (merging courses and repositories).** Recommendations order each (repository,
  course) group by the default order (§6), then merge the groups by: (1) expedited first
  (R-BTN-12); (2) the home repository's `weight` (default 100), higher first; (3) the
  candidate's place in its own group; (4) fewer legs to an end; (5) `ready_since`, oldest
  first; (6) ticket id. The matching query reads at most 50 candidates per group after posted
  bars; when owner bars or readiness leave a group short it reads the group's next page, at
  most 4 pages per group per request, later pages' survivors after earlier ones'. `?limit=`
  applies after the merge. A ticket is offered only for its queued leg (R-BTN-83), named in
  `legs`, a list of one.

### 3.2 Who may post a board

- **R-BTN-93 (sync keys and the one verifier).** A repository's sync and mirror authenticate
  with a sync key, a CI identity token (R-BTN-15), or — for the sync only — a machine key
  granted on the repository (R-BTN-102, R-BTN-146). A board post from a class the policy's
  `inputs.board` excludes (`sync-key`, `ci-identity`, `machine`; R-BTN-188) is refused
  `forbidden`.
  - **A sync key** is an SSH key of R-BTN-13's types in one `sync_keys` row: exactly one
    repository and one role, `sync` or `mirror`. Owners add and revoke it
    (`POST /v1/owner/{repository}/sync-keys`, `…/sync-keys/{fingerprint}/revoke`); an
    administrator at registration or by R-BTN-57's revoke. A key already serving a repository,
    or holding another role, is `conflict`; any other key is `forbidden` at `/v1/sync/*`.
    Requests are signed as R-BTN-13 says (namespace `baton-request`, same nonce cache).
    Revocation takes effect at the next request.
  - A sync key is bound to no branch: whoever holds it is the sync. In CI it is a secret only
    default-branch runs can read — a GitHub environment secret restricted to the default branch,
    or a GitLab protected variable where the default branch is the only protected ref
    (R-BTN-156) — never a plain repository secret. On a shared server only the sync account
    reads it. `baton repo init` writes the CI configuration that way.
  - **`verifySync(req) → {repository, role}`** is the only check. It refuses `unauthenticated`
    (no credential, bad signature, unknown or revoked key, a token that fails) or `forbidden`
    (another role, a key that is no sync credential, a machine key whose grant does not sync
    there). Every `/v1/sync/*` route uses only its answer.
  - **A repository has a mirror** when it is not retired (R-BTN-47) and has a `mirror_workflow`,
    `ci_identity.mirror` is true, or it has a `mirror`-role sync key. Only sync keys and CI tokens act as the mirror.

- **R-BTN-15 / R-BTN-156 (CI identity tokens).** `ci_identity` (§13) is NULL (sync keys only),
  `{kind: 'github-actions'}` or `{kind: 'gitlab-ci', issuer, mirror}`.
  - **GitHub Actions OIDC**, verified in the Worker: issuer
    `https://token.actions.githubusercontent.com`; audience `BATON_ORIGIN`; `repository_id` and
    `repository_owner_id` equal the stored ids; `ref` is the default branch;
    `job_workflow_ref` is `<repository>/<sync_workflow>@refs/heads/<default branch>` for
    `/v1/sync/board` and `/v1/sync/observation`, or the `mirror_workflow`'s for
    `/v1/sync/events`; `workflow_ref` equals `job_workflow_ref` (the sync is the run's
    top-level workflow); `event_name` is `push`, `schedule` or `workflow_dispatch`.
  - **GitLab CI `id_tokens`**: issuer the repository's GitLab instance, verified only against a
    `gitlab_issuer` listed in `BATON_FORGE_SECRETS` (keys at `<issuer>/oauth/discovery/keys`,
    never fetched from a token's own `iss`) and equal to `ci_identity.issuer`; `project_id`
    and `namespace_id` equal the stored ids; `ref_type: branch`, `ref` the default branch;
    `ref_protected: "true"`; `pipeline_source` in `push`, `schedule`, `web`, `api`,
    `trigger`; audience `<BATON_ORIGIN>#sync` or `<BATON_ORIGIN>#mirror`, which chooses the
    role. `repo init` writes a sync job that reads no pipeline variables.
  - **GitLab sync keys.** `repo init --forge gitlab` refuses a sync key unless the default
    branch is the only protected ref, and writes the CI identity instead where `id_tokens`
    exist.
  - A token reads and writes its own repository's board and events only. Whoever can push the
    default branch can post any board for it — a legitimate user (R-BTN-66); the token proves
    only default-branch origin. No push changes the state Baton holds for authority (§12).

### 3.3 Triggering a sync

- **R-BTN-94 (Baton records that a run is wanted; a runner pulls it, and Baton may dispatch it).** Where this
  specification says Baton dispatches a sync, Baton **records a want** — never for a retired
  repository (R-BTN-47) — in the transaction that causes it — a claim, an `advance`, an end, a fact arrival, an adoption, a forced Resync (R-BTN-11),
  a raise that names a handler (R-BTN-161),
  a person's answer held in Baton, an owner bar set or lifted,
  an unblocked ticket, a forge notification, the dashboard's **Resync**, `POST /v1/sync/want`
  (sync credential) or `POST /v1/owner/{repository}/sync-want` — then, where the repository
  has a dispatch target, **starts the workflow itself**: the object records the dispatch and the
  host shell performs it through `Dispatch` (R-BTN-55) after the transaction commits, from the
  request or from the alarm, never awaited by either (§2.1), with the credential Baton holds for
  the target.
  - **The sync's want** is `sync_wanted_at` (earliest unanswered want; set when NULL) and
    `sync_wanted_after` (`board_head.last_handed_out` at the latest want; 0 before any number).
    A board post accepted whose observation is **strictly greater** than
    `sync_wanted_after` clears both, so a want raised while a run reads is answered by the next
    run. Wants are not exported (R-BTN-88).
  - **The mirror's want** is implicit: unread events of a kind the mirror writes above
    `mirror_acked_seq` (§16). A mirror run ends with one `GET /v1/sync/events` at its final
    cursor, which acknowledges it.
  - **`GET /v1/sync/wanted`** answers `{wanted, since?, head_sha}` for the credential's role;
    `head_sha` is the newest commit any post named. It writes only its
    nonce row.
  - **Who answers a want**, any of: a cron loop (`baton repo sync --if-wanted`, `baton repo mirror
    --if-wanted`, each minute); a CI schedule (every 15 minutes as a backstop); runners
    (R-BTN-105); the dispatch below; optionally a server `post-receive` hook that only touches a
    spool file (`baton repo spool <repository>`) which the sync account's loop turns into
    `POST /v1/sync/want` and a run. The hook never reads the sync key and never waits for a sync.
  - **Dispatch targets** (`dispatch`, §13) name what Baton calls:
    `{kind: 'github-app'}` — `workflow_dispatch` through the GitHub App (§12.7), with an
    installation token Baton mints from the App's key; `{kind: 'gitlab-trigger', project_id,
    ref}`, with the trigger token; `{kind: 'gitea', workflow, ref}`, whose token belongs to a bot
    user with write access to that one repository only. Baton holds these credentials as Worker
    secrets (`BATON_GITHUB_APP_KEY`, and the tokens in `BATON_FORGE_SECRETS`), never in SQLite or
    an export: Baton's server is trusted with them (§12.8; the owner, 2026-11-01, "Drop it": no
    dispatch courier stands between Baton and the forge). Without a target (every `git`
    repository) Baton dispatches nothing and the runners alone answer wants; a dispatch that
    fails is retried once and then only adds latency, since the want stands until a post answers
    it. Baton dispatches only the repository's `sync_workflow`, `mirror_workflow` and the owners'
    unblocked trigger's workflow (§12.7). Dispatches of one workflow coalesce into one per
    repository and workflow per 30 seconds, whatever recorded the want, a dispatch wanted inside a window sent at its end as
    the **trailing dispatch** (R-BTN-73); the window and the pending trailing dispatch are the
    `webhook_syncs` row of that repository and workflow (`window_until`, `trailing_wanted`, §13),
    which the alarm reads. A mirror's dispatch is sent when events the mirror
    writes are unread above `mirror_acked_seq` and its row has no `trailing_wanted`, and at a seal.
  - **The unblocked trigger** (`unblocked_trigger`, owners' setting): NULL or a target of
    `dispatch`'s shape, dispatched when a ticket unblocks (R-BTN-77) with its `tickets` input
    (≤ 100, then a `truncated` count), coalesced in `unblocked_dispatch`'s 30-second window. It
    uses the repository's own dispatch credential; owners choose only the workflow — one under
    `.github/workflows/` or `.gitea/workflows/` on the default branch that declares a manual
    dispatch with a `tickets` input (the count past 100 travels inside it, R-BTN-77); GitHub
    refuses a dispatch carrying an input the workflow does not declare, so only a workflow that
    declares the input can be its target, and on a forge that ignores undeclared inputs the
    loosening gate below is the bound — or, on GitLab, only whether to call it. A target of
    another shape, or a workflow path outside those folders or the default branch, is
    `invalid-params`; whether the workflow declares the input is the forge's to enforce at
    dispatch. Setting or changing it is a loosening (R-BTN-186): it widens
    what Baton starts.
  - **What Baton holds.** `BATON_FORGE_SECRETS` (`--forge-secrets <file>` locally) is JSON keyed by
    repository id, `{forge, gitlab_issuer?, webhook?, trigger_token?}`, beside
    `BATON_GITHUB_WEBHOOK_SECRET` and `BATON_GITHUB_APP_KEY`. A webhook secret verifies an inbound
    delivery; a trigger token and the App's key act, and act only to start the workflows above.
    Registration refuses a repository whose entry names another forge.
  - Raises: `baton.forge-secret-missing` (a configured webhook with no secret, or a dispatch
    target with no credential); `baton.sync-late` (a sync want older than 30 minutes);
    `baton.mirror-late` (a mirror more than 30 minutes behind).
  - **The GitHub App** (§12.7) is GitHub's dispatch target and Baton's webhook source.
- **R-BTN-73 / R-BTN-95 (forge notifications are only triggers).** A notification records a
  want; it never computes or carries state. The one thing besides the want a delivery produces
  is the scope cross-check (B-134, §12.9): a push by a worker pusher of the owners'
  `worker_pushers` setting to a repository no open claim's scope covers records an
  `unclaimed-write` finding from the delivery's own fields — no repository content is read
  (an open claim is one still holding its ticket, as rule 3 reads it: active, or completed
  and unconfirmed, or reaped fence-pending, so a delivery of an ordinary leg-end push that
  lands after the claim's `end()` is still covered).
  - **Routes.** `POST /v1/github/webhook` takes the App's deliveries for every repository it is
    installed on (`X-Hub-Signature-256` under `BATON_GITHUB_WEBHOOK_SECRET`).
    `POST /v1/forges/{repository}/notify` takes a GitLab notification (`X-Gitlab-Token`
    compared with the repository's `webhook` secret), a Gitea one (`X-Gitea-Signature`,
    HMAC-SHA256) or a GitHub repository webhook (`X-Hub-Signature-256` under the repository's
    own secret, for a repository without the App). A `git` repository has no route. Both routes
    are verified in the Worker before anything is read, are outside the per-IP limit (§2.3), and
    answer `204`. A body over 26,214,400 bytes (25 MiB, above the largest delivery GitHub sends)
    is refused `too-large` on its `Content-Length`, or once that many bytes have been read,
    before any digest is computed. Every
    comparison is constant-time over equal-length digests.
  - **Events and the only fields read:**

    | forge | events | fields |
    |---|---|---|
    | GitHub | `push`, `pull_request`, `pull_request_review`, `issue_comment`, `workflow_run` | `X-GitHub-Event`, `X-GitHub-Delivery`, `repository.full_name`, `repository.id`, `workflow_run.path`; push: `pusher.name`, `head_commit.author.email`; pull_request: `pull_request.merged`, a boolean or null (B-89) |
    | GitLab | `Push Hook`, `Merge Request Hook`, `Note Hook` | `X-Gitlab-Event`, `X-Gitlab-Event-UUID`, `project.path_with_namespace`, `project.id`; push: `user_username`, head commit `author.email` |
    | Gitea | `push`, `pull_request`, `pull_request_review_*`, `issue_comment` | `X-Gitea-Event`, `X-Gitea-Delivery`, `repository.full_name`, `repository.id`, `repository.owner.id`; push: `pusher.login`, `head_commit.author.email` |

    No pipeline or job event is accepted from GitLab or Gitea.
  - **Dropped:** a delivery id seen in the last 24 hours (`webhook_deliveries`); a
    `workflow_run` whose path is the repository's `sync_workflow` or `mirror_workflow`; and,
    while the repository has a mirror (*adoption*, §16), a push whose pusher (`pusher.name`, `user_username`, `pusher.login`) is the repository's
    `mirror_pusher` — the forge account the mirror pushes as, set by the administrator with the
    mirror — **and** whose head commit's author email is the mirror's (§16), so a mirror write
    never triggers a sync. An author email alone, which any pusher can set, drops nothing.
  - **Which want.** A delivery records a want for the repository it names (by id, R-BTN-138)
    and for each registered repository whose `code_repos` lists it (by id once stored). A
    delivery to `/v1/forges/{repository}/notify` records a want for `{repository}` only, and only
    when its project is `{repository}` or one of its `code_repos`.
  - **A merge dispatches the sync (B-89).** A `pull_request` delivery that is not a merge
    (`pull_request.merged` anything but `true`) records nothing. When it is a merge, and the
    delivery names a registered repository's own home repository, that repository joins the
    want's set and its sync is dispatched — the trigger that fires when the workflow's
    `schedule` does not: 14 runs of a `*/15` cron in 51 hours (2026-10-22T10:22Z to 2026-10-24
    13:34Z), gaps of 2–5 hours, measured on the workflow's own history. The delivery names only
    `repository.full_name`, so the pull request's base branch is not read: a merge into another
    branch of the same repository sends the same sync, which reads the head it is dispatched
    against and posts the board it falls back to. It is dispatched whether or not the
    repository has cut over: §7.1's reason for holding a sync back (the mirror writes git after
    the cutover, and a sync that reads git from GitHub needs no mirror) does not hold for a sync
    that carries no mirror write. Every dispatch the webhook path sends, a merge's and another
    repository's want's alike, is timed in `webhook_syncs`: one row stamped by every repository
    the delivery dispatches, at the instant it decides — a push's sync of the delivery's own
    repository and another repository's want included — and stamped again by the alarm when the
    path sends on the backstop below. It shares R-BTN-73's 30-second window with the want's
    dispatches, and is sent whatever the repository's mode. Its stamp is written in the transaction
    that decides the dispatch, before the shell sends it; a send that fails is not forgotten: its
    stamp stands, and the backstop sends
    another once the stamp is stale, whatever the schedule does. A repository with no dispatch
    target gets no dispatch and no stamp (R-BTN-94), and the backstop skips it, so it never
    re-fires there.
  - **The webhook path's own backstop (B-89).** A live registered repository whose `webhook_syncs`
    row is stale — `last_dispatch_at` under the alarm's `now` less 10 minutes, strictly, so a
    stamp is never due again on the tick that wrote it, and a row exactly ten minutes old is not
    yet due — is sent a dispatch at R-BTN-73's alarm: the App's deliveries reached Baton, and
    this path did not send one. The alarm is armed for the earliest live stamp's
    `last_dispatch_at + SYNC_STALE_MS` (the first instant the strict comparison holds), as it is
    for a trailing dispatch and a lapsed reading, so the send lands at ten minutes rather than up
    to a minute later on the ordinary path; a tick that lands late sends once, not on every tick
    after. Sending opens the repository's 30-second window, so
    a delivery arriving meanwhile waits for the trailing dispatch rather than racing it. A
    repository with no row has never had one sent and takes no part in the backstop, which
    keeps it on the repository's own triggers: a row exists only where the App's deliveries led
    the path to a repository, and ten minutes without a send there is what the row being ten
    minutes old means (this repository merges up to a dozen times a day; `docs`, whose tickets
    name this repository, is sent a sync for each of them, while its own pushes are its
    workflow's).
  - **The schedule is the backstop of last resort.** The default workflow's `schedule` stays:
    what it adds over the two above is independence of the App, and it is not assumed to fire.

- **R-BTN-105 (a sync reads the commit it syncs; a plain server needs nothing).**
  - **Every input from the commit.** A sync reads tickets, `.baton/`, each course's
    `course.json` and `sync.mjs`, and the ticket source from the commit it posts — the remote
    default branch's head as just fetched — in a detached worktree of the whole commit (never
    a working tree), with `.baton/package.json`'s dependencies installed by R-BTN-133's rules
    and sourced courses read from their source (R-BTN-134).
  - **Runners sync.** A runner runs its repository's code already, so syncing adds no exposure
    within its tenant, except sourced courses' station functions it does not otherwise run. A
    runner that pushes the default branch syncs after its push. A runner that offers to sync a
    repository polls `GET /v1/sync/wanted?repository=<id>` and `git ls-remote <remote>`, each at
    most once a minute while live, and runs `baton repo sync` when `wanted` is true or the remote
    head differs from `head_sha`. Observation numbers and `sync-busy` (R-BTN-62) keep several
    runners from posting at once.
  - **A plain repository** is a bare repository reachable over SSH (plus, for a standard
    course, the baton repository or a mirror its source maps to). No hook, spool, sync account
    or sync key is required. The server must set `receive.denyNonFastForwards = true`,
    `receive.denyDeletes = true` and `git-shell` (or gitolite) as runner keys' login shell;
    `baton repo init --forge git` prints them.
  - **Two key lists.** The git server's `authorized_keys` and Baton are separate authorities;
    revoking a key needs both.
  - A client-side git hook is never a trigger: it fires before anything is shared.

- **R-BTN-97 (a sync off a CI sandbox).** A machine that is neither a CI sandbox nor a runner
  either runs the sync as an unprivileged user in a container holding no credential but the
  sync key and reaching only Baton's origin and the forge, or runs `baton repo sync
  --defaults-only` (R-BTN-134). This is the operator's obligation; Baton cannot see which runner
  posts, and a sync key's reach bounds the harm to one board.

### 3.4 Reading the forge

- **R-BTN-96 (course facts come from an adapter per forge).** For a course whose `entry.json`
  declares `facts: ["prs"]` (R-BTN-134) the CLI reads PR facts through a **fact adapter**
  chosen by `forge` — GitHub PRs and reviews, GitLab merge requests and approvals, Gitea PRs and
  reviews — mapped to one set of facts: a PR's head branch, state, head checks and verdicts on
  the head. Each fact carries `repository`, fork-ness and `pusher` (R-BTN-139). The verdict line
  `<!-- baton:verdict approve|changes -->` works on every forge.
  - The adapter reads the home repository and every `code_repos` repository a live ticket on a
    PR-reading course names (deduplicated, case-insensitive), under one request budget. An
    unreadable or missing repository fails the sync, naming the tickets; a partial reading is
    never posted. On GitHub it lists PRs over REST and reads live tickets' PRs over GraphQL, at
    most 25 PRs a query per repository (head-commit check runs through check suites, latest run
    per check; commit dates; reviews; issue comments); an overflowing first page or a head read
    at another commit is read over REST in full; an answer with `errors` fails the sync. Built:
    B-29, B-35.
  - **The `branch` course** (a course directory of the baton repository, `facts:
    ["branches"]`; `baton repo init --course branch`) reads the home repository's git alone:
    - stations `filed` → `pushed` → `reviewed` → `merged`, with `fixed` between `reviewed` and
      the next review; legs `implement`, `review` (`max_runs` 4), `fix` (`max_runs` 3),
      `merge`; no `short_waits`;
    - a ticket's branch is a ref matching the current or previous `branch_pattern` with a commit
      not reachable from the default branch; with several, the least advanced decides; none is
      `filed`;
    - a content commit's tree differs from its first parent's; a verdict is an empty commit whose
      trailers (`git interpret-trailers --parse`, last occurrence per key) carry
      `Baton-Verdict: approve|changes`, `Baton-Reviewed: <40-hex>` and `Baton-Claim: <nonce>`
      (the `review` claim's). A verdict no `review` claim wrote counts like any other: whoever can
      push is trusted (R-BTN-46, R-BTN-66), and where the policy admits no `sync` verdict the
      review is an attestation instead (R-BTN-187). Walking first-parent
      history from the head, the newest verdict reviewing the newest content commit decides:
      approve is `reviewed` with `merge` ready, changes `reviewed` with `fix` ready; content
      after it is `fixed`; content and no verdict is `pushed`;
    - `merged`, judged first, holds when the default branch's first-parent history has a commit
      with trailer `Baton-Ticket: <local id>`; the `merge` stub merges with `git merge --no-ff`
      and that trailer and pushes.

- **R-BTN-139 (on a forge, only pushers' writes count).** The fact adapter marks every PR,
  comment, review and approval `pusher` or not, once per sync run. Standard station functions
  read only pushers' facts; the adapter exports `pusher` to a course's own `sync.mjs`; whatever
  station function runs, the CLI drops every posted marker and output whose author is not a
  pusher. A non-pusher's markers are never read, so never an output or a position; the sync log
  counts them per PR. This is the one sense in which a forge author is trusted here; the word
  `trusted` is kept for the runner role (R-BTN-182), and `pusher` names this (B-163).
  - **PRs that count.** A PR found by `branch_pattern` counts only when its head repository is
    its base repository by id — GitHub `pull.head.repo.id == pull.base.repo.id` (a null
    `head.repo` is a fork), GitLab `source_project_id == target_project_id`, Gitea
    `head.repo_id == base.repo_id` — and its base is the home or a `code_repos` entry. A fork's PR
    counts only when a pusher names it in `prs:`; its outsiders' words still do not count.
  - **Words that count only from pushers:** verdict lines, adjudication and conclusion
    lines, forge review states and approvals, and every `baton:` marker (comment, review or PR
    body). A text counts only when its author **and every editor** are pushers: GitHub's GraphQL
    `userContentEdits`; on GitLab and Gitea the author is a pusher and `updated_by`, where
    present, is the author.
  - **A pusher**: an immutable forge user id in the owners' `pushers`, or
    someone the forge reports can push to the PR's base — GitHub
    `GET /repos/{owner}/{repo}/collaborators/{username}/permission` is `admin` or `write`
    (`author_association` only pre-filters); GitLab `GET /projects/:id/members/all/:user_id`
    has `access_level` ≥ 30 (approvals filtered the same); Gitea collaborator permission
    `write`, `admin` or `owner`. `baton owner settings set` warns when a shared echoing bot (such as
    `github-actions[bot]`) is listed.
  - **Failures.** A permission or editors read that errors aborts the sync run, which posts
    nothing and releases its number (R-BTN-150). Only a token known to lack the scope degrades: permissions to `pushers`
    (fail closed), raising `baton.pushers-degraded`; a text whose editors cannot be read does not
    count. Permissions are cached per author per run (GitLab
    and Gitea read the member list once per run) and re-read every sync, so a verdict whose author
    lost push stops counting from the next snapshot's readiness on (R-BTN-39). `repo init --forge
    gitlab` provisions a `read_api` token for the lookup.

- **R-BTN-140 (code repositories are the owners' list).** The owner setting `code_repos` lists
  forge repositories on the home forge host. Owners write each entry's `path` only; Baton
  resolves it at addition to `{path, repo_id}`, keeps `former_paths` itself and matches by id
  thereafter, and a re-written list keeps the ids of the paths it keeps.
  - An entry whose id is a registered repository of the tenant — the live one with that id, else a retired one, whose entry then never has reach — needs that repository's
    consent, a `code_repo_consents` row judged by id at every use and never written by A's
    settings: `POST /v1/owner/{B}/code-repo-consents {repository: A, confirm: true}` signed by
    B's owner, or an administrator's `code_repo_consents_add` (`POST /v1/admin/repositories`);
    `withdraw: true` withdraws it. Without consent the entry has no reach and raises
    `baton.code-repo-unconsented`.
  - A `repos:` entry gains reach only when it resolves — path first mapped to its current one by
    id, so a re-created former path never gains reach outside the fence — to an id in
    `code_repos`. Only such an entry may be named by a `git:` or `https://` input URI the runner
    fetches (§12.3); be searched for PRs or named in `prs:` (R-BTN-139); map a branch in the
    branch-holder query (R-BTN-141); carry a person leg's question `url` (R-BTN-116). Any other entry is
    shown and filtered on only, and the ticket raises `baton.repo-not-listed`.
  - `POST /v1/sync/observation` hands the sync the effective `code_repos` (consented entries
    with their ids) and `pushers`.

- **R-BTN-141 (a branch pattern's grammar and reach).**
  - `branch_pattern` and `previous_branch_pattern` (R-BTN-51): a literal prefix of 1–64
    characters of `[A-Za-z0-9._/-]` ending in `/` or `-`; `{ticket}` exactly once, optionally
    beside `{repository}` with a literal separator; then nothing, or one separator from
    `/ - _ .` and an optional trailing `*`. At most 128 characters. `*` matches
    `[A-Za-z0-9._/-]*`; no `?`, `[` or `**`. Default `claude/{ticket}-*`.
  - The sync refuses any other pattern and posts nothing; Baton refuses it in a posted
    registry (`invalid-params`). A pattern matches `refs/heads/*` only.
  - **Longest id wins.** `.` and `-` are both id characters and separators, so `claude/T-12-1-impl`
    matches `T-12` and `T-12-1`. A branch maps to a ticket only when no other ticket of the
    same repository whose id is longer also matches it; the fact adapter, standard station
    functions, the local branch check and the branch-holder query all apply this. A child not yet
    posted cannot win yet: until its first snapshot the query maps its branch to the parent.
  - **The branch-holder query** (§9) maps a branch of git repository G only to tickets whose
    home is G or whose `repos:` entry for G is in the home's `code_repos`, and names only
    tickets of repositories the asking key is granted on; any other match answers
    `held_by_other: true`, with no ids.

