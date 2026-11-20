---
title: "Proposal: users, groups, answerers and contacts"
description: "A tenant's directory of users and groups, each repository's acceptance of the keys and members that count for it, a policy knob naming who may answer a person leg, sealed contacts that only a repository's notifier can read, and a directory attestation from the forge."
---
**Status:** proposal — not built, no ticket filed; moves into BATON_SPEC §3, §7, §11, §12 and §13 when built. Reviewed adversarially on 2026-11-20 ([the review](../../docs/review/users-and-groups-2026-11-20.mdx)); this text is the revision.

BATON_SPEC knows credentials, not people: an owner is a key ([R-BTN-58](../BATON_SPEC/11-people.md#sec-11-2)),
a human is a `human_only` key ([R-BTN-185](../BATON_SPEC/12-security.md#sec-12-8)), and a person
leg's `asks` label ([R-BTN-116](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-4)) binds
to nobody. This page adds the record that ties a person's keys, forge identity, groups and
contacts together, and says where each piece is held.

It rests on one principle. **The tenant's directory says who a person is; each repository says
which of that person's keys count for it.** A user or group entry in a repository's lists admits
a key only once that repository's own `approvers.members` approver has accepted the key for the
person, so [R-BTN-188](../BATON_SPEC/12-security.md#sec-12-8)'s rule stands unchanged: a key
becomes an owner of a repository only by that repository's `approvers.members` action.

A rule this page changes is written `R-BTN-n (proposed)` and stays defined, as built, in its
section; §8 lists every such rule. A rule this page adds is labelled `U-n` until Baton's
sequence hands out its id ([R-BTN-199](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-3)). `§n`
alone is this page's section.

## 1. The directory: users and groups

- U-1 (proposed) — a user is the tenant's record of one person; a key stays the credential.
  - **The record.** A user has an `id` and a `display_name` (free text, §12.3). User and group
    ids match `^[a-z][a-z0-9-]{0,31}$`, share one namespace in the tenant and are never reused.
    Baton holds no email address, telephone number or channel address of a user that it can
    read (§5).
  - **Who writes the directory.** Creating and retiring a user or a group, and changing a
    group's members, are the administrator's (R-BTN-57). A user's own keys, forge identities and
    contacts are also the user's to write, as the bullets below and §5 and §6 say. Nothing an
    owner key or a runner does writes the directory, and nothing in it is read from git.
  - **Keys.** An owner key, or a key that holds no role yet, may be attached to at most one
    user; a machine key, a sync or mirror key, an instrument key and an administrator's key
    never are. For the one-role rule (§12.1) an attached key is an owner key, whether or not any
    repository admits it yet. A user authenticates nothing: every request is one key's
    (R-BTN-13, R-BTN-159).
  - **Attaching a key** is done by a key already attached to the user (`baton user-key add`),
    or by an administrator. An SSH key being attached signs `{origin, user, fingerprint,
    created}` as an SSHSIG in the namespace `baton-attach`, `created` within R-BTN-13's window;
    an API key (R-BTN-159) carries no signature. Attaching confers nothing by itself (§2).
  - **Detaching** is the user's own act or an administrator's revocation (R-BTN-57), and acts at
    once on every repository. A `human_only` key is detached only by a `human_only` key of the
    same user, a break-glass key (R-BTN-188) or that revocation.
  - **`human_only` is the key's, never the user's.** The mark is set only by R-BTN-185's
    registration, before the key is attached: `POST /v1/human-keys` refuses a key attached to a
    user (`conflict`), and attaching never sets the mark.
  - **Retiring a user** detaches its keys and deletes its contacts, memberships and
    acceptances. It is refused `unsatisfiable-approvers` where R-BTN-188 would refuse the
    detaches.
- U-2 (proposed) — a group is a named set of users.
  - **The record.** A group has an `id`, a `source` (`baton` or `forge`) and, for `forge`, the
    forge team it names (§6). A `baton` group's members are users; a group holds no group.
  - **Retiring a group** is refused `conflict` while any repository's owner set, approver list,
    `answerers` entry or `escalations` setting names it.
- **A principal, `user`, joins R-BTN-129's list:** a key attached to a user, acting on that
  user's record with scope `own`. It is how a key that owns no repository calls
  `/v1/users/{user}/…`; on a repository it acts as `owner`, or not at all.
- **Reading the directory.** An administrator reads all of it. An owner key reads every user
  and group — ids, display names, each user's key fingerprints with `attached_by`, forge
  identities and contact channels — so that an approver sees what it accepts. A key granted on a
  repository reads only the user ids that repository's Needs-you entries name (§4). Nobody reads
  which other repositories name a user or group.

## 2. Acceptance: what counts on a repository

- U-3 (proposed) — a repository admits only the keys and members its own approver accepted.
  - **An acceptance** is a row saying that, on repository R, key K counts for user U, or user U
    counts as a member of `baton` group G. Writing and dropping one are `approvers.members`
    actions on R (`POST /v1/owner/{repository}/acceptances`), and each names exactly what it
    accepts: the user with the key fingerprints, or the group with its member ids. Baton refuses
    an acceptance naming a key not attached to that user or a user not in that group
    (`conflict`), so an approver accepts the directory as it stands when it asks.
  - **A key matches `user:<id>` on R** when it is attached to that user and accepted for them on
    R. **It matches `group:<id>`** when it matches `user:<u>` on R for a user `u` who is a
    member of the group and accepted as one on R; a `forge` group matches as §6 says.
  - **Additions wait; removals act at once.** A key attached or a member added after an
    acceptance counts on R only when R's approver accepts it. Baton raises `baton.unaccepted`
    (a `notify` condition, R-BTN-163) on each repository that names the user or group, closed by
    an acceptance or by `owner acceptance decline`. A detach, a removal, a retirement or a
    revocation drops the acceptances it touches in its own transaction.
  - **A request that carries its own approval.** When the key that attaches a key, or the
    administrator's that adds a member, itself matches R's `approvers.members`, the same request
    may carry `accept: [<repository>, …]`, applied per repository and refused per repository.
    Under `cooperative` a person so adds a second key in one command; under a human-only list
    only a human does.
  - **Every repository decides alone.** No act needs two repositories' approvers, and nothing a
    repository's approver does changes what counts on another (R-BTN-58).

## 3. People in owner sets and approver lists

- R-BTN-58 (proposed) — an owner set names keys, users and groups.
  - Beside its key rows the set may hold `user:<id>` and `group:<id>` entries
    (`repository_owner_entries`; `baton owner owner add <repository> --user <id> | --group
    <id>`), each added or removed by an `approvers.members` action. An entry naming an unknown
    or retired id is `invalid-params`.
  - A key is an owner of R when the set holds its row, or holds an entry the key matches on R
    (§2).
  - **A key stops being an owner of R** when no row or entry admits it any longer — its row or
    entry is removed, its acceptance dropped, its membership ended, the key detached or revoked,
    or `members.source` changed. A dashboard session ends for R (R-BTN-155) and a delegated key
    it minted ends (R-BTN-130) on any of these, as on `owner.owner.remove`.
- R-BTN-188 (proposed) — approver lists name people as well as keys. Beside `owner`, `human` and
  `key:<fingerprint>`, an `approvers.*` list may hold:
  - `user:<id>`, `group:<id>`: a key that matches the entry on R (§2) while it is an owner of
    R, and a dashboard session such a key minted when the key is not `human_only`;
  - `human:user:<id>`, `human:group:<id>`: the same, narrowed to `human_only` keys meeting
    `human_key`.

  A list is human-only when every entry is `human`, a `human:` form or a `key:` naming a
  `human_only` key. A break-glass key satisfies the `human:` forms as it does `human`. An
  administrator matches an `owner` entry and no other, as built; a delegated key matches none.
  *No gate without a key to open it* counts a user or group entry only while a live key matches
  it on R, and refuses a detach, a removal, a retirement, a dropped acceptance and a policy
  change that would leave a list with none (`unsatisfiable-approvers`). A `forge` group entry
  never counts toward it: a list must be satisfiable without one.
- **`members.source`** is a new policy knob, enforced by Baton: `baton` or `forge`, `baton` in
  every preset, and a stored version naming none reads `baton`. It decides how a `forge` group
  matches (§6). The guarantee `human-gates` (R-BTN-189) holds only under `baton`.

## 4. Who may answer a person leg

- R-BTN-116 (proposed) — the policy names who may answer each label. The course names a label
  (`asks`); who holds it is the repository policy's.
  - **The knob.** `answerers` is a policy knob, enforced by Baton: `{<label>: [<entry>, …]}`,
    each list non-empty and built of `owner`, `human` and §3's user and group forms. No preset
    writes it.
  - **The answer.** A `std:decision@1` for a person leg is accepted when R-BTN-181 admits its
    credential and writer as built, and, where the leg's label has an entry, the credential also
    matches it on R (§2) — whether or not the key is an owner. Any other is refused `forbidden`.
    It is judged when Baton accepts the answer, never again when a deferred arrival applies
    (R-BTN-39).
  - **An answer in git** names no credential. The sync's attested answer (R-BTN-191) counts for
    a label with no entry, or one whose entry holds `owner`; for any other it is
    `arrival-unapplied` and raises `baton.answer-unadmitted`. A policy that gives a label an
    entry without `owner` while `std:decision@1` admits only `sync` is refused `invalid-params`.
  - **No label without a holder.** A stored policy version with no `answerers` knob narrows
    nothing: R-BTN-181 alone decides, as built. Once the knob is present, a snapshot posting a
    course whose person leg asks a label it does not name is refused, the previous course
    version staying in force, and a policy change that sets the knob without naming every label
    a current course asks is refused `invalid-params`, naming the label. An entry is held to *No
    gate without a key to open it* (§3).
  - **What the entry promises.** Baton enforces who answers. Who may change `asks`, remove the
    leg or add an `expires` is whoever lands the course file (`paths.control`, R-BTN-184), and
    who may adopt or route a ticket past the leg is `approvers.policy` (R-BTN-39): an entry
    narrower than those two is narrower in name only.
  - **Needs you** (R-BTN-163) lists each queued person leg with its label and the ids of the
    users with a key that could answer it now.

## 5. Contacts and the notifier

How a person learns of an entry stays a delivery runner's, outside core (R-BTN-163): Baton
sends nothing, names no channel and records no delivery. A **notifier** is such a delivery
runner. This section adds where each person's contacts are kept, so that no reader of Baton's
API learns them, and what Baton hands a notifier.

- U-4 (proposed) — a contact is a channel name in the clear and an address only the notifier
  can open.
  - **A contact** is `{channel, sealed?}`, in the user's order of preference, at most 8 per
    user. `channel` matches `^[a-z][a-z0-9-]{0,31}$` and is opaque to core (`ntfy`, `email`,
    `whatsapp`). `sealed` maps a notifier's **recipient** — its age X25519 public key — to the
    JSON `{origin, user, channel, address, created}` encrypted to it, at most 2 KB each. A
    contact with no `sealed` says the notifier's own host holds the address, keyed by the
    user's id. Baton stores a sealed value and cannot open it; it is no secret of Baton's
    (R-BTN-53).
  - **Who writes it.** The user (`baton user-contact set`), with a `human_only` key when one is
    attached to them, else with any attached key. The CLI seals locally, to the recipients
    Baton lists for the user. It keeps the recipients it has sealed to and asks before sealing
    to a new one, naming the repository and the credential that granted it.
  - **A notifier is a granted machine key with the `notify` flag.** The flag is a grant's, set
    and cleared by an `approvers.members` action like the `sync` flag (R-BTN-146), with the
    notifier's recipient; an API-key runner never holds it. No key role exists for it. One
    process may hold the flag on every repository of a tenant.
  - **What a notifier reads.** `GET /v1/runner/notify?after=<cursor>` answers the Needs-you
    entries (R-BTN-163) opened or closed since the cursor on the repositories where the caller
    holds the flag: for each, the repository, ticket, leg, label, `url`, severity, times, and
    `recipients`, the ids of the users §4 or the owner set resolves it to, each with its
    contacts sealed to the caller's recipient. No other route answers a sealed value, to an
    administrator or to anyone. An entry of a repository that binds a `deliver` course for it
    (R-BTN-169) is marked `handled`, and the notifier skips it.
  - **Who is told, and when.** An entry goes to its recipients at once, each by their first
    contact that sends. The owner setting `escalations` (R-BTN-66), `{<label> | "*": [{after_s,
    notify: [<entry>, …]}]}`, at most 8 steps, adds the people a step names once the entry is
    that old and still open. Baton resolves a step and drops everyone who could neither answer
    the entry nor read the repository as an owner, so no step tells a stranger. Core times
    nothing: the notifier applies the steps, and a person leg's `expires` (R-BTN-116) still
    bounds the wait. An owner key attached to no user reaches nobody, and the entry counts such
    keys as `unreached`.
  - **It runs no repository code.** `baton notifier start` is the CLI's own loop with the
    channel senders its host configures. It sends the ticket, the leg and the `url`, and
    nothing a leg wrote; it drops a sealed value whose `origin`, `user` or `channel` is not its
    contact's. It keeps its cursor and what it has sent in a local file; started without one, it
    begins at the present and sends nothing older.
  - **A silent or replaced notifier is a condition.** Baton stamps each `notify` grant's last
    read. A repository with open entries and no read for 15 minutes raises
    `baton.notifier-silent`. Setting or replacing a `notify` flag raises `baton.notifier-changed`
    on the repository until every reached user's contacts are sealed to the new recipient or
    hold no sealed value; the old grant's sealed values are deleted when its flag is cleared.

A channel whose address alone lets a stranger read or post — an ntfy.sh topic is one — is
better used with the channel's own access tokens. Sealing keeps an address from Baton's store
and its readers. It does not keep it from whoever may grant a notifier on a repository that
reaches the user: that approver can ask every such user to seal to a new recipient, and the
CLI's question is the user's one check.

## 6. The directory attestation

- U-5 (proposed) — a forge's teams and accounts reach Baton as an attestation, per repository.
  - **The attestation.** `std:directory@1` is a statement about the forge organisation that
    holds repository R: `{host, org_id, teams: [{team_id, members: [<user_id>]}], accounts:
    [{user_id, key_fingerprints}]}`, ids of R-BTN-138's kind, at most 256 KB. It covers only
    the teams R's `forge` groups name and the accounts linked to users, which Baton lists for
    the reader (`GET /v1/repositories/{repository}/directory/wanted`). Its writer is whoever
    R's policy admits for the type (R-BTN-181): `sync` in `cooperative`, nobody in `protected`
    until the owner names a `service:` key. The reader uses a forge credential its own host
    holds; Baton's App key reads nothing (§12.7), and a webhook only triggers (R-BTN-73).
  - **One repository, its own attestation.** R reads only the latest `std:directory@1` it
    accepted for its own organisation, and only while that is under 24 hours old. An older one
    counts for nothing and raises `baton.directory-stale`. No repository reads another's.
  - **Linking a forge identity.** A user links an account (`baton user-identity link`) with a
    key that the attestation of a repository the key can read lists for that account; an
    administrator may set a link too. An account is linked to at most one user. A link serves
    notification only.
  - **A `forge` group, for notification.** On R its members are the users whose linked account
    R's attestation lists in the group's team.
  - **A `forge` group, for authority.** Under `members.source: baton` a `forge` group matches
    no owner entry, approver entry or `answerers` entry. Under `forge`, a key matches
    `group:<id>` on R when R's attestation lists the key's fingerprint under an account in the
    group's team: the forge says both who is in the team and which keys are theirs, and no
    acceptance is asked. `members.source: forge` is refused `invalid-params` unless the policy
    admits only `service:` keys for `std:directory@1`. A key the forge publishes is never
    `human_only` unless R-BTN-185 registered it.
  - **Plain git.** A `git` repository has no forge to attest and uses `baton` groups alone.
    Nothing about a user is read from a file in the repository. A deployment whose git server
    maps keys to users may post `std:directory@1` from that map with a `service:` key.

## 7. Tables, routes, commands and scenarios

The conventions of BATON_SPEC [§13](../BATON_SPEC/13-data-model.md) and
[§14](../BATON_SPEC/14-api.md) apply; the rows move there when built. Every row below is owner
state, exported and imported with it (R-BTN-88): an import refuses an entry or acceptance
naming a user, group or key the export does not hold.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `users` | `id` | `display_name`, `created_by`, `created_at`, `retired_at` | The users (U-1) |
| `groups` | `id` | `source`, `forge_host`, `forge_org_id`, `forge_team_id` (NULL for `baton`), `created_by`, `created_at`, `retired_at` | The groups (U-2) |
| `directory_ids` | `id` | `kind` (`user`\|`group`) | The one namespace, retired ids included (U-1) |
| `user_keys` | `fingerprint` | `user_id`, `public_key` (unique), `attached_by`, `attached_at`, `detached_at` | Keys attached to a user (U-1) |
| `user_identities` | `(host, forge_user_id)` | `user_id`, `linked_by`, `linked_at` | Linked forge accounts, one user each (U-5) |
| `group_members` | `(group_id, user_id)` | `added_by`, `added_at` | A `baton` group's members (U-2) |
| `repository_owner_entries` | `(repository_id, entry)` | `added_by`, `added_at`, `removed_at` | `user:` and `group:` owner entries (R-BTN-58) |
| `acceptances` | `(repository_id, kind, user_id, ref)`; `kind` `key` with `ref` a fingerprint, or `member` with `ref` a group id | `accepted_by`, `accepted_at` | What counts on a repository (U-3) |
| `user_contacts` | `(user_id, position)` | `channel`, `set_by`, `set_at` | A user's contacts (U-4) |
| `contact_seals` | `(user_id, position, recipient)` | `sealed`, `set_at` | A contact's address, sealed to one notifier (U-4) |
| `runner_grants` | as built | also `notify` (0/1), `notify_recipient`, `notify_read_at` | The notifier's flag (U-4) |
| `human_keys` | as built | also `fido_attestation`, read wherever `human_key` is checked for a key no owner row holds | R-BTN-185 |
| `attestations` (R-BTN-181) | as proposed | a `std:directory@1` is kept as the repository's latest alone | U-5 |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/admin/users`, `POST /v1/admin/groups` | administrator | `{id, display_name}` or `{id, source, forge_team?}`; `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict`; `unsatisfiable-approvers` | U-1, U-2 |
| `PUT /v1/admin/groups/{group}/members` | administrator | `{add?: [], remove?: [], accept?: [<repository>]}` | `{ok: true, accepted: [], refused: []}`; `unsatisfiable-approvers` | U-2, U-3 |
| `GET /v1/users`, `GET /v1/users/{user}` | administrator, owner, user | `?cursor=`, 100 per page | users and groups as §1's read allows the caller | U-1 |
| `POST /v1/users/{user}/keys` | user; administrator | `{public_key, signature?, accept?: [<repository>]}`; `{fingerprint, detach: true, confirm: true}` | `{ok: true, accepted: [], refused: []}`; `conflict`; `forbidden`; `unsatisfiable-approvers` | U-1, U-3 |
| `PUT /v1/users/{user}/contacts` | user | `{contacts: [{channel, sealed?: {<recipient>: <ciphertext>}}]}` | `{ok: true}`; `conflict` for a recipient that serves no repository reaching the user | U-4 |
| `GET /v1/users/{user}/recipients` | user | — | `{recipients: [{recipient, repository, granted_by, granted_at}]}` | U-4 |
| `POST /v1/users/{user}/identities` | user; administrator | `{host, user_id}`; `{host, user_id, unlink: true}` | `{ok: true}`; `conflict`; `forbidden` | U-5 |
| `GET`, `POST /v1/owner/{repository}/acceptances` | owner | `{user, keys: []}` or `{group, members: []}`; `{…, drop: true, confirm: true}`; `{…, decline: true}` | pending and accepted rows; `{ok: true}`; `conflict`; `unsatisfiable-approvers` | U-3 |
| `POST /v1/owner/{repository}/owners` | owner | as built, and `{entry}` to add; `{entry, remove: true, confirm: true}` | as built; `invalid-params` | R-BTN-58 |
| `PUT /v1/owner/{repository}/grants/{fingerprint}/flags` | owner | as built, and `notify`, `notify_recipient` | as built | U-4, R-BTN-146 |
| `GET /v1/runner/notify` | a runner holding a `notify` flag | `?after=<cursor>`, 100 per page | `{entries: [{repository, kind, id, ticket, leg?, label?, url?, severity, opened_at, closed_at?, handled?, unreached, recipients: [{user, contacts: [{channel, sealed?}]}], steps?}], cursor}` | U-4 |
| `GET /v1/repositories/{repository}/directory/wanted` | whoever may write `std:directory@1` there | — | `{host, org_id, teams: [], accounts: []}` | U-5 |

A `std:directory@1` from a `service:` key is posted on the attestations route (R-BTN-181); the
sync's rides in its board post (R-BTN-191). The new `confirm: true` actions join §12.2's list.

| Command | What it does | Rule |
|---|---|---|
| `admin user add <id> --name <display name>`, `admin user retire <id>`, `admin user-key add <id> <pub>` | creates or retires a user; attaches a key | U-1 |
| `admin group add <id> [--forge-team <host>/<org>/<team>]`, `admin group retire <id>`, `admin group-member add <group> <user>`, `admin group-member remove <group> <user>` | creates or retires a group; changes its members | U-2 |
| `user list`, `user show [<id>]` | reads the directory | U-1 |
| `user-key add <pub> [--accept <repository>,…]`, `user-key remove <fingerprint>` | attaches or detaches one of the caller's own keys | U-1, U-3 |
| `user-contact set <channel> [--address <a>] [--position <n>]`, `user-contact remove <channel>`, `user-contact reseal` | seals and sets the caller's contacts | U-4 |
| `user-identity link <host>`, `user-identity unlink <host>` | links the caller's forge account | U-5 |
| `owner owner add <repository> --user <id> \| --group <id>` | adds a user or group to the owner set | R-BTN-58 |
| `owner acceptance list <repository>`, `owner acceptance add <repository> --user <id> [--key <fingerprint>…] \| --group <id> [--member <id>…]`, `owner acceptance drop …`, `owner acceptance decline …` | reads, writes or declines acceptances; `add` prints each key with who attached it and asks | U-3 |
| `owner grant flags <repository> <fingerprint> --notify <age recipient> \| --no-notify` | sets a grant's `notify` flag | U-4 |
| `owner settings set <repository>` | as built, and `escalations` | U-4 |
| `notifier start --config <file>` | runs a notifier | U-4 |

Each scenario takes its `S-BTN-n` from Baton's sequence (R-BTN-199) with the ticket that builds
it.

| Scenario | Sets up | Expects |
|---|---|---|
| an attached key counts only where it is accepted | `approvers.members: [human]` on B, owner set `[user:alice]`; alice's agent key attaches K2 with `accept: [B]`; her `human_only` key accepts K2 | attached, B `refused`, K2 `forbidden` on B and `baton.unaccepted` raised; K2 an owner of B, the condition closed |
| an administrator's attach confers nothing | an administrator creates `bob`, attaches its own key Ka and bob's Kb; B's approver adds `user:bob` and accepts Kb alone | Ka matches nothing on B; Kb is an owner |
| one repository's acceptance is not another's | group `g` in A's and B's lists; A's approver accepts a new member | the member's key matches on A, not on B |
| removals act at once | an accepted member is removed from `g`; an accepted key is detached; the last matching key of `approvers.policy: [group:g]` is detached | no match on any repository, its session and delegated key ended; the same; `unsatisfiable-approvers` |
| a `human:` entry needs a human-only key | `approvers.members: [human:group:g]`; a member's owner key, then its `human_only` key; a break-glass key; `POST /v1/human-keys` naming an attached key | `forbidden`; accepted, the list human-only; accepted; `conflict` |
| unknown, retired and reused ids | an entry naming an unknown id; retiring a group a list names; creating a user under a retired group's id | `invalid-params`; `conflict`; `conflict` |
| a person leg is answered by its label's holders | `answerers: {release: [group:g]}`; an owner outside `g`; an accepted non-owner member's `human_only` key; an answer in git; a course asking an unnamed label; a version with no `answerers` | `forbidden`; applied, `answered_by` naming key and user; `arrival-unapplied` and `baton.answer-unadmitted`; snapshot refused; R-BTN-181 alone decides |
| only a repository's notifier reads a sealed contact | a user seals to A's notifier; an owner, an administrator and a plain runner read the directory; A's notifier and B's read `notify` | `channel` alone; A's gets the ciphertext for entries of A, B's none |
| a notifier's entries and steps | a person leg queued for `release`; an `escalations` step naming a holder, an owner and a stranger; a bound `deliver` | `recipients` the holders; the step lists the first two; `handled` |
| a silent or replaced notifier is seen | no read for 15 minutes with an entry open; the flag moved to another key | `baton.notifier-silent`; `baton.notifier-changed` until contacts are resealed, the old seals deleted |
| a forge group counts only where the policy says | a `forge` group in `approvers.policy`; `members.source: baton`; `forge` with `sync` admitted for `std:directory@1`; `forge` with a `service:` key, its attestation listing a key; the attestation 25 hours old; A's attestation naming B's team | `unsatisfiable-approvers` unless another entry is satisfiable; no key matches; `invalid-params`; the key matches; no match and `baton.directory-stale`; B unchanged |

## 8. Rules of BATON_SPEC this changes

Each is amended in place, in its own section, by the change that builds the part it touches.

| Rule | What changes |
|---|---|
| R-BTN-58 | the owner set's entries, and when a key stops being an owner (§3) |
| R-BTN-188 | the entry forms, break-glass and the `human:` forms, *No gate without a key*, and the knobs `members.source` and `answerers` (§3, §4) |
| R-BTN-189 | `human-gates` requires `members.source: baton` (§3) |
| R-BTN-116, R-BTN-181, R-BTN-191 | who may answer a person leg, when the sync's answer counts, `answered_by`, and `std:directory@1` with an organisation as its subject (§4, §6) |
| R-BTN-185 | registration refuses an attached key; `fido_attestation` is the key's (§1, §7) |
| R-BTN-163 | what a Needs-you entry lists; the notifier's read and its three conditions (§4, §5) |
| R-BTN-146, R-BTN-102 | the `notify` flag (§5) |
| R-BTN-66 | the owner setting `escalations` (§5) |
| R-BTN-129, §12.1 | the principal `user`; an attached key under the one-role rule (§1) |
| R-BTN-155, R-BTN-130 | a session and a delegated key end when their key stops being an owner (§3) |
| R-BTN-57 | the administrator's directory actions, and that it reads no sealed value (§1, §5) |
| R-BTN-88, R-BTN-179 | the new owner-state sections and what the state read holds (§7) |
| R-BTN-127, §12.2 | the commands and the destructive actions (§7) |
| R-BTN-50, the vocabulary page | user, group, acceptance, answerer, contact, notifier, directory attestation |

`human_identity`, `pushers` and `runner_pushers` are untouched: a linked forge identity confers
none of them.

## 9. Decided, and still open

Decided in the design discussion of 2026-11-20:

- Users and groups carry authority beside keys; a key stays the only credential.
- The notifier runs no repository code, and addresses are sealed to it or held on its host.
- Forge membership serves notification by default; it counts for authority only where a
  repository's policy says so.
- Users and groups are the tenant's; what they may do is bound per repository.

Taken while answering the review, for the owner to confirm or change:

- **Acceptance per repository** (§2), over one approval spanning every repository or groups
  that belong to one repository.
- **Under `members.source: forge` a named `service:` key attests the directory** (§6), over
  Baton reading the forge itself or trusting the sync; and it lapses after 24 hours.
- **The notifier is a flagged grant per repository that keeps its own cursor** (§5), over a
  tenant-wide role or a cursor held in Baton.
- **Sealed addresses stay** (§5), over addresses held only on the notifier's host; an approver
  who may grant a notifier can still ask users to seal to it.
- **Only the administrator writes the directory** (§1), over owners editing groups.

Open:

- **An answerer who is neither an owner nor a human-only key holder** cannot answer: R-BTN-181
  admits no such credential. Admitting one needs a new writer class.
- **Tenant and runner conditions** (`baton.*` on no repository) reach no notifier, since
  administrators' keys attach to no user.
- **A lost last key** behind a `user:` or `group:` entry is recovered as a `key:` entry is
  today: by another entry of the list, or by break-glass for a `human:` form.
