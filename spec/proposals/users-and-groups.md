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
  - **Keys belong to users.** A key of any role (R-BTN-13, R-BTN-159) may be attached to at most
    one user (`user_keys`). A user authenticates nothing: every request is still one key's, and
    what the key may do is still decided by its role, its grants and the lists that admit it.
    `human_only` stays a property of the key (R-BTN-185), never of the user.
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
    `^[a-z][a-z0-9-]{0,31}$` and is opaque to core (`ntfy`, `email`, `whatsapp`). `sealed` is the
    address encrypted to a notifier's public encryption key, at most 2 KB, which Baton stores
    and never opens. A route with no `sealed` says the notifier's own host holds the address,
    keyed by the user's id.
  - **Who writes it.** The user, with any key attached to them (`baton user route set`, scope
    `own`). The CLI seals the address locally; the address never reaches Baton in the clear.
  - **The notifier** is a new principal: an SSH key an administrator registers for the tenant
    with its public encryption key (`baton admin notifier add`). It reads the conditions lists
    (R-BTN-163), the policy reads, and `GET /v1/notifier/routes`, the one route that answers
    sealed addresses; it writes nothing and holds no grant. Every other reader gets a route's
    `channel` alone.
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

## 7. Decided, and still open

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
