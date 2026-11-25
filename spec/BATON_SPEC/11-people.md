---
title: "11. People: administrators, owners and their surfaces"
description: "Two kinds of people hold authority in a tenant: its administrators and each repository's owners."
---
## 11. People: administrators, owners and their surfaces

Two kinds of people hold authority in a tenant: its **administrators** and each repository's
**owners**. They act through the CLI and the dashboard. What every principal may do is in the
principal table (§12.1). The action registry, MCP, owners' dashboard sessions and the screens'
contents are not built; their design is
[the people and dashboard proposal](../proposals/people-and-dashboard.md).

### 11.1 Keys

- **R-BTN-13 (SSH keys and signed requests).** `status: built R3-1213`
  - **Keys.** An SSH key is one of `ssh-ed25519`, `ecdsa-sha2-nistp256`,
    `sk-ssh-ed25519@openssh.com` or `sk-ecdsa-sha2-nistp256@openssh.com`. Baton stores only the
    public key; a credential's id is its fingerprint (`SHA256:…`). A credential is valid in one
    tenant (R-BTN-137).
  - **Runners.** A runner credential registers under one name — a machine's hostname, or a
    cloud environment's name shared by its containers — unique in the tenant, one key per name.
    What it may do is in its grants (R-BTN-58). Refused `forbidden`: a heartbeat under another
    name, and a course of a repository no grant of its key covers (a retired repository's
    course is dropped instead, R-BTN-47).
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
      `keyid` names.
    - Both hosts verify with WebCrypto (Ed25519, P-256). An `sk-` signature must carry the
      user-presence flag; its counter is not checked.
  - **Refused `unauthenticated`:** `created` more than 5 minutes from Baton's clock; an
    `@authority` other than the tenant origin's (its host, and its port when not the scheme's
    default); a nonce already seen for that key within 11 minutes (`request_nonces`); an unknown
    or revoked key.
  - **Signing.** Signers sign through `ssh-agent` or the key file and never write the private
    key to a log or transcript.

- **R-BTN-159 (an SSH key or an API key).** `status: built B-8` An administrator, an owner and a runner each hold
  either an SSH key, whose every request is signed (R-BTN-13), or an API key, sent as a bearer.
  Role, grants, revocation and the one-role rule (§12.1) are the same for both kinds. The kinds
  differ only as this rule says.
  - **Where only an SSH key serves.** Sync, mirror, instrument, check-runner and `human_only`
    (R-BTN-185) keys are SSH keys; a sync may use a CI identity instead (R-BTN-93). An API-key
    runner never syncs or delivers (R-BTN-171): `/v1/sync/*`, `/v1/probe/*` and
    `/v1/runner/outbox/*` accept no API key.
  - **The key.** `baton key create FILE` writes `bak_<id>_<secret>` (64 random bits of id, 256
    of secret, hex) to `FILE` (mode 0600) and its **public line** `bak_<id> sha256:<SHA-256 of
    the key> [comment]` to `FILE.pub`. Nothing is sent. The key's fingerprint is `bak_<id>`.
    Baton can mint a runner's API key instead, returned once: through a registration token
    (R-BTN-117), or `baton owner grant add --api-key --name <name>` (`POST
    /v1/owner/{repository}/grants {name, api_key: true, capabilities}`).
  - **Where it is registered.** Wherever an SSH public key goes for that role: a
    `BATON_ADMIN_KEYS` line (`--admin-keys` locally), an owner key, a grant's `public_key`.
  - **How it is sent.** `Authorization: Bearer <key>` in place of a signature, on `/v1/admin/*`,
    `/v1/owner/*`, `/v1/runner/*` and the repository reads; a runner adds its secret
    (R-BTN-14). `baton … -i FILE`, `BATON_KEY_FILE` and `BATON_KEY` send it. Client refusal over clear HTTP is not built (R-BTN-158). Baton hashes the key and compares every byte
    with the hash on the public line its fingerprint names. An unknown fingerprint, a wrong
    secret or a malformed bearer is `unauthenticated`.
  - **Records and revocation.** Acts are recorded as `admin:bak_<id>` or `owner:bak_<id>`.
    A runner's or owner's key of either kind stops at its next call after `baton admin key
    revoke` (R-BTN-57); an administrator's stops when its line leaves `BATON_ADMIN_KEYS`.
  - **Lifetime.** An API-key runner credential lives at most 90 days and ends after 7 days
    without an authenticated call (a token-registered one per R-BTN-117, if sooner). An
    administrator's or owner's API key lasts until it is revoked or its line removed. The
    repository setting `api_keys: false` (R-BTN-66) refuses API-key runners on that repository.

### 11.2 Administrators and owners

- **R-BTN-57 (administrators: whoever controls the deployment).** `status: built`
  - **The root of trust.** Whoever can deploy a Baton or set its secrets can replace its code,
    so that control is the root of trust (R-BTN-136). Where `ACCESS_IDENTITIES` binds an email
    (R-BTN-155), whoever can make the deployment's Cloudflare Access application assert that
    email — its administrators, the identity providers it admits and the factors they accept —
    holds the bound key's session too: a second root, which the deployment configures and Baton
    cannot see. Baton adds no other. A tenant's
    administrators are the lines of its `BATON_ADMIN_KEYS` secret, each an SSH public key or an
    API key's public line (R-BTN-159), written through the secret sink (R-BTN-136); locally, the
    file `--admin-keys` names. An administrator's powers end at its tenant.
  - **Powers.** An administrator calls `/v1/admin/*`: the `admin` commands of R-BTN-127's table,
    each owned by the rule its row cites. It reads everything, any claim's leg runs included
    (R-BTN-128), and the whole state in one request, `GET /v1/admin/state`, built of the
    functions the entity reads use (R-BTN-179), with no session. Each act is an `admin` event.
  - **Grants and owners.** Making or changing a grant, changing a key's hostname and adding an
    owner are `approvers.members` actions (R-BTN-188). An administrator's request is `forbidden`
    where that list is human-only: an administrator key carries no `human_only` mark (§12.1).
  - **Revocation.** An administrator revokes any key at once but an administrator's. Revoking
    an owner key removes it from every repository it owns, the last owner included (an
    administrator then adds one with `owner_keys_add`). A revocation that would leave an
    approver list unsatisfiable is refused `unsatisfiable-approvers` (R-BTN-188). An administrator's key is removed only from the secret (`baton admin keys
    set`); `admin key revoke` naming one is `invalid-params`.
  - **One management path.** `baton admin …` and `baton owner …` call the same validated
    functions (`src/core/admin.ts`) on both hosts. There is no other path.
  - **Creating the GitHub App.** `baton admin github-app create --org <org>` creates the
    tenant's App (§12.7) by GitHub's manifest flow, with `public: false`, the webhook URL
    `<BATON_ORIGIN>/v1/github/webhook`, R-BTN-73's events and §12.7's permissions.
    - It listens on `127.0.0.1` only, on a random port and path, and accepts exactly one
      callback carrying its 128-bit `state`.
    - It writes nothing unless the created App's `owner.login` is `--org`, its permissions and
      events equal the manifest's and its webhook URL is the origin's; on a mismatch it prints
      the App's settings URL for deletion.
    - It writes the App's id, webhook secret and private key through the secret sink, never to
      the terminal or a repository file, and prints the installation link. An organisation
      owner installs the App; no Baton key can.

    `baton admin check-app create` makes the check App the same way (§12.7).

- **R-BTN-58 (repository owners).** `status: built`
  - **Owners act for one repository.** Each registered repository has owner keys
    (`repository_owners`), SSH or API (R-BTN-159). An owner calls `/v1/owner/{repository}/*`
    and acts for that repository only; owning one repository confers nothing on another. Its
    commands are the `owner`, `ticket`, `leg`, `decision` and `repo` rows of R-BTN-127's table,
    each owned by the rule its row cites. The last owner is never removed by an owner.
  - **Grants carry the power.** A grant (`runner_grants`) gives one runner key access to one
    repository: the capabilities it may use there (a capability, or a whole type `<type>:*`,
    R-BTN-121; never a role name, R-BTN-157) and its `max_claims` (R-BTN-4). A
    key's capabilities live in each grant, not on the key, so what one repository's owners
    grant reaches only that repository's tickets (rules 4 and 7, R-BTN-45). A grant bounds
    which statements count for a repository; it confers no ability, and `human-operator` is
    admitted like any other capability.
  - **A key's hostname** binds as R-BTN-146 says and is unique in the tenant. A later grant
    naming another hostname for the key is refused `conflict`; only an administrator changes
    it.

### 11.3 The actions, the CLI and MCP

- **R-BTN-129 (principals, scopes and effects).** `status: partly B-25` Every route and command is an action: an id,
  the principals that may call it with their scopes, and an effect.
  - **Principals.** `administrator`, `owner`, `session` (a dashboard session, R-BTN-155),
    `runner`, `check-runner`, `probe` (an instrument key), `sync`, `mirror`, `token` (a
    registration token), `webhook` (the GitHub App's signature), `forge` (a forge verifier),
    `human` (a `human_only` key, R-BTN-185) and `public` (no credential). §12.1 says how each
    authenticates and what it may do.
  - **Scopes.** `instance` (this tenant; no action is the operator's, R-BTN-136), `repository`
    (a repository the key owns or is granted on), `claim-holder` (the key holds the claim's
    lease) and `own` (its own credential or outbox entries).
  - **Effect** is `read`, `write` or `destructive` (§12.2).
  - **Ids.** An action is named in R-BTN-127's nouns, with dots: `leg.stop`, `ticket.expedite`,
    `owner.owner.add`, `runner.heartbeat`.
  - **Refusals.** A caller the action does not list is refused as §12.1 says. Under `/v1`, a
    request matching no action is `404 not-found`.
  - **The registry.** One file of actions from which the router, the CLI's help, the
    dashboard's controls, MCP's tools and `GET /v1/actions` are generated, under one
    `authorize`, is not built (B-25):
    [the proposal, §1](../proposals/people-and-dashboard.md#1-the-action-registry). Until it
    is, §14 lists each route with its callers and R-BTN-127's table each command.

- **R-BTN-127 (the CLI is a tree of nouns and verbs).** `status: built B-22 B-23`
  - **Grammar.** Every command is `baton <noun> <verb> [<arguments>] [<flags>]`; the only
    top-level verbs are `help` and `version`. Under `owner` and `admin`, a verb that acts on a
    kind of thing is two words, `<thing> <act>`, the thing singular (`owner policy apply`,
    `admin repo add`), plural only where the act replaces or ends the whole set (`admin keys
    set`, `owner settings set`); a verb on the whole instance or on
    the caller's own session is one word (`admin freeze`, `admin open`). The sidecar (§8.1)
    and `baton-activity` (§9.9) are separate binaries, not commands of this tree.
  - **Every command is in the table below.** A rule that names a command cites this one. A
    command calls the action of its name (`owner grant add` calls `owner.grant.add`) unless its
    row names another, and signs as the first of that action's callers it has a key for. A
    row or a verb marked *proposed* is a command of a design that is not built; the page it
    links holds the design.
  - **Keys.** The key is the one `-i <file>` names, else the one `keys.json` (R-BTN-137) maps
    to the role for the origin called. A human-only key is mapped only where its custody allows
    (R-BTN-185), else given as `-i`. A command whose caller is an approver list tries the roles
    the list in force names (R-BTN-188). No key for the role exits 2, naming the role.
  - **Homes.** `~/.config/baton/homes.json` names the CLI's homes:
    `{default?: <name>, homes: {<name>: {origin, repository, checkout?}}}`, the name matching a
    repository id's pattern (R-BTN-47) and defaulting to the repository id. A home grants
    nothing: every request is signed and checked as without it.
    - The home in force is `--home <name|path>` (a value containing `/` or naming an existing
      directory is a path, read as its checkout), then `BATON_HOME`, then the file's `default`.
    - It supplies the repository an omitted `<repository>` names, the repository a bare ticket
      id is read in, and the origin where `--url` and `BATON_URL` are absent. A `<repository>`
      positional or a qualified ticket id always wins.
    - The CLI exits 2 where the home's origin differs from `--url` or `BATON_URL`, naming both,
      and where homes exist, none is in force and the command needs a repository, listing them.
    - `home add` with `--checkout` reads the origin from the checkout's `.baton/baton.json`
      `baton_url` (R-BTN-56) and refuses an `--origin` that differs; without `--checkout`,
      `--origin` is required. `home use` refuses an unknown name.
    - `baton run` and `baton runner start` take `--home` as a checkout: a name resolves to its
      home's `checkout`, and a home with none exits 2.
  - **Naming a repository and a leg.** `<repository>` is omitted where the key file maps one
    repository, the home in force names one, or the ticket names it. `<ticket>` is a qualified
    id, or a local id unique among the signing key's repositories where no home is in force;
    one matching several exits 2, listing the qualified matches. `<leg>` defaults to the
    running leg, else the queued leg, else the most recent; `--run <n>` defaults to the latest.
  - **Inside a leg.** The channel verbs act on the leg whose socket `BATON_SOCKET` names and
    take no ticket; outside a leg they exit 2, "not inside a leg".
  - **Help.** `baton help [<noun> [<verb>]]`, `--help` on a noun or a command, and an unknown
    verb print that level: a noun's verbs with their summaries, or one command's arguments,
    flags, summary and example. An unknown word suggests the nearest name. Every command that
    reads a route takes `--json` and prints the route's JSON as is; `leg log --json` prints
    frames as JSON lines.

  | Command | What it does | Rule |
  |---|---|---|
  | `leg why <ticket> [<leg>]` | a leg's prerequisites | R-BTN-120 |
  | `leg log <ticket> [<leg>] [--run <n>] [-f] [--transcripts] [--json]` | `leg.runs`, then reads the log directory | R-BTN-128 |
  | `leg runs <ticket> [<leg>]` | a leg's runs | R-BTN-128 |
  | `leg replay <ticket> <leg> [--run <n>] [--against <sha>]` | `leg.runs`, then replays locally | R-BTN-84 |
  | `leg stop <ticket>` | stops the running leg | R-BTN-119 |
  | `leg status`, `output`, `done`, `suspend`, `release`, `next`, `yield`, `raise` | the local channel, inside a leg; `leg await`, `events` and `ticket` are proposed ([conditions](../proposals/conditions.md)) | R-BTN-106, R-BTN-160 |
  | `ticket blocked [<ticket>] [--on <kind>:<ref>]` | a ticket's or the repository's blocks (`repo.blocked`) | R-BTN-75 |
  | `ticket history <ticket>` | a ticket's history | R-BTN-81 |
  | `ticket hold <ticket>`, `ticket unhold <ticket>`, `ticket expedite <ticket> [--clear]`, `ticket cancel <ticket>` | the overrides | R-BTN-12, R-BTN-186 |
  | `ticket route <ticket> <leg> \| --clear` | queues or clears a leg (proposed: [data model and API](../proposals/data-model-and-api.md#other-reads-and-owner-routes)) | R-BTN-83 |
  | `ticket adopt <ticket> [--at <station>] [--next <leg>] [--ran <leg>,…]` | places a ticket on its course (proposed: [ticket adopt](../proposals/ticket-adopt.md)) | R-BTN-39 |
  | `ticket resolve <ticket> <restart> [--condition <id>]` | resolves a condition | R-BTN-163 |
  | `ticket next <kind>`, `ticket check [<id> --claimable]`, `ticket request "<one sentence>" --course <course>` | local: the ticket source in git, read; Dibber writes the ticket files | R-BTN-74, R-BTN-199, R-BTN-131 |
  | `decision list [--all] [--watch]` | `condition.list`: what waits for a person | R-BTN-163 |
  | `decision answer <ticket> <option>` | `attestation.add`: a person leg's answer | R-BTN-116, R-BTN-181 |
  | `attestation add <repository> --type <type> --subject <json> --value <json> [--lapses <duration>]`, `attestation revoke <repository> <id>` | writes or revokes an attestation (proposed: [security](../proposals/security.md)) | R-BTN-181 |
  | `human-key add <pub>`, `human-key revoke <fingerprint>` | registers or revokes a human-only key: `POST /v1/human-keys` is built, the command is proposed | R-BTN-185 |
  | `repo board <repository>` | the board | R-BTN-179 |
  | `repo policy <repository>` | the policy | R-BTN-189 |
  | `repo protect --print <forge> \| --check <forge>` | `repo.policy`, then local (proposed: [security](../proposals/security.md)) | R-BTN-180 |
  | `repo init` | local: writes the repository's files | R-BTN-134 |
  | `repo sync [--if-wanted] [--defaults-only]`, `repo mirror [--if-wanted]` | runs a sync, or the mirror | R-BTN-93, R-BTN-102 |
  | `repo spool <repository>` | local | R-BTN-105 |
  | `course test <root> <course> [--base <ref>] [--board <file>]` | local: tests a course | R-BTN-69 |
  | `runner start [--delivers git,forge-check,source]` | runs a runner | R-BTN-72, R-BTN-171 |
  | `runner register --token <t> --name <name> [--key ssh\|api]` | registers with a token (proposed: [checks and executors](../proposals/checks-and-executors.md)) | R-BTN-117 |
  | `runner accept-grant <repository> [--confirm]`, `runner decline-grant <repository>` | accepts or declines a grant | R-BTN-146 |
  | `key create <file>` | local: makes an API key | R-BTN-159 |
  | `home list`, `home use <name>`, `home add [<name>] --repository <id> [--origin <url>] [--checkout <path>]`, `home remove <name>`, `home show` | local: the homes file | R-BTN-127 |
  | `server start --db <file> --admin-keys <file>` | local: starts the local host | R-BTN-56, R-BTN-158 |
  | `owner grant list <repository>` | owners, grants, settings and bars | R-BTN-179, R-BTN-146 |
  | `owner grant add <repository> --key <pub> --capabilities <a,b> [--hostname <h>] [--label <l>] [--max-claims <n>] [--confirm-span]`, or `--api-key --name <name>` | grants a runner key | R-BTN-58, R-BTN-146, R-BTN-159 |
  | `owner grant revoke <repository> <fingerprint>` | revokes a grant | R-BTN-58 |
  | `owner grant role <repository> <fingerprint> --role runner\|trusted-runner [--domain <label>] [--checker]` | sets a grant's role, domain and checker mark (proposed: [security](../proposals/security.md)) | R-BTN-180 |
  | `owner grant flags <repository> <fingerprint> --sync\|--no-sync` | sets a grant's `sync` flag | R-BTN-146 |
  | `owner owner add <repository> <pub>`, `owner owner remove <repository> <fingerprint>` | adds or removes an owner | R-BTN-58 |
  | `owner bar add <repository> --course <c> --tag <t>`, `owner bar lift <repository> <id>`, `owner bar follow <repository> <course>` | the owner's bars | R-BTN-67, R-BTN-142 |
  | `owner settings show <repository>`, `owner settings set <repository>` | reads (`owner.grant.list`) or sets the owner settings | R-BTN-66, R-BTN-140 |
  | `owner policy show <repository>`, `owner policy diff <repository> [<version>]`, `owner policy log <repository>`, `owner policy set <repository> <file>`, `owner policy apply <repository> <preset>` | reads (`repo.policy`, `owner.policy.log`) or sets the policy | R-BTN-188 |
  | `owner consent add <repository> <home>`, `owner consent withdraw <repository> <home>` | a `code_repos` consent (proposed: [data model and API](../proposals/data-model-and-api.md)) | R-BTN-140 |
  | `owner sync-key add <repository> <pub> --role sync\|mirror`, `owner sync-key revoke <repository> <fingerprint>` | sync and mirror keys | R-BTN-93 |
  | `owner sync want <repository>` | records a sync want | R-BTN-105 |
  | `owner token create <repository> --role runner [--capabilities …] [--ttl <d>] [--uses <n>]`, `owner token revoke <repository> <id>` | registration tokens (proposed: [checks and executors](../proposals/checks-and-executors.md)) | R-BTN-117 |
  | `owner check-runner add <repository> <pub> --name <hostname> [--capabilities …]`, `owner check-runner revoke <repository> <fingerprint>` | check-runners (proposed: [checks and executors](../proposals/checks-and-executors.md)) | R-BTN-114 |
  | `admin repo list` | the registry | R-BTN-179 |
  | `admin repo add <forge path> --owner-key <pub>`, `admin repo set <id>`, `admin repo retire <id>` | registers, changes or retires a repository | R-BTN-47, R-BTN-138 |
  | `admin repo resync <repository> --force [<sha>]` | forces a resync (proposed: [tickets and sources](../proposals/tickets-and-sources.md)) | R-BTN-11 |
  | `admin grant add <repository> --key <pub> --capabilities <a,b> [--max-claims <n>]` | grants a runner key | R-BTN-57, R-BTN-188 |
  | `admin key revoke <fingerprint>`, `admin key hostname <fingerprint> <hostname>` | revokes a key; changes its hostname | R-BTN-57 |
  | `admin keys set --file <path>`, `admin forge-secrets set --file <path>` | local: the secret sink | R-BTN-136 |
  | `admin github-app create --org <org>`, `admin check-app create --org <org> --key-out <path>` | local: creates an App | R-BTN-57, §12.7 |
  | `admin probe add --key <pub> --label <l>`, `admin resource add <name>`, `admin instance add <name>`, `admin reading set <instance>` | instruments, resources, instances, readings | R-BTN-76, R-BTN-101 |
  | `admin capacity set <capability> <n> \| --clear` | a capability's capacity | R-BTN-178 |
  | `admin settings set [--link-hosts …] [--session-hosts …] [--check-app-id <id>] [--recommended-client <version>]` | the instance settings | R-BTN-112, R-BTN-113, R-BTN-197, §12.7 |
  | `admin freeze`, `admin unfreeze`, `admin seal`, `admin export [--with-history]`, `admin import <file>` | freeze, seal, export, import | R-BTN-88 |
  | `admin state` | the state in one request | R-BTN-57, R-BTN-179 |
  | `admin open` | an administrator's dashboard sign-in | R-BTN-155 |
  | `owner open`, `admin confirm <code>`, `owner confirm <code>`, `admin sessions revoke --all`, `owner sessions revoke` | owners' sign-in, confirmations and session revocation (proposed: [people and dashboard](../proposals/people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions)) | R-BTN-155 |
  | `owner mcp-key create <repository> --name <name> [--actions read \| <id>,…] [--ttl <days>]`, `owner mcp-key revoke <repository> <name>` | MCP keys (proposed: [people and dashboard](../proposals/people-and-dashboard.md#2-mcp)) | R-BTN-130 |

- **R-BTN-197 (Baton states the client versions it serves).** `status: built`
  - **The client says what it is.** Every request the CLI sends carries `Baton-Client:
    baton/<version>`, its package's version, with `+dev` appended when it runs from a git
    working tree (`baton/0.1.4+dev`). A request without the header is compared as `0.0.0`.
  - **Baton says what it serves.** Every response under `/v1`, a refusal included, carries
    `Baton-Client-Versions: min=<version>, recommended=<version>`. `min` is a constant in
    Baton's code: the oldest client whose requests it still reads. `recommended` is at or above
    `min`; the code sets its default and an administrator may raise it (`admin settings set
    --recommended-client`), never below that default. Versions compare by semver precedence,
    `+dev` taking no part.
  - **Below `min` is one refusal.** A request from a client below `min` is answered
    `client-too-old` (§14), naming the client's version, `min` and `recommended`, before its
    signature is checked and before anything is read or written. No other answer depends on
    the client's version.
  - **`min` rises only after notice.** A change that raises `min` to a version lands only once
    `recommended` has been that version or higher on the deployment for at least 14 days.
  - **Below `recommended` is a warning.** The CLI prints `baton: this CLI is <version>; Baton
    recommends <recommended> and refuses below <min>` once per command, and a runner once at
    start and again whenever the header's values change. Every runner call records its
    `Baton-Client` as the runner's `client_version` (§13.3), and the state read lists each live
    runner whose `client_version` is below `recommended`.
  - **A refused runner stops; no client updates itself.** A runner answered `client-too-old`
    takes no claim, logs the refusal with the versions, and exits non-zero; a claim it held
    ends as its lease lapses (R-BTN-9). No client installs, fetches or switches its version on
    Baton's answer, and the header carries version numbers only (R-BTN-107).

- **R-BTN-130 (MCP and delegated keys).** `status: specified B-25` Baton serves no MCP endpoint and registers no
  delegated key (B-25, B-124). What a delegated key may do is R-BTN-186's. The design of
  `POST /v1/mcp` and the MCP key is
  [the proposal, §2](../proposals/people-and-dashboard.md#2-mcp); OAuth for MCP clients that
  cannot send a bearer is [BATON_MCP_OAUTH_SPEC](../BATON_MCP_OAUTH_SPEC.md) (B-73).

### 11.4 The dashboard

- **R-BTN-155 (dashboard sign-in and sessions).** `status: partly B-46 B-204 B-252 B-310`
  - **Sign-in.** `baton admin open` asks `POST /v1/admin/login-links` with an administrator
    key for a one-time link, `<origin>/login#<token>`, valid 5 minutes and used once. The page
    sends `POST /v1/login {token}`, which answers the session cookie `__Host-baton_session`
    (R-BTN-16) only while the minting key is an administrator's.
  - **Sessions.** A session is its key's: the administrator key whose link opened it, or the
    one its Access line names. It lives 12 hours and ends as
    soon as the key leaves `BATON_ADMIN_KEYS`, checked on every request. It calls `/v1/ui/*`
    and reads the `GET`s §14 lists a session on (§14, R-BTN-16); a destructive action carries `confirm: true` (§12.2). Link tokens and session values
    are stored as hashes (§12.1).
  - **Sign-in through Cloudflare Access.** Behind Cloudflare Access a person signs in with no
    terminal, by one explicit act: `/login` offers "Sign in with Cloudflare Access", and only that
    click sends `POST /v1/login {access: true}`. The page never sends it by itself, after a
    logout or a session's end included. Baton verifies the request's `Cf-Access-Jwt-Assertion`
    against the team's keys and the application's audience and reads its `email` claim. The
    secret `ACCESS_IDENTITIES` binds emails to keys: one `<email> <fingerprint>` line each,
    emails ASCII and compared ASCII-lowercased, at most one line per email, several emails to
    one key allowed. Whoever controls the deployment sets it (R-BTN-57). An email bound to an
    administrator key gets a session of that key, as its link would open it; that session's key
    is the line's. An Access sign-in refusal with `unauthenticated` sets no cookie and carries
    one `reason`, checked in this order: `not-configured` if either `ACCESS_TEAM_DOMAIN` or
    `ACCESS_AUD` is absent; `no-assertion` if no assertion reached Baton; `unverified` if the
    assertion did not verify or lacks a usable ASCII email; `not-bound` if the verified email
    has no line or its line names a key not in `BATON_ADMIN_KEYS`. Both binding failures have
    the same answer; no refusal echoes the email. The page explains the reason as text and
    still offers a one-time link. An unreadable key set is `unavailable`. A value of
    `ACCESS_IDENTITIES` with a malformed or duplicated line binds nothing: an Access sign-in
    that reaches the binding check is `unavailable` until it is fixed. Each successful sign-in
    is recorded as an event of its key, `{act: "login", via: "access"}`, with the email's
    SHA-256, never the email. Each request
    a session so opened authorizes also checks its line: the session ends as soon as the email
    leaves `ACCESS_IDENTITIES` or its line names another key. Baton reads no assertion after
    the sign-in, so ending the Access session does not end Baton's.
  - **Cloudflare Access, with no administrator key.** While `BATON_ADMIN_KEYS` names no key, a
    request to `/v1/ui/*` is authenticated by a verified Cloudflare Access
    assertion alone (verified as above, for an email in `OWNER_EMAILS`; `ACCESS_IDENTITIES` plays
    no part). Once an administrator key is configured, only a session authenticates `/v1/ui/*`
    (R-BTN-16).
  - **Not built:** sign-in by a code the key holder confirms, owners' sessions, session
    revocation and confirmation codes
    ([the proposal, §3](../proposals/people-and-dashboard.md#3-sign-in-sessions-and-confirmed-actions);
    B-206).

- **The screens.** `src/core/screens.ts` is the one table of screens: each has an id (`root`,
  `tenant/<segment>` or `repository/<segment>[/{param}]`), a path, and the session role that may
  open it. The front serves the dashboard's shell at each path, every `{param}` one id-shaped
  segment, and at `/login`; the shell draws no data.
  - `/` is `root`.
  - Under `/repositories/{repository}`: `/board`, `/tickets`, `/tickets/{ticket}`, `/goals`,
    `/courses`, `/courses/{course}`, `/conditions`, `/conditions/{condition}`, `/runners`,
    `/runners/{runner}`, `/grants`, `/owners`, `/tokens`, `/mcp-keys`, `/sync-keys`,
    `/check-runners`, `/policy`, `/settings`, `/bars`, `/consents`, `/attestations`, `/sync`.
  - The tenant screens, an administrator's session only: `/repositories`, `/instances`,
    `/resources`, `/capacities`, `/settings`, `/state`, `/sessions`.

  What each screen draws, its controls, polling and wording are not built:
  [the proposal, §4](../proposals/people-and-dashboard.md#4-the-screens) (B-207, B-208, B-221).
  Every value a screen draws reaches it as a text node (§12.3).
