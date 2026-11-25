---
title: "3. Repositories and forges"
description: "A Baton hands out the tickets of the repositories its administrator registers."
---
## 3. Repositories and forges *(proposal)*

A Baton hands out the tickets of the repositories its administrator registers. A repository
lives on a **forge** — GitHub, GitLab, Gitea — or on a plain git server (`git`). Core reads no
forge: the forge only selects which adapters a repository may use (credentials, dispatch,
notifications, PR facts) and how Baton builds links. Every adapter is optional; a bare
repository reachable over SSH is enough (R-BTN-105).

**The forge adapters.** The rules of this section are written once, for every forge. Where a rule
says "the forge's" id, verifier, target or lookup, this table says what that is. A `git`
repository has none of them.

| | GitHub | GitLab | Gitea |
|---|---|---|---|
| forge path segments (`git`: two, the administrator's choice) | two | two to four | two |
| `forge_repo_id`, `forge_owner_id` | repository `id`, owner `id` | project `id`, namespace `id` | repository `id`, owner `id` |
| the CLI's token for reading ids and facts | `GITHUB_TOKEN` | `GITLAB_TOKEN` | `GITEA_TOKEN` |
| CI identity token (R-BTN-15) and its ids | Actions OIDC: `repository_id`, `repository_owner_id` | CI `id_tokens`: `project_id`, `namespace_id` | none |
| notification route and verifier (R-BTN-73) | the App's `POST /v1/github/webhook`, `X-Hub-Signature-256` under `BATON_GITHUB_WEBHOOK_SECRET`; without the App, a repository webhook at `POST /v1/forges/{repository}/notify` under the repository's own secret (not built) | `…/notify`, `X-Gitlab-Token` equal to the repository's `webhook` secret (not built) | `…/notify`, `X-Gitea-Signature` (HMAC-SHA256) (not built) |
| events accepted | `push`, `pull_request`, `pull_request_review`, `issue_comment`, `workflow_run` | `Push Hook`, `Merge Request Hook`, `Note Hook` | `push`, `pull_request`, `pull_request_review_*`, `issue_comment` |
| fields read, and no others | `X-GitHub-Event`, `X-GitHub-Delivery`, `repository.full_name`, `repository.id`, `workflow_run.path`; push: `pusher.name`, `head_commit.author.email` and the push record's fields (R-BTN-73); `pull_request.merged` | `X-Gitlab-Event`, `X-Gitlab-Event-UUID`, `project.path_with_namespace`, `project.id`; push: `user_username`, head commit `author.email` | `X-Gitea-Event`, `X-Gitea-Delivery`, `repository.full_name`, `repository.id`, `repository.owner.id`; push: `pusher.login`, `head_commit.author.email` |
| dispatch target (R-BTN-94) and its credential | `{kind: 'github-app'}`: `workflow_dispatch` with an installation token minted from the App's key (§12.7) | `{kind: 'gitlab-trigger', project_id, ref}`: the trigger token | `{kind: 'gitea', workflow, ref}`: the token of a bot user with write access to that one repository |
| PR facts (R-BTN-96) | PRs and reviews | merge requests and approvals | PRs and reviews |
| a PR's head repository is its base (R-BTN-139) | `pull.head.repo.id == pull.base.repo.id`; a null `head.repo` is a fork | `source_project_id == target_project_id` | `head.repo_id == base.repo_id` |
| a text's editors (R-BTN-139) | GraphQL `userContentEdits` | `updated_by`, where present, is the author | as GitLab |
| can push to the base (R-BTN-139) | `GET /repos/{owner}/{repo}/collaborators/{username}/permission` is `admin` or `write` | `GET /projects/:id/members/all/:user_id` has `access_level` ≥ 30 | collaborator permission `write`, `admin` or `owner` |

No pipeline or job event is accepted from GitLab or Gitea. The App does not serve GitHub
Enterprise hosts. Only the App's notification route is built (R-BTN-73); the per-repository
route, with the events and fields the table lists for it, is
[proposed](../proposals/tickets-and-sources.md).

### 3.1 The registry

- **R-BTN-47 (registered repositories).** Baton keeps a registry of repositories
  (`repositories`, §13). Each has:
  - an id, `^[a-z][a-z0-9-]{0,39}$`, unique in its tenant (R-BTN-135);
  - its forge, forge path, `remote` and `web_base` (R-BTN-92) and the forge's ids (R-BTN-138);
  - its default branch, its sync credentials (R-BTN-93, R-BTN-15) and, with GitHub Actions,
    the `sync_workflow` allowed to post its board (and, legacy, the `mirror_workflow`, §16);
  - its optional dispatch target and unblocked trigger (R-BTN-94), its `weight` (R-BTN-61) and
    its owner settings (R-BTN-66).

  Only an administrator registers, changes or retires a repository, with its first owner keys
  (`POST /v1/admin/repositories`, R-BTN-57). A change never alters `forge`; it changes the
  forge path only by R-BTN-138's rules.

  - **Retirement** (`admin.repo.retire`, destructive, §12.2) is final. In the transaction that
    sets `retired_at`, Baton:
    1. revokes its sync keys and its runner grants (R-BTN-93, R-BTN-58);
    2. reaps each active claim on its tickets as an administrator's force-reap does, so a claim
       whose runner is alive is fence-pending (R-BTN-19), actor `admin:<fingerprint>`;
    3. closes its conditions still open after those reaps (R-BTN-160);
    4. deletes its `webhook_syncs` rows, its coalescing windows and its unblocked trigger, and
       its id from every account instance's `repositories` list (R-BTN-94, R-BTN-77, R-BTN-76).

    The steps for stores that are not built (owners' sessions, MCP keys and OAuth, registration
    tokens, the outbox, ticket timers, code-repository consents) are
    [proposed](../proposals/data-model-and-api.md) with each store.

    Afterwards every rule reads live repositories only: a retired one has no dispatch,
    credential, owner, policy or count, and every call naming it is `not-found`, as for one never
    registered. Its rows stay, read-only, for administrators' reads. Two things stay live while
    one of its claims is fence-pending: the fence itself — the alarm clears it at its
    `fence_deadline`, an administrator may clear it, the seal waits for it (R-BTN-19, R-BTN-88),
    and the old holder's heartbeat, whose retired course is dropped rather than refused
    (R-BTN-3), can still report `fenced` — and the holder queries, which keep answering for its
    former path (R-BTN-7, R-BTN-138). Its id is never registered again in the tenant (`conflict`);
    an export carries its tombstoned registry row alone (R-BTN-138, R-BTN-88).

  - **The seed.** `BATON_REPOSITORIES` seeds the registry at start, insert-only, through
    registration's validation: each entry is a registration's body, with or without its
    `owner_keys`. It writes an entry's owner keys (`added_by: admin:seed`) only where that
    repository has no owner. A malformed entry, or an owner key that holds another role
    (R-BTN-57), stops the start before any entry registers. A key an administrator revoked and an
    entry naming a retired id are skipped and logged; a repository a skipped key leaves with no
    owner is named in `seed_owners` (R-BTN-179).
  - **Home.** Every ticket belongs to one registered repository, its **home**. Baton's API,
    events and dashboard name a ticket by its qualified id `<repository id>:<local id>`; runners,
    branch names and git use the local id. Two repositories may share local ids.
  - **One board per repository**: its own head and compare-and-set (R-BTN-11), observation
    counter (R-BTN-62) and sync run. A sync credential posts only its own repository's board.
  - **Relations stay home, `depends_on` excepted.** A ticket's `parent` (so its children's
    `blocked_by`) names tickets of the same repository. Its `depends_on` may name a ticket of
    another repository registered with the same Baton by its qualified id; an unqualified id
    stays local, and a repository's own id spelled qualified is read as the local id alone. A
    qualified dependency resolves against the target's board (§4.4, R-BTN-120):
    the target must be live-registered and its ticket live or closed there, and a cycle through
    two boards is refused as one board's is.
    - **Visibility and consent.** A dependency shows the target ticket's state and title
      wherever the dependent's board is seen, and no other field of the target. It is accepted
      when every owner key and runner grant that sees the dependent's board sees the target's
      too. Otherwise it needs the target repository owners' consent: one row on the target naming
      the dependent, given by `POST /v1/owner/{repository}/dependency-consents {repository:
      <dependent>, confirm: true}` (`withdraw: true` takes it back), judged by id at every use
      and never written by the dependent's own settings. Without it the post is refused
      `invalid-params` and the sync's dependencies read `forbidden`, both naming the consent.
  - **Repositories a ticket changes** (`repos:`) are filter fields its course reports. They
    need no registration; what they reach is R-BTN-140's.

- **R-BTN-92 (a repository is a forge, a forge path, a remote and a web base).**
  - **`forge`**: `github`, `gitlab`, `gitea` or `git` (none), fixed for the repository's life.
  - **Forge path** (column `github`): segments of `[A-Za-z0-9_.-]{1,100}`, none `.` or `..`,
    none ending in `.git`, joined by `/`, as many as the forge allows (the adapter table).
    Compared case-insensitively and unique among the tenant's live repositories. It is for
    display and links; the forge's ids identify the repository (R-BTN-138). Every repository name
    a ticket carries — `repos:`, `git:` URIs (§12.3), the branch-holder query's `?repo=` (§9), the
    markdown source's `repos` map (R-BTN-74) — is a forge path naming the home or an entry with
    reach (R-BTN-140).
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
  - **Lookups by path name the forge host.** A token or notification is matched among the
    repositories of its own forge host: GitHub's among `github` repositories on `github.com`.
  - The administrator may change `remote` and `web_base` (a move).

- **R-BTN-138 (a forge repository is named by its immutable ids).** A path can be re-created
  by someone else after a rename, transfer or deletion; ids cannot.
  - **Registration records the ids** (the adapter table) as decimal strings
    `^[1-9][0-9]{0,19}$` in `forge_repo_id` and `forge_owner_id`, with `forge_host`. A forge
    repository without ids is refused `invalid-params`. `baton admin repo add` reads them from
    the forge's API; `--forge-ids <repo>,<owner>` supplies them offline. Ids are unique among a
    tenant's live repositories on one forge host (`conflict`). A webhook's numeric id is
    converted only when `Number.isSafeInteger` holds, else the delivery is ignored and logged.
  - **The ids decide.** A CI token, delivery or notification whose ids match passes whatever
    path it carries; one whose ids differ fails whatever path it carries. The fact adapter's read
    of a `code_repos` entry (R-BTN-140) is judged the same way: a mismatch fails the sync, naming
    the entry. A re-created path never gains reach.
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
    §6); active claims on those tickets get a `requested` release (§6). The hold clears when a
    later verified rename stops colliding.
  - **Former paths reach the fence only** (the branch-holder query, §9), never authentication or
    links: `?repo=P` resolves to live repositories whose current path is `P`, and to one whose
    former path is `P` only while no live repository holds `P`. A `code_repos` entry keeps its own
    `former_paths` (latest 10), updated by id-matched deliveries. Several matches fail safe.
  - **Administrative changes (not built, B-45).** The design allows a confirmed manual path
    change to clear a held rename using the verified rename's rewrite, removal of a former path
    with `former_paths_remove`, and re-identification after a transfer with `forge_repo_id`
    and `forge_owner_id`. These fields are not supported by the repository change route (§14).
  - **Retiring** moves the path to `former_paths`, sets `github` to the tombstone
    `~retired/<id>` and stops reading `web_base`. The path validator and import (R-BTN-88)
    accept a tombstone only on a retired row.
  - Verified renames are `admin` events with `detail.action` `repo-renamed` (actor `sync`).
    The unbuilt administrative changes would record `repo-path-changed` or `repo-identified`
    (actor the administrator) for manual path changes and re-identifications, respectively.

- **R-BTN-61 (merging courses and repositories).** Recommendations order each (repository,
  course) group by the default order (§6), then merge the groups by: (1) expedited first
  (R-BTN-12); (2) the home repository's `weight` (default 100), higher first; (3) the
  candidate's place in its own group; (4) fewer legs to an end; (5) `ready_since`, oldest
  first; (6) ticket id. The matching query reads at most 50 candidates per group after posted
  bars and, when owner bars or readiness leave a group short, the group's next page, at most 4
  pages per group per request. The answer is the one checking every candidate gives. `?limit=`
  applies after the merge. A ticket is offered only for its queued leg (R-BTN-83), named in
  `legs`, a list of one.

### 3.2 Who may post a board

- **R-BTN-93 (sync keys and the one verifier).** A repository's sync authenticates with a sync
  key, a CI identity token (R-BTN-15) or a machine key granted on the repository (R-BTN-102,
  R-BTN-146). A board post from a class the policy's `inputs.board` excludes (`sync-key`,
  `ci-identity`, `machine`; R-BTN-188) is refused `forbidden`.
  - **A sync key** is an SSH key of R-BTN-13's types in one `sync_keys` row: exactly one
    repository and one role. Owners add and revoke it
    (`POST /v1/owner/{repository}/sync-keys`, `…/sync-keys/{fingerprint}/revoke`); an
    administrator at registration or by R-BTN-57's revoke. A key already serving a repository,
    or holding another role, is `conflict`; any other key is `forbidden` at `/v1/sync/*`.
    Requests are signed as R-BTN-13 says (namespace `baton-request`, same nonce cache).
    Revocation takes effect at the next request.
  - A sync key is bound to no branch: whoever holds it is the sync. `baton repo init` writes a CI
    configuration in which only default-branch runs can read it.
  - **`verifySync(req) → {repository, role}`** is the only check. It refuses `unauthenticated`
    (no credential, bad signature, unknown or revoked key, a token that fails) or `forbidden`
    (another role, a key that is no sync credential, a machine key whose grant does not sync
    there). Every `/v1/sync/*` route uses only its answer.
  - **The mirror.** Legacy, removed with its code (R-BTN-193). A sync key's role is `sync` or
    `mirror`; a repository has a mirror when it has a `mirror_workflow`, `ci_identity.mirror` is
    true, or it has a `mirror`-role sync key. Only sync keys and CI tokens act as the mirror
    (§16).

- **R-BTN-15 / R-BTN-156 (CI identity tokens).** `ci_identity` (§13) is NULL (sync keys only),
  `{kind: 'github-actions'}` or `{kind: 'gitlab-ci', issuer, mirror}`. A token is verified in
  the Worker. Its audience is `BATON_ORIGIN` (R-BTN-56; GitLab's adds `#sync`), its ids equal the stored ones
  (R-BTN-138), and it comes from a run on the default branch:
  - **GitHub Actions OIDC**: issuer `https://token.actions.githubusercontent.com`; `ref` is the
    default branch; `job_workflow_ref` is
    `<repository>/<sync_workflow>@refs/heads/<default branch>` and equals `workflow_ref` (the
    sync is the run's top-level workflow); `event_name` is `push`, `schedule` or
    `workflow_dispatch`.
  - **GitLab CI `id_tokens`**: issuer equal to `ci_identity.issuer` and listed as a
    `gitlab_issuer` in `BATON_FORGE_SECRETS` (keys at `<issuer>/oauth/discovery/keys`, never
    fetched from a token's own `iss`); `ref_type: branch`, `ref` the default branch;
    `ref_protected: "true"`; `pipeline_source` in `push`, `schedule`, `web`, `api`, `trigger`;
    audience `<BATON_ORIGIN>#sync`. `repo init --forge gitlab` writes a sync job that reads no
    pipeline variables, and refuses a sync key unless the default branch is the only protected
    ref.
  - The mirror's token (§16) names the `mirror_workflow` on GitHub and the audience
    `<BATON_ORIGIN>#mirror` on GitLab.
  - A token reads and writes its own repository's board and events only. Whoever can push the
    default branch can post any board for it (R-BTN-66); the token proves only default-branch
    origin. No push changes the state Baton holds for authority (§12).

### 3.3 Triggering a sync

- **R-BTN-94 (Baton dispatches a sync after the commit that wants one).** Where this
  specification says Baton dispatches a sync, the object records the dispatch in the transaction
  that causes it — a claim, an `advance`, an end, a person's answer held in Baton, an owner bar
  set or lifted, an owners' `required_bars` change, a forge notification — once per repository
  and workflow, and the host shell performs it through `Dispatch` (R-BTN-55) after the
  transaction commits, for a request and for the alarm alike, awaited by neither (for a
  repository before its cutover, §16, only a forge notification's and the unblocked trigger's
  are sent). A repository without a dispatch target is synced by
  whatever runs `baton repo sync` for it: a CI schedule or a cron loop.
  - **Not built:** a stored want that stands until a post answers it, its routes
    (`GET /v1/sync/wanted`, `POST /v1/sync/want`, the owner's `sync-want`), runners that pull
    it, the dashboard's **Resync** and `baton.sync-late`:
    [the proposal](../proposals/tickets-and-sources.md).
  - **Dispatch targets** (`dispatch`, §13) name what Baton calls, per forge (the adapter table).
    Baton holds their credentials as host secrets (R-BTN-55), never in SQLite or an export
    (§12.8). Without a target (every `git` repository) Baton dispatches nothing; a dispatch the
    forge refuses is logged with its reason. Baton dispatches only the repository's `sync_workflow` and the owners' unblocked
    trigger's workflow (§12.7).
  - **Coalescing.** Dispatches of one workflow coalesce into one per repository and workflow per
    30 seconds; one wanted inside a window is sent at its end, the
    **trailing dispatch**. The window is the `webhook_syncs` row of that repository and
    workflow (§13), which the alarm reads.
  - **The unblocked trigger** (`unblocked_trigger`, owners' setting): NULL or a target of
    `dispatch`'s shape, dispatched when a ticket unblocks (R-BTN-77) with its `tickets` input,
    with the repository's own dispatch credential and in its own coalescing window. Owners choose
    only the workflow: one under `.github/workflows/` or `.gitea/workflows/` on the default
    branch that declares a manual dispatch with a `tickets` input; on GitLab, only whether to
    call it. Any other target is `invalid-params`; whether the workflow declares the input is the
    forge's to enforce at dispatch. Setting or changing it is a loosening (R-BTN-186).
  - **What Baton holds.** `BATON_FORGE_SECRETS` is JSON keyed by repository id, `{forge,
    gitlab_issuer?, webhook?, trigger_token?}`, beside the GitHub App's secrets (R-BTN-55). A
    webhook secret verifies an inbound delivery; a trigger token and the App's key act, and act
    only to start the workflows above. Registration refuses a repository whose entry names
    another forge.
  - **The mirror.** Legacy, removed with its code (R-BTN-193). Baton dispatches the
    `mirror_workflow` for the events a mirror writes and at a seal; a mirror run acknowledges
    what it read with the `GET /v1/sync/events` it ends with (§16).
- **R-BTN-73 / R-BTN-95 (forge notifications are only triggers).** A notification has Baton
  dispatch a sync (R-BTN-94); it never computes or carries state. Baton reads from it only the fields the adapter
  table lists.
  - **Routes.** Each forge's route and verifier are the adapter table's; a `git` repository has
    none. The App's route is verified in the Worker before anything is read and answers `204`;
    the per-repository route is not built and answers `not-found`. On either, a body over
    26,214,400 bytes is refused `too-large` on its `Content-Length`, or once that many bytes
    have been read, before any digest is computed. Every comparison is constant-time over
    equal-length digests.
  - **Dropped:** a delivery id seen in the last 24 hours (`webhook_deliveries`); a
    `workflow_run` whose path is the repository's `sync_workflow` or `mirror_workflow`; and,
    legacy (§16), a push by the Actions bot whose head commit's author email is the mirror's, so
    a mirror write never triggers a sync. An author email alone, which any pusher can set,
    drops nothing.
  - **Which sync.** A delivery triggers the sync of the repository it names (by id, R-BTN-138)
    and of each registered repository whose `code_repos` lists it. A `pull_request` delivery
    triggers one only when it is a merge (`pull_request.merged` is `true`), whatever its base branch.
  - **The push record.** A GitHub push delivery to a branch is recorded for ticket provenance
    (R-BTN-194): `sender.id`, `sender.login`, `ref`, `before`, `after` and each commit's `id`
    with its `added`, `removed` and `modified` paths, up to 30 commits and 600 paths. A push past
    the bounds is remembered `truncated` with no paths, and one that does not parse is not
    recorded; what either changed reads as `pusher-unknown`, and the delivery still triggers. The
    record lives 24 hours.
  - **Findings.** From the delivery's own fields, reading no repository content: a push by a
    worker pusher of the owners' `runner_pushers` setting to a repository no open claim's scope
    covers records an `unclaimed-write` finding (§12.9), an open claim being one still holding
    its ticket — active, completed and unconfirmed, or reaped fence-pending.
  - **The backstop.** Every dispatch this path decides stamps the repository's `webhook_syncs`
    row (`last_dispatch_at`) in the deciding transaction, before the shell sends it, so a failed
    send keeps its stamp. A live repository whose stamp is more than 10 minutes old is sent a
    dispatch by the alarm, once, which stamps the row again and opens the coalescing window. A
    repository with no row or no dispatch target takes no part.
  - The default workflow's `schedule` stays as a trigger independent of the App; no rule assumes
    it fires.

- **R-BTN-105 (a sync reads the commit it syncs; a plain server needs nothing).**
  - **Every input from the commit.** A sync reads tickets, `.baton/`, each course's
    `course.json` and `sync.mjs`, and the ticket source from the commit it posts — the remote
    default branch's head as just fetched — in a detached worktree of the whole commit (never
    a working tree), with `.baton/package.json`'s dependencies installed by R-BTN-133's rules
    and sourced courses read from their source (R-BTN-134).
  - **Runners that sync** are not built (R-BTN-94):
    [the proposal](../proposals/tickets-and-sources.md).
  - **A plain repository** is a bare repository reachable over SSH. No hook, spool, sync account
    or sync key is required. `baton repo init --forge git` prints the server settings it relies
    on: no non-fast-forward pushes, no deletes, and a restricted login shell for runner keys.
    The git server's `authorized_keys` and Baton are separate authorities; revoking a key needs
    both.
  - A client-side git hook is never a trigger: it fires before anything is shared.

### 3.4 Reading the forge

- **R-BTN-96 (course facts come from an adapter per forge).** The CLI reads PR facts for every
  course (R-BTN-203), not only one whose `entry.json` declares `facts: ["prs"]` (R-BTN-134),
  through a **fact adapter** chosen
  by the forge of the repository it reads — the home's by the home's, each code repository's by
  its own (R-BTN-140) — mapped to one set of facts: a PR's head branch, state, head checks,
  verdicts on the head, its merge commit, and its title and body (read for R-BTN-203's evidence,
  never posted). Each fact carries `repository`, fork-ness and `pusher` (R-BTN-139). The
  verdict line `<!-- baton:verdict approve|changes -->` works on every forge.
  - The adapter reads, for every course (R-BTN-203 reads any course's tickets), the home
    repository and every repository with reach (R-BTN-140) that a live ticket names (deduplicated, case-insensitive), under one request
    budget **per host**. A `git` home is read by no adapter; its code repositories are read on
    their own forges. An unreadable or missing repository, or an answer carrying errors, fails
    the sync, naming the tickets; a partial reading is never posted.
  - Where a token cannot read a repository's check suites, that repository's heads' checks are
    their Actions workflow runs (a completed run's conclusion, none while it runs); a token that
    cannot read those either fails the sync.
  - The `branch` course, which reads the home repository's git alone, is not built:
    [the proposal](../proposals/branch-course.md).

- **R-BTN-139 (on a forge, only pushers' writes count).** The fact adapter marks every PR,
  comment, review and approval `pusher` or not, once per sync run. Standard station functions
  read only pushers' facts; the adapter exports `pusher` to a course's own `sync.mjs`; whatever
  station function runs, the CLI drops every posted marker and output whose author is not a
  pusher, and the sync log counts them per PR. `pusher` is the word for this trust in a forge
  author; `trusted` is kept for the runner role (R-BTN-182).
  - **PRs that count.** A PR found by `branch_pattern` counts only when its head repository is
    its base repository by id (the adapter table) and its base is the home or a `repos:` entry
    with reach (R-BTN-140). A fork's PR counts only when a pusher names it in `prs:`; its
    outsiders' words still do not count.
  - **Words that count only from pushers:** verdict lines, adjudication and conclusion
    lines, forge review states and approvals, and every `baton:` marker (comment, review or PR
    body). A text counts only when its author **and every editor** are pushers.
  - **A pusher**: an immutable forge user id in the owners' `pushers`, or someone the forge
    reports can push to the PR's base, read on the base repository's own forge with that host's
    token. A `pushers` entry is `{host?, id}`: without a host it is the home's, and on a `git`
    home an entry without a host is refused (`invalid-params`). Every rule here applies per
    host.
  - **Failures.** A permission or editors read that errors aborts the sync run, which posts
    nothing and releases its number (R-BTN-150). Only a token known to lack the scope degrades:
    permissions to `pushers` alone, raising `baton.pushers-degraded`; a text whose editors
    cannot be read does not count. Permissions are cached per author per run and re-read every
    sync, so a verdict whose author lost push stops counting from the next snapshot on.

- **R-BTN-140 (code repositories are the owners' list).** The owner setting `code_repos` lists
  forge repositories, each on the forge and host its entry names: an entry is `{path, forge?,
  host?}`, and omitted `forge` and `host` are the home's — on a `git` home both are required
  (`invalid-params`, naming the entry). Baton stores `{path, forge, host, repo_id, owner_id,
  web_base}`; `forge` is `github`, `gitlab` or `gitea` (a `git` code repository has no PR facts
  and is refused), `host` a lowercased DNS name with optional port, and `web_base` that host and
  path. An entry's path is unique case-insensitively among the home's path and every entry,
  whatever its host, so a name resolves without one; a list with a duplicate is refused
  `invalid-params`. `baton owner settings` reads each entry's ids from its forge or takes
  `--forge-ids`, and posts them; Baton never fetches, and the ids decide at every read
  (R-BTN-138). A re-written list keeps the ids of the paths it keeps.
  - **Reach by name.** A home that lists no `code_repos` at all, under a policy whose
    `repos.unlisted` is `by-name` (R-BTN-188), reaches a `repos:` entry as a listed one when the
    posted forge path is under the home's owner on the home's forge host. Such an entry carries
    no id, so nothing fences a re-created path and no consent is judged for it; a repository
    registered in the tenant is reached this way only while its own policy's `repos.unlisted` is
    `by-name` too. In every other case the list alone gives reach. While a code repository sits
    on a host other than the home's, the policy may name no `human_identity` and no floor may
    stand (R-BTN-188).
  - **Consent.** The consent a registered repository of the tenant gives to being listed is not
    built: [the proposal](../proposals/data-model-and-api.md).
  - **What reach gives.** A `repos:` entry has reach only when it resolves, its path first
    mapped to its current one by id, to an id in `code_repos`, or by name as above. Only such an
    entry may be named by a `git:` or `https://` input URI the runner fetches (§12.3); be
    searched for PRs or named in `prs:` (R-BTN-139); map a branch in the branch-holder query
    (R-BTN-141); carry a person leg's question `url` (R-BTN-116). Any other entry is shown and
    filtered on only, and the ticket raises `baton.repo-not-listed`.
  - `POST /v1/sync/observation` hands the sync the effective `code_repos` (entries with their
    ids), the policy's `repos.unlisted` (`repos_unlisted`) and `pushers`.

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
    home is G or whose `repos:` entry for G has reach (R-BTN-140), and names only
    tickets of repositories the asking key is granted on; any other match answers
    `held_by_other: true`, with no ids.

