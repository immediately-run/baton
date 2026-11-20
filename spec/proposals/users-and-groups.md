---
title: "Proposal: users, groups, answerers and the notifier"
description: "A tenant's directory of users and groups, each repository's acceptance of the keys and members that count for it, a policy knob naming who may answer a person leg, what Baton hands a notifier, and a directory attestation from the forge."
---
**Status:** proposal — not built; moves into BATON_SPEC §3, §7, §11, §12 and §13 when built (tickets B-303, B-304, B-305, B-306, B-307, B-308; the secret strategy it waits on is B-309). Reviewed adversarially twice on 2026-11-20 ([the review](../../docs/review/users-and-groups-2026-11-20.mdx)); this text is the second revision, with the owner's rulings of the same day.

BATON_SPEC knows credentials, not people: an owner is a key ([R-BTN-58](../BATON_SPEC/11-people.md#sec-11-2)),
a human is a `human_only` key ([R-BTN-185](../BATON_SPEC/12-security.md#sec-12-8)), and a person
leg's `asks` label ([R-BTN-116](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-4)) binds
to nobody. This page adds the record that ties a person's keys, forge identity, groups and
notification channels together, and says where each piece is held.

It rests on one principle. **The tenant's directory says who a person is; each repository says
which of that person's keys count for it.** A user or group entry in a repository's lists admits
a key only once that repository's own `approvers.members` approver has accepted the key for the
person, so [R-BTN-188](../BATON_SPEC/12-security.md#sec-12-8)'s rule stands: a key becomes an
owner of a repository only by that repository's `approvers.members` action. A repository may
instead choose, in its policy, to take the administrator's acceptance for its own (§2).

A rule this page changes is written `R-BTN-n (proposed)` and stays defined, as built, in its
section; §8 lists every such rule. A rule this page adds is labelled `U-n` until Baton's
sequence hands out its id ([R-BTN-199](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-3)). `§n`
alone is this page's section.

## 1. The directory: users and groups

- U-1 (proposed) — a user is the tenant's record of one person; a key stays the credential.
  - **The record.** A user has an `id` and a `display_name` (free text, §12.3). User and group
    ids match `^[a-z][a-z0-9-]{0,31}$`, share one namespace in the tenant and are never reused.
    A tenant holds at most 1,000 users and 200 groups. Baton holds no email address, telephone
    number or channel address of a user (§5).
  - **Who writes the directory.** Creating and retiring a user or a group, changing a group's
    members and linking a forge identity (§6) are the administrator's (R-BTN-57). A user writes
    only their own keys and channels, as below and in §5. Nothing an owner key or a runner does
    writes the directory, and nothing in it is read from git.
  - **Keys.** A user has at most 16 attached keys. An owner key, or a key that holds no role
    yet, may be attached to at most one user; a key holding any other role is refused `conflict`
    as the one-role rule says (§12.1), where an attached key counts as an owner key whether or
    not any repository admits it yet. A user authenticates nothing: every request is one key's
    (R-BTN-13, R-BTN-159).
  - **Attaching a key takes two requests, and the new key makes the second.** A key already
    attached to the user, or an administrator, mints an attach code for the user (`baton
    user-key invite`): eight Crockford base32 characters, valid 10 minutes, used once, stored
    as a hash. The new key then attaches itself with a request it authenticates carrying the
    code (`baton user-key add <code>`). So a key is attached only by whoever holds it, SSH key
    or API key alike. Attaching confers nothing by itself (§2).
  - **Detaching** is the user's own act or an administrator's, and acts at once on every
    repository. A `human_only` key is detached only by a `human_only` key of the same user, a
    break-glass key (R-BTN-188) or an administrator's revocation of it (R-BTN-57).
  - **`human_only` is the key's, never the user's.** The mark is set only by R-BTN-185's
    registration, before the key is attached: `POST /v1/human-keys` refuses a key attached to a
    user (`conflict`), and attaching never sets the mark.
  - **Retiring a user** detaches its keys and deletes its channels, memberships, links and
    acceptances. It does not touch a key row a repository's owner set holds directly: that row
    is the repository's, and `baton admin key revoke` (R-BTN-57) is what ends a key everywhere.
- U-2 (proposed) — a group is a named set of users.
  - **The record.** A group has an `id`, a `source` (`baton` or `forge`) and, for `forge`, the
    forge team it names by its immutable ids (§6). A `baton` group has at most 256 members, all
    users; a group holds no group.
  - **Retiring a group** is refused `conflict` while any repository's owner set, approver list,
    `answerers` entry or `escalations` setting names it.
- **A removal never leaves a gate without a key.** A detach, a member's removal, a retirement
  or a revocation that would leave any repository's list unsatisfiable (§3) is refused
  `unsatisfiable-approvers`, as R-BTN-188 refuses a revocation today. Baton raises
  `baton.removal-blocked` on that repository, whose approver ends it by adding another entry.
  The refusal names the repository to an administrator, and to no one else.
- **A principal, `user`, joins R-BTN-129's list:** a key attached to a user, acting on that
  user's own record with scope `own`. It is how a key that owns no repository calls
  `/v1/users/{user}/…`; on a repository it acts as `owner`, or not at all.
- **Reading the directory.**
  - An administrator reads all of it.
  - A `user` reads its own record.
  - An owner key reads, by id, any one user or group: its display name, each key's fingerprint
    with who attached it and whether it is `human_only`, its forge identities and channel
    names, a group's members. That is what an approver must see to accept. It lists only the
    users and groups its own repositories' entries and acceptances name.
  - A key granted on a repository reads only the user ids and channel names that repository's
    Needs-you entries carry (§5).
  - Nobody but an administrator reads which repositories name a user or group.

## 2. Acceptance: what counts on a repository

- U-3 (proposed) — a repository admits only the keys, members and links accepted for it.
  - **An acceptance** says that, on repository R, key K counts for user U, user U counts as a
    member of `baton` group G, or forge account F counts as U's (§6). Writing and dropping one
    are `approvers.members` actions on R (`POST /v1/owner/{repository}/acceptances`), and each
    names exactly what it accepts: the user with the key fingerprints, the group with its
    member ids, the user with the account. Baton refuses one naming a key not attached to that
    user, a user not in that group or an account not linked to that user (`conflict`), so an
    approver accepts the directory as it stands when it asks.
  - **A key matches `user:<id>` on R** when it is attached to that user and accepted for them
    on R. **It matches `group:<id>`** when it matches `user:<u>` on R for a user `u` who is a
    member of the `baton` group and accepted as one on R. A `forge` group matches as §6 says.
  - **Additions wait.** A key attached, a member added or an account linked after an acceptance
    counts on R only when R's approver accepts it. Until then it is `pending` on each repository
    whose entries reach the user or group, and Baton raises `baton.unaccepted` there — one
    condition per repository and user or group, closed when nothing of theirs is pending.
    `baton owner acceptance decline` marks a pending row `declined`, which raises nothing again.
  - **Removals act at once.** A detach, a member's removal, an unlink, a retirement or a
    revocation drops the acceptances it touches in its own transaction, on every repository.
    A key detached and attached again, or a member removed and added again, is pending again.
    Removing an owner this way is no `approvers.members` action: tightening is open (R-BTN-186).
  - **A request that carries its own approval.** An attach code, and an administrator's
    membership change, may carry `accept: [<repository>, …]`. Each is applied only where the
    credential that sent it matches that repository's `approvers.members`, and is reported per
    repository. Under `cooperative` a person so adds a second key in two commands; under a
    human-only list only a human does.
  - **Every repository decides alone.** No act needs two repositories' approvers, and no
    repository's approver changes what counts on another (R-BTN-58).
  - **Or the repository takes the administrator's acceptance for its own.** Under
    `members.source: tenant` (§3) R asks for no acceptance of its own. A member the directory
    lists counts; a forge account the directory links counts; and a key counts once an
    administrator attached it or accepted it for the tenant (`baton admin acceptance add`). A
    key a user attached themselves counts nowhere under `tenant` until then. Each such change
    that reaches R is an `admin` event in R's log. It suits a tenant whose administrator and
    owners are the same people: the administrator, who is the deployment and no human for a
    human gate (R-BTN-57), then decides who R's entries admit.

## 3. People in owner sets and approver lists

- R-BTN-58 (proposed) — an owner set names keys, users and groups.
  - Beside its key rows the set may hold `user:<id>` and `group:<id>` entries
    (`repository_owner_entries`; `baton owner owner add <repository> --user <id> | --group
    <id>`), each added or removed by an `approvers.members` action. An entry naming an unknown
    or retired id is `invalid-params`.
  - A key is an owner of R when the set holds its row, or holds an entry the key matches on R
    (§2). A key that holds a role other than owner never matches an entry (§12.1, R-BTN-102).
  - **A key stops being an owner of R** when no row or entry admits it any longer: its row or
    entry is removed, its acceptance dropped, its membership ended, the key detached or revoked,
    `members.source` changed, or, for a `forge` group, the attestation no longer lists the
    account or has lapsed (§6). A dashboard session ends for R (R-BTN-155) and a delegated key
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
  it on R, and refuses a dropped acceptance and a policy change that would leave a list with
  none (`unsatisfiable-approvers`); the directory's removals are §1's. A `forge` group entry
  never counts toward it: a list must be satisfiable without one.
- **`members.source`** is a new policy knob, enforced by Baton, saying whose acceptance the
  repository takes: `repository` (its own, §2), `tenant` (the administrator's, §2) or `forge`
  (its own, and the forge's word on who is in a `forge` group, §6). It is `repository` in every
  preset, and a stored version naming none reads `repository`. Applying a preset keeps
  `members.source` and `answerers` as it keeps `floors`. A change of it is a policy change like
  any other, held to *No gate without a key to open it* as the lists would stand after it.
  `human-gates` (R-BTN-189), and every guarantee that includes it, holds only under
  `repository`, and promises that no owner's agent session **adds** a member: a removal is
  open to the directory's writers.

## 4. Who may answer a person leg

- R-BTN-116 (proposed) — the policy names who may answer each label. The course names a label
  (`asks`); who holds it is the repository policy's.
  - **The knob.** `answerers` is a policy knob, enforced by Baton: `{<label>: [<entry>, …]}`,
    each list non-empty and built of `owner`, `human` and §3's user and group forms. No preset
    writes it.
  - **The answer.** A `std:decision@1` for a person leg is accepted when R-BTN-181 admits its
    credential and writer as built, and, where the leg's label has an entry, the credential also
    matches it on R (§2) — whether or not the key is an owner. Any other is refused `forbidden`.
    Its `answered_by` carries the key and, when the key is attached, the user. An answer kept
    for a deferred arrival (R-BTN-39) is judged again when it applies, and one whose credential
    no longer matches is `arrival-unapplied`.
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

## 5. Reaching people: channels, Needs you and the notifier

How a person learns of an entry stays a delivery runner's, outside core (R-BTN-163): Baton
sends nothing, names no channel's protocol and holds no address. A **notifier** is such a
delivery runner. Reaching a person is a capability of its host, not a key role (R-BTN-161).
This section adds what Baton tells a notifier about people, and what the notifier tells Baton.

- U-4 (proposed) — Baton says who to tell and when; the notifier knows how, and says when it
  has.
  - **Channels.** A user keeps an ordered list of at most 8 channel names (`baton user-channel
    set`), each matching `^[a-z][a-z0-9-]{0,31}$` and opaque to core (`ntfy`, `email`,
    `whatsapp`): the order in which that person wants to be reached. The user writes it, with a
    `human_only` key when one is attached to them, else with any attached key.
  - **Addresses are the notifier's.** Baton stores no address, sealed or not. A notifier finds
    a user's address for a channel by the user's id, in whatever store its host uses, until
    Baton and Fieldhouse have one way to hold secrets (§9).
  - **Who an entry is for.** A Needs-you entry (R-BTN-163) is for its **recipients**: for a
    person leg whose label has an `answerers` entry, the users with a key that matches it on R;
    for every other entry, the users with a key that is an owner of R. An owner key attached to
    no user reaches nobody, and the entry counts such keys as `unreached`.
  - **Steps.** Step 0 of every entry is its recipients, due when the entry opens: the instant a
    person leg's `expires` counts from (R-BTN-116), or a condition's raise. The owner setting
    `escalations` (R-BTN-66) adds later steps: `{<label> | "*": [{after_s, notify: [<entry>,
    …]}]}`, at most 8 steps, `after_s` from 60 seconds to 30 days, `notify` built of §3's user
    and group forms. A label's own list is used where it has one, else `"*"`'s; a condition
    with no person leg uses `"*"`'s. A step is due `after_s` after the entry opened, while the
    entry is open. Baton drops from a step everyone who could neither answer the entry nor read
    the repository as an owner, so no step tells a stranger. Removing a step, or lengthening
    its `after_s`, is a loosening (R-BTN-186). Core sends nothing and times nothing: a step is
    a fact a notifier reads.
  - **The notifier's word.** A notifier attests each step it has worked: `std:notified@1`,
    about the entry, with `{step, told: [<user id>], unreachable: [<user id>]}`. It counts from
    a writer the repository policy's `attestations` entry admits for the type (R-BTN-188): the
    `service:` keys the owner names, and no other. Naming the notifier is therefore an
    `approvers.policy` change. Baton stores the attestation as it stores any, and names no
    channel in it.
  - **One read, no cursor.** `GET /v1/needs-you?due=1` answers, across the repositories the
    caller may read, every open entry with a step that is due and that no admitted writer has
    attested, each with its recipients for that step and their channel names, resolved as the
    read is made. A notifier keeps no place of its own: it asks, sends, attests, and asks again
    a minute later. A restart, a move to another host and a second notifier therefore need
    nothing carried over; two that race may both send one step. A person retired or removed
    before a step is due is not in it.
  - **Who may read.** `GET /v1/needs-you` and the conditions list (R-BTN-163) answer the same
    callers: a key granted on the repository, an owner of it and an administrator. A key that
    matches a label's `answerers` entry also reads that label's entries, so an answerer who is
    no owner sees what waits on them.
  - **A silent notifier is a condition.** Where the policy admits a writer for
    `std:notified@1`, an entry with a step due for 15 minutes and unattested raises
    `baton.notifier-silent` on the repository, closed when no such step remains. That condition
    never counts as an entry itself. A step whose attestation lists a user as `unreachable`
    shows that on its Needs-you entry.
  - **`baton notifier start`** is the CLI's own loop, with the channel senders and the address
    store its host configures. It runs no repository code, and sends the ticket, the leg and the
    `url`, and nothing a leg wrote. It tries a recipient's channels in their order, lists as
    `unreachable` anyone it has no address for, and attests only what it did.

A repository that binds `ask` (R-BTN-169) may have its `deliver` runner's key admitted for
`std:notified@1` too: a `deliver` leg that attests step 0 of its question is then the one that
told its recipients, and the notifier, seeing the step attested, does not. Core knows neither
course.

## 6. The directory attestation

- U-5 (proposed) — who is in a forge team reaches Baton as an attestation, per repository.
  - **The attestation.** `std:directory@1` is a statement about the forge organisation that
    holds repository R: `{host, org_id, teams: [{team_id, members: [<forge user id>]}]}`, ids
    of R-BTN-138's kind, at most 64 KB. It covers only the teams R's entries' `forge` groups
    name, which Baton lists for the reader (`GET /v1/repositories/{repository}/directory/wanted`).
    The reader uses a forge credential its own host holds; Baton's App key reads nothing
    (§12.7), and a webhook only triggers (R-BTN-73).
  - **Its writer.** Whoever R's policy admits for the type (R-BTN-181): `sync` in
    `cooperative`, nobody in `protected` until the owner names a `service:` key.
  - **One repository, its own attestation.** R keeps the latest `std:directory@1` from each
    admitted writer and reads the newest, only while it is under 24 hours old. An older one
    counts for nothing and raises `baton.directory-stale`. No repository reads another's.
  - **Linking a forge identity** is the administrator's (`baton admin user-identity link`): an
    account, by its immutable id, is linked to at most one user. A link is part of the
    directory, and counts on R as §2 says.
  - **A `forge` group, for notification.** On R its members are the users whose linked account
    R's attestation lists in the group's team.
  - **A `forge` group, for authority.** Under `members.source: repository` or `tenant` a
    `forge` group matches no owner entry, approver entry or `answerers` entry. Under `forge`, a
    key matches `group:<id>` on R when it matches `user:<u>` on R (§2), `u`'s linked account is
    accepted on R, and R's attestation lists that account in the group's team. The forge says
    who is in the team and nothing else: which keys are a person's, and which account is
    theirs, stay Baton's. A person removed from the team stops matching at the next
    attestation, or when it lapses.
  - **`members.source: forge` needs a writer no push controls.** It is refused `invalid-params`
    unless the policy admits only `service:` keys for `std:directory@1`, none of them a key the
    repository's `inputs.board` admits or a machine key granted on it.
  - **Plain git.** A `git` repository has no forge to attest and uses `baton` groups alone.
    Nothing about a user is read from a file in the repository. A deployment whose git server
    maps keys to users may post `std:directory@1` from that map with a `service:` key.

## 7. Tables, routes, commands and scenarios

The conventions of BATON_SPEC [§13](../BATON_SPEC/13-data-model.md) and
[§14](../BATON_SPEC/14-api.md) apply; the rows move there when built. Every table below is owner
state, exported and imported with it (R-BTN-88): an import refuses an entry or acceptance
naming a user, group or key the export does not hold. Attestations follow R-BTN-181: an import
drops them, so every open entry is due again and a `forge` group matches nothing until its
next attestation.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `users` | `id` | `display_name`, `created_by`, `created_at`, `retired_at` | The users (U-1) |
| `groups` | `id` | `source`, `forge_host`, `forge_org_id`, `forge_team_id` (NULL for `baton`), `created_by`, `created_at`, `retired_at` | The groups (U-2) |
| `directory_ids` | `id` | `kind` (`user`\|`group`) | The one namespace, retired ids included (U-1) |
| `user_keys` | `(fingerprint, attached_at)`; one live row per fingerprint | `user_id`, `public_key`, `attached_by`, `tenant_accepted_by` (NULL unless an administrator attached or accepted it), `detached_at` | Keys attached to a user (U-1, U-3) |
| `attach_codes` | `code_hash` | `user_id`, `minted_by`, `accept` JSON, `expires_at`, `used_at` | One-time attach codes (U-1) |
| `user_identities` | `(host, forge_user_id)` | `user_id`, `linked_by`, `linked_at` | Linked forge accounts, one user each (U-5) |
| `group_members` | `(group_id, user_id)` | `added_by`, `added_at` | A `baton` group's members (U-2) |
| `user_channels` | `(user_id, position)` | `channel`, `set_by`, `set_at` | The order in which a user wants to be reached (U-4) |
| `repository_owner_entries` | `(repository_id, entry)` | `added_by`, `added_at`, `removed_at` | `user:` and `group:` owner entries (R-BTN-58) |
| `acceptances` | `(repository_id, kind, user_id, ref)`; `kind` `key` with `ref` a fingerprint, `member` with `ref` a group id, or `identity` with `ref` `<host>/<forge user id>` | `status` (`pending`\|`accepted`\|`declined`), `set_by`, `set_at` | What counts on a repository, and what waits (U-3) |
| `human_keys` | as built | also `fido_attestation`, read wherever `human_key` is checked for a key no owner row holds | R-BTN-185 |
| `attestations` (R-BTN-181) | as proposed | `std:directory@1`: the latest per repository and writer, up to 64 KB, its subject the organisation; `std:notified@1`: one per entry, step and writer, its subject the entry | U-4, U-5 |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/admin/users`, `POST /v1/admin/groups` | administrator | `{id, display_name}` or `{id, source, forge_team?: {host, org_id, team_id}}`; `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict`; `unsatisfiable-approvers` | U-1, U-2 |
| `PUT /v1/admin/groups/{group}/members` | administrator | `{add?: [], remove?: [], accept?: [<repository>]}` | `{ok: true, accepted: [], refused: []}`; `unsatisfiable-approvers` | U-2, U-3 |
| `POST /v1/admin/users/{user}/identities` | administrator | `{host, forge_user_id}`; `{…, unlink: true, confirm: true}` | `{ok: true}`; `conflict` | U-5 |
| `POST /v1/admin/acceptances` | administrator | `{user, keys: []}`; `{…, drop: true, confirm: true}` | `{ok: true}`; `conflict`; `unsatisfiable-approvers` | U-3 |
| `GET /v1/users`, `GET /v1/users/{id}`, `GET /v1/groups/{id}` | administrator, owner, user | `?cursor=`, 100 per page | what §1's read allows the caller; an id outside it is `not-found` | U-1, U-2 |
| `POST /v1/users/{user}/attach-codes` | user; administrator | `{accept?: [<repository>]}` | `{code, expires_at}` | U-1, U-3 |
| `POST /v1/users/{user}/keys` | the key being attached; to detach, user or administrator | `{code}`; `{fingerprint, detach: true, confirm: true}` | `{ok: true, accepted: [], refused: []}`; `conflict`; `not-found` for a bad code; `unsatisfiable-approvers` | U-1, U-3 |
| `PUT /v1/users/{user}/channels` | user | `{channels: [<name>, …]}` | `{ok: true}`; `forbidden` | U-4 |
| `GET`, `POST /v1/owner/{repository}/acceptances` | owner | `{user, keys: []}`, `{group, members: []}` or `{user, identity: {host, forge_user_id}}`; `{…, drop: true, confirm: true}`; `{…, decline: true}` | pending, accepted and declined rows; `{ok: true}`; `conflict`; `unsatisfiable-approvers` | U-3 |
| `POST /v1/owner/{repository}/owners` | owner | as built, and `{entry}` to add; `{entry, remove: true, confirm: true}` | as built; `invalid-params` | R-BTN-58 |
| `GET /v1/needs-you`, `GET /v1/repositories/{repository}/conditions` | a key granted on the repository, an owner, an administrator; a key matching an `answerers` entry, for that label | `?due=1`, `?repository=`, the list's built filters, 100 per page | each entry as built, and `label?`, `unreached`, `steps: [{step, due_at, recipients: [{user, channels: []}], attested_by?, unreachable?: []}]`; with `due=1`, only entries with a step due and unattested | U-4, R-BTN-163 |
| `GET /v1/repositories/{repository}/directory/wanted` | whoever may write `std:directory@1` there | — | `{host, org_id, teams: [<team_id>]}` | U-5 |

`std:notified@1` and a `service:` key's `std:directory@1` are posted on the attestations route
(R-BTN-181); the sync's `std:directory@1` rides in its board post (R-BTN-191). The new
`confirm: true` actions join §12.2's list.

| Command | What it does | Rule |
|---|---|---|
| `admin user add <id> --name <display name>`, `admin user retire <id>` | creates or retires a user | U-1 |
| `admin group add <id> [--forge-team <host>:<org id>:<team id>]`, `admin group retire <id>`, `admin group-member add <group> <user> [--accept <repository>,…]`, `admin group-member remove <group> <user>` | creates or retires a group; changes its members | U-2, U-3 |
| `admin user-identity link <user> <host> <forge user id>`, `admin user-identity unlink …` | links or unlinks a forge account | U-5 |
| `admin acceptance add <user> [--key <fingerprint>…]`, `admin acceptance drop …` | accepts a user's keys for the tenant | U-3 |
| `user list`, `user show [<id>]`, `group show <id>` | reads the directory | U-1, U-2 |
| `user-key invite [<user>] [--accept <repository>,…]`, `user-key add <code>`, `user-key remove <fingerprint>` | mints an attach code; attaches the caller's own key with one; detaches a key | U-1, U-3 |
| `user-channel set <channel> [--position <n>]`, `user-channel remove <channel>` | sets the order in which the caller wants to be reached | U-4 |
| `owner owner add <repository> --user <id> \| --group <id>` | adds a user or group to the owner set | R-BTN-58 |
| `owner acceptance list <repository>`, `owner acceptance add <repository> --user <id> [--key <fingerprint>…] [--identity <host>:<forge user id>] \| --group <id> [--member <id>…]`, `owner acceptance drop …`, `owner acceptance decline …` | reads, writes or declines acceptances; `add` prints each key with who attached it and asks | U-3 |
| `owner settings set <repository>` | as built, and `escalations` | U-4 |
| `decision list` | as built, reading `needs-you` across the caller's repositories | R-BTN-163 |
| `notifier start --config <file>` | runs a notifier | U-4 |

Each scenario takes its `S-BTN-n` from Baton's sequence (R-BTN-199) with the ticket that builds
it.

| Scenario | Sets up | Expects |
|---|---|---|
| a key is attached only by its holder | alice's key mints a code; a stranger's key uses it after 11 minutes, then a fresh one within; a second use; a pending runner's machine key uses one; an API key uses one | `not-found`; attached; `not-found`; `conflict`; attached |
| an attached key counts only where it is accepted | `approvers.members: [human]` on B, owner set `[user:alice]`; alice's agent key mints a code with `accept: [B]` and K2 attaches; her `human_only` key accepts K2; she declines K3 | attached, B `refused`, K2 `forbidden` on B, one `baton.unaccepted`; K2 an owner of B; the condition closed and not raised again for K3 |
| an administrator's attach confers nothing under `repository` | an administrator attaches its own Ka and bob's Kb to `bob`; B's approver adds `user:bob` and accepts Kb alone | Ka matches nothing on B; Kb is an owner |
| one repository's acceptance is not another's | group `g` in A's and B's lists; the administrator adds carol, whose key both have yet to accept; A's approver accepts her and her key | carol's key matches on A, not on B, where `baton.unaccepted` stays |
| removals act at once, and never strand a gate | an accepted member is removed from `g`; an accepted key is detached and attached again; the last key matching X's `approvers.policy: [user:bob]` is detached; bob is retired | no match on any repository, the session and delegated key ended; pending again; `unsatisfiable-approvers` and `baton.removal-blocked` on X, in both cases |
| a repository may take the administrator's acceptance | B under `members.source: tenant`, owner set `[group:g]`; the administrator adds dave and attaches his key; dave attaches a second key himself; the administrator accepts it; B back to `repository` | the first key an owner of B, an `admin` event on B, `human-gates` broken; the second matches nothing; it matches; only B's own acceptances count, the change refused `unsatisfiable-approvers` if none satisfies a list |
| a `human:` entry needs a human-only key | `approvers.members: [human:group:g]`; a member's owner key, then its `human_only` key; a break-glass key; `POST /v1/human-keys` naming an attached key | `forbidden`; accepted, the list human-only; accepted; `conflict` |
| unknown, retired and reused ids | an entry naming an unknown id; retiring a group a list names; creating a user under a retired group's id; an owner reads a user no repository of its names, by id and by list | `invalid-params`; `conflict`; `conflict`; the record, and absent from the list |
| applying a preset keeps who was named | `answerers` and `members.source: tenant` set; `owner policy apply protected` | both unchanged in the new version |
| a person leg is answered by its label's holders | `answerers: {release: [group:g]}`; an owner outside `g`; an accepted non-owner member's `human_only` key; a member answers while a claim is active and is then removed from `g`; an answer in git; a course asking an unnamed label; a version with no `answerers` | `forbidden`; applied, `answered_by` naming key and user; `arrival-unapplied` when the claim ends; `arrival-unapplied` and `baton.answer-unadmitted`; snapshot refused; R-BTN-181 alone decides |
| Baton holds no address | a user with a `human_only` key sets channels with it, then with an agent key; every caller reads the directory and an entry | set; `forbidden`; channel names alone, on every route |
| who an entry is for, and when | a person leg queued for `release`; `escalations` with a step at 3,600 seconds naming a holder, an owner and a stranger; a holder is removed from `g` at 1,800 seconds; a non-owner answerer and a runner granted on A alone read `needs-you` | step 0 the holders, each with their channels; step 1 due an hour after the leg queued, listing the remaining holder and the owner; the answerer sees its label's entry, the runner A's alone |
| a notifier keeps no place | a notifier reads `due=1`, sends and attests step 0 with one user `unreachable`; it reads again; a second notifier starts on another host; a key the policy does not admit attests step 1 | the step and its recipients; nothing due, the entry showing the unreachable user; nothing due for it either; `forbidden`, the step still due |
| a silent notifier is seen | `std:notified@1` admits a key; a step due and unattested for 15 minutes; it is attested | `baton.notifier-silent`, itself in no `due=1` answer; closed |
| a forge group counts only where the policy says | a `forge` group in `approvers.policy` as its only entry; beside `key:K0` under `members.source: repository`; `forge` with `sync` admitted for `std:directory@1`; `forge` with a `service:` key that is a granted machine key; `forge` with an instrument key attesting erin's account in the team, her key accepted, then her link accepted | `unsatisfiable-approvers`; no key matches through the group; `invalid-params`; `invalid-params`; no match, then erin's key matches |
| the forge's word lapses and is each repository's own | the attestation drops erin; it is 25 hours old; A's attestation names B's team; an import | no match at once, her session ended; no match and `baton.directory-stale`; B unchanged; no `forge` group matches until the next attestation |

## 8. Rules this changes

Each is amended in place, in its own section, by the change that builds the part it touches.

| Rule | What changes |
|---|---|
| R-BTN-58 | the owner set's entries, and when a key stops being an owner (§3) |
| R-BTN-188 | the entry forms; break-glass and the `human:` forms; *No gate without a key* over entries, acceptances and the directory's removals; the knobs `members.source` and `answerers`, kept by a preset's apply; that removing an owner through the directory is no `approvers.members` action (§1 to §4) |
| R-BTN-189 | `human-gates` requires `members.source: repository` and speaks of adding members (§3) |
| R-BTN-116, R-BTN-181, R-BTN-191 | who may answer a person leg, the answer judged again when it applies, when the sync's answer counts, `answered_by`; `std:directory@1` and `std:notified@1`, their subjects, sizes and how a newer one replaces an older (§4 to §6) |
| R-BTN-185 | registration refuses an attached key; `fido_attestation` is the key's (§1, §7) |
| R-BTN-163 | "records no delivery" becomes "stores the notifier's word of it"; what an entry lists; `needs-you` and its callers; the new `baton.*` conditions (§1, §2, §4 to §6) |
| R-BTN-66, R-BTN-186 | the owner setting `escalations`, and which change of it loosens (§5) |
| R-BTN-129, §12.1, R-BTN-102 | the principal `user`; an attached key under the one-role rule; no key of another role matches an entry (§1, §3) |
| R-BTN-155, R-BTN-130 | a session and a delegated key end when their key stops being an owner (§3) |
| R-BTN-57 | the administrator's directory actions and tenant acceptance (§1, §2) |
| R-BTN-88, R-BTN-179 | the new owner-state tables and what the state read holds (§7) |
| R-BTN-127, §12.2 | the commands and the destructive actions (§7) |
| R-BTN-110 | `std:directory@1` and `std:notified@1` join the standard library (§5, §6) |
| R-BTN-50, the vocabulary page | user, group, acceptance, answerer, channel, notifier, directory attestation |
| the conditions proposal, R-BTN-163 and R-BTN-169 | a delivery runner reads `needs-you?due=1` and attests, in place of "sends each entry it has not yet sent"; `deliver` may attest step 0 (§5) |

`human_identity`, `pushers` and `runner_pushers` are untouched: a linked forge identity confers
none of them. Readings (R-BTN-76) are untouched: the notifier is no instrument.

## 9. Decided, and still open

Decided by the owner, 2026-11-20:

- Users and groups carry authority beside keys; a key stays the only credential.
- Users and groups are the tenant's; what they may do is bound per repository.
- A repository admits a key or a member by its own acceptance, or takes the tenant's (§2).
- Only the administrator writes the directory (§1).
- Forge membership serves notification by default. It counts for authority only where a
  repository's policy says so, and then only as a named `service:` key attests it, lapsing
  after 24 hours (§6).
- Baton stores no address of anyone, sealed or not: finding one is the notifier's job (§5).
- The notifier runs no repository code, and what it must remember is kept in Baton as typed
  values (§5).

Taken while answering the second review, for the owner to confirm or change:

- **Tenant acceptance is the administrator's** (§2): under `members.source: tenant` a key a
  user attached themselves counts only once an administrator accepts it. The other reading,
  that every attached key counts, lets an injected agent key mint a lasting owner key.
- **A removal that would strand a repository's gate is refused** (§1), as a revocation is
  today, and that repository is told. The other choice is to apply it and leave the repository
  to break-glass.
- **The forge says who is in a team and nothing more** (§6): keys and account links stay
  Baton's, each accepted like any other. Letting the forge's published keys count would make
  a runner's key an owner wherever its machine's key sits on a member's forge account.
- **The notifier keeps no cursor; it attests what it sent** (§5), in place of the reading the
  first revision proposed. A reading lapses in the outage it is for, is not exported, and may
  be written by any runner granted on a listed repository.
- **Only the administrator links a forge account** (§6), in place of a proof by a key the
  attestation lists, which a cooperative repository's board poster could forge for the tenant.

Open:

- **Secrets.** Baton and Fieldhouse have no shared way to hold and hand out a secret. Until
  they do, each notifier's host keeps the addresses and the channel credentials, and a person
  cannot set their own address through Baton.
- **Any human-only key of the tenant answers any repository's person leg** where the label has
  no `answerers` entry: that is R-BTN-181 as built, and this page does not narrow it. Until a
  repository names its answerers, a human who owns only repository A may answer on B.
- **An answerer who is neither an owner nor a human-only key holder** cannot answer: R-BTN-181
  admits no such credential. Admitting one needs a new writer class.
- **Tenant and runner conditions** (`baton.*` on no repository) reach no notifier, since
  administrators' keys attach to no user.
- **A lost last key** behind a `user:` or `group:` entry is recovered as a `key:` entry is
  today: by another entry of the list, or by break-glass for a `human:` form.
