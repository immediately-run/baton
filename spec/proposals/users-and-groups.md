---
title: "Proposal: users, groups, leg roles and notification routes"
description: "A tenant's users and groups, how they join owner sets and approver lists beside keys, how a repository's policy binds a person leg's label to people, sealed notification routes that only a notifier can read, and a directory read from the forge."
---
**Status:** proposal — not built, no ticket filed; moves into BATON_SPEC §3, §7, §11 and §12.8 when built

BATON_SPEC knows credentials, not people: an owner is a key ([R-BTN-58](../BATON_SPEC/11-people.md#sec-11-2)),
a human is a `human_only` key ([R-BTN-185](../BATON_SPEC/12-security.md#sec-12-8)), and a person
leg's `asks` label ([R-BTN-116](../BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-4)) binds
to nobody. This page adds the record that ties a person's keys, forge identity, groups and
notification routes together, and says where each piece is held.

A rule this page changes is written `R-BTN-n (proposed)` and stays defined, as built, in its
section. A rule this page adds is labelled `U-n` until Baton's sequence hands out its id
([R-BTN-199](../BATON_SPEC/04-tickets-syncs-board.md#sec-4-3)). `§n` alone is this page's
section.

## 1. Users

- U-1 (proposed) — a user is a tenant's record of one person; keys stay the credential.
  - **The record.** A `users` row: `id` (`^[a-z][a-z0-9-]{0,31}$`, unique in the tenant, never
    reused), `display_name` (text under §12.3's caps), `forge_identities` (a list of `{host,
    user_id}`, the immutable id of R-BTN-138's kind) and `retired_at`. Baton holds no email
    address, telephone number or channel address of a user in the clear (R-BTN-33, §5).
  - **Keys belong to users.** An owner key, or a key that holds no role yet, may be attached to
    at most one user (`user_keys`); a machine key, a sync or mirror key, an instrument key and
    an administrator's key never are. An attached key holds the owner role under the one-role
    rule (§12.1), and is an owner of a repository only where §3 says. A user authenticates
    nothing: every request is still one key's (R-BTN-13, R-BTN-159), and what the key may do is
    still decided by the lists that admit it. `human_only` stays a mark on the key (R-BTN-185),
    never on the user.
  - **Creating a user** is an administrator's action (`baton admin user add <id>`). A new user
    confers nothing: it is an owner of nothing and a member of nothing.
  - **Attaching a key is a grant of everything the user holds**, so it is one of two acts:
    - by the user: a request signed by a live key already attached to that user (`baton user key
      add <pub>`). A `human_only` key is attached only by a `human_only` key of the same user;
    - by an administrator, only while no repository's owner set, approver list or `roles` entry
      (§3, §4) and no group such a list names (§2) reaches the user.

    No key attaches itself to a user. Detaching is the user's own act, or any administrator's;
    revoking a key (R-BTN-57) detaches it. A detach or revocation that would leave an approver
    list unsatisfiable is refused as R-BTN-188 says.
  - **Records.** An act is recorded under its credential as today (`owner:<fingerprint>`), with
    the user's id beside it when the key is attached; a `std:decision@1` answer's `answered_by`
    carries both.
  - **The read.** `GET /v1/users` answers administrators, owners and keys granted on any
    repository with each user's `id`, `display_name`, groups and the channel names of its routes
    (§5), never a route's address.

## 2. Groups

- U-2 (proposed) — a group is a named set of users in the tenant.
  - **The record.** A `groups` row: `id` (the user id's pattern), `source` (`baton` or `forge`)
    and, for `forge`, the team it mirrors (§6). Its members are users; a group holds no group.
  - **Routing or authority.** A group **carries authority** on a repository while that
    repository's owner set, an `approvers.*` list or a `roles` entry names it (§3, §4). A group
    no repository names is for notification only (§5).
  - **Changing membership** of a `baton` group is an administrator's or any owner's action while
    the group carries authority nowhere. While it does, the change needs an `approvers.members`
    approver of every repository on which it carries authority, and is refused `forbidden`
    naming the first repository the caller does not satisfy. A `forge` group's membership is
    only ever what the directory read says (§6).

## 3. Users and groups in owner sets and approver lists

- R-BTN-58 (proposed) — an owner set names keys, users and groups. `repository_owners` holds
  key fingerprints as built, and may hold `user:<id>` and `group:<id>` entries (`baton owner
  owner add <repository> --user <id> | --group <id>`). A key is an owner of the repository when
  the set names it, names the user it is attached to, or names a group that user is a member of.
  Adding and removing an entry is an `approvers.members` action, as for a key.
- R-BTN-188 (proposed) — approver lists name people as well as keys. Beside `owner`, `human` and
  `key:<fingerprint>`, an `approvers.*` list may hold:
  - `user:<id>`, `group:<id>`: any key attached to that user, or to a member of that group,
    while it is an owner of the repository, and a dashboard session such a key minted when the
    key is not `human_only`;
  - `human:user:<id>`, `human:group:<id>`: the same, narrowed to `human_only` keys meeting
    `human_key`.

  A list is human-only when every entry is `human`, a `human:` form or a `key:` naming a
  `human_only` key. *No gate without a key to open it* reads a user or group entry as satisfied
  only while a live key matches it, and refuses a detach, a membership change and a retirement
  that would leave a list unsatisfiable (`unsatisfiable-approvers`). A delegated key matches no
  entry, as built.
- **`members.source`** is a new policy knob, enforced by Baton: `baton` or `forge`, `baton` in
  every preset. Under `baton`, a `forge` group matches no owner entry, approver entry or `roles`
  entry of the repository: its membership serves notification only. Under `forge` it matches
  like any group. The guarantee `human-gates` (R-BTN-189) holds only under `baton`: under
  `forge`, whoever administers the forge's teams changes who may act.

## 4. Who may answer a person leg

- R-BTN-116 (proposed) — the policy binds a person leg's label to people. The course names a
  label (`asks`); who holds it is the repository policy's, never the course's.
  - **The knob.** `roles` is a policy knob, enforced by Baton: `{<label>: [<entry>, …]}`, each
    list non-empty and built of §3's entries. It changes only under `approvers.policy`, like
    every knob.
  - **The answer.** A `std:decision@1` for a `kind: person` leg is accepted only from a
    credential that matches an entry of the leg's label and whose writer the policy's
    `attestations` entry admits (R-BTN-181); any other is refused `forbidden`. The sync's
    attested answer names no credential, so it counts only for a label bound to `[owner]`.
  - **No label without a holder.** A stored policy version with no `roles` knob reads every
    label as `[owner]`, which is today's behaviour. Once the knob is set, a snapshot posting a
    course whose person leg asks an unbound label is refused, the previous course version
    staying in force, and a policy change that unbinds a label a current course asks is refused
    `invalid-params`; a binding is also held to *No gate without a key to open it* (§3).
  - **Needs you** (R-BTN-163) lists each queued person leg with its label and the ids of the
    users who currently match it.

## 5. Notification routes and the notifier

How a person learns of an entry stays a delivery runner's, outside core (R-BTN-163): Baton sends
nothing, names no channel's protocol and records no delivery. This section adds where each
person's routes are kept so that nobody who can read Baton's API learns them.

- U-3 (proposed) — a user's routes are channel names in the clear and addresses sealed to the
  notifier.
  - **A route** is `{channel, sealed?}`, in the user's order of preference. `channel` matches
    `^[a-z][a-z0-9-]{0,31}$` and is opaque to core (`ntfy`, `email`, `whatsapp`). `sealed` is
    the JSON `{user, channel, address}` encrypted to the notifier's public encryption key (an
    age X25519 recipient), at most 2 KB of base64, which Baton stores and never opens. A route
    with no `sealed` says the notifier's own host holds the address, keyed by the user's id.
    The notifier drops a sealed value whose `user` or `channel` is not its route's, so a copied
    ciphertext reaches nobody else.
  - **Who writes it.** The user, with any key attached to them (`baton user route set`, scope
    `own`). The CLI seals the address locally; the address never reaches Baton in the clear.
  - **The notifier** is a new principal and a role of its own under the one-role rule (§12.1):
    an SSH key an administrator registers for the tenant with its public encryption key (`baton
    admin notifier add`), one live at a time. It reads every repository's conditions list
    (R-BTN-163) and policy (R-BTN-189), the users and groups, and `GET /v1/notifier/routes`,
    the one route that answers sealed addresses; it writes nothing and holds no grant. Every
    other reader, an administrator included, gets a route's `channel` alone.
  - **It runs no repository code.** `baton notifier start` is the CLI's own loop with the
    channel senders its host configures. It resolves an entry to people through the leg's label
    (§4) or, for a condition with no leg, the repository's owners, and sends each person the
    ticket, the leg and the `url`, and nothing a leg wrote. A repository's `deliver` course
    (R-BTN-169) is a separate path: its legs get their channel secrets as `credential:`
    variables on their own runner (R-BTN-144) and never read a sealed route.
  - **Rotation.** Replacing the notifier's encryption key marks every route sealed to the old
    one `stale` in the user's own read, until the user seals it again.
  - **Escalation is routing, not authority.** An `escalations` row per group lists steps
    `[{notify: [<user or group id>, …], after_s}]`, set by an administrator or an owner of any
    repository. The notifier applies the steps to an entry by its age; core times nothing, and
    a person leg's `expires` (R-BTN-116) still bounds the wait. No step changes who may answer.

A channel whose address alone lets a stranger read or post — an ntfy.sh topic is one — is
better used with the channel's own access tokens; sealing keeps the address from Baton's
readers, not from the channel's.

## 6. The directory read

- U-4 (proposed) — a forge's users and teams reach Baton one way, as the sync reads them.
  - **An adapter per forge**, beside the fact adapter (R-BTN-96), reads the organisation's
    users (immutable id, login), its teams with their members, and the SSH keys the forge
    publishes for each user. The sync posts the reading with its board post, as attestations of
    writer `sync` (R-BTN-191); a webhook about membership only triggers a sync (R-BTN-73). Baton
    writes nothing to the forge.
  - **Linking a forge identity** to a user: an administrator sets it, or the user proves it by
    a request signed with a key the latest reading lists for that forge account. A key the forge
    publishes is never attached to a user by the reading, and never becomes `human_only`.
  - **Forge groups.** An administrator creates a `forge` group naming a team; its members are
    the users whose linked forge identity the latest reading lists in that team. Whether it
    carries authority is `members.source` (§3).
  - **GitHub.** The reading needs the App permission `members: read`, an addition to §12.7.
  - **Plain git.** A `git` repository has no adapter: users and groups are Baton's state, set
    through the commands above, as on every forge. Nothing about a user is read from a file in
    the repository, which any pusher can write. A deployment whose git server maps keys to
    users may run its own adapter over that map.

## 7. Tables, routes and commands

The conventions of BATON_SPEC [§13](../BATON_SPEC/13-data-model.md) and
[§14](../BATON_SPEC/14-api.md) apply; the rows move there when built.

| Table | Key | Columns | Purpose |
|---|---|---|---|
| `users` | `id` | `display_name`, `forge_identities` JSON `[{host, user_id, linked_by, linked_at}]`, `created_by`, `created_at`, `retired_at` | A tenant's users (U-1) |
| `user_keys` | `fingerprint` | `user_id`, `public_key` (unique), `human_only`, `attached_by`, `attached_at`, `detached_at` | The keys attached to a user (U-1) |
| `groups` | `id` | `source` (`baton`\|`forge`), `forge_team` JSON `{host, org_id, team_id}` (NULL for `baton`), `version`, `escalation` JSON, `created_by`, `created_at`, `retired_at` | A tenant's groups and each one's escalation steps (U-2, U-3) |
| `group_members` | `(group_id, user_id)` | `added_by`, `added_at` | A `baton` group's members; a `forge` group's are derived from the latest reading (U-2, U-4) |
| `repository_owners` | as built, its key also holding `user:<id>` and `group:<id>` | as built | Owner entries (R-BTN-58, proposed) |
| `user_routes` | `(user_id, position)` | `channel`, `sealed` (NULL when the notifier's host holds the address), `recipient` (the encryption key it was sealed to), `set_at` | A user's routes (U-3) |
| `notifiers` | `fingerprint` | `public_key`, `recipient`, `label`, `added_by`, `added_at`, `revoked_at` | The tenant's notifier (U-3) |
| `directory_readings` | `(repository_id, host)` | `observation`, `reading_json` (users, teams, members and key fingerprints, ids only), `posted_at` | The latest directory reading per forge host (U-4) |

| Route | Caller | Body or query | Response | Rules |
|---|---|---|---|---|
| `POST /v1/admin/users` | administrator | `{id, display_name}`; `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict`; `unsatisfiable-approvers` | U-1 |
| `GET /v1/users` | administrator, owner, a key granted on any repository, the notifier | — | `{users: [{id, display_name, forge_identities, groups[], routes: [{channel, sealed: <bool>, stale?}]}], groups: [{id, source, members[], carries_authority_on[]}]}` | U-1, U-2 |
| `POST /v1/users/{user}/keys` | a key attached to the user; an administrator within U-1 | `{public_key, signature, human_only?}`, `signature` the new key's SSHSIG over its own public line; `{fingerprint, detach: true, confirm: true}` | `{ok: true}`; `conflict`; `forbidden`; `unsatisfiable-approvers` | U-1 |
| `PUT /v1/users/{user}/routes` | a key attached to the user | `{routes: [{channel, sealed?}]}`, at most 8 | `{ok: true}`; `invalid-params` for a `sealed` over its cap | U-3 |
| `POST /v1/users/{user}/forge-identities` | administrator; a key attached to the user that the latest reading lists for the account | `{host, user_id}`; `{host, user_id, unlink: true}` | `{ok: true}`; `forbidden` | U-4 |
| `POST /v1/admin/groups` | administrator | `{id, source, forge_team?}`; `{id, retire: true, confirm: true}` | `{ok: true}`; `conflict`; `unsatisfiable-approvers` | U-2 |
| `PUT /v1/groups/{group}/members` | as U-2 says | `{base_version, members[]}` | `{version}`; `conflict` when stale; `forbidden` naming a repository; `unsatisfiable-approvers` | U-2 |
| `PUT /v1/groups/{group}/escalation` | administrator, owner | `{steps: [{notify[], after_s}]}`, at most 8 steps | `{ok: true}` | U-3 |
| `POST /v1/admin/notifiers` | administrator | `{public_key, recipient, label}`; `{fingerprint, revoke: true, confirm: true}` | `{ok: true}`; `conflict` | U-3 |
| `GET /v1/notifier/routes` | the notifier | — | `{recipient, routes: [{user, channel, sealed}], escalations: {<group>: steps}}` | U-3 |
| `POST /v1/owner/{repository}/owners` | owner | as built, and `{user}` or `{group}` to add; `{entry, remove: true, confirm: true}` | as built | R-BTN-58 |

`GET /v1/repositories/{repository}/conditions` and `…/policy` also answer the notifier. The
board post (§4.4) gains `directory: {host, users[], teams[]}`, accepted or refused with it.

| Command | What it does | Rule |
|---|---|---|
| `admin user add <id> --name <display name>`, `admin user retire <id>` | creates or retires a user | U-1 |
| `user list`, `user show [<id>]` | the users and groups | U-1, U-2 |
| `user key add <pub> [--human-only]`, `user key remove <fingerprint>` | attaches or detaches one of the caller's own keys; `admin user key add <id> <pub>` is the administrator's | U-1 |
| `user route set <channel> [--address <a>] [--position <n>]`, `user route remove <channel>` | seals and sets one of the caller's routes | U-3 |
| `user forge link <host>` | links the caller's forge identity | U-4 |
| `admin group add <id> [--forge-team <host>/<org>/<team>]`, `admin group retire <id>` | creates or retires a group | U-2 |
| `group member add <group> <user>`, `group member remove <group> <user>` | changes a `baton` group's members | U-2 |
| `group escalation set <group> <file>` | sets a group's escalation steps | U-3 |
| `owner owner add <repository> --user <id> \| --group <id>` | adds a user or group to the owner set | R-BTN-58 |
| `admin notifier add <pub> --recipient <age recipient> --label <l>`, `admin notifier revoke <fingerprint>` | registers or revokes the notifier | U-3 |
| `notifier start --config <file>` | runs the notifier | U-3 |

## 8. Scenarios

Each takes its `S-BTN-n` from Baton's sequence (R-BTN-199) with the ticket that builds it.

| Scenario | Sets up | Expects |
|---|---|---|
| a key attaches only by its user | an unattached key asks to attach itself; a user's key attaches a second; an owner's key attaches a `human_only` one; an administrator attaches to a user a repository names | `forbidden`; attached, and an owner wherever the user is; `forbidden`; `forbidden` |
| user and group entries open gates only with a live key | `approvers.policy: [group:g]`; a member's key changes the policy; a non-member owner's does; the last member's key is detached | accepted; `forbidden`; `unsatisfiable-approvers` |
| a `human:` entry needs a human-only key | `approvers.members: [human:group:g]`; a member's owner key, its session, then its `human_only` key | `forbidden`; `forbidden`; accepted, and the list reads human-only |
| forge membership counts only where the policy says | a `forge` group in `approvers.policy` under `members.source: baton`, then `forge`; the reading drops the member | no key matches, the change that names it refused `unsatisfiable-approvers`; the member's key matches; it matches no longer |
| a group's membership is each repository's to approve | a group named by two repositories' lists; an approver of one adds a member; an approver of both does | `forbidden` naming the other; accepted in both |
| a person leg is answered by its label's holders | `roles: {release: [group:g]}`; an owner outside `g` answers; a member answers; the sync attests an answer in git; a course asks an unbound label | `forbidden`; applied, `answered_by` naming the user; `answer-invalid`; snapshot refused, the previous course in force |
| only the notifier reads a sealed route | a user sets a sealed route; an owner, an administrator and a runner read the users; the notifier reads its routes; the notifier key is replaced | `channel` and `sealed: true` alone; the ciphertext; the route reads `stale` to its user |

## 9. Decided, and still open

Decided in the design discussion of 2026-11-20:

- Users and groups carry authority, beside keys; a key stays the only credential (§1, §3).
- The notifier runs no repository code, and addresses are sealed to it or held on its host (§5).
- Forge team membership serves identity and notification by default; it counts for authority
  only where a repository's policy says so (§3, §6).
- Users and groups are the tenant's; what they may do is bound per repository (§2 to §4).

Open:

- **Recovery.** A user who loses every key keeps their memberships but can attach no key (§1).
  Whether an administrator may attach one after an `approvers.members` approver of each
  repository concerned agrees, or the user is retired and made again, is not settled.
- **`human_identity`** (R-BTN-188) is one forge identity per repository. With users it could
  become the linked forge identities of the users a `human:` entry names.
- **Export and import** (R-BTN-88): users, groups and sealed routes are owner state; whether an
  import keeps sealed routes when the notifier key is not imported.
- **The model.** `model/baton.qnt` checks approver lists by key; §3 changes what it checks.
