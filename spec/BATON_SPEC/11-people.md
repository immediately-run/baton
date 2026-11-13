---
title: "11. People: administrators, owners and their surfaces"
description: "Two kinds of people hold authority in a tenant: its administrators and each repository's owners."
---
## 11. People: administrators, owners and their surfaces *(partly built)*

Two kinds of people hold authority in a tenant: its **administrators** and each repository's
**owners**. They act through three surfaces — the CLI, the dashboard and MCP — all generated from
one registry of actions and checked by one `authorize` (R-BTN-129). What every principal may do
is summarized in the principal table (§12.1).

### 11.1 Keys

- **R-BTN-13 (SSH keys and signed requests).**
  - **Keys.** An SSH key is one of `ssh-ed25519`, `ecdsa-sha2-nistp256`,
    `sk-ssh-ed25519@openssh.com` or `sk-ecdsa-sha2-nistp256@openssh.com`. Baton stores only the
    public key; a credential's id is its fingerprint (`SHA256:…`). A credential is valid in one
    tenant (R-BTN-137).
  - **Runners.** A runner credential registers under one name — a machine's hostname, or a
    cloud environment's name shared by its containers — unique in the tenant, one key per name.
    What it may do is in its grants (R-BTN-58). Refused `forbidden`: a heartbeat under another
    name, a course of a repository no grant of its
    key covers (a retired repository's course is dropped instead, R-BTN-47).
  - **Revocation.** Revoking a key sets `revoked_at`; every runner it registered stops at its
    next call.
  - **The signature profile.** Every signed call carries an RFC 9421 `Signature-Input` and
    `Signature`, with exactly one signature label.
    - Components, exactly: `@method`, `@authority`, `@path`, `@query` and `content-digest`
      (`sha-256` of the body; a request with no body carries the empty string's digest). Baton
      recomputes `Content-Digest`.
    - Parameters, exactly: `created`, `nonce` (128 random bits), `keyid` (the fingerprint) and
      `tag="baton-request"`. `expires` and `alg` are refused.
    - The value is an SSHSIG (OpenSSH `PROTOCOL.sshsig`) over the signature base, in the
      namespace `baton-request`, hash `sha256` or `sha512`, whose embedded public key is the one
      `keyid` names. The namespace keeps it from passing as any other signature by the same key,
      such as a signed commit.
    - **Owner-signed commits** (B-127, R-BTN-66 as amended) use the same SSHSIG format in the
      namespace `git`, over the commit object without its `gpgsig` header — git's own
      `gpg.format ssh` writes them. The sync verifies them to mark what counts (§7.1) and each
      runner verifies them again before loading what a post named (R-BTN-133); the two
      namespaces keep one from passing as the other.
    - Both hosts verify with WebCrypto (Ed25519, P-256). An `sk-` signature must carry the
      user-presence flag; its counter is not checked.
  - **Refused `unauthenticated`:** `created` more than 5 minutes from Baton's clock; an
    `@authority` other than the tenant origin's (its host, and its port when not the scheme's
    default); a nonce already seen for that key within 11 minutes (`request_nonces`); an unknown
    or revoked key.
  - **Custody.** Signers sign through `ssh-agent` or the key file and never read the private key
    into a log or transcript. A machine keeps its key as well as it can: in a hardware key, a
    Secure Enclave P-256 key, or, for a cloud environment, the secret `BATON_KEY`.

- **R-BTN-159 (an SSH key or an API key, the holder's choice).**
  - **Who chooses.** An administrator, an owner and a runner each holds either an SSH key, whose
    every request is signed (R-BTN-13), or an API key, sent as a bearer. Role, grants and
    revocation never depend on the kind. Sync, mirror, instrument and check-runner
    keys are SSH keys (a sync may use a CI identity instead, R-BTN-93); an API-key runner never
    syncs or delivers (R-BTN-171). A signature leaves nothing reusable in a captured request; an API key works for
    whoever reads it until it is revoked. That is the holder's trade.
  - **The key.** `baton key create FILE` writes `bak_<id>_<secret>` (64 random bits of id, 256
    of secret, hex) to `FILE` (mode 0600) and its **public line** `bak_<id> sha256:<SHA-256 of
    the key> [comment]` to `FILE.pub`. Nothing is sent. The key's fingerprint is `bak_<id>`.
    Baton can mint a runner's API key instead, returned once: through a registration token
    (R-BTN-117), or `baton owner grant add --api-key --name <name>` (`POST
    /v1/owner/{repository}/grants {name, api_key: true, capabilities, max_tier?}`).
  - **Where it is registered.** Wherever an SSH public key goes for that role: a
    `BATON_ADMIN_KEYS` line (`--admin-keys` locally), an owner key (`owner_keys`,
    `owner_keys_add`, an owners add), a grant's `public_key`.
  - **How it is sent.** `Authorization: Bearer <key>` in place of a signature, on `/v1/admin/*`,
    `/v1/owner/*`, `/v1/runner/*`, the repository reads and `GET /v1/actions`;
    a runner adds its secret (R-BTN-14).
    `baton … -i FILE`, `BATON_KEY_FILE` and `BATON_KEY` send it.
    - Baton hashes the key and compares every byte with the hash on the public line its
      fingerprint names. An unknown fingerprint, a wrong secret or a malformed bearer is
      `unauthenticated`.
    - A bearer on `/v1/sync/*`, `/v1/probe/*` or `/v1/runner/outbox/*` is never an API key's.
    - No client sends a bearer over non-loopback `http` (R-BTN-158).
  - **Everything else is a key's.** The one-role rule holds across kinds (§12.1). Acts are
    recorded as `admin:bak_<id>` or `owner:bak_<id>`. `baton admin key revoke bak_<id>` stops a
    runner's or owner's key at its next call (R-BTN-57); an administrator's key, of either kind,
    stops only when its line leaves `BATON_ADMIN_KEYS`, at once, with its sessions.
  - **Bounds on API-key runners.** An API-key runner credential lives at most 90 days and ends
    after 7 days without an authenticated call (a token-registered one per R-BTN-117, if
    sooner). The repository setting `api_keys: false` (R-BTN-66, default `true`) refuses
    API-key runners and MCP keys on that repository. An administrator's or owner's API key lasts
    until it is revoked or its line removed.

### 11.2 Administrators and owners

- **R-BTN-57 (administrators: whoever controls the deployment).**
  - **The root of trust.** Whoever can deploy a Baton or set its secrets can replace its code, so
    that control is the root of trust (R-BTN-136) and Baton adds no second one. A tenant's
    administrators are the lines of its `BATON_ADMIN_KEYS` secret, each an SSH public key or an
    API key's public line, written through the CLI's secret sink (`baton admin keys set`,
    R-BTN-136); locally, the file `--admin-keys` names. Nothing in Baton's storage can add an
    administrator, and an administrator's powers end at its tenant.
  - **Powers.** An administrator signs `/v1/admin/*` to:
    - register and retire repositories with their first owner keys (R-BTN-47);
    - register instrument keys, external resources and account instances, and post or clear
      readings (R-BTN-76, R-BTN-151); set a capability's capacity (R-BTN-178);
    - make or change any grant, and change a key's hostname — an `approvers.members` action (R-BTN-188), `forbidden` where that list is human-only — the gate is opened on the owner route with a `human_only` key the list admits (R-BTN-188), never with an administrator key, which carries no `human_only` mark (§12.1); adding an owner the same
      (R-BTN-58);
    - revoke any key at once but an administrator's: revoking an owner key removes it from
      every repository it owns, the last owner included (an administrator then adds one with
      `owner_keys_add`), and ends its sessions and MCP keys, unless it would leave an approver list
      unsatisfiable (`unsatisfiable-approvers`, R-BTN-188), which only the break-glass key resolves. An administrator's key is removed
      only from the secret (`baton admin keys set`); `admin.key.revoke` naming one is
      `invalid-params`;
    - set the instance settings `link_hosts`, `session_hosts` and `check_app_id` (R-BTN-112,
      R-BTN-113, §12.7);
    - freeze, seal, export and import (R-BTN-88);
    - bind a sign-in code to an administrator's session, confirm that session's actions, and
      end every session, owners' included (R-BTN-155);
    - read everything, including any claim's leg runs (R-BTN-128), and the state in one
      request for a terminal — `GET /v1/admin/state`, built of the same functions the entity
      reads use (R-BTN-179, B-216), with no session and so no sign-in (B-118).

    Each act is an `admin` event. No administrator action is reachable to a delegated key, which
    is an owner's (R-BTN-130, R-BTN-186).
  - **An administrator key is out of every agent's reach.** It is a key of its own, never added
    to an ssh-agent that agent sessions can reach, and preferably touch-required
    (`ed25519-sk`), so no process signs with it unattended. `baton admin` signs with the key file
    (`-i`). Owner keys are kept out of agents' reach the same way, because they grant keys and add
    owners.
  - **One management path.** `baton admin …` and `baton owner …` sign with the user's ssh-agent
    or send the user's API key, and call the same validated functions (`src/core/admin.ts`) on
    both hosts. There is no other path: Durable Objects Data Studio is not used, and a local
    operator who edits the SQLite file bypasses validation at their own risk.
  - **Creating Baton's GitHub App is one command.** `baton admin github-app create --org <org>`
    creates the tenant's own App (§12.7) by GitHub's manifest flow.
    1. It opens GitHub's create-from-manifest page with the manifest filled in: `public: false`,
       the name, the webhook URL `<BATON_ORIGIN>/v1/github/webhook`, R-BTN-73's events and
       §12.7's permissions.
    2. It listens on `127.0.0.1` only, on a random port and path, sends a 128-bit `state`, and
       accepts exactly one callback carrying it.
    3. It exchanges the returned code (`POST /app-manifests/{code}/conversions`) and checks that
       `owner.login` is `--org`, that the permissions and events equal the manifest's, and that
       the webhook URL is the origin's. On any mismatch it writes nothing and prints the App's
       settings URL for deletion.
    4. It writes the App's id, webhook secret and private key through the secret sink
       (`BATON_GITHUB_APP_KEY`, §12.7), never to the terminal or a repository file, and prints
       the App's installation link. An organisation owner installs it; no Baton key can.
    `baton admin check-app create --org <org> --key-out <path>` makes the check App the same way,
    its key to the file and its id to `check_app_id` (§12.7).

- **R-BTN-58 (repository owners).**
  - **Owners act for one repository.** Each registered repository has owner keys
    (`repository_owners`), SSH or API (R-BTN-159). An owner signs `/v1/owner/{repository}/*`
    and acts for that repository only; owning one repository confers nothing on another. An
    owner may:
    - grant a runner key access with the capabilities it may use (a capability, or a whole type
      `<type>:*`, R-BTN-121; never a role name, R-BTN-157) and its
      `max_tier` (`runner_grants`); revoke a grant; set a grant's `sync` flag and see each key's
      span (R-BTN-146);
    - add and remove owners, never the last;
    - register and revoke sync and mirror keys (R-BTN-93) and check-runners (R-BTN-114); mint and revoke registration tokens (R-BTN-117) and MCP keys
      (R-BTN-130);
    - set the owner settings and bars of R-BTN-66 and R-BTN-67, follow renamed bars
      (R-BTN-142), and consent to another repository's `code_repos` entry (R-BTN-140);
    - set and clear expedite and hold, and cancel (§6); re-route a ticket (R-BTN-83); resolve a
      condition by choosing a restart
      (`baton ticket resolve`, R-BTN-163); stop a running leg (R-BTN-119); record a sync want
      (R-BTN-105);
    - read the repository's blocks, prerequisites, history, conditions and leg runs
      (R-BTN-75, R-BTN-120, R-BTN-128).
  - **Grants carry the power.** A key's capabilities live in each grant, not on the key, so what
    one repository's owners grant reaches only that repository's tickets (rule 4, R-BTN-45). A
    grant bounds which statements count for a repository; it confers no ability, and
    `human-operator` is admitted like any other capability.
  - **A key's hostname binds once.** It binds at the key's first acceptance (R-BTN-146) and is
    unique in the tenant. A later grant naming another hostname for the key is refused
    (`conflict`); only an administrator changes it.
  - **A runner works only where it is granted.** A ticket is recommended to, or claimed by, a
    runner only when its key holds an active grant on the ticket's repository (rule 7,
    R-BTN-45).
  - Owners act through `baton owner`, their own dashboard sessions (R-BTN-155) and the MCP keys
    they mint.

### 11.3 The registry, the CLI and MCP

- **R-BTN-129 (one registry of actions; every surface is derived from it).**
  - **An action** is one entry in `src/shared/actions.mjs`: `{id, summary, callers, effect,
    input, output, http, ui?, delegated}`.
    - `id` matches `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$` (dots and hyphens, never `_`), in
      R-BTN-127's nouns: `leg.why`, `leg.stop`, `ticket.expedite`, `owner.owner.add`,
      `runner.heartbeat`.
    - `callers` lists every principal that may call it, each with its scope, in the order the
      CLI tries them. Principals (§12.1): `administrator`, `owner`, `session` (a dashboard
      session, R-BTN-155, with the role or roles the entry admits: `administrator`, `owner`, or
      both), `runner`, `check-runner`, `probe` (an instrument key), `sync`, `mirror`, `token` (a
      registration token), `webhook` (the GitHub App's signature), `forge` (a forge verifier)
      `human` (a `human_only` key, R-BTN-185: scope `instance` for `human-key.*`, `repository`
      where it is an owner or, for a `BATON_HUMAN_KEYS` line, on every repository whose
      `human_key` it meets, R-BTN-188's break-glass) and `public` (no credential: `POST /v1/login`); an entry is
      `{principal, scope, roles?}`,
      `roles` only for `session` (`{principal: "session", roles: ["owner"], scope:
      "repository"}`). A delegated key is no principal of its own:
      it calls as `owner`, narrowed (R-BTN-130). Scopes: `instance` (this tenant; no action is
      the operator's, R-BTN-136), `repository` (a repository the key owns or is granted on; for a
      session, one of the repositories its key still owns, every repository for an
      administrator's), `claim-holder` (the key holds the claim's lease) and `own` (its own
      credential or outbox entries).
    - `effect` is `read`, `write` or `destructive` (§12.2).
    - `input` and `output` are schemas in the shared validator's subset (R-BTN-108).
    - `http` is `{method, path, upgrade?: "websocket", match?}`. A WebSocket upgrade
      (`/v1/runner/push`) is an action,
      authorized at the upgrade. `match` tells apart the actions of one route by body field:
      `POST …/overrides/{ticket}` serves `ticket.expedite`, `ticket.hold` (`hold: true`),
      `ticket.unhold` (`hold: false`: an approver on `approvers.policy`, a session of one, or the
      delegated key that set the hold, R-BTN-186) and `ticket.cancel`, and a body matching none or
      several is `invalid-params`.
    - `ui` is `{view: [<screen id>…], route?}` — the screens of §11.4 that draw the action as a
      control, and, where the dashboard calls it through a `/v1/ui/*` route of its own
      (`/v1/ui/resync`, `/v1/ui/overrides/{ticket}`, `/v1/ui/conditions/{condition}/resolve`,
      and `/v1/ui/messages`, which is `leg.stop`'s for `kind: release` and its own actions' for
      the other kinds, told apart by `match`), that route: an entry may carry both an `http` and
      a `ui` route, and the router serves both. A screen id is `root`, `tenant/<segment>` or
      `repository/<segment>[/{param}]`, exactly §11.4's list, held in one data file
      (`src/core/screens.ts`) the front, the client router and `check:actions` read. `view` is
      set only on an entry whose `callers` include `session`; `check:actions` fails a `view`
      naming no screen or an entry no session can call, and lists, never failing, a screen no
      control names.
    - `delegated` is what a delegated key (R-BTN-130) may do with the action, as R-BTN-186
      rules: `true` for a read whose `callers` include `owner`, and for a tightening —
      `ticket.hold`, `ticket.cancel`, `leg.stop`, `owner.bar.add`; `own` for the undoing of the
      key's own tightening — `ticket.unhold` of a hold it set (`set_by: mcp:<id>`),
      `owner.bar.lift` of a bar it added; `false` for everything else: every other write
      (`ticket.resolve` among them, R-BTN-186), every administrator action, machine protocol,
      credential action, attestation (R-BTN-181), and an action absent from MCP for a mechanical
      reason the entry names (the WebSocket upgrade; `GET /v1/actions`, whose answer over MCP is
      `tools/list`). This list is the mark's definition, and `check:actions` fails an entry whose
      mark differs from
      the one it gives.
  - **The CLI's commands** are a second table in the same file. Each names the action ids it
    calls (`leg log` calls `leg.runs` and reads the log directory itself), or `local` for one that
    calls none, with its arguments, its flags, a one-line summary and one example; a noun may
    carry a `notes` paragraph (the `ticket` noun's: the tags Baton reads and the `Requires:`
    clause, R-BTN-74). `baton help` is printed from it (R-BTN-127).
  - **One check.** The front resolves the request's credential to a principal and a target, then
    calls `authorize(principal, action, target)` in core. No route, command, dashboard control
    or MCP tool checks permissions itself.
    - Under `/v1`, a request matching no entry is `404 not-found`. The dashboard's static assets
      are not actions.
    - A dashboard session authorizes as `session` with its minting key's role (R-BTN-155): an
      administrator's session may take every action whose `callers` list `session` for
      administrators, on every repository; an owner's only those listed for owners, on the
      repositories its key still owns, never an administrator's action; a target elsewhere is
      `forbidden`. A delegated key authorizes as `owner` on its one repository, narrowed to its
      listed ids and their `delegated` marks (R-BTN-130).
  - **Generated surfaces.** The router comes from `http`, the CLI tree and every `help` from the
    command table, and an MCP key's tool list from `delegated` and the key's ids; the API table
    (§14) documents the registry. `npm run check:actions` fails when a route, command or API row
    has no entry, an entry has neither a route nor a command, an id breaks the grammar, a
    `delegated` mark disagrees with R-BTN-186, or a command's example does not parse against its
    arguments.
  - **What can I do.** `GET /v1/actions` answers the caller's own entries, each with its `input`
    schema — to a session, its entries as the registry holds them, minus `delegated`, with `ui`
    (a delegated key is `unauthenticated` there, R-BTN-130). `baton help` with a key, the
    dashboard and MCP's `tools/list` read it. A caller is never shown an
    action it cannot take.

- **R-BTN-127 (the CLI is a tree of nouns and verbs).**
  - Every command is `baton <noun> <verb> [<arguments>] [<flags>]`; the only top-level verbs
    are `help` and `version`. Under `owner` and `admin`, a verb that acts on a kind of thing is
    two words, `<thing> <act>`, the thing singular (`owner policy apply`, `admin repo add`,
    `owner owner add`), plural only where the act replaces or ends the whole set (`admin keys
    set`, `owner settings set`, `admin sessions revoke`); a verb on the whole instance or on the
    caller's own session is one word (`admin freeze`, `admin seal`, `admin export`, `admin
    state`, `owner open`, `owner confirm`). Two binaries, `baton-sidecar` (§8.1) and
    `baton-activity` (§9.9), are a runner's and a harness hook's, not commands of this tree.
    Each command signs as its actions'
    `callers`, in order, trying the first role it has a key for. **Every command a rule of this
    specification names is in the tree below**, and a rule that names a command cites this one;
    a command a ticket proposes joins the tree when its spec PR lands.
  - **Keys.** The key `-i <file>` names, else the one `~/.config/baton/keys.json` maps to the
    role for the origin called: `{<origin>: {admin, owner: {<repository>: <file>},
    runner, sync: {<repository>: <file>}, mirror: {<repository>: <file>}, human: <file>}}`
    (R-BTN-137); a human-only key is mapped only where its custody allows (R-BTN-185),
    else given as `-i`. A command whose caller is an approver list tries the roles the list in
    force names (R-BTN-188). No key for the role exits 2, naming the role.
  - **The tree.** `leg` and `ticket` act on work, with whatever key the caller holds;
    `decision` and `attestation` are a person's statements, and `human-key` the human-only
    identity's (R-BTN-185); `repo`, `course`, `runner`, `key` and `server` run the repository's
    and the machine's side; `owner` and `admin` manage a
    repository and the instance. `<repository>` is omitted where the key file maps one
    repository, or the ticket names it.

    | Command | Calls | Signs as |
    |---|---|---|
    | `leg why <ticket> [<leg>]` | `leg.why`: `GET …/tickets/{ticket}/prerequisites` (R-BTN-120) | owner, or runner granted on the repository |
    | `leg log <ticket> [<leg>] [--run <n>] [-f] [--transcripts] [--json]` | `leg.runs`, then the log directory (R-BTN-128) | owner, or administrator |
    | `leg runs <ticket> [<leg>]` | `leg.runs`: `GET …/legs/{leg}/runs` | owner, or administrator |
    | `leg replay <ticket> <leg> [--run <n>] [--against <sha>]` | `leg.runs`, then local (R-BTN-84) | owner, or administrator |
    | `leg stop <ticket>` | `leg.stop`: `POST /v1/owner/{repository}/tickets/{ticket}/release` `{reason: "requested", confirm: true}` (R-BTN-119) | owner |
    | `leg status`, `output`, `done`, `suspend`, `release`, `next`, `yield`, `raise`, `await` | the local channel (R-BTN-106, R-BTN-160, R-BTN-162) | the runner |
    | `ticket blocked [<ticket>] [--on <kind>:<ref>]` | `ticket.blocked`, `repo.blocked`: the blocks routes (R-BTN-75) | owner, or runner granted on the repository |
    | `ticket history <ticket>` | `ticket.history`: `GET …/tickets/{ticket}/history` (R-BTN-81) | owner, or runner granted on the repository |
    | `ticket hold <ticket>`, `ticket unhold <ticket>`, `ticket expedite <ticket> [--clear]`, `ticket cancel <ticket>` | `ticket.hold`, `ticket.unhold`, `ticket.expedite`, `ticket.cancel`: `POST /v1/owner/{repository}/overrides/{ticket}` (R-BTN-12, §6.8) | owner; `unhold` an approver on `approvers.policy` (R-BTN-186) |
    | `ticket route <ticket> <leg> \| --clear` | `ticket.route`: `POST …/tickets/{ticket}/route` (R-BTN-83) | owner |
    | `ticket adopt <ticket> [--at <station>] [--next <leg>] [--ran <leg>,…]` | `ticket.adopt`: `POST …/tickets/{ticket}/adopt` (R-BTN-39) | an approver on `approvers.policy` |
    | `ticket resolve <ticket> <restart> [--condition <id>]` | `ticket.resolve`: `POST …/tickets/{ticket}/resolve` (R-BTN-163) | owner |
    | `ticket new --title <t> […]`, `ticket claim <id> […]`, `ticket set <id> <status> […]`, `ticket done <id> [--pr <url>]`, `ticket check [--repo <dir>] [--quiet]`, `ticket request "<one sentence>" --course <course> […]` | local: the ticket source in git, each a commit; `claim` and `set` read Baton first, and their flags (`-i`, `--url`, `--offline`, `--pr`, `--note`) are R-BTN-74's (R-BTN-74, R-BTN-131) | — |
    | `decision list [--all] [--watch]` | `condition.list`: `GET /v1/repositories/{repository}/conditions?open=1&person=1` (R-BTN-163) | owner, runner granted on the repository, or administrator |
    | `decision answer <ticket> <option>` | `attestation.add` with a `std:decision@1` for the ticket's queued person leg (R-BTN-116, R-BTN-181) | owner, or a human-only key |
    | `attestation add <repository> --type <type> --subject <json> --value <json> [--lapses <duration>]`, `attestation revoke <repository> <id>` | `attestation.add`, `attestation.revoke`: `POST`, `DELETE /v1/repositories/{repository}/attestations` (R-BTN-181) | owner, a human-only key, or the `service:` key named |
    | `human-key add <pub>`, `human-key revoke <fingerprint>` | `human-key.add`, `human-key.revoke`: `POST /v1/human-keys` (R-BTN-185) | a human-only key |
    | `repo board <repository>` | `repo.board`: `GET /v1/repositories/{repository}/board` (R-BTN-179) | owner, runner granted on the repository, or administrator |
    | `repo policy <repository>` | `repo.policy`: `GET /v1/repositories/{repository}/policy` (R-BTN-189) | owner, runner granted on the repository, or administrator |
    | `repo protect --print <forge> \| --check <forge>` | `repo.policy`, then local (R-BTN-180) | owner, administrator, or runner granted on the repository |
    | `repo init`, with R-BTN-134's flags | local: writes files | — |
    | `repo sync [--if-wanted] [--defaults-only]`, `repo mirror [--if-wanted]` | `/v1/sync/*` (R-BTN-93) | CI identity, sync (mirror) key, or machine key (R-BTN-102) |
    | `repo spool <repository>` | local (R-BTN-105) | — |
    | `course test <root> <course> [--base <ref>] [--board <file>]` | local (R-BTN-69) | — |
    | `runner start [--delivers git,forge-check] […]` | `/v1/runner/*` (R-BTN-72, R-BTN-171) | runner |
    | `runner register --token <t> --name <name> [--key ssh\|api]` | `POST /v1/register` (R-BTN-117) | the token |
    | `runner accept-grant <repository> [--confirm]`, `runner decline-grant <repository>` | `runner.grant.accept`, `runner.grant.decline` (R-BTN-146) | runner, key alone |
    | `key create <file>` | local (R-BTN-159) | — |
    | `server start --db <file> --admin-keys <file> […]` | local: starts the local host (R-BTN-56, R-BTN-158) | — |
    | `owner grant list <repository>` | `owner.grant.list`: `GET /v1/owner/{repository}/grants` (R-BTN-179, R-BTN-146) | owner |
    | `owner grant add <repository> --key <pub> --capabilities <a,b> [--hostname <h>] [--label <l>] [--max-tier <t>] [--confirm-span]`, or `--api-key --name <name>` | `owner.grant.add`: `POST /v1/owner/{repository}/grants` (R-BTN-58, R-BTN-146, R-BTN-159) | an approver on `approvers.members` |
    | `owner grant revoke <repository> <fingerprint>` | `owner.grant.revoke` (R-BTN-58) | an approver on `approvers.members` |
    | `owner grant role <repository> <fingerprint> --role runner\|trusted-runner [--domain <label>] [--checker]` | `owner.grant.role`: `PUT …/grants/{fingerprint}/role` (R-BTN-180) | an approver on `approvers.roles` |
    | `owner grant flags <repository> <fingerprint> --sync\|--no-sync` | `owner.grant.flags`: `PUT …/grants/{fingerprint}/flags` (R-BTN-146) | owner; `--sync` an approver on `approvers.policy` |
    | `owner owner add <repository> <pub>`, `owner owner remove <repository> <fingerprint>` | `owner.owner.add`, `owner.owner.remove` (R-BTN-58) | an approver on `approvers.members` |
    | `owner bar add <repository> --course <c> --tag <t> […]`, `owner bar lift <repository> <id>`, `owner bar follow <repository> <course>` | `owner.bar.add`, `owner.bar.lift`, `owner.bar.follow` (R-BTN-67, R-BTN-142) | owner; `lift` an approver on `approvers.policy` |
    | `owner settings show <repository>`, `owner settings set <repository> […]` | `owner.grant.list`; `owner.settings.set`: `PUT /v1/owner/{repository}/settings` (R-BTN-66, R-BTN-140) | owner; a loosening an approver on `approvers.policy` |
    | `owner policy show <repository>`, `owner policy diff <repository> [<version>]`, `owner policy log <repository>`, `owner policy set <repository> <file> [--dry-run]`, `owner policy apply <repository> <preset> [--dry-run]` | `repo.policy`, `owner.policy.log`; `owner.policy.set`: `PUT /v1/owner/{repository}/policy` (R-BTN-188) | owner; `set` and `apply` an approver on `approvers.policy` |
    | `owner consent add <repository> <home>`, `owner consent withdraw <repository> <home>` | `owner.consent.add`, `owner.consent.withdraw` (R-BTN-140) | an approver on `approvers.members` |
    | `owner sync-key add <repository> <pub> --role sync\|mirror`, `owner sync-key revoke <repository> <fingerprint>` | `owner.sync-key.add`, `owner.sync-key.revoke` (R-BTN-93) | an approver on `approvers.members` |
    | `owner sync want <repository>` | `owner.sync.want` (R-BTN-105) | owner |
    | `owner token create <repository> --role runner [--capabilities …] [--max-tier <t>] [--ttl <d>] [--uses <n>]`, `owner token revoke <repository> <id>` | `owner.token.create`, `owner.token.revoke` (R-BTN-117) | an approver on `approvers.members` |
    | `owner mcp-key create <repository> --name <name> [--actions read \| <id>,…] [--ttl <days>]`, `owner mcp-key revoke <repository> <name>` | `owner.mcp-key.create`, `owner.mcp-key.revoke` (R-BTN-130) | an approver on `approvers.members` |
    | `owner check-runner add <repository> <pub> --name <hostname> [--capabilities …] [--max-tier <t>]`, `owner check-runner revoke <repository> <fingerprint>` | `owner.check-runner.add`, `owner.check-runner.revoke` (R-BTN-114) | an approver on `approvers.members` |
    | `owner open`, `owner confirm <code>`, `owner sessions revoke` | an owner's dashboard sign-in, confirmations and sessions (R-BTN-155) | owner |
    | `admin repo list` | `admin.repo.list`: `GET /v1/admin/repositories` (R-BTN-179) | administrator |
    | `admin repo add <forge path> --owner-key <pub> […]`, `admin repo set <id> […]`, `admin repo retire <id>` | `admin.repo.add`, `admin.repo.set`, `admin.repo.retire`: `POST /v1/admin/repositories` (R-BTN-47, R-BTN-138) | administrator |
    | `admin repo resync <repository> --force [<sha>]` | `admin.repo.resync`: `POST /v1/admin/repositories/{repository}/resync` (R-BTN-11) | administrator |
    | `admin grant add <repository> --key <pub> --capabilities <a,b> […]` | `admin.grant.add`: `POST /v1/admin/grants` (R-BTN-57, R-BTN-188) | administrator |
    | `admin key revoke <fingerprint>`, `admin key hostname <fingerprint> <hostname>` | `admin.key.revoke`; `admin.key.hostname`, `POST /v1/admin/grants` by `match` (R-BTN-57) | administrator |
    | `admin keys set --file <path>`, `admin forge-secrets set --file <path>` | local: the secret sink (R-BTN-136) | administrator |
    | `admin github-app create --org <org>`, `admin check-app create --org <org> --key-out <path>` | local: GitHub's manifest flow, then the secret sink or `admin.settings.set` (R-BTN-57, §12.7) | administrator |
    | `admin probe add --key <pub> --label <l>`, `admin resource add <name> […]`, `admin instance add <name> […]`, `admin reading set <instance> […]` | `admin.probe.add`, `admin.resource.add`, `admin.instance.add`, `admin.reading.set`: `POST /v1/admin/probes`, `…/resources`, `…/instances`, `…/readings` (R-BTN-76, R-BTN-101) | administrator |
    | `admin capacity set <capability> <n>`, `admin capacity set <capability> --clear` | `admin.capacity.set`: `PUT /v1/admin/capacities` (R-BTN-178) | administrator |
    | `admin settings set [--link-hosts …] [--session-hosts …] [--check-app-id <id>]` | `admin.settings.set`: `PUT /v1/admin/settings` (R-BTN-112, R-BTN-113, §12.7) | administrator |
    | `admin freeze`, `admin unfreeze`, `admin seal`, `admin export [--with-history]`, `admin import <file>` | `admin.freeze`, `admin.unfreeze`, `admin.seal`, `admin.export`, `admin.import` (R-BTN-88) | administrator |
    | `admin state` | `admin.state`: `GET /v1/admin/state` (R-BTN-57, R-BTN-179) | administrator |
    | `admin open`, `admin confirm <code>`, `admin sessions revoke --all` | an administrator's dashboard sign-in, confirmations and sessions (R-BTN-155) | administrator |

    The names this table replaces — `baton request`, `baton tickets …`, `baton board`, `baton
    attest`, `baton admin repos`, `baton admin revoke`, `baton admin resync`, `baton admin
    resource set`, `baton owner grants`, `baton owner key grant`, `baton owner key create`,
    `baton owner override`, `baton owner resolve`, `baton owner route`, `baton owner ticket
    adopt`, `baton owner bars follow`, `baton owner owners add | remove` — exit 2 with a `renamed:` line naming the new command until no caller
    uses them (the history's Migrations), as the twelve names before them did. No alias stays.
  - **A leg is named by its ticket.** `<ticket>` is a qualified id, or a local id unique among
    the signing key's repositories; one matching several exits 2, listing the qualified
    matches. `<leg>` defaults to the running leg, else the queued leg, else the most recent;
    `--run <n>` defaults to the latest.
  - **Inside a leg.** The channel verbs act on the leg whose socket `BATON_SOCKET` names and
    take no ticket; outside a leg they exit 2, "not inside a leg".
  - **Help, from the registry.** `baton help [<noun> [<verb>]]`, `baton <noun> --help`, `baton
    <noun> <verb> --help` and an unknown verb print that level, from the registry's command
    table (R-BTN-129): a noun's verbs with their summaries, or one command's arguments, flags,
    summary and example, so no command answers "not a flag of this command". With a key, `baton
    help` reads `GET /v1/actions` and marks the commands that key may run. An unknown word
    suggests the nearest name. Every command that reads a route takes `--json` and prints the
    route's JSON as is; `leg log --json` prints frames as JSON lines.

- **R-BTN-130 / R-BTN-154 (Baton serves MCP; a delegated key reaches what R-BTN-186 admits).**
  - **The MCP key is a delegated key** (R-BTN-186). It acts as an owner of one repository, for
    the action ids listed at its minting, and may tighten and undo its own tightenings — never
    anything else, whatever its minter lists. The registry's `delegated` marks (R-BTN-129) say
    which actions those are; `check:actions` keeps the marks and R-BTN-186 equal.
  - **Minting.** An approver on the repository's `approvers.members` (R-BTN-188) mints one:
    `baton owner mcp-key create <repository> --name <name> [--actions read | <id>,…] [--ttl
    <days>]` (`POST /v1/owner/{repository}/mcp-keys`). A key has an immutable `id`, never
    reused; `--name` is unique among the repository's live keys, the OAuth spec's grants
    included. A hold or bar the key sets records the actor `mcp:<id>` in its `set_by` (§13)
    beside `hold_reason: mcp:<name>`, and the `own` test below is on the id, so a later key of
    the same name undoes nothing of a revoked one's.
    - It is returned once, `bmcp_` followed by 32 random bytes in base32. Baton keeps one
      `mcp_keys` row: repository, name, hash, the minting approver's fingerprint (an owner key:
      an administrator matches an `owner` entry, R-BTN-188, but signs no `/v1/owner/*` route,
      §12.1, and mints none), the action
      ids resolved at minting, expiry, last use (written at most once a minute) and revocation.
      An MCP key is not a `credentials` row.
    - `read` means every action whose `delegated` mark is `true`, whose `effect` is `read` and
      that exists at minting, so a later release never widens a key. A write is included only
      when listed by id. An id whose mark is `false`, or an action the minter could not take
      itself, is refused at minting (`invalid-params`).
    - It lives at most 90 days (default 30) and ends after 7 days without a call, when the
      credential that minted it is removed or revoked, or when its repository is retired
      (R-BTN-47). It is refused while the repository has
      `api_keys: false` (R-BTN-159), and works again when the setting returns, unless expired.
      It is revoked with `owner.mcp-key.revoke` (`POST /v1/owner/{repository}/mcp-keys/{name}/revoke`),
      and listed with the repository's credentials, with its minter (`GET
      /v1/owner/{repository}/grants`' `mcp_keys`, `baton owner grant list`).
  - **Authorization.** `authorize` treats an MCP key as `owner` on its one repository, narrowed
    to its stored ids and their `delegated` marks; an id whose mark has since become `false` is
    refused. An `own`-marked action succeeds only on what the key itself set: a hold whose
    `set_by` is `mcp:<id>`, the key (a hold set over MCP is a `held` event with `hold_reason:
    mcp:<name>`; on a ticket already held it changes nothing, so it never replaces another
    reason), or a bar whose `set_by` is the key. An MCP key resolves no condition (`ticket.resolve`, R-BTN-186, R-BTN-163) and writes
    no attestation (R-BTN-181: a `std:decision@1` moves a ticket as a route does), which
    R-BTN-186 keeps from a delegated key. The actor is recorded as `mcp:<id>` in history and
    release messages, shown with its name. An MCP key is accepted only on `POST /v1/mcp`; every other route
    answers it `unauthenticated`.
  - **The endpoint.** `POST /v1/mcp` speaks MCP's streamable HTTP transport, statelessly, in JSON.
    - Revisions are those in the build's `MCP_VERSIONS` (at least `2025-06-18`). `initialize`
      needs no `MCP-Protocol-Version` header; on any other request an absent header means
      `2025-03-26`, and a revision not in the list is `400`.
    - Methods: `initialize`; notifications, answered `202`; `ping`; `tools/list`; `tools/call`.
      Any other method is JSON-RPC `-32601`; a batch array is `-32600`.
    - No `Mcp-Session-Id`. `GET /v1/mcp` is `405`. A missing or unknown key is `401` with
      `WWW-Authenticate: Bearer`. A foreign `Origin` is `403`.
  - **Tools.** `tools/list` returns the key's stored ids whose `delegated` mark still stands,
    named by the id with `.` as `_`, with `inputSchema` the entry's `input` and `readOnlyHint` or
    `destructiveHint` from `effect`. `tools/call` runs the route's core function and returns the
    output as `structuredContent` and as text through the `plain` renderer (R-BTN-112).
    - A refusal is a tool error with the route's code. A tool the key does not hold, an unknown
      tool, a target outside its repository and an `own` action on what another set all answer
      `forbidden`.
    - `confirm` over MCP is a schema check, not a human gate (§12.2); the safeguard is the
      minter's choice of ids.
    - Returned values are data, never instructions, and the tool descriptions say so.
      `leg.runs` returns pointers and live state, never log bytes.
  - **Bounds.** At most 60 calls per key in any 60 seconds, counted in memory in the
    tenant's object (a restart empties it), else `rate-limited` with `retry_after_s`. A list
    tool takes `cursor` and returns `next_cursor`, HMAC-bound under `CursorKey` (R-BTN-55) to
    the key, action and input. A page is at most 256 KB; a larger single item is `too-large`.
  - Clients that cannot send a bearer obtain MCP keys through OAuth 2.1, `BATON_MCP_OAUTH_SPEC`
    (`spec/BATON_MCP_OAUTH_SPEC.md`), whose grants are MCP keys under this rule, minted by the
    approving session's key where the session itself is an approver on `approvers.members` as
    R-BTN-188 reads a session (an `owner` entry, or a `key:` entry naming a key not
    `human_only`; never `human`, R-BTN-185).
### 11.4 The dashboard

- **R-BTN-155 (dashboard sign-in is a code a key holder confirms).** An administrator signs in
  with `baton admin open` and an administrator key, an owner with `baton owner open` and an
  owner key; the session has that key's role. Its row records the role (`administrator` or
  `owner`), the minting key's fingerprint and, for an owner, the repositories the key owned at
  binding (`dashboard_sessions`). A session is one principal, `session`, authorizing with its
  role (R-BTN-129, §12.1): an administrator's session takes every action listed for it, on every
  repository; an owner's sees, watches and acts only on those of its repositories the key still
  owns, with the actions listed for an owner's session, and never holds an administrator's
  action.
  - **Sign-in.**
    1. `baton admin open` opens `https://<origin>/login?as=administrator`, and `baton owner
       open` `https://<origin>/login?as=owner`; the page carries nothing secret and heads itself
       "administrator sign-in" or "owner sign-in".
    2. The page sends `POST /v1/login {role}`. Baton writes a `login_codes` row of that role, sets
       the pending cookie `__Host-baton_pending` (value `bps_<id>_<secret>`, two minutes, R-BTN-16), and
       answers `{code}`: eight Crockford base32 characters, which the page shows.
    3. The key holder types the code into the CLI, which sends `POST
       /v1/admin/login-links {code}` with the administrator key, or `POST /v1/owner/login-links {code}` with the owner
       key. Baton answers the unexpired, unbound row with that code and the route's role as
       `{role, client_addr, age_s}` and binds nothing. The CLI prints it ("owner session for
       `<address>`, `<n>` s old") and asks `bind? [y/N]`, defaulting to no and taking no `--yes`,
       since the address is the one thing the key holder must read. On yes it sends the same
       route `{code, confirm: true}`, and Baton binds the key to that row; on no it sends
       nothing, and the row expires unbound. An `sk-` key needs a touch for each request. At
       either step any other code, a row of the other role included, is `not-found`, as is an
       owner key that owns no repository, and the CLI then reports how many rows the address
       made and lost in the last two minutes.
    4. The page polls `POST /v1/login {poll: true}` (`{pending: true}` until bound). The request
       carrying the bound row's pending cookie gets the session cookie `__Host-baton_session`
       (value `bds_<id>_<secret>`), and the row is marked used.

    No command line, URL, history or capture carries anything that becomes a session: a process
    that asks for a code of its own gets nothing unless a key holder types that code, read from
    Baton's own page, and — through the CLI, which always previews before it confirms — reads the
    client address Baton shows for it before anything binds; an owner's code never becomes an
    administrator's session. A `not-found` at either step is not a failed verification (the
    request verified); the per-credential limit (§2.3) bounds a key that guesses codes.
  - **Limits.** At most five unbound rows per client address, each living two minutes. A sixth
    drops the oldest row whose pending cookie has never polled, else the oldest polled row; it
    never refuses. The client address is the connection's, or a forwarded one only from the
    `--trusted-proxy` (R-BTN-158). Eviction bursts raise `baton.sign-in-burst`.
  - **Sessions.** A session lives at most 4 hours and dies with its minting key's role, checked
    on every request: an administrator's session ends as soon as its key leaves
    `BATON_ADMIN_KEYS`; an owner's session loses a repository as soon as its key stops owning it
    (`owner.owner.remove`, or an administrator's revocation, R-BTN-57) or the repository is
    retired (R-BTN-47), and ends when none of its repositories remains. `POST /v1/ui/logout` (`ui.logout`) ends the caller's own; `baton owner
    sessions revoke` (`POST /v1/owner/sessions/revoke`, `owner.sessions.revoke`, destructive)
    ends every session the owner's key minted; `baton admin sessions revoke --all` (`POST
    /v1/admin/sessions/revoke`, `admin.sessions.revoke`, destructive) ends every session.
  - **Confirmed actions.** A session's request that changes authority answers
    `202 {confirm_code}` instead of acting: eight Crockford base32 characters, living two minutes and
    used once, bound to the session, the action and its parameters (`action_confirmations`).
    Only the key that minted the session confirms it, through its role's route: `baton admin
    confirm <code>` (`POST /v1/admin/confirm`) for an administrator's session, `baton owner
    confirm <code>` (`POST /v1/owner/confirm`) for an owner's; any other key's is `not-found`.
    The command fetches and prints the action and its target (`{code, dry_run: true}`), asks,
    then sends `{code}`, which performs it. One list, for both roles; each confirms the entries
    its session may start:
    - cut over (`POST /v1/ui/cutover`, R-BTN-28); force-reap (`POST /v1/ui/claims/{id}/reap`);
      clear a fence (`POST /v1/ui/claims/{id}/fence-clear`, R-BTN-19);
      force a resync onto a rewritten default branch's head (`POST /v1/ui/resync` with `force: true` and `sha`, R-BTN-11) — an administrator's only;
    - lift a hold, set or clear expedite (`POST /v1/ui/overrides/{ticket}` with `hold: false` or
      `expedite`);
    - confirm or release an unconfirmed completion (`POST /v1/ui/claims/{id}/confirm`,
      `…/release`); confirm an adoption (`POST /v1/ui/adoptions/{claim}/confirm`) — an
      administrator's only;
    - approve an MCP grant naming a destructive action (§12.2: `leg.stop`, `ticket.cancel`;
      `owner.mcp-key.approve`, `BATON_MCP_OAUTH_SPEC` §5) — an owner's only.

    Not confirmed, because they stop or slow work and Stop must stay one click: setting a hold,
    cancel, Stop and other `release` messages, a resync, a status request; nor resolving a
    condition, which a signed-in owner or administrator answers in one step (`POST
    /v1/ui/conditions/{condition}/resolve`, R-BTN-163); nor a person leg's answer from the
    Conditions screen (§11.4, R-BTN-116), an OAuth request, its status, a denial or an approval naming no
    destructive action (`BATON_MCP_OAUTH_SPEC` §5), or `ui.logout`. The list above is the whole
    list.
  - **What the confirmation protects.** A same-user process can read a browser's cookie jar, so
    a session is the browser profile's; the confirmation keeps a stolen session from an
    authority-changing act only while the minting key needs a touch. An API-key or plain SSH key
    that a same-user process can reach confirms as well, which is why R-BTN-57 keeps
    administrator and owner keys out of agents' reach.

- **The screens.** The dashboard is a walk down the entity tree the REST API, the CLI and MCP
  already draw (R-BTN-129): sign in, pick a repository, and every screen after that is one
  entity, every value it draws reaching it as a text node or through R-BTN-112's `ui` renderer
  (§12.3). `/` holds the caller's repositories — every registered one for an administrator's
  session, the key's own for an owner's, each with its head, mode, ready count and open
  conditions; nothing else is tenant-scoped for an owner. `/login` is R-BTN-155's sign-in page.
  Under `/repositories/{repository}`: `/board`, `/tickets`, `/tickets/{ticket}`, `/goals`,
  `/courses`, `/courses/{course}`, `/conditions`, `/conditions/{condition}`, `/runners`,
  `/runners/{runner}` (the runner's id, never its name — a host runs several sessions),
  `/grants`, `/owners`, `/tokens`, `/mcp-keys`, `/sync-keys`, `/check-runners`, `/policy`,
  `/settings`, `/bars`, `/consents`, `/attestations`, `/sync`. The tenant screens —
  `/repositories`, `/instances`, `/resources`, `/capacities`, `/settings`, `/state`,
  `/sessions` — are an administrator's session only.
  - **`/board`** — the repository's live claims: each one's event timeline and reap deadline,
    **stalled** where its runner is alive but `last_activity_at` is over 2 hours old,
    `condition-wait` where the leg waits on a condition, with session links (R-BTN-113) and log
    directories (R-BTN-128).
  - **`/tickets`** — every ticket under its state word (below), Ready in the matching order with
    each ticket's `requires`, tier and eligible alive runners, and **ready but nobody can take
    it** with the failed rule.
  - **`/tickets/{ticket}`** — the ticket as Baton holds it: its station and path, the claim's
    legs since, what a suspended ticket waits for, its newest hand-off, blocks, queued leg and
    its source (R-BTN-83), parent and children, and history with input and output pointers
    (R-BTN-81, R-BTN-82).
  - **`/goals`** — the repository's goals, as the ticket source posts them.
  - **`/courses`** — each course of the repository as stations and legs, every leg drawn as an
    edge with its state (ready, running, blocked by kind and when found, backing off) in colour
    and a text label, never a blocked station (R-BTN-126), with `off-graph` transitions and
    course stats.
  - **`/courses/{course}`** — the one course: the tickets on it, each at its station and on its
    path as Baton holds them, and each leg's queue depth against `max_queue` and the intake
    state (R-BTN-79).
  - **`/conditions`** — the debugger (R-BTN-163): the open conditions and the queued person legs
    §7 lists there, ordered by severity then age, each with its restarts or options, its
    question's link, and the tickets it would unblock; a person leg's entry takes the answer
    where the policy admits an `owner` writer, else names `baton decision answer` (R-BTN-116).
  - **`/conditions/{condition}`** — the Resolve page (R-BTN-163): the one condition, its detail
    and restarts; choosing a restart is `ticket.resolve` for a signed-in owner of its repository
    or an administrator.
  - **`/runners`** — the runners granted on the repository, grouped by hostname (R-BTN-3), each
    card marked with its state: alive or dead, harness, tier ceiling, capabilities (declared,
    and granted per repository, R-BTN-174), tags, courses, lease timeout, last seen, last
    activity, the claim held, current activity, transcript link, executor (source, digest and
    `provides`, R-BTN-107), credential kind and registering token.
  - **`/runners/{runner}`** — the one runner: a 24-hour timeline, claims as bars, activities
    nested under them by kind, failed ones marked; a segment shows its label, detail and
    transcript; leg runs link their `session_url` (R-BTN-113) and show their log directory
    (R-BTN-128) and their executor digest, environment and instance (R-BTN-107) as text.
  - **`/grants`, `/owners`, `/tokens`, `/mcp-keys`, `/sync-keys`, `/check-runners`** — the
    repository's credentials: the grants with the keys that hold them and their spans
    (R-BTN-146), the owner keys (R-BTN-58), the registration tokens (R-BTN-117), the MCP keys
    (R-BTN-130), the sync and mirror keys (R-BTN-93), the check-runners (R-BTN-114).
  - **`/policy`, `/settings`, `/bars`, `/consents`, `/attestations`** — the repository's
    governance: the policy with its version log and computed guarantees (R-BTN-188, R-BTN-189),
    the owner settings (R-BTN-66), the bars in force or scheduled (R-BTN-67), the `code_repos`
    consents (R-BTN-140), the attestations (R-BTN-181).
  - **`/sync`** — the repository's sync: every place git disagreed with Baton (R-BTN-85), by
    kind and age, with Baton's value, git's, the observation and a link to the ticket's history.
  - **The tenant screens** — the registry with each repository's head, mode and owners
    (R-BTN-179); the instance view and the day's request and row-write counts (R-BTN-99); the
    registered resources, their instances and readings, and the instrument keys (R-BTN-76,
    R-BTN-101); each capability's seats held with the holding claims (R-BTN-178); the instance
    settings — `link_hosts`, `session_hosts`, `check_app_id` (R-BTN-112, R-BTN-113, §12.7); the
    tenant at one request — the live counts and the request rate against the envelope, and
    storage (R-BTN-87); the dashboard sessions (R-BTN-155).

  The rules, each stated once here:
  - **The rule.** A screen is drawn from one entity's REST reads — the §14 rows whose callers
    admit `session` (B-192) — and its controls are the registry actions whose `ui.view` names it
    (R-BTN-129).
  - **The strip.** Every repository screen carries running now · ready · needs you, linking to
    `/board`, `/tickets` and `/conditions`, and the repository's mode where it is not cut over.
  - **Polling.** Every screen polls its reads each 10 seconds with `If-None-Match`, paused while
    the page is hidden, its freshness shown; the one exception is the confirmation-code dialog,
    which polls its screen's reads every 5 seconds for the code's two minutes (R-BTN-155).
  - **Refusals.** On the repository and owner reads, a repository the caller cannot read — or
    none — answers `forbidden` for every principal (B-192 changes the reads that answer
    `not-found` today), and the screen says "This repository is not yours or does not exist"
    with a link to `/`; an entity id not found in a readable repository answers `not-found` and
    the screen says "No such ticket" — condition, runner, course alike: one component, one
    wording.
  - **Target-dependent controls.** An action whose answer depends on the target's policy
    (`ticket.unhold`, a person leg's answer, `attestation.add`) is drawn only where the read
    says the caller may take it — `allowed: [<action id>]`, or `answerable`, or
    `writable_types`, computed by `authorize` with the session as principal — and the app never
    reads the policy to decide.
  - **Ticket state.** One word per ticket, from `unconfirmed`, `running`, `waiting-person`,
    `held`, `blocked`, `backing-off`, `suspended`, `ready`, `closed`, in that precedence, with
    `reasons` listing every other that applies; the Tickets tabs are Ready, Running, Blocked
    (`held`, `blocked`, `waiting-person`, `backing-off`, `suspended` — a held ticket counts
    under Blocked), Unconfirmed, and Closed today (`closed` in the last 24 hours) — the same
    words `docs/context/vocabulary.mdx` defines.
  - **Stop.** The session's Stop is one click — `POST /v1/ui/messages` `{kind: "release"}`, no
    dialog, no code — with `confirm: true` the CLI's and the owner route's; the confirmed-action
    list is R-BTN-155's, unchanged.
- **The actions.** Every control calls a registry action through `authorize`, a destructive one
  with `confirm: true` from its dialog (§12.2) — Stop alone drawn as one click, with neither
  dialog nor code (the Stop rule above). Unconfirmed, a session views, holds, cancels,
  stops a leg (`POST /v1/ui/messages` `{kind: "release", payload: {ticket_id, reason:
  "requested"}}`, R-BTN-119), resyncs a repository (`POST /v1/ui/resync`), requests status,
  resolves a condition and answers a person's leg from the Conditions screen
  (`attestation.add`, R-BTN-116:
  the answer is what the person came to give, and the policy's writer list bounds it); the
  actions R-BTN-155 lists need its code confirmed, and no other does, so the dashboard is no
  standalone console. An owner's session does these only on its
  repositories, and the administrator's controls (cutover, force-reap, a fence clear, a forced resync (R-BTN-11),
  completions, adoptions) are not drawn for it. The credential, governance and tenant screens
  are read-only, each naming the CLI command that changes what it shows: nothing changes
  authority from a cookie (R-BTN-155), and the tenant's export stays the CLI's alone.

